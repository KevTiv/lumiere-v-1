//! Company-scoped totals of saved source observations for the Assistant.

use std::{collections::BTreeMap, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{calendar_date, decimal, scope, Module};
use crate::{cold_tier::pg_pool, error::ApiError, state::AppState, web_session::OrgSession};

const MAX_ROWS: usize = 5_000;
const MAX_DAYS: i64 = 3_660;
const SOURCE_SAMPLES: usize = 5;
const DECIMAL_SCALE: i128 = 1_000_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::routes::import_reviews) struct SummaryQuery {
    company_id: u64,
    from: String,
    through: String,
    label: Option<String>,
}

impl SummaryQuery {
    fn dates(&self) -> Result<(NaiveDate, NaiveDate), ApiError> {
        let from = calendar_date(&self.from).map_err(ApiError::BadRequest)?;
        let through = calendar_date(&self.through).map_err(ApiError::BadRequest)?;
        if !(0..MAX_DAYS).contains(&(through - from).num_days()) {
            return Err(ApiError::BadRequest(
                "Choose an inclusive date range of up to 3,660 days".into(),
            ));
        }
        Ok((from, through))
    }
}

#[derive(Default)]
struct Totals {
    amounts: BTreeMap<String, i128>,
    included: usize,
    crossing_boundary: usize,
    source_ids: Vec<String>,
}

impl Totals {
    fn observe(
        &mut self,
        id: i64,
        contained: bool,
        currency: Option<&str>,
        amount: Option<&str>,
    ) -> Result<(), ApiError> {
        if !contained {
            self.crossing_boundary += 1;
            return Ok(());
        }
        let invalid = || ApiError::Unavailable("A saved sales amount could not be verified".into());
        let currency = currency
            .filter(|code| code.len() == 3 && code.bytes().all(|byte| byte.is_ascii_uppercase()))
            .ok_or_else(invalid)?;
        let amount = amount
            .and_then(decimal)
            .filter(|value| *value >= 0)
            .ok_or_else(invalid)?;
        let total = self.amounts.entry(currency.to_owned()).or_default();
        *total = total.checked_add(amount).ok_or_else(invalid)?;
        self.included += 1;
        if self.source_ids.len() < SOURCE_SAMPLES {
            self.source_ids.push(id.to_string());
        }
        Ok(())
    }
}

fn format_amount(amount: i128) -> String {
    format!("{}.{:06}", amount / DECIMAL_SCALE, amount % DECIMAL_SCALE)
        .trim_end_matches('0')
        .trim_end_matches('.')
        .into()
}

pub(in crate::routes::import_reviews) async fn read(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(module): Path<Module>,
    Query(query): Query<SummaryQuery>,
) -> Result<Json<Value>, ApiError> {
    let label_field = match module {
        Module::Sales => "customer",
        Module::ShopSales => "shop",
        Module::Warehouse => return Err(ApiError::NotFound("Unknown sales source".into())),
    };
    let label = query.label.as_deref().map(str::trim);
    if label.is_some_and(|value| {
        value.is_empty() || value.len() > 256 || value.chars().any(char::is_control)
    }) {
        return Err(ApiError::BadRequest("Invalid sales source label".into()));
    }
    let (from, through) = query.dates()?;
    let ctx = scope(&state, &session, query.company_id).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let rows = client
        .query(
            "SELECT id, period_start >= $4::text::date AND period_end <= $5::text::date AS contained,
                    facts->>'amount' AS amount, facts->>'currency' AS currency
             FROM lumiere_platform.module_backfill_record
             WHERE organization_id = $1::text::numeric AND company_id = $2::text::numeric
               AND module = 'sales' AND facts->>'kind' = $3
               AND period_end >= $4::text::date AND period_start <= $5::text::date
               AND ($6::text IS NULL OR lower(facts->>$7::text) = lower($6))
             ORDER BY period_end DESC, id DESC LIMIT $8",
            &[
                &ctx.organization_id().to_string(),
                &query.company_id.to_string(),
                &module.record_kind(),
                &from.to_string(),
                &through.to_string(),
                &label,
                &label_field,
                &((MAX_ROWS + 1) as i64),
            ],
        )
        .await
        .map_err(ApiError::internal)?;
    if rows.len() > MAX_ROWS {
        return Err(ApiError::Unprocessable(
            "Too many saved sales records. Choose a shorter period.".into(),
        ));
    }
    let mut totals = Totals::default();
    for row in rows {
        let currency: Option<&str> = row.get("currency");
        let amount: Option<&str> = row.get("amount");
        totals.observe(row.get("id"), row.get("contained"), currency, amount)?;
    }
    let amounts = totals.amounts.into_iter().map(|(currency, amount)| {
        json!({ "currency": currency, "reportedAmount": format_amount(amount) })
    }).collect::<Vec<_>>();
    Ok(Json(json!({ "data": {
        "companyId": query.company_id.to_string(),
        "module": module,
        "from": query.from,
        "through": query.through,
        "label": label,
        "included": totals.included,
        "crossingBoundary": totals.crossing_boundary,
        "totals": amounts,
        "sourceRecordIds": totals.source_ids,
    } })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_contained_records_count_and_currencies_stay_separate() {
        let mut totals = Totals::default();
        totals.observe(1, true, Some("RWF"), Some("0.1")).unwrap();
        totals
            .observe(2, true, Some("RWF"), Some("0.200001"))
            .unwrap();
        totals.observe(3, false, None, None).unwrap();
        totals.observe(4, true, Some("EUR"), Some("7")).unwrap();

        assert_eq!(totals.included, 3);
        assert_eq!(totals.crossing_boundary, 1);
        assert_eq!(totals.source_ids, ["1", "2", "4"]);
        assert_eq!(format_amount(totals.amounts["RWF"]), "0.300001");
        assert_eq!(format_amount(totals.amounts["EUR"]), "7");
        assert!(totals.observe(5, true, Some("RWF"), None).is_err());
    }
}
