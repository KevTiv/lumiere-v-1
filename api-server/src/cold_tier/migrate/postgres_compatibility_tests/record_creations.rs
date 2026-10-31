//! Real PostgreSQL 29→30 reviews→31 receipts→32 field decisions and restart preservation.

use super::*;
use serde_json::Value;

#[tokio::test]
async fn postgres_guides_29_via_import_reviews_30_to_receipts_31_preserves_data() -> Result<()> {
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
        .position(|migration| migration.name == "record_creation_receipts")
        .context("record creation receipt migration is present")?;
    ensure!(index > 1 && MIGRATIONS[index].version == 31);
    ensure!(MIGRATIONS[index - 2].version == 29);
    ensure!(MIGRATIONS[index - 2].name == "knowledge_guide_revisions");
    let imports = MIGRATIONS[index - 1];
    ensure!(imports.version == 30);
    ensure!(imports.name == "source_import_review_drafts");
    ensure!(imports.change_set == 19);
    ensure!(imports.phase.as_str() == "expand");
    ensure!(MIGRATIONS[index].name == "record_creation_receipts");
    ensure!(MIGRATIONS[index].change_set == 20);
    ensure!(MIGRATIONS[index].phase.as_str() == "expand");
    let frozen = include_str!(
        "../../../../../lumiere-codegen/pg-migration-ledger/0030_durable_projection_delta.sql"
    );
    ensure!(MIGRATIONS[index].sql == frozen);

    let pool = pg_pool::build_pool(config)?;
    apply_migration_prefix(&pool, index - 1).await?;
    let old_history = applied_migration_history(&pool).await?;
    ensure!(old_history.len() == 29);
    ensure!(!relation_exists(&pool, "record_creation_receipt").await?);
    seed_previous_release_rows(&pool).await?;
    let previous_rows = previous_release_rows(&pool).await?;

    // Reproduce main's deployed migration 30 before the receipt expansion.
    // Its source drafts and migration identity must survive the next release.
    apply_one_migration(&pool, imports).await?;
    let import_history = applied_migration_history(&pool).await?;
    ensure!(import_history.len() == 30);
    ensure!(import_history[..old_history.len()] == old_history);
    ensure!(applied_checksum(&pool, 30).await? == migration_checksum(imports.sql));
    ensure!(previous_release_rows(&pool).await? == previous_rows);
    ensure!(!relation_exists(&pool, "record_creation_receipt").await?);
    seed_import_review_rows(&pool).await?;
    let mut import_rows = import_review_rows(&pool).await?;
    // Migration 32 adds the exact sorted backfill to these two confirmed rows.
    // Keep every prior field in the expected snapshots, including the unchanged
    // batch; equality below must reject any other added or modified data.
    for snapshot in &mut import_rows[1..] {
        ensure!(snapshot["state"] == "confirmed");
        let fields = snapshot
            .as_object_mut()
            .context("source review snapshot is an object")?;
        ensure!(fields
            .insert(
                "confirmed_fields".into(),
                json!(["amount", "quantity", "unit_price"]),
            )
            .is_none());
    }

    ensure_schema(&pool).await?;
    let upgraded_history = applied_migration_history(&pool).await?;
    ensure!(upgraded_history.len() == MIGRATIONS.len());
    ensure!(
        upgraded_history[..import_history.len()] == import_history,
        "receipt upgrade changed a released migration checksum, identity, phase or application time"
    );
    ensure!(applied_checksum(&pool, 31).await? == migration_checksum(frozen));
    ensure!(relation_exists(&pool, "record_creation_receipt").await?);
    ensure!(previous_release_rows(&pool).await? == previous_rows);
    ensure!(import_review_rows(&pool).await? == import_rows);
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
    ensure!(import_review_rows(&pool).await? == import_rows);
    ensure!(creation_receipt_rows(&pool).await? == receipts);
    drop(pool);

    // A new API process/pool must recover the same durable rows and frozen history.
    let restarted_pool = pg_pool::build_pool(config)?;
    ensure_schema(&restarted_pool).await?;
    ensure!(applied_migration_history(&restarted_pool).await? == upgraded_history);
    ensure!(previous_release_rows(&restarted_pool).await? == previous_rows);
    ensure!(import_review_rows(&restarted_pool).await? == import_rows);
    ensure!(creation_receipt_rows(&restarted_pool).await? == receipts);
    ensure_schema(&restarted_pool).await?;
    ensure!(applied_migration_history(&restarted_pool).await? == upgraded_history);
    ensure!(creation_receipt_rows(&restarted_pool).await? == receipts);
    Ok(())
}

