//! Exercise the runner's durable transaction and service-scope boundaries.

use sha2::{Digest, Sha256};
use spacetimedb::{Identity, ReducerContext, Table, ViewContext};

use crate::ai::local_runner::*;
use crate::core::cold_tier_identity::{cold_tier_service_identity, ColdTierServiceIdentity};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn require(condition: bool, message: &str) -> Result<(), String> {
    condition.then_some(()).ok_or_else(|| message.to_owned())
}

pub fn test_runner_storage(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let org = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let stranger = Identity::from_byte_array([0xac; 32]);
    let digest = |key: &str| {
        format!(
            "{:x}",
            Sha256::digest(format!("runner:{}:{key}", org.organization_id))
        )
    };
    let actor = digest("actor");
    let code = digest("code");
    let stale_code = digest("expired-code");
    let credential = digest("device-credential");
    let device_id = format!("00000000-0000-4000-8000-{:012x}", org.organization_id);
    let other_device_id = format!("00000000-0000-4000-8000-{:012x}", foreign.organization_id);
    let now = (ctx.timestamp.to_micros_since_unix_epoch() / 1_000) as u64;
    let pair = |company_id| IssueRunnerPairing {
        company_id,
        actor_identity: actor.clone(),
        digest: code.clone(),
        expires_at_ms: now + 1000,
    };

    require(
        issue_ai_local_runner_pairing(ctx, org.organization_id, pair(org.company_id)).is_err(),
        "a normal tenant administrator must not issue a trusted device pairing",
    )?;
    let binding = ColdTierServiceIdentity {
        platform_id: format!("local-runner-test-{}", org.organization_id),
        organization_id: org.organization_id,
        service_name: RUNNER_SERVICE.into(),
        identity: ctx.sender(),
        is_active: true,
        registered_by: ctx.sender(),
        registered_at: ctx.timestamp,
        retired_at: None,
    };
    ctx.db.cold_tier_service_identity().insert(binding.clone());
    require(
        issue_ai_local_runner_pairing(ctx, org.organization_id, pair(foreign.company_id)).is_err(),
        "pairing must verify company ownership",
    )?;
    issue_ai_local_runner_pairing(ctx, org.organization_id, pair(org.company_id))?;

    let claim = |code: &str, device_id: &str| ClaimRunnerPairing {
        digest: code.into(),
        device_id: device_id.into(),
        credential_digest: credential.clone(),
        label: "Pilot CLI".into(),
    };
    ctx.db
        .ai_local_runner_pairing()
        .insert(AiLocalRunnerPairing {
            digest: stale_code.clone(),
            organization_id: org.organization_id,
            company_id: org.company_id,
            actor_identity: actor.clone(),
            expires_at_ms: now,
            claimed_device_id: None,
        });
    require(
        claim_ai_local_runner_pairing(ctx, claim(&stale_code, &device_id)).is_err(),
        "expired codes cannot create devices",
    )?;
    claim_ai_local_runner_pairing(ctx, claim(&code, &device_id))?;
    claim_ai_local_runner_pairing(ctx, claim(&code, &device_id))?;
    require(
        claim_ai_local_runner_pairing(ctx, claim(&code, &other_device_id)).is_err(),
        "a consumed code cannot create a second device",
    )?;

    let authorized = ViewContext::new(ctx.sender());
    let unauthorized = ViewContext::new(stranger);
    let devices = ai_local_runner_device_read(&authorized);
    require(
        devices.len() == 1 && devices[0].device_id == device_id,
        "trusted read must return exactly the committed device",
    )?;
    require(
        ai_local_runner_device_read(&unauthorized).is_empty(),
        "unbound readers cannot read device digests",
    )?;
    require(
        ai_local_runner_pairing_read(&unauthorized).is_empty(),
        "unbound readers cannot read pairing digests",
    )?;

    let run_id = org.company_id;
    let run = |run_id: u64, actor_identity: &str| StartRunnerRun {
        company_id: org.company_id,
        actor_identity: actor_identity.into(),
        run_id,
        device_id: device_id.clone(),
        request_key: digest(&format!("request:{run_id}")),
        mcp_digest: digest(&format!("grant:{run_id}")),
        expires_at_ms: now + 1000,
        payload: r#"{"events":[]}"#.into(),
    };
    require(
        start_ai_local_runner_run(
            ctx,
            org.organization_id,
            run(run_id, &digest("other-actor")),
        )
        .is_err(),
        "attempt must match enrolled device owner",
    )?;
    start_ai_local_runner_run(ctx, org.organization_id, run(run_id, &actor))?;
    require(
        start_ai_local_runner_run(ctx, org.organization_id, run(run_id + 1, &actor)).is_err(),
        "a second run cannot hold the same device lease",
    )?;

    let update = |expected_version, require_fresh, active| UpdateRunnerRun {
        run_id,
        company_id: org.company_id,
        actor_identity: actor.clone(),
        device_id: device_id.clone(),
        expected_version,
        require_fresh,
        active,
        payload: r#"{"events":[1]}"#.into(),
    };
    update_ai_local_runner_run(ctx, org.organization_id, update(0, true, true))?;
    require(
        update_ai_local_runner_run(ctx, org.organization_id, update(0, true, true)).is_err(),
        "a stale writer cannot replace an accepted event",
    )?;
    let mut stored = ctx
        .db
        .ai_local_runner_run()
        .run_id()
        .find(run_id)
        .ok_or("runner run missing")?;
    require(
        stored.version == 1 && stored.payload == r#"{"events":[1]}"#,
        "revision and replay payload must commit together",
    )?;
    require(
        ai_local_runner_run_read(&unauthorized).is_empty(),
        "unbound readers cannot read attempt state",
    )?;

    stored.expires_at_ms = now;
    ctx.db.ai_local_runner_run().run_id().update(stored);
    require(
        update_ai_local_runner_run(ctx, org.organization_id, update(1, true, false)).is_err(),
        "expired attempts cannot publish a live result",
    )?;
    update_ai_local_runner_run(ctx, org.organization_id, update(1, false, false))?;

    start_ai_local_runner_run(ctx, org.organization_id, run(run_id + 1, &actor))?;
    revoke_ai_local_runner_device(
        ctx,
        org.organization_id,
        org.company_id,
        actor.clone(),
        device_id.clone(),
    )?;
    require(
        start_ai_local_runner_run(ctx, org.organization_id, run(run_id + 2, &actor)).is_err(),
        "a revoked device cannot receive another lease",
    )?;
    let mut revoked_update = update(0, true, true);
    revoked_update.run_id = run_id + 1;
    require(
        update_ai_local_runner_run(ctx, org.organization_id, revoked_update).is_err(),
        "device revocation must fence writes that started during the lease",
    )?;
    require(
        claim_ai_local_runner_pairing(ctx, claim(&code, &device_id)).is_err(),
        "a consumed code must never recreate a revoked device",
    )?;

    ctx.db
        .cold_tier_service_identity()
        .platform_id()
        .update(ColdTierServiceIdentity {
            is_active: false,
            retired_at: Some(ctx.timestamp),
            ..binding
        });
    require(
        ai_local_runner_run_read(&authorized).is_empty(),
        "retiring the runner identity revokes durable state reads",
    )
}
