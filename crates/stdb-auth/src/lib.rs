//! Field-level RBAC and SQL builders for HTTP SQL.

mod erp_subscriptions;
mod field_policy;
mod resource_registry;

pub use lumiere_policy_core::additional_tenant::AdditionalTenantApproval;
pub use lumiere_policy_core::expense_allocations::{
    allocation_snapshot_bytes, AllocationSnapshotRow,
};

pub use erp_subscriptions::{
    auth_subscriptions, create_client_subscriptions, erp_org_extra_where,
    full_client_subscription_resources_vec, subscription_queries_for_resource,
    subscription_resource_keys_vec, SubscriptionQueryContext,
};
pub use field_policy::{
    apply_hr_field_policy, assert_safe_sql_identifiers, company_ids_dual_field_or_clause,
    company_ids_equality_or_clause, has_hr_permission, has_resource_field_projection_permission,
    has_resource_field_read_permission, has_resource_read_permission, hr_fields_require_read_audit,
    identity_sql_literal, is_hr_pii_resource, permission_allowed, purpose_for_hr_resource,
    resolve_http_sql_columns, resource_read_denied, select_company_scoped_sql,
    select_field_permissions_for_org_sql, select_org_and_company_scoped_sql, select_org_scoped_sql,
    select_roles_active_sql, select_user_organization_for_identity_sql,
    select_user_profile_by_identity_sql, select_user_profile_for_organization_sql,
    select_user_role_assignments_for_identity_sql, session_read_resource,
    sql_column_list_for_generated_type, ActionPermission, FieldAccessContext, FieldPermissionLike,
};
pub use resource_registry::{registry_get, registry_json, registry_keys, ResourceEntry};

/// Apply the server-owned bootstrap lease to a SpacetimeDB SQL profile row.
/// The trusted authority query must select metadata, including SATS Option values.
pub fn profile_bootstrap_lease_active(profile: &serde_json::Value, now_micros: i64) -> bool {
    profile_metadata(profile.get("metadata").unwrap_or(&serde_json::Value::Null)).is_ok_and(
        |metadata| lumiere_policy_core::platform_bootstrap_lease_active(metadata, now_micros),
    )
}

fn profile_metadata(value: &serde_json::Value) -> Result<Option<&str>, ()> {
    use serde_json::Value;
    match value {
        Value::Null => Ok(None),
        Value::String(text) => Ok(Some(text)),
        Value::Object(fields) if fields.contains_key("some") => profile_metadata(&fields["some"]),
        Value::Object(fields) if fields.contains_key("none") => Ok(None),
        Value::Array(fields) if fields.len() == 2 && fields[0] == 0 => profile_metadata(&fields[1]),
        Value::Array(fields) if fields.len() == 2 && fields[0] == 1 => Ok(None),
        _ => Err(()),
    }
}

/// A persistent non-human operator is never an interactive session principal.
/// Canonical PG flags are projection data for this account, not an independent
/// grant: stale flags cannot restore API authority after native revocation.
pub fn profile_metadata_allows_interactive_session(
    metadata: Option<&str>,
    now_micros: i64,
) -> bool {
    if !lumiere_policy_core::platform_bootstrap_lease_active(metadata, now_micros) {
        return false;
    }
    !metadata.is_some_and(metadata_marks_noninteractive_operator)
}

fn metadata_marks_noninteractive_operator(raw: &str) -> bool {
    use lumiere_policy_core::PERSISTENT_PLATFORM_OPERATOR_METADATA_PREFIX as PREFIX;
    use serde_json::Value;
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(fields)) => fields.keys().any(|key| key.starts_with(PREFIX)),
        // Deny malformed/unknown reserved states, including JSON string storage.
        _ => raw.contains(PREFIX),
    }
}

/// Check account class before constructing a session, even without membership.
pub fn profile_is_noninteractive_operator(profile: &serde_json::Value) -> bool {
    let Ok(metadata) =
        profile_metadata(profile.get("metadata").unwrap_or(&serde_json::Value::Null))
    else {
        return true;
    };
    let Some(raw) = metadata else {
        return false;
    };
    metadata_marks_noninteractive_operator(raw)
}

/// Apply the same interactive boundary to every supported native SQL wire shape.
pub fn profile_allows_interactive_session(profile: &serde_json::Value, now_micros: i64) -> bool {
    profile_metadata(profile.get("metadata").unwrap_or(&serde_json::Value::Null))
        .is_ok_and(|metadata| profile_metadata_allows_interactive_session(metadata, now_micros))
}

pub use lumiere_policy_core::platform_bootstrap_lease_active;

#[cfg(test)]
mod bootstrap_lease_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn expired_bootstrap_profile_is_rejected_in_every_supported_wire_shape() {
        let lease = "lumiere-platform-bootstrap-v1:1:10";
        for value in [json!(lease), json!({"some":lease}), json!([0, lease])] {
            let profile = json!({"metadata":value});
            assert!(profile_bootstrap_lease_active(&profile, 1));
            assert!(!profile_bootstrap_lease_active(&profile, 10));
        }
        assert!(!profile_bootstrap_lease_active(
            &json!({"metadata":[0,42]}),
            1
        ));
        assert!(profile_bootstrap_lease_active(&json!({"metadata":null}), 1));
    }

    #[test]
    fn persistent_operator_projection_never_authorizes_an_interactive_session() {
        let raw = json!({"persistent_platform_operator_v1":{"approvalRef":"approved"}}).to_string();
        // Native operator authorization keeps the original lease semantics.
        assert!(platform_bootstrap_lease_active(Some(&raw), 10));
        for value in [json!(raw), json!({"some":raw}), json!([0, raw])] {
            assert!(profile_is_noninteractive_operator(
                &json!({"metadata":value})
            ));
            assert!(!profile_allows_interactive_session(
                &json!({"metadata":value}),
                10
            ));
        }
        for raw in [
            r#"{"persistent_platform_operator_v1":null}"#,
            r#"{"persistent_platform_operator_v2":{}}"#,
            r#"{"persistent_platform_operator_v1":"#,
            r#""persistent_platform_operator_v1""#,
        ] {
            assert!(!profile_metadata_allows_interactive_session(Some(raw), 10));
        }
        assert!(profile_metadata_allows_interactive_session(
            Some(r#"{"notes":"persistent_platform_operator_v1 is reserved"}"#),
            10,
        ));
        assert!(profile_allows_interactive_session(
            &json!({"metadata":null}),
            10
        ));
        assert!(profile_allows_interactive_session(
            &json!({"metadata":{"some":"lumiere-platform-bootstrap-v1:1:20"}}),
            10,
        ));
        assert!(!profile_allows_interactive_session(
            &json!({"metadata":{"some":"lumiere-platform-bootstrap-v1:1:20"}}),
            20,
        ));
    }
}
