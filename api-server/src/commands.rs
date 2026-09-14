//! Session command contracts, argument normalization, and scoped reducer calls.

use crate::error::ApiError;
use crate::organization_placement::{OrganizationPlacementResolver, PlacementGeneration};
use crate::query_exec::authorize_membership_company_ids;
use crate::session::{normalize_identity_hex_for_sql, ApiSession};
use crate::state::AppState;
use crate::trusted_context::{opaque_correlation_id, TrustedOperationContext};
use axum::Json;
use serde_json::{json, Value};
use stdb_client::{Exposure, ReducerCall, ReducerContract, ScalarKind, StdbClientError};

/// Narrow server-owned authorities for routes that cannot run as an ordinary
/// organization session. Each variant has an explicit reducer allowlist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InternalRouteAuthority {
    InvitationAcceptance,
    PasswordRecovery,
    PlatformProfileProjection,
    ProviderWebhook,
}

impl InternalRouteAuthority {
    fn permits(self, reducer: &str) -> bool {
        match self {
            Self::InvitationAcceptance => matches!(
                reducer,
                "add_org_member"
                    | "bind_user_credential"
                    | "bind_user_profile"
                    | "mark_invite_accepted"
            ),
            Self::PasswordRecovery => matches!(
                reducer,
                "bind_password_reset_token" | "mark_password_reset_token_projection_used"
            ),
            Self::PlatformProfileProjection => reducer == "project_user_profile",
            Self::ProviderWebhook => matches!(
                reducer,
                "receive_crm_provider_message" | "record_crm_provider_delivery"
            ),
        }
    }
}

pub(crate) fn session_reducer_contract(
    reducer: &str,
) -> Result<&'static ReducerContract, ApiError> {
    let contract = stdb_client::reducer_contract(reducer).ok_or_else(|| {
        ApiError::Forbidden(format!(
            "Reducer '{reducer}' is not exposed by the module contract"
        ))
    })?;
    if contract.exposure != Exposure::Session {
        return Err(ApiError::Forbidden(format!(
            "Reducer '{reducer}' is not session-exposed"
        )));
    }
    Ok(contract)
}

pub(crate) fn session_operation_contract(
    operation_id: &str,
) -> Result<&'static ReducerContract, ApiError> {
    let contract =
        stdb_client::reducer_contract_by_operation_id(operation_id).ok_or_else(|| {
            ApiError::Forbidden(format!(
                "Operation '{operation_id}' is not exposed by the module contract"
            ))
        })?;
    if contract.exposure != Exposure::Session {
        return Err(ApiError::Forbidden(format!(
            "Operation '{operation_id}' is not session-exposed"
        )));
    }
    Ok(contract)
}

pub(crate) fn named_command_args(
    contract: &'static ReducerContract,
    body: Value,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let mut fields = body
        .as_object()
        .cloned()
        .ok_or_else(|| ApiError::Unprocessable("Command body must be a JSON object".into()))?;
    let mut args = Vec::with_capacity(contract.params.len());

    for (position, parameter) in contract.params.iter().enumerate() {
        if Some(position) == contract.organization_position {
            args.push(json!(organization_id));
            continue;
        }
        let camel_name = snake_to_lower_camel(parameter.name);
        let snake_value = fields.remove(parameter.name);
        let camel_value = (camel_name != parameter.name)
            .then(|| fields.remove(&camel_name))
            .flatten();
        if snake_value.is_some() && camel_value.is_some() {
            return Err(ApiError::Unprocessable(format!(
                "Reducer '{}' received both '{}' and '{}'",
                contract.name, parameter.name, camel_name
            )));
        }
        let value = snake_value.or(camel_value).ok_or_else(|| {
            ApiError::Unprocessable(format!(
                "Reducer '{}' requires named field '{}'",
                contract.name, camel_name
            ))
        })?;
        args.push(value);
    }

    if !fields.is_empty() {
        let mut names: Vec<_> = fields.keys().cloned().collect();
        names.sort();
        return Err(ApiError::Unprocessable(format!(
            "Reducer '{}' received unknown or server-owned fields: {}",
            contract.name,
            names.join(", ")
        )));
    }
    Ok(args)
}

