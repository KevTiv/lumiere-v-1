use super::{
    apply_commit, canonical_json, load_projection_codec, make_change, matrix_commit,
    primary_key_value, synthetic_value, MatrixEntry, ProjectionMode, ProjectionResult,
};
use crate::cold_tier::{migrate, pg_pool, projection_worker};
use anyhow::{Context, Result};
use deadpool_postgres::Pool;
use serde_json::{Map, Value};
use std::time::{SystemTime, UNIX_EPOCH};

const AUDIT_LOG: &str = "audit_log";
const POS_ORDER: &str = "pos_order";

/// Exercise the two legacy cold workers through the generic commit projector.
///
/// `audit_log` is append-history: a replay must not create a second row and a
/// later append must preserve the earlier row. `pos_order` is upsert-current:
/// its create, update, replay, and delete must all share the same durable
/// organization cursor and ledger.
#[tokio::test]
async fn postgres_legacy_worker_resource_parity() -> Result<()> {
    if std::env::var("C3_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping postgres_legacy_worker_resource_parity (set C3_TEST_PG=1 to run)");
        return Ok(());
    }

    let config = pg_pool::PgConfig::from_env()?;
    let pool = pg_pool::build_pool(&config)?;
    let relation_count = projection_worker::ensure_projection_relations(
        &pool,
        projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
    )
    .await?;
    assert!(relation_count > 0);
    migrate::ensure_schema(&pool).await?;

    let organization_id = unique_organization_id()?;
    let audit = resource_entry(AUDIT_LOG, ProjectionMode::AppendHistory, organization_id, 0)?;
    let pos = resource_entry(POS_ORDER, ProjectionMode::UpsertCurrent, organization_id, 1)?;

    let create_changes = vec![
        resource_change(
            organization_id,
            1,
            0,
            &audit,
            "upsert",
            Some(&audit.initial_row),
        )?,
        resource_change(
            organization_id,
            1,
            1,
            &pos,
            "upsert",
            Some(&pos.initial_row),
        )?,
    ];
    let create_commit = matrix_commit(organization_id, 1, &create_changes);
    assert_eq!(
        apply_commit(
            &pool,
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
            &create_commit,
            &create_changes,
        )
        .await?,
        ProjectionResult::Applied
    );
    assert_eq!(count_rows(&pool, AUDIT_LOG, organization_id).await?, 1);
    assert_eq!(count_rows(&pool, POS_ORDER, organization_id).await?, 1);
    assert_eq!(projection_watermark(&pool, organization_id).await?, Some(1));
    assert_eq!(
        ledger_count(&pool, organization_id, "organization_commit").await?,
        1
    );
    assert_eq!(
        ledger_count(&pool, organization_id, "organization_row_change").await?,
        2
    );
    let initial_pos = current_row_json(&pool, POS_ORDER, organization_id).await?;

    // Exact duplicate delivery is acknowledged from the durable watermark and
    // must not duplicate either the append-history row or its ledger changes.
    assert_eq!(
        apply_commit(
            &pool,
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
            &create_commit,
            &create_changes,
        )
        .await?,
        ProjectionResult::AlreadyApplied
    );
    assert_eq!(count_rows(&pool, AUDIT_LOG, organization_id).await?, 1);
    assert_eq!(count_rows(&pool, POS_ORDER, organization_id).await?, 1);
    assert_eq!(
        ledger_count(&pool, organization_id, "organization_commit").await?,
        1
    );
    assert_eq!(
        ledger_count(&pool, organization_id, "organization_row_change").await?,
        2
    );

    let audit_second =
        resource_entry(AUDIT_LOG, ProjectionMode::AppendHistory, organization_id, 2)?;
    let updated_pos_row = row_for(&pos, organization_id, 1, 2);
    let update_changes = vec![
        resource_change(
            organization_id,
            2,
            0,
            &audit_second,
            "upsert",
            Some(&audit_second.initial_row),
        )?,
        resource_change(
            organization_id,
            2,
            1,
            &pos,
            "upsert",
            Some(&updated_pos_row),
        )?,
    ];
    let update_commit = matrix_commit(organization_id, 2, &update_changes);
    assert_eq!(
        apply_commit(
            &pool,
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
            &update_commit,
            &update_changes,
        )
        .await?,
        ProjectionResult::Applied
    );
    assert_eq!(count_rows(&pool, AUDIT_LOG, organization_id).await?, 2);
    assert_eq!(count_rows(&pool, POS_ORDER, organization_id).await?, 1);
    assert_ne!(
        initial_pos,
        current_row_json(&pool, POS_ORDER, organization_id).await?
    );
    assert_eq!(projection_watermark(&pool, organization_id).await?, Some(2));
    assert_eq!(
        ledger_count(&pool, organization_id, "organization_commit").await?,
        2
    );
    assert_eq!(
        ledger_count(&pool, organization_id, "organization_row_change").await?,
        4
    );

    // Replay of a mixed append/update commit remains idempotent after a later
    // sequence has been applied, because the checksum is the commit identity.
    assert_eq!(
        apply_commit(
            &pool,
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
            &update_commit,
            &update_changes,
        )
        .await?,
        ProjectionResult::AlreadyApplied
    );
    assert_eq!(count_rows(&pool, AUDIT_LOG, organization_id).await?, 2);
    assert_eq!(count_rows(&pool, POS_ORDER, organization_id).await?, 1);
    assert_eq!(
        ledger_count(&pool, organization_id, "organization_commit").await?,
        2
    );
    assert_eq!(
        ledger_count(&pool, organization_id, "organization_row_change").await?,
        4
    );

    let delete_change = resource_change(organization_id, 3, 0, &pos, "delete", None)?;
    let delete_commit = matrix_commit(organization_id, 3, std::slice::from_ref(&delete_change));
    assert_eq!(
        apply_commit(
            &pool,
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
            &delete_commit,
            std::slice::from_ref(&delete_change),
        )
        .await?,
        ProjectionResult::Applied
    );
    assert_eq!(count_rows(&pool, AUDIT_LOG, organization_id).await?, 2);
    assert_eq!(count_rows(&pool, POS_ORDER, organization_id).await?, 0);
    assert_eq!(projection_watermark(&pool, organization_id).await?, Some(3));
    assert_eq!(
        ledger_count(&pool, organization_id, "organization_commit").await?,
        3
    );
    assert_eq!(
        ledger_count(&pool, organization_id, "organization_row_change").await?,
        5
    );
    Ok(())
}

