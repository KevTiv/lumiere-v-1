//! Bounded, fenced, idempotent organization reconstruction orchestration.
//!
//! PostgreSQL is the durable source, while typed sink adapters keep
//! SpacetimeDB as the only writable business-state engine. No caller-selected
//! relation, reducer, SQL, or row payload crosses this boundary.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{anyhow, bail, Context, Result};
use deadpool_postgres::Pool;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use stdb_client::{ReducerCall, StdbClient};

use super::{pg_codec, reconciliation};

pub const RECONSTRUCTION_MANIFEST_JSON: &str =
    lumiere_contracts::manifests::RECONSTRUCTION_MANIFEST;
const MAX_BATCH_SIZE: u32 = 256;
const MAX_DIGEST_ROWS: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DurableWatermark {
    pub sequence: u64,
    pub commit_checksum: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RestoreRow {
    pub identity: Value,
    pub row: Value,
    pub checksum: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RestoreTable {
    pub table: String,
    pub module: String,
    pub state_class: String,
    pub required_for_activation: bool,
    pub restore_order: u32,
    pub dependencies: Vec<String>,
    pub primary_key: String,
    pub organization_column: String,
    pub projection_mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoreCatalog(Vec<RestoreTable>);

#[derive(Deserialize)]
struct Manifest {
    version: u64,
    tables: Vec<RestoreTable>,
}

impl RestoreCatalog {
    /// Parse generated/reviewed metadata. Unknown fields are tolerated, but
    /// all recovery-critical fields are mandatory through `RestoreTable`.
    pub fn from_manifest(json: &str) -> Result<Self> {
        let mut manifest: Manifest =
            serde_json::from_str(json).context("parse reconstruction manifest")?;
        if manifest.version != 1 || manifest.tables.is_empty() {
            bail!("reconstruction manifest has unsupported version or no tables");
        }
        let mut names = BTreeSet::new();
        let mut orders = BTreeSet::new();
        for table in &manifest.tables {
            for (label, value) in [
                ("table", table.table.as_str()),
                ("module", table.module.as_str()),
                ("primary key", table.primary_key.as_str()),
            ] {
                validate_identifier(label, value)?;
            }
            if table.organization_column != "organization_id"
                || !matches!(
                    table.projection_mode.as_str(),
                    "upsert-current" | "append-history"
                )
            {
                bail!(
                    "reconstruction table '{}' has unsupported ownership or projection mode",
                    table.table
                );
            }
            if !names.insert(table.table.clone()) || !orders.insert(table.restore_order) {
                bail!("duplicate reconstruction table or restore order");
            }
        }
        let order: BTreeMap<_, _> = manifest
            .tables
            .iter()
            .map(|table| (table.table.as_str(), table.restore_order))
            .collect();
        for table in &manifest.tables {
            for dependency in &table.dependencies {
                if !matches!(
                    order.get(dependency.as_str()),
                    Some(value) if *value < table.restore_order
                ) {
                    bail!(
                        "reconstruction dependency '{dependency}' must precede '{}'",
                        table.table
                    );
                }
            }
        }
        manifest.tables.sort_by_key(|table| table.restore_order);
        Ok(Self(manifest.tables))
    }

    pub fn generated() -> Result<Self> {
        Self::from_manifest(RECONSTRUCTION_MANIFEST_JSON)
    }

    pub fn tables(&self) -> &[RestoreTable] {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableDigest {
    pub row_count: u64,
    pub checksum: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconstructionFence {
    pub token: String,
    pub organization_id: u64,
    pub watermark: DurableWatermark,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconstructionReport {
    pub organization_id: u64,
    pub watermark: DurableWatermark,
    pub restored_tables: usize,
    pub restored_rows: u64,
}

#[allow(async_fn_in_trait)]
pub trait ReconstructionSource {
    async fn declared_watermark(&self, organization_id: u64) -> Result<DurableWatermark>;
    async fn load_batch(
        &self,
        organization_id: u64,
        watermark: &DurableWatermark,
        table: &RestoreTable,
        after_identity: Option<&Value>,
        limit: u32,
    ) -> Result<Vec<RestoreRow>>;
    async fn table_digest(
        &self,
        organization_id: u64,
        watermark: &DurableWatermark,
        table: &RestoreTable,
    ) -> Result<TableDigest>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyDisposition {
    Applied,
    AlreadyApplied,
}

#[allow(async_fn_in_trait)]
pub trait ReconstructionSink {
    async fn acquire_fence(
        &self,
        organization_id: u64,
        watermark: &DurableWatermark,
    ) -> Result<ReconstructionFence>;
    async fn apply_batch(
        &self,
        fence: &ReconstructionFence,
        table: &RestoreTable,
        batch_ordinal: u64,
        is_last_batch: bool,
        rows: &[RestoreRow],
    ) -> Result<ApplyDisposition>;
    async fn table_digest(
        &self,
        fence: &ReconstructionFence,
        table: &RestoreTable,
    ) -> Result<TableDigest>;
    async fn verify_before_release(&self, fence: &ReconstructionFence) -> Result<()>;
    async fn release_fence(&self, fence: &ReconstructionFence) -> Result<()>;
}

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

/// Trusted STDB reconstruction adapter. It owns the server identity and the
/// run identity used by every reducer call.
pub struct StdbReconstructionSink<'a> {
    stdb: &'a StdbClient,
    pool: &'a Pool,
    run_id: String,
    placement_generation: u64,
    fence_acquired: AtomicBool,
}

impl<'a> StdbReconstructionSink<'a> {
    pub fn new(
        stdb: &'a StdbClient,
        pool: &'a Pool,
        run_id: impl Into<String>,
        placement_generation: u64,
    ) -> Result<Self> {
        require_server_identity(stdb)?;
        let run_id = run_id.into();
        validate_run_id(&run_id)?;
        if placement_generation == 0 {
            bail!("reconstruction placement generation must be non-zero");
        }
        Ok(Self {
            stdb,
            pool,
            run_id,
            placement_generation,
            fence_acquired: AtomicBool::new(false),
        })
    }

    #[must_use]
    pub fn has_acquired_fence(&self) -> bool {
        self.fence_acquired.load(Ordering::Acquire)
    }

    pub async fn mark_failed(&self, organization_id: u64, error: &anyhow::Error) -> Result<()> {
        let mut failure = format!("{error:#}");
        if failure.len() > 1024 {
            let mut end = 1024;
            while !failure.is_char_boundary(end) {
                end -= 1;
            }
            failure.truncate(end);
        }
        self.call(
            "fail_organization_reconstruction",
            json!([organization_id, self.run_id, failure]),
        )
        .await
    }

    async fn call(&self, reducer: &str, args: Value) -> Result<()> {
        self.stdb
            .call_reducer(ReducerCall::from_name(reducer, args))
            .await
            .with_context(|| format!("call trusted reconstruction reducer '{reducer}'"))
    }
}

impl ReconstructionSink for StdbReconstructionSink<'_> {
    async fn acquire_fence(
        &self,
        organization_id: u64,
        watermark: &DurableWatermark,
    ) -> Result<ReconstructionFence> {
        self.call(
            "begin_organization_reconstruction",
            json!([
                organization_id,
                self.run_id,
                self.placement_generation,
                watermark.sequence
            ]),
        )
        .await?;
        self.fence_acquired.store(true, Ordering::Release);
        Ok(ReconstructionFence {
            token: self.run_id.clone(),
            organization_id,
            watermark: watermark.clone(),
        })
    }

    async fn apply_batch(
        &self,
        fence: &ReconstructionFence,
        table: &RestoreTable,
        batch_ordinal: u64,
        is_last_batch: bool,
        rows: &[RestoreRow],
    ) -> Result<ApplyDisposition> {
        let rows_json = rows
            .iter()
            .map(|row| canonical_json(&row.row))
            .collect::<Result<Vec<_>>>()?;
        self.call(
            "apply_organization_reconstruction_batch",
            json!([
                fence.organization_id,
                fence.token,
                table.table,
                table.restore_order,
                batch_ordinal,
                is_last_batch,
                rows_json
            ]),
        )
        .await?;
        Ok(ApplyDisposition::Applied)
    }

    async fn table_digest(
        &self,
        fence: &ReconstructionFence,
        table: &RestoreTable,
    ) -> Result<TableDigest> {
        let columns = pg_codec::load_columns(
            lumiere_contracts::manifests::PROJECTION_CODEC_MANIFEST,
            &table.table,
        )?;
        let projection = columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT {projection} FROM `{}` WHERE {} = {} ORDER BY {} ASC LIMIT {}",
            table.table,
            table.organization_column,
            fence.organization_id,
            table.primary_key,
            MAX_DIGEST_ROWS + 1,
        );
        let rows = self.stdb.query_sql(&sql).await?;
        if rows.len() > MAX_DIGEST_ROWS {
            bail!("STDB reconstruction digest exceeds bounded row limit");
        }
        digest_rows(&rows)
    }

    async fn verify_before_release(&self, fence: &ReconstructionFence) -> Result<()> {
        let report = reconciliation::reconcile_organization(
            self.stdb,
            self.pool,
            fence.organization_id,
            fence.watermark.sequence,
        )
        .await
        .context("reconcile reconstructed organization before releasing fence")?;
        if !report.matches() {
            let mismatches = report
                .mismatches()
                .into_iter()
                .map(|table| table.table.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            bail!("reconstruction reconciliation mismatch: {mismatches}");
        }
        Ok(())
    }

    async fn release_fence(&self, fence: &ReconstructionFence) -> Result<()> {
        self.call(
            "complete_organization_reconstruction",
            json!([
                fence.organization_id,
                fence.token,
                self.placement_generation,
                fence.watermark.sequence
            ]),
        )
        .await
    }
}

/// Execute one complete durable reconstruction. Any failure after fence
/// acquisition is persisted as a failed fence; completion happens only after
/// whole-organization PG/STDB reconciliation succeeds.
pub async fn reconstruct_organization_once(
    stdb: &StdbClient,
    pool: &Pool,
    organization_id: u64,
    requested: DurableWatermark,
    run_id: impl Into<String>,
    placement_generation: u64,
) -> Result<ReconstructionReport> {
    let source = PgReconstructionSource::new(pool.clone());
    let sink = StdbReconstructionSink::new(stdb, pool, run_id, placement_generation)?;
    let catalog = RestoreCatalog::generated()?;
    match reconstruct_organization(
        &source,
        &sink,
        &catalog,
        organization_id,
        requested,
        MAX_BATCH_SIZE,
    )
    .await
    {
        Ok(report) => Ok(report),
        Err(error) => {
            if sink.has_acquired_fence() {
                if let Err(mark_error) = sink.mark_failed(organization_id, &error).await {
                    return Err(error.context(format!(
                        "also failed to persist reconstruction fence failure: {mark_error:#}"
                    )));
                }
            }
            Err(error)
        }
    }
}

/// Restore an organization at exactly the requested durable watermark.
/// Failures intentionally retain the writer fence. Exact retries are safe
/// because the sink owns idempotent batch application.
pub async fn reconstruct_organization<S: ReconstructionSource, T: ReconstructionSink>(
    source: &S,
    sink: &T,
    catalog: &RestoreCatalog,
    organization_id: u64,
    requested: DurableWatermark,
    batch_size: u32,
) -> Result<ReconstructionReport> {
    if organization_id == 0 || !(1..=MAX_BATCH_SIZE).contains(&batch_size) {
        bail!("reconstruction requires a valid organization and bounded batch size");
    }
    validate_watermark(&requested)?;
    let durable = source.declared_watermark(organization_id).await?;
    validate_watermark(&durable)?;
    if durable != requested {
        bail!("requested reconstruction watermark is not the durable watermark");
    }
    let fence = sink
        .acquire_fence(organization_id, &durable)
        .await
        .context("acquire reconstruction writer fence")?;
    if fence.token.trim().is_empty()
        || fence.organization_id != organization_id
        || fence.watermark != durable
    {
        bail!("reconstruction sink returned an invalid writer fence");
    }

    let mut restored_rows = 0_u64;
    for table in catalog.tables() {
        let mut after = None;
        let mut batch_ordinal = 0_u64;
        loop {
            let rows = source
                .load_batch(organization_id, &durable, table, after.as_ref(), batch_size)
                .await
                .with_context(|| format!("load reconstruction batch for {}", table.table))?;
            if rows.len() > batch_size as usize {
                bail!("source exceeded bounded reconstruction batch size");
            }
            let is_last_batch = rows.len() < batch_size as usize;
            if !rows.is_empty() {
                validate_rows(&rows, table, organization_id, after.as_ref())?;
            }
            sink.apply_batch(&fence, table, batch_ordinal, is_last_batch, &rows)
                .await
                .with_context(|| format!("apply reconstruction batch for {}", table.table))?;
            restored_rows = restored_rows
                .checked_add(rows.len() as u64)
                .ok_or_else(|| anyhow!("reconstruction row count overflow"))?;
            if is_last_batch {
                break;
            }
            after = rows.last().map(|row| row.identity.clone());
            batch_ordinal = batch_ordinal
                .checked_add(1)
                .ok_or_else(|| anyhow!("reconstruction batch ordinal overflow"))?;
        }
        let expected = source
            .table_digest(organization_id, &durable, table)
            .await?;
        let actual = sink.table_digest(&fence, table).await?;
        validate_digest(&expected)?;
        validate_digest(&actual)?;
        if expected != actual {
            bail!("reconstruction digest mismatch for table '{}'", table.table);
        }
    }
    sink.verify_before_release(&fence)
        .await
        .context("verify reconstruction before releasing writer fence")?;
    sink.release_fence(&fence)
        .await
        .context("release reconstruction writer fence")?;
    Ok(ReconstructionReport {
        organization_id,
        watermark: durable,
        restored_tables: catalog.tables().len(),
        restored_rows,
    })
}

fn validate_rows(
    rows: &[RestoreRow],
    table: &RestoreTable,
    organization_id: u64,
    after: Option<&Value>,
) -> Result<()> {
    let mut previous = after
        .map(|value| identity_key(value, &table.primary_key))
        .transpose()?;
    for row in rows {
        let identity = row
            .identity
            .as_object()
            .ok_or_else(|| anyhow!("restore row identity must be an object"))?;
        if identity.len() != 1 || !identity.contains_key(&table.primary_key) {
            bail!("restore row identity does not match generated primary key");
        }
        let object = row
            .row
            .as_object()
            .ok_or_else(|| anyhow!("restore row payload must be an object"))?;
        let primary_json_key = pg_codec::snake_to_camel(&table.primary_key);
        if object.get(&primary_json_key) != identity.get(&table.primary_key) {
            bail!("restore row identity does not match its payload");
        }
        let organization_json_key = pg_codec::snake_to_camel(&table.organization_column);
        if object.get(&organization_json_key).and_then(json_u64) != Some(organization_id) {
            bail!("restore row belongs to a different organization");
        }
        if row.checksum != canonical_checksum(&row.row)? {
            bail!("restore row checksum does not match its payload");
        }
        let current = identity_key(&row.identity, &table.primary_key)?;
        if previous.as_ref().is_some_and(|value| value >= &current) {
            bail!("restore rows are not in strict primary-key order");
        }
        previous = Some(current);
    }
    Ok(())
}

fn identity_key(value: &Value, primary_key: &str) -> Result<(u8, String)> {
    let value = value
        .get(primary_key)
        .ok_or_else(|| anyhow!("restore row identity lacks generated primary key"))?;
    if let Some(number) = value.as_u64() {
        return Ok((0, format!("{number:020}")));
    }
    if let Some(text) = value.as_str() {
        if let Ok(number) = text.parse::<u64>() {
            return Ok((0, format!("{number:020}")));
        }
        return Ok((1, text.to_owned()));
    }
    bail!("restore row primary key must be a string or unsigned integer")
}

fn identity_text(value: &Value, primary_key: &str) -> Result<String> {
    let value = value
        .get(primary_key)
        .ok_or_else(|| anyhow!("restore row identity lacks generated primary key"))?;
    if let Some(number) = value.as_u64() {
        return Ok(number.to_string());
    }
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("restore row primary key must be a string or unsigned integer"))
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

fn digest_rows(rows: &[Value]) -> Result<TableDigest> {
    let mut canonical = rows
        .iter()
        .map(canonical_json)
        .collect::<Result<Vec<_>>>()?;
    canonical.sort();
    let mut digest = Sha256::new();
    for row in canonical {
        digest.update(row.as_bytes());
        digest.update(b"\n");
    }
    Ok(TableDigest {
        row_count: rows.len() as u64,
        checksum: hex::encode(digest.finalize()),
    })
}

fn canonical_checksum(value: &Value) -> Result<String> {
    Ok(hex::encode(Sha256::digest(
        canonical_json(value)?.as_bytes(),
    )))
}

fn canonical_json(value: &Value) -> Result<String> {
    serde_json::to_string(&canonical_value(value)).context("serialize canonical reconstruction row")
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

fn validate_run_id(run_id: &str) -> Result<()> {
    if run_id.is_empty()
        || run_id.len() > 128
        || !run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':'))
    {
        bail!("reconstruction run_id has an invalid shape");
    }
    Ok(())
}

fn quote_identifier(identifier: &str) -> String {
    debug_assert!(validate_identifier("SQL identifier", identifier).is_ok());
    format!("\"{identifier}\"")
}

fn require_server_identity(stdb: &StdbClient) -> Result<()> {
    if stdb.token().trim().is_empty() || stdb.token() == "local-dev-token" {
        bail!("reconstruction requires a configured STDB server/admin identity");
    }
    Ok(())
}

fn validate_identifier(label: &str, value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        bail!("reconstruction {label} must be lowercase snake_case");
    }
    Ok(())
}

fn validate_watermark(value: &DurableWatermark) -> Result<()> {
    if value.sequence == 0 || !is_sha256_hex(&value.commit_checksum) {
        bail!("reconstruction watermark is malformed");
    }
    Ok(())
}

fn validate_digest(value: &TableDigest) -> Result<()> {
    if !is_sha256_hex(&value.checksum) {
        bail!("reconstruction table digest is malformed");
    }
    Ok(())
}

fn json_u64(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use serde_json::json;

    use super::*;

    const MANIFEST: &str = r#"{"version":1,"tables":[
      {"table":"organization","module":"core","state_class":"reference","required_for_activation":true,"restore_order":1,"dependencies":[],"primary_key":"id","organization_column":"organization_id","projection_mode":"upsert-current","future":"allowed"},
      {"table":"sale_order","module":"sales","state_class":"operational","required_for_activation":true,"restore_order":2,"dependencies":["organization"],"primary_key":"id","organization_column":"organization_id","projection_mode":"upsert-current"}
    ]}"#;

    fn watermark() -> DurableWatermark {
        DurableWatermark {
            sequence: 4,
            commit_checksum: "a".repeat(64),
        }
    }

    fn digest(rows: u64) -> TableDigest {
        TableDigest {
            row_count: rows,
            checksum: "b".repeat(64),
        }
    }

    fn restore_row(table: &RestoreTable, organization_id: u64) -> RestoreRow {
        let row = json!({"id": table.restore_order, "organizationId": organization_id});
        let checksum = canonical_checksum(&row).unwrap();
        RestoreRow {
            identity: json!({"id": table.restore_order}),
            row,
            checksum,
        }
    }

    struct Source {
        wrong_org: bool,
    }

    impl ReconstructionSource for Source {
        async fn declared_watermark(&self, _: u64) -> Result<DurableWatermark> {
            Ok(watermark())
        }

        async fn load_batch(
            &self,
            _: u64,
            _: &DurableWatermark,
            table: &RestoreTable,
            after: Option<&Value>,
            _: u32,
        ) -> Result<Vec<RestoreRow>> {
            if after.is_some() {
                return Ok(vec![]);
            }
            Ok(vec![restore_row(table, if self.wrong_org { 8 } else { 7 })])
        }

        async fn table_digest(
            &self,
            _: u64,
            _: &DurableWatermark,
            _: &RestoreTable,
        ) -> Result<TableDigest> {
            Ok(digest(1))
        }
    }

    #[derive(Default)]
    struct Sink {
        events: Mutex<Vec<String>>,
        mismatch: bool,
    }

    impl ReconstructionSink for Sink {
        async fn acquire_fence(
            &self,
            organization_id: u64,
            watermark: &DurableWatermark,
        ) -> Result<ReconstructionFence> {
            self.events.lock().unwrap().push("fence".into());
            Ok(ReconstructionFence {
                token: "attempt".into(),
                organization_id,
                watermark: watermark.clone(),
            })
        }

        async fn apply_batch(
            &self,
            _: &ReconstructionFence,
            table: &RestoreTable,
            _: u64,
            _: bool,
            _: &[RestoreRow],
        ) -> Result<ApplyDisposition> {
            self.events.lock().unwrap().push(table.table.clone());
            Ok(ApplyDisposition::Applied)
        }

        async fn table_digest(
            &self,
            _: &ReconstructionFence,
            table: &RestoreTable,
        ) -> Result<TableDigest> {
            Ok(digest(if self.mismatch && table.table == "sale_order" {
                2
            } else {
                1
            }))
        }

        async fn verify_before_release(&self, _: &ReconstructionFence) -> Result<()> {
            self.events.lock().unwrap().push("verify".into());
            Ok(())
        }

        async fn release_fence(&self, _: &ReconstructionFence) -> Result<()> {
            self.events.lock().unwrap().push("release".into());
            Ok(())
        }
    }

    #[tokio::test]
    async fn restores_in_generated_order_then_releases_fence() {
        let catalog = RestoreCatalog::from_manifest(MANIFEST).unwrap();
        let sink = Sink::default();
        let report = reconstruct_organization(
            &Source { wrong_org: false },
            &sink,
            &catalog,
            7,
            watermark(),
            10,
        )
        .await
        .unwrap();
        assert_eq!((report.restored_tables, report.restored_rows), (2, 2));
        assert_eq!(
            *sink.events.lock().unwrap(),
            ["fence", "organization", "sale_order", "verify", "release"]
        );
    }

    #[tokio::test]
    async fn mismatch_or_cross_tenant_row_retains_fence() {
        let catalog = RestoreCatalog::from_manifest(MANIFEST).unwrap();
        let mismatch = Sink {
            mismatch: true,
            ..Default::default()
        };
        assert!(reconstruct_organization(
            &Source { wrong_org: false },
            &mismatch,
            &catalog,
            7,
            watermark(),
            10
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("digest mismatch"));
        assert!(!mismatch.events.lock().unwrap().contains(&"release".into()));

        let cross_tenant = Sink::default();
        assert!(reconstruct_organization(
            &Source { wrong_org: true },
            &cross_tenant,
            &catalog,
            7,
            watermark(),
            10
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("different organization"));
        assert_eq!(*cross_tenant.events.lock().unwrap(), ["fence"]);
    }

    #[test]
    fn catalog_rejects_dependency_that_does_not_precede_child() {
        let invalid = MANIFEST.replace("\"restore_order\":1", "\"restore_order\":3");
        assert!(RestoreCatalog::from_manifest(&invalid)
            .unwrap_err()
            .to_string()
            .contains("must precede"));
    }

    #[test]
    fn generated_catalog_is_valid_and_dependency_sorted() {
        let catalog = RestoreCatalog::generated().unwrap();
        assert!(!catalog.tables().is_empty());
        assert!(catalog
            .tables()
            .windows(2)
            .all(|pair| pair[0].restore_order < pair[1].restore_order));
    }
}
