//! Phase 4 reducer invariants. This superuser fixture is not an RBAC or
//! ordinary-operator acceptance proof; no new test reducers/contracts.
use sha2::{Digest, Sha256};
use spacetimedb::{Identity, ReducerContext, Table};

use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::accounting::payment_management::{
    allocate_payment_transaction, create_payment_account, create_payment_transaction,
    payment_account, payment_reconciliation, payment_reversal, payment_transaction,
    post_payment_transaction, update_payment_transaction, AllocatePaymentParams,
    CreatePaymentAccountParams, CreatePaymentTransactionParams, UpdatePaymentTransactionParams,
};
use crate::accounting::payments::account_payment;
use crate::accounting_tests::helpers::{create_balanced_customer_invoice, seed_bank_journal};
use crate::ai::action_drafts::{
    ai_action_draft, ai_action_draft_request, approve_ai_action_draft, create_ai_action_draft,
    create_ai_run_action_draft, payment_reversal_source_snapshot_hash,
    payment_source_snapshot_hash, update_ai_action_draft_params, CreateAiActionDraftParams,
    UpdateAiActionDraftParamsParams,
};
use crate::ai::capability_execution::{
    ai_capability_execution, claim_ai_capability_execution, record_ai_capability_execution_result,
    ClaimAiCapabilityExecutionParams, RecordAiCapabilityExecutionResultParams,
};
use crate::ai::reducer_allowlist::{
    ai_reducer_allowlist, create_ai_reducer_allowlist, CreateAiReducerAllowlistParams,
};
use crate::ai::skills::{ai_agent_run, AiAgentRun};
use crate::core::audit::audit_log;
use crate::core::permissions::{role, Role};
use crate::projects::tasks::project_task;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{PartnerType, PaymentDirection, PaymentProviderCode, PaymentTransactionStatus};
use crate::workflow::action_registry::{GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION};
use crate::workflow::approvals::workflow_human_task;
use crate::workflow::definitions::{
    create_workflow, publish_workflow_version, upsert_workflow_edge, upsert_workflow_node,
    workflow, workflow_version, CreateWorkflowParams, UpsertWorkflowEdgeParams,
    UpsertWorkflowNodeParams, WorkflowActionReference, WorkflowBranchKind, WorkflowHumanTaskKind,
    WorkflowNodeKind, WorkflowTaskAssignment, WorkflowTaskPolicy, WorkflowTrigger,
};

