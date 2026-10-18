//! Permission effects, transaction preconditions, and trusted invitation retries.
use crate::core::auth::{
    accept_user_invite, create_user_invite, user_credential, user_invite_acceptance,
};
use crate::core::permissions::{
    assign_role, build_policy_snapshot_row, create_role, effective_roles, grant_permission, role,
    update_role, AssignRoleParams, CreateRoleParams, GrantOrgPermissionParams, PermissionAction,
    PermissionEffect, PermissionSubject, UpdateRoleParams,
};
use crate::core::users::{
    add_user_to_organization, remove_user_from_organization, user_organization,
    AddUserToOrganizationParams,
};
use crate::test_harness::OrgFixture;
use spacetimedb::{Identity, ReducerContext, Table};

fn create_test_role(
    ctx: &ReducerContext,
    org: u64,
    name: &str,
    permissions: &[&str],
) -> Result<u64, String> {
    create_role(
        ctx,
        org,
        CreateRoleParams {
            name: name.into(),
            permissions: permissions.iter().map(|p| (*p).into()).collect(),
            description: None,
            parent_id: None,
            is_active: true,
            metadata: None,
        },
    )?;
    ctx.db
        .role()
        .role_by_org()
        .filter(&org)
        .find(|r| r.name == name)
        .map(|r| r.id)
        .ok_or("Role missing".into())
}

