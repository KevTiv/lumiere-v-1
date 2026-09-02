//! Atomic application of one SpacetimeDB organization commit to PostgreSQL.
//!
//! The transport that reads commit rows from SpacetimeDB is deliberately
//! outside this module. This module accepts one already-decoded commit and
//! applies its ordered changes, commit ledger row, and watermark in one PG
//! transaction. The destination relation is always resolved from the signed
//! projection codec manifest; callers cannot select an arbitrary store.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use anyhow::{anyhow, bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tokio_postgres::types::ToSql;

use super::pg_codec::{self, ColumnCodec, PgValue};

const CHANGE_SCHEMA_VERSION: u32 = 1;
const CONTRACT_VERSION: &str = "ir-v2";
const LOCKED_OPERATION_MANIFEST_JSON: &str =
    include_str!("../../../lumiere-codegen/contract-operation-ids.json");

static LOCKED_OPERATION_IDS: OnceLock<std::result::Result<BTreeSet<String>, String>> =
    OnceLock::new();

/// Transport-neutral representation of `OrganizationCommit`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrganizationCommitEnvelope {
    pub id: String,
    pub organization_id: u64,
    pub sequence: u64,
    pub operation_id: String,
    pub correlation_id: String,
    pub change_schema_version: u32,
    pub contract_version: String,
    pub occurred_at_micros: i64,
    pub actor_identity_hex: String,
    pub row_change_count: u32,
    pub checksum: String,
}

/// Transport-neutral representation of one ordered row change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrganizationRowChangeInput {
    pub id: String,
    pub organization_id: u64,
    pub commit_sequence: u64,
    pub ordinal: u32,
    pub table_name: String,
    pub row_identity_json: String,
    pub change_kind: String,
    pub row_json: Option<String>,
    pub checksum: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionResult {
    Applied,
    AlreadyApplied,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SequenceDisposition {
    Apply,
    AlreadyApplied,
}

#[derive(Debug, Clone)]
struct ProjectionCodec {
    table_name: String,
    projection_mode: ProjectionMode,
    primary_key: String,
    organization_column: String,
    columns: Vec<ColumnCodec>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProjectionMode {
    UpsertCurrent,
    AppendHistory,
}

#[derive(Debug)]
struct PreparedChange {
    input: OrganizationRowChangeInput,
    codec: ProjectionCodec,
    values: Vec<PgValue>,
    key_value: PgValue,
}

/// Apply one complete commit atomically.
///
/// `projection_codec_manifest_json` must be the generated all-table
/// projection manifest. It is data, not a caller-selected SQL destination;
/// each relation is validated and quoted before being used in SQL.
pub async fn apply_commit(
    pool: &Pool,
    projection_codec_manifest_json: &str,
    commit: &OrganizationCommitEnvelope,
    changes: &[OrganizationRowChangeInput],
) -> Result<ProjectionResult> {
    let prepared = validate_commit(projection_codec_manifest_json, commit, changes)?;

    let mut client = pool
        .get()
        .await
        .context("get PG client for commit projection")?;
    let transaction = client
        .transaction()
        .await
        .context("begin commit projection transaction")?;

    let organization_id = commit.organization_id.to_string();
    let watermark = transaction
        .query_opt(
            "SELECT applied_sequence::TEXT, commit_checksum \
             FROM organization_projection_watermark \
             WHERE organization_id = $1::TEXT::NUMERIC FOR UPDATE",
            &[&organization_id],
        )
        .await
        .context("lock organization projection watermark")?;
    let current_sequence = watermark
        .as_ref()
        .map(|row| row.get::<_, String>(0))
        .map(|value| value.parse::<u64>())
        .transpose()
        .context("decode organization projection watermark")?;

    match validate_sequence(current_sequence, commit.sequence)? {
        SequenceDisposition::AlreadyApplied => {
            let existing = transaction
                .query_opt(
                    "SELECT checksum FROM organization_commit WHERE id = $1",
                    &[&commit.id],
                )
                .await
                .context("read existing organization commit")?;
            if existing
                .as_ref()
                .is_some_and(|row| row.get::<_, String>(0) == commit.checksum)
            {
                transaction.rollback().await.ok();
                return Ok(ProjectionResult::AlreadyApplied);
            }
            bail!(
                "stale organization commit {} conflicts with the applied checksum",
                commit.id
            );
        }
        SequenceDisposition::Apply => {}
    }

    let actor_identity = decode_identity(&commit.actor_identity_hex)?;
    let organization_id_text = organization_id;
    let sequence_text = commit.sequence.to_string();
    let schema_version = i64::from(commit.change_schema_version);
    let row_change_count = i64::from(commit.row_change_count);
    let params: [&(dyn ToSql + Sync); 11] = [
        &commit.id,
        &organization_id_text,
        &sequence_text,
        &commit.operation_id,
        &commit.correlation_id,
        &schema_version,
        &commit.contract_version,
        &commit.occurred_at_micros,
        &actor_identity,
        &row_change_count,
        &commit.checksum,
    ];
    transaction
        .execute(
            "INSERT INTO organization_commit \
             (id, organization_id, sequence, operation_id, correlation_id, \
              change_schema_version, contract_version, occurred_at, actor_identity, \
              row_change_count, checksum) \
             VALUES ($1, $2::TEXT::NUMERIC, $3::TEXT::NUMERIC, $4, $5, $6, $7, $8, $9, $10, $11)",
            &params,
        )
        .await
        .context("insert organization commit")?;

    for change in &prepared {
        insert_change(&transaction, change).await?;
    }
    for change in &prepared {
        apply_change(&transaction, change).await?;
    }

    transaction
        .execute(
            "INSERT INTO organization_projection_watermark \
             (organization_id, applied_sequence, commit_id, commit_checksum) \
             VALUES ($1::TEXT::NUMERIC, $2::TEXT::NUMERIC, $3, $4) \
             ON CONFLICT (organization_id) DO UPDATE SET \
                applied_sequence = EXCLUDED.applied_sequence, \
                commit_id = EXCLUDED.commit_id, \
                commit_checksum = EXCLUDED.commit_checksum, \
                applied_at = now()",
            &[
                &organization_id_text,
                &sequence_text,
                &commit.id,
                &commit.checksum,
            ],
        )
        .await
        .context("advance organization projection watermark")?;
    transaction
        .commit()
        .await
        .context("commit organization projection transaction")?;

    Ok(ProjectionResult::Applied)
}

async fn insert_change(
    transaction: &tokio_postgres::Transaction<'_>,
    change: &PreparedChange,
) -> Result<()> {
    let organization_id = change.input.organization_id.to_string();
    let sequence = change.input.commit_sequence.to_string();
    let ordinal = i64::from(change.input.ordinal);
    let identity = &change.input.row_identity_json;
    let row = change.input.row_json.as_deref();
    transaction
        .execute(
            "INSERT INTO organization_row_change \
             (id, organization_id, commit_sequence, ordinal, table_name, \
              row_identity_json, change_kind, row_json, checksum) \
             VALUES ($1, $2::TEXT::NUMERIC, $3::TEXT::NUMERIC, $4, $5, \
                     $6::TEXT::JSONB, $7, $8::TEXT::JSONB, $9)",
            &[
                &change.input.id,
                &organization_id,
                &sequence,
                &ordinal,
                &change.input.table_name,
                identity,
                &change.input.change_kind,
                &row,
                &change.input.checksum,
            ],
        )
        .await
        .context("insert organization row change")?;
    Ok(())
}

async fn apply_change(
    transaction: &tokio_postgres::Transaction<'_>,
    change: &PreparedChange,
) -> Result<()> {
    match change.input.change_kind.as_str() {
        "upsert" => {
            let sql = build_upsert_sql(&change.codec, change.values.len())?;
            let organization_id = change.input.organization_id.to_string();
            let mut params: Vec<&(dyn ToSql + Sync)> =
                change.values.iter().map(PgValue::as_sql).collect();
            if change.codec.projection_mode == ProjectionMode::UpsertCurrent
                && change
                    .codec
                    .columns
                    .iter()
                    .any(|column| column.name != change.codec.primary_key)
            {
                params.push(&organization_id);
            }
            let affected = transaction
                .execute(&sql, &params)
                .await
                .with_context(|| format!("apply upsert to {}", change.codec.table_name))?;
            if affected != 1 {
                bail!(
                    "upsert to {} did not affect exactly one organization-owned row",
                    change.codec.table_name
                );
            }
        }
        "delete" => {
            let table = quote_identifier(&change.codec.table_name)?;
            let primary_key = quote_identifier(&change.codec.primary_key)?;
            let placeholder = change
                .key_value
                .needs_cast()
                .map_or_else(|| "$1".to_string(), |cast| format!("$1::{cast}"));
            let organization_id = change.input.organization_id.to_string();
            let sql = format!(
                "DELETE FROM {table} WHERE {primary_key} = {placeholder} \
                 AND \"organization_id\" = $2::TEXT::NUMERIC"
            );
            let params: [&(dyn ToSql + Sync); 2] = [change.key_value.as_sql(), &organization_id];
            transaction
                .execute(&sql, &params)
                .await
                .with_context(|| format!("apply delete to {}", change.codec.table_name))?;
        }
        kind => bail!("unsupported organization row change kind '{kind}'"),
    }
    Ok(())
}

fn build_upsert_sql(codec: &ProjectionCodec, value_count: usize) -> Result<String> {
    if value_count != codec.columns.len() {
        bail!(
            "projection codec value count {} does not match {} columns",
            value_count,
            codec.columns.len()
        );
    }
    let table = quote_identifier(&codec.table_name)?;
    let primary_key = quote_identifier(&codec.primary_key)?;
    let organization_column = quote_identifier(&codec.organization_column)?;
    let columns: Vec<String> = codec
        .columns
        .iter()
        .map(|column| quote_identifier(&column.name))
        .collect::<Result<Vec<_>>>()?;
    let placeholders: Vec<String> = codec
        .columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let placeholder = format!("${}", index + 1);
            match column.pg_type.as_str() {
                "NUMERIC(20,0)" => format!("{placeholder}::TEXT::NUMERIC"),
                "JSONB" => format!("{placeholder}::TEXT::JSONB"),
                _ => placeholder,
            }
        })
        .collect();
    let updates: Vec<String> = columns
        .iter()
        .filter(|column| column.as_str() != primary_key)
        .map(|column| format!("{column} = EXCLUDED.{column}"))
        .collect();
    let conflict = if codec.projection_mode == ProjectionMode::AppendHistory || updates.is_empty() {
        "DO NOTHING".to_string()
    } else {
        format!(
            "DO UPDATE SET {} WHERE target.{organization_column} = ${}::TEXT::NUMERIC",
            updates.join(", "),
            value_count + 1,
        )
    };
    Ok(format!(
        "INSERT INTO {table} AS target ({columns}) VALUES ({placeholders}) \
         ON CONFLICT ({primary_key}) {conflict}",
        columns = columns.join(", "),
        placeholders = placeholders.join(", "),
    ))
}

