use super::{ensure_schema, migration_checksum, MIGRATIONS, MIGRATION_TABLE, MIGRATION_TABLE_DDL};
use crate::cold_tier::{conventions, pg_codec, pg_pool, projection_worker};
use anyhow::{ensure, Context, Result};
use deadpool_postgres::Pool;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static DATABASE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

const NEXT_EXPAND_SQL: &str = r#"
create table c4_next_release_probe (
    id bigint primary key,
    marker text not null
);
insert into c4_next_release_probe (id, marker) values (1, 'preserved-across-rollback');
"#;

const NEXT_CONTRACT_SQL: &str = r#"
alter table c4_next_release_probe rename column marker to next_marker;
"#;

#[tokio::test]
async fn postgres_current_next_application_rollback() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping postgres_current_next_application_rollback (set C4_TEST_PG=1 to run)");
        return Ok(());
    }

    let base_config = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin_pool = admin_pool(&base_config)?;
    create_database(&admin_pool, &database, &base_config.user).await?;

    let mut test_config = base_config.clone();
    test_config.database.clone_from(&database);
    let test_pool = pg_pool::build_pool(&test_config)?;
    let test_result = exercise_release_compatibility(&test_pool).await;
    drop(test_pool);
    let cleanup_result = drop_database(&admin_pool, &database).await;

    test_result?;
    cleanup_result?;
    Ok(())
}

#[tokio::test]
async fn postgres_existing_durable_projection_adds_migration_11() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!(
            "skipping postgres_existing_durable_projection_adds_migration_11 (set C4_TEST_PG=1 to run)"
        );
        return Ok(());
    }

    let base_config = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin_pool = admin_pool(&base_config)?;
    create_database(&admin_pool, &database, &base_config.user).await?;

    let mut test_config = base_config.clone();
    test_config.database.clone_from(&database);
    let test_pool = pg_pool::build_pool(&test_config)?;
    let test_result = exercise_durable_projection_upgrade(&test_pool).await;
    drop(test_pool);
    let cleanup_result = drop_database(&admin_pool, &database).await;

    test_result?;
    cleanup_result?;
    Ok(())
}

#[tokio::test]
async fn postgres_migration_13_adds_manufacturing_cost_projection_14() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!(
            "skipping postgres_migration_13_adds_manufacturing_cost_projection_14 (set C4_TEST_PG=1 to run)"
        );
        return Ok(());
    }

    let base_config = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin_pool = admin_pool(&base_config)?;
    create_database(&admin_pool, &database, &base_config.user).await?;

    let mut test_config = base_config.clone();
    test_config.database.clone_from(&database);
    let test_pool = pg_pool::build_pool(&test_config)?;
    let test_result = exercise_manufacturing_cost_projection_upgrade(&test_pool).await;
    drop(test_pool);
    let cleanup_result = drop_database(&admin_pool, &database).await;

    test_result?;
    cleanup_result?;
    Ok(())
}

#[tokio::test]
async fn postgres_migration_14_adds_account_payment_reversal_identity_15() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!(
            "skipping postgres_migration_14_adds_account_payment_reversal_identity_15 (set C4_TEST_PG=1 to run)"
        );
        return Ok(());
    }

    let base_config = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin_pool = admin_pool(&base_config)?;
    create_database(&admin_pool, &database, &base_config.user).await?;

    let mut test_config = base_config.clone();
    test_config.database.clone_from(&database);
    let test_pool = pg_pool::build_pool(&test_config)?;
    let test_result = exercise_account_payment_reversal_identity_upgrade(&test_pool).await;
    drop(test_pool);
    let cleanup_result = drop_database(&admin_pool, &database).await;

    test_result?;
    cleanup_result?;
    Ok(())
}

