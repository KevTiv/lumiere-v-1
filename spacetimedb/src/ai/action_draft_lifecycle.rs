//! Workflow and notification hooks for AI action draft lifecycle events.

use spacetimedb::{Identity, ReducerContext, Table};

use crate::core::messaging::{mail_message, MailMessage};
use crate::core::users::user_organization;
use crate::types::{InstanceState, MailMessageType, WorkitemState};
use crate::workflow::definitions::{workflow, workflow_activity, workflow_transition};
use crate::workflow::runtime::{workflow_instance, workflow_workitem, WorkflowInstance, WorkflowWorkitem};

use super::action_drafts::{ai_action_draft, AiActionDraft};

pub fn on_draft_created(ctx: &ReducerContext, draft: &AiActionDraft) {
    let instance_id = try_attach_approval_workflow(ctx, draft);
    if let Some(instance_id) = instance_id {
        update_draft_metadata(ctx, draft, instance_id);
    }

    let body = format!(
        "AI action draft #{} is pending approval: {} ({})",
        draft.id, draft.summary, draft.reducer_name
    );
    notify_draft_event(ctx, draft, "pending", &body);
    queue_email_notifications(ctx, draft, &body);
}

pub fn on_draft_approved(ctx: &ReducerContext, draft: &AiActionDraft, record_id: Option<u64>) {
    advance_draft_workflow(ctx, draft, "approve");
    let body = match record_id {
        Some(id) => format!(
            "AI action draft #{} was approved and created record #{}.",
            draft.id, id
        ),
        None => format!("AI action draft #{} was approved.", draft.id),
    };
    notify_draft_event(ctx, draft, "approved", &body);
}

pub fn on_draft_rejected(ctx: &ReducerContext, draft: &AiActionDraft, reason: Option<&str>) {
    advance_draft_workflow(ctx, draft, "reject");
    let reason_text = reason.filter(|value| !value.is_empty()).unwrap_or("No reason provided");
    let body = format!(
        "AI action draft #{} was rejected: {}",
        draft.id, reason_text
    );
    notify_draft_event(ctx, draft, "rejected", &body);
}

pub fn on_draft_expired(ctx: &ReducerContext, draft: &AiActionDraft) {
    advance_draft_workflow(ctx, draft, "expire");
    let body = format!(
        "AI action draft #{} expired before approval: {}",
        draft.id, draft.summary
    );
    notify_draft_event(ctx, draft, "expired", &body);
}

