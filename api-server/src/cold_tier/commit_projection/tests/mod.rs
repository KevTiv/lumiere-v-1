use super::apply::apply_commit;
use super::checksum::{
    canonical_json, change_checksum, commit_checksum, commit_id, projection_plan,
};
use super::prepare::{load_projection_codec, validate_commit, validate_sequence};
use super::sql::build_upsert_sql;
use super::*;
use crate::cold_tier::conventions::quote_identifier;
use crate::cold_tier::pg_codec::{ColumnCodec, PgValue};
use crate::cold_tier::{migrate, pg_pool, projection_observability, projection_worker};
use anyhow::{anyhow, bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::time::{SystemTime, UNIX_EPOCH};

const STORAGE_POLICY_MANIFEST_JSON: &str =
    include_str!("../../../../../lumiere-codegen/storage-policy-manifest.json");

fn manifest() -> String {
    json!({
            "tables": {
                "parent": {
                    "projection_table": "parent",
                    "projection_mode": "upsert-current",
                    "primary_key": {"name": "id", "type": "U64"},
                    "organization_column": "organization_id",
                    "postgres_access_path": "organization_index",
                    "columns": [
                        {"name":"id","stdb_type":"U64","pg_type":"NUMERIC(20,0)","nullable":false,"pg_bind":"to_sql_numeric","pg_from":"from_sql_numeric_to_string","api_json":"string"},
                        {"name":"organization_id","stdb_type":"U64","pg_type":"NUMERIC(20,0)","nullable":false,"pg_bind":"to_sql_numeric","pg_from":"from_sql_numeric_to_string","api_json":"string"},
                        {"name":"name","stdb_type":"String","pg_type":"TEXT","nullable":false,"pg_bind":"to_sql_text","pg_from":"from_sql_text","api_json":"string"}
                    ]
                }
            }
        }).to_string()
}

fn change(kind: &str, row: Option<&str>, ordinal: u32) -> OrganizationRowChangeInput {
    let identity = r#"{"id":5}"#;
    let checksum = change_checksum("parent", identity, kind, row.unwrap_or(""));
    OrganizationRowChangeInput {
        id: format!("7:1:{ordinal}"),
        organization_id: 7,
        commit_sequence: 1,
        ordinal,
        table_name: "parent".into(),
        row_identity_json: identity.into(),
        change_kind: kind.into(),
        row_json: row.map(str::to_string),
        checksum,
    }
}

fn commit(changes: &[OrganizationRowChangeInput], count: u32) -> OrganizationCommitEnvelope {
    let mut value = OrganizationCommitEnvelope {
        id: "7:1".into(),
        organization_id: 7,
        sequence: 1,
        operation_id: "erp.create_task".into(),
        correlation_id: "request-1".into(),
        change_schema_version: CHANGE_SCHEMA_VERSION,
        contract_version: "ir-v2".into(),
        occurred_at_micros: 1,
        actor_identity_hex: "00".repeat(32),
        row_change_count: count,
        checksum: String::new(),
    };
    let prepared = changes
        .iter()
        .map(|input| PreparedChange {
            input: input.clone(),
            codec: ProjectionCodec {
                table_name: "parent".into(),
                projection_mode: ProjectionMode::UpsertCurrent,
                primary_key: "id".into(),
                organization_column: "organization_id".into(),
                organization_partitioned: false,
                columns: vec![],
            },
            values: vec![],
            key_value: PgValue::NumericText(None),
        })
        .collect::<Vec<_>>();
    value.checksum = commit_checksum(&value, &prepared);
    value
}

#[test]
fn rejects_sequence_gap() {
    assert!(validate_sequence(None, 2).is_err());
    assert!(validate_sequence(Some(3), 5).is_err());
}

#[test]
fn upsert_sql_guards_existing_tenant() {
    let codec = ProjectionCodec {
        table_name: "parent".into(),
        projection_mode: ProjectionMode::UpsertCurrent,
        primary_key: "id".into(),
        organization_column: "organization_id".into(),
        organization_partitioned: false,
        columns: vec![
            ColumnCodec {
                name: "id".into(),
                pg_type: "NUMERIC(20,0)".into(),
                stdb_type: "U64".into(),
                nullable: false,
            },
            ColumnCodec {
                name: "organization_id".into(),
                pg_type: "NUMERIC(20,0)".into(),
                stdb_type: "U64".into(),
                nullable: false,
            },
            ColumnCodec {
                name: "name".into(),
                pg_type: "TEXT".into(),
                stdb_type: "String".into(),
                nullable: false,
            },
        ],
    };
    let sql = build_upsert_sql(&codec, 3).unwrap();
    assert!(sql.contains("INSERT INTO \"parent\" AS target"));
    assert!(sql.contains("ON CONFLICT (\"id\") DO UPDATE"));
    assert!(sql.contains("WHERE target.\"organization_id\" = $4::TEXT::NUMERIC"));

    let mut partitioned_codec = codec.clone();
    partitioned_codec.organization_partitioned = true;
    let partitioned_sql = build_upsert_sql(&partitioned_codec, 3).unwrap();
    assert!(partitioned_sql.contains("ON CONFLICT (\"organization_id\", \"id\") DO UPDATE"));

    let mut history_codec = codec;
    history_codec.projection_mode = ProjectionMode::AppendHistory;
    let history_sql = build_upsert_sql(&history_codec, 3).unwrap();
    assert!(history_sql.contains("ON CONFLICT (\"id\") DO NOTHING"));
    assert!(!history_sql.contains("DO UPDATE"));
}

#[test]
fn append_history_rejects_delete_changes() {
    let mut history_manifest: Value =
        serde_json::from_str(&manifest()).expect("test manifest JSON");
    history_manifest["tables"]["parent"]["projection_mode"] = json!("append-history");
    let change = change("delete", None, 0);
    let error = validate_commit(
        &history_manifest.to_string(),
        &commit(std::slice::from_ref(&change), 1),
        &[change],
    )
    .unwrap_err();
    assert!(error.to_string().contains("does not accept delete"));
}

#[test]
fn rejects_noncanonical_contract_and_operation_ids() {
    let row = r#"{"id":5,"name":"ok","organization_id":7}"#;
    let change = change("upsert", Some(row), 0);
    let mut envelope = commit(std::slice::from_ref(&change), 1);
    envelope.contract_version = "ir-v1".into();
    assert!(validate_commit(&manifest(), &envelope, std::slice::from_ref(&change)).is_err());

    let mut envelope = commit(std::slice::from_ref(&change), 1);
    envelope.operation_id = "create-parent".into();
    assert!(validate_commit(&manifest(), &envelope, &[change.clone()]).is_err());

    let mut envelope = commit(std::slice::from_ref(&change), 1);
    envelope.operation_id = "erp.create_parent".into();
    assert!(validate_commit(&manifest(), &envelope, &[change]).is_err());
}

#[test]
fn rejects_non_projected_codec_modes() {
    let mut manifest: Value = serde_json::from_str(&manifest()).expect("test manifest JSON");
    manifest["tables"]["parent"]["projection_mode"] = json!("snapshot");
    assert!(load_projection_codec(&manifest.to_string(), "parent").is_err());

    manifest["tables"]["parent"]
        .as_object_mut()
        .unwrap()
        .remove("projection_mode");
    assert!(load_projection_codec(&manifest.to_string(), "parent").is_err());
}

#[test]
fn matrix_skips_storage_snapshot_and_external_reference_modes() {
    let entries = manifest_matrix(7).expect("checked-in projection manifests");
    assert!(entries.iter().all(|entry| matches!(
        entry.projection_mode.as_str(),
        "upsert-current" | "append-history"
    )));
}

#[test]
fn rejects_count_and_checksum_mismatch() {
    let row = r#"{"id":5,"name":"ok","organization_id":7}"#;
    let change = change("upsert", Some(row), 0);
    assert!(validate_commit(
        &manifest(),
        &commit(&[change.clone()], 2),
        &[change.clone()]
    )
    .is_err());
    let mut bad = change;
    bad.checksum = "00".repeat(32);
    assert!(validate_commit(&manifest(), &commit(&[bad.clone()], 1), &[bad]).is_err());
}

#[test]
fn validates_delete_as_identity_only_tombstone() {
    let change = change("delete", None, 0);
    let prepared = validate_commit(
        &manifest(),
        &commit(std::slice::from_ref(&change), 1),
        &[change],
    )
    .unwrap();
    assert!(prepared[0].values.is_empty());
}

#[test]
fn atomic_plan_inserts_and_applies_all_changes_before_watermark() {
    let plan = projection_plan(&["upsert", "delete"]);
    assert_eq!(
        plan,
        vec![
            "lock_watermark",
            "insert_commit",
            "insert_change:0",
            "insert_change:1",
            "apply_change:0",
            "apply_change:1",
            "advance_watermark",
            "commit"
        ]
    );
}

/// Exercise the actual PG projection relation set from one representative
/// table per module and supported projection mode. The table list is
/// intentionally derived from the checked-in manifests: adding a module or
/// mode changes this test without another hand-maintained matrix.
#[tokio::test]
async fn postgres_manifest_matrix() -> Result<()> {
    if std::env::var("C3_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping postgres_manifest_matrix (set C3_TEST_PG=1 to run)");
        return Ok(());
    }

    let config = pg_pool::PgConfig::from_env()?;
    let pool = pg_pool::build_pool(&config)?;
    // Reproduce the deployed C3 state first: organization projections are
    // ordinary heap tables. The C4 baseline must adopt that layout before
    // fresh databases begin using policy-selected hash partitions.
    let relation_count = projection_worker::ensure_projection_relations(
        &pool,
        projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
    )
    .await?;
    assert!(relation_count > 0);
    migrate::ensure_schema(&pool).await?;

    let now_micros = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("read clock for C3 PostgreSQL matrix organization")?
        .as_micros() as u64;
    let organization_id = 1_000_000_000_000_000_000_u64
        + (now_micros % 900_000_000_000_000_000_u64)
        + u64::from(std::process::id());
    let entries = manifest_matrix(organization_id)?;
    assert!(entries.len() >= 2, "expected multiple enabled C3 modules");
    assert!(entries
        .iter()
        .all(|entry| !entry.module.is_empty() && !entry.projection_mode.is_empty()));
    assert!(entries
        .iter()
        .any(|entry| entry.projection_mode == "upsert-current"));
    assert!(entries
        .iter()
        .any(|entry| entry.projection_mode == "append-history"));
    let all_modules = entries
        .iter()
        .map(|entry| entry.module.as_str())
        .collect::<BTreeSet<_>>();
    let mutable_modules = entries
        .iter()
        .filter(|entry| entry.projection_mode == "upsert-current")
        .map(|entry| entry.module.as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        mutable_modules, all_modules,
        "every enabled module needs an upsert-current create/update/delete fixture"
    );

    let create_changes = changes_for_upsert(&entries, organization_id, 1);
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
    for entry in &entries {
        assert_eq!(
            count_projection_rows(&pool, &entry.table, organization_id).await?,
            1
        );
    }

    // Replaying the exact durable commit is a no-op, including its rows.
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
    assert_eq!(projection_watermark(&pool, organization_id).await?, Some(1));
    let before_update: Vec<String> = futures_snapshot(&pool, &entries, organization_id).await?;

    // A fresh pool models process restart. Sequence two must update every
    // representative row and advance the same durable watermark.
    drop(pool);
    let restarted_pool = pg_pool::build_pool(&config)?;
    let update_changes = changes_for_update(&entries, organization_id, 2);
    let update_commit = matrix_commit(organization_id, 2, &update_changes);
    assert_eq!(
        apply_commit(
            &restarted_pool,
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
            &update_commit,
            &update_changes,
        )
        .await?,
        ProjectionResult::Applied
    );
    let after_update = futures_snapshot(&restarted_pool, &entries, organization_id).await?;
    for ((entry, before), after) in entries
        .iter()
        .zip(before_update.iter())
        .zip(after_update.iter())
    {
        if entry.projection_mode == "upsert-current" {
            assert_ne!(before, after, "restart/update must change {}", entry.table);
        } else {
            assert_eq!(before, after, "append-history row must remain immutable");
        }
    }

    let delete_changes = changes_for_delete(&entries, organization_id, 3);
    let delete_commit = matrix_commit(organization_id, 3, &delete_changes);
    assert_eq!(
        apply_commit(
            &restarted_pool,
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
            &delete_commit,
            &delete_changes,
        )
        .await?,
        ProjectionResult::Applied
    );
    for entry in &entries {
        let expected = i64::from(entry.projection_mode == "append-history");
        assert_eq!(
            count_projection_rows(&restarted_pool, &entry.table, organization_id).await?,
            expected
        );
    }
    assert_eq!(
        projection_watermark(&restarted_pool, organization_id).await?,
        Some(3)
    );

    // Sequence four is deliberately omitted. A valid-looking sequence
    // five commit must be rejected before any ledger, row, or watermark
    // mutation occurs.
    let gap_changes = changes_for_upsert(&entries[..1], organization_id, 5);
    let gap_commit = matrix_commit(organization_id, 5, &gap_changes);
    let error = apply_commit(
        &restarted_pool,
        projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
        &gap_commit,
        &gap_changes,
    )
    .await
    .expect_err("injected sequence gap must be rejected");
    assert!(error.to_string().contains("gap or rewind"));
    assert_eq!(
        projection_watermark(&restarted_pool, organization_id).await?,
        Some(3)
    );
    projection_observability::record_projection_failure(
        &restarted_pool,
        organization_id,
        5,
        3,
        Some(gap_commit.occurred_at_micros),
        "gap",
        &error.to_string(),
        None,
    )
    .await?;
    let gap_status =
        projection_observability::read_projection_status(&restarted_pool, organization_id)
            .await?
            .expect("gap status must be visible");
    assert_eq!(gap_status.backlog_commits, 2);
    assert_eq!(gap_status.durable_sequence, 3);
    assert!(gap_status
        .last_error
        .as_deref()
        .is_some_and(|value| value.contains("gap")));
    assert_eq!(gap_status.quarantined_sequence, None);

    projection_observability::record_projection_failure(
        &restarted_pool,
        organization_id,
        5,
        3,
        Some(gap_commit.occurred_at_micros),
        "malformed_commit",
        "unsupported contract version",
        Some(4),
    )
    .await?;
    let quarantine_status =
        projection_observability::read_projection_status(&restarted_pool, organization_id)
            .await?
            .expect("quarantine status must be visible");
    assert_eq!(quarantine_status.quarantined_sequence, Some(4));
    assert_eq!(
        projection_watermark(&restarted_pool, organization_id).await?,
        Some(3),
        "quarantine must not skip the blocked sequence"
    );
    for entry in &entries {
        let expected = i64::from(entry.projection_mode == "append-history");
        assert_eq!(
            count_projection_rows(&restarted_pool, &entry.table, organization_id).await?,
            expected
        );
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct MatrixEntry {
    module: String,
    projection_mode: String,
    table: String,
    codec: ProjectionCodec,
    identity_json: String,
    initial_row: Value,
}

fn manifest_matrix(organization_id: u64) -> Result<Vec<MatrixEntry>> {
    let storage: Value = serde_json::from_str(STORAGE_POLICY_MANIFEST_JSON)?;
    let codec_manifest: Value =
        serde_json::from_str(projection_worker::PROJECTION_CODEC_MANIFEST_JSON)?;
    let policies = storage
        .get("policies")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("storage policy manifest lacks policies"))?;
    let mut selected = BTreeMap::<(String, String), String>::new();
    for policy in policies {
        if policy.get("enabled").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        let Some(mode) = policy.get("projection_mode").and_then(Value::as_str) else {
            bail!("storage policy lacks projection_mode");
        };
        if !matches!(mode, "upsert-current" | "append-history") {
            continue;
        }
        let module = policy
            .get("module")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("storage policy lacks module"))?;
        let table = policy
            .get("table")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("storage policy lacks table"))?;
        selected
            .entry((module.to_string(), mode.to_string()))
            .and_modify(|current| {
                if table < current.as_str() {
                    *current = table.to_string();
                }
            })
            .or_insert_with(|| table.to_string());
    }

    selected
            .into_iter()
            .enumerate()
            .map(|(index, ((module, projection_mode), table))| {
                let codec_entry = codec_manifest
                    .get("tables")
                    .and_then(|tables| tables.get(&table))
                    .ok_or_else(|| anyhow!("storage policy table '{table}' is absent from projection codec"))?;
                if codec_entry.get("module").and_then(Value::as_str) != Some(module.as_str())
                    || codec_entry.get("projection_mode").and_then(Value::as_str)
                        != Some(projection_mode.as_str())
                {
                    bail!(
                        "projection codec metadata for '{table}' does not match storage policy {module}/{projection_mode}"
                    );
                }
                let codec = load_projection_codec(
                    projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
                    &table,
                )?;
                let identity = primary_key_value(&codec, organization_id, index as u64)?;
                let mut row = Map::new();
                for column in &codec.columns {
                    row.insert(
                        column.name.clone(),
                        synthetic_value(
                            column,
                            &codec,
                            &identity,
                            organization_id,
                            index as u64,
                            1,
                        ),
                    );
                }
                let row = Value::Object(row);
                let identity_json = canonical_json(&identity)?;
                // Keep this assertion close to manifest selection so a policy
                // can never silently select a non-projectable relation.
                Ok(MatrixEntry {
                    module,
                    projection_mode,
                    table,
                    codec,
                    identity_json,
                    initial_row: row,
                })
            })
            .collect()
}

