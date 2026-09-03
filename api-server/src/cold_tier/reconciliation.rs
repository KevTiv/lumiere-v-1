//! Deterministic PostgreSQL/STDB reconciliation at one organization watermark.
//!
//! This is an operator boundary, not a general query endpoint. Relations and
//! columns come exclusively from the generated projection codec manifest. The
//! command first proves that PostgreSQL and the fenced STDB organization are at
//! the caller-declared watermark, then compares every projected column of every
//! organization-owned relation. Consequently deletes, relation identifiers,
//! totals, audit links, row versions, and idempotency keys are covered without
//! maintaining a second hand-written field list.

use anyhow::{anyhow, bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use stdb_client::StdbClient;

use super::pg_codec::{self, ColumnCodec};

const PROJECTION_CODEC_MANIFEST_JSON: &str =
    lumiere_contracts::manifests::PROJECTION_CODEC_MANIFEST;
const RECONSTRUCTION_MANIFEST_JSON: &str = lumiere_contracts::manifests::RECONSTRUCTION_MANIFEST;
const MAX_ROWS_PER_TABLE: usize = 100_000;

#[derive(Debug, Clone)]
struct ReconciliationRelation {
    table: String,
    primary_key: String,
    organization_column: String,
    columns: Vec<ColumnCodec>,
}

/// One deterministic table comparison. A differing count proves an insert or
/// delete mismatch; equal counts with differing checksums prove a field-level
/// mismatch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableReconciliation {
    pub table: String,
    pub postgres_count: usize,
    pub stdb_count: usize,
    pub postgres_checksum: String,
    pub stdb_checksum: String,
}

impl TableReconciliation {
    #[must_use]
    pub fn matches(&self) -> bool {
        self.postgres_count == self.stdb_count && self.postgres_checksum == self.stdb_checksum
    }
}

/// Complete result for one fenced organization at an exact durable sequence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrganizationReconciliation {
    pub organization_id: u64,
    pub watermark: u64,
    pub tables: Vec<TableReconciliation>,
}

impl OrganizationReconciliation {
    #[must_use]
    pub fn matches(&self) -> bool {
        self.tables.iter().all(TableReconciliation::matches)
    }

    #[must_use]
    pub fn mismatches(&self) -> Vec<&TableReconciliation> {
        self.tables
            .iter()
            .filter(|table| !table.matches())
            .collect()
    }
}

