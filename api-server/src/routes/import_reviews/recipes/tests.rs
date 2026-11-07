use super::*;
use anyhow::{ensure, Result};

fn source() -> Source {
    Source {
        ordinal: 2,
        name: "shop-export.csv".into(),
        sha256: "a".repeat(64),
    }
}

fn prepared_options() -> Value {
    json!({"version":1,"files":[{"fileName":"shop-export.csv","sourceSha256":"a".repeat(64),"decimalSeparator":",","dateOrder":"dmy",
        "sections":[{"key":"history","headerRecord":1,"firstRecord":2,"lastRecord":3,"targetEntity":"source_observation","expectedHeaders":["Itariki","Igikorwa","Amafaranga"],
            "headerMap":{"Itariki":"business_date","Igikorwa":"category","Amafaranga":"amount"},"aliases":[{"field":"category","from":"umuriro","to":"electricity"}]}]}]})
}

fn coverage() -> Value {
    json!({"version":1,"complete":true,"files":[{"fileName":"shop-export.csv","sourceSha256":"a".repeat(64),"status":"prepared","layoutSha256":"b".repeat(64),"sections":[{"headerSha256":"c".repeat(64)}]}]})
}

#[test]
fn recipe_snapshots_keep_typed_rules_and_pin_accepted_source_layout() -> Result<()> {
    let document = recipe_document(&prepared_options(), &coverage(), &[source()])?;
    let json = serde_json::to_value(document)?;
    ensure!(json["format"] == "lumiere-import-recipe/v1");
    ensure!(json["slots"][0]["key"] == "source-3");
    let rules = &json["slots"][0]["options"];
    ensure!(rules["expectedLayoutSha256"] == "b".repeat(64));
    ensure!(rules["dateOrder"] == "dmy");
    ensure!(rules["sections"][0]["aliases"][0]["from"] == "umuriro");
    ensure!(rules.get("fileName").is_none() && rules.get("sourceSha256").is_none());
    ensure!(rules.get("confirmedFields").is_none());
    Ok(())
}

#[test]
fn incomplete_stale_unknown_and_unstructured_rules_cannot_be_saved() {
    let mut incomplete = coverage();
    incomplete["complete"] = json!(false);
    assert!(recipe_document(&prepared_options(), &incomplete, &[source()]).is_err());
    let mut stale = prepared_options();
    stale["files"][0]["sourceSha256"] = json!("f".repeat(64));
    assert!(recipe_document(&stale, &coverage(), &[source()]).is_err());
    for path in [
        vec!["files", "0", "execute"],
        vec!["files", "0", "sections", "0", "confirmedFields"],
    ] {
        let mut unknown = prepared_options();
        if path.len() == 3 {
            unknown["files"][0]["execute"] = json!("anything");
        } else {
            unknown["files"][0]["sections"][0]["confirmedFields"] = json!(["amount"]);
        }
        assert!(recipe_document(&unknown, &coverage(), &[source()]).is_err());
    }
    let mut unstructured = coverage();
    unstructured["files"][0]["sections"][0]["headerSha256"] = Value::Null;
    assert!(recipe_document(&prepared_options(), &unstructured, &[source()]).is_err());
    let mut no_op = prepared_options();
    no_op["files"][0] = json!({"fileName":"shop-export.csv","sourceSha256":"a".repeat(64)});
    assert!(recipe_document(&no_op, &coverage(), &[source()]).is_err());
}

#[test]
fn replay_binds_current_originals_without_inheriting_facts_or_approvals() -> Result<()> {
    let document = recipe_document(&prepared_options(), &coverage(), &[source()])?;
    let current = Source {
        ordinal: 0,
        name: "next-export.csv".into(),
        sha256: "d".repeat(64),
    };
    let (preparation, ordinals) = materialize(
        &document,
        "shop-history",
        4,
        &[Binding {
            slot_key: "source-3".into(),
            ordinal: 0,
        }],
        &[current],
    )?;
    ensure!(ordinals == [0]);
    ensure!(preparation["recipe"] == json!({"key":"shop-history","version":4}));
    ensure!(preparation["files"][0]["fileName"] == "next-export.csv");
    ensure!(preparation["files"][0]["sourceSha256"] == "d".repeat(64));
    ensure!(preparation["files"][0]["expectedLayoutSha256"] == "b".repeat(64));
    ensure!(preparation["files"][0].get("confirmedFields").is_none());
    ensure!(preparation.get("approval").is_none());
    Ok(())
}

#[test]
fn replay_requires_explicit_unique_matching_file_slots() -> Result<()> {
    let document = recipe_document(&prepared_options(), &coverage(), &[source()])?;
    for bindings in [
        vec![],
        vec![Binding {
            slot_key: "wrong".into(),
            ordinal: 2,
        }],
        vec![Binding {
            slot_key: "source-3".into(),
            ordinal: 3,
        }],
        vec![
            Binding {
                slot_key: "source-3".into(),
                ordinal: 2,
            },
            Binding {
                slot_key: "source-3".into(),
                ordinal: 2,
            },
        ],
    ] {
        ensure!(materialize(&document, "shop-history", 1, &bindings, &[source()]).is_err());
    }
    let wrong_format = Source {
        ordinal: 2,
        name: "next.xlsx".into(),
        sha256: "d".repeat(64),
    };
    ensure!(materialize(
        &document,
        "shop-history",
        1,
        &[Binding {
            slot_key: "source-3".into(),
            ordinal: 2
        }],
        &[wrong_format]
    )
    .is_err());
    Ok(())
}

