//! Organization reconstruction writer fence.
//!
//! Reconstruction targets a disposable module, but the fence still lives in
//! STDB so an accidentally routed business request fails inside the same
//! transaction as its reducer. Only the registered reconstruction service may
//! acquire or release the fence; a failed run remains fenced until the same
//! run is resumed and verified.

use sha2::{Digest, Sha256};
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::core::cold_tier_identity::{
    is_active_cold_tier_service_identity, ORGANIZATION_RECONSTRUCTOR_SERVICE,
};

const ACTIVE: &str = "active";
const FAILED: &str = "failed";
const COMPLETE: &str = "complete";

#[derive(Clone)]
#[spacetimedb::table(
    accessor = organization_reconstruction_fence,
    public,
    index(
        accessor = organization_reconstruction_fence_by_run,
        btree(columns = [run_id])
    )
)]
pub struct OrganizationReconstructionFence {
    #[primary_key]
    pub organization_id: u64,
    pub run_id: String,
    pub placement_generation: u64,
    pub target_watermark: u64,
    pub state: String,
    pub started_at: Timestamp,
    pub updated_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub failure: Option<String>,
    /// Restore order currently accepting batches, if any.
    pub current_restore_order: Option<u32>,
    /// Last table whose final batch committed successfully.
    pub last_completed_restore_order: u32,
    /// Exact ordinal required for the next batch of the current table.
    pub next_batch_ordinal: u64,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = organization_reconstruction_batch_receipt,
    public,
    index(
        accessor = organization_reconstruction_batch_receipt_by_run_id,
        btree(columns = [run_id])
    ),
    index(
        accessor = organization_reconstruction_batch_receipt_by_organization,
        btree(columns = [organization_id])
    )
)]
pub struct OrganizationReconstructionBatchReceipt {
    #[primary_key]
    pub receipt_key: String,
    pub organization_id: u64,
    pub run_id: String,
    pub table_name: String,
    pub restore_order: u32,
    pub batch_ordinal: u64,
    pub is_last_batch: bool,
    pub row_count: u32,
    pub batch_checksum: String,
    pub applied_at: Timestamp,
}

#[derive(Clone)]
struct ApplyOrganizationReconstructionBatchParams {
    pub organization_id: u64,
    pub run_id: String,
    pub table_name: String,
    pub restore_order: u32,
    pub batch_ordinal: u64,
    pub is_last_batch: bool,
    /// Canonical SATS-compatible JSON, one complete table row per element.
    pub rows_json: Vec<String>,
}

const MAX_RECONSTRUCTION_BATCH_ROWS: usize = 256;
const MAX_RECONSTRUCTION_BATCH_BYTES: usize = 4 * 1024 * 1024;

