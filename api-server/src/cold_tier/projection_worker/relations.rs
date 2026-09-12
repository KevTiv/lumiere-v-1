//! Projection relation metadata and safe PostgreSQL DDL.

use crate::cold_tier::conventions::{quote_identifier, validate_identifier};
use anyhow::{anyhow, bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProjectionRelation {
    pub(super) table: String,
    pub(super) primary_key: String,
    pub(super) organization_column: String,
    columns: Vec<ProjectionColumn>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProjectionColumn {
    name: String,
    pg_type: String,
    nullable: bool,
}
/// Parse and validate the generated projection artifact into safe relation
/// definitions. Only the closed set of codec PG types is accepted; arbitrary
/// manifest text can never become executable DDL.
pub(super) fn parse_relations(manifest_json: &str) -> Result<Vec<ProjectionRelation>> {
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
        let projection_mode = entry
            .get("projection_mode")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("projection table '{table}' lacks projection_mode"))?;
        if matches!(projection_mode, "snapshot" | "external-reference") {
            // Snapshot and external-reference tables are intentionally not
            // commit-projected; their source of truth has a separate owner.
            continue;
        }
        if !matches!(projection_mode, "upsert-current" | "append-history") {
            bail!("projection table '{table}' has unsupported projection_mode '{projection_mode}'");
        }
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

pub(super) fn render_relation_ddl(relation: &ProjectionRelation) -> Result<String> {
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
