//! Metadata-only exception queue. No raw provider payloads are returned.
use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::Cookies;

use super::{company, pool, source, Scope};
use crate::{
    error::ApiError,
    routes::whatsapp_meta::{protocol::{optional_id, row_u64, Incoming}, require_enabled},
    state::AppState,
    trusted_context::TrustedOperationContext,
};

async fn authority(
    state: &AppState, headers: &HeaderMap, cookies: &Cookies, company: u64, account: u64,
) -> Result<TrustedOperationContext, ApiError> {
    require_enabled()?;
    let context = source::context(state, headers, cookies, company, false).await?;
    if !stdb_auth::permission_allowed(context.field_access(), "integrations", "write")
        || !stdb_auth::permission_allowed(context.field_access(), "operational_message", "write")
    {
        return Err(ApiError::Forbidden("WhatsApp exception management requires integration and message administration".into()));
    }
    let org = context.organization_id();
    let rows = state.stdb.query_sql(&format!(
        "SELECT id,organization_id,company_id FROM whatsapp_business_account \
         WHERE organization_id = {org} AND id = {account} LIMIT 2"
    )).await.map_err(ApiError::unavailable)?;
    let [row] = rows.as_slice() else {
        return Err(ApiError::NotFound("sender is unavailable".into()));
    };
    if row_u64(row, "organization_id") != Some(org)
        || optional_id(row, "company_id")? != Some(company)
    {
        // Unknown senders on shared accounts have no proven company ownership.
        return Err(ApiError::Forbidden("exception review requires a company-owned sender".into()));
    }
    Ok(context)
}

async fn list(
    State(state): State<Arc<AppState>>, headers: HeaderMap, cookies: Cookies,
    Path(account): Path<u64>, Query(scope): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    let context = authority(&state, &headers, &cookies, scope.company_id, account).await?;
    let client = pool()?.get().await
        .map_err(|_| ApiError::Unavailable("exception storage is unavailable".into()))?;
    let rows = client.query(
        "SELECT id,state,reason_code,event_json,attempts FROM lumiere_whatsapp.inbox \
         WHERE organization_id=$1 AND company_id=$2 AND account_id=$3 \
         AND state IN ('quarantined','retry') ORDER BY id DESC LIMIT 50",
        &[&context.organization_id().to_string(), &scope.company_id.to_string(), &account.to_string()],
    ).await.map_err(|_| ApiError::Unavailable("exception queue could not be read".into()))?;
    let data: Vec<_> = rows.into_iter().map(|row| {
        let event = serde_json::from_str::<Incoming>(&row.get::<_, String>(3)).ok();
        let sender = event.as_ref().and_then(|e| e.payload.get("from")).and_then(Value::as_str);
        let masked = sender.map(|sender| format!("***{}", sender.chars().rev().take(4)
            .collect::<String>().chars().rev().collect::<String>()));
        let kind = event.as_ref().map(|e| e.kind.as_str()).unwrap_or("invalid");
        let reason: Option<String> = row.get(2);
        json!({
            "id":row.get::<_, i64>(0).to_string(), "state":row.get::<_, String>(1),
            "reason":reason, "kind":kind, "sender":masked, "attempts":row.get::<_, i32>(4),
            "canRetry":row.get::<_, String>(1)=="quarantined" && reason.as_deref()!=Some("conflicting_provider_event"),
        })
    }).collect();
    Ok(Json(json!({"data":data,"limit":50})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RetryRequest {
    company_id: String,
    reason: String,
}

async fn retry(
    State(state): State<Arc<AppState>>, headers: HeaderMap, cookies: Cookies,
    Path((account, event)): Path<(u64, i64)>, Json(request): Json<RetryRequest>,
) -> Result<Json<Value>, ApiError> {
    let company = company(&request.company_id)?;
    let context = authority(&state, &headers, &cookies, company, account).await?;
    if event <= 0 || request.reason.trim().is_empty() || request.reason.len() > 256 {
        return Err(ApiError::BadRequest("a short review reason is required".into()));
    }
    let mut client = pool()?.get().await
        .map_err(|_| ApiError::Unavailable("exception storage is unavailable".into()))?;
    let tx = client.transaction().await
        .map_err(|_| ApiError::Unavailable("exception storage is unavailable".into()))?;
    let changed = tx.execute(
        "UPDATE lumiere_whatsapp.inbox SET state='pending',next_attempt_at=now(),updated_at=now() \
         WHERE id=$1 AND organization_id=$2 AND company_id=$3 AND account_id=$4 \
         AND state='quarantined' AND reason_code IS DISTINCT FROM 'conflicting_provider_event'",
        &[&event, &context.organization_id().to_string(), &company.to_string(), &account.to_string()],
    ).await.map_err(|_| ApiError::Unavailable("exception retry could not be recorded".into()))?;
    if changed != 1 {
        return Err(ApiError::Conflict("exception is no longer eligible for retry".into()));
    }
    let audit = json!({"actor":context.actor_identity(),"reason":request.reason.trim()}).to_string();
    tx.execute(
        "INSERT INTO lumiere_whatsapp.inbox_attempt (inbox_id,lease_token,outcome,reason_code) \
         VALUES ($1,$2,'pending',$3)",
        &[&event, &format!("operator:{}", context.actor_identity()), &audit],
    ).await.map_err(|_| ApiError::Unavailable("exception audit could not be recorded".into()))?;
    tx.commit().await.map_err(|_| ApiError::Unavailable("exception retry is unconfirmed; refresh the queue".into()))?;
    Ok(Json(json!({"state":"pending"})))
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/whatsapp/accounts/:account/triage", get(list))
        .route("/whatsapp/accounts/:account/triage/:event/retry", post(retry))
}
