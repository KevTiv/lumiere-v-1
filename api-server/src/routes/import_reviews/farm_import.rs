//! Apply explicitly reviewed historical facts through the Farm Batches owner.

#[cfg(test)]
mod tests;

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::NaiveDate;
use deadpool_postgres::Transaction;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{
    model::{decimal, ReviewItem},
    scope, StorageScope,
};
use crate::{
    cold_tier::pg_pool,
    error::ApiError,
    routes::farm_batches::{
        authorize, ensure_import_batch, find_batch_by_reference, find_event_by_request,
        list_events,
        native_links::{persist_cost, preview_cost, CostKind, PreparedCost},
        persist_event, read_event, validate_timeline, BatchInput, EventInput, EventKind,
        EventSource, FarmAccess, FarmScope,
    },
    session::ApiSession,
    state::AppState,
    web_session::OrgSession,
};

const SCALE: i128 = 1_000_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct WriteBody {
    company_id: u64,
    rows: Vec<Selection>,
    preview: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Selection {
    item_id: String,
    revision: i32,
    expected_digest: Option<String>,
}

struct Candidate {
    reference: String,
    source_column: i32,
    request_key: String,
    date: NaiveDate,
    intake: Option<BatchInput>,
    effect: Effect,
    source: EventSource,
    digest: String,
}

#[derive(Serialize)]
enum Effect {
    Event(EventInput),
    Cost(CostEffect),
}

#[derive(Serialize)]
struct CostEffect {
    line: u64,
    kind: CostKind,
    report: Option<u64>,
    basis: String,
}

struct PreviewBatch {
    batch_id: Option<i64>,
    start: NaiveDate,
    events: Vec<EventInput>,
    selected_requests: BTreeSet<String>,
}

fn digest(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

fn review_facts(
    values: &BTreeMap<String, Option<String>>,
    confirmed: &BTreeSet<String>,
    source: EventSource,
    source_column: i32,
) -> Result<Candidate, String> {
    let get = |key: &str| {
        confirmed
            .contains(key)
            .then(|| values.get(key)?.as_deref().map(str::trim))
            .flatten()
            .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("unknown"))
    };
    let required = |key: &str, label: &str| get(key).ok_or_else(|| format!("Confirm {label}."));
    let count = |key: &str, label: &str| {
        let value = required(key, label)?;
        decimal(value)
            .filter(|count| count % SCALE == 0)
            .and_then(|count| u32::try_from(count / SCALE).ok())
            .filter(|count| *count > 0)
            .ok_or_else(|| format!("{label} must be a positive whole count."))
    };
    let weight =
        |key: &str, label: &str, required: bool, minimum: i128| -> Result<Option<f64>, String> {
            let Some(value) = get(key) else {
                return if required {
                    Err(format!("Confirm {label}."))
                } else {
                    Ok(None)
                };
            };
            decimal(value)
                .filter(|amount| *amount >= minimum)
                .map(|amount| Some(amount as f64 / SCALE as f64))
                .ok_or_else(|| format!("{label} must be valid in kilograms."))
        };
    let reference = required("flock_reference", "the flock reference")?;
    let event_ref = required("event_reference", "a stable event reference")?;
    if reference.len() > 128
        || event_ref.len() > 160
        || reference.chars().any(char::is_control)
        || event_ref.chars().any(char::is_control)
    {
        return Err("Use bounded flock and event references without control characters.".into());
    }
    let business_date = required("business_date", "the business date")?;
    let date = super::history_period::calendar_date(business_date)?;
    let kind = required("event_kind", "the event type")?;
    let effect = if kind == "costLink" {
        let id = |value: &str| {
            value
                .parse::<u64>()
                .ok()
                .filter(|id| *id > 0 && id.to_string() == value)
                .ok_or_else(|| "Use exact positive decimal ERP record IDs.".to_owned())
        };
        Effect::Cost(CostEffect {
            line: id(required("journal_line_id", "the posted journal line ID")?)?,
            kind: serde_json::from_value(json!(required("cost_kind", "the cost source type")?))
                .map_err(|_| "Select a supported cost source type.".to_owned())?,
            report: get("expense_report_id").map(id).transpose()?,
            basis: required("allocation_basis", "the cost allocation basis")?.into(),
        })
    } else {
        Effect::Event(review_event(kind, business_date, required, count, weight)?)
    };
    let intake = if kind == "intake" {
        Some(
            serde_json::from_value::<BatchInput>(json!({
                "reference": reference,
                "species": required("species", "the species")?,
                "location": required("location", "the farm or house")?,
                "startDate": business_date,
            }))
            .map_err(|_| "The confirmed values do not match the flock contract.".to_owned())?,
        )
    } else {
        None
    };
    // A source producer should retain the same event reference across exports.
    // Length-delimited JSON prevents collisions at the flock/event separator.
    let identity = serde_json::to_vec(&(reference.to_lowercase(), event_ref))
        .map_err(|error| error.to_string())?;
    let request_key = format!("farm-import:{}", digest(&identity));
    let approval = serde_json::to_vec(&(&source, source_column, &request_key, &effect, &intake))
        .map_err(|error| error.to_string())?;
    Ok(Candidate {
        reference: reference.into(),
        source_column,
        request_key,
        date,
        intake,
        effect,
        source,
        digest: digest(&approval),
    })
}

fn review_event<'a>(
    kind: &str,
    business_date: &str,
    required: impl Fn(&str, &str) -> Result<&'a str, String>,
    count: impl Fn(&str, &str) -> Result<u32, String>,
    weight: impl Fn(&str, &str, bool, i128) -> Result<Option<f64>, String>,
) -> Result<EventInput, String> {
    let mut fields = match kind {
        "intake" | "mortality" | "transferIn" | "transferOut" | "internalTransfer" | "liveSale" => {
            json!({"count": count("count", "Headcount")?})
        }
        "weighIn" => json!({
            "sampleCount": count("sample_count", "Sample count")?,
            "totalWeightKg": weight("total_weight_kg", "Sample weight", true, 1)?,
        }),
        "feedUsage" => json!({
            "feedProduct": required("feed_product", "the feed product")?,
            "quantityKg": weight("quantity_kg", "Feed consumed", true, 1)?,
        }),
        "processing" => json!({
            "count": count("count", "Headcount")?,
            "liveWeightKg": weight("live_weight_kg", "Live input weight", false, 1)?,
            "sellableWeightKg": weight("sellable_weight_kg", "Sellable weight", false, 0)?,
        }),
        "feedCoverage" => json!({
            "fromExclusive": required("from_exclusive", "the exclusive start date of complete feed records")?,
        }),
        _ => return Err("Select a supported farm event type.".into()),
    };
    fields["kind"] = json!(kind);
    fields["businessDate"] = json!(business_date);
    serde_json::from_value(fields)
        .map_err(|_| "The confirmed values do not match the farm event contract.".to_owned())
}

