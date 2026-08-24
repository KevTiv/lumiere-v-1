//! Billing account read/update for tenant admins.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, routing::get, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::web_session::stdb_identity_hex_hint;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PatchBillingBody {
    plan_tier: Option<String>,
    seat_count: Option<u32>,
    status: Option<String>,
}

async fn require_org_session(
    state: &AppState,
    headers: &HeaderMap,
    cookies: &Cookies,
) -> Result<(crate::session::ApiSession, u64), ApiError> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(headers, cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());
    let session = resolve_api_session(state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = session
        .organization_id
        .ok_or_else(|| ApiError::Forbidden("No organization assigned".into()))?;
    Ok((session, org_id))
}

async fn get_billing_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Json<Value>, ApiError> {
    let (session, org_id) = require_org_session(&state, &headers, &cookies).await?;
    let client = state.client_with_token(&session.stdb_token);
    let sql = format!(
        "SELECT id, organization_id, plan_tier, seat_count, status, trial_ends_at, metadata FROM billing_account WHERE organization_id = {org_id}"
    );
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!({ "data": rows })))
}

async fn patch_billing_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<PatchBillingBody>,
) -> Result<Json<Value>, ApiError> {
    let (session, org_id) = require_org_session(&state, &headers, &cookies).await?;
    let client = state.client_with_token(&session.stdb_token);
    let sql = format!("SELECT id FROM billing_account WHERE organization_id = {org_id}");
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let Some(row) = rows.first() else {
        return Err(ApiError::NotFound("Billing account not found".into()));
    };
    let billing_id = row
        .get("id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| ApiError::Internal("Invalid billing account row".into()))?;

    let params = json!({
        "planTier": body.plan_tier,
        "seatCount": body.seat_count,
        "status": body.status,
        "trialEndsAt": null,
        "metadata": null,
    });
    client
        .call_reducer(stdb_client::reducer_call!(
            "update_billing_account",
            json!([org_id, billing_id, params]),
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!({ "ok": true })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route(
        "/billing/account",
        get(get_billing_account).patch(patch_billing_account),
    )
}
