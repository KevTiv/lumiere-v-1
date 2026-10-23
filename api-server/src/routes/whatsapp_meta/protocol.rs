//! Lossless provider envelopes and deterministic per-event identity.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::error::ApiError;

pub(super) const MAX_EVENTS: usize = 100;

#[derive(Deserialize)]
pub(super) struct Envelope {
    pub object: String,
    pub entry: Vec<Entry>,
}

#[derive(Deserialize)]
pub(super) struct Entry {
    pub id: String,
    pub changes: Vec<Change>,
}

#[derive(Deserialize)]
pub(super) struct Change {
    pub field: String,
    pub value: Value,
}

/// A transport fact, not an authorized ERP command. Raw media references and
/// unknown sender identities are retained for triage, never fetched as URLs.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Incoming {
    pub organization_id: u64,
    pub account_id: u64,
    pub company_id: Option<u64>,
    pub business_account_id: String,
    pub phone_number_id: String,
    pub kind: String,
    pub event_key: String,
    pub fingerprint: String,
    pub payload: Value,
}

pub(super) fn fingerprint(value: &Value) -> String {
    // Sorting recursively also works when serde_json's preserve_order feature
    // is enabled by another workspace dependency.
    fn canonical(value: &Value) -> Value {
        match value {
            Value::Object(map) => {
                let sorted: std::collections::BTreeMap<_, _> = map
                    .iter()
                    .map(|(key, value)| (key.clone(), canonical(value)))
                    .collect();
                Value::Object(sorted.into_iter().collect())
            }
            Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
            other => other.clone(),
        }
    }
    hex::encode(Sha256::digest(canonical(value).to_string().as_bytes()))
}

pub(super) fn event_key(kind: &str, payload: &Value) -> String {
    let identity = match (kind, payload.get("id").and_then(Value::as_str)) {
        ("message", Some(id)) => json!([kind, id]),
        ("status", Some(id)) => json!([kind, id, payload.get("status"), payload.get("timestamp")]),
        _ => json!([kind, fingerprint(payload)]),
    };
    fingerprint(&identity)
}

pub(super) fn valid_asset_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 32 && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// The STDB client returns camelCase keys with unwrapped SATS options. Accept
/// snake_case fixtures too, without treating malformed/missing scope as None.
pub(super) fn field<'a>(row: &'a Value, name: &str) -> Option<&'a Value> {
    let mut camel = String::with_capacity(name.len());
    let mut upper = false;
    for character in name.chars() {
        if character == '_' {
            upper = true;
        } else if upper {
            camel.extend(character.to_uppercase());
            upper = false;
        } else {
            camel.push(character);
        }
    }
    row.get(&camel).or_else(|| row.get(name))
}

pub(super) fn scalar_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        .or_else(|| value.get("some").and_then(scalar_u64))
        .or_else(|| value.get("Some").and_then(scalar_u64))
}

pub(super) fn row_u64(row: &Value, name: &str) -> Option<u64> {
    field(row, name).and_then(scalar_u64)
}

pub(super) fn absent(value: &Value) -> bool {
    value.is_null() || value.get("none").is_some() || value.get("None").is_some()
}

pub(super) fn optional_id(row: &Value, name: &str) -> Result<Option<u64>, ApiError> {
    let value = field(row, name)
        .ok_or_else(|| ApiError::Unprocessable("missing provider scope field".into()))?;
    if absent(value) {
        return Ok(None);
    }
    scalar_u64(value)
        .filter(|id| *id > 0)
        .map(Some)
        .ok_or_else(|| ApiError::Unprocessable("invalid provider scope field".into()))
}

pub(super) fn enum_tag(value: &Value) -> Option<&str> {
    value
        .as_str()
        .or_else(|| value.get("tag").and_then(Value::as_str))
        .or_else(|| {
            let object = value.as_object()?;
            if object.len() == 1 {
                object.keys().next().map(String::as_str)
            } else {
                None
            }
        })
}

pub(super) fn text<'a>(value: &'a Value, name: &str) -> Result<&'a str, ApiError> {
    field(value, name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 255)
        .ok_or_else(|| ApiError::Unprocessable("invalid provider identifier".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_camel_case_and_optional_ids_are_not_silently_unscoped() {
        let row = json!({"organizationId": "42", "companyId": 7, "isActive": true});
        assert_eq!(row_u64(&row, "organization_id"), Some(42));
        assert_eq!(optional_id(&row, "company_id").unwrap(), Some(7));
        assert_eq!(field(&row, "is_active"), Some(&Value::Bool(true)));
        assert!(optional_id(&json!({}), "company_id").is_err());
        assert!(optional_id(&json!({"companyId": "bad"}), "company_id").is_err());
        assert_eq!(
            optional_id(&json!({"companyId": null}), "company_id").unwrap(),
            None
        );
    }

    #[test]
    fn identity_survives_rebatching_but_changed_content_has_another_fingerprint() {
        let first = json!({"id":"wamid.1","type":"text","text":{"body":"hello"}});
        let changed = json!({"id":"wamid.1","type":"text","text":{"body":"changed"}});
        assert_eq!(event_key("message", &first), event_key("message", &changed));
        assert_ne!(fingerprint(&first), fingerprint(&changed));
        assert_ne!(event_key("message", &first), event_key("status", &first));
    }

    #[test]
    fn unknown_media_and_business_scoped_senders_are_preserved() {
        let raw = json!({"object":"whatsapp_business_account","entry":[{
            "id":"123", "changes":[{"field":"messages","value":{
                "metadata":{"phone_number_id":"456"},
                "messages":[{"id":"wamid.1","from_user_id":"opaque-user",
                    "type":"image","image":{"id":"media-123","caption":"receipt"}}]
            }}]
        }]});
        let envelope: Envelope = serde_json::from_value(raw).unwrap();
        let message = &envelope.entry[0].changes[0].value["messages"][0];
        assert_eq!(message["image"]["id"], "media-123");
        assert_eq!(message["from_user_id"], "opaque-user");
    }

    #[test]
    fn malformed_asset_ids_are_not_sql_input() {
        assert!(valid_asset_id("123456789"));
        assert!(!valid_asset_id("1' OR 1=1"));
        assert!(!valid_asset_id(""));
    }
}