fn row_result(candidate: &Candidate, status: &str, reason: &str) -> Value {
    json!({"itemId":candidate.source.review_item_id.to_string(),"status":status,"reason":reason})
}

fn saved_result(candidate: &Candidate, status: &str, batch_id: i64, event_id: i64) -> Value {
    json!({
        "itemId":candidate.source.review_item_id.to_string(),
        "status":status,
        "batchId":batch_id.to_string(),
        "eventId":event_id.to_string(),
    })
}

fn proposed_result(
    candidate: &Candidate,
    event: &EventInput,
    batch_id: Option<i64>,
    event_id: Option<i64>,
) -> Value {
    json!({
        "itemId":candidate.source.review_item_id.to_string(),
        "status":"ready",
        "flockReference":candidate.reference,
        "batchId":batch_id.map(|id| id.to_string()),
        "existingEventId":event_id.map(|id| id.to_string()),
        "effect":event,
        "digest":candidate.digest,
    })
}

fn event_order(effect: &Effect) -> u8 {
    let Effect::Event(event) = effect else {
        return 4;
    };
    match &event.kind {
        EventKind::Intake { .. } => 0,
        EventKind::TransferIn { .. } => 1,
        EventKind::Mortality { .. }
        | EventKind::TransferOut { .. }
        | EventKind::LiveSale { .. }
        | EventKind::Processing { .. } => 3,
        _ => 2,
    }
}

