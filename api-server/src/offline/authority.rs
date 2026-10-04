use super::{core::Scope, FIELDS, RESOURCE, SCHEMA_HASH};
use crate::{
    error::ApiError, query_exec::resolve_membership_company_id, session::ApiSession,
    state::AppState, trusted_context::TrustedOperationContext,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use stdb_auth::{has_resource_read_permission, resolve_http_sql_columns, FieldAccessContext};

pub fn require_fields(access: &FieldAccessContext) -> Result<(), ApiError> {
    if !has_resource_read_permission(Some(access), RESOURCE) {
        return Err(ApiError::Forbidden("Offline category read denied".into()));
    }
    if access.is_superuser
        || access
            .role_permissions
            .iter()
            .any(|permission| permission == "*:*")
    {
        return Ok(());
    }
    let columns = resolve_http_sql_columns(RESOURCE, Some(access)).map_err(ApiError::Internal)?;
    if FIELDS
        .iter()
        .any(|field| !columns.iter().any(|column| column == field))
    {
        return Err(ApiError::Forbidden(
            "Offline projection requires permission for every selected field".into(),
        ));
    }
    Ok(())
}

fn hash(value: &serde_json::Value) -> String {
    format!(
        "sha256:{}",
        hex::encode(Sha256::digest(value.to_string().as_bytes()))
    )
}

pub fn version(access: &FieldAccessContext, company: u64, environment: &str) -> String {
    let mut permissions = access.role_permissions.clone();
    permissions.sort();
    permissions.dedup();
    let mut fields = access
        .field_permissions
        .iter()
        .map(|rule| {
            let mut rule = rule.clone();
            rule.allowed_fields.sort();
            rule.allowed_fields.dedup();
            serde_json::to_value(rule)
                .expect("field permissions are serializable")
                .to_string()
        })
        .collect::<Vec<_>>();
    fields.sort();
    fields.dedup();
    hash(
        &json!({"protocol": "offline-categories-whole-commit-v1", "schema": SCHEMA_HASH, "environment": environment, "actor": access.identity_hex, "organization": access.organization_id.to_string(), "company": company.to_string(), "role": access.role_id.to_string(), "superuser": access.is_superuser, "permissions": permissions, "fields": fields}),
    )
}

pub async fn resolve(
    state: &AppState,
    session: &ApiSession,
    requested_company: Option<u64>,
) -> Result<Scope, ApiError> {
    if state
        .config
        .stdb_server_token
        .as_deref()
        .is_none_or(str::is_empty)
    {
        return Err(ApiError::Unavailable(
            "Offline source requires configured server authority".into(),
        ));
    }
    let context = TrustedOperationContext::for_resource_read(state, session)?;
    context.require_current_placement(&state.organization_placements)?;
    require_fields(context.field_access())?;
    let company = resolve_membership_company_id(
        &state.stdb,
        context.organization_id(),
        context.actor_identity(),
        requested_company,
        "Offline projection company denied",
    )
    .await?;
    let organization = context.organization_id();
    let fences = state.stdb.query_sql(&format!("SELECT organization_id, run_id, state FROM organization_reconstruction_fence WHERE organization_id = {organization}")).await.map_err(ApiError::internal)?;
    let reconstruction = match fences.as_slice() {
        [] => "initial",
        [fence]
            if super::rows::number(&fence["organizationId"])
                .map_err(|error| ApiError::Internal(error.to_string()))?
                == organization
                && fence["state"] == "complete" =>
        {
            fence["runId"]
                .as_str()
                .ok_or_else(|| ApiError::Internal("Invalid reconstruction epoch".into()))?
        }
        [_] => {
            return Err(ApiError::Conflict(
                "Offline reads fenced for reconstruction".into(),
            ))
        }
        _ => return Err(ApiError::Internal("Duplicate reconstruction epoch".into())),
    };
    let environment = hash(&json!([
        state.stdb.base_url(),
        state.stdb.module(),
        context.placement_generation()?.get().to_string(),
        reconstruction
    ]));
    let scope = Scope {
        environment_id: environment.clone(),
        actor_id: context.actor_identity().to_owned(),
        organization_id: context.organization_id().to_string(),
        company_id: Some(company.to_string()),
        authorization_version: version(context.field_access(), company, &environment),
    };
    context.require_current_placement(&state.organization_placements)?;
    Ok(scope)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn access() -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 7,
            role_id: 1,
            role_name: "inventory".into(),
            is_superuser: false,
            identity_hex: "ab".repeat(32),
            role_permissions: vec!["product_category:read".into()],
            field_permissions: vec![],
        }
    }
    #[test]
    fn missing_resource_or_selected_field_grant_denies() {
        let mut access = access();
        assert!(require_fields(&access).is_err());
        access.role_permissions.clear();
        assert!(require_fields(&access).is_err());
    }
    #[test]
    fn exact_selected_field_grant_is_admitted() {
        let mut access = access();
        access
            .field_permissions
            .push(stdb_auth::FieldPermissionLike {
                id: None,
                organization_id: Some(7),
                role_id: Some(1),
                resource: RESOURCE.into(),
                action: "read".into(),
                allowed_fields: FIELDS.iter().map(|field| field.to_string()).collect(),
                subject_user_hex: None,
                subject_role_id: Some(1),
            });
        require_fields(&access).unwrap();
        access.field_permissions[0]
            .allowed_fields
            .retain(|field| field != "name");
        assert!(require_fields(&access).is_err());
    }
    #[test]
    fn fingerprints_are_order_independent_and_change_with_policy_or_scope() {
        let mut access = access();
        access.role_permissions.push("other:read".into());
        let original = version(&access, 9, "env");
        access.role_permissions.reverse();
        assert_eq!(original, version(&access, 9, "env"));
        assert_ne!(original, version(&access, 8, "env"));
        assert_ne!(original, version(&access, 9, "other-env"));
        access.role_permissions.clear();
        assert_ne!(original, version(&access, 9, "env"));
    }
}
