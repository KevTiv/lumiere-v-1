use super::*;
use anyhow::{ensure, Result};
use std::collections::{BTreeMap, BTreeSet};

fn configuration() -> Configuration {
    Configuration {
        opening_balances: false,
        journal_id: "7".into(),
        debit_account_id: "8".into(),
        credit_account_id: "9".into(),
        currency_id: "2".into(),
        date_field: "date".into(),
        amount_field: "amount".into(),
        description_field: None,
        posting_date: None,
        reason: "Historical electricity expense confirmed from source".into(),
        distinct_expenses: Vec::new(),
    }
}

fn reviewed(id: i64, source_row: u32, amount: &str) -> Result<ReviewedRow> {
    let source = serde_json::from_value(
        json!({"key":format!("expense-{source_row}"),"label":"Electricity",
        "source":{"file":"farm.csv","row":source_row,"sha256":"a".repeat(64)},"issue":"Confirm expense details",
        "fields":[{"key":"observation_kind","label":"Kind","kind":"text","sourceValue":"expense","required":true},
            {"key":"amount","label":"Amount","kind":"decimal","sourceValue":amount,"required":true},
            {"key":"date","label":"Date","kind":"date","sourceValue":"2024-01-05","required":true},
            {"key":"reported_method","label":"Payment method","kind":"text","sourceValue":"MOMO","required":false}],
        "proposed":{"observation_kind":"expense","amount":amount,"date":"2024-01-05","reported_method":null},
        "businessDate":{"precision":"day","from":"2024-01-05","toExclusive":"2024-01-06","raw":"5 January"}}),
    )?;
    Ok(ReviewedRow {
        id,
        batch: 11,
        revision: 3,
        state: "needs_review".into(),
        target: "source_observation".into(),
        source,
        values: BTreeMap::from([
            ("observation_kind".into(), Some("expense".into())),
            ("amount".into(), Some(amount.into())),
            ("date".into(), Some("2024-01-05".into())),
            ("reported_method".into(), None),
        ]),
        confirmed: BTreeSet::from(["observation_kind".into(), "amount".into(), "date".into()]),
    })
}

fn scoped() -> StorageScope<'static> {
    StorageScope {
        organization: 42,
        company: 5,
        actor: "actor-one",
    }
}

fn saved(definition: Definition) -> SavedProposal {
    SavedProposal {
        id: 91,
        request_key: "a".repeat(32),
        revision: 1,
        digest: "b".repeat(64),
        definition,
        state: "approved".into(),
        execution: Execution::default(),
        result: None,
        last_error: None,
        created_at: "2026-11-07T12:00:00Z".into(),
        approved_at: Some("2026-11-07T12:01:00Z".into()),
        has_draft_bundle_receipts: false,
    }
}

#[test]
fn partial_confirmation_uses_only_known_facts_and_exact_decimal_totals() -> Result<()> {
    let definition = build_definition(
        &[reviewed(1, 8, "0.1")?, reviewed(2, 9, "0.2")?],
        &configuration(),
        2,
    )?;
    ensure!(definition.summary.total_debit == "0.3" && definition.summary.total_credit == "0.3");
    ensure!(definition.summary.record_count == 2 && definition.summary.line_count == 4);
    ensure!(definition.entries[0].source_revision == 3);
    ensure!(definition.issues.is_empty());
    ensure!(definition
        .entries
        .iter()
        .all(|entry| !entry.description.contains("MOMO")));
    Ok(())
}

fn opening_pair(id: i64, row_number: u32, reference: &str) -> Result<ReviewedRow> {
    let mut row = reviewed(id, row_number, "12000")?;
    for (field, value) in [
        ("observation_kind", "opening_balance"),
        ("debit", "12000.00"),
        ("credit", "12000"),
        ("debit_account_id", "8"),
        ("credit_account_id", "9"),
        ("currency_id", "2"),
        ("document_reference", reference),
        ("description", "Reviewed opening pair"),
    ] {
        row.values.insert(field.into(), Some(value.into()));
        row.confirmed.insert(field.into());
    }
    Ok(row)
}

#[test]
fn opening_balances_require_reviewed_pairs_cutover_currency_and_accounts() -> Result<()> {
    let mut config = configuration();
    config.opening_balances = true;
    config.amount_field = "debit".into();
    config.posting_date = Some("2024-01-05".into());
    let valid = opening_pair(1, 8, "BAL-01")?;
    let mut unbalanced = opening_pair(2, 9, "BAL-02")?;
    unbalanced
        .values
        .insert("credit".into(), Some("11999".into()));
    let mut foreign = opening_pair(3, 10, "BAL-03")?;
    foreign
        .values
        .insert("currency_id".into(), Some("3".into()));
    let mut unconfirmed = opening_pair(4, 11, "BAL-04")?;
    unconfirmed.confirmed.remove("credit_account_id");
    let mut wrong_day = opening_pair(5, 12, "BAL-05")?;
    wrong_day
        .values
        .insert("date".into(), Some("2024-01-06".into()));
    let mut no_reference = opening_pair(6, 13, "BAL-06")?;
    no_reference.confirmed.remove("document_reference");
    let result = build_definition(
        &[
            valid,
            unbalanced,
            foreign,
            unconfirmed,
            wrong_day,
            no_reference,
        ],
        &config,
        2,
    )?;
    ensure!(result.kind == OPENING_BALANCES);
    ensure!(result.summary.record_count == 1 && result.summary.line_count == 2);
    ensure!(result.summary.total_debit == "12000" && result.summary.total_credit == "12000");
    ensure!(
        result
            .issues
            .iter()
            .map(|issue| issue.code.as_str())
            .collect::<Vec<_>>()
            == [
                "opening_balance_unbalanced",
                "opening_balance_references",
                "opening_balance_references",
                "opening_balance_cutover",
                "opening_balance_reference",
            ]
    );
    let proposal = saved(result);
    let headers = native::header_request(scoped(), "task", &proposal)?;
    let lines = native::line_request(scoped(), "task", &proposal, &[56])?;
    ensure!(headers.csv.contains("2024-01-05"));
    ensure!(lines.csv.contains("12000"));

    config.posting_date = None;
    ensure!(config.validate().is_err());
    Ok(())
}

