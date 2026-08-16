//! Wave F — gate-enabled SoD approve, isolation (rebill/card/advance), period lock, CSV Draft-only.
use spacetimedb::{Identity, ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::fiscal_periods::{account_period, close_account_period};
use crate::data_ops::expenses_imports::import_expense_csv;
use crate::data_ops::import_tracker::{import_job, import_job_error};
use crate::expenses::expense_depth::{
    create_expense_project_rebill, CreateExpenseProjectRebillParams,
};
use crate::expenses::expense_wave_d::{
    apply_expense_advance_to_sheet, create_expense_advance, hr_expense_advance,
    ApplyExpenseAdvanceParams, CreateExpenseAdvanceParams,
};
use crate::expenses::expense_wave_e::{
    create_expense_card_statement_line, expense_card_statement_line,
    match_expense_card_statement_line, CreateExpenseCardStatementLineParams,
    MatchExpenseCardStatementLineParams,
};
use crate::expenses::expenses::{
    approve_expense_sheet, approve_expense_sheet_impl, create_expense, create_expense_sheet,
    expense_sheet, hr_expense, post_expense_sheet, submit_expense, submit_expense_sheet,
    CreateExpenseParams, CreateExpenseSheetParams, HrExpenseSheet, PostExpenseSheetParams,
};
use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountInternalGroup, EmploymentType, ExpenseLineKind, ExpensePaymentMode, ExpenseSheetState,
    ExpenseState, JournalType, PeriodState,
};

struct ExpenseAccounts {
    journal_id: u64,
    expense_id: u64,
    payable_id: u64,
    cash_id: u64,
    advance_id: u64,
}

