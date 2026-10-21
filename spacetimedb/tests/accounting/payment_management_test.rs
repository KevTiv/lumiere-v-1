/// Operational payment management domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, create_account_account, create_account_account_type,
    CreateAccountAccountParams, CreateAccountAccountTypeParams,
};
use crate::accounting::idempotency::accounting_operation_receipt;
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::accounting::payment_management::{
    allocate_payment_transaction, archive_payment_account, create_payment_account,
    create_payment_fee, create_payment_transaction, payment_account, payment_fee,
    payment_reconciliation, payment_transaction, post_payment_transaction,
    reverse_payment_transaction_impl, update_payment_account, void_payment_transaction,
    AllocatePaymentParams, CreatePaymentAccountParams, CreatePaymentFeeParams,
    CreatePaymentTransactionParams, ReversePaymentTransactionParams, UpdatePaymentAccountParams,
};
use crate::accounting::payments::account_payment;
use crate::core::audit::audit_log;
use crate::core::organization::company;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountInternalGroup, PartnerType, PaymentDirection, PaymentFeeBearer, PaymentProviderCode,
    PaymentTransactionStatus,
};

use super::helpers::{create_balanced_customer_invoice, seed_bank_journal};

fn company_currency_id(ctx: &ReducerContext, company_id: u64) -> Result<u64, String> {
    ctx.db
        .company()
        .id()
        .find(&company_id)
        .map(|company| company.currency_id)
        .ok_or_else(|| format!("Company {company_id} not found"))
}

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
            currency_id: company_currency_id(ctx, company_id)?,
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
            currency_id: company_currency_id(ctx, company_id)?,
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
        currency_id: company_currency_id(ctx, company_id)?,
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
            currency_id: company_currency_id(ctx, company_id)?,
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
            currency_id: company_currency_id(ctx, company_id)?,
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
            currency_id: company_currency_id(ctx, company_id)?,
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
    post_payment_transaction(ctx, org_id, transaction.id)
        .map_err(|error| format!("committed payment post retry failed: {error}"))?;
    let replayed = ctx
        .db
        .payment_transaction()
        .id()
        .find(&transaction.id)
        .ok_or("Posted transaction missing after retry")?;
    if replayed.account_payment_id != Some(account_payment_id) {
        return Err("payment post retry changed the linked ledger payment".to_string());
    }

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
    let linked_payment_count = ctx
        .db
        .account_payment()
        .iter()
        .filter(|payment| {
            payment.organization_id == org_id
                && payment.company_id == company_id
                && payment.ref_.as_deref() == Some("TXN-POST-001")
        })
        .count();
    let transaction_post_audits = ctx
        .db
        .audit_log()
        .iter()
        .filter(|audit| {
            audit.organization_id == org_id
                && audit.company_id == Some(company_id)
                && audit.table_name == "payment_transaction"
                && audit.record_id == transaction.id
                && audit.action == "POST"
        })
        .count();
    if linked_payment_count != 1 || transaction_post_audits != 1 {
        return Err(format!(
            "payment post retry persisted {linked_payment_count} ledger payments and \
             {transaction_post_audits} transaction audits"
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
            currency_id: company_currency_id(ctx, company_id)?,
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
            currency_id: company_currency_id(ctx, company_id)?,
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
            currency_id: company_currency_id(ctx, company_id)?,
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
            currency_id: company_currency_id(ctx, company_id)?,
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
        idempotency_key: format!("payment-allocation:{}:{}", posted.id, invoice_line.id),
        company_id,
        payment_transaction_id: posted.id,
        allocated_move_line_id: invoice_line.id,
        allocated_amount: 211.13,
        currency_id: company_currency_id(ctx, company_id)?,
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
    allocate_payment_transaction(ctx, org_id, params.clone())?;
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
    let allocation_receipts = ctx
        .db
        .accounting_operation_receipt()
        .iter()
        .filter(|receipt| {
            receipt.organization_id == org_id
                && receipt.company_id == company_id
                && receipt.action_kind == "allocate_payment_transaction"
                && receipt.result_id == reconciliation.id
        })
        .count();
    if allocation_receipts != 1 {
        return Err(format!(
            "allocation retry persisted {allocation_receipts} operation receipts"
        ));
    }
    let allocation_audits = ctx
        .db
        .audit_log()
        .iter()
        .filter(|audit| {
            audit.organization_id == org_id
                && audit.company_id == Some(company_id)
                && audit.table_name == "payment_reconciliation"
                && audit.record_id == reconciliation.id
                && audit.action == "CREATE"
        })
        .count();
    if allocation_audits != 1 {
        return Err(format!(
            "allocation retry persisted {allocation_audits} reconciliation audits"
        ));
    }
    let mut changed_retry = params.clone();
    changed_retry.allocated_amount = 200.0;
    match allocate_payment_transaction(ctx, org_id, changed_retry) {
        Err(error) if error.contains("idempotency key") => {}
        Err(error) => return Err(format!("unexpected allocation retry conflict: {error}")),
        Ok(()) => return Err("changed allocation retry reused its idempotency key".to_string()),
    }

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

pub fn test_payment_account_patch_preserves_and_clears(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (journal_id, clearing_account_id) = seed_bank_journal(ctx, &fixture)?;
    let fee_account_id = seed_payment_fee_account(ctx, &fixture)?;
    create_payment_account(
        ctx,
        fixture.organization_id,
        CreatePaymentAccountParams {
            company_id: fixture.company_id,
            provider_code: PaymentProviderCode::Other,
            name: "Patch Wallet".to_string(),
            provider_label: Some("ACC-RI-010 label".to_string()),
            reference_raw: Some("P-A1-73129".to_string()),
            currency_id: company_currency_id(ctx, fixture.company_id)?,
            account_journal_id: journal_id,
            fee_account_id: Some(fee_account_id),
            clearing_account_id: Some(clearing_account_id),
            is_primary: false,
            metadata: Some(r#"{"proof":"preserved"}"#.to_string()),
        },
    )?;
    let account_id = ctx
        .db
        .payment_account()
        .iter()
        .find(|a| a.organization_id == fixture.organization_id && a.name == "Patch Wallet")
        .map(|a| a.id)
        .ok_or("patch payment account missing")?;

    update_payment_account(
        ctx,
        fixture.organization_id,
        account_id,
        UpdatePaymentAccountParams {
            name: Some("Only name changed".to_string()),
            provider_label: None,
            reference_raw: None,
            fee_account_id: None,
            clearing_account_id: None,
            active: None,
            is_primary: None,
            metadata: None,
        },
    )?;
    let preserved = ctx
        .db
        .payment_account()
        .id()
        .find(&account_id)
        .ok_or("payment account missing after name-only update")?;
    if preserved.name != "Only name changed" {
        return Err("name-only update did not change name".to_string());
    }
    if preserved.provider_label.as_deref() != Some("ACC-RI-010 label")
        || preserved.fee_account_id != Some(fee_account_id)
        || preserved.metadata.as_deref() != Some(r#"{"proof":"preserved"}"#)
    {
        return Err("name-only update cleared unrelated payment-account fields".to_string());
    }

    update_payment_account(
        ctx,
        fixture.organization_id,
        account_id,
        UpdatePaymentAccountParams {
            name: None,
            provider_label: Some(None),
            reference_raw: None,
            fee_account_id: Some(None),
            clearing_account_id: None,
            active: None,
            is_primary: None,
            metadata: Some(None),
        },
    )?;
    let cleared = ctx
        .db
        .payment_account()
        .id()
        .find(&account_id)
        .ok_or("payment account missing after clear")?;
    if cleared.provider_label.is_some()
        || cleared.fee_account_id.is_some()
        || cleared.metadata.is_some()
    {
        return Err("explicit clear did not null nullable payment-account fields".to_string());
    }
    Ok(())
}

/// ACC-RI-023: `update_payment_account` must validate `fee_account_id` and
/// `clearing_account_id` under the caller's organization/company the same way
/// `create_payment_account` already does — rejecting a cross-tenant account ID
/// instead of persisting it unchecked.
pub fn test_update_payment_account_rejects_cross_tenant_accounts(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    let (journal_a, _) = seed_bank_journal(ctx, &fixture_a)?;
    let fee_account_a = seed_payment_fee_account(ctx, &fixture_a)?;
    let fee_account_b = seed_payment_fee_account(ctx, &fixture_b)?;

    create_payment_account(
        ctx,
        fixture_a.organization_id,
        CreatePaymentAccountParams {
            company_id: fixture_a.company_id,
            provider_code: PaymentProviderCode::Other,
            name: "ACC-RI-023 Wallet".to_string(),
            provider_label: Some("ACC-RI-023 label".to_string()),
            reference_raw: Some("P-ACC-RI-023".to_string()),
            currency_id: company_currency_id(ctx, fixture_a.company_id)?,
            account_journal_id: journal_a,
            fee_account_id: Some(fee_account_a),
            clearing_account_id: None,
            is_primary: false,
            metadata: None,
        },
    )?;
    let account_id = ctx
        .db
        .payment_account()
        .iter()
        .find(|a| a.organization_id == fixture_a.organization_id && a.name == "ACC-RI-023 Wallet")
        .map(|a| a.id)
        .ok_or("ACC-RI-023 payment account missing")?;

    let cross_tenant_result = update_payment_account(
        ctx,
        fixture_a.organization_id,
        account_id,
        UpdatePaymentAccountParams {
            name: None,
            provider_label: None,
            reference_raw: None,
            fee_account_id: Some(Some(fee_account_b)),
            clearing_account_id: None,
            active: None,
            is_primary: None,
            metadata: None,
        },
    );
    if cross_tenant_result.is_ok() {
        return Err(
            "update_payment_account accepted a cross-organization fee_account_id".to_string(),
        );
    }
    let unchanged = ctx
        .db
        .payment_account()
        .id()
        .find(&account_id)
        .ok_or("payment account disappeared after rejected cross-tenant update")?;
    if unchanged.fee_account_id != Some(fee_account_a) {
        return Err(
            "rejected cross-tenant fee_account_id update still mutated the stored account"
                .to_string(),
        );
    }

    let cross_tenant_clearing = update_payment_account(
        ctx,
        fixture_a.organization_id,
        account_id,
        UpdatePaymentAccountParams {
            name: None,
            provider_label: None,
            reference_raw: None,
            fee_account_id: None,
            clearing_account_id: Some(Some(fee_account_b)),
            active: None,
            is_primary: None,
            metadata: None,
        },
    );
    if cross_tenant_clearing.is_ok() {
        return Err(
            "update_payment_account accepted a cross-organization clearing_account_id".to_string(),
        );
    }

    // Positive: a same-tenant fee account still validates and persists.
    update_payment_account(
        ctx,
        fixture_a.organization_id,
        account_id,
        UpdatePaymentAccountParams {
            name: None,
            provider_label: None,
            reference_raw: None,
            fee_account_id: Some(Some(fee_account_a)),
            clearing_account_id: None,
            active: None,
            is_primary: None,
            metadata: None,
        },
    )?;
    let updated = ctx
        .db
        .payment_account()
        .id()
        .find(&account_id)
        .ok_or("payment account disappeared after same-tenant update")?;
    if updated.fee_account_id != Some(fee_account_a) {
        return Err("same-tenant fee_account_id update did not persist".to_string());
    }

    Ok(())
}

/// Seeded Paid rows must satisfy the same ledger and allocation invariants as
/// real payments. In particular an operational receipt may be unallocated, but
/// it may never be posted without a linked ledger payment and balanced move.
pub fn test_seed_payment_ledger_and_partial_report_balance(
    ctx: &ReducerContext,
) -> Result<(), String> {
    use crate::accounting::journal_entries::reconcile_payment_with_invoice;
    use crate::accounting::payment_management::{PaymentFee, PaymentTransaction};
    use crate::accounting::payments::AccountPayment;
    use crate::types::{AccountMoveState, PaymentState, PaymentType};

    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    let currency_id = company_currency_id(ctx, fixture.company_id)?;
    let invoice_id = create_balanced_customer_invoice(ctx, &fixture, 13_750.0, true)?;
    let settled_invoice_id = create_balanced_customer_invoice(ctx, &fixture, 3_600.0, true)?;
    use crate::inventory::product::product;
    use crate::sales::pricelists::{product_pricelist, ProductPricelist};
    use crate::sales::sales_core::{
        create_sale_order, sale_order, CreateSaleOrderLineParams, CreateSaleOrderParams,
    };
    let product_uom_id = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("fixture product missing")?
        .uom_id;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .insert(ProductPricelist {
            id: 0,
            organization_id: fixture.organization_id,
            company_id: Some(fixture.company_id),
            name: "Seed payment settlement regression".to_string(),
            currency_id,
            discount_policy: crate::types::DiscountPolicy::WithDiscount,
            is_active: true,
            created_at: ctx.timestamp,
        })
        .id;
    let qty = 1.0;
    let price_unit = Some(3_600.0);
    let client_order_ref = "Seed payment sales order";
    let metadata = "seed payment regression";
    create_sale_order(
        ctx,
        fixture.organization_id,
        CreateSaleOrderParams {
            company_id: Some(fixture.company_id),
            partner_id: fixture.partner_id,
            partner_invoice_id: fixture.partner_id,
            partner_shipping_id: fixture.partner_id,
            pricelist_id,
            currency_id: fixture.currency_id,
            warehouse_id: fixture.warehouse_id,
            order_lines: vec![CreateSaleOrderLineParams {
                product_id: fixture.product_id,
                quantity: qty,
                uom_id: product_uom_id,
                price_unit,
                discount: 0.0,
                tax_ids: vec![],
                name: None,
                sequence: 1,
                is_downpayment: false,
                display_type: None,
                product_variant_id: None,
                packaging_id: None,
                route_id: None,
                analytic_tag_ids: vec![],
                customer_lead: None,
                metadata: None,
            }],
            origin: Some(metadata.to_string()),
            client_order_ref: Some(client_order_ref.to_string()),
            payment_term_id: None,
            fiscal_position_id: None,
            team_id: None,
            opportunity_id: None,
            proposal_id: None,
            note: None,
            terms_and_conditions: None,
            validity_days: None,
            shipping_policy: None,
            picking_policy: None,
            campaign_id: None,
            medium_id: None,
            source_id: None,
            commitment_date: None,
            expected_date: None,
            incoterm_id: None,
            incoterm: None,
            incoterm_location: None,
            carrier_id: None,
            customer_lead: None,
            analytic_account_id: None,
            user_id: None,
            is_printed: None,
            is_locked: None,
            is_dropship: None,
            invoice_policy: None,
            message_follower_ids: None,
            message_partner_ids: None,
            message_channel_ids: None,
            activity_ids: None,
            metadata: Some(format!(r#"{{"test":"{metadata}"}}"#)),
        },
    )?;
    let linked_order = ctx
        .db
        .sale_order()
        .iter()
        .find(|row| {
            row.organization_id == fixture.organization_id
                && row.client_order_ref.as_deref() == Some(client_order_ref)
        })
        .ok_or("seed regression sales order missing")?;
    let settled_invoice = ctx
        .db
        .account_move()
        .id()
        .find(&settled_invoice_id)
        .ok_or("seed invoice missing")?;
    ctx.db
        .account_move()
        .id()
        .update(crate::accounting::journal_entries::AccountMove {
            sale_order_id: Some(linked_order.id),
            ..settled_invoice
        });

    let account =
        ctx.db
            .payment_account()
            .insert(crate::accounting::payment_management::PaymentAccount {
                id: 0,
                organization_id: fixture.organization_id,
                company_id: fixture.company_id,
                provider_code: PaymentProviderCode::Mtn,
                name: "Seed ledger fixture wallet".to_string(),
                provider_label: None,
                reference_normalized: None,
                reference_masked: None,
                currency_id,
                account_journal_id: journal_id,
                fee_account_id: None,
                clearing_account_id: None,
                active: true,
                is_primary: false,
                created_at: ctx.timestamp,
                updated_at: ctx.timestamp,
                created_by: ctx.sender(),
                updated_by: ctx.sender(),
                archived_at: None,
                metadata: None,
            });
    let mut payments = Vec::new();
    for (name, amount) in [
        ("PAY-0001", 3_600.0),
        ("PAY-OWNER-0001", 15_000.0),
        ("PAY-OWNER-0002", 5_000.0),
        ("PAY-OWNER-UNREC", 2_500.0),
    ] {
        let draft = ctx.db.account_payment().insert(AccountPayment {
            id: 0,
            organization_id: fixture.organization_id,
            company_id: fixture.company_id,
            name: Some(name.to_string()),
            move_id: None,
            reversal_move_id: None,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount,
            currency_id,
            date: ctx.timestamp,
            journal_id,
            ref_: None,
            memo: None,
            reconciled_invoice_ids: vec![],
            reconciled_bill_ids: vec![],
            state: PaymentState::NotPaid,
            created_at: ctx.timestamp,
            create_uid: ctx.sender(),
        });
        let paid = crate::seed::seed_posted_payment(ctx, draft)?;
        let move_id = paid.move_id.ok_or("seed payment missing ledger move")?;
        let header = ctx
            .db
            .account_move()
            .id()
            .find(&move_id)
            .ok_or("seed payment move missing")?;
        assert_eq!(header.state, AccountMoveState::Posted);
        assert_eq!(header.organization_id, fixture.organization_id);
        assert_eq!(header.company_id, fixture.company_id);
        assert_eq!(header.currency_id, currency_id);
        assert_eq!(header.partner_id, Some(fixture.partner_id));
        let lines: Vec<_> = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&move_id)
            .collect();
        assert_eq!(lines.len(), 2);
        assert!((lines.iter().map(|l| l.debit - l.credit).sum::<f64>()).abs() < 0.000_001);
        for line in &lines {
            assert_eq!(line.parent_state, AccountMoveState::Posted);
            assert_eq!(line.payment_id, Some(paid.id));
            assert_eq!(line.organization_id, fixture.organization_id);
            assert_eq!(line.company_id, fixture.company_id);
            assert_eq!(line.currency_id, currency_id);
            assert_eq!(line.company_currency_id, currency_id);
            assert_eq!(line.partner_id, Some(fixture.partner_id));
        }
        payments.push(paid);
    }
    reconcile_payment_with_invoice(
        ctx,
        fixture.organization_id,
        payments[0]
            .move_id
            .ok_or("settled seed payment missing move")?,
        settled_invoice_id,
    )?;
    let settled_order = ctx
        .db
        .sale_order()
        .id()
        .find(&linked_order.id)
        .ok_or("settled seed sales order missing")?;
    assert_eq!(settled_order.amount_total, 3_600.0);
    assert_eq!(settled_order.amount_paid, 3_600.0);
    assert_eq!(settled_order.amount_residual, 0.0);
    let mut transactions = Vec::new();
    for (payment, reference, gross, net) in [
        (&payments[1], "SEED-MTN-0001", 15_300.0, 14_700.0),
        (&payments[2], "SEED-WAYNE-PARTIAL", 5_000.0, 5_000.0),
        (&payments[3], "SEED-UNREC-0001", 2_500.0, 2_500.0),
    ] {
        transactions.push(ctx.db.payment_transaction().insert(PaymentTransaction {
            id: 0,
            organization_id: fixture.organization_id,
            company_id: fixture.company_id,
            payment_account_id: account.id,
            direction: PaymentDirection::Inbound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            external_reference: Some(reference.to_string()),
            reference_fingerprint: reference.to_lowercase(),
            gross_external_amount: gross,
            settlement_amount: payment.amount,
            net_account_amount: net,
            currency_id,
            occurred_at: ctx.timestamp,
            status: PaymentTransactionStatus::Posted,
            account_payment_id: Some(payment.id),
            source_entity: None,
            source_entity_id: None,
            evidence_document_ids: vec![],
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            created_by: ctx.sender(),
            updated_by: ctx.sender(),
            voided_at: None,
            metadata: None,
        }));
    }
    let fee = ctx.db.payment_fee().insert(PaymentFee {
        id: 0,
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        payment_transaction_id: transactions[0].id,
        bearer: PaymentFeeBearer::Company,
        amount: 300.0,
        currency_id,
        fee_account_id: None,
        tax_account_id: None,
        tax_amount: 0.0,
        provider_reference: None,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: None,
    });
    let invoice_line = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_id)
        .find(|line| line.account_internal_type.as_deref() == Some("receivable"))
        .ok_or("partial owner invoice has no AR line")?;
    allocate_payment_transaction(
        ctx,
        fixture.organization_id,
        AllocatePaymentParams {
            idempotency_key: format!("seed-ledger-regression-{}", transactions[1].id),
            company_id: fixture.company_id,
            payment_transaction_id: transactions[1].id,
            allocated_move_line_id: invoice_line.id,
            allocated_amount: 5_000.0,
            currency_id,
            write_off_amount: 0.0,
            write_off_account_id: None,
            metadata: None,
        },
    )?;
    let allocation = ctx
        .db
        .payment_reconciliation()
        .iter()
        .find(|row| row.payment_transaction_id == transactions[1].id)
        .ok_or("seed allocation absent")?;
    assert_eq!(allocation.allocated_amount, 5_000.0);
    assert_eq!(allocation.residual_before, 13_750.0);
    assert_eq!(allocation.residual_after, 8_750.0);
    assert_eq!(
        ctx.db
            .account_move()
            .id()
            .find(&invoice_id)
            .ok_or("owner invoice missing")?
            .amount_residual,
        8_750.0
    );
    assert_eq!(
        ctx.db
            .account_move_line()
            .id()
            .find(&invoice_line.id)
            .ok_or("owner invoice AR missing")?
            .amount_residual,
        8_750.0
    );
    for (payment, expected) in payments.iter().zip([0.0, 15_000.0, 0.0, 2_500.0]) {
        let remaining: f64 = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&payment.move_id.ok_or("seed payment move absent")?)
            .filter(|line| line.account_internal_type.as_deref() == Some("receivable"))
            .map(|line| line.amount_residual.abs())
            .sum();
        assert_eq!(remaining, expected);
    }
    assert_eq!(fee.amount, 300.0);
    assert_eq!(
        transactions
            .iter()
            .map(|row| row.settlement_amount)
            .sum::<f64>(),
        22_500.0
    );
    Ok(())
}
