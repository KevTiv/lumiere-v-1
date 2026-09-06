//! Browser WebSocket (Lumiere JSON) + SpacetimeDB Rust SDK subscription bridge.

mod wire {
    include!(concat!(env!("OUT_DIR"), "/realtime_wire.rs"));
}

mod bridge;
mod socket;
mod subscription;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::sync::Arc;
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::web_session::stdb_identity_hex_hint;

#[cfg(test)]
use self::subscription::{authorized_resources, subscription_select_all, validate_resources};
#[cfg(test)]
use stdb_auth::{
    create_client_subscriptions, full_client_subscription_resources_vec, SubscriptionQueryContext,
};

pub(crate) fn notify_row_change(
    tx: &tokio::sync::mpsc::UnboundedSender<String>,
    op: &str,
    table: &str,
    resources: &[String],
) {
    let msg = json!({
        "type": "change",
        "op": op,
        "table": table,
        "resources": resources,
    })
    .to_string();
    let _ = tx.send(msg);
}

pub async fn realtime_ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<impl IntoResponse, ApiError> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());

    let session = resolve_api_session(&state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;

    let org_id = session
        .organization_id
        .ok_or_else(|| ApiError::Forbidden("No organization assigned".into()))?;

    Ok(ws.on_upgrade(move |socket| socket::handle_realtime_socket(socket, state, session, org_id)))
}

/// POST body subscribe (for clients that cannot send WS text first); returns upgrade URL hint — optional helper.
pub async fn realtime_info() -> Json<serde_json::Value> {
    Json(json!({
        "path": "/v1/realtime/ws",
        "protocol": "First message: JSON {\"resources\":[\"leads\",...],\"organizationId\":N,\"companyIds\":[]}"
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_change_is_an_invalidation_without_row_payload() {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let resources = vec!["contacts".to_string()];

        notify_row_change(&tx, "update", "contact", &resources);

        let message = rx.try_recv().expect("row change should notify the client");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&message).expect("valid JSON"),
            json!({
                "type": "change",
                "op": "update",
                "table": "contact",
                "resources": ["contacts"],
            })
        );
    }

    #[test]
    fn owner_subscription_uses_full_rows_and_retains_scope() {
        let sql = "SELECT id, organization_id, company_id FROM contact WHERE organization_id = 7 AND company_id = 11 ORDER BY id DESC";
        assert_eq!(
            subscription_select_all(sql).expect("valid subscription SQL"),
            "SELECT * FROM contact WHERE organization_id = 7 AND company_id = 11"
        );
    }

    #[test]
    fn full_invalidation_set_uses_supported_subscription_shape() {
        let company_ids = [11];
        let context = SubscriptionQueryContext {
            organization_id: Some(7),
            company_ids: Some(&company_ids),
            identity_hex: Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
            ..SubscriptionQueryContext::default()
        };
        let resources = stdb_auth::full_client_subscription_resources_vec();
        let raw = create_client_subscriptions(&resources, &context)
            .expect("full invalidation subscriptions should resolve");

        assert!(!raw.is_empty());
        for query in raw {
            let query = subscription_select_all(&query).expect("subscription SQL should rewrite");
            assert!(query.starts_with("SELECT * FROM "), "{query}");
            assert!(!query.contains(" ORDER BY "), "{query}");
            assert!(!query.contains("state = '"), "{query}");
            assert!(!query.contains("status = '"), "{query}");
        }
    }

    #[test]
    fn full_client_resources_are_valid_realtime_keys() {
        let resources = full_client_subscription_resources_vec();
        validate_resources(&resources).expect("generated full-client resources must be accepted");
        assert!(resources
            .iter()
            .any(|resource| resource == "form-configuration"));
        assert!(resources
            .iter()
            .any(|resource| resource == "pricelist-items"));
    }

    #[test]
    fn generated_cold_resource_is_a_valid_realtime_key() {
        validate_resources(&["pos-orders".to_string()])
            .expect("generated invalidation resource must be accepted");
    }

    #[test]
    fn realtime_authorization_keeps_bootstrap_and_drops_ungranted_domain_resources() {
        let requested = vec!["auth".to_string(), "contacts".to_string()];
        assert_eq!(
            authorized_resources(&requested, None).expect("known resources should validate"),
            vec!["auth".to_string()]
        );
    }
}
