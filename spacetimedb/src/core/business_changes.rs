//! Private, reducer-authored evidence for committed business changes.
//!
//! This module deliberately exposes no reducer accepting history payloads.
//! Domain owners capture actual before/after values in their own transaction;
//! caller-authored `log_audit_event` rows cannot mint this evidence.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::core::audit::AuditLog;
use crate::helpers::{write_audit_log_v2_returning, AuditLogParams};

pub(crate) const BUSINESS_CHANGE_SCHEMA_VERSION: u32 = 1;
const MAX_EVIDENCE_BYTES: usize = 65_536;
const MAX_CHANGED_FIELDS: usize = 64;

/// Trusted change evidence. All values are private and require source-aware
/// authorization and field redaction at the server history read boundary.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = business_change,
    index(accessor = business_change_by_organization, btree(columns = [organization_id])),
    index(accessor = business_change_by_record, btree(columns = [organization_id, resource, record_id]))
)]
pub struct BusinessChange {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub resource: String,
    pub record_id: u64,
    pub subject_resource: String,
    pub subject_record_id: u64,
    pub operation: String,
    pub actor_identity: Identity,
    pub occurred_at: Timestamp,
    pub schema_version: u32,
    pub before_fingerprint: String,
    pub after_fingerprint: String,
    /// Schema v1: JSON array of {field, before, after}. Values are strings or
    /// null, preserving full-width identifiers and decimal representations.
    pub changes_json: String,
    pub audit_log_id: u64,
}

pub(crate) struct BusinessChangeInput {
    pub organization_id: u64,
    pub company_id: u64,
    pub resource: &'static str,
    pub record_id: u64,
    pub subject_resource: &'static str,
    pub subject_record_id: u64,
    pub operation: &'static str,
    pub audit_action: &'static str,
    pub before: Value,
    pub after: Value,
    /// Fields changed by the domain owner but deliberately excluded from
    /// material history (for example unbounded/private metadata).
    pub summary_only_changed_fields: Vec<&'static str>,
}

pub(crate) struct CapturedBusinessChange {
    pub change: Option<BusinessChange>,
    pub audit: AuditLog,
}

/// Capture a domain-authorized mutation and a non-sensitive audit summary.
/// The caller includes both returned rows in its organization commit.
pub(crate) fn capture_business_change(
    ctx: &ReducerContext,
    input: BusinessChangeInput,
) -> Result<Option<CapturedBusinessChange>, String> {
    if input.organization_id == 0
        || input.company_id == 0
        || input.record_id == 0
        || input.subject_record_id == 0
    {
        return Err("business change requires positive canonical ownership".into());
    }
    if !matches!(input.audit_action, "CREATE" | "UPDATE") {
        return Err("business change requires an admitted audit action".into());
    }
    let prepared = prepare_change(&input.before, &input.after)?;
    if prepared.is_none() && input.summary_only_changed_fields.is_empty() {
        return Ok(None);
    }
    let mut changed_fields = prepared
        .as_ref()
        .map(|change| change.fields.clone())
        .unwrap_or_default();
    for field in &input.summary_only_changed_fields {
        if !changed_fields.iter().any(|existing| existing == field) {
            changed_fields.push((*field).to_string());
        }
    }
    let audit = write_audit_log_v2_returning(
        ctx,
        input.organization_id,
        AuditLogParams {
            company_id: Some(input.company_id),
            table_name: input.subject_resource,
            record_id: input.subject_record_id,
            action: input.audit_action,
            // Sensitive values live once in the private change evidence.
            old_values: None,
            new_values: None,
            changed_fields,
            metadata: Some(
                serde_json::json!({
                    "business_change_schema_version": BUSINESS_CHANGE_SCHEMA_VERSION,
                    "resource": input.resource,
                    "record_id": input.record_id.to_string(),
                    "operation": input.operation,
                    "business_change_coverage": if prepared.is_some() { "captured-fields" } else { "summary-only" },
                })
                .to_string(),
            ),
        },
    );
    let change = prepared.map(|prepared| {
        ctx.db.business_change().insert(BusinessChange {
            id: 0,
            organization_id: input.organization_id,
            company_id: input.company_id,
            resource: input.resource.into(),
            record_id: input.record_id,
            subject_resource: input.subject_resource.into(),
            subject_record_id: input.subject_record_id,
            operation: input.operation.into(),
            actor_identity: ctx.sender(),
            occurred_at: ctx.timestamp,
            schema_version: BUSINESS_CHANGE_SCHEMA_VERSION,
            before_fingerprint: prepared.before_fingerprint,
            after_fingerprint: prepared.after_fingerprint,
            changes_json: prepared.changes_json,
            audit_log_id: audit.id,
        })
    });
    Ok(Some(CapturedBusinessChange { change, audit }))
}

