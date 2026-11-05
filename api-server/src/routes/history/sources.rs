//! Exact import-row provenance under the current record's history/read policy.
//!
//! Original source rows and review revisions are not inferred from record metadata.

use super::general::{
    record_adapter, require_record, require_record_with_access, source_read_allowed, RecordAdapter,
};
use super::*;
use serde_json::json;

const CANDIDATES_PER_PAGE: usize = 64;
const MAPPING_COLUMNS: &str =
    "id, organization_id, job_id, table_name, record_id, row_number, create_date";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SourcesQuery {
    company_id: u64,
    cursor: Option<String>,
    limit: Option<u32>,
}

impl SourcesQuery {
    fn prefix(&self, org: u64, actor: &str, table: &str, record: u64) -> String {
        format!("is1.{org}.{}.{table}.{record}.{actor}.", self.company_id)
    }

    fn after(&self, org: u64, actor: &str, table: &str, record: u64) -> Result<u64, ApiError> {
        if self.company_id == 0
            || record == 0
            || !(1..=50).contains(&self.limit.unwrap_or(50))
            || self.cursor.as_ref().is_some_and(|value| value.len() > 320)
        {
            return Err(ApiError::BadRequest("invalid import-source page".into()));
        }
        self.cursor.as_ref().map_or(Ok(0), |cursor| {
            cursor
                .strip_prefix(&self.prefix(org, actor, table, record))
                .and_then(decimal_id)
                .ok_or_else(|| ApiError::BadRequest("import-source cursor scope mismatch".into()))
        })
    }
}

fn read_columns(
    access: &FieldAccessContext,
    adapter: &RecordAdapter,
) -> Result<HashSet<String>, ApiError> {
    if !permission_allowed(access, "business_history", "read")
        || !source_read_allowed(access, adapter)
        || stdb_auth::resource_read_denied(access, "import-jobs")
    {
        return Err(ApiError::Forbidden(
            "Import source read permission denied".into(),
        ));
    }
    // As in the existing exact-import-receipt owner, source read permission
    // supplies authority; import-jobs supplies the field projection, not an
    // organization-wide import administration grant.
    let mut columns: HashSet<String> = resolve_http_sql_columns("import-jobs", Some(access))
        .map_err(ApiError::Internal)?
        .into_iter()
        .collect();
    // The list transport omits metadata by default. This dedicated owner emits
    // only validated hashes/references, and applies the same explicit field
    // projection before exposing them.
    for field in ["file_name", "metadata"] {
        if stdb_auth::has_resource_field_projection_permission(Some(access), "import-jobs", field) {
            columns.insert(field.into());
        }
    }
    if !columns.contains("status") || !columns.contains("table_name") {
        return Err(ApiError::Forbidden(
            "Import source fields are restricted".into(),
        ));
    }
    Ok(columns)
}

fn option_text(value: &Value) -> Option<&str> {
    value
        .as_str()
        .or_else(|| value.get("some").and_then(Value::as_str))
}

