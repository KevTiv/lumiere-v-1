//! Wave B — policy caps, tax recovery, FX snapshot, remittance partner.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::accounting::tax_management::{
    account_tax, account_tax_group, create_account_tax, create_account_tax_group,
    CreateAccountTaxGroupParams, CreateAccountTaxParams,
};
use crate::core::reference::{create_currency_rate, CreateCurrencyRateParams};
use crate::expenses::expenses::{
    approve_expense_sheet_impl, create_expense, create_expense_sheet, expense_sheet, hr_expense,
    post_expense_sheet, submit_expense, submit_expense_sheet, upsert_expense_policy,
    CreateExpenseParams, CreateExpenseSheetParams, PostExpenseSheetParams, UpsertExpensePolicyParams,
};
use crate::hr::employees::{
    create_employee, hr_employee, update_employee, CreateEmployeeParams, UpdateEmployeeParams,
};
use crate::inventory::product::{create_product, product, CreateProductParams};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountInternalGroup, AccountMoveState, EmploymentType, ExpenseLineKind, ExpensePaymentMode, ExpenseSheetState, JournalType,
    TaxAmountType, TaxTypeUse,
};

struct ExpenseAccounts {
    journal_id: u64,
    expense_id: u64,
    payable_id: u64,
    tax_id: u64,
}

fn seed_accounts(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<ExpenseAccounts, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let payable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("Harness missing AP")?;

    let expense_type_name = format!("WB Exp Type {company_id}");
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

    let expense_code = format!("6WB{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: expense_code.clone(),
            name: "WB Travel".into(),
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

    let tax_type_name = format!("WB Tax Type {company_id}");
    create_account_account_type(
        ctx,
        org_id,
        CreateAccountAccountTypeParams {
            company_id: Some(company_id),
            name: tax_type_name.clone(),
            type_: "asset".into(),
            include_initial_balance: false,
            internal_group: AccountInternalGroup::Asset,
            metadata: None,
        },
    )?;
    let tax_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == tax_type_name)
        .map(|t| t.id)
        .ok_or("tax type")?;

    let tax_code = format!("1TAX{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: tax_code.clone(),
            name: "VAT Recoverable".into(),
            user_type_id: tax_type_id,
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
    let tax_id = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.code == tax_code)
        .map(|a| a.id)
        .ok_or("tax account")?;

    let journal_code = format!("WB{company_id}");
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
                name: "WB Misc".into(),
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
            .ok_or("wb journal")?
    };

    Ok(ExpenseAccounts {
        journal_id,
        expense_id,
        payable_id,
        tax_id,
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

fn create_expensed_product(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
    can_be_expensed: bool,
    expense_policy: &str,
    max_amount: Option<f64>,
) -> Result<u64, String> {
    let template = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("harness product missing")?;
    create_product(
        ctx,
        fixture.organization_id,
        CreateProductParams {
            name: name.to_string(),
            categ_id: template.categ_id,
            type_: "service".to_string(),
            uom_id: template.uom_id,
            uom_po_id: template.uom_po_id,
            standard_price: 0.0,
            list_price: 0.0,
            currency_id: 1,
            default_code: Some(format!("EXP-{name}")),
            barcode: None,
            description: None,
            sale_ok: Some(false),
            purchase_ok: Some(false),
            display_name: None,
            cost_method: None,
            valuation: None,
            volume: None,
            weight: None,
            can_be_expensed: Some(can_be_expensed),
            available_in_pos: Some(false),
            invoicing_policy: None,
            expense_policy: Some(expense_policy.to_string()),
            priority: None,
            is_published: None,
            description_purchase: None,
            description_sale: None,
            service_type: None,
            service_tracking: None,
            image_1920_url: None,
            image_128_url: None,
            color: None,
            responsible_id: None,
            pricelist_id: None,
            description_picking: None,
            description_pickingout: None,
            description_pickingin: None,
            location_id: None,
            warehouse_id: None,
            tracking: None,
            has_configurable_attributes: None,
            taxes_id: None,
            supplier_taxes_id: None,
            route_ids: None,
            route_from_categ_ids: None,
            property_account_income_id: None,
            property_account_expense_id: None,
            variant_attribute_ids: None,
            attribute_line_ids: None,
            metadata: max_amount.map(|m| {
                serde_json::json!({ "expense_max_amount": m }).to_string()
            }),
        },
    )?;
    ctx.db
        .product()
        .iter()
        .find(|p| p.organization_id == fixture.organization_id && p.name == name)
        .map(|p| p.id)
        .ok_or_else(|| format!("product {name}"))
}

pub fn test_product_policy_and_line_cap(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "Policy Emp")?;
    let blocked = create_expensed_product(ctx, &fixture, "Blocked Prod", false, "cost", None)?;
    let capped = create_expensed_product(ctx, &fixture, "Capped Prod", true, "cost", Some(50.0))?;

    let err = create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Blocked".into(),
            date: ctx.timestamp,
            unit_amount: 10.0,
            quantity: 1.0,
            currency_id: 1,
            product_id: Some(blocked),
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
            attachment_ids: vec![1],
            client_request_id: None,
            payment_mode: ExpensePaymentMode::OutOfPocket,
            merchant_key: None,
            policy_exception_reason: None,
        },
    );
    if err.is_ok() {
        return Err("non-expensable product should fail".into());
    }

    let over = create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Over cap".into(),
            date: ctx.timestamp,
            unit_amount: 80.0,
            quantity: 1.0,
            currency_id: 1,
            product_id: Some(capped),
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
            attachment_ids: vec![1],
            client_request_id: None,
            payment_mode: ExpensePaymentMode::OutOfPocket,
            merchant_key: None,
            policy_exception_reason: None,
        },
    );
    if over.is_ok() {
        return Err("product amount cap should fail".into());
    }

    upsert_expense_policy(
        ctx,
        fixture.organization_id,
        UpsertExpensePolicyParams {
            company_id: Some(fixture.company_id),
            max_line_amount: Some(25.0),
            max_sheet_amount: None,
            active: true,
            metadata: None,
        },
    )?;
    let company_cap = create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Company cap".into(),
            date: ctx.timestamp,
            unit_amount: 40.0,
            quantity: 1.0,
            currency_id: 1,
            product_id: Some(capped),
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
            attachment_ids: vec![1],
            client_request_id: None,
            payment_mode: ExpensePaymentMode::OutOfPocket,
            merchant_key: None,
            policy_exception_reason: None,
        },
    );
    if company_cap.is_ok() {
        return Err("company line cap should fail".into());
    }
    Ok(())
}

