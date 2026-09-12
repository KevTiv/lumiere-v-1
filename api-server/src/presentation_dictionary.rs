//! Server-owned discovery metadata for the first ERP read capability.
//!
//! This module describes the existing authorized resource-query path. It does
//! not add a query executor, subscription path, pagination claim, or policy.

use lumiere_contracts::generated::resources::RESOURCES;
use serde::Serialize;
use stdb_auth::{has_resource_read_permission, resolve_http_sql_columns, FieldAccessContext};
use thiserror::Error;

const RESOURCE: &str = "account-moves";
const CONTRACT_PIN: &str = "v0.3.43";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadCapabilityMetadata {
    pub capability_id: &'static str,
    pub label: &'static str,
    pub semantic_source: &'static str,
    pub resource: &'static str,
    pub table: &'static str,
    pub row_type: &'static str,
    pub scope: &'static str,
    pub acquisition_route: &'static str,
    pub company_scope_input: &'static str,
    pub acquisition_authorization: &'static str,
    pub fields: Vec<String>,
    /// Fields are SQL registry names; generated result DTOs use their own
    /// canonical naming and are not inferred by this dictionary.
    pub field_naming: &'static str,
    pub contract_pin: &'static str,
    pub structural_source: &'static str,
    pub policy_source: &'static str,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum DictionaryError {
    #[error("read permission denied for account-moves")]
    PermissionDenied,
    #[error("invalid account-moves capability contract: {0}")]
    InvalidContract(String),
}

/// Build the capability dictionary entry visible to an already-authenticated actor.
pub(crate) fn account_moves_capability(
    field_access: Option<&FieldAccessContext>,
) -> Result<ReadCapabilityMetadata, DictionaryError> {
    if !has_resource_read_permission(field_access, RESOURCE) {
        return Err(DictionaryError::PermissionDenied);
    }
    let descriptor = RESOURCES
        .iter()
        .find(|descriptor| descriptor.name == RESOURCE)
        .ok_or_else(|| {
            DictionaryError::InvalidContract(
                "account-moves descriptor is absent from the pinned contract".to_string(),
            )
        })?;
    let fields = resolve_http_sql_columns(RESOURCE, field_access)
        .map_err(DictionaryError::InvalidContract)?;
    Ok(ReadCapabilityMetadata {
        capability_id: "erp.read.account-moves",
        label: "Accounting entries",
        semantic_source: "api-server/src/presentation_dictionary.rs",
        resource: descriptor.name,
        table: descriptor.table,
        row_type: descriptor.row_type_reference,
        scope: descriptor.scope_kind,
        acquisition_route: "/v1/query/account-moves",
        company_scope_input: "companyId",
        acquisition_authorization: "reauthorize-on-read",
        fields,
        field_naming: "sql-column",
        contract_pin: CONTRACT_PIN,
        structural_source: "lumiere-contracts:generated/resources.rs",
        policy_source: "stdb-auth:assets/resource_registry.json",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn access(fields: Vec<&str>) -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 7,
            role_id: 9,
            role_name: "reader".into(),
            is_superuser: false,
            role_permissions: vec!["account-moves:read".into()],
            identity_hex: "01".into(),
            field_permissions: if fields.is_empty() {
                vec![]
            } else {
                vec![stdb_auth::FieldPermissionLike {
                    id: None,
                    organization_id: Some(7),
                    role_id: Some(9),
                    resource: RESOURCE.into(),
                    action: "read".into(),
                    allowed_fields: fields.into_iter().map(str::to_string).collect(),
                    subject_user_hex: None,
                    subject_role_id: Some(9),
                }]
            },
        }
    }

    #[test]
    fn denies_without_actor_permission() {
        assert!(account_moves_capability(None).is_err());
        let mut actor = access(vec![]);
        actor.role_permissions.clear();
        assert!(account_moves_capability(Some(&actor)).is_err());
    }

    #[test]
    fn returns_pinned_provenance_and_registry_projection() {
        let actor = access(vec![]);
        let capability = account_moves_capability(Some(&actor)).expect("authorized capability");
        assert_eq!(capability.capability_id, "erp.read.account-moves");
        assert_eq!(capability.label, "Accounting entries");
        assert_eq!(
            capability.semantic_source,
            "api-server/src/presentation_dictionary.rs"
        );
        assert_eq!(capability.table, "account_move");
        assert_eq!(capability.row_type, "AccountMove");
        assert_eq!(capability.scope, "organization_company");
        assert_eq!(capability.acquisition_route, "/v1/query/account-moves");
        assert_eq!(capability.company_scope_input, "companyId");
        assert_eq!(capability.acquisition_authorization, "reauthorize-on-read");
        assert_eq!(capability.contract_pin, "v0.3.43");
        assert_eq!(capability.field_naming, "sql-column");
        assert!(capability.fields.contains(&"id".into()));
        assert!(capability.fields.contains(&"organization_id".into()));
        assert!(capability.fields.contains(&"company_id".into()));
    }

    #[test]
    fn narrows_fields_to_actor_field_permission_and_keeps_mandatory_columns() {
        let actor = access(vec!["name"]);
        let capability = account_moves_capability(Some(&actor)).expect("authorized capability");
        assert_eq!(
            capability.fields,
            vec!["id", "organization_id", "name", "company_id"]
        );
    }

    #[test]
    fn contract_pin_matches_api_dependency_pin() {
        let cargo = include_str!("../Cargo.toml");
        assert!(
            cargo.contains("lumiere-contracts = { workspace = true, features = [\"bindings\"] }")
        );
        let workspace = include_str!("../../Cargo.toml");
        assert!(workspace.contains("lumiere-contracts = { git = \"ssh://git@github.com/KevTiv/lumiere-contracts.git\", tag = \"v0.3.43\""));
    }
}