#[test]
fn opening_balance_overlap_uses_source_and_reference_even_when_equal_totals_are_common(
) -> Result<()> {
    let mut config = configuration();
    config.opening_balances = true;
    config.amount_field = "debit".into();
    config.posting_date = Some("2024-01-05".into());
    let mut ready = build_definition(
        &[opening_pair(1, 8, "BAL-01")?, opening_pair(2, 9, "BAL-02")?],
        &config,
        2,
    )?;
    overlap::apply_candidate_holds(scoped(), &mut ready, BTreeMap::new())?;
    ensure!(ready.summary.record_count == 2);
    let mut duplicates = build_definition(
        &[opening_pair(1, 8, "BAL-01")?, opening_pair(2, 9, "bal-01")?],
        &config,
        2,
    )?;
    overlap::apply_candidate_holds(scoped(), &mut duplicates, BTreeMap::new())?;
    ensure!(duplicates.entries.is_empty());
    ensure!(duplicates
        .issues
        .iter()
        .all(|issue| issue.resolution.is_none()));
    Ok(())
}

#[test]
fn rollback_requires_both_exact_native_receipts() -> Result<()> {
    let parent = json!({"status":"success","requestId":"parent","jobId":"11","totalRows":1,"rowsImported":1,"errorRows":0,"records":[{"recordId":"15","rowNumber":2}]});
    let child = json!({"status":"success","requestId":"child","jobId":"12","totalRows":2,"rowsImported":2,"errorRows":0,"records":[{"recordId":"16","rowNumber":2},{"recordId":"17","rowNumber":3}]});
    ensure!(
        correction::bundle_state(&parent, &child, &parent, &child)?
            == correction::BundleState::Draft
    );
    let removed_parent = json!({"status":"rolled_back","requestId":"parent","jobId":"11","totalRows":1,"rowsImported":1,"errorRows":0});
    let removed_child = json!({"status":"rolled_back","requestId":"child","jobId":"12","totalRows":2,"rowsImported":2,"errorRows":0});
    ensure!(
        correction::bundle_state(&removed_parent, &removed_child, &parent, &child)?
            == correction::BundleState::Removed
    );
    ensure!(correction::bundle_state(&removed_parent, &child, &parent, &child).is_err());
    let mut unrelated = removed_child;
    unrelated["jobId"] = json!("13");
    ensure!(correction::bundle_state(&removed_parent, &unrelated, &parent, &child).is_err());
    let mut remapped = child.clone();
    remapped["records"][0]["recordId"] = json!("20");
    ensure!(correction::bundle_state(&parent, &remapped, &parent, &child).is_err());
    Ok(())
}

#[test]
fn unknown_meaning_amount_excluded_and_coarse_dates_stay_held() -> Result<()> {
    let mut meaning = reviewed(1, 8, "100")?;
    meaning.confirmed.remove("observation_kind");
    let mut amount = reviewed(2, 9, "200")?;
    amount.confirmed.remove("amount");
    let mut excluded = reviewed(3, 10, "300")?;
    excluded.state = "excluded".into();
    let mut period = reviewed(4, 11, "400")?;
    period.source.business_date = Some(serde_json::from_value(
        json!({"precision":"month","from":"2024-01-01","toExclusive":"2024-02-01","raw":"January"}),
    )?);
    let result = build_definition(&[meaning, amount, excluded, period], &configuration(), 0)?;
    ensure!(result.entries.is_empty() && result.summary.blocked_count == 4);
    ensure!(
        result
            .issues
            .iter()
            .map(|issue| issue.code.as_str())
            .collect::<Vec<_>>()
            == [
                "expense_meaning_unconfirmed",
                "amount_unconfirmed",
                "excluded",
                "date_precision"
            ]
    );
    let mut explicit = configuration();
    explicit.posting_date = Some("2024-01-31".into());
    let mut row = reviewed(5, 12, "500")?;
    row.confirmed.remove("date");
    let result = build_definition(&[row], &explicit, 0)?;
    ensure!(result.entries[0].date == "2024-01-31");
    ensure!(result.configuration.posting_date.as_deref() == Some("2024-01-31"));
    Ok(())
}

#[test]
fn duplicate_sources_and_unrepresentable_native_amounts_cannot_enter_write_set() -> Result<()> {
    let result = build_definition(
        &[reviewed(1, 8, "10")?, reviewed(2, 8, "10")?],
        &configuration(),
        0,
    )?;
    ensure!(result.entries.len() == 1 && result.issues[0].code == "repeated_source");
    ensure!(!native_amount_matches(
        "999999999999.123456",
        Some(999999999999.123456)
    ));
    ensure!(!native_amount_matches("1.2", Some(1.200001)));
    ensure!(!native_amount_matches("1", Some(f64::NAN)));
    for amount in ["-1", "0", "1,000", "1.01"] {
        ensure!(
            build_definition(&[reviewed(3, 9, amount)?], &configuration(), 0)?
                .entries
                .is_empty()
        );
    }
    Ok(())
}

