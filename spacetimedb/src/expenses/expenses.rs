/// Expenses — HrExpense & HrExpenseSheet
///
/// Individual expense lines (receipts) grouped into expense reports (sheets).
/// Sheets can be submitted for approval and then posted as an AccountMove.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{ExpenseSheetState, ExpenseState};

// ── Tables ────────────────────────────────────────────────────────────────────

/// HR Expense — A single expense line (receipt/item) submitted by an employee.
#[spacetimedb::table(
    accessor = hr_expense,
    public,
    index(accessor = expense_by_employee, btree(columns = [employee_id])),
    index(accessor = expense_by_sheet, btree(columns = [sheet_id])),
    index(accessor = expense_by_org, btree(columns = [organization_id]))
)]
pub struct HrExpense {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,            // Description of the expense
    pub employee_id: u64,        // FK → HrEmployee
    pub product_id: Option<u64>, // FK → Product (expense category)
    pub date: Timestamp,
    pub total_amount: f64,
    pub currency_id: u64,
    pub quantity: f64,                    // Default 1.0
    pub unit_amount: f64,                 // Price per unit
    pub tax_ids: Vec<u64>,                // FK → AccountTax
    pub account_id: Option<u64>,          // FK → AccountAccount
    pub analytic_account_id: Option<u64>, // FK → AccountAnalyticAccount
    pub sheet_id: Option<u64>,            // FK → HrExpenseSheet (set when submitted)
    pub state: ExpenseState,
    pub description: Option<String>,
    pub attachment_ids: Vec<u64>, // File attachment IDs
    pub created_at: Timestamp,
}

