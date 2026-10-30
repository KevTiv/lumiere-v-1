//! A complete, read-only preview of the existing organization-wide purge owner.
//! Document names retain the live owner-only ACL; hidden candidates block the UI.

use std::{collections::BTreeSet, sync::Arc};

use axum::{
    extract::{Query, State},
    http::{header, HeaderMap},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use stdb_auth::{
    has_resource_field_read_permission, has_resource_read_permission, identity_sql_literal,
    permission_allowed, FieldAccessContext,
};
use stdb_client::StdbClient;
use tower_cookies::Cookies;

use crate::{
    error::ApiError, state::AppState, trusted_context::TrustedOperationContext,
    web_session::resolve_session,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PreviewQuery {
    #[serde(default)]
    delay_seconds: u64,
}

fn require_preview_access(access: &FieldAccessContext, delay: u64) -> Result<(), ApiError> {
    let action = if delay == 0 { "delete" } else { "admin" };
    if !has_resource_read_permission(Some(access), "documents")
        || !permission_allowed(access, "document", action)
    {
        return Err(ApiError::Forbidden(
            "Document retention preview permission denied".into(),
        ));
    }
    Ok(())
}

fn field<'a>(row: &'a Value, camel: &str, snake: &str) -> Result<&'a Value, ApiError> {
    let a = row.get(camel);
    let b = row.get(snake);
    if a.zip(b).is_some_and(|(a, b)| a != b) {
        return Err(ApiError::Internal(
            "Conflicting retention preview fields".into(),
        ));
    }
    a.or(b)
        .ok_or_else(|| ApiError::Internal("Incomplete retention preview source".into()))
}

fn exact_id(value: &Value) -> Result<u64, ApiError> {
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiError::Internal("Invalid retention preview record identity".into()))
}

fn optional(value: &Value) -> &Value {
    value.get("some").unwrap_or(value)
}

fn expiry(value: &Value) -> Result<Option<i64>, ApiError> {
    if value.is_null() || value.get("none").is_some() {
        return Ok(None);
    }
    let value = optional(value);
    let micros = value
        .get("microsSinceUnixEpoch")
        .or_else(|| value.get("__timestamp_micros_since_unix_epoch__"))
        .unwrap_or(value);
    micros
        .as_i64()
        .or_else(|| micros.as_str()?.parse().ok())
        .map(Some)
        .ok_or_else(|| ApiError::Internal("Invalid retention expiry timestamp".into()))
}