fn snake_to_lower_camel(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    let mut uppercase_next = false;
    for character in name.chars() {
        if character == '_' {
            uppercase_next = true;
        } else if uppercase_next {
            result.extend(character.to_uppercase());
            uppercase_next = false;
        } else {
            result.push(character);
        }
    }
    result
}

pub(crate) async fn execute_reducer_call(
    context: &TrustedOperationContext,
    contract: &'static ReducerContract,
    args: Vec<Value>,
) -> Result<Json<Value>, ApiError> {
    context.ensure_contract(contract)?;
    let organization_id = context.organization_id();
    let company_ids = validate_reducer_scope(contract, &args, organization_id)?;
    context.require_company_scope(&company_ids)?;
    tracing::info!(
        operation_id = contract.contract_operation_id,
        correlation_id = context.correlation_id(),
        organization_id,
        actor_identity = context.actor_identity(),
        "dispatching trusted reducer operation"
    );
    let call = ReducerCall::from_name(contract.name, Value::Array(args))
        .map_err(|error| ApiError::Unprocessable(error.to_string()))?;
    context
        .client()
        .call_reducer(call)
        .await
        .map_err(map_reducer_error)?;

    Ok(Json(json!({ "ok": true })))
}

/// Resolve a handwritten session route through the same generated reducer
/// contract, tenant-scope checks, and trusted context used by `/operations`.
///
/// The returned context lets a route perform a follow-up read without
/// reconstructing authority or retaining a raw session token.
pub(crate) async fn dispatch_session_reducer(
    state: &AppState,
    session: &ApiSession,
    reducer: &str,
    args: Value,
) -> Result<TrustedOperationContext, ApiError> {
    let args = args.as_array().cloned().ok_or_else(|| {
        ApiError::Internal("trusted route reducer arguments must be an array".into())
    })?;
    let contract = session_reducer_contract(reducer)?;
    let client = state.client_with_token(&session.stdb_token);
    let context = TrustedOperationContext::from_session_with_placement(
        session,
        client,
        contract.contract_operation_id,
        &state.organization_placements,
    )?;
    let company_scope = validate_reducer_scope(contract, &args, context.organization_id())?;
    let company_scope = authorize_reducer_company_scope(&context, company_scope).await?;
    let context = context.with_company_scope(company_scope)?;
    context.require_current_placement(&state.organization_placements)?;
    let _ = execute_reducer_call(&context, contract, args).await?;
    Ok(context)
}

/// Dispatch the presentation draft save through an explicit API-only path.
///
/// The reducer intentionally remains `Exposure::Denied`: it must not become a
/// generic operation merely because the presentation route needs persistence.
/// This path retains the authenticated session token so SpacetimeDB derives
/// the personal owner from `ctx.sender()`.
pub(crate) async fn dispatch_presentation_save(
    state: &AppState,
    session: &ApiSession,
    args: Value,
) -> Result<TrustedOperationContext, ApiError> {
    const REDUCER: &str = "save_presentation_module";
    let contract = stdb_client::reducer_contract(REDUCER).ok_or_else(|| {
        ApiError::Forbidden("presentation save reducer is absent from the module contract".into())
    })?;
    let signature_ok = contract.name == REDUCER
        && contract.contract_operation_id == "erp.save_presentation_module"
        && contract.exposure == Exposure::Denied
        && contract.organization_position == Some(0)
        && contract.params.len() == 3
        && contract
            .params
            .iter()
            .zip([
                ("organization_id", ScalarKind::UnsignedInteger),
                ("expected_revision", ScalarKind::OptionalUnsignedInteger),
                ("definition_json", ScalarKind::String),
            ])
            .all(|(actual, (name, kind))| {
                actual.name == name && actual.kind == kind && actual.ref_target.is_none()
            });
    if !signature_ok {
        return Err(ApiError::Forbidden(
            "presentation save reducer must remain denied to generic operations".into(),
        ));
    }
    let args = args
        .as_array()
        .cloned()
        .ok_or_else(|| ApiError::Internal("presentation save arguments must be an array".into()))?;
    let client = state.client_with_token(&session.stdb_token);
    let context = TrustedOperationContext::from_session_with_placement(
        session,
        client,
        contract.contract_operation_id,
        &state.organization_placements,
    )?;
    let company_scope = validate_reducer_scope(contract, &args, context.organization_id())?;
    let company_scope = authorize_reducer_company_scope(&context, company_scope).await?;
    let context = context.with_company_scope(company_scope)?;
    context.require_current_placement(&state.organization_placements)?;
    let _ = execute_reducer_call(&context, contract, args).await?;
    Ok(context)
}

