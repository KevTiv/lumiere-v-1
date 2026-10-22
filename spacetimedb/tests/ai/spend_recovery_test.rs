//! Durable spend-recovery reducer tests. These run inside SpacetimeDB through
//! `run_ai_spend_recovery_tests`, so table updates and reducer authorization
//! are exercised against the real transactional database API.

use spacetimedb::{ReducerContext, Table};

use crate::ai::spend::{
    ai_provider_attempt, ai_spend_budget, ai_spend_reservation, recover_ai_provider_attempt,
    AiProviderAttempt, AiSpendBudget, AiSpendReservation, RecoverAiProviderAttemptParams,
};
use crate::core::permissions::role;
use crate::core::users::{
    find_user_profile_for_organization, user_organization, user_profile, UserProfile,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

struct RecoveryFixture {
    organization_id: u64,
    budget_id: u64,
    reservation_id: u64,
    attempt_id: u64,
    reserved_units: u64,
}

fn seed_accepted_attempt(ctx: &ReducerContext, label: &str) -> Result<RecoveryFixture, String> {
    ensure_test_superuser(ctx)?;
    let scope = OrgFixture::seed_minimal(ctx)?;
    let agent_id = scope.company_id.saturating_add(1_000_000);
    let run_id = scope.company_id.saturating_add(2_000_000);
    let reserved_units = 400;
    let request_key = format!("spend-recovery-{label}-{}", scope.organization_id);

    let budget = ctx.db.ai_spend_budget().insert(AiSpendBudget {
        id: 0,
        organization_id: scope.organization_id,
        agent_id,
        billing_period: "2026-10".into(),
        currency: "USD".into(),
        limit_units: 1_000,
        settled_units: 0,
        outstanding_units: reserved_units,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    let reservation = ctx.db.ai_spend_reservation().insert(AiSpendReservation {
        id: 0,
        organization_id: scope.organization_id,
        company_id: scope.company_id,
        agent_id,
        run_id,
        request_key: request_key.clone(),
        provider: "test-provider".into(),
        model: "test-model".into(),
        billing_period: "2026-10".into(),
        currency: "USD".into(),
        price_snapshot_id: 1,
        reserved_units,
        settled_units: 0,
        input_token_allowance: 100,
        output_token_allowance: 100,
        status: "reserved".into(),
        reserved_by: ctx.sender(),
        settled_by: None,
        created_at: ctx.timestamp,
        settled_at: None,
        settled_input_tokens: 0,
        settled_output_tokens: 0,
    });
    let attempt = ctx.db.ai_provider_attempt().insert(AiProviderAttempt {
        id: 0,
        organization_id: scope.organization_id,
        company_id: scope.company_id,
        agent_id,
        run_id,
        reservation_id: reservation.id,
        request_key,
        provider: "test-provider".into(),
        model: "test-model".into(),
        status: "accepted".into(),
        input_tokens: 0,
        output_tokens: 0,
        failure_reason: None,
        resolution: None,
        recovery_actor: None,
        recovery_approval_id: None,
        recovery_at: None,
        reconciliation_actor: None,
        reconciliation_approval_id: None,
        accepted_by: ctx.sender(),
        write_uid: ctx.sender(),
        created_at: ctx.timestamp,
        dispatched_at: None,
        finished_at: None,
        write_date: ctx.timestamp,
    });

    Ok(RecoveryFixture {
        organization_id: scope.organization_id,
        budget_id: budget.id,
        reservation_id: reservation.id,
        attempt_id: attempt.id,
        reserved_units,
    })
}

fn abandon_params(attempt_id: u64) -> RecoverAiProviderAttemptParams {
    RecoverAiProviderAttemptParams {
        attempt_id,
        action: "abandon_accepted".into(),
        resolution: "provider dispatch never began".into(),
        actor_identity: "recovery-operator@example.test".into(),
        approval_id: "approval:test-abandon".into(),
    }
}

pub fn test_abandon_persists_and_releases_atomically(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = seed_accepted_attempt(ctx, "atomic")?;
    let params = abandon_params(fixture.attempt_id);

    recover_ai_provider_attempt(ctx, fixture.organization_id, params.clone())?;

    let attempt = ctx
        .db
        .ai_provider_attempt()
        .id()
        .find(&fixture.attempt_id)
        .ok_or("recovered attempt missing")?;
    let reservation = ctx
        .db
        .ai_spend_reservation()
        .id()
        .find(&fixture.reservation_id)
        .ok_or("released reservation missing")?;
    let budget = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(&fixture.budget_id)
        .ok_or("updated budget missing")?;

    if attempt.status != "abandoned"
        || attempt.resolution.as_deref() != Some(params.resolution.as_str())
        || attempt.recovery_actor.as_deref() != Some(params.actor_identity.as_str())
        || attempt.recovery_approval_id.as_deref() != Some(params.approval_id.as_str())
        || attempt.recovery_at.is_none()
        || attempt.finished_at.is_none()
    {
        return Err("recovery attribution/status was not persisted".into());
    }
    if reservation.status != "released" || budget.outstanding_units != 0 {
        return Err("attempt abandonment did not atomically release reserved spend".into());
    }

    // An exact replay succeeds without decrementing the budget twice.
    recover_ai_provider_attempt(ctx, fixture.organization_id, params.clone())?;
    let replayed_budget = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(&fixture.budget_id)
        .ok_or("budget missing after replay")?;
    if replayed_budget.outstanding_units != 0 {
        return Err(format!(
            "recovery replay changed outstanding spend from 0 to {}",
            replayed_budget.outstanding_units
        ));
    }
    if fixture.reserved_units == 0 {
        return Err("test fixture must reserve non-zero spend".into());
    }

    let mut conflicting = params;
    conflicting.approval_id = "approval:conflicting".into();
    match recover_ai_provider_attempt(ctx, fixture.organization_id, conflicting) {
        Err(error) if error.contains("different attribution or resolution") => Ok(()),
        Err(error) => Err(format!("unexpected conflicting replay error: {error}")),
        Ok(()) => Err("conflicting recovery replay unexpectedly succeeded".into()),
    }
}

pub fn test_recovery_requires_reconcile_permission(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = seed_accepted_attempt(ctx, "permission")?;
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
        .ok_or("recovery test profile missing")?;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == fixture.organization_id && row.is_active)
        .ok_or("recovery test membership missing")?;
    let assigned_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("recovery test role missing")?;

    let profile_id = profile.id;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    ctx.db.role().id().update(crate::core::permissions::Role {
        permissions: vec![],
        ..assigned_role.clone()
    });
    let result = recover_ai_provider_attempt(
        ctx,
        fixture.organization_id,
        abandon_params(fixture.attempt_id),
    );
    ctx.db.role().id().update(assigned_role);
    let demoted_profile = ctx
        .db
        .user_profile()
        .id()
        .find(&profile_id)
        .ok_or("demoted recovery test profile missing")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: true,
        ..demoted_profile
    });

    match result {
        Err(error) if error.contains("Permission denied") => Ok(()),
        Err(error) => Err(format!("unexpected authorization error: {error}")),
        Ok(()) => Err("recovery succeeded without ai_spend/reconcile permission".into()),
    }
}
