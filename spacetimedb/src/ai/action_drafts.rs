//! AI action drafts — human-approved ERP mutations proposed by the harness.

use std::collections::BTreeSet;

use serde_json::Value;
use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::{account_move, account_move_line, AccountMoveLine};
use crate::accounting::payment_management::{
    payment_account, payment_fee, payment_reconciliation, payment_reversal, payment_transaction,
    reverse_payment_transaction_impl, PaymentTransaction, ReversePaymentTransactionParams,
};
use crate::accounting::payments::{account_payment, AccountPayment};
use crate::ai::action_draft_lifecycle::{
    on_draft_approved, on_draft_created, on_draft_expired, on_draft_rejected,
};
use crate::ai::reducer_allowlist::is_allowed_ai_reducer;
use crate::ai::skills::{ai_agent_run, AiAgentRun};
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::projects::tasks::{create_task, project_task, CreateTaskParams};
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, create_purchase_order, purchase_order, AddPurchaseOrderLineParams,
    CreatePurchaseOrderParams,
};
use crate::sales::sales_core::{
    create_sale_order, sale_order, CreateSaleOrderLineParams, CreateSaleOrderParams,
};
use crate::types::{PaymentTransactionStatus, TaskState};
use crate::workflow::action_registry::{
    GuardedActionInput, GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION,
};
use crate::workflow::approval_gate::guarded_action_requires_human_approval;

