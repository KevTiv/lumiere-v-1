//! Bounded SpacetimeDB → PostgreSQL projection worker.
//!
//! The worker follows the durable cursor written by the reducer commit
//! protocol. For each organization it reads exactly `next_sequence`, fetches
//! that commit's complete ordered row changes, and delegates atomic
//! application to [`super::commit_projection::apply_commit`]. It never scans
//! business tables or reconstructs reducer outcomes.

use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use anyhow::{anyhow, bail, Context, Result};
use axum::{http::StatusCode, routing::get, Router};
use deadpool_postgres::Pool;
use serde_json::Value;
use stdb_client::StdbClient;

use super::{commit_projection, migrate, pg_pool};
use crate::{config::Config, state::AppState};

/// Generated all-table projection codec artifact checked into the API
/// package. Regeneration is owned by `lumiere-codegen`; this worker never
/// accepts a caller-selected schema or SQL destination.
pub const PROJECTION_CODEC_MANIFEST_JSON: &str =
    include_str!("../generated/projection-codec-manifest.json");
const MAX_CHANGES_PER_COMMIT: usize = 10_000;
static CURSOR_SCAN_AFTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ProjectionDrainStats {
    pub organizations: usize,
    pub commits: usize,
    pub already_applied: usize,
    pub failed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProjectionRelation {
    table: String,
    primary_key: String,
    organization_column: String,
    columns: Vec<ProjectionColumn>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProjectionColumn {
    name: String,
    pg_type: String,
    nullable: bool,
}

/// Read a bounded set of organization cursors and apply the exact next
/// commit for each organization. A missing next commit is normal: the cursor
/// may be ahead of the currently replicated commit rows during a poll.
pub async fn drain_batch(
    stdb: &StdbClient,
    pool: &Pool,
    batch_size: u32,
) -> Result<ProjectionDrainStats> {
    require_server_identity(stdb)?;
    // Cursor rows are private protocol tables. The worker's StdbClient must
    // use the configured server/admin identity; see `serve`, which rejects
    // startup when STDB_SERVER_TOKEN is absent.
    let scan_after = CURSOR_SCAN_AFTER.load(Ordering::Relaxed);
    let mut cursors = query_cursors(stdb, scan_after, batch_size).await?;
    if cursors.is_empty() && scan_after != 0 {
        // Wrap once per cycle so a newly active low-ID organization is not
        // delayed indefinitely after the scan reaches the upper bound.
        CURSOR_SCAN_AFTER.store(0, Ordering::Relaxed);
        cursors = query_cursors(stdb, 0, batch_size).await?;
    }
    if let Some(cursor) = cursors.last() {
        if let Some(organization_id) = cursor.get("organizationId").and_then(Value::as_u64) {
            CURSOR_SCAN_AFTER.store(organization_id, Ordering::Relaxed);
        }
    }
    let mut stats = ProjectionDrainStats {
        organizations: cursors.len(),
        ..Default::default()
    };

    for cursor in cursors {
        let organization_id = require_u64(&cursor, "organizationId")?;
        let available_next_sequence = require_u64(&cursor, "nextSequence")?;
        let next_sequence = next_projection_sequence(pool, organization_id).await?;
        if next_sequence >= available_next_sequence {
            continue;
        }
        let commit_rows = stdb
            .query_sql(&format!(
                "SELECT id, organization_id, sequence, operation_id, correlation_id, \
                        change_schema_version, contract_version, occurred_at, actor_identity, \
                        row_change_count, checksum \
                 FROM organization_commit \
                 WHERE organization_id = {organization_id} AND sequence = {next_sequence} \
                 LIMIT 1"
            ))
            .await
            .with_context(|| {
                format!("query organization {organization_id} commit {next_sequence}")
            })?;
        let Some(commit_row) = commit_rows.first() else {
            continue;
        };
        let commit = parse_commit(commit_row)?;
        if commit.organization_id != organization_id || commit.sequence != next_sequence {
            bail!("organization commit query returned a mismatched cursor scope");
        }
        let changes = stdb
            .query_sql(&format!(
                "SELECT id, organization_id, commit_sequence, ordinal, table_name, \
                        row_identity_json, change_kind, row_json, checksum \
                 FROM organization_row_change \
                 WHERE organization_id = {organization_id} \
                   AND commit_sequence = {next_sequence} \
                 ORDER BY ordinal ASC LIMIT {}",
                MAX_CHANGES_PER_COMMIT + 1
            ))
            .await
            .with_context(|| {
                format!("query organization {organization_id} commit {next_sequence} changes")
            })?;
        if changes.len() > MAX_CHANGES_PER_COMMIT {
            bail!(
                "organization {organization_id} commit {next_sequence} exceeds the bounded change limit"
            );
        }
        let changes = changes
            .iter()
            .map(parse_change)
            .collect::<Result<Vec<_>>>()?;
        match commit_projection::apply_commit(
            pool,
            PROJECTION_CODEC_MANIFEST_JSON,
            &commit,
            &changes,
        )
        .await
        .with_context(|| format!("apply organization {organization_id} commit {next_sequence}"))?
        {
            commit_projection::ProjectionResult::Applied => stats.commits += 1,
            commit_projection::ProjectionResult::AlreadyApplied => stats.already_applied += 1,
        }
    }

    Ok(stats)
}

fn require_server_identity(stdb: &StdbClient) -> Result<()> {
    if stdb.token().trim().is_empty() || stdb.token() == "local-dev-token" {
        bail!(
            "projection worker requires a configured STDB server/admin identity for private commit tables"
        );
    }
    Ok(())
}

async fn query_cursors(stdb: &StdbClient, scan_after: u64, batch_size: u32) -> Result<Vec<Value>> {
    stdb.query_sql(&format!(
        "SELECT organization_id, next_sequence \
         FROM organization_commit_cursor \
         WHERE organization_id > {scan_after} \
         ORDER BY organization_id ASC LIMIT {batch_size}"
    ))
    .await
    .context("query organization projection cursors")
}

async fn next_projection_sequence(pool: &Pool, organization_id: u64) -> Result<u64> {
    let client = pool
        .get()
        .await
        .context("get PG client for projection watermark")?;
    let organization_id = organization_id.to_string();
    let row = client
        .query_opt(
            "SELECT applied_sequence::TEXT \
             FROM organization_projection_watermark \
             WHERE organization_id = $1::NUMERIC",
            &[&organization_id],
        )
        .await
        .context("read organization projection watermark")?;
    row.map(|row| row.get::<_, String>(0).parse::<u64>())
        .transpose()
        .context("decode organization projection watermark")?
        .map_or(Ok(1), |sequence| {
            sequence
                .checked_add(1)
                .ok_or_else(|| anyhow!("organization projection sequence exhausted"))
        })
}

/// Parse and validate the generated projection artifact into safe relation
/// definitions. Only the closed set of codec PG types is accepted; arbitrary
/// manifest text can never become executable DDL.
fn parse_relations(manifest_json: &str) -> Result<Vec<ProjectionRelation>> {
    let manifest: Value =
        serde_json::from_str(manifest_json).context("parse projection codec manifest")?;
    if manifest.get("version").and_then(Value::as_u64) != Some(1) {
        bail!("projection codec manifest has unsupported version");
    }
    let tables = manifest
        .get("tables")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("projection codec manifest lacks tables"))?;
    let mut relations = Vec::with_capacity(tables.len());
    for (table, entry) in tables {
        let projection_table = entry
            .get("projection_table")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("projection table '{table}' lacks projection_table"))?;
        if projection_table != table {
            bail!("projection table '{table}' has mismatched projection_table");
        }
        let Some(organization_column) = entry.get("organization_column").and_then(Value::as_str)
        else {
            // Platform-global tables are present in the all-table artifact,
            // but organization commits must never provision or mutate them.
            continue;
        };
        if organization_column != "organization_id" {
            bail!("projection table '{table}' has unsupported organization column");
        }
        let primary_key = entry
            .get("primary_key")
            .and_then(|value| value.get("name"))
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("projection table '{table}' lacks primary key"))?;
        validate_identifier(table)?;
        validate_identifier(primary_key)?;
        let columns = entry
            .get("columns")
            .and_then(Value::as_array)
            .ok_or_else(|| anyhow!("projection table '{table}' lacks columns"))?;
        let mut parsed_columns = Vec::with_capacity(columns.len());
        for column in columns {
            let name = column
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("projection table '{table}' has an invalid column"))?;
            let pg_type = column
                .get("pg_type")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    anyhow!("projection table '{table}' column '{name}' lacks pg_type")
                })?;
            validate_identifier(name)?;
            validate_pg_type(pg_type)?;
            parsed_columns.push(ProjectionColumn {
                name: name.to_string(),
                pg_type: pg_type.to_string(),
                nullable: column
                    .get("nullable")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            });
        }
        if parsed_columns.is_empty()
            || !parsed_columns
                .iter()
                .any(|column| column.name == primary_key)
        {
            bail!("projection table '{table}' primary key is absent from columns");
        }
        if !parsed_columns
            .iter()
            .any(|column| column.name == organization_column)
        {
            bail!("projection table '{table}' organization column is absent from columns");
        }
        relations.push(ProjectionRelation {
            table: table.to_string(),
            primary_key: primary_key.to_string(),
            organization_column: organization_column.to_string(),
            columns: parsed_columns,
        });
    }
    relations.sort_by(|left, right| left.table.cmp(&right.table));
    Ok(relations)
}

