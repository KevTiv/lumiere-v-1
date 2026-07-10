use std::collections::HashSet;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum SaleState {
    Draft,
    Sent,
    Sale,
    Done,
    Cancelled,
    ToApprove,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum PurchaseState {
    Draft,
    Sent,
    ToApprove,
    Purchase,
    Done,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum PaymentDirection {
    Inbound,
    Outbound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum PaymentStatus {
    Draft,
    Posted,
    Reversed,
    Voided,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleSourceRow {
    pub id: u64,
    pub currency_id: u64,
    pub state: SaleState,
    pub amount_untaxed: f64,
    pub amount_tax: f64,
    pub amount_total: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseSourceRow {
    pub id: u64,
    pub currency_id: u64,
    pub state: PurchaseState,
    pub amount_untaxed: f64,
    pub amount_tax: f64,
    pub amount_total: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentSourceRow {
    pub id: u64,
    pub currency_id: u64,
    pub direction: PaymentDirection,
    pub status: PaymentStatus,
    pub settlement_amount: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeeSourceRow {
    pub id: u64,
    pub payment_transaction_id: u64,
    pub currency_id: u64,
    pub amount: f64,
    pub tax_amount: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockSourceRow {
    pub id: u64,
    pub product_id: u64,
    pub quantity: f64,
    pub reserved_quantity: f64,
    pub available_quantity: f64,
    pub is_outdated: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct DailyBusinessSummarySource {
    pub sales: Vec<SaleSourceRow>,
    pub payments: Vec<PaymentSourceRow>,
    pub purchases: Vec<PurchaseSourceRow>,
    pub fees: Vec<FeeSourceRow>,
    pub stock: Vec<StockSourceRow>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoneyAmount {
    pub minor_units: i64,
    pub scale: u8,
}

impl MoneyAmount {
    fn from_major_units(value: f64) -> Self {
        Self {
            minor_units: (value * 100.0).round() as i64,
            scale: 2,
        }
    }

    fn from_minor_units(minor_units: i64) -> Self {
        Self {
            minor_units,
            scale: 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesLine {
    pub order_id: u64,
    pub net: MoneyAmount,
    pub tax: MoneyAmount,
    pub gross: MoneyAmount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesSummary {
    pub order_count: usize,
    pub net: MoneyAmount,
    pub tax: MoneyAmount,
    pub gross: MoneyAmount,
    pub lines: Vec<SalesLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentLine {
    pub transaction_id: u64,
    pub direction: PaymentDirection,
    pub amount: MoneyAmount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptsSummary {
    pub receipt_count: usize,
    pub receipt_total: MoneyAmount,
    pub disbursement_count: usize,
    pub disbursement_total: MoneyAmount,
    pub lines: Vec<PaymentLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseLine {
    pub order_id: u64,
    pub net: MoneyAmount,
    pub tax: MoneyAmount,
    pub gross: MoneyAmount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchasesSummary {
    pub order_count: usize,
    pub net: MoneyAmount,
    pub tax: MoneyAmount,
    pub gross: MoneyAmount,
    pub lines: Vec<PurchaseLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeeLine {
    pub fee_id: u64,
    pub payment_transaction_id: u64,
    pub fee: MoneyAmount,
    pub tax: MoneyAmount,
    pub total: MoneyAmount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpensesAndFeesSummary {
    pub fee_count: usize,
    pub fees: MoneyAmount,
    pub tax: MoneyAmount,
    pub total: MoneyAmount,
    pub lines: Vec<FeeLine>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockAlertLine {
    pub quant_id: u64,
    pub product_id: u64,
    pub on_hand: f64,
    pub reserved: f64,
    pub available: f64,
    pub outdated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockAlertsSummary {
    pub alert_count: usize,
    pub lines: Vec<StockAlertLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportException {
    pub code: &'static str,
    pub source: &'static str,
    pub source_id: u64,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExceptionsSummary {
    pub count: usize,
    pub lines: Vec<ReportException>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyTotals {
    pub sales_gross: MoneyAmount,
    pub purchases_gross: MoneyAmount,
    pub receipts: MoneyAmount,
    pub disbursements: MoneyAmount,
    pub fees_and_tax: MoneyAmount,
    pub net_cash_flow: MoneyAmount,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyBusinessSummaryReportV1 {
    pub sales: SalesSummary,
    pub receipts: ReceiptsSummary,
    pub purchases: PurchasesSummary,
    pub expenses_and_fees: ExpensesAndFeesSummary,
    pub stock_alerts: StockAlertsSummary,
    pub exceptions: ExceptionsSummary,
    pub totals: DailyTotals,
}

pub fn aggregate_daily_business_summary(
    mut source: DailyBusinessSummarySource,
    currency_id: u64,
) -> DailyBusinessSummaryReportV1 {
    source.sales.sort_by_key(|row| row.id);
    source.payments.sort_by_key(|row| row.id);
    source.purchases.sort_by_key(|row| row.id);
    source.fees.sort_by_key(|row| row.id);
    source.stock.sort_by_key(|row| (row.product_id, row.id));

    let mut exceptions = Vec::new();
    let mut sale_lines = Vec::new();
    for row in source.sales {
        if !matches!(row.state, SaleState::Sale | SaleState::Done) {
            exceptions.push(state_exception("sale_order", row.id, "sale_not_confirmed"));
            continue;
        }
        if row.currency_id != currency_id {
            exceptions.push(currency_exception("sale_order", row.id));
            continue;
        }
        sale_lines.push(SalesLine {
            order_id: row.id,
            net: MoneyAmount::from_major_units(row.amount_untaxed),
            tax: MoneyAmount::from_major_units(row.amount_tax),
            gross: MoneyAmount::from_major_units(row.amount_total),
        });
    }

    let mut payment_lines = Vec::new();
    let mut posted_transaction_ids = HashSet::new();
    for row in source.payments {
        if row.status != PaymentStatus::Posted {
            exceptions.push(state_exception(
                "payment_transaction",
                row.id,
                "payment_not_posted",
            ));
            continue;
        }
        if row.currency_id != currency_id {
            exceptions.push(currency_exception("payment_transaction", row.id));
            continue;
        }
        posted_transaction_ids.insert(row.id);
        payment_lines.push(PaymentLine {
            transaction_id: row.id,
            direction: row.direction,
            amount: MoneyAmount::from_major_units(row.settlement_amount),
        });
    }

    let mut purchase_lines = Vec::new();
    for row in source.purchases {
        if !matches!(row.state, PurchaseState::Purchase | PurchaseState::Done) {
            exceptions.push(state_exception(
                "purchase_order",
                row.id,
                "purchase_not_confirmed",
            ));
            continue;
        }
        if row.currency_id != currency_id {
            exceptions.push(currency_exception("purchase_order", row.id));
            continue;
        }
        purchase_lines.push(PurchaseLine {
            order_id: row.id,
            net: MoneyAmount::from_major_units(row.amount_untaxed),
            tax: MoneyAmount::from_major_units(row.amount_tax),
            gross: MoneyAmount::from_major_units(row.amount_total),
        });
    }

    let mut fee_lines = Vec::new();
    for row in source.fees {
        if !posted_transaction_ids.contains(&row.payment_transaction_id) {
            exceptions.push(ReportException {
                code: "fee_without_posted_payment_in_window",
                source: "payment_fee",
                source_id: row.id,
                message: "Fee excluded because its posted payment is not in the report window"
                    .into(),
            });
            continue;
        }
        if row.currency_id != currency_id {
            exceptions.push(currency_exception("payment_fee", row.id));
            continue;
        }
        let fee = MoneyAmount::from_major_units(row.amount);
        let tax = MoneyAmount::from_major_units(row.tax_amount);
        fee_lines.push(FeeLine {
            fee_id: row.id,
            payment_transaction_id: row.payment_transaction_id,
            fee,
            tax,
            total: MoneyAmount::from_minor_units(fee.minor_units + tax.minor_units),
        });
    }

    let stock_lines: Vec<_> = source
        .stock
        .into_iter()
        .filter(|row| row.available_quantity <= 0.0 || row.is_outdated)
        .map(|row| StockAlertLine {
            quant_id: row.id,
            product_id: row.product_id,
            on_hand: row.quantity,
            reserved: row.reserved_quantity,
            available: row.available_quantity,
            outdated: row.is_outdated,
        })
        .collect();

    let sales_net = sum_money(sale_lines.iter().map(|line| line.net));
    let sales_tax = sum_money(sale_lines.iter().map(|line| line.tax));
    let sales_gross = sum_money(sale_lines.iter().map(|line| line.gross));
    let purchase_net = sum_money(purchase_lines.iter().map(|line| line.net));
    let purchase_tax = sum_money(purchase_lines.iter().map(|line| line.tax));
    let purchase_gross = sum_money(purchase_lines.iter().map(|line| line.gross));
    let receipts = sum_money(
        payment_lines
            .iter()
            .filter(|line| line.direction == PaymentDirection::Inbound)
            .map(|line| line.amount),
    );
    let disbursements = sum_money(
        payment_lines
            .iter()
            .filter(|line| line.direction == PaymentDirection::Outbound)
            .map(|line| line.amount),
    );
    let fees = sum_money(fee_lines.iter().map(|line| line.fee));
    let fee_tax = sum_money(fee_lines.iter().map(|line| line.tax));
    let fees_and_tax = MoneyAmount::from_minor_units(fees.minor_units + fee_tax.minor_units);

    exceptions.sort_by_key(|line| (line.source, line.source_id, line.code));

    DailyBusinessSummaryReportV1 {
        sales: SalesSummary {
            order_count: sale_lines.len(),
            net: sales_net,
            tax: sales_tax,
            gross: sales_gross,
            lines: sale_lines,
        },
        receipts: ReceiptsSummary {
            receipt_count: payment_lines
                .iter()
                .filter(|line| line.direction == PaymentDirection::Inbound)
                .count(),
            receipt_total: receipts,
            disbursement_count: payment_lines
                .iter()
                .filter(|line| line.direction == PaymentDirection::Outbound)
                .count(),
            disbursement_total: disbursements,
            lines: payment_lines,
        },
        purchases: PurchasesSummary {
            order_count: purchase_lines.len(),
            net: purchase_net,
            tax: purchase_tax,
            gross: purchase_gross,
            lines: purchase_lines,
        },
        expenses_and_fees: ExpensesAndFeesSummary {
            fee_count: fee_lines.len(),
            fees,
            tax: fee_tax,
            total: fees_and_tax,
            lines: fee_lines,
        },
        stock_alerts: StockAlertsSummary {
            alert_count: stock_lines.len(),
            lines: stock_lines,
        },
        exceptions: ExceptionsSummary {
            count: exceptions.len(),
            lines: exceptions,
        },
        totals: DailyTotals {
            sales_gross,
            purchases_gross: purchase_gross,
            receipts,
            disbursements,
            fees_and_tax,
            net_cash_flow: MoneyAmount::from_minor_units(
                receipts.minor_units - disbursements.minor_units - fees_and_tax.minor_units,
            ),
        },
    }
}

fn sum_money(values: impl Iterator<Item = MoneyAmount>) -> MoneyAmount {
    MoneyAmount::from_minor_units(values.map(|value| value.minor_units).sum())
}

fn state_exception(source: &'static str, source_id: u64, code: &'static str) -> ReportException {
    ReportException {
        code,
        source,
        source_id,
        message: "Source row excluded because it is not in a recognized posted state".into(),
    }
}

fn currency_exception(source: &'static str, source_id: u64) -> ReportException {
    ReportException {
        code: "currency_mismatch",
        source,
        source_id,
        message: "Source row excluded because its currency differs from the company currency"
            .into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sale(id: u64, state: SaleState, total: f64) -> SaleSourceRow {
        SaleSourceRow {
            id,
            currency_id: 1,
            state,
            amount_untaxed: total / 1.2,
            amount_tax: total - total / 1.2,
            amount_total: total,
        }
    }

    #[test]
    fn aggregation_is_deterministic_and_excludes_unposted_rows() {
        let source = DailyBusinessSummarySource {
            sales: vec![
                sale(2, SaleState::Draft, 60.0),
                sale(1, SaleState::Sale, 120.0),
            ],
            payments: vec![
                PaymentSourceRow {
                    id: 11,
                    currency_id: 1,
                    direction: PaymentDirection::Outbound,
                    status: PaymentStatus::Posted,
                    settlement_amount: 20.0,
                },
                PaymentSourceRow {
                    id: 10,
                    currency_id: 1,
                    direction: PaymentDirection::Inbound,
                    status: PaymentStatus::Posted,
                    settlement_amount: 100.0,
                },
                PaymentSourceRow {
                    id: 12,
                    currency_id: 1,
                    direction: PaymentDirection::Inbound,
                    status: PaymentStatus::Draft,
                    settlement_amount: 999.0,
                },
            ],
            purchases: vec![PurchaseSourceRow {
                id: 20,
                currency_id: 1,
                state: PurchaseState::Purchase,
                amount_untaxed: 40.0,
                amount_tax: 8.0,
                amount_total: 48.0,
            }],
            fees: vec![
                FeeSourceRow {
                    id: 31,
                    payment_transaction_id: 12,
                    currency_id: 1,
                    amount: 50.0,
                    tax_amount: 0.0,
                },
                FeeSourceRow {
                    id: 30,
                    payment_transaction_id: 10,
                    currency_id: 1,
                    amount: 2.0,
                    tax_amount: 0.4,
                },
            ],
            stock: vec![
                StockSourceRow {
                    id: 41,
                    product_id: 8,
                    quantity: 10.0,
                    reserved_quantity: 1.0,
                    available_quantity: 9.0,
                    is_outdated: false,
                },
                StockSourceRow {
                    id: 40,
                    product_id: 7,
                    quantity: 2.0,
                    reserved_quantity: 2.0,
                    available_quantity: 0.0,
                    is_outdated: false,
                },
            ],
        };

        let report = aggregate_daily_business_summary(source, 1);

        assert_eq!(report.sales.order_count, 1);
        assert_eq!(report.sales.gross.minor_units, 12_000);
        assert_eq!(report.receipts.receipt_total.minor_units, 10_000);
        assert_eq!(report.receipts.disbursement_total.minor_units, 2_000);
        assert_eq!(report.purchases.gross.minor_units, 4_800);
        assert_eq!(report.expenses_and_fees.total.minor_units, 240);
        assert_eq!(report.totals.net_cash_flow.minor_units, 7_760);
        assert_eq!(report.stock_alerts.alert_count, 1);
        assert_eq!(report.stock_alerts.lines[0].product_id, 7);
        assert_eq!(report.exceptions.count, 3);
        assert_eq!(report.sales.lines[0].order_id, 1);
    }

    #[test]
    fn aggregation_rejects_cross_currency_amounts() {
        let mut foreign_sale = sale(1, SaleState::Done, 120.0);
        foreign_sale.currency_id = 2;

        let report = aggregate_daily_business_summary(
            DailyBusinessSummarySource {
                sales: vec![foreign_sale],
                ..Default::default()
            },
            1,
        );

        assert_eq!(report.sales.order_count, 0);
        assert_eq!(report.sales.gross.minor_units, 0);
        assert_eq!(report.exceptions.count, 1);
        assert_eq!(report.exceptions.lines[0].code, "currency_mismatch");
    }
}
