//! Transactional membership access changes and invitation completion.
use crate::core::audit::audit_log;
use crate::core::permissions::{
    effective_roles, ensure_delegated_admin_may_assign_role, role, touch_policy_snapshot_for_user,
    user_role_assignment, validate_sod_for_effective_roles, Role, UserRoleAssignment,
};
use crate::core::users::{find_user_profile_for_organization, user_organization, UserOrganization};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table};

/// Optimistic access precondition plus the complete desired role set.
#[derive(SpacetimeType, Clone, Debug)]
pub struct SetMemberAccessParams {
    pub primary_role_id: u64,
    pub additional_role_ids: Vec<u64>,
    pub expected_primary_role_id: u64,
    pub expected_role_ids: Vec<u64>,
    pub expected_is_active: bool,
    /// Last audit revision for this membership and its role assignments.
    pub expected_access_revision: u64,
    pub is_active: bool,
    /// None preserves the existing job title; an empty string clears it.
    pub job_title: Option<String>,
}

pub(crate) fn member_is_admin(
    ctx: &ReducerContext,
    org: u64,
    identity: Identity,
    roles: &[Role],
) -> bool {
    let Some(profile) =
        find_user_profile_for_organization(ctx, identity, org).filter(|p| p.is_active)
    else {
        return false;
    };
    !roles.is_empty()
        && [
            ("role", "write"),
            ("user_organization", "write"),
            ("user_role_assignment", "create"),
            ("user_role_assignment", "delete"),
        ]
        .iter()
        .all(|(resource, action)| {
            crate::helpers::roles_allow_permission(
                ctx,
                org,
                identity,
                roles,
                profile.is_superuser,
                resource,
                action,
            )
        })
}

/// Audit IDs are monotonic even when several access changes share a timestamp.
/// Include inactive assignments so grant/revoke cycles cannot reuse an old version.
pub(crate) fn member_access_revision(ctx: &ReducerContext, membership: &UserOrganization) -> u64 {
    let assignment_ids: std::collections::HashSet<_> = ctx
        .db
        .user_role_assignment()
        .role_assign_by_user()
        .filter(&membership.user_identity)
        .filter(|a| a.organization_id == membership.organization_id)
        .map(|a| a.id)
        .collect();
    ctx.db
        .audit_log()
        .audit_by_org()
        .filter(&membership.organization_id)
        .filter(|a| {
            (a.table_name == "user_organization" && a.record_id == membership.id)
                || (a.table_name == "user_role_assignment" && assignment_ids.contains(&a.record_id))
        })
        .map(|a| a.id)
        .max()
        .unwrap_or(0)
}

pub(crate) fn current_access_params(
    ctx: &ReducerContext,
    membership: &UserOrganization,
) -> SetMemberAccessParams {
    let mut ids: Vec<_> = ctx
        .db
        .user_role_assignment()
        .role_assign_by_user()
        .filter(&membership.user_identity)
        .filter(|a| {
            a.organization_id == membership.organization_id
                && a.is_active
                && a.expires_at.is_none_or(|e| e > ctx.timestamp)
        })
        .map(|a| a.role_id)
        .chain([membership.role_id])
        .collect();
    ids.sort_unstable();
    ids.dedup();
    SetMemberAccessParams {
        primary_role_id: membership.role_id,
        additional_role_ids: ids
            .iter()
            .copied()
            .filter(|id| *id != membership.role_id)
            .collect(),
        expected_primary_role_id: membership.role_id,
        expected_role_ids: ids,
        expected_is_active: membership.is_active,
        expected_access_revision: member_access_revision(ctx, membership),
        is_active: membership.is_active,
        job_title: None,
    }
}

pub(crate) fn ensure_another_admin(
    ctx: &ReducerContext,
    org: u64,
    excluded: Identity,
) -> Result<(), String> {
    if ctx.db.user_organization().iter().any(|m| {
        m.organization_id == org
            && m.is_active
            && m.user_identity != excluded
            && find_user_profile_for_organization(ctx, m.user_identity, org)
                .is_some_and(|p| p.is_active)
            && effective_roles(ctx, org, m.user_identity)
                .is_ok_and(|roles| member_is_admin(ctx, org, m.user_identity, &roles))
    }) {
        Ok(())
    } else {
        Err("Cannot remove or demote the last organization administrator".into())
    }
}