/// Provision all organization-owned projection relations in one transaction.
pub async fn ensure_projection_relations(pool: &Pool, manifest_json: &str) -> Result<usize> {
    let relations = parse_relations(manifest_json)?;
    let mut client = pool
        .get()
        .await
        .context("get PG client for projection DDL")?;
    let transaction = client
        .transaction()
        .await
        .context("begin projection DDL transaction")?;
    for relation in &relations {
        let sql = render_relation_ddl(relation)?;
        transaction
            .batch_execute(&sql)
            .await
            .with_context(|| format!("provision projection relation {}", relation.table))?;
    }
    transaction
        .commit()
        .await
        .context("commit projection DDL transaction")?;
    Ok(relations.len())
}

fn render_relation_ddl(relation: &ProjectionRelation) -> Result<String> {
    let columns = relation
        .columns
        .iter()
        .map(|column| {
            Ok(format!(
                "{} {} {}",
                quote_identifier(&column.name)?,
                column.pg_type,
                if column.nullable { "" } else { "NOT NULL" }
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    let primary_key = quote_identifier(&relation.primary_key)?;
    let table = quote_identifier(&relation.table)?;
    let constraint = quote_identifier(&format!("{}_pkey", relation.table))?;
    let index = quote_identifier(&format!("{}_organization_id", relation.table))?;
    let organization_column = quote_identifier(&relation.organization_column)?;
    Ok(format!(
        "CREATE TABLE IF NOT EXISTS {table} (\n    {},\n    CONSTRAINT {constraint} PRIMARY KEY ({primary_key})\n);\nCREATE INDEX IF NOT EXISTS {index} ON {table} ({organization_column});",
        columns.join(",\n    "),
    ))
}

fn validate_identifier(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        bail!("unsafe projection identifier '{value}'");
    }
    Ok(())
}

fn quote_identifier(value: &str) -> Result<String> {
    validate_identifier(value)?;
    Ok(format!("\"{value}\""))
}

fn validate_pg_type(value: &str) -> Result<()> {
    if matches!(
        value,
        "NUMERIC(20,0)"
            | "BIGINT"
            | "INTEGER"
            | "DOUBLE PRECISION"
            | "REAL"
            | "BOOLEAN"
            | "TEXT"
            | "BYTEA"
            | "JSONB"
    ) {
        Ok(())
    } else {
        bail!("unsupported projection PG type '{value}'")
    }
}

fn require_u64(row: &Value, field: &str) -> Result<u64> {
    row.get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("projection {field}: expected u64"))
}

fn require_string(row: &Value, field: &str) -> Result<String> {
    row.get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("projection {field}: expected string"))
}

fn parse_timestamp(row: &Value) -> Result<i64> {
    row.get("microsSinceUnixEpoch")
        .and_then(Value::as_i64)
        .ok_or_else(|| anyhow!("projection occurredAt: expected microsSinceUnixEpoch"))
}

fn parse_identity(value: &Value) -> Result<String> {
    let raw = value
        .as_str()
        .or_else(|| value.get("__identity__").and_then(Value::as_str))
        .ok_or_else(|| anyhow!("projection actorIdentity: expected identity string"))?;
    let raw = raw.strip_prefix("0x").unwrap_or(raw);
    if raw.len() != 64 || !raw.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("projection actorIdentity: expected 32-byte hexadecimal identity");
    }
    Ok(raw.to_ascii_lowercase())
}

