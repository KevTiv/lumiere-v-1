//! Add-only enrollment of the platform's already registered AI runtime writer.
//! No human profile, superuser status, ERP write grants or secrets are copied.
use crate::core::cold_tier_identity::{cold_tier_service_identity, ColdTierServiceIdentity};
use crate::core::permissions::{
    field_permission, org_permission, role, user_role_assignment, PermissionSubject, Role,
};
use crate::core::users::{
    ensure_user_profile_for_organization, user_organization, user_profile, UserOrganization,
};
use crate::helpers::{write_audit_log_v2, AuditLogParams};
use spacetimedb::{Identity, ReducerContext, Table};

pub(crate) const WRITER_SERVICE: &str = "ai_spend_writer";
const WRITER_PERMISSIONS: &[&str] = &[
    "ai_spend:reserve",
    "ai_spend:settle",
    "ai_agent_run:create",
    "ai_agent_run:read",
    "ai_agent_run:write",
    "ai_intelligence_event:create",
    "ai_intelligence_event:write",
    "ai_work_program:write",
    "ai_evidence_source:create",
    "ai_evidence_source:update",
    "ai_evidence_passage:create",
    "ai_evidence_passage:update",
    "ai_evidence_contribution:create",
    "ai_evidence_claim:create",
    "ai_evidence_claim:update",
    "ai_evidence_decision:create",
    "ai_evidence_decision:update",
    "ai_artifact_component:create",
    "ai_artifact_component:update",
    "ai_workflow_provenance:create",
    "ai_capability_execution:write",
];

/// Return one distinct active identity from the platform-owned registry.
/// A tenant caller cannot select the identity or substitute their own account.
pub(crate) fn platform_service_identity(
    ctx: &ReducerContext,
    name: &str,
) -> Result<Identity, String> {
    let mut identities = Vec::new();
    for row in ctx
        .db
        .cold_tier_service_identity()
        .iter()
        .filter(|row| row.is_active && row.service_name == name)
    {
        if !identities.contains(&row.identity) {
            identities.push(row.identity);
        }
    }
    match identities.as_slice() {
        [identity] => Ok(*identity),
        _ => Err(format!(
            "configure exactly one platform {name} identity before publishing a template"
        )),
    }
}

/// Prior membership/profile/binding history is authoritative, even if inactive.
/// Never repair revoked service access through a routine enrollment retry.
pub(crate) fn can_enroll_writer(
    ctx: &ReducerContext,
    org: u64,
    writer: Identity,
    template: u64,
) -> bool {
    if ctx.db.user_role_assignment().role_assign_by_user().filter(&writer).any(|row| row.organization_id == org)
        || ctx.db.org_permission().perm_by_org().filter(&org).any(|row| matches!(row.subject, PermissionSubject::User(identity) if identity == writer))
        || ctx.db.field_permission().field_perm_by_org().filter(&org).any(|row| matches!(row.subject, PermissionSubject::User(identity) if identity == writer)) {
        return false;
    }
    !ctx.db
        .user_organization()
        .user_org_by_user()
        .filter(&writer)
        .any(|row| row.organization_id == org)
        && ctx
            .db
            .user_profile()
            .user_profile_by_identity_organization()
            .filter((&writer, &org))
            .next()
            .is_none()
        && ctx
            .db
            .cold_tier_service_identity()
            .cold_tier_service_identity_by_name()
            .filter((&org, &WRITER_SERVICE.to_string()))
            .next()
            .is_none()
        && !ctx
            .db
            .role()
            .role_by_org()
            .filter(&org)
            .any(|row| row.name == format!("Platform AI runtime {template}"))
}

pub(crate) fn enroll_writer(
    ctx: &ReducerContext,
    org: u64,
    writer: Identity,
    template: u64,
    approved_by: Identity,
) -> Result<(), String> {
    if !can_enroll_writer(ctx, org, writer, template) {
        return Err("existing AI writer access must be preserved".into());
    }
    let metadata = Some(
        serde_json::json!({"platformAiTemplateId":template,"service":WRITER_SERVICE}).to_string(),
    );
    let role = ctx.db.role().insert(Role {
        id: 0,
        organization_id: org,
        name: format!("Platform AI runtime {template}"),
        description: Some(
            "AI trace and spend execution only; no business mutation or funding authority".into(),
        ),
        parent_id: None,
        permissions: WRITER_PERMISSIONS.iter().map(|p| (*p).into()).collect(),
        is_system: true,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: metadata.clone(),
    });
    let membership = ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity: writer,
        organization_id: org,
        company_id: None,
        role_id: role.id,
        department_id: None,
        job_title: None,
        employee_id: None,
        date_joined: ctx.timestamp,
        is_active: true,
        is_default: false,
        metadata: metadata.clone(),
    });
    ensure_user_profile_for_organization(ctx, writer, org);
    ctx.db
        .cold_tier_service_identity()
        .insert(ColdTierServiceIdentity {
            platform_id: format!("tenant-enrollment-ai_spend_writer-{org}"),
            organization_id: org,
            service_name: WRITER_SERVICE.into(),
            identity: writer,
            is_active: true,
            registered_by: approved_by,
            registered_at: ctx.timestamp,
            retired_at: None,
        });
    for (table, id) in [("role", role.id), ("user_organization", membership.id)] {
        write_audit_log_v2(
            ctx,
            org,
            AuditLogParams {
                company_id: None,
                table_name: table,
                record_id: id,
                action: "CREATE",
                old_values: None,
                new_values: None,
                changed_fields: vec!["platform_ai_runtime".into()],
                metadata: metadata.clone(),
            },
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runtime_role_has_no_funding_permission_management_or_business_mutations() {
        assert!(WRITER_PERMISSIONS.contains(&"ai_spend:reserve"));
        assert!(WRITER_PERMISSIONS.contains(&"ai_spend:settle"));
        for permission in WRITER_PERMISSIONS {
            assert!(!permission.contains('*'));
            assert!(permission.starts_with("ai_"));
            assert!(!permission.starts_with("ai_agent:"));
            assert!(!permission.contains("configure") && !permission.contains("reconcile"));
            assert!(!permission.contains("permission") && !permission.contains("skill"));
        }
    }
}