async fn apply_one_migration(pool: &Pool, migration: super::super::Migration) -> Result<()> {
    let mut client = pool.get().await?;
    let transaction = client.transaction().await?;
    transaction.batch_execute(migration.sql).await?;
    transaction.execute(
        &format!("INSERT INTO {MIGRATION_TABLE} (version, name, change_set, phase, checksum) VALUES ($1,$2,$3,$4,$5)"),
        &[&migration.version, &migration.name, &migration.change_set,
          &migration.phase.as_str(), &migration_checksum(migration.sql)],
    ).await?;
    transaction.commit().await?;
    Ok(())
}

async fn seed_import_review_rows(pool: &Pool) -> Result<()> {
    pool.get().await?.batch_execute(
        "INSERT INTO lumiere_platform.import_review_batch
         (id,organization_id,company_id,title,target_entity,source_file,source_sha256,created_by)
         VALUES (9007199254740993,8001,9001,'Preserve source draft','product','source.csv',repeat('a',64),'actor-one');
         INSERT INTO lumiere_platform.import_review_item
         (id,organization_id,company_id,batch_id,source_key,source_json,proposed_json,state,revision,reviewed_by,reviewed_at,reason)
         VALUES (9007199254740995,8001,9001,9007199254740993,'row-2',
                 '{\"quantity\":\"8\",\"unit_price\":\"600\",\"amount\":\"4800\"}',
                 '{\"quantity\":\"1\",\"unit_price\":\"4800\",\"amount\":\"4800\"}',
                 'confirmed',2,'actor-two',now(),'Confirmed source interpretation');
         INSERT INTO lumiere_platform.import_review_decision
         (id,organization_id,company_id,item_id,revision,request_key,proposed_json,state,reason,actor_identity)
         VALUES (9007199254740997,8001,9001,9007199254740995,2,'preserve-import-review',
                 '{\"quantity\":\"1\",\"unit_price\":\"4800\",\"amount\":\"4800\"}',
                 'confirmed','Confirmed source interpretation','actor-two')",
    ).await?;
    Ok(())
}

async fn import_review_rows(pool: &Pool) -> Result<Vec<Value>> {
    let client = pool.get().await?;
    let mut rows = Vec::new();
    for table in [
        "import_review_batch",
        "import_review_item",
        "import_review_decision",
    ] {
        rows.push(
            client
                .query_one(
                    &format!(
                        "SELECT row_to_json(snapshot) FROM lumiere_platform.{table} AS snapshot"
                    ),
                    &[],
                )
                .await?
                .get(0),
        );
    }
    Ok(rows)
}

#[tokio::test]
async fn postgres_premerge_receipts_30_fail_closed_without_rewriting_history() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping conflicting receipt history proof (set C4_TEST_PG=1 to run)");
        return Ok(());
    }
    let base = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin = admin_pool(&base)?;
    create_database(&admin, &database, &base.user).await?;
    let mut config = base;
    config.database.clone_from(&database);
    let result = exercise_premerge_receipt_history(&config).await;
    let cleanup = drop_database(&admin, &database).await;
    result?;
    cleanup?;
    Ok(())
}

async fn exercise_premerge_receipt_history(config: &pg_pool::PgConfig) -> Result<()> {
    let pool = pg_pool::build_pool(config)?;
    apply_migration_prefix(&pool, 29).await?;
    seed_previous_release_rows(&pool).await?;
    // This was a pre-merge API image, not main's deployed migration lineage.
    // Reproduce it in a disposable database; never adopt or rewrite its entry.
    let legacy = super::super::Migration {
        version: 30,
        name: "record_creation_receipts",
        change_set: 19,
        phase: super::super::MigrationPhase::Expand,
        sql: MIGRATIONS[30].sql,
    };
    apply_one_migration(&pool, legacy).await?;
    seed_creation_receipts(&pool).await?;
    let history = applied_migration_history(&pool).await?;
    let previous_rows = previous_release_rows(&pool).await?;
    let receipts = creation_receipt_rows(&pool).await?;
    let error = ensure_schema(&pool)
        .await
        .expect_err("different version 30 histories must not be inferred compatible");
    ensure!(format!("{error:#}").contains("migration 30 name mismatch"));
    ensure!(applied_migration_history(&pool).await? == history);
    ensure!(previous_release_rows(&pool).await? == previous_rows);
    ensure!(creation_receipt_rows(&pool).await? == receipts);
    ensure!(!relation_exists(&pool, "lumiere_platform.import_review_batch").await?);
    drop(pool);

    let restarted = pg_pool::build_pool(config)?;
    ensure!(ensure_schema(&restarted).await.is_err());
    ensure!(applied_migration_history(&restarted).await? == history);
    ensure!(creation_receipt_rows(&restarted).await? == receipts);
    ensure!(!relation_exists(&restarted, "lumiere_platform.import_review_batch").await?);
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
