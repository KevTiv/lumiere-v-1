/// Expenses CSV Imports — HrExpense, HrExpenseSheet
use spacetimedb::{ReducerContext, Table};

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::expenses::expenses::{hr_expense, hr_expense_sheet, HrExpense, HrExpenseSheet};
use crate::helpers::check_permission;
use crate::types::{ExpenseSheetState, ExpenseState};

// ── HrExpense ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_expense_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "hr_expense", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let company_id = parse_u64(col(&headers, row, "company_id"));
        let employee_id = parse_u64(col(&headers, row, "employee_id"));
        if employee_id == 0 {
            record_import_error(ctx, job.id, row_num, Some("employee_id"), None, "employee_id is required");
            errors += 1;
            continue;
        }

        let state = match col(&headers, row, "state") {
            "submitted" => ExpenseState::Submitted,
            "approved" => ExpenseState::Approved,
            "posted" => ExpenseState::Posted,
            "done" => ExpenseState::Done,
            "refused" => ExpenseState::Refused,
            _ => ExpenseState::Draft,
        };

        ctx.db.hr_expense().insert(HrExpense {
            id: 0,
            organization_id,
            company_id,
            name,
            employee_id,
            product_id: opt_u64(col(&headers, row, "product_id")),
            date: opt_timestamp(col(&headers, row, "date")).unwrap_or(ctx.timestamp),
            total_amount: parse_f64(col(&headers, row, "total_amount")),
            currency_id: parse_u64(col(&headers, row, "currency_id")),
            quantity: {
                let q = parse_f64(col(&headers, row, "quantity"));
                if q == 0.0 { 1.0 } else { q }
            },
            unit_amount: parse_f64(col(&headers, row, "unit_amount")),
            tax_ids: vec_u64(col(&headers, row, "tax_ids")),
            account_id: opt_u64(col(&headers, row, "account_id")),
            analytic_account_id: opt_u64(col(&headers, row, "analytic_account_id")),
            sheet_id: opt_u64(col(&headers, row, "sheet_id")),
            state,
            description: opt_str(col(&headers, row, "description")),
            attachment_ids: vec_u64(col(&headers, row, "attachment_ids")),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import hr_expense: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── HrExpenseSheet ────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_expense_sheet_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "hr_expense_sheet", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let company_id = parse_u64(col(&headers, row, "company_id"));
        let employee_id = parse_u64(col(&headers, row, "employee_id"));
        if employee_id == 0 {
            record_import_error(ctx, job.id, row_num, Some("employee_id"), None, "employee_id is required");
            errors += 1;
            continue;
        }

        let state = match col(&headers, row, "state") {
            "submitted" => ExpenseSheetState::Submitted,
            "approved" => ExpenseSheetState::Approved,
            "posted" => ExpenseSheetState::Posted,
            "done" => ExpenseSheetState::Done,
            "refused" => ExpenseSheetState::Refused,
            _ => ExpenseSheetState::Draft,
        };

        ctx.db.hr_expense_sheet().insert(HrExpenseSheet {
            id: 0,
            organization_id,
            company_id,
            name,
            employee_id,
            state,
            total_amount: parse_f64(col(&headers, row, "total_amount")),
            currency_id: parse_u64(col(&headers, row, "currency_id")),
            accounting_date: opt_timestamp(col(&headers, row, "accounting_date")),
            account_move_id: opt_u64(col(&headers, row, "account_move_id")),
            approver_id: None,
            notes: opt_str(col(&headers, row, "notes")),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import hr_expense_sheet: imported={}, errors={}", imported, errors);
    Ok(())
}
