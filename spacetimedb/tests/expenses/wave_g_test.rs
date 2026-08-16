//! Wave G — EXP-009 (cross-company line/sheet rejection), EXP-010 (idempotent
//! post), EXP-011 (only-manager-can-refuse SoD guard).
use spacetimedb::{ReducerContext, Table};

use crate::accounting::journal_entries::account_move;
use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::expenses::expenses::{
    create_expense, create_expense_sheet, expense_sheet, hr_expense, post_expense_sheet,
    refuse_expense_sheet, submit_expense, submit_expense_sheet, CreateExpenseParams,
    CreateExpenseSheetParams, PostExpenseSheetParams, RefuseExpenseSheetParams,
};
use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{AccountMoveState, EmploymentType, ExpenseLineKind, ExpensePaymentMode};

use super::test_receipt_id;

fn seed_sibling_company(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: "Expenses Iso Company B".to_string(),
            code: format!("EXP-CB-{}", fixture.company_id),
            currency_id: 1,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: Some(r#"{"harness":"expenses-iso-b"}"#.to_string()),
        },
    )?;
    ctx.db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .map(|c| c.id)
        .filter(|id| *id != fixture.company_id)
        .max()
        .ok_or_else(|| "sibling company B missing".to_string())
}

fn seed_employee_in(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    company_id: u64,
    name: &str,
) -> Result<u64, String> {
    create_employee(
        ctx,
        fixture.organization_id,
        CreateEmployeeParams {
            company_id: Some(company_id),
            name: name.to_string(),
            job_id: None,
            department_id: None,
            employment_type: EmploymentType::FullTime,
            work_email: None,
            employee_number: None,
            job_title: None,
            parent_id: None,
            coach_id: None,
            work_phone: None,
            mobile_phone: None,
            work_location: None,
            work_contact_partner_id: None,
            date_hired: None,
            gender: None,
            birthday: None,
            marital: None,
            emergency_contact: None,
            emergency_phone: None,
            barcode: None,
            pin: None,
            image_url: None,
            color: None,
            is_active: true,
            metadata: None,
        },
    )?;
    ctx.db
        .hr_employee()
        .iter()
        .find(|e| e.organization_id == fixture.organization_id && e.name == name)
        .map(|e| e.id)
        .ok_or_else(|| format!("employee {name} missing"))
}

fn create_draft_sheet_in(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    company_id: u64,
    employee_id: u64,
    name: &str,
) -> Result<u64, String> {
    create_expense_sheet(
        ctx,
        fixture.organization_id,
        CreateExpenseSheetParams {
            company_id: Some(company_id),
            employee_id,
            name: name.to_string(),
            currency_id: 1,
            notes: None,
            accounting_date: None,
        },
    )?;
    ctx.db
        .expense_sheet()
        .iter()
        .find(|s| {
            s.organization_id == fixture.organization_id
                && s.employee_id == employee_id
                && s.name == name
        })
        .map(|s| s.id)
        .ok_or_else(|| format!("sheet {name} missing"))
}

fn create_line_with_receipt_in(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    company_id: u64,
    employee_id: u64,
    name: &str,
    amount: f64,
) -> Result<u64, String> {
    let receipt_id = test_receipt_id(ctx, fixture.organization_id, company_id, employee_id)?;
    create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(company_id),
            employee_id,
            name: name.to_string(),
            date: ctx.timestamp,
            unit_amount: amount,
            quantity: 1.0,
            currency_id: 1,
            product_id: None,
            description: None,
            tax_ids: vec![],
            account_id: None,
            analytic_account_id: None,
            project_id: None,
            line_kind: ExpenseLineKind::Standard,
            mileage_distance: None,
            mileage_rate_id: None,
            per_diem_days: None,
            per_diem_rate_id: None,
            attachment_ids: vec![receipt_id],
            client_request_id: None,
            payment_mode: ExpensePaymentMode::OutOfPocket,
            merchant_key: None,
            policy_exception_reason: None,
        },
    )?;
    ctx.db
        .hr_expense()
        .iter()
        .find(|e| {
            e.organization_id == fixture.organization_id
                && e.employee_id == employee_id
                && e.name == name
        })
        .map(|e| e.id)
        .ok_or_else(|| format!("expense {name} missing"))
}

/// EXP-009: a line from company B cannot be attached to a company A sheet —
/// submit_expense checks sheet.company_id == expense.company_id (and the same
/// for employee_id) before the line is ever attached, so a cross-company sheet
/// can never actually be assembled through the public API in the first place.
pub fn test_submit_expense_rejects_cross_company_attach(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let company_b = seed_sibling_company(ctx, &fixture)?;

    let employee_a = seed_employee_in(ctx, &fixture, fixture.company_id, "Wave G Emp A")?;
    let employee_b = seed_employee_in(ctx, &fixture, company_b, "Wave G Emp B")?;

    let sheet_a = create_draft_sheet_in(
        ctx,
        &fixture,
        fixture.company_id,
        employee_a,
        "Wave G Sheet A",
    )?;
    let line_b = create_line_with_receipt_in(
        ctx,
        &fixture,
        company_b,
        employee_b,
        "Wave G Line B",
        55.0,
    )?;

    let cross = submit_expense(ctx, fixture.organization_id, line_b, sheet_a);
    if cross.is_ok() {
        return Err("attaching a different-company line to the sheet should fail".into());
    }

    // Same-company attach still succeeds — proves the rejection above is
    // company-scope specific, not a general submit_expense failure.
    let line_a = create_line_with_receipt_in(
        ctx,
        &fixture,
        fixture.company_id,
        employee_a,
        "Wave G Line A",
        55.0,
    )?;
    submit_expense(ctx, fixture.organization_id, line_a, sheet_a)?;
    let attached = ctx
        .db
        .hr_expense()
        .id()
        .find(&line_a)
        .ok_or("line A after attach")?;
    if attached.sheet_id != Some(sheet_a) {
        return Err("same-company attach should have succeeded".into());
    }
    Ok(())
}

