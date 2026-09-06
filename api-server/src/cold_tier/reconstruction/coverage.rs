//! Disposable C7 source-cell snapshot coverage.
//!
//! This operator-only helper materializes a seeded local source organization
//! into the ordinary ordered PostgreSQL projection protocol. It exists solely
//! to prove reconstruction coverage with realistic rows; production recovery
//! continues to consume commits written by normal reducers and the projector.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::{json, Map, Value};
use stdb_client::StdbClient;

use super::RestoreCatalog;
use crate::cold_tier::{
    commit_projection::{
        apply_commit, canonical_json, change_checksum, commit_checksum_from_changes,
        OrganizationCommitEnvelope, OrganizationRowChangeInput, ProjectionResult,
    },
    conventions::quote_identifier,
    migrate, pg_codec, pg_pool, projection_worker,
};

const ENABLE_FLAG: &str = "C7_COVERAGE_SNAPSHOT";
const SOURCE_MODULE_ENV: &str = "C7_SOURCE_STDB_MODULE";
const SOURCE_TOKEN_ENV: &str = "C7_SOURCE_STDB_TOKEN";
const SOURCE_IDENTITY_ENV: &str = "C7_SOURCE_STDB_IDENTITY";
const MAX_SOURCE_ROWS: usize = 100_000;
const ROWS_PER_COMMIT: usize = 2_000;
const PROTOCOL_TABLES: [&str; 3] = [
    "organization_commit",
    "organization_commit_cursor",
    "organization_row_change",
];

const STORAGE_POLICY_MANIFEST_JSON: &str =
    include_str!("../../../../lumiere-codegen/storage-policy-manifest.json");

#[derive(Debug, Serialize)]
pub struct ReconstructionCoverageReport {
    pub organization_id: u64,
    pub modules: Vec<String>,
    pub module_row_counts: BTreeMap<String, usize>,
    pub source_tables_with_rows: usize,
    pub source_rows: usize,
    pub projection_commits: u64,
    pub projected_row_changes: usize,
    pub deleted_table: String,
    pub deleted_identity: Value,
    pub relationship_values: usize,
    pub total_values: usize,
    pub audit_rows: usize,
    pub durable_idempotency_records: usize,
}

#[derive(Debug)]
struct SnapshotRow {
    table: String,
    module: String,
    identity: Value,
    row: Value,
}

/// Capture a real seeded source organization into disposable PostgreSQL.
///
/// # Errors
///
/// Fails closed unless both the explicit drill flag and loopback-only source
/// module constraints hold, or when any enabled module lacks persisted rows.
pub async fn capture_coverage_snapshot(
    organization_id: u64,
) -> Result<ReconstructionCoverageReport> {
    if organization_id == 0 {
        bail!("organization id must be non-zero");
    }
    require_disposable_source()?;
    let host = required_env("STDB_HOST")?;
    let module = required_env(SOURCE_MODULE_ENV)?;
    let token = required_env(SOURCE_TOKEN_ENV)?;
    let actor_identity = normalize_identity(&required_env(SOURCE_IDENTITY_ENV)?)?;
    let source = StdbClient::new(host, module, token);
    let catalog = RestoreCatalog::generated()?;
    let expected_modules = enabled_modules()?;
    let rows = load_source_rows(&source, organization_id, &catalog).await?;
    let module_row_counts = count_module_rows(&rows);
    let covered_modules = module_row_counts.keys().cloned().collect::<BTreeSet<_>>();
    let missing = expected_modules
        .difference(&covered_modules)
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        bail!(
            "seeded source lacks persisted reconstruction rows for enabled modules: {}",
            missing.join(", ")
        );
    }
    let relationship_values = count_named_values(&rows, |name| {
        name.ends_with("_id") && !matches!(name, "id" | "organization_id")
    });
    let total_values = count_named_values(&rows, |name| {
        name.contains("total") || name.starts_with("amount_")
    });
    let audit_rows = rows.iter().filter(|row| row.table == "audit_log").count();
    if relationship_values == 0 || total_values == 0 || audit_rows == 0 {
        bail!("seeded source lacks relationship, total, or audit evidence");
    }

    let config = pg_pool::PgConfig::from_env().context("load C7 PostgreSQL config")?;
    let pool = pg_pool::build_pool(&config).context("build C7 PostgreSQL pool")?;
    migrate::ensure_schema(&pool).await?;
    projection_worker::ensure_projection_relations(
        &pool,
        projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
    )
    .await?;

    let mut sequence = 0_u64;
    let mut projected_row_changes = 0_usize;
    for chunk in rows.chunks(ROWS_PER_COMMIT) {
        sequence += 1;
        let mut changes = chunk
            .iter()
            .enumerate()
            .map(|(ordinal, row)| {
                snapshot_change(organization_id, sequence, ordinal as u32, row, "upsert")
            })
            .collect::<Result<Vec<_>>>()?;
        changes.push(cursor_change(
            organization_id,
            sequence,
            changes.len() as u32,
            sequence + 1,
        )?);
        projected_row_changes += changes.len();
        apply_snapshot_commit(&pool, organization_id, sequence, &actor_identity, &changes).await?;
    }

    let deleted = select_delete_proof(&rows)?;
    sequence += 1;
    let mut delete_changes = vec![snapshot_change(
        organization_id,
        sequence,
        0,
        deleted,
        "delete",
    )?];
    delete_changes.push(cursor_change(organization_id, sequence, 1, sequence + 1)?);
    projected_row_changes += delete_changes.len();
    apply_snapshot_commit(
        &pool,
        organization_id,
        sequence,
        &actor_identity,
        &delete_changes,
    )
    .await?;

    let source_tables_with_rows = rows
        .iter()
        .map(|row| row.table.as_str())
        .collect::<BTreeSet<_>>()
        .len();
    let source_rows = rows.len();
    Ok(ReconstructionCoverageReport {
        organization_id,
        modules: expected_modules.into_iter().collect(),
        module_row_counts,
        source_tables_with_rows,
        source_rows,
        projection_commits: sequence,
        projected_row_changes,
        deleted_table: deleted.table.clone(),
        deleted_identity: deleted.identity.clone(),
        relationship_values,
        total_values,
        audit_rows,
        durable_idempotency_records: sequence as usize + projected_row_changes,
    })
}