async fn exercise_durable_projection_upgrade(pool: &Pool) -> Result<()> {
    let migration_11_index = "cold_tier_service_identity_identity";
    let frozen_migration_1 =
        include_str!("../../../../lumiere-codegen/pg-migration-ledger/0001_durable_projection.sql");
    let prefix_length = MIGRATIONS
        .iter()
        .position(|migration| migration.version == 11)
        .context("migration 11 is missing from the catalog")?;
    ensure!(MIGRATIONS[0].sql == frozen_migration_1);
    ensure!(MIGRATIONS[prefix_length].version == 11);
    ensure!(MIGRATIONS[prefix_length].name == "durable_projection_delta");

    apply_migration_prefix(pool, prefix_length).await?;
    ensure!(migration_count(pool).await? == prefix_length as i64);
    ensure!(!relation_exists(pool, migration_11_index).await?);
    let migration_1_checksum = applied_checksum(pool, 1).await?;

    ensure_schema(pool).await?;

    ensure!(migration_count(pool).await? == MIGRATIONS.len() as i64);
    ensure!(relation_exists(pool, migration_11_index).await?);
    ensure!(applied_checksum(pool, 1).await? == migration_1_checksum);
    ensure!(applied_checksum(pool, 11).await? == migration_checksum(MIGRATIONS[prefix_length].sql));
    Ok(())
}

async fn exercise_manufacturing_cost_projection_upgrade(pool: &Pool) -> Result<()> {
    let migration_13_index = MIGRATIONS
        .iter()
        .position(|migration| migration.version == 13)
        .context("migration 13 is missing from the catalog")?;
    let migration_14_index = MIGRATIONS
        .iter()
        .position(|migration| migration.version == 14)
        .context("migration 14 is missing from the catalog")?;
    let frozen_migration_14 = include_str!(
        "../../../../lumiere-codegen/pg-migration-ledger/0014_durable_projection_delta.sql"
    );
    ensure!(migration_14_index == migration_13_index + 1);
    ensure!(MIGRATIONS[migration_14_index].name == "manufacturing_actual_cost_projection");
    ensure!(MIGRATIONS[migration_14_index].sql == frozen_migration_14);
    let prefix_length = migration_13_index + 1;
    apply_migration_prefix(pool, prefix_length).await?;
    ensure!(migration_count(pool).await? == prefix_length as i64);
    let previous_history = applied_migration_history(pool).await?;
    let previous_tables = public_table_names(pool).await?;
    let expected_new_tables = [
        "mrp_production_cost",
        "mrp_productivity_cost",
        "mrp_valuation_config",
        "mrp_workcenter_cost_rate",
        "purchase_order_creation_operation",
        "purchase_receipt_operation",
    ];
    for table in expected_new_tables {
        ensure!(
            !relation_exists(pool, table).await?,
            "table {table} predates its catalog migration"
        );
    }

    ensure_schema(pool).await?;

    let current_history = applied_migration_history(pool).await?;
    ensure!(current_history.len() == MIGRATIONS.len());
    ensure!(
        current_history[..prefix_length] == previous_history,
        "manufacturing upgrade changed prior migration identity, checksum, or applied time"
    );
    ensure!(applied_checksum(pool, 14).await? == migration_checksum(frozen_migration_14));
    let added_tables: Vec<_> = public_table_names(pool)
        .await?
        .into_iter()
        .filter(|table| !previous_tables.contains(table))
        .collect();
    ensure!(
        added_tables == expected_new_tables,
        "migration 13 upgrade produced unexpected new tables: {added_tables:?}"
    );

    // Startup replay must preserve both the released history and its application timestamps.
    ensure_schema(pool).await?;
    ensure!(applied_migration_history(pool).await? == current_history);
    Ok(())
}

