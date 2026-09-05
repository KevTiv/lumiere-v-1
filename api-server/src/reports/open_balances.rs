//! Allocation-backed open receivables and payables owner reports.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::daily_business_summary::MoneyAmount;

const BUCKET_ORDER: [(&str, &str); 5] = [
    ("current", "Current"),
    ("1_30", "1–30 days overdue"),
    ("31_60", "31–60 days overdue"),
    ("61_90", "61–90 days overdue"),
    ("over_90", "Over 90 days overdue"),
];

#[derive(Debug, Deserialize)]
pub struct OpenMoveSourceRow {
    pub id: u64,
    pub partner_id: Option<u64>,
    pub invoice_partner_display_name: Option<String>,
    pub invoice_date_due: Option<String>,
    pub amount_total: f64,
    pub amount_residual: f64,
    pub currency_id: u64,
}

#[derive(Debug, Deserialize)]
pub struct MoveLineMoveIdRow {
    pub id: u64,
    pub move_id: u64,
}

#[derive(Debug, Deserialize)]
pub struct MoveAllocationSourceRow {
    pub allocated_move_line_id: u64,
    pub allocated_amount: f64,
    pub is_reversal: bool,
    pub created_at: String,
    pub currency_id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum AgingBucketKey {
    Current,
    Days1To30,
    Days31To60,
    Days61To90,
    Over90,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DueBucketSummary {
    pub bucket: String,
    pub label: String,
    pub amount: MoneyAmount,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenBalanceLine {
    pub move_id: u64,
    pub partner_id: Option<u64>,
    pub partner_display_name: Option<String>,
    pub due_date: Option<String>,
    pub original_amount: MoneyAmount,
    pub paid_amount: MoneyAmount,
    pub residual: MoneyAmount,
    pub is_partial: bool,
    pub last_payment_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditStatusSummary {
    pub within_limit: u32,
    pub over_limit: u32,
    pub unknown: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerBalancesReportV1 {
    pub total_open: MoneyAmount,
    pub overdue: MoneyAmount,
    pub current: MoneyAmount,
    pub due_buckets: Vec<DueBucketSummary>,
    pub credit_status: CreditStatusSummary,
    pub lines: Vec<OpenBalanceLine>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplierPayablesReportV1 {
    pub total_open: MoneyAmount,
    pub overdue: MoneyAmount,
    pub current: MoneyAmount,
    pub due_buckets: Vec<DueBucketSummary>,
    pub paid_amounts: MoneyAmount,
    pub planned_amounts: MoneyAmount,
    pub lines: Vec<OpenBalanceLine>,
}

pub fn allocation_totals_by_move(
    lines: &[MoveLineMoveIdRow],
    allocations: &[MoveAllocationSourceRow],
    currency_id: u64,
) -> BTreeMap<u64, (i64, Option<String>)> {
    let line_to_move = lines
        .iter()
        .map(|line| (line.id, line.move_id))
        .collect::<BTreeMap<_, _>>();
    let mut by_move = BTreeMap::<u64, (i64, Option<String>)>::new();
    for allocation in allocations
        .iter()
        .filter(|allocation| allocation.currency_id == currency_id)
    {
        let Some(&move_id) = line_to_move.get(&allocation.allocated_move_line_id) else {
            continue;
        };
        let amount = minor_units(allocation.allocated_amount);
        let signed = if allocation.is_reversal {
            -amount
        } else {
            amount
        };
        let entry = by_move.entry(move_id).or_insert((0, None));
        entry.0 += signed;
        if !allocation.is_reversal {
            entry.1 = latest_timestamp(entry.1.as_deref(), Some(allocation.created_at.as_str()));
        }
    }
    by_move
}

pub fn aggregate_customer_balances(
    moves: Vec<OpenMoveSourceRow>,
    lines: &[MoveLineMoveIdRow],
    allocations: &[MoveAllocationSourceRow],
    currency_id: u64,
    report_date: NaiveDate,
) -> CustomerBalancesReportV1 {
    let allocation_by_move = allocation_totals_by_move(lines, allocations, currency_id);
    let (report_lines, bucket_totals, totals) =
        build_open_balance_lines(moves, &allocation_by_move, currency_id, report_date);

    CustomerBalancesReportV1 {
        total_open: amount(totals.open),
        overdue: amount(totals.overdue),
        current: amount(totals.current),
        due_buckets: bucket_summaries(bucket_totals),
        credit_status: CreditStatusSummary {
            within_limit: 0,
            over_limit: 0,
            unknown: report_lines.len() as u32,
        },
        lines: report_lines,
    }
}

pub fn aggregate_supplier_payables(
    moves: Vec<OpenMoveSourceRow>,
    lines: &[MoveLineMoveIdRow],
    allocations: &[MoveAllocationSourceRow],
    currency_id: u64,
    report_date: NaiveDate,
) -> SupplierPayablesReportV1 {
    let allocation_by_move = allocation_totals_by_move(lines, allocations, currency_id);
    let (report_lines, bucket_totals, totals) =
        build_open_balance_lines(moves, &allocation_by_move, currency_id, report_date);

    SupplierPayablesReportV1 {
        total_open: amount(totals.open),
        overdue: amount(totals.overdue),
        current: amount(totals.current),
        due_buckets: bucket_summaries(bucket_totals),
        paid_amounts: amount(totals.paid),
        planned_amounts: amount(totals.original),
        lines: report_lines,
    }
}

#[derive(Default)]
struct ReportTotals {
    open: i64,
    overdue: i64,
    current: i64,
    paid: i64,
    original: i64,
}

fn build_open_balance_lines(
    moves: Vec<OpenMoveSourceRow>,
    allocation_by_move: &BTreeMap<u64, (i64, Option<String>)>,
    currency_id: u64,
    report_date: NaiveDate,
) -> (
    Vec<OpenBalanceLine>,
    BTreeMap<AgingBucketKey, i64>,
    ReportTotals,
) {
    let mut bucket_totals = BTreeMap::<AgingBucketKey, i64>::new();
    let mut totals = ReportTotals::default();
    let lines = moves
        .into_iter()
        .filter(|move_| {
            move_.currency_id == currency_id && move_.amount_residual.abs() > f64::EPSILON
        })
        .map(|move_| {
            let residual = minor_units(move_.amount_residual.abs());
            let original = minor_units(move_.amount_total.abs());
            let (paid_minor, last_payment_date) = allocation_by_move
                .get(&move_.id)
                .map(|(paid, last)| (*paid, last.clone()))
                .unwrap_or((0, None));
            let paid = paid_minor.max(0);
            let bucket = aging_bucket(
                report_date,
                parse_due_date(move_.invoice_date_due.as_deref()),
            );
            *bucket_totals.entry(bucket).or_default() += residual;
            totals.open += residual;
            totals.original += original;
            totals.paid += paid;
            if bucket == AgingBucketKey::Current {
                totals.current += residual;
            } else {
                totals.overdue += residual;
            }
            OpenBalanceLine {
                move_id: move_.id,
                partner_id: move_.partner_id,
                partner_display_name: move_.invoice_partner_display_name,
                due_date: move_.invoice_date_due.map(format_due_date),
                original_amount: amount(original),
                paid_amount: amount(paid),
                residual: amount(residual),
                is_partial: paid > 0 && residual > 0,
                last_payment_date,
            }
        })
        .collect();
    (lines, bucket_totals, totals)
}

fn bucket_summaries(bucket_totals: BTreeMap<AgingBucketKey, i64>) -> Vec<DueBucketSummary> {
    BUCKET_ORDER
        .iter()
        .filter_map(|(bucket_id, label)| {
            let key = match *bucket_id {
                "current" => AgingBucketKey::Current,
                "1_30" => AgingBucketKey::Days1To30,
                "31_60" => AgingBucketKey::Days31To60,
                "61_90" => AgingBucketKey::Days61To90,
                "over_90" => AgingBucketKey::Over90,
                _ => return None,
            };
            let minor = bucket_totals.get(&key).copied().unwrap_or_default();
            if minor == 0 {
                return None;
            }
            Some(DueBucketSummary {
                bucket: (*bucket_id).to_string(),
                label: (*label).to_string(),
                amount: amount(minor),
            })
        })
        .collect()
}

fn aging_bucket(report_date: NaiveDate, due_date: Option<NaiveDate>) -> AgingBucketKey {
    let Some(due_date) = due_date else {
        return AgingBucketKey::Current;
    };
    let days = (report_date - due_date).num_days();
    if days <= 0 {
        AgingBucketKey::Current
    } else if days <= 30 {
        AgingBucketKey::Days1To30
    } else if days <= 60 {
        AgingBucketKey::Days31To60
    } else if days <= 90 {
        AgingBucketKey::Days61To90
    } else {
        AgingBucketKey::Over90
    }
}

fn parse_due_date(raw: Option<&str>) -> Option<NaiveDate> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    NaiveDate::parse_from_str(&raw[..raw.len().min(10)], "%Y-%m-%d").ok()
}

fn format_due_date(raw: String) -> String {
    parse_due_date(Some(raw.as_str()))
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or(raw)
}

fn latest_timestamp(current: Option<&str>, candidate: Option<&str>) -> Option<String> {
    match (current, candidate) {
        (None, None) => None,
        (None, Some(value)) => Some(value.to_string()),
        (Some(current), None) => Some(current.to_string()),
        (Some(current), Some(candidate)) if candidate > current => Some(candidate.to_string()),
        (Some(current), Some(_)) => Some(current.to_string()),
    }
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

    fn move_row(id: u64, due: &str, total: f64, residual: f64) -> OpenMoveSourceRow {
        OpenMoveSourceRow {
            id,
            partner_id: Some(7),
            invoice_partner_display_name: Some("Partner".into()),
            invoice_date_due: Some(format!("{due}T00:00:00Z")),
            amount_total: total,
            amount_residual: residual,
            currency_id: 1,
        }
    }

    #[test]
    fn aging_buckets_use_local_report_date_boundaries() {
        let report_date = NaiveDate::from_ymd_opt(2026, 7, 10).expect("date");
        let report = aggregate_customer_balances(
            vec![
                move_row(1, "2026-07-10", 100.0, 100.0),
                move_row(2, "2026-07-09", 50.0, 50.0),
                move_row(3, "2026-04-01", 20.0, 20.0),
            ],
            &[],
            &[],
            1,
            report_date,
        );
        assert_eq!(report.current.minor_units, 10_000);
        assert_eq!(report.overdue.minor_units, 7_000);
        assert_eq!(
            report
                .due_buckets
                .iter()
                .find(|bucket| bucket.bucket == "1_30")
                .map(|bucket| bucket.amount.minor_units),
            Some(5000)
        );
        assert_eq!(
            report
                .due_buckets
                .iter()
                .find(|bucket| bucket.bucket == "over_90")
                .map(|bucket| bucket.amount.minor_units),
            Some(2000)
        );
    }

    #[test]
    fn partial_payments_and_allocations_are_reflected_on_lines() {
        let report = aggregate_customer_balances(
            vec![move_row(1, "2026-07-10", 100.0, 40.0)],
            &[MoveLineMoveIdRow { id: 55, move_id: 1 }],
            &[MoveAllocationSourceRow {
                allocated_move_line_id: 55,
                allocated_amount: 60.0,
                is_reversal: false,
                created_at: "2026-07-09T10:00:00Z".into(),
                currency_id: 1,
            }],
            1,
            NaiveDate::from_ymd_opt(2026, 7, 10).expect("date"),
        );
        assert_eq!(report.lines[0].paid_amount.minor_units, 6000);
        assert_eq!(report.lines[0].residual.minor_units, 4000);
        assert!(report.lines[0].is_partial);
        assert_eq!(
            report.lines[0].last_payment_date.as_deref(),
            Some("2026-07-09T10:00:00Z")
        );
    }

    #[test]
    fn reversal_allocations_reduce_paid_amounts() {
        let report = aggregate_supplier_payables(
            vec![move_row(1, "2026-07-10", 100.0, 100.0)],
            &[MoveLineMoveIdRow { id: 55, move_id: 1 }],
            &[
                MoveAllocationSourceRow {
                    allocated_move_line_id: 55,
                    allocated_amount: 60.0,
                    is_reversal: false,
                    created_at: "2026-07-08T10:00:00Z".into(),
                    currency_id: 1,
                },
                MoveAllocationSourceRow {
                    allocated_move_line_id: 55,
                    allocated_amount: 60.0,
                    is_reversal: true,
                    created_at: "2026-07-09T10:00:00Z".into(),
                    currency_id: 1,
                },
            ],
            1,
            NaiveDate::from_ymd_opt(2026, 7, 10).expect("date"),
        );
        assert_eq!(report.paid_amounts.minor_units, 0);
        assert_eq!(report.lines[0].paid_amount.minor_units, 0);
        assert!(!report.lines[0].is_partial);
    }
}