async fn load_source_rows(
    source: &StdbClient,
    organization_id: u64,
    catalog: &RestoreCatalog,
) -> Result<Vec<SnapshotRow>> {
    let mut rows = Vec::new();
    for table in catalog.tables() {
        if PROTOCOL_TABLES.contains(&table.table.as_str()) {
            continue;
        }
        let columns = pg_codec::load_columns(
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
            &table.table,
        )?;
        let projection = columns
            .iter()
            .map(|column| quote_identifier(&column.name))
            .collect::<Result<Vec<_>>>()?
            .join(", ");
        let sql = format!(
            "SELECT {projection} FROM {table} WHERE {organization_column} = {organization_id} LIMIT {limit}",
            table = quote_identifier(&table.table)?,
            organization_column = quote_identifier(&table.organization_column)?,
            limit = MAX_SOURCE_ROWS + 1,
        );
        let source_rows = source
            .query_sql_sats(&sql)
            .await
            .with_context(|| format!("read C7 source table '{}'", table.table))?;
        if source_rows.len() > MAX_SOURCE_ROWS {
            bail!(
                "C7 source table '{}' exceeds bounded row limit",
                table.table
            );
        }
        for source_row in source_rows {
            let row = canonical_source_row(&source_row, &columns)?;
            let identity_value = row
                .get(&table.primary_key)
                .cloned()
                .with_context(|| format!("source row lacks '{}'", table.primary_key))?;
            rows.push(SnapshotRow {
                table: table.table.clone(),
                module: table.module.clone(),
                identity: json!({table.primary_key.clone(): identity_value}),
                row: Value::Object(row),
            });
        }
    }
    Ok(rows)
}

fn canonical_source_row(
    source: &Value,
    columns: &[pg_codec::ColumnCodec],
) -> Result<Map<String, Value>> {
    let object = source
        .as_object()
        .context("STDB source row must be an object")?;
    columns
        .iter()
        .map(|column| {
            let value = object
                .get(&column.name)
                .cloned()
                .with_context(|| format!("STDB source row lacks column '{}'", column.name))?;
            Ok((column.name.clone(), value))
        })
        .collect()
}

fn snapshot_change(
    organization_id: u64,
    sequence: u64,
    ordinal: u32,
    row: &SnapshotRow,
    kind: &str,
) -> Result<OrganizationRowChangeInput> {
    let identity = canonical_json(&row.identity)?;
    let row_json = (kind == "upsert")
        .then(|| canonical_json(&row.row))
        .transpose()?;
    let checksum = change_checksum(
        &row.table,
        &identity,
        kind,
        row_json.as_deref().unwrap_or(""),
    );
    Ok(OrganizationRowChangeInput {
        id: format!("{organization_id}:{sequence}:{ordinal}"),
        organization_id,
        commit_sequence: sequence,
        ordinal,
        table_name: row.table.clone(),
        row_identity_json: identity,
        change_kind: kind.to_owned(),
        row_json,
        checksum,
    })
}

fn cursor_change(
    organization_id: u64,
    sequence: u64,
    ordinal: u32,
    next_sequence: u64,
) -> Result<OrganizationRowChangeInput> {
    snapshot_change(
        organization_id,
        sequence,
        ordinal,
        &SnapshotRow {
            table: "organization_commit_cursor".to_owned(),
            module: "core".to_owned(),
            identity: json!({"organization_id": organization_id}),
            row: json!({
                "organization_id": organization_id,
                "next_sequence": next_sequence,
            }),
        },
        "upsert",
    )
}

