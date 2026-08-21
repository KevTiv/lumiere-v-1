//! Authenticated WhatsApp provider callback boundary.
//!
//! The HMAC secret is server-only. Verified callbacks are forwarded with the
//! SpacetimeDB server identity, which must also be registered as the active CRM
//! provider principal for the organization/account.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{error::ApiError, state::AppState};

const SIGNATURE_HEADER: &str = "x-hub-signature-256";
const WEBHOOK_SECRET_ENV: &str = "LUMIERE_WHATSAPP_WEBHOOK_APP_SECRET";
const MAX_WEBHOOK_AGE_SECONDS: u64 = 300;
const MAX_WEBHOOK_FUTURE_SKEW_SECONDS: u64 = 60;

#[derive(Debug, Deserialize)]
#[serde(tag = "eventType", rename_all = "snake_case")]
enum WhatsAppWebhookEvent {
    InboundMessage {
        #[serde(rename = "accountId")]
        account_id: u64,
        #[serde(rename = "occurredAtUnixSeconds")]
        occurred_at_unix_seconds: u64,
        #[serde(rename = "eventId")]
        event_id: String,
        #[serde(rename = "contactId")]
        contact_id: u64,
        #[serde(rename = "phoneIdentityId")]
        phone_identity_id: u64,
        #[serde(rename = "externalThreadId")]
        external_thread_id: String,
        #[serde(rename = "providerMessageId")]
        provider_message_id: String,
        body: String,
    },
    Delivery {
        #[serde(rename = "accountId")]
        account_id: u64,
        #[serde(rename = "occurredAtUnixSeconds")]
        occurred_at_unix_seconds: u64,
        #[serde(rename = "eventId")]
        event_id: String,
        #[serde(rename = "conversationId")]
        conversation_id: u64,
        #[serde(rename = "conversationMessageId")]
        conversation_message_id: u64,
        #[serde(rename = "providerMessageId")]
        provider_message_id: String,
        #[serde(rename = "operationalMessageId")]
        operational_message_id: u64,
        status: String,
        #[serde(rename = "failureReason")]
        failure_reason: Option<String>,
    },
}

#[derive(Debug, Serialize)]
struct ReceiveCrmProviderMessageReducerArg {
    provider_account_id: u64,
    provider_event_id: String,
    event_fingerprint: String,
    contact_id: u64,
    phone_identity_id: u64,
    external_thread_id: String,
    provider_message_id: String,
    body: String,
}

#[derive(Debug, Serialize)]
struct RecordCrmProviderDeliveryReducerArg {
    provider_account_id: u64,
    event_fingerprint: String,
    conversation_id: u64,
    conversation_message_id: u64,
    provider_event_id: String,
    provider_message_id: String,
    operational_message_id: u64,
    status: String,
    failure_reason: Value,
}

fn stdb_option<T: Serialize>(value: Option<&T>) -> Value {
    match value {
        Some(value) => json!({ "some": value }),
        None => json!({ "none": [] }),
    }
}

impl WhatsAppWebhookEvent {
    fn occurred_at_unix_seconds(&self) -> u64 {
        match self {
            Self::InboundMessage {
                occurred_at_unix_seconds,
                ..
            }
            | Self::Delivery {
                occurred_at_unix_seconds,
                ..
            } => *occurred_at_unix_seconds,
        }
    }
}

