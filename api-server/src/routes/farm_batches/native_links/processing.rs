//! Verify and bind exact farm processing effects from Manufacturing.
use std::{collections::BTreeSet, sync::Arc};

use axum::{
    extract::{Path, State},
    routing::post,
    Json, Router,
};
use deadpool_postgres::Transaction;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    checked_batch_id, context, enum_is, field, id, native_data_unavailable, native_date, number,
    optional_id, NativeId, NativeReader, NativeResource,
};
use crate::{
    cold_tier::pg_pool,
    commands::dispatch_session_reducer,
    error::ApiError,
    routes::farm_batches::{authorize, lock_batch, read_event, EventKind, FarmAccess, FarmScope},
    session::ApiSession,
    state::AppState,
    web_session::OrgSession,
};

const MAX_OUTPUTS: usize = 16;
const FARM_CONFIG: &str = "farm_processing_v1";

const ORDER: NativeResource = NativeResource {
    key: "mrp-productions",
    fields: &[
        "state",
        "product_id",
        "move_raw_ids",
        "move_finished_ids",
        "date_finished",
    ],
    company_scoped: true,
};
const MOVEMENT: NativeResource = NativeResource {
    key: "stock-moves",
    fields: &[
        "state",
        "is_done",
        "scrapped",
        "production_id",
        "raw_material_production_id",
        "product_id",
        "product_uom",
        "quantity_done",
        "lot_id",
    ],
    company_scoped: true,
};
const LOT: NativeResource = NativeResource {
    key: "stock-production-lots",
    fields: &["product_id"],
    company_scoped: true,
};
const UNIT: NativeResource = NativeResource {
    key: "uoms",
    fields: &["symbol", "is_reference_unit"],
    company_scoped: false,
};
fn found_ids(row: &Value, camel: &str, snake: &str) -> Result<Vec<u64>, ApiError> {
    let ids = field(row, camel, snake)?
        .as_array()
        .ok_or_else(native_data_unavailable)?;
    if ids.len() > MAX_OUTPUTS {
        return Err(ApiError::Unprocessable(
            "The number of native moves exceeds the supported processing link".into(),
        ));
    }
    let mut seen = BTreeSet::new();
    ids.iter()
        .map(|value| {
            let id = value.as_u64().or_else(|| value.as_str()?.parse().ok())?;
            (id > 0 && seen.insert(id)).then_some(id)
        })
        .collect::<Option<Vec<_>>>()
        .ok_or_else(native_data_unavailable)
}

fn same_quantity(left: f64, right: f64) -> bool {
    left.is_finite() && right.is_finite() && (left - right).abs() <= 1e-9
}

async fn verify_movement(
    reader: &NativeReader<'_>,
    movement: u64,
    order: u64,
) -> Result<Value, ApiError> {
    let row = reader.read(MOVEMENT, movement).await?;
    if !enum_is(&row, "state", "state", "done")?
        || field(&row, "isDone", "is_done")?.as_bool() != Some(true)
        || field(&row, "scrapped", "scrapped")?.as_bool() != Some(false)
        || optional_id(&row, "productionId", "production_id")? != Some(order)
    {
        return Err(ApiError::Conflict(
            "The stock move is not a completed native effect of this manufacturing order".into(),
        ));
    }
    Ok(row)
}

async fn verify_lot(
    reader: &NativeReader<'_>,
    move_row: &Value,
    lot: u64,
) -> Result<u64, ApiError> {
    let record = reader.read(LOT, lot).await?;
    let product = id(&record, "productId", "product_id")?;
    if id(move_row, "productId", "product_id")? != product {
        return Err(ApiError::Conflict(
            "The completed move has a different lot product".into(),
        ));
    }
    Ok(product)
}

