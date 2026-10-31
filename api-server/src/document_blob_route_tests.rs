//! Router-level delivery checks with real session resolution and a local SQL fixture.

use super::*;
use axum::{body::Body, http::Request};
use base64::Engine;
use serde_json::{json, Value};
use std::sync::Mutex;
use tower::ServiceExt;
use tower_cookies::CookieManagerLayer;

const ACTOR: &str = "abababababababababababababababababababababababababababababababab";
const OTHER: &str = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
const DEFAULT_PERMISSIONS: &[&str] = &[
    "document:create",
    "document:read",
    "document_version:read",
    "document_template:write",
    "document_template:read",
    "hr_expense:create",
    "hr_expense_receipt:read",
];

struct Rows {
    actor_permissions: Vec<String>,
    other_permissions: Vec<String>,
    documents: Vec<Value>,
    templates: Vec<Value>,
    receipts: Vec<Value>,
    versions: Vec<Value>,
    creation_receipts: Vec<Value>,
    field_permissions: Vec<Value>,
    restrict_after_versions: bool,
}

impl Default for Rows {
    fn default() -> Self {
        let permissions = || {
            DEFAULT_PERMISSIONS
                .iter()
                .map(|s| (*s).to_owned())
                .collect()
        };
        Self {
            actor_permissions: permissions(),
            other_permissions: permissions(),
            documents: Vec::new(),
            templates: Vec::new(),
            receipts: Vec::new(),
            versions: Vec::new(),
            creation_receipts: Vec::new(),
            field_permissions: Vec::new(),
            restrict_after_versions: false,
        }
    }
}

/// Only the identity probe trusts a token-to-actor mapping. Authority queries
/// must specify that identity; resource queries must retain the actor token.
async fn sql(State(rows): State<Arc<Mutex<Rows>>>, headers: HeaderMap, query: String) -> Response {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let actor = match token {
        "Bearer actor-token" => ACTOR,
        "Bearer other-token" => OTHER,
        "Bearer authority-token" => ACTOR,
        _ => return StatusCode::UNAUTHORIZED.into_response(),
    };
    let mut rows = rows.lock().expect("SQL fixture lock");
    let subject = if query.contains(OTHER) { OTHER } else { ACTOR };
    let role_id = if subject == ACTOR { 9 } else { 10 };
    let data = if query == "SELECT id FROM organization LIMIT 1" {
        vec![json!({"id": 7})]
    } else if query.contains(" FROM user_profile ") {
        assert_eq!(token, "Bearer authority-token");
        assert!(query.contains(subject), "{query}");
        vec![json!({
            "identity": subject, "organization_id": 7,
            "is_active": true, "is_superuser": false
        })]
    } else if query.contains(" FROM user_organization ") {
        assert!(query.contains(subject), "{query}");
        vec![json!({
            "id": role_id, "organization_id": 7, "company_id": 3,
            "user_identity": subject, "role_id": role_id,
            "is_active": true, "is_default": true
        })]
    } else if query.contains(" FROM role ") {
        vec![
            json!({"id":9, "organization_id":7, "name":"staff",
                "permissions": rows.actor_permissions, "is_active":true}),
            json!({"id":10, "organization_id":7, "name":"staff",
                "permissions": rows.other_permissions, "is_active":true}),
        ]
    } else if query.contains(" FROM field_permission ") {
        rows.field_permissions.clone()
    } else if query.contains(" FROM record_creation_receipt ") {
        assert_eq!(token, "Bearer authority-token");
        assert!(
            query.contains("company_id = 3")
                && query.contains("model = 'document'")
                && query.contains(&format!("created_by = 0x{subject}")),
            "{query}"
        );
        rows.creation_receipts
            .iter()
            .filter(|row| {
                row["created_by"] == subject && query.contains(row["id"].as_str().unwrap())
            })
            .cloned()
            .collect()
    } else if query.contains(" FROM user_role_assignment ")
        || query.contains(" FROM org_permission ")
    {
        Vec::new()
    } else {
        assert_ne!(token, "Bearer authority-token", "{query}");
        assert!(query.contains("organization_id = 7"), "{query}");
        if query.contains(" FROM document ") {
            assert!(query.contains(&format!("owner_id = 0x{actor}")), "{query}");
            assert!(query.contains("is_deleted = false"), "{query}");
            rows.documents
                .iter()
                .filter(|row| row["owner_id"] == actor && row["is_deleted"] == false)
                .cloned()
                .collect()
        } else if query.contains(" FROM document_version ") {
            assert!(
                query.contains(&format!("created_by = 0x{actor}")),
                "{query}"
            );
            let versions = rows
                .versions
                .iter()
                .filter(|row| row["created_by"] == actor)
                .cloned()
                .collect();
            if rows.restrict_after_versions {
                rows.field_permissions = vec![
                    json!({"id":1,"organization_id":7,"role_id":9,"resource":"document","action":"read","allowed_fields":["id"]}),
                ];
            }
            versions
        } else if query.contains(" FROM document_template ") {
            rows.templates.clone()
        } else if query.contains(" FROM hr_expense_receipt ") {
            rows.receipts.clone()
        } else {
            panic!("unexpected fixture SQL: {query}");
        }
    };
    // Respect SQL projections rather than accidentally returning fields omitted
    // by a permission mask or by the canonical resource query.
    let selected = query
        .strip_prefix("SELECT ")
        .and_then(|query| query.split_once(" FROM "))
        .map(|(columns, _)| columns)
        .expect("SELECT fixture query");
    let names: Vec<String> = if selected == "*" {
        data.first()
            .and_then(Value::as_object)
            .map(|row| row.keys().cloned().collect())
            .unwrap_or_default()
    } else {
        selected.split(", ").map(str::to_owned).collect()
    };
    (
        [("spacetime-identity", actor)],
        Json(json!([{
            "schema": {"elements": names.iter().map(|name| json!({"name":{"some":name}})).collect::<Vec<_>>()},
            "rows": data.iter().map(|row| names.iter().map(|name| row[name].clone()).collect::<Vec<_>>()).collect::<Vec<_>>()
        }])),
    )
        .into_response()
}

