//! MONEY / IDEMPOTENCY / TENANCY certification for operational payments and
//! statement staging. Assertions compare integer minor units (`super::money`).
//!
//! SpacetimeDB serializes reducer transactions, so "concurrent" cashier actions reduce
//! to an interleaving at this layer; true request concurrency through the BFF is
//! exercised by `pretenant-payment-adversarial.spec.ts`.

use spacetimedb::{ReducerContext, Table};

use super::money::{from_minor, require_minor_eq, to_minor};
use super::{run_cases, setup, CertCase};
use crate::accounting::bank_reconciliation::{
    bank_statement_import, bank_statement_import_line, stage_bank_statement_import,
    StageBankStatementImportLineParams, StageBankStatementImportParams,
};
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::accounting::payment_management::{
    allocate_payment_transaction, create_payment_account, create_payment_transaction,
    payment_account, payment_reconciliation, payment_reversal, payment_transaction,
    post_payment_transaction, reverse_payment_transaction_impl, AllocatePaymentParams,
    CreatePaymentAccountParams, CreatePaymentTransactionParams, ReversePaymentTransactionParams,
};
use crate::accounting::payments::account_payment;
use crate::accounting_tests::helpers::{create_balanced_customer_invoice, seed_bank_journal};
use crate::core::audit::audit_log;
use crate::core::organization::company;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{PartnerType, PaymentDirection, PaymentProviderCode, PaymentTransactionStatus};

const CENTS: u32 = 2;

pub const CASES: &[CertCase] = &[
    ("PAY-01", pay_01_interleaved_allocations_never_exceed_payment),
    ("PAY-02", pay_02_post_retry_has_single_ledger_effect),
    ("PAY-03", pay_03_post_retry_is_idempotent_success),
    ("PAY-04", pay_04_reversal_retry_is_single_compensation),
    ("PAY-05", pay_05_reversal_retry_is_idempotent_success),
    ("PAY-06", pay_06_overpayment_stays_explicit_unapplied),
    ("PAY-07", pay_07_reference_duplicate_scope),
    ("PAY-08", pay_08_many_small_allocations_reconcile_exactly),
    ("PAY-09", pay_09_large_values_settle_exactly),
    ("PAY-10", pay_10_statement_staging_fixture_matrix),
    ("PAY-11A", pay_11a_conflicting_statement_replay_does_not_mutate),
    ("PAY-11B", pay_11b_conflicting_statement_replay_fails_closed),
];