async fn verify_processing(
    reader: &NativeReader<'_>,
    order_id: u64,
    live_lot: u64,
    output_lot: u64,
    count: u64,
    sellable_kg: f64,
) -> Result<Value, ApiError> {
    if live_lot == output_lot {
        return Err(ApiError::BadRequest(
            "The live and output lots must be distinct".into(),
        ));
    }
    let order = reader.read(ORDER, order_id).await?;
    if !enum_is(&order, "state", "state", "Done")? {
        return Err(ApiError::Conflict(
            "Complete the native manufacturing order first".into(),
        ));
    }
    let live_product = id(
        &reader.read(LOT, live_lot).await?,
        "productId",
        "product_id",
    )?;
    let mut live_move = None;
    for move_id in found_ids(&order, "moveRawIds", "move_raw_ids")? {
        let row = verify_movement(reader, move_id, order_id).await?;
        if optional_id(&row, "lotId", "lot_id")? == Some(live_lot) {
            if live_move.is_some() {
                return Err(ApiError::Conflict(
                    "This workflow needs exactly one native move for the live flock lot".into(),
                ));
            }
            live_move = Some((move_id, row));
        } else if id(&row, "productId", "product_id")? == live_product {
            return Err(ApiError::Conflict(
                "A run that combines multiple live lots cannot be attributed to one farm batch"
                    .into(),
            ));
        }
    }
    let (input_id, input) = live_move.ok_or_else(|| {
        ApiError::Conflict(
            "No completed manufacturing consumption identifies the exact live flock lot".into(),
        )
    })?;
    verify_lot(reader, &input, live_lot).await?;
    let input_unit = reader
        .read(UNIT, id(&input, "productUom", "product_uom")?)
        .await?;
    let symbol = field(&input_unit, "symbol", "symbol")?
        .as_str()
        .ok_or_else(native_data_unavailable)?;
    if !matches!(
        symbol.to_ascii_lowercase().as_str(),
        "ea" | "u" | "unit" | "units" | "pc" | "pcs" | "head" | "piece" | "pieces"
    ) || field(&input_unit, "isReferenceUnit", "is_reference_unit")?.as_bool() != Some(true)
        || optional_id(
            &input,
            "rawMaterialProductionId",
            "raw_material_production_id",
        )? != Some(order_id)
        || count >= (1 << 53)
        || !same_quantity(
            number(&input, "quantityDone", "quantity_done")?,
            count as f64,
        )
    {
        return Err(ApiError::Conflict(
            "The completed live lot move must use a count unit and match the processing headcount"
                .into(),
        ));
    }

    let primary_product = id(&order, "productId", "product_id")?;
    let mut outputs = Vec::new();
    let mut found_primary = false;
    for move_id in found_ids(&order, "moveFinishedIds", "move_finished_ids")? {
        let row = verify_movement(reader, move_id, order_id).await?;
        let quantity = number(&row, "quantityDone", "quantity_done")?;
        let lot = optional_id(&row, "lotId", "lot_id")?;
        let product = id(&row, "productId", "product_id")?;
        let unit = id(&row, "productUom", "product_uom")?;
        if let Some(lot) = lot {
            verify_lot(reader, &row, lot).await?;
        }
        if lot == Some(output_lot) {
            let uom = reader.read(UNIT, unit).await?;
            if found_primary
                || product != primary_product
                || field(&uom, "symbol", "symbol")?
                    .as_str()
                    .is_none_or(|value| !value.eq_ignore_ascii_case("kg"))
                || !same_quantity(quantity, sellable_kg)
            {
                return Err(ApiError::Conflict(
                    "The primary finished move must identify the output lot and match the measured sellable kilograms".into(),
                ));
            }
            found_primary = true;
        }
        outputs.push(json!({
            "moveId": move_id.to_string(), "lotId": lot.map(|value| value.to_string()),
            "productId": product.to_string(), "quantity": quantity, "uomId": unit.to_string(),
        }));
    }
    if !found_primary {
        return Err(ApiError::Conflict(
            "No completed primary output identifies the selected lot".into(),
        ));
    }
    let date = native_date(field(&order, "dateFinished", "date_finished")?)
        .ok_or_else(native_data_unavailable)?;
    Ok(json!({"inputMoveId": input_id.to_string(), "outputs": outputs, "nativeFinishedDate": date}))
}

const PREPARED_ORDER: NativeResource = NativeResource {
    key: "mrp-productions",
    fields: &[
        "state",
        "metadata",
        "product_id",
        "product_qty",
        "product_uom_id",
        "qty_produced",
        "bom_id",
        "routing_id",
    ],
    company_scoped: true,
};

const BOM: NativeResource = NativeResource {
    key: "mrp-boms",
    fields: &[
        "bom_line_ids",
        "byproduct_ids",
        "routing_id",
        "operation_ids",
    ],
    company_scoped: true,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    company_id: NativeId,
    event_id: NativeId,
    manufacturing_order_id: NativeId,
    live_lot_id: NativeId,
    output_lot_id: NativeId,
    expected_event_revision: Option<i32>,
}

struct Binding {
    batch: i64,
    event: i64,
    revision: i32,
    order: u64,
    live_lot: u64,
    output_lot: u64,
    headcount: u32,
    sellable_kg: f64,
    business_date: String,
}

impl Binding {
    fn configuration(&self) -> Value {
        json!({
            "farmEventId": self.event.to_string(),
            "liveLotId": self.live_lot.to_string(),
            "outputLotId": self.output_lot.to_string(),
            "headcount": self.headcount,
        })
    }
}

