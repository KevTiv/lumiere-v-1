//! Incremental trusted capture for existing native audit producers.
//!
//! Audit producers have different payload completeness. Only known scalar values
//! become comparisons; an UPDATE missing its original value remains summary-only.
//! The raw audit reducer and the low-level returning writer never enter this path.

use std::collections::BTreeSet;

use serde_json::{Map, Value};
use spacetimedb::{ReducerContext, Table};

use super::{
    business_change, fingerprint, organization_business_change, BusinessChange,
    OrganizationBusinessChange, BUSINESS_CHANGE_SCHEMA_VERSION,
};
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::helpers::{write_audit_log_v2_returning, AuditLogParams};

const MAX_FIELDS: usize = 64;
const MAX_BYTES: usize = 65_536;

struct AuditEvidence {
    before: Value,
    after: Value,
    deltas: Value,
    coverage: &'static str,
    unchanged: bool,
}

fn scalar(value: &Value) -> Option<Value> {
    match value {
        Value::Null | Value::String(_) => Some(value.clone()),
        Value::Bool(_) | Value::Number(_) => Some(Value::String(value.to_string())),
        // A compound object is not an authorized field-level comparison. In
        // particular, nested metadata must not be disclosed as one text field.
        Value::Array(_) | Value::Object(_) => None,
    }
}

fn material_field(field: &str) -> bool {
    !field.is_empty()
        && field.len() <= 128
        && field
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_')
        && ![
            "metadata",
            "password",
            "password_hash",
            "secret",
            "token",
            "api_key",
            "access_token",
            "refresh_token",
            "private_key",
            "storage_key",
            "integration_keys",
            "create_uid",
            "create_date",
            "write_uid",
            "write_date",
            "created_at",
            "updated_at",
        ]
        .contains(&field)
}

fn object(raw: Option<&str>) -> Option<Map<String, Value>> {
    let raw = raw?;
    if raw.len() > MAX_BYTES {
        return None;
    }
    serde_json::from_str::<Value>(raw)
        .ok()?
        .as_object()
        .cloned()
}

fn evidence(params: &AuditLogParams) -> AuditEvidence {
    let old = object(params.old_values.as_deref());
    let new = object(params.new_values.as_deref());
    let fields: BTreeSet<_> = old
        .iter()
        .flat_map(|v| v.keys())
        .chain(new.iter().flat_map(|v| v.keys()))
        .filter(|field| material_field(field))
        .collect();
    let mut before = Map::new();
    let mut after = Map::new();
    let mut deltas = Vec::new();
    let mut omitted = false;
    let mut ordered_fields = fields.iter().collect::<Vec<_>>();
    ordered_fields.sort_by_key(|field| {
        old.as_ref().and_then(|row| row.get(**field))
            == new.as_ref().and_then(|row| row.get(**field))
    });
    for field in ordered_fields.into_iter().take(MAX_FIELDS) {
        let old_value = old.as_ref().and_then(|v| v.get(*field));
        let new_value = new.as_ref().and_then(|v| v.get(*field));
        let pair = match params.action.to_ascii_uppercase().as_str() {
            "CREATE" if old.is_none() => new_value.and_then(scalar).map(|v| (Value::Null, v)),
            "DELETE" if new.is_none() => old_value.and_then(scalar).map(|v| (v, Value::Null)),
            _ => old_value.and_then(scalar).zip(new_value.and_then(scalar)),
        };
        let Some((old_value, new_value)) = pair else {
            if old_value != new_value {
                omitted = true;
            }
            continue;
        };
        before.insert((*field).clone(), old_value.clone());
        after.insert((*field).clone(), new_value.clone());
        if old_value != new_value {
            deltas.push(serde_json::json!({"field":field,"before":old_value,"after":new_value}));
        }
    }
    let deltas = Value::Array(deltas);
    if deltas.to_string().len() > MAX_BYTES {
        return AuditEvidence {
            before: serde_json::json!({}),
            after: serde_json::json!({}),
            deltas: serde_json::json!([]),
            coverage: "summary-only",
            unchanged: false,
        };
    }
    let complete_fields = !omitted
        && fields.len() <= MAX_FIELDS
        && params
            .changed_fields
            .iter()
            .all(|field| before.contains_key(field));
    let coverage = if before.is_empty() {
        "summary-only"
    } else if complete_fields {
        "captured-audit-fields"
    } else {
        "partial-audit-fields"
    };
    let unchanged = matches!(
        params.action.to_ascii_uppercase().as_str(),
        "UPDATE" | "WRITE"
    ) && old.is_some()
        && (old == new || (before == after && complete_fields))
        && !before.is_empty();
    AuditEvidence {
        before: Value::Object(before),
        after: Value::Object(after),
        deltas,
        coverage,
        unchanged,
    }
}