fn unique_organization_id() -> Result<u64> {
    let now_micros = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("read clock for legacy worker parity organization")?
        .as_micros() as u64;
    Ok(2_000_000_000_000_000_000_u64
        + (now_micros % 900_000_000_000_000_000_u64)
        + u64::from(std::process::id()))
}

fn resource_entry(
    table: &str,
    expected_mode: ProjectionMode,
    organization_id: u64,
    key_index: u64,
) -> Result<MatrixEntry> {
    let codec = load_projection_codec(projection_worker::PROJECTION_CODEC_MANIFEST_JSON, table)?;
    assert_eq!(
        codec.projection_mode, expected_mode,
        "{table} projection mode"
    );
    let identity = primary_key_value(&codec, organization_id, key_index)?;
    let identity_json = canonical_json(&identity)?;
    let initial_row = row_for_codec(&codec, &identity, organization_id, key_index, 1);
    Ok(MatrixEntry {
        module: String::new(),
        projection_mode: match expected_mode {
            ProjectionMode::UpsertCurrent => "upsert-current".to_string(),
            ProjectionMode::AppendHistory => "append-history".to_string(),
        },
        table: table.to_string(),
        codec,
        identity_json,
        initial_row,
    })
}

fn row_for(entry: &MatrixEntry, organization_id: u64, key_index: u64, version: u64) -> Value {
    let identity: Value = serde_json::from_str(&entry.identity_json).expect("identity JSON");
    row_for_codec(&entry.codec, &identity, organization_id, key_index, version)
}

fn row_for_codec(
    codec: &super::ProjectionCodec,
    identity: &Value,
    organization_id: u64,
    key_index: u64,
    version: u64,
) -> Value {
    let mut row = Map::new();
    for column in &codec.columns {
        row.insert(
            column.name.clone(),
            synthetic_value(column, codec, identity, organization_id, key_index, version),
        );
    }
    Value::Object(row)
}

fn resource_change(
    organization_id: u64,
    sequence: u64,
    ordinal: u32,
    entry: &MatrixEntry,
    kind: &str,
    row: Option<&Value>,
) -> Result<super::OrganizationRowChangeInput> {
    make_change(organization_id, sequence, ordinal, entry, kind, row)
}

async fn count_rows(pool: &Pool, table: &str, organization_id: u64) -> Result<i64> {
    super::count_projection_rows(pool, table, organization_id).await
}

async fn current_row_json(pool: &Pool, table: &str, organization_id: u64) -> Result<String> {
    let client = pool.get().await?;
    let organization_id = organization_id.to_string();
    let table = crate::cold_tier::conventions::quote_identifier(table)?;
    Ok(client
        .query_one(
            &format!(
                "SELECT row_to_json(projection_row)::TEXT FROM (SELECT * FROM {table} WHERE \"organization_id\" = $1::TEXT::NUMERIC ORDER BY id LIMIT 1) projection_row"
            ),
            &[&organization_id],
        )
        .await?
        .get(0))
}

async fn projection_watermark(pool: &Pool, organization_id: u64) -> Result<Option<u64>> {
    super::projection_watermark(pool, organization_id).await
}

async fn ledger_count(pool: &Pool, organization_id: u64, table: &str) -> Result<i64> {
    let client = pool.get().await?;
    let organization_id = organization_id.to_string();
    let table = crate::cold_tier::conventions::quote_identifier(table)?;
    Ok(client
        .query_one(
            &format!("SELECT count(*) FROM {table} WHERE organization_id = $1::TEXT::NUMERIC"),
            &[&organization_id],
        )
        .await?
        .get(0))
}
