//! Reviewed sales, including daily shop sales, and physical counts have durable module records.
use std::{collections::BTreeMap, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

mod reconciliation;

#[cfg(test)]
pub(super) use reconciliation::exercise_persistence;

use super::{
    history_period::calendar_date,
    model::{decimal, ReviewItem},
    scope,
};
use crate::{
    cold_tier::pg_pool,
    error::ApiError,
    query_exec::{execute_resource_query_for_company, row_u64},
    routes::queries::require_owner_read_permission,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};
use reconciliation::{BackfillRow, Existing};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Module {
    Sales,
    ShopSales,
    Warehouse,
}

impl Module {
    fn storage_name(self) -> &'static str {
        match self {
            Self::Sales | Self::ShopSales => "sales",
            Self::Warehouse => "warehouse",
        }
    }

    fn record_kind(self) -> &'static str {
        match self {
            Self::Sales => "sales",
            Self::ShopSales => "shop_sale",
            Self::Warehouse => "warehouse",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct WriteBody {
    company_id: u64,
    module: Module,
    rows: Vec<Selection>,
    preview: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Selection {
    item_id: String,
    revision: i32,
    customer_id: Option<String>,
    expected_digest: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReadQuery {
    company_id: u64,
    before_id: Option<i64>,
    record_id: Option<i64>,
    task_id: Option<String>,
    from: Option<String>,
    through: Option<String>,
}

impl ReadQuery {
    fn validate(&self) -> Result<(), ApiError> {
        if let Some(record_id) = self.record_id {
            if record_id <= 0 {
                return Err(ApiError::BadRequest("Invalid saved record ID".into()));
            }
            if self.before_id.is_some() || self.from.is_some() || self.through.is_some() {
                return Err(ApiError::BadRequest(
                    "Saved record lookup cannot use date or pagination filters".into(),
                ));
            }
        }
        if self
            .task_id
            .as_deref()
            .is_some_and(|task| !super::tasks::valid_request_id(task))
        {
            return Err(ApiError::BadRequest("Invalid import task ID".into()));
        }
        for date in [&self.from, &self.through].into_iter().flatten() {
            calendar_date(date).map_err(ApiError::BadRequest)?;
        }
        if matches!((&self.from, &self.through), (Some(from), Some(through)) if from > through) {
            return Err(ApiError::BadRequest(
                "Date range start must be on or before its end".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum Facts<'a> {
    Sales {
        customer_id: String,
        customer: &'a str,
        source_customer: &'a str,
        product: &'a str,
        quantity: &'a str,
        unit: Option<&'a str>,
        unit_price: &'a str,
        amount: &'a str,
        currency: String,
        reported_payment: Option<&'a str>,
    },
    ShopSale {
        shop: &'a str,
        product: &'a str,
        quantity: &'a str,
        unit: Option<&'a str>,
        unit_price: &'a str,
        amount: &'a str,
        currency: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        sale_line_issuer: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        sale_line_reference: Option<&'a str>,
    },
    Warehouse {
        product: &'a str,
        pieces: &'a str,
        kilograms: &'a str,
        location: Option<&'a str>,
    },
}

struct ReviewedFacts<'a> {
    original: &'a ReviewItem,
    values: &'a BTreeMap<String, Option<String>>,
    confirmed: &'a [String],
    fully_confirmed: bool,
}

impl<'a> ReviewedFacts<'a> {
    fn value(&self, keys: &[&str], labels: &[&str]) -> Option<&'a str> {
        let field = self.original.fields.iter().find(|field| {
            keys.contains(&field.key.as_str()) || labels.contains(&field.label.as_str())
        })?;
        if !self.fully_confirmed && !self.confirmed.contains(&field.key) {
            return None;
        }
        self.values
            .get(&field.key)?
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("unknown"))
    }

    fn date(&self, keys: &[&str], labels: &[&str]) -> Option<NaiveDate> {
        calendar_date(self.value(keys, labels)?).ok()
    }

    fn number(&self, keys: &[&str], labels: &[&str]) -> Option<&'a str> {
        self.value(keys, labels)
            .filter(|value| decimal(value).is_some_and(|n| n >= 0))
    }

    fn explicit_line_identity(&self) -> Result<(Option<&'a str>, Option<&'a str>), &'static str> {
        let Some((issuer, reference)) = self
            .identity_field("sale_line_issuer")
            .zip(self.identity_field("sale_line_reference"))
        else {
            return Err(
                "Confirm the original line issuer and reference without changing their values",
            );
        };
        match (issuer, reference) {
            (None, None) | (Some(_), Some(_)) => Ok((issuer, reference)),
            _ => Err("Supply both the stable sale line reference and its issuing source"),
        }
    }

    /// None means the imported identity was changed, unsupported, or unconfirmed.
    fn identity_field(&self, key: &str) -> Option<Option<&'a str>> {
        let raw = self
            .original
            .fields
            .iter()
            .find(|field| field.key == key)
            .and_then(|field| field.source_value.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let chosen = self
            .values
            .get(key)
            .and_then(Option::as_deref)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if raw.is_none() && chosen.is_none() {
            return Some(None);
        }
        let value =
            raw.filter(|value| value.len() <= 160 && !value.chars().any(char::is_control))?;
        (chosen == Some(value) && self.value(&[key], &[]) == Some(value)).then_some(Some(value))
    }
}

fn canonical_name(text: &str) -> String {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn customer<'a>(
    contacts: &'a [Value],
    label: &str,
    selected: Option<&str>,
) -> Option<(String, &'a str)> {
    let label = canonical_name(label);
    let mut exact = Vec::new();
    let mut prefix = Vec::new();
    if label.is_empty() {
        return None;
    }
    for contact in contacts {
        let Some(id) = row_u64(contact, "id", "id")
            .ok()
            .flatten()
            .filter(|id| *id > 0)
        else {
            continue;
        };
        let id = id.to_string();
        let Some(name) = contact["name"].as_str() else {
            continue;
        };
        if let Some(selected) = selected {
            if selected == id {
                return Some((id, name));
            }
            continue;
        }
        let normalized = canonical_name(name);
        if normalized == label {
            exact.push((id, name));
        } else if normalized
            .strip_prefix(&label)
            .is_some_and(|suffix| suffix.starts_with(' '))
        {
            prefix.push((id, name));
        }
    }
    match (exact.as_slice(), prefix.as_slice()) {
        ([found], _) | ([], [found]) => Some(found.clone()),
        _ => None,
    }
}

fn matches_sale_amount(quantity: &str, price: &str, amount: &str) -> bool {
    let recorded = decimal(amount).and_then(|amount| amount.checked_mul(1_000_000));
    decimal(quantity)
        .zip(decimal(price))
        .and_then(|(quantity, price)| quantity.checked_mul(price))
        .is_some_and(|product| Some(product) == recorded)
}

fn prepare_shop_sale(
    row: ReviewedFacts<'_>,
) -> Result<(NaiveDate, NaiveDate, Facts<'_>), &'static str> {
    let date = row
        .date(&["sale_date"], &[])
        .ok_or("Confirm the exact sale date")?;
    if let Some(source_date) = &row.original.business_date {
        if source_date.precision != super::history_period::DatePrecision::Day
            || source_date
                .from
                .as_deref()
                .and_then(|day| calendar_date(day).ok())
                != Some(date)
        {
            return Err("The sale date must match the original single-day report");
        }
    }
    let shop = row.value(&["shop"], &[]).ok_or("Confirm the source shop")?;
    let product = row
        .value(&["product_label"], &[])
        .ok_or("Confirm the sold product")?;
    let positive = |key| {
        row.number(&[key], &[])
            .filter(|value| decimal(value).is_some_and(|n| n > 0))
    };
    let quantity = positive("sold_quantity").ok_or("Confirm a positive sold quantity")?;
    let unit_price = positive("sale_unit_price").ok_or("Confirm a positive sale price")?;
    let amount = positive("sale_amount").ok_or("Confirm the recorded sale total")?;
    if !matches_sale_amount(quantity, unit_price, amount) {
        return Err("Reconcile quantity, unit price, and recorded total");
    }
    let currency = row
        .value(&["currency_code"], &[])
        .filter(|code| code.len() == 3 && code.bytes().all(|b| b.is_ascii_alphabetic()))
        .ok_or("Confirm the sales currency")?
        .to_uppercase();
    let (sale_line_issuer, sale_line_reference) = row.explicit_line_identity()?;
    Ok((
        date,
        date,
        Facts::ShopSale {
            shop,
            product,
            quantity,
            unit: row.value(&["source_unit"], &[]),
            unit_price,
            amount,
            currency,
            sale_line_issuer,
            sale_line_reference,
        },
    ))
}

fn prepare<'a>(
    module: Module,
    row: ReviewedFacts<'a>,
    contacts: &'a [Value],
    selected_customer: Option<&str>,
) -> Result<(NaiveDate, NaiveDate, Facts<'a>), &'static str> {
    match module {
        Module::ShopSales => prepare_shop_sale(row),
        Module::Sales => {
            let source_customer = row
                .value(
                    &["customer", "customer_label", "source_customer_label"],
                    &["Source customer label"],
                )
                .ok_or("Confirm the customer recorded in the source")?;
            let (customer_id, name) = customer(contacts, source_customer, selected_customer)
                .ok_or("Choose the matching CRM customer")?;
            let product = row
                .value(
                    &["product", "product_label", "product_scope", "summary_scope"],
                    &["Product or summary scope"],
                )
                .ok_or("Confirm the product or summary scope")?;
            let start = row
                .date(&["period_start", "date"], &["Period start (YYYY-MM-DD)"])
                .ok_or("Confirm the start of the sales period")?;
            let end = row
                .date(&["period_end", "date"], &["Period end (YYYY-MM-DD)"])
                .filter(|end| *end >= start)
                .ok_or("Confirm the end of the sales period")?;
            let quantity = row
                .number(
                    &[
                        "quantity",
                        "source_quantity",
                        "recorded_quantity",
                        "sold_quantity",
                    ],
                    &["Recorded quantity (unit to confirm)"],
                )
                .ok_or("Confirm the recorded sales quantity")?;
            let unit_price = row
                .number(
                    &["unit_price", "source_unit_price", "price_unit"],
                    &["Recorded price per source unit (RWF)"],
                )
                .ok_or("Confirm the recorded unit price")?;
            let amount = row
                .number(
                    &["sales_total", "amount", "sale_amount", "total"],
                    &["Recorded sales total (RWF)"],
                )
                .ok_or("Confirm the recorded sales total")?;
            if !matches_sale_amount(quantity, unit_price, amount) {
                return Err("Reconcile quantity, unit price, and recorded total");
            }
            let currency = row
                .value(&["currency_code", "currency"], &[])
                .or_else(|| {
                    row.original
                        .fields
                        .iter()
                        .any(|field| field.label == "Recorded sales total (RWF)")
                        .then_some("RWF")
                })
                .filter(|code| code.len() == 3 && code.bytes().all(|b| b.is_ascii_alphabetic()))
                .ok_or("Confirm the sales currency")?
                .to_uppercase();
            Ok((
                start,
                end,
                Facts::Sales {
                    customer_id,
                    customer: name,
                    source_customer,
                    product,
                    quantity,
                    unit: row.value(&["source_unit", "unit", "uom"], &["Source quantity unit"]),
                    unit_price,
                    amount,
                    currency,
                    reported_payment: row.value(
                        &["payment_comment", "source_payment_comment", "comment"],
                        &["Source payment comment"],
                    ),
                },
            ))
        }
        Module::Warehouse => {
            let date = row
                .date(
                    &["count_date", "as_of", "date", "source_count_date"],
                    &[
                        "Count date (YYYY-MM-DD)",
                        "Snapshot date (YYYY-MM-DD)",
                        "Count date",
                        "Snapshot date",
                        "Source count date",
                    ],
                )
                .or_else(|| {
                    row.original
                        .business_date
                        .as_ref()
                        .filter(|date| date.precision == super::history_period::DatePrecision::Day)
                        .and_then(|date| calendar_date(date.from.as_deref()?).ok())
                })
                .ok_or("Confirm the inventory count date")?;
            let product = row
                .value(
                    &["product", "product_label", "source_product_label"],
                    &["Source product label"],
                )
                .ok_or("Confirm the counted product label")?;
            let pieces = row
                .number(
                    &["pieces", "piece_count", "counted_pieces"],
                    &["Recorded piece count"],
                )
                .filter(|value| decimal(value).is_some_and(|n| n % 1_000_000 == 0))
                .ok_or("Confirm the recorded piece count")?;
            let kilograms = row
                .number(
                    &["kilograms", "weight_kg", "counted_weight"],
                    &["Recorded weight (kg)"],
                )
                .ok_or("Confirm the recorded weight")?;
            Ok((
                date,
                date,
                Facts::Warehouse {
                    product,
                    pieces,
                    kilograms,
                    location: row.value(
                        &["location", "business_location", "stock_location"],
                        &["Business location"],
                    ),
                },
            ))
        }
    }
}

async fn load_customers(
    state: &AppState,
    context: &TrustedOperationContext,
    company: u64,
) -> Result<Vec<Value>, ApiError> {
    context.require_company_scope(&[company])?;
    require_owner_read_permission("contacts", context)?;
    // Contacts are private in SpaceTimeDB. Use the same company-scoped,
    // permission-checked resource read as the CRM screen.
    let rows = execute_resource_query_for_company(
        &state.stdb,
        "contacts",
        context.organization_id(),
        context.actor_identity(),
        Some(context.field_access()),
        Some(company),
    )
    .await?;
    Ok(backfill_customers(rows))
}

fn backfill_customers(rows: Vec<Value>) -> Vec<Value> {
    rows.into_iter()
        .filter(|row| {
            row.get("isCustomer")
                .or_else(|| row.get("is_customer"))
                .and_then(Value::as_bool)
                == Some(true)
                && row_u64(row, "mergeTargetId", "merge_target_id").is_ok_and(|id| id.is_none())
        })
        .collect()
}

pub(super) async fn write(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(batch): Path<i64>,
    Json(body): Json<WriteBody>,
) -> Result<Json<Value>, ApiError> {
    let ctx = scope(&state, &session, body.company_id).await?;
    let org = ctx.organization_id();
    let company = body.company_id;
    if batch <= 0 || body.rows.is_empty() || body.rows.len() > 200 {
        return Err(ApiError::BadRequest("select 1–200 reviewed rows".into()));
    }
    let selected = body
        .rows
        .iter()
        .map(|row| {
            let id = row
                .item_id
                .parse::<i64>()
                .ok()
                .filter(|id| *id > 0)
                .ok_or_else(|| ApiError::BadRequest("invalid reviewed row ID".into()))?;
            Ok((id, row))
        })
        .collect::<Result<BTreeMap<_, _>, ApiError>>()?;
    if selected.len() != body.rows.len() {
        return Err(ApiError::BadRequest("duplicate reviewed row IDs".into()));
    }
    let contacts = match body.module {
        Module::Sales => load_customers(&state, &ctx, company).await?,
        Module::ShopSales | Module::Warehouse => Vec::new(),
    };
    let org = org.to_string();
    let company = company.to_string();
    let ids: Vec<_> = selected.keys().copied().collect();
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    if matches!(body.module, Module::ShopSales) && !body.preview {
        reconciliation::lock_shop_sales(&tx, &org, &company).await?;
    }
    let eligible: bool = tx
        .query_one(
            "WITH links AS (
                 SELECT link.from_inspection, task.approved_mode, task.state
                 FROM lumiere_platform.import_task_review link
                 JOIN lumiere_platform.import_task task USING
                     (organization_id, company_id, actor_identity, request_id)
                 WHERE link.organization_id=$1::text::numeric
                   AND link.company_id=$2::text::numeric AND link.batch_id=$3
             )
             SELECT NOT EXISTS (SELECT 1 FROM links)
                 OR EXISTS (SELECT 1 FROM links WHERE NOT from_inspection
                     AND approved_mode='prepare_import' AND state='needs_review')",
            &[&org, &company, &batch],
        )
        .await
        .map_err(ApiError::internal)?
        .get(0);
    if !eligible {
        return Err(ApiError::Conflict(
            "Prepare the import before previewing or saving ERP records.".into(),
        ));
    }
    let items = tx
        .query(
            "SELECT item.id, item.revision, item.state, item.source_json, item.proposed_json, item.confirmed_fields
             FROM lumiere_platform.import_review_item item
             JOIN lumiere_platform.import_review_batch batch
               ON batch.organization_id=item.organization_id AND batch.company_id=item.company_id AND batch.id=item.batch_id
             WHERE item.organization_id=$1::text::numeric AND item.company_id=$2::text::numeric
               AND item.batch_id=$3 AND item.id=ANY($4::bigint[]) AND batch.target_entity='source_observation'
             ORDER BY item.id FOR SHARE OF item",
            &[&org, &company, &batch, &ids],
        )
        .await
        .map_err(ApiError::internal)?;
    if items.len() != ids.len() {
        return Err(ApiError::Conflict(
            "selected rows are outside this source review".into(),
        ));
    }
    let mut results = Vec::with_capacity(items.len());
    for item in items {
        let id: i64 = item.get("id");
        let revision: i32 = item.get("revision");
        let state: String = item.get("state");
        let selection = selected
            .get(&id)
            .ok_or_else(|| ApiError::Conflict("selected row changed".into()))?;
        if selection.revision != revision || state == "excluded" {
            results.push(json!({"itemId":id.to_string(),"status":"held","reason":"Source review changed. Refresh before saving."}));
            continue;
        }
        let original: ReviewItem =
            serde_json::from_value(item.get("source_json")).map_err(ApiError::internal)?;
        let values =
            serde_json::from_value(item.get("proposed_json")).map_err(ApiError::internal)?;
        let confirmed: Vec<String> =
            serde_json::from_value(item.get("confirmed_fields")).map_err(ApiError::internal)?;
        let reviewed = ReviewedFacts {
            original: &original,
            values: &values,
            confirmed: &confirmed,
            fully_confirmed: state == "confirmed",
        };
        let (start, end, facts) = match prepare(
            body.module,
            reviewed,
            &contacts,
            selection.customer_id.as_deref(),
        ) {
            Ok(ready) => ready,
            Err(reason) => {
                results.push(json!({"itemId":id.to_string(),"status":"held","reason":reason}));
                continue;
            }
        };
        let start = start.to_string();
        let end = end.to_string();
        let facts = serde_json::to_value(facts).map_err(ApiError::internal)?;
        let digest = hex::encode(Sha256::digest(
            serde_json::to_vec(&(id, revision, &start, &end, &facts))
                .map_err(ApiError::internal)?,
        ));
        let row = BackfillRow {
            organization: &org,
            company: &company,
            module: body.module,
            source: &original.source,
            period_start: &start,
            period_end: &end,
            facts: &facts,
        };
        if !body.preview && selection.expected_digest.as_deref() != Some(digest.as_str()) {
            results.push(json!({"itemId":id.to_string(),"status":"held","reason":"The mapped record changed. Preview it again."}));
            continue;
        }
        let key = row.business_key()?;
        let mut existing = row.existing(&tx, &key).await?;
        let mut saved_id = None;
        if !body.preview && matches!(existing, Existing::None) {
            saved_id = row
                .save(&tx, batch, id, revision, ctx.actor_identity(), &key)
                .await?;
            if saved_id.is_none() {
                existing = row.existing(&tx, &key).await?;
            }
        }
        let saved = match existing {
            Existing::None => None,
            Existing::Matched(saved) => Some(saved),
            Existing::Held(reason) => {
                results.push(json!({"itemId":id.to_string(),"status":"held","reason":reason}));
                continue;
            }
            Existing::Conflict(reason) => {
                results.push(json!({"itemId":id.to_string(),"status":"conflict","reason":reason}));
                continue;
            }
        };
        if body.preview {
            results.push(json!({
                "itemId":id.to_string(), "status":"ready", "periodStart":start, "periodEnd":end,
                "facts":facts, "digest":digest, "recordId":saved.map(|record| record.id.to_string())
            }));
            continue;
        }
        let (status, record_id) = if let Some(record_id) = saved_id {
            ("saved", record_id)
        } else if let Some(saved) = saved {
            if (saved.item, saved.revision) != (id, revision) {
                tx.execute(
                    "INSERT INTO lumiere_platform.module_backfill_review_match
                     (organization_id, company_id, batch_id, item_id, source_revision, record_id)
                     VALUES ($1::text::numeric, $2::text::numeric, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
                    &[&org, &company, &batch, &id, &revision, &saved.id],
                )
                .await
                .map_err(ApiError::internal)?;
            }
            ("matched", saved.id)
        } else {
            return Err(ApiError::Conflict(
                "The saved import changed. Preview the affected row again.".into(),
            ));
        };
        results.push(
            json!({"itemId":id.to_string(),"status":status,"recordId":record_id.to_string()}),
        );
    }
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(json!({"module":body.module,"results":results})))
}

pub(super) async fn task_results(
    tx: &tokio_postgres::Transaction<'_>,
    scope: super::StorageScope<'_>,
    task: &str,
) -> Result<Vec<Value>, ApiError> {
    let rows = tx
        .query(
            "SELECT CASE WHEN record.facts->>'kind' = 'shop_sale' THEN 'shop_sales'
                      ELSE record.module END AS module, count(*)::bigint AS count
         FROM lumiere_platform.module_backfill_record record
         WHERE record.organization_id=$1::text::numeric AND record.company_id=$2::text::numeric
         AND EXISTS (SELECT 1 FROM lumiere_platform.import_task_review link
             JOIN lumiere_platform.module_backfill_review_record source USING (organization_id, company_id, batch_id)
             WHERE source.organization_id=record.organization_id AND source.company_id=record.company_id
             AND source.record_id=record.id AND link.actor_identity=$3 AND link.request_id=$4)
         GROUP BY 1 ORDER BY 1",
            &[
                &scope.organization.to_string(),
                &scope.company.to_string(),
                &scope.actor,
                &task,
            ],
        )
        .await
        .map_err(ApiError::internal)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "module":row.get::<_,String>("module"), "count":row.get::<_,i64>("count"),
            })
        })
        .collect())
}