const DRAFT_TTL_SECS: u64 = 86_400;
const REQUEST_KEY_MAX_LEN: usize = 160;
const REVERSAL_REASON_MAX_LEN: usize = 500;
const REVERSE_PAYMENT_TRANSACTION: &str = "reverse_payment_transaction";
const SERVER_OWNED_REVERSAL_METADATA_FIELDS: [&str; 3] = [
    "approval_channel",
    "payment_reversal_source",
    "workflow_instance_id",
];
const ELEVATED_GOVERNANCE_FIELDS: [&str; 8] = [
    "risk",
    "skill_key",
    "skill_version",
    "policy_decision_hash",
    "source_snapshot_hash",
    "diff_hash",
    "required_approver_permission",
    "correction_plan",
];

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_action_draft,
    public,
    index(accessor = ai_action_draft_by_org, btree(columns = [organization_id])),
    index(accessor = ai_action_draft_by_company, btree(columns = [company_id])),
    index(accessor = ai_action_draft_by_status, btree(columns = [status]))
)]
pub struct AiActionDraft {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// pending | approved | rejected | failed | expired
    pub status: String,
    pub reducer_name: String,
    pub params_json: String,
    pub summary: String,
    pub confidence: f64,
    pub elevated: bool,
    pub warnings_json: Option<String>,
    pub source_query: Option<String>,
    pub ui_context_json: Option<String>,
    pub proposed_by: Identity,
    pub reviewed_by: Option<Identity>,
    pub reviewed_at: Option<Timestamp>,
    pub reject_reason: Option<String>,
    pub executed_at: Option<Timestamp>,
    pub execution_error: Option<String>,
    pub execution_record_id: Option<u64>,
    pub expires_at: Option<Timestamp>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Durable idempotency link between one H5 request and its draft.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_action_draft_request,
    index(accessor = ai_action_draft_request_by_org, btree(columns = [organization_id])),
    index(accessor = ai_action_draft_request_by_run, btree(columns = [run_id]))
)]
pub struct AiActionDraftRequest {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    /// Scoped request key; callers must not use this as a global identifier.
    pub request_key: String,
    pub draft_id: u64,
    /// SHA-256 of the complete immutable creation payload.
    pub creation_payload_hash: String,
    pub create_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiActionDraftParams {
    pub reducer_name: String,
    pub params_json: String,
    pub summary: String,
    pub confidence: f64,
    pub elevated: bool,
    pub warnings_json: Option<String>,
    pub source_query: Option<String>,
    pub ui_context_json: Option<String>,
    pub expires_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAiActionDraftParamsParams {
    pub params_json: String,
    pub summary: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_ai_action_draft(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateAiActionDraftParams,
) -> Result<(), String> {
    create_ai_action_draft_inner(ctx, organization_id, company_id, params).map(|_| ())
}

fn create_ai_action_draft_inner(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    mut params: CreateAiActionDraftParams,
) -> Result<AiActionDraft, String> {
    check_permission(ctx, organization_id, "ai_action_draft", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    let reducer_name = params.reducer_name.trim().to_string();
    if reducer_name.is_empty() {
        return Err("reducer_name is required".to_string());
    }
    is_allowed_ai_reducer(ctx, organization_id, &reducer_name)?;
    if params.params_json.trim().is_empty() {
        return Err("params_json is required".to_string());
    }
    if params.summary.trim().is_empty() {
        return Err("summary is required".to_string());
    }
    if !params.confidence.is_finite() || !(0.0..=1.0).contains(&params.confidence) {
        return Err("confidence must be finite and between 0 and 1".to_string());
    }
    bind_authoritative_reversal_source(
        ctx,
        organization_id,
        company_id,
        &reducer_name,
        &params.params_json,
        &mut params.metadata,
    )?;
    if params.elevated {
        validate_elevated_governance_metadata(params.metadata.as_deref())?;
    }
    validate_draft_payload_and_sources(
        ctx,
        organization_id,
        company_id,
        &reducer_name,
        &params.params_json,
        params.elevated,
        params.metadata.as_deref(),
    )?;

    let expires_at = params
        .expires_at
        .or_else(|| Some(ctx.timestamp + std::time::Duration::from_secs(DRAFT_TTL_SECS)));

    let row = ctx.db.ai_action_draft().insert(AiActionDraft {
        id: 0,
        organization_id,
        company_id,
        status: "pending".to_string(),
        reducer_name: reducer_name.clone(),
        params_json: params.params_json.clone(),
        summary: params.summary.clone(),
        confidence: params.confidence,
        elevated: params.elevated,
        warnings_json: params.warnings_json.clone(),
        source_query: params.source_query.clone(),
        ui_context_json: params.ui_context_json.clone(),
        proposed_by: ctx.sender(),
        reviewed_by: None,
        reviewed_at: None,
        reject_reason: None,
        executed_at: None,
        execution_error: None,
        execution_record_id: None,
        expires_at,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: params
            .metadata
            .or_else(|| Some(r#"{"approval_channel":"ai_action_draft"}"#.to_string())),
    });

    on_draft_created(ctx, &row);

    // Note: the guarded-action gate is checked inside `approve_ai_action_draft`
    // (like every other guarded action — confirm_sales_order, approve_leave,
    // approve_expense_sheet, etc.), not here at creation time. Requesting it
    // here as well would pre-create the human task, causing the later check
    // inside `approve_ai_action_draft` to always find that existing task and
    // short-circuit with `Ok(())` — leaving the draft stuck at "pending"
    // forever even when the approve call itself reports success.

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_action_draft",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "status": "pending",
                    "reducer_name": reducer_name,
                    "summary": params.summary,
                    "elevated": params.elevated,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "status".to_string(),
                "reducer_name".to_string(),
                "summary".to_string(),
            ],
            metadata: params
                .source_query
                .as_ref()
                .map(|q| serde_json::json!({ "source_query": q }).to_string()),
        },
    );

    Ok(row)
}

/// Create a draft and its durable request link atomically.
///
/// A retry with the same tenant/run/request key is an exact no-op only when the
/// immutable creation payload hash matches. The draft itself may have changed
/// state or been edited after creation; that does not alter the retry decision.
#[reducer]
pub fn create_ai_run_action_draft(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    request_key: String,
    params: CreateAiActionDraftParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_action_draft", "create")?;
    check_permission(ctx, organization_id, "ai_agent_run", "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    let request_key = request_key.trim();
    if request_key.is_empty() || request_key.len() > REQUEST_KEY_MAX_LEN {
        return Err(format!(
            "request_key must be 1..{REQUEST_KEY_MAX_LEN} bytes"
        ));
    }
    if !params.confidence.is_finite() || !(0.0..=1.0).contains(&params.confidence) {
        return Err("confidence must be finite and between 0 and 1".to_string());
    }
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&run_id)
        .ok_or("AI agent run not found")?;
    if run.organization_id != organization_id || run.company_id != company_id {
        return Err("AI agent run does not belong to this organization/company".to_string());
    }
    let payload_hash =
        creation_payload_hash(organization_id, company_id, run_id, request_key, &params);
    if let Some(existing) = ctx
        .db
        .ai_action_draft_request()
        .ai_action_draft_request_by_run()
        .filter(&run_id)
        .find(|link| {
            link.organization_id == organization_id
                && link.company_id == company_id
                && link.run_id == run_id
                && link.request_key == request_key
        })
    {
        if existing.creation_payload_hash == payload_hash {
            return Ok(());
        }
        return Err("request key is already bound to a different draft payload".to_string());
    }
    if run.status != "running" && run.status != "pending" {
        return Err("cannot create a new draft for a terminal AI agent run".to_string());
    }

    let draft = create_ai_action_draft_inner(ctx, organization_id, company_id, params)?;
    ctx.db
        .ai_action_draft_request()
        .insert(AiActionDraftRequest {
            id: 0,
            organization_id,
            company_id,
            run_id,
            request_key: request_key.to_string(),
            draft_id: draft.id,
            creation_payload_hash: payload_hash,
            create_date: ctx.timestamp,
        });
    let mut draft_ids = run.action_draft_ids;
    draft_ids.push(draft.id);
    ctx.db.ai_agent_run().id().update(AiAgentRun {
        action_draft_ids: draft_ids,
        write_date: ctx.timestamp,
        ..run
    });
    Ok(())
}

#[reducer]
pub fn update_ai_action_draft_params(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    draft_id: u64,
    params: UpdateAiActionDraftParamsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_action_draft", "write")?;

    let draft = load_mutable_draft(ctx, organization_id, company_id, draft_id)?;

    if draft.status != "pending" {
        return Err("only pending drafts can be edited".to_string());
    }
    if params.params_json.trim().is_empty() {
        return Err("params_json is required".to_string());
    }

    let updated = AiActionDraft {
        params_json: params.params_json,
        summary: params
            .summary
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(draft.summary),
        write_date: ctx.timestamp,
        ..draft
    };

    ctx.db.ai_action_draft().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_action_draft",
            record_id: draft_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "params_json": updated.params_json,
                    "summary": updated.summary,
                })
                .to_string(),
            ),
            changed_fields: vec!["params_json".to_string(), "summary".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn approve_ai_action_draft(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    draft_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_action_draft", "write")?;
    // `approve_ai_action_draft` IS the human-approval action for an AI action
    // draft — wrapping it in another guarded-action approval gate (as it
    // previously did) was circular: the seeded "ai-action-approval" workflow
    // gates this exact action unconditionally, so every call short-circuited
    // on `HumanTaskCreated` and `approve_ai_action_draft_core` was never
    // reached, leaving drafts stuck at "pending" forever. No other guarded
    // action gates its own approval step this way.
    approve_ai_action_draft_core(ctx, organization_id, company_id, draft_id)
}

pub fn approve_ai_action_draft_core(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    draft_id: u64,
) -> Result<(), String> {
    let draft = load_mutable_draft(ctx, organization_id, company_id, draft_id)?;

    if draft.status == "approved"
        && draft.reviewed_by == Some(ctx.sender())
        && draft.executed_at.is_some()
        && draft.execution_error.is_none()
    {
        return Ok(());
    }
    if draft.status != "pending" {
        return Err(format!("draft is not pending (status={})", draft.status));
    }
    if is_expired(ctx, &draft) {
        mark_expired(ctx, &draft);
        return Err("draft has expired".to_string());
    }
    if draft.elevated && draft.proposed_by == ctx.sender() {
        return Err("elevated drafts require a different approver than the proposer".to_string());
    }
    // Re-check allowlist on approve so emptying/disabling blocks pending drafts.
    is_allowed_ai_reducer(ctx, organization_id, &draft.reducer_name)?;
    // Compare the authoritative source in this reducer transaction, before
    // executing any business effect. A supplied hash never grants authority.
    validate_draft_payload_and_sources(
        ctx,
        organization_id,
        company_id,
        &draft.reducer_name,
        &draft.params_json,
        draft.elevated,
        draft.metadata.as_deref(),
    )?;

    let execution_result = execute_whitelisted_draft(ctx, organization_id, company_id, &draft);

    match execution_result {
        Ok(record_id) => {
            let draft_snapshot = serde_json::json!({
                "status": draft.status,
                "reducer_name": draft.reducer_name.clone(),
                "params_json": draft.params_json.clone(),
                "summary": draft.summary.clone(),
            });

            let updated = AiActionDraft {
                status: "approved".to_string(),
                reviewed_by: Some(ctx.sender()),
                reviewed_at: Some(ctx.timestamp),
                executed_at: Some(ctx.timestamp),
                execution_error: None,
                execution_record_id: record_id,
                write_date: ctx.timestamp,
                ..draft
            };
            ctx.db.ai_action_draft().id().update(updated.clone());

            on_draft_approved(ctx, &updated, record_id);

            write_audit_log_v2(
                ctx,
                organization_id,
                AuditLogParams {
                    company_id: Some(company_id),
                    table_name: "ai_action_draft",
                    record_id: draft_id,
                    action: "EXECUTE",
                    old_values: Some(draft_snapshot.to_string()),
                    new_values: Some(
                        serde_json::json!({
                            "reducer_name": updated.reducer_name,
                            "created_record_id": record_id,
                            "status": "approved",
                        })
                        .to_string(),
                    ),
                    changed_fields: vec!["status".to_string(), "executed_record_id".to_string()],
                    metadata: Some(updated.params_json.clone()),
                },
            );
            Ok(())
        }
        Err(err) => {
            let updated = AiActionDraft {
                status: "failed".to_string(),
                reviewed_by: Some(ctx.sender()),
                reviewed_at: Some(ctx.timestamp),
                execution_error: Some(err.clone()),
                write_date: ctx.timestamp,
                ..draft
            };
            ctx.db.ai_action_draft().id().update(updated);

            write_audit_log_v2(
                ctx,
                organization_id,
                AuditLogParams {
                    company_id: Some(company_id),
                    table_name: "ai_action_draft",
                    record_id: draft_id,
                    action: "UPDATE",
                    old_values: Some(serde_json::json!({ "status": "pending" }).to_string()),
                    new_values: Some(
                        serde_json::json!({ "status": "failed", "execution_error": err })
                            .to_string(),
                    ),
                    changed_fields: vec!["status".to_string(), "execution_error".to_string()],
                    metadata: None,
                },
            );

            Err(err)
        }
    }
}

#[reducer]
pub fn reject_ai_action_draft(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    draft_id: u64,
    reason: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_action_draft", "write")?;
    reject_ai_action_draft_core(ctx, organization_id, company_id, draft_id, &reason)
}

pub fn reject_ai_action_draft_core(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    draft_id: u64,
    reason: &str,
) -> Result<(), String> {
    let draft = load_mutable_draft(ctx, organization_id, company_id, draft_id)?;

    if draft.status != "pending" {
        return Err(format!("draft is not pending (status={})", draft.status));
    }

    let trimmed_reason = reason.trim().to_string();
    let reject_snapshot = serde_json::json!({
        "status": draft.status,
        "reducer_name": draft.reducer_name.clone(),
        "params_json": draft.params_json.clone(),
    });
    let updated = AiActionDraft {
        status: "rejected".to_string(),
        reviewed_by: Some(ctx.sender()),
        reviewed_at: Some(ctx.timestamp),
        reject_reason: if trimmed_reason.is_empty() {
            None
        } else {
            Some(trimmed_reason.clone())
        },
        write_date: ctx.timestamp,
        ..draft
    };
    ctx.db.ai_action_draft().id().update(updated.clone());

    on_draft_rejected(ctx, &updated, updated.reject_reason.as_deref());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_action_draft",
            record_id: draft_id,
            action: "REJECT",
            old_values: Some(reject_snapshot.to_string()),
            new_values: Some(
                serde_json::json!({
                    "status": "rejected",
                    "reject_reason": trimmed_reason,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string(), "reject_reason".to_string()],
            metadata: updated
                .reject_reason
                .as_ref()
                .map(|reason| serde_json::json!({ "reject_reason": reason }).to_string()),
        },
    );

    Ok(())
}

#[reducer]
pub fn expire_ai_action_drafts(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_action_draft", "write")?;

    let expired: Vec<AiActionDraft> = ctx
        .db
        .ai_action_draft()
        .ai_action_draft_by_company()
        .filter(&company_id)
        .filter(|draft| draft.organization_id == organization_id)
        .filter(|draft| draft.status == "pending")
        .filter(|draft| is_expired(ctx, draft))
        .collect();

    for draft in &expired {
        mark_expired(ctx, draft);
        on_draft_expired(ctx, draft);
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "ai_action_draft",
                record_id: draft.id,
                action: "UPDATE",
                old_values: Some(serde_json::json!({ "status": "pending" }).to_string()),
                new_values: Some(serde_json::json!({ "status": "expired" }).to_string()),
                changed_fields: vec!["status".to_string()],
                metadata: None,
            },
        );
    }

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────
//
// Execution registry: `execute_whitelisted_draft` dispatches known reducers via
// builder fns (`build_create_task_params`, etc.). To add a new reducer:
// 1. Add a builder + match arm in `execute_whitelisted_draft`
// 2. Add an `AiReducerAllowlist` row (empty org allowlists fail closed)
// 3. Ensure Casbin grants the target resource `create` permission

fn load_mutable_draft(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    draft_id: u64,
) -> Result<AiActionDraft, String> {
    let draft = ctx
        .db
        .ai_action_draft()
        .id()
        .find(&draft_id)
        .ok_or("Draft not found")?;

    if draft.organization_id != organization_id {
        return Err("Draft does not belong to this organization".to_string());
    }
    if draft.company_id != company_id {
        return Err("Draft does not belong to this company".to_string());
    }

    Ok(draft)
}

fn is_expired(ctx: &ReducerContext, draft: &AiActionDraft) -> bool {
    draft
        .expires_at
        .is_some_and(|expires| expires <= ctx.timestamp)
}

fn creation_payload_hash(
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    request_key: &str,
    params: &CreateAiActionDraftParams,
) -> String {
    let payload = serde_json::json!({
        "organization_id": organization_id,
        "company_id": company_id,
        "run_id": run_id,
        "request_key": request_key,
        "reducer_name": params.reducer_name.trim(),
        "params_json": params.params_json,
        "summary": params.summary,
        "confidence": params.confidence,
        "elevated": params.elevated,
        "warnings_json": params.warnings_json,
        "source_query": params.source_query,
        "ui_context_json": params.ui_context_json,
        "expires_at_micros": params.expires_at.map(|value| value.to_micros_since_unix_epoch()),
        "metadata": params.metadata,
    });
    let canonical = serde_json::to_vec(&payload).expect("JSON payload is serializable");
    let digest = Sha256::digest(canonical);
    format!("sha256:{digest:x}")
}

fn mark_expired(ctx: &ReducerContext, draft: &AiActionDraft) {
    if draft.status != "pending" {
        return;
    }
    ctx.db.ai_action_draft().id().update(AiActionDraft {
        status: "expired".to_string(),
        write_date: ctx.timestamp,
        ..draft.clone()
    });
}

/// Elevated drafts are the persisted boundary for red AI actions. Require the
/// policy decision, source/diff fingerprints, approver authorization, and a
/// correction plan before a draft can enter the human approval queue.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PaymentSourceBinding {
    id: u64,
    snapshot_hash: String,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ReversePaymentDraftPayload {
    company_id: u64,
    transaction_id: u64,
    reason: String,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PaymentReversalSourceBinding {
    company_id: u64,
    transaction_id: u64,
    snapshot_hash: String,
}

/// Bind reversal drafts to server-read source state at creation time. Callers
/// describe the intended target and governance decision, but cannot supply or
/// override the state fingerprint that later authorizes approval.
fn bind_authoritative_reversal_source(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    reducer_name: &str,
    params_json: &str,
    raw_metadata: &mut Option<String>,
) -> Result<(), String> {
    if reducer_name != REVERSE_PAYMENT_TRANSACTION {
        return Ok(());
    }
    let payload = parse_reverse_payment_draft_payload(params_json)?;
    if payload.company_id != company_id {
        return Err("reversal payload company_id does not match draft company scope".to_string());
    }
    let raw = raw_metadata
        .as_deref()
        .ok_or("payment reversal draft requires governance metadata")?;
    let mut metadata: Value = serde_json::from_str(raw)
        .map_err(|error| format!("invalid payment reversal governance metadata: {error}"))?;
    let object = metadata
        .as_object_mut()
        .ok_or("payment reversal governance metadata must be a JSON object")?;
    if let Some(field) = SERVER_OWNED_REVERSAL_METADATA_FIELDS
        .into_iter()
        .find(|field| object.contains_key(*field))
    {
        return Err(format!(
            "{field} is server-derived and must not be supplied by callers"
        ));
    }
    let payment = ctx
        .db
        .payment_transaction()
        .id()
        .find(&payload.transaction_id)
        .ok_or("payment reversal source transaction not found")?;
    if payment.organization_id != organization_id || payment.company_id != company_id {
        return Err(
            "payment reversal source is outside the requested organization/company".to_string(),
        );
    }
    if payment.status != PaymentTransactionStatus::Posted {
        return Err("payment reversal source must be a posted transaction".to_string());
    }
    let snapshot_hash = payment_reversal_source_snapshot_hash(ctx, &payment)?;
    object.insert(
        "source_snapshot_hash".to_string(),
        Value::String(snapshot_hash.clone()),
    );
    object.insert(
        "required_approver_permission".to_string(),
        Value::String("payment_transaction:reverse".to_string()),
    );
    object.insert(
        "payment_reversal_source".to_string(),
        serde_json::json!({
            "company_id": company_id,
            "transaction_id": payload.transaction_id,
            "snapshot_hash": snapshot_hash,
        }),
    );
    *raw_metadata = Some(metadata.to_string());
    Ok(())
}

fn validate_draft_payload_and_sources(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    reducer_name: &str,
    params_json: &str,
    elevated: bool,
    metadata: Option<&str>,
) -> Result<(), String> {
    if reducer_name == REVERSE_PAYMENT_TRANSACTION {
        if !elevated {
            return Err("payment reversal drafts must be elevated".to_string());
        }
        let payload = parse_reverse_payment_draft_payload(params_json)?;
        validate_reverse_payment_source(ctx, organization_id, company_id, &payload, metadata)
    } else {
        validate_payment_source(ctx, organization_id, company_id, metadata)
    }
}

fn parse_reverse_payment_draft_payload(raw: &str) -> Result<ReversePaymentDraftPayload, String> {
    let payload: ReversePaymentDraftPayload = serde_json::from_str(raw)
        .map_err(|error| format!("invalid reverse_payment_transaction params: {error}"))?;
    if payload.company_id == 0 || payload.transaction_id == 0 {
        return Err(
            "reverse_payment_transaction requires positive company_id and transaction_id"
                .to_string(),
        );
    }
    let reason = payload.reason.trim();
    if reason.is_empty()
        || reason != payload.reason
        || reason.len() > REVERSAL_REASON_MAX_LEN
        || reason.chars().any(char::is_control)
    {
        return Err(format!(
            "reversal reason must be trimmed, printable, and 1..={REVERSAL_REASON_MAX_LEN} bytes"
        ));
    }
    Ok(payload)
}

fn validate_reverse_payment_source(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payload: &ReversePaymentDraftPayload,
    raw_metadata: Option<&str>,
) -> Result<(), String> {
    if payload.company_id != company_id {
        return Err("reversal payload company_id does not match draft company scope".to_string());
    }
    let raw_metadata = raw_metadata.ok_or("payment reversal draft requires governance metadata")?;
    let metadata: Value = serde_json::from_str(raw_metadata)
        .map_err(|error| format!("invalid payment reversal governance metadata: {error}"))?;
    let object = metadata
        .as_object()
        .ok_or("payment reversal governance metadata must be a JSON object")?;
    let allowed_fields: BTreeSet<&str> = ELEVATED_GOVERNANCE_FIELDS
        .into_iter()
        .chain(SERVER_OWNED_REVERSAL_METADATA_FIELDS)
        .collect();
    if let Some(field) = object
        .keys()
        .find(|field| !allowed_fields.contains(field.as_str()))
    {
        return Err(format!(
            "payment reversal governance metadata contains unknown field '{field}'"
        ));
    }
    if object
        .get("required_approver_permission")
        .and_then(Value::as_str)
        != Some("payment_transaction:reverse")
    {
        return Err(
            "payment reversal draft requires approver permission payment_transaction:reverse"
                .to_string(),
        );
    }
    if object
        .get("approval_channel")
        .is_some_and(|value| value.as_str() != Some("ai_action_draft"))
    {
        return Err(
            "payment reversal draft has an invalid server-owned approval channel".to_string(),
        );
    }
    if object.get("workflow_instance_id").is_some_and(|value| {
        value
            .as_u64()
            .is_none_or(|workflow_instance_id| workflow_instance_id == 0)
    }) {
        return Err(
            "payment reversal draft has an invalid server-owned workflow instance".to_string(),
        );
    }
    let source: PaymentReversalSourceBinding = serde_json::from_value(
        object
            .get("payment_reversal_source")
            .cloned()
            .ok_or("payment reversal draft requires payment_reversal_source")?,
    )
    .map_err(|error| format!("invalid payment_reversal_source precondition: {error}"))?;
    validate_lowercase_sha256(&source.snapshot_hash, "payment_reversal_source")?;
    if source.company_id != company_id
        || source.company_id != payload.company_id
        || source.transaction_id != payload.transaction_id
    {
        return Err(
            "payment_reversal_source does not match the draft company and transaction target"
                .to_string(),
        );
    }
    if object.get("source_snapshot_hash").and_then(Value::as_str)
        != Some(source.snapshot_hash.as_str())
    {
        return Err(
            "source_snapshot_hash must match payment_reversal_source snapshot_hash".to_string(),
        );
    }
    let payment = ctx
        .db
        .payment_transaction()
        .id()
        .find(&source.transaction_id)
        .ok_or("payment_reversal_source transaction not found")?;
    if payment.organization_id != organization_id || payment.company_id != company_id {
        return Err(
            "payment_reversal_source is outside the requested organization/company".to_string(),
        );
    }
    if payment.status != PaymentTransactionStatus::Posted {
        return Err("payment reversal source must be a posted transaction".to_string());
    }
    if payment_reversal_source_snapshot_hash(ctx, &payment)? != source.snapshot_hash {
        return Err("payment reversal source is stale; refresh and review a new draft".to_string());
    }
    Ok(())
}

fn validate_lowercase_sha256(hash: &str, label: &str) -> Result<(), String> {
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(format!(
            "{label} requires a lowercase SHA-256 snapshot_hash"
        ));
    }
    Ok(())
}

/// Optional typed precondition, separate from the historical informational
/// `source_snapshot_hash`. Legacy unbound drafts keep their existing behavior.
fn payment_source_binding(raw: Option<&str>) -> Result<Option<PaymentSourceBinding>, String> {
    let Some(raw) = raw else { return Ok(None) };
    let Ok(metadata) = serde_json::from_str::<Value>(raw) else {
        return Ok(None);
    };
    let Some(source) = metadata.get("payment_source") else {
        return Ok(None);
    };
    let binding: PaymentSourceBinding = serde_json::from_value(source.clone())
        .map_err(|error| format!("invalid payment_source precondition: {error}"))?;
    if binding.id == 0
        || binding.snapshot_hash.len() != 64
        || !binding
            .snapshot_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(
            "payment_source requires a positive id and lowercase SHA-256 snapshot_hash".into(),
        );
    }
    Ok(Some(binding))
}

