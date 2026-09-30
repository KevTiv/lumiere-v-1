//! Phase 4 reducer invariants. This superuser fixture is not an RBAC or
//! ordinary-operator acceptance proof; no new test reducers/contracts.
use spacetimedb::{ReducerContext, Table};
use sha2::{Digest, Sha256};

use crate::accounting::payment_management::{
    create_payment_account, create_payment_transaction, payment_account, payment_transaction,
    update_payment_transaction, CreatePaymentAccountParams, CreatePaymentTransactionParams,
    UpdatePaymentTransactionParams,
};
use crate::accounting_tests::helpers::seed_bank_journal;
use crate::ai::action_drafts::{
    ai_action_draft, ai_action_draft_request, approve_ai_action_draft, create_ai_action_draft,
    create_ai_run_action_draft, payment_source_snapshot_hash, CreateAiActionDraftParams,
};
use crate::ai::capability_execution::{
    ai_capability_execution, claim_ai_capability_execution, record_ai_capability_execution_result,
    ClaimAiCapabilityExecutionParams, RecordAiCapabilityExecutionResultParams,
};
use crate::ai::reducer_allowlist::{ai_reducer_allowlist, create_ai_reducer_allowlist, CreateAiReducerAllowlistParams};
use crate::ai::skills::{ai_agent_run, AiAgentRun};
use crate::core::audit::audit_log;
use crate::projects::tasks::project_task;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{PartnerType, PaymentDirection, PaymentProviderCode};

