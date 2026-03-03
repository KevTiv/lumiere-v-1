/// Intercompany Transactions — IntercompanyTransaction, IntercompanyRule
///
/// # 8.4 Intercompany Transactions
///
/// Tables for managing transactions between related companies within
/// the same organization. Supports automatic generation of corresponding
/// documents in destination companies.
///
/// ## Tables
/// - `IntercompanyTransaction` — Records of intercompany transactions
/// - `IntercompanyRule` — Configuration rules for intercompany processing
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use crate::types::{IntercompanyState, RuleType};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = intercompany_transaction,
    public,
    index(accessor = intercompany_by_origin, btree(columns = [origin_company_id])),
    index(accessor = intercompany_by_destination, btree(columns = [destination_company_id])),
    index(accessor = intercompany_by_state, btree(columns = [state])),
    index(accessor = intercompany_by_type, btree(columns = [origin_document_model]))
)]
#[derive(Clone)]
pub struct IntercompanyTransaction {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub origin_company_id: u64,
    pub destination_company_id: u64,
    pub origin_document_id: u64,
    pub origin_document_model: String, // "sale_order", "purchase_order", "account_move", etc.
    pub destination_document_id: Option<u64>,
    pub destination_document_model: Option<String>,
    pub amount: f64,
    pub currency_id: u64,
    pub state: IntercompanyState,
    pub transaction_type: RuleType,
    pub notes: Option<String>,
    pub created_by: Option<Identity>,
    pub created_at: Timestamp,
    pub processed_at: Option<Timestamp>,
    pub processed_by: Option<Identity>,
    pub error_message: Option<String>,
    pub auto_process: bool,
    pub requires_approval: bool,
    pub approved_by: Option<Identity>,
    pub approved_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = intercompany_rule,
    public,
    index(accessor = intercompany_rule_by_source, btree(columns = [source_company_id])),
    index(accessor = intercompany_rule_by_destination, btree(columns = [destination_company_id])),
    index(accessor = intercompany_rule_by_type, btree(columns = [rule_type]))
)]
#[derive(Clone)]
pub struct IntercompanyRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub rule_type: RuleType,
    pub source_company_id: u64,
    pub destination_company_id: u64,
    pub auto_validation: bool,
    pub auto_generate_invoice: bool,
    pub auto_generate_bill: bool,
    pub journal_id: Option<u64>,
    pub account_id: Option<u64>,
    pub pricelist_id: Option<u64>,
    pub is_active: bool,
    pub sequence: u32,
    pub notes: Option<String>,
    pub created_by: Option<Identity>,
    pub created_at: Timestamp,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new intercompany rule
#[spacetimedb::reducer]
pub fn create_intercompany_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    source_company_id: u64,
    destination_company_id: u64,
    name: String,
    rule_type: RuleType,
    auto_validation: bool,
    auto_generate_invoice: bool,
    auto_generate_bill: bool,
    journal_id: Option<u64>,
    account_id: Option<u64>,
    pricelist_id: Option<u64>,
    sequence: u32,
    notes: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_rule", "create")?;

    if name.is_empty() {
        return Err("Rule name is required".to_string());
    }

    if source_company_id == destination_company_id {
        return Err("Source and destination companies must be different".to_string());
    }

    let rule = ctx.db.intercompany_rule().insert(IntercompanyRule {
        id: 0,
        name: name.clone(),
        rule_type: rule_type.clone(),
        source_company_id,
        destination_company_id,
        auto_validation,
        auto_generate_invoice,
        auto_generate_bill,
        journal_id,
        account_id,
        pricelist_id,
        is_active: true,
        sequence,
        notes,
        created_by: Some(ctx.sender()),
        created_at: ctx.timestamp,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(source_company_id),
        "intercompany_rule",
        rule.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({
                "name": name,
                "rule_type": format!("{:?}", rule_type.clone()),
                "source_company_id": source_company_id,
                "destination_company_id": destination_company_id
            })
            .to_string(),
        ),
        vec![
            "name".to_string(),
            "rule_type".to_string(),
            "source_company_id".to_string(),
            "destination_company_id".to_string(),
        ],
    );

    Ok(())
}

