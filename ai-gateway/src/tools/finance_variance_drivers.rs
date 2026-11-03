//! Explain measured changes in two authorized, validated owner reports.

use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};

use crate::harness::finance_review::{FinanceObservation, FinanceReportKey};

struct Driver {
    name: String,
    actual_pointer: String,
    baseline_pointer: String,
    contribution: i128,
}

fn amount(observation: &FinanceObservation, field: &str) -> Result<i128> {
    let pointer = format!("/report/{field}");
    observation
        .totals
        .iter()
        .find(|fact| fact.source_pointer == pointer)
        .map(|fact| i128::from(fact.amount.minor_units))
        .context("validated finance total missing")
}

pub(super) fn measured_drivers(
    actual: &FinanceObservation,
    baseline: &FinanceObservation,
) -> Result<Value> {
    ensure!(
        actual.report_key == baseline.report_key
            && actual.scope.organization_id == baseline.scope.organization_id
            && actual.scope.company_id == baseline.scope.company_id
            && actual.scope.timezone == baseline.scope.timezone
            && actual.currency.currency_id == baseline.currency.currency_id
            && actual.currency.minor_unit_scale == baseline.currency.minor_unit_scale,
        "finance driver scope or currency mismatch"
    );

    let mut drivers = Vec::new();
    let total_field = match actual.report_key {
        FinanceReportKey::Cash => {
            for (field, sign) in [
                ("opening", 1),
                ("receipts", 1),
                ("disbursements", -1),
                ("fees", -1),
            ] {
                let pointer = format!("/report/{field}");
                drivers.push(Driver {
                    name: field.into(),
                    actual_pointer: pointer.clone(),
                    baseline_pointer: pointer,
                    contribution: sign * (amount(actual, field)? - amount(baseline, field)?),
                });
            }
            "closing"
        }
        FinanceReportKey::Receivables | FinanceReportKey::Payables => {
            // The owner report omits zero buckets. An omitted bucket cites the
            // validated collection so the absence is visible in the source.
            for name in ["current", "1_30", "31_60", "61_90", "over_90"] {
                let current = actual
                    .due_buckets
                    .iter()
                    .find(|item| item.bucket == name);
                let previous = baseline
                    .due_buckets
                    .iter()
                    .find(|item| item.bucket == name);
                if current.is_none() && previous.is_none() {
                    continue;
                }
                drivers.push(Driver {
                    name: name.into(),
                    actual_pointer: current.map_or_else(
                        || "/report/dueBuckets".into(),
                        |item| item.source_pointer.clone(),
                    ),
                    baseline_pointer: previous.map_or_else(
                        || "/report/dueBuckets".into(),
                        |item| item.source_pointer.clone(),
                    ),
                    contribution: current.map_or(0, |item| i128::from(item.amount.minor_units))
                        - previous.map_or(0, |item| i128::from(item.amount.minor_units)),
                });
            }
            "totalOpen"
        }
    };

    let total_delta = amount(actual, total_field)? - amount(baseline, total_field)?;
    ensure!(
        drivers.iter().map(|driver| driver.contribution).sum::<i128>() == total_delta,
        "finance driver contributions do not reconcile"
    );
    drivers.sort_by(|left, right| {
        right
            .contribution
            .abs()
            .cmp(&left.contribution.abs())
            .then_with(|| left.name.cmp(&right.name))
    });
    let contributions: Vec<_> = drivers
        .into_iter()
        .map(|driver| {
            json!({
                "metric": driver.name,
                "contributionMinorUnits": driver.contribution.to_string(),
                "actualSourcePointer": format!("/actual{}", driver.actual_pointer),
                "baselineSourcePointer": format!("/baseline{}", driver.baseline_pointer),
            })
        })
        .collect();

    Ok(json!({
        "metric": total_field,
        "currencyId": actual.currency.currency_id,
        "scale": actual.currency.minor_unit_scale,
        "differenceMinorUnits": total_delta.to_string(),
        "contributions": contributions,
        "interpretation": "Arithmetic contributions from observed report totals. They do not establish causes.",
    }))
}
