//! Canonical queue preparation. No provider I/O and no delivery claims.
use sha2::{Digest, Sha256};
use spacetimedb::{ReducerContext, Table};

use super::*;

fn select_sender(candidates: &[(u64, bool, bool)]) -> Result<Option<u64>, String> {
    let company_owned = candidates.iter().any(|candidate| candidate.1);
    let scoped: Vec<_> = candidates
        .iter()
        .filter(|candidate| candidate.1 == company_owned)
        .collect();
    match scoped.as_slice() {
        [] => Ok(None),
        [only] => Ok(Some(only.0)),
        _ => {
            let primary: Vec<_> = scoped.iter().filter(|candidate| candidate.2).collect();
            match primary.as_slice() {
                [only] => Ok(Some(only.0)),
                _ => Err("select one primary WhatsApp sender for this company".into()),
            }
        }
    }
}

/// Bind the account from trusted company configuration, never caller metadata.
/// Copy-first installations without a configured sender retain their old path.
pub(super) fn prepare(
    ctx: &ReducerContext,
    mut conversation: CrmConversation,
    body: &str,
    status: &str,
) -> Result<(CrmConversation, Option<u64>), String> {
    if conversation.channel != MessageChannel::WhatsApp || status != "queued" {
        return Ok((conversation, None));
    }
    let organization_id = conversation.organization_id;
    let company_id = conversation.company_id;
    let account_id = match conversation.provider_account_id {
        Some(id) => Some(id),
        None => {
            let candidates: Vec<_> = ctx
                .db
                .whatsapp_business_account()
                .wa_account_by_org()
                .filter(&organization_id)
                .filter(|account| {
                    account.is_active
                        && account.deleted_at.is_none()
                        && account.messaging_enabled
                        && account.webhook_enabled
                        && account.company_id.is_none_or(|id| id == company_id)
                })
                .map(|account| (account.id, account.company_id.is_some(), account.is_primary))
                .collect();
            select_sender(&candidates)?
        }
    };
    let Some(account_id) = account_id else {
        return Ok((conversation, None));
    };
    let account = load_active_provider_account(ctx, organization_id, account_id)?;
    if account.company_id.is_some_and(|id| id != company_id) {
        return Err("WhatsApp sender belongs to another company".into());
    }
    if !account
        .subscribed_webhook_events
        .iter()
        .any(|event| event == "message_status")
    {
        return Err("WhatsApp sender must subscribe to delivery status".into());
    }
    let identity_id = conversation
        .phone_identity_id
        .ok_or("conversation lacks a recipient")?;
    let operational = ctx.db.operational_message().insert(OperationalMessage {
        id: 0,
        organization_id,
        company_id: Some(company_id),
        message_batch_id: 0,
        // Zero is a human-composed conversation intent, NOT a Meta-approved template.
        // The API must independently review the exact content and Meta template/window.
        template_id: 0,
        contact_id: conversation.contact_id,
        phone_identity_id: identity_id,
        channel: MessageChannel::WhatsApp,
        status: OperationalMessageStatus::Queued,
        subject_model: "crm_conversation".into(),
        subject_id: conversation.id,
        rendered_subject: None,
        rendered_body: body.to_owned(),
        variable_hash: format!("{:x}", Sha256::digest(body.as_bytes())),
        copied_at: None,
        queued_at: Some(ctx.timestamp),
        sent_at: None,
        failed_at: None,
        failure_reason: None,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: None,
    });
    conversation.provider_account_id = Some(account_id);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "operational_message",
            record_id: operational.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "status": "queued", "conversation_id": conversation.id,
                    "provider_account_id": account_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".into()],
            metadata: None,
        },
    );
    Ok((conversation, Some(operational.id)))
}

#[cfg(test)]
mod tests {
    use super::select_sender;

    #[test]
    fn sender_selection_is_company_first_and_ambiguity_is_not_guessed() {
        assert_eq!(select_sender(&[]).unwrap(), None);
        assert_eq!(
            select_sender(&[(1, false, true), (2, true, false)]).unwrap(),
            Some(2)
        );
        assert!(select_sender(&[(1, true, false), (2, true, false)]).is_err());
        assert_eq!(
            select_sender(&[(1, true, false), (2, true, true)]).unwrap(),
            Some(2)
        );
        assert!(select_sender(&[(1, true, true), (2, true, true)]).is_err());
    }
}