fn validate_payment_source(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    metadata: Option<&str>,
) -> Result<(), String> {
    let Some(binding) = payment_source_binding(metadata)? else {
        return Ok(());
    };
    let payment = ctx
        .db
        .payment_transaction()
        .id()
        .find(&binding.id)
        .ok_or("payment_source not found")?;
    if payment.organization_id != organization_id || payment.company_id != company_id {
        return Err("payment_source is outside the requested organization/company".into());
    }
    if payment_source_snapshot_hash(&payment) != binding.snapshot_hash {
        return Err("draft payment_source is stale; refresh and review a new draft".into());
    }
    Ok(())
}

/// Versioned, exact hash of the payment transaction row (not its related fee
/// or reconciliation rows). Float bits avoid rounding away a source change.
pub(crate) fn payment_source_snapshot_hash(payment: &PaymentTransaction) -> String {
    let snapshot = serde_json::json!({
        "version": 1, "id": payment.id,
        "organization_id": payment.organization_id, "company_id": payment.company_id,
        "payment_account_id": payment.payment_account_id,
        "direction": format!("{:?}", payment.direction),
        "partner_type": format!("{:?}", payment.partner_type), "partner_id": payment.partner_id,
        "external_reference": payment.external_reference, "reference_fingerprint": payment.reference_fingerprint,
        "gross_external_amount_bits": payment.gross_external_amount.to_bits(),
        "settlement_amount_bits": payment.settlement_amount.to_bits(),
        "net_account_amount_bits": payment.net_account_amount.to_bits(), "currency_id": payment.currency_id,
        "occurred_at": payment.occurred_at.to_micros_since_unix_epoch(), "status": format!("{:?}", payment.status),
        "account_payment_id": payment.account_payment_id, "source_entity": payment.source_entity,
        "source_entity_id": payment.source_entity_id, "evidence_document_ids": payment.evidence_document_ids,
        "created_at": payment.created_at.to_micros_since_unix_epoch(), "updated_at": payment.updated_at.to_micros_since_unix_epoch(),
        "created_by": payment.created_by.to_hex().to_string(), "updated_by": payment.updated_by.to_hex().to_string(),
        "voided_at": payment.voided_at.map(|at| at.to_micros_since_unix_epoch()), "metadata": payment.metadata,
    });
    format!("{:x}", Sha256::digest(snapshot.to_string().as_bytes()))
}