fn hmac_sha256(secret: &[u8], body: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut key = [0_u8; BLOCK_SIZE];
    if secret.len() > BLOCK_SIZE {
        key[..32].copy_from_slice(&Sha256::digest(secret));
    } else {
        key[..secret.len()].copy_from_slice(secret);
    }

    let mut inner_pad = [0x36_u8; BLOCK_SIZE];
    let mut outer_pad = [0x5c_u8; BLOCK_SIZE];
    for index in 0..BLOCK_SIZE {
        inner_pad[index] ^= key[index];
        outer_pad[index] ^= key[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(body);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_hash);
    outer.finalize().into()
}

fn constant_time_eq_32(left: &[u8; 32], right: &[u8; 32]) -> bool {
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn verify_signature(secret: &[u8], body: &[u8], header: &str) -> bool {
    let Some(hex_signature) = header.strip_prefix("sha256=") else {
        return false;
    };
    let Ok(decoded) = hex::decode(hex_signature) else {
        return false;
    };
    let Ok(provided) = <[u8; 32]>::try_from(decoded.as_slice()) else {
        return false;
    };
    constant_time_eq_32(&hmac_sha256(secret, body), &provided)
}

fn timestamp_is_fresh(now: u64, occurred_at: u64) -> bool {
    occurred_at <= now.saturating_add(MAX_WEBHOOK_FUTURE_SKEW_SECONDS)
        && now.saturating_sub(occurred_at) <= MAX_WEBHOOK_AGE_SECONDS
}

async fn receive_whatsapp_webhook(
    State(state): State<Arc<AppState>>,
    Path((organization_id, account_id)): Path<(u64, u64)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let secret = std::env::var(WEBHOOK_SECRET_ENV)
        .ok()
        .filter(|secret| !secret.is_empty())
        .ok_or_else(|| ApiError::Internal("whatsapp webhook secret is not configured".into()))?;
    let signature = headers
        .get(SIGNATURE_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or(ApiError::Unauthorized)?;
    if !verify_signature(secret.as_bytes(), &body, signature) {
        return Err(ApiError::Unauthorized);
    }

    let fingerprint = hex::encode(Sha256::digest(&body));
    let event: WhatsAppWebhookEvent = serde_json::from_slice(&body)
        .map_err(|error| ApiError::BadRequest(format!("invalid whatsapp webhook: {error}")))?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| ApiError::Internal(format!("system clock before unix epoch: {error}")))?
        .as_secs();
    if !timestamp_is_fresh(now, event.occurred_at_unix_seconds()) {
        return Err(ApiError::Unauthorized);
    }
    let (reducer, params) = match event {
        WhatsAppWebhookEvent::InboundMessage {
            account_id: signed_account_id,
            occurred_at_unix_seconds: _,
            event_id,
            contact_id,
            phone_identity_id,
            external_thread_id,
            provider_message_id,
            body,
        } => {
            if signed_account_id != account_id {
                return Err(ApiError::Forbidden(
                    "signed whatsapp account does not match callback path".into(),
                ));
            }
            let params = ReceiveCrmProviderMessageReducerArg {
                provider_account_id: account_id,
                provider_event_id: event_id,
                event_fingerprint: fingerprint,
                contact_id,
                phone_identity_id,
                external_thread_id,
                provider_message_id,
                body,
            };
            (
                "receive_crm_provider_message",
                serde_json::to_value(params).map_err(|error| {
                    ApiError::Internal(format!("serialize whatsapp inbound callback: {error}"))
                })?,
            )
        }
        WhatsAppWebhookEvent::Delivery {
            account_id: signed_account_id,
            occurred_at_unix_seconds: _,
            event_id,
            conversation_id,
            conversation_message_id,
            provider_message_id,
            operational_message_id,
            status,
            failure_reason,
        } => {
            if signed_account_id != account_id {
                return Err(ApiError::Forbidden(
                    "signed whatsapp account does not match callback path".into(),
                ));
            }
            let params = RecordCrmProviderDeliveryReducerArg {
                provider_account_id: account_id,
                event_fingerprint: fingerprint,
                conversation_id,
                conversation_message_id,
                provider_event_id: event_id,
                provider_message_id,
                operational_message_id,
                status,
                failure_reason: stdb_option(failure_reason.as_ref()),
            };
            (
                "record_crm_provider_delivery",
                serde_json::to_value(params).map_err(|error| {
                    ApiError::Internal(format!("serialize whatsapp delivery callback: {error}"))
                })?,
            )
        }
    };

    // Provider principals are registered to the module-owner identity. Never
    // fall back to a user session token (or AppState's local development token)
    // for this server-authenticated callback boundary.
    let owner_token = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| ApiError::Internal("STDB_SERVER_TOKEN is not configured".into()))?;
    state
        .client_with_token(owner_token)
        .call_reducer(stdb_client::ReducerCall::from_name(
            reducer,
            json!([organization_id, params]),
        ))
        .await
        .map_err(|error| ApiError::Unprocessable(error.to_string()))?;
    Ok((StatusCode::ACCEPTED, Json(json!({ "accepted": true }))))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route(
        "/webhooks/whatsapp/:organization_id/:account_id",
        post(receive_whatsapp_webhook),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_sha256_matches_rfc_4231_vector() {
        let secret = [0x0b_u8; 20];
        let signature = hmac_sha256(&secret, b"Hi There");
        assert_eq!(
            hex::encode(signature),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn signature_rejects_wrong_secret_and_malformed_values() {
        let body = br#"{"eventType":"inbound_message"}"#;
        let valid = format!("sha256={}", hex::encode(hmac_sha256(b"right", body)));
        assert!(verify_signature(b"right", body, &valid));
        assert!(!verify_signature(b"wrong", body, &valid));
        assert!(!verify_signature(b"right", body, "sha256=00"));
        assert!(!verify_signature(b"right", body, "not-a-signature"));
    }

    #[test]
    fn timestamp_freshness_rejects_stale_and_far_future_events() {
        assert!(timestamp_is_fresh(1_000, 900));
        assert!(timestamp_is_fresh(1_000, 1_060));
        assert!(!timestamp_is_fresh(1_000, 699));
        assert!(!timestamp_is_fresh(1_000, 1_061));
    }

    #[test]
    fn callback_metadata_is_ignored_at_the_public_adapter_boundary() {
        let event: WhatsAppWebhookEvent = serde_json::from_value(json!({
            "eventType": "inbound_message",
            "accountId": 3,
            "occurredAtUnixSeconds": 1_000,
            "eventId": "event-1",
            "contactId": 5,
            "phoneIdentityId": 7,
            "externalThreadId": "thread-1",
            "providerMessageId": "message-1",
            "body": "hello",
            "metadata": "caller-controlled"
        }))
        .expect("deserialize signed callback while ignoring metadata");

        match event {
            WhatsAppWebhookEvent::InboundMessage { body, .. } => assert_eq!(body, "hello"),
            WhatsAppWebhookEvent::Delivery { .. } => panic!("expected inbound callback"),
        }
    }

    #[test]
    fn reducer_wire_uses_snake_case_and_tagged_stdb_options() {
        let inbound = serde_json::to_value(ReceiveCrmProviderMessageReducerArg {
            provider_account_id: 3,
            provider_event_id: "event-1".into(),
            event_fingerprint: "a".repeat(64),
            contact_id: 5,
            phone_identity_id: 7,
            external_thread_id: "thread-1".into(),
            provider_message_id: "message-1".into(),
            body: "hello".into(),
        })
        .expect("serialize inbound reducer wire");
        assert_eq!(inbound["provider_account_id"], 3);
        assert!(inbound.get("providerAccountId").is_none());
        assert!(inbound.get("metadata").is_none());

        let failure_reason = "provider rejected message".to_string();
        let delivery = serde_json::to_value(RecordCrmProviderDeliveryReducerArg {
            provider_account_id: 3,
            event_fingerprint: "b".repeat(64),
            conversation_id: 11,
            conversation_message_id: 13,
            provider_event_id: "event-2".into(),
            provider_message_id: "message-2".into(),
            operational_message_id: 17,
            status: "failed".into(),
            failure_reason: stdb_option(Some(&failure_reason)),
        })
        .expect("serialize delivery reducer wire");
        assert_eq!(
            delivery["failure_reason"],
            json!({ "some": "provider rejected message" })
        );
        assert!(delivery.get("metadata").is_none());
    }
}
