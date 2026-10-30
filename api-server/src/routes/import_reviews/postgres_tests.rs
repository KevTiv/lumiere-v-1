use super::*;
use anyhow::{ensure, Result};

#[tokio::test]
async fn postgres_review_writes_are_scoped_idempotent_and_revision_checked() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping review storage proof (set C4_TEST_PG=1 to run)");
        return Ok(());
    }
    let mut config = pg_pool::PgConfig::from_env()?;
    config.database = "postgres".into();
    let admin = pg_pool::build_pool(&config)?;
    let database = format!(
        "import_review_{}_{}",
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
    pool.get()
        .await?
        .batch_execute("CREATE SCHEMA lumiere_platform")
        .await?;
    pool.get()
        .await?
        .batch_execute(include_str!("../../cold_tier/import_review_expand.sql"))
        .await?;
    let scoped = StorageScope {
        organization: 8001,
        company: 9001,
        actor: "actor-one",
    };
    let dataset: Dataset = serde_json::from_value(
        json!({"format":"lumiere-import-review/v1","title":"Historic source","targetEntity":"source_observation","sourceFile":"shop.csv","items":[{"key":"row-8","label":"Sausage","source":{"file":"shop.csv","row":8,"sha256":"a".repeat(64)},"issue":"Weight is uncertain","fields":[{"key":"quantity","label":"Actual weight","kind":"decimal","sourceValue":"8","required":true},{"key":"unit_price","label":"Price per kg","kind":"decimal","sourceValue":"600","required":true},{"key":"amount","label":"Total","kind":"decimal","sourceValue":"4800","required":true}],"proposed":{"quantity":null,"unit_price":"4800","amount":"4800"}}]}),
    )?;
    let created = create_draft(pool, scoped, &dataset).await?.0;
    let replay = create_draft(pool, scoped, &dataset).await?.0;
    ensure!(created["id"] == replay["id"] && replay["replayed"] == true);
    let batch = created["id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("missing batch id"))?
        .parse::<i64>()?;
    let id: i64 = pool
        .get()
        .await?
        .query_one(
            "SELECT id FROM lumiere_platform.import_review_item WHERE batch_id=$1",
            &[&batch],
        )
        .await?
        .get(0);
    let mut body: DecisionBody = serde_json::from_value(
        json!({"companyId":9001,"expectedRevision":1,"requestKey":"review-request-first-0001","state":"confirmed","reason":"Confirmed actual weight","values":{"quantity":null,"unit_price":"4800","amount":"4800"}}),
    )?;
    ensure!(matches!(
        save_decision(pool, scoped, batch, id, &body).await,
        Err(ApiError::BadRequest(_))
    ));
    body.values.insert("quantity".into(), Some("1".into()));
    let saved = save_decision(pool, scoped, batch, id, &body).await?.0;
    ensure!(saved["item"]["revision"] == 2);
    ensure!(saved["item"]["source"]["fields"][0]["sourceValue"] == "8");
    let replay = save_decision(pool, scoped, batch, id, &body).await?.0;
    ensure!(replay["replayed"] == true && replay["item"]["revision"] == 2);
    body.request_key = "review-stale-request-0002".into();
    ensure!(matches!(
        save_decision(pool, scoped, batch, id, &body).await,
        Err(ApiError::Conflict(_))
    ));
    body.expected_revision = 2;
    ensure!(matches!(
        save_decision(
            pool,
            StorageScope {
                organization: 8002,
                ..scoped
            },
            batch,
            id,
            &body
        )
        .await,
        Err(ApiError::NotFound(_))
    ));
    body.company_id = 9002;
    ensure!(matches!(
        save_decision(
            pool,
            StorageScope {
                company: 9002,
                ..scoped
            },
            batch,
            id,
            &body
        )
        .await,
        Err(ApiError::NotFound(_))
    ));
    body.company_id = 9001;
    let other: DecisionBody = serde_json::from_value(
        json!({"companyId":9001,"expectedRevision":2,"requestKey":"review-concurrent-request-0003","state":"confirmed","reason":"Second concurrent correction","values":{"quantity":"1","unit_price":"4800","amount":"4800"}}),
    )?;
    let (first, second) = tokio::join!(
        save_decision(pool, scoped, batch, id, &body),
        save_decision(pool, scoped, batch, id, &other)
    );
    ensure!(matches!(
        (&first, &second),
        (Ok(_), Err(ApiError::Conflict(_))) | (Err(ApiError::Conflict(_)), Ok(_))
    ));
    let count: i64 = pool
        .get()
        .await?
        .query_one(
            "SELECT count(*) FROM lumiere_platform.import_review_decision WHERE item_id=$1",
            &[&id],
        )
        .await?
        .get(0);
    ensure!(count == 2);
    let row = pool
        .get()
        .await?
        .query_one(
            "SELECT revision,source_json FROM lumiere_platform.import_review_item WHERE id=$1",
            &[&id],
        )
        .await?;
    ensure!(row.get::<_, i32>("revision") == 3);
    ensure!(row.get::<_, Value>("source_json")["fields"][0]["sourceValue"] == "8");
    Ok(())
}
