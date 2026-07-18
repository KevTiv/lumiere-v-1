//! Wave C — mileage/per diem, allocations, project rebill, idempotent create.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::account_move;
use crate::expenses::expense_depth::{
    create_expense_project_rebill, hr_expense_allocation, hr_expense_mileage_rate,
    hr_expense_per_diem_rate, set_expense_allocations, upsert_expense_mileage_rate,
    upsert_expense_per_diem_rate, CreateExpenseProjectRebillParams, ExpenseAllocationLineParams,
    SetExpenseAllocationsParams, UpsertExpenseMileageRateParams, UpsertExpensePerDiemRateParams,
};
use crate::expenses::expenses::{
    approve_expense_sheet_impl, create_expense, create_expense_sheet, expense_sheet, hr_expense,
    post_expense_sheet, submit_expense, submit_expense_sheet, CreateExpenseParams,
    CreateExpenseSheetParams, PostExpenseSheetParams,
};
use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::projects::projects::{create_project, project_project, CreateProjectParams};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountInternalGroup, AccountMoveState, EmploymentType, ExpenseLineKind, ExpensePaymentMode, ExpenseSheetState,
    JournalType, MoveType,
};

struct ExpenseAccounts {
    journal_id: u64,
    expense_id: u64,
    payable_id: u64,
    receivable_id: u64,
    income_id: u64,
}

fn seed_accounts(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<ExpenseAccounts, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let payable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("Harness missing AP")?;
    let receivable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("Harness missing AR")?;
    let income_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("Harness missing REVENUE")?;

    let expense_type_name = format!("WC Exp Type {company_id}");
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
    let expense_code = format!("6WC{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: expense_code.clone(),
            name: "WC Travel".into(),
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

    let journal_code = format!("WC{company_id}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: "WC Misc".into(),
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
    let journal_id = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == journal_code)
        .map(|j| j.id)
        .ok_or("journal")?;

    Ok(ExpenseAccounts {
        journal_id,
        expense_id,
        payable_id,
        receivable_id,
        income_id,
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
        .ok_or_else(|| format!("employee {name}"))
}

pub fn test_mileage_line_from_rate(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "Mileage Emp")?;
    upsert_expense_mileage_rate(
        ctx,
        fixture.organization_id,
        None,
        UpsertExpenseMileageRateParams {
            company_id: Some(fixture.company_id),
            name: "ATO km".into(),
            currency_id: 1,
            rate_per_unit: 0.85,
            unit: "km".into(),
            effective_from: None,
            effective_to: None,
            active: true,
            metadata: None,
        },
    )?;
    let rate_id = ctx
        .db
        .hr_expense_mileage_rate()
        .iter()
        .find(|r| r.organization_id == fixture.organization_id && r.name == "ATO km")
        .map(|r| r.id)
        .ok_or("mileage rate")?;

    create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Client drive".into(),
            date: ctx.timestamp,
            unit_amount: 0.0,
            quantity: 1.0,
            currency_id: 1,
            product_id: None,
            description: None,
            tax_ids: vec![],
            account_id: None,
            analytic_account_id: None,
            project_id: None,
            line_kind: ExpenseLineKind::Mileage,
            mileage_distance: Some(100.0),
            mileage_rate_id: Some(rate_id),
            per_diem_days: None,
            per_diem_rate_id: None,
            attachment_ids: vec![],
            client_request_id: Some("mile-1".into()),
            payment_mode: ExpensePaymentMode::OutOfPocket,
            merchant_key: None,
            policy_exception_reason: None,
        },
    )?;
    let line = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| e.organization_id == fixture.organization_id && e.name == "Client drive")
        .ok_or("mileage line")?;
    if (line.total_amount - 85.0).abs() > 0.001 {
        return Err(format!("expected 85.0, got {}", line.total_amount));
    }
    // Idempotent replay
    create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Client drive dup".into(),
            date: ctx.timestamp,
            unit_amount: 0.0,
            quantity: 1.0,
            currency_id: 1,
            product_id: None,
            description: None,
            tax_ids: vec![],
            account_id: None,
            analytic_account_id: None,
            project_id: None,
            line_kind: ExpenseLineKind::Mileage,
            mileage_distance: Some(100.0),
            mileage_rate_id: Some(rate_id),
            per_diem_days: None,
            per_diem_rate_id: None,
            attachment_ids: vec![],
            client_request_id: Some("mile-1".into()),
            payment_mode: ExpensePaymentMode::OutOfPocket,
            merchant_key: None,
            policy_exception_reason: None,
        },
    )?;
    let count = ctx
        .db
        .hr_expense()
        .iter()
        .filter(|e| {
            e.organization_id == fixture.organization_id
                && e.client_request_id.as_deref() == Some("mile-1")
        })
        .count();
    if count != 1 {
        return Err(format!("expected 1 idempotent row, got {count}"));
    }
    Ok(())
}

