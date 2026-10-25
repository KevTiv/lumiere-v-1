//! Native Meta webhook -> durable transport inbox -> canonical CRM reducer.
//! A 200 acknowledges durable storage, not delivery or financial settlement.
mod connection;
mod inbound;
mod operator;
mod outbound;
mod protocol;
mod store;

use std::{sync::Arc, time::Duration};

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Query, State},
    http::{HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::whatsapp_webhooks::verify_signature;
use crate::{cold_tier::pg_pool, config::Config, error::ApiError, state::AppState};
use protocol::{event_key, fingerprint, Envelope, Incoming, MAX_EVENTS};

const MAX_PAYLOAD_BYTES: usize = 1024 * 1024;

fn enabled() -> bool {
    std::env::var("LUMIERE_WHATSAPP_META_ENABLED").as_deref() == Ok("1")
}

fn require_enabled() -> Result<(), ApiError> {
    if enabled() {
        Ok(())
    } else {
        Err(ApiError::Unavailable(
            "meta webhook transport is disabled".into(),
        ))
    }
}

fn secret(name: &str) -> Result<String, ApiError> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::Unavailable("meta webhook secrets are not configured".into()))
}

#[derive(Deserialize)]
struct VerificationQuery {
    #[serde(rename = "hub.mode")]
    mode: String,
    #[serde(rename = "hub.verify_token")]
    token: String,
    #[serde(rename = "hub.challenge")]
    challenge: String,
}

fn challenge(expected: &str, query: VerificationQuery) -> Result<String, ApiError> {
    let left: [u8; 32] = Sha256::digest(expected.as_bytes()).into();
    let right: [u8; 32] = Sha256::digest(query.token.as_bytes()).into();
    let difference = left
        .iter()
        .zip(right.iter())
        .fold(0, |acc, (a, b)| acc | (a ^ b));
    if expected.is_empty()
        || query.mode != "subscribe"
        || difference != 0
        || query.challenge.is_empty()
        || query.challenge.len() > 512
    {
        return Err(ApiError::Unauthorized);
    }
    Ok(query.challenge)
}

async fn verify_webhook(Query(query): Query<VerificationQuery>) -> Result<String, ApiError> {
    require_enabled()?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    store::verify(pool).await.map_err(ApiError::unavailable)?;
    challenge(&secret("LUMIERE_WHATSAPP_META_VERIFY_TOKEN")?, query)
}

async fn prepare_batch(state: &AppState, envelope: Envelope) -> Result<Vec<Incoming>, ApiError> {
    if envelope.object != "whatsapp_business_account" {
        return Err(ApiError::BadRequest(
            "not a whatsapp business webhook".into(),
        ));
    }
    let mut events = Vec::new();
    for entry in envelope.entry {
        for change in entry.changes {
            if change.field != "messages" {
                return Err(ApiError::BadRequest(
                    "unconfigured meta webhook field".into(),
                ));
            }
            let phone = change
                .value
                .pointer("/metadata/phone_number_id")
                .and_then(Value::as_str)
                .ok_or_else(|| ApiError::BadRequest("missing meta receiving number".into()))?;
            let account = inbound::account(state, &entry.id, phone).await?;
            let mut items = Vec::new();
            for (key, kind) in [("messages", "message"), ("statuses", "status")] {
                if let Some(value) = change.value.get(key) {
                    let array = value
                        .as_array()
                        .ok_or_else(|| ApiError::BadRequest("invalid meta event array".into()))?;
                    items.extend(array.iter().map(|payload| (kind, payload.clone())));
                }
            }
            if items.is_empty() {
                items.push(("other", change.value.clone()));
            }
            for (kind, payload) in items {
                if events.len() >= MAX_EVENTS {
                    return Err(ApiError::BadRequest(
                        "meta batch exceeds event limit".into(),
                    ));
                }
                events.push(Incoming {
                    organization_id: account.organization_id,
                    account_id: account.account_id,
                    company_id: account.company_id,
                    business_account_id: entry.id.clone(),
                    phone_number_id: phone.to_owned(),
                    kind: kind.to_owned(),
                    event_key: event_key(kind, &payload),
                    fingerprint: fingerprint(&payload),
                    payload,
                });
            }
        }
    }
    if events.is_empty() {
        return Err(ApiError::BadRequest("empty meta webhook".into()));
    }
    Ok(events)
}