fn seed_accounts(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<ExpenseAccounts, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let payable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("Harness missing AP")?;

    let expense_type_name = format!("WF Exp Type {company_id}");
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

    let expense_code = format!("6WFX{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: expense_code.clone(),
            name: "Wave F Travel".into(),
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

    let journal_code = format!("WF{company_id}");
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
                name: "Wave F Misc".into(),
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

    let asset_type_name = format!("WF Asset Type {company_id}");
    create_account_account_type(
        ctx,
        org_id,
        CreateAccountAccountTypeParams {
            company_id: Some(company_id),
            name: asset_type_name.clone(),
            type_: "asset".into(),
            include_initial_balance: false,
            internal_group: AccountInternalGroup::Asset,
            metadata: None,
        },
    )?;
    let asset_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == asset_type_name)
        .map(|t| t.id)
        .ok_or("asset type")?;
    let cash_code = format!("1WFC{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: cash_code.clone(),
            name: "Wave F Cash".into(),
            user_type_id: asset_type_id,
            currency_id: None,
            internal_type: None,
            internal_group: Some(AccountInternalGroup::Asset),
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
    let cash_id = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.code == cash_code)
        .map(|a| a.id)
        .ok_or("cash account")?;
    let advance_code = format!("1WFA{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: advance_code.clone(),
            name: "Wave F Advances".into(),
            user_type_id: asset_type_id,
            currency_id: None,
            internal_type: None,
            internal_group: Some(AccountInternalGroup::Asset),
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
    let advance_id = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.code == advance_code)
        .map(|a| a.id)
        .ok_or("advance account")?;

    Ok(ExpenseAccounts {
        journal_id,
        expense_id,
        payable_id,
        cash_id,
        advance_id,
    })
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

/// Spoof `submitted_by` to a dummy identity so `ctx.sender()` can act as approver B.
fn spoof_submitter_as_other(ctx: &ReducerContext, sheet_id: u64) -> Result<(), String> {
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("sheet for spoof")?;
    ctx.db.expense_sheet().id().update(HrExpenseSheet {
        submitted_by: Some(Identity::__dummy()),
        ..sheet
    });
    Ok(())
}

/// Gate-enabled SoD: self-approve fails; approver B path uses public reducer (`skip=false`).
/// The versioned human-task deferral path is covered by the focused workflow suite.
pub fn test_gate_enabled_sod_approve(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    super::wave_a_test::seed_caller_manager(ctx, &fixture)?;
    let employee_id = seed_employee(ctx, &fixture, "WF SoD Emp")?;
    let sheet_id = create_draft_sheet(ctx, &fixture, employee_id, "WF SoD Sheet")?;
    let line_id = create_line_with_receipt(ctx, &fixture, employee_id, "WF SoD Line", 90.0)?;
    submit_expense(ctx, fixture.organization_id, line_id, sheet_id)?;
    submit_expense_sheet(ctx, fixture.organization_id, sheet_id)?;

    // Identity A (submitter) cannot approve.
    let sod = approve_expense_sheet(ctx, fixture.organization_id, sheet_id);
    if sod.is_ok() {
        return Err("self-approve should fail SoD with gate enabled".into());
    }
    let sod_err = sod.err().unwrap_or_default();
    if !sod_err.to_lowercase().contains("sod") && !sod_err.contains("cannot approve") {
        return Err(format!("expected SoD error, got: {sod_err}"));
    }

    // Approver B: spoof submitter, then public approve with gate enabled (no rule → gate no-op).
    spoof_submitter_as_other(ctx, sheet_id)?;
    approve_expense_sheet(ctx, fixture.organization_id, sheet_id)?;
    let approved = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("sheet after gate approve")?;
    if approved.state != ExpenseSheetState::Approved {
        return Err(format!(
            "expected Approved after gate-enabled approve, got {:?}",
            approved.state
        ));
    }
    if approved.approver_id != Some(ctx.sender()) {
        return Err("approver_id should be current sender".into());
    }

    Ok(())
}

/// Company B cannot rebill / match card / apply advance against company A resources.
pub fn test_isolation_rebill_card_advance(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    super::wave_a_test::seed_caller_manager(ctx, &fixture_a)?;
    let accounts_a = seed_accounts(ctx, &fixture_a)?;
    let emp_a = seed_employee(ctx, &fixture_a, "WF Iso Emp A")?;
    let emp_b = seed_employee(ctx, &fixture_b, "WF Iso Emp B")?;

    // Posted sheet in A for rebill isolation (org B caller).
    let sheet_a = create_draft_sheet(ctx, &fixture_a, emp_a, "WF Iso Rebill Sheet")?;
    let line_a = create_line_with_receipt(ctx, &fixture_a, emp_a, "WF Iso Rebill Line", 70.0)?;
    submit_expense(ctx, fixture_a.organization_id, line_a, sheet_a)?;
    submit_expense_sheet(ctx, fixture_a.organization_id, sheet_a)?;
    approve_expense_sheet_impl(ctx, fixture_a.organization_id, sheet_a, true)?;
    post_expense_sheet(
        ctx,
        fixture_a.organization_id,
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
            client_request_id: Some("wf-iso-post".into()),
        },
    )?;

    let rebill_cross = create_expense_project_rebill(
        ctx,
        fixture_b.organization_id,
        sheet_a,
        CreateExpenseProjectRebillParams {
            journal_id: accounts_a.journal_id,
            receivable_account_id: *fixture_a
                .chart_account_ids
                .get(chart_keys::AR)
                .ok_or("AR")?,
            income_account_id: *fixture_a
                .chart_account_ids
                .get(chart_keys::REVENUE)
                .ok_or("REVENUE")?,
            invoice_date: ctx.timestamp,
            partner_id: None,
            fiscal_position_id: None,
            client_request_id: None,
        },
    );
    if rebill_cross.is_ok() {
        return Err("company B must not rebill company A sheet".into());
    }

    // Card: statement in B, expense in A — match under B must fail.
    create_expense(
        ctx,
        fixture_a.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture_a.company_id),
            employee_id: emp_a,
            name: "WF Iso Card Exp".into(),
            date: ctx.timestamp,
            unit_amount: 40.0,
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
            attachment_ids: vec![super::test_receipt_id(
                ctx,
                fixture_a.organization_id,
                fixture_a.company_id,
                emp_a,
            )?],
            client_request_id: Some("wf-iso-card-exp".into()),
            payment_mode: ExpensePaymentMode::CorporateCard,
            merchant_key: Some("iso-merchant".into()),
            policy_exception_reason: None,
        },
    )?;
    let exp_a = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| e.client_request_id.as_deref() == Some("wf-iso-card-exp"))
        .map(|e| e.id)
        .ok_or("card expense A")?;

    create_expense_card_statement_line(
        ctx,
        fixture_b.organization_id,
        CreateExpenseCardStatementLineParams {
            company_id: Some(fixture_b.company_id),
            external_ref: format!("WF-ISO-STMT-{}", fixture_b.company_id),
            merchant_key: Some("iso-merchant".into()),
            amount: 40.0,
            currency_id: 1,
            transaction_date: ctx.timestamp,
            fx_fee_amount: 0.0,
            metadata: None,
        },
    )?;
    let stmt_b = ctx
        .db
        .expense_card_statement_line()
        .iter()
        .find(|s| {
            s.organization_id == fixture_b.organization_id
                && s.external_ref == format!("WF-ISO-STMT-{}", fixture_b.company_id)
        })
        .map(|s| s.id)
        .ok_or("statement B")?;

    let match_cross = match_expense_card_statement_line(
        ctx,
        fixture_b.organization_id,
        stmt_b,
        MatchExpenseCardStatementLineParams {
            expense_id: exp_a,
            metadata: None,
        },
    );
    if match_cross.is_ok() {
        return Err("company B must not match company A expense to its statement".into());
    }

    // Advance: apply A advance onto B sheet must fail.
    create_expense_advance(
        ctx,
        fixture_a.organization_id,
        CreateExpenseAdvanceParams {
            company_id: Some(fixture_a.company_id),
            employee_id: emp_a,
            name: "WF Iso Advance".into(),
            amount: 50.0,
            currency_id: 1,
            journal_id: accounts_a.journal_id,
            cash_account_id: accounts_a.cash_id,
            advance_account_id: accounts_a.advance_id,
            accounting_date: ctx.timestamp,
            client_request_id: Some("wf-iso-adv".into()),
            metadata: None,
        },
    )?;
    let advance_a = ctx
        .db
        .hr_expense_advance()
        .iter()
        .find(|a| {
            a.organization_id == fixture_a.organization_id
                && a.client_request_id.as_deref() == Some("wf-iso-adv")
        })
        .map(|a| a.id)
        .ok_or("advance A")?;

    let sheet_b = create_draft_sheet(ctx, &fixture_b, emp_b, "WF Iso Adv Sheet B")?;
    let adv_cross = apply_expense_advance_to_sheet(
        ctx,
        fixture_a.organization_id,
        advance_a,
        sheet_b,
        ApplyExpenseAdvanceParams {
            amount: 10.0,
            metadata: None,
        },
    );
    if adv_cross.is_ok() {
        return Err("must not apply company A advance to company B sheet".into());
    }

    Ok(())
}

