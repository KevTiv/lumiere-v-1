//! Live C5 finalization drill.
//!
//! This is intentionally an ignored test: it talks to a running SpacetimeDB
//! module and creates/drops a disposable PostgreSQL database. The companion
//! script supplies separate administrator/source-read and worker/finalizer
//! credentials. Keeping the test here gives it access to the selected-row
//! handler entry points without changing the production batch scheduler.

use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::{json, Value};
use stdb_client::StdbClient;

use super::pos_order;
use crate::cold_tier::{conventions, migrate, pg_codec, pg_pool, projection_worker};

const DRILL_FLAG: &str = "C5_FINALIZATION_DRILL";
const DRILL_DISPOSABLE_FLAG: &str = "C5_DISPOSABLE_STDB";
const DRILL_ADMIN_TOKEN: &str = "C5_STDB_ADMIN_TOKEN";
const DRILL_WORKER_TOKEN: &str = "C5_STDB_WORKER_TOKEN";
const DRILL_WORKER_IDENTITY: &str = "C5_STDB_WORKER_IDENTITY";

#[tokio::test]
#[ignore = "requires a running STDB module and disposable PostgreSQL database"]
async fn c5_live_finalization_worker_drill() -> Result<()> {
    require_enabled()?;
    let stdb_host = env_required("STDB_HOST")?;
    let stdb_module = env_required("STDB_MODULE")?;
    require_disposable_target(&stdb_host, &stdb_module)?;
    let admin_token = env_required(DRILL_ADMIN_TOKEN)?;
    let worker_token = env_required(DRILL_WORKER_TOKEN)?;
    let worker_identity = normalize_identity(&env_required(DRILL_WORKER_IDENTITY)?)?;
    if admin_token == worker_token {
        bail!("{DRILL_ADMIN_TOKEN} and {DRILL_WORKER_TOKEN} must be distinct");
    }

    let admin_stdb = StdbClient::new(stdb_host.clone(), stdb_module.clone(), admin_token);
    let worker_stdb = StdbClient::new(stdb_host, stdb_module, worker_token);
    let org = first_u64(
        &admin_stdb
            .query_sql(
                "SELECT id FROM organization WHERE id = organization_id ORDER BY id ASC LIMIT 1",
            )
            .await
            .context("find a disposable drill organization")?,
        "id",
    )?;
    let company = first_u64(
        &admin_stdb
            .query_sql(&format!(
                "SELECT id FROM company WHERE organization_id = {org} ORDER BY id ASC LIMIT 1"
            ))
            .await
            .context("find a company for the drill organization")?,
        "id",
    )?;
    let sample_order = admin_stdb
        .query_sql(&format!(
            "SELECT * FROM pos_order WHERE organization_id = {org} ORDER BY id ASC LIMIT 1"
        ))
        .await
        .context("find a POS order payload to clone for the drill")?
        .into_iter()
        .next()
        .context("the running STDB module has no pos_order fixture")?;
    let max_order_id = first_u64(
        &admin_stdb
            .query_sql("SELECT id FROM pos_order ORDER BY id DESC LIMIT 1")
            .await
            .context("read the highest existing POS order id")?,
        "id",
    )?;
    let order_id = max_order_id
        .checked_add(1)
        .context("POS order id exhausted")?;
    register_service(&admin_stdb, org, "projection_worker", &worker_identity).await?;
    register_service(&admin_stdb, org, "pos_order_hydrator", &worker_identity).await?;

    let mut order = sample_order;
    order["id"] = json!(order_id);
    order["organizationId"] = json!(org);
    order["companyId"] = json!(company);
    order["uid"] = json!(format!("c5-finalization-drill-{order_id}"));
    order["ticketNumber"] = json!(format!("C5-{order_id}"));
    order["lines"] = json!([]);
    order["statementIds"] = json!([]);
    order["coldEligibleAt"] = json!({
        "microsSinceUnixEpoch": unix_micros()?.saturating_sub(1_000_000),
    });
    order["archiveVersion"] = json!(1);
    order["metadata"] = json!("{\"c5_drill\":true}");
    let order_json = serde_json::to_string(&order).context("serialize drill POS order")?;
    let payload_checksum = "a".repeat(64);
    worker_stdb
        .call_reducer(stdb_client::reducer_call!(
            "hydrate_pos_order_aggregate",
            json!([org, company, 1, 1, 1, payload_checksum, order_json, [], [],]),
        ))
        .await
        .context("create eligible drill pos_order with worker token")?;
    let pos_row = admin_stdb
        .query_sql(&format!(
            "SELECT * FROM pos_order WHERE id = {order_id} AND organization_id = {org} LIMIT 1"
        ))
        .await
        .context("read the hydrated drill pos_order row")?
        .into_iter()
        .next()
        .context("STDB did not persist the hydrated drill pos_order row")?;

    let base_config = pg_pool::PgConfig::from_env().context("load drill PostgreSQL config")?;
    let admin_pool = admin_pool(&base_config)?;
    let database = unique_database_name()?;
    create_database(&admin_pool, &database, &base_config.user).await?;
    let mut test_config = base_config;
    test_config.database.clone_from(&database);
    let pool = pg_pool::build_pool(&test_config).context("build drill PostgreSQL pool")?;

    let drill_result = async {
        migrate::ensure_schema(&pool)
            .await
            .context("apply drill PostgreSQL schema")?;
        projection_worker::ensure_projection_relations(
            &pool,
            projection_worker::PROJECTION_CODEC_MANIFEST_JSON,
        )
        .await
        .context("create drill projection relations")?;
        project_until_order_is_durable(&admin_stdb, &pool, org, order_id).await?;
        let columns =
            pg_codec::load_columns(lumiere_contracts::manifests::CODEC_MANIFEST, "pos_order")
                .context("load pos_order drill codec")?;
        pos_order::drain_one_for_test(&pool, &admin_stdb, &worker_stdb, &columns, &pos_row)
            .await
            .context("finalize selected pos_order row")?;
        assert_stdb_row_absent(&admin_stdb, "pos_order", order_id).await?;
        assert_cold_pos_row(&pool, org, order_id).await?;
        assert_ledger_finalized(&pool, org, order_id).await?;
        Ok::<(), anyhow::Error>(())
    }
    .await;

    drop(pool);
    let cleanup = drop_database(&admin_pool, &database).await;
    drill_result?;
    cleanup
}

