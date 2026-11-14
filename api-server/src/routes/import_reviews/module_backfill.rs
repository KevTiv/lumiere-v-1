//! Reviewed sales summaries and physical counts have a durable module record.
use std::{collections::BTreeMap, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{
    history_period::calendar_date,
    model::{decimal, ReviewItem},
    scope,
};
use crate::{
    cold_tier::pg_pool, error::ApiError, query_exec::row_u64, state::AppState,
    web_session::OrgSession,
};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Module {
    Sales,
    Warehouse,
}

impl Module {
    fn name(self) -> &'static str {
        match self {
            Self::Sales => "sales",
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

fn prepare<'a>(
    module: Module,
    row: ReviewedFacts<'a>,
    contacts: &'a [Value],
    selected_customer: Option<&str>,
) -> Result<(NaiveDate, NaiveDate, Facts<'a>), &'static str> {
    match module {
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
            if decimal(quantity)
                .zip(decimal(unit_price))
                .and_then(|(qty, price)| qty.checked_mul(price))
                != decimal(amount).and_then(|amount| amount.checked_mul(1_000_000))
            {
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

pub(super) async fn write(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(batch): Path<i64>,
    Json(body): Json<WriteBody>,
) -> Result<Json<Value>, ApiError> {
    let ctx = scope(&state, &session, body.company_id).await?;
    let org = ctx.organization_id();
    let company = body.company_id;
    let module = body.module.name();
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
    let contacts = if let Module::Sales = body.module {
        let contacts = ctx.client().query_sql(&format!(
            "SELECT id,name,company_id,deleted_at,merge_target_id FROM contact WHERE organization_id = {org} AND is_customer = true"
        )).await.map_err(ApiError::internal)?;
        let contacts = contacts
            .into_iter()
            .filter(|row| {
                matches!(
                    row_u64(row, "companyId", "company_id"),
                    Ok(None) | Ok(Some(0))
                ) || row_u64(row, "companyId", "company_id").ok().flatten() == Some(company)
            })
            .filter(|row| {
                row["deleted_at"].is_null()
                    && row["deletedAt"].is_null()
                    && row_u64(row, "mergeTargetId", "merge_target_id").is_ok_and(|id| id.is_none())
            })
            .collect::<Vec<_>>();
        contacts
    } else {
        Vec::new()
    };
    let org = org.to_string();
    let company = company.to_string();
    let ids: Vec<_> = selected.keys().copied().collect();
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let items = tx.query("SELECT item.id,item.revision,item.state,item.source_json,item.proposed_json,item.confirmed_fields
        FROM lumiere_platform.import_review_item item JOIN lumiere_platform.import_review_batch batch
        ON batch.organization_id=item.organization_id AND batch.company_id=item.company_id AND batch.id=item.batch_id
        WHERE item.organization_id=$1::text::numeric AND item.company_id=$2::text::numeric
        AND item.batch_id=$3 AND item.id=ANY($4::bigint[]) AND batch.target_entity='source_observation'
        ORDER BY item.id FOR SHARE OF item", &[&org,&company,&batch,&ids]).await.map_err(ApiError::internal)?;
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
        if body.preview {
            results.push(json!({"itemId":id.to_string(),"status":"ready","periodStart":start,"periodEnd":end,"facts":facts,"digest":digest}));
            continue;
        }
        if selection.expected_digest.as_deref() != Some(digest.as_str()) {
            results.push(json!({"itemId":id.to_string(),"status":"held","reason":"The mapped record changed. Preview it again."}));
            continue;
        }
        let source = &original.source;
        let number = i64::from(source.row);
        let inserted = tx.execute("INSERT INTO lumiere_platform.module_backfill_record
            (organization_id,company_id,module,batch_id,item_id,source_revision,source_sha256,source_row,source_file,period_start,period_end,facts,created_by)
            VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8,$9,$10::text::date,$11::text::date,$12,$13)
            ON CONFLICT (organization_id,company_id,module,source_sha256,source_row) DO NOTHING",
            &[&org,&company,&module,&batch,&id,&revision,&source.sha256,&number,&source.file,&start,&end,&facts,&ctx.actor_identity()]
        ).await.map_err(ApiError::internal)?;
        let saved = tx.query_one("SELECT id,period_start::text,period_end::text,facts FROM lumiere_platform.module_backfill_record
            WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND module=$3 AND source_sha256=$4 AND source_row=$5",
            &[&org,&company,&module,&source.sha256,&number]).await.map_err(ApiError::internal)?;
        let same = saved.get::<_, Value>("facts") == facts
            && saved.get::<_, String>(1) == start
            && saved.get::<_, String>(2) == end;
        let status = if !same {
            "conflict"
        } else if inserted == 1 {
            "saved"
        } else {
            "matched"
        };
        results.push(json!({"itemId":id.to_string(),"status":status,"recordId":saved.get::<_, i64>("id").to_string()}));
    }
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(json!({"module":module,"results":results})))
}

pub(super) async fn task_results(
    tx: &tokio_postgres::Transaction<'_>,
    scope: super::StorageScope<'_>,
    task: &str,
) -> Result<Vec<Value>, ApiError> {
    let rows = tx
        .query(
            "SELECT record.module,count(*)::bigint AS count
         FROM lumiere_platform.module_backfill_record record
         WHERE record.organization_id=$1::text::numeric AND record.company_id=$2::text::numeric
         AND EXISTS (SELECT 1 FROM lumiere_platform.import_task_review link
             WHERE link.organization_id=record.organization_id AND link.company_id=record.company_id
             AND link.batch_id=record.batch_id AND link.actor_identity=$3 AND link.request_id=$4)
         GROUP BY record.module ORDER BY record.module",
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

pub(super) async fn read(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(module): Path<Module>,
    Query(query): Query<ReadQuery>,
) -> Result<Json<Value>, ApiError> {
    let ctx = scope(&state, &session, query.company_id).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let rows = client.query("SELECT id,batch_id,source_file,source_row,period_start::text,period_end::text,facts,item_id,source_revision
        FROM lumiere_platform.module_backfill_record WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric
        AND module=$3 AND ($4::bigint IS NULL OR id < $4) ORDER BY id DESC LIMIT 101",
        &[&ctx.organization_id().to_string(),&query.company_id.to_string(),&module.name(),&query.before_id]).await.map_err(ApiError::internal)?;
    let next = (rows.len() > 100).then(|| rows[99].get::<_, i64>("id").to_string());
    let data = rows.iter().take(100).map(|row| json!({
        "id":row.get::<_,i64>("id").to_string(),"batchId":row.get::<_,i64>("batch_id").to_string(),
        "sourceFile":row.get::<_,String>("source_file"),"sourceRow":row.get::<_,i64>("source_row"),
        "periodStart":row.get::<_,String>(4),"periodEnd":row.get::<_,String>(5),"facts":row.get::<_,Value>("facts"),
        "itemId":row.get::<_,i64>("item_id").to_string(),"sourceRevision":row.get::<_,i32>("source_revision"),
    })).collect::<Vec<_>>();
    Ok(Json(json!({"data":data,"nextBeforeId":next})))
}

#[cfg(test)]
mod tests {
    use super::*;

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
