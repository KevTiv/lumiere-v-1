use super::*;
use serde_json::Value;

#[tokio::test]
async fn postgres_import_review_30_preserves_source_and_scopes_relationships() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping source review migration proof (set C4_TEST_PG=1 to run)");
        return Ok(());
    }
    let base = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin = admin_pool(&base)?;
    create_database(&admin, &database, &base.user).await?;
    let mut config = base;
    config.database.clone_from(&database);
    let pool = pg_pool::build_pool(&config)?;
    let result = exercise(&pool).await;
    drop(pool);
    let cleanup = drop_database(&admin, &database).await;
    result?;
    cleanup?;
    Ok(())
}

async fn exercise(pool: &Pool) -> Result<()> {
    let index = MIGRATIONS
        .iter()
        .position(|migration| migration.version == 30)
        .context("review migration is present")?;
    apply_migration_prefix(pool, index).await?;
    let before = applied_migration_history(pool).await?;
    ensure_schema(pool).await?;
    let after = applied_migration_history(pool).await?;
    ensure!(&after[..before.len()] == before.as_slice());
    let mut client = pool.get().await?;
    let batch: i64 = client.query_one("INSERT INTO lumiere_platform.import_review_batch (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) VALUES (8001,9001,'Historic products','product','shop.csv',repeat('a',64),'actor-one') RETURNING id",&[]).await?.get(0);
    let source =
        json!({"label":"Sausage","quantity":"8","unit_price":"600","amount":"4800","unit":null});
    let proposal = json!({"quantity":null,"unit_price":"4800","amount":"4800","unit":"kg"});
    let id: i64 = client.query_one("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json) VALUES (8001,9001,$1,'row-2',$2,$3) RETURNING id",&[&batch,&source,&proposal]).await?.get(0);
    ensure!(client.execute("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json) VALUES (8002,9001,$1,'cross-org','{}','{}')",&[&batch]).await.is_err());
    ensure!(client.execute("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json) VALUES (8001,9002,$1,'cross-company','{}','{}')",&[&batch]).await.is_err());
    ensure!(client
        .execute(
            "UPDATE lumiere_platform.import_review_item SET source_json='{}' WHERE id=$1",
            &[&id]
        )
        .await
        .is_err());
    let corrected = json!({"quantity":"1","unit_price":"4800","amount":"4800","unit":"kg"});
    let tx = client.transaction().await?;
    tx.execute("INSERT INTO lumiere_platform.import_review_decision (organization_id,company_id,item_id,revision,request_key,proposed_json,state,reason,actor_identity) VALUES (8001,9001,$1,2,'source-review-test-key',$2,'confirmed','Confirmed actual weight','actor-two')",&[&id,&corrected]).await?;
    tx.execute("UPDATE lumiere_platform.import_review_item SET proposed_json=$2,state='confirmed',revision=2,reviewed_by='actor-two',reviewed_at=now(),reason='Confirmed actual weight' WHERE id=$1",&[&id,&corrected]).await?;
    tx.commit().await?;
    let row = client.query_one("SELECT source_json,proposed_json,revision,state FROM lumiere_platform.import_review_item WHERE organization_id=8001 AND company_id=9001 AND id=$1",&[&id]).await?;
    ensure!(row.get::<_, Value>("source_json") == source);
    ensure!(row.get::<_, Value>("proposed_json") == corrected);
    ensure!(row.get::<_, i32>("revision") == 2);
    ensure!(row.get::<_, String>("state") == "confirmed");
    ensure!(client.execute("INSERT INTO lumiere_platform.import_review_decision (organization_id,company_id,item_id,revision,request_key,proposed_json,state,reason,actor_identity) VALUES (8001,9001,$1,3,'source-review-test-key',$2,'confirmed','Duplicate request','actor-two')",&[&id,&corrected]).await.is_err());
    ensure!(client.execute("INSERT INTO lumiere_platform.import_review_decision (organization_id,company_id,item_id,revision,request_key,proposed_json,state,reason,actor_identity) VALUES (8002,9001,$1,3,'cross-org-decision',$2,'confirmed','Cross scope','actor-two')",&[&id,&corrected]).await.is_err());
    ensure_schema(pool).await?;
    ensure!(applied_migration_history(pool).await? == after);
    Ok(())
}

#[tokio::test]
async fn postgres_import_review_32_preserves_decisions_and_backfills_only_confirmed_values(
) -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping field decision migration proof (set C4_TEST_PG=1 to run)");
        return Ok(());
    }
    let base = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin = admin_pool(&base)?;
    create_database(&admin, &database, &base.user).await?;
    let mut config = base;
    config.database.clone_from(&database);
    let pool = pg_pool::build_pool(&config)?;
    let result = exercise_field_decisions(&pool).await;
    drop(pool);
    let cleanup = drop_database(&admin, &database).await;
    result?;
    cleanup?;
    Ok(())
}

async fn exercise_field_decisions(pool: &Pool) -> Result<()> {
    apply_migration_prefix(pool, 31).await?;
    let history = applied_migration_history(pool).await?;
    let client = pool.get().await?;
    let batch: i64 = client.query_one("INSERT INTO lumiere_platform.import_review_batch (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) VALUES (8001,9001,'Farm history','source_observation','farm.csv',repeat('b',64),'actor-one') RETURNING id", &[]).await?.get(0);
    let source = json!({"quantity":"8","price":"600","total":"4800","weight":null});
    let proposal = json!({"price":"4800","unit":"kg","weight":null,"note":""});
    let confirmed: i64 = client.query_one("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json,state,revision) VALUES (8001,9001,$1,'confirmed',$2,$3,'confirmed',2) RETURNING id", &[&batch,&source,&proposal]).await?.get(0);
    let pending: i64 = client.query_one("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json) VALUES (8001,9001,$1,'pending',$2,$3) RETURNING id", &[&batch,&source,&proposal]).await?.get(0);
    client.execute("INSERT INTO lumiere_platform.import_review_decision (organization_id,company_id,item_id,revision,request_key,proposed_json,state,reason,actor_identity) VALUES (8001,9001,$1,2,'migration-32-confirmed',$2,'confirmed','Confirmed source values','actor-one')", &[&confirmed,&proposal]).await?;
    drop(client);

    ensure_schema(pool).await?;
    let after = applied_migration_history(pool).await?;
    ensure!(after[..history.len()] == history);
    let client = pool.get().await?;
    for (id, expected) in [(confirmed, json!(["price", "unit"])), (pending, json!([]))] {
        let row = client.query_one("SELECT source_json,proposed_json,confirmed_fields FROM lumiere_platform.import_review_item WHERE id=$1", &[&id]).await?;
        ensure!(row.get::<_, Value>("source_json") == source);
        ensure!(row.get::<_, Value>("proposed_json") == proposal);
        ensure!(row.get::<_, Value>("confirmed_fields") == expected);
    }
    let decision = client.query_one("SELECT proposed_json,confirmed_fields,reason FROM lumiere_platform.import_review_decision WHERE item_id=$1", &[&confirmed]).await?;
    ensure!(decision.get::<_, Value>("proposed_json") == proposal);
    ensure!(decision.get::<_, Value>("confirmed_fields") == json!(["price", "unit"]));
    ensure!(decision.get::<_, String>("reason") == "Confirmed source values");
    ensure!(client
        .execute(
            "UPDATE lumiere_platform.import_review_item SET confirmed_fields='{}' WHERE id=$1",
            &[&pending]
        )
        .await
        .is_err());
    drop(client);
    ensure_schema(pool).await?;
    ensure!(applied_migration_history(pool).await? == after);
    Ok(())
}