/// Compare the durable PostgreSQL projection with the active STDB rows at an
/// exact declared watermark.
///
/// Writers must already be fenced by the reconstruction coordinator. This
/// function enforces the observable half of that contract by rejecting a STDB
/// head or PostgreSQL watermark that differs from `watermark`; it never
/// silently compares state from two different sequences.
pub async fn reconcile_organization(
    stdb: &StdbClient,
    pool: &Pool,
    organization_id: u64,
    watermark: u64,
) -> Result<OrganizationReconciliation> {
    require_server_identity(stdb)?;
    verify_declared_watermark(stdb, pool, organization_id, watermark).await?;

    let relations = load_relations(PROJECTION_CODEC_MANIFEST_JSON, RECONSTRUCTION_MANIFEST_JSON)?;
    let client = pool
        .get()
        .await
        .context("get PG client for organization reconciliation")?;
    let organization_text = organization_id.to_string();
    let mut tables = Vec::with_capacity(relations.len());

    for relation in relations {
        let projection = relation
            .columns
            .iter()
            .map(|column| {
                let name = quote_identifier(&column.name);
                match column.pg_type.as_str() {
                    "NUMERIC(20,0)" | "JSONB" => format!("{name}::TEXT"),
                    _ => name,
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        let pg_table = quote_identifier(&relation.table);
        let pg_organization_column = quote_identifier(&relation.organization_column);
        let pg_primary_key = quote_identifier(&relation.primary_key);
        let pg_sql = format!(
            "SELECT {projection} FROM {table} WHERE {organization_column} = \
             $1::TEXT::NUMERIC ORDER BY {primary_key} ASC LIMIT {limit}",
            table = pg_table,
            organization_column = pg_organization_column,
            primary_key = pg_primary_key,
            limit = MAX_ROWS_PER_TABLE + 1,
        );
        let pg_rows = client
            .query(&pg_sql, &[&organization_text])
            .await
            .with_context(|| format!("read PG reconciliation relation '{}'", relation.table))?;
        if pg_rows.len() > MAX_ROWS_PER_TABLE {
            bail!(
                "PG reconciliation relation '{}' exceeds the bounded row limit {}",
                relation.table,
                MAX_ROWS_PER_TABLE
            );
        }
        let pg_values = pg_rows
            .iter()
            .map(|row| pg_codec::row_to_hot_json(&relation.columns, row))
            .collect::<Result<Vec<_>>>()?;

        let stdb_projection = relation
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let stdb_sql = format!(
            "SELECT {stdb_projection} FROM `{table}` WHERE {organization_column} = \
             {organization_id} ORDER BY {primary_key} ASC LIMIT {limit}",
            table = relation.table,
            organization_column = relation.organization_column,
            primary_key = relation.primary_key,
            limit = MAX_ROWS_PER_TABLE + 1,
        );
        let stdb_values = stdb
            .query_sql(&stdb_sql)
            .await
            .with_context(|| format!("read STDB reconciliation relation '{}'", relation.table))?;
        if stdb_values.len() > MAX_ROWS_PER_TABLE {
            bail!(
                "STDB reconciliation relation '{}' exceeds the bounded row limit {}",
                relation.table,
                MAX_ROWS_PER_TABLE
            );
        }

        tables.push(compare_rows(&relation.table, &pg_values, &stdb_values)?);
    }

    Ok(OrganizationReconciliation {
        organization_id,
        watermark,
        tables,
    })
}

async fn verify_declared_watermark(
    stdb: &StdbClient,
    pool: &Pool,
    organization_id: u64,
    watermark: u64,
) -> Result<()> {
    let client = pool
        .get()
        .await
        .context("get PG client for reconciliation watermark")?;
    let organization_text = organization_id.to_string();
    let pg_row = client
        .query_opt(
            "SELECT applied_sequence::TEXT FROM organization_projection_watermark \
             WHERE organization_id = $1::TEXT::NUMERIC",
            &[&organization_text],
        )
        .await
        .context("read PG reconciliation watermark")?
        .ok_or_else(|| anyhow!("organization {organization_id} has no PG projection watermark"))?;
    let pg_watermark = pg_row
        .get::<_, String>(0)
        .parse::<u64>()
        .context("decode PG reconciliation watermark")?;
    if pg_watermark != watermark {
        bail!("declared watermark {watermark} does not match PG watermark {pg_watermark}");
    }

    let cursor_rows = stdb
        .query_sql(&format!(
            "SELECT next_sequence FROM organization_commit_cursor \
             WHERE organization_id = {organization_id} LIMIT 1"
        ))
        .await
        .context("read STDB reconciliation watermark")?;
    let next_sequence = cursor_rows
        .first()
        .and_then(|row| row.get("nextSequence"))
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("organization {organization_id} has no valid STDB commit cursor"))?;
    let stdb_watermark = next_sequence.checked_sub(1).ok_or_else(|| {
        anyhow!("organization {organization_id} has an invalid zero next sequence")
    })?;
    if stdb_watermark != watermark {
        bail!(
            "declared watermark {watermark} does not match STDB watermark {stdb_watermark}; writers must remain fenced"
        );
    }
    Ok(())
}

fn load_relations(
    manifest_json: &str,
    reconstruction_manifest_json: &str,
) -> Result<Vec<ReconciliationRelation>> {
    let manifest: Value =
        serde_json::from_str(manifest_json).context("parse generated projection codec manifest")?;
    if manifest["checksum_algo"].as_str() != Some("sha256")
        || manifest["canonical_serialization"].as_str() != Some("json_sorted_keys_no_whitespace")
    {
        bail!("unsupported projection codec checksum contract");
    }
    let tables = manifest["tables"]
        .as_object()
        .ok_or_else(|| anyhow!("projection codec manifest has no tables"))?;
    let reconstruction: Value = serde_json::from_str(reconstruction_manifest_json)
        .context("parse generated reconstruction manifest")?;
    let recreated = reconstruction["recreate_order"]
        .as_array()
        .ok_or_else(|| anyhow!("reconstruction manifest has no recreate_order"))?
        .iter()
        .map(|table| {
            table
                .as_str()
                .ok_or_else(|| anyhow!("reconstruction recreate table must be a string"))
        })
        .collect::<Result<std::collections::BTreeSet<_>>>()?;
    let mut relations = Vec::with_capacity(tables.len());
    for (table, metadata) in tables {
        validate_identifier(table)?;
        if recreated.contains(table.as_str()) {
            continue;
        }
        // This is deliberately an organization command. Global platform
        // tables have no organization column and belong to a separate restore
        // scope; including them here would compare unrelated tenants.
        let Some(organization_column) = metadata["organization_column"].as_str() else {
            continue;
        };
        let primary_key = metadata["primary_key"]["name"]
            .as_str()
            .ok_or_else(|| anyhow!("projection relation '{table}' has no primary key"))?;
        validate_identifier(organization_column)?;
        validate_identifier(primary_key)?;
        let columns = pg_codec::load_columns(manifest_json, table)?;
        if !columns
            .iter()
            .any(|column| column.name == organization_column)
            || !columns.iter().any(|column| column.name == primary_key)
        {
            bail!("projection relation '{table}' has invalid scope or primary-key metadata");
        }
        for column in &columns {
            validate_identifier(&column.name)?;
        }
        relations.push(ReconciliationRelation {
            table: table.clone(),
            primary_key: primary_key.to_owned(),
            organization_column: organization_column.to_owned(),
            columns,
        });
    }
    relations.sort_by(|left, right| left.table.cmp(&right.table));
    Ok(relations)
}

fn compare_rows(table: &str, postgres: &[Value], stdb: &[Value]) -> Result<TableReconciliation> {
    Ok(TableReconciliation {
        table: table.to_owned(),
        postgres_count: postgres.len(),
        stdb_count: stdb.len(),
        postgres_checksum: rows_checksum(postgres)?,
        stdb_checksum: rows_checksum(stdb)?,
    })
}

fn rows_checksum(rows: &[Value]) -> Result<String> {
    let mut canonical_rows = rows
        .iter()
        .map(canonical_json)
        .collect::<Result<Vec<_>>>()?;
    canonical_rows.sort();
    let mut digest = Sha256::new();
    for row in canonical_rows {
        digest.update(row.as_bytes());
        digest.update(b"\n");
    }
    Ok(hex::encode(digest.finalize()))
}

fn canonical_json(value: &Value) -> Result<String> {
    serde_json::to_string(&canonical_value(value)).context("serialize canonical reconciliation row")
}

fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut canonical = Map::new();
            for key in keys {
                canonical.insert(key.clone(), canonical_value(&object[key]));
            }
            Value::Object(canonical)
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical_value).collect()),
        other => other.clone(),
    }
}