fn primary_key_value(codec: &ProjectionCodec, organization_id: u64, index: u64) -> Result<Value> {
    let key = codec
        .columns
        .iter()
        .find(|column| column.name == codec.primary_key)
        .ok_or_else(|| anyhow!("primary key is absent from codec"))?;
    let key_value = if codec.primary_key == codec.organization_column {
        json!(organization_id)
    } else {
        match key.pg_type.as_str() {
            "NUMERIC(20,0)" => json!(organization_id + 10_000 + index),
            "BIGINT" => json!(organization_id as i64 + 10_000 + index as i64),
            "INTEGER" => json!((organization_id % 2_000_000_000) as i32 + index as i32),
            "DOUBLE PRECISION" => {
                json!((organization_id % 1_000_000_000) as f64 + index as f64)
            }
            "REAL" => json!((organization_id % 1_000_000) as f32 + index as f32),
            "BOOLEAN" => json!(true),
            "BYTEA" => json!(format!("{:064x}", organization_id + index)),
            "TEXT" => json!(format!("c3-key-{organization_id}-{index}")),
            other => bail!("unsupported synthetic primary-key type {other}"),
        }
    };
    let mut identity = Map::new();
    identity.insert(codec.primary_key.clone(), key_value);
    Ok(Value::Object(identity))
}