/// All role additions/removals and membership fields commit together.
#[spacetimedb::reducer]
pub fn set_member_access(
    ctx: &ReducerContext,
    organization_id: u64,
    user_identity: Identity,
    params: SetMemberAccessParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "user_organization", "write")?;
    let memberships: Vec<_> = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&user_identity)
        .filter(|m| m.organization_id == organization_id)
        .collect();
    let [membership] = memberships.as_slice() else {
        return Err("Exactly one membership is required".into());
    };
    if crate::core::permissions::caller_delegated_company_scope(ctx, organization_id)
        .is_some_and(|company| membership.company_id != Some(company))
    {
        return Err("Member is outside the delegated company scope".into());
    }
    if params.is_active
        && !find_user_profile_for_organization(ctx, user_identity, organization_id)
            .is_some_and(|p| p.is_active)
    {
        return Err("User account is inactive".into());
    }
    let assignments: Vec<_> = ctx
        .db
        .user_role_assignment()
        .role_assign_by_user()
        .filter(&user_identity)
        .filter(|a| {
            a.organization_id == organization_id
                && a.is_active
                && a.expires_at.is_none_or(|e| e > ctx.timestamp)
        })
        .collect();
    let mut current_ids: Vec<_> = assignments
        .iter()
        .map(|a| a.role_id)
        .chain([membership.role_id])
        .collect();
    current_ids.sort_unstable();
    current_ids.dedup();
    let mut expected = params.expected_role_ids.clone();
    expected.sort_unstable();
    expected.dedup();
    let mut desired_ids = params.additional_role_ids.clone();
    desired_ids.push(params.primary_role_id);
    desired_ids.sort_unstable();
    desired_ids.dedup();
    if member_access_revision(ctx, membership) != params.expected_access_revision
        || membership.role_id != params.expected_primary_role_id
        || current_ids != expected
        || membership.is_active != params.expected_is_active
    {
        // A retry of the exact committed operation succeeds without restoring revoked access.
        if membership.role_id == params.primary_role_id
            && current_ids == desired_ids
            && membership.is_active == params.is_active
            && params
                .job_title
                .as_ref()
                .is_none_or(|title| membership.job_title.as_deref().unwrap_or("") == title.trim())
        {
            return Ok(());
        }
        return Err("Member access changed; reload before saving".into());
    }
    if desired_ids.len() > 32 {
        return Err("At most 32 roles may be assigned".into());
    }
    let mut desired_roles = Vec::new();
    for id in &desired_ids {
        let selected = ctx
            .db
            .role()
            .id()
            .find(*id)
            .filter(|r| r.organization_id == organization_id && r.is_active)
            .ok_or("Role is inactive or outside the organization")?;
        ensure_delegated_admin_may_assign_role(ctx, organization_id, &selected)?;
        desired_roles.push(selected);
    }
    validate_sod_for_effective_roles(ctx, organization_id, user_identity, &desired_roles)?;
    if desired_ids.iter().any(|id| !current_ids.contains(id))
        || membership.role_id != params.primary_role_id
    {
        check_permission(ctx, organization_id, "user_role_assignment", "create")?;
    }
    if current_ids.iter().any(|id| !desired_ids.contains(id)) {
        check_permission(ctx, organization_id, "user_role_assignment", "delete")?;
    }
    let old_roles: Vec<_> = current_ids
        .iter()
        .filter_map(|id| ctx.db.role().id().find(*id))
        .collect();
    if membership.is_active
        && member_is_admin(ctx, organization_id, user_identity, &old_roles)
        && (!params.is_active
            || !member_is_admin(ctx, organization_id, user_identity, &desired_roles))
    {
        ensure_another_admin(ctx, organization_id, user_identity)?;
    }
    crate::core::users::enforce_alpha_membership_capacity(
        ctx,
        organization_id,
        membership.is_active,
        params.is_active,
    )?;
    for assignment in &assignments {
        if !desired_ids.contains(&assignment.role_id) {
            ctx.db
                .user_role_assignment()
                .id()
                .update(UserRoleAssignment {
                    is_active: false,
                    ..assignment.clone()
                });
        }
    }
    for id in &desired_ids {
        if *id != params.primary_role_id && !assignments.iter().any(|a| a.role_id == *id) {
            ctx.db.user_role_assignment().insert(UserRoleAssignment {
                id: 0,
                user_identity,
                role_id: *id,
                organization_id,
                assigned_by: ctx.sender(),
                assigned_at: ctx.timestamp,
                expires_at: None,
                is_active: true,
                metadata: None,
            });
        }
    }
    let job_title = params
        .job_title
        .map(|title| title.trim().to_string())
        .map(|title| if title.is_empty() { None } else { Some(title) })
        .unwrap_or_else(|| membership.job_title.clone());
    ctx.db.user_organization().id().update(UserOrganization {
        role_id: params.primary_role_id,
        is_active: params.is_active,
        job_title,
        ..membership.clone()
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: membership.company_id,
            table_name: "user_organization",
            record_id: membership.id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({"role_ids":current_ids,"is_active":membership.is_active})
                    .to_string(),
            ),
            new_values: Some(
                serde_json::json!({"role_ids":desired_ids,"is_active":params.is_active})
                    .to_string(),
            ),
            changed_fields: vec![
                "role_id".into(),
                "role_assignments".into(),
                "is_active".into(),
                "job_title".into(),
            ],
            metadata: None,
        },
    );
    touch_policy_snapshot_for_user(ctx, organization_id, user_identity);
    Ok(())
}