pub(super) fn allows(reader: &NativeReader<'_>) -> bool {
    [ORDER, MOVEMENT, LOT, UNIT]
        .into_iter()
        .all(|source| reader.allows(source))
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/farm-batches/:id/processing-links", post(link_processing))
        .route("/farm-batches/:id/processing-runs", post(run_processing))
}

async fn link_processing(
    State(state): State<Arc<AppState>>,
    Path(batch): Path<i64>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<Input>,
) -> Result<Json<Value>, ApiError> {
    submit(&state, &session, batch, body, false).await
}

async fn run_processing(
    State(state): State<Arc<AppState>>,
    Path(batch): Path<i64>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<Input>,
) -> Result<Json<Value>, ApiError> {
    submit(&state, &session, batch, body, true).await
}

async fn submit(
    state: &AppState,
    session: &ApiSession,
    batch: i64,
    body: Input,
    execute: bool,
) -> Result<Json<Value>, ApiError> {
    let batch = checked_batch_id(batch)?;
    let company = body.company_id.positive()?;
    let scope = authorize(state, session, company, FarmAccess::Write).await?;
    let context = context(state, session, company)?;
    let event_id = i64::try_from(body.event_id.positive()?)
        .map_err(|_| ApiError::BadRequest("Invalid farm event ID".into()))?;
    let live_lot = body.live_lot_id.positive()?;
    let output_lot = body.output_lot_id.positive()?;
    if live_lot == output_lot {
        return Err(ApiError::BadRequest(
            "The live and output lots must be distinct".into(),
        ));
    }
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let connection = pool.get().await.map_err(ApiError::unavailable)?;
    let event = read_event(&connection, &scope, batch, event_id).await?;
    drop(connection);
    let EventKind::Processing {
        count,
        sellable_weight_kg: Some(sellable_kg),
        live_weight_kg,
    } = event.event.kind
    else {
        return Err(ApiError::Conflict(
            "Record a processing event with measured sellable weight before linking its native effects".into(),
        ));
    };
    if execute
        && (event.source.is_some()
            || live_weight_kg.is_none()
            || sellable_kg <= 0.0
            || body.expected_event_revision != Some(event.revision))
    {
        return Err(ApiError::Conflict(
            "Confirm the current manual processing event and both measured weights before applying stock effects".into(),
        ));
    }
    let binding = Binding {
        batch,
        event: event.id,
        revision: event.revision,
        order: body.manufacturing_order_id.positive()?,
        live_lot,
        output_lot,
        headcount: count,
        sellable_kg,
        business_date: event.event.business_date.to_string(),
    };
    let reader = NativeReader {
        context: &context,
        scope: &scope,
    };
    if execute {
        if !allows(&reader)
            || ![
                ("mrp_production", "write"),
                ("stock_move", "create"),
                ("stock_move", "write"),
            ]
            .iter()
            .all(|(resource, action)| {
                stdb_auth::permission_allowed(context.field_access(), resource, action)
            })
        {
            return Err(ApiError::Forbidden(
                "Manufacturing and stock move access is required".into(),
            ));
        }
        preflight_native_order(&reader, &binding).await?;
        context.require_current_placement(&state.organization_placements)?;
        let mut connection = pool.get().await.map_err(ApiError::unavailable)?;
        let tx = connection.transaction().await.map_err(ApiError::internal)?;
        bind(&tx, &scope, &binding, None).await?;
        tx.commit().await.map_err(ApiError::internal)?;
        finish_native_order(state, session, &reader, &binding).await?;
    }
    let mut evidence = verify_processing(
        &reader,
        binding.order,
        live_lot,
        output_lot,
        u64::from(count),
        sellable_kg,
    )
    .await?;
    evidence["businessDate"] = json!(binding.business_date);
    context.require_current_placement(&state.organization_placements)?;
    let mut connection = pool.get().await.map_err(ApiError::unavailable)?;
    let tx = connection.transaction().await.map_err(ApiError::internal)?;
    let saved = bind(&tx, &scope, &binding, Some(evidence)).await?;
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(json!({"data": saved})))
}

