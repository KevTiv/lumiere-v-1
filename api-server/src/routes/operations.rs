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
use lumiere_auth_context::ORGANIZATION_HEADER;
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
    let organization_id = context.organization_id();
    require_expected_organization(&headers, organization_id)?;
    if !body.is_object() {
        return Err(ApiError::Unprocessable(
            "Operation body must be a named object".into(),
        ));
    }
    let args = named_command_args(contract, body, organization_id)?;
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

/// This optional precondition can only narrow the authenticated session scope.
/// A session that changes organization after preflight must not redirect a write.
fn require_expected_organization(
    headers: &HeaderMap,
    organization_id: u64,
) -> Result<(), ApiError> {
    let mut values = headers.get_all(ORGANIZATION_HEADER).iter();
    let Some(value) = values.next() else {
        return Ok(());
    };
    let invalid = || {
        ApiError::Unprocessable(format!(
            "{ORGANIZATION_HEADER} must contain one positive organization ID"
        ))
    };
    if values.next().is_some() {
        return Err(invalid());
    }
    let expected = value
        .to_str()
        .ok()
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|id| *id > 0)
        .ok_or_else(invalid)?;
    if expected != organization_id {
        return Err(ApiError::Forbidden(
            "requested organization does not match the authenticated session".into(),
        ));
    }
    Ok(())
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
    use axum::{
        http::{HeaderValue, StatusCode},
        response::IntoResponse,
    };
    use serde_json::json;

    fn organization_header(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            ORGANIZATION_HEADER,
            HeaderValue::from_str(value).expect("test organization header"),
        );
        headers
    }

    #[test]
    fn typed_operation_accepts_absent_or_matching_organization_precondition() {
        assert!(require_expected_organization(&HeaderMap::new(), 7).is_ok());
        assert!(require_expected_organization(&organization_header("7"), 7).is_ok());
        assert!(require_expected_organization(
            &organization_header(&u64::MAX.to_string()),
            u64::MAX
        )
        .is_ok());
    }

    #[test]
    fn typed_operation_rejects_a_session_organization_change() {
        let error = require_expected_organization(&organization_header("7"), 8)
            .expect_err("preflight organization must match the current session");
        assert_eq!(error.into_response().status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn typed_operation_rejects_malformed_organization_preconditions() {
        for value in [
            "",
            "0",
            "-7",
            "+7",
            "7.0",
            "7, 7",
            " 7 ",
            "18446744073709551616",
        ] {
            let error = require_expected_organization(&organization_header(value), 7)
                .expect_err("organization precondition must be a positive u64");
            assert_eq!(
                error.into_response().status(),
                StatusCode::UNPROCESSABLE_ENTITY,
                "header value: {value:?}"
            );
        }
        let mut headers = HeaderMap::new();
        headers.insert(
            ORGANIZATION_HEADER,
            HeaderValue::from_bytes(b"\xff").expect("opaque header value"),
        );
        let error = require_expected_organization(&headers, 7)
            .expect_err("non-text organization precondition must fail closed");
        assert_eq!(
            error.into_response().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[test]
    fn typed_operation_rejects_duplicate_organization_preconditions() {
        for second in ["7", "8"] {
            let mut headers = organization_header("7");
            headers.append(ORGANIZATION_HEADER, HeaderValue::from_static(second));
            let error = require_expected_organization(&headers, 7)
                .expect_err("duplicate scope preconditions must fail closed");
            assert_eq!(
                error.into_response().status(),
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
    }

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