/// Dispatch a deny-by-default reducer from the configured server identity.
/// The caller must choose a narrow authority variant and provide any resolved
/// organization scope separately from the reducer payload.
pub(crate) async fn dispatch_internal_reducer(
    state: &AppState,
    authority: InternalRouteAuthority,
    organization_id: Option<u64>,
    reducer: &str,
    args: Value,
) -> Result<(), ApiError> {
    if !authority.permits(reducer) {
        return Err(ApiError::Forbidden(format!(
            "internal authority {authority:?} cannot invoke reducer '{reducer}'"
        )));
    }
    let contract = stdb_client::reducer_contract(reducer).ok_or_else(|| {
        ApiError::Forbidden(format!("Reducer '{reducer}' is absent from the contract"))
    })?;
    let invitation_membership = authority == InternalRouteAuthority::InvitationAcceptance
        && reducer == "add_org_member"
        && contract.exposure == Exposure::Session;
    if contract.exposure != Exposure::Denied && !invitation_membership {
        return Err(ApiError::Forbidden(format!(
            "internal reducer '{reducer}' must be denied to sessions"
        )));
    }
    let args = args.as_array().cloned().ok_or_else(|| {
        ApiError::Internal("trusted internal reducer arguments must be an array".into())
    })?;
    validate_internal_organization_scope(contract, &args, organization_id)?;
    let placement_generation = organization_id
        .map(|organization_id| require_active_placement(state, organization_id))
        .transpose()?;

    let token = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|token| crate::auth_password::is_usable_admin_token(token))
        .ok_or_else(|| ApiError::Internal("STDB_SERVER_TOKEN is not configured".into()))?;
    let correlation_id = opaque_correlation_id();
    tracing::info!(
        operation_id = contract.contract_operation_id,
        correlation_id,
        authority = ?authority,
        organization_id,
        placement_generation = placement_generation.map(PlacementGeneration::get),
        "dispatching trusted internal reducer operation"
    );
    state
        .client_with_token(token)
        .call_reducer(
            ReducerCall::from_name(contract.name, Value::Array(args))
                .map_err(|error| ApiError::Internal(error.to_string()))?,
        )
        .await
        .map_err(map_reducer_error)
}

/// Dispatch the one operator-only reducer that intentionally preserves the
/// authenticated superuser as the SpacetimeDB audit identity.
pub(crate) async fn dispatch_superuser_reducer(
    state: &AppState,
    session: &ApiSession,
    organization_id: u64,
    reducer: &str,
    args: Value,
) -> Result<(), ApiError> {
    if reducer != "set_billing_status"
        || !session
            .field_access
            .as_ref()
            .is_some_and(|access| access.is_superuser)
    {
        return Err(ApiError::Forbidden(
            "trusted superuser authority is required".into(),
        ));
    }
    let contract = stdb_client::reducer_contract(reducer).ok_or_else(|| {
        ApiError::Forbidden(format!("Reducer '{reducer}' is absent from the contract"))
    })?;
    if contract.exposure != Exposure::Denied {
        return Err(ApiError::Forbidden(
            "superuser reducer must be denied to ordinary sessions".into(),
        ));
    }
    let args = args.as_array().cloned().ok_or_else(|| {
        ApiError::Internal("trusted superuser reducer arguments must be an array".into())
    })?;
    validate_internal_organization_scope(contract, &args, Some(organization_id))?;
    let placement_generation = require_active_placement(state, organization_id)?;
    let correlation_id = opaque_correlation_id();
    tracing::info!(
        operation_id = contract.contract_operation_id,
        correlation_id,
        actor_identity = session.identity_hex,
        organization_id,
        placement_generation = placement_generation.get(),
        "dispatching trusted superuser reducer operation"
    );
    state
        .client_with_token(&session.stdb_token)
        .call_reducer(
            ReducerCall::from_name(contract.name, Value::Array(args))
                .map_err(|error| ApiError::Internal(error.to_string()))?,
        )
        .await
        .map_err(map_reducer_error)
}

