use super::*;
use anyhow::{ensure, Result};

fn candidate(
    batch: i64,
    item: i64,
    sha: &str,
    sheet: &str,
    reference: &str,
    kind: &str,
) -> Candidate {
    let mut values = BTreeMap::from([
        ("flock_reference".into(), Some("CHICK-23".into())),
        ("event_reference".into(), Some(reference.into())),
        ("business_date".into(), Some("2026-11-08".into())),
        ("event_kind".into(), Some(kind.into())),
    ]);
    if kind == "intake" {
        values.extend([
            ("count".into(), Some("100.0".into())),
            ("location".into(), Some("House A".into())),
            ("species".into(), Some("Chicken".into())),
        ]);
    } else {
        values.insert("count".into(), Some("4".into()));
    }
    let confirmed = values.keys().cloned().collect();
    review_facts(
        &values,
        &confirmed,
        EventSource {
            file: "flock.xlsx".into(),
            sha256: sha.repeat(64),
            sheet: Some(sheet.into()),
            row: 3,
            review_batch_id: batch,
            review_item_id: item,
            revision: 2,
        },
        2,
    )
    .expect("confirmed row")
}

#[test]
fn identical_event_reexports_keep_request_identity_but_change_review_digest() {
    let first = candidate(1, 2, "a", "Intake", "receipt-17", "intake");
    let replay = candidate(2, 3, "b", "Batch record", "receipt-17", "intake");
    assert_eq!(first.request_key, replay.request_key);
    assert_eq!(
        serde_json::to_value(first.effect).unwrap(),
        serde_json::to_value(replay.effect).unwrap()
    );
    assert_ne!(first.digest, replay.digest);
    assert_ne!(
        first.request_key,
        candidate(1, 4, "a", "Mortality", "death-21", "mortality").request_key
    );
}

#[tokio::test]
async fn postgres_farm_import_binds_selected_worksheets_and_replays_safely() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping farm import storage proof (set C4_TEST_PG=1)");
        return Ok(());
    }
    let mut config = pg_pool::PgConfig::from_env()?;
    config.database = "postgres".into();
    let admin = pg_pool::build_pool(&config)?;
    let database = format!(
        "farm_import_{}_{}",
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

async fn exercise(pool: &deadpool_postgres::Pool) -> Result<()> {
    let mut client = pool.get().await?;
    client
        .batch_execute("CREATE SCHEMA lumiere_platform")
        .await?;
    for migration in [
        include_str!("../../../cold_tier/import_review_expand.sql"),
        include_str!("../../../cold_tier/import_tasks_expand.sql"),
        include_str!("../../../cold_tier/farm_batches_expand.sql"),
        include_str!("../../../cold_tier/farm_native_links_expand.sql"),
        include_str!("../../../cold_tier/farm_import_events_expand.sql"),
    ] {
        client.batch_execute(migration).await?;
    }
    let farm = FarmScope::for_test(41, 21, "reviewer");
    let tx = client.transaction().await?;
    let task_id = "c".repeat(32);
    tx.execute(
        "INSERT INTO lumiere_platform.import_task
         (organization_id,company_id,actor_identity,request_id,conversation_key,request_sha256,decision_request)
         VALUES (41,21,'reviewer',$1,'farm-import',$2,'{}')",
        &[&task_id, &"a".repeat(64)],
    ).await?;
    let mut review_batches = Vec::new();
    for marker in ["a", "b"] {
        let batch: i64 = tx
            .query_one(
                "INSERT INTO lumiere_platform.import_review_batch
             (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by)
             VALUES (41,21,'Farm book','farm_event','flock.xlsx',$1,'reviewer') RETURNING id",
                &[&marker.repeat(64)],
            )
            .await?
            .get(0);
        tx.execute("INSERT INTO lumiere_platform.import_task_review (organization_id,company_id,actor_identity,request_id,batch_id) VALUES (41,21,'reviewer',$1,$2)", &[&task_id, &batch]).await?;
        let items: Vec<i64> = tx.query(
            "INSERT INTO lumiere_platform.import_review_item
             (organization_id,company_id,batch_id,source_key,source_json,proposed_json,revision)
             VALUES (41,21,$1,'intake','{}','{}',2),(41,21,$1,'mortality','{}','{}',2) RETURNING id",
            &[&batch],
        ).await?.iter().map(|row| row.get(0)).collect();
        review_batches.push((batch, items));
    }
    let (first_batch, items) = &review_batches[0];
    let intake = candidate(
        *first_batch,
        items[0],
        "a",
        "Intake",
        "receipt-17",
        "intake",
    );
    let mortality = candidate(
        *first_batch,
        items[1],
        "a",
        "Mortality",
        "death-21",
        "mortality",
    );
    let mut prospective = BTreeMap::new();
    ensure!(preview(&tx, &farm, true, &intake, &mut prospective).await?["status"] == "ready");
    ensure!(preview(&tx, &farm, true, &mortality, &mut prospective).await?["status"] == "ready");
    ensure!(find_batch_by_reference(&tx, &farm, "CHICK-23")
        .await?
        .is_none());
    let intake_result = apply(&tx, &farm, true, &intake).await?;
    ensure!(intake_result["status"] == "saved");
    require_origin_available(&tx, &farm, &mortality).await?;
    let saved = apply(&tx, &farm, true, &mortality).await?;
    ensure!(saved["status"] == "saved" && saved["eventId"] != intake_result["eventId"]);
    ensure!(apply(&tx, &farm, true, &mortality).await?["status"] == "matched");

    let (second_batch, items) = &review_batches[1];
    let replay = candidate(
        *second_batch,
        items[0],
        "b",
        "Death log",
        "death-21",
        "mortality",
    );
    let replay_preview = preview(&tx, &farm, true, &replay, &mut BTreeMap::new()).await?;
    ensure!(replay_preview["existingEventId"] == saved["eventId"]);
    ensure!(apply(&tx, &farm, true, &replay).await?["eventId"] == saved["eventId"]);
    let remapped = candidate(
        *second_batch,
        items[1],
        "a",
        "Mortality",
        "new-reference",
        "mortality",
    );
    ensure!(matches!(
        require_origin_available(&tx, &farm, &remapped).await,
        Err(ApiError::Conflict(_))
    ));

    let batch = find_batch_by_reference(&tx, &farm, "CHICK-23")
        .await?
        .expect("saved flock");
    let events = list_events(&tx, &farm, batch.id).await?;
    ensure!(events.len() == 2);
    ensure!(
        events[1]
            .source
            .as_ref()
            .and_then(|source| source.sheet.as_deref())
            == Some("Mortality")
    );
    let scope = StorageScope {
        organization: 41,
        company: 21,
        actor: "reviewer",
    };
    let (results, more) = task_results(&tx, scope, &task_id).await?;
    ensure!(!more && results == vec![json!({"batchId":batch.id.to_string(),"count":2})]);
    let other = StorageScope {
        company: 22,
        ..scope
    };
    ensure!(task_results(&tx, other, &task_id).await?.0.is_empty());
    tx.commit().await?;
    Ok(())
}
