//! Canonical organization-scoped change commits for durable projections.
//!
//! Reducers remain the business-logic boundary. A reducer records the exact
//! rows it committed here, in parent-before-child order, so a PostgreSQL
//! projector can replay complete outcomes without reimplementing business
//! rules. Audit records explain who and why; these records reconstruct what.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::core::organization::organization;

pub const CHANGE_SCHEMA_VERSION: u32 = 1;
pub const CONTRACT_VERSION: &str = "ir-v2";

#[spacetimedb::table(accessor = organization_commit_cursor)]
#[derive(Clone)]
pub struct OrganizationCommitCursor {
    #[primary_key]
    pub organization_id: u64,
    /// The next sequence available to this organization.
    pub next_sequence: u64,
}

#[spacetimedb::table(
    accessor = organization_commit,
    index(accessor = organization_commit_by_organization, btree(columns = [organization_id])),
    index(accessor = organization_commit_by_org, btree(columns = [organization_id, sequence]))
)]
#[derive(Clone)]
pub struct OrganizationCommit {
    /// Deterministic primary key: `<organization_id>:<sequence>`.
    #[primary_key]
    pub id: String,
    pub organization_id: u64,
    pub sequence: u64,
    pub operation_id: String,
    pub correlation_id: String,
    pub change_schema_version: u32,
    pub contract_version: String,
    pub occurred_at: Timestamp,
    pub actor_identity: Identity,
    pub row_change_count: u32,
    pub checksum: String,
}

#[spacetimedb::table(
    accessor = organization_row_change,
    index(accessor = organization_row_change_by_organization, btree(columns = [organization_id])),
    index(accessor = organization_row_change_by_commit, btree(columns = [organization_id, commit_sequence, ordinal]))
)]
#[derive(Clone)]
pub struct OrganizationRowChange {
    /// Deterministic primary key: `<organization_id>:<sequence>:<ordinal>`.
    #[primary_key]
    pub id: String,
    pub organization_id: u64,
    pub commit_sequence: u64,
    pub ordinal: u32,
    pub table_name: String,
    /// Canonical JSON object containing the complete primary-key identity.
    pub row_identity_json: String,
    /// `upsert` or `delete`.
    pub change_kind: String,
    /// Canonical full-row JSON for an upsert; absent for a delete tombstone.
    pub row_json: Option<String>,
    pub checksum: String,
}

/// One row outcome supplied by the reducer after its business writes succeed.
pub struct RowChange {
    pub table_name: String,
    pub row_identity: Value,
    pub kind: RowChangeKind,
}

pub enum RowChangeKind {
    Upsert(Value),
    Delete,
}

impl RowChange {
    fn upsert(table_name: impl Into<String>, row_identity: Value, row: Value) -> Self {
        Self {
            table_name: table_name.into(),
            row_identity,
            kind: RowChangeKind::Upsert(row),
        }
    }

    pub fn delete(table_name: impl Into<String>, row_identity: Value) -> Self {
        Self {
            table_name: table_name.into(),
            row_identity,
            kind: RowChangeKind::Delete,
        }
    }

    /// Encode a complete SpacetimeDB row through its generated SATS schema.
    ///
    /// Reducer integrations should prefer this over hand-built JSON so adding
    /// a table column cannot silently produce a partial durable projection.
    pub fn upsert_stdb_row<T>(
        table_name: impl Into<String>,
        row_identity: Value,
        row: &T,
    ) -> Result<Self, String>
    where
        T: spacetimedb_sats::Serialize + ?Sized,
    {
        let row = serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(row))
            .map_err(|error| format!("serialize complete SpacetimeDB row: {error}"))?;
        Ok(Self::upsert(table_name, row_identity, row))
    }
}

pub struct OrganizationCommitInput {
    pub organization_id: u64,
    pub operation_id: String,
    pub correlation_id: String,
    /// Dependency-safe application order declared by the reducer: parents
    /// before children for upserts and children before parents for deletes.
    pub changes: Vec<RowChange>,
}