struct Fixture {
    app: Router,
    state: Arc<AppState>,
    rows: Arc<Mutex<Rows>>,
    root: PathBuf,
    server: tokio::task::JoinHandle<()>,
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    bytes: Bytes,
}

impl Reply {
    fn expect_status(self, expected: StatusCode) -> Self {
        assert_eq!(
            self.status,
            expected,
            "{}",
            String::from_utf8_lossy(&self.bytes)
        );
        self
    }

    fn json(self) -> Value {
        serde_json::from_slice(&self.bytes).expect("JSON response")
    }
}

struct UploadSlot {
    object_key: String,
    upload_url: String,
    url: String,
    checksum: String,
}

impl UploadSlot {
    fn pinned_url(&self) -> String {
        format!("{}?sha256={}", self.url, self.checksum)
    }

    fn document(&self, owner: &str) -> Value {
        json!({
            "id": if owner == ACTOR {21} else {22},
            "organization_id":7, "company_id":3, "owner_id":owner,
            "url":self.url, "checksum":self.checksum, "is_deleted":false
        })
    }

    fn template(&self) -> Value {
        json!({
            "id":31, "organization_id":7, "company_id":3, "is_active":true,
            "metadata":json!({"documentBranding": {
                "schemaVersion":1, "logoUrl":self.pinned_url()
            }}).to_string()
        })
    }
}

impl Fixture {
    fn register_submission(&self, slot: &UploadSlot, submission_id: &str) {
        let mut document = slot.document(ACTOR);
        document["metadata"] = json!(json!({"uploadSubmissionId":submission_id}).to_string());
        let mut rows = self.rows.lock().unwrap();
        rows.documents.push(document);
        rows.versions.push(json!({"id":31,"organization_id":7,"document_id":21,"version_number":1,
            "url":slot.url,"checksum":slot.checksum,"created_by":ACTOR,"metadata":json!({"uploadSubmissionId":submission_id}).to_string()}));
        rows.creation_receipts.push(json!({"id":format!("7:3:document:{submission_id}"),"organization_id":7,"company_id":3,"model":"document","operation_key":submission_id,"payload_hash":format!("sha256:{}","f".repeat(64)),"record_id":21,"created_by":ACTOR}));
    }

