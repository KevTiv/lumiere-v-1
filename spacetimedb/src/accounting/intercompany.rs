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
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
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
    pub origin_document_model: String,
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

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateIntercompanyRuleParams {
    pub name: String,
    pub rule_type: RuleType,
    pub auto_validation: bool,
    pub auto_generate_invoice: bool,
    pub auto_generate_bill: bool,
    pub is_active: bool,
    pub journal_id: Option<u64>,
    pub account_id: Option<u64>,
    pub pricelist_id: Option<u64>,
    pub sequence: u32,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateIntercompanyRuleParams {
    pub name: Option<String>,
    pub auto_validation: Option<bool>,
    pub auto_generate_invoice: Option<bool>,
    pub auto_generate_bill: Option<bool>,
    pub journal_id: Option<Option<u64>>,
    pub account_id: Option<Option<u64>>,
    pub pricelist_id: Option<Option<u64>>,
    pub sequence: Option<u32>,
    pub is_active: Option<bool>,
    pub notes: Option<Option<String>>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateIntercompanyTransactionParams {
    pub origin_document_id: u64,
    pub origin_document_model: String,
    pub destination_company_id: u64,
    pub amount: f64,
    pub currency_id: u64,
    pub transaction_type: RuleType,
    pub auto_process: bool,
    pub requires_approval: bool,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ProcessIntercompanyTransactionParams {
    pub destination_document_id: u64,
    pub destination_document_model: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ErrorIntercompanyTransactionParams {
    pub error_message: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CancelIntercompanyTransactionParams {
    pub reason: String,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_intercompany_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    source_company_id: u64,
    destination_company_id: u64,
    params: CreateIntercompanyRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_rule", "create")?;

    if params.name.is_empty() {
        return Err("Rule name is required".to_string());
    }

    if source_company_id == destination_company_id {
        return Err("Source and destination companies must be different".to_string());
    }

    let rule = ctx.db.intercompany_rule().insert(IntercompanyRule {
        id: 0,
        name: params.name.clone(),
        rule_type: params.rule_type.clone(),
        source_company_id,
        destination_company_id,
        auto_validation: params.auto_validation,
        auto_generate_invoice: params.auto_generate_invoice,
        auto_generate_bill: params.auto_generate_bill,
        journal_id: params.journal_id,
        account_id: params.account_id,
        pricelist_id: params.pricelist_id,
        is_active: params.is_active,
        sequence: params.sequence,
        notes: params.notes,
        created_by: Some(ctx.sender()),
        created_at: ctx.timestamp,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(source_company_id),
            table_name: "intercompany_rule",
            record_id: rule.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": rule.name,
                    "rule_type": format!("{:?}", rule.rule_type),
                    "source_company_id": source_company_id,
                    "destination_company_id": destination_company_id
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "rule_type".to_string(),
                "source_company_id".to_string(),
                "destination_company_id".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_intercompany_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule_id: u64,
    params: UpdateIntercompanyRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_rule", "write")?;

    let rule = ctx
        .db
        .intercompany_rule()
        .id()
        .find(&rule_id)
        .ok_or("Intercompany rule not found")?;

    if rule.source_company_id != company_id && rule.destination_company_id != company_id {
        return Err("Rule does not belong to this company".to_string());
    }

    let old_values = serde_json::json!({
        "name": rule.name,
        "auto_validation": rule.auto_validation,
        "is_active": rule.is_active
    });

    let mut changed_fields = Vec::new();

    let mut new_name = rule.name.clone();
    let mut new_auto_validation = rule.auto_validation;
    let mut new_auto_generate_invoice = rule.auto_generate_invoice;
    let mut new_auto_generate_bill = rule.auto_generate_bill;
    let mut new_journal_id = rule.journal_id;
    let mut new_account_id = rule.account_id;
    let mut new_pricelist_id = rule.pricelist_id;
    let mut new_sequence = rule.sequence;
    let mut new_is_active = rule.is_active;
    let mut new_notes = rule.notes.clone();
    let mut new_metadata = rule.metadata.clone();

    if let Some(n) = params.name {
        if n.is_empty() {
            return Err("Rule name cannot be empty".to_string());
        }
        new_name = n;
        changed_fields.push("name".to_string());
    }

    if let Some(av) = params.auto_validation {
        new_auto_validation = av;
        changed_fields.push("auto_validation".to_string());
    }

    if let Some(agi) = params.auto_generate_invoice {
        new_auto_generate_invoice = agi;
        changed_fields.push("auto_generate_invoice".to_string());
    }

    if let Some(agb) = params.auto_generate_bill {
        new_auto_generate_bill = agb;
        changed_fields.push("auto_generate_bill".to_string());
    }

    if params.journal_id.is_some() {
        new_journal_id = params.journal_id.unwrap();
        changed_fields.push("journal_id".to_string());
    }

    if params.account_id.is_some() {
        new_account_id = params.account_id.unwrap();
        changed_fields.push("account_id".to_string());
    }

    if params.pricelist_id.is_some() {
        new_pricelist_id = params.pricelist_id.unwrap();
        changed_fields.push("pricelist_id".to_string());
    }

    if let Some(seq) = params.sequence {
        new_sequence = seq;
        changed_fields.push("sequence".to_string());
    }

    if let Some(active) = params.is_active {
        new_is_active = active;
        changed_fields.push("is_active".to_string());
    }

    if params.notes.is_some() {
        new_notes = params.notes.unwrap();
        changed_fields.push("notes".to_string());
    }

    if let Some(m) = params.metadata {
        new_metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    ctx.db.intercompany_rule().id().update(IntercompanyRule {
        name: new_name,
        auto_validation: new_auto_validation,
        auto_generate_invoice: new_auto_generate_invoice,
        auto_generate_bill: new_auto_generate_bill,
        journal_id: new_journal_id,
        account_id: new_account_id,
        pricelist_id: new_pricelist_id,
        sequence: new_sequence,
        is_active: new_is_active,
        notes: new_notes,
        metadata: new_metadata,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..rule
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "intercompany_rule",
            record_id: rule_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_intercompany_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_rule", "delete")?;

    let rule = ctx
        .db
        .intercompany_rule()
        .id()
        .find(&rule_id)
        .ok_or("Intercompany rule not found")?;

    if rule.source_company_id != company_id && rule.destination_company_id != company_id {
        return Err("Rule does not belong to this company".to_string());
    }

    ctx.db.intercompany_rule().id().delete(&rule_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "intercompany_rule",
            record_id: rule_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": rule.name }).to_string()),
            new_values: None,
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    origin_company_id: u64,
    params: CreateIntercompanyTransactionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "create")?;

    if origin_company_id == params.destination_company_id {
        return Err("Origin and destination companies must be different".to_string());
    }

    if params.origin_document_model.is_empty() {
        return Err("Document model is required".to_string());
    }

    let rule = ctx
        .db
        .intercompany_rule()
        .intercompany_rule_by_source()
        .filter(&origin_company_id)
        .filter(|r| {
            r.destination_company_id == params.destination_company_id
                && r.rule_type == params.transaction_type
                && r.is_active
        })
        .min_by_key(|r| r.sequence);

    if rule.is_none() && params.requires_approval {
        return Err(
            "No active intercompany rule found for this transaction type between companies"
                .to_string(),
        );
    }

    let initial_state = if params.auto_process && !params.requires_approval {
        IntercompanyState::Processing
    } else {
        IntercompanyState::Draft
    };

    let transaction_name = format!(
        "{}-{}-{}",
        params.origin_document_model, params.origin_document_id, ctx.timestamp
    );

    let transaction = ctx
        .db
        .intercompany_transaction()
        .insert(IntercompanyTransaction {
            id: 0,
            name: transaction_name,
            origin_company_id,
            destination_company_id: params.destination_company_id,
            origin_document_id: params.origin_document_id,
            origin_document_model: params.origin_document_model,
            destination_document_id: None,
            destination_document_model: None,
            amount: params.amount,
            currency_id: params.currency_id,
            state: initial_state,
            transaction_type: params.transaction_type,
            notes: params.notes,
            created_by: Some(ctx.sender()),
            created_at: ctx.timestamp,
            processed_at: None,
            processed_by: None,
            error_message: None,
            auto_process: params.auto_process,
            requires_approval: params.requires_approval,
            approved_by: None,
            approved_at: None,
            metadata: params.metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(origin_company_id),
            table_name: "intercompany_transaction",
            record_id: transaction.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "origin_company_id": origin_company_id,
                    "destination_company_id": params.destination_company_id,
                    "origin_document_id": params.origin_document_id,
                    "amount": params.amount
                })
                .to_string(),
            ),
            changed_fields: vec![
                "origin_company_id".to_string(),
                "destination_company_id".to_string(),
                "origin_document_id".to_string(),
                "amount".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn approve_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let transaction = ctx
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

    ctx.db
        .intercompany_transaction()
        .id()
        .update(IntercompanyTransaction {
            state: IntercompanyState::Approved,
            approved_by: Some(ctx.sender()),
            approved_at: Some(ctx.timestamp),
            processed_by: Some(ctx.sender()),
            ..transaction
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "intercompany_transaction",
            record_id: transaction_id,
            action: "APPROVE",
            old_values: Some(serde_json::json!({ "state": "Draft" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Approved" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn process_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
    params: ProcessIntercompanyTransactionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let transaction = ctx
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

    ctx.db
        .intercompany_transaction()
        .id()
        .update(IntercompanyTransaction {
            state: IntercompanyState::Processing,
            destination_document_id: Some(params.destination_document_id),
            destination_document_model: Some(params.destination_document_model.clone()),
            processed_by: Some(ctx.sender()),
            ..transaction
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "intercompany_transaction",
            record_id: transaction_id,
            action: "PROCESS",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "destination_document_id": params.destination_document_id,
                    "destination_document_model": params.destination_document_model
                })
                .to_string(),
            ),
            changed_fields: vec![
                "destination_document_id".to_string(),
                "destination_document_model".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn complete_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let transaction = ctx
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

    ctx.db
        .intercompany_transaction()
        .id()
        .update(IntercompanyTransaction {
            state: IntercompanyState::Completed,
            processed_at: Some(ctx.timestamp),
            ..transaction
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "intercompany_transaction",
            record_id: transaction_id,
            action: "COMPLETE",
            old_values: Some(serde_json::json!({ "state": "Processing" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Completed" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn error_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
    params: ErrorIntercompanyTransactionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let transaction = ctx
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

    ctx.db
        .intercompany_transaction()
        .id()
        .update(IntercompanyTransaction {
            state: IntercompanyState::Error,
            error_message: Some(params.error_message.clone()),
            ..transaction
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "intercompany_transaction",
            record_id: transaction_id,
            action: "ERROR",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "error_message": params.error_message }).to_string(),
            ),
            changed_fields: vec!["state".to_string(), "error_message".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn cancel_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
    params: CancelIntercompanyTransactionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let transaction = ctx
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

    let updated_notes = Some(format!(
        "{}\nCancellation reason: {}",
        transaction.notes.unwrap_or_default(),
        params.reason
    ));

    ctx.db
        .intercompany_transaction()
        .id()
        .update(IntercompanyTransaction {
            state: IntercompanyState::Cancelled,
            notes: updated_notes,
            ..transaction
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "intercompany_transaction",
            record_id: transaction_id,
            action: "CANCEL",
            old_values: None,
            new_values: Some(serde_json::json!({ "reason": params.reason }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn retry_intercompany_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    transaction_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_transaction", "write")?;

    let transaction = ctx
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

    ctx.db
        .intercompany_transaction()
        .id()
        .update(IntercompanyTransaction {
            state: IntercompanyState::Pending,
            error_message: None,
            processed_by: Some(ctx.sender()),
            ..transaction
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "intercompany_transaction",
            record_id: transaction_id,
            action: "RETRY",
            old_values: Some(serde_json::json!({ "state": "Error" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Pending" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn set_intercompany_rule_active(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule_id: u64,
    is_active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "intercompany_rule", "write")?;

    let rule = ctx
        .db
        .intercompany_rule()
        .id()
        .find(&rule_id)
        .ok_or("Intercompany rule not found")?;

    if rule.source_company_id != company_id && rule.destination_company_id != company_id {
        return Err("Rule does not belong to this company".to_string());
    }

    ctx.db.intercompany_rule().id().update(IntercompanyRule {
        is_active,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..rule
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "intercompany_rule",
            record_id: rule_id,
            action: "SET_ACTIVE",
            old_values: None,
            new_values: Some(serde_json::json!({ "is_active": is_active }).to_string()),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
