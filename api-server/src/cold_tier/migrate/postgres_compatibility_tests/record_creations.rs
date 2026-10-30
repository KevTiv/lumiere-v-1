//! Real PostgreSQL 29→30 upgrade and restart preservation of exact creation receipts.

use super::*;

#[tokio::test]
async fn postgres_guides_29_to_record_creations_30_preserves_data() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping record creation migration proof (set C4_TEST_PG=1 to run)");
        return Ok(());
    }
    let base = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin = admin_pool(&base)?;
    create_database(&admin, &database, &base.user).await?;
    let mut config = base;
    config.database.clone_from(&database);
    let result = exercise_record_creation_upgrade(&config).await;
    let cleanup = drop_database(&admin, &database).await;
    result?;
    cleanup?;
    Ok(())
}

async fn exercise_record_creation_upgrade(config: &pg_pool::PgConfig) -> Result<()> {
    let index = MIGRATIONS
        .iter()
        .position(|migration| migration.version == 30)
        .context("record creation receipt migration is present")?;
    ensure!(index > 0 && MIGRATIONS[index - 1].version == 29);
    ensure!(MIGRATIONS[index - 1].name == "knowledge_guide_revisions");
    ensure!(MIGRATIONS[index].name == "record_creation_receipts");
    ensure!(MIGRATIONS[index].change_set == 19);
    ensure!(MIGRATIONS[index].phase.as_str() == "expand");
    let frozen = include_str!(
        "../../../../../lumiere-codegen/pg-migration-ledger/0030_durable_projection_delta.sql"
    );
    ensure!(MIGRATIONS[index].sql == frozen);

    let pool = pg_pool::build_pool(config)?;
    apply_migration_prefix(&pool, index).await?;
    let old_history = applied_migration_history(&pool).await?;
    ensure!(old_history.len() == 29);
    ensure!(!relation_exists(&pool, "record_creation_receipt").await?);
    seed_previous_release_rows(&pool).await?;
    let previous_rows = previous_release_rows(&pool).await?;

    ensure_schema(&pool).await?;
    let upgraded_history = applied_migration_history(&pool).await?;
    ensure!(upgraded_history.len() == MIGRATIONS.len());
    ensure!(
        upgraded_history[..old_history.len()] == old_history,
        "receipt upgrade changed a released migration checksum, identity, phase or application time"
    );
    ensure!(applied_checksum(&pool, 30).await? == migration_checksum(frozen));
    ensure!(relation_exists(&pool, "record_creation_receipt").await?);
    ensure!(previous_release_rows(&pool).await? == previous_rows);
    seed_creation_receipts(&pool).await?;
    let receipts = creation_receipt_rows(&pool).await?;
    ensure!(receipts.len() == 2);
    ensure!(receipts[0].1 == "8001:9001:contact:upgrade-contact");
    ensure!(receipts[0].2 == "9007199254740993");
    ensure!(receipts[1].1 == "8001:9002:sale_order:upgrade-quotation");
    ensure!(receipts[1].2 == "18446744073709551615");

    // Repeated startup must neither recreate receipts nor change their exact contents.
    ensure_schema(&pool).await?;
    ensure!(applied_migration_history(&pool).await? == upgraded_history);
    ensure!(previous_release_rows(&pool).await? == previous_rows);
    ensure!(creation_receipt_rows(&pool).await? == receipts);
    drop(pool);

    // A new API process/pool must recover the same durable rows and frozen history.
    let restarted_pool = pg_pool::build_pool(config)?;
    ensure_schema(&restarted_pool).await?;
    ensure!(applied_migration_history(&restarted_pool).await? == upgraded_history);
    ensure!(previous_release_rows(&restarted_pool).await? == previous_rows);
    ensure!(creation_receipt_rows(&restarted_pool).await? == receipts);
    ensure_schema(&restarted_pool).await?;
    ensure!(applied_migration_history(&restarted_pool).await? == upgraded_history);
    ensure!(creation_receipt_rows(&restarted_pool).await? == receipts);
    Ok(())
}

async fn seed_previous_release_rows(pool: &Pool) -> Result<()> {
    pool.get().await?.batch_execute(
        "INSERT INTO ai_run_queued_input
         (queued_input_id, organization_id, company_id, run_id, idempotency_key,
          request_hash, position, revision, author, payload, status, create_date, write_date)
         VALUES (9007199254740997, 8001, 9001, 9007199254740999, 'receipt-upgrade-queue',
                 'queue-hash', 1, 2, decode(repeat('11', 32), 'hex'), '{\"text\":\"Keep queued work\"}',
                 'queued', 1762000000000001, 1762000000000002);
         INSERT INTO knowledge_guide
         (id, organization_id, company_id, module, latest_revision, review_state,
          create_uid, create_date, write_date)
         VALUES (9007199254740993, 8001, 9001, 'accounting', 1, 'draft',
                 decode(repeat('11', 32), 'hex'), 1762000000000001, 1762000000000002);
         INSERT INTO knowledge_guide_revision
         (id, organization_id, company_id, guide_id, revision, title, markdown,
          language, draft_key, sources_json, content_hash, request_key, request_hash,
          create_uid, create_date)
         VALUES (9007199254740995, 8001, 9001, 9007199254740993, 1,
                 'Keep guide', 'Preserved draft and receipt context', 'en', 'guide-draft',
                 '[]', 'guide-content-hash', 'guide-request-key', 'guide-request-hash',
                 decode(repeat('11', 32), 'hex'), 1762000000000001)",
    ).await?;
    Ok(())
}

async fn previous_release_rows(pool: &Pool) -> Result<Vec<String>> {
    let client = pool.get().await?;
    let mut rows = Vec::new();
    for table in [
        "knowledge_guide",
        "knowledge_guide_revision",
        "ai_run_queued_input",
    ] {
        rows.push(
            client
                .query_one(
                    &format!("SELECT row_to_json({table})::TEXT FROM {table}"),
                    &[],
                )
                .await?
                .get(0),
        );
    }
    Ok(rows)
}

async fn seed_creation_receipts(pool: &Pool) -> Result<()> {
    pool.get().await?.batch_execute(
        "INSERT INTO record_creation_receipt
         (id, organization_id, company_id, model, operation_key, payload_hash,
          record_id, created_by, created_at)
         VALUES ('8001:9001:contact:upgrade-contact', 8001, 9001, 'contact', 'upgrade-contact',
                 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                 9007199254740993, decode(repeat('11', 32), 'hex'), 1762000000123456),
                ('8001:9002:sale_order:upgrade-quotation', 8001, 9002, 'sale_order', 'upgrade-quotation',
                 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                 18446744073709551615, decode(repeat('22', 32), 'hex'), 1762000000654321)",
    ).await?;
    Ok(())
}

async fn creation_receipt_rows(pool: &Pool) -> Result<Vec<(String, String, String)>> {
    Ok(pool
        .get()
        .await?
        .query(
            "SELECT row_to_json(record_creation_receipt)::TEXT, id, record_id::TEXT
             FROM record_creation_receipt ORDER BY id",
            &[],
        )
        .await?
        .into_iter()
        .map(|row| (row.get(0), row.get(1), row.get(2)))
        .collect())
}