fn validate_commit(
    manifest_json: &str,
    commit: &OrganizationCommitEnvelope,
    changes: &[OrganizationRowChangeInput],
) -> Result<Vec<PreparedChange>> {
    if commit.id != commit_id(commit.organization_id, commit.sequence) {
        bail!("organization commit id does not match organization and sequence");
    }
    if commit.change_schema_version != CHANGE_SCHEMA_VERSION {
        bail!("unsupported organization change schema version");
    }
    validate_operation_id(&commit.operation_id)?;
    validate_token("correlation_id", &commit.correlation_id)?;
    if commit.contract_version != CONTRACT_VERSION {
        bail!("unsupported organization commit contract version");
    }
    if commit.row_change_count as usize != changes.len() {
        bail!(
            "organization commit row_change_count {} does not match {} changes",
            commit.row_change_count,
            changes.len()
        );
    }
    if changes.is_empty() {
        bail!("organization commit must contain at least one change");
    }
    decode_identity(&commit.actor_identity_hex)?;

    let mut prepared = Vec::with_capacity(changes.len());
    for (expected_ordinal, input) in changes.iter().enumerate() {
        if input.organization_id != commit.organization_id
            || input.commit_sequence != commit.sequence
            || input.ordinal != expected_ordinal as u32
        {
            bail!("organization row changes must match commit scope and contiguous order");
        }
        if input.id
            != format!(
                "{}:{}:{}",
                commit.organization_id, commit.sequence, input.ordinal
            )
        {
            bail!("organization row change id does not match commit scope and ordinal");
        }
        let codec = load_projection_codec(manifest_json, &input.table_name)?;
        let identity = parse_canonical_json(&input.row_identity_json, "row identity")?;
        let identity_object = identity
            .as_object()
            .ok_or_else(|| anyhow!("row identity must be a JSON object"))?;
        if identity_object.len() != 1 || !identity_object.contains_key(&codec.primary_key) {
            bail!(
                "{} identity must contain exactly primary key '{}'",
                input.table_name,
                codec.primary_key
            );
        }
        let key_column = codec
            .columns
            .iter()
            .find(|column| column.name == codec.primary_key)
            .ok_or_else(|| anyhow!("projection codec is missing its primary key column"))?;
        let key_value = pg_codec::decode_key_value(
            key_column,
            identity_object
                .get(&codec.primary_key)
                .expect("primary key was checked above"),
        )?;

        let row = match input.change_kind.as_str() {
            "upsert" => {
                let row_text = input
                    .row_json
                    .as_deref()
                    .ok_or_else(|| anyhow!("upsert change is missing full row JSON"))?;
                let row = parse_canonical_json(row_text, "row")?;
                validate_full_row(&codec, &identity, &row, commit.organization_id)?;
                Some(row)
            }
            "delete" => {
                if codec.projection_mode == ProjectionMode::AppendHistory {
                    bail!(
                        "append-history table '{}' does not accept delete changes",
                        codec.table_name
                    );
                }
                if input.row_json.is_some() {
                    bail!("delete change must not contain row JSON");
                }
                None
            }
            kind => bail!("unsupported organization row change kind '{kind}'"),
        };

        let expected_checksum = change_checksum(
            &input.table_name,
            &input.row_identity_json,
            &input.change_kind,
            input.row_json.as_deref().unwrap_or(""),
        );
        if input.checksum != expected_checksum {
            bail!(
                "organization row change checksum mismatch at ordinal {}",
                input.ordinal
            );
        }

        let values = if let Some(row) = &row {
            let normalized = normalize_row_for_codec(&codec, row)?;
            pg_codec::decode_row(&codec.columns, &normalized)?
        } else {
            Vec::new()
        };
        prepared.push(PreparedChange {
            input: input.clone(),
            codec,
            values,
            key_value,
        });
    }

    let expected_commit_checksum = commit_checksum(commit, &prepared);
    if commit.checksum != expected_commit_checksum {
        bail!("organization commit checksum mismatch");
    }
    Ok(prepared)
}

