//! Meta WhatsApp Cloud API webhook boundary.
//!
//! Only server-authenticated provider messages enter the ERP. This adapter
//! deliberately has no session fallback and never creates CRM contacts.
//! Unmatched or unsupported inbound events fail closed instead of being
//! acknowledged as processed; a durable quarantine path is required before
//! enabling this endpoint for unrestricted live traffic.

use std::{collections::BTreeSet, sync::Arc};

use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::whatsapp_webhooks::verify_signature;
use crate::{
    commands::{dispatch_internal_reducer, InternalRouteAuthority},
    error::ApiError,
    state::AppState,
};

const APP_SECRET_ENV: &str = "LUMIERE_WHATSAPP_WEBHOOK_APP_SECRET";
const VERIFY_TOKEN_ENV: &str = "LUMIERE_WHATSAPP_META_VERIFY_TOKEN";
const MAX_PAYLOAD_BYTES: usize = 1024 * 1024;
const MAX_MESSAGE_BYTES: usize = 4000;

#[derive(Deserialize)]
struct VerificationQuery {
    #[serde(rename = "hub.mode")]
    mode: String,
    #[serde(rename = "hub.verify_token")]
    token: String,
    #[serde(rename = "hub.challenge")]
    challenge: String,
}

#[derive(Deserialize)]
struct MetaEnvelope {
    object: String,
    #[serde(default)]
    entry: Vec<MetaEntry>,
}

#[derive(Deserialize)]
struct MetaEntry {
    id: String,
    #[serde(default)]
    changes: Vec<MetaChange>,
}

#[derive(Deserialize)]
struct MetaChange {
    field: String,
    value: MetaValue,
}

#[derive(Deserialize)]
struct MetaValue {
    #[serde(default)]
    metadata: Option<MetaMetadata>,
    #[serde(default)]
    messages: Vec<MetaMessage>,
    #[serde(default)]
    statuses: Vec<MetaStatus>,
}

#[derive(Deserialize)]
struct MetaMetadata {
    phone_number_id: String,
}

#[derive(Deserialize, Serialize)]
struct MetaMessage {
    id: String,
    from: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<MetaText>,
    #[serde(default)]
    timestamp: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct MetaText {
    body: String,
}

#[derive(Deserialize, Serialize)]
struct MetaStatus {
    id: String,
    status: String,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    errors: Vec<MetaStatusError>,
}

#[derive(Deserialize, Serialize)]
struct MetaStatusError {
    #[serde(default)]
    code: Option<u64>,
}

struct BoundAccount {
    organization_id: u64,
    account_id: u64,
    company_id: Option<u64>,
    phone_number_id: String,
    business_account_id: String,
}

struct ContactMatch {
    contact_id: u64,
    phone_identity_id: u64,
}

fn token_matches(expected: &str, provided: &str) -> bool {
    let expected: [u8; 32] = Sha256::digest(expected.as_bytes()).into();
    let provided: [u8; 32] = Sha256::digest(provided.as_bytes()).into();
    expected
        .iter()
        .zip(provided.iter())
        .fold(0_u8, |different, (a, b)| different | (*a ^ *b))
        == 0
}

async fn verify_meta_webhook(
    Query(query): Query<VerificationQuery>,
) -> Result<(StatusCode, String), ApiError> {
    let token = std::env::var(VERIFY_TOKEN_ENV)
        .ok()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| ApiError::Unavailable("meta verification is not configured".into()))?;
    if query.mode != "subscribe"
        || !token_matches(&token, &query.token)
        || query.challenge.is_empty()
        || query.challenge.len() > 512
    {
        return Err(ApiError::Unauthorized);
    }
    Ok((StatusCode::OK, query.challenge))
}

fn row_u64(row: &Value, field: &str) -> Option<u64> {
    let value = row.get(field)?;
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        .or_else(|| value.get("some").and_then(Value::as_u64))
        .or_else(|| value.get("Some").and_then(Value::as_u64))
}

fn required_string<'a>(row: &'a Value, field: &str) -> Result<&'a str, ApiError> {
    row.get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::Unavailable("whatsapp provider account is incomplete".into()))
}

fn valid_meta_asset_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|byte| byte.is_ascii_digit())
}

