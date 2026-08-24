//! `/v1/mail/*` — dispatch queued outbound emails via Resend.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, routing::post, Json, Router};
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::auth_password::send_resend_email;
use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/mail/dispatch-queued", post(dispatch_queued_mail))
}

fn parse_delivery_meta(raw: Option<&str>) -> Option<Value> {
    raw.and_then(|s| serde_json::from_str(s).ok())
}

fn row_id(row: &Value) -> Option<u64> {
    row.get("id")
        .and_then(|v| v.as_u64())
        .or_else(|| row.get("id").and_then(|v| v.as_str())?.parse().ok())
}

async fn dispatch_queued_mail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;

    let resend_key = std::env::var("RESEND_API_KEY").unwrap_or_default();
    let from = std::env::var("RESEND_FROM_EMAIL")
        .unwrap_or_else(|_| "Lumiere ERP <onboarding@resend.dev>".to_string());

    if resend_key.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "RESEND_API_KEY is not configured on api-server".into(),
        ));
    }

    let client = state.client_with_token(&session.stdb_token);
    let rows = execute_resource_query(
        &client,
        "queued-mail-messages",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let mut sent = 0_u64;
    let mut skipped = 0_u64;
    let mut errors: Vec<String> = Vec::new();

    for row in rows {
        let message_id = match row_id(&row) {
            Some(id) => id,
            None => {
                skipped += 1;
                continue;
            }
        };

        let meta = parse_delivery_meta(
            row.get("metadata")
                .or_else(|| row.get("metadata"))
                .and_then(|v| v.as_str()),
        );
        let Some(meta) = meta else {
            skipped += 1;
            continue;
        };

        if meta.get("delivery").and_then(|v| v.as_str()) != Some("queued") {
            skipped += 1;
            continue;
        }

        let to = meta
            .get("to")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.contains('@'));
        let Some(to) = to else {
            skipped += 1;
            continue;
        };

        let subject = meta
            .get("subject")
            .and_then(|v| v.as_str())
            .unwrap_or("Lumiere ERP notification");
        let text = row
            .get("body")
            .or_else(|| row.get("body"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        match send_resend_email(&state.http, &resend_key, &from, to, subject, text).await {
            Ok(()) => {
                let mark_args = json!([org_id, message_id, null]);
                if let Err(e) = client
                    .call_reducer(stdb_client::reducer_call!(
                        "mark_mail_message_delivered",
                        mark_args
                    ))
                    .await
                {
                    errors.push(format!("message {message_id} sent but mark failed: {e}"));
                } else {
                    sent += 1;
                }
            }
            Err(e) => errors.push(format!("message {message_id}: {e}")),
        }
    }

    Ok(Json(json!({
        "sent": sent,
        "skipped": skipped,
        "errors": errors,
    })))
}