/// Exact source fingerprint for a payment reversal draft. It covers the
/// operational transaction and account, fees, allocation/reconciliation rows,
/// the linked ledger payment, and every ledger move/line that reversal reads or
/// restores. Any consequential allocation or residual change therefore makes
/// the pending draft stale before business execution.
pub(crate) fn payment_reversal_source_snapshot_hash(
    ctx: &ReducerContext,
    payment: &PaymentTransaction,
) -> Result<String, String> {
    let account = ctx
        .db
        .payment_account()
        .id()
        .find(&payment.payment_account_id)
        .ok_or("payment reversal source account not found")?;
    if account.organization_id != payment.organization_id
        || account.company_id != payment.company_id
    {
        return Err("payment reversal source account is outside transaction scope".to_string());
    }

    let ledger_payment_id = payment
        .account_payment_id
        .ok_or("payment reversal source has no linked ledger payment")?;
    let ledger_payment = ctx
        .db
        .account_payment()
        .id()
        .find(&ledger_payment_id)
        .ok_or("payment reversal source ledger payment not found")?;
    validate_ledger_payment_scope(payment, &ledger_payment)?;

    let mut reconciliations: Vec<_> = ctx
        .db
        .payment_reconciliation()
        .reconciliation_by_transaction()
        .filter(&payment.id)
        .collect();
    reconciliations.sort_by_key(|row| row.id);
    if reconciliations.iter().any(|row| {
        row.organization_id != payment.organization_id
            || row.company_id != payment.company_id
            || row.account_payment_id != ledger_payment_id
    }) {
        return Err("payment reversal reconciliation is outside transaction scope".to_string());
    }

    let mut fees: Vec<_> = ctx
        .db
        .payment_fee()
        .payment_fee_by_transaction()
        .filter(&payment.id)
        .collect();
    fees.sort_by_key(|row| row.id);
    if fees.iter().any(|row| {
        row.organization_id != payment.organization_id || row.company_id != payment.company_id
    }) {
        return Err("payment reversal fee is outside transaction scope".to_string());
    }

    let mut move_ids = BTreeSet::new();
    if let Some(move_id) = ledger_payment.move_id {
        move_ids.insert(move_id);
    }
    for row in &reconciliations {
        let line = ctx
            .db
            .account_move_line()
            .id()
            .find(&row.allocated_move_line_id)
            .ok_or("payment reversal allocated ledger line not found")?;
        validate_ledger_line_scope(payment, &line)?;
        move_ids.insert(line.move_id);
        if let Some(move_id) = row.write_off_move_id {
            move_ids.insert(move_id);
        }
    }

    let mut ledger_moves = Vec::with_capacity(move_ids.len());
    for move_id in move_ids {
        let move_record = ctx
            .db
            .account_move()
            .id()
            .find(&move_id)
            .ok_or("payment reversal ledger move not found")?;
        if move_record.organization_id != payment.organization_id
            || move_record.company_id != payment.company_id
        {
            return Err("payment reversal ledger move is outside transaction scope".to_string());
        }
        let mut lines: Vec<_> = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&move_id)
            .collect();
        lines.sort_by_key(|line| line.id);
        for line in &lines {
            validate_ledger_line_scope(payment, line)?;
        }
        ledger_moves.push(serde_json::json!({
            "id": move_record.id,
            "organization_id": move_record.organization_id,
            "company_id": move_record.company_id,
            "journal_id": move_record.journal_id,
            "currency_id": move_record.currency_id,
            "state": format!("{:?}", move_record.state),
            "move_type": format!("{:?}", move_record.move_type),
            "partner_id": move_record.partner_id,
            "amount_total_bits": move_record.amount_total.to_bits(),
            "amount_residual_bits": move_record.amount_residual.to_bits(),
            "amount_residual_signed_bits": move_record.amount_residual_signed.to_bits(),
            "payment_state": format!("{:?}", move_record.payment_state),
            "invoice_has_outstanding": move_record.invoice_has_outstanding,
            "posted_before": move_record.posted_before,
            "write_date": move_record.write_date.map(|value| value.to_micros_since_unix_epoch()),
            "metadata": move_record.metadata,
            "lines": lines.iter().map(ledger_line_snapshot).collect::<Vec<_>>(),
        }));
    }

    let mut reconciled_invoice_ids = ledger_payment.reconciled_invoice_ids.clone();
    reconciled_invoice_ids.sort_unstable();
    let mut reconciled_bill_ids = ledger_payment.reconciled_bill_ids.clone();
    reconciled_bill_ids.sort_unstable();
    let snapshot = serde_json::json!({
        "version": 1,
        "payment_transaction_hash": payment_source_snapshot_hash(payment),
        "payment_account": {
            "id": account.id,
            "organization_id": account.organization_id,
            "company_id": account.company_id,
            "currency_id": account.currency_id,
            "account_journal_id": account.account_journal_id,
            "fee_account_id": account.fee_account_id,
            "clearing_account_id": account.clearing_account_id,
            "active": account.active,
            "archived_at": account.archived_at.map(|value| value.to_micros_since_unix_epoch()),
            "updated_at": account.updated_at.to_micros_since_unix_epoch(),
        },
        "ledger_payment": {
            "id": ledger_payment.id,
            "organization_id": ledger_payment.organization_id,
            "company_id": ledger_payment.company_id,
            "move_id": ledger_payment.move_id,
            "payment_type": format!("{:?}", ledger_payment.payment_type),
            "partner_type": format!("{:?}", ledger_payment.partner_type),
            "partner_id": ledger_payment.partner_id,
            "amount_bits": ledger_payment.amount.to_bits(),
            "currency_id": ledger_payment.currency_id,
            "journal_id": ledger_payment.journal_id,
            "reconciled_invoice_ids": reconciled_invoice_ids,
            "reconciled_bill_ids": reconciled_bill_ids,
            "state": format!("{:?}", ledger_payment.state),
        },
        "fees": fees.iter().map(|row| serde_json::json!({
            "id": row.id,
            "organization_id": row.organization_id,
            "company_id": row.company_id,
            "payment_transaction_id": row.payment_transaction_id,
            "bearer": format!("{:?}", row.bearer),
            "amount_bits": row.amount.to_bits(),
            "currency_id": row.currency_id,
            "fee_account_id": row.fee_account_id,
            "tax_account_id": row.tax_account_id,
            "tax_amount_bits": row.tax_amount.to_bits(),
            "provider_reference": row.provider_reference,
            "metadata": row.metadata,
        })).collect::<Vec<_>>(),
        "reconciliations": reconciliations.iter().map(|row| serde_json::json!({
            "id": row.id,
            "organization_id": row.organization_id,
            "company_id": row.company_id,
            "payment_transaction_id": row.payment_transaction_id,
            "account_payment_id": row.account_payment_id,
            "allocated_move_line_id": row.allocated_move_line_id,
            "allocated_amount_bits": row.allocated_amount.to_bits(),
            "currency_id": row.currency_id,
            "residual_before_bits": row.residual_before.to_bits(),
            "residual_after_bits": row.residual_after.to_bits(),
            "write_off_amount_bits": row.write_off_amount.to_bits(),
            "write_off_account_id": row.write_off_account_id,
            "write_off_move_id": row.write_off_move_id,
            "is_reversal": row.is_reversal,
            "reversed_reconciliation_id": row.reversed_reconciliation_id,
            "created_at": row.created_at.to_micros_since_unix_epoch(),
            "created_by": row.created_by.to_hex().to_string(),
            "metadata": row.metadata,
        })).collect::<Vec<_>>(),
        "ledger_moves": ledger_moves,
    });
    Ok(format!(
        "{:x}",
        Sha256::digest(snapshot.to_string().as_bytes())
    ))
}