pub fn test_tax_recovery_and_partner_on_post(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let accounts = seed_accounts(ctx, &fixture)?;
    let employee_id = seed_employee(ctx, &fixture, "Tax Emp")?;
    update_employee(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        employee_id,
        UpdateEmployeeParams {
            name: None,
            job_title: None,
            job_id: None,
            department_id: None,
            parent_id: None,
            work_email: None,
            work_phone: None,
            mobile_phone: None,
            work_location: None,
            work_contact_partner_id: Some(fixture.partner_id),
            employment_type: None,
            user_id: None,
        },
    )?;

    create_account_tax_group(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountTaxGroupParams {
            name: format!("WB VAT Group {}", fixture.company_id),
            sequence: 10,
            preceding_subtotal: None,
            tax_payable_account_id: None,
            tax_receivable_account_id: Some(accounts.tax_id),
            advance_tax_payment_account_id: None,
            metadata: None,
        },
    )?;
    let group_id = ctx
        .db
        .account_tax_group()
        .iter()
        .find(|g| {
            g.organization_id == fixture.organization_id
                && g.company_id == fixture.company_id
                && g.name.contains("WB VAT Group")
        })
        .map(|g| g.id)
        .ok_or("tax group")?;

    create_account_tax(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountTaxParams {
            name: format!("WB VAT 10 {}", fixture.company_id),
            description: None,
            type_tax_use: TaxTypeUse::Purchase,
            amount_type: TaxAmountType::Percent,
            amount: 10.0,
            active: true,
            price_include: false,
            include_base_amount: false,
            is_base_affected: false,
            sequence: 10,
            tax_group_id: Some(group_id),
            country_id: None,
            country_code: None,
            tags: vec![],
            has_negative_factor: false,
            invoice_repartition_line_ids: vec![],
            refund_repartition_line_ids: vec![],
            metadata: None,
        },
    )?;
    let tax_def_id = ctx
        .db
        .account_tax()
        .iter()
        .find(|t| {
            t.organization_id == fixture.organization_id
                && t.company_id == fixture.company_id
                && t.name.contains("WB VAT 10")
        })
        .map(|t| t.id)
        .ok_or("tax")?;

    create_expense_sheet(
        ctx,
        fixture.organization_id,
        CreateExpenseSheetParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Tax Sheet".into(),
            currency_id: 1,
            notes: None,
            accounting_date: None,
        },
    )?;
    let sheet_id = ctx
        .db
        .expense_sheet()
        .iter()
        .find(|s| s.organization_id == fixture.organization_id && s.name == "Tax Sheet")
        .map(|s| s.id)
        .ok_or("sheet")?;

    create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Taxi".into(),
            date: ctx.timestamp,
            unit_amount: 100.0,
            quantity: 1.0,
            currency_id: 1,
            product_id: None,
            description: None,
            tax_ids: vec![tax_def_id],
            account_id: Some(accounts.expense_id),
            analytic_account_id: None,
            project_id: None,
            line_kind: ExpenseLineKind::Standard,
            mileage_distance: None,
            mileage_rate_id: None,
            per_diem_days: None,
            per_diem_rate_id: None,
            attachment_ids: vec![9],
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
        .find(|e| e.organization_id == fixture.organization_id && e.name == "Taxi")
        .map(|e| e.id)
        .ok_or("line")?;
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
            default_tax_account_id: Some(accounts.tax_id),
            card_liability_account_id: None,
            advance_account_id: None,
            fx_fee_account_id: None,
            fx_fee_amount: None,
            accounting_date: ctx.timestamp,
            client_request_id: Some("wb-tax".into()),
        },
    )?;

    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("posted sheet")?;
    let move_id = sheet.account_move_id.ok_or("move id")?;
    let mv = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("move")?;
    if mv.state != AccountMoveState::Posted {
        return Err("move not posted".into());
    }
    if (mv.amount_tax - 10.0).abs() > 0.01 {
        return Err(format!("expected tax 10, got {}", mv.amount_tax));
    }
    if (mv.amount_total - 110.0).abs() > 0.01 {
        return Err(format!("expected total 110, got {}", mv.amount_total));
    }
    if mv.partner_id != Some(fixture.partner_id) {
        return Err(format!(
            "expected partner {}, got {:?}",
            fixture.partner_id, mv.partner_id
        ));
    }
    let tax_line = ctx
        .db
        .account_move_line()
        .iter()
        .find(|l| l.move_id == move_id && l.account_id == accounts.tax_id)
        .ok_or("tax recovery line missing")?;
    if (tax_line.debit - 10.0).abs() > 0.01 {
        return Err(format!("tax debit expected 10, got {}", tax_line.debit));
    }
    Ok(())
}

