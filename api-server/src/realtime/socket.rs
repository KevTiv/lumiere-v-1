//! WebSocket handshake, authorization, forwarding, and lifecycle.

use std::collections::HashSet;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use serde_json::json;

use crate::error::ApiError;
use crate::query_exec::{
    company_ids_for_organization, crm_resource, resolve_crm_company_id, resolve_sales_company_id,
};
use crate::session::ApiSession;
use crate::state::AppState;
use stdb_auth::{create_client_subscriptions, SubscriptionQueryContext};

use super::bridge;
use super::subscription::{
    authorized_resources, parse_tables_from_sql, subscription_select_all, ClientSubscribe,
};

pub(super) async fn handle_realtime_socket(
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
    let generated_resource_keys =
        match crate::cold_tier::read_descriptor::subscription_resource_keys() {
            Ok(resources) => resources.into_iter().collect::<HashSet<_>>(),
            Err(error) => {
                let _ = socket
                    .send(Message::Text(
                        json!({ "type": "error", "error": format!("generated subscription descriptors: {error}") })
                            .to_string(),
                    ))
                    .await;
                return;
            }
        };
    let generated_resources: Vec<String> = resources
        .iter()
        .filter(|resource| generated_resource_keys.contains(resource.trim()))
        .cloned()
        .collect();
    let non_crm_resources: Vec<String> = resources
        .iter()
        .filter(|resource| {
            !crm_resource(resource.trim()) && !generated_resource_keys.contains(resource.trim())
        })
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
            if !generated_resources.is_empty() {
                let allowed_company_id = match resolve_sales_company_id(
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
                for resource in &generated_resources {
                    match crate::cold_tier::read_descriptor::compile_subscription_sql(
                        resource,
                        session_org,
                        Some(allowed_company_id),
                    ) {
                        Ok(query) => queries.push(query),
                        Err(error) => {
                            let _ = socket
                                .send(Message::Text(
                                    json!({ "type": "error", "error": format!("generated subscription descriptor: {error}") })
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

    bridge::spawn_subscription_bridge(
        state.config.stdb_host.clone(),
        state.config.stdb_module.clone(),
        token,
        tables.iter().cloned().collect(),
        crm_subscription_tables,
        resolved_crm_company_id,
        resources_vec.clone(),
        queries.clone(),
        sdk_tx.clone(),
    );
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
