//! Superuser admin routes — tenant suspend and export.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::session::{normalize_identity_hex_for_sql, resolve_api_session};
use crate::state::AppState;
use crate::web_session::stdb_identity_hex_hint;

async fn require_superuser(
    state: &AppState,
    headers: &HeaderMap,
    cookies: &Cookies,
) -> Result<crate::session::ApiSession, ApiError> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(headers, cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());
    let session = resolve_api_session(state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;

    let id = normalize_identity_hex_for_sql(&session.identity_hex);
    let sql = format!("SELECT is_superuser FROM user_profile WHERE identity = 0x{id}");
    let client = state.client_with_token(&session.stdb_token);
    let rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    let is_superuser = rows
        .first()
        .and_then(|r| r.get("isSuperuser").or_else(|| r.get("is_superuser")))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !is_superuser {
        return Err(ApiError::Forbidden("Superuser required".into()));
    }
    Ok(session)
}

async fn suspend_organization(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(org_id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let session = require_superuser(&state, &headers, &cookies).await?;
    let client = state.client_with_token(&session.stdb_token);

    let billing_sql = format!("SELECT id FROM billing_account WHERE organization_id = {org_id}");
    let rows = client
        .query_sql(&billing_sql)
        .await
        .map_err(ApiError::internal)?;
    let billing_id = rows
        .first()
        .and_then(|row| row.get("id").and_then(|v| v.as_u64()))
        .ok_or_else(|| ApiError::NotFound("Billing account not found".into()))?;

    client
        .call_reducer(stdb_client::reducer_call!(
            "set_billing_status",
            json!([org_id, billing_id, "suspended"]),
        ))
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(
        json!({ "ok": true, "organizationId": org_id, "status": "suspended" }),
    ))
}

async fn export_organization(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(org_id): Path<u64>,
) -> Result<impl IntoResponse, ApiError> {
    let session = require_superuser(&state, &headers, &cookies).await?;
    let client = state.client_with_token(&session.stdb_token);

    // Best-effort pilot DR subset — not full module export (see docs/PILOT_RUNBOOK.md §3.4).
    const EXPORT_TABLES: &[&str] = &[
        "company",
        "user_organization",
        "contact",
        "lead",
        "sale_order",
        "purchase_order",
        "account_account",
        "account_journal",
        "account_move",
        "account_payment",
        "product",
        "stock_picking",
        "stock_move",
    ];
    let mut bundle = json!({
        "organizationId": org_id,
        "exportedAt": chrono_now_rfc3339(),
        "exportTables": EXPORT_TABLES,
        "notes": "Partial tenant export; many tables (audit, settings, HR, etc.) are omitted. No restore API.",
        "tables": {},
    });
    for table in EXPORT_TABLES {
        let sql = format!("SELECT * FROM {table} WHERE organization_id = {org_id}");
        if let Ok(rows) = client.query_sql(&sql).await {
            bundle["tables"][table] = json!(rows);
        }
    }

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "application/json"),
            (
                axum::http::header::CONTENT_DISPOSITION,
                "attachment; filename=\"org-export.json\"",
            ),
        ],
        bundle.to_string(),
    ))
}

fn chrono_now_rfc3339() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/admin/organizations/:org_id/suspend",
            post(suspend_organization),
        )
        .route(
            "/admin/organizations/:org_id/export",
            post(export_organization),
        )
}
