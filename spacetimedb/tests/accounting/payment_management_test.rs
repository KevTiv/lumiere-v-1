/// Operational payment management domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::payment_management::{
    archive_payment_account, create_payment_account, create_payment_fee, create_payment_transaction,
    payment_account, payment_transaction, post_payment_transaction, void_payment_transaction,
    CreatePaymentAccountParams, CreatePaymentFeeParams, CreatePaymentTransactionParams,
};
use crate::accounting::journal_entries::account_move_line;
use crate::accounting::payments::account_payment;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{
    PartnerType, PaymentDirection, PaymentFeeBearer, PaymentProviderCode, PaymentTransactionStatus,
};

use super::helpers::seed_bank_journal;

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
        occurred_at: None,
        source_entity: None,
        source_entity_id: None,
        evidence_document_ids: vec![],
        metadata: None,
    };

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
            occurred_at: None,
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
            t.organization_id == org_id
                && t.external_reference == Some("TXN-POST-001".to_string())
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
            external_reference: Some("TXN-FEE-001".to_string()),
            gross_external_amount: 110.0,
            settlement_amount: 100.0,
            net_account_amount: 100.0,
            currency_id: 1,
            occurred_at: None,
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
            currency_id: 1,
            fee_account_id: None,
            tax_account_id: None,
            tax_amount: 0.0,
            provider_reference: Some("FEE-1".to_string()),
            metadata: None,
        },
    )?;

    // Post should succeed now that fees reconcile to gross - net.
    post_payment_transaction(ctx, org_id, transaction.id)?;

    // Void should fail because posted.
    let void_result = void_payment_transaction(ctx, org_id, transaction.id);
    if void_result.is_ok() {
        return Err("Expected void of posted transaction to fail".to_string());
    }

    Ok(())
}
