//! Workflow and notification hooks for AI action draft lifecycle events.

use spacetimedb::{Identity, ReducerContext, Table};

use crate::core::messaging::{mail_message, MailMessage};
use crate::core::users::user_organization;
use crate::types::MailMessageType;
use crate::workflow::definitions::{
    workflow, workflow_version, ConditionValue, WorkflowVersionStatus,
};
use crate::workflow::evaluator::{
    canonical_condition_snapshot_hash, ConditionSnapshot, ConditionSnapshotField,
};
use crate::workflow::runtime::{
    signal_workflow, start_workflow, workflow_instance, SignalWorkflowParams, StartWorkflowParams,
    WorkflowInstanceState,
};

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
    let reason_text = reason
        .filter(|value| !value.is_empty())
        .unwrap_or("No reason provided");
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
            row.model == "ai_action_draft"
                && row
                    .company_id
                    .map_or(true, |company_id| company_id == draft.company_id)
        })?;
    let workflow_version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow_def.id)
        .filter(|row| row.status == WorkflowVersionStatus::Published)
        .max_by_key(|row| row.version)?;
    let snapshot = ai_action_draft_snapshot(draft).ok()?;

    start_workflow(
        ctx,
        draft.organization_id,
        StartWorkflowParams {
            company_id: draft.company_id,
            workflow_id: workflow_def.id,
            workflow_version_id: workflow_version.id,
            subject_model: "ai_action_draft".to_string(),
            subject_id: draft.id,
            subject_revision_hash: snapshot.subject_revision_hash,
            singleton_trigger_key: None,
            idempotency_key: format!("ai-action-draft:{}:start", draft.id),
            correlation_id: format!("ai-action-draft:{}", draft.id),
            causation_id: None,
        },
    )
    .ok()?;

    ctx.db
        .workflow_instance()
        .instance_by_org()
        .filter(&draft.organization_id)
        .filter(|row| row.subject_model == "ai_action_draft" && row.subject_id == draft.id)
        .max_by_key(|row| row.id)
        .map(|row| row.id)
}

fn advance_draft_workflow(ctx: &ReducerContext, draft: &AiActionDraft, signal: &str) {
    let Some(instance) = ctx
        .db
        .workflow_instance()
        .instance_by_org()
        .filter(&draft.organization_id)
        .filter(|row| row.subject_model == "ai_action_draft" && row.subject_id == draft.id)
        .filter(|row| row.state == WorkflowInstanceState::Active)
        .max_by_key(|row| row.id)
    else {
        return;
    };

    if let Err(error) = signal_workflow(
        ctx,
        draft.organization_id,
        SignalWorkflowParams {
            company_id: draft.company_id,
            instance_id: instance.id,
            expected_revision: instance.revision,
            signal_key: signal.to_string(),
            snapshot: match ai_action_draft_snapshot(draft) {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    log::warn!(
                        "AI action draft snapshot failed: draft_id={}, error={}",
                        draft.id,
                        error
                    );
                    return;
                }
            },
            idempotency_key: format!("ai-action-draft:{}:signal:{signal}", draft.id),
            correlation_id: instance.correlation_id.clone(),
            causation_id: Some(format!("ai-action-draft:{}:{signal}", draft.id)),
        },
    ) {
        log::warn!(
            "AI action draft workflow signal failed: draft_id={}, signal={}, error={}",
            draft.id,
            signal,
            error
        );
    }
}

fn ai_action_draft_snapshot(draft: &AiActionDraft) -> Result<ConditionSnapshot, String> {
    let mut snapshot = ConditionSnapshot {
        subject_model: "ai_action_draft".to_string(),
        subject_id: draft.id,
        subject_revision_hash: String::new(),
        fields: vec![
            ConditionSnapshotField {
                field_key: "params_json".to_string(),
                value: ConditionValue::Text(draft.params_json.clone()),
            },
            ConditionSnapshotField {
                field_key: "reducer_name".to_string(),
                value: ConditionValue::Code(draft.reducer_name.clone()),
            },
            ConditionSnapshotField {
                field_key: "summary".to_string(),
                value: ConditionValue::Text(draft.summary.clone()),
            },
        ],
    };
    snapshot.subject_revision_hash = canonical_condition_snapshot_hash(&snapshot)
        .map_err(|error| format!("cannot hash AI action draft snapshot: {error}"))?;
    Ok(snapshot)
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
        metadata: None,
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

    ctx.db.mail_message().insert(MailMessage {
        id: 0,
        organization_id: draft.organization_id,
        model: "ai_action_draft".to_string(),
        res_id: draft.id,
        author_id: ctx.sender(),
        body: body.to_string(),
        message_type: MailMessageType::Email,
        subtype: Some("ai.action_draft.email".to_string()),
        date: ctx.timestamp,
        parent_id: None,
        attachment_ids: vec![],
        metadata: Some(
            serde_json::json!({
                "delivery": "queued",
                "subject": format!("AI action draft #{} pending approval", draft.id),
                "approver_identities": recipient_lines,
            })
            .to_string(),
        ),
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
