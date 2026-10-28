//! Real PostgreSQL upgrade and append-only projection proof for business history.

use super::*;
use crate::cold_tier::commit_projection::{
    apply_commit, canonical_json, change_checksum, commit_checksum_from_changes,
    OrganizationCommitEnvelope, OrganizationRowChangeInput, ProjectionResult,
};
use serde_json::Value;

#[tokio::test]
async fn postgres_finance_history_migration_and_projection_recovery() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping finance history PostgreSQL proof (set C4_TEST_PG=1 to run)");
        return Ok(());
    }
    let base = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin = admin_pool(&base)?;
    create_database(&admin, &database, &base.user).await?;
    let mut config = base;
    config.database.clone_from(&database);
    let pool = pg_pool::build_pool(&config)?;
    let result = exercise_finance_history(&pool).await;
    drop(pool);
    let cleanup = drop_database(&admin, &database).await;
    result?;
    cleanup?;
    Ok(())
}

#[tokio::test]
async fn postgres_finance_27_to_harness_28_preserves_history() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping harness upgrade proof (set C4_TEST_PG=1 to run)");
        return Ok(());
    }
    let base = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin = admin_pool(&base)?;
    create_database(&admin, &database, &base.user).await?;
    let mut config = base;
    config.database.clone_from(&database);
    let pool = pg_pool::build_pool(&config)?;
    let result = exercise_harness_upgrade(&pool).await;
    drop(pool);
    let cleanup = drop_database(&admin, &database).await;
    result?;
    cleanup?;
    Ok(())
}

async fn exercise_harness_upgrade(pool: &Pool) -> Result<()> {
    let index = MIGRATIONS
        .iter()
        .position(|m| m.version == 28)
        .context("harness migration is present")?;
    ensure!(MIGRATIONS[index - 1].version == 27);
    ensure!(MIGRATIONS[index - 1].name == "finance_business_change_history");
    ensure!(MIGRATIONS[index].name == "ai_harness_v2_projection");
    apply_migration_prefix(pool, index).await?;
    let before = applied_migration_history(pool).await?;
    let manifest = history_manifest()?;
    let changes = vec![history_change(
        8001,
        1,
        0,
        history_row(8001, 9_007_199_254_740_993, "20.50"),
    )?];
    let commit = history_commit(8001, 1, &changes);
    ensure!(apply_commit(pool, &manifest, &commit, &changes).await? == ProjectionResult::Applied);
    let row_before: String = pool.get().await?.query_one(
        "SELECT row_to_json(business_change)::TEXT FROM business_change WHERE organization_id=8001", &[]
    ).await?.get(0);
    for table in [
        "ai_run_budget_park",
        "ai_run_budget_resume_job",
        "ai_run_queued_input",
    ] {
        ensure!(!relation_exists(pool, table).await?);
    }
    ensure_schema(pool).await?;
    let after = applied_migration_history(pool).await?;
    ensure!(&after[..before.len()] == before.as_slice());
    for table in [
        "ai_run_budget_park",
        "ai_run_budget_resume_job",
        "ai_run_queued_input",
    ] {
        ensure!(relation_exists(pool, table).await?);
    }
    let row_after: String = pool.get().await?.query_one(
        "SELECT row_to_json(business_change)::TEXT FROM business_change WHERE organization_id=8001", &[]
    ).await?.get(0);
    ensure!(row_before == row_after);
    ensure!(watermark(pool, 8001).await? == Some("1".into()));
    ensure!(
        apply_commit(pool, &manifest, &commit, &changes).await? == ProjectionResult::AlreadyApplied
    );
    ensure_schema(pool).await?;
    ensure!(applied_migration_history(pool).await? == after);
    Ok(())
}

fn history_manifest() -> Result<String> {
    // Local source validation may precede the immutable contracts release.
    // Only an explicitly supplied real codegen output may replace the current
    // released manifest; CI normally uses the new canonical pinned manifest.
    let manifest = match std::env::var("FCR_TEST_PROJECTION_MANIFEST") {
        Ok(path) => {
            std::fs::read_to_string(path).context("read generated finance history codec")?
        }
        Err(_) => projection_worker::PROJECTION_CODEC_MANIFEST_JSON.to_string(),
    };
    let value: Value = serde_json::from_str(&manifest)?;
    ensure!(
        value["tables"]["business_change"]["projection_mode"] == "append-history",
        "the generated business_change append-history codec must be released or supplied explicitly"
    );
    Ok(manifest)
}