fn preview_rows(
    documents: &[Value],
    holds: &[Value],
    organization: u64,
    access: &FieldAccessContext,
    evaluated_at: i64,
    delay: u64,
) -> Result<Value, ApiError> {
    if organization == 0 || access.organization_id != organization {
        return Err(ApiError::Forbidden(
            "Retention preview organization context changed".into(),
        ));
    }
    require_preview_access(access, delay)?;
    let cutoff = evaluated_at
        .checked_add(
            i64::try_from(delay)
                .ok()
                .and_then(|delay| delay.checked_mul(1_000_000))
                .ok_or_else(|| ApiError::BadRequest("Retention delay is too large".into()))?,
        )
        .ok_or_else(|| ApiError::BadRequest("Retention delay is too large".into()))?;
    let actor = identity_sql_literal(&access.identity_hex).map_err(ApiError::Internal)?;
    let mut held = BTreeSet::new();
    for row in holds {
        if exact_id(field(row, "organizationId", "organization_id")?)? != organization {
            return Err(ApiError::Internal("Foreign retention hold source".into()));
        }
        match field(row, "isActive", "is_active")?.as_bool() {
            Some(true) => {
                held.insert(exact_id(field(row, "documentId", "document_id")?)?);
            }
            Some(false) => (),
            None => return Err(ApiError::Internal("Invalid legal hold state".into())),
        }
    }
    let readable_fields = ["id", "name", "company_id", "purge_after"]
        .iter()
        .all(|name| has_resource_field_read_permission(Some(access), "documents", name));
    let mut rows = Vec::new();
    let mut snapshot = Vec::new();
    let mut hidden = 0u64;
    let mut held_count = 0u64;
    let mut ids = BTreeSet::new();
    for row in documents {
        let id = exact_id(field(row, "id", "id")?)?;
        if !ids.insert(id)
            || exact_id(field(row, "organizationId", "organization_id")?)? != organization
            || field(row, "isDeleted", "is_deleted")? != &Value::Bool(true)
        {
            return Err(ApiError::Internal(
                "Invalid retention candidate scope".into(),
            ));
        }
        let Some(purge_after) = expiry(field(row, "purgeAfter", "purge_after")?)? else {
            continue;
        };
        if purge_after > cutoff {
            continue;
        }
        let is_held = held.contains(&id);
        let owner = field(row, "ownerId", "owner_id")?
            .as_str()
            .ok_or_else(|| ApiError::Internal("Invalid document owner".into()))?;
        let company = field(row, "companyId", "company_id")?;
        let company = if company.is_null() || company.get("none").is_some() {
            None
        } else {
            Some(exact_id(optional(company))?.to_string())
        };
        let name = field(row, "name", "name")?
            .as_str()
            .ok_or_else(|| ApiError::Internal("Invalid document name".into()))?;
        snapshot.push((
            id,
            owner.to_owned(),
            name.to_owned(),
            company.clone(),
            purge_after,
            is_held,
        ));
        if is_held {
            held_count += 1;
            continue;
        }
        if !readable_fields || identity_sql_literal(owner).map_err(ApiError::Internal)? != actor {
            hidden += 1;
            continue;
        }
        rows.push(json!({"id":id.to_string(), "name":name, "companyId":company, "purgeAfterMicros":purge_after.to_string()}));
    }
    snapshot.sort();
    rows.sort_by_key(|row| row["id"].as_str().unwrap_or_default().to_owned());
    let fingerprint = hex::encode(Sha256::digest(
        serde_json::to_vec(&(organization, delay, snapshot)).map_err(ApiError::internal)?,
    ));
    Ok(
        json!({"organizationId":organization.to_string(), "scope":"organization", "delaySeconds":delay,
        "evaluatedAtMicros":evaluated_at.to_string(), "cutoffMicros":cutoff.to_string(), "fingerprint":fingerprint,
        "documents":rows, "unreviewableCount":hidden, "heldCount":held_count, "complete":true, "canProceed":hidden == 0}),
    )
}

async fn read_preview(
    client: &StdbClient,
    org: u64,
    access: &FieldAccessContext,
    delay: u64,
    now: i64,
) -> Result<Value, ApiError> {
    require_preview_access(access, delay)?;
    if org == 0 || access.organization_id != org {
        return Err(ApiError::Forbidden(
            "Retention preview organization context changed".into(),
        ));
    }
    // No owner predicate or pagination: this must cover the existing purge owner's
    // entire destructive scope. Names are redacted by preview_rows before return.
    let documents = client.query_sql(&format!("SELECT id, organization_id, company_id, owner_id, name, is_deleted, purge_after FROM document WHERE organization_id = {org} AND is_deleted = true")).await.map_err(ApiError::internal)?;
    let holds = client.query_sql(&format!("SELECT organization_id, document_id, is_active FROM document_legal_hold WHERE organization_id = {org}")).await.map_err(ApiError::internal)?;
    preview_rows(&documents, &holds, org, access, now, delay)
}

pub(super) async fn preview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(query): Query<PreviewQuery>,
) -> Result<(HeaderMap, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let org = context.organization_id();
    let now = chrono::Utc::now().timestamp_micros();
    let preview = read_preview(
        context.client(),
        org,
        context.field_access(),
        query.delay_seconds,
        now,
    )
    .await?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, no-store"),
    );
    Ok((headers, Json(json!({"data":preview}))))
}