/// Record native audit and its bounded private evidence in the same transaction.
///
/// `operation` is supplied by the native producer, never by a caller payload.
/// This adapter preserves legacy audit payloads while adding private history.
/// Organization-wide producers use a separate private relation with explicit
/// ownership; a company identifier is never fabricated for shared records.
pub(crate) fn write_business_audit(
    ctx: &ReducerContext,
    organization_id: u64,
    operation: &'static str,
    params: AuditLogParams,
) -> Result<(), String> {
    write_business_audit_inner(ctx, organization_id, operation, params, false)
}

/// Serialize an actual native row through its generated SATS type contract.
pub(crate) fn native_row_snapshot<T: spacetimedb_sats::Serialize + ?Sized>(
    row: &T,
) -> Result<String, String> {
    let mut snapshot = serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(row))
        .map_err(|error| format!("serialize native history snapshot: {error}"))?;
    if let Some(fields) = snapshot.as_object_mut() {
        fields.retain(|field, _| material_field(field));
    }
    Ok(snapshot.to_string())
}

/// Capture new material values privately while keeping the public audit a summary.
pub(crate) fn write_private_business_audit(
    ctx: &ReducerContext,
    organization_id: u64,
    operation: &'static str,
    params: AuditLogParams,
) -> Result<(), String> {
    write_business_audit_inner(ctx, organization_id, operation, params, true)
}

