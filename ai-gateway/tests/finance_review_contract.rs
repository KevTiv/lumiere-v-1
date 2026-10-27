//! Compile the candidate against the actual owner-report types and calculations.
//! No duplicated financial calculator, provider, database or live credential.

#[allow(dead_code)]
#[path = "../../api-server/src/reports/daily_business_summary.rs"]
mod daily_business_summary;
#[allow(dead_code)]
#[path = "../src/harness/finance_review/mod.rs"]
mod finance_review;
#[allow(dead_code)]
#[path = "../../api-server/src/reports/financial_position.rs"]
mod financial_position;
#[allow(dead_code)]
#[path = "../../api-server/src/reports/open_balances.rs"]
mod open_balances;

use std::collections::BTreeMap;

use chrono::NaiveDate;
use finance_review::{build_evidence, FinanceReportKey, FinanceReviewRequest, FinanceReviewScope};
use serde_json::Value;

fn check(key: FinanceReportKey, fixture: &[u8], owner_report: Value) {
    let mut preview: Value = serde_json::from_slice(fixture).unwrap();
    assert_eq!(
        preview["report"], owner_report,
        "fixture must match the actual owner calculation"
    );
    preview["report"] = owner_report;
    let request = FinanceReviewRequest {
        report_key: key,
        date: "2026-10-26".into(),
        timezone: "Africa/Kigali".into(),
    };
    let result = build_evidence(
        FinanceReviewScope::new(9, 7, 42).unwrap(),
        &request,
        &serde_json::to_vec(&preview).unwrap(),
    )
    .unwrap();
    assert!(!result.observation.totals.is_empty());
}

#[test]
fn receivables_and_payables_use_owner_residuals_after_partial_payment_and_reversal() {
    use open_balances::*;
    let moves = || {
        vec![
            OpenMoveSourceRow {
                id: 101,
                partner_id: Some(42),
                invoice_partner_display_name: Some("Fixture party".into()),
                invoice_date_due: Some("2026-10-01".into()),
                amount_total: 100.0,
                amount_residual: 40.0,
                currency_id: 1,
            },
            OpenMoveSourceRow {
                id: 102,
                partner_id: Some(42),
                invoice_partner_display_name: Some("Fixture party".into()),
                invoice_date_due: None,
                amount_total: 75.0,
                amount_residual: 75.0,
                currency_id: 1,
            },
            OpenMoveSourceRow {
                id: 103,
                partner_id: Some(42),
                invoice_partner_display_name: Some("Fixture party".into()),
                invoice_date_due: Some("2026-10-30".into()),
                amount_total: 50.0,
                amount_residual: 50.0,
                currency_id: 1,
            },
        ]
    };
    let lines = vec![MoveLineMoveIdRow {
        id: 1001,
        move_id: 101,
    }];
    let allocations = vec![
        MoveAllocationSourceRow {
            allocated_move_line_id: 1001,
            allocated_amount: 80.0,
            is_reversal: false,
            created_at: "2026-10-10T12:00:00Z".into(),
            currency_id: 1,
        },
        MoveAllocationSourceRow {
            allocated_move_line_id: 1001,
            allocated_amount: 20.0,
            is_reversal: true,
            created_at: "2026-10-15T12:00:00Z".into(),
            currency_id: 1,
        },
    ];
    let date = NaiveDate::from_ymd_opt(2026, 10, 26).unwrap();
    let receivables = aggregate_customer_balances(moves(), &lines, &allocations, 1, date);
    let payables = aggregate_supplier_payables(moves(), &lines, &allocations, 1, date);
    check(
        FinanceReportKey::Receivables,
        include_bytes!("../src/harness/finance_review/fixtures/receivables.json"),
        serde_json::to_value(receivables).unwrap(),
    );
    check(
        FinanceReportKey::Payables,
        include_bytes!("../src/harness/finance_review/fixtures/payables.json"),
        serde_json::to_value(payables).unwrap(),
    );
}

#[test]
fn cash_review_uses_the_owners_posted_movement_and_fee_semantics() {
    use financial_position::*;
    let report = aggregate_cash_mobile_money(
        vec![PaymentAccountSourceRow {
            id: 7,
            name: "Fixture payment account".into(),
            provider_code: "momo".into(),
            reference_masked: Some("***1234".into()),
            currency_id: 1,
            account_journal_id: 9,
        }],
        BTreeMap::from([(9, 10000)]),
        vec![],
        vec![],
        vec![
            PostedPaymentSourceRow {
                id: 701,
                payment_account_id: 7,
                direction: "Inbound".into(),
                settlement_amount: 50.0,
                net_account_amount: 50.0,
                currency_id: 1,
            },
            PostedPaymentSourceRow {
                id: 702,
                payment_account_id: 7,
                direction: "Outbound".into(),
                settlement_amount: 20.0,
                net_account_amount: 20.0,
                currency_id: 1,
            },
        ],
        vec![PaymentFeeSourceRow {
            payment_transaction_id: 702,
            amount: 5.0,
            tax_amount: 0.0,
            currency_id: 1,
        }],
        vec![UnreconciledPaymentSourceRow {
            id: 701,
            payment_account_id: 7,
            external_reference: Some("REF5678".into()),
            occurred_at: "2026-10-26T08:00:00Z".into(),
            net_account_amount: 50.0,
            currency_id: 1,
        }],
        1,
    );
    check(
        FinanceReportKey::Cash,
        include_bytes!("../src/harness/finance_review/fixtures/cash.json"),
        serde_json::to_value(report).unwrap(),
    );
}