    async fn new() -> Self {
        let rows = Arc::new(Mutex::new(Rows::default()));
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("SQL fixture port");
        let address = listener.local_addr().expect("SQL fixture address");
        let mock = Router::new()
            .route("/v1/database/test-module/sql", post(sql))
            .with_state(rows.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, mock)
                .await
                .expect("SQL fixture server")
        });
        let root = std::env::temp_dir().join(format!(
            "lumiere-blob-route-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let mut config = crate::session::test_support::test_config(Some("authority-token"));
        config.stdb_host = format!("http://{address}");
        config.document_blob_store = DocumentBlobStoreConfig::Local { root: root.clone() };
        let state = Arc::new(AppState::new(config));
        let app = Router::new()
            .nest("/v1", blob_router())
            .layer(CookieManagerLayer::new())
            .with_state(state.clone());
        Self {
            app,
            state,
            rows,
            root,
            server,
        }
    }

    async fn request(&self, token: &str, method: &str, url: &str, bytes: Vec<u8>) -> Reply {
        let response = self
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(url.replacen("/api/", "/v1/", 1))
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(bytes))
                    .expect("fixture request"),
            )
            .await
            .expect("router response");
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("response bytes");
        Reply {
            status,
            headers,
            bytes,
        }
    }

    async fn get(&self, token: &str, url: &str) -> Reply {
        self.request(token, "GET", url, Vec::new()).await
    }

    async fn reserve(&self, purpose: &str, content_type: &str, bytes: &[u8]) -> UploadSlot {
        let checksum = hex::encode(Sha256::digest(bytes));
        let mut body = json!({
            "fileName":"fixture.bin", "contentType":content_type,
            "contentLength":bytes.len(), "companyId":3, "checksum":checksum
        });
        // Existing document callers omit purpose; its default remains Document.
        if purpose != "document" {
            body["purpose"] = json!(purpose);
        }
        let response = self
            .request(
                "actor-token",
                "POST",
                "/api/documents/blobs/presign",
                serde_json::to_vec(&body).unwrap(),
            )
            .await
            .expect_status(StatusCode::OK)
            .json();
        UploadSlot {
            object_key: response["objectKey"].as_str().unwrap().to_owned(),
            upload_url: response["uploadUrl"].as_str().unwrap().to_owned(),
            url: response["publicUrl"].as_str().unwrap().to_owned(),
            checksum,
        }
    }

    async fn complete(&self, token: &str, slot: &UploadSlot) -> Reply {
        self.request(
            token,
            "POST",
            "/api/documents/blobs/complete",
            serde_json::to_vec(&json!({
                "objectKey":slot.object_key, "checksum":slot.checksum
            }))
            .unwrap(),
        )
        .await
    }

    async fn completed(&self, purpose: &str, mime: &str, bytes: &[u8]) -> UploadSlot {
        let slot = self.reserve(purpose, mime, bytes).await;
        self.request("actor-token", "PUT", &slot.upload_url, bytes.to_vec())
            .await
            .expect_status(StatusCode::NO_CONTENT);
        self.complete("actor-token", &slot)
            .await
            .expect_status(StatusCode::OK);
        slot
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn png() -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=")
        .expect("PNG fixture")
}