/// Update an intercompany rule
#[spacetimedb::reducer]
pub fn update_intercompany_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule_id: u64,
    name: Option<String>,
    auto_validation: Option<bool>,
    auto_generate_invoice: Option<bool>,
    auto_generate_bill: Option<bool>,
    journal_id: Option<u64>,
    account_id: Option<u64>,
    pricelist_id: Option<u64>,
    sequence: Option<u32>,
    is_active: Option<bool>,
    notes: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_rule", "write")?;

    let mut rule = ctx
        .db
        .intercompany_rule()
        .id()
        .find(&rule_id)
        .ok_or("Intercompany rule not found")?;

    if rule.source_company_id != company_id && rule.destination_company_id != company_id {
        return Err("Rule does not belong to this company".to_string());
    }

    let mut changed_fields = Vec::new();

    if let Some(n) = name {
        if n.is_empty() {
            return Err("Rule name cannot be empty".to_string());
        }
        rule.name = n;
        changed_fields.push("name".to_string());
    }

    if let Some(av) = auto_validation {
        rule.auto_validation = av;
        changed_fields.push("auto_validation".to_string());
    }

    if let Some(agi) = auto_generate_invoice {
        rule.auto_generate_invoice = agi;
        changed_fields.push("auto_generate_invoice".to_string());
    }

    if let Some(agb) = auto_generate_bill {
        rule.auto_generate_bill = agb;
        changed_fields.push("auto_generate_bill".to_string());
    }

    if journal_id.is_some() {
        rule.journal_id = journal_id;
        changed_fields.push("journal_id".to_string());
    }

    if account_id.is_some() {
        rule.account_id = account_id;
        changed_fields.push("account_id".to_string());
    }

    if pricelist_id.is_some() {
        rule.pricelist_id = pricelist_id;
        changed_fields.push("pricelist_id".to_string());
    }

    if let Some(seq) = sequence {
        rule.sequence = seq;
        changed_fields.push("sequence".to_string());
    }

    if let Some(active) = is_active {
        rule.is_active = active;
        changed_fields.push("is_active".to_string());
    }

    if notes.is_some() {
        rule.notes = notes;
        changed_fields.push("notes".to_string());
    }

    if let Some(m) = metadata {
        rule.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    rule.write_uid = Some(ctx.sender());
    rule.write_date = Some(ctx.timestamp);

    ctx.db.intercompany_rule().id().update(rule.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "intercompany_rule",
        rule_id,
        "UPDATE",
        None,
        Some(serde_json::json!({ "name": rule.name }).to_string()),
        changed_fields,
    );

    Ok(())
}