/// Scope durable module writes and replays to batches attached to this actor's task.
pub(super) async fn workflow_results(
    tx: &tokio_postgres::Transaction<'_>,
    scope: super::StorageScope<'_>,
    task: &str,
) -> Result<Value, ApiError> {
    let rows = tx.query(
        "WITH batches AS (
            SELECT batch_id FROM lumiere_platform.import_task_review
            WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric
              AND actor_identity=$3 AND request_id=$4
         ), receipts AS (
            SELECT record.id AS record_id, true AS created_here
            FROM lumiere_platform.module_backfill_record record JOIN batches USING (batch_id)
            WHERE record.organization_id=$1::text::numeric AND record.company_id=$2::text::numeric
            UNION ALL
            SELECT matched.record_id, false
            FROM lumiere_platform.module_backfill_review_match matched JOIN batches USING (batch_id)
            WHERE matched.organization_id=$1::text::numeric AND matched.company_id=$2::text::numeric
         ), scoped_records AS (
            SELECT record_id, bool_or(created_here) AS created_here FROM receipts GROUP BY record_id
         ), records AS (
            SELECT record.*, scoped.created_here
            FROM scoped_records scoped JOIN lumiere_platform.module_backfill_record record ON record.id=scoped.record_id
            WHERE record.organization_id=$1::text::numeric AND record.company_id=$2::text::numeric
         ), sale_amounts AS (
            SELECT facts->>'currency' AS currency,
                   CASE WHEN facts->>'amount' ~ '^[0-9]{1,12}([.][0-9]{1,6})?$'
                        THEN (facts->>'amount')::numeric END AS amount
            FROM records WHERE module='sales' AND facts->>'kind'='shop_sale'
         ), totals AS (
            SELECT currency, trim_scale(sum(amount))::text AS amount, count(*) AS count
            FROM sale_amounts WHERE currency ~ '^[A-Z]{3}$' AND amount > 0 GROUP BY currency
         ), reconciliation AS (
            SELECT CASE WHEN count(*) <= 20 AND coalesce(sum(count), 0) = (SELECT count(*) FROM sale_amounts)
                        THEN coalesce(jsonb_agg(to_jsonb(totals) ORDER BY currency), '[]'::jsonb) END AS sales_totals
            FROM totals
         )
         SELECT record.id, CASE WHEN record.facts->>'kind'='shop_sale' THEN 'shop_sales'
                           ELSE record.module END AS module,
                record.period_start::text, record.facts->>'product' AS product,
                count(*) OVER () AS verified,
                count(*) FILTER (WHERE NOT record.created_here) OVER () AS already_present, sales_totals
         FROM records record CROSS JOIN reconciliation
         ORDER BY record.period_start DESC, record.id DESC LIMIT 20",
        &[&scope.organization.to_string(), &scope.company.to_string(), &scope.actor, &task],
    ).await.map_err(ApiError::internal)?;
    let (verified, present) = rows.first().map_or((0i64, 0i64), |row| {
        (row.get("verified"), row.get("already_present"))
    });
    let records = rows
        .iter()
        .map(|row| {
            let mut record = json!({
                "id": row.get::<_, i64>("id").to_string(),
                "module": row.get::<_, String>("module"),
                "periodStart": row.get::<_, String>("period_start"),
            });
            if let Some(product) = row
                .get::<_, Option<&str>>("product")
                .filter(|name| !name.is_empty())
            {
                record["displayLabel"] = Value::String(product.chars().take(200).collect());
            }
            record
        })
        .collect::<Vec<_>>();
    let mut result = json!({
        "counts": {"verified": verified, "alreadyPresent": present},
        "more": verified > records.len() as i64,
        "records": records,
    });
    if let Some(totals) = rows.first().map_or(Some(json!([])), |row| {
        row.get::<_, Option<Value>>("sales_totals")
    }) {
        result["salesTotals"] = totals;
    }
    Ok(result)
}

