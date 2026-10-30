//! Field-level RBAC and SQL builders for HTTP SQL.

mod erp_subscriptions;
mod field_policy;
mod resource_registry;

pub use erp_subscriptions::{
    auth_subscriptions, create_client_subscriptions, erp_org_extra_where,
    full_client_subscription_resources_vec, subscription_queries_for_resource,
    subscription_resource_keys_vec, SubscriptionQueryContext,
};
pub use field_policy::{
    apply_hr_field_policy, assert_safe_sql_identifiers, company_ids_dual_field_or_clause,
    company_ids_equality_or_clause, has_hr_permission, has_resource_field_read_permission,
    has_resource_read_permission, hr_fields_require_read_audit, identity_sql_literal,
    is_hr_pii_resource, permission_allowed, purpose_for_hr_resource, resolve_http_sql_columns,
    resource_read_denied, select_company_scoped_sql, select_field_permissions_for_org_sql,
    select_org_and_company_scoped_sql, select_org_scoped_sql, select_roles_active_sql,
    select_user_organization_for_identity_sql, select_user_profile_by_identity_sql,
    select_user_profile_for_organization_sql, select_user_role_assignments_for_identity_sql,
    session_read_resource, sql_column_list_for_generated_type, ActionPermission,
    FieldAccessContext, FieldPermissionLike,
};
pub use resource_registry::{registry_get, registry_json, registry_keys, ResourceEntry};

/// Apply the server-owned bootstrap lease to a SpacetimeDB SQL profile row.
/// The trusted authority query must select metadata, including SATS Option values.
pub fn profile_bootstrap_lease_active(profile: &serde_json::Value, now_micros: i64) -> bool {
    use serde_json::Value;
    fn metadata(value: &Value) -> Result<Option<&str>, ()> {
        match value {
            Value::Null => Ok(None),
            Value::String(text) => Ok(Some(text)),
            Value::Object(fields) if fields.contains_key("some") => metadata(&fields["some"]),
            Value::Object(fields) if fields.contains_key("none") => Ok(None),
            Value::Array(fields) if fields.len() == 2 && fields[0] == 0 => metadata(&fields[1]),
            Value::Array(fields) if fields.len() == 2 && fields[0] == 1 => Ok(None),
            _ => Err(()),
        }
    }
    let value = profile.get("metadata").unwrap_or(&Value::Null);
    metadata(value).is_ok_and(|metadata| {
        lumiere_policy_core::platform_bootstrap_lease_active(metadata, now_micros)
    })
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
}
