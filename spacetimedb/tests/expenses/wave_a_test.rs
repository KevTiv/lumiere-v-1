//! Wave A expense lifecycle, isolation, SoD, refuse, and totals tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::account_move;
use crate::expenses::expenses::{
    approve_expense_sheet, approve_expense_sheet_impl, create_expense,
    create_expense_reimbursement_payment, create_expense_sheet, expense_sheet, hr_expense,
    post_expense_sheet, refuse_expense_sheet_impl, submit_expense, submit_expense_sheet,
    CreateExpenseParams, CreateExpenseReimbursementParams, CreateExpenseSheetParams,
    PostExpenseSheetParams, RefuseExpenseSheetParams,
};
use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountInternalGroup, AccountMoveState, EmploymentType, ExpenseLineKind, ExpensePaymentMode,
    ExpenseSheetState, ExpenseState, JournalType,
};

pub(super) struct ExpenseAccounts {
    pub(super) journal_id: u64,
    pub(super) expense_id: u64,
    pub(super) payable_id: u64,
    pub(super) liquidity_id: u64,
}

pub(super) fn seed_accounts(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
) -> Result<ExpenseAccounts, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let payable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("Harness missing AP")?;

    let expense_type_name = format!("Exp Type {company_id}");
    create_account_account_type(
        ctx,
        org_id,
        CreateAccountAccountTypeParams {
            company_id: Some(company_id),
            name: expense_type_name.clone(),
            type_: "expense".into(),
            include_initial_balance: false,
            internal_group: AccountInternalGroup::Expense,
            metadata: None,
        },
    )?;
    let expense_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == expense_type_name)
        .map(|t| t.id)
        .ok_or("expense type")?;

    let expense_code = format!("6EXP{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: expense_code.clone(),
            name: "Travel Expense".into(),
            user_type_id: expense_type_id,
            currency_id: None,
            internal_type: None,
            internal_group: Some(AccountInternalGroup::Expense),
            group_id: None,
            reconcile: false,
            tax_ids: vec![],
            note: None,
            opening_debit: 0.0,
            opening_credit: 0.0,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_off_balance: false,
            metadata: None,
        },
    )?;
    let expense_id = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.code == expense_code)
        .map(|a| a.id)
        .ok_or("expense account")?;

    let cash_type_name = format!("Cash Type {company_id}");
    create_account_account_type(
        ctx,
        org_id,
        CreateAccountAccountTypeParams {
            company_id: Some(company_id),
            name: cash_type_name.clone(),
            type_: "asset".into(),
            include_initial_balance: false,
            internal_group: AccountInternalGroup::Asset,
            metadata: None,
        },
    )?;
    let cash_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == cash_type_name)
        .map(|t| t.id)
        .ok_or("cash type")?;

    let cash_code = format!("1CASH{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: cash_code.clone(),
            name: "Cash".into(),
            user_type_id: cash_type_id,
            currency_id: None,
            internal_type: None,
            internal_group: Some(AccountInternalGroup::Asset),
            group_id: None,
            reconcile: true,
            tax_ids: vec![],
            note: None,
            opening_debit: 0.0,
            opening_credit: 0.0,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_off_balance: false,
            metadata: None,
        },
    )?;
    let liquidity_id = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.code == cash_code)
        .map(|a| a.id)
        .ok_or("cash account")?;

    let journal_code = format!("EX{company_id}");
    let journal_id = if let Some(j) = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == journal_code)
    {
        j.id
    } else {
        create_account_journal(
            ctx,
            org_id,
            CreateAccountJournalParams {
                company_id: Some(company_id),
                name: "Expense Misc".into(),
                code: journal_code.clone(),
                type_: JournalType::General,
                currency_id: Some(1),
                default_account_id: Some(expense_id),
                suspense_account_id: None,
                loss_account_id: None,
                profit_account_id: None,
                bank_account_id: None,
                payment_credit_account_id: None,
                payment_debit_account_id: None,
                invoice_reference_type: None,
                invoice_reference_model: None,
                sequence_id: None,
                refund_sequence_id: None,
                sequence_override_regex: None,
                secure_sequence_id: None,
                alias_name: None,
                alias_domain: None,
                sale_activity_type_id: None,
                sale_activity_user_id: None,
                sale_activity_note: None,
                sale_activity_date_deadline: None,
                restrict_mode_hash_table: false,
                active: true,
                at_least_one_inbound: true,
                at_least_one_outbound: true,
                dedicated_payment_method_ids: vec![],
                sale_activity_done: false,
                metadata: None,
            },
        )?;
        ctx.db
            .account_journal()
            .iter()
            .find(|j| j.organization_id == org_id && j.code == journal_code)
            .map(|j| j.id)
            .ok_or("expense journal")?
    };

    Ok(ExpenseAccounts {
        journal_id,
        expense_id,
        payable_id,
        liquidity_id,
    })
}

