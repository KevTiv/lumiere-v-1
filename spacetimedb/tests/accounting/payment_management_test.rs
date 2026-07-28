/// Operational payment management domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, create_account_account, create_account_account_type,
    CreateAccountAccountParams, CreateAccountAccountTypeParams,
};
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::accounting::payment_management::{
    allocate_payment_transaction, archive_payment_account, create_payment_account,
    create_payment_fee, create_payment_transaction, payment_account, payment_fee,
    payment_reconciliation, payment_transaction, post_payment_transaction,
    reverse_payment_transaction_impl, void_payment_transaction, AllocatePaymentParams,
    CreatePaymentAccountParams, CreatePaymentFeeParams, CreatePaymentTransactionParams,
    ReversePaymentTransactionParams,
};
use crate::accounting::payments::account_payment;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountInternalGroup, PartnerType, PaymentDirection, PaymentFeeBearer, PaymentProviderCode,
    PaymentTransactionStatus,
};

use super::helpers::{create_balanced_customer_invoice, seed_bank_journal};

fn seed_payment_fee_account(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let type_name = format!("Payment fee expense {}", fixture.company_id);
    create_account_account_type(
        ctx,
        fixture.organization_id,
        CreateAccountAccountTypeParams {
            name: type_name.clone(),
            type_: "expense".to_string(),
            internal_group: AccountInternalGroup::Expense,
            include_initial_balance: false,
            company_id: Some(fixture.company_id),
            metadata: None,
        },
    )?;
    let type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.name == type_name)
        .map(|row| row.id)
        .ok_or("payment fee account type not found")?;
    let code = format!("PAYF{}", fixture.company_id);
    create_account_account(
        ctx,
        fixture.organization_id,
        CreateAccountAccountParams {
            company_id: Some(fixture.company_id),
            code: code.clone(),
            name: "Payment fee expense".to_string(),
            user_type_id: type_id,
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
    ctx.db
        .account_account()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.code == code)
        .map(|row| row.id)
        .ok_or("payment fee account not found".to_string())
}

pub fn test_payment_account_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let (journal_id, _bank_account_id) = seed_bank_journal(ctx, &fixture)?;

    create_payment_account(
        ctx,
        org_id,
        CreatePaymentAccountParams {
            company_id,
            provider_code: PaymentProviderCode::Mtn,
            name: "MTN Test Wallet".to_string(),
            provider_label: None,
            reference_raw: Some("+233501234567".to_string()),
            currency_id: 1,
            account_journal_id: journal_id,
            fee_account_id: None,
            clearing_account_id: None,
            is_primary: true,
            metadata: None,
        },
    )?;

    let account = ctx
        .db
        .payment_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.name == "MTN Test Wallet")
        .ok_or("Payment account not found after create")?;

    if account.provider_code != PaymentProviderCode::Mtn {
        return Err("Provider code mismatch".to_string());
    }
    if account.reference_normalized.as_deref() != Some("+233501234567") {
        return Err(format!(
            "Expected normalized reference +233501234567, got {:?}",
            account.reference_normalized
        ));
    }
    if account.reference_masked.is_none() {
        return Err("Expected masked reference".to_string());
    }

    archive_payment_account(ctx, org_id, account.id)?;
    let archived = ctx
        .db
        .payment_account()
        .id()
        .find(&account.id)
        .ok_or("Archived account not found")?;
    if archived.archived_at.is_none() {
        return Err("Account was not archived".to_string());
    }

    Ok(())
}