/// Bootstrap is the sole authenticated pre-membership route. It deliberately
/// cannot invoke any other reducer and retains the authenticated user's token.
pub(crate) async fn dispatch_tenant_bootstrap(
    state: &AppState,
    session: &ApiSession,
    args: Value,
) -> Result<(), ApiError> {
    let contract = stdb_client::reducer_contract("bootstrap_new_tenant").ok_or_else(|| {
        ApiError::Forbidden("bootstrap reducer is absent from the contract".into())
    })?;
    if contract.exposure != Exposure::Denied {
        return Err(ApiError::Forbidden(
            "bootstrap reducer must be denied to generic sessions".into(),
        ));
    }
    let identity = normalize_identity_hex_for_sql(&session.identity_hex);
    if identity.is_empty() || session.stdb_token.trim().is_empty() {
        return Err(ApiError::Unauthorized);
    }
    let correlation_id = opaque_correlation_id();
    tracing::info!(
        operation_id = contract.contract_operation_id,
        correlation_id,
        actor_identity = identity,
        "dispatching trusted tenant bootstrap"
    );
    state
        .client_with_token(&session.stdb_token)
        .call_reducer(
            ReducerCall::from_name(contract.name, args)
                .map_err(|error| ApiError::Internal(error.to_string()))?,
        )
        .await
        .map_err(map_reducer_error)
}

fn validate_internal_organization_scope(
    contract: &'static ReducerContract,
    args: &[Value],
    organization_id: Option<u64>,
) -> Result<(), ApiError> {
    let Some(position) = contract.organization_position else {
        return Ok(());
    };
    let expected = organization_id.ok_or_else(|| {
        ApiError::Forbidden(format!(
            "internal reducer '{}' requires resolved organization scope",
            contract.name
        ))
    })?;
    let actual = args.get(position).and_then(Value::as_u64).ok_or_else(|| {
        ApiError::Unprocessable(format!(
            "internal reducer '{}' has an invalid organization argument",
            contract.name
        ))
    })?;
    if actual == expected {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "internal reducer organization scope mismatch".into(),
        ))
    }
}

fn require_active_placement(
    state: &AppState,
    organization_id: u64,
) -> Result<PlacementGeneration, ApiError> {
    let placement = state
        .organization_placements
        .resolve(organization_id)
        .map_err(|error| {
            ApiError::Internal(format!(
                "resolve authoritative organization placement: {error}"
            ))
        })?;
    if !placement.lifecycle().permits_business_execution() {
        return Err(ApiError::Conflict(
            "organization placement is fenced for trusted operation".into(),
        ));
    }
    Ok(placement.generation())
}

/// Resolve every reducer company reference against the authenticated actor's
/// active membership. Organization membership currently grants one company;
/// passing multiple distinct company ids therefore fails closed.
pub(crate) async fn authorize_reducer_company_scope(
    context: &TrustedOperationContext,
    company_ids: Vec<u64>,
) -> Result<Vec<u64>, ApiError> {
    authorize_membership_company_ids(
        context.client(),
        context.organization_id(),
        context.actor_identity(),
        &company_ids,
        "company scope mismatch for reducer call",
    )
    .await?;
    Ok(company_ids)
}

