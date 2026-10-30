//! Upgrade the shipped catalog without losing existing data or guide revisions.

use super::*;

#[tokio::test]
async fn postgres_harness_28_to_knowledge_guides_29_preserves_data() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping guide migration proof (set C4_TEST_PG=1 to run)");
        return Ok(());
    }
    let base = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin = admin_pool(&base)?;
    create_database(&admin, &database, &base.user).await?;
    let mut config = base;
    config.database.clone_from(&database);
    let pool = pg_pool::build_pool(&config)?;
    let result = exercise_guide_upgrade(&pool).await;
    drop(pool);
    let cleanup = drop_database(&admin, &database).await;
    result?;
    cleanup?;
    Ok(())
}

async fn exercise_guide_upgrade(pool: &Pool) -> Result<()> {
    let index = MIGRATIONS
        .iter()
        .position(|migration| migration.version == 29)
        .context("guide migration is present")?;
    ensure!(MIGRATIONS[index - 1].version == 28);
    ensure!(MIGRATIONS[index].name == "knowledge_guide_revisions");
    apply_migration_prefix(pool, index).await?;
    let before = applied_migration_history(pool).await?;
    pool.get()
        .await?
        .batch_execute(
            "INSERT INTO ai_run_queued_input
         (queued_input_id, organization_id, company_id, run_id, idempotency_key,
          request_hash, position, revision, author, payload, status, create_date, write_date)
         VALUES (1, 8001, 9001, 1, 'guide-upgrade-probe', 'request-hash', 1, 1,
                 decode(repeat('11', 32), 'hex'), '{}', 'queued', 1, 1)",
        )
        .await?;
    let queued_before: String = pool.get().await?.query_one(
        "SELECT row_to_json(ai_run_queued_input)::TEXT FROM ai_run_queued_input WHERE queued_input_id=1", &[],
    ).await?.get(0);
    for table in ["knowledge_guide", "knowledge_guide_revision"] {
        ensure!(!relation_exists(pool, table).await?);
    }

    ensure_schema(pool).await?;
    let after = applied_migration_history(pool).await?;
    ensure!(&after[..before.len()] == before.as_slice());
    for table in ["knowledge_guide", "knowledge_guide_revision"] {
        ensure!(relation_exists(pool, table).await?);
    }
    pool.get()
        .await?
        .batch_execute(
            "INSERT INTO knowledge_guide
         (id, organization_id, company_id, module, latest_revision, review_state,
          create_uid, create_date, write_date)
         VALUES (9007199254740993, 8001, 9001, 'accounting', 1, 'draft',
                 decode(repeat('11', 32), 'hex'), 1, 1);
         INSERT INTO knowledge_guide_revision
         (id, organization_id, company_id, guide_id, revision, title, markdown,
          language, draft_key, sources_json, content_hash, request_key, request_hash,
          create_uid, create_date)
         VALUES (1, 8001, 9001, 9007199254740993, 1, 'Guide', 'Original draft',
                 'en', 'draft-key', '[]', 'content-hash', 'request-key', 'request-hash',
                 decode(repeat('11', 32), 'hex'), 1)",
        )
        .await?;
    let revision_before: String = pool.get().await?.query_one(
        "SELECT row_to_json(knowledge_guide_revision)::TEXT FROM knowledge_guide_revision WHERE id=1", &[],
    ).await?.get(0);

    ensure_schema(pool).await?;
    ensure!(applied_migration_history(pool).await? == after);
    let client = pool.get().await?;
    let queued_after: String = client.query_one(
        "SELECT row_to_json(ai_run_queued_input)::TEXT FROM ai_run_queued_input WHERE queued_input_id=1", &[],
    ).await?.get(0);
    ensure!(queued_after == queued_before);
    let revision_after: String = client.query_one(
        "SELECT row_to_json(knowledge_guide_revision)::TEXT FROM knowledge_guide_revision WHERE id=1", &[],
    ).await?.get(0);
    ensure!(revision_after == revision_before);
    let guide = client
        .query_one("SELECT id::TEXT, latest_revision FROM knowledge_guide", &[])
        .await?;
    ensure!(guide.get::<_, String>(0) == "9007199254740993");
    ensure!(guide.get::<_, i64>(1) == 1);
    Ok(())
}