#[test]
fn changed_exports_and_equal_source_periods_are_held_within_a_proposal() -> Result<()> {
    let first = reviewed(1, 8, "1234")?;
    let mut changed = reviewed(2, 9, "1234")?;
    changed.source.source.sha256 = "b".repeat(64);
    let mut override_date = configuration();
    override_date.posting_date = Some("2024-01-31".into());
    let mut definition = build_definition(&[first, changed], &override_date, 0)?;
    overlap::apply_candidate_holds(scoped(), &mut definition, BTreeMap::new())?;
    ensure!(definition.entries.is_empty() && definition.summary.blocked_count == 2);
    ensure!(definition
        .issues
        .iter()
        .all(|issue| issue.code == "possible_source_overlap"));
    Ok(())
}

#[test]
fn request_validation_preserves_large_ids_and_rejects_client_authority_fields() -> Result<()> {
    ensure!(positive_id("9007199254740993")? == 9_007_199_254_740_993);
    for invalid in [
        "0",
        "01",
        "-2",
        "1; DROP TABLE company",
        "18446744073709551616",
    ] {
        ensure!(positive_id(invalid).is_err());
    }
    let mut input = serde_json::to_value(configuration())?;
    input["companyId"] = json!(5);
    input["requestKey"] = json!("a".repeat(32));
    input["rows"] = json!([{"itemId":"1","expectedRevision":3}]);
    let body: PrepareBody = serde_json::from_value(input.clone())?;
    body.validate()?;
    input["status"] = json!("verified");
    ensure!(serde_json::from_value::<PrepareBody>(input).is_err());
    ensure!(serde_json::from_value::<ActionBody>(json!({"companyId":5,"expectedRevision":1,"expectedDigest":"b".repeat(64),"result":{"verified":true}})).is_err());
    Ok(())
}

#[test]
fn native_requests_are_stable_source_bound_and_balanced() -> Result<()> {
    let proposal = saved(build_definition(
        &[reviewed(1, 8, "1234")?],
        &configuration(),
        0,
    )?);
    let headers = native::header_request(scoped(), "a".repeat(32).as_str(), &proposal)?;
    let retry = native::header_request(scoped(), "a".repeat(32).as_str(), &proposal)?;
    ensure!(headers.request_id == retry.request_id && headers.csv == retry.csv);
    ensure!(
        headers.csv.contains("lumiere_account_move_bundle")
            && headers.csv.contains("lumiere_import_proposal")
    );
    ensure!(headers.csv.contains("2024-01-05") && !headers.csv.contains("posted"));
    let lines = native::line_request(scoped(), "task", &proposal, &[9_007_199_254_740_993])?;
    ensure!(lines.csv.contains("9007199254740993,8") && lines.csv.contains("9007199254740993,9"));
    ensure!(lines.request_id != headers.request_id);
    let mut other = scoped();
    other.company = 6;
    ensure!(native::header_request(other, "task", &proposal)?.request_id != headers.request_id);
    Ok(())
}

#[test]
fn receipt_ids_require_exact_outcomes_and_never_use_order_or_latest_job() -> Result<()> {
    let mut receipt = json!({"status":"success","rowsImported":2,"totalRows":2,"errorRows":0,"records":[{"rowNumber":3,"recordId":"19"},{"rowNumber":2,"recordId":"9007199254740993"}]});
    ensure!(native::receipt_ids(&receipt, 2)? == [9_007_199_254_740_993, 19]);
    receipt["records"][1]["rowNumber"] = json!(3);
    ensure!(native::receipt_ids(&receipt, 2).is_err());
    receipt["status"] = json!("partial");
    ensure!(native::receipt_ids(&receipt, 2).is_err());
    Ok(())
}

fn record_fixture(proposal: &SavedProposal) -> (Vec<Value>, Vec<Value>) {
    let entry = &proposal.definition.entries[0];
    let binding = |side| {
        json!({"lumiere_import_proposal":native::source_binding(scoped(),"task",proposal,entry,side)}).to_string()
    };
    let timestamp = json!({"microsSinceUnixEpoch":1_704_412_800_000_000_i64});
    let parent = json!({"id":100,"organizationId":42,"companyId":5,"journalId":7,"currencyId":2,"companyCurrencyId":2,"amountTotal":1234.0,"autoPost":false,"postedBefore":false,"date":timestamp,"state":"Draft","moveType":"Entry","ref":entry.reference,"metadata":binding("header")});
    let debit = json!({"id":200,"organizationId":42,"companyId":5,"moveId":100,"accountId":8,"journalId":7,"currencyId":2,"companyCurrencyId":2,"date":timestamp,"parentState":"Draft","debit":1234.0,"credit":0.0,"metadata":binding("debit")});
    let credit = json!({"id":201,"organizationId":42,"companyId":5,"moveId":100,"accountId":9,"journalId":7,"currencyId":2,"companyCurrencyId":2,"date":timestamp,"parentState":"Draft","debit":0.0,"credit":1234.0,"metadata":binding("credit")});
    (vec![parent], vec![debit, credit])
}

