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
    company_ids_equality_or_clause, has_hr_permission, hr_fields_require_read_audit,
    identity_sql_literal, is_hr_pii_resource, purpose_for_hr_resource, resolve_http_sql_columns,
    select_company_scoped_sql, select_field_permissions_for_org_sql, select_org_scoped_sql,
    select_roles_active_sql, select_user_organization_for_identity_sql,
    select_user_profile_by_identity_sql, select_user_role_assignments_for_identity_sql,
    sql_column_list_for_generated_type, FieldAccessContext, FieldPermissionLike,
};
pub use resource_registry::{registry_get, registry_json, registry_keys, ResourceEntry};