fn require_batch_match(existing: &BatchInput, intake: &BatchInput) -> Result<(), ApiError> {
    if existing.reference.to_lowercase() != intake.reference.to_lowercase()
        || existing.species != intake.species
        || existing.location != intake.location
        || existing.start_date != intake.start_date
    {
        return Err(ApiError::Conflict(
            "The intake details differ from this flock. Review the existing flock before applying."
                .into(),
        ));
    }
    Ok(())
}

async fn require_origin_available(
    tx: &Transaction<'_>,
    farm: &FarmScope,
    candidate: &Candidate,
) -> Result<(), ApiError> {
    let source = &candidate.source;
    let row = i32::try_from(source.row).map_err(ApiError::internal)?;
    let journal_line = match &candidate.effect {
        Effect::Event(_) => None,
        Effect::Cost(cost) => Some(cost.line.to_string()),
    };
    let conflict = tx
        .query_one(
            "SELECT EXISTS (
            SELECT 1 FROM lumiere_platform.farm_import_event receipt
            WHERE receipt.organization_id=$1::text::numeric AND receipt.company_id=$2::text::numeric
              AND (receipt.review_item_id=$3 OR receipt.request_key=$8 OR (
                receipt.source_sha256=$4 AND receipt.source_sheet=$5
                AND receipt.source_row=$6 AND receipt.source_column=$7
              ))
              AND (receipt.request_key <> $8 OR receipt.journal_line_id IS DISTINCT FROM $9::text::numeric)
         )",
            &[
                &farm.organization.to_string(),
                &farm.company.to_string(),
                &source.review_item_id,
                &source.sha256,
                &source.sheet.as_deref().unwrap_or_default(),
                &row,
                &candidate.source_column,
                &candidate.request_key,
                &journal_line,
            ],
        )
        .await
        .map_err(ApiError::internal)?
        .get::<_, bool>(0);
    if conflict {
        return Err(ApiError::Conflict(
            "This source row already produced a different event. Open the saved event to correct it.".into(),
        ));
    }
    Ok(())
}

async fn bind_verified_result(
    tx: &Transaction<'_>,
    farm: &FarmScope,
    candidate: &Candidate,
    batch_id: i64,
    event_id: Option<i64>,
    journal_line_id: Option<u64>,
) -> Result<(), ApiError> {
    let source = &candidate.source;
    let row = i32::try_from(source.row).map_err(ApiError::internal)?;
    let line = journal_line_id.map(|id| id.to_string());
    tx.execute(
        "INSERT INTO lumiere_platform.farm_import_event
         (organization_id,company_id,review_batch_id,review_item_id,review_revision,source_sha256,
            source_sheet,source_row,source_column,request_key,farm_batch_id,farm_event_id,journal_line_id)
         VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text::numeric)
         ON CONFLICT (organization_id,company_id,review_item_id) DO NOTHING",
        &[
            &farm.organization.to_string(),
            &farm.company.to_string(),
            &source.review_batch_id,
            &source.review_item_id,
            &source.revision,
            &source.sha256,
            &source.sheet.as_deref().unwrap_or_default(),
            &row,
            &candidate.source_column,
            &candidate.request_key,
            &batch_id,
            &event_id,
            &line,
        ],
    )
    .await
    .map_err(ApiError::internal)?;
    Ok(())
}