fn parse_commit(row: &Value) -> Result<commit_projection::OrganizationCommitEnvelope> {
    let row_change_count = u32::try_from(require_u64(row, "rowChangeCount")?)
        .context("decode projection rowChangeCount")?;
    Ok(commit_projection::OrganizationCommitEnvelope {
        id: require_string(row, "id")?,
        organization_id: require_u64(row, "organizationId")?,
        sequence: require_u64(row, "sequence")?,
        operation_id: require_string(row, "operationId")?,
        correlation_id: require_string(row, "correlationId")?,
        change_schema_version: u32::try_from(require_u64(row, "changeSchemaVersion")?)
            .context("decode projection changeSchemaVersion")?,
        contract_version: require_string(row, "contractVersion")?,
        occurred_at_micros: parse_timestamp(
            row.get("occurredAt")
                .ok_or_else(|| anyhow!("projection occurredAt is missing"))?,
        )?,
        actor_identity_hex: parse_identity(
            row.get("actorIdentity")
                .ok_or_else(|| anyhow!("projection actorIdentity is missing"))?,
        )?,
        row_change_count,
        checksum: require_string(row, "checksum")?,
    })
}

fn parse_change(row: &Value) -> Result<commit_projection::OrganizationRowChangeInput> {
    Ok(commit_projection::OrganizationRowChangeInput {
        id: require_string(row, "id")?,
        organization_id: require_u64(row, "organizationId")?,
        commit_sequence: require_u64(row, "commitSequence")?,
        ordinal: u32::try_from(require_u64(row, "ordinal")?)
            .context("decode projection ordinal")?,
        table_name: require_string(row, "tableName")?,
        row_identity_json: require_string(row, "rowIdentityJson")?,
        change_kind: require_string(row, "changeKind")?,
        row_json: row
            .get("rowJson")
            .and_then(Value::as_str)
            .map(str::to_owned),
        checksum: require_string(row, "checksum")?,
    })
}