/// Persist one complete reducer outcome in the reducer's existing transaction.
///
/// Validation and checksumming happen before any table write. SpacetimeDB then
/// commits the cursor, row changes, and envelope atomically with the reducer's
/// business rows (or rolls all of them back when the reducer returns an error).
pub fn record_organization_commit(
    ctx: &ReducerContext,
    input: OrganizationCommitInput,
) -> Result<u64, String> {
    crate::core::reconstruction::require_writes_unfenced(ctx, input.organization_id)?;
    if ctx
        .db
        .organization()
        .id()
        .find(&input.organization_id)
        .is_none()
    {
        return Err("organization commit requires an existing organization".to_string());
    }
    let prepared = prepare_changes(&input)?;
    let sequence = allocate_sequence(ctx, input.organization_id)?;
    let commit_id = commit_id(input.organization_id, sequence);
    let checksum = commit_checksum(
        &input,
        sequence,
        ctx.timestamp,
        &ctx.sender().to_hex().to_string(),
        &prepared,
    );

    for (ordinal, change) in prepared.into_iter().enumerate() {
        ctx.db
            .organization_row_change()
            .insert(OrganizationRowChange {
                id: format!("{commit_id}:{ordinal}"),
                organization_id: input.organization_id,
                commit_sequence: sequence,
                ordinal: u32::try_from(ordinal)
                    .map_err(|_| "organization commit contains too many row changes")?,
                table_name: change.table_name,
                row_identity_json: change.row_identity_json,
                change_kind: change.change_kind,
                row_json: change.row_json,
                checksum: change.checksum,
            });
    }

    ctx.db.organization_commit().insert(OrganizationCommit {
        id: commit_id,
        organization_id: input.organization_id,
        sequence,
        operation_id: input.operation_id,
        correlation_id: input.correlation_id,
        change_schema_version: CHANGE_SCHEMA_VERSION,
        contract_version: CONTRACT_VERSION.to_string(),
        occurred_at: ctx.timestamp,
        actor_identity: ctx.sender(),
        row_change_count: u32::try_from(input.changes.len())
            .map_err(|_| "organization commit contains too many row changes")?,
        checksum,
    });

    Ok(sequence)
}

struct PreparedChange {
    table_name: String,
    row_identity_json: String,
    change_kind: String,
    row_json: Option<String>,
    checksum: String,
}

fn prepare_changes(input: &OrganizationCommitInput) -> Result<Vec<PreparedChange>, String> {
    if input.organization_id == 0 {
        return Err("organization commit requires a non-zero organization_id".to_string());
    }
    validate_operation_id(&input.operation_id)?;
    validate_token("correlation_id", &input.correlation_id)?;
    if input.changes.is_empty() {
        return Err("organization commit requires at least one row change".to_string());
    }

    input
        .changes
        .iter()
        .map(|change| {
            validate_table_name(&change.table_name)?;
            if !change.row_identity.is_object()
                || change.row_identity.as_object().is_some_and(Map::is_empty)
            {
                return Err(format!(
                    "{} row identity must be a non-empty JSON object",
                    change.table_name
                ));
            }
            let row_identity_json = canonical_json(&change.row_identity)?;
            let (change_kind, row_json) = match &change.kind {
                RowChangeKind::Upsert(row) if row.is_object() => {
                    validate_upsert_row(input.organization_id, &change.row_identity, row)?;
                    ("upsert".to_string(), Some(canonical_json(row)?))
                }
                RowChangeKind::Upsert(_) => {
                    return Err(format!(
                        "{} upsert must contain a full JSON object",
                        change.table_name
                    ));
                }
                RowChangeKind::Delete => ("delete".to_string(), None),
            };
            let checksum = sha256_hex(
                format!(
                    "{}\n{}\n{}\n{}",
                    change.table_name,
                    row_identity_json,
                    change_kind,
                    row_json.as_deref().unwrap_or("")
                )
                .as_bytes(),
            );
            Ok(PreparedChange {
                table_name: change.table_name.clone(),
                row_identity_json,
                change_kind,
                row_json,
                checksum,
            })
        })
        .collect()
}

fn validate_upsert_row(
    organization_id: u64,
    row_identity: &Value,
    row: &Value,
) -> Result<(), String> {
    let row_object = row
        .as_object()
        .ok_or_else(|| "upsert must contain a full JSON object".to_string())?;
    let row_organization = row_object
        .get("organization_id")
        .and_then(json_u64)
        .ok_or_else(|| {
            "organization commit upsert requires organization_id in the row".to_string()
        })?;
    if row_organization != organization_id {
        return Err("organization commit row belongs to a different organization".to_string());
    }
    for (column, expected) in row_identity
        .as_object()
        .expect("row identity was validated before upsert validation")
    {
        if row_object.get(column) != Some(expected) {
            return Err(format!(
                "row identity column {column} does not match the upsert row"
            ));
        }
    }
    Ok(())
}

fn json_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