fn allow_task(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<(), String> {
    if let Some(existing) = ctx.db.ai_reducer_allowlist().iter().find(|row| {
        row.organization_id == fixture.organization_id && row.reducer_name == "create_task"
    }) {
        if existing.enabled
            && existing.permission_resource == "project_task"
            && existing.permission_action == "create"
        {
            return Ok(());
        }
        return Err("phase4 create_task allowlist fixture has unexpected authority".into());
    }
    create_ai_reducer_allowlist(
        ctx,
        fixture.organization_id,
        CreateAiReducerAllowlistParams {
            reducer_name: "create_task".into(),
            permission_resource: "project_task".into(),
            permission_action: "create".into(),
            enabled: true,
            metadata: None,
        },
    )
}

fn task_params(marker: &str) -> CreateAiActionDraftParams {
    CreateAiActionDraftParams {
        reducer_name: "create_task".into(),
        params_json: serde_json::json!({"name": marker}).to_string(),
        summary: marker.into(),
        confidence: 1.0,
        elevated: false,
        warnings_json: None,
        source_query: None,
        ui_context_json: None,
        expires_at: None,
        metadata: None,
    }
}

fn seed_run(ctx: &ReducerContext, fixture: &OrgFixture) -> AiAgentRun {
    ctx.db.ai_agent_run().insert(AiAgentRun {
        id: 0,
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        skill_id: 1,
        skill_config_id: None,
        agent_id: 1,
        team_member_id: None,
        run_key: format!("phase4:{}", fixture.organization_id),
        status: "running".into(),
        inputs_json: "{}".into(),
        summary: None,
        artifacts_json: None,
        citations_json: None,
        action_draft_ids: vec![],
        step_count: 0,
        tokens_used: 0,
        error_message: None,
        triggered_by_hex: ctx.sender().to_hex().to_string(),
        started_at: ctx.timestamp,
        completed_at: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: None,
    })
}

pub fn test_correlated_draft_replay(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    allow_task(ctx, &fixture)?;
    let run = seed_run(ctx, &fixture);
    let params = task_params("AG-04 correlated draft");
    let create = |params| {
        create_ai_run_action_draft(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            run.id,
            "ag04-replay".into(),
            params,
        )
    };
    create(params.clone())?;
    let link = ctx
        .db
        .ai_action_draft_request()
        .iter()
        .find(|row| row.run_id == run.id)
        .ok_or("AG-04 request link missing")?;
    let initial_audits = ctx
        .db
        .audit_log()
        .iter()
        .filter(|row| {
            row.organization_id == fixture.organization_id && row.table_name == "ai_action_draft"
        })
        .count();
    for _ in 0..3 {
        create(params.clone())?;
    }
    let mut changed = params.clone();
    changed.params_json = serde_json::json!({"name": "conflicting effect"}).to_string();
    if !matches!(create(changed), Err(error) if error.contains("different draft payload")) {
        return Err("AG-04 conflicting replay was not rejected".into());
    }
    let persisted = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&run.id)
        .ok_or("AG-04 run missing")?;
    ctx.db.ai_agent_run().id().update(AiAgentRun {
        status: "completed".into(),
        ..persisted
    });
    create(params.clone())?; // A committed replay still resolves after terminal state.
    if create_ai_run_action_draft(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run.id,
        "ag04-new".into(),
        params,
    )
    .is_ok()
    {
        return Err("AG-04 terminal run accepted a new draft".into());
    }
    let drafts: Vec<_> = ctx
        .db
        .ai_action_draft()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .collect();
    let requests: Vec<_> = ctx
        .db
        .ai_action_draft_request()
        .iter()
        .filter(|row| row.run_id == run.id)
        .collect();
    let persisted = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&run.id)
        .ok_or("AG-04 run missing")?;
    if drafts.len() != 1
        || requests.len() != 1
        || drafts[0].id != link.draft_id
        || drafts[0].status != "pending"
        || drafts[0].executed_at.is_some()
        || persisted.action_draft_ids != vec![link.draft_id]
    {
        return Err("AG-04 replay changed the draft, correlation, or run binding".into());
    }
    if ctx
        .db
        .project_task()
        .iter()
        .any(|row| row.organization_id == fixture.organization_id)
        || ctx
            .db
            .audit_log()
            .iter()
            .filter(|row| {
                row.organization_id == fixture.organization_id
                    && row.table_name == "ai_action_draft"
            })
            .count()
            != initial_audits
    {
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
    create_payment_account(
        ctx,
        fixture.organization_id,
        CreatePaymentAccountParams {
            company_id: fixture.company_id,
            provider_code: PaymentProviderCode::Cash,
            name: "AG-03 source wallet".into(),
            provider_label: None,
            reference_raw: None,
            currency_id: fixture.currency_id,
            account_journal_id: journal_id,
            fee_account_id: None,
            clearing_account_id: None,
            is_primary: true,
            metadata: None,
        },
    )?;
    let account_id = ctx
        .db
        .payment_account()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or("AG-03 wallet missing")?
        .id;
    create_payment_transaction(
        ctx,
        fixture.organization_id,
        CreatePaymentTransactionParams {
            company_id: fixture.company_id,
            payment_account_id: account_id,
            direction: PaymentDirection::Inbound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            external_reference: Some("AG-03-source".into()),
            gross_external_amount: 10.0,
            settlement_amount: 10.0,
            net_account_amount: 10.0,
            currency_id: fixture.currency_id,
            occurred_at: Some(ctx.timestamp),
            source_entity: None,
            source_entity_id: None,
            evidence_document_ids: vec![],
            metadata: None,
        },
    )?;
    let payment = ctx
        .db
        .payment_transaction()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or("AG-03 payment missing")?;
    let source_hash = payment_source_snapshot_hash(&payment);
    let mut params = task_params("AG-03 payment follow-up");
    params.metadata = Some(
        serde_json::json!({"payment_source": {
            "id": payment.id, "snapshot_hash": source_hash,
        }})
        .to_string(),
    );
    if create_ai_action_draft(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        params.clone(),
    )
    .is_ok()
    {
        return Err("AG-03 foreign payment source was accepted".into());
    }
    create_ai_action_draft(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        params.clone(),
    )?;
    let draft_id = ctx
        .db
        .ai_action_draft()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or("AG-03 draft missing")?
        .id;
    // All calls share a timestamp. Amount bits, not updated_at alone, must
    // invalidate the preview even under this same-timestamp mutation.
    update_payment_transaction(
        ctx,
        fixture.organization_id,
        payment.id,
        UpdatePaymentTransactionParams {
            external_reference: None,
            gross_external_amount: Some(11.0),
            settlement_amount: Some(11.0),
            net_account_amount: Some(11.0),
            occurred_at: Some(ctx.timestamp),
            evidence_document_ids: None,
            metadata: None,
        },
    )?;
    if !matches!(approve_ai_action_draft(ctx, fixture.organization_id, fixture.company_id, draft_id),
        Err(error) if error.contains("stale"))
    {
        return Err("AG-03 stale source did not block approval".into());
    }
    if create_ai_action_draft(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        params.clone(),
    )
    .is_ok()
    {
        return Err("AG-03 stale source did not block draft creation".into());
    }
    let draft = ctx
        .db
        .ai_action_draft()
        .id()
        .find(&draft_id)
        .ok_or("AG-03 draft disappeared")?;
    if draft.status != "pending"
        || draft.executed_at.is_some()
        || draft.reviewed_by.is_some()
        || ctx
            .db
            .project_task()
            .iter()
            .any(|row| row.organization_id == fixture.organization_id)
        || ctx.db.audit_log().iter().any(|row| {
            row.organization_id == fixture.organization_id
                && row.table_name == "ai_action_draft"
                && row.action == "EXECUTE"
        })
    {
        return Err("AG-03 stale rejection left a business, review, or audit effect".into());
    }
    let current = ctx
        .db
        .payment_transaction()
        .id()
        .find(&payment.id)
        .ok_or("AG-03 payment missing")?;
    params.metadata = Some(
        serde_json::json!({"payment_source": {
            "id": current.id, "snapshot_hash": payment_source_snapshot_hash(&current),
        }})
        .to_string(),
    );
    params.summary = "AG-03 fresh payment follow-up".into();
    create_ai_action_draft(ctx, fixture.organization_id, fixture.company_id, params)?;
    let fresh_id = ctx
        .db
        .ai_action_draft()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.id != draft_id)
        .ok_or("AG-03 fresh draft missing")?
        .id;
    approve_ai_action_draft(ctx, fixture.organization_id, fixture.company_id, fresh_id)?;
    if ctx
        .db
        .project_task()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .count()
        != 1
    {
        return Err("AG-03 fresh source did not execute exactly one task".into());
    }
    Ok(())
}