/// Preserve reducer-level authorization and validation failures at the BFF
/// boundary. SpacetimeDB uses HTTP 530 for reducer errors, including the
/// permission denial that callers must see as HTTP 403. Unknown upstream
/// failures remain internal and keep their source for diagnostics.
fn map_reducer_error(error: anyhow::Error) -> ApiError {
    let Some(client_error) = error.downcast_ref::<StdbClientError>() else {
        return ApiError::internal(error);
    };
    let Some(body) = client_error.response_body() else {
        return ApiError::internal(error);
    };
    if client_error.status_code() != Some(530) {
        return ApiError::internal(error);
    }
    if body.to_ascii_lowercase().contains("permission denied") {
        ApiError::Forbidden(body.to_owned())
    } else {
        ApiError::Unprocessable(body.to_owned())
    }
}

pub(crate) fn validate_reducer_scope(
    contract: &'static ReducerContract,
    args: &[Value],
    session_organization_id: u64,
) -> Result<Vec<u64>, ApiError> {
    let company_scope_paths = stdb_client::company_scope_paths(contract.name);
    if let Some(position) = contract.organization_position {
        let requested_organization =
            args.get(position).and_then(Value::as_u64).ok_or_else(|| {
                ApiError::Unprocessable(format!(
                    "Reducer '{}' requires an organization_id at argument {position}",
                    contract.name
                ))
            })?;
        if requested_organization != session_organization_id {
            return Err(ApiError::Forbidden(
                "organization scope mismatch for reducer call".into(),
            ));
        }
    } else if contract.company_position.is_none()
        && company_scope_paths.is_empty()
        && contract.unscoped_reason.is_none()
    {
        return Err(ApiError::Forbidden(format!(
            "Reducer '{}' has no reviewed tenant scope",
            contract.name
        )));
    }

    let mut company_ids = Vec::new();
    if company_scope_paths.is_empty() {
        if let Some(position) = contract.company_position {
            let value = args.get(position).ok_or_else(|| {
                ApiError::Unprocessable(format!(
                    "Reducer '{}' requires company scope at argument {position}",
                    contract.name
                ))
            })?;
            if let Some(company_id) = decode_company_id(contract.name, value, false)? {
                company_ids.push(company_id);
            }
        }
    } else {
        for company_path in company_scope_paths {
            let mut value = args.get(company_path.parameter_position);
            for segment in company_path.path {
                value = value.and_then(|value| value.get(*segment));
            }
            let Some(value) = value else {
                if company_path.required {
                    return Err(ApiError::Unprocessable(format!(
                        "Reducer '{}' requires company scope at argument {} path {}",
                        contract.name,
                        company_path.parameter_position,
                        company_path.path.join(".")
                    )));
                }
                continue;
            };
            if let Some(company_id) =
                decode_company_id(contract.name, value, company_path.nullable)?
            {
                if !company_ids.contains(&company_id) {
                    company_ids.push(company_id);
                }
            }
        }
    }
    if contract.organization_position.is_none()
        && (contract.company_position.is_some() || !company_scope_paths.is_empty())
        && company_ids.is_empty()
    {
        return Err(ApiError::Unprocessable(format!(
            "Reducer '{}' requires a company_id scope",
            contract.name
        )));
    }
    Ok(company_ids)
}

