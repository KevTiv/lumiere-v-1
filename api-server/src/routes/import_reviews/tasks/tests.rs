use super::*;
use anyhow::{ensure, Result};

fn submission() -> Submission {
    Submission {
        company_id: 9001,
        request_id: "a".repeat(32),
        conversation_key: "conversation-one".into(),
        files: vec![SourceFile {
            file_name: "products.csv".into(),
            content_base64: STANDARD.encode(b"name,sale_price,cost_price\nEggs,600,400\n"),
        }],
    }
}

#[test]
fn exact_bytes_company_filename_and_conversation_bind_submission_identity() -> Result<()> {
    let mut body = submission();
    let (sources, initial) = decode_submission(&body)?;
    ensure!(sources[0].bytes == b"name,sale_price,cost_price\nEggs,600,400\n");
    ensure!(decode_submission(&body)?.1 == initial);
    body.company_id = 9002;
    ensure!(decode_submission(&body)?.1 != initial);
    body.company_id = 9001;
    body.files[0].file_name = "renamed.csv".into();
    ensure!(decode_submission(&body)?.1 != initial);
    body.files[0].file_name = "products.csv".into();
    body.conversation_key = "conversation-two".into();
    ensure!(decode_submission(&body)?.1 != initial);
    body.files[0].content_base64 = STANDARD.encode(b"changed bytes");
    ensure!(decode_submission(&body)?.1 != initial);
    Ok(())
}

#[test]
fn upload_validation_rejects_paths_invalid_encoding_and_limits() {
    for filename in ["../products.csv", "a\\b.csv", "file.txt", "a\n.csv"] {
        let mut body = submission();
        body.files[0].file_name = filename.into();
        assert!(decode_submission(&body).is_err());
    }
    let mut body = submission();
    body.files[0].content_base64 = "invalid!".into();
    assert!(decode_submission(&body).is_err());
    body.files[0].content_base64 = STANDARD.encode(vec![b'a'; MAX_FILE_BYTES + 1]);
    assert!(decode_submission(&body).is_err());
    body.files.clear();
    assert!(decode_submission(&body).is_err());
}

fn prepared(source: &Original) -> Result<Preparation> {
    Ok(serde_json::from_value(json!({"datasets":[{
        "format":"lumiere-import-review/v1","title":"Uploaded products","targetEntity":"product","sourceFile":source.file_name,
        "items":[{"key":"row-2","label":"Eggs","source":{"file":source.file_name,"row":2,"sha256":source.sha256},"issue":"Confirm product values","fields":[{"key":"name","label":"Name","kind":"text","sourceValue":"Eggs","required":true}],"proposed":{"name":"Eggs"}}]
    }],"warnings":[]}))?)
}

#[test]
fn prepared_reviews_must_reference_saved_original_hashes() -> Result<()> {
    let (sources, _) = decode_submission(&submission())?;
    let mut output = prepared(&sources[0])?;
    validate_preparation(&output, &sources, ProcessingMode::PrepareImport)?;
    ensure!(validate_preparation(&output, &sources, ProcessingMode::InspectOnly).is_err());
    output.datasets[0].items[0].source.sha256 = "b".repeat(64);
    ensure!(validate_preparation(&output, &sources, ProcessingMode::PrepareImport).is_err());
    Ok(())
}

#[tokio::test]
async fn actual_preparation_worker_emits_valid_review_of_original_bytes() -> Result<()> {
    let body = submission();
    let (originals, _) = decode_submission(&body)?;
    let script = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../scripts/import-task-prepare.py"
    );
    let prepared = run_preparation_script(&body, script, ProcessingMode::PrepareImport).await?;
    validate_preparation(&prepared, &originals, ProcessingMode::PrepareImport)?;
    ensure!(prepared
        .datasets
        .iter()
        .any(|d| d.target_entity == "product"));
    ensure!(prepared
        .datasets
        .iter()
        .flat_map(|d| &d.items)
        .all(|item| item.source.sha256 == originals[0].sha256));
    let inspection = run_preparation_script(&body, script, ProcessingMode::InspectOnly).await?;
    validate_preparation(&inspection, &originals, ProcessingMode::InspectOnly)?;
    ensure!(inspection
        .datasets
        .iter()
        .all(|d| d.target_entity == "source_observation"));
    Ok(())
}