struct ReversalCase {
    fixture: OrgFixture,
    payment_id: u64,
    invoice_id: u64,
    invoice_line_id: u64,
    ledger_payment_id: u64,
}

fn allow_reversal(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<(), String> {
    if let Some(existing) = ctx.db.ai_reducer_allowlist().iter().find(|row| {
        row.organization_id == fixture.organization_id
            && row.reducer_name == "reverse_payment_transaction"
    }) {
        if existing.enabled
            && existing.permission_resource == "payment_transaction"
            && existing.permission_action == "reverse"
        {
            return Ok(());
        }
        return Err("phase4 reversal allowlist fixture has unexpected authority".into());
    }
    create_ai_reducer_allowlist(
        ctx,
        fixture.organization_id,
        CreateAiReducerAllowlistParams {
            reducer_name: "reverse_payment_transaction".into(),
            permission_resource: "payment_transaction".into(),
            permission_action: "reverse".into(),
            enabled: true,
            metadata: None,
        },
    )
}

fn seed_reversal_case(ctx: &ReducerContext, marker: &str) -> Result<ReversalCase, String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    allow_reversal(ctx, &fixture)?;
    let (journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    create_payment_account(
        ctx,
        fixture.organization_id,
        CreatePaymentAccountParams {
            company_id: fixture.company_id,
            provider_code: PaymentProviderCode::Cash,
            name: format!("AG-03 reversal wallet {marker}"),
            provider_label: None,
            reference_raw: None,
            currency_id: fixture.currency_id,
            account_journal_id: journal_id,
            fee_account_id: None,
            clearing_account_id: None,
            is_primary: true,
            metadata: None,
        },
    )?;
    let account_id = ctx
        .db
        .payment_account()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .max_by_key(|row| row.id)
        .ok_or("AG-03 reversal wallet missing")?
        .id;
    create_payment_transaction(
        ctx,
        fixture.organization_id,
        CreatePaymentTransactionParams {
            company_id: fixture.company_id,
            payment_account_id: account_id,
            direction: PaymentDirection::Inbound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            external_reference: Some(format!("AG-03-{marker}")),
            gross_external_amount: 100.0,
            settlement_amount: 100.0,
            net_account_amount: 100.0,
            currency_id: fixture.currency_id,
            occurred_at: Some(ctx.timestamp),
            source_entity: None,
            source_entity_id: None,
            evidence_document_ids: vec![],
            metadata: None,
        },
    )?;
    let payment_id = ctx
        .db
        .payment_transaction()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .max_by_key(|row| row.id)
        .ok_or("AG-03 reversal payment missing")?
        .id;
    post_payment_transaction(ctx, fixture.organization_id, payment_id)?;
    let payment = ctx
        .db
        .payment_transaction()
        .id()
        .find(&payment_id)
        .ok_or("AG-03 posted payment missing")?;
    let ledger_payment_id = payment
        .account_payment_id
        .ok_or("AG-03 posted payment has no ledger payment")?;
    let invoice_id = create_balanced_customer_invoice(ctx, &fixture, 100.0, true)?;
    let invoice_line_id = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_id)
        .find(|line| line.account_internal_type.as_deref() == Some("Receivable"))
        .or_else(|| {
            ctx.db
                .account_move_line()
                .move_line_by_move()
                .filter(&invoice_id)
                .find(|line| {
                    line.account_internal_type
                        .as_deref()
                        .is_some_and(|kind| kind.eq_ignore_ascii_case("receivable"))
                })
        })
        .ok_or("AG-03 invoice receivable line missing")?
        .id;
    Ok(ReversalCase {
        fixture,
        payment_id,
        invoice_id,
        invoice_line_id,
        ledger_payment_id,
    })
}