async fn register_service(
    stdb: &StdbClient,
    organization_id: u64,
    service_name: &str,
    identity: &str,
) -> Result<()> {
    stdb.call_reducer(stdb_client::reducer_call!(
        "register_cold_tier_service_identity",
        json!([
            organization_id,
            format!("c5-drill-{service_name}-{}", std::process::id()),
            service_name,
            identity,
        ]),
    ))
    .await
    .with_context(|| format!("register {service_name} identity with administrator token"))
}

async fn project_until_order_is_durable(
    stdb: &StdbClient,
    pool: &Pool,
    organization_id: u64,
    order_id: u64,
) -> Result<()> {
    for _ in 0..200 {
        let stats = projection_worker::drain_batch(stdb, pool, 100)
            .await
            .context("run administrator/source-read projection batch")?;
        if stats.failed != 0 {
            bail!("projection batch failed while preparing drill: {stats:?}");
        }
        let client = pool.get().await?;
        let organization_id = organization_id.to_string();
        let order_id = order_id.to_string();
        let durable = client
            .query_opt(
                "SELECT 1 FROM pos_order WHERE organization_id = $1::TEXT::NUMERIC \
                 AND id = $2::TEXT::NUMERIC",
                &[&organization_id, &order_id],
            )
            .await?;
        drop(client);
        if durable.is_some() {
            return Ok(());
        }
        if stats.commits == 0 {
            bail!("projection cursor drained without the hydrated drill pos_order");
        }
    }
    bail!("projection worker did not durably project drill pos_order within the bound")
}

async fn assert_stdb_row_absent(stdb: &StdbClient, table: &str, id: u64) -> Result<()> {
    let rows = stdb
        .query_sql(&format!("SELECT id FROM {table} WHERE id = {id} LIMIT 1"))
        .await?;
    if !rows.is_empty() {
        bail!("{table} row {id} remains in STDB after finalization");
    }
    Ok(())
}

async fn assert_cold_pos_row(pool: &Pool, organization_id: u64, id: u64) -> Result<()> {
    let client = pool.get().await?;
    client
        .query_opt(
            "SELECT payload_checksum FROM cold_pos_order WHERE organization_id = $1::TEXT::NUMERIC \
             AND id = $2::TEXT::NUMERIC",
            &[&organization_id.to_string(), &id.to_string()],
        )
        .await?
        .context("cold_pos_order row missing after finalization")?;
    Ok(())
}