#[test]
fn authoritative_readback_checks_source_scope_dates_accounts_amounts_and_draft_state() -> Result<()>
{
    let proposal = saved(build_definition(
        &[reviewed(1, 8, "1234")?],
        &configuration(),
        0,
    )?);
    let (moves, lines) = record_fixture(&proposal);
    let result = native::verify_records(
        scoped(),
        "task",
        &proposal,
        &[100],
        &[200, 201],
        &moves,
        &lines,
    )?;
    ensure!(
        result.total_debit == "1234" && result.posted_count == 0 && result.record_ids == ["100"]
    );
    for (field, value) in [
        ("companyId", json!(6)),
        ("accountId", json!(9)),
        ("companyCurrencyId", json!(3)),
        ("debit", json!(1235)),
        ("parentState", json!("Posted")),
        ("metadata", json!("{}")),
    ] {
        let mut changed = lines.clone();
        changed[0][field] = value;
        ensure!(native::verify_records(
            scoped(),
            "task",
            &proposal,
            &[100],
            &[200, 201],
            &moves,
            &changed
        )
        .is_err());
    }
    let mut extra = lines.clone();
    extra.push(lines[0].clone());
    ensure!(native::verify_records(
        scoped(),
        "task",
        &proposal,
        &[100],
        &[200, 201],
        &moves,
        &extra
    )
    .is_err());
    for (field, value) in [
        ("state", json!("Posted")),
        ("companyCurrencyId", json!(3)),
        ("amountTotal", json!(1235)),
        ("autoPost", json!(true)),
        ("postedBefore", json!(true)),
    ] {
        let mut changed = moves.clone();
        changed[0][field] = value;
        ensure!(native::verify_records(
            scoped(),
            "task",
            &proposal,
            &[100],
            &[200, 201],
            &changed,
            &lines
        )
        .is_err());
    }
    Ok(())
}

#[test]
fn reference_preflight_requires_current_company_currency_and_available_accounts() -> Result<()> {
    let companies = vec![json!({"id":5,"organizationId":42,"currencyId":2,"deletedAt":null})];
    let journals =
        vec![json!({"id":7,"organizationId":42,"companyId":5,"active":true,"currencyId":null})];
    let accounts = vec![
        json!({"id":8,"organizationId":42,"companyId":5,"deprecated":false,"currencyId":null,"allowedJournalIds":[]}),
        json!({"id":9,"organizationId":42,"companyId":5,"deprecated":false,"currencyId":null,"allowedJournalIds":[7]}),
    ];
    let currencies = vec![json!({"id":2,"organizationId":42,"active":true,"decimalPlaces":0})];
    ensure!(
        native::validate_reference_rows(
            42,
            5,
            &configuration(),
            &companies,
            &journals,
            &accounts,
            &currencies
        )? == 0
    );
    let mut wrong = accounts.clone();
    wrong[1]["companyId"] = json!(6);
    ensure!(native::validate_reference_rows(
        42,
        5,
        &configuration(),
        &companies,
        &journals,
        &wrong,
        &currencies
    )
    .is_err());
    wrong = accounts.clone();
    wrong[1]["allowedJournalIds"] = json!([99]);
    ensure!(native::validate_reference_rows(
        42,
        5,
        &configuration(),
        &companies,
        &journals,
        &wrong,
        &currencies
    )
    .is_err());
    Ok(())
}