fn synthetic_value(
    column: &ColumnCodec,
    codec: &ProjectionCodec,
    identity: &Value,
    organization_id: u64,
    index: u64,
    version: u64,
) -> Value {
    if column.name == codec.primary_key {
        return identity
            .as_object()
            .and_then(|object| object.get(&codec.primary_key))
            .cloned()
            .unwrap_or(Value::Null);
    }
    if column.name == codec.organization_column {
        return json!(organization_id);
    }
    if column.nullable && version == 1 {
        return Value::Null;
    }
    match column.pg_type.as_str() {
        "NUMERIC(20,0)" => json!(20_000_u64 + index + version),
        "BIGINT" if column.stdb_type == "Timestamp" => {
            json!({"microsSinceUnixEpoch": 1_700_000_000_000_000_i64 + index as i64 + version as i64})
        }
        "BIGINT" => json!(20_000_i64 + index as i64 + version as i64),
        "INTEGER" => json!(20_000_i32 + index as i32 + version as i32),
        "DOUBLE PRECISION" => json!(20_000.25_f64 + index as f64 + version as f64),
        "REAL" => json!(20_000.25_f32 + index as f32 + version as f32),
        "BOOLEAN" => json!(version % 2 == 0),
        "BYTEA" => json!("11".repeat(32)),
        "JSONB" if column.stdb_type.starts_with("Vec(") => json!([index, version]),
        "JSONB" => json!({"c3": version}),
        "TEXT" => json!(format!("c3-{}-{}", column.name, version)),
        _ => Value::Null,
    }
}

