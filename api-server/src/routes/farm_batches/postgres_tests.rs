use super::*;
use anyhow::{ensure, Result};
use deadpool_postgres::Pool;

#[tokio::test]
async fn postgres_farm_events_replay_and_preserve_corrections() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping farm batch storage proof (set C4_TEST_PG=1 to run)");
        return Ok(());
    }

    let mut config = pg_pool::PgConfig::from_env()?;
    config.database = "postgres".into();
    let admin = pg_pool::build_pool(&config)?;
    let database = format!(
        "farm_core_{}_{}",
        std::process::id(),
        chrono::Utc::now().timestamp_micros()
    );
    admin
        .get()
        .await?
        .batch_execute(&format!("CREATE DATABASE {database}"))
        .await?;
    config.database.clone_from(&database);
    let pool = pg_pool::build_pool(&config)?;
    let result = exercise(&pool).await;
    drop(pool);
    let cleanup = admin
        .get()
        .await?
        .batch_execute(&format!("DROP DATABASE {database} WITH (FORCE)"))
        .await;
    result?;
    cleanup?;
    Ok(())
}

async fn exercise(pool: &Pool) -> Result<()> {
    let mut db = pool.get().await?;
    db.batch_execute("CREATE SCHEMA lumiere_platform").await?;
    db.batch_execute(include_str!("../../cold_tier/farm_batches_expand.sql"))
        .await?;
    db.batch_execute(include_str!("../../cold_tier/farm_native_links_expand.sql"))
        .await?;

    let local_date = NaiveDate::from_ymd_opt(2026, 2, 4).unwrap();
    let scope = FarmScope {
        organization: 42,
        company: 1,
        actor: "operator".into(),
        local_date,
    };
    let other = FarmScope {
        organization: scope.organization,
        company: 2,
        actor: scope.actor.clone(),
        local_date,
    };
    let input = serde_json::from_value(json!({
        "reference":"Flock-01","species":"Chicken","startDate":"2026-01-01","location":"House 1"
    }))?;
    let tx = db.transaction().await?;
    let batch = storage::create_batch(&tx, &scope, "create", &input, false).await?;
    ensure!(batch.revision == 1);
    ensure!(
        ensure_import_batch(&tx, &scope, "import-existing", &input)
            .await?
            .id
            == batch.id
    );
    ensure!(matches!(
        storage::read_batch(&tx, &other, batch.id).await,
        Err(ApiError::NotFound(_))
    ));

    let intake = serde_json::from_value(json!({
        "kind":"intake","businessDate":"2026-01-01","count":100
    }))?;
    let source = EventSource {
        file: "pilot.xlsx".into(),
        sha256: "0".repeat(64),
        sheet: Some("Intake".into()),
        row: 4,
        review_batch_id: 5,
        review_item_id: 6,
        revision: 3,
    };
    let saved = persist_event(
        &tx,
        &scope,
        batch.id,
        "intake",
        Some(1),
        &intake,
        Some(&source),
    )
    .await?;
    let replay = persist_event(&tx, &scope, batch.id, "intake", Some(1), &intake, None).await?;
    ensure!(replay.id == saved.id && replay.source == Some(source));
    ensure!(matches!(
        persist_event(&tx, &scope, batch.id, "stale", Some(1), &intake, None).await,
        Err(ApiError::Conflict(_))
    ));

    let processing = serde_json::from_value(json!({
        "kind":"processing","businessDate":"2026-01-03","count":80
    }))?;
    persist_event(&tx, &scope, batch.id, "process", Some(2), &processing, None).await?;
    let corrected = serde_json::from_value(json!({
        "kind":"intake","businessDate":"2026-01-01","count":99
    }))?;
    let revision = storage::correct_event(
        &tx,
        &scope,
        batch.id,
        saved.id,
        "correction",
        3,
        &corrected,
        "Paper ledger",
    )
    .await?;
    ensure!(revision.id == saved.id && revision.revision == 2);
    let original = find_event_by_request(&tx, &scope, batch.id, "intake")
        .await?
        .ok_or_else(|| anyhow::anyhow!("original receipt missing"))?;
    ensure!(original.revision == 1 && original.event == intake);
    let history = storage::event_history(&tx, &scope, batch.id, saved.id).await?;
    ensure!(history.len() == 2 && history[0]["reason"] == "Paper ledger");

    let other_batch = storage::create_batch(&tx, &other, "create", &input, false).await?;
    for (company, batch_id, journal_line, kind) in [
        ("1", batch.id, "11", "vendor_bill"),
        ("1", batch.id, "12", "expense_report"),
        ("2", other_batch.id, "13", "vendor_bill"),
    ] {
        tx.execute(
            "INSERT INTO lumiere_platform.farm_cost_link
             (organization_id,company_id,journal_line_id,batch_id,source,linked_by)
             VALUES (42,$1::text::numeric,$2::text::numeric,$3,$4,'operator')",
            &[&company, &journal_line, &batch_id, &json!({"kind": kind})],
        )
        .await?;
    }
    let visible_costs =
        native_links::read_cost_rows(&tx, &scope, batch.id, None, false, 10).await?;
    ensure!(visible_costs.len() == 1 && visible_costs[0].get::<_, &str>("journal_line_id") == "11");
    let all_costs = native_links::read_cost_rows(&tx, &scope, batch.id, None, true, 10).await?;
    ensure!(all_costs.len() == 2 && all_costs[0].get::<_, &str>("journal_line_id") == "12");
    ensure!(
        native_links::read_cost_rows(&tx, &other, batch.id, None, true, 10)
            .await?
            .is_empty()
    );
    tx.commit().await?;

    let (batches, cursor) = storage::list_batches(&db, &scope, local_date, i64::MAX).await?;
    ensure!(
        batches.len() == 1
            && batches[0]["revision"] == 4
            && batches[0]["liveHeadcount"] == 19
            && cursor.is_none()
    );
    Ok(())
}
