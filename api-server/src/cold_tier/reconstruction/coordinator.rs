//! Reconstruction sequencing and fence lifecycle.

use super::catalog::RestoreCatalog;
use super::integrity::{validate_digest, validate_rows, validate_watermark};
use super::postgres_source::PgReconstructionSource;
use super::protocol::{
    DurableWatermark, ReconstructionReport, ReconstructionSink, ReconstructionSource,
};
use super::stdb_sink::StdbReconstructionSink;
use super::MAX_BATCH_SIZE;
use crate::organization_placement::{OrganizationLifecycle, OrganizationPlacement};
use anyhow::{anyhow, bail, Context, Result};
use deadpool_postgres::Pool;
use std::time::Instant;
use stdb_client::StdbClient;

/// Execute one complete durable reconstruction. Any failure after fence
/// acquisition is persisted as a failed fence; completion happens only after
/// whole-organization PG/STDB reconciliation succeeds.
pub async fn reconstruct_organization_once(
    stdb: &StdbClient,
    read_stdb: &StdbClient,
    pool: &Pool,
    target: &OrganizationPlacement,
    requested: DurableWatermark,
    run_id: impl Into<String>,
) -> Result<ReconstructionReport> {
    if target.lifecycle() != OrganizationLifecycle::Reactivating {
        bail!("reconstruction target must be server-fenced as reactivating");
    }
    let organization_id = target.organization_id();
    let placement_generation = target.generation().get();
    let source = PgReconstructionSource::new(pool.clone());
    let sink = StdbReconstructionSink::new(stdb, read_stdb, pool, run_id, placement_generation)?;
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
    let started_at = Instant::now();
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
        || fence.placement_generation == 0
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
    sink.prepare_recreated_state(&fence, catalog.recreate_order())
        .await
        .context("prepare target-local and rebuildable reconstruction state")?;
    sink.verify_before_release(&fence)
        .await
        .context("verify reconstruction before releasing writer fence")?;
    sink.release_fence(&fence)
        .await
        .context("release reconstruction writer fence")?;
    Ok(ReconstructionReport {
        run_id: fence.token,
        organization_id,
        placement_generation: fence.placement_generation,
        watermark: durable,
        restored_tables: catalog.tables().len(),
        restored_rows,
        recreated_tables: catalog.recreate_order().len(),
        excluded_tables: catalog.excluded_tables().len(),
        verified: true,
        elapsed_millis: u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}