/// EXP-010: posting the same sheet twice with the same client_request_id is a
/// no-op — the second call returns Ok(()) without creating a second move.
pub fn test_post_expense_sheet_is_idempotent(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    super::wave_a_test::seed_caller_manager(ctx, &fixture)?;
    let accounts = super::wave_a_test::seed_accounts(ctx, &fixture)?;
    let employee_id = seed_employee_in(ctx, &fixture, fixture.company_id, "Wave G Idem Emp")?;
    let sheet_id = create_draft_sheet_in(
        ctx,
        &fixture,
        fixture.company_id,
        employee_id,
        "Wave G Idem Sheet",
    )?;
    let line_id = create_line_with_receipt_in(
        ctx,
        &fixture,
        fixture.company_id,
        employee_id,
        "Wave G Idem Line",
        75.0,
    )?;
    submit_expense(ctx, fixture.organization_id, line_id, sheet_id)?;
    submit_expense_sheet(ctx, fixture.organization_id, sheet_id)?;
    crate::expenses::expenses::approve_expense_sheet_impl(
        ctx,
        fixture.organization_id,
        sheet_id,
        true,
    )?;

    let post_params = || PostExpenseSheetParams {
        journal_id: accounts.journal_id,
        payable_account_id: accounts.payable_id,
        default_expense_account_id: accounts.expense_id,
        default_tax_account_id: None,
        card_liability_account_id: None,
        advance_account_id: None,
        fx_fee_account_id: None,
        fx_fee_amount: None,
        accounting_date: ctx.timestamp,
        client_request_id: Some("wave-g-idem-post".into()),
    };

    post_expense_sheet(ctx, fixture.organization_id, sheet_id, post_params())?;
    let after_first = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("sheet after first post")?;
    let move_id = after_first.account_move_id.ok_or("move id after first post")?;

    // Same client_request_id — must no-op, not error, and must not touch account_move_id.
    post_expense_sheet(ctx, fixture.organization_id, sheet_id, post_params())?;
    let after_second = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("sheet after second post")?;
    if after_second.account_move_id != Some(move_id) {
        return Err(format!(
            "duplicate post changed account_move_id: {:?} -> {:?}",
            Some(move_id),
            after_second.account_move_id
        ));
    }
    let mv = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("move missing")?;
    if mv.state != AccountMoveState::Posted {
        return Err("move should remain posted after duplicate post call".into());
    }

    // A different client_request_id against an already-posted sheet must still reject.
    let mismatched = post_expense_sheet(
        ctx,
        fixture.organization_id,
        sheet_id,
        PostExpenseSheetParams {
            client_request_id: Some("wave-g-idem-post-different".into()),
            ..post_params()
        },
    );
    if mismatched.is_ok() {
        return Err("posting an already-posted sheet with a different request id should fail".into());
    }
    Ok(())
}

/// EXP-011: refuse_expense_sheet (the public reducer, SoD guard included)
/// rejects a refusal from the same identity that submitted the sheet.
pub fn test_refuse_expense_sheet_rejects_self_refusal(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    // Satisfies the is_org_employee gate so the call below reaches the SoD check
    // specifically, rather than failing earlier for an unrelated reason.
    super::wave_a_test::seed_caller_manager(ctx, &fixture)?;
    let employee_id = seed_employee_in(ctx, &fixture, fixture.company_id, "Wave G SoD Emp")?;
    let sheet_id = create_draft_sheet_in(
        ctx,
        &fixture,
        fixture.company_id,
        employee_id,
        "Wave G SoD Sheet",
    )?;
    let line_id = create_line_with_receipt_in(
        ctx,
        &fixture,
        fixture.company_id,
        employee_id,
        "Wave G SoD Line",
        30.0,
    )?;
    submit_expense(ctx, fixture.organization_id, line_id, sheet_id)?;
    // The test superuser identity both submits (via submit_expense_sheet, below)
    // and is the only caller available to attempt refuse — exactly the self-refuse
    // case the SoD guard must reject.
    submit_expense_sheet(ctx, fixture.organization_id, sheet_id)?;

    let self_refuse = refuse_expense_sheet(
        ctx,
        fixture.organization_id,
        sheet_id,
        RefuseExpenseSheetParams {
            reason: Some("self refuse attempt".into()),
        },
    );
    if self_refuse.is_ok() {
        return Err("submitter should not be able to refuse their own sheet (SoD)".into());
    }
    let refuse_err = self_refuse.err().unwrap_or_default();
    if !refuse_err.to_lowercase().contains("sod") {
        return Err(format!("expected SoD-specific error, got: {refuse_err}"));
    }
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("sheet after rejected self-refuse")?;
    if sheet.state != crate::types::ExpenseSheetState::Submitted {
        return Err(format!(
            "sheet state should be unchanged (Submitted), got {:?}",
            sheet.state
        ));
    }
    Ok(())
}
