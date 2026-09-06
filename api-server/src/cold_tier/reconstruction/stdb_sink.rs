//! SpacetimeDB reconstruction sink.

use super::super::{pg_codec, reconciliation};
use super::catalog::RestoreTable;
use super::integrity::{canonical_json, digest_rows, require_server_identity, validate_run_id};
use super::protocol::{
    ApplyDisposition, DurableWatermark, ReconstructionFence, ReconstructionSink, RestoreRow,
    TableDigest,
};
use super::MAX_DIGEST_ROWS;
use anyhow::{bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use stdb_client::{ReducerCall, StdbClient};

/// Trusted STDB reconstruction adapter. It owns the server identity and the
/// run identity used by every reducer call.
pub struct StdbReconstructionSink<'a> {
    stdb: &'a StdbClient,
    pool: &'a Pool,
    run_id: String,
    placement_generation: u64,
    inject_failure_after_batch: bool,
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
        let inject_failure_after_batch = failure_injection_enabled(
            std::env::var("C7_INJECT_FAILURE_AFTER_BATCH")
                .ok()
                .as_deref(),
            stdb.base_url(),
            std::env::var("C7_DISPOSABLE_STDB").ok().as_deref(),
        )?;
        Ok(Self {
            stdb,
            pool,
            run_id,
            placement_generation,
            inject_failure_after_batch,
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
                watermark.sequence,
                watermark.commit_checksum
            ]),
        )
        .await?;
        self.fence_acquired.store(true, Ordering::Release);
        Ok(ReconstructionFence {
            token: self.run_id.clone(),
            organization_id,
            placement_generation: self.placement_generation,
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
        let columns = pg_codec::load_columns(
            lumiere_contracts::manifests::PROJECTION_CODEC_MANIFEST,
            &table.table,
        )?;
        let rows_json = rows
            .iter()
            .map(|row| canonical_stdb_row_json(&columns, &row.row))
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
        if self.inject_failure_after_batch && batch_ordinal == 0 && !rows.is_empty() {
            bail!("C7 injected failure after a committed reconstruction batch");
        }
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
            "SELECT {projection} FROM {} WHERE {} = {} LIMIT {}",
            table.table,
            table.organization_column,
            fence.organization_id,
            MAX_DIGEST_ROWS + 1,
        );
        let rows = self.stdb.query_sql(&sql).await?;
        if rows.len() > MAX_DIGEST_ROWS {
            bail!("STDB reconstruction digest exceeds bounded row limit");
        }
        digest_rows(&rows)
    }

    async fn prepare_recreated_state(
        &self,
        _fence: &ReconstructionFence,
        tables: &[String],
    ) -> Result<()> {
        const EXPECTED_RECREATED: [&str; 5] = [
            "cold_tier_service_identity",
            "organization_reconstruction_batch_receipt",
            "organization_reconstruction_fence",
            "policy_snapshot",
            "project_margin_snapshot",
        ];
        if tables.iter().map(String::as_str).collect::<Vec<_>>() != EXPECTED_RECREATED {
            bail!("generated recreated-state contract does not match the trusted rebuild set");
        }
        Ok(())
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
                fence.watermark.sequence,
                fence.watermark.commit_checksum
            ]),
        )
        .await
    }
}

fn canonical_stdb_row_json(columns: &[pg_codec::ColumnCodec], row: &Value) -> Result<String> {
    let source = row
        .as_object()
        .context("reconstruction row payload must be an object")?;
    if source.len() != columns.len() {
        bail!("reconstruction row payload does not match generated columns");
    }
    let mut stdb_row = serde_json::Map::new();
    for column in columns {
        let api_key = pg_codec::snake_to_camel(&column.name);
        let value = source
            .get(&api_key)
            .with_context(|| format!("reconstruction row lacks generated column '{api_key}'"))?;
        stdb_row.insert(column.name.clone(), value.clone());
    }
    canonical_json(&Value::Object(stdb_row))
}

fn failure_injection_enabled(
    value: Option<&str>,
    host: &str,
    disposable: Option<&str>,
) -> Result<bool> {
    let Some(value) = value else {
        return Ok(false);
    };
    if value != "1" {
        bail!("C7_INJECT_FAILURE_AFTER_BATCH must be exactly 1 when set");
    }
    let loopback = host.starts_with("http://127.0.0.1") || host.starts_with("http://localhost");
    if disposable != Some("1") || !loopback {
        bail!("C7 failure injection requires C7_DISPOSABLE_STDB=1 and a loopback STDB host");
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{canonical_stdb_row_json, failure_injection_enabled};
    use crate::cold_tier::pg_codec;
    use serde_json::json;

    #[test]
    fn failure_injection_is_disposable_and_loopback_only() {
        assert!(
            !failure_injection_enabled(None, "https://maincloud.spacetimedb.com", None).unwrap()
        );
        assert!(failure_injection_enabled(Some("1"), "http://127.0.0.1:3000", Some("1")).unwrap());
        assert!(failure_injection_enabled(
            Some("1"),
            "https://maincloud.spacetimedb.com",
            Some("1")
        )
        .is_err());
        assert!(failure_injection_enabled(Some("1"), "http://localhost:3000", None).is_err());
    }

    #[test]
    fn reconstruction_rows_use_stdb_rust_field_names() {
        let columns = pg_codec::load_columns(
            lumiere_contracts::manifests::PROJECTION_CODEC_MANIFEST,
            "organization_commit_cursor",
        )
        .unwrap();
        let encoded = canonical_stdb_row_json(
            &columns,
            &json!({ "organizationId": "42", "nextSequence": "2" }),
        )
        .unwrap();
        assert_eq!(encoded, r#"{"next_sequence":"2","organization_id":"42"}"#);
    }
}