pub fn test_payment_transaction_duplicate_reference(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let (journal_id, _bank_account_id) = seed_bank_journal(ctx, &fixture)?;

    create_payment_account(
        ctx,
        org_id,
        CreatePaymentAccountParams {
            company_id,
            provider_code: PaymentProviderCode::Mtn,
            name: "MTN Wallet".to_string(),
            provider_label: None,
            reference_raw: None,
            currency_id: 1,
            account_journal_id: journal_id,
            fee_account_id: None,
            clearing_account_id: None,
            is_primary: false,
            metadata: None,
        },
    )?;

    let account = ctx
        .db
        .payment_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.name == "MTN Wallet")
        .ok_or("Payment account not found")?;

    let params = CreatePaymentTransactionParams {
        company_id,
        payment_account_id: account.id,
        direction: PaymentDirection::Inbound,
        partner_type: PartnerType::Customer,
        partner_id: fixture.partner_id,
        external_reference: Some("TXN-12345".to_string()),
        gross_external_amount: 110.0,
        settlement_amount: 100.0,
        net_account_amount: 100.0,
        currency_id: 1,
        occurred_at: Some(ctx.timestamp),
        source_entity: None,
        source_entity_id: None,
        evidence_document_ids: vec![],
        metadata: None,
    };

    let mut missing_date = params.clone();
    missing_date.external_reference = Some("TXN-MISSING-DATE".to_string());
    missing_date.occurred_at = None;
    if create_payment_transaction(ctx, org_id, missing_date).is_ok() {
        return Err("Expected missing provider event time to be rejected".to_string());
    }

    create_payment_transaction(ctx, org_id, params.clone())?;

    let duplicate = create_payment_transaction(ctx, org_id, params.clone());
    if duplicate.is_ok() {
        return Err("Expected duplicate reference to be rejected".to_string());
    }

    // Different account should allow same reference.
    create_payment_account(
        ctx,
        org_id,
        CreatePaymentAccountParams {
            company_id,
            provider_code: PaymentProviderCode::Cash,
            name: "Cash Drawer".to_string(),
            provider_label: None,
            reference_raw: None,
            currency_id: 1,
            account_journal_id: journal_id,
            fee_account_id: None,
            clearing_account_id: None,
            is_primary: false,
            metadata: None,
        },
    )?;

    let cash_account = ctx
        .db
        .payment_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.name == "Cash Drawer")
        .ok_or("Cash account not found")?;

    let mut distinct_params = params;
    distinct_params.payment_account_id = cash_account.id;
    create_payment_transaction(ctx, org_id, distinct_params)?;

    Ok(())
}

pub fn test_payment_transaction_post_creates_ledger_payment(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let (journal_id, _bank_account_id) = seed_bank_journal(ctx, &fixture)?;

    create_payment_account(
        ctx,
        org_id,
        CreatePaymentAccountParams {
            company_id,
            provider_code: PaymentProviderCode::Mtn,
            name: "MTN Wallet".to_string(),
            provider_label: None,
            reference_raw: None,
            currency_id: 1,
            account_journal_id: journal_id,
            fee_account_id: None,
            clearing_account_id: None,
            is_primary: false,
            metadata: None,
        },
    )?;

    let account = ctx
        .db
        .payment_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.name == "MTN Wallet")
        .ok_or("Payment account not found")?;

    create_payment_transaction(
        ctx,
        org_id,
        CreatePaymentTransactionParams {
            company_id,
            payment_account_id: account.id,
            direction: PaymentDirection::Inbound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            external_reference: Some("TXN-POST-001".to_string()),
            gross_external_amount: 100.0,
            settlement_amount: 100.0,
            net_account_amount: 100.0,
            currency_id: 1,
            occurred_at: Some(ctx.timestamp),
            source_entity: None,
            source_entity_id: None,
            evidence_document_ids: vec![],
            metadata: None,
        },
    )?;

    let transaction = ctx
        .db
        .payment_transaction()
        .iter()
        .find(|t| {
            t.organization_id == org_id && t.external_reference == Some("TXN-POST-001".to_string())
        })
        .ok_or("Payment transaction not found")?;

    post_payment_transaction(ctx, org_id, transaction.id)?;

    let posted = ctx
        .db
        .payment_transaction()
        .id()
        .find(&transaction.id)
        .ok_or("Posted transaction not found")?;
    if posted.status != PaymentTransactionStatus::Posted {
        return Err("Transaction was not posted".to_string());
    }
    let account_payment_id = posted
        .account_payment_id
        .ok_or("Posted transaction missing ledger payment link")?;

    let ledger_payment = ctx
        .db
        .account_payment()
        .id()
        .find(&account_payment_id)
        .ok_or("Linked AccountPayment not found")?;
    if ledger_payment.amount != 100.0 {
        return Err(format!(
            "Ledger payment amount mismatch: expected 100.0, got {}",
            ledger_payment.amount
        ));
    }

    let payment_move_id = ledger_payment
        .move_id
        .ok_or("Ledger payment missing move_id after post")?;
    let line_count = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .count();
    if line_count < 2 {
        return Err(format!(
            "post_ledger_payment must insert balanced lines, got {line_count}"
        ));
    }
    let debit: f64 = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .map(|l| l.debit)
        .sum();
    let credit: f64 = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .map(|l| l.credit)
        .sum();
    if (debit - credit).abs() > 0.01 {
        return Err(format!(
            "Ledger payment move unbalanced: debit={debit} credit={credit}"
        ));
    }

    Ok(())
}