fn reversal_draft_params(
    ctx: &ReducerContext,
    case: &ReversalCase,
    reason: &str,
) -> Result<CreateAiActionDraftParams, String> {
    let payment = ctx
        .db
        .payment_transaction()
        .id()
        .find(&case.payment_id)
        .ok_or("AG-03 reversal source disappeared")?;
    let snapshot_hash = payment_reversal_source_snapshot_hash(ctx, &payment)?;
    Ok(CreateAiActionDraftParams {
        reducer_name: "reverse_payment_transaction".into(),
        params_json: serde_json::json!({
            "company_id": case.fixture.company_id,
            "transaction_id": case.payment_id,
            "reason": reason,
        })
        .to_string(),
        summary: format!("Reverse payment {}", case.payment_id),
        confidence: 1.0,
        elevated: true,
        warnings_json: None,
        source_query: None,
        ui_context_json: None,
        expires_at: None,
        metadata: Some(
            serde_json::json!({
                "risk": "red",
                "skill_key": "ag03-payment-reversal",
                "skill_version": "1",
                "policy_decision_hash": "ag03-policy",
                "source_snapshot_hash": snapshot_hash,
                "diff_hash": "ag03-reversal-diff",
                "required_approver_permission": "payment_transaction:reverse",
                "correction_plan": "reverse the compensating entry through the ordinary accounting route",
                "payment_reversal_source": {
                    "company_id": case.fixture.company_id,
                    "transaction_id": case.payment_id,
                    "snapshot_hash": snapshot_hash,
                },
            })
            .to_string(),
        ),
    })
}