#[tokio::test]
async fn postgres_workflow_keeps_revisions_claims_and_receipts_durable() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping import workflow storage proof (set C4_TEST_PG=1)");
        return Ok(());
    }
    let mut config = pg_pool::PgConfig::from_env()?;
    config.database = "postgres".into();
    let admin = pg_pool::build_pool(&config)?;
    let database = format!(
        "import_workflow_{}_{}",
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
    let result = async {
        exercise_storage(&pool).await?;
        approved_ready_rows_are_independent_from_held_rows(&pool).await?;
        competing_changed_exports_cannot_both_acquire_approval(&pool).await
    }
    .await;
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
    let mut client = pool.get().await?;
    client
        .batch_execute("CREATE SCHEMA lumiere_platform")
        .await?;
    for sql in [
        include_str!("../../../cold_tier/import_review_expand.sql"),
        include_str!("../../../cold_tier/import_review_fields_expand.sql"),
        include_str!("../../../cold_tier/import_tasks_expand.sql"),
        include_str!("../../../cold_tier/import_workflow_expand.sql"),
    ] {
        client.batch_execute(sql).await?;
    }
    let task = "a".repeat(32);
    client.execute("INSERT INTO lumiere_platform.import_task (organization_id,company_id,actor_identity,request_id,conversation_key,request_sha256,state,approved_mode,decision_request) VALUES (42,5,'actor-one',$1,'original-conversation',$2,'needs_review','prepare_import','{}')",&[&task,&"c".repeat(64)]).await?;
    let batch: i64 = client.query_one("INSERT INTO lumiere_platform.import_review_batch (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) VALUES (42,5,'Expenses','source_observation','farm.csv',$1,'actor-one') RETURNING id",&[&"d".repeat(64)]).await?.get(0);
    client.execute("INSERT INTO lumiere_platform.import_task_review (organization_id,company_id,actor_identity,request_id,batch_id) VALUES (42,5,'actor-one',$1,$2)",&[&task,&batch]).await?;
    let mut row = reviewed(1, 8, "1234")?;
    row.values
        .insert("external_reference".into(), Some("  INV-0051 ".into()));
    row.confirmed.insert("external_reference".into());
    let item: i64 = client.query_one("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json,confirmed_fields,revision) VALUES (42,5,$1,'expense-8',$2,$3,$4,3) RETURNING id",&[&batch,&serde_json::to_value(&row.source)?,&serde_json::to_value(&row.values)?,&serde_json::to_value(&row.confirmed)?]).await?.get(0);
    let body = PrepareBody {
        company_id: 5,
        request_key: "e".repeat(32),
        rows: vec![RowSelection {
            item_id: item.to_string(),
            expected_revision: 3,
        }],
        configuration: configuration(),
    };
    let request_hash = hash(&serde_json::to_vec(&body)?);
    let tx = client.transaction().await?;
    storage::require_task(&tx, scoped(), &task, true).await?;
    let rows = storage::reviews(&tx, scoped(), &task, &body.rows).await?;
    let definition = build_definition(&rows, &configuration(), 0)?;
    let mut proposal =
        storage::insert(&tx, scoped(), &task, &body, &request_hash, &definition).await?;
    let proposal_id = proposal.id;
    ensure!(
        storage::replay(&tx, scoped(), &task, &body.request_key, &request_hash)
            .await?
            .is_some()
    );
    storage::approve(&tx, scoped(), &task, &mut proposal, 0).await?;
    storage::require_claims(&tx, scoped(), &proposal).await?;
    storage::record_receipt(
        &tx,
        scoped(),
        proposal.id,
        "headers",
        &"f".repeat(32),
        &"a".repeat(64),
        &json!({"jobId":"901","status":"success","rowsImported":1,"totalRows":1,"errorRows":0,"records":[{"rowNumber":2,"recordId":"100"}]}),
    )
    .await?;
    ensure!(
        storage::load(&tx, scoped(), &task, proposal_id)
            .await?
            .view()["canRollback"]
            == false
    );
    storage::record_receipt(&tx,scoped(),proposal.id,"lines",&"c".repeat(32),&"b".repeat(64),&json!({"jobId":"902","status":"success","rowsImported":2,"totalRows":2,"errorRows":0,"records":[{"rowNumber":3,"recordId":"201"},{"rowNumber":2,"recordId":"200"}]})).await?;
    let mut blocked = storage::load(&tx, scoped(), &task, proposal_id).await?;
    blocked.state = "blocked".into();
    blocked.execution.phase = Phase::Headers;
    blocked.last_error = Some("Temporary ERP readback error".into());
    storage::save_progress(&tx, &blocked).await?;
    let reloaded = storage::load(&tx, scoped(), &task, proposal_id)
        .await?
        .view();
    ensure!(reloaded["result"].is_null() && reloaded["canRollback"] == true);
    ensure!(storage::list(&tx, scoped(), &task).await?[0]["canRollback"] == true);
    storage::save_progress(&tx, &proposal).await?;
    tx.commit().await?;
    let bound = binding::read_saved_binding(
        &client,
        42,
        5,
        "actor-one",
        &"f".repeat(32),
        "account_move",
        &"a".repeat(64),
        901,
        100,
        2,
    )
    .await?
    .ok_or_else(|| anyhow::anyhow!("trusted workflow source binding missing"))?;
    ensure!(bound["taskRequestId"] == task && bound["proposalId"] == proposal_id.to_string());
    ensure!(
        bound["itemId"] == item.to_string()
            && bound["revision"] == 3
            && bound["role"] == "journal_header"
    );
    for (record, row, role) in [(200, 2, "journal_debit"), (201, 3, "journal_credit")] {
        let line = binding::read_saved_binding(
            &client,
            42,
            5,
            "actor-one",
            &"c".repeat(32),
            "account_move_line",
            &"b".repeat(64),
            902,
            record,
            row,
        )
        .await?
        .ok_or_else(|| anyhow::anyhow!("trusted line source binding missing"))?;
        ensure!(line["itemId"] == item.to_string() && line["role"] == role);
    }
    ensure!(binding::read_saved_binding(
        &client,
        42,
        5,
        "actor-one",
        &"c".repeat(32),
        "account_move_line",
        &"b".repeat(64),
        902,
        201,
        2
    )
    .await?
    .is_none());
    for (org, company, actor, entity, job, record, import_row) in [
        (43, 5, "actor-one", "account_move", 901, 100, 2),
        (42, 6, "actor-one", "account_move", 901, 100, 2),
        (42, 5, "actor-two", "account_move", 901, 100, 2),
        (42, 5, "actor-one", "account_move_line", 901, 100, 2),
        (42, 5, "actor-one", "account_move", 902, 100, 2),
        (42, 5, "actor-one", "account_move", 901, 101, 2),
        (42, 5, "actor-one", "account_move", 901, 100, 3),
    ] {
        ensure!(binding::read_saved_binding(
            &client,
            org,
            company,
            actor,
            &"f".repeat(32),
            entity,
            &"a".repeat(64),
            job,
            record,
            import_row
        )
        .await?
        .is_none());
    }
    ensure!(binding::read_saved_binding(
        &client,
        42,
        5,
        "actor-one",
        &"e".repeat(32),
        "account_move",
        &"a".repeat(64),
        901,
        100,
        2
    )
    .await?
    .is_none());
    ensure!(binding::read_saved_binding(
        &client,
        42,
        5,
        "actor-one",
        &"f".repeat(32),
        "account_move",
        &"b".repeat(64),
        901,
        100,
        2
    )
    .await?
    .is_none());
    let tx = client.transaction().await?;
    let stored = storage::load(&tx, scoped(), &task, proposal_id).await?;
    ensure!(stored.state == "approved" && stored.approved_at.is_some());
    ensure!(storage::load(
        &tx,
        StorageScope {
            company: 6,
            ..scoped()
        },
        &task,
        proposal_id
    )
    .await
    .is_err());
    ensure!(storage::load(
        &tx,
        StorageScope {
            actor: "actor-two",
            ..scoped()
        },
        &task,
        proposal_id
    )
    .await
    .is_err());
    ensure!(storage::load(
        &tx,
        StorageScope {
            organization: 43,
            ..scoped()
        },
        &task,
        proposal_id
    )
    .await
    .is_err());
    storage::validate_sources(&tx, scoped(), &task, &stored, 0).await?;
    // A changed export cannot evade company-wide admission by getting a new
    // hash, task, actor or row number. It is a candidate hold, never a merge.
    let mut changed = reviewed(99, 21, "1234")?;
    changed.source.source.sha256 = "1".repeat(64);
    let mut candidate = build_definition(&[changed], &configuration(), 0)?;
    let unchanged = candidate.clone();
    overlap::hold_candidates(
        &tx,
        StorageScope {
            actor: "actor-two",
            ..scoped()
        },
        &mut candidate,
        None,
    )
    .await?;
    ensure!(candidate.entries.is_empty() && candidate.issues[0].code == "possible_prior_expense");
    ensure!(candidate.issues[0].candidates[0].proposal_id == Some(proposal_id.to_string()));
    ensure!(
        candidate.issues[0].candidates[0].proposal_digest.as_deref()
            == Some(stored.digest.as_str())
    );
    let mut outside_company = unchanged;
    overlap::hold_candidates(
        &tx,
        StorageScope {
            company: 6,
            ..scoped()
        },
        &mut outside_company,
        None,
    )
    .await?;
    ensure!(outside_company.entries.len() == 1);
    let mut corrected = reviewed(100, 22, "1500")?;
    corrected.source.source.sha256 = "2".repeat(64);
    corrected.source.business_date = None;
    corrected
        .values
        .insert("date".into(), Some("2025-02-08".into()));
    corrected
        .values
        .insert("document_reference".into(), Some("inv-0051".into()));
    corrected.confirmed.insert("document_reference".into());
    let mut corrected_candidate = build_definition(&[corrected], &configuration(), 0)?;
    overlap::hold_candidates(&tx, scoped(), &mut corrected_candidate, None).await?;
    ensure!(
        corrected_candidate.entries.is_empty()
            && corrected_candidate.issues[0].candidates[0].reason == "same_reference"
    );
    tx.rollback().await?;
    client
        .execute(
            "UPDATE lumiere_platform.import_review_item SET revision=revision+1 WHERE id=$1",
            &[&item],
        )
        .await?;
    let tx = client.transaction().await?;
    ensure!(storage::validate_sources(&tx, scoped(), &task, &stored, 0)
        .await
        .is_err());
    tx.rollback().await?;
    // A different operator can review the same company data, but cannot claim
    // the same expense a second time through a different task/proposal.
    let next_task = "1".repeat(32);
    client.execute("INSERT INTO lumiere_platform.import_task (organization_id,company_id,actor_identity,request_id,conversation_key,request_sha256,state,approved_mode,decision_request) VALUES (42,5,'actor-two',$1,'new-conversation',$2,'needs_review','prepare_import','{}')",&[&next_task,&"c".repeat(64)]).await?;
    client.execute("INSERT INTO lumiere_platform.import_task_review (organization_id,company_id,actor_identity,request_id,batch_id) VALUES (42,5,'actor-two',$1,$2)",&[&next_task,&batch]).await?;
    let second_scope = StorageScope {
        actor: "actor-two",
        ..scoped()
    };
    let second_body = PrepareBody {
        company_id: 5,
        request_key: "2".repeat(32),
        rows: vec![RowSelection {
            item_id: item.to_string(),
            expected_revision: 4,
        }],
        configuration: configuration(),
    };
    let tx = client.transaction().await?;
    let rows = storage::reviews(&tx, second_scope, &next_task, &second_body.rows).await?;
    let definition = build_definition(&rows, &configuration(), 0)?;
    let mut second = storage::insert(
        &tx,
        second_scope,
        &next_task,
        &second_body,
        &hash(&serde_json::to_vec(&second_body)?),
        &definition,
    )
    .await?;
    ensure!(
        storage::approve(&tx, second_scope, &next_task, &mut second, 0)
            .await
            .is_err()
    );
    tx.rollback().await?;
    ensure!(client
        .execute(
            "UPDATE lumiere_platform.import_workflow_proposal SET proposal_sha256=$1 WHERE id=$2",
            &[&"f".repeat(64), &proposal_id]
        )
        .await
        .is_err());
    ensure!(client
        .execute(
            "DELETE FROM lumiere_platform.import_workflow_receipt WHERE proposal_id=$1",
            &[&proposal_id]
        )
        .await
        .is_err());
    Ok(())
}

