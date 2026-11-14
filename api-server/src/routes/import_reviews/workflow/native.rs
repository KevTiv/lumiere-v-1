//! Prepared journals use the existing native CSV owner. This module supplies
//! bounded inputs and verifies authoritative receipts and records afterwards.
use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use super::super::StorageScope;
use super::{model::*, storage::SavedProposal};
use crate::{
    error::ApiError, query_exec::row_u64, routes::import::WorkflowImportRequest,
    trusted_context::TrustedOperationContext,
};

const SOURCE_KEY: &str = "lumiere_import_proposal";
const BUNDLE_KEY: &str = "lumiere_account_move_bundle";

fn field<'a>(row: &'a Value, camel: &str, snake: &str) -> &'a Value {
    row.get(camel)
        .or_else(|| row.get(snake))
        .unwrap_or(&Value::Null)
}

fn id(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row_u64(row, camel, snake)
        .ok()
        .flatten()
        .filter(|value| *value > 0)
}

pub(super) async fn validate_references(
    context: &TrustedOperationContext,
    company: u64,
    config: &Configuration,
) -> Result<u8, ApiError> {
    config.validate()?;
    let org = context.organization_id();
    let journal = positive_id(&config.journal_id)?;
    let debit = positive_id(&config.debit_account_id)?;
    let credit = positive_id(&config.credit_account_id)?;
    let currency = positive_id(&config.currency_id)?;
    let companies = context.client().query_sql(&format!("SELECT id, organization_id, currency_id, deleted_at FROM company WHERE organization_id = {org} AND id = {company}")).await.map_err(ApiError::internal)?;
    let journals = context.client().query_sql(&format!("SELECT id, organization_id, company_id, active, currency_id FROM account_journal WHERE organization_id = {org} AND company_id = {company} AND id = {journal}")).await.map_err(ApiError::internal)?;
    let accounts = context.client().query_sql(&format!("SELECT id, organization_id, company_id, deprecated, currency_id, allowed_journal_ids FROM account_account WHERE organization_id = {org} AND company_id = {company} AND (id = {debit} OR id = {credit})")).await.map_err(ApiError::internal)?;
    let currencies = context.client().query_sql(&format!("SELECT id, organization_id, active, decimal_places FROM currency WHERE organization_id = {org} AND id = {currency}")).await.map_err(ApiError::internal)?;
    validate_reference_rows(
        org,
        company,
        config,
        &companies,
        &journals,
        &accounts,
        &currencies,
    )
}

pub(super) fn validate_reference_rows(
    org: u64,
    company: u64,
    config: &Configuration,
    companies: &[Value],
    journals: &[Value],
    accounts: &[Value],
    currencies: &[Value],
) -> Result<u8, ApiError> {
    let currency = positive_id(&config.currency_id)?;
    let journal = positive_id(&config.journal_id)?;
    let expected_accounts = [
        positive_id(&config.debit_account_id)?,
        positive_id(&config.credit_account_id)?,
    ]
    .into_iter()
    .collect::<BTreeSet<_>>();
    if companies.len() != 1
        || id(&companies[0], "id", "id") != Some(company)
        || id(&companies[0], "organizationId", "organization_id") != Some(org)
        || id(&companies[0], "currencyId", "currency_id") != Some(currency)
        || !field(&companies[0], "deletedAt", "deleted_at").is_null()
    {
        return Err(ApiError::Conflict("select the active company's own currency; foreign-currency preparation requires a separately reviewed exchange-rate workflow".into()));
    }
    if journals.len() != 1
        || !in_company(&journals[0], org, company)
        || id(&journals[0], "id", "id") != Some(journal)
        || journals[0]["active"] != true
        || id(&journals[0], "currencyId", "currency_id").is_some_and(|value| value != currency)
    {
        return Err(ApiError::Conflict(
            "choose an active journal in this company and currency".into(),
        ));
    }
    let found_accounts = accounts
        .iter()
        .filter_map(|row| id(row, "id", "id"))
        .collect::<BTreeSet<_>>();
    if accounts.len() != 2
        || found_accounts != expected_accounts
        || accounts.iter().any(|row| {
            !in_company(row, org, company)
                || row["deprecated"] != false
                || id(row, "currencyId", "currency_id").is_some_and(|value| value != currency)
                || !field(row, "allowedJournalIds", "allowed_journal_ids")
                    .as_array()
                    .is_some_and(|ids| {
                        ids.is_empty()
                            || ids.iter().any(|value| {
                                value.as_u64().or_else(|| value.as_str()?.parse().ok())
                                    == Some(journal)
                            })
                    })
        })
    {
        return Err(ApiError::Conflict(
            "choose two available accounts in this company, currency and journal".into(),
        ));
    }
    if currencies.len() != 1
        || id(&currencies[0], "organizationId", "organization_id") != Some(org)
        || id(&currencies[0], "id", "id") != Some(currency)
        || currencies[0]["active"] != true
    {
        return Err(ApiError::Conflict(
            "the selected currency is unavailable".into(),
        ));
    }
    field(&currencies[0], "decimalPlaces", "decimal_places")
        .as_u64()
        .and_then(|value| u8::try_from(value).ok())
        .filter(|value| *value <= 6)
        .ok_or_else(|| {
            ApiError::Conflict("currency precision exceeds the supported import precision".into())
        })
}