fn latest_draft_id(ctx: &ReducerContext, organization_id: u64) -> Result<u64, String> {
    ctx.db
        .ai_action_draft()
        .ai_action_draft_by_org()
        .filter(&organization_id)
        .max_by_key(|draft| draft.id)
        .map(|draft| draft.id)
        .ok_or("AG-03 reversal draft missing".to_string())
}

fn set_independent_proposer(ctx: &ReducerContext, draft_id: u64) -> Result<(), String> {
    let draft = ctx
        .db
        .ai_action_draft()
        .id()
        .find(&draft_id)
        .ok_or("AG-03 reversal draft disappeared")?;
    let first = Identity::from_byte_array([0xa5; 32]);
    let proposed_by = if first == ctx.sender() {
        Identity::from_byte_array([0x5a; 32])
    } else {
        first
    };
    ctx.db
        .ai_action_draft()
        .id()
        .update(crate::ai::action_drafts::AiActionDraft {
            proposed_by,
            ..draft
        });
    Ok(())
}

fn invoice_residual(ctx: &ReducerContext, case: &ReversalCase) -> Result<f64, String> {
    ctx.db
        .account_move()
        .id()
        .find(&case.invoice_id)
        .map(|invoice| invoice.amount_residual)
        .ok_or("AG-03 invoice disappeared".to_string())
}

fn payment_clearing_residual(ctx: &ReducerContext, case: &ReversalCase) -> Result<f64, String> {
    let ledger_payment = ctx
        .db
        .account_payment()
        .id()
        .find(&case.ledger_payment_id)
        .ok_or("AG-03 ledger payment disappeared")?;
    let move_id = ledger_payment
        .move_id
        .ok_or("AG-03 ledger payment move missing")?;
    Ok(ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .filter(|line| {
            line.account_internal_type.as_deref().is_some_and(|kind| {
                kind.eq_ignore_ascii_case("receivable") || kind.eq_ignore_ascii_case("payable")
            })
        })
        .map(|line| line.amount_residual.abs())
        .sum())
}