/// approve_expense_sheet_impl/refuse_expense_sheet_impl (EXP-007/EXP-011) require
/// the caller to be a registered hr_employee in the org — create_employee never
/// sets user_id itself, so this links a fresh employee to the test caller's own
/// identity via update_employee. Every reducer call in a test reducer shares the
/// same ctx.sender(), so this is the only way to satisfy that check here; the
/// SoD guards (submitted_by == ctx.sender()) are still meaningfully exercised
/// since submitted_by is independently set to ctx.sender() at submit time.
pub(super) fn seed_caller_manager(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let name = format!("Caller Manager {}", fixture.organization_id);
    let manager_id = seed_employee(ctx, fixture, &name)?;
    crate::hr::employees::update_employee(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        manager_id,
        crate::hr::employees::UpdateEmployeeParams {
            name: None,
            job_title: None,
            job_id: None,
            department_id: None,
            parent_id: None,
            work_email: None,
            work_phone: None,
            mobile_phone: None,
            work_location: None,
            work_contact_partner_id: None,
            employment_type: None,
            user_id: Some(ctx.sender()),
        },
    )?;
    Ok(manager_id)
}

fn seed_employee(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_employee(
        ctx,
        fixture.organization_id,
        CreateEmployeeParams {
            company_id: Some(fixture.company_id),
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

fn create_line_with_receipt(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    employee_id: u64,
    name: &str,
    amount: f64,
) -> Result<u64, String> {
    let receipt_id = super::test_receipt_id(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        employee_id,
    )?;
    create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
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

fn create_draft_sheet(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    employee_id: u64,
    name: &str,
) -> Result<u64, String> {
    create_expense_sheet(
        ctx,
        fixture.organization_id,
        CreateExpenseSheetParams {
            company_id: Some(fixture.company_id),
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

/// Happy path: create → attach → submit (server total) → approve (impl) → post JE → reimburse.
pub fn test_expense_lifecycle_posts_move(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    seed_caller_manager(ctx, &fixture)?;
    let accounts = seed_accounts(ctx, &fixture)?;
    let employee_id = seed_employee(ctx, &fixture, "Traveler A")?;
    let sheet_id = create_draft_sheet(ctx, &fixture, employee_id, "Trip A")?;
    let line_id = create_line_with_receipt(ctx, &fixture, employee_id, "Flight A", 120.0)?;
    submit_expense(ctx, fixture.organization_id, line_id, sheet_id)?;
    submit_expense_sheet(ctx, fixture.organization_id, sheet_id)?;

    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("sheet after submit")?;
    if sheet.state != ExpenseSheetState::Submitted {
        return Err(format!("expected Submitted, got {:?}", sheet.state));
    }
    if (sheet.total_amount - 120.0).abs() > 0.001 {
        return Err(format!("expected total 120, got {}", sheet.total_amount));
    }

    // Same identity as submitter — public approve must SoD-fail.
    let sod = approve_expense_sheet(ctx, fixture.organization_id, sheet_id);
    if sod.is_ok() {
        return Err("self-approve should fail SoD".into());
    }

    approve_expense_sheet_impl(ctx, fixture.organization_id, sheet_id, true)?;
    post_expense_sheet(
        ctx,
        fixture.organization_id,
        sheet_id,
        PostExpenseSheetParams {
            journal_id: accounts.journal_id,
            payable_account_id: accounts.payable_id,
            default_expense_account_id: accounts.expense_id,
            default_tax_account_id: None,
            card_liability_account_id: None,
            advance_account_id: None,
            fx_fee_account_id: None,
            fx_fee_amount: None,
            accounting_date: ctx.timestamp,
            client_request_id: Some("post-1".into()),
        },
    )?;

    let posted = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("sheet after post")?;
    if posted.state != ExpenseSheetState::Posted {
        return Err(format!("expected Posted, got {:?}", posted.state));
    }
    let move_id = posted.account_move_id.ok_or("account_move_id unset")?;
    let mv = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("move missing")?;
    if mv.state != AccountMoveState::Posted {
        return Err("move not posted".into());
    }
    if (mv.amount_total - 120.0).abs() > 0.001 {
        return Err(format!("move total {}, expected 120", mv.amount_total));
    }

    let line = ctx.db.hr_expense().id().find(&line_id).ok_or("line")?;
    if line.state != ExpenseState::Posted {
        return Err(format!("line state {:?}, expected Posted", line.state));
    }

    create_expense_reimbursement_payment(
        ctx,
        fixture.organization_id,
        sheet_id,
        CreateExpenseReimbursementParams {
            journal_id: accounts.journal_id,
            liquidity_account_id: accounts.liquidity_id,
            payable_account_id: accounts.payable_id,
            payment_date: ctx.timestamp,
            amount: None,
            client_request_id: Some("reim-1".into()),
        },
    )?;
    let done = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("sheet after reimburse")?;
    if done.state != ExpenseSheetState::Done {
        return Err(format!("expected Done, got {:?}", done.state));
    }
    if done.reimbursement_move_id.is_none() {
        return Err("reimbursement_move_id unset".into());
    }
    Ok(())
}

pub fn test_refuse_only_from_submitted(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    seed_caller_manager(ctx, &fixture)?;
    let employee_id = seed_employee(ctx, &fixture, "Traveler B")?;
    let sheet_id = create_draft_sheet(ctx, &fixture, employee_id, "Trip B")?;
    let line_id = create_line_with_receipt(ctx, &fixture, employee_id, "Hotel B", 80.0)?;
    submit_expense(ctx, fixture.organization_id, line_id, sheet_id)?;

    // Refuse while Draft must fail.
    let early = refuse_expense_sheet_impl(
        ctx,
        fixture.organization_id,
        sheet_id,
        RefuseExpenseSheetParams {
            reason: Some("too early".into()),
        },
        true,
    );
    if early.is_ok() {
        return Err("refuse on Draft should fail".into());
    }

    submit_expense_sheet(ctx, fixture.organization_id, sheet_id)?;
    // skip_approval_check=true: this test's single identity both submits and
    // refuses, which the public reducer's SoD guard (EXP-011) would otherwise
    // reject — that guard has its own dedicated test below.
    refuse_expense_sheet_impl(
        ctx,
        fixture.organization_id,
        sheet_id,
        RefuseExpenseSheetParams {
            reason: Some("policy".into()),
        },
        true,
    )?;
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("refused sheet")?;
    if sheet.state != ExpenseSheetState::Refused {
        return Err(format!("expected Refused, got {:?}", sheet.state));
    }
    let line = ctx.db.hr_expense().id().find(&line_id).ok_or("line")?;
    if line.state != ExpenseState::Draft || line.sheet_id.is_some() {
        return Err("refused lines should return to Draft without sheet".into());
    }

    // Refuse Posted must fail — re-run lifecycle fragment to get Posted then refuse.
    let accounts = seed_accounts(ctx, &fixture)?;
    let sheet2 = create_draft_sheet(ctx, &fixture, employee_id, "Trip B2")?;
    let line2 = create_line_with_receipt(ctx, &fixture, employee_id, "Taxi B2", 40.0)?;
    submit_expense(ctx, fixture.organization_id, line2, sheet2)?;
    submit_expense_sheet(ctx, fixture.organization_id, sheet2)?;
    approve_expense_sheet_impl(ctx, fixture.organization_id, sheet2, true)?;
    post_expense_sheet(
        ctx,
        fixture.organization_id,
        sheet2,
        PostExpenseSheetParams {
            journal_id: accounts.journal_id,
            payable_account_id: accounts.payable_id,
            default_expense_account_id: accounts.expense_id,
            default_tax_account_id: None,
            card_liability_account_id: None,
            advance_account_id: None,
            fx_fee_account_id: None,
            fx_fee_amount: None,
            accounting_date: ctx.timestamp,
            client_request_id: None,
        },
    )?;
    let refuse_posted = refuse_expense_sheet_impl(
        ctx,
        fixture.organization_id,
        sheet2,
        RefuseExpenseSheetParams { reason: None },
        true,
    );
    if refuse_posted.is_ok() {
        return Err("refuse on Posted should fail".into());
    }
    Ok(())
}

pub fn test_company_isolation_on_post(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    seed_caller_manager(ctx, &fixture_a)?;
    let accounts_a = seed_accounts(ctx, &fixture_a)?;
    let employee_a = seed_employee(ctx, &fixture_a, "Iso Emp A")?;
    let sheet_a = create_draft_sheet(ctx, &fixture_a, employee_a, "Iso Sheet A")?;
    let line_a = create_line_with_receipt(ctx, &fixture_a, employee_a, "Iso Line A", 55.0)?;
    submit_expense(ctx, fixture_a.organization_id, line_a, sheet_a)?;
    submit_expense_sheet(ctx, fixture_a.organization_id, sheet_a)?;
    approve_expense_sheet_impl(ctx, fixture_a.organization_id, sheet_a, true)?;

    let cross = post_expense_sheet(
        ctx,
        fixture_b.organization_id,
        sheet_a,
        PostExpenseSheetParams {
            journal_id: accounts_a.journal_id,
            payable_account_id: accounts_a.payable_id,
            default_expense_account_id: accounts_a.expense_id,
            default_tax_account_id: None,
            card_liability_account_id: None,
            advance_account_id: None,
            fx_fee_account_id: None,
            fx_fee_amount: None,
            accounting_date: ctx.timestamp,
            client_request_id: None,
        },
    );
    if cross.is_ok() {
        return Err("company B must not post company A sheet".into());
    }
    Ok(())
}

pub fn test_submit_rejects_missing_receipt(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "No Receipt Emp")?;
    let sheet_id = create_draft_sheet(ctx, &fixture, employee_id, "No Receipt Sheet")?;
    create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "No receipt".into(),
            date: ctx.timestamp,
            unit_amount: 10.0,
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
            attachment_ids: vec![],
            client_request_id: None,
            payment_mode: ExpensePaymentMode::OutOfPocket,
            merchant_key: None,
            policy_exception_reason: None,
        },
    )?;
    let line_id = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| e.organization_id == fixture.organization_id && e.name == "No receipt")
        .map(|e| e.id)
        .ok_or("line")?;
    submit_expense(ctx, fixture.organization_id, line_id, sheet_id)?;
    let err = submit_expense_sheet(ctx, fixture.organization_id, sheet_id);
    if err.is_ok() {
        return Err("submit without receipts should fail".into());
    }
    Ok(())
}