fn make_change(
    organization_id: u64,
    sequence: u64,
    ordinal: u32,
    entry: &MatrixEntry,
    kind: &str,
    row: Option<&Value>,
) -> Result<OrganizationRowChangeInput> {
    let row_json = row.map(canonical_json).transpose()?;
    let checksum = change_checksum(
        &entry.table,
        &entry.identity_json,
        kind,
        row_json.as_deref().unwrap_or(""),
    );
    Ok(OrganizationRowChangeInput {
        id: format!("{organization_id}:{sequence}:{ordinal}"),
        organization_id,
        commit_sequence: sequence,
        ordinal,
        table_name: entry.table.clone(),
        row_identity_json: entry.identity_json.clone(),
        change_kind: kind.to_string(),
        row_json,
        checksum,
    })
}

fn changes_for_upsert(
    entries: &[MatrixEntry],
    organization_id: u64,
    sequence: u64,
) -> Vec<OrganizationRowChangeInput> {
    entries
        .iter()
        .enumerate()
        .map(|(ordinal, entry)| {
            make_change(
                organization_id,
                sequence,
                ordinal as u32,
                entry,
                "upsert",
                Some(&entry.initial_row),
            )
            .expect("synthetic upsert change")
        })
        .collect()
}

fn changes_for_update(
    entries: &[MatrixEntry],
    organization_id: u64,
    sequence: u64,
) -> Vec<OrganizationRowChangeInput> {
    entries
        .iter()
        .filter(|entry| entry.projection_mode == "upsert-current")
        .enumerate()
        .map(|(ordinal, entry)| {
            let identity: Value =
                serde_json::from_str(&entry.identity_json).expect("identity JSON");
            let mut row = Map::new();
            for column in &entry.codec.columns {
                row.insert(
                    column.name.clone(),
                    synthetic_value(
                        column,
                        &entry.codec,
                        &identity,
                        organization_id,
                        ordinal as u64,
                        2,
                    ),
                );
            }
            // `synthetic_value` derives the key from identity; keep the
            // exact initial identity even for non-standard primary keys.
            row.insert(
                entry.codec.primary_key.clone(),
                identity
                    .as_object()
                    .and_then(|object| object.get(&entry.codec.primary_key))
                    .cloned()
                    .expect("identity primary key"),
            );
            make_change(
                organization_id,
                sequence,
                ordinal as u32,
                entry,
                "upsert",
                Some(&Value::Object(row)),
            )
            .expect("synthetic update change")
        })
        .collect()
}