pub fn test_payment_transaction_fee_and_void(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let (journal_id, _bank_account_id) = seed_bank_journal(ctx, &fixture)?;
    let fee_account_id = seed_payment_fee_account(ctx, &fixture)?;

    create_payment_account(
        ctx,
        org_id,
        CreatePaymentAccountParams {
            company_id,
            provider_code: PaymentProviderCode::Mtn,
            name: "MTN Wallet".to_string(),
            provider_label: None,
            reference_raw: None,
            currency_id: 1,
            account_journal_id: journal_id,
            fee_account_id: Some(fee_account_id),
            clearing_account_id: None,
            is_primary: false,
            metadata: None,
        },
    )?;

    let account = ctx
        .db
        .payment_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.name == "MTN Wallet")
        .ok_or("Payment account not found")?;

    create_payment_transaction(
        ctx,
        org_id,
        CreatePaymentTransactionParams {
            company_id,
            payment_account_id: account.id,
            direction: PaymentDirection::Inbound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            external_reference: Some("TXN-FEE-001".to_string()),
            gross_external_amount: 110.0,
            settlement_amount: 100.0,
            net_account_amount: 100.0,
            currency_id: 1,
            occurred_at: Some(ctx.timestamp),
            source_entity: None,
            source_entity_id: None,
            evidence_document_ids: vec![],
            metadata: None,
        },
    )?;

    let transaction = ctx
        .db
        .payment_transaction()
        .iter()
        .find(|t| {
            t.organization_id == org_id && t.external_reference == Some("TXN-FEE-001".to_string())
        })
        .ok_or("Payment transaction not found")?;

    create_payment_fee(
        ctx,
        org_id,
        CreatePaymentFeeParams {
            company_id,
            payment_transaction_id: transaction.id,
            bearer: PaymentFeeBearer::Company,
            amount: 10.0,
            fee_account_id: None,
            tax_account_id: None,
            tax_amount: 0.0,
            provider_reference: Some("FEE-1".to_string()),
            metadata: None,
        },
    )?;
    let fee = ctx
        .db
        .payment_fee()
        .payment_fee_by_transaction()
        .filter(&transaction.id)
        .next()
        .ok_or("Payment fee not found")?;
    if fee.currency_id != transaction.currency_id || fee.fee_account_id != Some(fee_account_id) {
        return Err(
            "Payment fee did not derive transaction currency and account setup".to_string(),
        );
    }

    // Post should succeed now that fees reconcile to gross - net.
    post_payment_transaction(ctx, org_id, transaction.id)?;

    // Void should fail because posted.
    let void_result = void_payment_transaction(ctx, org_id, transaction.id);
    if void_result.is_ok() {
        return Err("Expected void of posted transaction to fail".to_string());
    }

    Ok(())
}

