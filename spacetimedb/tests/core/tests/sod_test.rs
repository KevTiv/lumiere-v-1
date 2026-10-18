//! Segregation-of-duties enforcement (A6) and delegated-admin guards.
use std::time::Duration;

use spacetimedb::{Identity, ReducerContext, Table};

use crate::core::organization::{insert_organization_with_owner, CreateOrganizationParams};
use crate::core::permissions::{
    assign_role, build_policy_snapshot_row, create_role, create_sod_conflict_rule,
    delegated_admin_scope, ensure_resource_fields_writable, grant_delegated_admin_scope,
    grant_field_permission, grant_permission, revoke_delegated_admin_scope, revoke_role, role,
    sod_conflict_rule, update_sod_conflict_rule, user_role_assignment, AssignRoleParams,
    CreateRoleParams, CreateSodConflictRuleParams, FieldPermissionAction,
    GrantDelegatedAdminScopeParams, GrantFieldPermissionParams, GrantOrgPermissionParams,
    PermissionAction, PermissionEffect, PermissionSubject, UpdateSodConflictRuleParams,
};
use crate::core::users::{
    add_user_to_organization, find_user_profile_for_organization, user_organization, user_profile,
    AddUserToOrganizationParams, UserOrganization, UserProfile,
};
use crate::helpers::check_permission;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn seed_sod_org(ctx: &ReducerContext) -> Result<(u64, u64, u64, u64), String> {
    ensure_test_superuser(ctx)?;

    let (org, _) = insert_organization_with_owner(
        ctx,
        CreateOrganizationParams {
            name: "SoD Org".to_string(),
            code: format!("SODORG{}", ctx.timestamp.to_micros_since_unix_epoch()),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: None,
        },
    )?;

    create_sod_conflict_rule(
        ctx,
        org.id,
        CreateSodConflictRuleParams {
            permission_a: "account_payment:create".to_string(),
            permission_b: "account_payment:post".to_string(),
            description: Some("AP clerk vs approver".to_string()),
            is_active: true,
            metadata: None,
        },
    )?;

    create_role(
        ctx,
        org.id,
        CreateRoleParams {
            name: "AP Clerk".to_string(),
            description: None,
            parent_id: None,
            permissions: vec!["account_payment:create".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    create_role(
        ctx,
        org.id,
        CreateRoleParams {
            name: "Payment Approver".to_string(),
            description: None,
            parent_id: None,
            permissions: vec!["account_payment:post".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    create_role(
        ctx,
        org.id,
        CreateRoleParams {
            name: "Member".to_string(),
            description: None,
            parent_id: None,
            permissions: vec!["organization:read".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    let clerk_role = ctx
        .db
        .role()
        .role_by_org()
        .filter(&org.id)
        .find(|r| r.name == "AP Clerk")
        .ok_or("AP Clerk role not found")?;
    let approver_role = ctx
        .db
        .role()
        .role_by_org()
        .filter(&org.id)
        .find(|r| r.name == "Payment Approver")
        .ok_or("Payment Approver role not found")?;
    let member_role = ctx
        .db
        .role()
        .role_by_org()
        .filter(&org.id)
        .find(|r| r.name == "Member")
        .ok_or("Member role not found")?;

    Ok((org.id, clerk_role.id, approver_role.id, member_role.id))
}

pub fn test_sod_blocks_conflicting_roles(ctx: &ReducerContext) -> Result<(), String> {
    let (org_id, _, _, _) = seed_sod_org(ctx)?;

    let conflicting = vec![
        "account_payment:create".to_string(),
        "account_payment:post".to_string(),
    ];
    match crate::core::permissions::validate_sod_for_permissions(ctx, org_id, &conflicting) {
        Ok(()) => {
            return Err("Expected SoD validation to reject conflicting permissions".to_string())
        }
        Err(msg) if msg.contains("segregation of duties") => {}
        Err(msg) => return Err(format!("Unexpected SoD validation error: {msg}")),
    }

    let clerk_only = vec!["account_payment:create".to_string()];
    crate::core::permissions::validate_sod_for_permissions(ctx, org_id, &clerk_only)?;

    Ok(())
}

pub fn test_sod_assign_role_blocks_conflicting_roles(ctx: &ReducerContext) -> Result<(), String> {
    let (org_id, clerk_role_id, approver_role_id, member_role_id) = seed_sod_org(ctx)?;
    let member = Identity::__dummy();

    add_user_to_organization(
        ctx,
        member,
        org_id,
        AddUserToOrganizationParams {
            role_id: member_role_id,
            company_id: None,
            job_title: None,
            department_id: None,
            employee_id: None,
            is_active: true,
            is_default: false,
            metadata: None,
        },
    )?;

    assign_role(
        ctx,
        member,
        clerk_role_id,
        org_id,
        AssignRoleParams {
            expires_at_micros: None,
            metadata: None,
        },
    )?;

    match assign_role(
        ctx,
        member,
        approver_role_id,
        org_id,
        AssignRoleParams {
            expires_at_micros: None,
            metadata: None,
        },
    ) {
        Ok(()) => return Err("assign_role should reject conflicting SoD permissions".to_string()),
        Err(msg) if msg.contains("segregation of duties") => {}
        Err(msg) => return Err(format!("Unexpected assign_role error: {msg}")),
    }

    let clerk_assignment = ctx
        .db
        .user_role_assignment()
        .role_assign_by_user()
        .filter(&member)
        .find(|assignment| {
            assignment.organization_id == org_id
                && assignment.role_id == clerk_role_id
                && assignment.is_active
        })
        .ok_or("active clerk assignment not found")?;
    revoke_role(ctx, org_id, clerk_assignment.id)?;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&member)
        .find(|membership| membership.organization_id == org_id)
        .ok_or("member organization row not found")?;
    ctx.db.user_organization().id().update(UserOrganization {
        role_id: clerk_role_id,
        ..membership
    });

    match assign_role(
        ctx,
        member,
        approver_role_id,
        org_id,
        AssignRoleParams {
            expires_at_micros: None,
            metadata: None,
        },
    ) {
        Ok(()) => Err("base-role SoD conflict should reject supplemental role".to_string()),
        Err(msg) if msg.contains("segregation of duties") => Ok(()),
        Err(msg) => Err(format!("Unexpected base-role SoD error: {msg}")),
    }
}

pub fn test_delegated_admin_cannot_grant_permission(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    grant_delegated_admin_scope(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        GrantDelegatedAdminScopeParams {
            user_identity: ctx.sender(),
            metadata: None,
        },
    )?;

    let role = ctx
        .db
        .role()
        .role_by_org()
        .filter(&fixture.organization_id)
        .find(|r| r.name == "owner" || r.permissions.iter().any(|p| p == "*:*"))
        .ok_or("Owner role not found")?;

    match grant_permission(
        ctx,
        fixture.organization_id,
        GrantOrgPermissionParams {
            subject: PermissionSubject::Role(role.id),
            resource: "contact".to_string(),
            action: PermissionAction::Read,
            effect: PermissionEffect::Allow,
        },
    ) {
        Ok(()) => Err("delegated admin should not grant org permissions".to_string()),
        Err(msg) if msg.contains("delegated administrators cannot grant") => Ok(()),
        Err(msg) => Err(format!("Unexpected grant_permission error: {msg}")),
    }
}

pub fn test_field_write_policy_blocks_disallowed_columns(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_role(
        ctx,
        org_id,
        CreateRoleParams {
            name: "Contact Name Only".to_string(),
            description: None,
            parent_id: None,
            permissions: vec!["contact:write".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    let limited_role = ctx
        .db
        .role()
        .role_by_org()
        .filter(&org_id)
        .find(|r| r.name == "Contact Name Only")
        .ok_or("Limited role not found")?;

    let member = Identity::__dummy();
    add_user_to_organization(
        ctx,
        member,
        org_id,
        AddUserToOrganizationParams {
            role_id: limited_role.id,
            company_id: Some(fixture.company_id),
            job_title: None,
            department_id: None,
            employee_id: None,
            is_active: true,
            is_default: false,
            metadata: None,
        },
    )?;

    grant_field_permission(
        ctx,
        org_id,
        GrantFieldPermissionParams {
            subject: PermissionSubject::Role(limited_role.id),
            resource: "contact".to_string(),
            action: FieldPermissionAction::Write,
            allowed_fields: vec!["name".to_string(), "email".to_string()],
        },
    )?;

    create_role(
        ctx,
        org_id,
        CreateRoleParams {
            name: "Contact Supplemental Name Only".to_string(),
            description: None,
            parent_id: None,
            permissions: vec!["contact:write".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;
    let supplemental_role = ctx
        .db
        .role()
        .role_by_org()
        .filter(&org_id)
        .find(|role| role.name == "Contact Supplemental Name Only")
        .ok_or("supplemental field role not found")?;
    grant_field_permission(
        ctx,
        org_id,
        GrantFieldPermissionParams {
            subject: PermissionSubject::Role(supplemental_role.id),
            resource: "contact".to_string(),
            action: FieldPermissionAction::Write,
            allowed_fields: vec!["name".to_string()],
        },
    )?;
    ctx.db
        .user_role_assignment()
        .insert(crate::core::permissions::UserRoleAssignment {
            id: 0,
            user_identity: member,
            role_id: supplemental_role.id,
            organization_id: org_id,
            assigned_by: ctx.sender(),
            assigned_at: ctx.timestamp,
            expires_at: None,
            is_active: true,
            metadata: Some(r#"{"test":"field-intersection"}"#.to_string()),
        });

    let effective_roles = crate::core::permissions::effective_roles(ctx, org_id, member)?;
    if ![limited_role.id, supplemental_role.id]
        .iter()
        .all(|id| effective_roles.iter().any(|role| role.id == *id))
    {
        return Err("field intersection fixture is missing a target member role".into());
    }

    ensure_resource_fields_writable(
        ctx,
        org_id,
        member,
        limited_role.id,
        &limited_role.name,
        false,
        "contact",
        &["name".to_string()],
    )?;

    match ensure_resource_fields_writable(
        ctx,
        org_id,
        member,
        limited_role.id,
        &limited_role.name,
        false,
        "contact",
        &["email".to_string()],
    ) {
        Ok(()) => Err("field write policy should block email updates".to_string()),
        Err(msg) if msg.contains("column-level write policy") => Ok(()),
        Err(msg) => Err(format!("Unexpected field policy error: {msg}")),
    }
}

pub fn test_sod_update_deactivates_rule(ctx: &ReducerContext) -> Result<(), String> {
    let (org_id, clerk_role_id, approver_role_id, member_role_id) = seed_sod_org(ctx)?;
    let rule = ctx
        .db
        .sod_conflict_rule()
        .sod_by_org()
        .filter(&org_id)
        .next()
        .ok_or("SoD rule not found")?;

    update_sod_conflict_rule(
        ctx,
        org_id,
        rule.id,
        UpdateSodConflictRuleParams {
            permission_a: None,
            permission_b: None,
            description: Some("Deactivated for test".to_string()),
            is_active: Some(false),
            metadata: None,
        },
    )?;

    let member = Identity::__dummy();
    add_user_to_organization(
        ctx,
        member,
        org_id,
        AddUserToOrganizationParams {
            role_id: member_role_id,
            company_id: None,
            job_title: None,
            department_id: None,
            employee_id: None,
            is_active: true,
            is_default: false,
            metadata: None,
        },
    )?;

    assign_role(
        ctx,
        member,
        clerk_role_id,
        org_id,
        AssignRoleParams {
            expires_at_micros: None,
            metadata: None,
        },
    )?;
    assign_role(
        ctx,
        member,
        approver_role_id,
        org_id,
        AssignRoleParams {
            expires_at_micros: None,
            metadata: None,
        },
    )?;

    Ok(())
}

pub fn test_revoke_delegated_admin_scope(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let delegate = Identity::__dummy();

    grant_delegated_admin_scope(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        GrantDelegatedAdminScopeParams {
            user_identity: delegate,
            metadata: None,
        },
    )?;

    let scope = ctx
        .db
        .delegated_admin_scope()
        .delegated_admin_by_user()
        .filter(&delegate)
        .find(|s| s.organization_id == fixture.organization_id && s.is_active)
        .ok_or("Delegated admin scope not found")?;

    revoke_delegated_admin_scope(ctx, fixture.organization_id, scope.id)?;

    let after = ctx
        .db
        .delegated_admin_scope()
        .id()
        .find(&scope.id)
        .ok_or("Delegated admin scope missing after revoke")?;
    if after.is_active {
        return Err("Delegated admin scope should be inactive after revoke".to_string());
    }
    Ok(())
}

pub fn test_opportunity_field_write_policy(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_role(
        ctx,
        org_id,
        CreateRoleParams {
            name: "Opportunity Name Only".to_string(),
            description: None,
            parent_id: None,
            permissions: vec!["opportunity:write".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    let limited_role = ctx
        .db
        .role()
        .role_by_org()
        .filter(&org_id)
        .find(|r| r.name == "Opportunity Name Only")
        .ok_or("Limited role not found")?;

    let member = Identity::__dummy();
    add_user_to_organization(
        ctx,
        member,
        org_id,
        AddUserToOrganizationParams {
            role_id: limited_role.id,
            company_id: Some(fixture.company_id),
            job_title: None,
            department_id: None,
            employee_id: None,
            is_active: true,
            is_default: false,
            metadata: None,
        },
    )?;

    grant_field_permission(
        ctx,
        org_id,
        GrantFieldPermissionParams {
            subject: PermissionSubject::Role(limited_role.id),
            resource: "opportunity".to_string(),
            action: FieldPermissionAction::Write,
            allowed_fields: vec!["name".to_string()],
        },
    )?;

    match ensure_resource_fields_writable(
        ctx,
        org_id,
        member,
        limited_role.id,
        &limited_role.name,
        false,
        "opportunity",
        &["expected_revenue".to_string()],
    ) {
        Ok(()) => Err("opportunity field policy should block expected_revenue".to_string()),
        Err(msg) if msg.contains("column-level write policy") => Ok(()),
        Err(msg) => Err(format!("Unexpected opportunity field policy error: {msg}")),
    }
}

/// COV-23: assign → revoke is exact and one-way. A duplicate assignment, a
/// cross-organization revoke and a replayed revoke are all rejected and leave
/// the assignment row unchanged.
pub fn test_role_assign_revoke_rejects_replay(ctx: &ReducerContext) -> Result<(), String> {
    let (org_id, clerk_role_id, _approver_role_id, member_role_id) = seed_sod_org(ctx)?;
    let other = OrgFixture::seed_minimal(ctx)?;
    let member = Identity::__dummy();

    add_user_to_organization(
        ctx,
        member,
        org_id,
        AddUserToOrganizationParams {
            role_id: member_role_id,
            company_id: None,
            job_title: None,
            department_id: None,
            employee_id: None,
            is_active: true,
            is_default: false,
            metadata: None,
        },
    )?;

    let params = || AssignRoleParams {
        expires_at_micros: None,
        metadata: None,
    };
    let clerk_assignments = || {
        ctx.db
            .user_role_assignment()
            .iter()
            .filter(|a| {
                a.organization_id == org_id
                    && a.role_id == clerk_role_id
                    && a.user_identity == member
            })
            .collect::<Vec<_>>()
    };

    assign_role(ctx, member, clerk_role_id, org_id, params())?;
    let assigned = match clerk_assignments().as_slice() {
        [only] if only.is_active => only.id,
        rows => {
            return Err(format!(
                "expected one active clerk assignment, found {}",
                rows.len()
            ))
        }
    };
    let active = ctx
        .db
        .user_role_assignment()
        .id()
        .find(&assigned)
        .ok_or("assignment vanished after assign")?;

    match assign_role(ctx, member, clerk_role_id, org_id, params()) {
        Err(message) if message.contains("already has this role") => {}
        Err(message) => return Err(format!("unexpected duplicate-assign rejection: {message}")),
        Ok(()) => return Err("duplicate assignment must be rejected".to_string()),
    }
    if clerk_assignments().len() != 1 {
        return Err("rejected duplicate assignment inserted a row".to_string());
    }

    if revoke_role(ctx, other.organization_id, assigned).is_ok() {
        return Err("cross-organization revoke must be rejected".to_string());
    }
    let untouched = ctx
        .db
        .user_role_assignment()
        .id()
        .find(&assigned)
        .ok_or("assignment vanished after rejected revoke")?;
    if untouched != active {
        return Err("rejected cross-organization revoke mutated the assignment".to_string());
    }

    revoke_role(ctx, org_id, assigned)?;
    let revoked = ctx
        .db
        .user_role_assignment()
        .id()
        .find(&assigned)
        .ok_or("assignment vanished after revoke")?;
    if revoked.is_active {
        return Err("revoke did not persist is_active = false".to_string());
    }

    match revoke_role(ctx, org_id, assigned) {
        Err(message) if message.contains("already revoked") => {}
        Err(message) => return Err(format!("unexpected replay rejection: {message}")),
        Ok(()) => return Err("replayed revoke must be rejected".to_string()),
    }
    let after_replay = ctx
        .db
        .user_role_assignment()
        .id()
        .find(&assigned)
        .ok_or("assignment vanished after replay")?;
    if after_replay != revoked {
        return Err("rejected replay mutated the revoked assignment".to_string());
    }
    Ok(())
}

pub fn test_supplemental_role_authority_filters_stale_assignments(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    let create_test_role = |name: &str, permissions: Vec<String>, is_active: bool| {
        create_role(
            ctx,
            org_id,
            CreateRoleParams {
                name: name.to_string(),
                description: None,
                parent_id: None,
                permissions,
                is_active,
                metadata: None,
            },
        )?;
        ctx.db
            .role()
            .role_by_org()
            .filter(&org_id)
            .find(|role| role.name == name)
            .ok_or_else(|| format!("{name} role not found"))
    };

    let current_role = create_test_role(
        "Supplemental current",
        vec![
            "supplemental_string:read".to_string(),
            "supplemental_denied:read".to_string(),
        ],
        true,
    )?;
    let expired_role = create_test_role(
        "Supplemental expired",
        vec!["supplemental_expired:read".to_string()],
        true,
    )?;
    let inactive_role = create_test_role(
        "Supplemental inactive",
        vec!["supplemental_inactive:read".to_string()],
        false,
    )?;

    grant_permission(
        ctx,
        org_id,
        GrantOrgPermissionParams {
            subject: PermissionSubject::Role(current_role.id),
            resource: "supplemental_org_grant".to_string(),
            action: PermissionAction::Read,
            effect: PermissionEffect::Allow,
        },
    )?;
    grant_permission(
        ctx,
        org_id,
        GrantOrgPermissionParams {
            subject: PermissionSubject::Role(current_role.id),
            resource: "supplemental_denied".to_string(),
            action: PermissionAction::Read,
            effect: PermissionEffect::Deny,
        },
    )?;
    grant_field_permission(
        ctx,
        org_id,
        GrantFieldPermissionParams {
            subject: PermissionSubject::Role(current_role.id),
            resource: "account_move".to_string(),
            action: FieldPermissionAction::Read,
            allowed_fields: vec!["name".to_string()],
        },
    )?;

    for (role_id, expires_at) in [
        (current_role.id, None),
        (
            expired_role.id,
            Some(ctx.timestamp - Duration::from_secs(1)),
        ),
        (inactive_role.id, None),
    ] {
        ctx.db
            .user_role_assignment()
            .insert(crate::core::permissions::UserRoleAssignment {
                id: 0,
                user_identity: ctx.sender(),
                role_id,
                organization_id: org_id,
                assigned_by: ctx.sender(),
                assigned_at: ctx.timestamp,
                expires_at,
                is_active: true,
                metadata: Some(r#"{"test":"supplemental-authority"}"#.to_string()),
            });
    }
    let other = OrgFixture::seed_minimal(ctx)?;
    let other_owner_role = ctx
        .db
        .role()
        .role_by_org()
        .filter(&other.organization_id)
        .find(|role| {
            role.permissions
                .iter()
                .any(|permission| permission == "*:*")
        })
        .ok_or("other organization owner role not found")?;
    ctx.db
        .user_role_assignment()
        .insert(crate::core::permissions::UserRoleAssignment {
            id: 0,
            user_identity: ctx.sender(),
            role_id: other_owner_role.id,
            organization_id: other.organization_id,
            assigned_by: ctx.sender(),
            assigned_at: ctx.timestamp,
            expires_at: None,
            is_active: true,
            metadata: Some(r#"{"test":"cross-org-authority"}"#.to_string()),
        });

    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == org_id)
        .ok_or("test membership not found")?;
    let base_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("base role not found")?;
    ctx.db.role().id().update(crate::core::permissions::Role {
        permissions: vec![],
        ..base_role
    });
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), org_id)
        .ok_or("test profile not found")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });

    check_permission(ctx, org_id, "supplemental_string", "read")?;
    check_permission(ctx, org_id, "supplemental_org_grant", "read")?;
    if check_permission(ctx, org_id, "supplemental_denied", "read").is_ok() {
        return Err("explicit org deny did not override role-string allow".to_string());
    }
    for resource in [
        "supplemental_expired",
        "supplemental_inactive",
        "cross_org_probe",
    ] {
        if check_permission(ctx, org_id, resource, "read").is_ok() {
            return Err(format!("stale supplemental role granted {resource}"));
        }
    }

    let snapshot = build_policy_snapshot_row(ctx, org_id, ctx.sender())?;
    if !snapshot
        .role_permissions
        .contains(&"supplemental_string:read".to_string())
        || snapshot
            .role_permissions
            .contains(&"supplemental_expired:read".to_string())
        || snapshot
            .role_permissions
            .contains(&"supplemental_inactive:read".to_string())
    {
        return Err("policy snapshot supplemental permission filtering mismatch".to_string());
    }
    if !snapshot
        .org_permission_grants
        .iter()
        .any(|grant| grant.resource == "supplemental_org_grant")
        || !snapshot
            .field_permissions
            .iter()
            .any(|grant| grant.resource == "account_move")
    {
        return Err("supplemental role grants missing from policy snapshot".to_string());
    }
    Ok(())
}