pub fn test_payment_reversal_draft_is_bound_and_idempotent(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let case = seed_reversal_case(ctx, "bound")?;
    let foreign = seed_reversal_case(ctx, "foreign")?;
    let base = reversal_draft_params(ctx, &case, "customer payment correction")?;

    let mut bypass = base.clone();
    bypass.params_json = serde_json::json!({
        "company_id": case.fixture.company_id,
        "transaction_id": case.payment_id,
        "reason": "customer payment correction",
        "skip_approval_check": true,
    })
    .to_string();
    if create_ai_action_draft(
        ctx,
        case.fixture.organization_id,
        case.fixture.company_id,
        bypass,
    )
    .is_ok()
    {
        return Err("AG-03 reversal draft accepted an approval-bypass field".into());
    }
    let mut retargeted = base.clone();
    retargeted.params_json = serde_json::json!({
        "company_id": case.fixture.company_id,
        "transaction_id": case.payment_id + 1,
        "reason": "customer payment correction",
    })
    .to_string();
    if create_ai_action_draft(
        ctx,
        case.fixture.organization_id,
        case.fixture.company_id,
        retargeted,
    )
    .is_ok()
    {
        return Err("AG-03 reversal draft accepted a retargeted payload".into());
    }
    if create_ai_action_draft(
        ctx,
        foreign.fixture.organization_id,
        foreign.fixture.company_id,
        base.clone(),
    )
    .is_ok()
    {
        return Err("AG-03 reversal draft accepted a cross-scope source".into());
    }

    create_ai_action_draft(
        ctx,
        case.fixture.organization_id,
        case.fixture.company_id,
        base.clone(),
    )?;
    let retargeted_draft_id = latest_draft_id(ctx, case.fixture.organization_id)?;
    update_ai_action_draft_params(
        ctx,
        case.fixture.organization_id,
        case.fixture.company_id,
        retargeted_draft_id,
        UpdateAiActionDraftParamsParams {
            params_json: serde_json::json!({
                "company_id": case.fixture.company_id,
                "transaction_id": case.payment_id + 1,
                "reason": "customer payment correction",
            })
            .to_string(),
            summary: None,
        },
    )?;
    set_independent_proposer(ctx, retargeted_draft_id)?;
    if !matches!(
        approve_ai_action_draft(
            ctx,
            case.fixture.organization_id,
            case.fixture.company_id,
            retargeted_draft_id,
        ),
        Err(error) if error.contains("does not match")
    ) {
        return Err("AG-03 pending draft retargeting was not rejected".into());
    }

    create_ai_action_draft(
        ctx,
        case.fixture.organization_id,
        case.fixture.company_id,
        base,
    )?;
    let stale_draft_id = latest_draft_id(ctx, case.fixture.organization_id)?;
    set_independent_proposer(ctx, stale_draft_id)?;
    allocate_payment_transaction(
        ctx,
        case.fixture.organization_id,
        AllocatePaymentParams {
            idempotency_key: format!("ag03-stale-allocation:{}", case.payment_id),
            company_id: case.fixture.company_id,
            payment_transaction_id: case.payment_id,
            allocated_move_line_id: case.invoice_line_id,
            allocated_amount: 40.0,
            currency_id: case.fixture.currency_id,
            write_off_amount: 0.0,
            write_off_account_id: None,
            metadata: None,
        },
    )?;
    if !matches!(
        approve_ai_action_draft(
            ctx,
            case.fixture.organization_id,
            case.fixture.company_id,
            stale_draft_id,
        ),
        Err(error) if error.contains("stale")
    ) {
        return Err("AG-03 stale allocation did not block reversal approval".into());
    }
    if ctx
        .db
        .payment_reversal()
        .reversal_by_original()
        .filter(&case.payment_id)
        .count()
        != 0
        || ctx.db.payment_transaction().iter().any(|row| {
            row.organization_id == case.fixture.organization_id
                && row.source_entity.as_deref() == Some("reversal")
                && row.source_entity_id == Some(case.payment_id)
        })
        || (invoice_residual(ctx, &case)? - 60.0).abs() > 0.001
    {
        return Err("AG-03 stale allocation rejection left a reversal effect".into());
    }

    let fresh = reversal_draft_params(ctx, &case, "customer payment correction")?;
    create_ai_action_draft(
        ctx,
        case.fixture.organization_id,
        case.fixture.company_id,
        fresh,
    )?;
    let fresh_draft_id = latest_draft_id(ctx, case.fixture.organization_id)?;
    if !matches!(
        approve_ai_action_draft(
            ctx,
            case.fixture.organization_id,
            case.fixture.company_id,
            fresh_draft_id,
        ),
        Err(error) if error.contains("different approver")
    ) {
        return Err("AG-03 reversal draft did not require independent approval".into());
    }
    set_independent_proposer(ctx, fresh_draft_id)?;
    approve_ai_action_draft(
        ctx,
        case.fixture.organization_id,
        case.fixture.company_id,
        fresh_draft_id,
    )?;

    let reversal = ctx
        .db
        .payment_reversal()
        .reversal_by_original()
        .filter(&case.payment_id)
        .next()
        .ok_or("AG-03 committed reversal record missing")?;
    let draft = ctx
        .db
        .ai_action_draft()
        .id()
        .find(&fresh_draft_id)
        .ok_or("AG-03 approved draft missing")?;
    let original = ctx
        .db
        .payment_transaction()
        .id()
        .find(&case.payment_id)
        .ok_or("AG-03 reversed source missing")?;
    let reconciliation_rows: Vec<_> = ctx
        .db
        .payment_reconciliation()
        .reconciliation_by_transaction()
        .filter(&case.payment_id)
        .collect();
    let net_allocation: f64 = reconciliation_rows
        .iter()
        .map(|row| row.allocated_amount)
        .sum();
    if draft.status != "approved"
        || draft.execution_record_id != Some(reversal.id)
        || original.status != PaymentTransactionStatus::Reversed
        || (invoice_residual(ctx, &case)? - 100.0).abs() > 0.001
        || (payment_clearing_residual(ctx, &case)? - 100.0).abs() > 0.001
        || net_allocation.abs() > 0.001
        || reconciliation_rows.len() != 2
    {
        return Err("AG-03 committed reversal did not restore ledger/residual state".into());
    }
    let effect_counts = || {
        (
            ctx.db
                .payment_reversal()
                .reversal_by_original()
                .filter(&case.payment_id)
                .count(),
            ctx.db
                .payment_transaction()
                .iter()
                .filter(|row| {
                    row.organization_id == case.fixture.organization_id
                        && row.source_entity.as_deref() == Some("reversal")
                        && row.source_entity_id == Some(case.payment_id)
                })
                .count(),
            ctx.db
                .audit_log()
                .iter()
                .filter(|row| {
                    row.organization_id == case.fixture.organization_id
                        && row.table_name == "ai_action_draft"
                        && row.record_id == fresh_draft_id
                        && row.action == "EXECUTE"
                })
                .count(),
        )
    };
    if effect_counts() != (1, 1, 1) {
        return Err("AG-03 fresh reversal did not create exactly one compensating effect".into());
    }
    approve_ai_action_draft(
        ctx,
        case.fixture.organization_id,
        case.fixture.company_id,
        fresh_draft_id,
    )?;
    if effect_counts() != (1, 1, 1) {
        return Err("AG-03 committed draft retry duplicated reversal effects".into());
    }
    Ok(())
}

