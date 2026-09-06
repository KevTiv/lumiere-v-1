//! Shared row JSON decoding and filtering primitives.

use serde_json::Value;
use stdb_auth::{has_resource_read_permission, FieldAccessContext};

pub(crate) fn row_not_soft_deleted(r: &Value) -> bool {
    match r.get("deletedAt").or_else(|| r.get("deleted_at")) {
        None | Some(Value::Null) => true,
        Some(Value::Object(obj)) if obj.contains_key("none") => true,
        Some(_) => false,
    }
}

pub(crate) fn has_iot_read_permission(
    field_access: Option<&FieldAccessContext>,
    resource: &str,
) -> bool {
    has_resource_read_permission(field_access, resource)
        || field_access.is_some_and(|access| {
            access
                .role_permissions
                .iter()
                .any(|permission| permission == "module:iot:read" || permission == "module:iot:*")
        })
}

pub(crate) fn strip_soft_delete_fields(row: &mut Value) {
    if let Value::Object(map) = row {
        map.remove("deletedAt");
        map.remove("deleted_at");
    }
}

pub(crate) fn filter_and_strip_soft_deleted(rows: &mut Vec<Value>) {
    rows.retain(|r| row_not_soft_deleted(r));
    for row in rows.iter_mut() {
        strip_soft_delete_fields(row);
    }
}

pub(crate) fn row_not_archived(r: &Value) -> bool {
    match r.get("archivedAt").or_else(|| r.get("archived_at")) {
        None | Some(Value::Null) => true,
        Some(Value::Object(obj)) if obj.contains_key("none") => true,
        Some(_) => false,
    }
}

pub(crate) fn strip_archived_fields(row: &mut Value) {
    if let Value::Object(map) = row {
        map.remove("archivedAt");
        map.remove("archived_at");
    }
}

pub(crate) fn filter_and_strip_archived(rows: &mut Vec<Value>) {
    rows.retain(|r| row_not_archived(r));
    for row in rows.iter_mut() {
        strip_archived_fields(row);
    }
}

pub(crate) fn row_id_u64(row: &Value) -> u64 {
    row.get("id")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            row.get("id")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or(0)
}

/// Strict variant of `row_id_u64` that surfaces parse failures instead of
/// silently returning zero. Use this wherever the ID feeds a business
/// operation rather than a sort comparator.
pub(crate) fn row_id_u64_strict(row: &Value) -> Result<u64, String> {
    let v = row
        .get("id")
        .ok_or_else(|| "row missing id field".to_string())?;
    if v.is_null() {
        return Err("row id is null".to_string());
    }
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        .ok_or_else(|| format!("row id is not a valid u64: {v}"))
}

pub(crate) fn optional_u64(value: Option<&Value>) -> Result<Option<u64>, String> {
    let value = match value {
        None => return Ok(None),
        Some(v) => v,
    };
    if value.is_null() {
        return Ok(None);
    }
    // SpacetimeDB None encoding: {none: ...}
    if let Some(obj) = value.as_object() {
        if obj.contains_key("none") {
            return Ok(None);
        }
        // SpacetimeDB Some encoding: {some: [v]} or {Some: [v]}
        if let Some(some_val) = obj.get("some").or_else(|| obj.get("Some")) {
            let inner = some_val
                .as_array()
                .and_then(|arr| arr.first())
                .unwrap_or(some_val);
            let parsed = inner
                .as_u64()
                .or_else(|| inner.as_str().and_then(|s| s.parse().ok()))
                .ok_or_else(|| format!("cannot parse Some value as u64: {inner}"))?;
            return Ok(Some(parsed));
        }
    }
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .ok_or_else(|| format!("cannot parse value as u64: {value}"))
        .map(Some)
}

pub(crate) fn row_u64(row: &Value, camel: &str, snake: &str) -> Result<Option<u64>, String> {
    optional_u64(row.get(camel).or_else(|| row.get(snake)))
}

pub(crate) fn row_enum_tag_is(row: &Value, column: &str, expected: &[&str]) -> bool {
    row.get(column)
        .and_then(Value::as_str)
        .is_some_and(|tag| expected.contains(&tag))
}

pub(crate) fn identity_value_is(value: &Value, target_hex: &str) -> bool {
    if let Some(hex) = value.as_str() {
        return hex
            .trim_start_matches("0x")
            .trim_start_matches("0X")
            .eq_ignore_ascii_case(target_hex);
    }
    if let Some(inner) = value.as_array().and_then(|items| items.first()) {
        return identity_value_is(inner, target_hex);
    }
    value
        .as_object()
        .and_then(|object| object.get("some").or_else(|| object.get("Some")))
        .is_some_and(|inner| identity_value_is(inner, target_hex))
}

pub(crate) fn row_identity_option_is(
    row: &Value,
    camel: &str,
    snake: &str,
    target_hex: &str,
) -> bool {
    row.get(camel)
        .or_else(|| row.get(snake))
        .is_some_and(|value| identity_value_is(value, target_hex))
}

pub(crate) fn sort_rows_by_id_desc(rows: &mut [Value]) {
    rows.sort_by(|a, b| row_id_u64(b).cmp(&row_id_u64(a)));
}