async fn approved_ready_rows_are_independent_from_held_rows(
    pool: &deadpool_postgres::Pool,
) -> Result<()> {
    let scope = StorageScope {
        actor: "held-row-reviewer",
        ..scoped()
    };
    let task = "3".repeat(32);
    let source_hash = "3".repeat(64);
    let mut client = pool.get().await?;
    client.execute("INSERT INTO lumiere_platform.import_task (organization_id,company_id,actor_identity,request_id,conversation_key,request_sha256,state,approved_mode,decision_request) VALUES (42,5,$1,$2,'independent-source-review',$3,'needs_review','prepare_import','{}')",&[&scope.actor,&task,&source_hash]).await?;
    let batch:i64=client.query_one("INSERT INTO lumiere_platform.import_review_batch (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) VALUES (42,5,'Independent expenses','source_observation','farm.csv',$1,$2) RETURNING id",&[&source_hash,&scope.actor]).await?.get(0);
    client.execute("INSERT INTO lumiere_platform.import_task_review (organization_id,company_id,actor_identity,request_id,batch_id) VALUES (42,5,$1,$2,$3)",&[&scope.actor,&task,&batch]).await?;
    let mut selected = Vec::new();
    for source_row in [30, 31] {
        let mut row = reviewed(1, source_row, "2222")?;
        row.source.source.sha256.clone_from(&source_hash);
        let item:i64=client.query_one("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json,confirmed_fields,revision) VALUES (42,5,$1,$2,$3,$4,$5,3) RETURNING id",&[&batch,&row.source.key,&serde_json::to_value(&row.source)?,&serde_json::to_value(&row.values)?,&serde_json::to_value(&row.confirmed)?]).await?.get(0);
        selected.push(RowSelection {
            item_id: item.to_string(),
            expected_revision: 3,
        });
    }
    let ready_id = selected[0].item_id.parse::<i64>()?;
    let held_id = selected[1].item_id.parse::<i64>()?;
    let tx = client.transaction().await?;
    let rows = storage::reviews(&tx, scope, &task, &selected).await?;
    let mut held = build_definition(&rows, &configuration(), 0)?;
    overlap::hold_candidates(&tx, scope, &mut held, None).await?;
    let resolution = held
        .issues
        .iter()
        .find(|issue| issue.item_id.as_deref() == Some(selected[0].item_id.as_str()))
        .and_then(|issue| issue.resolution.as_ref())
        .ok_or_else(|| anyhow::anyhow!("ready row needs an explicit distinct-expense decision"))?;
    let mut config = configuration();
    config.distinct_expenses = vec![DistinctExpenseDecision {
        item_id: selected[0].item_id.clone(),
        source_revision: 3,
        candidate_digest: resolution.candidate_digest.clone(),
        reason: "The first reviewed document establishes a separate expense; hold the second for correction".into(),
    }];
    let body = PrepareBody {
        company_id: scope.company,
        request_key: "4".repeat(32),
        rows: selected,
        configuration: config,
    };
    let mut definition = build_definition(&rows, &body.configuration, 0)?;
    overlap::hold_candidates(&tx, scope, &mut definition, None).await?;
    ensure!(definition.sources.len() == 2 && definition.entries.len() == 1);
    ensure!(definition.entries[0].item_id == ready_id.to_string());
    ensure!(
        definition.issues.len() == 1 && definition.issues[0].item_id == Some(held_id.to_string())
    );
    let original_definition = serde_json::to_value(&definition)?;
    let proposal = storage::insert(
        &tx,
        scope,
        &task,
        &body,
        &hash(&serde_json::to_vec(&body)?),
        &definition,
    )
    .await?;
    tx.commit().await?;

    // Initial approval still depends on the complete preview, including B.
    let tx = client.transaction().await?;
    tx.execute(
        "UPDATE lumiere_platform.import_review_item SET revision=revision+1 WHERE id=$1",
        &[&held_id],
    )
    .await?;
    let mut stale = storage::load(&tx, scope, &task, proposal.id).await?;
    ensure!(storage::approve(&tx, scope, &task, &mut stale, 0)
        .await
        .is_err());
    ensure!(storage::require_claims(&tx, scope, &stale).await.is_err());
    tx.rollback().await?;

    let tx = client.transaction().await?;
    let mut approved = storage::load(&tx, scope, &task, proposal.id).await?;
    storage::approve(&tx, scope, &task, &mut approved, 0).await?;
    storage::require_claims(&tx, scope, &approved).await?;
    tx.commit().await?;

    // Correcting B after approval cannot revoke A's already reserved effect.
    client.execute("UPDATE lumiere_platform.import_review_item SET revision=revision+1,proposed_json=jsonb_set(proposed_json,'{amount}','\"3333\"') WHERE id=$1", &[&held_id]).await?;
    let tx = client.transaction().await?;
    let stored = storage::load(&tx, scope, &task, proposal.id).await?;
    storage::validate_approved_sources(&tx, scope, &task, &stored, 0).await?;
    storage::require_claims(&tx, scope, &stored).await?;
    ensure!(serde_json::to_value(&stored.definition)? == original_definition);
    ensure!(stored.digest == proposal.digest);

    // The execution check holds only A's review lock; B remains reviewable.
    let mut reviewer = pool.get().await?;
    let review_tx = reviewer.transaction().await?;
    review_tx
        .batch_execute("SET LOCAL lock_timeout='200ms'")
        .await?;
    review_tx
        .execute(
            "UPDATE lumiere_platform.import_review_item SET revision=revision+1 WHERE id=$1",
            &[&held_id],
        )
        .await?;
    review_tx.commit().await?;
    // The initial whole-preview validator deliberately still rejects the
    // same held-row change that approved-entry execution permits.
    ensure!(storage::validate_sources(&tx, scope, &task, &stored, 0)
        .await
        .is_err());
    tx.rollback().await?;

    client
        .execute(
            "UPDATE lumiere_platform.import_review_item SET revision=revision+1 WHERE id=$1",
            &[&ready_id],
        )
        .await?;
    let tx = client.transaction().await?;
    let changed = storage::load(&tx, scope, &task, proposal.id).await?;
    ensure!(
        storage::validate_approved_sources(&tx, scope, &task, &changed, 0)
            .await
            .is_err()
    );
    storage::require_claims(&tx, scope, &changed).await?;
    ensure!(serde_json::to_value(&changed.definition)? == original_definition);
    tx.rollback().await?;
    Ok(())
}