async fn existing_event(
    tx: &Transaction<'_>,
    farm: &FarmScope,
    batch_id: i64,
    candidate: &Candidate,
    event: &EventInput,
) -> Result<Option<i64>, ApiError> {
    let Some(previous) = find_event_by_request(tx, farm, batch_id, &candidate.request_key).await?
    else {
        return Ok(None);
    };
    let current = read_event(tx, farm, batch_id, previous.id).await?;
    if previous.event != *event || current.event != *event {
        return Err(ApiError::Conflict(
            "This event reference already exists with different values. Review the saved event and correct it in Farm Batches.".into(),
        ));
    }
    Ok(Some(previous.id))
}

async fn preview(
    tx: &Transaction<'_>,
    farm: &FarmScope,
    can_create: bool,
    candidate: &Candidate,
    batches: &mut BTreeMap<String, PreviewBatch>,
) -> Result<Value, ApiError> {
    let Effect::Event(proposed) = &candidate.effect else {
        return Err(ApiError::Internal("Farm event expected".into()));
    };
    let found = find_batch_by_reference(tx, farm, &candidate.reference).await?;
    if let Some(batch) = &found {
        if let Some(intake) = &candidate.intake {
            require_batch_match(&batch.input, intake)?;
        }
        if let Some(event) = existing_event(tx, farm, batch.id, candidate, proposed).await? {
            let already_bound = tx
                .query_one(
                    "SELECT EXISTS (SELECT 1 FROM lumiere_platform.farm_import_event
                    WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric
                    AND review_item_id=$3 AND farm_batch_id=$4 AND farm_event_id=$5)",
                    &[
                        &farm.organization.to_string(),
                        &farm.company.to_string(),
                        &candidate.source.review_item_id,
                        &batch.id,
                        &event,
                    ],
                )
                .await
                .map_err(ApiError::internal)?
                .get::<_, bool>(0);
            return Ok(if already_bound {
                saved_result(candidate, "matched", batch.id, event)
            } else {
                proposed_result(candidate, proposed, Some(batch.id), Some(event))
            });
        }
    }
    let folded_reference = candidate.reference.to_lowercase();
    if !batches.contains_key(&folded_reference) {
        let (batch_id, start, events) = match found {
            Some(batch) => {
                let stored = list_events(tx, farm, batch.id).await?;
                (
                    Some(batch.id),
                    batch.input.start_date,
                    stored.into_iter().map(|row| row.event).collect(),
                )
            }
            None => {
                let intake = candidate.intake.as_ref().ok_or_else(|| {
                    ApiError::BadRequest("Create or import the flock intake first.".into())
                })?;
                if !can_create {
                    return Err(ApiError::Forbidden(
                        "Creating this flock requires farm batch creation access.".into(),
                    ));
                }
                (None, intake.start_date, Vec::new())
            }
        };
        batches.insert(
            folded_reference.clone(),
            PreviewBatch {
                batch_id,
                start,
                events,
                selected_requests: BTreeSet::new(),
            },
        );
    }
    let staged = batches
        .get_mut(&folded_reference)
        .expect("preview batch exists");
    if staged.selected_requests.contains(&candidate.request_key) {
        return Err(ApiError::Conflict(
            "One preview row already uses this event reference.".into(),
        ));
    }
    staged.events.push(proposed.clone());
    if let Err(error) = validate_timeline(staged.start, &staged.events) {
        staged.events.pop();
        if staged.batch_id.is_none() && staged.events.is_empty() {
            batches.remove(&folded_reference);
        }
        return Err(error);
    }
    staged
        .selected_requests
        .insert(candidate.request_key.clone());
    Ok(proposed_result(candidate, proposed, staged.batch_id, None))
}

