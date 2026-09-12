use spacetimedb::Timestamp;

/// Merge exchange-rate metadata into an existing metadata JSON string.
///
/// Preserves existing keys, overwrites the four FX keys (`exchange_rate`,
/// `exchange_rate_from`, `exchange_rate_to`, `exchange_rate_at_micros`),
/// and returns `None`-tolerant input: invalid/non-object JSON falls back to
/// an empty object, exactly as the original inline copies did.
pub(crate) fn merge_exchange_rate_metadata(
    existing: &Option<String>,
    rate: f64,
    from: &str,
    to: &str,
    at: Timestamp,
) -> Option<String> {
    let mut metadata = existing
        .as_ref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|parsed| parsed.as_object().cloned())
        .unwrap_or_default();
    metadata.insert("exchange_rate".to_string(), serde_json::json!(rate));
    metadata.insert(
        "exchange_rate_from".to_string(),
        serde_json::Value::String(from.to_string()),
    );
    metadata.insert(
        "exchange_rate_to".to_string(),
        serde_json::Value::String(to.to_string()),
    );
    let at_micros = at
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as u64;
    metadata.insert(
        "exchange_rate_at_micros".to_string(),
        serde_json::json!(at_micros),
    );
    Some(serde_json::Value::Object(metadata).to_string())
}
