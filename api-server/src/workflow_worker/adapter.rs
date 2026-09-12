//! Fail-closed dispatch allowlists, webhook delivery and existing fingerprint mode.
use crate::{config::Config, state::AppState};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;

#[derive(Debug, Deserialize, Clone)]
pub(super) struct OutboxPayload {
    #[serde(alias = "outboxId", default)]
    pub(super) outbox_id: Option<u64>,
    #[serde(alias = "companyId")]
    pub(super) company_id: u64,
    #[serde(alias = "actionKey", default)]
    pub(super) action_key: Option<String>,
    #[serde(alias = "effectKey", default)]
    pub(super) effect_key: Option<String>,
    #[serde(default)]
    pub(super) payload: Option<Value>,
}

pub(super) fn dispatch_allowlisted(
    config: &Config,
    company_id: u64,
    action_key: Option<&str>,
) -> bool {
    if !config.workflow_external_dispatch_company_ids.is_empty()
        && !config
            .workflow_external_dispatch_company_ids
            .contains(&company_id)
    {
        return false;
    }
    // Webhook mode is fail-closed on empty action allowlist.
    if config.workflow_external_webhook_url.is_some() {
        let Some(key) = action_key else {
            return false;
        };
        return config
            .workflow_external_dispatch_action_keys
            .iter()
            .any(|allowed| allowed == key);
    }
    // Fingerprint/dev mode: empty action allowlist means all actions.
    if config.workflow_external_dispatch_action_keys.is_empty() {
        return true;
    }
    action_key.is_some_and(|key| {
        config
            .workflow_external_dispatch_action_keys
            .iter()
            .any(|allowed| allowed == key)
    })
}

/// Fake fingerprint when no webhook is set; HTTP POST when configured.
pub(super) async fn run_external_adapter(
    state: &AppState,
    payload: &OutboxPayload,
) -> anyhow::Result<String> {
    let outbox_id = payload
        .outbox_id
        .ok_or_else(|| anyhow::anyhow!("outbox id required for adapter"))?;
    let key = payload.action_key.as_deref().unwrap_or("workflow.external");
    let effect = outbox_record_idempotency_key(payload);

    if let Some(url) = state.config.workflow_external_webhook_url.as_deref() {
        let body = json!({
            "outboxId": outbox_id,
            "companyId": payload.company_id,
            "actionKey": key,
            "effectKey": effect,
            "payload": payload.payload.clone().unwrap_or(Value::Null),
        });
        let response = state
            .http
            .post(url)
            .header("Idempotency-Key", &effect)
            .timeout(Duration::from_millis(
                state.config.workflow_external_webhook_timeout_ms,
            ))
            .json(&body)
            .send()
            .await
            .map_err(|error| anyhow::anyhow!("webhook request failed: {error}"))?;
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        if !(200..300).contains(&status) {
            return Err(anyhow::anyhow!(
                "webhook returned HTTP {status}: {}",
                text.chars().take(200).collect::<String>()
            ));
        }
        let mut hasher = Sha256::new();
        hasher.update(status.to_le_bytes());
        hasher.update(
            text.as_bytes()
                .iter()
                .take(512)
                .copied()
                .collect::<Vec<_>>(),
        );
        return Ok(format!("sha256:{:x}", hasher.finalize()));
    }

    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    hasher.update(outbox_id.to_le_bytes());
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

pub(super) fn outbox_record_idempotency_key(payload: &OutboxPayload) -> String {
    if let Some(key) = payload.effect_key.clone() {
        return key;
    }
    match payload.outbox_id {
        Some(id) => format!("outbox-result:{id}"),
        None => "outbox-result:unknown".to_string(),
    }
}
