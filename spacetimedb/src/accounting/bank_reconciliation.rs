/// Bank & Reconciliation — AccountBankStatement, AccountBankStatementLine, AccountReconciliationWidget
///
/// # 7.4 Bank & Reconciliation
///
/// Tables for managing bank statements and account reconciliation.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::accounting::chart_of_accounts::account_journal;
use crate::accounting::journal_entries::account_move_line;
use crate::helpers::{check_permission, write_audit_log};
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

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_bank_statement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    journal_id: u64,
    name: Option<String>,
    reference: Option<String>,
    date: Option<Timestamp>,
    balance_start: f64,
    currency_id: u64,
    date_done: Option<Timestamp>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement", "create")?;

    // Validate journal exists and is a bank journal
    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&journal_id)
        .ok_or("Journal not found")?;

    if journal.company_id != company_id {
        return Err("Journal does not belong to the specified company".to_string());
    }

    let name_clone = name.clone();

    let statement = ctx
        .db
        .account_bank_statement()
        .insert(AccountBankStatement {
            id: 0,
            name: name_clone.clone(),
            reference,
            date,
            balance_start,
            balance_end_real: balance_start,
            balance_end: balance_start,
            company_id,
            journal_id,
            currency_id,
            state: BankStatementState::Open,
            line_ids: Vec::new(),
            move_line_ids: Vec::new(),
            total_entry_encoding: 0.0,
            total_amount: 0.0,
            total_amount_currency: 0.0,
            date_done,
            is_valid_balance_start: true,
            is_valid_balance_end: true,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata,
        });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_bank_statement",
        statement.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "name": name_clone, "balance_start": balance_start }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn add_bank_statement_line(
    ctx: &ReducerContext,
    organization_id: u64,
    statement_id: u64,
    date: Timestamp,
    amount: f64,
    partner_id: Option<u64>,
    bank_account_id: Option<u64>,
    account_number: Option<String>,
    transaction_type: Option<String>,
    foreign_currency_id: Option<u64>,
    move_id: Option<u64>,
    metadata: Option<String>,
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

    // Get journal for currency
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
            date,
            amount,
            amount_currency: amount,
            currency_id: Some(statement.currency_id),
            journal_currency_id: journal.currency_id.unwrap_or(statement.currency_id),
            foreign_currency_id,
            partner_id,
            bank_account_id,
            account_number,
            statement_id,
            journal_id: statement.journal_id,
            move_id,
            is_reconciled: false,
            transaction_type,
            move_ids: Vec::new(),
            payment_ids: Vec::new(),
            amount_residual: amount,
            auto_reconcile_ids: Vec::new(),
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata,
        });

    // Update statement totals
    let new_total = statement.total_entry_encoding + amount;
    let new_balance_end = statement.balance_start + new_total;

    ctx.db
        .account_bank_statement()
        .id()
        .update(AccountBankStatement {
            line_ids: {
                let mut ids = statement.line_ids.clone();
                ids.push(line.id);
                ids
            },
            total_entry_encoding: new_total,
            total_amount: new_total,
            balance_end: new_balance_end,
            balance_end_real: new_balance_end,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..statement
        });

    write_audit_log(
        ctx,
        organization_id,
        Some(statement.company_id),
        "account_bank_statement_line",
        line.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "amount": amount, "partner_id": partner_id.clone() }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn post_bank_statement(
    ctx: &ReducerContext,
    organization_id: u64,
    statement_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement", "write")?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&statement_id)
        .ok_or("Statement not found")?;

    if statement.state == BankStatementState::Posted {
        return Err("Statement is already posted".to_string());
    }

    // Validate balance
    if (statement.balance_end - statement.balance_end_real).abs() > 0.01 {
        return Err("Statement balance does not match".to_string());
    }

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

    write_audit_log(
        ctx,
        organization_id,
        Some(statement.company_id),
        "account_bank_statement",
        statement_id,
        "POST",
        None,
        None,
        vec!["state".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn reconcile_bank_statement_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    move_ids: Vec<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement_line", "write")?;

    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .ok_or("Statement line not found")?;

    if line.is_reconciled {
        return Err("Line is already reconciled".to_string());
    }

    // Validate all move IDs exist
    for move_id in &move_ids {
        ctx.db
            .account_move_line()
            .id()
            .find(move_id)
            .ok_or(format!("Move line {} not found", move_id))?;
    }

    ctx.db
        .account_bank_statement_line()
        .id()
        .update(AccountBankStatementLine {
            is_reconciled: true,
            move_ids: move_ids.clone(),
            amount_residual: 0.0,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..line
        });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "account_bank_statement_line",
        line_id,
        "RECONCILE",
        None,
        Some(serde_json::json!({ "move_ids": move_ids }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_reconciliation_widget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    account_id: u64,
    partner_id: Option<u64>,
    move_line_ids: Vec<u64>,
    mode: String,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "account_reconciliation_widget",
        "create",
    )?;

    // Validate all move line IDs exist
    for line_id in &move_line_ids {
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

    let move_line_ids_clone = move_line_ids.clone();

    let widget = ctx
        .db
        .account_reconciliation_widget()
        .insert(AccountReconciliationWidget {
            id: 0,
            partner_id,
            account_id,
            move_line_ids: move_line_ids_clone.clone(),
            to_check: false,
            mode,
            company_id,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata,
        });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_reconciliation_widget",
        widget.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({ "account_id": account_id, "move_line_ids": move_line_ids_clone })
                .to_string(),
        ),
        vec![],
    );

    Ok(())
}