fn validate_identifier(identifier: &str) -> Result<()> {
    let mut chars = identifier.chars();
    if !matches!(chars.next(), Some('a'..='z'))
        || !chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
    {
        bail!("generated projection identifier '{identifier}' is unsafe");
    }
    Ok(())
}

fn quote_identifier(identifier: &str) -> String {
    debug_assert!(validate_identifier(identifier).is_ok());
    format!("\"{identifier}\"")
}

fn require_server_identity(stdb: &StdbClient) -> Result<()> {
    if stdb.token().trim().is_empty() || stdb.token() == "local-dev-token" {
        bail!("reconciliation requires a configured STDB server/admin identity");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn generated_manifest_produces_closed_sorted_relation_plan() {
        let relations =
            load_relations(PROJECTION_CODEC_MANIFEST_JSON, RECONSTRUCTION_MANIFEST_JSON).unwrap();
        let reconstruction: Value = serde_json::from_str(RECONSTRUCTION_MANIFEST_JSON).unwrap();
        assert_eq!(
            relations.len(),
            reconstruction["tables"].as_array().unwrap().len()
        );
        assert!(relations
            .windows(2)
            .all(|pair| pair[0].table < pair[1].table));
        assert!(relations.iter().all(|relation| {
            relation
                .columns
                .iter()
                .any(|column| column.name == relation.organization_column)
        }));
        assert!(!relations.iter().any(|relation| {
            matches!(
                relation.table.as_str(),
                "organization_reconstruction_fence" | "organization_reconstruction_batch_receipt"
            )
        }));
    }

    #[test]
    fn canonical_checksum_ignores_object_and_row_order() {
        let left = vec![
            json!({"id": 2, "nested": {"b": 2, "a": 1}}),
            json!({"id": 1}),
        ];
        let right = vec![
            json!({"id": 1}),
            json!({"nested": {"a": 1, "b": 2}, "id": 2}),
        ];
        assert_eq!(
            rows_checksum(&left).unwrap(),
            rows_checksum(&right).unwrap()
        );
    }

    #[test]
    fn checksum_detects_same_count_field_mismatch() {
        let result = compare_rows(
            "pos_order",
            &[json!({"id": 7, "organizationId": 2, "total": 100})],
            &[json!({"id": 7, "organizationId": 2, "total": 99})],
        )
        .unwrap();
        assert!(!result.matches());
        assert_eq!(result.postgres_count, result.stdb_count);
    }

    #[test]
    fn count_detects_delete_mismatch() {
        let result = compare_rows(
            "audit_log",
            &[json!({"id": 1}), json!({"id": 2})],
            &[json!({"id": 1})],
        )
        .unwrap();
        assert!(!result.matches());
        assert_eq!(result.postgres_count, 2);
        assert_eq!(result.stdb_count, 1);
    }

    #[test]
    fn organization_result_reports_only_mismatches() {
        let matching = compare_rows("company", &[json!({"id": 1})], &[json!({"id": 1})]).unwrap();
        let differing = compare_rows("sale_order", &[json!({"id": 2})], &[]).unwrap();
        let result = OrganizationReconciliation {
            organization_id: 42,
            watermark: 9,
            tables: vec![matching, differing],
        };
        assert!(!result.matches());
        assert_eq!(result.mismatches().len(), 1);
        assert_eq!(result.mismatches()[0].table, "sale_order");
    }

    #[test]
    fn unsafe_manifest_identifier_is_rejected() {
        let manifest = r#"{
            "checksum_algo":"sha256",
            "canonical_serialization":"json_sorted_keys_no_whitespace",
            "tables":{"safe;drop":{"organization_column":"organization_id","primary_key":{"name":"id"},"columns":[]}}
        }"#;
        assert!(load_relations(manifest, RECONSTRUCTION_MANIFEST_JSON)
            .unwrap_err()
            .to_string()
            .contains("unsafe"));
    }
}