pub fn test_fx_snapshot_on_submit(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let _ = create_currency_rate(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateCurrencyRateParams {
            from_currency: "EUR".into(),
            to_currency: "USD".into(),
            rate: 1.25,
            metadata: None,
        },
    );

    let employee_id = seed_employee(ctx, &fixture, "FX Emp")?;
    create_expense_sheet(
        ctx,
        fixture.organization_id,
        CreateExpenseSheetParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "FX Sheet".into(),
            currency_id: 2, // EUR
            notes: None,
            accounting_date: None,
        },
    )?;
    let sheet_id = ctx
        .db
        .expense_sheet()
        .iter()
        .find(|s| s.organization_id == fixture.organization_id && s.name == "FX Sheet")
        .map(|s| s.id)
        .ok_or("fx sheet")?;

    create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Euro lunch".into(),
            date: ctx.timestamp,
            unit_amount: 80.0,
            quantity: 1.0,
            currency_id: 2,
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
            attachment_ids: vec![3],
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
        .find(|e| e.organization_id == fixture.organization_id && e.name == "Euro lunch")
        .map(|e| e.id)
        .ok_or("fx line")?;
    submit_expense(ctx, fixture.organization_id, line_id, sheet_id)?;
    submit_expense_sheet(ctx, fixture.organization_id, sheet_id)?;

    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("submitted fx sheet")?;
    if sheet.state != ExpenseSheetState::Submitted {
        return Err("sheet not submitted".into());
    }
    if (sheet.currency_rate - 1.25).abs() > 0.0001 {
        return Err(format!(
            "expected FX rate 1.25, got {}",
            sheet.currency_rate
        ));
    }
    Ok(())
}