pub fn test_payment_allocation_updates_ledger_and_reverses(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let invoice_id = create_balanced_customer_invoice(ctx, &fixture, 600.67, true)?;
    let foreign_invoice_id = create_balanced_customer_invoice(ctx, &foreign, 999.99, true)?;
    let receivable_line_for = |move_id| {
        ctx.db
            .account_move_line()
            .move_line_by_move()
            .filter(&move_id)
            .find(|line| {
                line.account_internal_type
                    .as_deref()
                    .is_some_and(|kind| kind.eq_ignore_ascii_case("receivable"))
            })
    };
    let invoice_line =
        receivable_line_for(invoice_id).ok_or("invoice receivable line not found")?;
    let foreign_line =
        receivable_line_for(foreign_invoice_id).ok_or("foreign receivable line not found")?;

    let (journal_id, _bank_account_id) = seed_bank_journal(ctx, &fixture)?;
    create_payment_account(
        ctx,
        org_id,
        CreatePaymentAccountParams {
            company_id,
            provider_code: PaymentProviderCode::Bank,
            name: "ACC-RI-004 allocation account".to_string(),
            provider_label: None,
            reference_raw: None,
            currency_id: 1,
            account_journal_id: journal_id,
            fee_account_id: None,
            clearing_account_id: None,
            is_primary: false,
            metadata: Some(r#"{"test":"acc_ri_004"}"#.to_string()),
        },
    )?;
    let payment_account = ctx
        .db
        .payment_account()
        .iter()
        .find(|account| {
            account.organization_id == org_id && account.name == "ACC-RI-004 allocation account"
        })
        .ok_or("allocation payment account not found")?;
    create_payment_transaction(
        ctx,
        org_id,
        CreatePaymentTransactionParams {
            company_id,
            payment_account_id: payment_account.id,
            direction: PaymentDirection::Inbound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            external_reference: Some("ACC-RI-004-21113".to_string()),
            gross_external_amount: 211.13,
            settlement_amount: 211.13,
            net_account_amount: 211.13,
            currency_id: 1,
            occurred_at: Some(ctx.timestamp),
            source_entity: Some("invoice".to_string()),
            source_entity_id: Some(invoice_id),
            evidence_document_ids: vec![],
            metadata: Some(r#"{"test":"acc_ri_004"}"#.to_string()),
        },
    )?;
    let transaction = ctx
        .db
        .payment_transaction()
        .iter()
        .find(|transaction| {
            transaction.organization_id == org_id
                && transaction.external_reference == Some("ACC-RI-004-21113".to_string())
        })
        .ok_or("allocation payment transaction not found")?;
    post_payment_transaction(ctx, org_id, transaction.id)?;
    let posted = ctx
        .db
        .payment_transaction()
        .id()
        .find(&transaction.id)
        .ok_or("posted allocation transaction not found")?;
    let account_payment_id = posted
        .account_payment_id
        .ok_or("posted transaction missing ledger payment")?;
    let params = AllocatePaymentParams {
        company_id,
        payment_transaction_id: posted.id,
        allocated_move_line_id: invoice_line.id,
        allocated_amount: 211.13,
        currency_id: 1,
        write_off_amount: 0.0,
        write_off_account_id: None,
        metadata: Some(r#"{"test":"acc_ri_004"}"#.to_string()),
    };

    if allocate_payment_transaction(
        ctx,
        org_id,
        AllocatePaymentParams {
            allocated_move_line_id: foreign_line.id,
            ..params.clone()
        },
    )
    .is_ok()
    {
        return Err("cross-tenant allocation should fail".to_string());
    }
    allocate_payment_transaction(ctx, org_id, params.clone())?;

    let reconciliation = ctx
        .db
        .payment_reconciliation()
        .iter()
        .find(|row| {
            row.payment_transaction_id == posted.id
                && row.allocated_move_line_id == invoice_line.id
                && !row.is_reversal
        })
        .ok_or("payment reconciliation not found")?;
    if (reconciliation.residual_before - 600.67).abs() > 0.001
        || (reconciliation.residual_after - 389.54).abs() > 0.001
    {
        return Err("reconciliation residual evidence is incorrect".to_string());
    }
    let assert_invoice_residual = |expected: f64| -> Result<(), String> {
        let line = ctx
            .db
            .account_move_line()
            .id()
            .find(&invoice_line.id)
            .ok_or("allocated invoice line missing")?;
        let invoice = ctx
            .db
            .account_move()
            .id()
            .find(&invoice_id)
            .ok_or("allocated invoice missing")?;
        if (line.amount_residual.abs() - expected).abs() > 0.001
            || (invoice.amount_residual - expected).abs() > 0.001
        {
            return Err(format!(
                "invoice residual mismatch: line={} move={} expected={expected}",
                line.amount_residual, invoice.amount_residual
            ));
        }
        Ok(())
    };
    assert_invoice_residual(389.54)?;

    let row_count = ctx
        .db
        .payment_reconciliation()
        .iter()
        .filter(|row| row.payment_transaction_id == posted.id)
        .count();
    allocate_payment_transaction(ctx, org_id, params)?;
    if ctx
        .db
        .payment_reconciliation()
        .iter()
        .filter(|row| row.payment_transaction_id == posted.id)
        .count()
        != row_count
    {
        return Err("allocation retry inserted a duplicate reconciliation".to_string());
    }
    assert_invoice_residual(389.54)?;

    reverse_payment_transaction_impl(
        ctx,
        org_id,
        posted.id,
        ReversePaymentTransactionParams {
            company_id,
            reason: Some("ACC-RI-004 reversal proof".to_string()),
            metadata: Some(r#"{"test":"acc_ri_004"}"#.to_string()),
        },
        true,
    )?;
    assert_invoice_residual(600.67)?;
    if !ctx.db.payment_reconciliation().iter().any(|row| {
        row.payment_transaction_id == posted.id
            && row.is_reversal
            && row.reversed_reconciliation_id == Some(reconciliation.id)
            && (row.allocated_amount + 211.13).abs() <= 0.001
    }) {
        return Err("reversal did not persist compensating reconciliation evidence".to_string());
    }
    let ledger_payment = ctx
        .db
        .account_payment()
        .id()
        .find(&account_payment_id)
        .ok_or("ledger payment missing after reversal")?;
    let payment_move_id = ledger_payment
        .move_id
        .ok_or("ledger payment move missing after reversal")?;
    let restored_payment_residual: f64 = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .filter(|line| {
            line.account_internal_type.as_deref().is_some_and(|kind| {
                kind.eq_ignore_ascii_case("receivable") || kind.eq_ignore_ascii_case("payable")
            })
        })
        .map(|line| line.amount_residual.abs())
        .sum();
    if (restored_payment_residual - 211.13).abs() > 0.001 {
        return Err("reversal did not restore payment clearing residual".to_string());
    }

    Ok(())
}