async fn apply_snapshot_commit(
    pool: &deadpool_postgres::Pool,
    organization_id: u64,
    sequence: u64,
    actor_identity: &str,
    changes: &[OrganizationRowChangeInput],
) -> Result<()> {
    let mut commit = OrganizationCommitEnvelope {
        id: format!("{organization_id}:{sequence}"),
        organization_id,
        sequence,
        operation_id: "erp.bootstrap_new_tenant".to_owned(),
        correlation_id: format!("c7-coverage-{organization_id}-{sequence}"),
        change_schema_version: 1,
        contract_version: "ir-v2".to_owned(),
        occurred_at_micros: 1_700_000_000_000_000_i64 + sequence as i64,
        actor_identity_hex: actor_identity.to_owned(),
        row_change_count: changes.len() as u32,
        checksum: String::new(),
    };
    commit.checksum = commit_checksum_from_changes(
        &commit,
        changes.iter().map(|change| change.checksum.as_str()),
    );
    if apply_commit(
        pool,
        projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
        &commit,
        changes,
    )
    .await?
        != ProjectionResult::Applied
    {
        bail!("C7 coverage snapshot commit was already applied; use an empty disposable database");
    }
    Ok(())
}

fn select_delete_proof(rows: &[SnapshotRow]) -> Result<&SnapshotRow> {
    rows.iter()
        .find(|row| row.table == "activity")
        .or_else(|| rows.iter().find(|row| row.table == "audit_rule"))
        .context("seeded source lacks a mutable row for delete proof")
}

fn enabled_modules() -> Result<BTreeSet<String>> {
    let manifest: Value = serde_json::from_str(STORAGE_POLICY_MANIFEST_JSON)?;
    let policies = manifest["policies"]
        .as_array()
        .context("storage policy manifest lacks policies")?;
    policies
        .iter()
        .filter(|policy| policy["enabled"].as_bool() != Some(false))
        .map(|policy| {
            policy["module"]
                .as_str()
                .map(str::to_owned)
                .context("storage policy lacks module")
        })
        .collect()
}

fn count_module_rows(rows: &[SnapshotRow]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for row in rows {
        *counts.entry(row.module.clone()).or_default() += 1;
    }
    counts
}

fn count_named_values(rows: &[SnapshotRow], predicate: impl Fn(&str) -> bool) -> usize {
    rows.iter()
        .filter_map(|row| row.row.as_object())
        .flat_map(Map::iter)
        .filter(|(name, value)| predicate(name) && sats_value_is_present(value))
        .count()
}

fn sats_value_is_present(value: &Value) -> bool {
    !value.is_null()
        && !value
            .as_object()
            .is_some_and(|object| object.len() == 1 && object.contains_key("none"))
}

fn require_disposable_source() -> Result<()> {
    if std::env::var(ENABLE_FLAG).ok().as_deref() != Some("1") {
        bail!("{ENABLE_FLAG}=1 is required");
    }
    let host = required_env("STDB_HOST")?;
    if !matches!(host.as_str(), "http://127.0.0.1" | "http://localhost")
        && !host.starts_with("http://127.0.0.1:")
        && !host.starts_with("http://localhost:")
    {
        bail!("STDB_HOST must be loopback");
    }
    let module = required_env(SOURCE_MODULE_ENV)?;
    if !module.starts_with("lumiere-c7-source-") {
        bail!("{SOURCE_MODULE_ENV} must use the disposable 'lumiere-c7-source-' prefix");
    }
    Ok(())
}

fn required_env(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .with_context(|| format!("{name} is required"))
}

fn normalize_identity(value: &str) -> Result<String> {
    let value = value.trim().strip_prefix("0x").unwrap_or(value.trim());
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("C7 source identity must be 64 hexadecimal characters");
    }
    Ok(value.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enabled_module_census_is_complete() {
        let modules = enabled_modules().unwrap();
        assert_eq!(modules.len(), 22);
        assert!(modules.contains("core"));
        assert!(modules.contains("workflow"));
    }

    #[test]
    fn validates_canonical_source_rows_against_generated_columns() {
        let columns = vec![
            pg_codec::ColumnCodec {
                name: "organization_id".to_owned(),
                pg_type: "NUMERIC(20,0)".to_owned(),
                stdb_type: "U64".to_owned(),
                nullable: false,
            },
            pg_codec::ColumnCodec {
                name: "amount_total".to_owned(),
                pg_type: "DOUBLE PRECISION".to_owned(),
                stdb_type: "F64".to_owned(),
                nullable: false,
            },
        ];
        let normalized = canonical_source_row(
            &json!({"organization_id": 42, "amount_total": 7.5}),
            &columns,
        )
        .unwrap();
        assert_eq!(normalized["organization_id"], 42);
        assert_eq!(normalized["amount_total"], 7.5);
    }
}
