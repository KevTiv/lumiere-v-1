use super::*;
use anyhow::{ensure, Result};

fn attempt() -> Attempt {
    Attempt {
        request: "a".repeat(32),
        entity: "product".into(),
        content_hash: "b".repeat(64),
        file_name: Some("products.csv".into()),
        rows: json!([{"batchId":"1","itemId":"2","revision":3}]),
        created_at: "2026-11-07T00:00:00Z".into(),
    }
}

#[test]
fn native_receipt_results_require_exact_request_and_do_not_claim_readback() -> Result<()> {
    let attempt = attempt();
    let receipt = json!({"requestId":attempt.request,"entity":"product","jobId":"9007199254740993","status":"success","totalRows":1,"rowsImported":1,"errorRows":0});
    let projected = project_receipt(&receipt, &attempt)?;
    ensure!(
        projected["jobId"] == "9007199254740993"
            && projected.get("verified").is_none()
            && projected.get("recordIds").is_none()
    );
    for (field, value) in [
        ("requestId", json!("c".repeat(32))),
        ("entity", json!("contact")),
        ("jobId", json!("01")),
        ("status", json!("verified")),
        ("rowsImported", json!(2)),
        ("totalRows", json!(2)),
    ] {
        let mut changed = receipt.clone();
        changed[field] = value;
        ensure!(project_receipt(&changed, &attempt).is_err());
    }
    Ok(())
}

#[tokio::test]
async fn postgres_native_requests_attach_only_complete_actor_owned_task_sources() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping native request association proof (set C4_TEST_PG=1)");
        return Ok(());
    }
    let mut config = pg_pool::PgConfig::from_env()?;
    config.database = "postgres".into();
    let admin = pg_pool::build_pool(&config)?;
    let database = format!(
        "import_native_{}_{}",
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
    let client = pool.get().await?;
    client
        .batch_execute("CREATE SCHEMA lumiere_platform")
        .await?;
    for sql in [
        include_str!("../../../cold_tier/import_review_expand.sql"),
        include_str!("../../../cold_tier/import_review_fields_expand.sql"),
        include_str!("../../../cold_tier/import_tasks_expand.sql"),
        include_str!("../../../cold_tier/import_native_requests_expand.sql"),
    ] {
        client.batch_execute(sql).await?;
    }
    let task = "1".repeat(32);
    let partial = "2".repeat(32);
    let scope = StorageScope {
        organization: 42,
        company: 5,
        actor: "actor-one",
    };
    for (request, actor) in [
        (&task, "actor-one"),
        (&partial, "actor-one"),
        (&task, "actor-two"),
    ] {
        client.execute("INSERT INTO lumiere_platform.import_task (organization_id,company_id,actor_identity,request_id,conversation_key,request_sha256,state,approved_mode,decision_request) VALUES (42,5,$1,$2,'conversation',$3,'needs_review','prepare_import','{}')",&[&actor,request,&"a".repeat(64)]).await?;
    }
    let mut batches = Vec::new();
    for letter in ['a', 'b'] {
        let batch:i64=client.query_one("INSERT INTO lumiere_platform.import_review_batch (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) VALUES (42,5,'Products','product','products.csv',$1,'actor-one') RETURNING id",&[&letter.to_string().repeat(64)]).await?.get(0);
        batches.push(batch);
        for actor in ["actor-one", "actor-two"] {
            client.execute("INSERT INTO lumiere_platform.import_task_review (organization_id,company_id,actor_identity,request_id,batch_id) VALUES (42,5,$1,$2,$3)",&[&actor,&task,&batch]).await?;
        }
    }
    client.execute("INSERT INTO lumiere_platform.import_task_review (organization_id,company_id,actor_identity,request_id,batch_id) VALUES (42,5,'actor-one',$1,$2)",&[&partial,&batches[0]]).await?;
    drop(client);
    let rows = vec![
        json!({"importRow":2,"batchId":batches[0].to_string(),"itemId":"91","revision":1}),
        json!({"importRow":3,"batchId":batches[1].to_string(),"itemId":"92","revision":2}),
    ];
    let request = "3".repeat(32);
    let digest = "c".repeat(64);
    let (first, second) = tokio::join!(
        record(
            pool,
            scope,
            "product",
            &request,
            &digest,
            Some("products.csv"),
            &rows
        ),
        record(
            pool,
            scope,
            "product",
            &request,
            &digest,
            Some("products.csv"),
            &rows
        )
    );
    first?;
    second?;
    let client = pool.get().await?;
    let associations=client.query("SELECT actor_identity,task_request_id,review_rows FROM lumiere_platform.import_task_native_request",&[]).await?;
    ensure!(
        associations.len() == 1
            && associations[0].get::<_, String>("task_request_id") == task
            && associations[0].get::<_, String>("actor_identity") == "actor-one"
    );
    ensure!(associations[0].get::<_, Value>("review_rows") == json!(rows));
    ensure!(record(
        pool,
        scope,
        "product",
        &request,
        &"d".repeat(64),
        Some("products.csv"),
        &rows
    )
    .await
    .is_err());
    ensure!(client
        .execute(
            "DELETE FROM lumiere_platform.import_task_native_request",
            &[]
        )
        .await
        .is_err());
    ensure!(client
        .execute(
            "UPDATE lumiere_platform.import_task_native_request SET entity='contact'",
            &[]
        )
        .await
        .is_err());
    Ok(())
}
