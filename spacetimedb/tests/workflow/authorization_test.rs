//! Workflow decision authorization and delegation tests.

use std::time::Duration;

use spacetimedb::rand::Rng;
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::core::permissions::{
    role, sod_conflict_rule, user_role_assignment, Role, SodConflictRule, UserRoleAssignment,
};
use crate::core::users::{user_organization, user_profile, UserOrganization, UserProfile};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::workflow::authorization::{
    authorize_workflow_decision_for_actor, insert_workflow_delegation,
    require_workflow_company_access, workflow_delegation, CreateWorkflowDelegationParams,
    WorkflowAuthorizationBypass, WorkflowAuthorizationRequest, WorkflowDelegation,
};

pub fn test_workflow_authorization(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    rejects_wrong_and_expired_roles(ctx)?;
    rejects_inactive_and_cross_company_members(ctx)?;
    rejects_self_approval_and_sod_conflicts(ctx)?;
    rejects_invalid_overlapping_and_cyclic_delegation(ctx)?;
    rejects_expired_delegation_at_decision_time(ctx)?;
    records_valid_delegation_identities(ctx)?;
    records_explicit_superuser_bypass(ctx)?;
    Ok(())
}

fn rejects_wrong_and_expired_roles(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let member_role = seed_role(ctx, fixture.organization_id, "workflow-member", vec![]);
    let approver_role = seed_role(
        ctx,
        fixture.organization_id,
        "workflow-approver",
        vec!["workflow_task:approve"],
    );
    let actor = seed_member(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        member_role,
        true,
        false,
    );
    let requester = new_identity(ctx);

    let wrong_role = authorize_workflow_decision_for_actor(
        ctx,
        actor,
        &request(
            &fixture,
            requester,
            None,
            vec![approver_role],
            "workflow_task:approve",
        ),
    )
    .err()
    .ok_or("wrong-role workflow decision was authorized")?;
    assert_error_contains(&wrong_role, "candidate role")?;

    ctx.db.user_role_assignment().insert(UserRoleAssignment {
        id: 0,
        user_identity: actor,
        role_id: approver_role,
        organization_id: fixture.organization_id,
        assigned_by: ctx.sender(),
        assigned_at: ctx.timestamp - Duration::from_secs(120),
        expires_at: Some(ctx.timestamp - Duration::from_secs(60)),
        is_active: true,
        metadata: Some(r#"{"test":"expired"}"#.to_string()),
    });
    let expired = authorize_workflow_decision_for_actor(
        ctx,
        actor,
        &request(
            &fixture,
            requester,
            None,
            vec![approver_role],
            "workflow_task:approve",
        ),
    )
    .err()
    .ok_or("expired workflow role was accepted")?;
    assert_error_contains(&expired, "candidate role")
}

fn rejects_inactive_and_cross_company_members(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(
        ctx,
        fixture.organization_id,
        "company-approver",
        vec!["workflow_task:approve"],
    );
    let inactive = seed_member(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        role_id,
        false,
        false,
    );
    let inactive_error =
        require_workflow_company_access(ctx, fixture.organization_id, fixture.company_id, inactive)
            .err()
            .ok_or("inactive organization member retained workflow access")?;
    assert_error_contains(&inactive_error, "no active access")?;

    let second_company_id = seed_second_company(ctx, &fixture)?;
    let scoped_member = seed_member(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        role_id,
        true,
        false,
    );
    let cross_company = require_workflow_company_access(
        ctx,
        fixture.organization_id,
        second_company_id,
        scoped_member,
    )
    .err()
    .ok_or("company-scoped member accessed another company")?;
    assert_error_contains(&cross_company, "no active access")
}

fn rejects_self_approval_and_sod_conflicts(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let requester_role = seed_role(
        ctx,
        fixture.organization_id,
        "payment-requester",
        vec!["account_payment:create"],
    );
    let approver_role = seed_role(
        ctx,
        fixture.organization_id,
        "payment-approver",
        vec!["account_payment:post"],
    );
    let actor = seed_member(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        requester_role,
        true,
        false,
    );

    let self_approval = authorize_workflow_decision_for_actor(
        ctx,
        actor,
        &request(
            &fixture,
            actor,
            None,
            vec![requester_role],
            "account_payment:create",
        ),
    )
    .err()
    .ok_or("requester approved their own workflow task")?;
    assert_error_contains(&self_approval, "self-approval")?;

    ctx.db.user_role_assignment().insert(UserRoleAssignment {
        id: 0,
        user_identity: actor,
        role_id: approver_role,
        organization_id: fixture.organization_id,
        assigned_by: ctx.sender(),
        assigned_at: ctx.timestamp,
        expires_at: None,
        is_active: true,
        metadata: Some(r#"{"test":"decision-time-sod"}"#.to_string()),
    });
    ctx.db.sod_conflict_rule().insert(SodConflictRule {
        id: 0,
        organization_id: fixture.organization_id,
        permission_a: "account_payment:create".to_string(),
        permission_b: "account_payment:post".to_string(),
        description: Some("requester versus approver".to_string()),
        is_active: true,
        created_at: ctx.timestamp,
        metadata: None,
    });

    let sod = authorize_workflow_decision_for_actor(
        ctx,
        actor,
        &request(
            &fixture,
            new_identity(ctx),
            None,
            vec![approver_role],
            "account_payment:post",
        ),
    )
    .err()
    .ok_or("SOD-conflicting workflow decision was authorized")?;
    assert_error_contains(&sod, "segregation of duties")
}

fn rejects_invalid_overlapping_and_cyclic_delegation(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(
        ctx,
        fixture.organization_id,
        "delegated-approver",
        vec!["workflow_task:approve"],
    );
    let first = seed_member(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        role_id,
        true,
        false,
    );
    let second = seed_member(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        role_id,
        true,
        false,
    );
    let window = delegation(first, second, Some(role_id), ctx.timestamp);

    let self_delegation = insert_workflow_delegation(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        delegation(first, first, Some(role_id), ctx.timestamp),
        ctx.sender(),
    )
    .err()
    .ok_or("self-delegation was inserted")?;
    assert_error_contains(&self_delegation, "cannot target self")?;

    insert_workflow_delegation(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        window.clone(),
        ctx.sender(),
    )?;
    let overlap = insert_workflow_delegation(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        window,
        ctx.sender(),
    )
    .err()
    .ok_or("overlapping duplicate delegation was inserted")?;
    assert_error_contains(&overlap, "overlapping")?;

    let cycle = insert_workflow_delegation(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        delegation(second, first, Some(role_id), ctx.timestamp),
        ctx.sender(),
    )
    .err()
    .ok_or("cyclic delegation was inserted")?;
    assert_error_contains(&cycle, "cycle")?;

    let second_company_id = seed_second_company(ctx, &fixture)?;
    let other_company_member = seed_member(
        ctx,
        fixture.organization_id,
        Some(second_company_id),
        role_id,
        true,
        false,
    );
    let cross_company = insert_workflow_delegation(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        delegation(first, other_company_member, Some(role_id), ctx.timestamp),
        ctx.sender(),
    )
    .err()
    .ok_or("cross-company delegation was inserted")?;
    assert_error_contains(&cross_company, "no active access")
}

fn records_valid_delegation_identities(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let member_role = seed_role(ctx, fixture.organization_id, "delegate-member", vec![]);
    let approver_role = seed_role(
        ctx,
        fixture.organization_id,
        "delegator-approver",
        vec!["workflow_task:approve"],
    );
    let delegator = seed_member(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        approver_role,
        true,
        false,
    );
    let actor = seed_member(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        member_role,
        true,
        false,
    );
    let delegation = insert_workflow_delegation(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        delegation(delegator, actor, None, ctx.timestamp),
        ctx.sender(),
    )?;
    let requester = new_identity(ctx);
    let decision = authorize_workflow_decision_for_actor(
        ctx,
        actor,
        &request(
            &fixture,
            requester,
            Some(delegator),
            vec![approver_role],
            "workflow_task:approve",
        ),
    )?;
    if decision.actor_identity != actor
        || decision.acting_for_identity != Some(delegator)
        || decision.matched_role_id != Some(approver_role)
        || decision.delegation_id != Some(delegation.id)
    {
        return Err("delegated decision did not retain actor/principal/role evidence".to_string());
    }
    Ok(())
}

fn rejects_expired_delegation_at_decision_time(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let member_role = seed_role(ctx, fixture.organization_id, "expired-delegate", vec![]);
    let approver_role = seed_role(
        ctx,
        fixture.organization_id,
        "expired-delegator",
        vec!["workflow_task:approve"],
    );
    let delegator = seed_member(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        approver_role,
        true,
        false,
    );
    let actor = seed_member(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        member_role,
        true,
        false,
    );
    let row = insert_workflow_delegation(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        delegation(delegator, actor, Some(approver_role), ctx.timestamp),
        ctx.sender(),
    )?;
    ctx.db
        .workflow_delegation()
        .id()
        .update(WorkflowDelegation {
            valid_until: ctx.timestamp,
            ..row
        });

    let error = authorize_workflow_decision_for_actor(
        ctx,
        actor,
        &request(
            &fixture,
            new_identity(ctx),
            Some(delegator),
            vec![approver_role],
            "workflow_task:approve",
        ),
    )
    .err()
    .ok_or("expired delegation was accepted at decision time")?;
    assert_error_contains(&error, "no effective workflow delegation")
}

fn records_explicit_superuser_bypass(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let superuser = seed_profile(ctx, fixture.organization_id, true);
    let decision = authorize_workflow_decision_for_actor(
        ctx,
        superuser,
        &request(
            &fixture,
            new_identity(ctx),
            None,
            vec![u64::MAX],
            "workflow_task:approve",
        ),
    )?;
    if !decision.superuser_bypass
        || decision.bypassed_checks
            != vec![
                WorkflowAuthorizationBypass::CompanyMembership,
                WorkflowAuthorizationBypass::CandidateRole,
                WorkflowAuthorizationBypass::ResourcePermission,
            ]
    {
        return Err("superuser bypass was not explicit in authorization evidence".to_string());
    }
    Ok(())
}

fn request(
    fixture: &OrgFixture,
    requester_identity: Identity,
    acting_for_identity: Option<Identity>,
    candidate_role_ids: Vec<u64>,
    required_permission: &str,
) -> WorkflowAuthorizationRequest {
    WorkflowAuthorizationRequest {
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        requester_identity,
        acting_for_identity,
        candidate_role_ids,
        required_permission: required_permission.to_string(),
    }
}

fn seed_role(
    ctx: &ReducerContext,
    organization_id: u64,
    name: &str,
    permissions: Vec<&str>,
) -> u64 {
    ctx.db
        .role()
        .insert(Role {
            id: 0,
            organization_id,
            name: format!("{name}-{}", ctx.rng().gen::<u64>()),
            description: None,
            parent_id: None,
            permissions: permissions.into_iter().map(str::to_string).collect(),
            is_system: false,
            is_active: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: Some(r#"{"test":"workflow-authorization"}"#.to_string()),
        })
        .id
}

fn seed_member(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    role_id: u64,
    membership_active: bool,
    superuser: bool,
) -> Identity {
    let identity = seed_profile(ctx, organization_id, superuser);
    ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity: identity,
        organization_id,
        company_id,
        role_id,
        department_id: None,
        job_title: None,
        employee_id: None,
        date_joined: ctx.timestamp,
        is_active: membership_active,
        is_default: false,
        metadata: Some(r#"{"test":"workflow-authorization"}"#.to_string()),
    });
    identity
}

fn seed_profile(ctx: &ReducerContext, organization_id: u64, superuser: bool) -> Identity {
    let identity = new_identity(ctx);
    ctx.db.user_profile().insert(UserProfile {
        id: 0,
        identity,
        platform_user_id: format!("test-{}", identity.to_hex()),
        organization_id,
        email: format!("{}@workflow.test", identity.to_hex()),
        email_verified: true,
        name: "Workflow test user".to_string(),
        first_name: None,
        last_name: None,
        avatar_url: None,
        phone: None,
        mobile: None,
        timezone: "UTC".to_string(),
        language: "en".to_string(),
        signature: None,
        notification_preferences: None,
        ui_preferences: None,
        is_active: true,
        is_superuser: superuser,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        last_login: None,
        metadata: Some(r#"{"test":"workflow-authorization"}"#.to_string()),
    });
    identity
}

fn new_identity(ctx: &ReducerContext) -> Identity {
    Identity::from_byte_array(ctx.rng().gen::<[u8; 32]>())
}

fn delegation(
    delegator_identity: Identity,
    delegatee_identity: Identity,
    role_id: Option<u64>,
    now: Timestamp,
) -> CreateWorkflowDelegationParams {
    CreateWorkflowDelegationParams {
        delegator_identity,
        delegatee_identity,
        role_id,
        valid_from: now - Duration::from_secs(60),
        valid_until: now + Duration::from_secs(3_600),
        reason: Some("workflow authorization test".to_string()),
    }
}

fn seed_second_company(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("Harness company not found")?
        .currency_id;
    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: format!("Workflow Company {}", ctx.rng().gen::<u64>()),
            code: format!("WF{}", ctx.rng().gen::<u32>()),
            currency_id,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: Some(r#"{"test":"workflow-authorization"}"#.to_string()),
        },
    )?;
    ctx.db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .filter(|company| company.id != fixture.company_id)
        .map(|company| company.id)
        .max()
        .ok_or("second workflow test company was not created".to_string())
}

fn assert_error_contains(error: &str, expected: &str) -> Result<(), String> {
    if error.contains(expected) {
        Ok(())
    } else {
        Err(format!(
            "expected error containing '{expected}', got '{error}'"
        ))
    }
}
