//! Approval gate — evaluate rules and create pending requests (no domain imports).

use spacetimedb::{ReducerContext, Table};

use crate::core::messaging::{mail_message, MailMessage};
use crate::types::MailMessageType;

use super::approvals::{approval_request, approval_rule, ApprovalRequest, ApprovalRule};

/// Returns `Ok(Some(request_id))` when approval is required.
pub fn gate_action_with_approval(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    model: &str,
    res_id: u64,
    action: &str,
    metric_value: f64,
    summary: &str,
    params_json: &str,
    context_json: Option<String>,
) -> Result<Option<u64>, String> {
    if has_approved_request(ctx, organization_id, model, res_id, action) {
        return Ok(None);
    }

    if let Some(existing) = find_pending_request(ctx, organization_id, model, res_id, action) {
        return Ok(Some(existing.id));
    }

    let matching_rule =
        find_matching_rule(ctx, organization_id, company_id, model, action, metric_value)?;

    let Some(rule) = matching_rule else {
        return Ok(None);
    };

    let request = insert_approval_request(
        ctx,
        organization_id,
        company_id,
        &rule,
        model,
        res_id,
        action,
        summary,
        params_json,
        context_json,
    );

    notify_approval_event(
        ctx,
        &request,
        "pending",
        &format!("Approval required: {}", request.summary),
    );

    Ok(Some(request.id))
}

/// Creates a unified inbox entry for every pending AI action draft.
pub fn create_ai_draft_approval_request(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    draft_id: u64,
    summary: &str,
    params_json: &str,
    elevated: bool,
) {
    if find_pending_request(
        ctx,
        organization_id,
        "ai_action_draft",
        draft_id,
        "approve_ai_action_draft",
    )
    .is_some()
    {
        return;
    }

    let request = ctx.db.approval_request().insert(ApprovalRequest {
        id: 0,
        organization_id,
        company_id,
        rule_id: 0,
        model: "ai_action_draft".to_string(),
        res_id: draft_id,
        action: "approve_ai_action_draft".to_string(),
        params_json: params_json.to_string(),
        status: "pending".to_string(),
        summary: summary.to_string(),
        context_json: Some(
            serde_json::json!({ "elevated": elevated, "draft_id": draft_id }).to_string(),
        ),
        requested_by: ctx.sender(),
        requested_at: ctx.timestamp,
        reviewed_by: None,
        reviewed_at: None,
        reject_reason: None,
        reviewer_comment: None,
        ai_draft_id: Some(draft_id),
        workflow_instance_id: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: Some(
            serde_json::json!({
                "approval_channel": "ai_action_draft",
                "elevated": elevated,
            })
            .to_string(),
        ),
    });

    notify_approval_event(
        ctx,
        &request,
        "pending",
        &format!("AI action draft pending approval: {summary}"),
    );
}

pub fn has_approved_request(
    ctx: &ReducerContext,
    organization_id: u64,
    model: &str,
    res_id: u64,
    action: &str,
) -> bool {
    ctx.db
        .approval_request()
        .approval_request_by_org()
        .filter(&organization_id)
        .any(|row| {
            row.model == model
                && row.res_id == res_id
                && row.action == action
                && row.status == "approved"
        })
}

pub fn find_pending_request(
    ctx: &ReducerContext,
    organization_id: u64,
    model: &str,
    res_id: u64,
    action: &str,
) -> Option<ApprovalRequest> {
    ctx.db
        .approval_request()
        .approval_request_by_org()
        .filter(&organization_id)
        .find(|row| {
            row.model == model
                && row.res_id == res_id
                && row.action == action
                && row.status == "pending"
        })
}

fn find_matching_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    model: &str,
    action: &str,
    metric_value: f64,
) -> Result<Option<ApprovalRule>, String> {
    let mut rules: Vec<ApprovalRule> = ctx
        .db
        .approval_rule()
        .approval_rule_by_org()
        .filter(&organization_id)
        .filter(|rule| {
            rule.is_active
                && rule.model == model
                && rule.action == action
                && rule.company_id.map_or(true, |cid| cid == company_id)
        })
        .collect();

    rules.sort_by_key(|rule| rule.sequence);

    for rule in rules {
        if rule_matches(&rule, metric_value) {
            return Ok(Some(rule));
        }
    }

    Ok(None)
}

fn rule_matches(rule: &ApprovalRule, metric_value: f64) -> bool {
    match rule.rule_type.as_str() {
        "amount_threshold" => metric_value >= rule.threshold,
        "discount_percent" => metric_value >= rule.threshold,
        _ => false,
    }
}

fn insert_approval_request(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule: &ApprovalRule,
    model: &str,
    res_id: u64,
    action: &str,
    summary: &str,
    params_json: &str,
    context_json: Option<String>,
) -> ApprovalRequest {
    ctx.db.approval_request().insert(ApprovalRequest {
        id: 0,
        organization_id,
        company_id,
        rule_id: rule.id,
        model: model.to_string(),
        res_id,
        action: action.to_string(),
        params_json: params_json.to_string(),
        status: "pending".to_string(),
        summary: summary.to_string(),
        context_json,
        requested_by: ctx.sender(),
        requested_at: ctx.timestamp,
        reviewed_by: None,
        reviewed_at: None,
        reject_reason: None,
        reviewer_comment: None,
        ai_draft_id: None,
        workflow_instance_id: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: Some(
            serde_json::json!({
                "rule_id": rule.id,
                "rule_name": rule.name,
                "approval_channel": "approval_request",
            })
            .to_string(),
        ),
    })
}

pub fn notify_approval_event(
    ctx: &ReducerContext,
    request: &ApprovalRequest,
    event: &str,
    body: &str,
) {
    let _ = ctx.db.mail_message().insert(MailMessage {
        id: 0,
        organization_id: request.organization_id,
        model: "approval_request".to_string(),
        res_id: request.id,
        author_id: ctx.sender(),
        body: body.to_string(),
        message_type: MailMessageType::Notification,
        subtype: Some(format!("approval.{event}")),
        date: ctx.timestamp,
        parent_id: None,
        attachment_ids: Vec::new(),
        metadata: None,
    });
}
