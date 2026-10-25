//! Pure send eligibility; facts come from current canonical authority, not JSON input.
use anyhow::{bail, Result};
use serde_json::{json, Value};

use super::super::protocol::{fingerprint, valid_asset_id};

pub(crate) enum Content {
    Reply(String),
    Template {
        name: String,
        language: String,
        parameters: Vec<String>,
    },
}

pub(crate) struct ReviewedMessage {
    pub organization_id: u64,
    pub company_id: u64,
    pub account_id: u64,
    pub operational_message_id: u64,
    pub phone_number_id: String,
    pub recipient: String,
    pub review_digest: String,
    pub content: Content,
}

/// Not deserializable from browser or model input.
pub(crate) struct Eligibility {
    pub organization_id: u64,
    pub company_id: u64,
    pub account_id: u64,
    pub review_digest: String,
    pub approved_payload_digest: String,
    pub actor_can_send: bool,
    pub sender_active: bool,
    pub explicit_opt_in: bool,
    pub opted_out: bool,
    pub quiet_hours_allow: bool,
    pub last_customer_message_seconds: Option<u64>,
    pub exact_meta_template_approved: bool,
    pub meta_approval_checked_at_seconds: Option<u64>,
}

pub(crate) trait FreshAuthorization {
    async fn refresh(&self, message: &ReviewedMessage) -> Result<Eligibility>;
}

pub(super) fn payload(message: &ReviewedMessage) -> Result<Value> {
    if !valid_asset_id(&message.phone_number_id)
        || !(8..=15).contains(&message.recipient.len())
        || message.recipient.starts_with('0')
        || !message.recipient.bytes().all(|byte| byte.is_ascii_digit())
    {
        bail!("invalid verified whatsapp addressing");
    }
    let mut result = json!({"messaging_product":"whatsapp","recipient_type":"individual",
        "to":message.recipient});
    match &message.content {
        Content::Reply(body) => {
            result["type"] = json!("text");
            result["text"] = json!({"body":body,"preview_url":false});
        }
        Content::Template {
            name,
            language,
            parameters,
        } => {
            let components = if parameters.is_empty() {
                vec![]
            } else {
                let parameters: Vec<_> = parameters
                    .iter()
                    .map(|text| json!({"type":"text","text":text}))
                    .collect();
                vec![json!({"type":"body","parameters":parameters})]
            };
            result["type"] = json!("template");
            result["template"] = json!({"name":name,"language":{"code":language},
                "components":components});
        }
    }
    Ok(result)
}

pub(crate) fn reviewed_payload_digest(message: &ReviewedMessage) -> Result<String> {
    Ok(fingerprint(&json!([
        message.phone_number_id,
        payload(message)?
    ])))
}

pub(crate) fn validate(message: &ReviewedMessage, current: &Eligibility, now: u64) -> Result<()> {
    let requested = (
        message.organization_id,
        message.company_id,
        message.account_id,
    );
    let authorized = (
        current.organization_id,
        current.company_id,
        current.account_id,
    );
    if requested.0 == 0
        || requested.1 == 0
        || requested.2 == 0
        || message.operational_message_id == 0
        || requested != authorized
        || message.review_digest != current.review_digest
        || message.review_digest.len() != 64
        || !message
            .review_digest
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || reviewed_payload_digest(message)? != current.approved_payload_digest
        || !current.actor_can_send
        || !current.sender_active
        || !current.explicit_opt_in
        || current.opted_out
        || !current.quiet_hours_allow
    {
        bail!("whatsapp authority, consent or reviewed scope is no longer valid");
    }
    match &message.content {
        Content::Reply(body) => {
            let last = current
                .last_customer_message_seconds
                .filter(|last| *last <= now)
                .ok_or_else(|| anyhow::anyhow!("no verified customer service window"))?;
            if now - last >= 86400 || body.trim().is_empty() || body.len() > 4000 {
                bail!("whatsapp reply is outside its service window or body limit");
            }
        }
        Content::Template {
            name,
            language,
            parameters,
        } => {
            let fresh = current
                .meta_approval_checked_at_seconds
                .is_some_and(|checked| checked <= now && now - checked <= 60);
            if !current.exact_meta_template_approved
                || !fresh
                || name.is_empty()
                || language.is_empty()
                || parameters.len() > 20
                || parameters.iter().any(|value| value.len() > 4000)
            {
                bail!("exact current Meta template approval is required");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (ReviewedMessage, Eligibility) {
        let message = ReviewedMessage {
            organization_id: 1,
            company_id: 2,
            account_id: 3,
            operational_message_id: 4,
            phone_number_id: "123".into(),
            recipient: "250788123456".into(),
            review_digest: "a".repeat(64),
            content: Content::Reply("Thank you".into()),
        };
        let policy = Eligibility {
            organization_id: 1,
            company_id: 2,
            account_id: 3,
            review_digest: "a".repeat(64),
            approved_payload_digest: reviewed_payload_digest(&message).unwrap(),
            actor_can_send: true,
            sender_active: true,
            explicit_opt_in: true,
            opted_out: false,
            quiet_hours_allow: true,
            last_customer_message_seconds: Some(100),
            exact_meta_template_approved: false,
            meta_approval_checked_at_seconds: None,
        };
        (message, policy)
    }

    #[test]
    fn revoked_consent_authority_and_stale_review_fail_closed() {
        let (message, mut current) = fixture();
        assert!(validate(&message, &current, 101).is_ok());
        current.explicit_opt_in = false;
        assert!(validate(&message, &current, 101).is_err());
        current.explicit_opt_in = true;
        current.actor_can_send = false;
        assert!(validate(&message, &current, 101).is_err());
        current.actor_can_send = true;
        current.review_digest = "b".repeat(64);
        assert!(validate(&message, &current, 101).is_err());
    }

    #[test]
    fn changing_recipient_or_sender_invalidates_review() {
        let (mut message, current) = fixture();
        message.recipient = "250788123457".into();
        assert!(validate(&message, &current, 101).is_err());
        message.recipient = "250788123456".into();
        message.phone_number_id = "124".into();
        assert!(validate(&message, &current, 101).is_err());
    }

    #[test]
    fn reply_window_uses_customer_timestamp_not_callback_arrival() {
        let (message, current) = fixture();
        assert!(validate(&message, &current, 86499).is_ok());
        assert!(validate(&message, &current, 86500).is_err());
        assert!(validate(&message, &current, 99).is_err());
    }

    #[test]
    fn internal_approval_is_not_meta_template_approval() {
        let (mut message, mut current) = fixture();
        message.content = Content::Template {
            name: "invoice_ready".into(),
            language: "en".into(),
            parameters: vec!["INV-1".into()],
        };
        current.approved_payload_digest = reviewed_payload_digest(&message).unwrap();
        assert!(validate(&message, &current, 200).is_err());
        current.exact_meta_template_approved = true;
        current.meta_approval_checked_at_seconds = Some(200);
        assert!(validate(&message, &current, 200).is_ok());
        assert!(validate(&message, &current, 261).is_err());
    }

    #[test]
    fn inbound_stop_and_quiet_hours_override_valid_reviews() {
        let (message, mut current) = fixture();
        current.opted_out = true;
        assert!(validate(&message, &current, 101).is_err());
        current.opted_out = false;
        current.quiet_hours_allow = false;
        assert!(validate(&message, &current, 101).is_err());
        current.quiet_hours_allow = true;
        current.company_id = 99;
        assert!(validate(&message, &current, 101).is_err());
    }
}