pub fn test_payment_reversal_draft_preserves_finance_workflow(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let case = seed_reversal_case(ctx, "workflow")?;
    seed_reversal_approval_workflow(ctx, &case.fixture)?;
    let params = reversal_draft_params(ctx, &case, "finance workflow proof")?;
    create_ai_action_draft(
        ctx,
        case.fixture.organization_id,
        case.fixture.company_id,
        params,
    )?;
    let draft_id = latest_draft_id(ctx, case.fixture.organization_id)?;
    set_independent_proposer(ctx, draft_id)?;
    if !matches!(
        approve_ai_action_draft(
            ctx,
            case.fixture.organization_id,
            case.fixture.company_id,
            draft_id,
        ),
        Err(error) if error.contains("finance workflow approval")
    ) {
        return Err("AG-03 draft route did not stop for the finance workflow".into());
    }
    if ctx
        .db
        .payment_reversal()
        .reversal_by_original()
        .filter(&case.payment_id)
        .count()
        != 0
        || ctx.db.payment_transaction().iter().any(|row| {
            row.organization_id == case.fixture.organization_id
                && row.source_entity.as_deref() == Some("reversal")
                && row.source_entity_id == Some(case.payment_id)
        })
        || ctx.db.workflow_human_task().iter().any(|task| {
            task.organization_id == case.fixture.organization_id
                && task.company_id == case.fixture.company_id
        })
    {
        return Err("AG-03 finance-workflow preflight left an unauthorized effect".into());
    }
    Ok(())
}