async fn exercise_account_payment_reversal_identity_upgrade(pool: &Pool) -> Result<()> {
    let migration_15_index = MIGRATIONS
        .iter()
        .position(|migration| migration.version == 15)
        .context("migration 15 is missing from the catalog")?;
    let frozen_migration_15 = include_str!(
        "../../../../lumiere-codegen/pg-migration-ledger/0015_durable_projection_delta.sql"
    );
    ensure!(MIGRATIONS[migration_15_index].name == "account_payment_reversal_identity");
    ensure!(MIGRATIONS[migration_15_index].sql == frozen_migration_15);

    apply_migration_prefix(pool, migration_15_index).await?;
    let client = pool.get().await?;
    let column_before: bool = client
        .query_one(
            "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'account_payment' and column_name = 'reversal_move_id')",
            &[],
        )
        .await?
        .get(0);
    ensure!(!column_before, "reversal identity predates migration 15");
    drop(client);

    let previous_history = applied_migration_history(pool).await?;
    ensure_schema(pool).await?;
    ensure!(applied_checksum(pool, 15).await? == migration_checksum(frozen_migration_15));

    let client = pool.get().await?;
    let column = client
        .query_one(
            "select is_nullable, column_default, data_type, numeric_precision, numeric_scale from information_schema.columns where table_schema = 'public' and table_name = 'account_payment' and column_name = 'reversal_move_id'",
            &[],
        )
        .await?;
    let nullable: String = column.get(0);
    let default_value: Option<String> = column.get(1);
    let data_type: String = column.get(2);
    let precision: Option<i32> = column.get(3);
    let scale: Option<i32> = column.get(4);
    ensure!(nullable == "YES");
    ensure!(default_value.is_none());
    ensure!(data_type == "numeric");
    ensure!(precision == Some(20));
    ensure!(scale == Some(0));

    let index = client
        .query_one(
            "select index_definition.indisunique, pg_get_expr(index_definition.indpred, index_definition.indrelid) from pg_catalog.pg_class index_relation join pg_catalog.pg_index index_definition on index_definition.indexrelid = index_relation.oid where index_relation.oid = to_regclass('account_payment_reversal_move_id')",
            &[],
        )
        .await?;
    let unique: bool = index.get(0);
    let predicate: Option<String> = index.get(1);
    ensure!(unique);
    ensure!(predicate
        .as_deref()
        .is_some_and(|value| value.contains("reversal_move_id IS NOT NULL")));
    drop(client);

    ensure!(applied_migration_history(pool).await?[..migration_15_index] == previous_history);
    ensure_schema(pool).await?;
    ensure!(migration_count(pool).await? == MIGRATIONS.len() as i64);
    Ok(())
}

type AppliedMigrationHistory = (i64, String, i64, String, String, String);

async fn applied_migration_history(pool: &Pool) -> Result<Vec<AppliedMigrationHistory>> {
    let client = pool.get().await?;
    Ok(client.query(
        &format!("select version, name, change_set, phase, checksum, applied_at::text from {MIGRATION_TABLE} order by version"),
        &[],
    ).await?.into_iter().map(|row|
        (row.get(0), row.get(1), row.get(2), row.get(3), row.get(4), row.get(5))
    ).collect())
}

async fn public_table_names(pool: &Pool) -> Result<Vec<String>> {
    let client = pool.get().await?;
    Ok(client
        .query(
            "select tablename from pg_tables where schemaname = 'public' order by tablename",
            &[],
        )
        .await?
        .into_iter()
        .map(|row| row.get(0))
        .collect())
}

async fn apply_migration_prefix(pool: &Pool, prefix_length: usize) -> Result<()> {
    let mut client = pool.get().await?;
    let transaction = client.transaction().await?;
    transaction.batch_execute(MIGRATION_TABLE_DDL).await?;
    for migration in &MIGRATIONS[..prefix_length] {
        transaction.batch_execute(migration.sql).await?;
        let checksum = migration_checksum(migration.sql);
        transaction
            .execute(
                &format!(
                    "insert into {MIGRATION_TABLE} (version, name, change_set, phase, checksum) values ($1, $2, $3, $4, $5)"
                ),
                &[
                    &migration.version,
                    &migration.name,
                    &migration.change_set,
                    &migration.phase.as_str(),
                    &checksum,
                ],
            )
            .await?;
    }
    transaction.commit().await?;
    Ok(())
}