/// Create an intercompany transaction
#[spacetimedb::reducer]
pub fn create_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    origin_company_id: u64,
    destination_company_id: u64,
    origin_document_id: u64,
    origin_document_model: String,
    amount: f64,
    currency_id: u64,
    transaction_type: RuleType,
    auto_process: bool,
    requires_approval: bool,
    notes: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "create")?;

    if origin_company_id == destination_company_id {
        return Err("Origin and destination companies must be different".to_string());
    }

    if origin_document_model.is_empty() {
        return Err("Document model is required".to_string());
    }

    // Find applicable rule
    let rule = ctx
        .db
        .intercompany_rule()
        .intercompany_rule_by_source()
        .filter(&origin_company_id)
        .filter(|r| {
            r.destination_company_id == destination_company_id
                && r.rule_type == transaction_type
                && r.is_active
        })
        .min_by_key(|r| r.sequence);

    if rule.is_none() && requires_approval {
        return Err(
            "No active intercompany rule found for this transaction type between companies"
                .to_string(),
        );
    }

    let initial_state = if auto_process && !requires_approval {
        IntercompanyState::Processing
    } else {
        IntercompanyState::Draft
    };

    let transaction = ctx
        .db
        .intercompany_transaction()
        .insert(IntercompanyTransaction {
            id: 0,
            name: format!(
                "{}-{}-{}",
                origin_document_model, origin_document_id, ctx.timestamp
            ),
            origin_company_id,
            destination_company_id,
            origin_document_id,
            origin_document_model,
            destination_document_id: None,
            destination_document_model: None,
            amount,
            currency_id,
            state: initial_state,
            transaction_type,
            notes,
            created_by: Some(ctx.sender()),
            created_at: ctx.timestamp,
            processed_at: None,
            processed_by: None,
            error_message: None,
            auto_process,
            requires_approval,
            approved_by: None,
            approved_at: None,
            metadata,
        });

    write_audit_log(
        ctx,
        organization_id,
        Some(origin_company_id),
        "intercompany_transaction",
        transaction.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({
                "origin_company_id": origin_company_id,
                "destination_company_id": destination_company_id,
                "origin_document_id": origin_document_id,
                "amount": amount
            })
            .to_string(),
        ),
        vec![
            "origin_company_id".to_string(),
            "destination_company_id".to_string(),
            "origin_document_id".to_string(),
            "amount".to_string(),
        ],
    );

    Ok(())
}