async fn bind(
    tx: &Transaction<'_>,
    scope: &FarmScope,
    binding: &Binding,
    evidence: Option<Value>,
) -> Result<Value, ApiError> {
    lock_batch(tx, scope, binding.batch).await?;
    let current = read_event(tx, scope, binding.batch, binding.event).await?;
    if current.revision != binding.revision {
        return Err(ApiError::Conflict(
            "The processing event changed. Review the current version.".into(),
        ));
    }
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let order = binding.order.to_string();
    let live_lot = binding.live_lot.to_string();
    let output_lot = binding.output_lot.to_string();
    tx.execute(
        "INSERT INTO lumiere_platform.farm_live_lot_link
        (organization_id, company_id, live_lot_id, batch_id)
        VALUES ($1::text::numeric, $2::text::numeric, $3::text::numeric, $4)
        ON CONFLICT DO NOTHING",
        &[&org, &company, &live_lot, &binding.batch],
    )
    .await
    .map_err(ApiError::internal)?;
    let lot_owner: i64 = tx.query_one("SELECT batch_id FROM lumiere_platform.farm_live_lot_link
        WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND live_lot_id=$3::text::numeric",
        &[&org, &company, &live_lot],
    ).await.map_err(ApiError::internal)?.get(0);
    if lot_owner != binding.batch {
        return Err(ApiError::Conflict(
            "The live stock lot already belongs to another farm batch".into(),
        ));
    }
    tx.execute("INSERT INTO lumiere_platform.farm_processing_link
        (organization_id, company_id, batch_id, event_id, event_revision, manufacturing_order_id, live_lot_id, output_lot_id, evidence, linked_by)
        VALUES ($1::text::numeric, $2::text::numeric, $3, $4, $5, $6::text::numeric, $7::text::numeric, $8::text::numeric, $9, $10)
        ON CONFLICT DO NOTHING",
        &[&org, &company, &binding.batch, &binding.event, &binding.revision, &order, &live_lot, &output_lot, &evidence, &scope.actor],
    ).await.map_err(ApiError::internal)?;
    if let Some(proof) = &evidence {
        tx.execute("UPDATE lumiere_platform.farm_processing_link SET evidence=$9
            WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND batch_id=$3 AND event_id=$4
            AND event_revision=$5 AND manufacturing_order_id=$6::text::numeric AND live_lot_id=$7::text::numeric
            AND output_lot_id=$8::text::numeric AND evidence IS NULL",
            &[&org, &company, &binding.batch, &binding.event, &binding.revision, &order, &live_lot, &output_lot, proof],
        ).await.map_err(ApiError::internal)?;
    }
    let stored = tx.query_opt("SELECT event_id, manufacturing_order_id::text, live_lot_id::text,
        output_lot_id::text, evidence, linked_at::text FROM lumiere_platform.farm_processing_link
        WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND batch_id=$3 AND event_id=$4
        AND event_revision=$5 AND manufacturing_order_id=$6::text::numeric AND live_lot_id=$7::text::numeric
        AND output_lot_id=$8::text::numeric",
        &[&org, &company, &binding.batch, &binding.event, &binding.revision, &order, &live_lot, &output_lot],
    ).await.map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::Conflict("This event, order or output lot already has a different binding".into()))?;
    if evidence.is_some() && stored.get::<_, Option<Value>>("evidence") != evidence {
        return Err(ApiError::Conflict(
            "The linked processing evidence changed".into(),
        ));
    }
    Ok(row(&stored))
}

fn order_metadata(order: &Value) -> Result<Value, ApiError> {
    let value = field(order, "metadata", "metadata")?;
    if value.is_null() {
        return Ok(json!({}));
    }
    value
        .as_str()
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .filter(Value::is_object)
        .ok_or_else(|| {
            ApiError::Conflict("Choose a manufacturing order with compatible JSON metadata.".into())
        })
}

async fn preflight_native_order(
    reader: &NativeReader<'_>,
    binding: &Binding,
) -> Result<(), ApiError> {
    let order = reader.read(PREPARED_ORDER, binding.order).await?;
    let metadata = order_metadata(&order)?;
    if metadata
        .get(FARM_CONFIG)
        .is_some_and(|config| config != &binding.configuration())
        || (!enum_is(&order, "state", "state", "Draft")? && metadata.get(FARM_CONFIG).is_none())
    {
        return Err(ApiError::Conflict(
            "Choose a Draft order or resume the exact previously prepared order.".into(),
        ));
    }
    if enum_is(&order, "state", "state", "Cancelled")? {
        return Err(ApiError::Conflict(
            "The linked native order was cancelled.".into(),
        ));
    }
    let unit = reader
        .read(UNIT, id(&order, "productUomId", "product_uom_id")?)
        .await?;
    let output = reader.read(LOT, binding.output_lot).await?;
    let live_lot = reader.read(LOT, binding.live_lot).await?;
    let product = id(&order, "productId", "product_id")?;
    let bom = reader.read(BOM, id(&order, "bomId", "bom_id")?).await?;
    if !same_quantity(
        number(&order, "productQty", "product_qty")?,
        binding.sellable_kg,
    ) || field(&unit, "symbol", "symbol")?
        .as_str()
        .is_none_or(|v| !v.eq_ignore_ascii_case("kg"))
        || id(&output, "productId", "product_id")? != product
        || id(&live_lot, "productId", "product_id")? == product
        || optional_id(&order, "routingId", "routing_id")?.is_some()
        || optional_id(&bom, "routingId", "routing_id")?.is_some()
        || !found_ids(&bom, "operationIds", "operation_ids")?.is_empty()
        || !found_ids(&bom, "byproductIds", "byproduct_ids")?.is_empty()
        || found_ids(&bom, "bomLineIds", "bom_line_ids")?.len() != 1
    {
        return Err(ApiError::Conflict(
            "Farm processing needs matching planned kilograms, a live and finished lot, and a single-component BOM without routing or byproducts.".into(),
        ));
    }
    Ok(())
}

