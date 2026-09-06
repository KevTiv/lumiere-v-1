//! Manifest decoding and prepared-change validation.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{Map, Value};

use super::super::conventions;
use super::super::pg_codec::{self, snake_to_camel};
use super::checksum::{
    change_checksum, commit_checksum, commit_id, decode_identity, parse_canonical_json,
    validate_operation_id, validate_token,
};
use super::{
    OrganizationCommitEnvelope, OrganizationRowChangeInput, PreparedChange, ProjectionCodec,
    ProjectionMode, SequenceDisposition, CHANGE_SCHEMA_VERSION, CONTRACT_VERSION,
};

static PROJECTION_CODEC_CACHE: OnceLock<Result<BTreeMap<String, ProjectionCodec>, String>> =
    OnceLock::new();

pub(super) fn validate_commit(
    manifest_json: &str,
    commit: &OrganizationCommitEnvelope,
    changes: &[OrganizationRowChangeInput],
) -> Result<Vec<PreparedChange>> {
    validate_commit_with_loader(commit, changes, |table_name| {
        load_projection_codec(manifest_json, table_name)
    })
}

fn validate_commit_with_loader(
    commit: &OrganizationCommitEnvelope,
    changes: &[OrganizationRowChangeInput],
    load_codec: impl Fn(&str) -> Result<ProjectionCodec>,
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
        let codec = load_codec(&input.table_name)?;
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

pub(super) fn validate_commit_cached(
    commit: &OrganizationCommitEnvelope,
    changes: &[OrganizationRowChangeInput],
) -> Result<Vec<PreparedChange>> {
    validate_commit_with_loader(commit, changes, cached_projection_codec)
}

pub(super) fn validate_full_row(
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

pub(super) fn normalize_row_for_codec(codec: &ProjectionCodec, row: &Value) -> Result<Value> {
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

pub(super) fn load_projection_codec(
    manifest_json: &str,
    table_name: &str,
) -> Result<ProjectionCodec> {
    let manifest: Value =
        serde_json::from_str(manifest_json).context("parse projection codec manifest")?;
    projection_codec_from_manifest(&manifest, table_name)
}

pub(super) fn cached_projection_codec(table_name: &str) -> Result<ProjectionCodec> {
    let codecs = PROJECTION_CODEC_CACHE.get_or_init(|| {
        projection_codecs(super::super::projection_worker::PROJECTION_CODEC_MANIFEST_JSON)
            .map_err(|error| error.to_string())
    });
    let codecs = codecs
        .as_ref()
        .map_err(|error| anyhow!("cached projection codec manifest is invalid: {error}"))?;
    codecs
        .get(table_name)
        .cloned()
        .ok_or_else(|| anyhow!("projection codec has no table '{table_name}'"))
}

pub(super) fn projection_codecs(manifest_json: &str) -> Result<BTreeMap<String, ProjectionCodec>> {
    let manifest: Value =
        serde_json::from_str(manifest_json).context("parse projection codec manifest")?;
    let tables = manifest
        .get("tables")
        .and_then(Value::as_object)
        .context("projection codec manifest lacks tables")?;
    tables
        .iter()
        .filter_map(|(table_name, entry)| {
            (entry.get("projection_mode").and_then(Value::as_str) != Some("snapshot")).then(|| {
                projection_codec_from_manifest(&manifest, table_name)
                    .map(|codec| (table_name.clone(), codec))
            })
        })
        .collect()
}

fn projection_codec_from_manifest(manifest: &Value, table_name: &str) -> Result<ProjectionCodec> {
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
    let organization_partitioned = match entry
        .get("postgres_access_path")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("projection codec table lacks postgres_access_path"))?
    {
        "organization_partition" => true,
        "organization_index" | "snapshot_key" | "platform_shared" | "external" => false,
        access_path => bail!(
            "projection codec table '{table_name}' has unsupported PostgreSQL access path '{access_path}'"
        ),
    };
    let primary_key = entry
        .get("primary_key")
        .and_then(|key| key.get("name"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("projection codec table lacks primary-key metadata"))?;
    if conventions::validate_identifier(primary_key).is_err() {
        bail!("projection codec has unsafe primary-key identifier");
    }
    let columns = pg_codec::load_columns_from_manifest(manifest, table_name)?;
    if columns.is_empty() || !columns.iter().any(|column| column.name == primary_key) {
        bail!("projection codec primary key is not present in columns");
    }
    if columns
        .iter()
        .any(|column| conventions::validate_identifier(&column.name).is_err())
    {
        bail!("projection codec has unsafe column identifier");
    }
    Ok(ProjectionCodec {
        table_name: table_name.to_string(),
        projection_mode,
        primary_key: primary_key.to_string(),
        organization_column: organization_column.to_string(),
        organization_partitioned,
        columns,
    })
}

pub(super) fn validate_sequence(
    current: Option<u64>,
    incoming: u64,
) -> Result<SequenceDisposition> {
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
