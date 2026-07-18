//! Approval rule engine — tables, CRUD reducers, and approve/reject execution.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::ai::action_drafts::{
    approve_ai_action_draft_core, reject_ai_action_draft_core,
};
use crate::accounting::journal_entries::post_account_move_impl;
use crate::accounting::payments::post_payment_impl;
use crate::expenses::expenses::approve_expense_sheet_impl;
use crate::purchasing::purchase_orders::{
    confirm_purchase_order_impl, purchase_order, send_purchase_order_impl, PurchaseOrder,
};
use crate::sales::sales_core::{confirm_sales_order_impl, sale_order, SaleOrder};
use crate::types::{PoState, SaleState};

use super::approval_gate::notify_approval_event;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Configurable approval rule — evaluated before a guarded reducer runs.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = approval_rule,
    public,
    index(accessor = approval_rule_by_org, btree(columns = [organization_id])),
    index(accessor = approval_rule_by_model, btree(columns = [model]))
)]
pub struct ApprovalRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub name: String,
    pub description: Option<String>,
    pub model: String,
    pub action: String,
    pub rule_type: String,
    pub threshold: f64,
    pub approver_role_id: Option<u64>,
    pub sequence: u32,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Pending or completed approval for a specific record + action.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = approval_request,
    public,
    index(accessor = approval_request_by_org, btree(columns = [organization_id])),
    index(accessor = approval_request_by_status, btree(columns = [status])),
    index(accessor = approval_request_by_model, btree(columns = [model]))
)]
pub struct ApprovalRequest {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub rule_id: u64,
    pub model: String,
    pub res_id: u64,
    pub action: String,
    pub params_json: String,
    pub status: String,
    pub summary: String,
    pub context_json: Option<String>,
    pub requested_by: Identity,
    pub requested_at: Timestamp,
    pub reviewed_by: Option<Identity>,
    pub reviewed_at: Option<Timestamp>,
    pub reject_reason: Option<String>,
    pub reviewer_comment: Option<String>,
    pub ai_draft_id: Option<u64>,
    pub workflow_instance_id: Option<u64>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateApprovalRuleParams {
    pub name: String,
    pub description: Option<String>,
    pub model: String,
    pub action: String,
    pub rule_type: String,
    pub threshold: f64,
    pub approver_role_id: Option<u64>,
    pub sequence: u32,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateApprovalRuleParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub rule_type: Option<String>,
    pub threshold: Option<f64>,
    pub approver_role_id: Option<Option<u64>>,
    pub sequence: Option<u32>,
    pub is_active: Option<bool>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RejectApprovalRequestParams {
    pub reason: String,
    pub comment: Option<String>,
}

fn execute_approved_action(
    ctx: &ReducerContext,
    organization_id: u64,
    request: &ApprovalRequest,
) -> Result<(), String> {
    match request.action.as_str() {
        "confirm_purchase_order" => {
            confirm_purchase_order_impl(ctx, organization_id, request.res_id, true)
        }
        "send_purchase_order" => send_purchase_order_impl(ctx, organization_id, request.res_id, true),
        "confirm_sales_order" => {
            confirm_sales_order_impl(ctx, organization_id, request.res_id, true)
        }
        "post_account_move" => post_account_move_impl(ctx, organization_id, request.res_id, true),
        "post_payment" => post_payment_impl(ctx, organization_id, request.res_id, true),
        "approve_expense_sheet" => {
            approve_expense_sheet_impl(ctx, organization_id, request.res_id, true)
        }
        "approve_ai_action_draft" => {
            let draft_id = request
                .ai_draft_id
                .unwrap_or(request.res_id);
            approve_ai_action_draft_core(ctx, organization_id, request.company_id, draft_id)
        }
        other => Err(format!("unsupported approval action: {other}")),
    }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_approval_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateApprovalRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "approval_rule", "create")?;

    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    if params.model.trim().is_empty() {
        return Err("model is required".to_string());
    }
    if params.action.trim().is_empty() {
        return Err("action is required".to_string());
    }
    if !matches!(params.rule_type.as_str(), "amount_threshold" | "discount_percent") {
        return Err("rule_type must be amount_threshold or discount_percent".to_string());
    }

    let row = ctx.db.approval_rule().insert(ApprovalRule {
        id: 0,
        organization_id,
        company_id,
        name: params.name.trim().to_string(),
        description: params.description,
        model: params.model.trim().to_string(),
        action: params.action.trim().to_string(),
        rule_type: params.rule_type,
        threshold: params.threshold,
        approver_role_id: params.approver_role_id,
        sequence: params.sequence,
        is_active: params.is_active,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "approval_rule",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": row.name,
                    "model": row.model,
                    "action": row.action,
                    "threshold": row.threshold,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "model".to_string(),
                "action".to_string(),
                "threshold".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_approval_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    rule_id: u64,
    params: UpdateApprovalRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "approval_rule", "write")?;

    let rule = ctx
        .db
        .approval_rule()
        .id()
        .find(&rule_id)
        .ok_or("approval rule not found")?;

    if rule.organization_id != organization_id {
        return Err("approval rule does not belong to this organization".to_string());
    }
    if rule.company_id != company_id {
        return Err("approval rule does not belong to this company scope".to_string());
    }

    let updated = ApprovalRule {
        name: params.name.unwrap_or(rule.name),
        description: params.description.or(rule.description),
        rule_type: params.rule_type.unwrap_or(rule.rule_type),
        threshold: params.threshold.unwrap_or(rule.threshold),
        approver_role_id: params.approver_role_id.unwrap_or(rule.approver_role_id),
        sequence: params.sequence.unwrap_or(rule.sequence),
        is_active: params.is_active.unwrap_or(rule.is_active),
        metadata: params.metadata.or(rule.metadata),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..rule
    };

    ctx.db.approval_rule().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "approval_rule",
            record_id: rule_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": updated.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn set_approval_rule_active(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    rule_id: u64,
    active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "approval_rule", "write")?;

    let rule = ctx
        .db
        .approval_rule()
        .id()
        .find(&rule_id)
        .ok_or("approval rule not found")?;

    if rule.organization_id != organization_id {
        return Err("approval rule does not belong to this organization".to_string());
    }
    if rule.company_id != company_id {
        return Err("approval rule does not belong to this company scope".to_string());
    }

    ctx.db.approval_rule().id().update(ApprovalRule {
        is_active: active,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..rule
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "approval_rule",
            record_id: rule_id,
            action: "SET_ACTIVE",
            old_values: None,
            new_values: Some(serde_json::json!({ "is_active": active }).to_string()),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn delete_approval_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    rule_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "approval_rule", "delete")?;

    let rule = ctx
        .db
        .approval_rule()
        .id()
        .find(&rule_id)
        .ok_or("approval rule not found")?;

    if rule.organization_id != organization_id {
        return Err("approval rule does not belong to this organization".to_string());
    }
    if rule.company_id != company_id {
        return Err("approval rule does not belong to this company scope".to_string());
    }

    ctx.db.approval_rule().id().delete(&rule_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "approval_rule",
            record_id: rule_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": rule.name }).to_string()),
            new_values: None,
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn approve_approval_request(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    request_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "approval_request", "write")?;

    let request = ctx
        .db
        .approval_request()
        .id()
        .find(&request_id)
        .ok_or("approval request not found")?;

    if request.organization_id != organization_id {
        return Err("approval request does not belong to this organization".to_string());
    }
    if request.company_id != company_id {
        return Err("approval request does not belong to this company".to_string());
    }
    if request.status != "pending" {
        return Err(format!("request is not pending (status={})", request.status));
    }
    if request.requested_by == ctx.sender() {
        return Err("requester cannot approve their own request".to_string());
    }

    execute_approved_action(ctx, organization_id, &request)?;

    let updated = ApprovalRequest {
        status: "approved".to_string(),
        reviewed_by: Some(ctx.sender()),
        reviewed_at: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..request.clone()
    };
    ctx.db.approval_request().id().update(updated.clone());

    notify_approval_event(
        ctx,
        &updated,
        "approved",
        &format!("Approval request #{} was approved.", request_id),
    );

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "approval_request",
            record_id: request_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "status": "pending" }).to_string()),
            new_values: Some(serde_json::json!({ "status": "approved" }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn reject_approval_request(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    request_id: u64,
    params: RejectApprovalRequestParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "approval_request", "write")?;

    let request = ctx
        .db
        .approval_request()
        .id()
        .find(&request_id)
        .ok_or("approval request not found")?;

    if request.organization_id != organization_id {
        return Err("approval request does not belong to this organization".to_string());
    }
    if request.company_id != company_id {
        return Err("approval request does not belong to this company".to_string());
    }
    if request.status != "pending" {
        return Err(format!("request is not pending (status={})", request.status));
    }
    if params.reason.trim().is_empty() {
        return Err("reject reason is required".to_string());
    }

    if request.model == "purchase_order" {
        if let Some(order) = ctx.db.purchase_order().id().find(&request.res_id) {
            if order.state == PoState::ToApprove {
                ctx.db.purchase_order().id().update(PurchaseOrder {
                    state: PoState::Draft,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..order
                });
            }
        }
    }

    if request.model == "sale_order" {
        if let Some(order) = ctx.db.sale_order().id().find(&request.res_id) {
            if order.state == SaleState::ToApprove {
                ctx.db.sale_order().id().update(SaleOrder {
                    state: SaleState::Draft,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..order
                });
            }
        }
    }

    if request.model == "ai_action_draft" {
        let draft_id = request.ai_draft_id.unwrap_or(request.res_id);
        reject_ai_action_draft_core(
            ctx,
            organization_id,
            request.company_id,
            draft_id,
            params.reason.trim(),
        )?;
    }

    let updated = ApprovalRequest {
        status: "rejected".to_string(),
        reviewed_by: Some(ctx.sender()),
        reviewed_at: Some(ctx.timestamp),
        reject_reason: Some(params.reason.trim().to_string()),
        reviewer_comment: params.comment,
        write_date: ctx.timestamp,
        ..request.clone()
    };
    ctx.db.approval_request().id().update(updated.clone());

    notify_approval_event(
        ctx,
        &updated,
        "rejected",
        &format!(
            "Approval request #{} was rejected: {}",
            request_id,
            updated.reject_reason.as_deref().unwrap_or("no reason")
        ),
    );

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "approval_request",
            record_id: request_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "status": "pending" }).to_string()),
            new_values: Some(serde_json::json!({ "status": "rejected" }).to_string()),
            changed_fields: vec!["status".to_string(), "reject_reason".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
