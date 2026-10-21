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
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::stdb_identity_hex_hint;

#[cfg(test)]
use self::subscription::{
    authorized_resources, subscription_select_all, validate_requested_company_scope,
    validate_resources,
};
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
    if state.config.workos_client_id.is_some() {
        require_browser_origin(&headers, &state.config.app_url)?;
    }
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());

    let session = resolve_api_session(&state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;

    let client = state.client_with_token(&session.stdb_token);
    let context = TrustedOperationContext::from_session_with_placement(
        &session,
        client,
        "erp.subscribe_resources",
        &state.organization_placements,
    )?;

    let maximum_deadline = if state.config.workos_client_id.is_some() {
        let token = auth
            .and_then(|value| value.strip_prefix("Bearer "))
            .or(cookie_tok.as_deref())
            .ok_or(ApiError::Unauthorized)?;
        Some(tokio::time::Instant::now() + verified_socket_lifetime(token)?)
    } else {
        None
    };
    Ok(ws.on_upgrade(move |socket| async move {
        let handler = socket::handle_realtime_socket(socket, state, context);
        if let Some(deadline) = maximum_deadline {
            // Dropping the handler closes the socket and its invalidation receiver.
            // Reconnection performs fresh provider revocation and membership checks.
            let _ = tokio::time::timeout_at(deadline, handler).await;
        } else {
            handler.await;
        }
    }))
}

fn require_browser_origin(headers: &HeaderMap, app_url: &str) -> Result<(), ApiError> {
    let configured = reqwest::Url::parse(app_url).map_err(|_| ApiError::Unauthorized)?;
    if !matches!(configured.scheme(), "https" | "http")
        || !configured.username().is_empty()
        || configured.password().is_some()
    {
        return Err(ApiError::Unauthorized);
    }
    let expected = configured.origin().ascii_serialization();
    if headers.get_all(axum::http::header::ORIGIN).iter().count() != 1 {
        return Err(ApiError::Unauthorized);
    }
    let actual = headers
        .get(axum::http::header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if actual != Some(expected.as_str()) {
        return Err(ApiError::Forbidden(
            "WebSocket origin is not permitted".into(),
        ));
    }
    Ok(())
}

// Only call after resolve_api_session has verified the same provider token.
// Untrusted claims can shorten this lease but cannot extend it beyond 60s.
fn verified_socket_lifetime(token: &str) -> Result<std::time::Duration, ApiError> {
    use base64::Engine;
    let payload = token.split('.').nth(1).ok_or(ApiError::Unauthorized)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| ApiError::Unauthorized)?;
    let claims: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| ApiError::Unauthorized)?;
    let expiry = claims
        .get("exp")
        .and_then(serde_json::Value::as_u64)
        .ok_or(ApiError::Unauthorized)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(ApiError::internal)?;
    let remaining = std::time::Duration::from_secs(expiry)
        .checked_sub(now)
        .filter(|remaining| !remaining.is_zero())
        .ok_or(ApiError::Unauthorized)?;
    Ok(remaining.min(std::time::Duration::from_secs(60)))
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
    fn workos_websocket_requires_exact_frontend_origin() {
        let mut headers = HeaderMap::new();
        assert!(require_browser_origin(&headers, "https://alpha.example.test/app").is_err());
        for origin in [
            "null",
            "https://evil.test",
            "https://alpha.example.test.evil.test",
            "http://alpha.example.test",
            "https://alpha.example.test/path",
        ] {
            headers.insert("origin", origin.parse().unwrap());
            assert!(require_browser_origin(&headers, "https://alpha.example.test/app").is_err());
        }
        headers.insert("origin", "https://alpha.example.test".parse().unwrap());
        assert!(require_browser_origin(&headers, "https://alpha.example.test/app").is_ok());
    }
    #[test]
    fn socket_lease_never_outlives_provider_jwt_or_sixty_seconds() {
        use base64::Engine;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let token = |exp| {
            format!(
                "header.{}.signature",
                base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .encode(json!({"exp":exp}).to_string())
            )
        };
        assert!(verified_socket_lifetime(&token(now)).is_err());
        assert!((1..=10).contains(
            &verified_socket_lifetime(&token(now + 10))
                .unwrap()
                .as_secs()
        ));
        assert_eq!(
            verified_socket_lifetime(&token(now + 600))
                .unwrap()
                .as_secs(),
            60
        );
        assert!(verified_socket_lifetime("malformed").is_err());
    }

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
        assert!(authorized_resources(&requested, None).is_err());
    }

    #[test]
    fn realtime_authorization_drops_resources_without_fresh_field_access() {
        let access = stdb_auth::FieldAccessContext {
            organization_id: 7,
            role_id: 9,
            role_name: "member".into(),
            is_superuser: false,
            role_permissions: vec!["contact:read".into()],
            identity_hex: "actor".into(),
            field_permissions: Vec::new(),
            role_ids: Vec::new(),
            org_permissions: Vec::new(),
        };
        let requested = vec!["employees".to_string(), "iot-hubs".to_string()];
        assert!(authorized_resources(&requested, Some(&access))
            .expect("authorization should fail closed by filtering")
            .is_empty());
    }

    #[test]
    fn realtime_company_scope_is_membership_derived() {
        assert!(validate_requested_company_scope(&[], None, 11).is_ok());
        assert!(validate_requested_company_scope(&[11], Some(11), 11).is_ok());
        assert!(validate_requested_company_scope(&[12], None, 11).is_err());
        assert!(validate_requested_company_scope(&[], Some(12), 11).is_err());
        assert!(validate_requested_company_scope(&[11, 12], Some(11), 11).is_ok());
        assert!(validate_requested_company_scope(&[0, 11], Some(11), 11).is_err());
    }

    #[test]
    fn realtime_authorization_keeps_module_owned_hr_and_iot_resources() {
        let access = stdb_auth::FieldAccessContext {
            organization_id: 7,
            role_id: 9,
            role_name: "manager".into(),
            is_superuser: false,
            role_permissions: vec!["module:hr:read".into(), "module:iot:read".into()],
            identity_hex: "actor".into(),
            field_permissions: Vec::new(),
            role_ids: Vec::new(),
            org_permissions: Vec::new(),
        };
        let requested = vec!["employees".to_string(), "iot-hubs".to_string()];
        assert_eq!(
            authorized_resources(&requested, Some(&access))
                .expect("module grants should authorize registered resources"),
            requested
        );
    }
}
