/// Bank & Reconciliation — AccountBankStatement, AccountBankStatementLine, AccountReconciliationWidget
///
/// # 7.4 Bank & Reconciliation
///
/// Tables for managing bank statements and account reconciliation.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::{account_account, account_journal};
use crate::accounting::idempotency::{
    accounting_operation_receipt, record_result, replayed_result,
};
use crate::accounting::journal_entries::{account_move, account_move_line, AccountMoveLine};
use crate::accounting::money::{
    pilot_money_minor_units as settlement_minor_units, validate_pilot_money_amount,
};
use crate::accounting::payments::{
    account_payment, create_payment, post_payment, register_bank_settlement_on_invoices,
    AccountPayment, CreatePaymentParams,
};
use crate::accounting::relations::{require_active_currency_id, require_active_journal};
use crate::core::organization::{company, require_company_in_organization};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{
    AccountMoveState, AccountTypeInternal, BankStatementState, JournalType, MoveType, PartnerType,
    PaymentState, PaymentType,
};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_bank_statement,
    public,
    index(accessor = bank_statement_by_org, btree(columns = [organization_id])),
    index(accessor = statement_by_journal, btree(columns = [journal_id])),
    index(accessor = statement_by_state, btree(columns = [state])),
    index(accessor = statement_by_date, btree(columns = [date]))
)]
pub struct AccountBankStatement {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation — always required
    pub organization_id: u64,
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
    index(accessor = bank_statement_line_by_org, btree(columns = [organization_id])),
    index(accessor = statement_line_by_statement, btree(columns = [statement_id])),
    index(accessor = statement_line_by_partner, btree(columns = [partner_id])),
    index(accessor = statement_line_by_date, btree(columns = [date])),
    index(accessor = statement_line_by_reconcile, btree(columns = [is_reconciled]))
)]
#[derive(Clone)]
pub struct AccountBankStatementLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation — always required
    pub organization_id: u64,
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
    index(accessor = reconciliation_widget_by_org, btree(columns = [organization_id])),
    index(accessor = reconciliation_by_partner, btree(columns = [partner_id])),
    index(accessor = reconciliation_by_account, btree(columns = [account_id]))
)]
pub struct AccountReconciliationWidget {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation — always required
    pub organization_id: u64,
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
    index(accessor = bank_match_candidate_by_org, btree(columns = [organization_id])),
    index(accessor = candidate_by_statement_line, btree(columns = [statement_line_id])),
    index(accessor = candidate_by_entity, btree(columns = [entity_id]))
)]
pub struct BankMatchCandidate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation — always required
    pub organization_id: u64,
    pub statement_line_id: u64,
    pub match_type: String, // "invoice" | "payment"
    pub entity_id: u64,
    pub amount: f64,
    pub rule_id: Option<u64>,
    pub score: u32, // confidence 0-100
    pub created_at: Timestamp,
}

/// An idempotent, reviewable CSV statement import before it becomes an
/// accounting bank statement. Parsed values are stored separately from the raw
/// source values so validation errors can be shown without creating ledger data.
#[spacetimedb::table(
    accessor = bank_statement_import,
    public,
    index(accessor = bank_statement_import_by_org, btree(columns = [organization_id])),
    index(accessor = bank_statement_import_by_company, btree(columns = [company_id])),
    index(accessor = bank_statement_import_by_idempotency, btree(columns = [organization_id, company_id, idempotency_key]))
)]
pub struct BankStatementImport {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub journal_id: u64,
    pub currency_id: u64,
    pub file_name: Option<String>,
    /// Deterministic key generated from the selected account and CSV payload.
    pub idempotency_key: String,
    /// `staged` | `needs_review` | `approved`.
    pub state: String,
    pub opening_balance: f64,
    pub total_rows: u32,
    pub valid_rows: u32,
    pub invalid_rows: u32,
    pub approved_statement_id: Option<u64>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub approved_at: Option<Timestamp>,
    pub approved_by: Option<Identity>,
}

