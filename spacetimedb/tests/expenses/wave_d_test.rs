//! Wave D — integration intents, card liability, fraud, advances, delayed sync.
use spacetimedb::{Identity, ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::expenses::expense_wave_d::{
    apply_expense_advance_to_sheet, apply_expense_integration_intent, create_expense_advance,
    create_expense_integration_intent, expense_integration_intent, hr_expense_advance,
    hr_expense_policy_exception, reject_expense_policy_exception, request_expense_policy_exception,
    set_expense_fraud_hold, ApplyExpenseAdvanceParams, CreateExpenseAdvanceParams,
    CreateExpenseIntegrationIntentParams, RejectExpensePolicyExceptionParams,
    RequestExpensePolicyExceptionParams, SetExpenseFraudHoldParams,
};
use crate::expenses::expenses::{
    approve_expense_sheet_impl, create_expense, create_expense_sheet, expense_sheet, hr_expense,
    post_expense_sheet, submit_expense, submit_expense_sheet, update_expense, CreateExpenseParams,
    CreateExpenseSheetParams, PostExpenseSheetParams, UpdateExpenseParams,
};
use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountInternalGroup, AccountMoveState, EmploymentType, ExpenseLineKind, ExpensePaymentMode,
    ExpensePolicyExceptionState, ExpenseSheetState, JournalType,
};

struct ExpenseAccounts {
    journal_id: u64,
    expense_id: u64,
    payable_id: u64,
    card_liability_id: u64,
    advance_id: u64,
    cash_id: u64,
}

fn seed_accounts(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<ExpenseAccounts, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let payable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("Harness missing AP")?;

    let type_name = format!("WD Exp Type {company_id}");
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

    let liability_type_name = format!("WD Liab Type {company_id}");
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

    let asset_type_name = format!("WD Asset Type {company_id}");
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
        format!("6WD{company_id}"),
        "WD Travel".into(),
        expense_type_id,
        AccountInternalGroup::Expense,
    )?;
    let card_liability_id = mk_account(
        format!("2WD{company_id}"),
        "WD Card Liability".into(),
        liability_type_id,
        AccountInternalGroup::Liability,
    )?;
    let advance_id = mk_account(
        format!("1WD{company_id}"),
        "WD Expense Advances".into(),
        liability_type_id,
        AccountInternalGroup::Liability,
    )?;
    let cash_id = mk_account(
        format!("1WDC{company_id}"),
        "WD Cash".into(),
        asset_type_id,
        AccountInternalGroup::Asset,
    )?;

    let journal_code = format!("WD{company_id}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: "WD Misc".into(),
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
        advance_id,
        cash_id,
    })
}

