//! Bounded owner-token read of the private replenishment schedule.
//! Permission and scope come from the current trusted actor, never the owner client.

use crate::error::ApiError;
use crate::query_exec::resolve_inventory_company_id;
use crate::trusted_context::TrustedOperationContext;
use serde_json::Value;
use stdb_auth::{
    has_resource_read_permission, select_org_and_company_scoped_sql, FieldAccessContext,
};
use stdb_client::StdbClient;

fn require_permission(access: &FieldAccessContext) -> Result<(), ApiError> {
    if has_resource_read_permission(Some(access), "replenishment-rules") {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "Read permission denied for resource 'replenishment-run-jobs'".into(),
        ))
    }
}

fn scoped_sql(
    organization_id: u64,
    company_id: u64,
    access: &FieldAccessContext,
) -> Result<String, ApiError> {
    require_permission(access)?;
    if access.organization_id != organization_id {
        return Err(ApiError::Forbidden(
            "Cannot query another organization's data".into(),
        ));
    }
    // The registered projection owns field policy (including scheduled_at).
    // StdbClient's normal SQL serializer owns the response shape.
    select_org_and_company_scoped_sql(
        "replenishment-run-jobs",
        "replenishment_run_job",
        organization_id,
        company_id,
        Some(access),
        "",
        "",
    )
    .map_err(ApiError::Internal)
}

pub(super) async fn read(
    owner_client: &StdbClient,
    context: TrustedOperationContext,
    requested_company_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    require_permission(context.field_access())?;
    let company_id = resolve_inventory_company_id(
        context.client(),
        context.organization_id(),
        context.actor_identity(),
        requested_company_id,
    )
    .await?;
    let scoped = context.with_company_scope(vec![company_id])?;
    scoped.require_company_scope(&[company_id])?;
    let sql = scoped_sql(scoped.organization_id(), company_id, scoped.field_access())?;
    owner_client.query_sql(&sql).await.map_err(ApiError::internal)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn access(permissions: &[&str]) -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 42,
            role_id: 1,
            role_name: "warehouse".into(),
            is_superuser: false,
            role_permissions: permissions.iter().map(|p| (*p).into()).collect(),
            identity_hex: "01".repeat(32),
            field_permissions: vec![],
        }
    }

    #[test]
    fn current_replenishment_permission_is_required() {
        for permissions in [
            vec![],
            vec!["organization:read"],
            vec!["replenishment_rule:write"],
            vec!["replenishment_run_job:read"],
        ] {
            assert!(require_permission(&access(&permissions)).is_err());
        }
        for grant in ["replenishment_rule:read", "replenishment_rule:*", "*:*"] {
            assert!(require_permission(&access(&[grant])).is_ok());
        }
    }

    #[test]
    fn registered_projection_is_bounded_by_both_scope_predicates() {
        let sql = scoped_sql(42, 198, &access(&["replenishment_rule:*"])).unwrap();
        assert_eq!(
            sql,
            "SELECT scheduled_id, organization_id, scheduled_at, company_id, rule_id FROM replenishment_run_job WHERE organization_id = 42 AND company_id = 198"
        );
        assert!(!sql.contains("SELECT *"));
    }

    #[test]
    fn foreign_company_intent_is_denied() {
        assert!(crate::query_exec::enforce_requested_company(
            198,
            Some(199),
            "Cannot query another company's inventory data",
        )
        .is_err());
    }

    #[test]
    fn foreign_organization_is_denied() {
        assert!(scoped_sql(43, 198, &access(&["replenishment_rule:*"])).is_err());
    }

    #[test]
    fn registered_field_policy_controls_the_response_projection() {
        let mut actor = access(&["replenishment_rule:*"]);
        actor.field_permissions.push(
            serde_json::from_value(serde_json::json!({
                "organizationId": 42,
                "roleId": 1,
                "resource": "replenishment-run-jobs",
                "action": "read",
                "allowedFields": ["rule_id"]
            }))
            .unwrap(),
        );
        let sql = scoped_sql(42, 198, &actor).unwrap();
        assert!(
            sql.starts_with("SELECT scheduled_id, organization_id, rule_id, company_id FROM "),
            "{sql}"
        );
        assert!(!sql.contains("scheduled_at"));
        assert!(sql.ends_with("WHERE organization_id = 42 AND company_id = 198"));
    }
}