#[spacetimedb::table(
    accessor = bank_statement_import_line,
    public,
    index(accessor = bank_statement_import_line_by_import, btree(columns = [import_id])),
    index(accessor = bank_statement_import_line_by_org, btree(columns = [organization_id]))
)]
pub struct BankStatementImportLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub import_id: u64,
    pub row_number: u32,
    pub date: Option<Timestamp>,
    pub amount: Option<f64>,
    pub reference: Option<String>,
    pub description: Option<String>,
    pub validation_error: Option<String>,
    pub created_statement_line_id: Option<u64>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountBankStatementParams {
    pub name: Option<String>,
    pub reference: Option<String>,
    pub date: Option<Timestamp>,
    pub balance_start: f64,
    pub currency_id: u64,
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

#[derive(SpacetimeType, Clone, Debug)]
pub struct StageBankStatementImportLineParams {
    pub row_number: u32,
    pub date: Option<Timestamp>,
    pub amount: Option<f64>,
    pub reference: Option<String>,
    pub description: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct StageBankStatementImportParams {
    pub file_name: Option<String>,
    pub idempotency_key: String,
    pub opening_balance: f64,
    pub rows: Vec<StageBankStatementImportLineParams>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Stage parsed statement rows for review. Repeating the exact payload for the
/// same company/key is a no-op; reusing the key with different input fails closed.
#[spacetimedb::reducer]
pub fn stage_bank_statement_import(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    journal_id: u64,
    currency_id: u64,
    params: StageBankStatementImportParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement", "create")?;
    if params.idempotency_key.trim().is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    if params.rows.is_empty() {
        return Err("statement import must contain at least one row".to_string());
    }
    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&journal_id)
        .ok_or("Journal not found")?;
    if journal.company_id != company_id {
        return Err("Journal does not belong to the specified company".to_string());
    }

    let payload_fingerprint =
        format!("journal_id={journal_id};currency_id={currency_id};params={params:?}");
    if replayed_result(
        ctx,
        organization_id,
        company_id,
        "stage_bank_statement_import",
        &params.idempotency_key,
        &payload_fingerprint,
    )?
    .is_some()
    {
        return Ok(());
    }
    if ctx.db.bank_statement_import().iter().any(|import| {
        import.organization_id == organization_id
            && import.company_id == company_id
            && import.idempotency_key == params.idempotency_key
    }) {
        return Err(
            "statement import exists without an idempotency receipt; replay cannot be verified"
                .to_string(),
        );
    }

    validate_pilot_money_amount("opening balance", params.opening_balance)?;
    let idempotency_key = params.idempotency_key.clone();
    let mut invalid_rows = 0_u32;
    let mut staged_lines = Vec::with_capacity(params.rows.len());
    for row in params.rows {
        let validation_error = match (row.date, row.amount) {
            (None, _) => Some("date is required".to_string()),
            (_, None) => Some("amount is required".to_string()),
            (_, Some(0.0)) => Some("amount must not be zero".to_string()),
            (_, Some(amount)) => validate_pilot_money_amount("statement amount", amount).err(),
        };
        if validation_error.is_some() {
            invalid_rows += 1;
        }
        staged_lines.push((row, validation_error));
    }

    let staged_total = staged_lines
        .iter()
        .filter(|(_, validation_error)| validation_error.is_none())
        .filter_map(|(row, _)| row.amount)
        .sum::<f64>();
    validate_pilot_money_amount("statement total amount", staged_total)?;
    validate_pilot_money_amount(
        "statement closing balance",
        params.opening_balance + staged_total,
    )?;

    let total_rows = staged_lines.len() as u32;
    let import = ctx.db.bank_statement_import().insert(BankStatementImport {
        id: 0,
        organization_id,
        company_id,
        journal_id,
        currency_id,
        file_name: params.file_name,
        idempotency_key: params.idempotency_key,
        state: if invalid_rows == 0 {
            "staged"
        } else {
            "needs_review"
        }
        .to_string(),
        opening_balance: params.opening_balance,
        total_rows,
        valid_rows: total_rows - invalid_rows,
        invalid_rows,
        approved_statement_id: None,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        approved_at: None,
        approved_by: None,
    });
    for (row, validation_error) in staged_lines {
        ctx.db
            .bank_statement_import_line()
            .insert(BankStatementImportLine {
                id: 0,
                organization_id,
                import_id: import.id,
                row_number: row.row_number,
                date: row.date,
                amount: row.amount,
                reference: row.reference,
                description: row.description,
                validation_error,
                created_statement_line_id: None,
            });
    }
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "bank_statement_import",
            record_id: import.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "total_rows": total_rows, "invalid_rows": invalid_rows })
                    .to_string(),
            ),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    record_result(
        ctx,
        organization_id,
        company_id,
        "stage_bank_statement_import",
        idempotency_key,
        payload_fingerprint,
        "bank_statement_import",
        import.id,
    );
    Ok(())
}