async fn assert_ledger_finalized(pool: &Pool, organization_id: u64, order_id: u64) -> Result<()> {
    let client = pool.get().await?;
    let organization_id = organization_id.to_string();
    let resource = "pos_order";
    let row = client
        .query_opt(
            "SELECT stdb_finalized_at FROM archive_transfer \
             WHERE resource = $1 AND row_id = $2::TEXT::NUMERIC \
               AND organization_id = $3::TEXT::NUMERIC",
            &[&resource, &order_id.to_string(), &organization_id],
        )
        .await?
        .with_context(|| format!("archive_transfer row missing for {resource}/{order_id}"))?;
    let finalized_at: Option<std::time::SystemTime> = row.get(0);
    if finalized_at.is_none() {
        bail!("archive_transfer {resource}/{order_id} is not marked finalized");
    }
    Ok(())
}

fn require_enabled() -> Result<()> {
    if std::env::var(DRILL_FLAG).as_deref() != Ok("1") {
        bail!("{DRILL_FLAG}=1 is required; refusing to run a live disposable drill")
    }
    Ok(())
}

fn require_disposable_target(host: &str, module: &str) -> Result<()> {
    validate_disposable_target(
        std::env::var(DRILL_DISPOSABLE_FLAG).as_deref() == Ok("1"),
        host,
        module,
    )
}

fn validate_disposable_target(acknowledged: bool, host: &str, module: &str) -> Result<()> {
    if !acknowledged {
        bail!("{DRILL_DISPOSABLE_FLAG}=1 is required; refusing to mutate a non-disposable module")
    }
    let is_loopback = host.starts_with("http://127.0.0.1:")
        || host.starts_with("http://localhost:")
        || host == "http://127.0.0.1"
        || host == "http://localhost";
    if !is_loopback {
        bail!("C5 drill requires a loopback STDB_HOST, got {host}")
    }
    if !module.starts_with("lumiere-c5-") {
        bail!("C5 drill requires a disposable STDB_MODULE prefixed with 'lumiere-c5-'")
    }
    Ok(())
}

#[test]
fn disposable_target_validation_rejects_shared_or_remote_modules() {
    assert!(validate_disposable_target(true, "http://127.0.0.1:3000", "lumiere-c5-drill").is_ok());
    assert!(
        validate_disposable_target(false, "http://127.0.0.1:3000", "lumiere-c5-drill").is_err()
    );
    assert!(validate_disposable_target(
        true,
        "https://maincloud.spacetimedb.com",
        "lumiere-c5-drill"
    )
    .is_err());
    assert!(validate_disposable_target(true, "http://127.0.0.1:3000", "lumiere-v1").is_err());
}

fn env_required(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("{name} is required for the C5 drill"))
}

fn normalize_identity(value: &str) -> Result<String> {
    let identity = value
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    if identity.len() != 64 || !identity.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("{DRILL_WORKER_IDENTITY} must be a 32-byte hexadecimal identity")
    }
    Ok(identity.to_ascii_lowercase())
}

fn first_u64(rows: &[Value], field: &str) -> Result<u64> {
    rows.first()
        .and_then(|row| row.get(field))
        .and_then(Value::as_u64)
        .with_context(|| format!("query returned no numeric {field}"))
}

fn unix_micros() -> Result<i64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("read wall clock")?
        .as_micros()
        .try_into()
        .context("wall clock exceeds i64 micros")?)
}

fn unique_u64(label: &str) -> Result<u64> {
    let micros = unix_micros()? as u64;
    micros
        .checked_add(u64::from(std::process::id()))
        .context(format!("{label} id exhausted"))
}

fn unique_database_name() -> Result<String> {
    Ok(format!("lumiere_c5_drill_{}", unique_u64("database")?))
}

fn admin_pool(config: &pg_pool::PgConfig) -> Result<Pool> {
    let mut admin = config.clone();
    admin.database = "postgres".to_string();
    pg_pool::build_pool(&admin)
}

async fn create_database(pool: &Pool, database: &str, owner: &str) -> Result<()> {
    let client = pool.get().await?;
    client
        .batch_execute(&format!(
            "CREATE DATABASE {} OWNER {}",
            conventions::quote_identifier(database)?,
            conventions::quote_identifier(owner)?
        ))
        .await
        .context("create disposable C5 drill database")
}

async fn drop_database(pool: &Pool, database: &str) -> Result<()> {
    let client = pool.get().await?;
    client
        .query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
             WHERE datname = $1 AND pid <> pg_backend_pid()",
            &[&database],
        )
        .await?;
    client
        .batch_execute(&format!(
            "DROP DATABASE {}",
            conventions::quote_identifier(database)?
        ))
        .await
        .context("drop disposable C5 drill database")
}