async fn relation_exists(pool: &Pool, relation: &str) -> Result<bool> {
    let client = pool.get().await?;
    Ok(client
        .query_one("select to_regclass($1) is not null", &[&relation])
        .await?
        .get(0))
}

async fn applied_checksum(pool: &Pool, version: i64) -> Result<String> {
    let client = pool.get().await?;
    Ok(client
        .query_one(
            &format!("select checksum from {MIGRATION_TABLE} where version = $1"),
            &[&version],
        )
        .await?
        .get(0))
}

async fn exercise_release_compatibility(pool: &Pool) -> Result<()> {
    // Start from the exact pre-C4 heap relations that the C3 projector used,
    // then adopt them through the current checksum-verified catalog.
    projection_worker::ensure_projection_relations(
        pool,
        projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
    )
    .await?;
    ensure_schema(pool).await?;
    ensure!(migration_count(pool).await? == MIGRATIONS.len() as i64);

    assert_codec_round_trip(pool).await?;

    // Model the next application's additive expand migration and its history
    // record. The current application must accept that future additive prefix
    // without deleting the new relation or its data.
    apply_future_migration(pool, "next_release_expand", "expand", NEXT_EXPAND_SQL).await?;
    ensure_schema(pool).await?;
    let client = pool.get().await?;
    let marker: String = client
        .query_one("select marker from c4_next_release_probe where id = 1", &[])
        .await?
        .get(0);
    ensure!(marker == "preserved-across-rollback");
    ensure!(migration_count(pool).await? == MIGRATIONS.len() as i64 + 1);
    drop(client);

    // Once the next release applies a contract-phase migration, the current
    // application is no longer compatible and must fail before serving.
    apply_future_migration(pool, "next_release_contract", "contract", NEXT_CONTRACT_SQL).await?;
    let error = ensure_schema(pool)
        .await
        .err()
        .context("current application accepted a future contract migration")?;
    ensure!(format!("{error:#}").contains("future contract migration"));
    Ok(())
}

async fn apply_future_migration(pool: &Pool, name: &str, phase: &str, sql: &str) -> Result<()> {
    let mut client = pool.get().await?;
    let transaction = client.transaction().await?;
    transaction.batch_execute(sql).await?;
    let version = migration_count_transaction(&transaction).await? + 1;
    let change_set = MIGRATIONS
        .last()
        .context("current migration catalog is empty")?
        .change_set
        + 1;
    let checksum = migration_checksum(sql);
    transaction
        .execute(
            &format!(
                "insert into {MIGRATION_TABLE} (version, name, change_set, phase, checksum) values ($1, $2, $3, $4, $5)"
            ),
            &[&version, &name, &change_set, &phase, &checksum],
        )
        .await?;
    transaction.commit().await?;
    Ok(())
}

async fn migration_count(pool: &Pool) -> Result<i64> {
    let client = pool.get().await?;
    Ok(client
        .query_one(&format!("select count(*) from {MIGRATION_TABLE}"), &[])
        .await?
        .get(0))
}

async fn migration_count_transaction(transaction: &tokio_postgres::Transaction<'_>) -> Result<i64> {
    Ok(transaction
        .query_one(&format!("select count(*) from {MIGRATION_TABLE}"), &[])
        .await?
        .get(0))
}