pub(super) async fn read(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(module): Path<Module>,
    Query(query): Query<ReadQuery>,
) -> Result<Json<Value>, ApiError> {
    query.validate()?;
    let ctx = scope(&state, &session, query.company_id).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let rows = client
        .query(
            "SELECT record.id, record.batch_id, record.source_file, record.source_row,
                    nullif(record.source_worksheet, '') AS source_worksheet,
                    record.period_start::text AS period_start, record.period_end::text AS period_end,
                    record.facts, record.item_id, record.source_revision,
                    to_char(record.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS saved_at
             FROM lumiere_platform.module_backfill_record record
             WHERE record.organization_id = $1::text::numeric
               AND record.company_id = $2::text::numeric
               AND record.module = $3 AND record.facts->>'kind' = $9
               AND ($10::bigint IS NULL OR record.id = $10)
               AND ($5::text IS NULL OR EXISTS (
                   SELECT 1 FROM lumiere_platform.import_task_review link
                   JOIN lumiere_platform.module_backfill_review_record source USING (organization_id, company_id, batch_id)
                   WHERE source.organization_id = record.organization_id AND source.company_id = record.company_id
                     AND source.record_id = record.id AND link.actor_identity = $8 AND link.request_id = $5
               ))
               AND ($6::text IS NULL OR record.period_end >= $6::text::date)
               AND ($7::text IS NULL OR record.period_start <= $7::text::date)
               AND ($4::bigint IS NULL OR (record.period_end, record.id) < (
                   SELECT cursor.period_end, cursor.id
                   FROM lumiere_platform.module_backfill_record cursor
                   WHERE cursor.id = $4 AND cursor.organization_id = $1::text::numeric
                     AND cursor.company_id = $2::text::numeric AND cursor.module = $3
                     AND cursor.facts->>'kind' = $9
               ))
             ORDER BY record.period_end DESC, record.id DESC
             LIMIT 101",
            &[
                &ctx.organization_id().to_string(),
                &query.company_id.to_string(),
                &module.storage_name(),
                &query.before_id,
                &query.task_id,
                &query.from,
                &query.through,
                &ctx.actor_identity(),
                &module.record_kind(),
                &query.record_id,
            ],
        )
        .await
        .map_err(ApiError::internal)?;
    let next = (rows.len() > 100).then(|| rows[99].get::<_, i64>("id").to_string());
    let data = rows.iter().take(100).map(|row| json!({
        "id":row.get::<_,i64>("id").to_string(),"batchId":row.get::<_,i64>("batch_id").to_string(),
        "sourceFile":row.get::<_,String>("source_file"),"sourceWorksheet":row.get::<_,Option<String>>("source_worksheet"),"sourceRow":row.get::<_,i64>("source_row"),
        "periodStart":row.get::<_,String>("period_start"),"periodEnd":row.get::<_,String>("period_end"),"facts":row.get::<_,Value>("facts"),
        "savedAt":row.get::<_,String>("saved_at"),
        "itemId":row.get::<_,i64>("item_id").to_string(),"sourceRevision":row.get::<_,i32>("source_revision"),
    })).collect::<Vec<_>>();
    Ok(Json(json!({"data":data,"nextBeforeId":next})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_filters_require_valid_dates_and_import_identity() {
        let mut query = ReadQuery {
            company_id: 4097,
            before_id: None,
            record_id: None,
            task_id: Some("a".repeat(32)),
            from: Some("2022-06-13".into()),
            through: Some("2022-06-13".into()),
        };
        assert!(query.validate().is_ok());
        query.through = Some("2022-06-12".into());
        assert!(query.validate().is_err());
        query.through = Some("2022-02-29".into());
        assert!(query.validate().is_err());
        query.through = None;
        assert!(query.validate().is_ok());
        query.task_id = Some("invalid".into());
        assert!(query.validate().is_err());
    }

    #[test]
    fn exact_record_reads_keep_task_scope_without_date_or_cursor_filters() {
        let mut query = ReadQuery {
            company_id: 4097,
            before_id: None,
            record_id: Some(i64::MAX),
            task_id: Some("a".repeat(32)),
            from: None,
            through: None,
        };
        assert!(query.validate().is_ok());
        query.before_id = Some(1);
        assert!(query.validate().is_err());
        query.before_id = None;
        query.from = Some("2022-06-13".into());
        assert!(query.validate().is_err());
        query.from = None;
        query.through = Some("2022-06-13".into());
        assert!(query.validate().is_err());
        query.through = None;
        query.record_id = Some(0);
        assert!(query.validate().is_err());
    }

    fn source(fields: &[(&str, &str, &str)]) -> ReviewItem {
        serde_json::from_value(json!({
            "key":"week-10","label":"Reported transaction","issue":"Review",
            "source":{"file":"source.csv","row":10,"sha256":"a".repeat(64)},
            "proposed": fields.iter().map(|(key,_,value)| (*key,*value)).collect::<BTreeMap<_,_>>(),
            "fields": fields.iter().map(|(key,label,value)| json!({
                "key":key,"label":label,"sourceValue":value,"kind":"text","required":true
            })).collect::<Vec<_>>()
        }))
        .unwrap()
    }

    #[test]
    fn builds_sales_from_partially_confirmed_fields_and_preserves_source_values() {
        let row = source(&[
            ("customer_label", "Source customer label", "LEMIGO"),
            ("period_start", "Period start (YYYY-MM-DD)", "2022-06-13"),
            ("period_end", "Period end (YYYY-MM-DD)", "2022-06-18"),
            ("product_scope", "Product or summary scope", "Chicken"),
            ("quantity", "Recorded quantity (unit to confirm)", "1089"),
            ("source_unit", "Source quantity unit", "kg"),
            ("unit_price", "Recorded price per source unit (RWF)", "4000"),
            ("sales_total", "Recorded sales total (RWF)", "4356000"),
            ("payment_comment", "Source payment comment", "PAYEMENT CHEQ"),
        ]);
        let selected: Vec<_> = row
            .proposed
            .keys()
            .filter(|key| *key != "source_unit")
            .cloned()
            .collect();
        let review = ReviewedFacts {
            original: &row,
            values: &row.proposed,
            confirmed: &selected,
            fully_confirmed: false,
        };
        let contacts = [json!({"id":42,"name":"LEMIGO HOTEL"})];
        let (start, end, result) = prepare(Module::Sales, review, &contacts, None).unwrap();
        assert_eq!(start.to_string(), "2022-06-13");
        assert_eq!(end.to_string(), "2022-06-18");
        let result = serde_json::to_value(result).unwrap();
        assert_eq!(result["customerId"], "42");
        assert_eq!(result["product"], "Chicken");
        assert_eq!(result["amount"], "4356000");
        assert_eq!(result["currency"], "RWF");
        assert!(result["unit"].is_null());
        assert_eq!(result["reportedPayment"], "PAYEMENT CHEQ");
    }

    #[test]
    fn builds_dated_shop_sales_without_customer_or_payment() {
        let mut row = source(&[
            ("shop", "Shop", "KIMIRONKO"),
            ("sale_date", "Sale date", "2024-04-12"),
            ("product_label", "Product", "WHOLE CHICKENS"),
            ("sold_quantity", "Quantity", "8.125"),
            ("sale_unit_price", "Unit price", "4000"),
            ("sale_amount", "Recorded total", "32500"),
            ("currency_code", "Currency", "RWF"),
        ]);
        row.business_date = Some(super::super::history_period::BusinessDate {
            precision: super::super::history_period::DatePrecision::Day,
            from: Some("2024-04-12".into()),
            to_exclusive: Some("2024-04-13".into()),
            raw: None,
        });
        let prepare_row = |row: &ReviewItem| {
            let review = ReviewedFacts {
                original: row,
                values: &row.proposed,
                confirmed: &[],
                fully_confirmed: true,
            };
            prepare(Module::ShopSales, review, &[], None)
                .map(|(start, end, facts)| (start, end, serde_json::to_value(facts).unwrap()))
        };
        let (start, end, facts) = prepare_row(&row).unwrap();
        assert_eq!(start.to_string(), "2024-04-12");
        assert_eq!(start, end);
        assert_eq!(facts["kind"], "shop_sale");
        assert_eq!(facts["shop"], "KIMIRONKO");
        assert_eq!(facts["product"], "WHOLE CHICKENS");
        assert_eq!(facts["quantity"], "8.125");
        assert_eq!(facts["unitPrice"], "4000");
        assert_eq!(facts["amount"], "32500");
        assert!(facts.get("customerId").is_none());
        assert!(facts.get("reportedPayment").is_none());

        row.proposed
            .insert("sale_amount".into(), Some("32499".into()));
        assert!(prepare_row(&row).is_err());
        row.proposed
            .insert("sale_amount".into(), Some("32500".into()));
        row.proposed
            .insert("sale_date".into(), Some("2024-04-13".into()));
        assert!(prepare_row(&row).is_err());
    }

    #[test]
    fn only_confirmed_original_pos_line_identities_are_reusable() {
        let row = source(&[
            ("sale_line_issuer", "Issuer", "Kicukiro POS"),
            ("sale_line_reference", "Line reference", "0010"),
        ]);
        let review = ReviewedFacts {
            original: &row,
            values: &row.proposed,
            confirmed: &[],
            fully_confirmed: true,
        };
        assert_eq!(
            review.explicit_line_identity(),
            Ok((Some("Kicukiro POS"), Some("0010")))
        );
        let unconfirmed = ReviewedFacts {
            fully_confirmed: false,
            ..review
        };
        assert!(unconfirmed.explicit_line_identity().is_err());
        let mut revised = row.proposed.clone();
        revised.insert("sale_line_reference".into(), Some("10".into()));
        assert!(ReviewedFacts {
            values: &revised,
            ..review
        }
        .explicit_line_identity()
        .is_err());
    }

    #[test]
    fn customer_lookup_excludes_vendors_and_merged_contacts() {
        let rows = backfill_customers(vec![
            json!({"id":1,"name":"Lemigo Hotel","is_customer":true,"merge_target_id":{"none":[]}}),
            json!({"id":2,"name":"Lemigo Vendor","is_customer":false}),
            json!({"id":3,"name":"Lemigo Duplicate","isCustomer":true,"mergeTargetId":{"some":[1]}}),
        ]);
        assert_eq!(
            customer(&rows, "Lemigo", None),
            Some(("1".into(), "Lemigo Hotel"))
        );
        assert!(customer(&rows, "Lemigo", Some("3")).is_none());
    }

    #[test]
    fn ambiguous_customer_requires_a_scoped_selection() {
        let contacts = [
            json!({"id":1,"name":"Lemigo Hotel"}),
            json!({"id":2,"name":"Lemigo Catering"}),
        ];
        assert!(customer(&contacts, "LEMIGO", None).is_none());
        assert_eq!(
            customer(&contacts, "LEMIGO", Some("2")),
            Some(("2".into(), "Lemigo Catering"))
        );
        assert!(customer(&contacts, "LEMIGO", Some("9")).is_none());
    }

    #[test]
    fn keeps_piece_count_and_weight_independent() {
        let row = source(&[
            ("count_date", "Count date", "2022-10-05"),
            ("product_label", "Source product label", "WHOLLCHICKEN"),
            ("pieces", "Recorded piece count", "839"),
            ("kilograms", "Recorded weight (kg)", "1531.200"),
        ]);
        let review = ReviewedFacts {
            original: &row,
            values: &row.proposed,
            confirmed: &[],
            fully_confirmed: true,
        };
        let (_, _, record) = prepare(Module::Warehouse, review, &[], None).unwrap();
        let record = serde_json::to_value(record).unwrap();
        assert_eq!(record["pieces"], "839");
        assert_eq!(record["kilograms"], "1531.200");
        assert!(record["location"].is_null());
    }
}
