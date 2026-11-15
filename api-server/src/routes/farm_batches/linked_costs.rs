//! Current posted cost subtotal for the authorized links on one farm batch.

use std::{collections::BTreeMap, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::NaiveDate;
use futures_util::{stream, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    authorize,
    native_links::{context, read_cost_rows, verify_cost, CostSource, NativeReader},
    storage, FarmAccess, ScopeQuery,
};
use crate::{cold_tier::pg_pool, error::ApiError, state::AppState, web_session::OrgSession};

const MAX_CHECKS: usize = 50;
const READ_CONCURRENCY: usize = 4;
const FRACTION_DIGITS: u32 = 18;
const SCALE: i128 = 10_i128.pow(FRACTION_DIGITS);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifiedCost {
    currency_id: String,
    amount: String,
    business_date: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrencyTotal {
    currency_id: String,
    amount: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostedCostSummary {
    as_of: String,
    checked_links: usize,
    verified_links: usize,
    unverified_links: usize,
    truncated: bool,
    coverage: &'static str,
    totals: Vec<CurrencyTotal>,
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new().route("/farm-batches/:batch_id/linked-posted-costs", get(summary))
}

async fn summary(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(batch): Path<i64>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
    let scope = authorize(&state, &session, query.company_id, FarmAccess::Read).await?;
    let as_of = query.as_of(scope.local_date)?;
    let context = context(&state, &session, query.company_id)?;
    let reader = NativeReader {
        context: &context,
        scope: &scope,
    };
    if !reader.allows_cost_lines() {
        return Err(ApiError::Forbidden(
            "Posted farm costs require access to the source ledger".into(),
        ));
    }

    let mut db = pg_pool::required_pool()
        .map_err(ApiError::unavailable)?
        .get()
        .await
        .map_err(ApiError::unavailable)?;
    let transaction = db
        .build_transaction()
        .read_only(true)
        .start()
        .await
        .map_err(ApiError::internal)?;
    storage::read_batch(&transaction, &scope, batch).await?;
    let rows = read_cost_rows(
        &transaction,
        &scope,
        batch,
        None,
        reader.allows_expense_reports(),
        (MAX_CHECKS + 1) as i64,
    )
    .await?;
    transaction.commit().await.map_err(ApiError::internal)?;
    drop(db);

    let truncated = rows.len() > MAX_CHECKS;
    let checked = stream::iter(rows.into_iter().take(MAX_CHECKS))
        .map(|row| {
            let reader = &reader;
            async move {
                let id: String = row.get("journal_line_id");
                let id = id.parse().map_err(ApiError::internal)?;
                let origin: CostSource =
                    serde_json::from_value(row.get("source")).map_err(ApiError::internal)?;
                match verify_cost(reader, id, &origin).await {
                    Ok(proof) => serde_json::from_value(proof)
                        .map(Some)
                        .map_err(ApiError::internal),
                    Err(ApiError::NotFound(_) | ApiError::Conflict(_)) => Ok(None),
                    Err(error) => Err(error),
                }
            }
        })
        .buffered(READ_CONCURRENCY)
        .try_collect::<Vec<Option<VerifiedCost>>>()
        .await?;
    context.require_current_placement(&state.organization_placements)?;
    let data = summarize(checked, truncated, as_of).ok_or_else(|| {
        ApiError::Unavailable("The linked posted cost amounts could not be totaled".into())
    })?;
    Ok(Json(json!({"data": data})))
}

fn summarize(
    checked: Vec<Option<VerifiedCost>>,
    truncated: bool,
    as_of: NaiveDate,
) -> Option<PostedCostSummary> {
    let checked_links = checked.len();
    let mut verified_links = 0;
    let mut unverified_links = 0;
    let mut totals = BTreeMap::<String, i128>::new();
    for item in checked {
        let Some(line) = item else {
            unverified_links += 1;
            continue;
        };
        if super::model::date::parse(&line.business_date).ok()? > as_of {
            continue;
        }
        let amount = decimal_units(&line.amount)?;
        let total = totals.entry(line.currency_id).or_default();
        *total = total.checked_add(amount)?;
        verified_links += 1;
    }
    Some(PostedCostSummary {
        as_of: as_of.to_string(),
        checked_links,
        verified_links,
        unverified_links,
        truncated,
        coverage: "linked-posted-lines-only",
        totals: totals
            .into_iter()
            .map(|(currency_id, amount)| CurrencyTotal {
                currency_id,
                amount: format_units(amount),
            })
            .collect(),
    })
}

fn decimal_units(value: &str) -> Option<i128> {
    let (negative, magnitude) = value
        .strip_prefix('-')
        .map_or((false, value), |positive| (true, positive));
    let (whole, fraction) = magnitude.split_once('.').unwrap_or((magnitude, ""));
    if whole.is_empty()
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|byte| byte.is_ascii_digit())
        || fraction.len() > FRACTION_DIGITS as usize
    {
        return None;
    }
    let whole = whole.parse::<i128>().ok()?.checked_mul(SCALE)?;
    let fraction_units = if fraction.is_empty() {
        0
    } else {
        fraction
            .parse::<i128>()
            .ok()?
            .checked_mul(10_i128.pow(FRACTION_DIGITS - fraction.len() as u32))?
    };
    let units = whole.checked_add(fraction_units)?;
    if negative {
        units.checked_neg()
    } else {
        Some(units)
    }
}

fn format_units(units: i128) -> String {
    let magnitude = units.unsigned_abs();
    let scale = SCALE as u128;
    let whole = magnitude / scale;
    let sign = if units < 0 { "-" } else { "" };
    let fraction = magnitude % scale;
    if fraction == 0 {
        format!("{sign}{whole}")
    } else {
        let fraction = format!("{fraction:018}");
        format!("{sign}{whole}.{}", fraction.trim_end_matches('0'))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proof(amount: &str, currency: &str, date: &str) -> Option<VerifiedCost> {
        Some(VerifiedCost {
            amount: amount.into(),
            currency_id: currency.into(),
            business_date: date.into(),
        })
    }

    #[test]
    fn totals_scoped_verified_posted_costs_as_of_cutoff_by_currency() {
        let result = summarize(
            vec![
                proof("9007199254740993.22", "1", "2026-10-01"),
                proof("-9007199254740992.19", "1", "2026-10-02"),
                proof("10000", "1", "2026-10-03"),
                proof("-125.003", "2", "2026-10-02"),
                None,
            ],
            true,
            NaiveDate::from_ymd_opt(2026, 10, 2).unwrap(),
        )
        .unwrap();
        assert!(result.truncated);
        assert_eq!(result.checked_links, 5);
        assert_eq!(result.verified_links, 3);
        assert_eq!(result.unverified_links, 1);
        assert_eq!(result.totals[0].amount, "1.03");
        assert_eq!(result.totals[1].amount, "-125.003");
    }

    #[test]
    fn subtotal_keeps_decimal_precision_and_rejects_invalid_input() {
        assert_eq!(decimal_units("0.1"), Some(100_000_000_000_000_000));
        assert_eq!(decimal_units("1.0000000000000000001"), None);
        assert_eq!(decimal_units("Infinity"), None);
        assert_eq!(format_units(decimal_units("-0.0001").unwrap()), "-0.0001");
        assert_eq!(format_units(0), "0");
    }
}