async fn receive_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    require_enabled()?;
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|value| value.to_str().ok())
        .ok_or(ApiError::Unauthorized)?;
    let key = secret("LUMIERE_WHATSAPP_WEBHOOK_APP_SECRET")?;
    if !verify_signature(key.as_bytes(), &body, signature) {
        return Err(ApiError::Unauthorized);
    }
    let envelope = serde_json::from_slice::<Envelope>(&body)
        .map_err(|_| ApiError::BadRequest("invalid meta webhook JSON".into()))?;
    let events = prepare_batch(&state, envelope).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    tokio::time::timeout(Duration::from_secs(5), store::persist(pool, &events))
        .await
        .map_err(|_| ApiError::Unavailable("meta inbox persistence timed out".into()))?
        .map_err(|_| ApiError::Unavailable("meta inbox persistence failed".into()))?;
    Ok((
        StatusCode::OK,
        Json(json!({"received": true, "persisted": events.len()})),
    ))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/webhooks/whatsapp/meta",
            get(verify_webhook).post(receive_webhook),
        )
        .merge(operator::router())
        .layer(DefaultBodyLimit::max(MAX_PAYLOAD_BYTES))
}

/// Standalone restart-safe incoming worker. Outbound sends require the user API.
/// --migrate is explicit and is never performed on normal startup.
pub(crate) async fn run_worker() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let pool = pg_pool::required_pool()?;
    match args.as_slice() {
        [flag] if flag == "--migrate" => return store::migrate(pool).await,
        [flag, org, account, id] if flag == "--requeue" => {
            store::verify(pool).await?;
            return store::requeue(pool, org.parse()?, account.parse()?, id.parse()?).await;
        }
        [] => {}
        _ => {
            anyhow::bail!("usage: whatsapp-inbox-worker [--migrate | --requeue ORG ACCOUNT EVENT]")
        }
    }
    if !enabled() {
        anyhow::bail!("LUMIERE_WHATSAPP_META_ENABLED=1 is required for the inbox worker");
    }
    store::verify(pool).await?;
    let config = Config::from_nonreporting_worker_env()?;
    if config.stdb_server_token.is_none() {
        anyhow::bail!("STDB_SERVER_TOKEN is required for provider account resolution");
    }
    let state = AppState::new(config);
    loop {
        let lease = match store::claim(pool).await {
            Ok(Some(lease)) => lease,
            Ok(None) => {
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
            Err(_) => {
                tracing::error!("whatsapp inbox claim failed");
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
        };
        let outcome = match serde_json::from_str::<Incoming>(&lease.event_json) {
            Ok(event) => {
                let processing =
                    tokio::time::timeout(Duration::from_secs(45), inbound::process(&state, &event))
                        .await;
                match processing {
                    Ok(Ok(())) => (store::Outcome::Processed, "canonical_receipt_recorded"),
                    Ok(Err(ApiError::BadRequest(_) | ApiError::Unprocessable(_))) => {
                        (store::Outcome::Quarantined, "identity_or_content_triage")
                    }
                    Ok(Err(ApiError::Forbidden(_) | ApiError::Unauthorized)) => (
                        store::Outcome::Quarantined,
                        "provider_authority_or_scope_denied",
                    ),
                    _ => (store::Outcome::Retry, "canonical_processing_unconfirmed"),
                }
            }
            Err(_) => (store::Outcome::Quarantined, "invalid_stored_envelope"),
        };
        if store::finish(pool, &lease, outcome.0, outcome.1)
            .await
            .is_err()
        {
            tracing::warn!(inbox_id = lease.id, "whatsapp completion is unconfirmed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(mode: &str, token: &str) -> VerificationQuery {
        VerificationQuery {
            mode: mode.into(),
            token: token.into(),
            challenge: "12345".into(),
        }
    }

    #[test]
    fn challenge_checks_mode_token_and_preserves_exact_response() {
        assert_eq!(
            challenge("secret", query("subscribe", "secret")).unwrap(),
            "12345"
        );
        assert!(challenge("secret", query("subscribe", "wrong")).is_err());
        assert!(challenge("secret", query("other", "secret")).is_err());
        assert!(challenge("", query("subscribe", "")).is_err());
    }
}