/// Start the standalone projection worker service.
pub async fn serve() -> Result<()> {
    let config = Config::from_env()?;
    if config.stdb_server_token.is_none() {
        bail!(
            "projection worker requires STDB_SERVER_TOKEN to read private commit protocol tables"
        );
    }
    let poll_secs = std::env::var("LUMIERE_PROJECTION_WORKER_POLL_SECS")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(5u64);
    let batch = std::env::var("LUMIERE_PROJECTION_WORKER_BATCH")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(100u32);
    let port = std::env::var("LUMIERE_PROJECTION_WORKER_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8096u16);
    let state = Arc::new(AppState::new(config));
    let pg_config = pg_pool::PgConfig::from_env().context("PG config for projection worker")?;
    let pool = pg_pool::build_pool(&pg_config).context("build PG pool for projection worker")?;
    migrate::ensure_schema(&pool)
        .await
        .context("apply projection infrastructure schema")?;
    ensure_projection_relations(&pool, PROJECTION_CODEC_MANIFEST_JSON).await?;

    let ready = Arc::new(AtomicBool::new(false));
    let worker_ready = ready.clone();
    let worker_state = state;
    let worker_pool = pool;
    tokio::spawn(async move {
        loop {
            match drain_batch(&worker_state.stdb, &worker_pool, batch).await {
                Ok(stats) => {
                    worker_ready.store(true, Ordering::Relaxed);
                    if stats.commits > 0 || stats.already_applied > 0 {
                        tracing::info!(?stats, "projection worker batch complete");
                    }
                }
                Err(error) => {
                    worker_ready.store(false, Ordering::Relaxed);
                    tracing::error!(%error, "projection worker batch failed");
                }
            }
            tokio::time::sleep(Duration::from_secs(poll_secs)).await;
        }
    });
    let app = Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .route(
            "/health/ready",
            get(move || {
                let ready = ready.clone();
                async move {
                    if ready.load(Ordering::Relaxed) {
                        StatusCode::OK
                    } else {
                        StatusCode::SERVICE_UNAVAILABLE
                    }
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await?;
    tracing::info!(port, "projection worker listening");
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manifest() -> String {
        json!({
            "version": 1,
            "tables": {
                "parent": {
                    "projection_table": "parent",
                    "primary_key": {"name": "id", "type": "U64"},
                    "organization_column": "organization_id",
                    "columns": [
                        {"name":"id", "pg_type":"NUMERIC(20,0)", "nullable":false},
                        {"name":"organization_id", "pg_type":"NUMERIC(20,0)", "nullable":false}
                    ]
                }
            }
        })
        .to_string()
    }

    #[test]
    fn parses_and_sorts_safe_projection_relations() {
        let relations = parse_relations(&manifest()).unwrap();
        assert_eq!(relations[0].table, "parent");
        assert_eq!(relations[0].primary_key, "id");
        assert_eq!(relations[0].organization_column, "organization_id");
    }

    #[test]
    fn renders_quoted_organization_projection_ddl() {
        let relation = parse_relations(&manifest()).unwrap().remove(0);
        let ddl = render_relation_ddl(&relation).unwrap();
        assert!(ddl.contains("CREATE TABLE IF NOT EXISTS \"parent\""));
        assert!(ddl.contains("\"organization_id\" NUMERIC(20,0) NOT NULL"));
        assert!(ddl.contains("PRIMARY KEY (\"id\")"));
        assert!(ddl.contains("CREATE INDEX IF NOT EXISTS \"parent_organization_id\""));
    }

    #[test]
    fn parses_commit_wire_shape_without_coercing_fields() {
        let row = json!({
            "id": "7:1",
            "organizationId": 7,
            "sequence": 1,
            "operationId": "erp.create_task",
            "correlationId": "request-1",
            "changeSchemaVersion": 1,
            "contractVersion": "ir-v2",
            "occurredAt": {"microsSinceUnixEpoch": 12},
            "actorIdentity": "0x".to_string() + &"ab".repeat(32),
            "rowChangeCount": 1,
            "checksum": "a".repeat(64)
        });
        let commit = parse_commit(&row).unwrap();
        assert_eq!(commit.organization_id, 7);
        assert_eq!(commit.sequence, 1);
        assert_eq!(commit.occurred_at_micros, 12);
        assert_eq!(commit.actor_identity_hex, "ab".repeat(32));
    }

    #[test]
    fn rejects_identifier_and_type_injection() {
        let mut value: Value = serde_json::from_str(&manifest()).unwrap();
        value["tables"]["parent"]["columns"][0]["pg_type"] =
            Value::String("TEXT; DROP TABLE parent".into());
        assert!(parse_relations(&value.to_string()).is_err());

        let mut value: Value = serde_json::from_str(&manifest()).unwrap();
        value["tables"]["parent"]["projection_table"] = Value::String("parent;drop".into());
        assert!(parse_relations(&value.to_string()).is_err());
    }
}
