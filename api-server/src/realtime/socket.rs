//! WebSocket handshake, authorization, forwarding, and lifecycle.

use std::collections::HashSet;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use serde_json::json;

use crate::error::ApiError;
use crate::query_exec::{crm_resource, resolve_sales_company_id};
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use stdb_auth::{create_client_subscriptions, SubscriptionQueryContext};

use super::bridge;
use super::subscription::{
    authorized_resources, parse_tables_from_sql, subscription_select_all,
    validate_requested_company_scope, ClientSubscribe,
};
use super::workflow;

pub(super) fn must_close_after_bridge_message(
    message: &serde_json::Value,
    has_workflow_subscription: bool,
) -> bool {
    message.get("type").and_then(serde_json::Value::as_str) == Some("error")
        && (has_workflow_subscription
            || message.get("terminal").and_then(serde_json::Value::as_bool) == Some(true))
}

pub(super) async fn handle_realtime_socket(
    mut socket: WebSocket,
    state: Arc<AppState>,
    context: TrustedOperationContext,
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

    let session_org = context.organization_id();

    if let Err(error) = context.require_current_placement(&state.organization_placements) {
        let _ = socket
            .send(Message::Text(
                json!({ "type": "error", "error": error.to_string() }).to_string(),
            ))
            .await;
        return;
    }

    if sub.organization_id != session_org {
        let _ = socket
            .send(Message::Text(
                json!({ "type": "error", "error": "organizationId does not match session" })
                    .to_string(),
            ))
            .await;
        return;
    }

    let resources = match authorized_resources(&sub.resources, Some(context.field_access())) {
        Ok(resources) => resources,
        Err(ApiError::BadRequest(message)) => {
            let _ = socket
                .send(Message::Text(
                    json!({ "type": "error", "error": message }).to_string(),
                ))
                .await;
            return;
        }
        Err(error) => {
            let _ = socket
                .send(Message::Text(
                    json!({ "type": "error", "error": error.to_string() }).to_string(),
                ))
                .await;
            return;
        }
    };

    let allowed_company_id = match resolve_sales_company_id(
        context.client(),
        session_org,
        context.actor_identity(),
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
    if let Err(error) = validate_requested_company_scope(
        &sub.company_ids,
        sub.active_company_id,
        allowed_company_id,
    ) {
        let _ = socket
            .send(Message::Text(
                json!({ "type": "error", "error": error.to_string() }).to_string(),
            ))
            .await;
        return;
    }
    let context = match context.with_company_scope(vec![allowed_company_id]) {
        Ok(context) => context,
        Err(error) => {
            let _ = socket
                .send(Message::Text(
                    json!({ "type": "error", "error": error.to_string() }).to_string(),
                ))
                .await;
            return;
        }
    };
    if let Err(error) = context.require_company_scope(&[allowed_company_id]) {
        let _ = socket
            .send(Message::Text(
                json!({ "type": "error", "error": error.to_string() }).to_string(),
            ))
            .await;
        return;
    }

    let company_ids = [allowed_company_id];
    let base_ctx = SubscriptionQueryContext {
        organization_id: Some(session_org),
        company_ids: Some(&company_ids),
        identity_hex: Some(context.actor_identity()),
        role_names: None,
        manager_employee_id: None,
        field_access: Some(context.field_access()),
    };

    let workflow_resources: Vec<String> = resources
        .iter()
        .filter(|resource| workflow::resource_table(resource).is_some())
        .cloned()
        .collect();
    let workflow_owner_token = if workflow_resources.is_empty() {
        None
    } else {
        let Some(token) = state
            .config
            .stdb_server_token
            .as_ref()
            .filter(|token| !token.is_empty())
            .cloned()
        else {
            let _ = socket.send(Message::Text(json!({"type":"error","error":"workflow realtime requires the server owner token"}).to_string())).await;
            return;
        };
        if let Err(error) =
            workflow::require_current_scope(&state.stdb, &context, allowed_company_id).await
        {
            let _ = socket
                .send(Message::Text(
                    json!({"type":"error","error":error.to_string()}).to_string(),
                ))
                .await;
            return;
        }
        if let Err(error) = context.require_current_placement(&state.organization_placements) {
            let _ = socket
                .send(Message::Text(
                    json!({"type":"error","error":error.to_string()}).to_string(),
                ))
                .await;
            return;
        }
        Some(token)
    };
    let workflow_queries = if workflow_resources.is_empty() {
        Vec::new()
    } else {
        match workflow::subscription_queries(&workflow_resources, session_org, allowed_company_id) {
            Ok(queries) => queries,
            Err(error) => {
                let _ = socket
                    .send(Message::Text(
                        json!({"type":"error","error":error.to_string()}).to_string(),
                    ))
                    .await;
                return;
            }
        }
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
        .filter(|resource| {
            generated_resource_keys.contains(resource.trim())
                && workflow::resource_table(resource).is_none()
        })
        .cloned()
        .collect();
    let non_crm_resources: Vec<String> = resources
        .iter()
        .filter(|resource| {
            !crm_resource(resource.trim())
                && !generated_resource_keys.contains(resource.trim())
                && workflow::resource_table(resource).is_none()
        })
        .cloned()
        .collect();
    let mut resolved_crm_company_id = None;
    let mut crm_subscription_tables = HashSet::new();

    let queries = match create_client_subscriptions(&non_crm_resources, &base_ctx) {
        Ok(mut queries) => {
            if !crm_resources.is_empty() {
                resolved_crm_company_id = Some(allowed_company_id);
                let crm_ctx = SubscriptionQueryContext {
                    company_ids: Some(&company_ids),
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

    if queries.is_empty() && workflow_queries.is_empty() {
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
    let (workflow_tx, mut workflow_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let has_base_subscription = !queries.is_empty();
    let has_workflow_subscription = !workflow_queries.is_empty();

    if has_base_subscription {
        let token = if crm_resources.is_empty() {
            context.client().token().to_owned()
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
    }
    if let Some(token) = workflow_owner_token {
        // Never reuse owner authority for generic actor/auth subscription SQL.
        // This connection receives only the fixed company-scoped private set.
        let workflow_tables: HashSet<String> = workflow_queries
            .iter()
            .flat_map(|query| parse_tables_from_sql(query))
            .collect();
        bridge::spawn_subscription_bridge(
            state.config.stdb_host.clone(),
            state.config.stdb_module.clone(),
            token,
            workflow_tables.iter().cloned().collect(),
            workflow_tables,
            Some(allowed_company_id),
            workflow_resources,
            workflow_queries,
            workflow_tx.clone(),
        );
    }
    let mut base_ready = !has_base_subscription;
    let mut workflow_ready = !has_workflow_subscription;
    let mut announced_ready = false;
    loop {
        let (workflow_message, message) = tokio::select! {
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
                continue;
            }
            message = sdk_rx.recv(), if has_base_subscription => (false, message),
            message = workflow_rx.recv(), if has_workflow_subscription => (true, message),
        };
        let Some(text) = message else {
            break;
        };
        let parsed = serde_json::from_str::<serde_json::Value>(&text).ok();
        if parsed
            .as_ref()
            .and_then(|value| value.get("type"))
            .and_then(|kind| kind.as_str())
            == Some("subscribed")
        {
            if workflow_message {
                workflow_ready = true;
            } else {
                base_ready = true;
            }
            if base_ready && workflow_ready && !announced_ready {
                if socket
                    .send(Message::Text(
                        json!({"type":"subscribed","resources":resources_vec}).to_string(),
                    ))
                    .await
                    .is_err()
                {
                    break;
                }
                announced_ready = true;
            }
            continue;
        }
        if has_workflow_subscription {
            if let Some(notice) = parsed.as_ref().and_then(workflow::authority_refresh_notice) {
                let _ = socket.send(Message::Text(notice)).await;
                let _ = socket.send(Message::Close(None)).await;
                break;
            }
        }
        let subscription_error = parsed.as_ref().is_some_and(|message| {
            must_close_after_bridge_message(message, has_workflow_subscription)
        });
        if socket.send(Message::Text(text)).await.is_err() {
            break;
        }
        if subscription_error {
            let _ = socket.send(Message::Close(None)).await;
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_failure_closes_workflow_socket_and_terminal_failure_closes_all_sockets() {
        assert!(must_close_after_bridge_message(
            &json!({"type":"error"}),
            true
        ));
        assert!(!must_close_after_bridge_message(
            &json!({"type":"error"}),
            false
        ));
        assert!(must_close_after_bridge_message(
            &json!({"type":"error","terminal":true}),
            false
        ));
        assert!(!must_close_after_bridge_message(
            &json!({"type":"change","terminal":true}),
            true
        ));
        assert!(!must_close_after_bridge_message(
            &json!({"type":"subscribed"}),
            true
        ));
    }
}