fn allocate_sequence(ctx: &ReducerContext, organization_id: u64) -> Result<u64, String> {
    let cursor = ctx
        .db
        .organization_commit_cursor()
        .organization_id()
        .find(&organization_id);
    let (sequence, next_sequence) =
        next_sequence(cursor.as_ref().map(|cursor| cursor.next_sequence))?;
    match cursor {
        Some(_) => {
            ctx.db
                .organization_commit_cursor()
                .organization_id()
                .update(OrganizationCommitCursor {
                    organization_id,
                    next_sequence,
                });
        }
        None => {
            ctx.db
                .organization_commit_cursor()
                .insert(OrganizationCommitCursor {
                    organization_id,
                    next_sequence,
                });
        }
    }
    Ok(sequence)
}

fn next_sequence(current: Option<u64>) -> Result<(u64, u64), String> {
    let sequence = current.unwrap_or(1);
    if sequence == 0 {
        return Err("organization commit cursor has an invalid zero next sequence".to_string());
    }
    let next_sequence = sequence
        .checked_add(1)
        .ok_or_else(|| "organization commit sequence exhausted".to_string())?;
    Ok((sequence, next_sequence))
}

fn commit_checksum(
    input: &OrganizationCommitInput,
    sequence: u64,
    occurred_at: Timestamp,
    actor_identity_hex: &str,
    changes: &[PreparedChange],
) -> String {
    let mut digest = Sha256::new();
    for field in [
        input.organization_id.to_string(),
        sequence.to_string(),
        CHANGE_SCHEMA_VERSION.to_string(),
        input.operation_id.clone(),
        input.correlation_id.clone(),
        CONTRACT_VERSION.to_string(),
        occurred_at.to_micros_since_unix_epoch().to_string(),
        actor_identity_hex.to_string(),
        changes.len().to_string(),
    ] {
        digest.update(field.len().to_string().as_bytes());
        digest.update(b":");
        digest.update(field.as_bytes());
    }
    for change in changes {
        digest.update(change.checksum.as_bytes());
    }
    hex::encode(digest.finalize())
}

fn commit_id(organization_id: u64, sequence: u64) -> String {
    format!("{organization_id}:{sequence}")
}

fn validate_token(name: &str, value: &str) -> Result<(), String> {
    if value.is_empty() || value.trim() != value || value.len() > 256 {
        return Err(format!(
            "{name} must be non-empty, trimmed, and at most 256 bytes"
        ));
    }
    Ok(())
}

fn validate_operation_id(value: &str) -> Result<(), String> {
    validate_token("operation_id", value)?;
    let Some(suffix) = value.strip_prefix("erp.") else {
        return Err("operation_id must use a canonical erp.* contract ID".to_string());
    };
    if suffix.is_empty()
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err("operation_id must use a canonical erp.<snake_case> contract ID".to_string());
    }
    Ok(())
}

fn validate_table_name(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err("row change table_name must be lowercase snake_case".to_string());
    }
    Ok(())
}

fn canonical_json(value: &Value) -> Result<String, String> {
    serde_json::to_string(&sort_json(value))
        .map_err(|error| format!("serialize canonical row JSON: {error}"))
}