fn changes_for_delete(
    entries: &[MatrixEntry],
    organization_id: u64,
    sequence: u64,
) -> Vec<OrganizationRowChangeInput> {
    entries
        .iter()
        .filter(|entry| entry.projection_mode == "upsert-current")
        .enumerate()
        .map(|(ordinal, entry)| {
            make_change(
                organization_id,
                sequence,
                ordinal as u32,
                entry,
                "delete",
                None,
            )
            .expect("synthetic delete change")
        })
        .collect()
}

fn matrix_commit(
    organization_id: u64,
    sequence: u64,
    changes: &[OrganizationRowChangeInput],
) -> OrganizationCommitEnvelope {
    let mut commit = OrganizationCommitEnvelope {
        id: commit_id(organization_id, sequence),
        organization_id,
        sequence,
        operation_id: "erp.create_task".to_string(),
        correlation_id: format!("c3-matrix-{organization_id}-{sequence}"),
        change_schema_version: CHANGE_SCHEMA_VERSION,
        contract_version: CONTRACT_VERSION.to_string(),
        occurred_at_micros: 1_700_000_000_000_000 + sequence as i64,
        actor_identity_hex: "00".repeat(32),
        row_change_count: changes.len() as u32,
        checksum: String::new(),
    };
    let prepared = changes
        .iter()
        .cloned()
        .map(|input| PreparedChange {
            input,
            codec: ProjectionCodec {
                table_name: String::new(),
                projection_mode: ProjectionMode::UpsertCurrent,
                primary_key: String::new(),
                organization_column: String::new(),
                organization_partitioned: false,
                columns: Vec::new(),
            },
            values: Vec::new(),
            key_value: PgValue::NumericText(None),
        })
        .collect::<Vec<_>>();
    commit.checksum = commit_checksum(&commit, &prepared);
    commit
}

