/// Bank & Reconciliation — AccountBankStatement, AccountBankStatementLine, AccountReconciliationWidget
///
/// # 7.4 Bank & Reconciliation
///
/// Tables for managing bank statements and account reconciliation.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::account_journal;
use crate::accounting::journal_entries::{account_move_line, AccountMoveLine};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::BankStatementState;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_bank_statement,
    public,
    index(accessor = statement_by_journal, btree(columns = [journal_id])),
    index(accessor = statement_by_state, btree(columns = [state])),
    index(accessor = statement_by_date, btree(columns = [date]))
)]
pub struct AccountBankStatement {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: Option<String>,
    pub reference: Option<String>,
    pub date: Option<Timestamp>,
    pub balance_start: f64,
    pub balance_end_real: f64,
    pub balance_end: f64,
    pub company_id: u64,
    pub journal_id: u64,
    pub currency_id: u64,
    pub state: BankStatementState,
    pub line_ids: Vec<u64>,
    pub move_line_ids: Vec<u64>,
    pub total_entry_encoding: f64,
    pub total_amount: f64,
    pub total_amount_currency: f64,
    pub date_done: Option<Timestamp>,
    pub is_valid_balance_start: bool,
    pub is_valid_balance_end: bool,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_bank_statement_line,
    public,
    index(accessor = statement_line_by_statement, btree(columns = [statement_id])),
    index(accessor = statement_line_by_partner, btree(columns = [partner_id])),
    index(accessor = statement_line_by_date, btree(columns = [date])),
    index(accessor = statement_line_by_reconcile, btree(columns = [is_reconciled]))
)]
pub struct AccountBankStatementLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub date: Timestamp,
    pub amount: f64,
    pub amount_currency: f64,
    pub currency_id: Option<u64>,
    pub journal_currency_id: u64,
    pub foreign_currency_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub bank_account_id: Option<u64>,
    pub account_number: Option<String>,
    pub statement_id: u64,
    pub journal_id: u64,
    pub move_id: Option<u64>,
    pub is_reconciled: bool,
    pub transaction_type: Option<String>,
    pub move_ids: Vec<u64>,
    pub payment_ids: Vec<u64>,
    pub amount_residual: f64,
    pub auto_reconcile_ids: Vec<u64>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_reconciliation_widget,
    public,
    index(accessor = reconciliation_by_partner, btree(columns = [partner_id])),
    index(accessor = reconciliation_by_account, btree(columns = [account_id]))
)]
pub struct AccountReconciliationWidget {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub partner_id: Option<u64>,
    pub account_id: u64,
    pub move_line_ids: Vec<u64>,
    pub to_check: bool,
    pub mode: String,
    pub company_id: u64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = bank_match_candidate,
    public,
    index(accessor = candidate_by_statement_line, btree(columns = [statement_line_id])),
    index(accessor = candidate_by_entity, btree(columns = [entity_id]))
)]
pub struct BankMatchCandidate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub statement_line_id: u64,
    pub match_type: String, // "invoice" | "payment"
    pub entity_id: u64,
    pub amount: f64,
    pub rule_id: Option<u64>,
    pub score: u32, // confidence 0-100
    pub created_at: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountBankStatementParams {
    pub name: Option<String>,
    pub reference: Option<String>,
    pub date: Option<Timestamp>,
    pub balance_start: f64,
    pub currency_id: u64,
    pub state: BankStatementState,
    pub line_ids: Vec<u64>,
    pub move_line_ids: Vec<u64>,
    pub total_entry_encoding: f64,
    pub total_amount: f64,
    pub total_amount_currency: f64,
    pub date_done: Option<Timestamp>,
    pub is_valid_balance_start: bool,
    pub is_valid_balance_end: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountBankStatementParams {
    pub name: Option<Option<String>>,
    pub reference: Option<Option<String>>,
    pub date: Option<Option<Timestamp>>,
    pub balance_start: Option<f64>,
    pub balance_end_real: Option<f64>,
    pub balance_end: Option<f64>,
    pub currency_id: Option<u64>,
    pub state: Option<BankStatementState>,
    pub line_ids: Option<Vec<u64>>,
    pub move_line_ids: Option<Vec<u64>>,
    pub total_entry_encoding: Option<f64>,
    pub total_amount: Option<f64>,
    pub total_amount_currency: Option<f64>,
    pub date_done: Option<Option<Timestamp>>,
    pub is_valid_balance_start: Option<bool>,
    pub is_valid_balance_end: Option<bool>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountBankStatementLineParams {
    pub date: Timestamp,
    pub amount: f64,
    pub amount_currency: f64,
    pub currency_id: Option<u64>,
    pub foreign_currency_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub bank_account_id: Option<u64>,
    pub account_number: Option<String>,
    pub move_id: Option<u64>,
    pub is_reconciled: bool,
    pub transaction_type: Option<String>,
    pub move_ids: Vec<u64>,
    pub payment_ids: Vec<u64>,
    pub amount_residual: f64,
    pub auto_reconcile_ids: Vec<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountBankStatementLineParams {
    pub date: Option<Timestamp>,
    pub amount: Option<f64>,
    pub amount_currency: Option<f64>,
    pub currency_id: Option<Option<u64>>,
    pub foreign_currency_id: Option<Option<u64>>,
    pub partner_id: Option<Option<u64>>,
    pub bank_account_id: Option<Option<u64>>,
    pub account_number: Option<Option<String>>,
    pub move_id: Option<Option<u64>>,
    pub is_reconciled: Option<bool>,
    pub transaction_type: Option<Option<String>>,
    pub move_ids: Option<Vec<u64>>,
    pub payment_ids: Option<Vec<u64>>,
    pub amount_residual: Option<f64>,
    pub auto_reconcile_ids: Option<Vec<u64>>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountReconciliationWidgetParams {
    pub partner_id: Option<u64>,
    pub account_id: u64,
    pub move_line_ids: Vec<u64>,
    pub to_check: bool,
    pub mode: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountReconciliationWidgetParams {
    pub partner_id: Option<Option<u64>>,
    pub account_id: Option<u64>,
    pub move_line_ids: Option<Vec<u64>>,
    pub to_check: Option<bool>,
    pub mode: Option<String>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReconcileAccountBankStatementLineParams {
    pub move_ids: Vec<u64>,
    pub amount_residual: f64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UnreconcileAccountBankStatementLineParams {
    pub move_ids: Vec<u64>,
    pub amount_residual: f64,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_account_bank_statement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    journal_id: u64,
    params: CreateAccountBankStatementParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement", "create")?;

    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&journal_id)
        .ok_or("Journal not found")?;

    if journal.company_id != company_id {
        return Err("Journal does not belong to the specified company".to_string());
    }

    let statement = ctx
        .db
        .account_bank_statement()
        .insert(AccountBankStatement {
            id: 0,
            name: params.name,
            reference: params.reference,
            date: params.date,
            balance_start: params.balance_start,
            balance_end_real: params.balance_start + params.total_entry_encoding,
            balance_end: params.balance_start + params.total_amount,
            company_id,
            journal_id,
            currency_id: params.currency_id,
            state: params.state,
            line_ids: params.line_ids,
            move_line_ids: params.move_line_ids,
            total_entry_encoding: params.total_entry_encoding,
            total_amount: params.total_amount,
            total_amount_currency: params.total_amount_currency,
            date_done: params.date_done,
            is_valid_balance_start: params.is_valid_balance_start,
            is_valid_balance_end: params.is_valid_balance_end,
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
            company_id: Some(company_id),
            table_name: "account_bank_statement",
            record_id: statement.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": statement.name,
                    "balance_start": statement.balance_start,
                    "company_id": company_id,
                    "journal_id": journal_id
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "balance_start".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_bank_statement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    statement_id: u64,
    params: UpdateAccountBankStatementParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement", "write")?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&statement_id)
        .ok_or("Statement not found")?;

    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let old_name = statement.name.clone();
    let old_reference = statement.reference.clone();
    let old_balance_start = statement.balance_start;
    let old_state = statement.state.clone();

    let old_values = serde_json::json!({
        "name": old_name,
        "reference": old_reference,
        "balance_start": old_balance_start,
        "state": format!("{:?}", old_state),
    });

    let new_name = params.name.unwrap_or_else(|| statement.name.clone());
    let new_reference = params
        .reference
        .unwrap_or_else(|| statement.reference.clone());
    let new_date = params.date.unwrap_or(statement.date);
    let new_balance_start = params.balance_start.unwrap_or(statement.balance_start);
    let new_balance_end_real = params
        .balance_end_real
        .unwrap_or(statement.balance_end_real);
    let new_balance_end = params.balance_end.unwrap_or(statement.balance_end);
    let new_currency_id = params.currency_id.unwrap_or(statement.currency_id);
    let new_state = params.state.unwrap_or(statement.state);
    let new_line_ids = params.line_ids.unwrap_or(statement.line_ids);
    let new_move_line_ids = params.move_line_ids.unwrap_or(statement.move_line_ids);
    let new_total_entry_encoding = params
        .total_entry_encoding
        .unwrap_or(statement.total_entry_encoding);
    let new_total_amount = params.total_amount.unwrap_or(statement.total_amount);
    let new_total_amount_currency = params
        .total_amount_currency
        .unwrap_or(statement.total_amount_currency);
    let new_date_done = params.date_done.unwrap_or(statement.date_done);
    let new_is_valid_balance_start = params
        .is_valid_balance_start
        .unwrap_or(statement.is_valid_balance_start);
    let new_is_valid_balance_end = params
        .is_valid_balance_end
        .unwrap_or(statement.is_valid_balance_end);
    let new_metadata = params.metadata.unwrap_or(statement.metadata);

    let mut changed_fields = Vec::new();

    if new_name != old_name {
        changed_fields.push("name".to_string());
    }
    if new_reference != old_reference {
        changed_fields.push("reference".to_string());
    }
    if new_balance_start != old_balance_start {
        changed_fields.push("balance_start".to_string());
    }
    if new_state != old_state {
        changed_fields.push("state".to_string());
    }

    let new_values_for_audit = serde_json::json!({
        "name": new_name,
        "reference": new_reference,
        "balance_start": new_balance_start,
        "state": format!("{:?}", new_state),
    });

    ctx.db
        .account_bank_statement()
        .id()
        .update(AccountBankStatement {
            id: statement.id,
            name: new_name,
            reference: new_reference,
            date: new_date,
            balance_start: new_balance_start,
            balance_end_real: new_balance_end_real,
            balance_end: new_balance_end,
            company_id: statement.company_id,
            journal_id: statement.journal_id,
            currency_id: new_currency_id,
            state: new_state,
            line_ids: new_line_ids,
            move_line_ids: new_move_line_ids,
            total_entry_encoding: new_total_entry_encoding,
            total_amount: new_total_amount,
            total_amount_currency: new_total_amount_currency,
            date_done: new_date_done,
            is_valid_balance_start: new_is_valid_balance_start,
            is_valid_balance_end: new_is_valid_balance_end,
            create_uid: statement.create_uid,
            create_date: statement.create_date,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: new_metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_bank_statement",
            record_id: statement_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some(new_values_for_audit.to_string()),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_account_bank_statement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    statement_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement", "delete")?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&statement_id)
        .ok_or("Statement not found")?;

    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if statement.state == BankStatementState::Posted {
        return Err("Cannot delete a posted statement".to_string());
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_bank_statement",
            record_id: statement_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "name": statement.name,
                    "reference": statement.reference,
                    "balance_start": statement.balance_start
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    ctx.db.account_bank_statement().id().delete(&statement_id);

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_bank_statement_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    statement_id: u64,
    params: CreateAccountBankStatementLineParams,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "account_bank_statement_line",
        "create",
    )?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&statement_id)
        .ok_or("Statement not found")?;

    if statement.state == BankStatementState::Posted {
        return Err("Cannot add lines to a posted statement".to_string());
    }

    if statement.company_id != company_id {
        return Err("Statement does not belong to this company".to_string());
    }

    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&statement.journal_id)
        .ok_or("Journal not found")?;

    let line = ctx
        .db
        .account_bank_statement_line()
        .insert(AccountBankStatementLine {
            id: 0,
            date: params.date,
            amount: params.amount,
            amount_currency: params.amount_currency,
            currency_id: params.currency_id,
            journal_currency_id: journal.currency_id.unwrap_or(statement.currency_id),
            foreign_currency_id: params.foreign_currency_id,
            partner_id: params.partner_id,
            bank_account_id: params.bank_account_id,
            account_number: params.account_number,
            statement_id,
            journal_id: statement.journal_id,
            move_id: params.move_id,
            is_reconciled: params.is_reconciled,
            transaction_type: params.transaction_type,
            move_ids: params.move_ids,
            payment_ids: params.payment_ids,
            amount_residual: params.amount_residual,
            auto_reconcile_ids: params.auto_reconcile_ids,
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
            company_id: Some(company_id),
            table_name: "account_bank_statement_line",
            record_id: line.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "statement_id": statement_id,
                    "amount": line.amount,
                    "partner_id": line.partner_id
                })
                .to_string(),
            ),
            changed_fields: vec!["amount".to_string(), "partner_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_bank_statement_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: UpdateAccountBankStatementLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement_line", "write")?;

    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .ok_or("Statement line not found")?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&line.statement_id)
        .ok_or("Parent statement not found")?;

    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let old_amount = line.amount;
    let old_partner_id = line.partner_id.clone();
    let old_is_reconciled = line.is_reconciled;

    let old_values = serde_json::json!({
        "amount": old_amount,
        "partner_id": old_partner_id,
        "is_reconciled": old_is_reconciled,
    });

    let new_date = params.date.unwrap_or(line.date);
    let new_amount = params.amount.unwrap_or(line.amount);
    let new_amount_currency = params.amount_currency.unwrap_or(line.amount_currency);
    let new_currency_id = params
        .currency_id
        .unwrap_or_else(|| line.currency_id.clone());
    let new_foreign_currency_id = params
        .foreign_currency_id
        .unwrap_or_else(|| line.foreign_currency_id.clone());
    let new_partner_id = params.partner_id.unwrap_or_else(|| line.partner_id.clone());
    let new_bank_account_id = params
        .bank_account_id
        .unwrap_or_else(|| line.bank_account_id.clone());
    let new_account_number = params
        .account_number
        .unwrap_or_else(|| line.account_number.clone());
    let new_move_id = params.move_id.unwrap_or_else(|| line.move_id.clone());
    let new_is_reconciled = params.is_reconciled.unwrap_or(line.is_reconciled);
    let new_transaction_type = params
        .transaction_type
        .unwrap_or_else(|| line.transaction_type.clone());
    let new_move_ids = params.move_ids.unwrap_or(line.move_ids);
    let new_payment_ids = params.payment_ids.unwrap_or(line.payment_ids);
    let new_amount_residual = params.amount_residual.unwrap_or(line.amount_residual);
    let new_auto_reconcile_ids = params.auto_reconcile_ids.unwrap_or(line.auto_reconcile_ids);
    let new_metadata = params.metadata.unwrap_or_else(|| line.metadata.clone());

    let mut changed_fields = Vec::new();

    if new_amount != old_amount {
        changed_fields.push("amount".to_string());
    }
    if new_partner_id != old_partner_id {
        changed_fields.push("partner_id".to_string());
    }
    if new_is_reconciled != old_is_reconciled {
        changed_fields.push("is_reconciled".to_string());
    }

    ctx.db
        .account_bank_statement_line()
        .id()
        .update(AccountBankStatementLine {
            id: line.id,
            date: new_date,
            amount: new_amount,
            amount_currency: new_amount_currency,
            currency_id: new_currency_id,
            journal_currency_id: line.journal_currency_id,
            foreign_currency_id: new_foreign_currency_id,
            partner_id: new_partner_id.clone(),
            bank_account_id: new_bank_account_id,
            account_number: new_account_number,
            statement_id: line.statement_id,
            journal_id: line.journal_id,
            move_id: new_move_id,
            is_reconciled: new_is_reconciled,
            transaction_type: new_transaction_type,
            move_ids: new_move_ids,
            payment_ids: new_payment_ids,
            amount_residual: new_amount_residual,
            auto_reconcile_ids: new_auto_reconcile_ids,
            create_uid: line.create_uid,
            create_date: line.create_date,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: new_metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_bank_statement_line",
            record_id: line_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some(
                serde_json::json!({
                    "amount": new_amount,
                    "partner_id": new_partner_id,
                    "is_reconciled": new_is_reconciled,
                })
                .to_string(),
            ),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_account_bank_statement_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "account_bank_statement_line",
        "delete",
    )?;

    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .ok_or("Statement line not found")?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&line.statement_id)
        .ok_or("Parent statement not found")?;

    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if statement.state == BankStatementState::Posted {
        return Err("Cannot delete lines from a posted statement".to_string());
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_bank_statement_line",
            record_id: line_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "statement_id": line.statement_id,
                    "amount": line.amount,
                    "partner_id": line.partner_id
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    ctx.db.account_bank_statement_line().id().delete(&line_id);

    Ok(())
}

#[spacetimedb::reducer]
pub fn post_account_bank_statement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    statement_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement", "write")?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&statement_id)
        .ok_or("Statement not found")?;

    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if statement.state == BankStatementState::Posted {
        return Err("Statement is already posted".to_string());
    }

    if (statement.balance_end - statement.balance_end_real).abs() > 0.01 {
        return Err("Statement balance does not match".to_string());
    }

    let old_state = format!("{:?}", statement.state);

    ctx.db
        .account_bank_statement()
        .id()
        .update(AccountBankStatement {
            state: BankStatementState::Posted,
            date_done: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..statement
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_bank_statement",
            record_id: statement_id,
            action: "POST",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(
                serde_json::json!({ "state": "Posted", "date_done": "now" }).to_string(),
            ),
            changed_fields: vec!["state".to_string(), "date_done".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn reconcile_account_bank_statement_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: ReconcileAccountBankStatementLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement_line", "write")?;

    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .ok_or("Statement line not found")?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&line.statement_id)
        .ok_or("Parent statement not found")?;

    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if line.is_reconciled {
        return Err("Line is already reconciled".to_string());
    }

    for move_id in &params.move_ids {
        ctx.db
            .account_move_line()
            .id()
            .find(move_id)
            .ok_or(format!("Move line {} not found", move_id))?;
    }

    let is_reconciled = params.amount_residual.abs() < 0.01;

    let old_values = serde_json::json!({
        "is_reconciled": line.is_reconciled,
        "move_ids": line.move_ids,
        "amount_residual": line.amount_residual,
    });

    ctx.db
        .account_bank_statement_line()
        .id()
        .update(AccountBankStatementLine {
            is_reconciled,
            move_ids: params.move_ids.clone(),
            amount_residual: params.amount_residual,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..line
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_bank_statement_line",
            record_id: line_id,
            action: "RECONCILE",
            old_values: Some(old_values.to_string()),
            new_values: Some(
                serde_json::json!({
                    "is_reconciled": is_reconciled,
                    "move_ids": params.move_ids,
                    "amount_residual": params.amount_residual
                })
                .to_string(),
            ),
            changed_fields: vec![
                "is_reconciled".to_string(),
                "move_ids".to_string(),
                "amount_residual".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn unreconciled_account_bank_statement_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: UnreconcileAccountBankStatementLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement_line", "write")?;

    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .ok_or("Statement line not found")?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&line.statement_id)
        .ok_or("Parent statement not found")?;

    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if !line.is_reconciled {
        return Err("Line is not reconciled".to_string());
    }

    let old_values = serde_json::json!({
        "is_reconciled": line.is_reconciled,
        "move_ids": line.move_ids,
        "amount_residual": line.amount_residual,
    });

    let is_reconciled = params.amount_residual.abs() > 0.01;
    let move_ids = params.move_ids;
    let amount_residual = params.amount_residual;

    ctx.db
        .account_bank_statement_line()
        .id()
        .update(AccountBankStatementLine {
            is_reconciled,
            move_ids: move_ids.clone(),
            amount_residual,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..line
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_bank_statement_line",
            record_id: line_id,
            action: "UNRECONCILE",
            old_values: Some(old_values.to_string()),
            new_values: Some(
                serde_json::json!({
                    "is_reconciled": is_reconciled,
                    "move_ids": move_ids,
                    "amount_residual": amount_residual
                })
                .to_string(),
            ),
            changed_fields: vec![
                "is_reconciled".to_string(),
                "move_ids".to_string(),
                "amount_residual".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_reconciliation_widget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateAccountReconciliationWidgetParams,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "account_reconciliation_widget",
        "create",
    )?;

    for line_id in &params.move_line_ids {
        let line = ctx
            .db
            .account_move_line()
            .id()
            .find(line_id)
            .ok_or(format!("Move line {} not found", line_id))?;

        if line.company_id != company_id {
            return Err(format!(
                "Move line {} does not belong to the specified company",
                line_id
            ));
        }
    }

    let widget = ctx
        .db
        .account_reconciliation_widget()
        .insert(AccountReconciliationWidget {
            id: 0,
            partner_id: params.partner_id,
            account_id: params.account_id,
            move_line_ids: params.move_line_ids.clone(),
            to_check: params.to_check,
            mode: params.mode,
            company_id,
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
            company_id: Some(company_id),
            table_name: "account_reconciliation_widget",
            record_id: widget.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "account_id": widget.account_id,
                    "move_line_ids": widget.move_line_ids,
                    "company_id": company_id
                })
                .to_string(),
            ),
            changed_fields: vec!["account_id".to_string(), "move_line_ids".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_reconciliation_widget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    widget_id: u64,
    params: UpdateAccountReconciliationWidgetParams,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "account_reconciliation_widget",
        "write",
    )?;

    let widget = ctx
        .db
        .account_reconciliation_widget()
        .id()
        .find(&widget_id)
        .ok_or("Widget not found")?;

    if widget.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let old_account_id = widget.account_id;
    let old_move_line_ids = widget.move_line_ids.clone();
    let old_to_check = widget.to_check;

    let old_values = serde_json::json!({
        "account_id": old_account_id,
        "move_line_ids": old_move_line_ids.clone(),
        "to_check": old_to_check,
    });

    let new_partner_id = params
        .partner_id
        .unwrap_or_else(|| widget.partner_id.clone());
    let new_account_id = params.account_id.unwrap_or(widget.account_id);
    let new_move_line_ids = params.move_line_ids.unwrap_or(widget.move_line_ids);
    let new_to_check = params.to_check.unwrap_or(widget.to_check);
    let new_mode = params.mode.unwrap_or_else(|| widget.mode.clone());
    let new_metadata = params.metadata.unwrap_or_else(|| widget.metadata.clone());

    let mut changed_fields = Vec::new();

    if new_account_id != old_account_id {
        changed_fields.push("account_id".to_string());
    }
    if new_move_line_ids != old_move_line_ids {
        changed_fields.push("move_line_ids".to_string());
    }
    if new_to_check != old_to_check {
        changed_fields.push("to_check".to_string());
    }

    ctx.db
        .account_reconciliation_widget()
        .id()
        .update(AccountReconciliationWidget {
            id: widget.id,
            partner_id: new_partner_id,
            account_id: new_account_id,
            move_line_ids: new_move_line_ids.clone(),
            to_check: new_to_check,
            mode: new_mode,
            company_id: widget.company_id,
            create_uid: widget.create_uid,
            create_date: widget.create_date,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: new_metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_reconciliation_widget",
            record_id: widget_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some(
                serde_json::json!({
                    "account_id": new_account_id,
                    "move_line_ids": new_move_line_ids,
                    "to_check": new_to_check,
                })
                .to_string(),
            ),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_account_reconciliation_widget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    widget_id: u64,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "account_reconciliation_widget",
        "delete",
    )?;

    let widget = ctx
        .db
        .account_reconciliation_widget()
        .id()
        .find(&widget_id)
        .ok_or("Widget not found")?;

    if widget.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_reconciliation_widget",
            record_id: widget_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "account_id": widget.account_id,
                    "move_line_ids": widget.move_line_ids
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    ctx.db
        .account_reconciliation_widget()
        .id()
        .delete(&widget_id);

    Ok(())
}

// ── Reconciliation Rule Reducers ─────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn apply_reconciliation_rules(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    rule_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "bank_match_candidate", "create")?;

    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .ok_or("Statement line not found")?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&line.statement_id)
        .ok_or("Parent statement not found")?;

    for existing in ctx
        .db
        .bank_match_candidate()
        .candidate_by_statement_line()
        .filter(&line_id)
    {
        ctx.db.bank_match_candidate().id().delete(&existing.id);
    }

    match_by_exact_amount(
        ctx,
        organization_id,
        line_id,
        rule_id,
        line.amount,
        statement.company_id,
    )?;

    if let Some(partner_id) = line.partner_id {
        match_by_partner(
            ctx,
            organization_id,
            line_id,
            rule_id,
            partner_id,
            line.amount,
            statement.company_id,
        )?;
    }

    if let Some(ref account_number) = line.account_number {
        match_by_reference(
            ctx,
            organization_id,
            line_id,
            rule_id,
            account_number,
            line.amount,
            statement.company_id,
        )?;
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn match_bank_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    rule_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "bank_match_candidate", "create")?;

    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .ok_or("Statement line not found")?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&line.statement_id)
        .ok_or("Parent statement not found")?;

    if line.is_reconciled {
        return Err("Line is already reconciled".to_string());
    }

    for existing in ctx
        .db
        .bank_match_candidate()
        .candidate_by_statement_line()
        .filter(&line_id)
    {
        ctx.db.bank_match_candidate().id().delete(&existing.id);
    }

    let target_amount = line.amount.abs();
    let is_payment = line.amount < 0.0;

    for move_line in ctx.db.account_move_line().iter() {
        if move_line.company_id != statement.company_id {
            continue;
        }

        let move_line_amount = move_line.balance.abs();

        if (move_line_amount - target_amount).abs() <= 0.01 {
            let is_invoice = move_line.account_id > 0;

            if is_invoice {
                let match_type = if is_payment { "payment" } else { "invoice" }.to_string();
                let score = calculate_match_score(&line, &move_line, "amount");

                ctx.db.bank_match_candidate().insert(BankMatchCandidate {
                    id: 0,
                    statement_line_id: line_id,
                    match_type,
                    entity_id: move_line.id,
                    amount: move_line.balance,
                    rule_id,
                    score,
                    created_at: ctx.timestamp,
                });
            }
        }
    }

    Ok(())
}

// ── Helper Functions ─────────────────────────────────────────────────────────
///TODO: should this be scoped to organization_id
fn match_by_exact_amount(
    ctx: &ReducerContext,
    _organization_id: u64,
    line_id: u64,
    rule_id: Option<u64>,
    amount: f64,
    company_id: u64,
) -> Result<(), String> {
    let target_amount = amount.abs();

    for move_line in ctx.db.account_move_line().iter() {
        if move_line.company_id != company_id {
            continue;
        }

        let move_line_amount = move_line.balance.abs();

        if (move_line_amount - target_amount).abs() <= 0.01 {
            let match_type = if amount < 0.0 { "payment" } else { "invoice" }.to_string();

            ctx.db.bank_match_candidate().insert(BankMatchCandidate {
                id: 0,
                statement_line_id: line_id,
                match_type,
                entity_id: move_line.id,
                amount: move_line.balance,
                rule_id,
                score: 90,
                created_at: ctx.timestamp,
            });
        }
    }

    Ok(())
}

///TODO: should this be scoped to organization_id
fn match_by_partner(
    ctx: &ReducerContext,
    _organization_id: u64,
    line_id: u64,
    rule_id: Option<u64>,
    partner_id: u64,
    amount: f64,
    company_id: u64,
) -> Result<(), String> {
    for move_line in ctx.db.account_move_line().iter() {
        if move_line.company_id != company_id {
            continue;
        }

        if let Some(ml_partner_id) = move_line.partner_id {
            if ml_partner_id == partner_id {
                let match_type = if amount < 0.0 { "payment" } else { "invoice" }.to_string();
                let score = calculate_match_score_by_ids(ctx, line_id, &move_line, "partner");

                ctx.db.bank_match_candidate().insert(BankMatchCandidate {
                    id: 0,
                    statement_line_id: line_id,
                    match_type,
                    entity_id: move_line.id,
                    amount: move_line.balance,
                    rule_id,
                    score,
                    created_at: ctx.timestamp,
                });
            }
        }
    }

    Ok(())
}

fn match_by_reference(
    ctx: &ReducerContext,
    _organization_id: u64,
    line_id: u64,
    rule_id: Option<u64>,
    _account_number: &str,
    amount: f64,
    company_id: u64,
) -> Result<(), String> {
    for move_line in ctx.db.account_move_line().iter() {
        if move_line.company_id != company_id {
            continue;
        }

        let match_type = if amount < 0.0 { "payment" } else { "invoice" }.to_string();
        let score = calculate_match_score_by_ids(ctx, line_id, &move_line, "reference");

        if score > 50 {
            ctx.db.bank_match_candidate().insert(BankMatchCandidate {
                id: 0,
                statement_line_id: line_id,
                match_type,
                entity_id: move_line.id,
                amount: move_line.balance,
                rule_id,
                score,
                created_at: ctx.timestamp,
            });
        }
    }

    Ok(())
}

fn calculate_match_score(
    line: &AccountBankStatementLine,
    move_line: &AccountMoveLine,
    match_criteria: &str,
) -> u32 {
    let mut score: u32 = 0;

    let amount_diff = (line.amount.abs() - move_line.balance.abs()).abs();
    if amount_diff <= 0.01 {
        score += 40;
    } else if amount_diff <= 1.0 {
        score += 20;
    }

    if let Some(line_partner) = line.partner_id {
        if let Some(ml_partner) = move_line.partner_id {
            if line_partner == ml_partner {
                score += 30;
            }
        }
    }

    let date_diff = (line
        .date
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs() as i64
        - move_line
            .date
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_secs() as i64)
        .abs();

    if date_diff <= 86400 {
        score += 20;
    } else if date_diff <= 604800 {
        score += 10;
    }

    if match_criteria == "reference" {
        score += 10;
    }

    score.min(100)
}

fn calculate_match_score_by_ids(
    ctx: &ReducerContext,
    line_id: u64,
    move_line: &AccountMoveLine,
    match_criteria: &str,
) -> u32 {
    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .expect("Line should exist");

    calculate_match_score(&line, move_line, match_criteria)
}