/// Closing the open accounting period rejects expense post.
pub fn test_locked_period_rejects_post(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    super::wave_a_test::seed_caller_manager(ctx, &fixture)?;
    let accounts = seed_accounts(ctx, &fixture)?;
    let employee_id = seed_employee(ctx, &fixture, "WF Lock Emp")?;
    let sheet_id = create_draft_sheet(ctx, &fixture, employee_id, "WF Lock Sheet")?;
    let line_id = create_line_with_receipt(ctx, &fixture, employee_id, "WF Lock Line", 25.0)?;
    submit_expense(ctx, fixture.organization_id, line_id, sheet_id)?;
    submit_expense_sheet(ctx, fixture.organization_id, sheet_id)?;
    approve_expense_sheet_impl(ctx, fixture.organization_id, sheet_id, true)?;

    let period_id = ctx
        .db
        .account_period()
        .period_by_company()
        .filter(&fixture.company_id)
        .find(|p| p.state == PeriodState::Open)
        .map(|p| p.id)
        .ok_or("open period missing")?;
    close_account_period(ctx, fixture.organization_id, fixture.company_id, period_id)?;

    let result = post_expense_sheet(
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
            client_request_id: Some("wf-lock-post".into()),
        },
    );
    match result {
        Ok(()) => Err("post should fail when accounting period is closed".into()),
        Err(msg)
            if msg.to_lowercase().contains("closed") || msg.to_lowercase().contains("period") =>
        {
            Ok(())
        }
        Err(msg) => Err(format!("unexpected post error under locked period: {msg}")),
    }
}

/// CSV expense import rejects Posted (and Done) without break-glass; Draft-only by default.
pub fn test_csv_draft_only(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "WF CSV Emp")?;
    let name = format!("WF CSV Posted {}", fixture.company_id);
    let csv = format!(
        "name,company_id,employee_id,currency_id,unit_amount,quantity,total_amount,state\n\
         {name},{},{},1,10,1,10,posted\n",
        fixture.company_id, employee_id
    );
    import_expense_csv(ctx, fixture.organization_id, csv)?;

    if ctx.db.hr_expense().iter().any(|e| {
        e.organization_id == fixture.organization_id
            && e.name == name
            && matches!(e.state, ExpenseState::Posted | ExpenseState::Done)
    }) {
        return Err("CSV must not import Posted/Done expense lines".into());
    }

    let job = ctx
        .db
        .import_job()
        .import_job_by_org()
        .filter(&fixture.organization_id)
        .filter(|j| j.table_name == "hr_expense")
        .max_by_key(|j| j.id)
        .ok_or("import job missing")?;
    if job.error_rows == 0 {
        return Err("expected CSV Posted row to record an import error".into());
    }
    let has_draft_msg = ctx
        .db
        .import_job_error()
        .import_error_by_job()
        .filter(&job.id)
        .any(|e| {
            e.error_message.contains("Draft")
                || e.error_message.contains("allow_non_draft")
                || e.raw_value.as_deref() == Some("posted")
        });
    if !has_draft_msg {
        return Err("expected Draft-only / posted rejection error on import job".into());
    }

    // Sanity: Draft row still imports.
    let draft_name = format!("WF CSV Draft {}", fixture.company_id);
    let draft_csv = format!(
        "name,company_id,employee_id,currency_id,unit_amount,quantity,total_amount,state\n\
         {draft_name},{},{},1,12,1,12,draft\n",
        fixture.company_id, employee_id
    );
    import_expense_csv(ctx, fixture.organization_id, draft_csv)?;
    let draft = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| e.organization_id == fixture.organization_id && e.name == draft_name)
        .ok_or("draft CSV row missing")?;
    if draft.state != ExpenseState::Draft {
        return Err(format!("expected Draft, got {:?}", draft.state));
    }
    Ok(())
}