fn validate_full_row(
    codec: &ProjectionCodec,
    identity: &Value,
    row: &Value,
    organization_id: u64,
) -> Result<()> {
    let object = row
        .as_object()
        .ok_or_else(|| anyhow!("upsert row must be a JSON object"))?;
    let expected: BTreeSet<&str> = codec
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect();
    let actual: BTreeSet<&str> = object.keys().map(String::as_str).collect();
    if actual != expected {
        bail!(
            "{} upsert must contain exactly the generated full row",
            codec.table_name
        );
    }
    if object.get(&codec.primary_key)
        != identity
            .as_object()
            .and_then(|map| map.get(&codec.primary_key))
    {
        bail!(
            "{} primary key does not match row identity",
            codec.table_name
        );
    }
    if object
        .get(&codec.organization_column)
        .and_then(Value::as_u64)
        != Some(organization_id)
    {
        bail!(
            "{} organization_id does not match commit organization",
            codec.table_name
        );
    }
    Ok(())
}

fn normalize_row_for_codec(codec: &ProjectionCodec, row: &Value) -> Result<Value> {
    let object = row
        .as_object()
        .ok_or_else(|| anyhow!("upsert row must be a JSON object"))?;
    let mut normalized = Map::new();
    for column in &codec.columns {
        let value = object
            .get(&column.name)
            .ok_or_else(|| anyhow!("row missing column '{}'", column.name))?;
        normalized.insert(snake_to_camel(&column.name), value.clone());
    }
    Ok(Value::Object(normalized))
}

fn load_projection_codec(manifest_json: &str, table_name: &str) -> Result<ProjectionCodec> {
    let manifest: Value =
        serde_json::from_str(manifest_json).context("parse projection codec manifest")?;
    let entry = manifest
        .get("tables")
        .and_then(|tables| tables.get(table_name))
        .ok_or_else(|| anyhow!("projection codec has no table '{table_name}'"))?;
    let projection_table = entry
        .get("projection_table")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("projection codec table lacks projection_table"))?;
    if projection_table != table_name {
        bail!("projection codec table name mismatch for '{table_name}'");
    }
    let projection_mode = match entry
        .get("projection_mode")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("projection codec table lacks projection_mode"))?
    {
        "upsert-current" => ProjectionMode::UpsertCurrent,
        "append-history" => ProjectionMode::AppendHistory,
        mode => {
            bail!("projection codec table '{table_name}' has unsupported projection mode '{mode}'")
        }
    };
    let organization_column = entry
        .get("organization_column")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("projection codec table is not organization-scoped"))?;
    if organization_column != "organization_id" {
        bail!("projection codec has unsupported organization column");
    }
    let primary_key = entry
        .get("primary_key")
        .and_then(|key| key.get("name"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("projection codec table lacks primary-key metadata"))?;
    if !is_safe_identifier(primary_key) {
        bail!("projection codec has unsafe primary-key identifier");
    }
    let columns = pg_codec::load_columns(manifest_json, table_name)?;
    if columns.is_empty() || !columns.iter().any(|column| column.name == primary_key) {
        bail!("projection codec primary key is not present in columns");
    }
    if columns
        .iter()
        .any(|column| !is_safe_identifier(&column.name))
    {
        bail!("projection codec has unsafe column identifier");
    }
    Ok(ProjectionCodec {
        table_name: table_name.to_string(),
        projection_mode,
        primary_key: primary_key.to_string(),
        organization_column: organization_column.to_string(),
        columns,
    })
}

fn validate_sequence(current: Option<u64>, incoming: u64) -> Result<SequenceDisposition> {
    match current {
        Some(current) if incoming == current => Ok(SequenceDisposition::AlreadyApplied),
        Some(current) if incoming == current.saturating_add(1) => Ok(SequenceDisposition::Apply),
        Some(current) => bail!(
            "organization commit sequence gap or rewind: current={current}, incoming={incoming}"
        ),
        None if incoming == 1 => Ok(SequenceDisposition::Apply),
        None => bail!("organization commit sequence gap: first incoming sequence is {incoming}"),
    }
}