/// Release a fully valid import into the existing bank-statement reconciliation
/// workflow. A second approval call is safe and returns without duplicating lines.
#[spacetimedb::reducer]
pub fn approve_bank_statement_import(
    ctx: &ReducerContext,
    organization_id: u64,
    import_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement", "write")?;
    let import = ctx
        .db
        .bank_statement_import()
        .id()
        .find(&import_id)
        .ok_or("Statement import not found")?;
    if import.organization_id != organization_id {
        return Err("Statement import does not belong to this organization".to_string());
    }
    if import.approved_statement_id.is_some() {
        return Ok(());
    }
    validate_pilot_money_amount("opening balance", import.opening_balance)?;
    if import.invalid_rows > 0 {
        return Err("Correct invalid rows before approving this statement import".to_string());
    }
    let lines: Vec<_> = ctx
        .db
        .bank_statement_import_line()
        .bank_statement_import_line_by_import()
        .filter(&import_id)
        .collect();
    if lines.is_empty() {
        return Err("Statement import has no rows".to_string());
    }
    let total_amount = lines.iter().filter_map(|line| line.amount).sum::<f64>();
    validate_pilot_money_amount("statement total amount", total_amount)?;
    validate_pilot_money_amount(
        "statement closing balance",
        import.opening_balance + total_amount,
    )?;
    let metadata = format!(r#"{{"bank_statement_import_id":{import_id}}}"#);
    create_account_bank_statement(
        ctx,
        organization_id,
        import.company_id,
        import.journal_id,
        CreateAccountBankStatementParams {
            name: import
                .file_name
                .clone()
                .or_else(|| Some(format!("Statement import #{import_id}"))),
            reference: Some(import.idempotency_key.clone()),
            date: None,
            balance_start: import.opening_balance,
            currency_id: import.currency_id,
            metadata: Some(metadata.clone()),
        },
    )?;
    let statement_id = ctx
        .db
        .account_bank_statement()
        .iter()
        .find(|statement| {
            statement.organization_id == organization_id
                && statement.company_id == import.company_id
                && statement.metadata.as_deref() == Some(metadata.as_str())
        })
        .map(|statement| statement.id)
        .ok_or("Statement import approval could not create a bank statement")?;
    for line in lines {
        let date = line.date.ok_or("Staged import line is missing date")?;
        let amount = line.amount.ok_or("Staged import line is missing amount")?;
        validate_pilot_money_amount("statement amount", amount)?;
        create_account_bank_statement_line(
            ctx,
            organization_id,
            import.company_id,
            statement_id,
            CreateAccountBankStatementLineParams {
                date,
                amount,
                amount_currency: amount,
                currency_id: Some(import.currency_id),
                foreign_currency_id: None,
                partner_id: None,
                bank_account_id: None,
                account_number: None,
                move_id: None,
                is_reconciled: false,
                transaction_type: Some("imported_statement".to_string()),
                move_ids: Vec::new(),
                payment_ids: Vec::new(),
                amount_residual: amount,
                auto_reconcile_ids: Vec::new(),
                metadata: Some(
                    serde_json::json!({
                        "bank_statement_import_id": import_id,
                        "source_row": line.row_number,
                        "reference": line.reference,
                        "description": line.description,
                    })
                    .to_string(),
                ),
            },
        )?;
        let created_statement_line_id = ctx
            .db
            .account_bank_statement_line()
            .iter()
            .filter(|statement_line| statement_line.statement_id == statement_id)
            .max_by_key(|statement_line| statement_line.id)
            .map(|statement_line| statement_line.id)
            .ok_or("Statement import approval could not create a statement line")?;
        ctx.db
            .bank_statement_import_line()
            .id()
            .update(BankStatementImportLine {
                created_statement_line_id: Some(created_statement_line_id),
                ..line
            });
    }
    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&statement_id)
        .ok_or("Statement import approval lost the created bank statement")?;
    ctx.db
        .account_bank_statement()
        .id()
        .update(AccountBankStatement {
            balance_end_real: statement.balance_start + total_amount,
            balance_end: statement.balance_start + total_amount,
            total_entry_encoding: total_amount,
            total_amount,
            total_amount_currency: total_amount,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..statement
        });
    ctx.db
        .bank_statement_import()
        .id()
        .update(BankStatementImport {
            state: "approved".to_string(),
            approved_statement_id: Some(statement_id),
            approved_at: Some(ctx.timestamp),
            approved_by: Some(ctx.sender()),
            ..import
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(import.company_id),
            table_name: "bank_statement_import",
            record_id: import_id,
            action: "APPROVE",
            old_values: None,
            new_values: Some(serde_json::json!({ "statement_id": statement_id }).to_string()),
            changed_fields: vec!["state".to_string(), "approved_statement_id".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

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
            organization_id,
            name: params.name,
            reference: params.reference,
            date: params.date,
            balance_start: params.balance_start,
            balance_end_real: params.balance_start,
            balance_end: params.balance_start,
            company_id,
            journal_id,
            currency_id: params.currency_id,
            state: BankStatementState::Open,
            line_ids: vec![],
            move_line_ids: vec![],
            total_entry_encoding: 0.0,
            total_amount: 0.0,
            total_amount_currency: 0.0,
            date_done: None,
            is_valid_balance_start: true,
            is_valid_balance_end: true,
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

    if statement.organization_id != organization_id {
        return Err("Statement does not belong to this organization".to_string());
    }
    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let settlement_lines: Vec<_> = ctx
        .db
        .account_bank_statement_line()
        .statement_line_by_statement()
        .filter(&statement_id)
        .filter(|line| !line.payment_ids.is_empty())
        .collect();
    if !settlement_lines.is_empty()
        && (params
            .currency_id
            .is_some_and(|id| id != statement.currency_id)
            || params.state.as_ref().is_some_and(|state| {
                *state != statement.state && settlement_lines.iter().any(|line| !line.is_reconciled)
            }))
    {
        return Err(
            "cannot change currency or close a statement with a pending settlement payment"
                .to_string(),
        );
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
            organization_id: statement.organization_id,
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

    if statement.organization_id != organization_id {
        return Err("Statement does not belong to this organization".to_string());
    }
    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if statement.state == BankStatementState::Posted {
        return Err("Cannot delete a posted statement".to_string());
    }
    if ctx
        .db
        .account_bank_statement_line()
        .statement_line_by_statement()
        .filter(&statement_id)
        .any(|line| {
            !line.payment_ids.is_empty()
                || line.is_reconciled
                || super::bank_settlement_lifecycle::has_attempt_history(ctx, line.id)
        })
    {
        return Err(
            "cannot delete a statement with settlement payments or reconciled lines".to_string(),
        );
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

    if statement.organization_id != organization_id {
        return Err("Statement does not belong to this organization".to_string());
    }
    if statement.state == BankStatementState::Posted {
        return Err("Cannot add lines to a posted statement".to_string());
    }

    if statement.company_id != company_id {
        return Err("Statement does not belong to this company".to_string());
    }
    if params.is_reconciled
        || params.move_id.is_some()
        || !params.move_ids.is_empty()
        || !params.payment_ids.is_empty()
        || params.amount_residual != params.amount
    {
        return Err(
            "new bank lines cannot supply settlement links or reconciled balances".to_string(),
        );
    }
    validate_pilot_money_amount("bank line amount", params.amount)?;
    validate_pilot_money_amount("bank line currency amount", params.amount_currency)?;
    super::bank_settlement_lifecycle::validate_metadata_change(None, params.metadata.as_deref())?;

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
            organization_id,
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

    if statement.organization_id != organization_id {
        return Err("Statement does not belong to this organization".to_string());
    }
    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if statement.state == BankStatementState::Posted {
        return Err("cannot edit a posted statement line".to_string());
    }
    if let Some(metadata) = &params.metadata {
        super::bank_settlement_lifecycle::validate_metadata_change(
            line.metadata.as_deref(),
            metadata.as_deref(),
        )?;
    }
    if params.move_id.is_some()
        || params.is_reconciled.is_some()
        || params.move_ids.is_some()
        || params.payment_ids.is_some()
        || params.amount_residual.is_some()
    {
        return Err(
            "bank settlement links and residuals are managed by the settlement action".to_string(),
        );
    }
    if (!line.payment_ids.is_empty() || line.is_reconciled)
        && (params.date.is_some()
            || params.amount.is_some()
            || params.amount_currency.is_some()
            || params.currency_id.is_some()
            || params.foreign_currency_id.is_some()
            || params.partner_id.is_some()
            || params.move_id.is_some()
            || params.is_reconciled.is_some()
            || params.move_ids.is_some()
            || params.payment_ids.is_some()
            || params.amount_residual.is_some())
    {
        return Err(
            "settlement payment provenance and financial fields cannot be edited".to_string(),
        );
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
    validate_pilot_money_amount("bank line amount", new_amount)?;
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
    let new_amount_residual = if params.amount.is_some() {
        new_amount
    } else {
        line.amount_residual
    };
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
            organization_id: line.organization_id,
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

    if statement.organization_id != organization_id {
        return Err("Statement does not belong to this organization".to_string());
    }
    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if statement.state == BankStatementState::Posted
        || !line.payment_ids.is_empty()
        || line.is_reconciled
        || super::bank_settlement_lifecycle::has_attempt_history(ctx, line.id)
    {
        return Err(
            "cannot delete a posted, reconciled or settlement-linked bank line".to_string(),
        );
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

    if statement.organization_id != organization_id {
        return Err("Statement does not belong to this organization".to_string());
    }
    if statement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if statement.state == BankStatementState::Posted {
        return Err("Statement is already posted".to_string());
    }
    if ctx
        .db
        .account_bank_statement_line()
        .statement_line_by_statement()
        .filter(&statement_id)
        .any(|line| !line.payment_ids.is_empty() && !line.is_reconciled)
    {
        return Err("complete pending bank settlements before posting the statement".to_string());
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

pub(super) struct BankSettlementSelection {
    pub(super) line_ids: Vec<u64>,
    pub(super) invoice_ids: Vec<u64>,
    pub(super) partner_id: u64,
    pub(super) account_id: u64,
}

/// Bank-linked payments remain part of an immutable settlement until a dedicated
/// bank reversal can unwind both the statement and its financial effects.
pub(crate) fn require_payment_not_bank_linked(
    ctx: &ReducerContext,
    organization_id: u64,
    payment_id: u64,
) -> Result<(), String> {
    if super::bank_settlement_lifecycle::is_owned_payment(ctx, organization_id, payment_id)
        || ctx
            .db
            .account_bank_statement_line()
            .bank_statement_line_by_org()
            .filter(&organization_id)
            .any(|line| line.payment_ids.contains(&payment_id))
    {
        return Err(
            "bank-linked payments require a dedicated bank settlement reversal".to_string(),
        );
    }
    Ok(())
}

/// Validate the entire selection before creating a payment or requesting approval.
/// Invoice registration settles all its open AR/AP rows, so partial row selection
/// and mixed partners must be rejected rather than silently settling extra rows.
pub(super) fn bank_settlement_selection(
    ctx: &ReducerContext,
    statement: &AccountBankStatement,
    line: &AccountBankStatementLine,
    params: &ReconcileAccountBankStatementLineParams,
    existing_payment: Option<&AccountPayment>,
) -> Result<BankSettlementSelection, String> {
    if params.amount_residual != 0.0 || params.move_ids.is_empty() {
        return Err("bank settlement requires an exact full-amount selection".to_string());
    }
    require_company_in_organization(ctx, statement.organization_id, statement.company_id)?;
    let company = ctx
        .db
        .company()
        .id()
        .find(&statement.company_id)
        .ok_or("settlement company not found")?;
    let currency = require_active_currency_id(ctx, company.currency_id, "bank settlement")?;
    let journal = require_active_journal(
        ctx,
        statement.organization_id,
        statement.company_id,
        statement.journal_id,
        "bank settlement",
    )?;
    if journal.type_ != JournalType::Bank
        || statement.currency_id != company.currency_id
        || line.journal_currency_id != company.currency_id
        || line.currency_id.is_some_and(|id| id != company.currency_id)
        || line.foreign_currency_id.is_some()
        || journal
            .currency_id
            .is_some_and(|id| id != company.currency_id)
        || currency.organization_id != statement.organization_id
        || currency.rounding_factor != 10_f64.powi(-i32::from(currency.decimal_places))
    {
        return Err(
            "bank settlement supports an active bank journal in company base currency only"
                .to_string(),
        );
    }
    let bank_minor = settlement_minor_units(line.amount, currency.decimal_places)?;
    if bank_minor == 0 {
        return Err("bank settlement amount must be nonzero".to_string());
    }
    let mut line_ids = params.move_ids.clone();
    line_ids.sort_unstable();
    line_ids.dedup();
    if line_ids.len() != params.move_ids.len() {
        return Err("Move line ids must be unique".to_string());
    }
    if !line.move_ids.is_empty() {
        return Err("existing bank links require review before settlement".to_string());
    }
    for other in ctx
        .db
        .account_bank_statement_line()
        .bank_statement_line_by_org()
        .filter(&statement.organization_id)
    {
        if other.id != line.id
            && (other.move_ids.iter().any(|id| line_ids.contains(id))
                || existing_payment.is_some_and(|payment| other.payment_ids.contains(&payment.id)))
        {
            return Err("selected records are already linked to another bank line".to_string());
        }
    }
    let expected_type = if bank_minor > 0 {
        MoveType::OutInvoice
    } else {
        MoveType::InInvoice
    };
    let account_type = if bank_minor > 0 {
        AccountTypeInternal::Receivable
    } else {
        AccountTypeInternal::Payable
    };
    let mut partner_id = line.partner_id;
    let mut invoice_ids = Vec::new();
    let mut selected_account_id = None;
    let mut total_minor = 0_i64;
    for id in &line_ids {
        let target = ctx
            .db
            .account_move_line()
            .id()
            .find(id)
            .ok_or("selected move line not found")?;
        let invoice = ctx
            .db
            .account_move()
            .id()
            .find(&target.move_id)
            .ok_or("selected invoice not found")?;
        let account = ctx
            .db
            .account_account()
            .id()
            .find(&target.account_id)
            .ok_or("selected account not found")?;
        if selected_account_id.is_some_and(|account_id| account_id != account.id) {
            return Err("bank settlement requires one receivable or payable account".to_string());
        }
        selected_account_id = Some(account.id);
        let target_partner = invoice
            .partner_id
            .ok_or("invoice partner is required for bank settlement")?;
        if partner_id.is_some_and(|id| id != target_partner) {
            return Err("bank settlement requires invoices for the same partner".to_string());
        }
        partner_id = Some(target_partner);
        if target.organization_id != statement.organization_id
            || target.company_id != statement.company_id
            || invoice.organization_id != statement.organization_id
            || invoice.company_id != statement.company_id
            || invoice.state != AccountMoveState::Posted
            || target.parent_state != AccountMoveState::Posted
            || target.journal_id != invoice.journal_id
            || invoice.move_type != expected_type
            || invoice.currency_id != currency.id
            || invoice.company_currency_id != currency.id
            || target.currency_id != currency.id
            || target.company_currency_id != currency.id
            || target.partner_id != Some(target_partner)
            || target.blocked
            || account.organization_id != statement.organization_id
            || account.company_id != statement.company_id
            || account.deprecated
            || !account.reconcile
            || account.internal_type.as_ref() != Some(&account_type)
        {
            return Err("selection must contain posted, unblocked customer invoice receivables or supplier bill payables in bank scope".to_string());
        }
        let residual = settlement_minor_units(target.amount_residual, currency.decimal_places)?;
        let balance = settlement_minor_units(target.balance, currency.decimal_places)?;
        if balance.signum() != bank_minor.signum()
            || settlement_minor_units(target.debit, currency.decimal_places)?
                - settlement_minor_units(target.credit, currency.decimal_places)?
                != balance
        {
            return Err("selected invoice line has an incompatible signed balance".to_string());
        }
        let selected_minor = if let Some(payment) = existing_payment {
            let payment_move_id = payment
                .move_id
                .ok_or("posted payment has no journal entry")?;
            if residual != 0
                || target.matching_number.as_deref()
                    != Some(format!("MATCH-{payment_move_id}-{}", invoice.id).as_str())
                || !(payment.reconciled_invoice_ids.contains(&invoice.id)
                    || payment.reconciled_bill_ids.contains(&invoice.id))
            {
                return Err(
                    "existing payment does not own the selected settled invoice lines".to_string(),
                );
            }
            balance
        } else {
            if residual == 0
                || residual.signum() != bank_minor.signum()
                || residual.abs() > balance.abs()
            {
                return Err(
                    "selected invoice residual is stale or has the wrong direction".to_string(),
                );
            }
            residual
        };
        total_minor = total_minor
            .checked_add(selected_minor)
            .ok_or("bank settlement total overflow")?;
        if !invoice_ids.contains(&invoice.id) {
            invoice_ids.push(invoice.id);
        }
    }
    if total_minor != bank_minor {
        return Err("selected invoice residuals must exactly equal the bank amount".to_string());
    }
    for invoice_id in &invoice_ids {
        for target in ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(invoice_id)
        {
            if crate::accounting::journal_entries::is_receivable_or_payable_line_type(
                target.account_internal_type.as_deref(),
            ) && (existing_payment.is_some() || target.amount_residual != 0.0)
                && !line_ids.contains(&target.id)
            {
                return Err(
                    "select every outstanding receivable/payable line of each invoice".to_string(),
                );
            }
        }
    }
    invoice_ids.sort_unstable();
    Ok(BankSettlementSelection {
        line_ids,
        invoice_ids,
        partner_id: partner_id.ok_or("bank settlement partner is required")?,
        account_id: selected_account_id.ok_or("bank settlement clearing account is required")?,
    })
}

/// Resolve the reviewed AR/AP account at posting time, including approval execution.
/// A changed/paid invoice must invalidate the pending bank payment before posting.
pub(super) fn bank_payment_clearing_account(
    ctx: &ReducerContext,
    payment: &AccountPayment,
) -> Result<Option<u64>, String> {
    super::bank_settlement_lifecycle::validate_pending_snapshot(ctx, payment)?;
    let lines: Vec<_> = ctx
        .db
        .account_bank_statement_line()
        .bank_statement_line_by_org()
        .filter(&payment.organization_id)
        .filter(|line| line.payment_ids.contains(&payment.id))
        .collect();
    if lines.is_empty() {
        return Ok(None);
    }
    if lines.len() != 1 {
        return Err("bank settlement payment must own exactly one bank line".to_string());
    }
    let line = &lines[0];
    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&line.statement_id)
        .ok_or("bank settlement statement missing")?;
    if line.is_reconciled
        || statement.state != BankStatementState::Open
        || payment.company_id != statement.company_id
    {
        return Err("bank payment cannot post outside its open settlement".to_string());
    }
    let line_ids: Vec<u64> = payment
        .memo
        .as_deref()
        .and_then(|memo| memo.strip_prefix("Reviewed bank settlement items "))
        .and_then(|ids| serde_json::from_str(ids).ok())
        .ok_or("reviewed bank payment items are unavailable")?;
    let fingerprint = format!(
        "{}:{}:{}:{:?}:{:?}:{}:{:?}",
        statement.id,
        line.journal_id,
        line.amount.to_bits(),
        line.date,
        line.partner_id,
        statement.currency_id,
        line_ids
    );
    let receipt = replayed_result(
        ctx,
        payment.organization_id,
        payment.company_id,
        "bank_statement_settlement",
        &super::bank_settlement_lifecycle::receipt_key(ctx, line)?,
        &fingerprint,
    )?;
    if receipt != Some(payment.id) {
        return Err("bank payment has no immutable settlement receipt".to_string());
    }
    let selection = bank_settlement_selection(
        ctx,
        &statement,
        line,
        &ReconcileAccountBankStatementLineParams {
            move_ids: line_ids,
            amount_residual: 0.0,
        },
        None,
    )?;
    if selection.partner_id != payment.partner_id
        || payment.amount != line.amount.abs()
        || payment.currency_id != statement.currency_id
        || payment.journal_id != statement.journal_id
    {
        return Err("bank payment does not match its reviewed settlement".to_string());
    }
    Ok(Some(selection.account_id))
}

/// Reconstruct and verify the immutable selection at the internal allocation boundary.
pub(super) fn validate_bank_settlement_registration(
    ctx: &ReducerContext,
    organization_id: u64,
    payment_id: u64,
    invoice_ids: &[u64],
    is_bill: bool,
) -> Result<(), String> {
    let lines: Vec<_> = ctx
        .db
        .account_bank_statement_line()
        .bank_statement_line_by_org()
        .filter(&organization_id)
        .filter(|line| line.payment_ids.contains(&payment_id))
        .collect();
    if lines.len() != 1 {
        return Err("bank settlement payment must own exactly one bank line".to_string());
    }
    let line = &lines[0];
    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&line.statement_id)
        .ok_or("bank settlement parent missing")?;
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("bank settlement payment missing")?;
    if line.is_reconciled
        || statement.state != BankStatementState::Open
        || statement.organization_id != organization_id
        || payment.organization_id != organization_id
        || payment.company_id != statement.company_id
        || is_bill != (line.amount < 0.0)
    {
        return Err("bank settlement registration scope is inconsistent".to_string());
    }
    // The receipt pins the canonical reviewed line IDs even while approval is pending.
    super::bank_settlement_lifecycle::validate_pending_snapshot(ctx, &payment)?;
    let key = super::bank_settlement_lifecycle::receipt_key(ctx, line)?;
    let receipt = ctx
        .db
        .accounting_operation_receipt()
        .accounting_operation_receipt_by_scope()
        .filter((
            &organization_id,
            &statement.company_id,
            &"bank_statement_settlement".to_string(),
        ))
        .find(|receipt| receipt.idempotency_key == key && receipt.result_id == payment_id)
        .ok_or("immutable bank settlement receipt missing")?;
    let line_ids: Vec<u64> = payment
        .memo
        .as_deref()
        .and_then(|memo| memo.strip_prefix("Reviewed bank settlement items "))
        .and_then(|ids| serde_json::from_str(ids).ok())
        .ok_or("bank settlement reviewed items missing")?;
    let fingerprint = format!(
        "{}:{}:{}:{:?}:{:?}:{}:{:?}",
        statement.id,
        line.journal_id,
        line.amount.to_bits(),
        line.date,
        line.partner_id,
        statement.currency_id,
        line_ids
    );
    if receipt.payload_fingerprint != fingerprint {
        return Err("bank settlement selection no longer matches its receipt".to_string());
    }
    let selection = bank_settlement_selection(
        ctx,
        &statement,
        line,
        &ReconcileAccountBankStatementLineParams {
            move_ids: line_ids,
            amount_residual: 0.0,
        },
        None,
    )?;
    let mut canonical_invoice_ids = invoice_ids.to_vec();
    canonical_invoice_ids.sort_unstable();
    if selection.invoice_ids != canonical_invoice_ids {
        return Err("bank payment can only settle its reviewed invoices".to_string());
    }
    Ok(())
}

/// Settle an exact bank amount through the normal payment posting approval gate.
/// A pending approval persists a draft payment only; the bank line is matched
/// only after payment posting and invoice reconciliation have both succeeded.
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

    if line.organization_id != organization_id
        || statement.organization_id != organization_id
        || statement.company_id != company_id
        || line.statement_id != statement.id
        || line.journal_id != statement.journal_id
    {
        return Err("Record does not belong to this company".to_string());
    }

    if statement.state != BankStatementState::Open {
        return Err("Only an Open statement can be reconciled".to_string());
    }

    if line.is_reconciled {
        return Err("Line is already reconciled".to_string());
    }

    // Require every downstream capability before persisting even a draft or approval task.
    check_permission(ctx, organization_id, "payment", "create")?;
    check_permission(ctx, organization_id, "payment", "post")?;
    check_permission(ctx, organization_id, "payment", "reconcile")?;
    check_permission(ctx, organization_id, "account_move", "write")?;
    let mut selected_ids = params.move_ids.clone();
    selected_ids.sort_unstable();
    let key = super::bank_settlement_lifecycle::receipt_key(ctx, &line)?;
    let fingerprint = format!(
        "{}:{}:{}:{:?}:{:?}:{}:{:?}",
        statement.id,
        line.journal_id,
        line.amount.to_bits(),
        line.date,
        line.partner_id,
        statement.currency_id,
        selected_ids
    );
    let own_payment_id = replayed_result(
        ctx,
        organization_id,
        company_id,
        "bank_statement_settlement",
        &key,
        &fingerprint,
    )?;
    if line.payment_ids.len() > 1 || own_payment_id.is_some_and(|id| line.payment_ids != vec![id]) {
        return Err("bank settlement payment provenance is inconsistent".to_string());
    }
    let existing = line
        .payment_ids
        .first()
        .map(|id| {
            ctx.db
                .account_payment()
                .id()
                .find(id)
                .ok_or("bank settlement payment not found")
        })
        .transpose()?;
    let previously_settled = own_payment_id.is_none() && existing.is_some();
    let selection = bank_settlement_selection(
        ctx,
        &statement,
        &line,
        &params,
        if previously_settled {
            existing.as_ref()
        } else {
            None
        },
    )?;
    let mut prepared_attempt = if existing.is_none() {
        Some(super::bank_settlement_lifecycle::prepare_attempt(
            ctx,
            &statement,
            &line,
            &selection.line_ids,
            selection.partner_id,
        )?)
    } else {
        None
    };
    let inbound = line.amount > 0.0;
    let payment_type = if inbound {
        PaymentType::InBound
    } else {
        PaymentType::OutBound
    };
    let partner_type = if inbound {
        PartnerType::Customer
    } else {
        PartnerType::Supplier
    };
    let payment_id = if let Some(payment) = &existing {
        if payment.organization_id != organization_id
            || payment.company_id != company_id
            || payment.journal_id != statement.journal_id
            || payment.currency_id != statement.currency_id
            || payment.partner_id != selection.partner_id
            || payment.payment_type != payment_type
            || payment.partner_type != partner_type
            || payment.amount != line.amount.abs()
            || payment.reversal_move_id.is_some()
            || (previously_settled && payment.state != PaymentState::Paid)
            || (!previously_settled && payment.date != line.date)
        {
            return Err("linked payment does not match bank settlement scope".to_string());
        }
        payment.id
    } else {
        let payment_params = CreatePaymentParams {
            idempotency_key: key.clone(),
            company_id,
            payment_type,
            partner_type,
            partner_id: selection.partner_id,
            amount: line.amount.abs(),
            currency_id: statement.currency_id,
            date: Some(line.date),
            journal_id: statement.journal_id,
            ref_: Some(format!("BANK-STATEMENT-{}-LINE-{line_id}", statement.id)),
            memo: Some(format!(
                "Reviewed bank settlement items {:?}",
                selection.line_ids
            )),
        };
        let payment_fingerprint = format!("{payment_params:?}");
        create_payment(ctx, organization_id, payment_params)?;
        let payment_id = replayed_result(
            ctx,
            organization_id,
            company_id,
            "create_payment",
            &key,
            &payment_fingerprint,
        )?
        .ok_or("bank settlement payment receipt missing")?;
        record_result(
            ctx,
            organization_id,
            company_id,
            "bank_statement_settlement",
            key,
            fingerprint,
            "account_payment",
            payment_id,
        );
        super::bank_settlement_lifecycle::insert_attempt(
            ctx,
            &statement,
            &line,
            payment_id,
            selection.partner_id,
            prepared_attempt
                .take()
                .ok_or("bank settlement snapshot was not prepared")?,
        )?;
        payment_id
    };
    // This provenance survives a human approval, without marking the bank line matched.
    ctx.db
        .account_bank_statement_line()
        .id()
        .update(AccountBankStatementLine {
            payment_ids: vec![payment_id],
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..ctx
                .db
                .account_bank_statement_line()
                .id()
                .find(&line_id)
                .ok_or("bank line missing")?
        });
    if !previously_settled {
        let payment = ctx
            .db
            .account_payment()
            .id()
            .find(&payment_id)
            .ok_or("bank payment missing")?;
        if payment.state == PaymentState::NotPaid {
            post_payment(ctx, organization_id, payment_id)?;
        }
        let payment = ctx
            .db
            .account_payment()
            .id()
            .find(&payment_id)
            .ok_or("bank payment missing after posting")?;
        if payment.state == PaymentState::NotPaid {
            // The standard gate created an approval task. Returning success commits only
            // the draft and its approval request; canonical readback reports pending.
            super::bank_settlement_lifecycle::pending_finished(ctx, payment_id)?;
            return Ok(());
        }
        if payment.state != PaymentState::Paid
            || !payment.reconciled_invoice_ids.is_empty()
            || !payment.reconciled_bill_ids.is_empty()
        {
            return Err(
                "bank settlement payment is reversed or already allocated elsewhere".to_string(),
            );
        }
        register_bank_settlement_on_invoices(
            ctx,
            organization_id,
            payment_id,
            selection.invoice_ids.clone(),
            !inbound,
        )?;
    }
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("settled bank payment missing")?;
    let payment_move_id = payment
        .move_id
        .ok_or("settled bank payment has no journal entry")?;
    let payment_move = ctx
        .db
        .account_move()
        .id()
        .find(&payment_move_id)
        .ok_or("payment journal entry missing")?;
    if payment_move.organization_id != organization_id
        || payment_move.company_id != company_id
        || payment_move.journal_id != statement.journal_id
        || payment_move.state != AccountMoveState::Posted
    {
        return Err("bank payment journal entry does not match settlement scope".to_string());
    }
    let currency = require_active_currency_id(ctx, statement.currency_id, "bank settlement")?;
    for id in &selection.line_ids {
        let target = ctx
            .db
            .account_move_line()
            .id()
            .find(id)
            .ok_or("settled invoice line missing")?;
        if settlement_minor_units(target.amount_residual, currency.decimal_places)? != 0 {
            return Err(
                "bank settlement did not clear every selected invoice residual".to_string(),
            );
        }
    }
    let clearing: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .filter(|row| {
            crate::accounting::journal_entries::is_receivable_or_payable_line_type(
                row.account_internal_type.as_deref(),
            )
        })
        .collect();
    if clearing.is_empty() || clearing.iter().any(|row| row.amount_residual != 0.0) {
        return Err("bank settlement payment has an unapplied clearing residual".to_string());
    }
    let is_reconciled = true;

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
            move_id: Some(payment_move_id),
            payment_ids: vec![payment_id],
            move_ids: selection.line_ids,
            amount_residual: 0.0,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..ctx
                .db
                .account_bank_statement_line()
                .id()
                .find(&line_id)
                .ok_or("settled bank line missing")?
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

    super::bank_settlement_lifecycle::settlement_finished(ctx, payment_id)?;
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

    if statement.organization_id != organization_id
        || line.organization_id != organization_id
        || statement.company_id != company_id
    {
        return Err("Record does not belong to this company".to_string());
    }
    if !line.payment_ids.is_empty() {
        return Err(
            "a settlement-linked bank line requires an accounting reversal, not unlinking"
                .to_string(),
        );
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
            organization_id,
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
            organization_id: widget.organization_id,
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

    if statement.organization_id != organization_id {
        return Err("Statement does not belong to this organization".to_string());
    }

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
        if move_line.organization_id != organization_id
            || move_line.company_id != statement.company_id
        {
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
                    organization_id,
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
fn match_by_exact_amount(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    rule_id: Option<u64>,
    amount: f64,
    company_id: u64,
) -> Result<(), String> {
    let target_amount = amount.abs();

    for move_line in ctx.db.account_move_line().iter() {
        if move_line.organization_id != organization_id || move_line.company_id != company_id {
            continue;
        }

        let move_line_amount = move_line.balance.abs();

        if (move_line_amount - target_amount).abs() <= 0.01 {
            let match_type = if amount < 0.0 { "payment" } else { "invoice" }.to_string();

            ctx.db.bank_match_candidate().insert(BankMatchCandidate {
                id: 0,
                organization_id,
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

fn match_by_partner(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    rule_id: Option<u64>,
    partner_id: u64,
    amount: f64,
    company_id: u64,
) -> Result<(), String> {
    for move_line in ctx.db.account_move_line().iter() {
        if move_line.organization_id != organization_id || move_line.company_id != company_id {
            continue;
        }

        if let Some(ml_partner_id) = move_line.partner_id {
            if ml_partner_id == partner_id {
                let match_type = if amount < 0.0 { "payment" } else { "invoice" }.to_string();
                let score = calculate_match_score_by_ids(ctx, line_id, &move_line, "partner");

                ctx.db.bank_match_candidate().insert(BankMatchCandidate {
                    id: 0,
                    organization_id,
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
    organization_id: u64,
    line_id: u64,
    rule_id: Option<u64>,
    account_number: &str,
    amount: f64,
    company_id: u64,
) -> Result<(), String> {
    let reference = account_number.trim().to_lowercase();
    for move_line in ctx.db.account_move_line().iter() {
        if move_line.organization_id != organization_id || move_line.company_id != company_id {
            continue;
        }

        let match_type = if amount < 0.0 { "payment" } else { "invoice" }.to_string();
        let reference_matches = !reference.is_empty()
            && [
                Some(move_line.name.as_str()),
                move_line.ref_.as_deref(),
                move_line.move_name.as_deref(),
                move_line.matching_label.as_deref(),
                move_line.matching_number.as_deref(),
            ]
            .into_iter()
            .flatten()
            .any(|candidate| candidate.to_lowercase().contains(&reference));

        let mut score = calculate_match_score_by_ids(ctx, line_id, &move_line, "reference");
        if reference_matches {
            score = (score + 30).min(100);
        }

        if reference_matches && score > 50 {
            ctx.db.bank_match_candidate().insert(BankMatchCandidate {
                id: 0,
                organization_id,
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
