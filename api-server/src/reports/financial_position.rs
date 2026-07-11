//! Typed, ledger-backed owner report for cash and mobile money.
//!
//! These projections deliberately consume only posted payment/accounting rows.  The
//! operational daily summary lives in its own module because it has a different
//! truth boundary and watermark.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::daily_business_summary::MoneyAmount;

const MAX_UNRECONCILED_LINES: usize = 50;

#[derive(Debug, Deserialize)]
pub struct PaymentAccountSourceRow {
    pub id: u64,
    pub name: String,
    pub provider_code: String,
    pub reference_masked: Option<String>,
    pub currency_id: u64,
    pub account_journal_id: u64,
}

#[derive(Debug, Deserialize)]
pub struct PostedPaymentSourceRow {
    pub id: u64,
    pub payment_account_id: u64,
    pub direction: String,
    pub settlement_amount: f64,
    pub net_account_amount: f64,
    pub currency_id: u64,
}

#[derive(Debug, Deserialize)]
pub struct PaymentFeeSourceRow {
    pub payment_transaction_id: u64,
    pub amount: f64,
    pub tax_amount: f64,
    pub currency_id: u64,
}

#[derive(Debug, Deserialize)]
pub struct JournalDefaultAccountRow {
    pub id: u64,
    pub default_account_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct LiquidityMoveLineRow {
    pub journal_id: u64,
    pub account_id: u64,
    pub balance: f64,
}

#[derive(Debug, Deserialize)]
pub struct PaymentReconciliationSourceRow {
    pub payment_transaction_id: u64,
    pub is_reversal: bool,
}

#[derive(Debug, Deserialize)]
pub struct UnreconciledPaymentSourceRow {
    pub id: u64,
    pub payment_account_id: u64,
    pub external_reference: Option<String>,
    pub occurred_at: String,
    pub net_account_amount: f64,
    pub currency_id: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashAccountLine {
    pub payment_account_id: u64,
    pub name: String,
    pub provider: String,
    pub reference_masked: Option<String>,
    pub opening: MoneyAmount,
    pub receipts: MoneyAmount,
    pub disbursements: MoneyAmount,
    pub fees: MoneyAmount,
    pub closing: MoneyAmount,
    pub closing_movement: MoneyAmount,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSummary {
    pub provider: String,
    pub receipts: MoneyAmount,
    pub disbursements: MoneyAmount,
    pub fees: MoneyAmount,
    pub net: MoneyAmount,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreconciledPaymentLine {
    pub payment_transaction_id: u64,
    pub payment_account_id: u64,
    pub reference_masked: Option<String>,
    pub occurred_at: String,
    pub amount: MoneyAmount,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreconciledSummary {
    pub count: u32,
    pub lines: Vec<UnreconciledPaymentLine>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashMobileMoneyReportV1 {
    pub opening: MoneyAmount,
    pub receipts: MoneyAmount,
    pub disbursements: MoneyAmount,
    pub fees: MoneyAmount,
    pub closing: MoneyAmount,
    pub accounts: Vec<CashAccountLine>,
    pub providers: Vec<ProviderSummary>,
    pub unreconciled: UnreconciledSummary,
}

#[derive(Debug, Clone, Copy, Default)]
struct WindowMovement {
    receipts: i64,
    disbursements: i64,
    fees: i64,
}

pub fn ledger_opening_by_journal(
    journals: &[JournalDefaultAccountRow],
    lines: &[LiquidityMoveLineRow],
    currency_id: u64,
) -> BTreeMap<u64, i64> {
    let liquidity_account_by_journal = journals
        .iter()
        .map(|journal| (journal.id, journal.default_account_id))
        .collect::<BTreeMap<_, _>>();

    let mut opening = BTreeMap::<u64, i64>::new();
    for line in lines {
        let Some(default_account_id) = liquidity_account_by_journal.get(&line.journal_id) else {
            continue;
        };
        if default_account_id.is_some_and(|account_id| account_id != line.account_id) {
            continue;
        }
        *opening.entry(line.journal_id).or_default() += minor_units(line.balance);
    }
    let _ = currency_id;
    opening
}

pub fn aggregate_cash_mobile_money(
    accounts: Vec<PaymentAccountSourceRow>,
    opening_by_journal: BTreeMap<u64, i64>,
    prior_payments: Vec<PostedPaymentSourceRow>,
    prior_fees: Vec<PaymentFeeSourceRow>,
    payments: Vec<PostedPaymentSourceRow>,
    fees: Vec<PaymentFeeSourceRow>,
    unreconciled: Vec<UnreconciledPaymentSourceRow>,
    currency_id: u64,
) -> CashMobileMoneyReportV1 {
    let prior_movement = movement_by_account(&prior_payments, &prior_fees, currency_id);
    let window_movement = movement_by_account(&payments, &fees, currency_id);

    let mut receipts = 0_i64;
    let mut disbursements = 0_i64;
    let mut total_fees = 0_i64;
    let mut provider_totals = BTreeMap::<String, WindowMovement>::new();
    let mut account_lines = Vec::new();

    for account in accounts
        .into_iter()
        .filter(|account| account.currency_id == currency_id)
    {
        let ledger_opening = opening_by_journal
            .get(&account.account_journal_id)
            .copied()
            .unwrap_or_default();
        let reconstructed_opening = prior_movement
            .get(&account.id)
            .map(|movement| movement.receipts - movement.disbursements - movement.fees)
            .unwrap_or_default();
        let opening = if ledger_opening != 0 {
            ledger_opening
        } else {
            reconstructed_opening
        };

        let movement = window_movement
            .get(&account.id)
            .copied()
            .unwrap_or_default();
        receipts += movement.receipts;
        disbursements += movement.disbursements;
        total_fees += movement.fees;

        let provider_key = account.provider_code.clone();
        let provider = provider_totals.entry(provider_key).or_default();
        provider.receipts += movement.receipts;
        provider.disbursements += movement.disbursements;
        provider.fees += movement.fees;

        let closing_movement = movement.receipts - movement.disbursements - movement.fees;
        account_lines.push(CashAccountLine {
            payment_account_id: account.id,
            name: account.name,
            provider: account.provider_code,
            reference_masked: account.reference_masked,
            opening: amount(opening),
            receipts: amount(movement.receipts),
            disbursements: amount(movement.disbursements),
            fees: amount(movement.fees),
            closing: amount(opening + closing_movement),
            closing_movement: amount(closing_movement),
        });
    }

    let total_opening: i64 = account_lines
        .iter()
        .map(|line| line.opening.minor_units)
        .sum();
    let providers = provider_totals
        .into_iter()
        .map(|(provider, movement)| ProviderSummary {
            provider,
            receipts: amount(movement.receipts),
            disbursements: amount(movement.disbursements),
            fees: amount(movement.fees),
            net: amount(movement.receipts - movement.disbursements - movement.fees),
        })
        .collect();

    let unreconciled_filtered = unreconciled
        .into_iter()
        .filter(|payment| payment.currency_id == currency_id)
        .collect::<Vec<_>>();
    let unreconciled_count = unreconciled_filtered.len() as u32;
    let unreconciled_lines = unreconciled_filtered
        .into_iter()
        .take(MAX_UNRECONCILED_LINES)
        .map(|payment| UnreconciledPaymentLine {
            payment_transaction_id: payment.id,
            payment_account_id: payment.payment_account_id,
            reference_masked: mask_payment_reference(payment.external_reference.as_deref()),
            occurred_at: payment.occurred_at,
            amount: amount(minor_units(payment.net_account_amount)),
        })
        .collect::<Vec<_>>();

    CashMobileMoneyReportV1 {
        opening: amount(total_opening),
        receipts: amount(receipts),
        disbursements: amount(disbursements),
        fees: amount(total_fees),
        closing: amount(total_opening + receipts - disbursements - total_fees),
        accounts: account_lines,
        providers,
        unreconciled: UnreconciledSummary {
            count: unreconciled_count,
            lines: unreconciled_lines,
        },
    }
}

fn movement_by_account(
    payments: &[PostedPaymentSourceRow],
    fees: &[PaymentFeeSourceRow],
    currency_id: u64,
) -> BTreeMap<u64, WindowMovement> {
    let mut fee_by_payment = BTreeMap::<u64, i64>::new();
    for fee in fees.iter().filter(|fee| fee.currency_id == currency_id) {
        *fee_by_payment
            .entry(fee.payment_transaction_id)
            .or_default() += minor_units(fee.amount + fee.tax_amount);
    }

    let mut movement_by_account = BTreeMap::<u64, WindowMovement>::new();
    for payment in payments
        .iter()
        .filter(|payment| payment.currency_id == currency_id)
    {
        let amount = minor_units(payment.net_account_amount);
        let fee = fee_by_payment.remove(&payment.id).unwrap_or_default();
        let movement = movement_by_account
            .entry(payment.payment_account_id)
            .or_default();
        movement.fees += fee;
        if payment.direction.eq_ignore_ascii_case("inbound") {
            movement.receipts += amount;
        } else {
            movement.disbursements += amount;
        }
    }
    movement_by_account
}

fn mask_payment_reference(reference: Option<&str>) -> Option<String> {
    let reference = reference?.trim();
    if reference.is_empty() {
        return None;
    }
    if reference.len() <= 4 {
        return Some("*".repeat(reference.len()));
    }
    Some(format!("***{}", &reference[reference.len() - 4..]))
}

fn minor_units(value: f64) -> i64 {
    (value * 100.0).round() as i64
}
fn amount(minor_units: i64) -> MoneyAmount {
    MoneyAmount {
        minor_units,
        scale: 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(id: u64, journal_id: u64) -> PaymentAccountSourceRow {
        PaymentAccountSourceRow {
            id,
            name: format!("Account {id}"),
            provider_code: if id == 2 { "Mtn".into() } else { "Cash".into() },
            reference_masked: Some("***1234".into()),
            currency_id: 1,
            account_journal_id: journal_id,
        }
    }

    #[test]
    fn cash_report_uses_posted_net_movements_and_masks_references() {
        let report = aggregate_cash_mobile_money(
            vec![account(1, 10)],
            BTreeMap::new(),
            vec![],
            vec![],
            vec![PostedPaymentSourceRow {
                id: 9,
                payment_account_id: 1,
                direction: "Inbound".into(),
                settlement_amount: 11.0,
                net_account_amount: 10.0,
                currency_id: 1,
            }],
            vec![PaymentFeeSourceRow {
                payment_transaction_id: 9,
                amount: 0.5,
                tax_amount: 0.5,
                currency_id: 1,
            }],
            vec![],
            1,
        );
        assert_eq!(report.opening.minor_units, 0);
        assert_eq!(report.closing.minor_units, 900);
        assert_eq!(report.accounts[0].closing_movement.minor_units, 900);
        assert_eq!(report.accounts[0].closing.minor_units, 900);
        assert_eq!(
            report.accounts[0].reference_masked.as_deref(),
            Some("***1234")
        );
    }

    #[test]
    fn cash_report_applies_ledger_opening_and_closing_balance() {
        let mut opening = BTreeMap::new();
        opening.insert(10, 5_000);
        let report = aggregate_cash_mobile_money(
            vec![account(1, 10)],
            opening,
            vec![],
            vec![],
            vec![PostedPaymentSourceRow {
                id: 9,
                payment_account_id: 1,
                direction: "Inbound".into(),
                settlement_amount: 10.0,
                net_account_amount: 10.0,
                currency_id: 1,
            }],
            vec![],
            vec![],
            1,
        );
        assert_eq!(report.opening.minor_units, 5_000);
        assert_eq!(report.accounts[0].opening.minor_units, 5_000);
        assert_eq!(report.accounts[0].closing.minor_units, 6_000);
        assert_eq!(report.closing.minor_units, 6_000);
    }

    #[test]
    fn cash_report_reconstructs_opening_from_prior_posted_movements() {
        let report = aggregate_cash_mobile_money(
            vec![account(1, 10)],
            BTreeMap::new(),
            vec![PostedPaymentSourceRow {
                id: 1,
                payment_account_id: 1,
                direction: "Inbound".into(),
                settlement_amount: 20.0,
                net_account_amount: 20.0,
                currency_id: 1,
            }],
            vec![],
            vec![PostedPaymentSourceRow {
                id: 9,
                payment_account_id: 1,
                direction: "Inbound".into(),
                settlement_amount: 10.0,
                net_account_amount: 10.0,
                currency_id: 1,
            }],
            vec![],
            vec![],
            1,
        );
        assert_eq!(report.opening.minor_units, 2_000);
        assert_eq!(report.closing.minor_units, 3_000);
    }

    #[test]
    fn cash_report_aggregates_provider_totals() {
        let report = aggregate_cash_mobile_money(
            vec![account(1, 10), account(2, 11)],
            BTreeMap::new(),
            vec![],
            vec![],
            vec![
                PostedPaymentSourceRow {
                    id: 1,
                    payment_account_id: 1,
                    direction: "Inbound".into(),
                    settlement_amount: 10.0,
                    net_account_amount: 10.0,
                    currency_id: 1,
                },
                PostedPaymentSourceRow {
                    id: 2,
                    payment_account_id: 2,
                    direction: "Outbound".into(),
                    settlement_amount: 4.0,
                    net_account_amount: 4.0,
                    currency_id: 1,
                },
            ],
            vec![PaymentFeeSourceRow {
                payment_transaction_id: 2,
                amount: 1.0,
                tax_amount: 0.0,
                currency_id: 1,
            }],
            vec![],
            1,
        );
        assert_eq!(report.providers.len(), 2);
        let mtn = report
            .providers
            .iter()
            .find(|provider| provider.provider == "Mtn")
            .expect("mtn provider");
        assert_eq!(mtn.disbursements.minor_units, 400);
        assert_eq!(mtn.fees.minor_units, 100);
        assert_eq!(mtn.net.minor_units, -500);
    }

    #[test]
    fn cash_report_counts_unreconciled_transactions_and_masks_reference() {
        let unreconciled = vec![UnreconciledPaymentSourceRow {
            id: 42,
            payment_account_id: 1,
            external_reference: Some("TEST-MTN-0001".into()),
            occurred_at: "2026-07-10T12:00:00Z".into(),
            net_account_amount: 12.0,
            currency_id: 1,
        }];
        let report = aggregate_cash_mobile_money(
            vec![account(1, 10)],
            BTreeMap::new(),
            vec![],
            vec![],
            vec![],
            vec![],
            unreconciled,
            1,
        );
        assert_eq!(report.unreconciled.count, 1);
        assert_eq!(
            report.unreconciled.lines[0].reference_masked.as_deref(),
            Some("***0001")
        );
    }

    #[test]
    fn ledger_opening_uses_liquidity_account_only() {
        let opening = ledger_opening_by_journal(
            &[JournalDefaultAccountRow {
                id: 10,
                default_account_id: Some(100),
            }],
            &[
                LiquidityMoveLineRow {
                    journal_id: 10,
                    account_id: 100,
                    balance: 12.34,
                },
                LiquidityMoveLineRow {
                    journal_id: 10,
                    account_id: 200,
                    balance: 99.0,
                },
            ],
            1,
        );
        assert_eq!(opening.get(&10), Some(&1234));
    }
}