#[tokio::test]
async fn upload_accepts_three_mib_and_presign_rejects_the_declared_size_above_the_cap() {
    let fixture = Fixture::new().await;
    // Cross Axum's default 2 MiB extractor limit through the actual PUT route.
    let bytes = vec![0x5a; 3 * 1024 * 1024];
    let size = bytes.len();
    let slot = fixture
        .reserve("document", "application/octet-stream", &bytes)
        .await;
    fixture
        .request("actor-token", "PUT", &slot.upload_url, bytes)
        .await
        .expect_status(StatusCode::NO_CONTENT);
    let completed = fixture
        .complete("actor-token", &slot)
        .await
        .expect_status(StatusCode::OK)
        .json();
    assert_eq!(completed["fileSize"], size);
    assert_eq!(completed["checksum"], slot.checksum);

    // Reject the declaration without allocating or uploading a 50 MiB buffer.
    fixture
        .request(
            "actor-token",
            "POST",
            "/api/documents/blobs/presign",
            serde_json::to_vec(&json!({
                "fileName":"oversize.bin", "contentType":"application/octet-stream",
                "contentLength":MAX_UPLOAD_BYTES + 1, "companyId":3
            }))
            .unwrap(),
        )
        .await
        .expect_status(StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn reservation_upload_and_completion_require_current_owner_write_authority() {
    let fixture = Fixture::new().await;
    let bytes = b"private uploaded document";
    let slot = fixture.reserve("document", "text/plain", bytes).await;
    fixture
        .request("other-token", "PUT", &slot.upload_url, bytes.to_vec())
        .await
        .expect_status(StatusCode::NOT_FOUND);
    fixture
        .complete("other-token", &slot)
        .await
        .expect_status(StatusCode::NOT_FOUND);
    fixture.rows.lock().unwrap().actor_permissions = vec!["document:read".into()];
    fixture
        .request("actor-token", "PUT", &slot.upload_url, bytes.to_vec())
        .await
        .expect_status(StatusCode::FORBIDDEN);
    fixture.rows.lock().unwrap().actor_permissions = vec!["document:create".into()];
    fixture
        .request("actor-token", "PUT", &slot.upload_url, bytes.to_vec())
        .await
        .expect_status(StatusCode::NO_CONTENT);
    fixture.rows.lock().unwrap().actor_permissions.clear();
    fixture
        .complete("actor-token", &slot)
        .await
        .expect_status(StatusCode::FORBIDDEN);
    fixture.rows.lock().unwrap().actor_permissions =
        vec!["document:create".into(), "document:read".into()];
    let completed = fixture
        .complete("actor-token", &slot)
        .await
        .expect_status(StatusCode::OK)
        .json();
    assert_eq!(completed["url"], slot.url);
    assert_eq!(completed["checksum"], slot.checksum);
    fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn document_delivery_requires_current_registration_and_cannot_be_copied_to_another_owner() {
    let fixture = Fixture::new().await;
    let bytes = b"registered private document";
    let slot = fixture.completed("document", "text/plain", bytes).await;
    fixture.rows.lock().unwrap().documents = vec![slot.document(ACTOR), slot.document(OTHER)];
    let response = fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::OK);
    assert_eq!(&response.bytes[..], bytes);
    assert_eq!(response.headers[header::CACHE_CONTROL], "private, no-store");
    assert_eq!(response.headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
    fixture
        .get("other-token", &slot.url)
        .await
        .expect_status(StatusCode::NOT_FOUND);
    fixture
        .rows
        .lock()
        .unwrap()
        .actor_permissions
        .retain(|permission| permission != "document:read");
    fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::FORBIDDEN);
    {
        let mut rows = fixture.rows.lock().unwrap();
        rows.actor_permissions.push("document:read".into());
        rows.documents[0]["is_deleted"] = json!(true);
    }
    fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn unbound_legacy_metadata_and_tampered_storage_never_deliver_document_bytes() {
    let fixture = Fixture::new().await;
    let slot = fixture
        .completed("document", "text/plain", b"private bytes")
        .await;
    fixture.rows.lock().unwrap().documents = vec![slot.document(ACTOR)];
    let metadata_key = format!("{}.meta.json", slot.object_key);
    let store = &fixture.state.config.document_blob_store;
    let mut meta = read_meta(store, &metadata_key).await.unwrap();
    meta.created_by = None;
    write_meta(store, &metadata_key, &meta).await.unwrap();
    fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::NOT_FOUND);
    meta.created_by = Some(ACTOR.into());
    write_meta(store, &metadata_key, &meta).await.unwrap();
    fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::OK);
    fs::write(
        fixture.root.join(format!("{}.bin", slot.object_key)),
        b"changed bytes",
    )
    .unwrap();
    fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::CONFLICT);
}