async fn count_projection_rows(pool: &Pool, table: &str, organization_id: u64) -> Result<i64> {
    let client = pool.get().await?;
    let table = quote_identifier(table)?;
    let organization_id = organization_id.to_string();
    Ok(client
        .query_one(
            &format!("SELECT count(*) FROM {table} WHERE \"organization_id\" = $1::TEXT::NUMERIC"),
            &[&organization_id],
        )
        .await?
        .get(0))
}

async fn futures_snapshot(
    pool: &Pool,
    entries: &[MatrixEntry],
    organization_id: u64,
) -> Result<Vec<String>> {
    let client = pool.get().await?;
    let organization_id = organization_id.to_string();
    let mut rows = Vec::with_capacity(entries.len());
    for entry in entries {
        let table = quote_identifier(&entry.table)?;
        let value = client
                .query_one(
                    &format!(
                        "SELECT row_to_json(projection_row)::TEXT FROM (SELECT * FROM {table} WHERE \"organization_id\" = $1::TEXT::NUMERIC) projection_row"
                    ),
                    &[&organization_id],
                )
                .await?
                .get::<_, String>(0);
        rows.push(value);
    }
    Ok(rows)
}

async fn projection_watermark(pool: &Pool, organization_id: u64) -> Result<Option<u64>> {
    let client = pool.get().await?;
    let organization_id = organization_id.to_string();
    Ok(client
            .query_opt(
                "SELECT applied_sequence::TEXT FROM organization_projection_watermark WHERE organization_id = $1::TEXT::NUMERIC",
                &[&organization_id],
            )
            .await?
            .map(|row| row.get::<_, String>(0).parse::<u64>())
            .transpose()?)
}