fn history_row(org: u64, id: u64, after: &str) -> Value {
    json!({
        "id":id,"organization_id":org,"company_id":7,"resource":"account_move","record_id":9,
        "subject_resource":"account_move_line","subject_record_id":10,"operation":"update_account_move_line",
        "actor_identity":{"__identity__":format!("0x{}", "ab".repeat(32))},
        "occurred_at":{"__timestamp_micros_since_unix_epoch__":1_762_000_000_123_456_i64},
        "schema_version":1,"before_fingerprint":format!("sha256:{}", "1".repeat(64)),
        "after_fingerprint":format!("sha256:{}", "2".repeat(64)),
        "changes_json":json!([{"field":"debit","before":"10.25","after":after}]).to_string(),
        "audit_log_id":17
    })
}

fn history_change(
    org: u64,
    sequence: u64,
    ordinal: u32,
    row: Value,
) -> Result<OrganizationRowChangeInput> {
    let row_identity_json = canonical_json(&json!({"id":row["id"]}))?;
    let row_json = canonical_json(&row)?;
    Ok(OrganizationRowChangeInput {
        id: format!("{org}:{sequence}:{ordinal}"),
        organization_id: org,
        commit_sequence: sequence,
        ordinal,
        table_name: "business_change".into(),
        checksum: change_checksum("business_change", &row_identity_json, "upsert", &row_json),
        row_identity_json,
        change_kind: "upsert".into(),
        row_json: Some(row_json),
    })
}

fn history_commit(
    org: u64,
    sequence: u64,
    changes: &[OrganizationRowChangeInput],
) -> OrganizationCommitEnvelope {
    let mut commit = OrganizationCommitEnvelope {
        id: format!("{org}:{sequence}"),
        organization_id: org,
        sequence,
        operation_id: "erp.update_account_move_line".into(),
        correlation_id: format!("finance-history-{org}-{sequence}"),
        change_schema_version: 1,
        contract_version: "ir-v2".into(),
        occurred_at_micros: 1_762_000_000_123_456,
        actor_identity_hex: "ab".repeat(32),
        row_change_count: changes.len() as u32,
        checksum: String::new(),
    };
    commit.checksum = commit_checksum_from_changes(
        &commit,
        changes.iter().map(|change| change.checksum.as_str()),
    );
    commit
}

async fn watermark(pool: &Pool, org: u64) -> Result<Option<String>> {
    Ok(pool.get().await?.query_opt("SELECT applied_sequence::TEXT FROM organization_projection_watermark WHERE organization_id=$1::TEXT::NUMERIC",&[&org.to_string()]).await?.map(|row|row.get(0)))
}

async fn count_history(pool: &Pool, org: u64) -> Result<i64> {
    Ok(pool
        .get()
        .await?
        .query_one(
            "SELECT count(*) FROM business_change WHERE organization_id=$1::TEXT::NUMERIC",
            &[&org.to_string()],
        )
        .await?
        .get(0))
}

