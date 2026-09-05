use super::{ensure_schema, migration_checksum, MIGRATIONS, MIGRATION_TABLE};
use crate::cold_tier::{conventions, pg_codec, pg_pool, projection_worker};
use anyhow::{ensure, Context, Result};
use deadpool_postgres::Pool;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

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
    let micros = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("read clock for C4 PostgreSQL database")?
        .as_micros();
    Ok(format!("lumiere_c4_{}_{}", std::process::id(), micros))
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