async fn bound_account(
    state: &AppState,
    business_account_id: &str,
    phone_number_id: &str,
) -> Result<BoundAccount, ApiError> {
    if !valid_meta_asset_id(business_account_id) || !valid_meta_asset_id(phone_number_id) {
        return Err(ApiError::BadRequest("invalid meta business asset id".into()));
    }
    // Meta subscriptions normally share an app-level callback URL. Never
    // derive organization scope from the request path or sender's phone.
    // Lookup uses only the signed WABA + receiving phone-number IDs.
    let sql = format!(
        "SELECT * FROM whatsapp_business_account WHERE business_account_id = '{business_account_id}' AND phone_number_id = '{phone_number_id}' LIMIT 3"
    );
    let rows = state.stdb.query_sql(&sql).await.map_err(ApiError::unavailable)?;
    if rows.len() != 1 {
        return Err(ApiError::Unavailable(
            "whatsapp business assets lack a unique active organization binding".into(),
        ));
    }
    let row = &rows[0];
    if row.get("is_active").and_then(Value::as_bool) != Some(true)
        || row.get("messaging_enabled").and_then(Value::as_bool) != Some(true)
        || row.get("webhook_enabled").and_then(Value::as_bool) != Some(true)
    {
        return Err(ApiError::Forbidden("whatsapp provider account is disabled".into()));
    }
    Ok(BoundAccount {
        organization_id: row_u64(row, "organization_id")
            .ok_or_else(|| ApiError::Unavailable("whatsapp account lacks organization".into()))?,
        account_id: row_u64(row, "id")
            .ok_or_else(|| ApiError::Unavailable("whatsapp account lacks id".into()))?,
        company_id: row_u64(row, "company_id"),
        phone_number_id: required_string(row, "phone_number_id")?.to_owned(),
        business_account_id: required_string(row, "business_account_id")?.to_owned(),
    })
}

fn sender_e164(from: &str) -> Result<String, ApiError> {
    // Phone-based identities only. Business-scoped IDs require a separate
    // verified identity mapping and must not be guessed from a chat ID.
    if !(8..=15).contains(&from.len()) || !from.bytes().all(|digit| digit.is_ascii_digit()) {
        return Err(ApiError::Unavailable(
            "whatsapp sender needs a verified contact identity mapping".into(),
        ));
    }
    Ok(format!("+{from}"))
}

async fn resolve_contact(
    state: &AppState,
    account: &BoundAccount,
    sender: &str,
) -> Result<ContactMatch, ApiError> {
    let phone = sender_e164(sender)?;
    // phone was strictly restricted to a plus followed by ASCII digits.
    let sql = format!(
        "SELECT * FROM contact_phone_identity WHERE organization_id = {} AND normalized_e164 = '{}' LIMIT 32",
        account.organization_id, phone
    );
    let rows = state.stdb.query_sql(&sql).await.map_err(ApiError::unavailable)?;
    let mut contacts = BTreeSet::new();
    let mut identities = Vec::new();
    for row in rows {
        if row_u64(&row, "organization_id") != Some(account.organization_id) {
            continue;
        }
        if account
            .company_id
            .is_some_and(|company_id| row_u64(&row, "company_id") != Some(company_id))
        {
            continue;
        }
        // A revoked or archived identity cannot receive a provider event.
        if row.get("archived_at").is_some_and(|value| !value.is_null() && value.get("none").is_none()) {
            continue;
        }
        let (Some(contact_id), Some(phone_identity_id)) =
            (row_u64(&row, "contact_id"), row_u64(&row, "id"))
        else {
            continue;
        };
        contacts.insert(contact_id);
        identities.push(ContactMatch {
            contact_id,
            phone_identity_id,
        });
    }
    if contacts.len() != 1 || identities.is_empty() {
        // Do not fabricate a contact or cross-company match. Meta will retry
        // failures; production onboarding is gated on a durable triage queue.
        return Err(ApiError::Unavailable(
            "whatsapp sender cannot be matched to one authorized contact".into(),
        ));
    }
    identities.sort_by_key(|identity| identity.phone_identity_id);
    Ok(identities.remove(0))
}