fn seed_employee(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    create_employee(
        ctx,
        fixture.organization_id,
        CreateEmployeeParams {
            company_id: Some(fixture.company_id),
            name: format!("WD Emp {}", fixture.company_id),
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
        .find(|e| e.organization_id == fixture.organization_id && e.name.contains("WD Emp"))
        .map(|e| e.id)
        .ok_or("employee".into())
}

pub fn test_card_feed_and_liability_post(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let accounts = seed_accounts(ctx, &fixture)?;
    let employee_id = seed_employee(ctx, &fixture)?;

    create_expense_integration_intent(
        ctx,
        fixture.organization_id,
        CreateExpenseIntegrationIntentParams {
            company_id: Some(fixture.company_id),
            intent_type: "card_feed".into(),
            idempotency_key: "card-1".into(),
            device_id: Some("feed".into()),
            payload: serde_json::json!({
                "employee_id": employee_id,
                "currency_id": 1,
                "name": "Uber card",
                "unit_amount": 42.0,
                "quantity": 1.0,
                "merchant_key": "uber",
                "payment_mode": "corporate_card",
            })
            .to_string(),
            metadata: None,
        },
    )?;
    let intent = ctx
        .db
        .expense_integration_intent()
        .iter()
        .find(|i| {
            i.organization_id == fixture.organization_id && i.idempotency_key == "card-1"
        })
        .ok_or("intent")?;
    apply_expense_integration_intent(ctx, fixture.organization_id, intent.id)?;
    let line = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| e.organization_id == fixture.organization_id && e.name == "Uber card")
        .ok_or("card expense")?;
    if line.payment_mode != ExpensePaymentMode::CorporateCard {
        return Err("expected CorporateCard payment mode".into());
    }
    // Card feeds may omit merchant receipt images; attach a registered receipt for submit evidence.
    let receipt_id = super::test_receipt_id(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        employee_id,
    )?;
    update_expense(
        ctx,
        fixture.organization_id,
        line.id,
        UpdateExpenseParams {
            company_id: None,
            name: None,
            unit_amount: None,
            quantity: None,
            description: None,
            account_id: None,
            product_id: None,
            tax_ids: None,
            payment_mode: None,
            merchant_key: None,
            attachment_ids: Some(vec![receipt_id]),
            mileage_distance: None,
            mileage_rate_id: None,
            per_diem_days: None,
            per_diem_rate_id: None,
        },
    )?;

    create_expense_sheet(
        ctx,
        fixture.organization_id,
        CreateExpenseSheetParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "WD Card Sheet".into(),
            currency_id: 1,
            notes: None,
            accounting_date: None,
        },
    )?;
    let sheet_id = ctx
        .db
        .expense_sheet()
        .iter()
        .find(|s| s.organization_id == fixture.organization_id && s.name == "WD Card Sheet")
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
            fx_fee_account_id: None,
            fx_fee_amount: None,
            accounting_date: ctx.timestamp,
            client_request_id: Some("wd-card-post".into()),
        },
    )?;
    let card_credit: f64 = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.account_id == accounts.card_liability_id && l.credit > 0.0)
        .map(|l| l.credit)
        .sum();
    if (card_credit - 42.0).abs() > 0.01 {
        return Err(format!("expected card liability credit 42, got {card_credit}"));
    }
    let sheet = ctx.db.expense_sheet().id().find(&sheet_id).ok_or("sheet")?;
    if sheet.state != ExpenseSheetState::Posted {
        return Err("sheet not posted".into());
    }
    Ok(())
}

pub fn test_duplicate_fraud_hold_blocks_submit(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture)?;
    let mk = |name: &str, req: Option<&str>| -> Result<(), String> {
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
                name: name.into(),
                date: ctx.timestamp,
                unit_amount: 55.0,
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
                client_request_id: req.map(|s| s.into()),
                payment_mode: ExpensePaymentMode::OutOfPocket,
                merchant_key: Some("starbucks".into()),
                policy_exception_reason: None,
            },
        )
    };
    mk("Coffee A", Some("fraud-a"))?;
    mk("Coffee B", Some("fraud-b"))?;
    let dup = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| e.organization_id == fixture.organization_id && e.name == "Coffee B")
        .ok_or("dup")?;
    if !dup.fraud_hold {
        return Err("expected fraud hold on duplicate".into());
    }
    create_expense_sheet(
        ctx,
        fixture.organization_id,
        CreateExpenseSheetParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "WD Fraud Sheet".into(),
            currency_id: 1,
            notes: None,
            accounting_date: None,
        },
    )?;
    let sheet_id = ctx
        .db
        .expense_sheet()
        .iter()
        .find(|s| {
            s.organization_id == fixture.organization_id && s.name == "WD Fraud Sheet"
        })
        .map(|s| s.id)
        .ok_or("sheet")?;
    submit_expense(ctx, fixture.organization_id, dup.id, sheet_id)?;
    let err = submit_expense_sheet(ctx, fixture.organization_id, sheet_id).err();
    if err.as_ref().map(|e| e.contains("fraud hold")).unwrap_or(false) {
        // clear hold and succeed
        set_expense_fraud_hold(
            ctx,
            fixture.organization_id,
            dup.id,
            SetExpenseFraudHoldParams {
                fraud_hold: false,
                fraud_reason: None,
                metadata: None,
            },
        )?;
        submit_expense_sheet(ctx, fixture.organization_id, sheet_id)?;
        Ok(())
    } else {
        Err(format!("expected fraud hold submit error, got {err:?}"))
    }
}