fn allow_task(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<(), String> {
    if let Some(existing) = ctx.db.ai_reducer_allowlist().iter().find(|row|
        row.organization_id == fixture.organization_id && row.reducer_name == "create_task") {
        if existing.enabled && existing.permission_resource == "project_task" && existing.permission_action == "create" {
            return Ok(());
        }
        return Err("phase4 create_task allowlist fixture has unexpected authority".into());
    }
    create_ai_reducer_allowlist(ctx, fixture.organization_id, CreateAiReducerAllowlistParams {
        reducer_name: "create_task".into(), permission_resource: "project_task".into(),
        permission_action: "create".into(), enabled: true, metadata: None,
    })
}

fn task_params(marker: &str) -> CreateAiActionDraftParams {
    CreateAiActionDraftParams {
        reducer_name: "create_task".into(),
        params_json: serde_json::json!({"name": marker}).to_string(),
        summary: marker.into(), confidence: 1.0, elevated: false,
        warnings_json: None, source_query: None, ui_context_json: None,
        expires_at: None, metadata: None,
    }
}

fn seed_run(ctx: &ReducerContext, fixture: &OrgFixture) -> AiAgentRun {
    ctx.db.ai_agent_run().insert(AiAgentRun {
        id: 0, organization_id: fixture.organization_id, company_id: fixture.company_id,
        skill_id: 1, skill_config_id: None, agent_id: 1, team_member_id: None,
        run_key: format!("phase4:{}", fixture.organization_id), status: "running".into(),
        inputs_json: "{}".into(), summary: None, artifacts_json: None, citations_json: None,
        action_draft_ids: vec![], step_count: 0, tokens_used: 0, error_message: None,
        triggered_by_hex: ctx.sender().to_hex().to_string(), started_at: ctx.timestamp,
        completed_at: None, create_date: ctx.timestamp, write_date: ctx.timestamp, metadata: None,
    })
}

pub fn test_correlated_draft_replay(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    allow_task(ctx, &fixture)?;
    let run = seed_run(ctx, &fixture);
    let params = task_params("AG-04 correlated draft");
    let create = |params| create_ai_run_action_draft(ctx, fixture.organization_id,
        fixture.company_id, run.id, "ag04-replay".into(), params);
    create(params.clone())?;
    let link = ctx.db.ai_action_draft_request().iter().find(|row| row.run_id == run.id)
        .ok_or("AG-04 request link missing")?;
    let initial_audits = ctx.db.audit_log().iter().filter(|row|
        row.organization_id == fixture.organization_id && row.table_name == "ai_action_draft").count();
    for _ in 0..3 { create(params.clone())?; }
    let mut changed = params.clone();
    changed.params_json = serde_json::json!({"name": "conflicting effect"}).to_string();
    if !matches!(create(changed), Err(error) if error.contains("different draft payload")) {
        return Err("AG-04 conflicting replay was not rejected".into());
    }
    let persisted = ctx.db.ai_agent_run().id().find(&run.id).ok_or("AG-04 run missing")?;
    ctx.db.ai_agent_run().id().update(AiAgentRun { status: "completed".into(), ..persisted });
    create(params.clone())?; // A committed replay still resolves after terminal state.
    if create_ai_run_action_draft(ctx, fixture.organization_id, fixture.company_id,
        run.id, "ag04-new".into(), params).is_ok() {
        return Err("AG-04 terminal run accepted a new draft".into());
    }
    let drafts: Vec<_> = ctx.db.ai_action_draft().iter()
        .filter(|row| row.organization_id == fixture.organization_id).collect();
    let requests: Vec<_> = ctx.db.ai_action_draft_request().iter()
        .filter(|row| row.run_id == run.id).collect();
    let persisted = ctx.db.ai_agent_run().id().find(&run.id).ok_or("AG-04 run missing")?;
    if drafts.len() != 1 || requests.len() != 1 || drafts[0].id != link.draft_id
        || drafts[0].status != "pending" || drafts[0].executed_at.is_some()
        || persisted.action_draft_ids != vec![link.draft_id] {
        return Err("AG-04 replay changed the draft, correlation, or run binding".into());
    }
    if ctx.db.project_task().iter().any(|row| row.organization_id == fixture.organization_id)
        || ctx.db.audit_log().iter().filter(|row| row.organization_id == fixture.organization_id
            && row.table_name == "ai_action_draft").count() != initial_audits {
        return Err("AG-04 draft-only replay executed a task or duplicated audit effects".into());
    }
    Ok(())
}

pub fn test_payment_bound_draft_rejects_stale_source(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    allow_task(ctx, &fixture)?;
    allow_task(ctx, &foreign)?;
    let (journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    create_payment_account(ctx, fixture.organization_id, CreatePaymentAccountParams {
        company_id: fixture.company_id, provider_code: PaymentProviderCode::Cash,
        name: "AG-03 source wallet".into(), provider_label: None, reference_raw: None,
        currency_id: fixture.currency_id, account_journal_id: journal_id,
        fee_account_id: None, clearing_account_id: None, is_primary: true, metadata: None,
    })?;
    let account_id = ctx.db.payment_account().iter().find(|row|
        row.organization_id == fixture.organization_id).ok_or("AG-03 wallet missing")?.id;
    create_payment_transaction(ctx, fixture.organization_id, CreatePaymentTransactionParams {
        company_id: fixture.company_id, payment_account_id: account_id,
        direction: PaymentDirection::Inbound, partner_type: PartnerType::Customer,
        partner_id: fixture.partner_id, external_reference: Some("AG-03-source".into()),
        gross_external_amount: 10.0, settlement_amount: 10.0, net_account_amount: 10.0,
        currency_id: fixture.currency_id, occurred_at: None, source_entity: None,
        source_entity_id: None, evidence_document_ids: vec![], metadata: None,
    })?;
    let payment = ctx.db.payment_transaction().iter().find(|row|
        row.organization_id == fixture.organization_id).ok_or("AG-03 payment missing")?;
    let source_hash = payment_source_snapshot_hash(&payment);
    let mut params = task_params("AG-03 payment follow-up");
    params.metadata = Some(serde_json::json!({"payment_source": {
        "id": payment.id, "snapshot_hash": source_hash,
    }}).to_string());
    if create_ai_action_draft(ctx, foreign.organization_id, foreign.company_id, params.clone()).is_ok() {
        return Err("AG-03 foreign payment source was accepted".into());
    }
    create_ai_action_draft(ctx, fixture.organization_id, fixture.company_id, params.clone())?;
    let draft_id = ctx.db.ai_action_draft().iter().find(|row|
        row.organization_id == fixture.organization_id).ok_or("AG-03 draft missing")?.id;
    // All calls share a timestamp. Amount bits, not updated_at alone, must
    // invalidate the preview even under this same-timestamp mutation.
    update_payment_transaction(ctx, fixture.organization_id, payment.id, UpdatePaymentTransactionParams {
        external_reference: None, gross_external_amount: Some(11.0), settlement_amount: Some(11.0),
        net_account_amount: Some(11.0), occurred_at: None, evidence_document_ids: None, metadata: None,
    })?;
    if !matches!(approve_ai_action_draft(ctx, fixture.organization_id, fixture.company_id, draft_id),
        Err(error) if error.contains("stale")) {
        return Err("AG-03 stale source did not block approval".into());
    }
    if create_ai_action_draft(ctx, fixture.organization_id, fixture.company_id, params.clone()).is_ok() {
        return Err("AG-03 stale source did not block draft creation".into());
    }
    let draft = ctx.db.ai_action_draft().id().find(&draft_id).ok_or("AG-03 draft disappeared")?;
    if draft.status != "pending" || draft.executed_at.is_some() || draft.reviewed_by.is_some()
        || ctx.db.project_task().iter().any(|row| row.organization_id == fixture.organization_id)
        || ctx.db.audit_log().iter().any(|row| row.organization_id == fixture.organization_id
            && row.table_name == "ai_action_draft" && row.action == "EXECUTE") {
        return Err("AG-03 stale rejection left a business, review, or audit effect".into());
    }
    let current = ctx.db.payment_transaction().id().find(&payment.id).ok_or("AG-03 payment missing")?;
    params.metadata = Some(serde_json::json!({"payment_source": {
        "id": current.id, "snapshot_hash": payment_source_snapshot_hash(&current),
    }}).to_string());
    params.summary = "AG-03 fresh payment follow-up".into();
    create_ai_action_draft(ctx, fixture.organization_id, fixture.company_id, params)?;
    let fresh_id = ctx.db.ai_action_draft().iter().find(|row| row.organization_id == fixture.organization_id
        && row.id != draft_id).ok_or("AG-03 fresh draft missing")?.id;
    approve_ai_action_draft(ctx, fixture.organization_id, fixture.company_id, fresh_id)?;
    if ctx.db.project_task().iter().filter(|row| row.organization_id == fixture.organization_id).count() != 1 {
        return Err("AG-03 fresh source did not execute exactly one task".into());
    }
    Ok(())
}

pub fn test_execution_claim_is_exclusive(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run = seed_run(ctx, &fixture);
    let params = ClaimAiCapabilityExecutionParams {
        company_id: fixture.company_id, run_id: run.id,
        recovery_key: "ag09-exclusive-claim".into(), capability: "erp.search".into(),
    };
    claim_ai_capability_execution(ctx, fixture.organization_id, params.clone())?;
    if claim_ai_capability_execution(ctx, fixture.organization_id, params.clone()).is_ok() {
        return Err("AG-09 a second worker acquired the same unresolved claim".into());
    }
    record_ai_capability_execution_result(ctx, fixture.organization_id, RecordAiCapabilityExecutionResultParams {
        recovery_key: params.recovery_key.clone(), status: "succeeded".into(),
        output_json: Some("{}".into()), output_hash: Some(format!("{:x}", Sha256::digest(b"{}"))), failure_reason: None,
    })?;
    if claim_ai_capability_execution(ctx, fixture.organization_id, params).is_ok()
        || ctx.db.ai_capability_execution().iter().filter(|row| row.run_id == run.id).count() != 1 {
        return Err("AG-09 a terminal row allowed a second claim or duplicate execution row".into());
    }
    Ok(())
}
