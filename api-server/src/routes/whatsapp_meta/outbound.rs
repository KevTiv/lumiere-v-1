//! Send-once Meta transport. Only a fresh, actor-bound reviewed source may call it.
mod claim;
pub(super) mod meta;
pub(super) mod policy;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Result};
use deadpool_postgres::Pool;
use serde_json::{json, Value};

use super::protocol::fingerprint;
use policy::{payload, validate, FreshAuthorization, ReviewedMessage};

pub(super) struct MetaTransport {
    http: reqwest::Client,
    version: String,
}

impl MetaTransport {
    pub fn new(version: &str) -> Result<Self> {
        let valid = version
            .strip_prefix('v')
            .and_then(|value| value.split_once('.'))
            .is_some_and(|(major, minor)| {
                !major.is_empty()
                    && !minor.is_empty()
                    && major.bytes().all(|byte| byte.is_ascii_digit())
                    && minor.bytes().all(|byte| byte.is_ascii_digit())
            });
        if !valid || version.len() > 12 {
            bail!("an explicit valid Meta Graph API version is required");
        }
        Ok(Self {
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(30))
                .build()?,
            version: version.to_owned(),
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum SendOutcome {
    Accepted(String),
    Rejected,
    Unknown,
    AlreadyAttempted,
}

fn now_seconds() -> Result<u64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs())
}

/// Consume a durable attempt and revalidate immediately before contacting Meta.
/// Unknown attempts are never automatically reclaimed. No provider idempotency
/// guarantee is assumed, and HTTP acceptance is not recipient delivery.
pub(super) async fn send_once(
    pool: &Pool,
    transport: &MetaTransport,
    message: &ReviewedMessage,
    token: &str,
    daily_limit: u32,
    guard: &impl FreshAuthorization,
) -> Result<SendOutcome> {
    if token.trim().is_empty() {
        bail!("whatsapp sender credential is unavailable");
    }
    let first = guard.refresh(message).await?;
    validate(message, &first, now_seconds()?)?;
    let mut body = payload(message)?;
    let intent = fingerprint(&json!([
        message.organization_id,
        message.company_id,
        message.account_id,
        message.operational_message_id,
        message.review_digest
    ]));
    body["biz_opaque_callback_data"] = json!(intent);
    let digest = fingerprint(&json!([message.phone_number_id, body]));
    if !claim::acquire(pool, message, &intent, &digest, daily_limit).await? {
        return Ok(SendOutcome::AlreadyAttempted);
    }
    // Lost claim acknowledgement stops before provider I/O. A crash after
    // claiming leaves an inspectable, non-replayable attempt.
    let still_authorized = match guard.refresh(message).await {
        Ok(current) => validate(message, &current, now_seconds()?).is_ok(),
        Err(_) => false,
    };
    if !still_authorized {
        finish(pool, &intent, &SendOutcome::Rejected).await?;
        bail!("whatsapp authorization changed immediately before dispatch");
    }
    let endpoint = format!(
        "https://graph.facebook.com/{}/{}/messages",
        transport.version, message.phone_number_id
    );
    let response = transport
        .http
        .post(endpoint)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await;
    let outcome = match response {
        Ok(response) => response_outcome(response).await,
        Err(_) => SendOutcome::Unknown,
    };
    finish(pool, &intent, &outcome).await?;
    Ok(outcome)
}

fn classify_response(status: u16, value: &Value) -> SendOutcome {
    if (200..300).contains(&status) {
        if let Some(messages) = value.get("messages").and_then(Value::as_array) {
            if messages.len() == 1 {
                if let Some(id) = messages[0]
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty() && id.len() <= 255)
                {
                    return SendOutcome::Accepted(id.to_owned());
                }
            }
        }
    } else if (400..500).contains(&status)
        && status != 408
        && value
            .pointer("/error/code")
            .and_then(Value::as_u64)
            .is_some()
        && value.get("messages").is_none()
    {
        return SendOutcome::Rejected;
    }
    SendOutcome::Unknown
}

async fn response_outcome(mut response: reqwest::Response) -> SendOutcome {
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if bytes.len() + chunk.len() <= 65536 => {
                bytes.extend_from_slice(&chunk)
            }
            Ok(None) => break,
            _ => return SendOutcome::Unknown,
        }
    }
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(value) => classify_response(status, &value),
        Err(_) => SendOutcome::Unknown,
    }
}

async fn finish(pool: &Pool, intent: &str, outcome: &SendOutcome) -> Result<()> {
    let (state, provider) = match outcome {
        SendOutcome::Accepted(id) => ("accepted", Some(id.as_str())),
        SendOutcome::Rejected => ("rejected", None),
        _ => ("unknown", None),
    };
    let client = pool.get().await?;
    let count = client
        .execute(
            "UPDATE lumiere_whatsapp.outbox SET state=$2,provider_message_id=$3,finished_at=now() \
             WHERE intent_key=$1 AND state='attempted'",
            &[&intent, &state, &provider],
        )
        .await?;
    if count == 1 {
        return Ok(());
    }
    // A signed status callback may already have bound this exact attempt.
    let row = client.query_opt(
        "SELECT provider_message_id FROM lumiere_whatsapp.outbox WHERE intent_key=$1 AND state='accepted'",
        &[&intent],
    ).await?;
    let verified = row.and_then(|row| row.get::<_, Option<String>>(0));
    if verified.as_deref().is_some_and(|id| provider.is_none_or(|expected| expected == id)) {
        return Ok(());
    }
    bail!("whatsapp acceptance recording is unconfirmed; do not resend")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acceptance_requires_one_provider_message_id() {
        assert_eq!(classify_response(200, &json!({})), SendOutcome::Unknown);
        assert_eq!(
            classify_response(200, &json!({"messages":[]})),
            SendOutcome::Unknown
        );
        assert_eq!(
            classify_response(200, &json!({"messages":[{"id":"wamid.1"}]})),
            SendOutcome::Accepted("wamid.1".into())
        );
    }

    #[test]
    fn uncertain_server_timeout_and_malformed_errors_are_not_rejections() {
        for status in [408, 500, 503] {
            assert_eq!(
                classify_response(status, &json!({"error":{"code":1}})),
                SendOutcome::Unknown
            );
        }
        assert_eq!(classify_response(429, &json!({})), SendOutcome::Unknown);
        assert_eq!(
            classify_response(400, &json!({"error":{"code":100}})),
            SendOutcome::Rejected
        );
    }
}