fn try_attach_approval_workflow(ctx: &ReducerContext, draft: &AiActionDraft) -> Option<u64> {
    let workflow_def = ctx
        .db
        .workflow()
        .workflow_by_org()
        .filter(&draft.organization_id)
        .find(|row| {
            row.is_active
                && row.model == "ai_action_draft"
                && row.company_id.map_or(true, |company_id| company_id == draft.company_id)
        })?;

    let start_act = ctx
        .db
        .workflow_activity()
        .activity_by_workflow()
        .filter(&workflow_def.id)
        .find(|activity| activity.flow_start)?;

    let instance = ctx.db.workflow_instance().insert(WorkflowInstance {
        id: 0,
        organization_id: draft.organization_id,
        workflow_id: workflow_def.id,
        res_id: draft.id,
        res_type: "ai_action_draft".to_string(),
        state: InstanceState::Active,
        activity_ids: vec![start_act.id],
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some(
            serde_json::json!({
                "source": "ai_action_draft",
                "draft_id": draft.id,
                "elevated": draft.elevated,
            })
            .to_string(),
        ),
    });

    ctx.db.workflow_workitem().insert(WorkflowWorkitem {
        id: 0,
        organization_id: draft.organization_id,
        instance_id: instance.id,
        act_id: start_act.id,
        wkf_evaled_condition: None,
        state: WorkitemState::Active,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    Some(instance.id)
}

fn advance_draft_workflow(ctx: &ReducerContext, draft: &AiActionDraft, signal: &str) {
    let Some(instance) = ctx
        .db
        .workflow_instance()
        .instance_by_org()
        .filter(&draft.organization_id)
        .filter(|row| row.res_type == "ai_action_draft" && row.res_id == draft.id)
        .filter(|row| row.state == InstanceState::Active)
        .max_by_key(|row| row.id)
    else {
        return;
    };

    let active_items: Vec<WorkflowWorkitem> = ctx
        .db
        .workflow_workitem()
        .workitem_by_instance()
        .filter(&instance.id)
        .filter(|item| item.state == WorkitemState::Active)
        .collect();

    let mut new_activity_ids = instance.activity_ids.clone();
    let mut completed = false;

    for item in active_items {
        let matching: Vec<_> = ctx
            .db
            .workflow_transition()
            .transition_by_from()
            .filter(&item.act_id)
            .filter(|transition| transition.signal.as_deref() == Some(signal))
            .collect();

        for transition in matching {
            let Some(target_act) = ctx
                .db
                .workflow_activity()
                .id()
                .find(&transition.activity_to)
            else {
                continue;
            };

            ctx.db.workflow_workitem().id().update(WorkflowWorkitem {
                state: WorkitemState::Complete,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..item.clone()
            });

            new_activity_ids.retain(|activity_id| *activity_id != item.act_id);
            new_activity_ids.push(target_act.id);

            if target_act.flow_stop {
                ctx.db.workflow_instance().id().update(WorkflowInstance {
                    state: InstanceState::Complete,
                    activity_ids: new_activity_ids.clone(),
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..instance.clone()
                });
                completed = true;
                break;
            }

            ctx.db.workflow_workitem().insert(WorkflowWorkitem {
                id: 0,
                organization_id: draft.organization_id,
                instance_id: instance.id,
                act_id: target_act.id,
                wkf_evaled_condition: None,
                state: WorkitemState::Active,
                create_uid: ctx.sender(),
                create_date: ctx.timestamp,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                metadata: None,
            });
            completed = true;
        }
    }

    if completed {
        return;
    }

    if let Some(latest) = ctx.db.workflow_instance().id().find(&instance.id) {
        if latest.state == InstanceState::Active {
            ctx.db.workflow_instance().id().update(WorkflowInstance {
                activity_ids: new_activity_ids,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..latest
            });
        }
    }
}

fn update_draft_metadata(ctx: &ReducerContext, draft: &AiActionDraft, workflow_instance_id: u64) {
    let metadata = merge_metadata(
        draft.metadata.as_deref(),
        serde_json::json!({
            "approval_channel": "ai_action_draft",
            "workflow_instance_id": workflow_instance_id,
        }),
    );
    ctx.db.ai_action_draft().id().update(AiActionDraft {
        metadata: Some(metadata),
        write_date: ctx.timestamp,
        ..draft.clone()
    });
}

fn merge_metadata(existing: Option<&str>, patch: serde_json::Value) -> String {
    let mut base = existing
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if let Some(patch_obj) = patch.as_object() {
        for (key, value) in patch_obj {
            base.insert(key.clone(), value.clone());
        }
    }
    serde_json::Value::Object(base).to_string()
}

fn notify_draft_event(ctx: &ReducerContext, draft: &AiActionDraft, event: &str, body: &str) {
    ctx.db.mail_message().insert(MailMessage {
        id: 0,
        organization_id: draft.organization_id,
        model: "ai_action_draft".to_string(),
        res_id: draft.id,
        author_id: ctx.sender(),
        body: body.to_string(),
        message_type: MailMessageType::Notification,
        subtype: Some(format!("ai.action_draft.{event}")),
        date: ctx.timestamp,
        parent_id: None,
        attachment_ids: vec![],
    });
}

fn queue_email_notifications(ctx: &ReducerContext, draft: &AiActionDraft, body: &str) {
    let recipients = approver_identities(ctx, draft.organization_id, draft.proposed_by);
    if recipients.is_empty() {
        return;
    }

    let recipient_lines = recipients
        .iter()
        .map(|identity| identity.to_hex().to_string())
        .collect::<Vec<_>>()
        .join(", ");

    let email_body = format!(
        "{body}\n\nEmail queued for approvers: {recipient_lines}\nReview in AI Approvals."
    );

    ctx.db.mail_message().insert(MailMessage {
        id: 0,
        organization_id: draft.organization_id,
        model: "ai_action_draft".to_string(),
        res_id: draft.id,
        author_id: ctx.sender(),
        body: email_body,
        message_type: MailMessageType::Email,
        subtype: Some("ai.action_draft.email".to_string()),
        date: ctx.timestamp,
        parent_id: None,
        attachment_ids: vec![],
    });
}

fn approver_identities(
    ctx: &ReducerContext,
    organization_id: u64,
    proposer: Identity,
) -> Vec<Identity> {
    ctx.db
        .user_organization()
        .user_org_by_org()
        .filter(&organization_id)
        .filter(|membership| membership.is_active)
        .map(|membership| membership.user_identity)
        .filter(|identity| *identity != proposer)
        .collect()
}
