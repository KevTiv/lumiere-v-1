//! Segregation-of-duties enforcement (A6) and delegated-admin guards.
use spacetimedb::{Identity, ReducerContext};

use crate::core::organization::{insert_organization_with_owner, CreateOrganizationParams};
use crate::core::permissions::{
    assign_role, create_role, create_sod_conflict_rule, ensure_resource_fields_writable,
    grant_delegated_admin_scope, grant_field_permission, grant_permission,
    revoke_delegated_admin_scope, role, delegated_admin_scope, sod_conflict_rule,
    update_sod_conflict_rule, AssignRoleParams, CreateRoleParams, CreateSodConflictRuleParams,
    FieldPermissionAction, GrantDelegatedAdminScopeParams, GrantFieldPermissionParams,
    GrantOrgPermissionParams, PermissionAction, PermissionEffect, PermissionSubject,
    UpdateSodConflictRuleParams,
};
use crate::core::users::{add_user_to_organization, AddUserToOrganizationParams};
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
        Ok(()) => return Err("Expected SoD validation to reject conflicting permissions".to_string()),
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
        Err(msg) if msg.contains("segregation of duties") => Ok(()),
        Err(msg) => Err(format!("Unexpected assign_role error: {msg}")),
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

pub fn test_field_write_policy_blocks_disallowed_columns(ctx: &ReducerContext) -> Result<(), String> {
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

    grant_field_permission(
        ctx,
        org_id,
        GrantFieldPermissionParams {
            subject: PermissionSubject::Role(limited_role.id),
            resource: "contact".to_string(),
            action: FieldPermissionAction::Write,
            allowed_fields: vec!["name".to_string()],
        },
    )?;

    ensure_resource_fields_writable(
        ctx,
        org_id,
        ctx.sender(),
        limited_role.id,
        &limited_role.name,
        false,
        "contact",
        &["name".to_string()],
    )?;

    match ensure_resource_fields_writable(
        ctx,
        org_id,
        ctx.sender(),
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
        ctx.sender(),
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