async fn assert_codec_round_trip(pool: &Pool) -> Result<()> {
    let columns = vec![
        column("full_u64", "NUMERIC(20,0)", "U64"),
        column("recorded_at", "BIGINT", "Timestamp"),
        column("actor", "BYTEA", "Identity"),
        column("state", "TEXT", "PostingState"),
        column("ids", "JSONB", "Vec(U64)"),
        column("nested", "JSONB", "ApprovalSnapshot"),
    ];
    let expected = json!({
        "fullU64": u64::MAX,
        "recordedAt": { "microsSinceUnixEpoch": -1_234_567_890_i64 },
        "actor": "ab".repeat(32),
        "state": "posted",
        "ids": [0, u64::MAX],
        "nested": { "approved": true, "levels": [1, 2], "owner": { "id": u64::MAX } }
    });
    let values = pg_codec::decode_row(&columns, &expected)?;
    let client = pool.get().await?;
    client
        .batch_execute(
            "create table c4_codec_probe (\
                full_u64 numeric(20,0) not null,\
                recorded_at bigint not null,\
                actor bytea not null,\
                state text not null,\
                ids jsonb not null,\
                nested jsonb not null\
            )",
        )
        .await?;
    let placeholders = values
        .iter()
        .enumerate()
        .map(|(index, value)| match value.needs_cast() {
            Some(cast) => format!("${}::{cast}", index + 1),
            None => format!("${}", index + 1),
        })
        .collect::<Vec<_>>()
        .join(", ");
    let parameters = values
        .iter()
        .map(pg_codec::PgValue::as_sql)
        .collect::<Vec<_>>();
    client
        .execute(
            &format!("insert into c4_codec_probe values ({placeholders})"),
            &parameters,
        )
        .await?;
    let projection = pg_codec::projection_with_pg_casts(&columns).join(", ");
    let row = client
        .query_one(&format!("select {projection} from c4_codec_probe"), &[])
        .await?;
    let actual = pg_codec::row_to_hot_json(&columns, &row)?;
    ensure!(actual == expected, "codec round trip changed value shape");
    Ok(())
}

fn column(name: &str, pg_type: &str, stdb_type: &str) -> pg_codec::ColumnCodec {
    pg_codec::ColumnCodec {
        name: name.to_string(),
        pg_type: pg_type.to_string(),
        stdb_type: stdb_type.to_string(),
        nullable: false,
    }
}

fn unique_database_name() -> Result<String> {
    let micros: u64 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("read clock for C4 PostgreSQL database")?
        .as_micros()
        .try_into()
        .context("C4 PostgreSQL database clock exceeds u64 micros")?;
    let sequence = DATABASE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    Ok(database_name(std::process::id(), micros, sequence))
}

fn database_name(process_id: u32, micros: u64, sequence: u64) -> String {
    format!("lumiere_c4_{process_id}_{micros}_{sequence}")
}

#[test]
fn database_names_distinguish_same_microsecond_and_fit_postgres_identifier() {
    let first = database_name(u32::MAX, u64::MAX, 0);
    let second = database_name(u32::MAX, u64::MAX, 1);
    let longest = database_name(u32::MAX, u64::MAX, u64::MAX);

    assert_ne!(first, second);
    assert_eq!(longest.len(), 63);
    assert!(longest
        .bytes()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'));
}

fn admin_pool(config: &pg_pool::PgConfig) -> Result<Pool> {
    let mut admin = config.clone();
    admin.database = "postgres".to_string();
    pg_pool::build_pool(&admin)
}

async fn create_database(pool: &Pool, database: &str, owner: &str) -> Result<()> {
    let client = pool.get().await?;
    let database = conventions::quote_identifier(database)?;
    let owner = conventions::quote_identifier(owner)?;
    client
        .batch_execute(&format!("create database {database} owner {owner}"))
        .await
        .context("create disposable C4 PostgreSQL database")
}

async fn drop_database(pool: &Pool, database: &str) -> Result<()> {
    let client = pool.get().await?;
    client
        .query(
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
            &[&database],
        )
        .await?;
    let database = conventions::quote_identifier(database)?;
    client
        .batch_execute(&format!("drop database {database}"))
        .await
        .context("drop disposable C4 PostgreSQL database")
}
