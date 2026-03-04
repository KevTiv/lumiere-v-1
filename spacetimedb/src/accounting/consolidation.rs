/// Consolidation — ConsolidationAccount, ConsolidationJournal
///
/// # 8.5 Multi-Entity & Consolidation
///
/// Tables for managing multi-entity financial consolidation, including
/// elimination entries, intercompany balance eliminations, and
/// consolidated financial statements.
///
/// ## Tables
/// - `ConsolidationAccount` — Account mappings for consolidation
/// - `ConsolidationJournal` — Consolidation journals with elimination entries
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::ConsolidationState;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = consolidation_account,
    public,
    index(accessor = consolidation_account_by_code, btree(columns = [code])),
    index(accessor = consolidation_account_by_type, btree(columns = [account_type])),
    index(accessor = consolidation_account_by_currency, btree(columns = [currency_id]))
)]
#[derive(Clone)]
pub struct ConsolidationAccount {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub code: String,
    pub account_type: String, // "asset", "liability", "equity", "income", "expense"
    pub company_ids: Vec<u64>,
    pub consolidation_rate: f64, // Exchange rate for consolidation
    pub elimination_account_id: Option<u64>,
    pub currency_id: u64,
    pub is_active: bool,
    pub is_intercompany: bool,
    pub elimination_method: Option<String>, // "full", "proportional", "none"
    pub notes: Option<String>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = consolidation_journal,
    public,
    index(accessor = consolidation_journal_by_period, btree(columns = [period_id])),
    index(accessor = consolidation_journal_by_state, btree(columns = [state])),
    index(accessor = consolidation_journal_by_currency, btree(columns = [currency_id]))
)]
#[derive(Clone)]
pub struct ConsolidationJournal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub period_id: u64,
    pub period_name: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub company_ids: Vec<u64>,
    pub state: ConsolidationState,
    pub total_debit: f64,
    pub total_credit: f64,
    pub elimination_entries: Vec<u64>, // Journal entry IDs for eliminations
    pub elimination_total: f64,
    pub currency_id: u64,
    pub exchange_rate: f64,
    pub exchange_rate_date: Option<Timestamp>,
    pub notes: Option<String>,
    pub created_by: Option<Identity>,
    pub created_at: Timestamp,
    pub processed_at: Option<Timestamp>,
    pub processed_by: Option<Identity>,
    pub validated_at: Option<Timestamp>,
    pub validated_by: Option<Identity>,
    pub posted_at: Option<Timestamp>,
    pub posted_by: Option<Identity>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = consolidation_elimination_entry,
    public,
    index(accessor = elimination_by_journal, btree(columns = [journal_id])),
    index(accessor = elimination_by_account, btree(columns = [account_id])),
    index(accessor = elimination_by_company, btree(columns = [company_id]))
)]
#[derive(Clone)]
pub struct ConsolidationEliminationEntry {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub journal_id: u64,
    pub sequence: u32,
    pub name: String,
    pub account_id: u64,
    pub account_code: String,
    pub account_name: String,
    pub company_id: u64,
    pub counterparty_company_id: Option<u64>,
    pub debit: f64,
    pub credit: f64,
    pub currency_id: u64,
    pub amount_currency: f64,
    pub elimination_type: String, // "intercompany_receivable", "intercompany_payable", "intercompany_revenue", "intercompany_expense", "inventory_profit"
    pub reference: Option<String>,
    pub move_id: Option<u64>, // Reference to the journal entry created
    pub is_matched: bool,
    pub matched_entry_id: Option<u64>,
    pub notes: Option<String>,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = consolidation_company_rate,
    public,
    index(accessor = company_rate_by_company, btree(columns = [company_id])),
    index(accessor = company_rate_by_period, btree(columns = [period_id]))
)]
#[derive(Clone)]
pub struct ConsolidationCompanyRate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub company_id: u64,
    pub period_id: u64,
    pub currency_id: u64,
    pub exchange_rate: f64,
    pub rate_type: String, // "average", "spot", "historical"
    pub effective_date: Timestamp,
    pub created_by: Option<Identity>,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateConsolidationAccountParams {
    pub name: String,
    pub code: String,
    pub account_type: String,
    pub company_ids: Vec<u64>,
    pub consolidation_rate: f64,
    pub currency_id: u64,
    pub elimination_account_id: Option<u64>,
    pub is_intercompany: bool,
    pub elimination_method: Option<String>,
    pub notes: Option<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateConsolidationAccountParams {
    pub name: Option<String>,
    pub code: Option<String>,
    pub account_type: Option<String>,
    pub company_ids: Option<Vec<u64>>,
    pub consolidation_rate: Option<f64>,
    pub elimination_account_id: Option<u64>,
    pub is_intercompany: Option<bool>,
    pub elimination_method: Option<String>,
    pub is_active: Option<bool>,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateConsolidationJournalParams {
    pub name: String,
    pub period_id: u64,
    pub period_name: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub company_ids: Vec<u64>,
    pub currency_id: u64,
    pub exchange_rate: f64,
    pub exchange_rate_date: Option<Timestamp>,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateEliminationEntryParams {
    pub journal_id: u64,
    pub name: String,
    pub account_id: u64,
    pub account_code: String,
    pub account_name: String,
    pub company_id: u64,
    pub counterparty_company_id: Option<u64>,
    pub debit: f64,
    pub credit: f64,
    pub currency_id: u64,
    pub amount_currency: f64,
    pub elimination_type: String,
    pub reference: Option<String>,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetConsolidationCompanyRateParams {
    pub company_id: u64,
    pub period_id: u64,
    pub currency_id: u64,
    pub exchange_rate: f64,
    pub rate_type: String,
    pub effective_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a consolidation account mapping
#[spacetimedb::reducer]
pub fn create_consolidation_account(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateConsolidationAccountParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "consolidation_account", "create")?;

    if params.name.is_empty() {
        return Err("Consolidation account name is required".to_string());
    }

    if params.code.is_empty() {
        return Err("Consolidation account code is required".to_string());
    }

    if params.company_ids.is_empty() {
        return Err("At least one company is required".to_string());
    }

    let valid_types = ["asset", "liability", "equity", "income", "expense"];
    if !valid_types.contains(&params.account_type.as_str()) {
        return Err(format!(
            "Invalid account type. Must be one of: {}",
            valid_types.join(", ")
        ));
    }

    if params.consolidation_rate <= 0.0 {
        return Err("Consolidation rate must be positive".to_string());
    }

    let account = ctx.db.consolidation_account().insert(ConsolidationAccount {
        id: 0,
        name: params.name.clone(),
        code: params.code.clone(),
        account_type: params.account_type.clone(),
        company_ids: params.company_ids.clone(),
        consolidation_rate: params.consolidation_rate,
        elimination_account_id: params.elimination_account_id,
        currency_id: params.currency_id,
        is_active: params.is_active,
        is_intercompany: params.is_intercompany,
        elimination_method: params.elimination_method,
        notes: params.notes,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "consolidation_account",
            record_id: account.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "code": params.code, "account_type": params.account_type })
                    .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "code".to_string(), "account_type".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Update a consolidation account
#[spacetimedb::reducer]
pub fn update_consolidation_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    params: UpdateConsolidationAccountParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "consolidation_account", "write")?;

    let mut account = ctx
        .db
        .consolidation_account()
        .id()
        .find(&account_id)
        .ok_or("Consolidation account not found")?;

    let mut changed_fields = Vec::new();

    if let Some(n) = params.name {
        if n.is_empty() {
            return Err("Consolidation account name cannot be empty".to_string());
        }
        account.name = n;
        changed_fields.push("name".to_string());
    }

    if let Some(c) = params.code {
        if c.is_empty() {
            return Err("Consolidation account code cannot be empty".to_string());
        }
        account.code = c;
        changed_fields.push("code".to_string());
    }

    if let Some(at) = params.account_type {
        let valid_types = ["asset", "liability", "equity", "income", "expense"];
        if !valid_types.contains(&at.as_str()) {
            return Err(format!(
                "Invalid account type. Must be one of: {}",
                valid_types.join(", ")
            ));
        }
        account.account_type = at;
        changed_fields.push("account_type".to_string());
    }

    if let Some(cids) = params.company_ids {
        if cids.is_empty() {
            return Err("At least one company is required".to_string());
        }
        account.company_ids = cids;
        changed_fields.push("company_ids".to_string());
    }

    if let Some(cr) = params.consolidation_rate {
        if cr <= 0.0 {
            return Err("Consolidation rate must be positive".to_string());
        }
        account.consolidation_rate = cr;
        changed_fields.push("consolidation_rate".to_string());
    }

    if params.elimination_account_id.is_some() {
        account.elimination_account_id = params.elimination_account_id;
        changed_fields.push("elimination_account_id".to_string());
    }

    if let Some(ii) = params.is_intercompany {
        account.is_intercompany = ii;
        changed_fields.push("is_intercompany".to_string());
    }

    if params.elimination_method.is_some() {
        account.elimination_method = params.elimination_method;
        changed_fields.push("elimination_method".to_string());
    }

    if let Some(ia) = params.is_active {
        account.is_active = ia;
        changed_fields.push("is_active".to_string());
    }

    if params.notes.is_some() {
        account.notes = params.notes;
        changed_fields.push("notes".to_string());
    }

    if let Some(m) = params.metadata {
        account.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    account.write_uid = Some(ctx.sender());
    account.write_date = Some(ctx.timestamp);

    let account_name = account.name.clone();
    ctx.db.consolidation_account().id().update(account);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "consolidation_account",
            record_id: account_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": account_name }).to_string()),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

/// Create a consolidation journal
#[spacetimedb::reducer]
pub fn create_consolidation_journal(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateConsolidationJournalParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "consolidation_journal", "create")?;

    if params.name.is_empty() {
        return Err("Journal name is required".to_string());
    }

    if params.company_ids.is_empty() {
        return Err("At least one company is required".to_string());
    }

    if params.date_to <= params.date_from {
        return Err("End date must be after start date".to_string());
    }

    if params.exchange_rate <= 0.0 {
        return Err("Exchange rate must be positive".to_string());
    }

    let journal = ctx.db.consolidation_journal().insert(ConsolidationJournal {
        id: 0,
        name: params.name.clone(),
        period_id: params.period_id,
        period_name: params.period_name,
        date_from: params.date_from,
        date_to: params.date_to,
        company_ids: params.company_ids.clone(),
        state: ConsolidationState::Draft,
        total_debit: 0.0,
        total_credit: 0.0,
        elimination_entries: Vec::new(),
        elimination_total: 0.0,
        currency_id: params.currency_id,
        exchange_rate: params.exchange_rate,
        exchange_rate_date: params.exchange_rate_date,
        notes: params.notes,
        created_by: Some(ctx.sender()),
        created_at: ctx.timestamp,
        processed_at: None,
        processed_by: None,
        validated_at: None,
        validated_by: None,
        posted_at: None,
        posted_by: None,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "consolidation_journal",
            record_id: journal.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "period_id": params.period_id,
                    "company_ids": params.company_ids.len()
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "period_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Add elimination entry to consolidation journal
#[spacetimedb::reducer]
pub fn create_elimination_entry(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateEliminationEntryParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "consolidation_journal", "create")?;

    if params.name.is_empty() {
        return Err("Entry name is required".to_string());
    }

    let mut journal = ctx
        .db
        .consolidation_journal()
        .id()
        .find(&params.journal_id)
        .ok_or("Consolidation journal not found")?;

    if journal.state != ConsolidationState::Draft {
        return Err("Can only add entries to journals in Draft state".to_string());
    }

    let valid_elimination_types = [
        "intercompany_receivable",
        "intercompany_payable",
        "intercompany_revenue",
        "intercompany_expense",
        "inventory_profit",
    ];
    if !valid_elimination_types.contains(&params.elimination_type.as_str()) {
        return Err(format!(
            "Invalid elimination type. Must be one of: {}",
            valid_elimination_types.join(", ")
        ));
    }

    if (params.debit > 0.0 && params.credit > 0.0) || (params.debit == 0.0 && params.credit == 0.0)
    {
        return Err("Entry must have either debit or credit, but not both".to_string());
    }

    let sequence = ctx
        .db
        .consolidation_elimination_entry()
        .elimination_by_journal()
        .filter(&params.journal_id)
        .count() as u32
        + 1;

    let entry = ctx
        .db
        .consolidation_elimination_entry()
        .insert(ConsolidationEliminationEntry {
            id: 0,
            journal_id: params.journal_id,
            sequence,
            name: params.name.clone(),
            account_id: params.account_id,
            account_code: params.account_code.clone(),
            account_name: params.account_name,
            company_id: params.company_id,
            counterparty_company_id: params.counterparty_company_id,
            debit: params.debit,
            credit: params.credit,
            currency_id: params.currency_id,
            amount_currency: params.amount_currency,
            elimination_type: params.elimination_type.clone(),
            reference: params.reference,
            move_id: None,
            is_matched: false,
            matched_entry_id: None,
            notes: params.notes,
            created_at: ctx.timestamp,
            metadata: params.metadata,
        });

    journal.total_debit += params.debit;
    journal.total_credit += params.credit;
    journal.elimination_entries.push(entry.id);
    journal.elimination_total += params.debit + params.credit;

    ctx.db.consolidation_journal().id().update(journal);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "consolidation_elimination_entry",
            record_id: entry.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "account_code": params.account_code,
                    "debit": params.debit,
                    "credit": params.credit
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "account_code".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Process consolidation (calculate eliminations)
#[spacetimedb::reducer]
pub fn process_consolidation(
    ctx: &ReducerContext,
    organization_id: u64,
    journal_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "consolidation_journal", "write")?;

    let mut journal = ctx
        .db
        .consolidation_journal()
        .id()
        .find(&journal_id)
        .ok_or("Consolidation journal not found")?;

    if journal.state != ConsolidationState::Draft {
        return Err("Journal must be in Draft state to process".to_string());
    }

    journal.state = ConsolidationState::InProgress;
    journal.processed_by = Some(ctx.sender());
    journal.processed_at = Some(ctx.timestamp);

    ctx.db.consolidation_journal().id().update(journal.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "consolidation_journal",
            record_id: journal_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "Draft" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "InProgress" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Validate consolidation journal
#[spacetimedb::reducer]
pub fn validate_consolidation(
    ctx: &ReducerContext,
    organization_id: u64,
    journal_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "consolidation_journal", "write")?;

    let mut journal = ctx
        .db
        .consolidation_journal()
        .id()
        .find(&journal_id)
        .ok_or("Consolidation journal not found")?;

    if journal.state != ConsolidationState::InProgress {
        return Err("Journal must be in InProgress state to validate".to_string());
    }

    if (journal.total_debit - journal.total_credit).abs() > 0.01 {
        return Err(format!(
            "Journal is not balanced. Debits: {}, Credits: {}",
            journal.total_debit, journal.total_credit
        ));
    }

    journal.state = ConsolidationState::Completed;
    journal.validated_by = Some(ctx.sender());
    journal.validated_at = Some(ctx.timestamp);

    ctx.db.consolidation_journal().id().update(journal.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "consolidation_journal",
            record_id: journal_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "InProgress" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Completed" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Cancel consolidation journal
#[spacetimedb::reducer]
pub fn cancel_consolidation(
    ctx: &ReducerContext,
    organization_id: u64,
    journal_id: u64,
    reason: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "consolidation_journal", "write")?;

    let mut journal = ctx
        .db
        .consolidation_journal()
        .id()
        .find(&journal_id)
        .ok_or("Consolidation journal not found")?;

    if journal.state == ConsolidationState::Completed {
        return Err("Cannot cancel a completed consolidation journal".to_string());
    }

    journal.state = ConsolidationState::Cancelled;
    journal.notes = Some(format!(
        "{}\nCancellation reason: {}",
        journal.notes.unwrap_or_default(),
        reason
    ));

    ctx.db.consolidation_journal().id().update(journal.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "consolidation_journal",
            record_id: journal_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "reason": reason }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Set company exchange rate for consolidation
#[spacetimedb::reducer]
pub fn set_consolidation_company_rate(
    ctx: &ReducerContext,
    organization_id: u64,
    params: SetConsolidationCompanyRateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "consolidation_company_rate", "create")?;

    if params.exchange_rate <= 0.0 {
        return Err("Exchange rate must be positive".to_string());
    }

    let valid_rate_types = ["average", "spot", "historical"];
    if !valid_rate_types.contains(&params.rate_type.as_str()) {
        return Err(format!(
            "Invalid rate type. Must be one of: {}",
            valid_rate_types.join(", ")
        ));
    }

    let existing = ctx
        .db
        .consolidation_company_rate()
        .company_rate_by_company()
        .filter(&params.company_id)
        .filter(|r| r.period_id == params.period_id)
        .next();

    let rate = if let Some(mut existing_rate) = existing {
        existing_rate.exchange_rate = params.exchange_rate;
        existing_rate.rate_type = params.rate_type.clone();
        existing_rate.effective_date = params.effective_date;
        existing_rate.metadata = params.metadata;
        ctx.db
            .consolidation_company_rate()
            .id()
            .update(existing_rate.clone());
        existing_rate
    } else {
        ctx.db
            .consolidation_company_rate()
            .insert(ConsolidationCompanyRate {
                id: 0,
                company_id: params.company_id,
                period_id: params.period_id,
                currency_id: params.currency_id,
                exchange_rate: params.exchange_rate,
                rate_type: params.rate_type.clone(),
                effective_date: params.effective_date,
                created_by: Some(ctx.sender()),
                created_at: ctx.timestamp,
                metadata: params.metadata,
            })
    };

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "consolidation_company_rate",
            record_id: rate.id,
            action: "SET",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "company_id": params.company_id,
                    "period_id": params.period_id,
                    "exchange_rate": params.exchange_rate,
                    "rate_type": params.rate_type
                })
                .to_string(),
            ),
            changed_fields: vec!["exchange_rate".to_string(), "rate_type".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Match elimination entries
#[spacetimedb::reducer]
pub fn match_elimination_entries(
    ctx: &ReducerContext,
    organization_id: u64,
    entry_id: u64,
    matched_entry_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "consolidation_journal", "write")?;

    let mut entry1 = ctx
        .db
        .consolidation_elimination_entry()
        .id()
        .find(&entry_id)
        .ok_or("First elimination entry not found")?;

    let entry2 = ctx
        .db
        .consolidation_elimination_entry()
        .id()
        .find(&matched_entry_id)
        .ok_or("Second elimination entry not found")?;

    if entry1.journal_id != entry2.journal_id {
        return Err("Entries must be in the same journal to match".to_string());
    }

    let amounts_match =
        (entry1.debit > 0.0 && entry2.credit > 0.0 && (entry1.debit - entry2.credit).abs() < 0.01)
            || (entry1.credit > 0.0
                && entry2.debit > 0.0
                && (entry1.credit - entry2.debit).abs() < 0.01);

    if !amounts_match {
        return Err("Entries cannot be matched - amounts do not balance".to_string());
    }

    entry1.is_matched = true;
    entry1.matched_entry_id = Some(matched_entry_id);

    ctx.db
        .consolidation_elimination_entry()
        .id()
        .update(entry1.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "consolidation_elimination_entry",
            record_id: entry_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "matched_entry_id": matched_entry_id }).to_string(),
            ),
            changed_fields: vec!["is_matched".to_string(), "matched_entry_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Unmatch elimination entries
#[spacetimedb::reducer]
pub fn unmatch_elimination_entry(
    ctx: &ReducerContext,
    organization_id: u64,
    entry_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "consolidation_journal", "write")?;

    let mut entry = ctx
        .db
        .consolidation_elimination_entry()
        .id()
        .find(&entry_id)
        .ok_or("Elimination entry not found")?;

    if !entry.is_matched {
        return Err("Entry is not matched".to_string());
    }

    let journal = ctx
        .db
        .consolidation_journal()
        .id()
        .find(&entry.journal_id)
        .ok_or("Consolidation journal not found")?;

    if journal.state != ConsolidationState::Draft {
        return Err("Can only unmatch entries in Draft journals".to_string());
    }

    entry.is_matched = false;
    entry.matched_entry_id = None;

    ctx.db
        .consolidation_elimination_entry()
        .id()
        .update(entry.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "consolidation_elimination_entry",
            record_id: entry_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "is_matched": false }).to_string()),
            changed_fields: vec!["is_matched".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