fn write_business_audit_inner(
    ctx: &ReducerContext,
    organization_id: u64,
    operation: &'static str,
    mut params: AuditLogParams,
    private_values: bool,
) -> Result<(), String> {
    let company_id = params.company_id;
    if organization_id == 0 || company_id == Some(0) || params.record_id == 0 {
        // Authentication and aggregate-wide administrative producers can have
        // no record identity. Preserve their established audit behavior; they
        // cannot establish record-scoped trusted history without a real owner.
        if private_values {
            params.old_values = None;
            params.new_values = None;
        }
        write_audit_log_v2_returning(ctx, organization_id, params);
        return Ok(());
    }
    let captured = evidence(&params);
    if private_values {
        params.old_values = None;
        params.new_values = None;
    }
    // Keep legacy audit metadata byte-for-byte, including non-JSON reasons.
    // Only the private relation establishes trusted evidence; audit metadata is
    // never an authority marker, even when it contains history-looking keys.
    log::debug!(
        "native history operation={} coverage={}",
        operation,
        captured.coverage
    );
    let audit = write_audit_log_v2_returning(ctx, organization_id, params);
    if captured.unchanged {
        return Ok(());
    }
    let audit_change =
        RowChange::upsert_stdb_row("audit_log", serde_json::json!({"id":audit.id}), &audit)?;
    let Some(company_id) = company_id else {
        let change = ctx
            .db
            .organization_business_change()
            .insert(OrganizationBusinessChange {
                id: 0,
                organization_id,
                resource: audit.table_name.clone(),
                record_id: audit.record_id,
                subject_resource: audit.table_name.clone(),
                subject_record_id: audit.record_id,
                operation: operation.into(),
                actor_identity: ctx.sender(),
                occurred_at: ctx.timestamp,
                schema_version: BUSINESS_CHANGE_SCHEMA_VERSION,
                before_fingerprint: fingerprint(&captured.before.to_string()),
                after_fingerprint: fingerprint(&captured.after.to_string()),
                changes_json: captured.deltas.to_string(),
                audit_log_id: audit.id,
            });
        record_organization_commit(
            ctx,
            OrganizationCommitInput {
                organization_id,
                operation_id: format!("erp.{operation}"),
                correlation_id: format!("organization-business-change:{}", change.id),
                changes: vec![
                    audit_change,
                    RowChange::upsert_stdb_row(
                        "organization_business_change",
                        serde_json::json!({"id":change.id}),
                        &change,
                    )?,
                ],
            },
        )?;
        return Ok(());
    };
    let change = ctx.db.business_change().insert(BusinessChange {
        id: 0,
        organization_id,
        company_id,
        resource: audit.table_name.clone(),
        record_id: audit.record_id,
        subject_resource: audit.table_name.clone(),
        subject_record_id: audit.record_id,
        operation: operation.into(),
        actor_identity: ctx.sender(),
        occurred_at: ctx.timestamp,
        schema_version: BUSINESS_CHANGE_SCHEMA_VERSION,
        before_fingerprint: fingerprint(&captured.before.to_string()),
        after_fingerprint: fingerprint(&captured.after.to_string()),
        changes_json: captured.deltas.to_string(),
        audit_log_id: audit.id,
    });
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: format!("erp.{operation}"),
            correlation_id: format!("business-change:{}", change.id),
            changes: vec![
                audit_change,
                RowChange::upsert_stdb_row(
                    "business_change",
                    serde_json::json!({"id":change.id}),
                    &change,
                )?,
            ],
        },
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(action: &'static str, before: Option<Value>, after: Option<Value>) -> AuditLogParams {
        AuditLogParams {
            company_id: Some(7),
            table_name: "sale_order",
            record_id: 9,
            action,
            old_values: before.map(|v| v.to_string()),
            new_values: after.map(|v| v.to_string()),
            changed_fields: vec![],
            metadata: None,
        }
    }

    #[test]
    fn unknown_update_before_is_not_fabricated() {
        let result = evidence(&params(
            "UPDATE",
            None,
            Some(serde_json::json!({"name":"new"})),
        ));
        assert_eq!(result.deltas, serde_json::json!([]));
        assert_eq!(result.coverage, "summary-only");
    }

    #[test]
    fn native_scalar_values_and_full_width_ids_remain_exact() {
        let result = evidence(&params(
            "UPDATE",
            Some(
                serde_json::json!({"name":"old","amount":"100.1200","partner_id":18446744073709551615u64}),
            ),
            Some(
                serde_json::json!({"name":"new","amount":"100.1300","partner_id":18446744073709551614u64}),
            ),
        ));
        assert_eq!(
            result.deltas,
            serde_json::json!([
                {"field":"amount","before":"100.1200","after":"100.1300"},
                {"field":"name","before":"old","after":"new"},
                {"field":"partner_id","before":"18446744073709551615","after":"18446744073709551614"}
            ])
        );
    }

    #[test]
    fn creation_and_deletion_use_actual_absence() {
        let create = evidence(&params(
            "CREATE",
            None,
            Some(serde_json::json!({"name":"item"})),
        ));
        assert_eq!(
            create.deltas,
            serde_json::json!([{"field":"name","before":null,"after":"item"}])
        );
        let delete = evidence(&params(
            "DELETE",
            Some(serde_json::json!({"name":"item"})),
            None,
        ));
        assert_eq!(
            delete.deltas,
            serde_json::json!([{"field":"name","before":"item","after":null}])
        );
        let soft_delete = evidence(&params(
            "DELETE",
            Some(serde_json::json!({"is_active":true})),
            Some(serde_json::json!({"is_active":false})),
        ));
        assert_eq!(
            soft_delete.deltas,
            serde_json::json!([
                {"field":"is_active","before":"true","after":"false"}
            ])
        );
    }

    #[test]
    fn nested_metadata_and_credentials_never_enter_comparisons() {
        let result = evidence(&params(
            "CREATE",
            None,
            Some(
                serde_json::json!({"metadata":"private","password":"private","nested":{"data":"private"},"name":"item"}),
            ),
        ));
        assert_eq!(
            result.deltas,
            serde_json::json!([{"field":"name","before":null,"after":"item"}])
        );
    }

    #[test]
    fn oversized_source_remains_summary_and_unchanged_fields_have_no_delta() {
        let large = evidence(&params(
            "CREATE",
            None,
            Some(serde_json::json!({"name":"x".repeat(MAX_BYTES)})),
        ));
        assert_eq!(large.coverage, "summary-only");
        let same = serde_json::json!({"name":"same"});
        assert_eq!(
            evidence(&params("UPDATE", Some(same.clone()), Some(same))).deltas,
            serde_json::json!([])
        );
        let same = serde_json::json!({"name":"same"});
        assert!(evidence(&params("UPDATE", Some(same.clone()), Some(same))).unchanged);
    }

    #[test]
    fn changed_fields_take_priority_over_unchanged_columns_in_wide_rows() {
        let before = (0..100)
            .map(|n| (format!("field_{n:03}"), Value::String("same".into())))
            .collect::<Map<_, _>>();
        let mut after = before.clone();
        after.insert("field_099".into(), Value::String("changed".into()));
        let result = evidence(&params(
            "UPDATE",
            Some(Value::Object(before.clone())),
            Some(Value::Object(after)),
        ));
        assert_eq!(
            result.deltas,
            serde_json::json!([{"field":"field_099","before":"same","after":"changed"}])
        );
        assert!(
            evidence(&params(
                "UPDATE",
                Some(Value::Object(before.clone())),
                Some(Value::Object(before))
            ))
            .unchanged
        );
    }
}