async fn apply(
    tx: &Transaction<'_>,
    farm: &FarmScope,
    can_create: bool,
    candidate: &Candidate,
) -> Result<Value, ApiError> {
    let Effect::Event(proposed) = &candidate.effect else {
        return Err(ApiError::Internal("Farm event expected".into()));
    };
    let batch = match find_batch_by_reference(tx, farm, &candidate.reference).await? {
        Some(found) => {
            if let Some(intake) = &candidate.intake {
                require_batch_match(&found.input, intake)?;
            }
            found
        }
        None => {
            let intake = candidate.intake.as_ref().ok_or_else(|| {
                ApiError::BadRequest("Create or import the flock intake first.".into())
            })?;
            if !can_create {
                return Err(ApiError::Forbidden(
                    "Creating this flock requires farm batch creation access.".into(),
                ));
            }
            let key = format!(
                "farm-import-flock:{}",
                digest(candidate.reference.to_lowercase().as_bytes())
            );
            let created = ensure_import_batch(tx, farm, &key, intake).await?;
            require_batch_match(&created.input, intake)?;
            created
        }
    };
    if let Some(event) = existing_event(tx, farm, batch.id, candidate, proposed).await? {
        bind_verified_result(tx, farm, candidate, batch.id, Some(event), None).await?;
        return Ok(saved_result(candidate, "matched", batch.id, event));
    }
    let receipt = persist_event(
        tx,
        farm,
        batch.id,
        &candidate.request_key,
        None,
        proposed,
        Some(&candidate.source),
    )
    .await?;
    let saved = read_event(tx, farm, batch.id, receipt.id).await?;
    if saved.id != receipt.id || saved.event != *proposed || saved.revision != receipt.revision {
        return Err(ApiError::Conflict(
            "The saved event differs from the reviewed values.".into(),
        ));
    }
    bind_verified_result(tx, farm, candidate, batch.id, Some(saved.id), None).await?;
    Ok(saved_result(candidate, "saved", batch.id, saved.id))
}

fn row_failure(candidate: &Candidate, error: ApiError) -> Result<Value, ApiError> {
    match error {
        ApiError::BadRequest(reason)
        | ApiError::Unprocessable(reason)
        | ApiError::Forbidden(reason)
        | ApiError::NotFound(reason) => Ok(row_result(candidate, "held", &reason)),
        ApiError::Conflict(reason) => Ok(row_result(candidate, "conflict", &reason)),
        error => Err(error),
    }
}

async fn prepare_cost(
    state: &AppState,
    session: &ApiSession,
    farm: &FarmScope,
    candidate: &Candidate,
    cost: &CostEffect,
) -> Result<(PreparedCost, String), ApiError> {
    let prepared = preview_cost(
        state,
        session,
        farm,
        cost.line,
        cost.kind,
        cost.report,
        &cost.basis,
    )
    .await?;
    if prepared.proof["businessDate"].as_str() != Some(candidate.date.to_string().as_str()) {
        return Err(ApiError::Conflict(
            "The reviewed business date differs from the posted journal date.".into(),
        ));
    }
    let proof =
        serde_json::to_vec(&(&candidate.digest, &prepared.proof)).map_err(ApiError::internal)?;
    Ok((prepared, digest(&proof)))
}

async fn existing_cost(
    tx: &Transaction<'_>,
    farm: &FarmScope,
    candidate: &Candidate,
    cost: &CostEffect,
    batch_id: Option<i64>,
    prepared: &PreparedCost,
) -> Result<Option<bool>, ApiError> {
    let row = tx
        .query_opt(
            "SELECT cost.batch_id, cost.source, EXISTS (
            SELECT 1 FROM lumiere_platform.farm_import_event receipt
            WHERE (receipt.organization_id,receipt.company_id,receipt.journal_line_id)
                = (cost.organization_id,cost.company_id,cost.journal_line_id)
              AND receipt.review_item_id=$4) AS already_bound
         FROM lumiere_platform.farm_cost_link cost
         WHERE cost.organization_id=$1::text::numeric AND cost.company_id=$2::text::numeric
           AND cost.journal_line_id=$3::text::numeric",
            &[
                &farm.organization.to_string(),
                &farm.company.to_string(),
                &cost.line.to_string(),
                &candidate.source.review_item_id,
            ],
        )
        .await
        .map_err(ApiError::internal)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let source: Value = row.get("source");
    if Some(row.get("batch_id")) != batch_id
        || ["kind", "expenseReportId", "allocationBasis"]
            .iter()
            .any(|field| source[*field] != prepared.proof[*field])
    {
        return Err(ApiError::Conflict(
            "This journal line already has a different farm allocation.".into(),
        ));
    }
    Ok(Some(row.get("already_bound")))
}

