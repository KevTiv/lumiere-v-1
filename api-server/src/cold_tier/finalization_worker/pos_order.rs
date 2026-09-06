//! Bounded POS-order C5 finalization worker.
//!
//! This module owns the cross-tier hand-off for the first mutable aggregate:
//! `pos_order`.  It deliberately has no service/bootstrap loop; a coordinator
//! supplies the authenticated STDB client and placement-resolved PG pool and
//! calls [`drain_batch`].  Every row is re-checked by the STDB finalizer after
//! the PG write, so a race between this worker and a business/hydration write
//! fails closed instead of deleting a newer hot row.

use anyhow::{anyhow, bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use stdb_client::StdbClient;

use super::super::{commit_projection, ledger, pg_codec};
use super::CandidateDrainStats;

const CODEC_MANIFEST_JSON: &str = lumiere_contracts::manifests::CODEC_MANIFEST;
const TABLE: &str = "pos_order";
const COLD_TABLE: &str = "cold_pos_order";
const MAX_BATCH_SIZE: u32 = 200;
const COLD_ROW_PROOF_SQL: &str = "SELECT archive_version::TEXT, payload_checksum \
     FROM cold_pos_order \
     WHERE organization_id = $1::TEXT::NUMERIC \
       AND id = $2::TEXT::NUMERIC";
const DURABILITY_PROOF_SQL: &str =
    "SELECT projected.archive_version::TEXT, projected.cold_eligible_at, \
     change.commit_sequence::TEXT, watermark.applied_sequence::TEXT, \
     envelope.change_schema_version, envelope.contract_version \
     FROM pos_order projected \
     JOIN LATERAL ( \
         SELECT organization_id, commit_sequence \
         FROM organization_row_change \
         WHERE organization_id = $1::TEXT::NUMERIC \
           AND table_name = 'pos_order' \
           AND row_identity_json = $3::TEXT::JSONB \
           AND change_kind = 'upsert' \
         ORDER BY commit_sequence DESC \
         LIMIT 1 \
     ) change ON TRUE \
     JOIN organization_projection_watermark watermark \
       ON watermark.organization_id = projected.organization_id \
      AND watermark.applied_sequence >= change.commit_sequence \
     JOIN organization_commit envelope \
       ON envelope.organization_id = change.organization_id \
      AND envelope.sequence = change.commit_sequence \
     WHERE projected.organization_id = $1::TEXT::NUMERIC \
       AND projected.id = $2::TEXT::NUMERIC";

#[derive(Debug, Clone, PartialEq, Eq)]
struct DurableProjectionProof {
    row_commit_sequence: u64,
    durable_watermark: u64,
    change_schema_version: u32,
    contract_version: String,
}

/// Drain a bounded set of currently eligible POS orders.
///
/// Individual rows fail closed and are counted so one malformed or
/// not-yet-durable row cannot prevent later rows in the same bounded batch
/// from being considered.  A batch-level STDB/PG query failure is propagated
/// to the coordinator.
pub async fn drain_batch(
    source_stdb: &StdbClient,
    finalizer_stdb: &StdbClient,
    pool: &Pool,
    batch_size: u32,
) -> Result<CandidateDrainStats> {
    let batch_size = bounded_batch_size(batch_size)?;
    let mut stats = CandidateDrainStats::default();
    reconcile_pending(pool, source_stdb, batch_size, &mut stats).await?;

    let columns =
        pg_codec::load_columns(CODEC_MANIFEST_JSON, TABLE).context("load pos_order columns")?;
    let sql = format!("SELECT * FROM {TABLE}");
    let raw_rows = source_stdb
        .query_sql(&sql)
        .await
        .context("query pos_order finalization batch")?;
    let raw_rows = select_candidates(raw_rows, batch_size)?;

    stats.read = raw_rows.len();
    for raw in &raw_rows {
        match drain_one(pool, finalizer_stdb, &columns, raw).await {
            Ok(()) => {
                stats.archived += 1;
                stats.finalized += 1;
            }
            Err(error) => {
                stats.failed += 1;
                tracing::error!(%error, row = %raw, "pos_order finalization: row failed");
            }
        }
    }
    Ok(stats)
}

/// Reconcile an ambiguous prior reducer success from durable evidence.
///
/// POS finalization intentionally does not emit projection deletes: the
/// current PostgreSQL child projections remain the aggregate's hydration
/// source, while `cold_pos_order` holds the immutable root transfer proof.
async fn reconcile_pending(
    pool: &Pool,
    stdb: &StdbClient,
    batch_size: u32,
    stats: &mut CandidateDrainStats,
) -> Result<()> {
    for transfer in ledger::pending_transfers(pool, TABLE, batch_size).await? {
        let result = async {
            let id: u64 = transfer
                .row_id
                .parse()
                .context("parse pending pos_order id")?;
            let organization_id: u64 = transfer
                .organization_id
                .parse()
                .context("parse pending pos_order organization")?;
            if transfer.resource != TABLE || transfer.archive_version <= 0 {
                bail!("pending pos_order transfer has an invalid resource or version");
            }
            let hot = stdb
                .query_sql(&format!("SELECT * FROM {TABLE} WHERE id = {id}"))
                .await
                .context("check pending pos_order hot row")?;
            if select_exact_pos_order_row(hot, id, Some(organization_id))?.is_some() {
                return Ok(false);
            }

            let client = pool
                .get()
                .await
                .context("get PG client for pos_order reconciliation")?;
            let archived = client
                .query_opt(
                    COLD_ROW_PROOF_SQL,
                    &[&transfer.organization_id, &transfer.row_id],
                )
                .await
                .context("verify pending cold_pos_order transfer")?
                .ok_or_else(|| anyhow!("pending pos_order transfer has no cold-row proof"))?;
            let archive_version: String = archived.get(0);
            let checksum: String = archived.get(1);
            if archive_version != transfer.archive_version.to_string()
                || checksum != transfer.payload_checksum
            {
                bail!("pending pos_order transfer disagrees with the exact cold row");
            }
            ledger::mark_finalized(pool, TABLE, &transfer.row_id).await?;
            Ok(true)
        }
        .await;

        match result {
            Ok(true) => stats.reconciled += 1,
            Ok(false) => {}
            Err(error) => {
                stats.failed += 1;
                tracing::error!(%error, row_id = %transfer.row_id, "pos_order finalization reconciliation failed");
            }
        }
    }
    Ok(())
}

async fn drain_one(
    pool: &Pool,
    stdb: &StdbClient,
    columns: &[pg_codec::ColumnCodec],
    raw: &Value,
) -> Result<()> {
    let id = require_u64(raw, "id")?;
    let organization_id = require_u64(raw, "organizationId")?;
    let archive_version = require_u64(raw, "archiveVersion")?;
    let cold_eligible_at_micros = raw
        .get("coldEligibleAt")
        .and_then(|value| value.get("microsSinceUnixEpoch"))
        .and_then(Value::as_i64)
        .ok_or_else(|| {
            anyhow!("pos_order {id}: missing cold_eligible_at despite eligibility batch predicate")
        })?;

    let values = pg_codec::decode_row(columns, raw)?;
    let checksum = pg_codec::checksum_for(columns, &values);
    let durability = verify_durable_projection(
        pool,
        organization_id,
        id,
        archive_version,
        cold_eligible_at_micros,
    )
    .await?;

    {
        let client = pool
            .get()
            .await
            .context("get PG client for cold_pos_order upsert")?;
        let affected = pg_codec::upsert_row(&client, COLD_TABLE, columns, &values, &checksum)
            .await
            .context("upsert cold_pos_order")?;
        if affected == 0 {
            let organization_id_text = organization_id.to_string();
            let id_text = id.to_string();
            let archived = client
                .query_opt(COLD_ROW_PROOF_SQL, &[&organization_id_text, &id_text])
                .await
                .context("verify existing cold_pos_order retry")?
                .ok_or_else(|| {
                    anyhow!("pos_order {id}: cold UPSERT was a no-op but no archived row exists")
                })?;
            let archived_version: String = archived.get(0);
            let archived_checksum: String = archived.get(1);
            if archived_version != archive_version.to_string() || archived_checksum != checksum {
                return Err(anyhow!(
                    "pos_order {id}: cold UPSERT was a no-op without an exact version/checksum match"
                ));
            }
        }
    }

    ledger::record_transfer(
        pool,
        TABLE,
        &id.to_string(),
        &organization_id.to_string(),
        archive_version as i64,
        &checksum,
    )
    .await
    .context("record archive_transfer")?;

    // The reducer repeats state, obligation, dependency, exact-version, and
    // STDB-side durable watermark checks in the transaction immediately before
    // child-first deletion.  Worker-side proof is therefore advisory until
    // this call succeeds.
    stdb.call_reducer(stdb_client::reducer_call!(
        "finalize_pos_order_archive",
        json!([
            id,
            archive_version,
            cold_eligible_at_micros,
            durability.row_commit_sequence,
            durability.durable_watermark,
            durability.change_schema_version,
            durability.contract_version
        ]),
    ))
    .await
    .context("call finalize_pos_order_archive")?;

    ledger::mark_finalized(pool, TABLE, &id.to_string())
        .await
        .context("mark archive_transfer finalized")?;
    Ok(())
}

#[cfg(test)]
pub(super) async fn drain_one_for_test(
    pool: &Pool,
    source_stdb: &StdbClient,
    finalizer_stdb: &StdbClient,
    columns: &[pg_codec::ColumnCodec],
    raw: &Value,
) -> Result<()> {
    let id = require_u64(raw, "id")?;
    let organization_id = require_u64(raw, "organizationId")?;
    let source_row = source_stdb
        .query_sql(&format!("SELECT * FROM {TABLE} WHERE id = {id}"))
        .await
        .context("read selected pos_order with administrator/source token")?;
    let source_row = select_exact_pos_order_row(source_row, id, Some(organization_id))?
        .ok_or_else(|| anyhow!("source pos_order {id} disappeared before finalization"))?;
    drain_one(pool, finalizer_stdb, columns, &source_row).await
}

fn select_candidates(rows: Vec<Value>, batch_size: u32) -> Result<Vec<Value>> {
    let mut candidates = Vec::with_capacity(rows.len());
    for row in rows {
        let eligible = row
            .get("coldEligibleAt")
            .ok_or_else(|| anyhow!("pos_order candidate is missing coldEligibleAt"))?;
        if eligible.is_null() {
            continue;
        }
        let id = require_u64(&row, "id")?;
        candidates.push((id, row));
    }

    candidates.sort_by_key(|(id, _)| *id);
    let mut seen_ids = BTreeSet::new();
    for (id, _) in &candidates {
        if !seen_ids.insert(*id) {
            bail!("pos_order candidate query returned duplicate id {id}");
        }
    }

    Ok(candidates
        .into_iter()
        .take(batch_size as usize)
        .map(|(_, row)| row)
        .collect())
}

fn select_exact_pos_order_row(
    rows: Vec<Value>,
    expected_id: u64,
    expected_organization_id: Option<u64>,
) -> Result<Option<Value>> {
    match rows.len() {
        0 => Ok(None),
        1 => {
            let row = rows
                .into_iter()
                .next()
                .ok_or_else(|| anyhow!("pos_order row disappeared during cardinality check"))?;
            let id = require_u64(&row, "id")?;
            if id != expected_id {
                bail!("pos_order query returned id {id}; expected exact id {expected_id}");
            }
            if let Some(expected_organization_id) = expected_organization_id {
                let organization_id = require_u64(&row, "organizationId")?;
                if organization_id != expected_organization_id {
                    bail!(
                        "pos_order query returned organization {organization_id}; expected exact organization {expected_organization_id}"
                    );
                }
            }
            Ok(Some(row))
        }
        count => Err(anyhow!(
            "pos_order query returned {count} rows; expected exactly one"
        )),
    }
}

/// Prove the exact current row image is covered by the contiguous PG
/// projection watermark and carries the expected durable schema/contract.
async fn verify_durable_projection(
    pool: &Pool,
    organization_id: u64,
    id: u64,
    archive_version: u64,
    cold_eligible_at_micros: i64,
) -> Result<DurableProjectionProof> {
    let client = pool
        .get()
        .await
        .context("get PG client for pos_order durability proof")?;
    let identity = json!({"id": id}).to_string();
    let organization_id_text = organization_id.to_string();
    let id_text = id.to_string();
    let expected_version = archive_version.to_string();
    let row = client
        .query_opt(
            DURABILITY_PROOF_SQL,
            &[&organization_id_text, &id_text, &identity],
        )
        .await
        .context("query pos_order durable projection proof")?
        .ok_or_else(|| {
            anyhow!("pos_order {id}: exact durable projection and watermark are not yet available")
        })?;
    let durable_version: String = row.try_get(0).context("read durable archive version")?;
    let durable_eligible_at: Option<i64> = row
        .try_get(1)
        .context("read durable eligibility timestamp")?;
    let durable_sequence: String = row.try_get(2).context("read durable row commit sequence")?;
    if durable_version != expected_version || durable_eligible_at != Some(cold_eligible_at_micros) {
        return Err(anyhow!(
            "pos_order {id}: durable version mismatch at commit {durable_sequence}; expected version {expected_version} and eligibility {cold_eligible_at_micros}, found version {durable_version} and eligibility {durable_eligible_at:?}"
        ));
    }
    let durable_watermark: String = row
        .try_get(3)
        .context("read durable projection watermark")?;
    let change_schema_version: i64 = row
        .try_get(4)
        .context("read durable change schema version")?;
    let contract_version: String = row.try_get(5).context("read durable contract version")?;
    let row_commit_sequence: u64 = durable_sequence
        .parse()
        .context("parse durable row commit sequence")?;
    let durable_watermark: u64 = durable_watermark
        .parse()
        .context("parse durable projection watermark")?;
    if row_commit_sequence == 0 || durable_watermark < row_commit_sequence {
        return Err(anyhow!(
            "pos_order {id}: durable watermark {durable_watermark} does not cover row commit {row_commit_sequence}"
        ));
    }
    if change_schema_version != i64::from(commit_projection::CHANGE_SCHEMA_VERSION)
        || contract_version != commit_projection::CONTRACT_VERSION
    {
        return Err(anyhow!(
            "pos_order {id}: durable projection has an incompatible schema/contract version"
        ));
    }
    Ok(DurableProjectionProof {
        row_commit_sequence,
        durable_watermark,
        change_schema_version: checked_change_schema_version(change_schema_version)?,
        contract_version,
    })
}

fn checked_change_schema_version(value: i64) -> Result<u32> {
    value
        .try_into()
        .context("durable change schema version is outside u32 range")
}

fn bounded_batch_size(value: u32) -> Result<u32> {
    if value == 0 || value > MAX_BATCH_SIZE {
        bail!("pos_order finalization batch size must be in 1..={MAX_BATCH_SIZE}");
    }
    Ok(value)
}

fn require_u64(row: &Value, field: &str) -> Result<u64> {
    row.get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("pos_order.{field}: expected u64, got {:?}", row.get(field)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codec_manifest_has_pos_order_cooling_columns() {
        let columns = pg_codec::load_columns(CODEC_MANIFEST_JSON, TABLE).unwrap();
        let names: Vec<&str> = columns.iter().map(|column| column.name.as_str()).collect();
        assert!(names.contains(&"organization_id"));
        assert!(names.contains(&"cold_eligible_at"));
        assert!(names.contains(&"archive_version"));
    }

    #[test]
    fn batch_size_is_positive_and_bounded() {
        assert!(bounded_batch_size(0).is_err());
        assert_eq!(bounded_batch_size(1).unwrap(), 1);
        assert_eq!(bounded_batch_size(MAX_BATCH_SIZE).unwrap(), MAX_BATCH_SIZE);
        assert!(bounded_batch_size(MAX_BATCH_SIZE + 1).is_err());
    }

    #[test]
    fn require_u64_rejects_missing_or_non_numeric_values() {
        assert!(require_u64(&json!({}), "id").is_err());
        assert!(require_u64(&json!({"id": "7"}), "id").is_err());
        assert_eq!(require_u64(&json!({"id": 7}), "id").unwrap(), 7);
    }

    #[test]
    fn durability_proof_requires_exact_identity_version_and_watermark() {
        assert!(DURABILITY_PROOF_SQL.contains("row_identity_json = $3::TEXT::JSONB"));
        assert!(
            DURABILITY_PROOF_SQL.contains("watermark.applied_sequence >= change.commit_sequence")
        );
        assert!(DURABILITY_PROOF_SQL.contains("envelope.sequence = change.commit_sequence"));
        assert!(DURABILITY_PROOF_SQL.contains("envelope.change_schema_version"));
        assert!(DURABILITY_PROOF_SQL.contains("envelope.contract_version"));
        assert!(DURABILITY_PROOF_SQL.contains("projected.organization_id = $1::TEXT::NUMERIC"));
        assert!(DURABILITY_PROOF_SQL.contains("projected.id = $2::TEXT::NUMERIC"));
        assert!(COLD_ROW_PROOF_SQL.contains("archive_version::TEXT"));
        assert!(COLD_ROW_PROOF_SQL.contains("payload_checksum"));
        assert!(COLD_ROW_PROOF_SQL.contains("organization_id = $1::TEXT::NUMERIC"));
    }

    #[test]
    fn durability_proof_decodes_postgres_bigint_schema_version_safely() {
        let expected = i64::from(commit_projection::CHANGE_SCHEMA_VERSION);
        assert_eq!(
            checked_change_schema_version(expected).unwrap(),
            expected as u32
        );
        assert!(checked_change_schema_version(-1).is_err());
        assert!(checked_change_schema_version(i64::from(u32::MAX) + 1).is_err());
    }

    fn candidate(id: u64, eligible: Value) -> Value {
        json!({
            "id": id,
            "organizationId": 7,
            "coldEligibleAt": eligible,
        })
    }

    #[test]
    fn candidate_selection_filters_sorts_and_bounds_in_rust() {
        let selected = select_candidates(
            vec![
                candidate(9, json!({"microsSinceUnixEpoch": 9})),
                candidate(2, Value::Null),
                candidate(4, json!({"microsSinceUnixEpoch": 4})),
                candidate(1, json!({"microsSinceUnixEpoch": 1})),
            ],
            2,
        )
        .unwrap();
        assert_eq!(
            selected
                .iter()
                .map(|row| row["id"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![1, 4]
        );
    }

    #[test]
    fn candidate_selection_rejects_duplicate_ids_and_missing_eligibility() {
        let duplicate = select_candidates(
            vec![
                candidate(4, json!({"microsSinceUnixEpoch": 4})),
                candidate(4, json!({"microsSinceUnixEpoch": 5})),
            ],
            10,
        );
        assert!(duplicate.unwrap_err().to_string().contains("duplicate id"));

        let missing = select_candidates(vec![json!({"id": 4})], 10);
        assert!(missing
            .unwrap_err()
            .to_string()
            .contains("missing coldEligibleAt"));
    }

    #[test]
    fn exact_row_selection_requires_scope_and_cardinality() {
        assert!(select_exact_pos_order_row(Vec::new(), 4, Some(7))
            .unwrap()
            .is_none());
        assert!(select_exact_pos_order_row(
            vec![candidate(4, json!({"microsSinceUnixEpoch": 4}))],
            4,
            Some(7),
        )
        .unwrap()
        .is_some());
        assert!(select_exact_pos_order_row(
            vec![
                candidate(4, json!({"microsSinceUnixEpoch": 4})),
                candidate(4, json!({"microsSinceUnixEpoch": 5})),
            ],
            4,
            Some(7),
        )
        .unwrap_err()
        .to_string()
        .contains("exactly one"));
        assert!(select_exact_pos_order_row(
            vec![candidate(4, json!({"microsSinceUnixEpoch": 4}))],
            5,
            Some(7),
        )
        .unwrap_err()
        .to_string()
        .contains("expected exact id"));
        assert!(select_exact_pos_order_row(
            vec![json!({
                "id": 4,
                "organizationId": 8,
                "coldEligibleAt": {"microsSinceUnixEpoch": 4},
            })],
            4,
            Some(7),
        )
        .unwrap_err()
        .to_string()
        .contains("expected exact organization"));
    }
}