fn hash(value: Option<&Value>, length: usize) -> Option<&str> {
    value.and_then(Value::as_str).filter(|value| {
        value.len() == length
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn project_mapping(
    mapping: &Value,
    job: &Value,
    org: u64,
    company: u64,
    table: &str,
    record: u64,
    columns: &HashSet<String>,
) -> Result<Option<Value>, ApiError> {
    if number(mapping, "organization_id", "organizationId") != Some(org)
        || number(mapping, "record_id", "recordId") != Some(record)
        || cell(mapping, "table_name", "tableName").and_then(Value::as_str) != Some(table)
        || number(job, "organization_id", "organizationId") != Some(org)
        || number(mapping, "job_id", "jobId") != number(job, "id", "id")
        || cell(job, "table_name", "tableName").and_then(Value::as_str) != Some(table)
    {
        return Err(ApiError::Internal(
            "Import source escaped its record scope".into(),
        ));
    }
    let Some(metadata) = job
        .get("metadata")
        .and_then(option_text)
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
    else {
        return Ok(None);
    };
    // Only the native tracked-import owner writes this complete correlation
    // envelope. Unscoped legacy jobs cannot establish a company source trace.
    if metadata.get("correlation_version").and_then(Value::as_u64) != Some(1)
        || metadata.get("company_id").and_then(Value::as_u64) != Some(company)
        || hash(metadata.get("request_id"), 32).is_none()
        || hash(metadata.get("sha256"), 64).is_none()
    {
        return Ok(None);
    }
    let status = job
        .get("status")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "success" | "partial" | "rolled_back"));
    let Some(status) = status else {
        return Ok(None);
    };
    let id = number(mapping, "id", "id")
        .filter(|id| *id > 0)
        .ok_or_else(malformed_evidence)?;
    let job_id = number(job, "id", "id")
        .filter(|id| *id > 0)
        .ok_or_else(malformed_evidence)?;
    let row = number(mapping, "row_number", "rowNumber")
        .filter(|row| *row > 0 && *row <= u32::MAX as u64)
        .ok_or_else(malformed_evidence)?;
    let imported_at =
        occurred_at(cell(mapping, "create_date", "createDate").ok_or_else(malformed_evidence)?)?;
    Ok(Some(json!({
        "id":id.to_string(),"kind":"import","jobId":job_id.to_string(),
        "rowNumber":row,"tableName":table,"status":status,"importedAt":imported_at,
        "fileName":if columns.contains("file_name") { cell(job,"file_name","fileName").and_then(option_text) } else { None },
        "contentSha256":if columns.contains("metadata") { hash(metadata.get("sha256"),64) } else { None },
        "verification":"tracked-import","review":null
    })))
}

/// A v1 job envelope was editable through the older assistant metadata route.
/// Only the new private native import event can establish that the exact job
/// mapping was produced after those fields became protected. Raw audit rows
/// alone supply no authority: their IDs must be retained by this private event.
#[allow(clippy::too_many_arguments)]
async fn native_mapping_receipt(
    owner: &StdbClient,
    mapping: &Value,
    job: &Value,
    org: u64,
    company: u64,
    table: &str,
    record: u64,
) -> Result<bool, ApiError> {
    let operation = match table {
        "product" => "import_product_csv",
        "contact" => "import_contact_csv",
        "stock_location" => "import_stock_location_csv",
        "account_move" => "import_account_move_csv",
        "account_move_line" => "import_account_move_line_csv",
        _ => return Ok(false),
    };
    let importing_actor = cell(job, "create_uid", "createUid")
        .and_then(identity_cell_to_hex)
        .and_then(|actor| parse_stdb_identity_hex(&actor))
        .ok_or_else(malformed_evidence)?;
    let imported_at =
        occurred_at(cell(mapping, "create_date", "createDate").ok_or_else(malformed_evidence)?)?;
    for (provider, company_scope) in [
        ("business_change", true),
        ("organization_business_change", false),
    ] {
        let scope = if company_scope {
            format!("organization_id = {org} AND company_id = {company}")
        } else {
            format!("organization_id = {org}")
        };
        let company_column = if company_scope { ", company_id" } else { "" };
        let events=owner.query_sql(&format!("SELECT id, organization_id{company_column}, resource, record_id, subject_resource, subject_record_id, operation, actor_identity, occurred_at, schema_version, audit_log_id FROM {provider} WHERE {scope} AND resource = '{table}' AND record_id = {record} AND operation = '{operation}' LIMIT 2")).await.map_err(ApiError::internal)?;
        if events.len() > 1 {
            return Err(malformed_evidence());
        }
        for event in events {
            let actor = cell(&event, "actor_identity", "actorIdentity")
                .and_then(identity_cell_to_hex)
                .and_then(|actor| parse_stdb_identity_hex(&actor));
            if number(&event, "organization_id", "organizationId") != Some(org)
                || (company_scope && number(&event, "company_id", "companyId") != Some(company))
                || event["resource"] != table
                || number(&event, "record_id", "recordId") != Some(record)
                || cell(&event, "subject_resource", "subjectResource").and_then(Value::as_str)
                    != Some(table)
                || number(&event, "subject_record_id", "subjectRecordId") != Some(record)
                || event["operation"] != operation
                || number(&event, "schema_version", "schemaVersion") != Some(1)
                || actor.as_deref() != Some(importing_actor.as_str())
                || occurred_at(
                    cell(&event, "occurred_at", "occurredAt").ok_or_else(malformed_evidence)?,
                )? != imported_at
            {
                return Err(malformed_evidence());
            }
            let audit = number(&event, "audit_log_id", "auditLogId")
                .filter(|id| *id > 0)
                .ok_or_else(malformed_evidence)?;
            let audits=owner.query_sql(&format!("SELECT id, organization_id, table_name, record_id, action, metadata FROM audit_log WHERE organization_id = {org} AND id = {audit}")).await.map_err(ApiError::internal)?;
            match audits.as_slice() {
                [audit] => {
                    if number(audit, "organization_id", "organizationId") != Some(org)
                        || cell(audit, "table_name", "tableName").and_then(Value::as_str)
                            != Some(table)
                        || number(audit, "record_id", "recordId") != Some(record)
                        || audit["action"] != "CREATE"
                    {
                        return Err(malformed_evidence());
                    }
                    let metadata: Value = serde_json::from_str(
                        audit
                            .get("metadata")
                            .and_then(option_text)
                            .ok_or_else(malformed_evidence)?,
                    )
                    .map_err(|_| malformed_evidence())?;
                    if number(&metadata, "import_job_id", "importJobId") == number(job, "id", "id")
                        && number(&metadata, "import_row", "importRow")
                            == number(mapping, "row_number", "rowNumber")
                    {
                        return Ok(true);
                    }
                }
                [] => {}
                _ => return Err(malformed_evidence()),
            }
        }
    }
    Ok(false)
}

async fn read_sources(
    owner: &StdbClient,
    store: &crate::document_blob_store::DocumentBlobStoreConfig,
    context: &TrustedOperationContext,
    adapter: &RecordAdapter,
    record: u64,
    query: &SourcesQuery,
) -> Result<Value, ApiError> {
    let org = context.organization_id();
    let actor = context.actor_identity();
    let company = query.company_id;
    let limit = query.limit.unwrap_or(50) as usize;
    let mut after = query.after(org, actor, adapter.table, record)?;
    let columns = read_columns(context.field_access(), adapter)?;
    require_record(owner, context, adapter, company, record).await?;
    let predicate = format!(
        "organization_id = {org} AND table_name = '{}' AND record_id = {record}",
        adapter.table
    );
    let reader = BoundedIdReader::new(owner, "import_job_record", &predicate);
    let mut data = Vec::new();
    let mut processed = 0;
    let mut probes = 0;
    'windows: for _ in 0..MAX_WINDOWS {
        let Some(witness) = reader.witness(after, None).await? else {
            break;
        };
        reader
            .seek_window_start(&mut after, witness, &mut probes)
            .await?;
        let end = after.saturating_add(ID_WINDOW);
        let mut rows = owner
            .query_sql(&reader.window_sql(MAPPING_COLUMNS, after, end))
            .await
            .map_err(ApiError::internal)?;
        if rows.len() > ID_WINDOW as usize {
            return Err(malformed_evidence());
        }
        rows.sort_by_key(|row| number(row, "id", "id"));
        for mapping in rows {
            let id = number(&mapping, "id", "id")
                .filter(|id| *id > after && *id <= end)
                .ok_or_else(malformed_evidence)?;
            after = id;
            processed += 1;
            let job_id = number(&mapping, "job_id", "jobId")
                .filter(|id| *id > 0)
                .ok_or_else(malformed_evidence)?;
            // One exact job per mapping, with a strict per-page candidate cap.
            // No global LIMIT can hide an older job for this particular record.
            let jobs = owner.query_sql(&format!("SELECT id, organization_id, table_name, status, metadata, file_name, create_uid FROM import_job WHERE organization_id = {org} AND id = {job_id}"))
                .await.map_err(ApiError::internal)?;
            match jobs.as_slice() {
                [job] => {
                    if let Some(mut projected) = project_mapping(
                        &mapping,
                        job,
                        org,
                        company,
                        adapter.table,
                        record,
                        &columns,
                    )? {
                        if !native_mapping_receipt(
                            owner,
                            &mapping,
                            job,
                            org,
                            company,
                            adapter.table,
                            record,
                        )
                        .await?
                        {
                            if processed == CANDIDATES_PER_PAGE {
                                break 'windows;
                            }
                            continue;
                        }
                        projected["sourceAdmissionId"] = Value::Null;
                        projected["sourceSha256"] = Value::Null;
                        projected["sourceRelationship"] = Value::Null;
                        if columns.contains("metadata") {
                            let metadata: Value = serde_json::from_str(
                                job.get("metadata")
                                    .and_then(option_text)
                                    .ok_or_else(malformed_evidence)?,
                            )
                            .map_err(|_| malformed_evidence())?;
                            let importing_actor = cell(job, "create_uid", "createUid")
                                .and_then(identity_cell_to_hex)
                                .and_then(|actor| parse_stdb_identity_hex(&actor))
                                .ok_or_else(malformed_evidence)?;
                            let request = metadata
                                .get("request_id")
                                .and_then(Value::as_str)
                                .ok_or_else(malformed_evidence)?;
                            let content_hash = metadata
                                .get("sha256")
                                .and_then(Value::as_str)
                                .ok_or_else(malformed_evidence)?;
                            if let Some(binding) =
                                crate::import_admissions::read_import_source_binding(
                                    store,
                                    org,
                                    company,
                                    &importing_actor,
                                    request,
                                    adapter.table,
                                    content_hash,
                                )
                                .await?
                            {
                                for field in
                                    ["sourceAdmissionId", "sourceSha256", "sourceRelationship"]
                                {
                                    projected[field] = binding[field].clone();
                                }
                            }
                            if super::super::import_reviews::full_administrator(
                                context.field_access(),
                            ) {
                                projected["review"] =
                                    super::super::import_reviews::read_review_binding(
                                        store,
                                        org,
                                        company,
                                        &importing_actor,
                                        request,
                                        adapter.table,
                                        content_hash,
                                        number(&mapping, "row_number", "rowNumber")
                                            .ok_or_else(malformed_evidence)?,
                                    )
                                    .await?
                                    .unwrap_or(Value::Null);
                            }
                        }
                        data.push(projected)
                    }
                }
                [] => {} // A removed legacy job cannot establish an origin.
                _ => return Err(malformed_evidence()),
            }
            if data.len() == limit || processed == CANDIDATES_PER_PAGE {
                break 'windows;
            }
        }
        after = end;
        if after == u64::MAX {
            break;
        }
    }
    let next = if reader.witness(after, None).await?.is_some() {
        Some(format!(
            "{}{after}",
            query.prefix(org, actor, adapter.table, record)
        ))
    } else {
        None
    };
    require_record(owner, context, adapter, company, record).await?;
    let current = load_field_access_context(owner, actor, org)
        .await
        .map_err(ApiError::Internal)?
        .ok_or_else(|| ApiError::Forbidden("Import source access revoked".into()))?;
    let current_columns = read_columns(&current, adapter)?;
    // Re-run the canonical row policy with the refreshed authority, not merely
    // the context captured before source receipt/storage reads.
    require_record_with_access(owner, context, adapter, company, record, &current).await?;
    for row in &mut data {
        if !super::super::import_reviews::full_administrator(&current) {
            row["review"] = Value::Null;
        }
        if !current_columns.contains("file_name") {
            row["fileName"] = Value::Null;
        }
        if !current_columns.contains("metadata") {
            for field in [
                "contentSha256",
                "sourceAdmissionId",
                "sourceSha256",
                "sourceRelationship",
                "review",
            ] {
                row[field] = Value::Null;
            }
        }
    }
    Ok(
        json!({"schemaVersion":1,"resource":adapter.table,"recordId":record.to_string(),"companyId":company.to_string(),
        "data":data,"nextCursor":next,"coverage":{"status":"partial","message":"Only exact tracked import rows backed by the new private native import receipt are included. Import row numbers refer to submitted CSV data. Original file hashes require a matching immutable source admission. Source-review links require a retained submission binding validated against the confirmed review decision and current review access. Older or missing receipts remain unavailable."}}),
    )
}

