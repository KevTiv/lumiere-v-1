use super::*;
use anyhow::{ensure, Result};

fn attempt() -> Attempt {
    Attempt {
        submitter: "actor".into(),
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

#[test]
fn large_source_pages_require_exact_distinct_mappings() -> Result<()> {
    let rows: Vec<_> = (2..=45).rev().map(|row| json!({"importRow":row})).collect();
    let first = source_page(&rows, 0)?;
    ensure!(first.len() == 21 && first[19].0 == 21);
    let remaining = source_page(&rows, first[19].0)?;
    ensure!(remaining.first().map(|row| row.0) == Some(22) && remaining[19].0 == 41);
    ensure!(source_page(&rows, remaining[19].0)?.len() == 4);
    ensure!(source_page(&[json!({"importRow":2}), json!({"importRow":2})], 0).is_err());
    ensure!(source_page(&[json!({"itemId":"9"})], 0).is_err());

    let exact = json!({"organization_id":7,"job_id":13,"table_name":"product","row_number":2,"record_id":"9007199254740993"});
    let other = json!({"organization_id":8,"job_id":13,"table_name":"product","row_number":2,"record_id":15});
    let candidates = vec![exact.clone(), other];
    ensure!(
        exact_mapping(&candidates, 7, 13, "product", 2).map(|(id, _)| id) == Some(9007199254740993)
    );
    ensure!(exact_mapping(&candidates, 7, 13, "contact", 2).is_none());
    ensure!(exact_mapping(&[exact.clone(), exact], 7, 13, "product", 2).is_none());
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
        include_str!("../../../cold_tier/import_workflow_expand.sql"),
        include_str!("../../../cold_tier/import_task_inspection_expand.sql"),
        include_str!("../../../cold_tier/import_native_requests_expand.sql"),
        include_str!("../../../cold_tier/import_task_handoff_expand.sql"),
        include_str!("../../../cold_tier/import_workflow_actors_expand.sql"),
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
    // Identical timestamps exercise the immutable request ID tie-breaker.
    client.execute("INSERT INTO lumiere_platform.import_task_native_request
        (organization_id,company_id,actor_identity,task_request_id,native_request_id,entity,content_sha256,review_rows,created_at)
        SELECT 42,5,actor,$1,lpad(to_hex(i),32,'0'),'product',$2,$3,'2000-01-01 00:00:00+00'
        FROM generate_series(1,24) i CROSS JOIN (VALUES ('actor-one'),('actor-two')) AS a(actor)",
        &[&task,&digest,&json!(rows)]).await?;
    let first = client
        .query(
            ATTEMPT_PAGE,
            &[&"42", &"5", &"actor-one", &task, &None::<String>],
        )
        .await?;
    ensure!(first.len() == 21);
    let anchor: String = first[19].get("native_request_id");
    let second = client
        .query(
            ATTEMPT_PAGE,
            &[&"42", &"5", &"actor-one", &task, &Some(anchor)],
        )
        .await?;
    ensure!(second.len() == 5);
    let foreign = client
        .query(
            ATTEMPT_PAGE,
            &[&"42", &"5", &"actor-two", &task, &Some(request)],
        )
        .await?;
    ensure!(foreign.is_empty());
    client
        .execute(
            "INSERT INTO lumiere_platform.import_task_handoff
       (organization_id,company_id,actor_identity,request_id,recipient_identity,revision)
       VALUES (42,5,'actor-one',$1,'owner',1)",
            &[&task],
        )
        .await?;
    drop(client);
    ensure!(record_for_task(
        pool,
        scope,
        "owner",
        &task,
        "product",
        &request,
        &digest,
        Some("products.csv"),
        &rows
    )
    .await
    .is_err());
    let attempt_id = "4".repeat(32);
    let new_rows =
        [json!({"importRow":2,"batchId":batches[0].to_string(),"itemId":"93","revision":1})];
    for _ in 0..2 {
        record_for_task(
            pool,
            scope,
            "owner",
            &task,
            "product",
            &attempt_id,
            &digest,
            Some("products.csv"),
            &new_rows,
        )
        .await?;
    }
    let client = pool.get().await?;
    let saved = client
        .query_one(
            "SELECT actor_identity, submitted_by FROM lumiere_platform.import_task_native_request
       WHERE native_request_id=$1",
            &[&attempt_id],
        )
        .await?;
    ensure!(saved.get::<_, String>("actor_identity") == "actor-one");
    ensure!(saved.get::<_, String>("submitted_by") == "owner");
    client
        .execute(
            "UPDATE lumiere_platform.import_task_handoff SET recipient_identity=NULL,revision=2
       WHERE organization_id=42 AND company_id=5 AND actor_identity='actor-one' AND request_id=$1",
            &[&task],
        )
        .await?;
    drop(client);
    ensure!(record_for_task(
        pool,
        scope,
        "owner",
        &task,
        "product",
        &attempt_id,
        &digest,
        Some("products.csv"),
        &new_rows
    )
    .await
    .is_err());
    Ok(())
}