fn in_company(row: &Value, org: u64, company: u64) -> bool {
    id(row, "organizationId", "organization_id") == Some(org)
        && id(row, "companyId", "company_id") == Some(company)
}

pub(super) fn source_binding(
    scope: StorageScope<'_>,
    task: &str,
    proposal: &SavedProposal,
    entry: &Entry,
    side: &str,
) -> Value {
    json!({"version":1,"proposalId":proposal.id.to_string(),"proposalDigest":proposal.digest,"taskRequestId":task,
        "companyId":scope.company.to_string(),"itemId":entry.item_id,"batchId":entry.batch_id,"revision":entry.source_revision,
        "sourceFile":entry.source_file,"sourceRow":entry.source_row,"sourceSha256":entry.source_sha256,"side":side})
}

fn metadata(
    scope: StorageScope<'_>,
    task: &str,
    proposal: &SavedProposal,
    entry: &Entry,
    side: &str,
) -> Value {
    let mut marker = json!({"version":1,"token":format!("proposal-{}-{}",proposal.id,proposal.digest),"original_extra_present":false,"original_extra":null});
    if side == "header" {
        marker["fingerprint"] = json!(claim_key(entry));
    }
    json!({SOURCE_KEY:source_binding(scope,task,proposal,entry,side),"extra":{BUNDLE_KEY:marker}})
}