pub(super) async fn record_sources_get(
    State(state): State<Arc<AppState>>,
    Path((resource, record)): Path<(String, u64)>,
    Query(query): Query<SourcesQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let adapter = record_adapter(&resource)?;
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    let result = read_sources(
        &state.stdb,
        &state.config.document_blob_store,
        &context,
        &adapter,
        record,
        &query,
    )
    .await?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn old_mutable_job_correlation_and_raw_audit_metadata_cannot_establish_a_source() {
        use super::super::tests as fixture;
        let server=fixture::server(vec![json!({"id":1,"organization_id":42,"job_id":12,"table_name":"product","record_id":9,"row_number":2,"create_date":1_762_000_000_123_456_i64})],None,true,true,false).await;
        fixture::hide_native_import_receipt(&server);
        let context = fixture::context(
            &server,
            fixture::access(&["business_history:read", "product:read"], None),
        );
        let store = crate::document_blob_store::DocumentBlobStoreConfig::Local {
            root: std::env::temp_dir()
                .join(format!("legacy-source-receipt-{}", rand::random::<u64>())),
        };
        let page = read_sources(
            &server.owner,
            &store,
            &context,
            &record_adapter("product").unwrap(),
            9,
            &SourcesQuery {
                company_id: 7,
                cursor: None,
                limit: Some(50),
            },
        )
        .await
        .unwrap();
        assert_eq!(page["data"], json!([]));
        assert!(page["coverage"]["message"]
            .as_str()
            .unwrap()
            .contains("Older or missing receipts"));
    }

    #[tokio::test]
    async fn exact_review_reference_requires_the_review_owners_fresh_administrator_policy() {
        use super::super::tests as fixture;
        use sha2::{Digest, Sha256};
        let server=fixture::server(vec![json!({"id":1,"organization_id":42,"job_id":12,"table_name":"product","record_id":9,"row_number":2,"create_date":1_762_000_000_123_456_i64})],None,true,true,false).await;
        let context = fixture::context(&server, fixture::access(&["*:*"], None));
        let actor = context.actor_identity();
        let request = "b".repeat(32);
        let digest = hex::encode(Sha256::digest(format!(
            "review-import-v1:42:7:{actor}:{request}"
        )));
        let root =
            std::env::temp_dir().join(format!("history-review-policy-{}", rand::random::<u64>()));
        let store =
            crate::document_blob_store::DocumentBlobStoreConfig::Local { root: root.clone() };
        let receipt = json!({"version":1,"organizationId":"42","companyId":"7","actor":actor,"requestId":request,"entity":"product","contentSha256":"a".repeat(64),"rows":[{"importRow":2,"batchId":"3","itemId":"9","revision":2}]});
        crate::document_blob_store::put_immutable(
            &store,
            &format!("org-42/import-review-bindings/{}.meta.json", &digest[..32]),
            &serde_json::to_vec(&receipt).unwrap(),
            "application/json",
        )
        .await
        .unwrap();
        let adapter = record_adapter("product").unwrap();
        fixture::set_review_administrator(&server, true);
        let page = read_sources(
            &server.owner,
            &store,
            &context,
            &adapter,
            9,
            &SourcesQuery {
                company_id: 7,
                cursor: None,
                limit: Some(50),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            page["data"][0]["review"],
            json!({"batchId":"3","itemId":"9","revision":2})
        );
        // The captured session remains an administrator, but refreshed owner
        // policy no longer permits multidomain review references.
        fixture::set_review_administrator(&server, false);
        let page = read_sources(
            &server.owner,
            &store,
            &context,
            &adapter,
            9,
            &SourcesQuery {
                company_id: 7,
                cursor: None,
                limit: Some(50),
            },
        )
        .await
        .unwrap();
        assert!(page["data"][0]["review"].is_null());
        assert_eq!(page["data"][0]["contentSha256"], "a".repeat(64));
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn native_mapping_pages_are_company_scoped_and_currently_authorized() {
        use super::super::tests as fixture;
        let events = [(1, 12), (2048, 13), (9007199254740993_u64, 12)]
            .into_iter().map(|(id, job)| json!({"id":id,"organization_id":42,"job_id":job,"table_name":"product","record_id":9,"row_number":2,"create_date":1_762_000_000_123_456_i64})).collect();
        let server = fixture::server(events, None, true, true, false).await;
        let context = fixture::context(
            &server,
            fixture::access(&["business_history:read", "product:read"], None),
        );
        let root =
            std::env::temp_dir().join(format!("history-source-page-{}", rand::random::<u64>()));
        let store = crate::document_blob_store::DocumentBlobStoreConfig::Local { root };
        let adapter = record_adapter("product").unwrap();
        let mut cursor = None;
        let mut ids = Vec::new();
        for _ in 0..16 {
            let page = read_sources(
                &server.owner,
                &store,
                &context,
                &adapter,
                9,
                &SourcesQuery {
                    company_id: 7,
                    cursor,
                    limit: Some(1),
                },
            )
            .await
            .unwrap();
            for source in page["data"].as_array().unwrap() {
                ids.push(source["id"].as_str().unwrap().to_owned());
                assert_eq!(source["rowNumber"], 2);
                assert_eq!(source["contentSha256"], "a".repeat(64));
                assert!(source["review"].is_null());
                assert!(source["sourceAdmissionId"].is_null());
            }
            cursor = page["nextCursor"].as_str().map(str::to_owned);
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(ids, vec!["1", "9007199254740993"]);
        assert!(cursor.is_none());
    }

    #[tokio::test]
    async fn sources_fail_closed_when_source_or_history_grant_is_revoked_during_read() {
        use super::super::tests as fixture;
        let server=fixture::server(vec![json!({"id":1,"organization_id":42,"job_id":12,"table_name":"product","record_id":9,"row_number":2,"create_date":1_762_000_000_123_456_i64})],None,true,true,true).await;
        let context = fixture::context(
            &server,
            fixture::access(&["business_history:read", "product:read"], None),
        );
        let store = crate::document_blob_store::DocumentBlobStoreConfig::Local {
            root: std::env::temp_dir()
                .join(format!("history-source-revoke-{}", rand::random::<u64>())),
        };
        let result = read_sources(
            &server.owner,
            &store,
            &context,
            &record_adapter("product").unwrap(),
            9,
            &SourcesQuery {
                company_id: 7,
                cursor: None,
                limit: Some(50),
            },
        )
        .await;
        assert!(matches!(result, Err(ApiError::Forbidden(_))));
    }

    #[tokio::test]
    async fn source_route_keeps_auth_and_bad_queries_private_and_uncached() {
        use crate::session::test_support::test_config;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        use tower_cookies::CookieManagerLayer;
        let app = super::super::router()
            .with_state(Arc::new(AppState::new(test_config(Some("owner-token")))))
            .layer(CookieManagerLayer::new());
        for (uri, status) in [
            (
                "/history/records/product/9/sources?companyId=7",
                StatusCode::UNAUTHORIZED,
            ),
            (
                "/history/records/product/9/sources?companyId=invalid",
                StatusCode::BAD_REQUEST,
            ),
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), status);
            assert_eq!(
                response.headers().get(CACHE_CONTROL).unwrap(),
                "private, no-store"
            );
        }
    }

    #[test]
    fn source_history_requires_history_and_source_read_authority() {
        let adapter = record_adapter("product").unwrap();
        for grants in [vec!["business_history:read"], vec!["product:read"], vec![]] {
            let access = FieldAccessContext {
                role_permissions: grants.into_iter().map(String::from).collect(),
                ..FieldAccessContext::default()
            };
            assert!(read_columns(&access, &adapter).is_err());
        }
        let access = FieldAccessContext {
            role_permissions: vec!["business_history:read".into(), "product:read".into()],
            ..FieldAccessContext::default()
        };
        assert!(read_columns(&access, &adapter).is_ok());
    }

    fn mapping() -> Value {
        json!({"id":"9007199254740993","organization_id":42,"job_id":12,"table_name":"product","record_id":9,"row_number":7,"create_date":1762000000123456_i64})
    }
    fn job() -> Value {
        json!({"id":12,"organization_id":42,"table_name":"product","status":"success","file_name":{"some":"prepared.csv"},"metadata":json!({"correlation_version":1,"company_id":7,"request_id":"a".repeat(32),"sha256":"b".repeat(64)}).to_string()})
    }
    fn columns() -> HashSet<String> {
        ["status", "table_name", "file_name", "metadata"]
            .into_iter()
            .map(String::from)
            .collect()
    }
    #[test]
    fn exact_import_mapping_retains_full_width_ids_and_submitted_row_identity() {
        let value = project_mapping(&mapping(), &job(), 42, 7, "product", 9, &columns())
            .unwrap()
            .unwrap();
        assert_eq!(value["id"], "9007199254740993");
        assert_eq!(value["rowNumber"], 7);
        assert_eq!(value["fileName"], "prepared.csv");
        assert_eq!(value["contentSha256"], "b".repeat(64));
        assert!(value["review"].is_null());
        assert!(value.get("sourceSha256").is_none());
    }
    #[test]
    fn source_identity_must_match_record_job_table_and_organization() {
        for field in ["organization_id", "record_id", "job_id"] {
            let mut value = mapping();
            value[field] = json!(999);
            assert!(project_mapping(&value, &job(), 42, 7, "product", 9, &columns()).is_err());
        }
        let mut value = job();
        value["table_name"] = json!("contact");
        assert!(project_mapping(&mapping(), &value, 42, 7, "product", 9, &columns()).is_err());
    }
    #[test]
    fn missing_or_other_company_tracking_does_not_infer_a_source() {
        for metadata in [
            Value::Null,
            json!({"company_id":8,"correlation_version":1,"request_id":"a".repeat(32),"sha256":"b".repeat(64)}),
            json!({"company_id":7,"source_file":"caller-claim.csv"}),
        ] {
            let mut value = job();
            value["metadata"] = if metadata.is_null() {
                Value::Null
            } else {
                json!(metadata.to_string())
            };
            assert!(
                project_mapping(&mapping(), &value, 42, 7, "product", 9, &columns())
                    .unwrap()
                    .is_none()
            );
        }
    }
    #[test]
    fn filenames_and_content_hashes_obey_current_job_field_policy() {
        let value = project_mapping(&mapping(), &job(), 42, 7, "product", 9, &HashSet::new())
            .unwrap()
            .unwrap();
        assert!(value["fileName"].is_null());
        assert!(value["contentSha256"].is_null());
    }
    #[test]
    fn source_cursor_is_bound_to_actor_company_record_and_table() {
        let mut query = SourcesQuery {
            company_id: 7,
            cursor: None,
            limit: Some(10),
        };
        query.cursor = Some(format!("{}22", query.prefix(42, "actor", "product", 9)));
        assert_eq!(query.after(42, "actor", "product", 9).unwrap(), 22);
        for (org, actor, table, record) in [
            (43, "actor", "product", 9),
            (42, "other", "product", 9),
            (42, "actor", "contact", 9),
            (42, "actor", "product", 10),
        ] {
            assert!(query.after(org, actor, table, record).is_err());
        }
        query.company_id = 8;
        assert!(query.after(42, "actor", "product", 9).is_err());
    }
}