pub fn test_advance_and_delayed_sync(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let accounts = seed_accounts(ctx, &fixture)?;
    let employee_id = seed_employee(ctx, &fixture)?;

    let adv_req = format!("adv-1-{}", fixture.company_id);
    let delay_key = format!("delay-1-{}", fixture.company_id);
    let post_req = format!("wd-adv-post-{}", fixture.company_id);
    create_expense_advance(
        ctx,
        fixture.organization_id,
        CreateExpenseAdvanceParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: "Trip advance".into(),
            amount: 100.0,
            currency_id: 1,
            journal_id: accounts.journal_id,
            cash_account_id: accounts.cash_id,
            advance_account_id: accounts.advance_id,
            accounting_date: ctx.timestamp,
            client_request_id: Some(adv_req.clone()),
            metadata: None,
        },
    )?;
    let advance = ctx
        .db
        .hr_expense_advance()
        .iter()
        .find(|a| {
            a.organization_id == fixture.organization_id
                && a.client_request_id.as_deref() == Some(adv_req.as_str())
        })
        .ok_or("advance")?;
    let issue_move_id = advance.account_move_id.ok_or("advance missing account_move_id")?;
    let issue_move = ctx
        .db
        .account_move()
        .id()
        .find(&issue_move_id)
        .ok_or("issuance move missing")?;
    if issue_move.state != AccountMoveState::Posted {
        return Err("advance issuance move must be Posted".into());
    }
    let issue_adv_debit: f64 = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.move_id == issue_move_id && l.account_id == accounts.advance_id)
        .map(|l| l.debit)
        .sum();
    let issue_cash_credit: f64 = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.move_id == issue_move_id && l.account_id == accounts.cash_id)
        .map(|l| l.credit)
        .sum();
    if (issue_adv_debit - 100.0).abs() > 0.01 || (issue_cash_credit - 100.0).abs() > 0.01 {
        return Err(format!(
            "expected issuance Dr advance 100 / Cr cash 100, got debit={issue_adv_debit} credit={issue_cash_credit}"
        ));
    }

    let delay_receipt_id = super::test_receipt_id(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        employee_id,
    )?;
    create_expense_integration_intent(
        ctx,
        fixture.organization_id,
        CreateExpenseIntegrationIntentParams {
            company_id: Some(fixture.company_id),
            intent_type: "delayed_sync".into(),
            idempotency_key: delay_key.clone(),
            device_id: Some("phone".into()),
            payload: serde_json::json!({
                "employee_id": employee_id,
                "currency_id": 1,
                "name": "Offline meal",
                "unit_amount": 80.0,
                "quantity": 1.0,
                "client_request_id": delay_key.clone(),
                "attachment_ids": [delay_receipt_id],
            })
            .to_string(),
            metadata: None,
        },
    )?;
    let intent = ctx
        .db
        .expense_integration_intent()
        .iter()
        .find(|i| {
            i.organization_id == fixture.organization_id && i.idempotency_key == delay_key
        })
        .ok_or("delay intent")?;
    apply_expense_integration_intent(ctx, fixture.organization_id, intent.id)?;
    let line = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| {
            e.organization_id == fixture.organization_id
                && e.client_request_id.as_deref() == Some(delay_key.as_str())
        })
        .ok_or("delayed expense")?;

    let sheet_name = format!("WD Adv Sheet {}", fixture.company_id);
    create_expense_sheet(
        ctx,
        fixture.organization_id,
        CreateExpenseSheetParams {
            company_id: Some(fixture.company_id),
            employee_id,
            name: sheet_name.clone(),
            currency_id: 1,
            notes: None,
            accounting_date: None,
        },
    )?;
    let sheet_id = ctx
        .db
        .expense_sheet()
        .iter()
        .find(|s| s.organization_id == fixture.organization_id && s.name == sheet_name)
        .map(|s| s.id)
        .ok_or("sheet")?;
    submit_expense(ctx, fixture.organization_id, line.id, sheet_id)?;
    apply_expense_advance_to_sheet(
        ctx,
        fixture.organization_id,
        advance.id,
        sheet_id,
        ApplyExpenseAdvanceParams {
            amount: 30.0,
            metadata: None,
        },
    )?;
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
            advance_account_id: Some(accounts.advance_id),
            fx_fee_account_id: None,
            fx_fee_amount: None,
            accounting_date: ctx.timestamp,
            client_request_id: Some(post_req),
        },
    )?;
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("sheet after post")?;
    let post_move_id = sheet.account_move_id.ok_or("sheet missing account_move_id")?;
    let payable_credit: f64 = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| {
            l.move_id == post_move_id && l.account_id == accounts.payable_id && l.credit > 0.0
        })
        .map(|l| l.credit)
        .sum();
    // 80 out of pocket - 30 advance = 50 payable
    if (payable_credit - 50.0).abs() > 0.01 {
        return Err(format!("expected payable credit 50, got {payable_credit}"));
    }
    let adv_credit: f64 = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| {
            l.move_id == post_move_id && l.account_id == accounts.advance_id && l.credit > 0.0
        })
        .map(|l| l.credit)
        .sum();
    if (adv_credit - 30.0).abs() > 0.01 {
        return Err(format!("expected advance credit 30, got {adv_credit}"));
    }
    Ok(())
}