struct PreparedChange {
    fields: Vec<String>,
    before_fingerprint: String,
    after_fingerprint: String,
    changes_json: String,
}

fn snapshot_object(value: &Value) -> Result<&Map<String, Value>, String> {
    let object = value
        .as_object()
        .ok_or("business change snapshot must be an object")?;
    if object.len() > MAX_CHANGED_FIELDS
        || object
            .values()
            .any(|value| !value.is_string() && !value.is_null())
    {
        return Err("business change snapshot must contain bounded string or null fields".into());
    }
    Ok(object)
}

fn snapshot_json(value: &Value) -> Result<String, String> {
    let encoded = serde_json::to_string(value)
        .map_err(|error| format!("encode business change snapshot: {error}"))?;
    if encoded.len() > MAX_EVIDENCE_BYTES {
        return Err("business change snapshot exceeds the evidence limit".into());
    }
    Ok(encoded)
}

fn fingerprint(encoded: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(encoded.as_bytes()))
}

fn prepare_change(before: &Value, after: &Value) -> Result<Option<PreparedChange>, String> {
    let previous = snapshot_object(before)?;
    let next = snapshot_object(after)?;
    if previous.keys().ne(next.keys()) {
        return Err("business change snapshots must have the same field schema".into());
    }
    let before_json = snapshot_json(before)?;
    let after_json = snapshot_json(after)?;
    let mut fields = Vec::new();
    let mut deltas = Vec::new();
    for (field, old_value) in previous {
        let new_value = &next[field];
        if old_value != new_value {
            fields.push(field.clone());
            deltas.push(serde_json::json!({
                "field": field,
                "before": old_value,
                "after": new_value,
            }));
        }
    }
    if fields.is_empty() {
        return Ok(None);
    }
    let changes_json = snapshot_json(&Value::Array(deltas))?;
    Ok(Some(PreparedChange {
        fields,
        before_fingerprint: fingerprint(&before_json),
        after_fingerprint: fingerprint(&after_json),
        changes_json,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn actual_deltas_preserve_ids_nulls_and_exact_decimal_strings() {
        let before = json!({"name":"Old", "partner_id":null, "debit":"9007199254740993.25", "metadata":null});
        let after = json!({"name":"New", "partner_id":"18446744073709551615", "debit":"9007199254740993.25", "metadata":null});
        let change = prepare_change(&before, &after).unwrap().unwrap();
        assert_eq!(change.fields, vec!["name", "partner_id"]);
        assert_eq!(
            serde_json::from_str::<Value>(&change.changes_json).unwrap(),
            json!([
                {"field":"name", "before":"Old", "after":"New"},
                {"field":"partner_id", "before":null, "after":"18446744073709551615"},
            ])
        );
        assert_ne!(change.before_fingerprint, change.after_fingerprint);
        assert_eq!(change.before_fingerprint.len(), 71);
    }

    #[test]
    fn unchanged_values_do_not_create_history() {
        let row = json!({"name":"Same", "debit":"10", "partner_id":null});
        assert!(prepare_change(&row, &row).unwrap().is_none());
    }

    #[test]
    fn malformed_or_oversized_evidence_is_rejected_before_capture() {
        assert!(prepare_change(&json!({"debit":10}), &json!({"debit":11})).is_err());
        assert!(prepare_change(&json!({"name":null}), &json!({"different":null})).is_err());
        let large = json!({"name":"x".repeat(MAX_EVIDENCE_BYTES)});
        assert!(prepare_change(&json!({"name":null}), &large).is_err());
    }
}
