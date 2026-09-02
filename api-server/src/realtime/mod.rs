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
use crate::query_exec::{company_ids_for_organization, crm_resource, resolve_crm_company_id};
use crate::session::{resolve_api_session, ApiSession};
use crate::state::AppState;
use crate::web_session::stdb_identity_hex_hint;
use lumiere_contracts::bindings::DbConnection;
use spacetimedb_sdk::DbContext;
use stdb_auth::{
    create_client_subscriptions, full_client_subscription_resources_vec,
    has_resource_read_permission, subscription_resource_keys_vec, FieldAccessContext,
    SubscriptionQueryContext,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientSubscribe {
    resources: Vec<String>,
    organization_id: u64,
    #[serde(default)]
    company_ids: Vec<u64>,
    #[serde(default)]
    active_company_id: Option<u64>,
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

/// SpacetimeDB subscriptions must return the complete table row type. The
/// owner-only bridge consumes those rows internally and emits invalidations,
/// never row payloads, so retain the scoped predicate while widening only the
/// subscription projection.
fn subscription_select_all(sql: &str) -> Result<String, ApiError> {
    let from = sql
        .find(" FROM ")
        .ok_or_else(|| ApiError::BadRequest("subscription SQL has no FROM clause".into()))?;
    let table_scope = &sql[from..];
    let table_scope = table_scope
        .split_once(" ORDER BY ")
        .map_or(table_scope, |(scope, _)| scope);
    Ok(format!("SELECT *{table_scope}"))
}

fn validate_resources(requested: &[String]) -> Result<(), ApiError> {
    let allowed: HashSet<String> = subscription_resource_keys_vec()
        .into_iter()
        .chain(full_client_subscription_resources_vec())
        .collect();
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

fn bootstrap_realtime_resource(resource: &str) -> bool {
    matches!(
        resource,
        "auth"
            | "user-profile"
            | "user-role-assignment"
            | "auth-role-table"
            | "user-organization"
            | "field-permissions"
            | "org-permissions"
            | "policy-snapshots"
            | "roles"
            | "user-roles"
            | "form-configuration"
    )
}

fn authorized_resources(
    requested: &[String],
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<String>, ApiError> {
    validate_resources(requested)?;
    Ok(requested
        .iter()
        .map(|resource| resource.trim())
        .filter(|resource| {
            bootstrap_realtime_resource(resource)
                || has_resource_read_permission(field_access, resource)
        })
        .map(str::to_owned)
        .collect())
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

    let resources = match authorized_resources(&sub.resources, session.field_access.as_ref()) {
        Ok(resources) => resources,
        Err(ApiError::BadRequest(message)) => {
            let _ = socket
                .send(Message::Text(
                    json!({ "type": "error", "error": message }).to_string(),
                ))
                .await;
            return;
        }
        Err(_) => unreachable!("resource authorization only returns bad requests"),
    };

    let session_client = state.client_with_token(&session.stdb_token);
    let organization_company_ids = match company_ids_for_organization(
        &session_client,
        session_org,
        session.field_access.as_ref(),
    )
    .await
    {
        Ok(ids) => ids.into_iter().collect::<HashSet<_>>(),
        Err(_) => {
            let _ = socket
                .send(Message::Text(
                    json!({ "type": "error", "error": "company scope validation failed" })
                        .to_string(),
                ))
                .await;
            return;
        }
    };
    if sub
        .company_ids
        .iter()
        .any(|company_id| !organization_company_ids.contains(company_id))
    {
        let _ = socket
            .send(Message::Text(
                json!({ "type": "error", "error": "companyId does not belong to session organization" })
                    .to_string(),
            ))
            .await;
        return;
    }

    let identity_hex = (session.identity_hex != "unknown").then_some(session.identity_hex.as_str());
    let legacy_company_ids = (!sub.company_ids.is_empty()).then_some(sub.company_ids.as_slice());
    let base_ctx = SubscriptionQueryContext {
        organization_id: Some(session_org),
        company_ids: legacy_company_ids,
        identity_hex,
        role_names: None,
        manager_employee_id: None,
        field_access: session.field_access.as_ref(),
    };

    let crm_resources: Vec<String> = resources
        .iter()
        .filter(|resource| crm_resource(resource.trim()))
        .cloned()
        .collect();
    let non_crm_resources: Vec<String> = resources
        .iter()
        .filter(|resource| !crm_resource(resource.trim()))
        .cloned()
        .collect();
    let mut resolved_crm_company_id = None;
    let mut crm_subscription_tables = HashSet::new();

    let queries = match create_client_subscriptions(&non_crm_resources, &base_ctx) {
        Ok(mut queries) => {
            if !crm_resources.is_empty() {
                let allowed_company_id = match resolve_crm_company_id(
                    &session_client,
                    session_org,
                    &session.identity_hex,
                    sub.active_company_id,
                )
                .await
                {
                    Ok(company_id) => company_id,
                    Err(_) => {
                        let _ = socket
                            .send(Message::Text(
                                json!({ "type": "error", "error": "activeCompanyId is not permitted for this session" })
                                    .to_string(),
                            ))
                            .await;
                        return;
                    }
                };
                resolved_crm_company_id = Some(allowed_company_id);
                let crm_company_ids = [allowed_company_id];
                let crm_ctx = SubscriptionQueryContext {
                    company_ids: Some(&crm_company_ids),
                    ..base_ctx
                };
                for resource in &crm_resources {
                    match create_client_subscriptions(std::slice::from_ref(resource), &crm_ctx) {
                        Ok(crm_queries) => {
                            for query in crm_queries {
                                crm_subscription_tables.extend(parse_tables_from_sql(&query));
                                queries.push(query);
                            }
                        }
                        Err(e) => {
                            let _ = socket
                                .send(Message::Text(
                                    json!({ "type": "error", "error": format!("subscription SQL: {e}") })
                                        .to_string(),
                                ))
                                .await;
                            return;
                        }
                    }
                }
            }
            queries
        }
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

    // The Rust SDK subscription parser accepts complete rows only and rejects
    // ORDER BY. This owner-side bridge never forwards row payloads: callbacks
    // emit resource invalidations and the browser refetches through authorized
    // HTTP. Widen every internal projection, not just CRM, while retaining the
    // authenticated row predicate produced above.
    let queries = match queries
        .iter()
        .map(|query| subscription_select_all(query))
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(queries) => queries,
        Err(ApiError::BadRequest(message)) => {
            let _ = socket
                .send(Message::Text(
                    json!({ "type": "error", "error": message }).to_string(),
                ))
                .await;
            return;
        }
        Err(_) => unreachable!("subscription projection rewrite only returns bad requests"),
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

    let resources_vec = resources;
    let (sdk_tx, mut sdk_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let stdb_uri = state.config.stdb_host.clone();
    let module = state.config.stdb_module.clone();
    let token = if crm_resources.is_empty() {
        session.stdb_token.clone()
    } else {
        let Some(token) = state
            .config
            .stdb_server_token
            .as_ref()
            .filter(|token| !token.is_empty())
            .cloned()
        else {
            let _ = socket
                .send(Message::Text(
                    json!({ "type": "error", "error": "CRM realtime requires the server owner token" })
                        .to_string(),
                ))
                .await;
            return;
        };
        token
    };
    let tables_thread: Vec<String> = tables.iter().cloned().collect();
    let crm_tables_thread = crm_subscription_tables;
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
                    let company_id =
                        resolved_crm_company_id.filter(|_| crm_tables_thread.contains(t));
                    if let Err(e) = wire::wire_realtime_table_callbacks(
                        conn,
                        t,
                        &res_thread,
                        company_id,
                        &sdk_tx,
                    ) {
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
                        tracing::error!("realtime STDB subscription error: {err:?}");
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn realtime_authorization_keeps_bootstrap_and_drops_ungranted_domain_resources() {
        let requested = vec!["auth".to_string(), "contacts".to_string()];
        assert_eq!(
            authorized_resources(&requested, None).expect("known resources should validate"),
            vec!["auth".to_string()]
        );
    }
}
