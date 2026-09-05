//! PostgreSQL reconstruction source.

use super::super::pg_codec;
use super::catalog::RestoreTable;
use super::integrity::{canonical_checksum, digest_rows, identity_text, quote_identifier};
use super::protocol::{DurableWatermark, ReconstructionSource, RestoreRow, TableDigest};
use super::{MAX_BATCH_SIZE, MAX_DIGEST_ROWS};
use anyhow::{anyhow, bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::{json, Value};

/// Durable reconstruction reader. Every relation and column is resolved from
/// the pinned generated manifests; callers cannot select SQL identifiers.
#[derive(Clone)]
pub struct PgReconstructionSource {
    pool: Pool,
}

impl PgReconstructionSource {
    #[must_use]
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    fn columns(&self, table: &RestoreTable) -> Result<Vec<pg_codec::ColumnCodec>> {
        pg_codec::load_columns(
            lumiere_contracts::manifests::PROJECTION_CODEC_MANIFEST,
            &table.table,
        )
        .with_context(|| format!("load generated codec for '{}'", table.table))
    }
}

impl ReconstructionSource for PgReconstructionSource {
    async fn declared_watermark(&self, organization_id: u64) -> Result<DurableWatermark> {
        let client = self
            .pool
            .get()
            .await
            .context("get PG reconstruction client")?;
        let organization_id = organization_id.to_string();
        let row = client
            .query_opt(
                "SELECT applied_sequence::TEXT, commit_checksum FROM organization_projection_watermark WHERE organization_id = $1::TEXT::NUMERIC",
                &[&organization_id],
            )
            .await
            .context("read durable reconstruction watermark")?
            .ok_or_else(|| anyhow!("organization has no durable projection watermark"))?;
        Ok(DurableWatermark {
            sequence: row
                .get::<_, String>(0)
                .parse()
                .context("decode durable reconstruction sequence")?,
            commit_checksum: row.get(1),
        })
    }

    async fn load_batch(
        &self,
        organization_id: u64,
        watermark: &DurableWatermark,
        table: &RestoreTable,
        after_identity: Option<&Value>,
        limit: u32,
    ) -> Result<Vec<RestoreRow>> {
        if !(1..=MAX_BATCH_SIZE).contains(&limit) {
            bail!("PG reconstruction batch limit is out of bounds");
        }
        let columns = self.columns(table)?;
        let primary = columns
            .iter()
            .find(|column| column.name == table.primary_key)
            .ok_or_else(|| anyhow!("generated codec lacks reconstruction primary key"))?;
        let projection = pg_codec::projection_with_pg_casts(&columns)
            .into_iter()
            .map(|column| {
                let (name, suffix) = column.split_once("::").unwrap_or((&column, ""));
                if suffix.is_empty() {
                    quote_identifier(name)
                } else {
                    format!("{}::{suffix}", quote_identifier(name))
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        let organization_id_text = organization_id.to_string();
        let after_text = after_identity
            .map(|identity| identity_text(identity, &table.primary_key))
            .transpose()?;
        let comparison = match (after_text.as_ref(), primary.pg_type.as_str()) {
            (None, _) => String::new(),
            (Some(_), "NUMERIC(20,0)") => {
                format!(
                    " AND {} > $2::TEXT::NUMERIC",
                    quote_identifier(&table.primary_key)
                )
            }
            (Some(_), "TEXT") => format!(" AND {} > $2", quote_identifier(&table.primary_key)),
            (Some(_), other) => bail!("unsupported reconstruction primary key type '{other}'"),
        };
        let sql = format!(
            "SELECT {projection} FROM {table_name} WHERE {organization_column} = $1::TEXT::NUMERIC{comparison} ORDER BY {primary_key} ASC LIMIT {limit}",
            table_name = quote_identifier(&table.table),
            organization_column = quote_identifier(&table.organization_column),
            primary_key = quote_identifier(&table.primary_key),
        );
        let client = self
            .pool
            .get()
            .await
            .context("get PG reconstruction client")?;
        let rows = if let Some(after) = after_text.as_ref() {
            client.query(&sql, &[&organization_id_text, after]).await
        } else {
            client.query(&sql, &[&organization_id_text]).await
        }
        .with_context(|| format!("read durable reconstruction table '{}'", table.table))?;
        ensure_watermark(self, organization_id, watermark).await?;
        rows.iter()
            .map(|row| {
                let value = pg_codec::row_to_hot_json(&columns, row)?;
                let primary_json = value
                    .get(pg_codec::snake_to_camel(&table.primary_key))
                    .cloned()
                    .ok_or_else(|| anyhow!("decoded reconstruction row lacks primary key"))?;
                Ok(RestoreRow {
                    identity: json!({ table.primary_key.clone(): primary_json }),
                    checksum: canonical_checksum(&value)?,
                    row: value,
                })
            })
            .collect()
    }

    async fn table_digest(
        &self,
        organization_id: u64,
        watermark: &DurableWatermark,
        table: &RestoreTable,
    ) -> Result<TableDigest> {
        let rows = load_all_pg_rows(self, organization_id, watermark, table).await?;
        digest_rows(&rows)
    }
}

async fn ensure_watermark(
    source: &PgReconstructionSource,
    organization_id: u64,
    expected: &DurableWatermark,
) -> Result<()> {
    if source.declared_watermark(organization_id).await? != *expected {
        bail!("durable watermark changed during reconstruction");
    }
    Ok(())
}

async fn load_all_pg_rows(
    source: &PgReconstructionSource,
    organization_id: u64,
    watermark: &DurableWatermark,
    table: &RestoreTable,
) -> Result<Vec<Value>> {
    let mut values = Vec::new();
    let mut after = None;
    loop {
        let batch = source
            .load_batch(
                organization_id,
                watermark,
                table,
                after.as_ref(),
                MAX_BATCH_SIZE,
            )
            .await?;
        if values.len() + batch.len() > MAX_DIGEST_ROWS {
            bail!("PG reconstruction digest exceeds bounded row limit");
        }
        let is_last = batch.len() < MAX_BATCH_SIZE as usize;
        after = batch.last().map(|row| row.identity.clone());
        values.extend(batch.into_iter().map(|row| row.row));
        if is_last {
            break;
        }
    }
    Ok(values)
}