/// Approve an intercompany transaction
#[spacetimedb::reducer]
pub fn approve_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let mut transaction = ctx
        .db
        .intercompany_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Transaction not found")?;

    if transaction.origin_company_id != company_id
        && transaction.destination_company_id != company_id
    {
        return Err("Transaction does not involve this company".to_string());
    }

    if transaction.state != IntercompanyState::Draft {
        return Err("Transaction must be in Draft state to approve".to_string());
    }

    if !transaction.requires_approval {
        return Err("This transaction does not require approval".to_string());
    }

    transaction.state = IntercompanyState::Approved;
    transaction.approved_by = Some(ctx.sender());
    transaction.approved_at = Some(ctx.timestamp);
    transaction.processed_by = Some(ctx.sender());

    ctx.db
        .intercompany_transaction()
        .id()
        .update(transaction.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "intercompany_transaction",
        transaction_id,
        "APPROVE",
        Some(serde_json::json!({ "state": "Draft" }).to_string()),
        Some(serde_json::json!({ "state": "Approved" }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

/// Process an intercompany transaction
#[spacetimedb::reducer]
pub fn process_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
    destination_document_id: u64,
    destination_document_model: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let mut transaction = ctx
        .db
        .intercompany_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Transaction not found")?;

    if transaction.destination_company_id != company_id {
        return Err("Transaction must be processed by destination company".to_string());
    }

    if transaction.state != IntercompanyState::Draft
        && transaction.state != IntercompanyState::Approved
        && transaction.state != IntercompanyState::Pending
    {
        return Err(
            "Transaction must be in Draft, Approved, or Pending state to process".to_string(),
        );
    }

    transaction.state = IntercompanyState::Processing;
    transaction.destination_document_id = Some(destination_document_id);
    transaction.destination_document_model = Some(destination_document_model.clone());
    transaction.processed_by = Some(ctx.sender());

    ctx.db
        .intercompany_transaction()
        .id()
        .update(transaction.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "intercompany_transaction",
        transaction_id,
        "PROCESS",
        None,
        Some(
            serde_json::json!({
                "destination_document_id": destination_document_id,
                "destination_document_model": destination_document_model
            })
            .to_string(),
        ),
        vec![
            "destination_document_id".to_string(),
            "destination_document_model".to_string(),
        ],
    );

    Ok(())
}

/// Complete an intercompany transaction
#[spacetimedb::reducer]
pub fn complete_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let mut transaction = ctx
        .db
        .intercompany_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Transaction not found")?;

    if transaction.origin_company_id != company_id
        && transaction.destination_company_id != company_id
    {
        return Err("Transaction does not involve this company".to_string());
    }

    if transaction.state != IntercompanyState::Processing {
        return Err("Transaction must be in Processing state to complete".to_string());
    }

    if transaction.destination_document_id.is_none() {
        return Err("Transaction must have a destination document to complete".to_string());
    }

    transaction.state = IntercompanyState::Completed;
    transaction.processed_at = Some(ctx.timestamp);

    ctx.db
        .intercompany_transaction()
        .id()
        .update(transaction.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "intercompany_transaction",
        transaction_id,
        "COMPLETE",
        Some(serde_json::json!({ "state": "Processing" }).to_string()),
        Some(serde_json::json!({ "state": "Completed" }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

/// Mark transaction as error
#[spacetimedb::reducer]
pub fn error_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
    error_message: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let mut transaction = ctx
        .db
        .intercompany_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Transaction not found")?;

    if transaction.origin_company_id != company_id
        && transaction.destination_company_id != company_id
    {
        return Err("Transaction does not involve this company".to_string());
    }

    transaction.state = IntercompanyState::Error;
    transaction.error_message = Some(error_message.clone());

    ctx.db
        .intercompany_transaction()
        .id()
        .update(transaction.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "intercompany_transaction",
        transaction_id,
        "ERROR",
        None,
        Some(serde_json::json!({ "error_message": error_message }).to_string()),
        vec!["state".to_string(), "error_message".to_string()],
    );

    Ok(())
}

/// Cancel an intercompany transaction
#[spacetimedb::reducer]
pub fn cancel_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
    reason: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let mut transaction = ctx
        .db
        .intercompany_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Transaction not found")?;

    if transaction.origin_company_id != company_id {
        return Err("Only origin company can cancel the transaction".to_string());
    }

    if transaction.state == IntercompanyState::Completed {
        return Err("Cannot cancel a completed transaction".to_string());
    }

    transaction.state = IntercompanyState::Cancelled;
    transaction.notes = Some(format!(
        "{}\nCancellation reason: {}",
        transaction.notes.unwrap_or_default(),
        reason
    ));

    ctx.db
        .intercompany_transaction()
        .id()
        .update(transaction.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "intercompany_transaction",
        transaction_id,
        "CANCEL",
        None,
        Some(serde_json::json!({ "reason": reason }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

/// Retry a failed transaction
#[spacetimedb::reducer]
pub fn retry_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let mut transaction = ctx
        .db
        .intercompany_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Transaction not found")?;

    if transaction.destination_company_id != company_id {
        return Err("Transaction must be retried by destination company".to_string());
    }

    if transaction.state != IntercompanyState::Error {
        return Err("Only transactions in Error state can be retried".to_string());
    }

    transaction.state = IntercompanyState::Pending;
    transaction.error_message = None;
    transaction.processed_by = Some(ctx.sender());

    ctx.db
        .intercompany_transaction()
        .id()
        .update(transaction.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "intercompany_transaction",
        transaction_id,
        "RETRY",
        Some(serde_json::json!({ "state": "Error" }).to_string()),
        Some(serde_json::json!({ "state": "Pending" }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

/// Set rule active/inactive
#[spacetimedb::reducer]
pub fn set_intercompany_rule_active(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule_id: u64,
    is_active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_rule", "write")?;

    let mut rule = ctx
        .db
        .intercompany_rule()
        .id()
        .find(&rule_id)
        .ok_or("Intercompany rule not found")?;

    if rule.source_company_id != company_id && rule.destination_company_id != company_id {
        return Err("Rule does not belong to this company".to_string());
    }

    rule.is_active = is_active;
    rule.write_uid = Some(ctx.sender());
    rule.write_date = Some(ctx.timestamp);

    ctx.db.intercompany_rule().id().update(rule.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "intercompany_rule",
        rule_id,
        "SET_ACTIVE",
        None,
        Some(serde_json::json!({ "is_active": is_active }).to_string()),
        vec!["is_active".to_string()],
    );

    Ok(())
}