fn cost_result(candidate: &Candidate, batch_id: i64, line: u64, status: &str) -> Value {
    json!({
        "itemId":candidate.source.review_item_id.to_string(),
        "status":status,
        "batchId":batch_id.to_string(),
        "journalLineId":line.to_string(),
    })
}

async fn preview_cost_effect(
    tx: &Transaction<'_>,
    farm: &FarmScope,
    candidate: &Candidate,
    cost: &CostEffect,
    prepared: &PreparedCost,
    proof_digest: &str,
    batches: &BTreeMap<String, PreviewBatch>,
) -> Result<Value, ApiError> {
    let found = find_batch_by_reference(tx, farm, &candidate.reference).await?;
    let batch_id = found.as_ref().map(|batch| batch.id);
    if batch_id.is_none() && !batches.contains_key(&candidate.reference.to_lowercase()) {
        return Err(ApiError::BadRequest(
            "Create or import the flock intake first.".into(),
        ));
    }
    let found_cost = existing_cost(tx, farm, candidate, cost, batch_id, prepared).await?;
    if let (Some(true), Some(id)) = (found_cost, batch_id) {
        return Ok(cost_result(candidate, id, cost.line, "matched"));
    }
    Ok(json!({
        "itemId":candidate.source.review_item_id.to_string(),
        "status":"ready",
        "flockReference":candidate.reference,
        "batchId":batch_id.map(|id| id.to_string()),
        "effect":{"kind":"costLink","businessDate":candidate.date.to_string(),"cost":prepared.proof},
        "digest":proof_digest,
    }))
}

async fn apply_cost(
    tx: &Transaction<'_>,
    farm: &FarmScope,
    candidate: &Candidate,
    cost: &CostEffect,
    prepared: &PreparedCost,
) -> Result<Value, ApiError> {
    let batch = find_batch_by_reference(tx, farm, &candidate.reference)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Create or import the flock intake first.".into()))?;
    let current = existing_cost(tx, farm, candidate, cost, Some(batch.id), prepared).await?;
    let receipt = persist_cost(tx, farm, batch.id, prepared).await?;
    if receipt["status"] != "verified" || receipt["journalLineId"] != cost.line.to_string() {
        return Err(ApiError::Conflict(
            "The saved cost link differs from the reviewed journal line.".into(),
        ));
    }
    bind_verified_result(tx, farm, candidate, batch.id, None, Some(cost.line)).await?;
    Ok(cost_result(
        candidate,
        batch.id,
        cost.line,
        if current.is_some() {
            "matched"
        } else {
            "saved"
        },
    ))
}