pub fn test_allocations_and_project_rebill(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let accounts = seed_accounts(ctx, &fixture)?;
    let employee_id = seed_employee(ctx, &fixture, "Alloc Emp")?;

    create_project(
        ctx,
        fixture.organization_id,
        CreateProjectParams {
            company_id: Some(fixture.company_id),
            name: format!("Billable {}", fixture.company_id),
            description: None,
            active: true,
            sequence: 1,
            currency_id: 1,
            partner_id: Some(fixture.partner_id),
            partner_email: None,
            partner_phone: None,
            partner_company_id: None,
            date_start: None,
            date: None,
            date_end: None,
            allow_subtasks: true,
            allow_recurring_tasks: false,
            allow_task_dependencies: false,
            allow_timesheets: true,
            allow_timesheet_timer: false,
            allow_material: false,
            allow_worksheets: false,
            allow_forecast: false,
            allow_wip_je: false,
            bill_type: "customer_project".into(),
            pricing_type: "fixed_rate".into(),
            rating_status: "off".into(),
            rating_status_period: "monthly".into(),
            privacy_visibility: "employees".into(),
            access_instruction_message: None,
            task_count: 0,
            task_count_open: 0,
            task_count_closed: 0,
            task_count_in_progress: 0,
            task_count_blocked: 0,
            sale_order_id: None,
            sale_line_id: None,
            last_update_status: "on_track".into(),
            last_update_color: None,
            is_favorite: false,
            color: None,
            stage_id: None,
            analytic_account_id: None,
            activity_ids: vec![],
            activity_state: None,
            activity_date_deadline: None,
            activity_type_id: None,
            activity_user_id: None,
            activity_summary: None,
            message_follower_ids: vec![],
            message_ids: vec![],
            metadata: None,
        },
    )?;
    let project_id = ctx
        .db
        .project_project()
        .iter()
        .find(|p| {
            p.organization_id == fixture.organization_id
                && p.name == format!("Billable {}", fixture.company_id)
        })
        .map(|p| p.id)
        .ok_or("project")?;

    create_expense_sheet(
        ctx,
        fixture.organization_id,
        CreateExpenseSheetParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Alloc Sheet".into(),
            currency_id: 1,
            notes: None,
            accounting_date: None,
        },
    )?;
    let sheet_id = ctx
        .db
        .expense_sheet()
        .iter()
        .find(|s| s.organization_id == fixture.organization_id && s.name == "Alloc Sheet")
        .map(|s| s.id)
        .ok_or("sheet")?;

    create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Hotel".into(),
            date: ctx.timestamp,
            unit_amount: 200.0,
            quantity: 1.0,
            currency_id: 1,
            product_id: None,
            description: None,
            tax_ids: vec![],
            account_id: Some(accounts.expense_id),
            analytic_account_id: None,
            project_id: Some(project_id),
            line_kind: ExpenseLineKind::Standard,
            mileage_distance: None,
            mileage_rate_id: None,
            per_diem_days: None,
            per_diem_rate_id: None,
            attachment_ids: vec![1],
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
        .find(|e| e.organization_id == fixture.organization_id && e.name == "Hotel")
        .map(|e| e.id)
        .ok_or("line")?;

    set_expense_allocations(
        ctx,
        fixture.organization_id,
        line_id,
        SetExpenseAllocationsParams {
            lines: vec![
                ExpenseAllocationLineParams {
                    analytic_account_id: None,
                    project_id: Some(project_id),
                    share_percent: 60.0,
                    billable: true,
                    metadata: None,
                },
                ExpenseAllocationLineParams {
                    analytic_account_id: None,
                    project_id: Some(project_id),
                    share_percent: 40.0,
                    billable: false,
                    metadata: None,
                },
            ],
        },
    )?;
    let alloc_sum: f64 = ctx
        .db
        .hr_expense_allocation()
        .allocation_by_expense()
        .filter(&line_id)
        .map(|a| a.amount)
        .sum();
    if (alloc_sum - 200.0).abs() > 0.01 {
        return Err(format!("alloc sum expected 200, got {alloc_sum}"));
    }

    submit_expense(ctx, fixture.organization_id, line_id, sheet_id)?;
    submit_expense_sheet(ctx, fixture.organization_id, sheet_id)?;
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
            client_request_id: Some("wc-post".into()),
        },
    )?;

    create_expense_project_rebill(
        ctx,
        fixture.organization_id,
        sheet_id,
        CreateExpenseProjectRebillParams {
            journal_id: accounts.journal_id,
            receivable_account_id: accounts.receivable_id,
            income_account_id: accounts.income_id,
            invoice_date: ctx.timestamp,
            partner_id: None,
            client_request_id: Some("wc-rebill".into()),
        },
    )?;
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("sheet after rebill")?;
    let rebill_id = sheet.rebill_move_id.ok_or("rebill_move_id unset")?;
    let mv = ctx
        .db
        .account_move()
        .id()
        .find(&rebill_id)
        .ok_or("rebill move")?;
    if mv.move_type != MoveType::OutInvoice || mv.state != AccountMoveState::Posted {
        return Err("rebill move must be posted OutInvoice".into());
    }
    // Only billable 60% → 120
    if (mv.amount_total - 120.0).abs() > 0.01 {
        return Err(format!("expected rebill 120, got {}", mv.amount_total));
    }
    if sheet.state != ExpenseSheetState::Posted {
        // still Posted is fine
    }
    Ok(())
}