async fn competing_changed_exports_cannot_both_acquire_approval(
    pool: &deadpool_postgres::Pool,
) -> Result<()> {
    let mut prepared = Vec::new();
    for (actor, letter) in [("racing-actor-one", '6'), ("racing-actor-two", '7')] {
        let scoped = StorageScope {
            organization: 42,
            company: 5,
            actor,
        };
        let task = letter.to_string().repeat(32);
        let source_hash = letter.to_string().repeat(64);
        let mut client = pool.get().await?;
        let tx = client.transaction().await?;
        tx.execute("INSERT INTO lumiere_platform.import_task (organization_id,company_id,actor_identity,request_id,conversation_key,request_sha256,state,approved_mode,decision_request) VALUES (42,5,$1,$2,'competing-imports',$3,'needs_review','prepare_import','{}')",&[&actor,&task,&source_hash]).await?;
        let batch:i64=tx.query_one("INSERT INTO lumiere_platform.import_review_batch (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) VALUES (42,5,'Competing expenses','source_observation','changed-export.csv',$1,$2) RETURNING id",&[&source_hash,&actor]).await?.get(0);
        tx.execute("INSERT INTO lumiere_platform.import_task_review (organization_id,company_id,actor_identity,request_id,batch_id) VALUES (42,5,$1,$2,$3)",&[&actor,&task,&batch]).await?;
        let mut reviewed = reviewed(1, 20, "999")?;
        reviewed.source.source.sha256 = source_hash;
        let item:i64=tx.query_one("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json,confirmed_fields,revision) VALUES (42,5,$1,'row-20',$2,$3,$4,3) RETURNING id",&[&batch,&serde_json::to_value(&reviewed.source)?,&serde_json::to_value(&reviewed.values)?,&serde_json::to_value(&reviewed.confirmed)?]).await?.get(0);
        let body = PrepareBody {
            company_id: 5,
            request_key: task.clone(),
            rows: vec![RowSelection {
                item_id: item.to_string(),
                expected_revision: 3,
            }],
            configuration: configuration(),
        };
        let rows = storage::reviews(&tx, scoped, &task, &body.rows).await?;
        let mut definition = build_definition(&rows, &body.configuration, 0)?;
        overlap::hold_candidates(&tx, scoped, &mut definition, None).await?;
        ensure!(definition.entries.len() == 1);
        let proposal = storage::insert(
            &tx,
            scoped,
            &task,
            &body,
            &hash(&serde_json::to_vec(&body)?),
            &definition,
        )
        .await?;
        ensure!(
            storage::read_request(&tx, scoped, &task, &body.request_key)
                .await?
                .id
                == proposal.id
        );
        ensure!(storage::read_request(&tx, scoped, &task, &"8".repeat(32))
            .await
            .is_err());
        prepared.push((scoped, task, proposal.id));
        tx.commit().await?;
    }
    let (a, b) = tokio::join!(
        approve_stored(pool, prepared[0].0, &prepared[0].1, prepared[0].2),
        approve_stored(pool, prepared[1].0, &prepared[1].1, prepared[1].2)
    );
    ensure!(matches!(
        (&a, &b),
        (Ok(()), Err(ApiError::Conflict(_))) | (Err(ApiError::Conflict(_)), Ok(()))
    ));
    let count:i64=pool.get().await?.query_one("SELECT count(*)::bigint FROM lumiere_platform.import_workflow_source_claim WHERE organization_id=42 AND company_id=5 AND amount=999 AND released_at IS NULL",&[]).await?.get(0);
    ensure!(count == 1);
    let winner = if a.is_ok() { 0 } else { 1 };
    let loser = 1 - winner;
    let (loser_scope, loser_task, loser_id) = &prepared[loser];
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    let previous = storage::load(&tx, *loser_scope, loser_task, *loser_id).await?;
    let selected = previous
        .definition
        .sources
        .iter()
        .map(|source| RowSelection {
            item_id: source.item_id.clone(),
            expected_revision: source.revision,
        })
        .collect::<Vec<_>>();
    let rows = storage::reviews(&tx, *loser_scope, loser_task, &selected).await?;
    let mut held = build_definition(&rows, &configuration(), 0)?;
    overlap::hold_candidates(&tx, *loser_scope, &mut held, None).await?;
    let resolution = held.issues[0]
        .resolution
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("distinct expense resolution missing"))?;
    let mut config = configuration();
    config.distinct_expenses = vec![DistinctExpenseDecision {
        item_id: selected[0].item_id.clone(),
        source_revision: selected[0].expected_revision,
        candidate_digest: resolution.candidate_digest.clone(),
        reason: "Two different supported electricity expense documents share this date and amount"
            .into(),
    }];
    let body = PrepareBody {
        company_id: 5,
        request_key: "9".repeat(32),
        rows: selected,
        configuration: config,
    };
    let mut definition = build_definition(&rows, &body.configuration, 0)?;
    overlap::hold_candidates(&tx, *loser_scope, &mut definition, None).await?;
    ensure!(definition.entries.len() == 1 && definition.issues.is_empty());
    let mut distinct = storage::insert(
        &tx,
        *loser_scope,
        loser_task,
        &body,
        &hash(&serde_json::to_vec(&body)?),
        &definition,
    )
    .await?;
    storage::approve(&tx, *loser_scope, loser_task, &mut distinct, 0).await?;
    tx.commit().await?;

    // A's approved claim remains executable after B explicitly distinguishes
    // from it. Rechecking candidates here would strand the earlier approval.
    let (winner_scope, winner_task, winner_id) = &prepared[winner];
    let tx = client.transaction().await?;
    let earlier = storage::load(&tx, *winner_scope, winner_task, *winner_id).await?;
    ensure!(
        storage::validate_sources(&tx, *winner_scope, winner_task, &earlier, 0)
            .await
            .is_err()
    );
    storage::validate_approved_sources(&tx, *winner_scope, winner_task, &earlier, 0).await?;
    storage::require_claims(&tx, *winner_scope, &earlier).await?;
    tx.rollback().await?;
    Ok(())
}

async fn approve_stored(
    pool: &deadpool_postgres::Pool,
    scope: StorageScope<'_>,
    task: &str,
    id: i64,
) -> std::result::Result<(), ApiError> {
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let mut proposal = storage::load(&tx, scope, task, id).await?;
    storage::validate_sources(&tx, scope, task, &proposal, 0).await?;
    storage::approve(&tx, scope, task, &mut proposal, 0).await?;
    tx.commit().await.map_err(ApiError::internal)
}