fn sort_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), sort_json(value)))
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(sort_json).collect()),
        _ => value.clone(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(spacetimedb::SpacetimeType)]
    struct ExampleRow {
        id: u64,
        organization_id: u64,
        label: String,
    }

    fn input(changes: Vec<RowChange>) -> OrganizationCommitInput {
        OrganizationCommitInput {
            organization_id: 7,
            operation_id: "erp.confirm_sales_order".to_string(),
            correlation_id: "request-42".to_string(),
            changes,
        }
    }

    #[test]
    fn canonical_json_sorts_nested_object_keys() {
        let value = json!({"z": {"b": 2, "a": 1}, "a": [{"d": 4, "c": 3}]});
        assert_eq!(
            canonical_json(&value).unwrap(),
            r#"{"a":[{"c":3,"d":4}],"z":{"a":1,"b":2}}"#
        );
    }

    #[test]
    fn prepared_changes_preserve_caller_order_and_delete_tombstone() {
        let prepared = prepare_changes(&input(vec![
            RowChange::upsert(
                "sale_order",
                json!({"id": 5}),
                json!({"id": 5, "organization_id": 7}),
            ),
            RowChange::upsert(
                "sale_order_line",
                json!({"id": 9}),
                json!({"order_id": 5, "id": 9, "organization_id": 7}),
            ),
            RowChange::delete("reservation", json!({"id": 4})),
        ]))
        .unwrap();

        assert_eq!(prepared[0].table_name, "sale_order");
        assert_eq!(prepared[1].table_name, "sale_order_line");
        assert_eq!(prepared[2].change_kind, "delete");
        assert_eq!(prepared[2].row_json, None);
    }

    #[test]
    fn checksum_is_stable_for_equivalent_json_key_order() {
        let left = prepare_changes(&input(vec![RowChange::upsert(
            "sale_order",
            json!({"id": 5}),
            serde_json::from_str(r#"{"b":2,"a":1,"id":5,"organization_id":7}"#).unwrap(),
        )]))
        .unwrap();
        let right = prepare_changes(&input(vec![RowChange::upsert(
            "sale_order",
            json!({"id": 5}),
            serde_json::from_str(r#"{"a":1,"b":2,"id":5,"organization_id":7}"#).unwrap(),
        )]))
        .unwrap();
        assert_eq!(left[0].checksum, right[0].checksum);
    }

    #[test]
    fn commit_checksum_is_stable_for_equivalent_inputs_and_order_sensitive() {
        let left_input = input(vec![
            RowChange::upsert(
                "sale_order",
                json!({"id": 5}),
                json!({"id": 5, "organization_id": 7, "status": "confirmed"}),
            ),
            RowChange::delete("sale_order_line", json!({"id": 9})),
        ]);
        let equivalent_input = input(vec![
            RowChange::upsert(
                "sale_order",
                json!({"id": 5}),
                serde_json::from_str(r#"{"status":"confirmed","organization_id":7,"id":5}"#)
                    .unwrap(),
            ),
            RowChange::delete("sale_order_line", json!({"id": 9})),
        ]);
        let reordered_input = input(vec![
            RowChange::delete("sale_order_line", json!({"id": 9})),
            RowChange::upsert(
                "sale_order",
                json!({"id": 5}),
                json!({"id": 5, "organization_id": 7, "status": "confirmed"}),
            ),
        ]);
        let left_changes = prepare_changes(&left_input).unwrap();
        let equivalent_changes = prepare_changes(&equivalent_input).unwrap();
        let reordered_changes = prepare_changes(&reordered_input).unwrap();
        let occurred_at = Timestamp::from_micros_since_unix_epoch(123);
        let actor = "ab".repeat(32);

        let left_checksum = commit_checksum(&left_input, 4, occurred_at, &actor, &left_changes);
        assert_eq!(
            left_checksum,
            commit_checksum(
                &equivalent_input,
                4,
                occurred_at,
                &actor,
                &equivalent_changes
            )
        );
        assert_ne!(
            left_checksum,
            commit_checksum(&reordered_input, 4, occurred_at, &actor, &reordered_changes)
        );
    }

    #[test]
    fn sequence_allocator_is_positive_monotonic_and_fails_closed() {
        assert_eq!(next_sequence(None).unwrap(), (1, 2));
        assert_eq!(next_sequence(Some(7)).unwrap(), (7, 8));
        assert!(next_sequence(Some(0)).is_err());
        assert!(next_sequence(Some(u64::MAX)).is_err());
    }

    #[test]
    fn repeated_current_state_upserts_are_preserved_in_declared_order() {
        let changes = prepare_changes(&input(vec![
            RowChange::upsert(
                "sale_order",
                json!({"id": 5}),
                json!({"id": 5, "organization_id": 7, "status": "draft"}),
            ),
            RowChange::upsert(
                "sale_order",
                json!({"id": 5}),
                json!({"id": 5, "organization_id": 7, "status": "confirmed"}),
            ),
        ]))
        .unwrap();

        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].row_identity_json, changes[1].row_identity_json);
        assert_ne!(changes[0].checksum, changes[1].checksum);
        assert_eq!(
            changes[0].row_json.as_deref().unwrap(),
            r#"{"id":5,"organization_id":7,"status":"draft"}"#
        );
        assert_eq!(
            changes[1].row_json.as_deref().unwrap(),
            r#"{"id":5,"organization_id":7,"status":"confirmed"}"#
        );
    }

    #[test]
    fn stdb_row_encoder_includes_every_sats_field() {
        let change = RowChange::upsert_stdb_row(
            "example_row",
            json!({"id": 3}),
            &ExampleRow {
                id: 3,
                organization_id: 7,
                label: "complete".to_string(),
            },
        )
        .unwrap();
        let prepared = prepare_changes(&input(vec![change])).unwrap();
        assert_eq!(
            prepared[0].row_json.as_deref(),
            Some(r#"{"id":3,"label":"complete","organization_id":7}"#)
        );
    }

    #[test]
    fn rejects_empty_identity_and_partial_upsert_payloads() {
        let empty_identity = input(vec![RowChange::delete("sale_order", json!({}))]);
        assert!(prepare_changes(&empty_identity).is_err());

        let scalar_upsert = input(vec![RowChange::upsert(
            "sale_order",
            json!({"id": 5}),
            json!(5),
        )]);
        assert!(prepare_changes(&scalar_upsert).is_err());
    }
}