#[tokio::test]
async fn branding_preview_and_published_read_have_distinct_current_grants() {
    let fixture = Fixture::new().await;
    let bytes = png();
    let slot = fixture.completed("branding", "image/png", &bytes).await;
    fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::NOT_FOUND);
    let response = fixture
        .get("actor-token", &slot.pinned_url())
        .await
        .expect_status(StatusCode::OK);
    assert_eq!(&response.bytes[..], bytes);
    fixture
        .get("other-token", &slot.pinned_url())
        .await
        .expect_status(StatusCode::NOT_FOUND);
    fixture.rows.lock().unwrap().actor_permissions = vec!["document_template:read".into()];
    fixture
        .get("actor-token", &slot.pinned_url())
        .await
        .expect_status(StatusCode::NOT_FOUND);
    fixture.rows.lock().unwrap().templates = vec![slot.template()];
    fixture
        .get("other-token", &slot.pinned_url())
        .await
        .expect_status(StatusCode::OK);
    fixture.rows.lock().unwrap().other_permissions.clear();
    fixture
        .get("other-token", &slot.pinned_url())
        .await
        .expect_status(StatusCode::NOT_FOUND);
    fixture.rows.lock().unwrap().templates.clear();
    fixture
        .get("actor-token", &slot.pinned_url())
        .await
        .expect_status(StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_template_reference_cannot_convert_a_private_png_document_into_branding() {
    let fixture = Fixture::new().await;
    let slot = fixture.completed("document", "image/png", &png()).await;
    fixture.rows.lock().unwrap().templates = vec![slot.template()];
    fixture
        .get("other-token", &slot.pinned_url())
        .await
        .expect_status(StatusCode::NOT_FOUND);
    let result = read_completed_branding_blob(
        &fixture.state.config.document_blob_store,
        7,
        3,
        &slot.pinned_url(),
    )
    .await;
    assert!(matches!(result, Err(ApiError::NotFound(_))));
}

#[tokio::test]
async fn evidence_byte_admission_uses_current_document_policy_and_rejects_branding() {
    let fixture = Fixture::new().await;
    let bytes = b"private extraction source";
    let slot = fixture.completed("document", "text/plain", bytes).await;
    let branding = fixture.completed("branding", "image/png", &png()).await;
    let mut branded_document = branding.document(ACTOR);
    branded_document["id"] = json!(23);
    fixture.rows.lock().unwrap().documents =
        vec![slot.document(ACTOR), slot.document(OTHER), branded_document];
    let actor =
        crate::session::resolve_api_session(&fixture.state, Some("Bearer actor-token"), None, None)
            .await
            .expect("resolve uploader session")
            .expect("authenticated uploader");
    let blob = read_authorized_document_blob(&fixture.state, &actor, 3, 21, &slot.url)
        .await
        .expect("authorized extraction source");
    assert_eq!(&blob.bytes[..], bytes);
    assert_eq!(blob.checksum, slot.checksum);
    assert!(matches!(
        read_authorized_document_blob(&fixture.state, &actor, 3, 22, &slot.url).await,
        Err(ApiError::NotFound(_))
    ));
    assert!(matches!(
        read_authorized_document_blob(&fixture.state, &actor, 3, 23, &branding.url).await,
        Err(ApiError::NotFound(_))
    ));

    let other =
        crate::session::resolve_api_session(&fixture.state, Some("Bearer other-token"), None, None)
            .await
            .expect("resolve second actor session")
            .expect("authenticated second actor");
    assert!(matches!(
        read_authorized_document_blob(&fixture.state, &other, 3, 22, &slot.url).await,
        Err(ApiError::NotFound(_))
    ));

    fixture
        .rows
        .lock()
        .unwrap()
        .actor_permissions
        .retain(|permission| permission != "document:read");
    // A new operation resolves current policy instead of reusing the old grant.
    let revoked =
        crate::session::resolve_api_session(&fixture.state, Some("Bearer actor-token"), None, None)
            .await
            .expect("resolve current uploader session")
            .expect("authenticated uploader after read revocation");
    assert!(matches!(
        read_authorized_document_blob(&fixture.state, &revoked, 3, 21, &slot.url).await,
        Err(ApiError::Forbidden(_))
    ));
}

#[tokio::test]
async fn receipt_delivery_uses_receipt_grants_and_exact_storage_registration() {
    let fixture = Fixture::new().await;
    fixture.rows.lock().unwrap().actor_permissions =
        vec!["hr_expense:create".into(), "hr_expense_receipt:read".into()];
    let bytes = b"%PDF-1.7 receipt";
    let slot = fixture
        .completed("expense_receipt", "application/pdf", bytes)
        .await;
    fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::NOT_FOUND);
    fixture.rows.lock().unwrap().receipts = vec![json!({
        "id":41, "organization_id":7, "company_id":3,
        "storage_key":slot.object_key, "content_hash":slot.checksum
    })];
    let response = fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::OK);
    assert_eq!(&response.bytes[..], bytes);
    fixture
        .get("other-token", &slot.url)
        .await
        .expect_status(StatusCode::NOT_FOUND);
    fixture.rows.lock().unwrap().receipts[0]["content_hash"] = json!("0".repeat(64));
    fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::NOT_FOUND);
    {
        let mut rows = fixture.rows.lock().unwrap();
        rows.receipts[0]["content_hash"] = json!(slot.checksum);
        rows.actor_permissions = vec!["hr_expense:create".into()];
    }
    fixture
        .get("actor-token", &slot.url)
        .await
        .expect_status(StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn submission_receipt_recovers_same_blob_and_separates_failed_indexing() {
    let fixture = Fixture::new().await;
    let bytes = b"product,quantity,total\nSausage,8,4800";
    let checksum = hex::encode(Sha256::digest(bytes));
    let submission_id = "a".repeat(32);
    let body = json!({
        "fileName":"farm.csv", "contentType":"text/csv", "contentLength":bytes.len(),
        "companyId":3, "checksum":checksum, "submissionId":submission_id,
        "registration":{"name":"Farm source", "tagIds":[], "isFavorite":false}
    });
    let reserve = fixture
        .request(
            "actor-token",
            "POST",
            "/api/documents/blobs/presign",
            serde_json::to_vec(&body).unwrap(),
        )
        .await
        .expect_status(StatusCode::OK)
        .json();
    let slot = UploadSlot {
        object_key: reserve["objectKey"].as_str().unwrap().to_owned(),
        upload_url: reserve["uploadUrl"].as_str().unwrap().to_owned(),
        url: reserve["publicUrl"].as_str().unwrap().to_owned(),
        checksum: checksum.clone(),
    };
    fixture
        .request("actor-token", "PUT", &slot.upload_url, bytes.to_vec())
        .await
        .expect_status(StatusCode::NO_CONTENT);
    fixture
        .complete("actor-token", &slot)
        .await
        .expect_status(StatusCode::OK);
    let replay = fixture
        .request(
            "actor-token",
            "POST",
            "/api/documents/blobs/presign",
            serde_json::to_vec(&body).unwrap(),
        )
        .await
        .expect_status(StatusCode::OK)
        .json();
    assert_eq!(replay["objectKey"], reserve["objectKey"]);
    assert_eq!(replay["completed"], true);
    let receipt_url =
        format!("/api/documents/blobs/receipt?companyId=3&submissionId={submission_id}");
    let pending = fixture
        .get("actor-token", &receipt_url)
        .await
        .expect_status(StatusCode::OK)
        .json();
    assert_eq!(pending["fileSaved"], true);
    assert_eq!(pending["registrationState"], "unconfirmed");
    assert_eq!(pending["documentId"], Value::Null);
    fixture.register_submission(&slot, &submission_id);
    record_indexing_receipt(
        &fixture.state.config.document_blob_store,
        &slot.object_key,
        21,
        &checksum,
        false,
    )
    .await
    .unwrap();
    let failed = fixture
        .get("actor-token", &receipt_url)
        .await
        .expect_status(StatusCode::OK)
        .json();
    assert_eq!(failed["documentId"], "21");
    assert_eq!(failed["registrationState"], "registered");
    assert_eq!(failed["indexing"], "failed");
    record_indexing_receipt(
        &fixture.state.config.document_blob_store,
        &slot.object_key,
        21,
        &checksum,
        true,
    )
    .await
    .unwrap();
    // A concurrent late failure cannot erase an accepted queue result.
    record_indexing_receipt(
        &fixture.state.config.document_blob_store,
        &slot.object_key,
        21,
        &checksum,
        false,
    )
    .await
    .unwrap();
    let queued = fixture
        .get("actor-token", &receipt_url)
        .await
        .expect_status(StatusCode::OK)
        .json();
    assert_eq!(queued["indexing"], "queued");
    assert_eq!(queued["objectKey"], reserve["objectKey"]);
    fixture
        .get("other-token", &receipt_url)
        .await
        .expect_status(StatusCode::NOT_FOUND);
    fixture
        .rows
        .lock()
        .unwrap()
        .actor_permissions
        .retain(|permission| permission != "document:create");
    fixture
        .get("actor-token", &receipt_url)
        .await
        .expect_status(StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn submission_id_rejects_reuse_for_different_file_or_registration() {
    let fixture = Fixture::new().await;
    let body = json!({
        "fileName":"farm.csv", "contentType":"text/csv", "contentLength":4,
        "companyId":3, "checksum":"b".repeat(64), "submissionId":"a".repeat(32),
        "registration":{"name":"Farm source", "tagIds":[], "isFavorite":false}
    });
    fixture
        .request(
            "actor-token",
            "POST",
            "/api/documents/blobs/presign",
            serde_json::to_vec(&body).unwrap(),
        )
        .await
        .expect_status(StatusCode::OK);
    for (key, value) in [
        ("checksum", json!("c".repeat(64))),
        ("fileName", json!("another.csv")),
        (
            "registration",
            json!({"name":"Changed", "tagIds":[], "isFavorite":false}),
        ),
    ] {
        let mut changed = body.clone();
        changed[key] = value;
        fixture
            .request(
                "actor-token",
                "POST",
                "/api/documents/blobs/presign",
                serde_json::to_vec(&changed).unwrap(),
            )
            .await
            .expect_status(StatusCode::CONFLICT);
    }
}

#[tokio::test]
async fn submission_recovery_uses_immutable_version_and_rejects_purged_record() {
    let fixture = Fixture::new().await;
    let bytes = b"farm";
    let checksum = hex::encode(Sha256::digest(bytes));
    let submission_id = "a".repeat(32);
    let body = json!({"fileName":"farm.csv","contentType":"text/csv","contentLength":4,"companyId":3,"checksum":checksum,
        "submissionId":submission_id,"registration":{"name":"Private original name","description":"Private description","tagIds":[],"isFavorite":false}});
    let reserved = fixture
        .request(
            "actor-token",
            "POST",
            "/api/documents/blobs/presign",
            serde_json::to_vec(&body).unwrap(),
        )
        .await
        .expect_status(StatusCode::OK)
        .json();
    let slot = UploadSlot {
        object_key: reserved["objectKey"].as_str().unwrap().into(),
        upload_url: reserved["uploadUrl"].as_str().unwrap().into(),
        url: reserved["publicUrl"].as_str().unwrap().into(),
        checksum,
    };
    fixture
        .request("actor-token", "PUT", &slot.upload_url, bytes.to_vec())
        .await
        .expect_status(StatusCode::NO_CONTENT);
    fixture
        .complete("actor-token", &slot)
        .await
        .expect_status(StatusCode::OK);
    fixture.register_submission(&slot, &submission_id);
    let url = format!("/api/documents/blobs/receipt?companyId=3&submissionId={submission_id}");
    {
        let mut rows = fixture.rows.lock().unwrap();
        rows.documents[0]["metadata"] = json!("{\"note\":\"Edited later\"}");
        rows.documents[0]["url"] = json!("/api/documents/blobs/object/7/default/new-version");
        rows.documents[0]["checksum"] = json!("c".repeat(64));
    }
    let recovered = fixture
        .get("actor-token", &url)
        .await
        .expect_status(StatusCode::OK)
        .json();
    assert_eq!(recovered["documentId"], "21");
    assert_eq!(recovered["url"], slot.url);
    assert_eq!(recovered["indexing"], "superseded");
    fixture.rows.lock().unwrap().documents[0]["is_deleted"] = json!(true);
    fixture
        .get("actor-token", &url)
        .await
        .expect_status(StatusCode::FORBIDDEN);
    {
        let mut rows = fixture.rows.lock().unwrap();
        rows.documents.clear();
        rows.versions.clear();
    }
    let purged = fixture
        .get("actor-token", &url)
        .await
        .expect_status(StatusCode::GONE);
    assert!(!String::from_utf8_lossy(&purged.bytes).contains("Private original name"));
}

#[tokio::test]
async fn submission_receipts_respect_field_masks_and_late_narrowing() {
    let fixture = Fixture::new().await;
    let body = json!({"fileName":"farm.csv","contentType":"text/csv","contentLength":4,"companyId":3,"checksum":"b".repeat(64),
        "submissionId":"a".repeat(32),"registration":{"name":"Private original name","description":"Private description","tagIds":[],"isFavorite":false}});
    fixture
        .request(
            "actor-token",
            "POST",
            "/api/documents/blobs/presign",
            serde_json::to_vec(&body).unwrap(),
        )
        .await
        .expect_status(StatusCode::OK);
    let url = format!(
        "/api/documents/blobs/receipt?companyId=3&submissionId={}",
        "a".repeat(32)
    );
    for resource in ["document", "document_version"] {
        fixture.rows.lock().unwrap().field_permissions = vec![
            json!({"id":1,"organization_id":7,"role_id":9,"resource":resource,"action":"read","allowed_fields":["id"]}),
        ];
        let denied = fixture
            .get("actor-token", &url)
            .await
            .expect_status(StatusCode::FORBIDDEN);
        assert!(!String::from_utf8_lossy(&denied.bytes).contains("Private description"));
    }
    {
        let mut rows = fixture.rows.lock().unwrap();
        rows.field_permissions.clear();
        rows.restrict_after_versions = true;
    }
    fixture
        .get("actor-token", &url)
        .await
        .expect_status(StatusCode::FORBIDDEN);
}
