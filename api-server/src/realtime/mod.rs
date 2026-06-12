//! Browser WebSocket (Lumiere JSON) + SpacetimeDB Rust SDK subscription bridge.

mod wire {
    include!(concat!(env!("OUT_DIR"), "/realtime_wire.rs"));
}

use std::collections::HashSet;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::session::{resolve_api_session, ApiSession};
use crate::state::AppState;
use crate::stdb_sdk_bindings::DbConnection;
use crate::web_session::stdb_identity_hex_hint;
use spacetimedb_sdk::DbContext;
use stdb_auth::{
    create_client_subscriptions, subscription_resource_keys_vec, SubscriptionQueryContext,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientSubscribe {
    resources: Vec<String>,
    organization_id: u64,
    #[serde(default)]
    company_ids: Vec<u64>,
}

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

fn parse_tables_from_sql(sql: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let lower = sql.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(idx) = rest.find("from ") {
        rest = &rest[idx + 5..];
        rest = rest.trim_start();
        let name: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if !name.is_empty() {
            out.insert(name);
        }
    }
    out
}

fn validate_resources(requested: &[String]) -> Result<(), ApiError> {
    let allowed: HashSet<String> = subscription_resource_keys_vec().into_iter().collect();
    for r in requested {
        let t = r.trim();
        if t.is_empty() || !allowed.contains(t) {
            return Err(ApiError::BadRequest(format!(
                "Unknown or disallowed realtime resource: {t}"
            )));
        }
    }
    Ok(())
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

    Ok(ws.on_upgrade(move |socket| handle_realtime_socket(socket, state, session, org_id)))
}

async fn handle_realtime_socket(
    mut socket: WebSocket,
    state: Arc<AppState>,
    session: ApiSession,
    session_org: u64,
) {
    let first = match socket.recv().await {
        Some(Ok(Message::Text(t))) => t,
        Some(Ok(Message::Binary(b))) => match String::from_utf8(b.to_vec()) {
            Ok(s) => s,
            Err(_) => {
                let _ = socket
                    .send(Message::Text(
                        json!({ "type": "error", "error": "invalid UTF-8" }).to_string(),
                    ))
                    .await;
                return;
            }
        },
        _ => {
            let _ = socket
                .send(Message::Text(
                    json!({ "type": "error", "error": "expected subscribe JSON as first message" })
                        .to_string(),
                ))
                .await;
            return;
        }
    };

    let sub: ClientSubscribe = match serde_json::from_str(&first) {
        Ok(s) => s,
        Err(e) => {
            let _ = socket
                .send(Message::Text(
                    json!({ "type": "error", "error": format!("invalid subscribe: {e}") })
                        .to_string(),
                ))
                .await;
            return;
        }
    };

    if sub.organization_id != session_org {
        let _ = socket
            .send(Message::Text(
                json!({ "type": "error", "error": "organizationId does not match session" })
                    .to_string(),
            ))
            .await;
        return;
    }

    if let Err(e) = validate_resources(&sub.resources) {
        let msg = match e {
            ApiError::BadRequest(m) => m,
            _ => "validation failed".to_string(),
        };
        let _ = socket
            .send(Message::Text(
                json!({ "type": "error", "error": msg }).to_string(),
            ))
            .await;
        return;
    }

    let identity_hex = (session.identity_hex != "unknown").then_some(session.identity_hex.as_str());
    let company_ids_slice = if sub.company_ids.is_empty() {
        None
    } else {
        Some(sub.company_ids.as_slice())
    };

    let ctx = SubscriptionQueryContext {
        organization_id: Some(session_org),
        company_ids: company_ids_slice,
        identity_hex,
        role_names: None,
        field_access: session.field_access.as_ref(),
    };

    let queries = match create_client_subscriptions(&sub.resources, &ctx) {
        Ok(q) => q,
        Err(e) => {
            let _ = socket
                .send(Message::Text(
                    json!({ "type": "error", "error": format!("subscription SQL: {e}") })
                        .to_string(),
                ))
                .await;
            return;
        }
    };

    if queries.is_empty() {
        let _ = socket
            .send(Message::Text(
                json!({ "type": "error", "error": "no subscription queries for requested resources" })
                    .to_string(),
            ))
            .await;
        return;
    }

    let mut tables: HashSet<String> = HashSet::new();
    for q in &queries {
        tables.extend(parse_tables_from_sql(q));
    }

    let resources_vec: Vec<String> = sub.resources.iter().map(|s| s.trim().to_string()).collect();
    let (sdk_tx, mut sdk_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let stdb_uri = state.config.stdb_host.clone();
    let module = state.config.stdb_module.clone();
    let token = session.stdb_token.clone();
    let tables_thread: Vec<String> = tables.iter().cloned().collect();
    let res_thread = resources_vec.clone();
    let queries_thread = queries.clone();

    std::thread::spawn(move || {
        let sdk_tx_err = sdk_tx.clone();
        let conn_result: Result<DbConnection, spacetimedb_sdk::Error> = DbConnection::builder()
            .with_uri(&stdb_uri)
            .with_database_name(&module)
            .with_token(Some(token))
            .on_connect_error(move |_ctx, err| {
                tracing::error!("realtime STDB connect error: {err:?}");
                let _ = sdk_tx_err.send(
                    json!({ "type": "error", "error": format!("connect_error: {err:?}") })
                        .to_string(),
                );
            })
            .on_connect(move |conn, _ident, _tok| {
                for t in &tables_thread {
                    if let Err(e) =
                        wire::wire_realtime_table_callbacks(conn, t, &res_thread, &sdk_tx)
                    {
                        tracing::debug!("realtime skip wire for table {t}: {e}");
                    }
                }

                let res_applied = res_thread.clone();
                let tx_ok = sdk_tx.clone();
                let tx_err = sdk_tx.clone();
                let q = queries_thread.clone();
                conn.subscription_builder()
                    .on_applied(move |_ctx| {
                        let _ = tx_ok.send(
                            json!({ "type": "subscribed", "resources": res_applied }).to_string(),
                        );
                    })
                    .on_error(move |_ctx, err| {
                        let _ = tx_err.send(
                            json!({ "type": "error", "error": format!("{err:?}") }).to_string(),
                        );
                    })
                    .subscribe(q);
            })
            .build();

        let Ok(conn) = conn_result else {
            return;
        };

        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(r) => r,
            Err(e) => {
                tracing::error!("realtime runtime: {e}");
                return;
            }
        };
        if let Err(e) = rt.block_on(conn.run_async()) {
            tracing::debug!("realtime run_async: {e:?}");
        }
    });

    loop {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(p))) => {
                        let _ = socket.send(Message::Pong(p)).await;
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Binary(_))) | Some(Ok(Message::Text(_))) => {}
                    Some(Err(_)) => break,
                }
            }
            m = sdk_rx.recv() => {
                match m {
                    Some(text) => {
                        if socket.send(Message::Text(text)).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }
}

/// POST body subscribe (for clients that cannot send WS text first); returns upgrade URL hint — optional helper.
pub async fn realtime_info() -> Json<serde_json::Value> {
    Json(json!({
        "path": "/v1/realtime/ws",
        "protocol": "First message: JSON {\"resources\":[\"leads\",...],\"organizationId\":N,\"companyIds\":[]}"
    }))
}
