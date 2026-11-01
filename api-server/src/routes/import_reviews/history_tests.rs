use super::*;
use anyhow::{ensure, Result};

fn query() -> RowsQuery {
    serde_json::from_value(json!({"companyId":9001})).unwrap()
}

#[test]
fn ranges_have_no_recent_date_cap_and_unknown_dates_are_explicit() {
    let mut query = query();
    query.from = Some("1901-01-01".into());
    query.to_exclusive = Some("2099-01-01".into());
    assert_eq!(query.validate().unwrap(), 50);
    query.to_exclusive = Some("1901-01-01".into());
    assert!(query.validate().is_err());
    query.to_exclusive = Some("2022-02-29".into());
    assert!(query.validate().is_err());
    query.to_exclusive = None;
    query.date_mode = DateMode::Undated;
    assert!(query.validate().is_err());
    query.from = None;
    assert!(query.validate().is_ok());
    query.limit = Some(101);
    assert!(query.validate().is_err());
    assert!(
        serde_json::from_value::<RowsQuery>(json!({"companyId":9001,"organizationId":8002}))
            .is_err()
    );
    assert!(serde_json::from_value::<RowsQuery>(
        json!({"companyId":9001,"dateField":"created_at"})
    )
    .is_err());
}

#[test]
fn signed_cursor_rejects_tampering_cross_scope_filter_and_changed_inventory() {
    let scope = CursorScope {
        kind: "rows",
        organization: 8001,
        company: 9001,
        actor: "actor-one",
        placement: 3,
        filter: "all-dates",
        snapshot: "revision-one",
    };
    let cursor = scope.encode(42, b"private-test-signing-key").unwrap();
    assert_eq!(
        scope
            .after(Some(&cursor), b"private-test-signing-key")
            .unwrap(),
        42
    );
    assert!(scope.after(Some(&cursor), b"other-signing-key").is_err());
    for different in [
        CursorScope {
            company: 9002,
            ..scope
        },
        CursorScope {
            organization: 8002,
            ..scope
        },
        CursorScope {
            actor: "actor-two",
            ..scope
        },
        CursorScope {
            placement: 4,
            ..scope
        },
        CursorScope {
            filter: "1901-only",
            ..scope
        },
        CursorScope {
            kind: "coverage",
            ..scope
        },
    ] {
        assert!(matches!(
            different.after(Some(&cursor), b"private-test-signing-key"),
            Err(ApiError::BadRequest(_))
        ));
    }
    let changed = CursorScope {
        snapshot: "revision-two",
        ..scope
    };
    assert!(matches!(
        changed.after(Some(&cursor), b"private-test-signing-key"),
        Err(ApiError::Conflict(_))
    ));
    assert!(scope
        .after(Some(&format!("{cursor}a")), b"private-test-signing-key")
        .is_err());
}

#[test]
fn source_history_requires_unrestricted_administration_and_cannot_return_fake_empty_storage() {
    let mut access = stdb_auth::FieldAccessContext::default();
    access.role_permissions = vec!["import_job:read".into()];
    assert!(!full_administrator(&access));
    access.role_permissions = vec!["*:*".into()];
    assert!(full_administrator(&access));
    access.org_permissions.push(stdb_auth::ActionPermission {
        resource: "account_move".into(),
        action: "read".into(),
        allow: false,
    });
    assert!(!full_administrator(&access));
    assert!(matches!(
        storage_error("missing review table"),
        ApiError::Unavailable(_)
    ));
}

