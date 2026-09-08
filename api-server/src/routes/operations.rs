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
    let context =
        TrustedOperationContext::from_session(session, client, contract.contract_operation_id)?;
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
    execute_reducer_call(&context, contract, args).await
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
    let context =
        TrustedOperationContext::from_session(session, client, contract.contract_operation_id)?;
    let args = body.as_array().cloned().ok_or_else(|| {
        ApiError::Unprocessable(
            "Compatibility reducer body must be a positional argument array".into(),
        )
    })?;
    let organization_id = context.organization_id();
    let company_scope = validate_reducer_scope(contract, &args, organization_id)?;
    let company_scope = authorize_reducer_company_scope(&context, company_scope).await?;
    let context = context.with_company_scope(company_scope)?;
    execute_reducer_call(&context, contract, args).await
}
