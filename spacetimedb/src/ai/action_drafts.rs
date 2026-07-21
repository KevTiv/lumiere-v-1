//! AI action drafts — human-approved ERP mutations proposed by the harness.

use serde_json::Value;
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::action_draft_lifecycle::{
    on_draft_approved, on_draft_created, on_draft_expired, on_draft_rejected,
};
use crate::ai::reducer_allowlist::is_allowed_ai_reducer;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::projects::tasks::{create_task, project_task, CreateTaskParams};
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, create_purchase_order, purchase_order, AddPurchaseOrderLineParams,
    CreatePurchaseOrderParams,
};
use crate::sales::sales_core::{
    create_sale_order, sale_order, CreateSaleOrderLineParams, CreateSaleOrderParams,
};
use crate::types::TaskState;
use crate::workflow::action_registry::{
    GuardedActionInput, GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION,
};
use crate::workflow::approval_gate::{
    request_guarded_action, GuardedActionGateOutcome, RequestGuardedActionParams,
};

const DRAFT_TTL_SECS: u64 = 86_400;
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
    check_permission(ctx, organization_id, "ai_action_draft", "create")?;

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
    if params.elevated {
        validate_elevated_governance_metadata(params.metadata.as_deref())?;
    }

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

    request_guarded_action(
        ctx,
        organization_id,
        RequestGuardedActionParams {
            company_id,
            action: GuardedActionKey::ApproveAiActionDraft,
            action_version: GUARDED_ACTION_SCHEMA_VERSION,
            input: GuardedActionInput::ApproveAiActionDraft { draft_id: row.id },
            idempotency_key: format!("approve-ai-action-draft:{}", row.id),
            correlation_id: format!("ai-action-draft:{}:approve", row.id),
            causation_id: None,
        },
    )?;

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
    if matches!(
        request_guarded_action(
            ctx,
            organization_id,
            RequestGuardedActionParams {
                company_id,
                action: GuardedActionKey::ApproveAiActionDraft,
                action_version: GUARDED_ACTION_SCHEMA_VERSION,
                input: GuardedActionInput::ApproveAiActionDraft { draft_id },
                idempotency_key: format!("approve-ai-action-draft:{draft_id}"),
                correlation_id: format!("ai-action-draft:{draft_id}:approve"),
                causation_id: None,
            },
        )?,
        GuardedActionGateOutcome::HumanTaskCreated { .. }
    ) {
        return Ok(());
    }
    approve_ai_action_draft_core(ctx, organization_id, company_id, draft_id)
}

pub fn approve_ai_action_draft_core(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    draft_id: u64,
) -> Result<(), String> {
    let draft = load_mutable_draft(ctx, organization_id, company_id, draft_id)?;

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
// 2. Add an `AiReducerAllowlist` row (or rely on default allowlist before org rows exist)
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

    let order_lines = obj
        .get("order_lines")
        .and_then(Value::as_array)
        .map(|lines| {
            lines
                .iter()
                .filter_map(|line| build_create_sale_order_line_params(line))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

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

fn build_create_sale_order_line_params(value: &Value) -> Option<CreateSaleOrderLineParams> {
    let obj = value.as_object()?;
    let product_id = obj.get("product_id").and_then(json_u64)?;
    Some(CreateSaleOrderLineParams {
        product_id,
        quantity: obj
            .get("quantity")
            .or_else(|| obj.get("product_uom_qty"))
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0),
        uom_id: obj
            .get("uom_id")
            .or_else(|| obj.get("product_uom"))
            .and_then(json_u64)
            .unwrap_or(1),
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

    let line_params = obj
        .get("order_lines")
        .and_then(Value::as_array)
        .map(|lines| {
            lines
                .iter()
                .filter_map(|line| build_add_purchase_order_line_params(line))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

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

fn build_add_purchase_order_line_params(value: &Value) -> Option<AddPurchaseOrderLineParams> {
    let obj = value.as_object()?;
    let product_id = obj.get("product_id").and_then(json_u64)?;
    Some(AddPurchaseOrderLineParams {
        product_id,
        quantity: obj
            .get("quantity")
            .or_else(|| obj.get("product_qty"))
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0),
        uom_id: obj
            .get("uom_id")
            .or_else(|| obj.get("product_uom"))
            .and_then(json_u64)
            .unwrap_or(1),
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
    fn parse_task_state_defaults_to_in_progress() {
        assert_eq!(parse_task_state(None), TaskState::InProgress);
    }

    #[test]
    fn build_create_task_params_requires_name() {
        let err = build_create_task_params(1, &serde_json::json!({ "company_id": 1 }))
            .expect_err("name required");
        assert!(err.contains("name"));
    }
}