fn event_fingerprint<T: Serialize>(event: &T) -> Result<String, ApiError> {
    let bytes = serde_json::to_vec(event).map_err(ApiError::internal)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn ensure_identifier(id: &str) -> Result<(), ApiError> {
    if id.trim().is_empty() || id.len() > 255 {
        return Err(ApiError::BadRequest("invalid meta provider identifier".into()));
    }
    Ok(())
}

async fn ingest_message(
    state: &Arc<AppState>,
    account: &BoundAccount,
    message: MetaMessage,
) -> Result<(), ApiError> {
    ensure_identifier(&message.id)?;
    ensure_identifier(&message.from)?;
    if message.kind != "text" {
        return Err(ApiError::Unavailable(
            "non-text whatsapp inbox processing is not enabled".into(),
        ));
    }
    let body = message
        .text
        .as_ref()
        .map(|text| text.body.as_str())
        .filter(|body| !body.trim().is_empty() && body.len() <= MAX_MESSAGE_BYTES)
        .ok_or_else(|| ApiError::BadRequest("invalid meta text message".into()))?;
    let identity = resolve_contact(state, account, &message.from).await?;
    let payload = json!({
        "provider_account_id": account.account_id,
        "provider_event_id": &message.id,
        "event_fingerprint": event_fingerprint(&message)?,
        "contact_id": identity.contact_id,
        "phone_identity_id": identity.phone_identity_id,
        "external_thread_id": format!("meta:{}:{}", account.account_id, message.from),
        "provider_message_id": &message.id,
        "body": body,
    });
    dispatch_internal_reducer(
        state,
        InternalRouteAuthority::ProviderWebhook,
        Some(account.organization_id),
        "receive_crm_provider_message",
        json!([account.organization_id, payload]),
    )
    .await?;
    Ok(())
}

fn normalized_delivery_status(status: &str) -> Option<&'static str> {
    match status {
        "sent" => Some("sent"),
        "delivered" | "read" => Some("delivered"),
        "failed" => Some("failed"),
        _ => None,
    }
}

async fn ingest_status(
    state: &Arc<AppState>,
    account: &BoundAccount,
    event: MetaStatus,
) -> Result<(), ApiError> {
    ensure_identifier(&event.id)?;
    let status = normalized_delivery_status(&event.status)
        .ok_or_else(|| ApiError::BadRequest("unsupported meta delivery status".into()))?;
    // A provider status is allowed to update only an existing, server-linked
    // outbound message. A client may not choose ERP identifiers in a callback.
    let escaped_message_id = event.id.replace('\'', "''");
    let sql = format!(
        "SELECT * FROM crm_conversation_message WHERE organization_id = {} AND direction = 'outbound' AND provider_message_id = '{}' LIMIT 2",
        account.organization_id, escaped_message_id
    );
    let rows = state.stdb.query_sql(&sql).await.map_err(ApiError::unavailable)?;
    if rows.len() != 1 {
        return Err(ApiError::Unavailable(
            "provider delivery lacks a linked outbound message".into(),
        ));
    }
    let row = &rows[0];
    let (Some(conversation_id), Some(conversation_message_id), Some(operational_message_id)) = (
        row_u64(row, "conversation_id"),
        row_u64(row, "id"),
        row_u64(row, "operational_message_id"),
    ) else {
        return Err(ApiError::Unavailable(
            "provider delivery lacks an operational message link".into(),
        ));
    };
    let failure_reason = if status == "failed" {
        Some(match event.errors.first().and_then(|error| error.code) {
            Some(code) => format!("meta delivery error {code}"),
            None => "meta delivery failed".to_owned(),
        })
    } else {
        None
    };
    let payload = json!({
        "provider_account_id": account.account_id,
        "provider_event_id": format!("meta:{}", event_fingerprint(&event)?),
        "event_fingerprint": event_fingerprint(&event)?,
        "conversation_id": conversation_id,
        "conversation_message_id": conversation_message_id,
        "provider_message_id": &event.id,
        "operational_message_id": operational_message_id,
        "status": status,
        "failure_reason": match failure_reason {
            Some(reason) => json!({"some": reason}),
            None => json!({"none": []}),
        },
    });
    dispatch_internal_reducer(
        state,
        InternalRouteAuthority::ProviderWebhook,
        Some(account.organization_id),
        "record_crm_provider_delivery",
        json!([account.organization_id, payload]),
    )
    .await?;
    Ok(())
}