/// Return an error while an organization restore is active or failed.
pub fn require_writes_unfenced(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    if let Some(fence) = ctx
        .db
        .organization_reconstruction_fence()
        .organization_id()
        .find(&organization_id)
    {
        if fence.state != COMPLETE {
            return Err(format!(
                "organization {organization_id} is fenced for reconstruction run {}",
                fence.run_id
            ));
        }
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn begin_organization_reconstruction(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: String,
    placement_generation: u64,
    target_watermark: u64,
) -> Result<(), String> {
    require_reconstructor(ctx)?;
    validate_identity(
        organization_id,
        &run_id,
        placement_generation,
        target_watermark,
    )?;

    let table = ctx.db.organization_reconstruction_fence();
    if let Some(existing) = table.organization_id().find(&organization_id) {
        if existing.run_id == run_id
            && existing.placement_generation == placement_generation
            && existing.target_watermark == target_watermark
            && (existing.state == ACTIVE || existing.state == FAILED)
        {
            table
                .organization_id()
                .update(OrganizationReconstructionFence {
                    state: ACTIVE.to_string(),
                    updated_at: ctx.timestamp,
                    failure: None,
                    ..existing
                });
            return Ok(());
        }
        if existing.state != COMPLETE {
            return Err("organization already has a different reconstruction fence".to_string());
        }
        if ctx
            .db
            .organization_reconstruction_batch_receipt()
            .organization_reconstruction_batch_receipt_by_run_id()
            .filter(&run_id)
            .any(|receipt| receipt.organization_id == organization_id)
        {
            return Err("reconstruction run_id has already been used".to_string());
        }
        table
            .organization_id()
            .update(OrganizationReconstructionFence {
                organization_id,
                run_id,
                placement_generation,
                target_watermark,
                state: ACTIVE.to_string(),
                started_at: ctx.timestamp,
                updated_at: ctx.timestamp,
                completed_at: None,
                failure: None,
                current_restore_order: None,
                last_completed_restore_order: 0,
                next_batch_ordinal: 0,
            });
        return Ok(());
    }

    table.insert(OrganizationReconstructionFence {
        organization_id,
        run_id,
        placement_generation,
        target_watermark,
        state: ACTIVE.to_string(),
        started_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        completed_at: None,
        failure: None,
        current_restore_order: None,
        last_completed_restore_order: 0,
        next_batch_ordinal: 0,
    });
    Ok(())
}

/// Apply one bounded, dependency-ordered batch from the durable projection.
///
/// Table names are resolved by a generated closed match. Each match arm SATS
/// decodes one concrete row type, validates direct organization ownership,
/// and inserts only when the primary key is absent. An identical existing row
/// is a no-op; different data at the same primary key aborts the transaction.
#[spacetimedb::reducer]
pub fn apply_organization_reconstruction_batch(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: String,
    table_name: String,
    restore_order: u32,
    batch_ordinal: u64,
    is_last_batch: bool,
    rows_json: Vec<String>,
) -> Result<(), String> {
    require_reconstructor(ctx)?;
    let params = ApplyOrganizationReconstructionBatchParams {
        organization_id,
        run_id,
        table_name,
        restore_order,
        batch_ordinal,
        is_last_batch,
        rows_json,
    };
    validate_batch(&params)?;

    let expected_restore_order =
        crate::generated_reconstruction_apply::generated_restore_order(&params.table_name)
            .ok_or_else(|| "table is not in the generated reconstruction allowlist".to_string())?;
    if params.restore_order != expected_restore_order {
        return Err("table restore order does not match generated metadata".to_string());
    }

    let checksum = batch_checksum(&params);
    let receipt_key = receipt_key(&params);
    if let Some(receipt) = ctx
        .db
        .organization_reconstruction_batch_receipt()
        .receipt_key()
        .find(&receipt_key)
    {
        if receipt.organization_id == params.organization_id
            && receipt.run_id == params.run_id
            && receipt.table_name == params.table_name
            && receipt.restore_order == params.restore_order
            && receipt.batch_ordinal == params.batch_ordinal
            && receipt.is_last_batch == params.is_last_batch
            && receipt.row_count == params.rows_json.len() as u32
            && receipt.batch_checksum == checksum
        {
            return Ok(());
        }
        return Err("reconstruction batch receipt conflicts with retry".to_string());
    }

    let mut fence = exact_fence(ctx, params.organization_id, &params.run_id)?;
    if fence.state != ACTIVE {
        return Err("reconstruction batch requires an active fence".to_string());
    }
    let next_order = fence
        .last_completed_restore_order
        .checked_add(1)
        .ok_or_else(|| "reconstruction restore order overflow".to_string())?;
    match fence.current_restore_order {
        Some(order) if order != params.restore_order => {
            return Err("previous reconstruction table is not complete".to_string());
        }
        Some(_) => {}
        None => {
            if params.restore_order != next_order || params.batch_ordinal != 0 {
                return Err("reconstruction table is not next in generated order".to_string());
            }
            fence.current_restore_order = Some(params.restore_order);
            fence.next_batch_ordinal = 0;
        }
    }
    if params.batch_ordinal != fence.next_batch_ordinal {
        return Err("reconstruction batch ordinal is not the expected next batch".to_string());
    }

    for row_json in &params.rows_json {
        crate::generated_reconstruction_apply::apply_generated_reconstruction_row(
            ctx,
            params.organization_id,
            &params.table_name,
            row_json,
        )?;
    }

    ctx.db.organization_reconstruction_batch_receipt().insert(
        OrganizationReconstructionBatchReceipt {
            receipt_key,
            organization_id: params.organization_id,
            run_id: params.run_id,
            table_name: params.table_name,
            restore_order: params.restore_order,
            batch_ordinal: params.batch_ordinal,
            is_last_batch: params.is_last_batch,
            row_count: params.rows_json.len() as u32,
            batch_checksum: checksum,
            applied_at: ctx.timestamp,
        },
    );

    if params.is_last_batch {
        fence.current_restore_order = None;
        fence.last_completed_restore_order = params.restore_order;
        fence.next_batch_ordinal = 0;
    } else {
        fence.next_batch_ordinal = fence
            .next_batch_ordinal
            .checked_add(1)
            .ok_or_else(|| "reconstruction batch ordinal overflow".to_string())?;
    }
    fence.updated_at = ctx.timestamp;
    ctx.db
        .organization_reconstruction_fence()
        .organization_id()
        .update(fence);
    Ok(())
}

#[spacetimedb::reducer]
pub fn fail_organization_reconstruction(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: String,
    failure: String,
) -> Result<(), String> {
    require_reconstructor(ctx)?;
    let failure = failure.trim();
    if failure.is_empty() || failure.len() > 1024 {
        return Err("reconstruction failure must contain 1..=1024 characters".to_string());
    }
    update_exact_fence(
        ctx,
        organization_id,
        &run_id,
        FAILED,
        Some(failure.to_string()),
    )
}

#[spacetimedb::reducer]
pub fn complete_organization_reconstruction(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: String,
    placement_generation: u64,
    verified_watermark: u64,
) -> Result<(), String> {
    require_reconstructor(ctx)?;
    let mut fence = exact_fence(ctx, organization_id, &run_id)?;
    if fence.state != ACTIVE
        || fence.placement_generation != placement_generation
        || fence.target_watermark != verified_watermark
        || fence.current_restore_order.is_some()
        || fence.last_completed_restore_order
            != crate::generated_reconstruction_apply::GENERATED_FINAL_RESTORE_ORDER
    {
        return Err("reconstruction completion does not match the active fence".to_string());
    }
    fence.state = COMPLETE.to_string();
    fence.updated_at = ctx.timestamp;
    fence.completed_at = Some(ctx.timestamp);
    fence.failure = None;
    ctx.db
        .organization_reconstruction_fence()
        .organization_id()
        .update(fence);
    Ok(())
}

fn update_exact_fence(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: &str,
    state: &str,
    failure: Option<String>,
) -> Result<(), String> {
    let mut fence = exact_fence(ctx, organization_id, run_id)?;
    if fence.state == COMPLETE {
        return Err("completed reconstruction cannot be failed".to_string());
    }
    fence.state = state.to_string();
    fence.updated_at = ctx.timestamp;
    fence.failure = failure;
    ctx.db
        .organization_reconstruction_fence()
        .organization_id()
        .update(fence);
    Ok(())
}

fn exact_fence(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: &str,
) -> Result<OrganizationReconstructionFence, String> {
    let fence = ctx
        .db
        .organization_reconstruction_fence()
        .organization_id()
        .find(&organization_id)
        .ok_or_else(|| "organization reconstruction fence was not found".to_string())?;
    if fence.run_id != run_id {
        return Err("reconstruction run does not own the organization fence".to_string());
    }
    Ok(fence)
}

fn require_reconstructor(ctx: &ReducerContext) -> Result<(), String> {
    if !is_active_cold_tier_service_identity(ctx, ORGANIZATION_RECONSTRUCTOR_SERVICE) {
        return Err("caller is not the registered organization reconstructor".to_string());
    }
    Ok(())
}

fn validate_batch(params: &ApplyOrganizationReconstructionBatchParams) -> Result<(), String> {
    validate_identity(params.organization_id, &params.run_id, 1, 1)?;
    if params.table_name.is_empty()
        || params.table_name.len() > 128
        || !params
            .table_name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err("reconstruction table name has an invalid shape".to_string());
    }
    if params.rows_json.len() > MAX_RECONSTRUCTION_BATCH_ROWS {
        return Err("reconstruction batch exceeds row limit".to_string());
    }
    if params.rows_json.is_empty() && !params.is_last_batch {
        return Err("only a final reconstruction batch may be empty".to_string());
    }
    let bytes = params.rows_json.iter().try_fold(0usize, |total, row| {
        total
            .checked_add(row.len())
            .ok_or_else(|| "reconstruction batch byte count overflow".to_string())
    })?;
    if bytes > MAX_RECONSTRUCTION_BATCH_BYTES {
        return Err("reconstruction batch exceeds byte limit".to_string());
    }
    Ok(())
}

fn receipt_key(params: &ApplyOrganizationReconstructionBatchParams) -> String {
    format!(
        "{}:{}:{}:{}",
        params.organization_id, params.run_id, params.restore_order, params.batch_ordinal
    )
}

fn batch_checksum(params: &ApplyOrganizationReconstructionBatchParams) -> String {
    let mut hasher = Sha256::new();
    hasher.update(params.table_name.as_bytes());
    hasher.update(params.restore_order.to_le_bytes());
    hasher.update(params.batch_ordinal.to_le_bytes());
    hasher.update([u8::from(params.is_last_batch)]);
    for row in &params.rows_json {
        hasher.update((row.len() as u64).to_le_bytes());
        hasher.update(row.as_bytes());
    }
    format!("sha256:{:x}", hasher.finalize())
}

fn validate_identity(
    organization_id: u64,
    run_id: &str,
    placement_generation: u64,
    target_watermark: u64,
) -> Result<(), String> {
    if organization_id == 0 || placement_generation == 0 || target_watermark == 0 {
        return Err(
            "reconstruction organization, generation, and watermark must be non-zero".to_string(),
        );
    }
    if run_id.is_empty()
        || run_id.len() > 128
        || !run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':'))
    {
        return Err("reconstruction run_id has an invalid shape".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconstruction_identity_requires_server_owned_nonzero_fence_values() {
        assert!(validate_identity(7, "restore-7-42", 3, 42).is_ok());
        assert!(validate_identity(0, "restore-7-42", 3, 42).is_err());
        assert!(validate_identity(7, "restore/7", 3, 42).is_err());
        assert!(validate_identity(7, "restore-7-42", 0, 42).is_err());
        assert!(validate_identity(7, "restore-7-42", 3, 0).is_err());
    }

    #[test]
    fn reconstruction_batch_is_bounded_and_only_final_batch_may_be_empty() {
        let mut params = ApplyOrganizationReconstructionBatchParams {
            organization_id: 7,
            run_id: "restore-7-42".to_string(),
            table_name: "pos_order".to_string(),
            restore_order: 1,
            batch_ordinal: 0,
            is_last_batch: false,
            rows_json: Vec::new(),
        };
        assert!(validate_batch(&params).is_err());
        params.is_last_batch = true;
        assert!(validate_batch(&params).is_ok());
        params.rows_json = vec!["{}".to_string(); MAX_RECONSTRUCTION_BATCH_ROWS + 1];
        assert!(validate_batch(&params).is_err());
    }

    #[test]
    fn reconstruction_batch_checksum_is_framed_and_retry_stable() {
        let params = ApplyOrganizationReconstructionBatchParams {
            organization_id: 7,
            run_id: "restore-7-42".to_string(),
            table_name: "pos_order".to_string(),
            restore_order: 217,
            batch_ordinal: 3,
            is_last_batch: true,
            rows_json: vec!["{\"id\":1}".to_string(), "{\"id\":2}".to_string()],
        };
        assert_eq!(batch_checksum(&params), batch_checksum(&params));
        let mut changed = params.clone();
        changed.rows_json.reverse();
        assert_ne!(batch_checksum(&params), batch_checksum(&changed));
    }
}