fn csv(rows: Vec<Vec<String>>) -> Result<String, ApiError> {
    let csv = rows
        .into_iter()
        .map(|row| {
            row.into_iter()
                .map(|value| {
                    if value.contains([',', '"', '\n', '\r']) {
                        format!("\"{}\"", value.replace('"', "\"\""))
                    } else {
                        value
                    }
                })
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>()
        .join("\n");
    if csv.len() > 2_000_000 {
        return Err(ApiError::BadRequest(
            "prepared journal group exceeds the native import limit; use a smaller group".into(),
        ));
    }
    Ok(csv)
}

fn request(
    scope: StorageScope<'_>,
    proposal: &SavedProposal,
    phase: &str,
    data: String,
) -> WorkflowImportRequest {
    let key = hash(
        format!(
            "lumiere-import-workflow/v1\0{}\0{}\0{}\0{}\0{}\0{phase}",
            scope.organization, scope.company, scope.actor, proposal.id, proposal.digest
        )
        .as_bytes(),
    );
    WorkflowImportRequest {
        entity: if phase == "headers" {
            "account_move"
        } else {
            "account_move_line"
        }
        .into(),
        company_id: scope.company,
        request_id: key[..32].into(),
        file_name: format!("import-proposal-{}-{phase}.csv", proposal.id),
        csv: data,
    }
}

pub(super) fn header_request(
    scope: StorageScope<'_>,
    task: &str,
    proposal: &SavedProposal,
) -> Result<WorkflowImportRequest, ApiError> {
    let config = &proposal.definition.configuration;
    let mut rows = vec![vec![
        "journal_id",
        "ref_",
        "date",
        "move_type",
        "currency_id",
        "name",
        "amount_total",
        "metadata",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()];
    for entry in &proposal.definition.entries {
        rows.push(vec![
            config.journal_id.clone(),
            entry.reference.clone(),
            entry.date.clone(),
            "entry".into(),
            config.currency_id.clone(),
            "/".into(),
            entry.amount.clone(),
            metadata(scope, task, proposal, entry, "header").to_string(),
        ]);
    }
    Ok(request(scope, proposal, "headers", csv(rows)?))
}

pub(super) fn line_request(
    scope: StorageScope<'_>,
    task: &str,
    proposal: &SavedProposal,
    header_ids: &[u64],
) -> Result<WorkflowImportRequest, ApiError> {
    if header_ids.len() != proposal.definition.entries.len() {
        return Err(ApiError::Conflict(
            "journal header receipt is incomplete".into(),
        ));
    }
    let config = &proposal.definition.configuration;
    let mut rows = vec![vec![
        "move_id",
        "account_id",
        "date",
        "currency_id",
        "name",
        "debit",
        "credit",
        "metadata",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()];
    for (entry, id) in proposal.definition.entries.iter().zip(header_ids) {
        for (side, account, debit, credit) in [
            (
                "debit",
                &config.debit_account_id,
                entry.amount.as_str(),
                "0",
            ),
            (
                "credit",
                &config.credit_account_id,
                "0",
                entry.amount.as_str(),
            ),
        ] {
            rows.push(vec![
                id.to_string(),
                account.clone(),
                entry.date.clone(),
                config.currency_id.clone(),
                entry.description.clone(),
                debit.into(),
                credit.into(),
                metadata(scope, task, proposal, entry, side).to_string(),
            ]);
        }
    }
    Ok(request(scope, proposal, "lines", csv(rows)?))
}

pub(super) fn receipt_ids(receipt: &Value, expected: usize) -> Result<Vec<u64>, ApiError> {
    if receipt["status"] != "success"
        || receipt["errorRows"].as_u64() != Some(0)
        || receipt["totalRows"].as_u64() != Some(expected as u64)
        || receipt["rowsImported"].as_u64() != Some(expected as u64)
    {
        let message = receipt
            .get("errors")
            .and_then(Value::as_array)
            .and_then(|errors| errors.first())
            .and_then(|error| error["errorMessage"].as_str())
            .unwrap_or("Inspect the saved native import receipt before changing this group.");
        return Err(ApiError::Conflict(format!(
            "native import did not save the approved group: {message}"
        )));
    }
    let records = receipt["records"]
        .as_array()
        .ok_or_else(|| ApiError::Conflict("native import returned no exact record IDs".into()))?;
    if records.len() != expected {
        return Err(ApiError::Conflict(
            "native import record count does not match the approved group".into(),
        ));
    }
    let mut rows = BTreeMap::new();
    let mut ids = BTreeSet::new();
    for record in records {
        let row = record["rowNumber"]
            .as_u64()
            .filter(|row| (2..=expected as u64 + 1).contains(row))
            .ok_or_else(|| {
                ApiError::Conflict("native receipt contains an invalid source row".into())
            })?;
        let record_id = record["recordId"]
            .as_str()
            .map(positive_id)
            .transpose()?
            .or_else(|| record["recordId"].as_u64())
            .filter(|id| *id > 0)
            .ok_or_else(|| {
                ApiError::Conflict("native receipt contains an invalid record ID".into())
            })?;
        if rows.insert(row, record_id).is_some() || !ids.insert(record_id) {
            return Err(ApiError::Conflict(
                "native receipt contains ambiguous record IDs".into(),
            ));
        }
    }
    Ok(rows.into_values().collect())
}

fn id_filter(column: &str, ids: &[u64]) -> Result<String, ApiError> {
    if ids.is_empty() || ids.len() > MAX_ROWS * 2 {
        return Err(ApiError::BadRequest("invalid verified record set".into()));
    }
    Ok(ids
        .iter()
        .map(|id| format!("{column} = {id}"))
        .collect::<Vec<_>>()
        .join(" OR "))
}

pub(super) async fn read_records(
    context: &TrustedOperationContext,
    company: u64,
    header_ids: &[u64],
) -> Result<(Vec<Value>, Vec<Value>), ApiError> {
    let org = context.organization_id();
    let parent_filter = id_filter("id", header_ids)?;
    let line_filter = id_filter("move_id", header_ids)?;
    let moves = context.client().query_sql(&format!("SELECT id, organization_id, company_id, journal_id, currency_id, company_currency_id, date, state, move_type, ref_, amount_total, auto_post, posted_before, metadata FROM account_move WHERE organization_id = {org} AND company_id = {company} AND ({parent_filter})")).await.map_err(ApiError::internal)?;
    // All child lines are read so an extra or untracked line cannot be hidden
    // behind a clean subset of returned receipt IDs.
    let lines = context.client().query_sql(&format!("SELECT id, organization_id, company_id, move_id, account_id, journal_id, currency_id, company_currency_id, date, parent_state, debit, credit, metadata FROM account_move_line WHERE organization_id = {org} AND company_id = {company} AND ({line_filter})")).await.map_err(ApiError::internal)?;
    Ok((moves, lines))
}

fn metadata_matches(row: &Value, expected: &Value) -> bool {
    row["metadata"]
        .as_str()
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .is_some_and(|value| value[SOURCE_KEY] == *expected)
}

pub(super) async fn read_posting_status(
    context: &TrustedOperationContext,
    scope: StorageScope<'_>,
    task: &str,
    proposal: &SavedProposal,
    result: &VerifiedResult,
) -> Result<Value, ApiError> {
    let ids = result
        .record_ids
        .iter()
        .map(|id| positive_id(id))
        .collect::<Result<Vec<_>, _>>()?;
    let filter = id_filter("id", &ids)?;
    let company = scope.company;
    let org = scope.organization;
    let moves = context.client().query_sql(&format!("SELECT id, organization_id, company_id, state, move_type, metadata FROM account_move WHERE organization_id = {org} AND company_id = {company} AND ({filter})")).await.map_err(ApiError::internal)?;
    posting_status(scope, task, proposal, result, &moves)
}

pub(super) fn posting_status(
    scope: StorageScope<'_>,
    task: &str,
    proposal: &SavedProposal,
    result: &VerifiedResult,
    moves: &[Value],
) -> Result<Value, ApiError> {
    let ids = result
        .record_ids
        .iter()
        .map(|id| positive_id(id))
        .collect::<Result<Vec<_>, _>>()?;
    if result.company_id != scope.company.to_string()
        || ids.len() != result.record_count
        || ids.len() != proposal.definition.entries.len()
        || ids.iter().collect::<BTreeSet<_>>().len() != ids.len()
    {
        return Err(ApiError::Conflict(
            "the saved draft receipt does not identify the approved journal entries".into(),
        ));
    }
    let mut draft = 0;
    let mut posted = 0;
    let mut other = 0;
    let mut unavailable = 0;
    for (move_id, entry) in ids.iter().zip(&proposal.definition.entries) {
        let mut matching = moves
            .iter()
            .filter(|row| id(row, "id", "id") == Some(*move_id));
        let row = matching.next().filter(|row| {
            matching.next().is_none()
                && in_company(row, scope.organization, scope.company)
                && field(row, "moveType", "move_type")
                    .as_str()
                    .is_some_and(|value| value.eq_ignore_ascii_case("entry"))
                && metadata_matches(row, &source_binding(scope, task, proposal, entry, "header"))
        });
        let state = row.and_then(|row| row["state"].as_str());
        match state.map(str::to_ascii_lowercase).as_deref() {
            Some("draft") => draft += 1,
            Some("posted") => posted += 1,
            Some(_) => other += 1,
            None => unavailable += 1,
        }
    }
    Ok(json!({
        "companyId": scope.company.to_string(),
        "proposalId": proposal.id.to_string(),
        "recordCount": ids.len(),
        "draftCount": draft,
        "postedCount": posted,
        "otherCount": other,
        "unavailableCount": unavailable,
        "checkedAt": chrono::Utc::now().to_rfc3339()
    }))
}

fn date_matches(value: &Value, expected: &str) -> bool {
    let value = value
        .get("microsSinceUnixEpoch")
        .or_else(|| value.get("__timestamp_micros_since_unix_epoch__"))
        .unwrap_or(value);
    let actual = value.as_i64().or_else(|| value.as_str()?.parse().ok());
    let expected = super::super::history_period::calendar_date(expected)
        .ok()
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|date| date.and_utc().timestamp_micros());
    actual.is_some() && actual == expected
}

pub(super) fn verify_records(
    scope: StorageScope<'_>,
    task: &str,
    proposal: &SavedProposal,
    header_ids: &[u64],
    line_ids: &[u64],
    moves: &[Value],
    lines: &[Value],
) -> Result<VerifiedResult, ApiError> {
    let entries = &proposal.definition.entries;
    if moves.len() != entries.len()
        || lines.len() != entries.len() * 2
        || header_ids.len() != entries.len()
        || line_ids.len() != entries.len() * 2
    {
        return Err(ApiError::Conflict(
            "saved journal headers or lines do not match the approved counts".into(),
        ));
    }
    let moves = moves
        .iter()
        .filter_map(|row| id(row, "id", "id").map(|id| (id, row)))
        .collect::<BTreeMap<_, _>>();
    let lines = lines
        .iter()
        .filter_map(|row| id(row, "id", "id").map(|id| (id, row)))
        .collect::<BTreeMap<_, _>>();
    if moves.len() != entries.len() || lines.len() != entries.len() * 2 {
        return Err(ApiError::Conflict(
            "saved record identities are ambiguous".into(),
        ));
    }
    let config = &proposal.definition.configuration;
    let journal = positive_id(&config.journal_id)?;
    let currency = positive_id(&config.currency_id)?;
    for (index, entry) in entries.iter().enumerate() {
        let move_id = header_ids[index];
        let parent = moves
            .get(&move_id)
            .ok_or_else(|| ApiError::Conflict("a saved journal header is missing".into()))?;
        if !in_company(parent, scope.organization, scope.company)
            || id(parent, "journalId", "journal_id") != Some(journal)
            || id(parent, "currencyId", "currency_id") != Some(currency)
            || id(parent, "companyCurrencyId", "company_currency_id") != Some(currency)
            || !native_amount_matches(
                &entry.amount,
                field(parent, "amountTotal", "amount_total").as_f64(),
            )
            || field(parent, "autoPost", "auto_post") != false
            || field(parent, "postedBefore", "posted_before") != false
            || parent["state"].as_str().map(str::to_lowercase).as_deref() != Some("draft")
            || field(parent, "moveType", "move_type")
                .as_str()
                .map(str::to_lowercase)
                .as_deref()
                != Some("entry")
            || !date_matches(&parent["date"], &entry.date)
            || field(parent, "ref", "ref_").as_str() != Some(entry.reference.as_str())
            || !metadata_matches(
                parent,
                &source_binding(scope, task, proposal, entry, "header"),
            )
        {
            return Err(ApiError::Conflict(format!(
                "journal {move_id} changed or does not match its approved source"
            )));
        }
        for (offset, side, account, debit, credit) in [
            (
                0,
                "debit",
                &config.debit_account_id,
                entry.amount.as_str(),
                "0",
            ),
            (
                1,
                "credit",
                &config.credit_account_id,
                "0",
                entry.amount.as_str(),
            ),
        ] {
            let line_id = line_ids[index * 2 + offset];
            let line = lines
                .get(&line_id)
                .ok_or_else(|| ApiError::Conflict("a saved journal line is missing".into()))?;
            if !in_company(line, scope.organization, scope.company)
                || id(line, "moveId", "move_id") != Some(move_id)
                || id(line, "accountId", "account_id") != Some(positive_id(account)?)
                || id(line, "journalId", "journal_id") != Some(journal)
                || id(line, "currencyId", "currency_id") != Some(currency)
                || id(line, "companyCurrencyId", "company_currency_id") != Some(currency)
                || field(line, "parentState", "parent_state")
                    .as_str()
                    .map(str::to_lowercase)
                    .as_deref()
                    != Some("draft")
                || !date_matches(&line["date"], &entry.date)
                || !native_amount_matches(debit, line["debit"].as_f64())
                || !native_amount_matches(credit, line["credit"].as_f64())
                || !metadata_matches(line, &source_binding(scope, task, proposal, entry, side))
            {
                return Err(ApiError::Conflict(format!(
                    "journal line {line_id} changed or does not match its approved source"
                )));
            }
        }
    }
    Ok(VerifiedResult {
        verified_at: chrono::Utc::now().to_rfc3339(),
        company_id: scope.company.to_string(),
        currency_id: config.currency_id.clone(),
        record_count: entries.len(),
        line_count: entries.len() * 2,
        total_debit: proposal.definition.summary.total_debit.clone(),
        total_credit: proposal.definition.summary.total_credit.clone(),
        record_ids: header_ids.iter().map(ToString::to_string).collect(),
        line_ids: line_ids.iter().map(ToString::to_string).collect(),
        posted_count: 0,
    })
}