async fn receive_meta_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if body.is_empty() || body.len() > MAX_PAYLOAD_BYTES {
        return Err(ApiError::BadRequest("invalid meta webhook body size".into()));
    }
    let app_secret = std::env::var(APP_SECRET_ENV)
        .ok()
        .filter(|secret| !secret.is_empty())
        .ok_or_else(|| ApiError::Unavailable("meta webhook app secret is not configured".into()))?;
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|header| header.to_str().ok())
        .ok_or(ApiError::Unauthorized)?;
    if !verify_signature(app_secret.as_bytes(), &body, signature) {
        return Err(ApiError::Unauthorized);
    }
    let envelope: MetaEnvelope = serde_json::from_slice(&body)
        .map_err(|_| ApiError::BadRequest("invalid meta webhook JSON".into()))?;
    if envelope.object != "whatsapp_business_account" {
        return Err(ApiError::BadRequest("not a whatsapp business webhook".into()));
    }
    for entry in envelope.entry {
        for change in entry.changes {
            if change.field != "messages" {
                continue;
            }
            let metadata = change.value.metadata.as_ref().ok_or_else(|| {
                ApiError::BadRequest("meta messages event lacks phone metadata".into())
            })?;
            let account = bound_account(&state, &entry.id, &metadata.phone_number_id).await?;
            // Redundant defense against ambiguous/mutated account mappings.
            if account.business_account_id != entry.id
                || account.phone_number_id != metadata.phone_number_id
            {
                return Err(ApiError::Forbidden("meta business asset binding changed".into()));
            }
            for message in change.value.messages {
                ingest_message(&state, &account, message).await?;
            }
            for status in change.value.statuses {
                ingest_status(&state, &account, status).await?;
            }
        }
    }
    // Acknowledge only after every supported event has entered canonical
    // reducers. Replays after a partial batch are safe via provider receipts.
    Ok((StatusCode::OK, Json(json!({"received": true}))))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route(
        "/webhooks/whatsapp/meta",
        get(verify_meta_webhook).post(receive_meta_webhook),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verification_requires_subscribe_and_the_exact_token() {
        assert!(token_matches("high-entropy-secret", "high-entropy-secret"));
        assert!(!token_matches("high-entropy-secret", "different-secret"));
        assert!(!token_matches("high-entropy-secret", "high-entropy-secreT"));
    }

    #[test]
    fn native_batched_webhook_parses_text_and_delivery_without_erp_ids() {
        let payload = json!({
            "object": "whatsapp_business_account",
            "entry": [{
                "id": "waba-1",
                "changes": [{
                    "field": "messages",
                    "value": {
                        "metadata": {"phone_number_id": "number-1"},
                        "messages": [{
                            "id": "wamid.1",
                            "from": "250788123456",
                            "type": "text",
                            "text": {"body": "Have you received the payment?"},
                            "timestamp": "1782150000"
                        }],
                        "statuses": [
                            {"id": "wamid.2", "status": "sent", "timestamp": "1782150001"},
                            {"id": "wamid.2", "status": "delivered", "timestamp": "1782150002"}
                        ]
                    }
                }]
            }]
        });
        let envelope: MetaEnvelope = serde_json::from_value(payload).unwrap();
        assert_eq!(envelope.entry.len(), 1);
        let value = &envelope.entry[0].changes[0].value;
        assert_eq!(value.messages.len(), 1);
        assert_eq!(value.statuses.len(), 2);
        assert_eq!(value.messages[0].text.as_ref().unwrap().body, "Have you received the payment?");
        assert_eq!(sender_e164(&value.messages[0].from).unwrap(), "+250788123456");
        assert_ne!(
            event_fingerprint(&value.statuses[0]).unwrap(),
            event_fingerprint(&value.statuses[1]).unwrap()
        );
    }

    #[test]
    fn rejects_unverified_non_phone_sender_without_guessing_identity() {
        assert!(sender_e164("user:business-scoped-id").is_err());
        assert!(sender_e164("250788123456' OR 1=1").is_err());
        assert!(sender_e164("250788123456").is_ok());
    }

    #[test]
    fn delivery_status_preserves_monotonic_read_mapping() {
        assert_eq!(normalized_delivery_status("read"), Some("delivered"));
        assert_eq!(normalized_delivery_status("sent"), Some("sent"));
        assert_eq!(normalized_delivery_status("failed"), Some("failed"));
        assert_eq!(normalized_delivery_status("unknown"), None);
    }

    #[test]
    fn meta_asset_id_never_becomes_sql_input_without_validation() {
        assert!(valid_meta_asset_id("1234567890"));
        assert!(!valid_meta_asset_id("1\' OR 1=1 --"));
        assert!(!valid_meta_asset_id(""));
    }

    #[test]
    fn optional_company_and_ids_decode_from_stdb_rows() {
        assert_eq!(row_u64(&json!({"company_id":{"some":4}}), "company_id"), Some(4));
        assert_eq!(row_u64(&json!({"id":"42"}), "id"), Some(42));
        assert_eq!(row_u64(&json!({"company_id":{"none":[]}}), "company_id"), None);
    }
}