pub fn test_effective_access_and_atomic_updates(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let reader = create_test_role(ctx, org, "Lifecycle reader", &["contact:read"])?;
    let writer = create_test_role(ctx, org, "Lifecycle writer", &["contact:write"])?;
    let member = Identity::__dummy();
    add_user_to_organization(
        ctx,
        member,
        org,
        AddUserToOrganizationParams {
            role_id: reader,
            company_id: Some(fixture.company_id),
            job_title: Some("Clerk".into()),
            department_id: Some(123),
            employee_id: Some("employee-preserved".into()),
            is_active: true,
            is_default: false,
            metadata: None,
        },
    )?;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&member)
        .find(|m| m.organization_id == org)
        .ok_or("Member missing")?;
    let mut update = crate::core::access_lifecycle::current_access_params(ctx, &membership);
    update.additional_role_ids = vec![writer];
    crate::core::access_lifecycle::set_member_access(ctx, org, member, update.clone())?;
    crate::core::access_lifecycle::set_member_access(ctx, org, member, update)?;
    let roles = effective_roles(ctx, org, member)?;
    if roles.len() != 2 {
        return Err("Expected base and additive role".into());
    }
    let snapshot = build_policy_snapshot_row(ctx, org, member)?;
    if !snapshot.role_permissions.contains(&"contact:write".into()) {
        return Err("Snapshot omitted additive permissions".into());
    }
    if crate::helpers::resolve_permission(
        ctx,
        org,
        member,
        reader,
        "reader",
        &[],
        false,
        "contact",
        "write",
    ) != crate::helpers::PermissionResolution::Allow
    {
        return Err("Reducer omitted additive permissions".into());
    }
    let saved = ctx
        .db
        .user_organization()
        .id()
        .find(membership.id)
        .ok_or("Member missing")?;
    if saved.job_title != membership.job_title
        || saved.department_id != membership.department_id
        || saved.employee_id != membership.employee_id
    {
        return Err("An access-only save changed employment fields".into());
    }
    let mut stale = crate::core::access_lifecycle::current_access_params(ctx, &saved);
    stale.expected_role_ids = vec![reader];
    stale.additional_role_ids = vec![];
    if crate::core::access_lifecycle::set_member_access(ctx, org, member, stale).is_ok() {
        return Err("Stale access edit succeeded".into());
    }
    if effective_roles(ctx, org, member)?.len() != 2 {
        return Err("Stale edit changed access".into());
    }
    if update_role(
        ctx,
        writer,
        UpdateRoleParams {
            name: None,
            description: None,
            permissions: None,
            is_active: Some(false),
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("Assigned role retirement succeeded".into());
    }
    grant_permission(
        ctx,
        org,
        GrantOrgPermissionParams {
            subject: PermissionSubject::Role(writer),
            resource: "contact".into(),
            action: PermissionAction::Write,
            effect: PermissionEffect::Deny,
        },
    )?;
    if crate::helpers::resolve_permission(
        ctx,
        org,
        member,
        reader,
        "reader",
        &[],
        false,
        "contact",
        "update",
    ) == crate::helpers::PermissionResolution::Allow
    {
        return Err("Explicit deny did not override a role allow".into());
    }
    // An expiry at the current timestamp must never be treated as current.
    if assign_role(
        ctx,
        member,
        writer,
        org,
        AssignRoleParams {
            expires_at_micros: Some(ctx.timestamp.to_micros_since_unix_epoch() as u64),
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("Already expired assignment was admitted".into());
    }
    if remove_user_from_organization(ctx, ctx.sender(), org).is_ok() {
        return Err("Last administrator removal succeeded".into());
    }
    // Assignment ceilings include organization grants attached to the selected role.
    let policy_role = create_test_role(ctx, org, "Policy-only elevation", &[])?;
    grant_permission(
        ctx,
        org,
        GrantOrgPermissionParams {
            subject: PermissionSubject::Role(policy_role),
            resource: "account_payment".into(),
            action: PermissionAction::Create,
            effect: PermissionEffect::Allow,
        },
    )?;
    let selected = ctx.db.role().id().find(policy_role).ok_or("Role missing")?;
    if crate::core::permissions::ensure_identity_may_assign_role(ctx, org, member, &selected)
        .is_ok()
    {
        return Err("Assignment ceiling ignored role policy grants".into());
    }
    let wildcard = create_test_role(ctx, org, "Wildcard with deny", &["*:*"])?;
    let limited = Identity::from_byte_array([0x31; 32]);
    add_user_to_organization(
        ctx,
        limited,
        org,
        AddUserToOrganizationParams {
            role_id: wildcard,
            company_id: Some(fixture.company_id),
            job_title: None,
            department_id: None,
            employee_id: None,
            is_active: true,
            is_default: false,
            metadata: None,
        },
    )?;
    grant_permission(
        ctx,
        org,
        GrantOrgPermissionParams {
            subject: PermissionSubject::User(limited),
            resource: "contact".into(),
            action: PermissionAction::Read,
            effect: PermissionEffect::Deny,
        },
    )?;
    let selected = ctx.db.role().id().find(wildcard).ok_or("Role missing")?;
    if crate::core::permissions::ensure_identity_may_assign_role(ctx, org, limited, &selected)
        .is_ok()
    {
        return Err("Wildcard assignment ignored administrator deny".into());
    }
    let module_role = crate::core::permissions::Role {
        permissions: vec!["module:crm:read".into()],
        ..selected.clone()
    };
    if crate::core::permissions::ensure_identity_may_assign_role(ctx, org, limited, &module_role)
        .is_ok()
    {
        return Err("Module assignment ignored a resource deny".into());
    }
    grant_permission(
        ctx,
        org,
        GrantOrgPermissionParams {
            subject: PermissionSubject::User(limited),
            resource: "contact".into(),
            action: PermissionAction::All,
            effect: PermissionEffect::Deny,
        },
    )?;
    let read_role = crate::core::permissions::Role {
        permissions: vec!["*:read".into()],
        ..selected
    };
    if crate::core::permissions::ensure_identity_may_assign_role(ctx, org, limited, &read_role)
        .is_ok()
    {
        return Err("Read wildcard ignored an all-actions resource deny".into());
    }

    Ok(())
}

pub fn test_invitation_acceptance_retries_do_not_regrant(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let reader = create_test_role(ctx, org, "Invite lifecycle reader", &["contact:read"])?;
    create_user_invite(
        ctx,
        org,
        reader,
        "lifecycle@example.test".into(),
        "a".repeat(64),
        ctx.sender(),
        ctx.timestamp + std::time::Duration::from_secs(3600),
    )?;
    use crate::core::auth::user_invite;
    let invite = ctx
        .db
        .user_invite()
        .iter()
        .find(|i| i.organization_id == org)
        .ok_or("Invite missing")?;
    let member = Identity::__dummy();
    accept_user_invite(
        ctx,
        org,
        invite.id,
        "p_lifecycle".into(),
        member,
        "lifecycle@example.test".into(),
    )?;
    accept_user_invite(
        ctx,
        org,
        invite.id,
        "p_lifecycle".into(),
        member,
        "lifecycle@example.test".into(),
    )?;
    if ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&member)
        .filter(|m| m.organization_id == org)
        .count()
        != 1
    {
        return Err("Retry duplicated membership".into());
    }
    if ctx
        .db
        .user_invite_acceptance()
        .invite_id()
        .find(invite.id)
        .is_none()
        || ctx
            .db
            .user_credential()
            .user_credential_by_identity()
            .filter(&member)
            .filter(|b| b.organization_id == org)
            .count()
            != 1
    {
        return Err("Acceptance omitted trusted receipt or binding".into());
    }
    if accept_user_invite(
        ctx,
        org,
        invite.id,
        "p_wrong".into(),
        ctx.sender(),
        "lifecycle@example.test".into(),
    )
    .is_ok()
    {
        return Err("Another identity reused an acceptance receipt".into());
    }
    remove_user_from_organization(ctx, member, org)?;
    if accept_user_invite(
        ctx,
        org,
        invite.id,
        "p_lifecycle".into(),
        member,
        "lifecycle@example.test".into(),
    )
    .is_ok()
    {
        return Err("Retry restored revoked organization access".into());
    }
    if ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&member)
        .any(|m| m.organization_id == org && m.is_active)
    {
        return Err("Revoked member became active".into());
    }
    Ok(())
}