/// Reject path: Pending → Rejected with reason; SoD; policy_hold remains.
pub fn test_reject_policy_exception(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture)?;
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
            name: "WD Exception Line".into(),
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
            attachment_ids: vec![receipt_id],
            client_request_id: Some(format!("wd-exc-1-{}", fixture.company_id)),
            payment_mode: ExpensePaymentMode::OutOfPocket,
            merchant_key: None,
            policy_exception_reason: None,
        },
    )?;
    let exc_req = format!("wd-exc-1-{}", fixture.company_id);
    let expense_id = ctx
        .db
        .hr_expense()
        .iter()
        .find(|e| {
            e.organization_id == fixture.organization_id
                && e.client_request_id.as_deref() == Some(exc_req.as_str())
        })
        .map(|e| e.id)
        .ok_or("expense")?;

    request_expense_policy_exception(
        ctx,
        fixture.organization_id,
        expense_id,
        RequestExpensePolicyExceptionParams {
            reason: "Over cap for client dinner".into(),
            metadata: None,
        },
    )?;
    let exception = ctx
        .db
        .hr_expense_policy_exception()
        .iter()
        .find(|e| e.expense_id == expense_id && e.state == ExpensePolicyExceptionState::Pending)
        .ok_or("pending exception")?;

    // SoD: requester cannot reject.
    let sod = reject_expense_policy_exception(
        ctx,
        fixture.organization_id,
        exception.id,
        RejectExpensePolicyExceptionParams {
            reason: "self reject".into(),
            metadata: None,
        },
    );
    if sod.is_ok() {
        return Err("requester must not reject own exception".into());
    }
    let empty = reject_expense_policy_exception(
        ctx,
        fixture.organization_id,
        exception.id,
        RejectExpensePolicyExceptionParams {
            reason: "  ".into(),
            metadata: None,
        },
    );
    if empty.is_ok() {
        return Err("empty reject reason must fail".into());
    }

    // Harness sender is the requester — patch requested_by so SoD allows reject.
    ctx.db
        .hr_expense_policy_exception()
        .id()
        .update(crate::expenses::expense_wave_d::HrExpensePolicyException {
            requested_by: Identity::__dummy(),
            ..exception.clone()
        });
    reject_expense_policy_exception(
        ctx,
        fixture.organization_id,
        exception.id,
        RejectExpensePolicyExceptionParams {
            reason: "Policy not waived".into(),
            metadata: None,
        },
    )?;
    let rejected = ctx
        .db
        .hr_expense_policy_exception()
        .id()
        .find(&exception.id)
        .ok_or("exception after reject")?;
    if rejected.state != ExpensePolicyExceptionState::Rejected {
        return Err(format!("expected Rejected, got {:?}", rejected.state));
    }
    let meta = rejected.metadata.as_deref().unwrap_or("");
    if !meta.contains("Policy not waived") {
        return Err(format!("reject reason missing from metadata: {meta}"));
    }
    let expense = ctx
        .db
        .hr_expense()
        .id()
        .find(&expense_id)
        .ok_or("expense after reject")?;
    if !expense.policy_hold {
        return Err("policy_hold must remain after reject".into());
    }
    Ok(())
}