async fn exercise_finance_history(pool: &Pool) -> Result<()> {
    let migration_index = MIGRATIONS
        .iter()
        .position(|migration| migration.version == 27)
        .context("finance migration is present")?;
    let migration = &MIGRATIONS[migration_index];
    ensure!(migration.name == "finance_business_change_history");
    let manifest = history_manifest()?;
    apply_migration_prefix(pool, migration_index).await?;
    ensure!(!relation_exists(pool, "business_change").await?);
    let prior_history = applied_migration_history(pool).await?;
    pool.get()
        .await?
        .execute(
            "INSERT INTO organization_commit_cursor(organization_id,next_sequence) VALUES(999,41)",
            &[],
        )
        .await?;
    ensure_schema(pool).await?;
    let next_history = applied_migration_history(pool).await?;
    ensure!(
        &next_history[..prior_history.len()] == prior_history.as_slice(),
        "released migration identities and bytes changed"
    );
    ensure!(next_history.len() == MIGRATIONS.len());
    ensure!(applied_checksum(pool, 27).await? == migration_checksum(migration.sql));
    ensure!(pool.get().await?.query_one("SELECT next_sequence::TEXT FROM organization_commit_cursor WHERE organization_id=999",&[]).await?.get::<_,String>(0)=="41");
    ensure_schema(pool).await?;
    ensure!(
        applied_migration_history(pool).await? == next_history,
        "upgrade replay changed migration history"
    );
    let primary_key:String=pool.get().await?.query_one("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='business_change'::regclass AND contype='p'",&[]).await?.get(0);
    ensure!(primary_key == "PRIMARY KEY (organization_id, id)");

    // A complete event and its exact commit/watermark persist together.
    let event_id = 9_007_199_254_740_993;
    let first = vec![history_change(
        7001,
        1,
        0,
        history_row(7001, event_id, "20.50"),
    )?];
    let commit = history_commit(7001, 1, &first);
    ensure!(apply_commit(pool, &manifest, &commit, &first).await? == ProjectionResult::Applied);
    ensure!(
        apply_commit(pool, &manifest, &commit, &first).await? == ProjectionResult::AlreadyApplied
    );
    ensure!(
        count_history(pool, 7001).await? == 1 && watermark(pool, 7001).await? == Some("1".into())
    );
    let stored=pool.get().await?.query_one("SELECT id::TEXT,changes_json,encode(actor_identity,'hex'),occurred_at FROM business_change WHERE organization_id=7001",&[]).await?;
    ensure!(stored.get::<_, String>(0) == event_id.to_string());
    ensure!(
        stored.get::<_, String>(1)
            == history_row(7001, event_id, "20.50")["changes_json"]
                .as_str()
                .unwrap()
    );
    ensure!(stored.get::<_, String>(2) == "ab".repeat(32));
    ensure!(stored.get::<_, i64>(3) == 1_762_000_000_123_456);

    // Equal source IDs in another organization neither collide nor replace.
    let other = vec![history_change(
        7002,
        1,
        0,
        history_row(7002, event_id, "35.75"),
    )?];
    ensure!(
        apply_commit(pool, &manifest, &history_commit(7002, 1, &other), &other).await?
            == ProjectionResult::Applied
    );
    ensure!(count_history(pool, 7001).await? == 1 && count_history(pool, 7002).await? == 1);

    // A later attempted replacement fails the existing append-history writer;
    // it cannot overwrite the old event or advance its organization cursor.
    let replacement = vec![history_change(
        7001,
        2,
        0,
        history_row(7001, event_id, "999.00"),
    )?];
    ensure!(apply_commit(
        pool,
        &manifest,
        &history_commit(7001, 2, &replacement),
        &replacement
    )
    .await
    .is_err());
    ensure!(watermark(pool, 7001).await? == Some("1".into()));
    ensure!(pool.get().await?.query_one("SELECT changes_json FROM business_change WHERE organization_id=7001 AND id=$1::TEXT::NUMERIC",&[&event_id.to_string()]).await?.get::<_,String>(0)==stored.get::<_,String>(1));

    let foreign = vec![history_change(
        7001,
        2,
        0,
        history_row(7002, event_id + 1, "40.00"),
    )?];
    ensure!(apply_commit(
        pool,
        &manifest,
        &history_commit(7001, 2, &foreign),
        &foreign
    )
    .await
    .is_err());
    let mut deleted = first[0].clone();
    deleted.id = "7001:2:0".into();
    deleted.commit_sequence = 2;
    deleted.change_kind = "delete".into();
    deleted.row_json = None;
    deleted.checksum = change_checksum("business_change", &deleted.row_identity_json, "delete", "");
    let deleted = vec![deleted];
    ensure!(apply_commit(
        pool,
        &manifest,
        &history_commit(7001, 2, &deleted),
        &deleted
    )
    .await
    .is_err());
    ensure!(
        count_history(pool, 7001).await? == 1 && watermark(pool, 7001).await? == Some("1".into())
    );

    // Force the second actual PG insert to fail after the first was attempted.
    // The first event, durable envelope and cursor must all roll back, allowing
    // the same exact commit to retry after the temporary failure is removed.
    pool.get().await?.batch_execute("CREATE FUNCTION fcr_reject_second_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=2 THEN RAISE EXCEPTION 'disposable history insert failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fcr_reject_second_event BEFORE INSERT ON business_change FOR EACH ROW EXECUTE FUNCTION fcr_reject_second_event();").await?;
    let batch = vec![
        history_change(7003, 1, 0, history_row(7003, 1, "20.50"))?,
        history_change(7003, 1, 1, history_row(7003, 2, "30.75"))?,
    ];
    let batch_commit = history_commit(7003, 1, &batch);
    ensure!(apply_commit(pool, &manifest, &batch_commit, &batch)
        .await
        .is_err());
    ensure!(count_history(pool, 7003).await? == 0 && watermark(pool, 7003).await?.is_none());
    ensure!(
        pool.get()
            .await?
            .query_one(
                "SELECT count(*) FROM organization_commit WHERE organization_id=7003",
                &[]
            )
            .await?
            .get::<_, i64>(0)
            == 0
    );
    pool.get().await?.batch_execute("DROP TRIGGER fcr_reject_second_event ON business_change; DROP FUNCTION fcr_reject_second_event();").await?;
    ensure!(
        apply_commit(pool, &manifest, &batch_commit, &batch).await? == ProjectionResult::Applied
    );
    ensure!(
        apply_commit(pool, &manifest, &batch_commit, &batch).await?
            == ProjectionResult::AlreadyApplied
    );
    ensure!(
        count_history(pool, 7003).await? == 2 && watermark(pool, 7003).await? == Some("1".into())
    );
    Ok(())
}
