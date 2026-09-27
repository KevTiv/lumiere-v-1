//! Typed operation and compatibility reducer handlers.

use crate::commands::{
    authorize_reducer_company_scope, execute_reducer_call, named_command_args,
    session_operation_contract, session_reducer_contract, validate_reducer_scope,
};
use crate::error::ApiError;
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::stdb_identity_hex_hint;
use axum::{
    extract::{Path, State},
    http::{header::AUTHORIZATION, HeaderMap},
    Json,
};
use serde_json::Value;
use std::sync::Arc;

pub(crate) async fn post_operation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Path(operation): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let operation_id = operation.clone();
    match post_operation_inner(state, headers, cookies, operation, body).await {
        Ok(response) => {
            tracing::info!(operation = %operation_id, outcome = "success", "typed operation completed");
            Ok(response)
        }
        Err(error) => {
            tracing::info!(operation = %operation_id, outcome = "error", "typed operation rejected");
            Err(error)
        }
    }
}

async fn post_operation_inner(
    state: Arc<AppState>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    operation: String,
    body: Value,
) -> Result<Json<Value>, ApiError> {
    let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());
    let session = resolve_api_session(&state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let contract = session_operation_contract(&operation)?;
    let client = state.client_with_token(&session.stdb_token);
    let context = TrustedOperationContext::from_session_with_placement(
        &session,
        client,
        contract.contract_operation_id,
        &state.organization_placements,
    )?;
    if !body.is_object() {
        return Err(ApiError::Unprocessable(
            "Operation body must be a named object".into(),
        ));
    }
    let args = named_command_args(contract, body, context.organization_id())?;
    let organization_id = context.organization_id();
    let company_scope = validate_reducer_scope(contract, &args, organization_id)?;
    let company_scope = authorize_reducer_company_scope(&context, company_scope).await?;
    let context = context.with_company_scope(company_scope)?;
    context.require_current_placement(&state.organization_placements)?;

    let correlation_id = context.correlation_id().to_string();
    let response = execute_reducer_call(&context, contract, args).await?;
    attach_operation_receipt(
        response,
        contract.contract_operation_id,
        correlation_id.as_str(),
    )
}

fn attach_operation_receipt(
    mut response: Json<Value>,
    operation_id: &str,
    correlation_id: &str,
) -> Result<Json<Value>, ApiError> {
    let object = response.0.as_object_mut().ok_or_else(|| {
        ApiError::Internal("trusted operation acknowledgement must be a JSON object".into())
    })?;
    object.insert(
        "operationId".to_string(),
        Value::String(operation_id.to_string()),
    );
    object.insert(
        "correlationId".to_string(),
        Value::String(correlation_id.to_string()),
    );
    Ok(response)
}

pub(crate) async fn post_compat_reducer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Path(reducer): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());
    let session = resolve_api_session(&state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let contract = session_reducer_contract(&reducer)?;
    let client = state.client_with_token(&session.stdb_token);
    let context = TrustedOperationContext::from_session_with_placement(
        &session,
        client,
        contract.contract_operation_id,
        &state.organization_placements,
    )?;
    let args = body.as_array().cloned().ok_or_else(|| {
        ApiError::Unprocessable(
            "Compatibility reducer body must be a positional argument array".into(),
        )
    })?;
    let organization_id = context.organization_id();
    let company_scope = validate_reducer_scope(contract, &args, organization_id)?;
    let company_scope = authorize_reducer_company_scope(&context, company_scope).await?;
    let context = context.with_company_scope(company_scope)?;
    context.require_current_placement(&state.organization_placements)?;
    execute_reducer_call(&context, contract, args).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn typed_operation_receipt_preserves_ack_and_adds_server_metadata() {
        let receipt = attach_operation_receipt(
            Json(json!({ "ok": true })),
            "erp.convert_opportunity_to_sale_order",
            "corr-test-1",
        )
        .expect("receipt");

        assert_eq!(
            receipt.0,
            json!({
                "ok": true,
                "operationId": "erp.convert_opportunity_to_sale_order",
                "correlationId": "corr-test-1"
            })
        );
    }

    #[test]
    fn typed_operation_receipt_rejects_non_object_acknowledgement() {
        let error = attach_operation_receipt(
            Json(Value::Null),
            "erp.convert_opportunity_to_sale_order",
            "corr-test-2",
        )
        .expect_err("non-object acknowledgement must fail closed");

        assert!(matches!(error, ApiError::Internal(_)));
    }
}