#[tokio::test]
async fn absent_worker_is_retryable_instead_of_a_terminal_source_failure() {
    let result = run_preparation_script(
        &submission(),
        "/missing-import-worker.py",
        ProcessingMode::PrepareImport,
    )
    .await;
    assert!(matches!(result, Err(ApiError::Unavailable(_))));
}

fn decision(id: char, revision: i32, option: &str, text: Option<&str>) -> DecisionBody {
    DecisionBody {
        company_id: 9001,
        decision_id: id.to_string().repeat(32),
        expected_revision: revision,
        option_id: option.into(),
        other_text: text.map(str::to_owned),
    }
}

#[test]
fn other_is_a_bounded_note_not_an_executable_processing_mode() {
    for text in [None, Some(" "), Some("\0invalid")] {
        assert!(validate_decision(&decision('b', 1, "other", text), 9001).is_err());
    }
    assert!(validate_decision(&decision('b', 1, "other", Some(&"界".repeat(2000))), 9001).is_ok());
    assert!(validate_decision(&decision('b', 1, "other", Some(&"界".repeat(2001))), 9001).is_err());
    assert!(validate_decision(
        &decision('b', 1, "prepare_import", Some("also execute this")),
        9001
    )
    .is_err());
    assert!(validate_decision(&decision('b', 1, "arbitrary_command", None), 9001).is_err());
}