pub(super) async fn write(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(batch): Path<i64>,
    Json(body): Json<WriteBody>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, body.company_id).await?;
    let farm = authorize(&state, &session, body.company_id, FarmAccess::Write).await?;
    if batch <= 0 || body.rows.is_empty() || body.rows.len() > 200 {
        return Err(ApiError::BadRequest(
            "Select 1–200 reviewed farm rows.".into(),
        ));
    }
    let mut selections = BTreeMap::new();
    for selection in &body.rows {
        let id =
            selection.item_id.parse::<i64>().ok().filter(|id| {
                *id > 0 && id.to_string() == selection.item_id && selection.revision > 0
            });
        let Some(id) = id else {
            return Err(ApiError::BadRequest(
                "Invalid farm review row or revision.".into(),
            ));
        };
        if selections.insert(id, selection).is_some() {
            return Err(ApiError::BadRequest("Duplicate farm review rows.".into()));
        }
    }

    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let mut tx = client.transaction().await.map_err(ApiError::internal)?;
    let org = context.organization_id().to_string();
    let company = body.company_id.to_string();
    let ids: Vec<_> = selections.keys().copied().collect();
    let rows = tx.query(
        "SELECT item.id,item.revision,item.state,item.source_json,item.proposed_json,item.confirmed_fields
         FROM lumiere_platform.import_review_item item JOIN lumiere_platform.import_review_batch batch
           ON (batch.organization_id,batch.company_id,batch.id)
            = (item.organization_id,item.company_id,item.batch_id)
         WHERE item.organization_id=$1::text::numeric AND item.company_id=$2::text::numeric
           AND item.batch_id=$3 AND item.id=ANY($4::bigint[]) AND batch.target_entity='farm_event'
           AND EXISTS (
             SELECT 1 FROM lumiere_platform.import_task_review link
               JOIN lumiere_platform.import_task task USING
                 (organization_id,company_id,actor_identity,request_id)
               JOIN lumiere_platform.import_task_source source
                 ON (source.organization_id,source.company_id,source.actor_identity,source.request_id)
                  = (link.organization_id,link.company_id,link.actor_identity,link.request_id)
             WHERE (link.organization_id,link.company_id,link.batch_id)
                 = (item.organization_id,item.company_id,item.batch_id)
               AND NOT link.from_inspection
               AND task.approved_mode='prepare_import' AND task.state='needs_review'
               AND source.file_name=item.source_json->'source'->>'file'
               AND source.source_sha256=item.source_json->'source'->>'sha256'
           )
         ORDER BY item.id FOR SHARE OF item",
        &[&org, &company, &batch, &ids],
    ).await.map_err(ApiError::internal)?;
    if rows.len() != ids.len() {
        return Err(ApiError::Conflict(
            "Rows must belong to this prepared farm import source.".into(),
        ));
    }

    let mut candidates = Vec::with_capacity(rows.len());
    let mut results = Vec::with_capacity(rows.len());
    for row in rows {
        let id: i64 = row.get("id");
        let revision: i32 = row.get("revision");
        let selection = selections[&id];
        if revision != selection.revision || row.get::<_, &str>("state") != "confirmed" {
            results.push(json!({"itemId":id.to_string(),"status":"held","reason":"Confirm the current source review before applying this row."}));
            continue;
        }
        let original: ReviewItem =
            serde_json::from_value(row.get("source_json")).map_err(ApiError::internal)?;
        let Some(source_column) = original
            .fields
            .iter()
            .find(|field| field.key == "event_reference")
            .and_then(|field| field.source_column)
            .map(i32::from)
        else {
            results.push(json!({"itemId":id.to_string(),"status":"held","reason":"Prepare this row from its original source with a mapped event reference column."}));
            continue;
        };
        let values =
            serde_json::from_value(row.get("proposed_json")).map_err(ApiError::internal)?;
        let confirmed =
            serde_json::from_value(row.get("confirmed_fields")).map_err(ApiError::internal)?;
        let source = EventSource {
            file: original.source.file,
            sha256: original.source.sha256,
            sheet: original.source.sheet,
            row: original.source.row,
            review_batch_id: batch,
            review_item_id: id,
            revision,
        };
        match review_facts(&values, &confirmed, source, source_column) {
            Ok(candidate) => candidates.push(candidate),
            Err(reason) => {
                results.push(json!({"itemId":id.to_string(),"status":"held","reason":reason}))
            }
        }
    }
    candidates.sort_by(|left, right| {
        (
            left.reference.to_lowercase(),
            left.date,
            event_order(&left.effect),
            left.source.review_item_id,
        )
            .cmp(&(
                right.reference.to_lowercase(),
                right.date,
                event_order(&right.effect),
                right.source.review_item_id,
            ))
    });
    let can_create = if candidates
        .iter()
        .any(|candidate| candidate.intake.is_some())
    {
        match authorize(&state, &session, body.company_id, FarmAccess::Create).await {
            Ok(_) => true,
            Err(ApiError::Forbidden(_)) => false,
            Err(error) => return Err(error),
        }
    } else {
        false
    };
    let mut batches = BTreeMap::new();
    if !body.preview && !candidates.is_empty() {
        // Serialize imports within the company while the same transaction
        // guards exact original coordinates and native writes.
        let lock_scope = format!("farm-import:{org}");
        tx.query_one(
            "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
            &[&lock_scope, &company],
        )
        .await
        .map_err(ApiError::internal)?;
    }
    for candidate in candidates {
        if let Err(error) = require_origin_available(&tx, &farm, &candidate).await {
            results.push(row_failure(&candidate, error)?);
            continue;
        }
        let cost = if let Effect::Cost(cost) = &candidate.effect {
            match prepare_cost(&state, &session, &farm, &candidate, cost).await {
                Ok((prepared, digest)) => Some((cost, prepared, digest)),
                Err(error) => {
                    results.push(row_failure(&candidate, error)?);
                    continue;
                }
            }
        } else {
            None
        };
        if body.preview {
            let previewed = match cost {
                Some((cost, proof, digest)) => {
                    preview_cost_effect(&tx, &farm, &candidate, cost, &proof, &digest, &batches)
                        .await
                }
                None => preview(&tx, &farm, can_create, &candidate, &mut batches).await,
            };
            let result = match previewed {
                Ok(result) => result,
                Err(error) => row_failure(&candidate, error)?,
            };
            results.push(result);
            continue;
        }
        let selection = selections[&candidate.source.review_item_id];
        let expected = cost
            .as_ref()
            .map_or(candidate.digest.as_str(), |(_, _, digest)| digest.as_str());
        if selection.expected_digest.as_deref() != Some(expected) {
            results.push(row_result(
                &candidate,
                "held",
                "The mapped row changed. Preview it again.",
            ));
            continue;
        }
        // A failed row rolls back its own batch creation with the event, while
        // independent confirmed rows still commit.
        let savepoint = tx.transaction().await.map_err(ApiError::internal)?;
        let applied = match cost {
            Some((cost, proof, _)) => apply_cost(&savepoint, &farm, &candidate, cost, &proof).await,
            None => apply(&savepoint, &farm, can_create, &candidate).await,
        };
        match applied {
            Ok(result) => {
                savepoint.commit().await.map_err(ApiError::internal)?;
                results.push(result);
            }
            Err(error) => {
                savepoint.rollback().await.map_err(ApiError::internal)?;
                results.push(row_failure(&candidate, error)?);
            }
        }
    }
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(
        json!({"mode":"historical_farm_events","results":results}),
    ))
}

