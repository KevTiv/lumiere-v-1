use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use anyhow::{anyhow, bail, Result};
use serde_json::json;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::catalog::{RestoreCatalog, RestoreTable};
use super::coordinator::reconstruct_organization;
use super::integrity::{canonical_checksum, digest_rows};
use super::protocol::{
    ApplyDisposition, DurableWatermark, ReconstructionFence, ReconstructionSink,
    ReconstructionSource, RestoreRow, TableDigest,
};
use super::RECONSTRUCTION_MANIFEST_JSON;

const MANIFEST: &str = r#"{"version":1,"recreate_order":["derived_snapshot"],"excluded_tables":["platform_global"],"tables":[
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
            placement_generation: 1,
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

    async fn prepare_recreated_state(
        &self,
        _: &ReconstructionFence,
        tables: &[String],
    ) -> Result<()> {
        self.events
            .lock()
            .unwrap()
            .push(format!("recreate:{}", tables.join(",")));
        Ok(())
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
        [
            "fence",
            "organization",
            "sale_order",
            "recreate:derived_snapshot",
            "verify",
            "release"
        ]
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

/// Disposable-cell recovery drill. This intentionally exercises the
/// coordinator against a persistent sink rather than merely checking
/// individual validation helpers: the sink models STDB rows, batch
/// receipts, the writer fence, and one representative business write.
#[tokio::test]
async fn disposable_recovery_drill_resumes_idempotently_and_releases_workflow_fence() {
    let catalog = RestoreCatalog::from_manifest(MANIFEST).unwrap();
    let source = RecoverySource::new_with_empty(&catalog, 7, 3, Some("sale_order"));
    let sink = RecoverySink::new(source.digests());

    // The destination starts empty and the first run is interrupted after
    // one committed batch. A business write must remain fenced.
    sink.fail_next_apply();
    assert!(
        reconstruct_organization(&source, &sink, &catalog, 7, watermark(), 2,)
            .await
            .is_err()
    );
    assert_eq!(sink.row_count(), 2);
    assert!(sink.business_write().is_err());
    assert_eq!(sink.watermark(), Some(watermark()));

    // Re-running the same run resumes from durable receipts. It accepts
    // the already-applied first batch, applies the remaining batches, and
    // releases the fence only after table digests and watermark checks.
    let report = reconstruct_organization(&source, &sink, &catalog, 7, watermark(), 2)
        .await
        .unwrap();
    assert_eq!(report.watermark, watermark());
    assert_eq!(report.restored_tables, 2);
    assert_eq!(report.restored_rows, 3);
    assert_eq!(sink.row_count(), 3);
    // Two organization batches plus one empty final batch for sale_order.
    assert_eq!(sink.receipt_count(), 3);
    assert_eq!(sink.table_digests(), source.digests());
    assert_eq!(
        sink.recreated(),
        BTreeSet::from(["derived_snapshot".into()])
    );
    assert!(sink.business_write().is_ok());
    assert_eq!(sink.workflow_write_count(), 1);
    let evidence = serde_json::to_value(&report).unwrap();
    assert_eq!(evidence["run_id"], "run-1");
    assert_eq!(evidence["organization_id"], 7);
    assert_eq!(evidence["placement_generation"], 1);
    assert_eq!(evidence["watermark"]["sequence"], 4);
    assert_eq!(evidence["restored_tables"], 2);
    assert_eq!(evidence["restored_rows"], 3);
    assert_eq!(evidence["recreated_tables"], 1);
    assert_eq!(evidence["excluded_tables"], 1);
    assert_eq!(evidence["verified"], true);
    assert!(evidence["elapsed_millis"].is_u64());

    // A second identical reconstruction on the same destination, with a
    // fresh run ID, creates new receipts but cannot duplicate primary
    // keys already present in the target cell.
    sink.set_run_id("run-2");
    let second_report = reconstruct_organization(&source, &sink, &catalog, 7, watermark(), 2)
        .await
        .unwrap();
    assert_eq!(second_report.restored_rows, 3);
    assert_eq!(sink.row_count(), 3);
    assert_eq!(sink.receipt_count(), 6);
    assert!(sink.business_write().is_ok());
    assert_eq!(sink.workflow_write_count(), 2);
}

#[test]
fn generated_manifest_covers_restore_recreate_and_excluded_state() {
    let manifest: Value = serde_json::from_str(RECONSTRUCTION_MANIFEST_JSON).unwrap();
    let coverage = &manifest["coverage"];
    let restore_count = coverage["restore"].as_u64().unwrap();
    let recreate_count = coverage["recreate"].as_u64().unwrap();
    let excluded_count = coverage["excluded"].as_u64().unwrap();

    let restore = manifest["tables"]
        .as_array()
        .unwrap()
        .iter()
        .map(|table| table["table"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    let recreate = manifest["recreate_order"]
        .as_array()
        .unwrap()
        .iter()
        .map(|table| table.as_str().unwrap())
        .collect::<BTreeSet<_>>();
    let excluded = manifest["excluded_tables"]
        .as_array()
        .unwrap()
        .iter()
        .map(|table| table.as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(restore.len() as u64, restore_count);
    assert_eq!(recreate.len() as u64, recreate_count);
    assert_eq!(excluded.len() as u64, excluded_count);
    assert_eq!(
        restore_count + recreate_count + excluded_count,
        coverage["schema_tables"].as_u64().unwrap()
    );
    assert_eq!(
        restore.len(),
        RestoreCatalog::generated().unwrap().tables().len()
    );
    assert!(restore.is_disjoint(&recreate));
    assert!(restore.is_disjoint(&excluded));
    assert!(recreate.is_disjoint(&excluded));
}

struct RecoverySource {
    rows: BTreeMap<String, Vec<RestoreRow>>,
    digests: BTreeMap<String, TableDigest>,
}

impl RecoverySource {
    fn new_with_empty(
        catalog: &RestoreCatalog,
        organization_id: u64,
        rows_per_table: u64,
        empty_table: Option<&str>,
    ) -> Self {
        let mut rows = BTreeMap::new();
        let mut digests = BTreeMap::new();
        for table in catalog.tables() {
            let values = (1..=rows_per_table)
                .map(|id| {
                    let row = json!({
                        "id": id,
                        "organizationId": organization_id,
                        "label": format!("{}-{id}", table.table),
                    });
                    RestoreRow {
                        identity: json!({"id": id}),
                        checksum: canonical_checksum(&row).unwrap(),
                        row,
                    }
                })
                .collect::<Vec<_>>();
            let values = if empty_table == Some(table.table.as_str()) {
                Vec::new()
            } else {
                values
            };
            digests.insert(
                table.table.clone(),
                digest_rows(&values.iter().map(|row| row.row.clone()).collect::<Vec<_>>()).unwrap(),
            );
            rows.insert(table.table.clone(), values);
        }
        Self { rows, digests }
    }

    fn digests(&self) -> BTreeMap<String, TableDigest> {
        self.digests.clone()
    }
}

impl ReconstructionSource for RecoverySource {
    async fn declared_watermark(&self, _: u64) -> Result<DurableWatermark> {
        Ok(watermark())
    }

    async fn load_batch(
        &self,
        _: u64,
        _: &DurableWatermark,
        table: &RestoreTable,
        after_identity: Option<&Value>,
        limit: u32,
    ) -> Result<Vec<RestoreRow>> {
        let after = after_identity
            .and_then(|identity| identity.get("id"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        Ok(self
            .rows
            .get(&table.table)
            .unwrap()
            .iter()
            .filter(|row| row.identity["id"].as_u64().unwrap() > after)
            .take(limit as usize)
            .cloned()
            .collect())
    }

    async fn table_digest(
        &self,
        _: u64,
        _: &DurableWatermark,
        table: &RestoreTable,
    ) -> Result<TableDigest> {
        Ok(self.digests[&table.table].clone())
    }
}

#[derive(Clone)]
struct FenceState {
    run_id: String,
    watermark: DurableWatermark,
    complete: bool,
}

struct RecoverySink {
    state: Mutex<RecoveryState>,
    expected: BTreeMap<String, TableDigest>,
    run_id: Mutex<String>,
}

struct RecoveryState {
    fence: Option<FenceState>,
    rows: BTreeMap<String, BTreeMap<u64, Value>>,
    receipts: BTreeMap<(String, String, u64), String>,
    recreated: BTreeSet<String>,
    fail_after_receipts: Option<usize>,
    workflow_writes: u64,
}

impl RecoverySink {
    fn new(expected: BTreeMap<String, TableDigest>) -> Self {
        Self::with_run(expected, "run-1")
    }

    fn with_run(expected: BTreeMap<String, TableDigest>, run_id: &str) -> Self {
        Self {
            state: Mutex::new(RecoveryState {
                fence: None,
                rows: BTreeMap::new(),
                receipts: BTreeMap::new(),
                recreated: BTreeSet::new(),
                fail_after_receipts: None,
                workflow_writes: 0,
            }),
            expected,
            run_id: Mutex::new(run_id.to_string()),
        }
    }

    fn set_run_id(&self, run_id: &str) {
        *self.run_id.lock().unwrap() = run_id.to_string();
    }

    fn fail_next_apply(&self) {
        self.state.lock().unwrap().fail_after_receipts = Some(1);
    }

    fn row_count(&self) -> usize {
        self.state
            .lock()
            .unwrap()
            .rows
            .values()
            .map(BTreeMap::len)
            .sum()
    }

    fn receipt_count(&self) -> usize {
        self.state.lock().unwrap().receipts.len()
    }

    fn watermark(&self) -> Option<DurableWatermark> {
        self.state
            .lock()
            .unwrap()
            .fence
            .as_ref()
            .map(|fence| fence.watermark.clone())
    }

    fn table_digests(&self) -> BTreeMap<String, TableDigest> {
        self.state
            .lock()
            .unwrap()
            .rows
            .iter()
            .map(|(table, rows)| {
                let values = rows.values().cloned().collect::<Vec<_>>();
                (table.clone(), digest_rows(&values).unwrap())
            })
            .collect()
    }

    fn business_write(&self) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        if !state.fence.as_ref().is_some_and(|fence| fence.complete) {
            bail!("organization writer fence is active")
        }
        state.workflow_writes += 1;
        Ok(())
    }

    fn workflow_write_count(&self) -> u64 {
        self.state.lock().unwrap().workflow_writes
    }

    fn recreated(&self) -> BTreeSet<String> {
        self.state.lock().unwrap().recreated.clone()
    }
}

impl ReconstructionSink for RecoverySink {
    async fn acquire_fence(
        &self,
        organization_id: u64,
        watermark: &DurableWatermark,
    ) -> Result<ReconstructionFence> {
        let run_id = self.run_id.lock().unwrap().clone();
        let mut state = self.state.lock().unwrap();
        if let Some(fence) = state.fence.as_mut() {
            if !fence.complete {
                if fence.watermark != *watermark {
                    bail!("resume watermark changed")
                }
                return Ok(ReconstructionFence {
                    token: fence.run_id.clone(),
                    organization_id,
                    placement_generation: 1,
                    watermark: watermark.clone(),
                });
            }
        }
        state.fence = Some(FenceState {
            run_id: run_id.clone(),
            watermark: watermark.clone(),
            complete: false,
        });
        Ok(ReconstructionFence {
            token: run_id,
            organization_id,
            placement_generation: 1,
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
        let mut state = self.state.lock().unwrap();
        if state
            .fail_after_receipts
            .is_some_and(|receipt_count| state.receipts.len() >= receipt_count)
        {
            state.fail_after_receipts = None;
            bail!("synthetic cell interrupted")
        }
        let key = (fence.token.clone(), table.table.clone(), batch_ordinal);
        let fingerprint = format!(
            "{is_last_batch}:{:?}",
            rows.iter().map(|row| &row.row).collect::<Vec<_>>()
        );
        if let Some(previous) = state.receipts.get(&key) {
            if previous != &fingerprint {
                bail!("reconstruction receipt conflicts with retry")
            }
            return Ok(ApplyDisposition::AlreadyApplied);
        }
        let target = state.rows.entry(table.table.clone()).or_default();
        for row in rows {
            let id = row.identity["id"].as_u64().unwrap();
            if let Some(previous) = target.get(&id) {
                if previous != &row.row {
                    bail!("reconstruction primary key conflicts with retry")
                }
            } else {
                target.insert(id, row.row.clone());
            }
        }
        state.receipts.insert(key, fingerprint);
        Ok(ApplyDisposition::Applied)
    }

    async fn table_digest(
        &self,
        _: &ReconstructionFence,
        table: &RestoreTable,
    ) -> Result<TableDigest> {
        Ok(self
            .table_digests()
            .get(&table.table)
            .cloned()
            .unwrap_or_else(|| TableDigest {
                row_count: 0,
                checksum: hex::encode(Sha256::digest(b"")),
            }))
    }

    async fn prepare_recreated_state(
        &self,
        _: &ReconstructionFence,
        tables: &[String],
    ) -> Result<()> {
        self.state
            .lock()
            .unwrap()
            .recreated
            .extend(tables.iter().cloned());
        Ok(())
    }

    async fn verify_before_release(&self, fence: &ReconstructionFence) -> Result<()> {
        if self.watermark() != Some(fence.watermark.clone()) {
            bail!("synthetic cell watermark mismatch")
        }
        if self.recreated() != BTreeSet::from(["derived_snapshot".into()]) {
            bail!("synthetic cell recreated-state preparation is incomplete")
        }
        if self.table_digests() != self.expected {
            bail!("synthetic cell digest mismatch")
        }
        Ok(())
    }

    async fn release_fence(&self, fence: &ReconstructionFence) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        let current = state
            .fence
            .as_mut()
            .ok_or_else(|| anyhow!("synthetic cell fence missing"))?;
        if current.run_id != fence.token {
            bail!("synthetic cell fence owner mismatch")
        }
        current.complete = true;
        Ok(())
    }
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
