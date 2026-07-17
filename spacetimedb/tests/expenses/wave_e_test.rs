//! Wave E — pack tax evidence, card statement match, OCR/email intents, FX fees.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::account_move_line;
use crate::core::country_pack::{
    country_pack_definition, set_company_country_pack, SetCompanyCountryPackParams,
};
use crate::expenses::expense_wave_d::{
    apply_expense_integration_intent, create_expense_integration_intent,
    expense_integration_intent, CreateExpenseIntegrationIntentParams,
};
use crate::expenses::expense_wave_e::{
    apply_pending_expense_integration_intents, create_expense_card_statement_line,
    expense_card_statement_line, match_expense_card_statement_line,
    CreateExpenseCardStatementLineParams, MatchExpenseCardStatementLineParams,
};
use crate::expenses::expenses::{
    approve_expense_sheet_impl, create_expense, create_expense_sheet, expense_sheet, hr_expense,
    post_expense_sheet, submit_expense, submit_expense_sheet, CreateExpenseParams,
    CreateExpenseSheetParams, PostExpenseSheetParams,
};
use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountInternalGroup, EmploymentType, ExpenseLineKind, ExpensePaymentMode, ExpenseSheetState,
    JournalType,
};

struct ExpenseAccounts {
    journal_id: u64,
    expense_id: u64,
    payable_id: u64,
    card_liability_id: u64,
    fx_fee_id: u64,
}

fn seed_accounts(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<ExpenseAccounts, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let payable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("Harness missing AP")?;

    let type_name = format!("WE Exp Type {company_id}");
    create_account_account_type(
        ctx,
        org_id,
        CreateAccountAccountTypeParams {
            company_id: Some(company_id),
            name: type_name.clone(),
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
        .find(|t| t.organization_id == org_id && t.name == type_name)
        .map(|t| t.id)
        .ok_or("expense type")?;

    let liability_type_name = format!("WE Liab Type {company_id}");
    create_account_account_type(
        ctx,
        org_id,
        CreateAccountAccountTypeParams {
            company_id: Some(company_id),
            name: liability_type_name.clone(),
            type_: "liability".into(),
            include_initial_balance: false,
            internal_group: AccountInternalGroup::Liability,
            metadata: None,
        },
    )?;
    let liability_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == liability_type_name)
        .map(|t| t.id)
        .ok_or("liability type")?;

    let mk_account = |code: String,
                      name: String,
                      type_id: u64,
                      group: AccountInternalGroup|
     -> Result<u64, String> {
        create_account_account(
            ctx,
            org_id,
            CreateAccountAccountParams {
                company_id: Some(company_id),
                code: code.clone(),
                name,
                user_type_id: type_id,
                currency_id: None,
                internal_type: None,
                internal_group: Some(group),
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
        ctx.db
            .account_account()
            .iter()
            .find(|a| a.organization_id == org_id && a.code == code)
            .map(|a| a.id)
            .ok_or_else(|| format!("account {code}"))
    };

    let expense_id = mk_account(
        format!("WE-EXP-{company_id}"),
        "WE Expense".into(),
        expense_type_id,
        AccountInternalGroup::Expense,
    )?;
    let fx_fee_id = mk_account(
        format!("WE-FX-{company_id}"),
        "WE FX Fee".into(),
        expense_type_id,
        AccountInternalGroup::Expense,
    )?;
    let card_liability_id = mk_account(
        format!("WE-CARD-{company_id}"),
        "WE Card Liab".into(),
        liability_type_id,
        AccountInternalGroup::Liability,
    )?;

    let journal_code = format!("WEM{company_id}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: "WE Misc".into(),
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
        card_liability_id,
        fx_fee_id,
    })
}

fn seed_employee(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    create_employee(
        ctx,
        fixture.organization_id,
        CreateEmployeeParams {
            company_id: Some(fixture.company_id),
            name: format!("WE Emp {}", fixture.company_id),
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
        .find(|e| e.organization_id == fixture.organization_id && e.name.contains("WE Emp"))
        .map(|e| e.id)
        .ok_or("employee".into())
}

pub fn test_pack_tax_evidence_required(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture)?;

    // Ensure AU pack definition exists (seeded by migrations / catalog).
    if ctx
        .db
        .country_pack_definition()
        .pack_key()
        .find(&"au".to_string())
        .is_none()
    {
        return Err("au country pack missing — run migrations".into());
    }
    set_company_country_pack(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        SetCompanyCountryPackParams {
            pack_key: "au".into(),
            enabled: true,
            configuration: None,
        },
    )?;

    create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Pack no tax".into(),
            date: ctx.timestamp,
            unit_amount: 25.0,
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
            attachment_ids: vec![1],
            client_request_id: Some("we-pack-1".into()),
            payment_mode: ExpensePaymentMode::OutOfPocket,
            merchant_key: None,
            policy_exception_reason: None,
        },
    )?;
    let line = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| e.client_request_id.as_deref() == Some("we-pack-1"))
        .ok_or("line")?;
    create_expense_sheet(
        ctx,
        fixture.organization_id,
        CreateExpenseSheetParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "WE Pack Sheet".into(),
            currency_id: 1,
            notes: None,
            accounting_date: None,
        },
    )?;
    let sheet_id = ctx
        .db
        .expense_sheet()
        .iter()
        .find(|s| s.name == "WE Pack Sheet")
        .map(|s| s.id)
        .ok_or("sheet")?;
    submit_expense(ctx, fixture.organization_id, line.id, sheet_id)?;
    let err = submit_expense_sheet(ctx, fixture.organization_id, sheet_id).err();
    if !err
        .as_ref()
        .map(|e| e.contains("tax evidence"))
        .unwrap_or(false)
    {
        return Err(format!("expected pack tax evidence error, got {err:?}"));
    }
    Ok(())
}