pub(super) async fn task_results(
    tx: &tokio_postgres::Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
) -> Result<(Vec<Value>, bool), ApiError> {
    let rows = tx.query(
        "SELECT receipt.farm_batch_id::text AS batch_id,
            (count(DISTINCT receipt.farm_event_id)+count(DISTINCT receipt.journal_line_id))::bigint AS count
         FROM lumiere_platform.farm_import_event receipt
         WHERE receipt.organization_id=$1::text::numeric AND receipt.company_id=$2::text::numeric
           AND EXISTS (SELECT 1 FROM lumiere_platform.import_task_review link
             WHERE (link.organization_id,link.company_id,link.batch_id)
                 = (receipt.organization_id,receipt.company_id,receipt.review_batch_id)
               AND link.actor_identity=$3 AND link.request_id=$4)
         GROUP BY receipt.farm_batch_id ORDER BY receipt.farm_batch_id LIMIT 21",
        &[&scope.organization.to_string(), &scope.company.to_string(), &scope.actor, &task],
    ).await.map_err(ApiError::internal)?;
    let results = rows.iter().take(20).map(|row| {
        json!({"batchId":row.get::<_, &str>("batch_id"),"count":row.get::<_, i64>("count")})
    }).collect();
    Ok((results, rows.len() > 20))
}