#[cfg(test)]
fn projection_plan(change_kinds: &[&str]) -> Vec<String> {
    let mut plan = vec!["lock_watermark", "insert_commit"]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    plan.extend((0..change_kinds.len()).map(|ordinal| format!("insert_change:{ordinal}")));
    plan.extend((0..change_kinds.len()).map(|ordinal| format!("apply_change:{ordinal}")));
    plan.push("advance_watermark".to_string());
    plan.push("commit".to_string());
    plan
}

fn parse_canonical_json(text: &str, label: &str) -> Result<Value> {
    let value: Value = serde_json::from_str(text).with_context(|| format!("parse {label} JSON"))?;
    let canonical = canonical_json(&value)?;
    if canonical != text {
        bail!("{label} JSON is not canonical");
    }
    Ok(value)
}

fn canonical_json(value: &Value) -> Result<String> {
    serde_json::to_string(&sort_json(value)).context("serialize canonical JSON")
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
        value => value.clone(),
    }
}

fn change_checksum(table: &str, identity: &str, kind: &str, row: &str) -> String {
    sha256_hex(format!("{table}\n{identity}\n{kind}\n{row}").as_bytes())
}

fn commit_checksum(commit: &OrganizationCommitEnvelope, changes: &[PreparedChange]) -> String {
    let fields = [
        commit.organization_id.to_string(),
        commit.sequence.to_string(),
        commit.change_schema_version.to_string(),
        commit.operation_id.clone(),
        commit.correlation_id.clone(),
        commit.contract_version.clone(),
        commit.occurred_at_micros.to_string(),
        commit.actor_identity_hex.clone(),
        changes.len().to_string(),
    ];
    let mut digest = Sha256::new();
    for field in fields {
        digest.update(field.len().to_string().as_bytes());
        digest.update(b":");
        digest.update(field.as_bytes());
    }
    for change in changes {
        digest.update(change.input.checksum.as_bytes());
    }
    hex::encode(digest.finalize())
}

fn decode_identity(identity: &str) -> Result<Vec<u8>> {
    if identity.len() != 64
        || !identity
            .chars()
            .all(|character| character.is_ascii_digit() || character.is_ascii_lowercase())
    {
        bail!("actor identity must be 64 lowercase hexadecimal characters");
    }
    Ok(hex::decode(identity)?)
}

fn quote_identifier(identifier: &str) -> Result<String> {
    if !is_safe_identifier(identifier) {
        bail!("unsafe projection SQL identifier '{identifier}'");
    }
    Ok(format!("\"{identifier}\""))
}

fn is_safe_identifier(identifier: &str) -> bool {
    !identifier.is_empty()
        && identifier.len() <= 128
        && identifier
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn validate_token(name: &str, value: &str) -> Result<()> {
    if value.is_empty() || value.trim() != value || value.len() > 256 {
        bail!("{name} must be non-empty, trimmed, and at most 256 bytes");
    }
    Ok(())
}

fn validate_operation_id(value: &str) -> Result<()> {
    validate_token("operation_id", value)?;
    let Some(suffix) = value.strip_prefix("erp.") else {
        bail!("operation_id must use a canonical erp.* contract ID");
    };
    if suffix.is_empty()
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        bail!("operation_id must use a canonical erp.<snake_case> contract ID");
    }
    if !locked_operation_ids()?.contains(value) {
        bail!("operation_id is not present in the locked contract manifest");
    }
    Ok(())
}

fn locked_operation_ids() -> Result<&'static BTreeSet<String>> {
    let result = LOCKED_OPERATION_IDS.get_or_init(|| {
        let manifest: Value = serde_json::from_str(LOCKED_OPERATION_MANIFEST_JSON)
            .map_err(|error| format!("parse locked contract-operation-ids.json: {error}"))?;
        if manifest.get("schema_version").and_then(Value::as_u64) != Some(1) {
            return Err("locked operation manifest has unsupported schema_version".into());
        }
        let operations = manifest
            .get("operations")
            .and_then(Value::as_object)
            .ok_or_else(|| "locked operation manifest lacks operations object".to_string())?;
        let ids: BTreeSet<String> = operations
            .values()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "locked operation manifest contains a non-string ID".to_string())
            })
            .collect::<std::result::Result<_, _>>()?;
        if ids.len() != operations.len() {
            return Err("locked operation manifest contains duplicate IDs".into());
        }
        Ok(ids)
    });
    result.as_ref().map_err(|error| anyhow!("{error}"))
}

fn snake_to_camel(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut uppercase = false;
    for character in value.chars() {
        if character == '_' {
            uppercase = true;
        } else if uppercase {
            output.push(character.to_ascii_uppercase());
            uppercase = false;
        } else {
            output.push(character);
        }
    }
    output
}