#[tokio::test]
async fn postgres_tasks_keep_originals_replay_atomic_reviews_and_scope() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping import task storage proof (set C4_TEST_PG=1)");
        return Ok(());
    }
    let mut config = pg_pool::PgConfig::from_env()?;
    config.database = "postgres".into();
    let admin = pg_pool::build_pool(&config)?;
    let database = format!(
        "import_tasks_{}_{}",
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
    {
        let client = pool.get().await?;
        client
            .batch_execute("CREATE SCHEMA lumiere_platform")
            .await?;
        client
            .batch_execute(include_str!("../../../cold_tier/import_review_expand.sql"))
            .await?;
        client
            .batch_execute(include_str!(
                "../../../cold_tier/import_review_fields_expand.sql"
            ))
            .await?;
        client
            .batch_execute(include_str!("../../../cold_tier/import_tasks_expand.sql"))
            .await?;
    }
    let scoped = StorageScope {
        organization: 8001,
        company: 9001,
        actor: "actor-one",
    };
    let body = submission();
    let (sources, hash) = decode_submission(&body)?;
    accept(pool, scoped, &body, &sources, &hash).await?;
    accept(pool, scoped, &body, &sources, &hash).await?;
    let task = read_task(pool, scoped, &body.request_id).await?;
    let initial_question = task["decision"].clone();
    ensure!(
        task["status"] == "awaiting_decision" && task["files"][0]["sha256"] == sources[0].sha256
    );
    ensure!(task["reviews"].as_array().is_some_and(Vec::is_empty));
    ensure!(
        task["decision"]["revision"] == 1
            && task["decision"]["status"] == "pending"
            && task["decisionReceipt"].is_null()
    );
    // Both recovery entry points leave originals untouched until an explicit
    // decision is recorded; even a direct finalize cannot bypass the gate.
    ensure!(prepare_saved(pool, scoped, &body, &sources).await?.0["status"] == "awaiting_decision");
    ensure!(resume_task(pool, scoped, &body.request_id).await?.0["status"] == "awaiting_decision");
    ensure!(matches!(
        finish(
            pool,
            scoped,
            &body.request_id,
            &prepared(&sources[0])?,
            ProcessingMode::PrepareImport
        )
        .await,
        Err(ApiError::Conflict(_))
    ));
    for wrong_scope in [
        StorageScope {
            organization: 8002,
            ..scoped
        },
        StorageScope {
            company: 9002,
            ..scoped
        },
        StorageScope {
            actor: "actor-two",
            ..scoped
        },
    ] {
        ensure!(matches!(
            read_task(pool, wrong_scope, &body.request_id).await,
            Err(ApiError::NotFound(_))
        ));
    }
    let mut changed = submission();
    changed.files[0].content_base64 = STANDARD.encode(b"different bytes");
    let (different_sources, different_hash) = decode_submission(&changed)?;
    ensure!(matches!(
        accept(pool, scoped, &changed, &different_sources, &different_hash).await,
        Err(ApiError::Conflict(_))
    ));
    let other_company = StorageScope {
        company: 9002,
        ..scoped
    };
    ensure!(matches!(
        accept(pool, other_company, &body, &sources, &hash).await,
        Err(ApiError::Conflict(_))
    ));

    let custom = decision(
        'b',
        1,
        "other",
        Some("Please check historical dates first."),
    );
    for wrong in [
        StorageScope {
            organization: 8002,
            ..scoped
        },
        StorageScope {
            company: 9002,
            ..scoped
        },
        StorageScope {
            actor: "actor-two",
            ..scoped
        },
    ] {
        ensure!(save_decision(pool, wrong, &body.request_id, &custom)
            .await
            .is_err());
    }
    let note = save_decision(pool, scoped, &body.request_id, &custom).await?;
    ensure!(note["revision"] == 2 && note["otherText"] == "Please check historical dates first.");
    ensure!(save_decision(pool, scoped, &body.request_id, &custom).await? == note);
    let pending = resume_task(pool, scoped, &body.request_id).await?.0;
    ensure!(
        pending["status"] == "awaiting_decision"
            && pending["decision"]["status"] == "pending"
            && pending["reviews"].as_array().is_some_and(Vec::is_empty)
    );
    let changed_note = decision('b', 1, "other", Some("Different instructions"));
    ensure!(matches!(
        save_decision(pool, scoped, &body.request_id, &changed_note).await,
        Err(ApiError::Conflict(_))
    ));
    let changed_revision = decision(
        'b',
        2,
        "other",
        Some("Please check historical dates first."),
    );
    ensure!(matches!(
        save_decision(pool, scoped, &body.request_id, &changed_revision).await,
        Err(ApiError::Conflict(_))
    ));
    let stale = decision('c', 1, "prepare_import", None);
    ensure!(matches!(
        save_decision(pool, scoped, &body.request_id, &stale).await,
        Err(ApiError::Conflict(_))
    ));
    let first = decision('c', 2, "prepare_import", None);
    let second = decision('d', 2, "prepare_import", None);
    let (first_result, second_result) = tokio::join!(
        save_decision(pool, scoped, &body.request_id, &first),
        save_decision(pool, scoped, &body.request_id, &second)
    );
    ensure!(matches!(
        (&first_result, &second_result),
        (Ok(_), Err(ApiError::Conflict(_))) | (Err(ApiError::Conflict(_)), Ok(_))
    ));
    let approved = read_task(pool, scoped, &body.request_id).await?;
    ensure!(
        approved["status"] == "saved"
            && approved["decision"]["status"] == "approved"
            && approved["decisionHistory"]
                .as_array()
                .is_some_and(|v| v.len() == 2)
    );
    // Replaying an earlier Other answer after approval uses its original
    // question snapshot and returns the exact receipt without reverting state.
    ensure!(save_decision(pool, scoped, &body.request_id, &custom).await? == note);
    ensure!(read_decision(pool, scoped, &body.request_id, &custom.decision_id).await? == note);
    ensure!(matches!(
        read_decision(
            pool,
            StorageScope {
                actor: "actor-two",
                ..scoped
            },
            &body.request_id,
            &custom.decision_id
        )
        .await,
        Err(ApiError::NotFound(_))
    ));
    ensure!(matches!(
        finish(
            pool,
            scoped,
            &body.request_id,
            &prepared(&sources[0])?,
            ProcessingMode::InspectOnly
        )
        .await,
        Err(ApiError::Conflict(_))
    ));

    // Simultaneous retries can prepare twice, but commit one set of review rows.
    let output = prepared(&sources[0])?;
    validate_preparation(&output, &sources, ProcessingMode::PrepareImport)?;
    let (a, b) = tokio::join!(
        finish(
            pool,
            scoped,
            &body.request_id,
            &output,
            ProcessingMode::PrepareImport
        ),
        finish(
            pool,
            scoped,
            &body.request_id,
            &output,
            ProcessingMode::PrepareImport
        )
    );
    a?;
    b?;
    let task = read_task(pool, scoped, &body.request_id).await?;
    ensure!(
        task["status"] == "needs_review"
            && task["reviews"].as_array().is_some_and(|v| v.len() == 1)
    );
    ensure!(task["reviews"][0]["pending"] == 1);
    let client = pool.get().await?;
    let row = client
        .query_one(
            "SELECT original_bytes FROM lumiere_platform.import_task_source",
            &[],
        )
        .await?;
    ensure!(row.get::<_, Vec<u8>>(0) == sources[0].bytes);
    ensure!(client
        .execute(
            "UPDATE lumiere_platform.import_task_source SET original_bytes='changed'::bytea",
            &[]
        )
        .await
        .is_err());
    ensure!(client
        .execute(
            "UPDATE lumiere_platform.import_task_decision SET other_text='changed'",
            &[]
        )
        .await
        .is_err());
    let audit=client.query_one("SELECT question_json,request_sha256 FROM lumiere_platform.import_task_decision WHERE decision_id=$1",&[&custom.decision_id]).await?;
    ensure!(audit.get::<_, Value>("question_json") == initial_question);
    ensure!(audit.get::<_, String>("request_sha256") == hash);
    ensure!(client
        .execute(
            "UPDATE lumiere_platform.import_task SET approved_mode='inspect_only'",
            &[]
        )
        .await
        .is_err());
    ensure!(client
        .execute(
            "UPDATE lumiere_platform.import_task SET company_id=9002",
            &[]
        )
        .await
        .is_err());
    let count: i64 = client
        .query_one(
            "SELECT count(*) FROM lumiere_platform.import_review_item",
            &[],
        )
        .await?
        .get(0);
    ensure!(count == 1);
    drop(client);
    let mut inspection_body = submission();
    inspection_body.request_id = "e".repeat(32);
    accept(pool, scoped, &inspection_body, &sources, &hash).await?;
    let repeated = read_task(pool, scoped, &inspection_body.request_id).await?;
    ensure!(repeated["files"][0]["previousMatch"]["kind"] == "identical");
    ensure!(repeated["files"][0]["previousMatch"]["requestId"] == body.request_id);

    changed.request_id = "f".repeat(32);
    accept(pool, scoped, &changed, &different_sources, &different_hash).await?;
    let revision = read_task(pool, scoped, &changed.request_id).await?;
    ensure!(revision["files"][0]["previousMatch"]["kind"] == "same_name");
    ensure!(revision["files"][0]["previousMatch"]["sha256"] == sources[0].sha256);

    let unrelated_scope = StorageScope {
        actor: "actor-two",
        ..scoped
    };
    accept(
        pool,
        unrelated_scope,
        &changed,
        &different_sources,
        &different_hash,
    )
    .await?;
    let unrelated = read_task(pool, unrelated_scope, &changed.request_id).await?;
    ensure!(unrelated["files"][0]["previousMatch"].is_null());
    // The same decision identity cannot authorize another task, even when its
    // uploaded bytes are identical.
    ensure!(matches!(
        save_decision(pool, scoped, &inspection_body.request_id, &custom).await,
        Err(ApiError::Conflict(_))
    ));
    let inspection_decision = decision('f', 1, "inspect_only", None);
    save_decision(
        pool,
        scoped,
        &inspection_body.request_id,
        &inspection_decision,
    )
    .await?;
    let mut inspection = prepared(&sources[0])?;
    inspection.datasets[0].target_entity = "source_observation".into();
    validate_preparation(&inspection, &sources, ProcessingMode::InspectOnly)?;
    finish(
        pool,
        scoped,
        &inspection_body.request_id,
        &inspection,
        ProcessingMode::InspectOnly,
    )
    .await?;
    let inspected = resume_task(pool, scoped, &inspection_body.request_id)
        .await?
        .0;
    ensure!(
        inspected["status"] == "inspection_ready"
            && inspected["reviews"][0]["targetEntity"] == "source_observation"
    );
    Ok(())
}