pub fn test_card_statement_match_and_fx_fee(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let accounts = seed_accounts(ctx, &fixture)?;
    let employee_id = seed_employee(ctx, &fixture)?;

    create_expense(
        ctx,
        fixture.organization_id,
        CreateExpenseParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Intl hotel".into(),
            date: ctx.timestamp,
            unit_amount: 100.0,
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
            attachment_ids: vec![1],
            client_request_id: Some("we-card-1".into()),
            payment_mode: ExpensePaymentMode::CorporateCard,
            merchant_key: Some("hilton".into()),
            policy_exception_reason: None,
        },
    )?;
    let line = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| e.client_request_id.as_deref() == Some("we-card-1"))
        .ok_or("card expense")?;

    create_expense_card_statement_line(
        ctx,
        fixture.organization_id,
        CreateExpenseCardStatementLineParams {
            company_id: Some(fixture.company_id),
            external_ref: "STMT-WE-1".into(),
            merchant_key: Some("hilton".into()),
            amount: 100.0,
            currency_id: 1,
            transaction_date: ctx.timestamp,
            fx_fee_amount: 3.5,
            metadata: None,
        },
    )?;
    let stmt = ctx
        .db
        .expense_card_statement_line()
        .iter()
        .find(|s| s.external_ref == "STMT-WE-1")
        .ok_or("statement")?;
    match_expense_card_statement_line(
        ctx,
        fixture.organization_id,
        stmt.id,
        MatchExpenseCardStatementLineParams {
            expense_id: line.id,
            metadata: None,
        },
    )?;

    create_expense_sheet(
        ctx,
        fixture.organization_id,
        CreateExpenseSheetParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "WE FX Sheet".into(),
            currency_id: 1,
            notes: None,
            accounting_date: None,
        },
    )?;
    let sheet_id = ctx
        .db
        .expense_sheet()
        .iter()
        .find(|s| s.name == "WE FX Sheet")
        .map(|s| s.id)
        .ok_or("sheet")?;
    submit_expense(ctx, fixture.organization_id, line.id, sheet_id)?;
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
            card_liability_account_id: Some(accounts.card_liability_id),
            advance_account_id: None,
            fx_fee_account_id: Some(accounts.fx_fee_id),
            fx_fee_amount: None,
            accounting_date: ctx.timestamp,
            client_request_id: Some("we-fx-post".into()),
        },
    )?;
    let fx_debit: f64 = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.account_id == accounts.fx_fee_id && l.debit > 0.0)
        .map(|l| l.debit)
        .sum();
    if (fx_debit - 3.5).abs() > 0.01 {
        return Err(format!("expected FX fee debit 3.5, got {fx_debit}"));
    }
    let card_credit: f64 = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.account_id == accounts.card_liability_id && l.credit > 0.0)
        .map(|l| l.credit)
        .sum();
    if (card_credit - 103.5).abs() > 0.01 {
        return Err(format!("expected card credit 103.5, got {card_credit}"));
    }
    let sheet = ctx.db.expense_sheet().id().find(&sheet_id).ok_or("sheet")?;
    if sheet.state != ExpenseSheetState::Posted {
        return Err("sheet not posted".into());
    }
    Ok(())
}

pub fn test_email_inbox_intent_batch_apply(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture)?;

    create_expense_integration_intent(
        ctx,
        fixture.organization_id,
        CreateExpenseIntegrationIntentParams {
            company_id: Some(fixture.company_id),
            intent_type: "email_inbox".into(),
            idempotency_key: "email-we-1".into(),
            device_id: Some("inbox-worker".into()),
            payload: serde_json::json!({
                "employee_id": employee_id,
                "currency_id": 1,
                "name": "Email receipt lunch",
                "unit_amount": 18.0,
                "quantity": 1.0,
                "attachment_ids": [9],
            })
            .to_string(),
            metadata: None,
        },
    )?;
    apply_pending_expense_integration_intents(ctx, fixture.organization_id, 10)?;
    let intent = ctx
        .db
        .expense_integration_intent()
        .iter()
        .find(|i| {
            i.organization_id == fixture.organization_id && i.idempotency_key == "email-we-1"
        })
        .ok_or("intent")?;
    if intent.status != "applied" {
        return Err(format!("expected applied, got {}", intent.status));
    }
    let line = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| e.organization_id == fixture.organization_id && e.name == "Email receipt lunch")
        .ok_or("email expense")?;
    if line.attachment_ids.is_empty() {
        return Err("email inbox should attach receipt ids".into());
    }
    // Direct apply path still works for OCR.
    create_expense_integration_intent(
        ctx,
        fixture.organization_id,
        CreateExpenseIntegrationIntentParams {
            company_id: Some(fixture.company_id),
            intent_type: "ocr_receipt".into(),
            idempotency_key: "ocr-we-1".into(),
            device_id: None,
            payload: serde_json::json!({
                "employee_id": employee_id,
                "currency_id": 1,
                "name": "OCR taxi",
                "unit_amount": 12.0,
                "quantity": 1.0,
            })
            .to_string(),
            metadata: None,
        },
    )?;
    let ocr = ctx
        .db
        .expense_integration_intent()
        .iter()
        .find(|i| {
            i.organization_id == fixture.organization_id && i.idempotency_key == "ocr-we-1"
        })
        .ok_or("ocr intent")?;
    apply_expense_integration_intent(ctx, fixture.organization_id, ocr.id)?;
    Ok(())
}