#[tokio::test]
async fn history_rechecks_authority_membership_fields_company_and_placement_after_read() {
    use axum::{
        http::{HeaderMap, StatusCode},
        response::IntoResponse,
        routing::post,
        Router,
    };
    use std::sync::atomic::{AtomicU8, Ordering};

    // 0=unchanged, 1=role revoked, 2=field restriction, 3=membership revoked,
    // 4=company removed, 5=profile inactive, 6=authority unavailable.
    let changed = Arc::new(AtomicU8::new(0));
    let observed = changed.clone();
    let router = Router::new().route("/v1/database/history-authority/sql", post(move |headers: HeaderMap, sql: String| {
        let changed = observed.clone();
        async move {
            let change = changed.load(Ordering::SeqCst);
            let token = headers.get("authorization").unwrap().to_str().unwrap();
            assert!(matches!(token,"Bearer history-actor-token"|"Bearer history-owner-token"));
            assert!(!sql.contains("import_review"), "the owner token reads authority only");
            if change == 6 { return (StatusCode::SERVICE_UNAVAILABLE,"authority unavailable").into_response(); }
            let rows = if sql.contains(" FROM user_profile ") {
                assert_eq!(token,"Bearer history-owner-token");
                vec![json!({"id":1,"identity":{"__identity__":format!("0x{}","ab".repeat(32))},"organization_id":8001,"is_active":change!=5,"is_superuser":false,"metadata":null})]
            } else if sql.contains(" FROM user_organization ") {
                if change == 3 {vec![]} else {vec![json!({"id":1,"organization_id":8001,"company_id":9001,"is_active":true,"role_id":1})]}
            } else if sql.contains(" FROM role ") {
                vec![json!({"id":1,"organization_id":8001,"name":"Administrator","permissions":if change==1 {vec!["import_job:read"]} else {vec!["*:*"]},"is_active":true})]
            } else if sql.contains(" FROM field_permission ") {
                if change==2 {vec![json!({"id":1,"organization_id":8001,"subject":null,"role_id":1,"resource":"expenses","action":"read","allowed_fields":["id"]})]} else {vec![]}
            } else if sql.contains(" FROM company ") {
                if change==4 {vec![]} else {vec![json!({"id":9001,"organization_id":8001,"is_parent":true,"is_active":true})]}
            } else if sql.contains(" FROM user_role_assignment ") || sql.contains(" FROM org_permission ") {vec![]}
            else {panic!("unexpected authority SQL: {sql}")};
            let projection=sql.strip_prefix("SELECT ").unwrap().split_once(" FROM ").unwrap().0;
            let columns:Vec<String>=if projection=="*" {rows.first().and_then(Value::as_object).map(|row|row.keys().cloned().collect()).unwrap_or_else(||vec!["id".into()])} else {projection.split(", ").map(str::to_owned).collect()};
            Json(json!([{"schema":{"elements":columns.iter().map(|column|json!({"name":{"some":column}})).collect::<Vec<_>>()},
                "rows":rows.iter().map(|row|columns.iter().map(|column|row.get(column).cloned().unwrap_or(Value::Null)).collect::<Vec<_>>()).collect::<Vec<_>>()}])).into_response()
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let mut config = crate::session::test_support::test_config(Some("history-owner-token"));
    config.stdb_host = format!("http://{address}");
    config.stdb_module = "history-authority".into();
    let mut state = AppState::new(config);
    let session = crate::session::ApiSession {
        stdb_token: "history-actor-token".into(),
        identity_hex: "ab".repeat(32),
        organization_id: Some(8001),
        field_access: Some(stdb_auth::FieldAccessContext {
            organization_id: 8001,
            identity_hex: "ab".repeat(32),
            role_id: 1,
            role_permissions: vec!["*:*".into()],
            ..Default::default()
        }),
    };
    let context = scope(&state, &session, 9001).await.unwrap();
    assert!(reauthorize(&state, &context, 9001).await.is_ok());
    for change in 1..=6 {
        changed.store(change, Ordering::SeqCst);
        assert!(
            reauthorize(&state, &context, 9001).await.is_err(),
            "revocation {change} leaked a source read"
        );
    }
    changed.store(0, Ordering::SeqCst);
    state.organization_placements =
        crate::organization_placement::ConfiguredPlacementResolver::new("new-cell", 2, "new-store")
            .unwrap();
    assert!(matches!(
        reauthorize(&state, &context, 9001).await,
        Err(ApiError::Conflict(_))
    ));
    server.abort();
}

#[tokio::test]
async fn postgres_history_coverage_and_pages_are_complete_scoped_and_snapshot_checked() -> Result<()>
{
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping source history PostgreSQL proof (set C4_TEST_PG=1 to run)");
        return Ok(());
    }
    let mut config = pg_pool::PgConfig::from_env()?;
    config.database = "postgres".into();
    let admin = pg_pool::build_pool(&config)?;
    let database = format!(
        "source_history_{}_{}",
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
    let result = exercise_history(&pool).await;
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

async fn add_item(
    client: &tokio_postgres::Client,
    batch: i64,
    key: &str,
    date: Option<Value>,
    legacy: Option<&str>,
    state: &str,
) -> Result<i64> {
    let mut source = json!({"key":key,"label":key,"issue":"Source evidence needs review",
        "source":{"file":"historic.csv","row":2,"sha256":"a".repeat(64)},
        "fields":[{"key":"amount","label":"Source amount","kind":"decimal","sourceValue":"12","required":false}],"proposed":{"amount":"12"}});
    if let Some(date) = date {
        source["businessDate"] = date;
    }
    if let Some(legacy) = legacy {
        source["fields"].as_array_mut().unwrap().push(json!({"key":"date","label":"Source date","kind":"date","sourceValue":legacy,"required":false}));
    }
    Ok(client.query_one("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json,state) VALUES (8001,9001,$1,$2,$3,'{}',$4) RETURNING id", &[&batch,&key,&source,&state]).await?.get(0))
}

async fn exercise_history(pool: &deadpool_postgres::Pool) -> Result<()> {
    let mut client = pool.get().await?;
    // Missing storage must fail closed; it is different from a verified empty company.
    let tx = client.transaction().await?;
    ensure!(matches!(
        snapshot(&tx, "8001", "9001").await,
        Err(ApiError::Unavailable(_))
    ));
    tx.rollback().await?;
    client
        .batch_execute("CREATE SCHEMA lumiere_platform")
        .await?;
    client
        .batch_execute(include_str!("../../cold_tier/import_review_expand.sql"))
        .await?;
    client
        .batch_execute(include_str!(
            "../../cold_tier/import_review_fields_expand.sql"
        ))
        .await?;
    let batch:i64 = client.query_one("INSERT INTO lumiere_platform.import_review_batch (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) VALUES (8001,9001,'Historic observations','source_observation','historic.csv',repeat('a',64),'actor-one') RETURNING id", &[]).await?.get(0);
    let oldest = add_item(
        &client,
        batch,
        "oldest",
        None,
        Some("1901-03-04"),
        "confirmed",
    )
    .await?;
    add_item(&client,batch,"month",Some(json!({"precision":"month","from":"2022-06-01","toExclusive":"2022-07-01","raw":"June 2022"})),None,"needs_review").await?;
    add_item(
        &client,
        batch,
        "year",
        Some(
            json!({"precision":"year","from":"2021-01-01","toExclusive":"2022-01-01","raw":"2021"}),
        ),
        None,
        "needs_review",
    )
    .await?;
    add_item(&client,batch,"interval",Some(json!({"precision":"interval","from":"2022-06-10","toExclusive":"2022-06-20","raw":"10–19 June"})),None,"needs_review").await?;
    add_item(&client, batch, "unknown", None, None, "needs_review").await?;
    let invalid = add_item(
        &client,
        batch,
        "invalid",
        None,
        Some("2022-02-31"),
        "excluded",
    )
    .await?;
    let cleared = add_item(
        &client,
        batch,
        "cleared",
        None,
        Some("2022-01-01"),
        "needs_review",
    )
    .await?;
    // The CSV review capture preserves the rejected cell but proposes null.
    // Clearing a valid original is different from retaining an invalid source.
    client.execute("UPDATE lumiere_platform.import_review_item SET proposed_json='{\"date\":null}' WHERE id=$1 OR id=$2", &[&invalid,&cleared]).await?;
    // Exceed the old detail endpoint's 1,000-row limit without synthesizing a total from a page.
    client.execute("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json) SELECT 8001,9001,$1,'extra-'||n,'{\"fields\":[],\"label\":\"Extra source\",\"source\":{\"file\":\"historic.csv\",\"row\":3}}','{}' FROM generate_series(1,1001) n", &[&batch]).await?;
    // Different company and organization must not contribute a row, count or date.
    client.batch_execute("INSERT INTO lumiere_platform.import_review_batch (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) VALUES (8001,9002,'Other company','source_observation','other.csv',repeat('b',64),'actor-two'),(8002,9001,'Other tenant','source_observation','other.csv',repeat('c',64),'actor-two')").await?;
    client.batch_execute("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json) SELECT organization_id,company_id,id,'other','{\"businessDate\":{\"precision\":\"day\",\"from\":\"1800-01-01\",\"toExclusive\":\"1800-01-02\"}}','{}' FROM lumiere_platform.import_review_batch WHERE company_id=9002 OR organization_id=8002").await?;
    client.batch_execute("INSERT INTO lumiere_platform.import_review_batch (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) SELECT 8001,9001,'Dataset '||n,'source_observation','extra.csv',lpad(n::text,64,'0'),'actor-one' FROM generate_series(1,105) n").await?;
    let tx = client
        .build_transaction()
        .isolation_level(IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await?;
    let inventory = snapshot(&tx, "8001", "9001").await?;
    let coverage = coverage_data(&tx, "8001", "9001", 0, 100).await?;
    ensure!(coverage["totals"]["total"] == 1008);
    ensure!(coverage["totals"]["dated"] == 4);
    ensure!(coverage["totals"]["undated"] == 1003);
    ensure!(coverage["totals"]["invalid"] == 1);
    ensure!(coverage["totals"]["minDate"] == "1901-03-04");
    ensure!(coverage["totals"]["maxDate"] == "2022-06-30");
    ensure!(coverage["years"][0]["year"] == 1901);
    ensure!(coverage["bucketGranularity"] == "year" && coverage["months"] == json!([]));
    ensure!(coverage["aggregatesComplete"] == true);
    ensure!(coverage["complete"] == false && coverage["datasets"].as_array().unwrap().len() == 100);
    let after = coverage["after"].as_i64().unwrap();
    let next_datasets = coverage_data(&tx, "8001", "9001", after, 100).await?;
    ensure!(
        next_datasets["complete"] == true
            && next_datasets["datasets"].as_array().unwrap().len() == 6
    );
    ensure!(
        next_datasets["totals"] == coverage["totals"],
        "global coverage is never derived from a dataset page"
    );
    let empty = coverage_data(&tx, "8001", "9999", 0, 100).await?;
    ensure!(empty["totals"]["total"] == 0 && empty["totals"]["minDate"].is_null());
    let mut filters = query();
    filters.from = Some("1900-01-01".into());
    filters.to_exclusive = Some("1902-01-01".into());
    let (rows, next) = rows_data(&tx, "8001", "9001", &filters, 0, 50).await?;
    ensure!(rows.len() == 1 && next.is_none() && rows[0]["id"] == oldest.to_string());
    filters.from = Some("2022-06-15".into());
    filters.to_exclusive = Some("2022-06-16".into());
    let (rows, _) = rows_data(&tx, "8001", "9001", &filters, 0, 50).await?;
    ensure!(
        rows.len() == 2,
        "month and interval overlap the selected day without pretending to be exact-day events"
    );
    ensure!(rows[0]["businessDate"]["precision"] == "month");
    filters = query();
    filters.date_mode = DateMode::Invalid;
    let (rows, _) = rows_data(&tx, "8001", "9001", &filters, 0, 50).await?;
    ensure!(rows.len() == 1 && rows[0]["businessDate"]["raw"] == "2022-02-31");
    filters.date_mode = DateMode::Undated;
    let (unknown_rows, _) = rows_data(&tx, "8001", "9001", &filters, 0, 50).await?;
    let cleared_row = unknown_rows
        .iter()
        .find(|row| row["id"] == cleared.to_string())
        .unwrap();
    ensure!(
        cleared_row["businessDate"]["from"].is_null()
            && cleared_row["businessDate"]["raw"] == "2022-01-01"
    );
    filters = query();
    let (first, next) = rows_data(&tx, "8001", "9001", &filters, 0, 2).await?;
    ensure!(first.len() == 2 && next.is_some());
    let (second, _) = rows_data(&tx, "8001", "9001", &filters, next.unwrap(), 2).await?;
    ensure!(
        second.len() == 2
            && !first
                .iter()
                .any(|left| second.iter().any(|right| left["id"] == right["id"]))
    );
    let (other, _) = rows_data(&tx, "8001", "9002", &filters, 0, 50).await?;
    ensure!(other.len() == 1 && other[0]["businessDate"]["from"] == "1800-01-01");
    filters.batch_id = Some(batch);
    ensure!(matches!(
        rows_data(&tx, "8001", "9002", &filters, 0, 50).await,
        Err(ApiError::NotFound(_))
    ));
    let concurrent = pool.get().await?;
    concurrent
        .execute(
            "UPDATE lumiere_platform.import_review_item SET revision=revision+1 WHERE id=$1",
            &[&oldest],
        )
        .await?;
    ensure!(
        snapshot(&tx, "8001", "9001").await? == inventory,
        "each response reads one repeatable storage snapshot"
    );
    tx.commit().await?;
    client.execute("UPDATE lumiere_platform.import_review_item SET proposed_json='{\"date\":\"2020-01-01\"}',revision=revision+1 WHERE id=$1", &[&invalid]).await?;
    let tx = client.transaction().await?;
    ensure!(
        snapshot(&tx, "8001", "9001").await? != inventory,
        "a correction invalidates the continuation snapshot"
    );
    let mut corrected = query();
    corrected.from = Some("2020-01-01".into());
    corrected.to_exclusive = Some("2020-01-02".into());
    let (corrected_rows, _) = rows_data(&tx, "8001", "9001", &corrected, 0, 50).await?;
    ensure!(
        corrected_rows.len() == 1
            && corrected_rows[0]["businessDate"]["from"] == "2020-01-01"
            && corrected_rows[0]["businessDate"]["raw"] == "2022-02-31"
    );
    tx.rollback().await?;
    Ok(())
}