fn seed_reversal_approval_workflow(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
) -> Result<(), String> {
    let role_id = ctx
        .db
        .role()
        .role_by_org()
        .filter(&fixture.organization_id)
        .find(|role| role.is_active)
        .map(|role| role.id)
        .unwrap_or_else(|| {
            ctx.db
                .role()
                .insert(Role {
                    id: 0,
                    organization_id: fixture.organization_id,
                    name: format!("AG-03 finance approver {}", fixture.company_id),
                    description: None,
                    parent_id: None,
                    permissions: vec!["workflow_task:approve".into()],
                    is_system: false,
                    is_active: true,
                    created_at: ctx.timestamp,
                    updated_at: ctx.timestamp,
                    metadata: Some(r#"{"test":"ag03"}"#.into()),
                })
                .id
        });
    let workflow_key = format!("ag03-reversal-approval-{}", fixture.company_id);
    create_workflow(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            workflow_key: workflow_key.clone(),
            model: "payment_transaction".into(),
            name: "AG-03 payment reversal approval".into(),
            description: None,
            trigger: WorkflowTrigger::Manual,
            schema_version: 1,
            snapshot_fields: Vec::new(),
            metadata: None,
        },
    )?;
    let definition = ctx
        .db
        .workflow()
        .workflow_by_key()
        .filter(&workflow_key)
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or("AG-03 reversal workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&definition.id)
        .find(|row| row.version == 1)
        .ok_or("AG-03 reversal workflow version missing")?;
    let node = |key: &str,
                kind: WorkflowNodeKind,
                sequence: u32,
                task_policy: Option<WorkflowTaskPolicy>,
                action: Option<WorkflowActionReference>| UpsertWorkflowNodeParams {
        node_key: key.into(),
        name: key.into(),
        kind,
        sequence,
        split_kind: WorkflowBranchKind::None,
        join_kind: WorkflowBranchKind::None,
        action,
        task_policy,
        timer_policy: None,
        retry_policy: None,
        subflow: None,
        metadata: Some(r#"{"test":"ag03"}"#.into()),
    };
    let mut revision = version.draft_revision;
    for params in [
        node("start", WorkflowNodeKind::Start, 1, None, None),
        node(
            "approve",
            WorkflowNodeKind::HumanTask,
            2,
            Some(WorkflowTaskPolicy {
                kind: WorkflowHumanTaskKind::ApproveReject,
                assignment: WorkflowTaskAssignment::AnyCandidate,
                candidate_role_ids: vec![role_id],
                candidate_group_ids: Vec::new(),
                candidate_unit_ids: Vec::new(),
                require_comment_on_reject: true,
            }),
            None,
        ),
        node(
            "reverse",
            WorkflowNodeKind::Action,
            3,
            None,
            Some(WorkflowActionReference {
                action_key: GuardedActionKey::ReversePaymentTransaction.as_str().into(),
                input_schema_version: GUARDED_ACTION_SCHEMA_VERSION,
                input: Vec::new(),
            }),
        ),
        node("done", WorkflowNodeKind::End, 4, None, None),
        node("rejected", WorkflowNodeKind::End, 5, None, None),
    ] {
        upsert_workflow_node(ctx, fixture.organization_id, version.id, revision, params)?;
        revision += 1;
    }
    let edge = |key: &str, from: &str, to: &str, sequence: u32, signal: Option<&str>| {
        UpsertWorkflowEdgeParams {
            edge_key: key.into(),
            from_node_key: from.into(),
            to_node_key: to.into(),
            sequence,
            signal_key: signal.map(str::to_string),
            condition: None,
            metadata: Some(r#"{"test":"ag03"}"#.into()),
        }
    };
    for params in [
        edge("start-approve", "start", "approve", 1, None),
        edge("approve-reverse", "approve", "reverse", 2, Some("approved")),
        edge(
            "approve-rejected",
            "approve",
            "rejected",
            3,
            Some("rejected"),
        ),
        edge("reverse-done", "reverse", "done", 4, None),
    ] {
        upsert_workflow_edge(ctx, fixture.organization_id, version.id, revision, params)?;
        revision += 1;
    }
    publish_workflow_version(ctx, fixture.organization_id, version.id, revision)
}

pub fn test_execution_claim_is_exclusive(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run = seed_run(ctx, &fixture);
    let params = ClaimAiCapabilityExecutionParams {
        company_id: fixture.company_id,
        run_id: run.id,
        recovery_key: "ag09-exclusive-claim".into(),
        capability: "erp.search".into(),
    };
    claim_ai_capability_execution(ctx, fixture.organization_id, params.clone())?;
    if claim_ai_capability_execution(ctx, fixture.organization_id, params.clone()).is_ok() {
        return Err("AG-09 a second worker acquired the same unresolved claim".into());
    }
    record_ai_capability_execution_result(
        ctx,
        fixture.organization_id,
        RecordAiCapabilityExecutionResultParams {
            recovery_key: params.recovery_key.clone(),
            status: "succeeded".into(),
            output_json: Some("{}".into()),
            output_hash: Some(format!("{:x}", Sha256::digest(b"{}"))),
            failure_reason: None,
        },
    )?;
    if claim_ai_capability_execution(ctx, fixture.organization_id, params).is_ok()
        || ctx
            .db
            .ai_capability_execution()
            .iter()
            .filter(|row| row.run_id == run.id)
            .count()
            != 1
    {
        return Err(
            "AG-09 a terminal row allowed a second claim or duplicate execution row".into(),
        );
    }
    Ok(())
}