fn commit_id(organization_id: u64, sequence: u64) -> String {
    format!("{organization_id}:{sequence}")
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cold_tier::{migrate, pg_pool, projection_observability, projection_worker};
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::time::{SystemTime, UNIX_EPOCH};

    const STORAGE_POLICY_MANIFEST_JSON: &str =
        include_str!("../../../lumiere-codegen/storage-policy-manifest.json");

    fn manifest() -> String {
        json!({
            "tables": {
                "parent": {
                    "projection_table": "parent",
                    "projection_mode": "upsert-current",
                    "primary_key": {"name": "id", "type": "U64"},
                    "organization_column": "organization_id",
                    "columns": [
                        {"name":"id","stdb_type":"U64","pg_type":"NUMERIC(20,0)","nullable":false,"pg_bind":"to_sql_numeric","pg_from":"from_sql_numeric_to_string","api_json":"string"},
                        {"name":"organization_id","stdb_type":"U64","pg_type":"NUMERIC(20,0)","nullable":false,"pg_bind":"to_sql_numeric","pg_from":"from_sql_numeric_to_string","api_json":"string"},
                        {"name":"name","stdb_type":"String","pg_type":"TEXT","nullable":false,"pg_bind":"to_sql_text","pg_from":"from_sql_text","api_json":"string"}
                    ]
                }
            }
        }).to_string()
    }

    fn change(kind: &str, row: Option<&str>, ordinal: u32) -> OrganizationRowChangeInput {
        let identity = r#"{"id":5}"#;
        let checksum = change_checksum("parent", identity, kind, row.unwrap_or(""));
        OrganizationRowChangeInput {
            id: format!("7:1:{ordinal}"),
            organization_id: 7,
            commit_sequence: 1,
            ordinal,
            table_name: "parent".into(),
            row_identity_json: identity.into(),
            change_kind: kind.into(),
            row_json: row.map(str::to_string),
            checksum,
        }
    }

    fn commit(changes: &[OrganizationRowChangeInput], count: u32) -> OrganizationCommitEnvelope {
        let mut value = OrganizationCommitEnvelope {
            id: "7:1".into(),
            organization_id: 7,
            sequence: 1,
            operation_id: "erp.create_task".into(),
            correlation_id: "request-1".into(),
            change_schema_version: CHANGE_SCHEMA_VERSION,
            contract_version: "ir-v2".into(),
            occurred_at_micros: 1,
            actor_identity_hex: "00".repeat(32),
            row_change_count: count,
            checksum: String::new(),
        };
        let prepared = changes
            .iter()
            .map(|input| PreparedChange {
                input: input.clone(),
                codec: ProjectionCodec {
                    table_name: "parent".into(),
                    projection_mode: ProjectionMode::UpsertCurrent,
                    primary_key: "id".into(),
                    organization_column: "organization_id".into(),
                    columns: vec![],
                },
                values: vec![],
                key_value: PgValue::NumericText(None),
            })
            .collect::<Vec<_>>();
        value.checksum = commit_checksum(&value, &prepared);
        value
    }

    #[test]
    fn rejects_sequence_gap() {
        assert!(validate_sequence(None, 2).is_err());
        assert!(validate_sequence(Some(3), 5).is_err());
    }

    #[test]
    fn upsert_sql_guards_existing_tenant() {
        let codec = ProjectionCodec {
            table_name: "parent".into(),
            projection_mode: ProjectionMode::UpsertCurrent,
            primary_key: "id".into(),
            organization_column: "organization_id".into(),
            columns: vec![
                ColumnCodec {
                    name: "id".into(),
                    pg_type: "NUMERIC(20,0)".into(),
                    stdb_type: "U64".into(),
                    nullable: false,
                },
                ColumnCodec {
                    name: "organization_id".into(),
                    pg_type: "NUMERIC(20,0)".into(),
                    stdb_type: "U64".into(),
                    nullable: false,
                },
                ColumnCodec {
                    name: "name".into(),
                    pg_type: "TEXT".into(),
                    stdb_type: "String".into(),
                    nullable: false,
                },
            ],
        };
        let sql = build_upsert_sql(&codec, 3).unwrap();
        assert!(sql.contains("INSERT INTO \"parent\" AS target"));
        assert!(sql.contains("ON CONFLICT (\"id\") DO UPDATE"));
        assert!(sql.contains("WHERE target.\"organization_id\" = $4::TEXT::NUMERIC"));

        let mut history_codec = codec;
        history_codec.projection_mode = ProjectionMode::AppendHistory;
        let history_sql = build_upsert_sql(&history_codec, 3).unwrap();
        assert!(history_sql.contains("ON CONFLICT (\"id\") DO NOTHING"));
        assert!(!history_sql.contains("DO UPDATE"));
    }

    #[test]
    fn append_history_rejects_delete_changes() {
        let mut history_manifest: Value =
            serde_json::from_str(&manifest()).expect("test manifest JSON");
        history_manifest["tables"]["parent"]["projection_mode"] = json!("append-history");
        let change = change("delete", None, 0);
        let error = validate_commit(
            &history_manifest.to_string(),
            &commit(std::slice::from_ref(&change), 1),
            &[change],
        )
        .unwrap_err();
        assert!(error.to_string().contains("does not accept delete"));
    }

    #[test]
    fn rejects_noncanonical_contract_and_operation_ids() {
        let row = r#"{"id":5,"name":"ok","organization_id":7}"#;
        let change = change("upsert", Some(row), 0);
        let mut envelope = commit(std::slice::from_ref(&change), 1);
        envelope.contract_version = "ir-v1".into();
        assert!(validate_commit(&manifest(), &envelope, std::slice::from_ref(&change)).is_err());

        let mut envelope = commit(std::slice::from_ref(&change), 1);
        envelope.operation_id = "create-parent".into();
        assert!(validate_commit(&manifest(), &envelope, &[change.clone()]).is_err());

        let mut envelope = commit(std::slice::from_ref(&change), 1);
        envelope.operation_id = "erp.create_parent".into();
        assert!(validate_commit(&manifest(), &envelope, &[change]).is_err());
    }

    #[test]
    fn rejects_non_projected_codec_modes() {
        let mut manifest: Value = serde_json::from_str(&manifest()).expect("test manifest JSON");
        manifest["tables"]["parent"]["projection_mode"] = json!("snapshot");
        assert!(load_projection_codec(&manifest.to_string(), "parent").is_err());

        manifest["tables"]["parent"]
            .as_object_mut()
            .unwrap()
            .remove("projection_mode");
        assert!(load_projection_codec(&manifest.to_string(), "parent").is_err());
    }

    #[test]
    fn matrix_skips_storage_snapshot_and_external_reference_modes() {
        let entries = manifest_matrix(7).expect("checked-in projection manifests");
        assert!(entries.iter().all(|entry| matches!(
            entry.projection_mode.as_str(),
            "upsert-current" | "append-history"
        )));
    }

    #[test]
    fn rejects_count_and_checksum_mismatch() {
        let row = r#"{"id":5,"name":"ok","organization_id":7}"#;
        let change = change("upsert", Some(row), 0);
        assert!(validate_commit(
            &manifest(),
            &commit(&[change.clone()], 2),
            &[change.clone()]
        )
        .is_err());
        let mut bad = change;
        bad.checksum = "00".repeat(32);
        assert!(validate_commit(&manifest(), &commit(&[bad.clone()], 1), &[bad]).is_err());
    }

    #[test]
    fn validates_delete_as_identity_only_tombstone() {
        let change = change("delete", None, 0);
        let prepared = validate_commit(
            &manifest(),
            &commit(std::slice::from_ref(&change), 1),
            &[change],
        )
        .unwrap();
        assert!(prepared[0].values.is_empty());
    }

    #[test]
    fn atomic_plan_inserts_and_applies_all_changes_before_watermark() {
        let plan = projection_plan(&["upsert", "delete"]);
        assert_eq!(
            plan,
            vec![
                "lock_watermark",
                "insert_commit",
                "insert_change:0",
                "insert_change:1",
                "apply_change:0",
                "apply_change:1",
                "advance_watermark",
                "commit"
            ]
        );
    }

    /// Exercise the actual PG projection relation set from one representative
    /// table per module and supported projection mode. The table list is
    /// intentionally derived from the checked-in manifests: adding a module or
    /// mode changes this test without another hand-maintained matrix.
    #[tokio::test]
    async fn postgres_manifest_matrix() -> Result<()> {
        if std::env::var("C3_TEST_PG").as_deref() != Ok("1") {
            eprintln!("skipping postgres_manifest_matrix (set C3_TEST_PG=1 to run)");
            return Ok(());
        }

        let config = pg_pool::PgConfig::from_env()?;
        let pool = pg_pool::build_pool(&config)?;
        migrate::ensure_schema(&pool).await?;
        let relation_count = projection_worker::ensure_projection_relations(
            &pool,
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
        )
        .await?;
        assert!(relation_count > 0);

        let now_micros = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("read clock for C3 PostgreSQL matrix organization")?
            .as_micros() as u64;
        let organization_id = 1_000_000_000_000_000_000_u64
            + (now_micros % 900_000_000_000_000_000_u64)
            + u64::from(std::process::id());
        let entries = manifest_matrix(organization_id)?;
        assert!(entries.len() >= 2, "expected multiple enabled C3 modules");
        assert!(entries
            .iter()
            .all(|entry| !entry.module.is_empty() && !entry.projection_mode.is_empty()));
        assert!(entries
            .iter()
            .any(|entry| entry.projection_mode == "upsert-current"));
        assert!(entries
            .iter()
            .any(|entry| entry.projection_mode == "append-history"));
        let all_modules = entries
            .iter()
            .map(|entry| entry.module.as_str())
            .collect::<BTreeSet<_>>();
        let mutable_modules = entries
            .iter()
            .filter(|entry| entry.projection_mode == "upsert-current")
            .map(|entry| entry.module.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(
            mutable_modules, all_modules,
            "every enabled module needs an upsert-current create/update/delete fixture"
        );

        let create_changes = changes_for_upsert(&entries, organization_id, 1);
        let create_commit = matrix_commit(organization_id, 1, &create_changes);
        assert_eq!(
            apply_commit(
                &pool,
                projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
                &create_commit,
                &create_changes,
            )
            .await?,
            ProjectionResult::Applied
        );
        for entry in &entries {
            assert_eq!(
                count_projection_rows(&pool, &entry.table, organization_id).await?,
                1
            );
        }

        // Replaying the exact durable commit is a no-op, including its rows.
        assert_eq!(
            apply_commit(
                &pool,
                projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
                &create_commit,
                &create_changes,
            )
            .await?,
            ProjectionResult::AlreadyApplied
        );
        assert_eq!(projection_watermark(&pool, organization_id).await?, Some(1));
        let before_update: Vec<String> = futures_snapshot(&pool, &entries, organization_id).await?;

        // A fresh pool models process restart. Sequence two must update every
        // representative row and advance the same durable watermark.
        drop(pool);
        let restarted_pool = pg_pool::build_pool(&config)?;
        let update_changes = changes_for_update(&entries, organization_id, 2);
        let update_commit = matrix_commit(organization_id, 2, &update_changes);
        assert_eq!(
            apply_commit(
                &restarted_pool,
                projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
                &update_commit,
                &update_changes,
            )
            .await?,
            ProjectionResult::Applied
        );
        let after_update = futures_snapshot(&restarted_pool, &entries, organization_id).await?;
        for ((entry, before), after) in entries
            .iter()
            .zip(before_update.iter())
            .zip(after_update.iter())
        {
            if entry.projection_mode == "upsert-current" {
                assert_ne!(before, after, "restart/update must change {}", entry.table);
            } else {
                assert_eq!(before, after, "append-history row must remain immutable");
            }
        }

        let delete_changes = changes_for_delete(&entries, organization_id, 3);
        let delete_commit = matrix_commit(organization_id, 3, &delete_changes);
        assert_eq!(
            apply_commit(
                &restarted_pool,
                projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
                &delete_commit,
                &delete_changes,
            )
            .await?,
            ProjectionResult::Applied
        );
        for entry in &entries {
            let expected = i64::from(entry.projection_mode == "append-history");
            assert_eq!(
                count_projection_rows(&restarted_pool, &entry.table, organization_id).await?,
                expected
            );
        }
        assert_eq!(
            projection_watermark(&restarted_pool, organization_id).await?,
            Some(3)
        );

        // Sequence four is deliberately omitted. A valid-looking sequence
        // five commit must be rejected before any ledger, row, or watermark
        // mutation occurs.
        let gap_changes = changes_for_upsert(&entries[..1], organization_id, 5);
        let gap_commit = matrix_commit(organization_id, 5, &gap_changes);
        let error = apply_commit(
            &restarted_pool,
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
            &gap_commit,
            &gap_changes,
        )
        .await
        .expect_err("injected sequence gap must be rejected");
        assert!(error.to_string().contains("gap or rewind"));
        assert_eq!(
            projection_watermark(&restarted_pool, organization_id).await?,
            Some(3)
        );
        projection_observability::record_projection_failure(
            &restarted_pool,
            organization_id,
            5,
            3,
            Some(gap_commit.occurred_at_micros),
            "gap",
            &error.to_string(),
            None,
        )
        .await?;
        let gap_status =
            projection_observability::read_projection_status(&restarted_pool, organization_id)
                .await?
                .expect("gap status must be visible");
        assert_eq!(gap_status.backlog_commits, 2);
        assert_eq!(gap_status.durable_sequence, 3);
        assert!(gap_status
            .last_error
            .as_deref()
            .is_some_and(|value| value.contains("gap")));
        assert_eq!(gap_status.quarantined_sequence, None);

        projection_observability::record_projection_failure(
            &restarted_pool,
            organization_id,
            5,
            3,
            Some(gap_commit.occurred_at_micros),
            "malformed_commit",
            "unsupported contract version",
            Some(4),
        )
        .await?;
        let quarantine_status =
            projection_observability::read_projection_status(&restarted_pool, organization_id)
                .await?
                .expect("quarantine status must be visible");
        assert_eq!(quarantine_status.quarantined_sequence, Some(4));
        assert_eq!(
            projection_watermark(&restarted_pool, organization_id).await?,
            Some(3),
            "quarantine must not skip the blocked sequence"
        );
        for entry in &entries {
            let expected = i64::from(entry.projection_mode == "append-history");
            assert_eq!(
                count_projection_rows(&restarted_pool, &entry.table, organization_id).await?,
                expected
            );
        }
        Ok(())
    }

    #[derive(Debug, Clone)]
    struct MatrixEntry {
        module: String,
        projection_mode: String,
        table: String,
        codec: ProjectionCodec,
        identity_json: String,
        initial_row: Value,
    }

    fn manifest_matrix(organization_id: u64) -> Result<Vec<MatrixEntry>> {
        let storage: Value = serde_json::from_str(STORAGE_POLICY_MANIFEST_JSON)?;
        let codec_manifest: Value =
            serde_json::from_str(projection_worker::PROJECTION_CODEC_MANIFEST_JSON)?;
        let policies = storage
            .get("policies")
            .and_then(Value::as_array)
            .ok_or_else(|| anyhow!("storage policy manifest lacks policies"))?;
        let mut selected = BTreeMap::<(String, String), String>::new();
        for policy in policies {
            if policy.get("enabled").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let Some(mode) = policy.get("projection_mode").and_then(Value::as_str) else {
                bail!("storage policy lacks projection_mode");
            };
            if !matches!(mode, "upsert-current" | "append-history") {
                continue;
            }
            let module = policy
                .get("module")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("storage policy lacks module"))?;
            let table = policy
                .get("table")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("storage policy lacks table"))?;
            selected
                .entry((module.to_string(), mode.to_string()))
                .and_modify(|current| {
                    if table < current.as_str() {
                        *current = table.to_string();
                    }
                })
                .or_insert_with(|| table.to_string());
        }

        selected
            .into_iter()
            .enumerate()
            .map(|(index, ((module, projection_mode), table))| {
                let codec_entry = codec_manifest
                    .get("tables")
                    .and_then(|tables| tables.get(&table))
                    .ok_or_else(|| anyhow!("storage policy table '{table}' is absent from projection codec"))?;
                if codec_entry.get("module").and_then(Value::as_str) != Some(module.as_str())
                    || codec_entry.get("projection_mode").and_then(Value::as_str)
                        != Some(projection_mode.as_str())
                {
                    bail!(
                        "projection codec metadata for '{table}' does not match storage policy {module}/{projection_mode}"
                    );
                }
                let codec = load_projection_codec(
                    projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
                    &table,
                )?;
                let identity = primary_key_value(&codec, organization_id, index as u64)?;
                let mut row = Map::new();
                for column in &codec.columns {
                    row.insert(
                        column.name.clone(),
                        synthetic_value(
                            column,
                            &codec,
                            &identity,
                            organization_id,
                            index as u64,
                            1,
                        ),
                    );
                }
                let row = Value::Object(row);
                let identity_json = canonical_json(&identity)?;
                // Keep this assertion close to manifest selection so a policy
                // can never silently select a non-projectable relation.
                Ok(MatrixEntry {
                    module,
                    projection_mode,
                    table,
                    codec,
                    identity_json,
                    initial_row: row,
                })
            })
            .collect()
    }

    fn primary_key_value(
        codec: &ProjectionCodec,
        organization_id: u64,
        index: u64,
    ) -> Result<Value> {
        let key = codec
            .columns
            .iter()
            .find(|column| column.name == codec.primary_key)
            .ok_or_else(|| anyhow!("primary key is absent from codec"))?;
        let key_value = if codec.primary_key == codec.organization_column {
            json!(organization_id)
        } else {
            match key.pg_type.as_str() {
                "NUMERIC(20,0)" => json!(organization_id + 10_000 + index),
                "BIGINT" => json!(organization_id as i64 + 10_000 + index as i64),
                "INTEGER" => json!((organization_id % 2_000_000_000) as i32 + index as i32),
                "DOUBLE PRECISION" => {
                    json!((organization_id % 1_000_000_000) as f64 + index as f64)
                }
                "REAL" => json!((organization_id % 1_000_000) as f32 + index as f32),
                "BOOLEAN" => json!(true),
                "BYTEA" => json!(format!("{:064x}", organization_id + index)),
                "TEXT" => json!(format!("c3-key-{organization_id}-{index}")),
                other => bail!("unsupported synthetic primary-key type {other}"),
            }
        };
        let mut identity = Map::new();
        identity.insert(codec.primary_key.clone(), key_value);
        Ok(Value::Object(identity))
    }

    fn synthetic_value(
        column: &ColumnCodec,
        codec: &ProjectionCodec,
        identity: &Value,
        organization_id: u64,
        index: u64,
        version: u64,
    ) -> Value {
        if column.name == codec.primary_key {
            return identity
                .as_object()
                .and_then(|object| object.get(&codec.primary_key))
                .cloned()
                .unwrap_or(Value::Null);
        }
        if column.name == codec.organization_column {
            return json!(organization_id);
        }
        if column.nullable && version == 1 {
            return Value::Null;
        }
        match column.pg_type.as_str() {
            "NUMERIC(20,0)" => json!(20_000_u64 + index + version),
            "BIGINT" if column.stdb_type == "Timestamp" => {
                json!({"microsSinceUnixEpoch": 1_700_000_000_000_000_i64 + index as i64 + version as i64})
            }
            "BIGINT" => json!(20_000_i64 + index as i64 + version as i64),
            "INTEGER" => json!(20_000_i32 + index as i32 + version as i32),
            "DOUBLE PRECISION" => json!(20_000.25_f64 + index as f64 + version as f64),
            "REAL" => json!(20_000.25_f32 + index as f32 + version as f32),
            "BOOLEAN" => json!(version % 2 == 0),
            "BYTEA" => json!("11".repeat(32)),
            "JSONB" if column.stdb_type.starts_with("Vec(") => json!([index, version]),
            "JSONB" => json!({"c3": version}),
            "TEXT" => json!(format!("c3-{}-{}", column.name, version)),
            _ => Value::Null,
        }
    }

    fn make_change(
        organization_id: u64,
        sequence: u64,
        ordinal: u32,
        entry: &MatrixEntry,
        kind: &str,
        row: Option<&Value>,
    ) -> Result<OrganizationRowChangeInput> {
        let row_json = row.map(canonical_json).transpose()?;
        let checksum = change_checksum(
            &entry.table,
            &entry.identity_json,
            kind,
            row_json.as_deref().unwrap_or(""),
        );
        Ok(OrganizationRowChangeInput {
            id: format!("{organization_id}:{sequence}:{ordinal}"),
            organization_id,
            commit_sequence: sequence,
            ordinal,
            table_name: entry.table.clone(),
            row_identity_json: entry.identity_json.clone(),
            change_kind: kind.to_string(),
            row_json,
            checksum,
        })
    }

    fn changes_for_upsert(
        entries: &[MatrixEntry],
        organization_id: u64,
        sequence: u64,
    ) -> Vec<OrganizationRowChangeInput> {
        entries
            .iter()
            .enumerate()
            .map(|(ordinal, entry)| {
                make_change(
                    organization_id,
                    sequence,
                    ordinal as u32,
                    entry,
                    "upsert",
                    Some(&entry.initial_row),
                )
                .expect("synthetic upsert change")
            })
            .collect()
    }

    fn changes_for_update(
        entries: &[MatrixEntry],
        organization_id: u64,
        sequence: u64,
    ) -> Vec<OrganizationRowChangeInput> {
        entries
            .iter()
            .filter(|entry| entry.projection_mode == "upsert-current")
            .enumerate()
            .map(|(ordinal, entry)| {
                let identity: Value =
                    serde_json::from_str(&entry.identity_json).expect("identity JSON");
                let mut row = Map::new();
                for column in &entry.codec.columns {
                    row.insert(
                        column.name.clone(),
                        synthetic_value(
                            column,
                            &entry.codec,
                            &identity,
                            organization_id,
                            ordinal as u64,
                            2,
                        ),
                    );
                }
                // `synthetic_value` derives the key from identity; keep the
                // exact initial identity even for non-standard primary keys.
                row.insert(
                    entry.codec.primary_key.clone(),
                    identity
                        .as_object()
                        .and_then(|object| object.get(&entry.codec.primary_key))
                        .cloned()
                        .expect("identity primary key"),
                );
                make_change(
                    organization_id,
                    sequence,
                    ordinal as u32,
                    entry,
                    "upsert",
                    Some(&Value::Object(row)),
                )
                .expect("synthetic update change")
            })
            .collect()
    }

    fn changes_for_delete(
        entries: &[MatrixEntry],
        organization_id: u64,
        sequence: u64,
    ) -> Vec<OrganizationRowChangeInput> {
        entries
            .iter()
            .filter(|entry| entry.projection_mode == "upsert-current")
            .enumerate()
            .map(|(ordinal, entry)| {
                make_change(
                    organization_id,
                    sequence,
                    ordinal as u32,
                    entry,
                    "delete",
                    None,
                )
                .expect("synthetic delete change")
            })
            .collect()
    }

    fn matrix_commit(
        organization_id: u64,
        sequence: u64,
        changes: &[OrganizationRowChangeInput],
    ) -> OrganizationCommitEnvelope {
        let mut commit = OrganizationCommitEnvelope {
            id: commit_id(organization_id, sequence),
            organization_id,
            sequence,
            operation_id: "erp.create_task".to_string(),
            correlation_id: format!("c3-matrix-{organization_id}-{sequence}"),
            change_schema_version: CHANGE_SCHEMA_VERSION,
            contract_version: CONTRACT_VERSION.to_string(),
            occurred_at_micros: 1_700_000_000_000_000 + sequence as i64,
            actor_identity_hex: "00".repeat(32),
            row_change_count: changes.len() as u32,
            checksum: String::new(),
        };
        let prepared = changes
            .iter()
            .cloned()
            .map(|input| PreparedChange {
                input,
                codec: ProjectionCodec {
                    table_name: String::new(),
                    projection_mode: ProjectionMode::UpsertCurrent,
                    primary_key: String::new(),
                    organization_column: String::new(),
                    columns: Vec::new(),
                },
                values: Vec::new(),
                key_value: PgValue::NumericText(None),
            })
            .collect::<Vec<_>>();
        commit.checksum = commit_checksum(&commit, &prepared);
        commit
    }

    async fn count_projection_rows(pool: &Pool, table: &str, organization_id: u64) -> Result<i64> {
        let client = pool.get().await?;
        let table = quote_identifier(table)?;
        let organization_id = organization_id.to_string();
        Ok(client
            .query_one(
                &format!(
                    "SELECT count(*) FROM {table} WHERE \"organization_id\" = $1::TEXT::NUMERIC"
                ),
                &[&organization_id],
            )
            .await?
            .get(0))
    }

    async fn futures_snapshot(
        pool: &Pool,
        entries: &[MatrixEntry],
        organization_id: u64,
    ) -> Result<Vec<String>> {
        let client = pool.get().await?;
        let organization_id = organization_id.to_string();
        let mut rows = Vec::with_capacity(entries.len());
        for entry in entries {
            let table = quote_identifier(&entry.table)?;
            let value = client
                .query_one(
                    &format!(
                        "SELECT row_to_json(projection_row)::TEXT FROM (SELECT * FROM {table} WHERE \"organization_id\" = $1::TEXT::NUMERIC) projection_row"
                    ),
                    &[&organization_id],
                )
                .await?
                .get::<_, String>(0);
            rows.push(value);
        }
        Ok(rows)
    }

    async fn projection_watermark(pool: &Pool, organization_id: u64) -> Result<Option<u64>> {
        let client = pool.get().await?;
        let organization_id = organization_id.to_string();
        Ok(client
            .query_opt(
                "SELECT applied_sequence::TEXT FROM organization_projection_watermark WHERE organization_id = $1::TEXT::NUMERIC",
                &[&organization_id],
            )
            .await?
            .map(|row| row.get::<_, String>(0).parse::<u64>())
            .transpose()?)
    }
}