fn validate_ledger_payment_scope(
    payment: &PaymentTransaction,
    ledger_payment: &AccountPayment,
) -> Result<(), String> {
    if ledger_payment.organization_id != payment.organization_id
        || ledger_payment.company_id != payment.company_id
        || ledger_payment.partner_id != payment.partner_id
        || ledger_payment.currency_id != payment.currency_id
    {
        return Err("payment reversal ledger payment is outside transaction scope".to_string());
    }
    Ok(())
}

fn validate_ledger_line_scope(
    payment: &PaymentTransaction,
    line: &AccountMoveLine,
) -> Result<(), String> {
    if line.organization_id != payment.organization_id || line.company_id != payment.company_id {
        return Err("payment reversal ledger line is outside transaction scope".to_string());
    }
    Ok(())
}

fn ledger_line_snapshot(line: &AccountMoveLine) -> Value {
    serde_json::json!({
        "id": line.id,
        "organization_id": line.organization_id,
        "company_id": line.company_id,
        "move_id": line.move_id,
        "parent_state": format!("{:?}", line.parent_state),
        "journal_id": line.journal_id,
        "currency_id": line.currency_id,
        "sequence": line.sequence,
        "account_id": line.account_id,
        "account_internal_type": line.account_internal_type,
        "partner_id": line.partner_id,
        "payment_id": line.payment_id,
        "balance_bits": line.balance.to_bits(),
        "amount_currency_bits": line.amount_currency.to_bits(),
        "amount_residual_bits": line.amount_residual.to_bits(),
        "amount_residual_currency_bits": line.amount_residual_currency.to_bits(),
        "debit_bits": line.debit.to_bits(),
        "credit_bits": line.credit.to_bits(),
        "blocked": line.blocked,
        "matching_number": line.matching_number,
        "is_matching": line.is_matching,
        "write_date": line.write_date.map(|value| value.to_micros_since_unix_epoch()),
        "metadata": line.metadata,
    })
}