pub fn test_canonical_duties_and_explicit_payment_capabilities(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    crate::core::permissions::create_sod_conflict_rule(
        ctx,
        org,
        crate::core::permissions::CreateSodConflictRuleParams {
            permission_a: "account_move:create".into(),
            permission_b: "account_move:write".into(),
            description: None,
            is_active: true,
            metadata: None,
        },
    )?;
    let reader = create_test_role(ctx, org, "Canonical duty reader", &["contact:read"])?;
    let member = Identity::from_byte_array([0x53; 32]);
    add_user_to_organization(
        ctx,
        member,
        org,
        AddUserToOrganizationParams {
            role_id: reader,
            company_id: Some(fixture.company_id),
            job_title: None,
            department_id: None,
            employee_id: None,
            is_active: true,
            is_default: false,
            metadata: None,
        },
    )?;
    // A policy denial belonging to the dispatching administrator must never
    // exempt the target member's proposed authority from their conflict rule.
    grant_permission(
        ctx,
        org,
        GrantOrgPermissionParams {
            subject: PermissionSubject::User(ctx.sender()),
            resource: "account_move".into(),
            action: PermissionAction::Write,
            effect: PermissionEffect::Deny,
        },
    )?;
    let mut module_role_id = None;
    for (name, permission) in [
        ("Canonical module duties", "module:accounting:*"),
        ("Canonical alias duties", "account-moves:*"),
    ] {
        let role_id = create_test_role(ctx, org, name, &[permission])?;
        module_role_id.get_or_insert(role_id);
        let selected = ctx
            .db
            .role()
            .id()
            .find(role_id)
            .ok_or("Duty role missing")?;
        for action in ["create", "write"] {
            if !crate::helpers::roles_allow_permission(
                ctx,
                org,
                member,
                &[selected.clone()],
                false,
                "account_move",
                action,
            ) {
                return Err("Duty fixture did not grant its canonical authority".into());
            }
        }
        if crate::core::permissions::validate_sod_for_permissions(ctx, org, &[permission.into()])
            .is_ok()
        {
            return Err("Canonical/module duty wildcard bypassed configured conflict".into());
        }
        let membership = ctx
            .db
            .user_organization()
            .user_org_by_user()
            .filter(&member)
            .find(|m| m.organization_id == org)
            .ok_or("Duty member missing")?;
        let mut params = crate::core::access_lifecycle::current_access_params(ctx, &membership);
        params.primary_role_id = role_id;
        let assignments_before = ctx
            .db
            .user_role_assignment()
            .role_assign_by_user()
            .filter(&member)
            .count();
        if crate::core::access_lifecycle::set_member_access(ctx, org, member, params).is_ok() {
            return Err("Canonical/module member edit bypassed configured duty conflict".into());
        }
        let unchanged = ctx
            .db
            .user_organization()
            .id()
            .find(membership.id)
            .ok_or("Duty member missing")?;
        if unchanged.role_id != reader
            || unchanged.is_active != membership.is_active
            || ctx
                .db
                .user_role_assignment()
                .role_assign_by_user()
                .filter(&member)
                .count()
                != assignments_before
        {
            return Err("Denied duty edit changed membership or assignments".into());
        }
    }
    // Only the target's own deny reduces their effective powers and removes the conflict.
    grant_permission(
        ctx,
        org,
        GrantOrgPermissionParams {
            subject: PermissionSubject::User(member),
            resource: "account_move".into(),
            action: PermissionAction::Write,
            effect: PermissionEffect::Deny,
        },
    )?;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&member)
        .find(|m| m.organization_id == org)
        .ok_or("Duty member missing")?;
    let mut params = crate::core::access_lifecycle::current_access_params(ctx, &membership);
    params.primary_role_id = module_role_id.ok_or("Module role missing")?;
    crate::core::access_lifecycle::set_member_access(ctx, org, member, params)?;
    let roles = effective_roles(ctx, org, member)?;
    if !crate::helpers::roles_allow_permission(
        ctx,
        org,
        member,
        &roles,
        false,
        "account_move",
        "create",
    ) || crate::helpers::roles_allow_permission(
        ctx,
        org,
        member,
        &roles,
        false,
        "account_move",
        "write",
    ) {
        return Err("Target deny did not reduce effective duty powers".into());
    }
    let payment_role_id = create_test_role(
        ctx,
        org,
        "Explicit financial actions",
        &["payment:post", "payment:cancel", "payment:reverse"],
    )?;
    let payment_role = ctx
        .db
        .role()
        .id()
        .find(payment_role_id)
        .ok_or("Payment role missing")?;
    for action in ["post", "cancel", "reverse"] {
        if !crate::helpers::roles_allow_permission(
            ctx,
            org,
            member,
            &[payment_role.clone()],
            false,
            "payment",
            action,
        ) {
            return Err("Explicit payment capability was not honored".into());
        }
        let crud = crate::core::permissions::Role {
            permissions: vec!["account_payment:*".into()],
            ..payment_role.clone()
        };
        if crate::helpers::roles_allow_permission(
            ctx,
            org,
            member,
            &[crud],
            false,
            "payment",
            action,
        ) {
            return Err("Account payment CRUD conferred a financial action".into());
        }
    }
    grant_permission(
        ctx,
        org,
        GrantOrgPermissionParams {
            subject: PermissionSubject::User(member),
            resource: "module:accounting".into(),
            action: PermissionAction::All,
            effect: PermissionEffect::Deny,
        },
    )?;
    for action in ["post", "cancel", "reverse"] {
        if crate::helpers::roles_allow_permission(
            ctx,
            org,
            member,
            &[payment_role.clone()],
            false,
            "payment",
            action,
        ) {
            return Err("Accounting module deny did not block an explicit financial action".into());
        }
    }
    Ok(())
}