pub fn test_per_diem_rate(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "PerDiem Emp")?;
    upsert_expense_per_diem_rate(
        ctx,
        fixture.organization_id,
        None,
        UpsertExpensePerDiemRateParams {
            company_id: Some(fixture.company_id),
            name: "NYC".into(),
            currency_id: 1,
            location_code: "US-NYC".into(),
            amount_per_day: 75.0,
            effective_from: None,
            effective_to: None,
            active: true,
            metadata: None,
        },
    )?;
    let rate_id = ctx
        .db
        .hr_expense_per_diem_rate()
        .iter()
        .find(|r| r.organization_id == fixture.organization_id && r.location_code == "US-NYC")
        .map(|r| r.id)
        .ok_or("per diem rate")?;
    create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "NYC trip".into(),
            date: ctx.timestamp,
            unit_amount: 0.0,
            quantity: 1.0,
            currency_id: 1,
            product_id: None,
            description: None,
            tax_ids: vec![],
            account_id: None,
            analytic_account_id: None,
            project_id: None,
            line_kind: ExpenseLineKind::PerDiem,
            mileage_distance: None,
            mileage_rate_id: None,
            per_diem_days: Some(3.0),
            per_diem_rate_id: Some(rate_id),
            attachment_ids: vec![],
            client_request_id: None,
            payment_mode: ExpensePaymentMode::OutOfPocket,
            merchant_key: None,
            policy_exception_reason: None,
        },
    )?;
    let line = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| e.organization_id == fixture.organization_id && e.name == "NYC trip")
        .ok_or("per diem line")?;
    if (line.total_amount - 225.0).abs() > 0.001 {
        return Err(format!("expected 225, got {}", line.total_amount));
    }
    Ok(())
}