fn validate_elevated_governance_metadata(raw: Option<&str>) -> Result<(), String> {
    let raw = raw.ok_or("elevated drafts require governance metadata")?;
    let metadata: Value = serde_json::from_str(raw)
        .map_err(|error| format!("invalid elevated draft governance metadata: {error}"))?;
    let object = metadata
        .as_object()
        .ok_or("elevated draft governance metadata must be a JSON object")?;

    if object.get("risk").and_then(Value::as_str) != Some("red") {
        return Err("elevated draft governance metadata must declare risk=red".to_string());
    }
    for field in ELEVATED_GOVERNANCE_FIELDS
        .into_iter()
        .filter(|field| *field != "risk")
    {
        let present = object.get(field).is_some_and(|value| match value {
            Value::String(text) => !text.trim().is_empty(),
            Value::Number(number) => number.as_u64().is_some_and(|value| value > 0),
            _ => false,
        });
        if !present {
            return Err(format!(
                "elevated draft governance metadata requires {field}"
            ));
        }
    }
    Ok(())
}

fn execute_whitelisted_draft(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    draft: &AiActionDraft,
) -> Result<Option<u64>, String> {
    // Fail closed on execute as well (empty allowlist / disabled reducer).
    is_allowed_ai_reducer(ctx, organization_id, &draft.reducer_name)?;

    let params: Value = serde_json::from_str(&draft.params_json)
        .map_err(|e| format!("invalid params_json: {e}"))?;

    match draft.reducer_name.as_str() {
        "create_task" => {
            check_permission(ctx, organization_id, "project_task", "create")?;
            let task_params = build_create_task_params(company_id, &params)?;
            create_task(ctx, organization_id, task_params)?;

            let latest = ctx
                .db
                .project_task()
                .task_by_company()
                .filter(&company_id)
                .max_by_key(|task| task.id);

            Ok(latest.map(|task| task.id))
        }
        "create_sale_order" => {
            check_permission(ctx, organization_id, "sale_order", "create")?;
            let so_params = build_create_sale_order_params(company_id, &params)?;
            create_sale_order(ctx, organization_id, so_params)?;

            let latest = ctx
                .db
                .sale_order()
                .sale_order_by_company()
                .filter(&company_id)
                .max_by_key(|order| order.id);

            Ok(latest.map(|order| order.id))
        }
        "create_purchase_order" => {
            check_permission(ctx, organization_id, "purchase_order", "create")?;
            let (po_params, line_params) = build_create_purchase_order_params(company_id, &params)?;
            create_purchase_order(ctx, organization_id, po_params)?;

            let latest = ctx
                .db
                .purchase_order()
                .purchase_order_by_org()
                .filter(&organization_id)
                .filter(|order| order.company_id == company_id)
                .max_by_key(|order| order.id);

            let Some(order_id) = latest.map(|order| order.id) else {
                return Ok(None);
            };

            for line in line_params {
                add_purchase_order_line(ctx, organization_id, order_id, line)?;
            }

            Ok(Some(order_id))
        }
        REVERSE_PAYMENT_TRANSACTION => {
            if !draft.elevated {
                return Err("payment reversal drafts must be elevated".to_string());
            }
            check_permission(ctx, organization_id, "payment_transaction", "reverse")?;
            let reversal = parse_reverse_payment_draft_payload(&draft.params_json)?;
            if reversal.company_id != company_id {
                return Err(
                    "reversal payload company_id does not match draft company scope".to_string(),
                );
            }
            let action_input = GuardedActionInput::ReversePaymentTransaction {
                transaction_id: reversal.transaction_id,
            };
            if guarded_action_requires_human_approval(
                ctx,
                organization_id,
                company_id,
                GuardedActionKey::ReversePaymentTransaction,
                GUARDED_ACTION_SCHEMA_VERSION,
                action_input,
            )? {
                return Err(
                    "payment reversal requires an additional finance workflow approval; use the finance workflow route"
                        .to_string(),
                );
            }

            let execution_metadata = Some(
                serde_json::json!({
                    "source": "ai_action_draft",
                    "draft_id": draft.id,
                })
                .to_string(),
            );
            let reversal_params = ReversePaymentTransactionParams {
                company_id,
                reason: Some(reversal.reason),
                metadata: execution_metadata,
            };
            reverse_payment_transaction_impl(
                ctx,
                organization_id,
                reversal.transaction_id,
                reversal_params.clone(),
                false,
            )?;

            let original = ctx
                .db
                .payment_transaction()
                .id()
                .find(&reversal.transaction_id)
                .ok_or("reversed payment transaction disappeared")?;
            if original.organization_id != organization_id
                || original.company_id != company_id
                || original.status != PaymentTransactionStatus::Reversed
            {
                return Err("payment reversal did not commit its target effect".to_string());
            }
            let reversals: Vec<_> = ctx
                .db
                .payment_reversal()
                .reversal_by_original()
                .filter(&reversal.transaction_id)
                .collect();
            let [effect] = reversals.as_slice() else {
                return Err(format!(
                    "payment reversal produced {} reversal records instead of one",
                    reversals.len()
                ));
            };
            if effect.organization_id != organization_id
                || effect.company_id != company_id
                || effect.reason != reversal_params.reason
                || effect.metadata != reversal_params.metadata
            {
                return Err("payment reversal effect does not match the approved draft".to_string());
            }
            Ok(Some(effect.id))
        }
        other => Err(format!("reducer '{other}' is not executable from drafts")),
    }
}