pub fn run_payments_certification(ctx: &ReducerContext) -> Result<(), String> {
    run_cases(ctx, "payments", CASES)
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

pub(super) struct Wallet {
    pub(super) fixture: OrgFixture,
    pub(super) account_id: u64,
    pub(super) currency_id: u64,
}

impl Wallet {
    pub(super) fn org(&self) -> u64 {
        self.fixture.organization_id
    }
    pub(super) fn company(&self) -> u64 {
        self.fixture.company_id
    }
}

pub(super) fn wallet(ctx: &ReducerContext, tag: &str) -> Result<Wallet, String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .map(|c| c.currency_id)
        .ok_or("company missing")?;
    let name = format!("{tag} MTN wallet");
    create_payment_account(
        ctx,
        fixture.organization_id,
        CreatePaymentAccountParams {
            company_id: fixture.company_id,
            provider_code: PaymentProviderCode::Mtn,
            name: name.clone(),
            provider_label: None,
            reference_raw: None,
            currency_id,
            account_journal_id: journal_id,
            fee_account_id: None,
            clearing_account_id: None,
            is_primary: false,
            metadata: Some(r#"{"test":"pretenant"}"#.to_string()),
        },
    )?;
    let account_id = ctx
        .db
        .payment_account()
        .iter()
        .find(|a| a.organization_id == fixture.organization_id && a.name == name)
        .map(|a| a.id)
        .ok_or("payment account missing")?;
    Ok(Wallet {
        fixture,
        account_id,
        currency_id,
    })
}

pub(super) fn create_receipt(
    ctx: &ReducerContext,
    w: &Wallet,
    reference: &str,
    amount: f64,
) -> Result<u64, String> {
    create_payment_transaction(
        ctx,
        w.org(),
        CreatePaymentTransactionParams {
            company_id: w.company(),
            payment_account_id: w.account_id,
            direction: PaymentDirection::Inbound,
            partner_type: PartnerType::Customer,
            partner_id: w.fixture.partner_id,
            external_reference: Some(reference.to_string()),
            gross_external_amount: amount,
            settlement_amount: amount,
            net_account_amount: amount,
            currency_id: w.currency_id,
            occurred_at: Some(ctx.timestamp),
            source_entity: None,
            source_entity_id: None,
            evidence_document_ids: vec![],
            metadata: Some(r#"{"test":"pretenant"}"#.to_string()),
        },
    )?;
    ctx.db
        .payment_transaction()
        .iter()
        .find(|t| t.organization_id == w.org() && t.external_reference.as_deref() == Some(reference))
        .map(|t| t.id)
        .ok_or_else(|| format!("payment transaction {reference} missing"))
}

pub(super) fn posted_receipt(
    ctx: &ReducerContext,
    w: &Wallet,
    reference: &str,
    amount: f64,
) -> Result<u64, String> {
    let id = create_receipt(ctx, w, reference, amount)?;
    post_payment_transaction(ctx, w.org(), id)?;
    Ok(id)
}

/// Posted customer invoice and its receivable line.
pub(super) fn invoice(ctx: &ReducerContext, w: &Wallet, amount: f64) -> Result<(u64, u64), String> {
    let invoice_id = create_balanced_customer_invoice(ctx, &w.fixture, amount, true)?;
    let line_id = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_id)
        .find(|line| {
            line.account_internal_type
                .as_deref()
                .is_some_and(|kind| kind.eq_ignore_ascii_case("receivable"))
        })
        .map(|line| line.id)
        .ok_or("invoice receivable line missing")?;
    Ok((invoice_id, line_id))
}

pub(super) fn allocate(
    ctx: &ReducerContext,
    w: &Wallet,
    transaction_id: u64,
    line_id: u64,
    amount: f64,
    key: &str,
) -> Result<(), String> {
    allocate_payment_transaction(
        ctx,
        w.org(),
        AllocatePaymentParams {
            idempotency_key: key.to_string(),
            company_id: w.company(),
            payment_transaction_id: transaction_id,
            allocated_move_line_id: line_id,
            allocated_amount: amount,
            currency_id: w.currency_id,
            write_off_amount: 0.0,
            write_off_account_id: None,
            metadata: None,
        },
    )
}

/// Net allocated amount (reversal rows carry negative amounts), in minor units.
pub(super) fn net_allocated_minor(ctx: &ReducerContext, transaction_id: u64) -> i128 {
    ctx.db
        .payment_reconciliation()
        .iter()
        .filter(|r| r.payment_transaction_id == transaction_id)
        .map(|r| to_minor(r.allocated_amount, CENTS))
        .sum()
}

pub(super) fn invoice_residual(ctx: &ReducerContext, invoice_id: u64) -> Result<f64, String> {
    ctx.db
        .account_move()
        .id()
        .find(&invoice_id)
        .map(|m| m.amount_residual)
        .ok_or_else(|| format!("invoice {invoice_id} missing"))
}

/// Remaining unapplied amount on the payment's receivable/payable clearing line.
pub(super) fn unapplied(ctx: &ReducerContext, transaction_id: u64) -> Result<f64, String> {
    let account_payment_id = ctx
        .db
        .payment_transaction()
        .id()
        .find(&transaction_id)
        .and_then(|t| t.account_payment_id)
        .ok_or("transaction has no ledger payment")?;
    let move_id = ctx
        .db
        .account_payment()
        .id()
        .find(&account_payment_id)
        .and_then(|p| p.move_id)
        .ok_or("ledger payment has no move")?;
    Ok(ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .filter(|line| {
            line.account_internal_type.as_deref().is_some_and(|kind| {
                kind.eq_ignore_ascii_case("receivable") || kind.eq_ignore_ascii_case("payable")
            })
        })
        .map(|line| line.amount_residual.abs())
        .sum())
}

fn audits(ctx: &ReducerContext, org: u64, table: &str, record_id: u64, action: &str) -> usize {
    ctx.db
        .audit_log()
        .iter()
        .filter(|a| {
            a.organization_id == org
                && a.table_name == table
                && a.record_id == record_id
                && a.action == action
        })
        .count()
}

// ── Cases ─────────────────────────────────────────────────────────────────────

/// Cashier A allocates 80 and cashier B 50 against a 100 payment: committed allocations
/// stay within the payment and residuals reconcile exactly.
fn pay_01_interleaved_allocations_never_exceed_payment(ctx: &ReducerContext) -> Result<(), String> {
    let w = setup("wallet", wallet(ctx, "pay01"))?;
    let (invoice_a, line_a) = setup("invoice A", invoice(ctx, &w, 80.0))?;
    let (invoice_b, line_b) = setup("invoice B", invoice(ctx, &w, 50.0))?;
    let (_, line_c) = setup("invoice C", invoice(ctx, &w, 10.0))?;
    let payment = setup("receipt", posted_receipt(ctx, &w, "PAY01-MOMO", 100.0))?;

    allocate(ctx, &w, payment, line_a, 80.0, "pay01-cashier-a")?;
    if allocate(ctx, &w, payment, line_b, 50.0, "pay01-cashier-b").is_ok() {
        return Err("second cashier allocation exceeded the available payment".to_string());
    }
    require_minor_eq("net allocated", from_minor(net_allocated_minor(ctx, payment), CENTS), 8_000, CENTS)?;
    require_minor_eq("invoice A residual", invoice_residual(ctx, invoice_a)?, 0, CENTS)?;
    require_minor_eq("invoice B residual", invoice_residual(ctx, invoice_b)?, 5_000, CENTS)?;
    require_minor_eq("unapplied", unapplied(ctx, payment)?, 2_000, CENTS)?;

    allocate(ctx, &w, payment, line_b, 20.0, "pay01-cashier-b-retry")?;
    require_minor_eq("invoice B residual after 20", invoice_residual(ctx, invoice_b)?, 3_000, CENTS)?;
    require_minor_eq("unapplied after 20", unapplied(ctx, payment)?, 0, CENTS)?;
    if allocate(ctx, &w, payment, line_c, 0.01, "pay01-exhausted").is_ok() {
        return Err("allocation accepted after the payment was fully applied".to_string());
    }
    Ok(())
}

fn post_twice(ctx: &ReducerContext, tag: &str) -> Result<(Wallet, u64, Result<(), String>), String> {
    let w = setup("wallet", wallet(ctx, tag))?;
    let payment = setup("receipt", create_receipt(ctx, &w, &format!("{tag}-REF"), 42.0))?;
    setup("first post", post_payment_transaction(ctx, w.org(), payment))?;
    let retry = post_payment_transaction(ctx, w.org(), payment);
    Ok((w, payment, retry))
}

/// "Post Payment" commits, the response is lost and the user retries: one ledger effect.
fn pay_02_post_retry_has_single_ledger_effect(ctx: &ReducerContext) -> Result<(), String> {
    let (w, payment, _) = post_twice(ctx, "pay02")?;
    let ledger_payments = ctx
        .db
        .account_payment()
        .iter()
        .filter(|p| p.organization_id == w.org())
        .count();
    if ledger_payments != 1 {
        return Err(format!("retry produced {ledger_payments} ledger payments"));
    }
    let row = ctx
        .db
        .payment_transaction()
        .id()
        .find(&payment)
        .ok_or("transaction missing")?;
    if row.status != PaymentTransactionStatus::Posted || row.account_payment_id.is_none() {
        return Err("retry changed posted transaction state".to_string());
    }
    let posts = audits(ctx, w.org(), "payment_transaction", payment, "POST");
    if posts != 1 {
        return Err(format!("retry produced {posts} POST audits"));
    }
    Ok(())
}

/// The retry must be distinguishable from failure: it succeeds without a second effect.
fn pay_03_post_retry_is_idempotent_success(ctx: &ReducerContext) -> Result<(), String> {
    let (_, _, retry) = post_twice(ctx, "pay03")?;
    retry.map_err(|error| format!("post retry after committed post failed: {error}"))
}

fn settle_and_reverse_twice(
    ctx: &ReducerContext,
    tag: &str,
) -> Result<(Wallet, u64, u64, Result<(), String>), String> {
    let w = setup("wallet", wallet(ctx, tag))?;
    let (invoice_id, line_id) = setup("invoice", invoice(ctx, &w, 100.0))?;
    let payment = setup("receipt", posted_receipt(ctx, &w, &format!("{tag}-REF"), 100.0))?;
    setup("full allocation", allocate(ctx, &w, payment, line_id, 100.0, &format!("{tag}-alloc")))?;
    let reverse = |ctx: &ReducerContext| {
        reverse_payment_transaction_impl(
            ctx,
            w.org(),
            payment,
            ReversePaymentTransactionParams {
                company_id: w.company(),
                reason: Some("provider chargeback".to_string()),
                metadata: Some(r#"{"test":"pretenant"}"#.to_string()),
            },
            true,
        )
    };
    setup("first reversal", reverse(ctx))?;
    let retry = reverse(ctx);
    Ok((w, payment, invoice_id, retry))
}

/// Provider reversal after settlement: one compensating transaction, invoice balance
/// restored, original payment immutable, complete audit.
fn pay_04_reversal_retry_is_single_compensation(ctx: &ReducerContext) -> Result<(), String> {
    let (w, payment, invoice_id, _) = settle_and_reverse_twice(ctx, "pay04")?;
    let reversals = ctx
        .db
        .payment_reversal()
        .iter()
        .filter(|r| r.original_transaction_id == payment)
        .count();
    if reversals != 1 {
        return Err(format!("reversal retry produced {reversals} reversal records"));
    }
    let corrections = ctx
        .db
        .payment_transaction()
        .iter()
        .filter(|t| {
            t.organization_id == w.org()
                && t.source_entity.as_deref() == Some("reversal")
                && t.source_entity_id == Some(payment)
        })
        .count();
    if corrections != 1 {
        return Err(format!("reversal retry produced {corrections} compensating transactions"));
    }
    let original = ctx
        .db
        .payment_transaction()
        .id()
        .find(&payment)
        .ok_or("original transaction missing")?;
    if original.status != PaymentTransactionStatus::Reversed
        || original.external_reference.as_deref() != Some("pay04-REF")
        || to_minor(original.settlement_amount, CENTS) != 10_000
        || to_minor(original.gross_external_amount, CENTS) != 10_000
    {
        return Err("original payment facts were mutated by reversal".to_string());
    }
    let original_ledger = original
        .account_payment_id
        .and_then(|id| ctx.db.account_payment().id().find(&id));
    if original_ledger.is_none() {
        return Err("original ledger payment is no longer traceable".to_string());
    }
    require_minor_eq("invoice residual after reversal", invoice_residual(ctx, invoice_id)?, 10_000, CENTS)?;
    require_minor_eq("net allocation after reversal", from_minor(net_allocated_minor(ctx, payment), CENTS), 0, CENTS)?;
    let reversal_id = ctx
        .db
        .payment_reversal()
        .iter()
        .find(|r| r.original_transaction_id == payment)
        .map(|r| r.id)
        .ok_or("reversal missing")?;
    if audits(ctx, w.org(), "payment_reversal", reversal_id, "CREATE") != 1 {
        return Err("reversal audit is missing or duplicated".to_string());
    }
    Ok(())
}

fn pay_05_reversal_retry_is_idempotent_success(ctx: &ReducerContext) -> Result<(), String> {
    let (_, _, _, retry) = settle_and_reverse_twice(ctx, "pay05")?;
    retry.map_err(|error| format!("reversal retry after committed reversal failed: {error}"))
}

/// Invoice 100, payment 120: 100 allocated, 20 stays explicit unapplied, no write-off.
fn pay_06_overpayment_stays_explicit_unapplied(ctx: &ReducerContext) -> Result<(), String> {
    let w = setup("wallet", wallet(ctx, "pay06"))?;
    let (invoice_id, line_id) = setup("invoice", invoice(ctx, &w, 100.0))?;
    let payment = setup("receipt", posted_receipt(ctx, &w, "PAY06-REF", 120.0))?;
    if allocate(ctx, &w, payment, line_id, 120.0, "pay06-over").is_ok() {
        return Err("allocation beyond the invoice residual was accepted".to_string());
    }
    allocate(ctx, &w, payment, line_id, 100.0, "pay06-exact")?;
    let rows: Vec<_> = ctx
        .db
        .payment_reconciliation()
        .iter()
        .filter(|r| r.payment_transaction_id == payment)
        .collect();
    if rows.len() != 1 || rows.iter().any(|r| to_minor(r.write_off_amount, CENTS) != 0 || r.write_off_move_id.is_some()) {
        return Err("overpayment produced an implicit write-off or extra allocation".to_string());
    }
    require_minor_eq("invoice residual", invoice_residual(ctx, invoice_id)?, 0, CENTS)?;
    require_minor_eq("unapplied customer credit", unapplied(ctx, payment)?, 2_000, CENTS)?;
    let settlement = ctx
        .db
        .payment_transaction()
        .id()
        .find(&payment)
        .map(|t| t.settlement_amount)
        .ok_or("transaction missing")?;
    require_minor_eq("settlement unchanged", settlement, 12_000, CENTS)
}

/// Normalized duplicates are rejected per payment account; another organization's
/// identical provider reference is an independent scope.
fn pay_07_reference_duplicate_scope(ctx: &ReducerContext) -> Result<(), String> {
    let w = setup("wallet", wallet(ctx, "pay07"))?;
    let foreign = setup("foreign wallet", wallet(ctx, "pay07-foreign"))?;
    setup("original", create_receipt(ctx, &w, "MP-2026 0912_AB", 5.0))?;
    if create_receipt(ctx, &w, "mp20260912ab", 5.0).is_ok() {
        return Err("formatting variant of an existing provider reference was accepted".to_string());
    }
    let same_account = ctx
        .db
        .payment_transaction()
        .iter()
        .filter(|t| t.payment_account_id == w.account_id)
        .count();
    if same_account != 1 {
        return Err(format!("duplicate reference persisted {same_account} transactions"));
    }
    create_receipt(ctx, &foreign, "MP-2026 0912_AB", 5.0)
        .map_err(|error| format!("identical reference in another organization was rejected: {error}"))?;
    Ok(())
}

/// Many 0.01 allocations and 0.10/0.20/0.30 splits reconcile to the cent.
fn pay_08_many_small_allocations_reconcile_exactly(ctx: &ReducerContext) -> Result<(), String> {
    let w = setup("wallet", wallet(ctx, "pay08"))?;
    let cents_payment = setup("cent receipt", posted_receipt(ctx, &w, "PAY08-CENTS", 0.20))?;
    let mut invoices = Vec::new();
    for _ in 0..21 {
        invoices.push(setup("cent invoice", invoice(ctx, &w, 0.01))?);
    }
    for (index, (_, line_id)) in invoices.iter().take(20).enumerate() {
        allocate(ctx, &w, cents_payment, *line_id, 0.01, &format!("pay08-cent-{index}"))
            .map_err(|error| format!("cent allocation {index} rejected: {error}"))?;
    }
    if allocate(ctx, &w, cents_payment, invoices[20].1, 0.01, "pay08-cent-overflow").is_ok() {
        return Err("21st cent allocation exceeded a 0.20 payment".to_string());
    }
    if net_allocated_minor(ctx, cents_payment) != 20 {
        return Err("cent allocations do not sum to 20 minor units".to_string());
    }
    for (invoice_id, _) in invoices.iter().take(20) {
        require_minor_eq("cent invoice residual", invoice_residual(ctx, *invoice_id)?, 0, CENTS)?;
    }
    require_minor_eq("cent unapplied", unapplied(ctx, cents_payment)?, 0, CENTS)?;

    let split_payment = setup("split receipt", posted_receipt(ctx, &w, "PAY08-SPLIT", 0.60))?;
    for (index, amount) in [0.10, 0.20, 0.30].into_iter().enumerate() {
        let (invoice_id, line_id) = setup("split invoice", invoice(ctx, &w, amount))?;
        allocate(ctx, &w, split_payment, line_id, amount, &format!("pay08-split-{index}"))
            .map_err(|error| format!("split allocation {amount} rejected: {error}"))?;
        require_minor_eq("split invoice residual", invoice_residual(ctx, invoice_id)?, 0, CENTS)?;
    }
    require_minor_eq("split unapplied", unapplied(ctx, split_payment)?, 0, CENTS)
}

/// A ~1.2e10 payment settled by two invoices must reconcile to the cent. Beyond ~1e10
/// the absolute reconciliation epsilon is below f64 resolution (MONEY-PRECISION).
fn pay_09_large_values_settle_exactly(ctx: &ReducerContext) -> Result<(), String> {
    let w = setup("wallet", wallet(ctx, "pay09"))?;
    let (large_invoice, large_line) = setup("large invoice", invoice(ctx, &w, 12_345_678_901.22))?;
    let (cent_invoice, cent_line) = setup("cent invoice", invoice(ctx, &w, 0.01))?;
    let payment = setup("large receipt", posted_receipt(ctx, &w, "PAY09-LARGE", 12_345_678_901.23))?;
    allocate(ctx, &w, payment, large_line, 12_345_678_901.22, "pay09-large")
        .map_err(|error| format!("large allocation rejected: {error}"))?;
    allocate(ctx, &w, payment, cent_line, 0.01, "pay09-final-cent")
        .map_err(|error| format!("final cent of a large payment rejected: {error}"))?;
    require_minor_eq("large invoice residual", invoice_residual(ctx, large_invoice)?, 0, CENTS)?;
    require_minor_eq("cent invoice residual", invoice_residual(ctx, cent_invoice)?, 0, CENTS)?;
    require_minor_eq("large unapplied", unapplied(ctx, payment)?, 0, CENTS)
}

struct StatementScope {
    org: u64,
    company: u64,
    journal_id: u64,
    currency_id: u64,
}

fn statement_scope(ctx: &ReducerContext) -> Result<StatementScope, String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .map(|c| c.currency_id)
        .ok_or("company missing")?;
    Ok(StatementScope {
        org: fixture.organization_id,
        company: fixture.company_id,
        journal_id,
        currency_id,
    })
}

fn stage(
    ctx: &ReducerContext,
    scope: &StatementScope,
    key: &str,
    rows: Vec<StageBankStatementImportLineParams>,
) -> Result<(), String> {
    stage_bank_statement_import(
        ctx,
        scope.org,
        scope.company,
        scope.journal_id,
        scope.currency_id,
        StageBankStatementImportParams {
            file_name: Some(format!("{key}.csv")),
            idempotency_key: key.to_string(),
            opening_balance: 0.0,
            rows,
        },
    )
}

fn statement_row(
    ctx: &ReducerContext,
    row_number: u32,
    dated: bool,
    amount: Option<f64>,
    reference: Option<&str>,
) -> StageBankStatementImportLineParams {
    StageBankStatementImportLineParams {
        row_number,
        date: dated.then_some(ctx.timestamp),
        amount,
        reference: reference.map(str::to_string),
        description: Some(format!("row {row_number}")),
    }
}

fn staged_imports(ctx: &ReducerContext, scope: &StatementScope, key: &str) -> Vec<(u64, u32, u32, String)> {
    ctx.db
        .bank_statement_import()
        .iter()
        .filter(|i| i.organization_id == scope.org && i.company_id == scope.company && i.idempotency_key == key)
        .map(|i| (i.id, i.total_rows, i.invalid_rows, i.state))
        .collect()
}

fn staged_lines(ctx: &ReducerContext, import_id: u64) -> Vec<(u32, Option<i128>, bool)> {
    let mut lines: Vec<_> = ctx
        .db
        .bank_statement_import_line()
        .iter()
        .filter(|l| l.import_id == import_id)
        .map(|l| (l.row_number, l.amount.map(|a| to_minor(a, CENTS)), l.validation_error.is_some()))
        .collect();
    lines.sort_unstable();
    lines
}

/// Server-side staging matrix: negative, zero, non-finite, missing date/amount/reference,
/// duplicate rows, same reference with different amounts, out-of-order row numbers and a
/// large file. CSV-level cases (BOM, delimiter, localized decimals) are client-parsed; see plan.
fn pay_10_statement_staging_fixture_matrix(ctx: &ReducerContext) -> Result<(), String> {
    let scope = setup("statement scope", statement_scope(ctx))?;
    let rows = vec![
        statement_row(ctx, 7, true, Some(-45.10), Some("REF-NEG")),
        statement_row(ctx, 2, true, Some(125.50), Some("REF-1")),
        statement_row(ctx, 3, true, Some(125.50), Some("REF-1")),
        statement_row(ctx, 4, true, Some(125.51), Some("REF-1")),
        statement_row(ctx, 5, true, Some(10.0), None),
        statement_row(ctx, 6, false, Some(1.0), Some("REF-NO-DATE")),
        statement_row(ctx, 8, true, None, Some("REF-NO-AMOUNT")),
        statement_row(ctx, 9, true, Some(0.0), Some("REF-ZERO")),
        statement_row(ctx, 10, true, Some(f64::NAN), Some("REF-NAN")),
        statement_row(ctx, 11, true, Some(f64::INFINITY), Some("REF-INF")),
    ];
    stage(ctx, &scope, "pay10-matrix", rows)?;
    let imports = staged_imports(ctx, &scope, "pay10-matrix");
    let [(import_id, total, invalid, state)] = imports.as_slice() else {
        return Err(format!("expected one staged import, got {}", imports.len()));
    };
    if (*total, *invalid, state.as_str()) != (10, 5, "needs_review") {
        return Err(format!("staging summary mismatch: total={total} invalid={invalid} state={state}"));
    }
    let lines = staged_lines(ctx, *import_id);
    let invalid_rows: Vec<u32> = lines.iter().filter(|l| l.2).map(|l| l.0).collect();
    if invalid_rows != vec![6, 8, 9, 10, 11] {
        return Err(format!("unexpected invalid rows {invalid_rows:?}"));
    }
    let negative = lines.iter().find(|l| l.0 == 7).and_then(|l| l.1);
    if negative != Some(-4_510) {
        return Err(format!("negative amount not preserved exactly: {negative:?}"));
    }

    let huge: Vec<_> = (1..=2_000)
        .map(|n| statement_row(ctx, n, true, Some(0.01 * f64::from(n)), Some("REF-HUGE")))
        .collect();
    stage(ctx, &scope, "pay10-huge", huge)?;
    let huge_imports = staged_imports(ctx, &scope, "pay10-huge");
    let [(huge_id, huge_total, huge_invalid, _)] = huge_imports.as_slice() else {
        return Err("large statement was not staged exactly once".to_string());
    };
    if (*huge_total, *huge_invalid) != (2_000, 0) || staged_lines(ctx, *huge_id).len() != 2_000 {
        return Err("large statement staging lost or invalidated rows".to_string());
    }
    Ok(())
}

fn replay_with_different_payload(ctx: &ReducerContext) -> Result<(StatementScope, Result<(), String>), String> {
    let scope = setup("statement scope", statement_scope(ctx))?;
    setup(
        "first stage",
        stage(ctx, &scope, "pay11-replay", vec![statement_row(ctx, 2, true, Some(125.50), Some("REF-A"))]),
    )?;
    let replay = stage(
        ctx,
        &scope,
        "pay11-replay",
        vec![statement_row(ctx, 2, true, Some(999.99), Some("REF-TAMPERED"))],
    );
    Ok((scope, replay))
}

fn pay_11a_conflicting_statement_replay_does_not_mutate(ctx: &ReducerContext) -> Result<(), String> {
    let (scope, _) = replay_with_different_payload(ctx)?;
    let imports = staged_imports(ctx, &scope, "pay11-replay");
    let [(import_id, ..)] = imports.as_slice() else {
        return Err(format!("replay produced {} imports", imports.len()));
    };
    if staged_lines(ctx, *import_id) != vec![(2, Some(12_550), false)] {
        return Err("replay with a different payload mutated staged lines".to_string());
    }
    Ok(())
}

fn pay_11b_conflicting_statement_replay_fails_closed(ctx: &ReducerContext) -> Result<(), String> {
    let (_, replay) = replay_with_different_payload(ctx)?;
    if replay.is_ok() {
        return Err("idempotency key replay with a different payload was accepted silently".to_string());
    }
    Ok(())
}