/// HR Expense Sheet — An expense report grouping multiple expense lines.
#[spacetimedb::table(
    accessor = expense_sheet,
    public,
    index(accessor = sheet_by_employee, btree(columns = [employee_id])),
    index(accessor = sheet_by_state, btree(columns = [state])),
    index(accessor = sheet_by_org, btree(columns = [organization_id]))
)]
pub struct HrExpenseSheet {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,     // e.g. "Business Trip - March 2026"
    pub employee_id: u64, // FK → HrEmployee
    pub state: ExpenseSheetState,
    pub total_amount: f64,
    pub currency_id: u64,
    pub accounting_date: Option<Timestamp>,
    pub account_move_id: Option<u64>, // FK → AccountMove (set on post)
    pub approver_id: Option<Identity>, // Who approved this sheet
    pub notes: Option<String>,
    pub created_at: Timestamp,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateExpenseParams {
    pub employee_id: u64,
    pub name: String,
    pub date: Timestamp,
    pub unit_amount: f64,
    pub quantity: f64,
    pub currency_id: u64,
    pub product_id: Option<u64>,
    pub description: Option<String>,
    pub tax_ids: Vec<u64>,
    pub account_id: Option<u64>,
    pub analytic_account_id: Option<u64>,
    pub attachment_ids: Vec<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateExpenseParams {
    pub name: Option<String>,
    pub unit_amount: Option<f64>,
    pub quantity: Option<f64>,
    pub description: Option<String>,
    pub account_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateExpenseSheetParams {
    pub employee_id: u64,
    pub name: String,
    pub currency_id: u64,
    pub notes: Option<String>,
    pub accounting_date: Option<Timestamp>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SubmitExpenseSheetParams {
    pub total_amount: f64,
}

// ── Reducers: Expenses ────────────────────────────────────────────────────────

#[reducer]
pub fn create_expense(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateExpenseParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "create")?;
    if params.name.is_empty() {
        return Err("Expense description cannot be empty".to_string());
    }
    if params.unit_amount < 0.0 {
        return Err("Unit amount cannot be negative".to_string());
    }
    if params.quantity <= 0.0 {
        return Err("Quantity must be positive".to_string());
    }
    let expense = ctx.db.hr_expense().insert(HrExpense {
        id: 0,
        organization_id,
        company_id,
        name: params.name,
        employee_id: params.employee_id,
        product_id: params.product_id,
        date: params.date,
        total_amount: params.unit_amount * params.quantity,
        currency_id: params.currency_id,
        quantity: params.quantity,
        unit_amount: params.unit_amount,
        tax_ids: params.tax_ids,
        account_id: params.account_id,
        analytic_account_id: params.analytic_account_id,
        sheet_id: None,
        state: ExpenseState::Draft,
        description: params.description,
        attachment_ids: params.attachment_ids,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense",
            record_id: expense.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_expense(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    expense_id: u64,
    params: UpdateExpenseParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "update")?;
    let expense = ctx
        .db
        .hr_expense()
        .id()
        .find(&expense_id)
        .ok_or("Expense not found")?;
    if expense.organization_id != organization_id {
        return Err("Expense belongs to a different organization".to_string());
    }
    if expense.company_id != company_id {
        return Err("Expense does not belong to this company".to_string());
    }
    if expense.state != ExpenseState::Draft {
        return Err("Only draft expenses can be edited".to_string());
    }
    let new_unit = params.unit_amount.unwrap_or(expense.unit_amount);
    let new_qty = params.quantity.unwrap_or(expense.quantity);
    ctx.db.hr_expense().id().update(HrExpense {
        name: params.name.unwrap_or(expense.name),
        unit_amount: new_unit,
        quantity: new_qty,
        total_amount: new_unit * new_qty,
        description: params.description.or(expense.description),
        account_id: params.account_id.or(expense.account_id),
        ..expense
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense",
            record_id: expense_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn submit_expense(
    ctx: &ReducerContext,
    organization_id: u64,
    expense_id: u64,
    sheet_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "update")?;
    let expense = ctx
        .db
        .hr_expense()
        .id()
        .find(&expense_id)
        .ok_or("Expense not found")?;
    if expense.organization_id != organization_id {
        return Err("Expense belongs to a different organization".to_string());
    }
    if expense.state != ExpenseState::Draft {
        return Err("Only draft expenses can be submitted".to_string());
    }
    let company_id = expense.company_id;
    ctx.db.hr_expense().id().update(HrExpense {
        sheet_id: Some(sheet_id),
        state: ExpenseState::Submitted,
        ..expense
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense",
            record_id: expense_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["sheet_id".to_string(), "state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Expense Sheets ──────────────────────────────────────────────────

#[reducer]
pub fn create_expense_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateExpenseSheetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "create")?;
    if params.name.is_empty() {
        return Err("Expense sheet name cannot be empty".to_string());
    }
    let sheet = ctx.db.expense_sheet().insert(HrExpenseSheet {
        id: 0,
        organization_id,
        company_id,
        name: params.name,
        employee_id: params.employee_id,
        state: ExpenseSheetState::Draft,
        total_amount: 0.0,
        currency_id: params.currency_id,
        accounting_date: params.accounting_date,
        account_move_id: None,
        approver_id: None,
        notes: params.notes,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_sheet",
            record_id: sheet.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn submit_expense_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
    params: SubmitExpenseSheetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "update")?;
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    if sheet.organization_id != organization_id {
        return Err("Expense sheet belongs to a different organization".to_string());
    }
    if sheet.state != ExpenseSheetState::Draft {
        return Err("Only draft sheets can be submitted".to_string());
    }
    let company_id = sheet.company_id;
    ctx.db.expense_sheet().id().update(HrExpenseSheet {
        total_amount: params.total_amount,
        state: ExpenseSheetState::Submitted,
        ..sheet
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_sheet",
            record_id: sheet_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["total_amount".to_string(), "state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn approve_expense_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "approve")?;
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    if sheet.organization_id != organization_id {
        return Err("Expense sheet belongs to a different organization".to_string());
    }
    if sheet.state != ExpenseSheetState::Submitted {
        return Err("Only submitted sheets can be approved".to_string());
    }
    let company_id = sheet.company_id;
    ctx.db.expense_sheet().id().update(HrExpenseSheet {
        state: ExpenseSheetState::Approved,
        approver_id: Some(ctx.sender()),
        ..sheet
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_sheet",
            record_id: sheet_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["state".to_string(), "approver_id".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn refuse_expense_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "approve")?;
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    if sheet.organization_id != organization_id {
        return Err("Expense sheet belongs to a different organization".to_string());
    }
    let company_id = sheet.company_id;
    ctx.db.expense_sheet().id().update(HrExpenseSheet {
        state: ExpenseSheetState::Refused,
        ..sheet
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_sheet",
            record_id: sheet_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn post_expense_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
    accounting_date: Timestamp,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "post")?;
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    if sheet.organization_id != organization_id {
        return Err("Expense sheet belongs to a different organization".to_string());
    }
    if sheet.state != ExpenseSheetState::Approved {
        return Err("Only approved sheets can be posted".to_string());
    }
    let company_id = sheet.company_id;
    ctx.db.expense_sheet().id().update(HrExpenseSheet {
        state: ExpenseSheetState::Posted,
        accounting_date: Some(accounting_date),
        ..sheet
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_sheet",
            record_id: sheet_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["state".to_string(), "accounting_date".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