fn build_create_sale_order_params(
    company_id: u64,
    value: &Value,
) -> Result<CreateSaleOrderParams, String> {
    let obj = value
        .as_object()
        .ok_or("create_sale_order params must be a JSON object")?;

    let param_company = obj
        .get("company_id")
        .and_then(json_u64)
        .filter(|id| *id > 0)
        .unwrap_or(company_id);
    if param_company != company_id {
        return Err("params company_id does not match draft company scope".to_string());
    }

    let partner_id = obj
        .get("partner_id")
        .and_then(json_u64)
        .ok_or("create_sale_order requires partner_id")?;

    let partner_invoice_id = obj
        .get("partner_invoice_id")
        .and_then(json_u64)
        .unwrap_or(partner_id);
    let partner_shipping_id = obj
        .get("partner_shipping_id")
        .and_then(json_u64)
        .unwrap_or(partner_id);

    let pricelist_id = obj
        .get("pricelist_id")
        .and_then(json_u64)
        .ok_or("create_sale_order requires pricelist_id")?;
    let currency_id = obj
        .get("currency_id")
        .and_then(json_u64)
        .ok_or("create_sale_order requires currency_id")?;
    let warehouse_id = obj
        .get("warehouse_id")
        .and_then(json_u64)
        .ok_or("create_sale_order requires warehouse_id")?;

    let order_lines = match obj.get("order_lines").and_then(Value::as_array) {
        Some(lines) => {
            let mut out = Vec::with_capacity(lines.len());
            for line in lines {
                out.push(build_create_sale_order_line_params(line)?);
            }
            out
        }
        None => Vec::new(),
    };

    Ok(CreateSaleOrderParams {
        company_id: Some(company_id),
        partner_id,
        partner_invoice_id,
        partner_shipping_id,
        pricelist_id,
        currency_id,
        warehouse_id,
        order_lines,
        origin: json_string(obj, "origin"),
        client_order_ref: json_string(obj, "client_order_ref"),
        payment_term_id: obj.get("payment_term_id").and_then(json_u64),
        fiscal_position_id: obj.get("fiscal_position_id").and_then(json_u64),
        team_id: obj.get("team_id").and_then(json_u64),
        opportunity_id: obj.get("opportunity_id").and_then(json_u64),
        proposal_id: None,
        note: json_string(obj, "note"),
        terms_and_conditions: json_string(obj, "terms_and_conditions"),
        validity_days: obj
            .get("validity_days")
            .and_then(json_u64)
            .map(|days| days as u32),
        shipping_policy: json_string(obj, "shipping_policy"),
        picking_policy: json_string(obj, "picking_policy"),
        campaign_id: obj.get("campaign_id").and_then(json_u64),
        medium_id: obj.get("medium_id").and_then(json_u64),
        source_id: obj.get("source_id").and_then(json_u64),
        commitment_date: None,
        expected_date: None,
        incoterm_id: obj.get("incoterm_id").and_then(json_u64),
        incoterm: json_string(obj, "incoterm"),
        incoterm_location: json_string(obj, "incoterm_location"),
        carrier_id: obj.get("carrier_id").and_then(json_u64),
        customer_lead: obj.get("customer_lead").and_then(|v| v.as_f64()),
        analytic_account_id: obj.get("analytic_account_id").and_then(json_u64),
        user_id: None,
        is_printed: json_bool(obj, "is_printed"),
        is_locked: json_bool(obj, "is_locked"),
        is_dropship: json_bool(obj, "is_dropship"),
        invoice_policy: json_string(obj, "invoice_policy"),
        message_follower_ids: None,
        message_partner_ids: None,
        message_channel_ids: None,
        activity_ids: None,
        metadata: json_string(obj, "metadata"),
    })
}

fn build_create_sale_order_line_params(value: &Value) -> Result<CreateSaleOrderLineParams, String> {
    let obj = value
        .as_object()
        .ok_or("sale order line must be a JSON object")?;
    let product_id = obj
        .get("product_id")
        .and_then(json_u64)
        .ok_or("sale order line requires product_id")?;
    let uom_id = obj
        .get("uom_id")
        .or_else(|| obj.get("product_uom"))
        .and_then(json_u64)
        .filter(|&id| id != 0)
        .ok_or("sale order line requires uom_id (no magic default)")?;
    Ok(CreateSaleOrderLineParams {
        product_id,
        quantity: obj
            .get("quantity")
            .or_else(|| obj.get("product_uom_qty"))
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0),
        uom_id,
        price_unit: obj.get("price_unit").and_then(|v| v.as_f64()),
        discount: obj.get("discount").and_then(|v| v.as_f64()).unwrap_or(0.0),
        tax_ids: json_u64_vec(obj.get("tax_ids")),
        name: json_string(obj, "name"),
        sequence: obj.get("sequence").and_then(json_u64).unwrap_or(0) as u32,
        is_downpayment: json_bool(obj, "is_downpayment").unwrap_or(false),
        display_type: json_string(obj, "display_type"),
        product_variant_id: obj.get("product_variant_id").and_then(json_u64),
        packaging_id: obj.get("packaging_id").and_then(json_u64),
        route_id: obj.get("route_id").and_then(json_u64),
        analytic_tag_ids: json_u64_vec(obj.get("analytic_tag_ids")),
        customer_lead: obj.get("customer_lead").and_then(|v| v.as_f64()),
        metadata: json_string(obj, "metadata"),
    })
}

fn build_create_purchase_order_params(
    company_id: u64,
    value: &Value,
) -> Result<(CreatePurchaseOrderParams, Vec<AddPurchaseOrderLineParams>), String> {
    let obj = value
        .as_object()
        .ok_or("create_purchase_order params must be a JSON object")?;

    let param_company = obj
        .get("company_id")
        .and_then(json_u64)
        .filter(|id| *id > 0)
        .unwrap_or(company_id);
    if param_company != company_id {
        return Err("params company_id does not match draft company scope".to_string());
    }

    let partner_id = obj
        .get("partner_id")
        .and_then(json_u64)
        .ok_or("create_purchase_order requires partner_id")?;
    let currency_id = obj
        .get("currency_id")
        .and_then(json_u64)
        .ok_or("create_purchase_order requires currency_id")?;

    let line_params = match obj.get("order_lines").and_then(Value::as_array) {
        Some(lines) => {
            let mut out = Vec::with_capacity(lines.len());
            for line in lines {
                out.push(build_add_purchase_order_line_params(line)?);
            }
            out
        }
        None => Vec::new(),
    };

    Ok((
        CreatePurchaseOrderParams {
            company_id: Some(company_id),
            partner_id,
            currency_id,
            origin: json_string(obj, "origin"),
            partner_ref: json_string(obj, "partner_ref"),
            notes: json_string(obj, "notes"),
            date_planned: None,
            payment_term_id: obj.get("payment_term_id").and_then(json_u64),
            fiscal_position_id: obj.get("fiscal_position_id").and_then(json_u64),
            incoterm_id: obj.get("incoterm_id").and_then(json_u64),
            incoterm_location: json_string(obj, "incoterm_location"),
            user_id: None,
            invoice_ids: json_u64_vec(obj.get("invoice_ids")),
            picking_ids: json_u64_vec(obj.get("picking_ids")),
            message_follower_ids: json_u64_vec(obj.get("message_follower_ids")),
            message_ids: json_u64_vec(obj.get("message_ids")),
            activity_ids: json_u64_vec(obj.get("activity_ids")),
            is_quantity_copy: json_string(obj, "is_quantity_copy"),
            metadata: json_string(obj, "metadata"),
        },
        line_params,
    ))
}

fn build_add_purchase_order_line_params(
    value: &Value,
) -> Result<AddPurchaseOrderLineParams, String> {
    let obj = value
        .as_object()
        .ok_or("purchase order line must be a JSON object")?;
    let product_id = obj
        .get("product_id")
        .and_then(json_u64)
        .ok_or("purchase order line requires product_id")?;
    let uom_id = obj
        .get("uom_id")
        .or_else(|| obj.get("product_uom"))
        .and_then(json_u64)
        .filter(|&id| id != 0)
        .ok_or("purchase order line requires uom_id (no magic default)")?;
    Ok(AddPurchaseOrderLineParams {
        product_id,
        quantity: obj
            .get("quantity")
            .or_else(|| obj.get("product_qty"))
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0),
        uom_id,
        price_unit: obj
            .get("price_unit")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
        discount: obj.get("discount").and_then(|v| v.as_f64()).unwrap_or(0.0),
        tax_ids: json_u64_vec(obj.get("tax_ids")),
        name: json_string(obj, "name"),
        sequence: obj
            .get("sequence")
            .and_then(json_u64)
            .map(|value| value as u32),
        display_type: json_string(obj, "display_type"),
        product_variant_id: obj.get("product_variant_id").and_then(json_u64),
        account_analytic_id: obj.get("account_analytic_id").and_then(json_u64),
        date_planned: None,
        propagate_cancel: json_bool(obj, "propagate_cancel"),
        lot_id: obj.get("lot_id").and_then(json_u64),
        metadata: json_string(obj, "metadata"),
    })
}

