//! Reconstruction protocol types and source/sink contracts.

use super::catalog::RestoreTable;
use anyhow::Result;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableDigest {
    pub row_count: u64,
    pub checksum: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconstructionFence {
    pub token: String,
    pub organization_id: u64,
    pub placement_generation: u64,
    pub watermark: DurableWatermark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReconstructionReport {
    pub run_id: String,
    pub organization_id: u64,
    pub placement_generation: u64,
    pub watermark: DurableWatermark,
    pub restored_tables: usize,
    pub restored_rows: u64,
    pub recreated_tables: usize,
    pub excluded_tables: usize,
    pub verified: bool,
    pub elapsed_millis: u64,
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
    async fn prepare_recreated_state(
        &self,
        _fence: &ReconstructionFence,
        tables: &[String],
    ) -> Result<()>;
    async fn verify_before_release(&self, fence: &ReconstructionFence) -> Result<()>;
    async fn release_fence(&self, fence: &ReconstructionFence) -> Result<()>;
}