async fn finish_native_order(
    state: &AppState,
    session: &ApiSession,
    reader: &NativeReader<'_>,
    binding: &Binding,
) -> Result<(), ApiError> {
    let scope = reader.scope;
    let approved = binding.configuration();
    for _ in 0..5 {
        let order = reader.read(PREPARED_ORDER, binding.order).await?;
        let mut metadata = order_metadata(&order)?;
        let status =
            super::tagged(field(&order, "state", "state")?).ok_or_else(native_data_unavailable)?;
        if status.eq_ignore_ascii_case("Draft") {
            if metadata
                .get(FARM_CONFIG)
                .is_some_and(|prior| prior != &approved)
            {
                return Err(ApiError::Conflict(
                    "The processing authorization changed on the Draft order.".into(),
                ));
            }
            if metadata.get(FARM_CONFIG).is_none() {
                metadata[FARM_CONFIG] = approved.clone();
                let none = json!({"none":[]});
                dispatch_session_reducer(state, session, "update_manufacturing_order", json!([
                    scope.organization, scope.company, binding.order, {
                        "product_qty": none, "date_planned_start": none, "date_planned_finished": none,
                        "date_deadline": none, "origin": none,
                        "metadata": {"some":{"some":metadata.to_string()}},
                    }
                ])).await?;
            }
            dispatch_session_reducer(
                state,
                session,
                "confirm_manufacturing_order",
                json!([scope.organization, scope.company, binding.order]),
            )
            .await?;
            continue;
        }
        if metadata.get(FARM_CONFIG) != Some(&approved) {
            return Err(ApiError::Conflict(
                "The native order is not bound to this processing event and lot pair.".into(),
            ));
        }
        match status.to_ascii_lowercase().as_str() {
            "confirmed" | "planned" => {
                dispatch_session_reducer(
                    state,
                    session,
                    "start_manufacturing_order",
                    json!([scope.organization, scope.company, binding.order]),
                )
                .await?;
            }
            "progress" if number(&order, "qtyProduced", "qty_produced")? == 0.0 => {
                dispatch_session_reducer(
                    state,
                    session,
                    "produce_manufacturing_order",
                    json!([
                        scope.organization,
                        scope.company,
                        binding.order,
                        binding.sellable_kg
                    ]),
                )
                .await?;
            }
            "toclose" | "to_close" => {
                dispatch_session_reducer(state, session, "finish_manufacturing_order_with_tracking",
                    json!([scope.organization, scope.company, binding.order, {
                        "lot_id": {"some": binding.output_lot}, "serial_id": {"none": []}, "byproducts": [],
                    }])).await?;
            }
            "done" => return Ok(()),
            _ => {
                return Err(ApiError::Conflict(
                    "The native order is in a state that requires review.".into(),
                ))
            }
        }
    }
    Err(ApiError::Conflict(
        "Check the native order outcome and resume this exact run.".into(),
    ))
}

pub(super) fn row(row: &tokio_postgres::Row) -> Value {
    let saved = row.get::<_, Option<Value>>("evidence");
    let mut evidence = saved.unwrap_or_else(|| json!({"status":"pending","outputs":[]}));
    if evidence.get("status").is_none() {
        evidence["status"] = json!("verified");
    }
    evidence["eventId"] = json!(row.get::<_, i64>("event_id").to_string());
    evidence["manufacturingOrderId"] = json!(row.get::<_, String>("manufacturing_order_id"));
    evidence["liveLotId"] = json!(row.get::<_, String>("live_lot_id"));
    evidence["outputLotId"] = json!(row.get::<_, String>("output_lot_id"));
    evidence["linkedAt"] = json!(row.get::<_, String>("linked_at"));
    evidence
}