#[cfg(test)]
mod tests {
    use super::*;
    const ACTOR: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    fn access() -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 7,
            role_id: 1,
            role_name: "Reviewer".into(),
            is_superuser: false,
            role_permissions: vec!["document:*".into()],
            identity_hex: ACTOR.into(),
            field_permissions: vec![],
            role_ids: vec![],
            org_permissions: vec![],
        }
    }
    fn document(id: u64, owner: &str, expiry: i64) -> Value {
        json!({"id":id,"organization_id":7,"company_id":12,"owner_id":owner,"name":"Saved file","is_deleted":true,"purge_after":{"microsSinceUnixEpoch":expiry}})
    }
    #[test]
    fn complete_preview_excludes_legal_holds_and_includes_delayed_expiry() {
        let docs = vec![
            document(1, ACTOR, 100),
            document(2, ACTOR, 1_000_100),
            document(3, ACTOR, 100),
        ];
        let holds = vec![json!({"organization_id":7,"document_id":3,"is_active":true})];
        let immediate = preview_rows(&docs, &holds, 7, &access(), 100, 0).expect("preview");
        assert_eq!(immediate["documents"].as_array().expect("rows").len(), 1);
        let delayed = preview_rows(&docs, &holds, 7, &access(), 100, 1).expect("preview");
        assert_eq!(delayed["documents"].as_array().expect("rows").len(), 2);
        assert_eq!(delayed["heldCount"], 1);
        assert_eq!(delayed["canProceed"], true);
    }
    #[test]
    fn hidden_candidates_are_redacted_and_block_the_whole_org_action() {
        let hidden = document(
            2,
            "123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0",
            100,
        );
        let result = preview_rows(
            &[document(1, ACTOR, 100), hidden],
            &[],
            7,
            &access(),
            100,
            0,
        )
        .expect("preview");
        assert_eq!(result["unreviewableCount"], 1);
        assert_eq!(result["canProceed"], false);
        assert_eq!(result["documents"].as_array().expect("rows").len(), 1);
    }
    #[test]
    fn malformed_foreign_or_unauthorized_sources_fail_closed() {
        let mut no_delete = access();
        no_delete.role_permissions = vec!["document:read".into()];
        assert!(preview_rows(&[], &[], 7, &no_delete, 100, 0).is_err());
        let mut foreign = document(1, ACTOR, 100);
        foreign["organization_id"] = json!(8);
        assert!(preview_rows(&[foreign], &[], 7, &access(), 100, 0).is_err());
        let mut malformed = document(1, ACTOR, 100);
        malformed["purge_after"] = json!("bad");
        assert!(preview_rows(&[malformed], &[], 7, &access(), 100, 0).is_err());
        assert!(preview_rows(&[], &[], 7, &access(), 100, u64::MAX).is_err());
    }
    #[test]
    fn fingerprint_changes_with_affected_scope_and_not_read_time() {
        let a =
            preview_rows(&[document(1, ACTOR, 100)], &[], 7, &access(), 100, 0).expect("preview");
        let b =
            preview_rows(&[document(1, ACTOR, 100)], &[], 7, &access(), 200, 0).expect("preview");
        let c =
            preview_rows(&[document(2, ACTOR, 100)], &[], 7, &access(), 100, 0).expect("preview");
        assert_eq!(a["fingerprint"], b["fingerprint"]);
        assert_ne!(a["fingerprint"], c["fingerprint"]);
    }

    #[tokio::test]
    async fn real_preview_read_is_unpaginated_and_failed_or_denied_sources_never_become_empty_success(
    ) {
        use axum::{routing::post, Router};
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        };
        let queries = Arc::new(Mutex::new(Vec::new()));
        let recorded = queries.clone();
        let fail = Arc::new(AtomicBool::new(false));
        let fail_request = fail.clone();
        let app = Router::new().route(
            "/v1/database/retention/sql",
            post(move |sql: String| {
                let recorded = recorded.clone();
                let fail_request = fail_request.clone();
                async move {
                    recorded.lock().expect("queries").push(sql);
                    let status = if fail_request.load(Ordering::SeqCst) {
                        axum::http::StatusCode::SERVICE_UNAVAILABLE
                    } else {
                        axum::http::StatusCode::OK
                    };
                    (status, Json(json!([{"schema":{"elements":[]},"rows":[]}])))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move { axum::serve(listener, app).await.expect("serve") });
        let client = StdbClient::new(
            format!("http://{address}"),
            "retention".into(),
            "fixture".into(),
        );
        let result = read_preview(&client, 7, &access(), 0, 100)
            .await
            .expect("complete read");
        assert_eq!(result["complete"], true);
        {
            let queries = queries.lock().expect("queries");
            assert_eq!(queries.len(), 2);
            assert!(queries[0].ends_with("WHERE organization_id = 7 AND is_deleted = true"));
            assert!(queries.iter().all(|sql| !sql.contains("LIMIT")
                && !sql.contains("owner_id =")
                && !sql.contains("SELECT *")));
        }
        let mut denied = access();
        denied.role_permissions = vec!["document:read".into()];
        assert!(read_preview(&client, 7, &denied, 0, 100).await.is_err());
        assert_eq!(queries.lock().expect("queries").len(), 2);
        fail.store(true, Ordering::SeqCst);
        assert!(read_preview(&client, 7, &access(), 0, 100).await.is_err());
        server.abort();
    }
}