#[test]
fn recipes_reject_arbitrary_semantic_or_native_actions_in_api_bodies() {
    let body = json!({"companyId":1,"requestId":"a".repeat(32),"sourceRequestId":"b".repeat(32),"key":"shop","name":"Shop export","expectedVersion":0,"confirmAll":true});
    assert!(serde_json::from_value::<SaveBody>(body).is_err());
    let body = json!({"companyId":1,"requestId":"a".repeat(32),"sourceRequestId":"b".repeat(32),"version":1,"bindings":[{"slotKey":"source-1","ordinal":0,"approved":true}]});
    assert!(serde_json::from_value::<ApplyBody>(body).is_err());
    for invalid in ["../shop", "Shop", "", "shop/history", "shop\n"] {
        assert!(!valid_key(invalid));
    }
}

#[tokio::test]
async fn postgres_recipes_version_replay_and_scope_are_durable() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping recipe storage proof (set C4_TEST_PG=1)");
        return Ok(());
    }
    let mut config = pg_pool::PgConfig::from_env()?;
    config.database = "postgres".into();
    let admin = pg_pool::build_pool(&config)?;
    let database = format!(
        "import_recipes_{}_{}",
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
    let result = exercise_storage(&pool).await;
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

async fn exercise_storage(pool: &deadpool_postgres::Pool) -> Result<()> {
    let source_request = "a".repeat(32);
    {
        let client = pool.get().await?;
        client.batch_execute("CREATE SCHEMA lumiere_platform; CREATE TABLE lumiere_platform.import_task (organization_id numeric(20,0),company_id numeric(20,0),actor_identity text,request_id text,state text,approved_mode text,preparation_json jsonb,coverage_json jsonb,preparation_receipt_json jsonb,PRIMARY KEY (organization_id,company_id,actor_identity,request_id)); CREATE TABLE lumiere_platform.import_task_source (organization_id numeric(20,0),company_id numeric(20,0),actor_identity text,request_id text,ordinal integer,file_name text,source_sha256 text)").await?;
        client
            .batch_execute(include_str!("../../../cold_tier/import_recipes_expand.sql"))
            .await?;
        client.execute("INSERT INTO lumiere_platform.import_task VALUES (1,2,'actor',$1,'needs_review','prepare_import',$2,$3,$4)",&[&source_request,&prepared_options(),&coverage(),&json!({"engineVersion":"lumiere-import-preparation/2","semantics":"deterministic_review_proposals"})]).await?;
        client.execute("INSERT INTO lumiere_platform.import_task_source VALUES (1,2,'actor',$1,2,'shop-export.csv',$2)",&[&source_request,&"a".repeat(64)]).await?;
    }
    let scoped = StorageScope {
        organization: 1,
        company: 2,
        actor: "actor",
    };
    let mut body = SaveBody {
        company_id: 2,
        request_id: "b".repeat(32),
        source_request_id: source_request,
        key: "shop-history".into(),
        name: "Shop export".into(),
        expected_version: 0,
    };
    let one = save_recipe(pool, scoped, &body).await?;
    ensure!(one["version"] == 1 && one["companyId"] == "2");
    ensure!(save_recipe(pool, scoped, &body).await? == one);
    body.name = "Changed name".into();
    ensure!(matches!(
        save_recipe(pool, scoped, &body).await,
        Err(ApiError::Conflict(_))
    ));
    body.request_id = "c".repeat(32);
    ensure!(matches!(
        save_recipe(pool, scoped, &body).await,
        Err(ApiError::Conflict(_))
    ));
    body.expected_version = 1;
    let two = save_recipe(pool, scoped, &body).await?;
    ensure!(two["version"] == 2 && two["name"] == "Changed name");
    ensure!(matches!(
        save_recipe(
            pool,
            StorageScope {
                actor: "another-actor",
                ..scoped
            },
            &body
        )
        .await,
        Err(ApiError::NotFound(_))
    ));
    let client = pool.get().await?;
    ensure!(
        client
            .query_one(
                "SELECT count(*)::int FROM lumiere_platform.import_recipe_version",
                &[]
            )
            .await?
            .get::<_, i32>(0)
            == 2
    );
    ensure!(client
        .execute(
            "UPDATE lumiere_platform.import_recipe_version SET name='tampered' WHERE version=1",
            &[]
        )
        .await
        .is_err());
    ensure!(client
        .execute(
            "DELETE FROM lumiere_platform.import_recipe_version WHERE version=1",
            &[]
        )
        .await
        .is_err());
    Ok(())
}