fn decode_company_id(
    reducer_name: &str,
    value: &Value,
    nullable: bool,
) -> Result<Option<u64>, ApiError> {
    if let Some(company_id) = value.as_u64() {
        return Ok(Some(company_id));
    }
    if value.is_null() || value.get("none").is_some() {
        return if nullable {
            Ok(None)
        } else {
            Err(ApiError::Unprocessable(format!(
                "Reducer '{reducer_name}' requires a non-null company_id"
            )))
        };
    }
    if let Some(some) = value.get("some") {
        return some.as_u64().map(Some).ok_or_else(|| {
            ApiError::Unprocessable(format!(
                "Reducer '{reducer_name}' has an invalid company_id option"
            ))
        });
    }
    Err(ApiError::Unprocessable(format!(
        "Reducer '{reducer_name}' has an invalid company_id"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn identity_first_reducer_uses_manifest_organization_position() {
        let contract = stdb_client::reducer_contract("assign_role").expect("assign_role");
        assert!(
            validate_reducer_scope(contract, &[json!({}), json!(9), json!(7), json!({})], 7)
                .is_ok()
        );
        assert!(matches!(
            validate_reducer_scope(contract, &[json!({}), json!(9), json!(8), json!({})], 7),
            Err(ApiError::Forbidden(_))
        ));
    }

    #[test]
    fn company_first_reducer_is_not_compared_directly_to_organization() {
        let contract = stdb_client::reducer_contract("delete_company").expect("delete_company");
        assert_eq!(
            validate_reducer_scope(contract, &[json!(42)], 7).unwrap(),
            vec![42]
        );
    }

    #[test]
    fn nested_optional_company_scope_decodes_stdb_option_json() {
        let contract = stdb_client::reducer_contract("create_contact").expect("create_contact");
        assert_eq!(
            validate_reducer_scope(
                contract,
                &[json!(7), json!({ "company_id": { "some": 42 } })],
                7,
            )
            .unwrap(),
            vec![42]
        );
        assert_eq!(
            validate_reducer_scope(
                contract,
                &[json!(7), json!({ "company_id": { "none": [] } })],
                7,
            )
            .unwrap(),
            Vec::<u64>::new()
        );
        assert!(matches!(
            validate_reducer_scope(contract, &[json!(7), json!({ "company_id": "wrong" })], 7,),
            Err(ApiError::Unprocessable(_))
        ));
    }

    #[test]
    fn zero_arg_and_unknown_reducers_are_not_session_exposed() {
        let zero_arg = stdb_client::reducer_contract("apply_global_migrations")
            .expect("apply_global_migrations");
        assert!(zero_arg.params.is_empty());
        assert_eq!(zero_arg.exposure, Exposure::Denied);
        assert!(stdb_client::reducer_contract("not_a_reducer").is_none());
    }

    #[test]
    fn typed_operation_resolves_locked_identity_and_not_reducer_name() {
        let contract = session_operation_contract("erp.create_account_account")
            .expect("session operation identity");
        assert_eq!(contract.name, "create_account_account");
        assert!(session_operation_contract("create_account_account").is_err());
        assert!(session_operation_contract("erp.apply_global_migrations").is_err());
    }

    #[test]
    fn account_create_requires_and_validates_the_selected_company() {
        let contract = session_operation_contract("erp.create_account_account")
            .expect("account create operation");
        let args = named_command_args(
            contract,
            json!({ "params": { "company_id": { "some": 42 } } }),
            7,
        )
        .expect("named account create input");
        assert_eq!(args[0], json!(7));
        assert_eq!(
            validate_reducer_scope(contract, &args, 7).unwrap(),
            vec![42]
        );
        assert!(matches!(
            validate_reducer_scope(
                contract,
                &[json!(7), json!({ "company_id": { "none": [] } })],
                7,
            ),
            Err(ApiError::Unprocessable(_))
        ));
    }

    #[test]
    fn form_configuration_mutators_are_session_exposed_and_org_scoped() {
        for reducer in [
            "add_user_custom_field",
            "add_form_field",
            "delete_user_custom_field",
            "delete_form_field",
            "initialize_default_form_configs",
            "publish_form_configuration",
            "set_form_role_config",
            "update_form_field",
        ] {
            let contract = stdb_client::reducer_contract(reducer).expect(reducer);
            assert_eq!(contract.exposure, Exposure::Session, "{reducer}");
            assert_eq!(contract.organization_position, Some(0), "{reducer}");
            assert_eq!(contract.company_position, None, "{reducer}");
        }

        let seed = stdb_client::reducer_contract("seed_organization_form_configs")
            .expect("seed_organization_form_configs");
        assert_eq!(seed.exposure, Exposure::Denied);
        assert_eq!(seed.organization_position, Some(0));
        assert_eq!(seed.company_position, None);

        for reducer in [
            "delete_record_custom_field_values",
            "set_record_custom_field_values",
        ] {
            let contract = stdb_client::reducer_contract(reducer).expect(reducer);
            assert_eq!(contract.exposure, Exposure::Session, "{reducer}");
            assert_eq!(contract.organization_position, Some(0), "{reducer}");
            assert_eq!(contract.company_position, Some(1), "{reducer}");
        }
    }

    #[test]
    fn interactive_integration_operations_are_exposed_but_machine_callbacks_are_denied() {
        for reducer in [
            "create_whatsapp_business_account",
            "delete_integration",
            "delete_whatsapp_business_account",
            "set_whatsapp_primary_account",
            "update_whatsapp_business_account",
        ] {
            let contract = stdb_client::reducer_contract(reducer).expect(reducer);
            assert_eq!(contract.exposure, Exposure::Session, "{reducer}");
            assert_eq!(contract.organization_position, Some(0), "{reducer}");
            assert_eq!(contract.company_position, None, "{reducer}");
        }

        let create_drive = stdb_client::reducer_contract("create_google_drive_connection")
            .expect("create_google_drive_connection");
        assert_eq!(create_drive.exposure, Exposure::Session);
        assert_eq!(create_drive.organization_position, Some(0));
        assert_eq!(create_drive.company_position, Some(1));

        let update_drive = stdb_client::reducer_contract("update_google_drive_connection")
            .expect("update_google_drive_connection");
        assert_eq!(update_drive.exposure, Exposure::Session);
        assert_eq!(update_drive.organization_position, Some(1));
        assert_eq!(update_drive.company_position, None);

        let archive = stdb_client::reducer_contract("archive_ai_chat_session")
            .expect("archive_ai_chat_session");
        assert_eq!(archive.exposure, Exposure::Session);
        assert_eq!(archive.organization_position, Some(0));
        assert_eq!(archive.company_position, Some(1));

        assert_eq!(
            stdb_client::company_scope_paths("create_whatsapp_business_account").len(),
            1
        );

        for reducer in [
            "record_google_drive_sync",
            "record_google_drive_sync_error",
            "record_whatsapp_health_check",
            "record_whatsapp_message_sent",
            "update_integration_status",
            "update_whatsapp_verification_status",
        ] {
            let contract = stdb_client::reducer_contract(reducer).expect(reducer);
            assert_eq!(contract.exposure, Exposure::Denied, "{reducer}");
        }
    }

    #[test]
    fn internal_route_authorities_are_narrow_and_non_interchangeable() {
        assert!(InternalRouteAuthority::PasswordRecovery.permits("bind_password_reset_token"));
        assert!(!InternalRouteAuthority::PasswordRecovery.permits("project_user_profile"));
        assert!(InternalRouteAuthority::ProviderWebhook.permits("receive_crm_provider_message"));
        assert!(!InternalRouteAuthority::ProviderWebhook.permits("add_org_member"));
        assert!(InternalRouteAuthority::InvitationAcceptance.permits("bind_user_profile"));
        assert!(!InternalRouteAuthority::InvitationAcceptance.permits("set_billing_status"));
    }

    #[test]
    fn internal_route_scope_rejects_missing_or_foreign_organization() {
        let contract = stdb_client::reducer_contract("record_crm_provider_delivery")
            .expect("provider delivery contract");
        let args = [json!(42), json!({})];
        assert!(validate_internal_organization_scope(contract, &args, Some(42)).is_ok());
        assert!(matches!(
            validate_internal_organization_scope(contract, &args, Some(43)),
            Err(ApiError::Forbidden(_))
        ));
        assert!(matches!(
            validate_internal_organization_scope(contract, &args, None),
            Err(ApiError::Forbidden(_))
        ));
    }

    #[test]
    fn organization_seeded_reference_reducer_is_session_scoped() {
        let contract = stdb_client::reducer_contract("create_country").expect("create_country");
        assert_eq!(contract.exposure, Exposure::Session);
        assert_eq!(contract.organization_position, Some(0));
        assert!(contract.company_position.is_none());
        assert!(contract.unscoped_reason.is_none());
        assert!(validate_reducer_scope(contract, &[json!(7)], 7).is_ok());
        assert!(matches!(
            validate_reducer_scope(contract, &[json!(8)], 7),
            Err(ApiError::Forbidden(_))
        ));
    }

    #[test]
    fn named_command_injects_organization_at_the_contract_position() {
        let contract = stdb_client::reducer_contract("assign_role").expect("assign_role");
        let args = named_command_args(
            contract,
            json!({
                "user_identity": {},
                "role_id": 9,
                "params": {}
            }),
            7,
        )
        .expect("valid named command");

        assert_eq!(args, vec![json!({}), json!(9), json!(7), json!({})]);
    }

    #[test]
    fn reducer_permission_denial_maps_upstream_530_to_forbidden() {
        let error = anyhow::Error::new(StdbClientError::Http(
            "530 <unknown status code>".into(),
            "Permission denied: write on account_move".into(),
        ));
        assert!(matches!(
            map_reducer_error(error),
            ApiError::Forbidden(message) if message == "Permission denied: write on account_move"
        ));
    }

    #[test]
    fn reducer_validation_maps_upstream_530_to_unprocessable() {
        let error = anyhow::Error::new(StdbClientError::Http(
            "530 <unknown status code>".into(),
            "currency_id is required".into(),
        ));
        assert!(matches!(
            map_reducer_error(error),
            ApiError::Unprocessable(message) if message == "currency_id is required"
        ));
    }

    #[test]
    fn named_command_rejects_client_supplied_tenant_and_missing_fields() {
        let contract = stdb_client::reducer_contract("create_lead").expect("create_lead");
        assert!(matches!(
            named_command_args(contract, json!({ "organization_id": 99, "params": {} }), 7,),
            Err(ApiError::Unprocessable(_))
        ));
        assert!(matches!(
            named_command_args(contract, json!({}), 7),
            Err(ApiError::Unprocessable(_))
        ));
    }

    #[test]
    fn named_command_rejects_camel_case_forged_organization_field() {
        let contract = stdb_client::reducer_contract("create_lead").expect("create_lead");
        assert!(matches!(
            named_command_args(
                contract,
                json!({ "organizationId": 99, "params": {} }),
                7,
            ),
            Err(ApiError::Unprocessable(message))
                if message.contains("server-owned fields")
        ));
    }

    #[test]
    fn named_command_accepts_camel_case_without_allowing_alias_duplicates() {
        let contract =
            stdb_client::reducer_contract("confirm_sales_order").expect("confirm_sales_order");
        let args = named_command_args(contract, json!({ "companyId": 9, "orderId": 12 }), 7)
            .expect("camel-case input");
        assert_eq!(args, vec![json!(7), json!(9), json!(12)]);
        assert!(matches!(
            named_command_args(
                contract,
                json!({ "companyId": 9, "company_id": 9, "orderId": 12 }),
                7,
            ),
            Err(ApiError::Unprocessable(_))
        ));
    }

    #[test]
    fn named_command_preserves_sats_options_for_central_contract_normalization() {
        let contract = stdb_client::reducer_contract("create_workflow").expect("create_workflow");
        let args = named_command_args(
            contract,
            json!({
                "companyId": { "some": 42 },
                "params": { "metadata": { "none": [] } }
            }),
            7,
        )
        .expect("valid named command");
        assert_eq!(args[0], json!(7));
        assert_eq!(args[1], json!({ "some": 42 }));
        // Composite fields must retain SATS option encoding for SpacetimeDB.
        assert_eq!(args[2]["metadata"], json!({ "none": [] }));

        let args = named_command_args(
            contract,
            json!({
                "companyId": { "none": [] },
                "params": { "metadata": null }
            }),
            7,
        )
        .expect("nullable named command");
        assert_eq!(args[1], json!({ "none": [] }));
    }
}