fn json_u64_vec(value: Option<&Value>) -> Vec<u64> {
    value
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(json_u64).collect())
        .unwrap_or_default()
}

fn build_create_task_params(company_id: u64, value: &Value) -> Result<CreateTaskParams, String> {
    let obj = value
        .as_object()
        .ok_or("create_task params must be a JSON object")?;

    let name = json_string(obj, "name")
        .filter(|s| !s.trim().is_empty())
        .ok_or("create_task requires name")?;

    let param_company = obj
        .get("company_id")
        .and_then(json_u64)
        .filter(|id| *id > 0)
        .unwrap_or(company_id);
    if param_company != company_id {
        return Err("params company_id does not match draft company scope".to_string());
    }

    Ok(CreateTaskParams {
        company_id: Some(company_id),
        project_id: obj.get("project_id").and_then(json_u64),
        name,
        description: json_string(obj, "description"),
        priority: json_string(obj, "priority").unwrap_or_else(|| "1".to_string()),
        sequence: obj.get("sequence").and_then(json_u64).unwrap_or(0) as u32,
        stage_id: obj.get("stage_id").and_then(json_u64),
        state: parse_task_state(obj.get("state")),
        kanban_state: json_string(obj, "kanban_state").unwrap_or_else(|| "normal".to_string()),
        date_deadline: None,
        date_start: None,
        date_end: None,
        color: None,
        user_ids: Vec::new(),
        milestone_id: obj.get("milestone_id").and_then(json_u64),
        wbs_code: json_string(obj, "wbs_code").unwrap_or_default(),
        wbs_level: obj.get("wbs_level").and_then(json_u64).unwrap_or(0) as u32,
        planned_hours: json_f64(obj, "planned_hours").unwrap_or(0.0),
        total_hours_spent: json_f64(obj, "total_hours_spent").unwrap_or(0.0),
        effective_hours: json_f64(obj, "effective_hours").unwrap_or(0.0),
        progress: json_f64(obj, "progress").unwrap_or(0.0),
        remaining_hours: json_f64(obj, "remaining_hours").unwrap_or(0.0),
        sale_order_id: obj.get("sale_order_id").and_then(json_u64),
        sale_line_id: obj.get("sale_line_id").and_then(json_u64),
        partner_id: obj.get("partner_id").and_then(json_u64),
        partner_email: json_string(obj, "partner_email"),
        parent_id: obj.get("parent_id").and_then(json_u64),
        child_ids: Vec::new(),
        subtask_count: 0,
        closed_subtask_count: 0,
        is_closed: json_bool(obj, "is_closed").unwrap_or(false),
        is_blocked: json_bool(obj, "is_blocked").unwrap_or(false),
        allow_task_dependencies: json_bool(obj, "allow_task_dependencies").unwrap_or(false),
        depend_on_ids: Vec::new(),
        dependent_ids: Vec::new(),
        is_private: json_bool(obj, "is_private").unwrap_or(false),
        permitted_user_ids: Vec::new(),
        activity_ids: Vec::new(),
        activity_state: json_string(obj, "activity_state"),
        activity_date_deadline: None,
        activity_type_id: obj.get("activity_type_id").and_then(json_u64),
        activity_user_id: None,
        activity_summary: json_string(obj, "activity_summary"),
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        metadata: json_string(obj, "metadata"),
    })
}

fn parse_task_state(value: Option<&Value>) -> TaskState {
    match value.and_then(|v| v.as_str()).unwrap_or("InProgress") {
        "ChangesRequested" | "changes_requested" => TaskState::ChangesRequested,
        "Approved" | "approved" => TaskState::Approved,
        "Cancelled" | "cancelled" | "Canceled" | "canceled" => TaskState::Cancelled,
        "Done" | "done" => TaskState::Done,
        _ => TaskState::InProgress,
    }
}

fn json_string(map: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    map.get(key).and_then(|v| match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    })
}

fn json_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|n| (n >= 0).then_some(n as u64)))
}

fn json_f64(map: &serde_json::Map<String, Value>, key: &str) -> Option<f64> {
    map.get(key).and_then(|v| v.as_f64())
}

fn json_bool(map: &serde_json::Map<String, Value>, key: &str) -> Option<bool> {
    map.get(key).and_then(|v| v.as_bool())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payment_source_preconditions_are_strict_and_legacy_metadata_is_unbound() {
        assert!(payment_source_binding(None).unwrap().is_none());
        assert!(payment_source_binding(Some("legacy annotation"))
            .unwrap()
            .is_none());
        assert!(payment_source_binding(Some("{} ")).unwrap().is_none());
        let valid =
            serde_json::json!({"payment_source": {"id": 1, "snapshot_hash": "a".repeat(64)}})
                .to_string();
        assert_eq!(payment_source_binding(Some(&valid)).unwrap().unwrap().id, 1);
        for source in [
            serde_json::json!(null),
            serde_json::json!({"id": 0, "snapshot_hash": "a".repeat(64)}),
            serde_json::json!({"id": "1", "snapshot_hash": "a".repeat(64)}),
            serde_json::json!({"id": 1, "snapshot_hash": "A".repeat(64)}),
            serde_json::json!({"id": 1, "snapshot_hash": "a".repeat(63)}),
            serde_json::json!({"id": 1, "snapshot_hash": "a".repeat(64), "company_id": 99}),
        ] {
            let raw = serde_json::json!({"payment_source": source}).to_string();
            assert!(payment_source_binding(Some(&raw)).is_err(), "{raw}");
        }
    }

    #[test]
    fn parse_task_state_defaults_to_in_progress() {
        assert_eq!(parse_task_state(None), TaskState::InProgress);
    }

    #[test]
    fn build_create_task_params_requires_name() {
        let err = build_create_task_params(1, &serde_json::json!({ "company_id": 1 }))
            .expect_err("name required");
        assert!(err.contains("name"));
    }

    fn hash_params() -> CreateAiActionDraftParams {
        CreateAiActionDraftParams {
            reducer_name: "create_task".to_string(),
            params_json: r#"{"company_id":1}"#.to_string(),
            summary: "create task".to_string(),
            confidence: 0.8,
            elevated: false,
            warnings_json: None,
            source_query: Some("make a task".to_string()),
            ui_context_json: None,
            expires_at: Some(Timestamp::from_micros_since_unix_epoch(42)),
            metadata: Some("{}".to_string()),
        }
    }

    #[test]
    fn creation_payload_hash_is_deterministic_and_sensitive() {
        let params = hash_params();
        let first = creation_payload_hash(1, 2, 3, "request-1", &params);
        assert_eq!(first, creation_payload_hash(1, 2, 3, "request-1", &params));
        assert_ne!(first, creation_payload_hash(1, 2, 3, "request-2", &params));
        let mut changed = params.clone();
        changed.summary.push('!');
        assert_ne!(first, creation_payload_hash(1, 2, 3, "request-1", &changed));
    }

    #[test]
    fn creation_payload_hash_normalizes_reducer_name() {
        let mut trimmed = hash_params();
        trimmed.reducer_name = "  create_task  ".to_string();
        assert_eq!(
            creation_payload_hash(1, 2, 3, "request-1", &trimmed),
            creation_payload_hash(1, 2, 3, "request-1", &hash_params())
        );
    }
}
