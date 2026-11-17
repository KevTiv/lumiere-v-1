use chrono::NaiveDate;
use deadpool_postgres::{GenericClient, Transaction};
use serde_json::{json, Value};
use tokio_postgres::Row;

use super::{
    model::{date, text_field, validate_request_key, validate_timeline},
    BatchInput, EventInput, EventSource, FarmScope,
};
use crate::error::ApiError;

const BATCH_COLUMNS: &str =
    "batch.id,batch.reference,batch.species,batch.start_date::text,batch.location,batch.revision";
const SCOPE: &str = "organization_id=$1::text::numeric AND company_id=$2::text::numeric";

pub(crate) struct Batch {
    pub id: i64,
    pub input: BatchInput,
    pub revision: i32,
}

impl Batch {
    fn from_row(row: &Row) -> Result<Self, ApiError> {
        Ok(Self {
            id: row.get("id"),
            input: BatchInput {
                reference: row.get("reference"),
                species: row.get("species"),
                start_date: date::parse(row.get::<_, &str>("start_date"))
                    .map_err(|cause| ApiError::Internal(cause.into()))?,
                location: row.get("location"),
            },
            revision: row.get("revision"),
        })
    }

    pub(super) fn view(&self, live_headcount: u64) -> Value {
        json!({
            "id": self.id.to_string(),
            "reference": self.input.reference,
            "species": self.input.species,
            "startDate": self.input.start_date.to_string(),
            "location": self.input.location,
            "revision": self.revision,
            "liveHeadcount": live_headcount,
        })
    }
}

#[derive(Debug)]
pub(crate) struct FarmEvent {
    pub id: i64,
    pub revision: i32,
    pub event: EventInput,
    pub source: Option<EventSource>,
}

impl FarmEvent {
    fn from_row(row: &Row) -> Result<Self, ApiError> {
        Ok(Self {
            id: row.get("id"),
            revision: row.get("revision"),
            event: serde_json::from_value(row.get("event_json")).map_err(ApiError::internal)?,
            source: row
                .get::<_, Option<Value>>("source_json")
                .map(serde_json::from_value)
                .transpose()
                .map_err(ApiError::internal)?,
        })
    }

    pub(super) fn view(&self) -> Result<Value, ApiError> {
        let mut view = serde_json::to_value(&self.event).map_err(ApiError::internal)?;
        let fields = view
            .as_object_mut()
            .ok_or_else(|| ApiError::Internal("farm event is not an object".into()))?;
        fields.insert("id".into(), json!(self.id.to_string()));
        fields.insert("revision".into(), json!(self.revision));
        if let Some(source) = &self.source {
            fields.insert("source".into(), json!(source));
        }
        Ok(view)
    }
}

fn missing_batch() -> ApiError {
    ApiError::NotFound("farm batch not found".into())
}

fn missing_event() -> ApiError {
    ApiError::NotFound("farm event not found".into())
}

fn key_conflict() -> ApiError {
    ApiError::Conflict("farm request key already used for different details".into())
}

pub(super) async fn list_batches(
    db: &impl GenericClient,
    scope: &FarmScope,
    as_of: NaiveDate,
    before_id: i64,
) -> Result<(Vec<Value>, Option<String>), ApiError> {
    let rows = db.query(
        &format!(
            "SELECT {BATCH_COLUMNS},coalesce(headcount.total,0)::text AS headcount
             FROM lumiere_platform.farm_batch batch
             LEFT JOIN LATERAL (
               SELECT sum(event.headcount_delta) AS total FROM lumiere_platform.farm_batch_event event
               WHERE event.organization_id=batch.organization_id AND event.company_id=batch.company_id
                 AND event.batch_id=batch.id AND event.business_date <= $3::text::date
             ) headcount ON true
             WHERE batch.organization_id=$1::text::numeric AND batch.company_id=$2::text::numeric
               AND batch.id < $4
             ORDER BY batch.id DESC LIMIT 101"
        ),
        &[&scope.organization.to_string(), &scope.company.to_string(), &as_of.to_string(), &before_id],
    ).await.map_err(ApiError::internal)?;
    let next = (rows.len() > 100).then(|| rows[99].get::<_, i64>("id").to_string());
    let views = rows
        .iter()
        .take(100)
        .map(|row| {
            let count = row
                .get::<_, &str>("headcount")
                .parse::<u64>()
                .map_err(ApiError::internal)?;
            Ok(Batch::from_row(row)?.view(count))
        })
        .collect::<Result<_, ApiError>>()?;
    Ok((views, next))
}

pub(crate) async fn find_batch_by_reference<C: GenericClient + Sync>(
    db: &C,
    scope: &FarmScope,
    reference: &str,
) -> Result<Option<Batch>, ApiError> {
    let reference = text_field("reference", reference, 128)?;
    db.query_opt(
        &format!("SELECT {BATCH_COLUMNS} FROM lumiere_platform.farm_batch batch WHERE {SCOPE} AND lower(reference) = lower($3)"),
        &[&scope.organization.to_string(), &scope.company.to_string(), &reference],
    ).await.map_err(ApiError::internal)?.as_ref().map(Batch::from_row).transpose()
}

pub(super) async fn read_batch(
    db: &Transaction<'_>,
    scope: &FarmScope,
    id: i64,
) -> Result<Batch, ApiError> {
    get_batch(db, scope, id, "").await
}

pub(crate) async fn lock_batch(
    db: &Transaction<'_>,
    scope: &FarmScope,
    id: i64,
) -> Result<Batch, ApiError> {
    get_batch(db, scope, id, " FOR UPDATE").await
}

async fn get_batch(
    db: &Transaction<'_>,
    scope: &FarmScope,
    id: i64,
    lock: &str,
) -> Result<Batch, ApiError> {
    let row = db.query_opt(
        &format!("SELECT {BATCH_COLUMNS} FROM lumiere_platform.farm_batch batch WHERE {SCOPE} AND id=$3{lock}"),
        &[&scope.organization.to_string(), &scope.company.to_string(), &id],
    ).await.map_err(ApiError::internal)?.ok_or_else(missing_batch)?;
    Batch::from_row(&row)
}

pub(crate) async fn ensure_import_batch(
    db: &Transaction<'_>,
    scope: &FarmScope,
    request_key: &str,
    input: &BatchInput,
) -> Result<Batch, ApiError> {
    create_batch(db, scope, request_key, input, true).await
}

pub(super) async fn create_batch(
    db: &Transaction<'_>,
    scope: &FarmScope,
    request_key: &str,
    input: &BatchInput,
    allow_reference_match: bool,
) -> Result<Batch, ApiError> {
    validate_request_key(request_key)?;
    let input = input.normalized()?;
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    if let Some(row) = db.query_opt(
        &format!(
            "INSERT INTO lumiere_platform.farm_batch AS batch
             (organization_id,company_id,reference,species,start_date,location,create_request_key,created_by)
             VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5::text::date,$6,$7,$8)
             ON CONFLICT DO NOTHING RETURNING {BATCH_COLUMNS}"
        ),
        &[&org, &company, &input.reference, &input.species, &input.start_date.to_string(), &input.location, &request_key, &scope.actor],
    ).await.map_err(ApiError::internal)? {
        return Batch::from_row(&row);
    }
    if let Some(row) = db.query_opt(
        &format!("SELECT {BATCH_COLUMNS} FROM lumiere_platform.farm_batch batch WHERE {SCOPE} AND create_request_key=$3"),
        &[&org, &company, &request_key],
    ).await.map_err(ApiError::internal)? {
        let batch = Batch::from_row(&row)?;
        return (batch.input == input).then_some(batch).ok_or_else(key_conflict);
    }
    if allow_reference_match {
        if let Some(batch) = find_batch_by_reference(db, scope, &input.reference).await? {
            if batch.input.species == input.species
                && batch.input.start_date == input.start_date
                && batch.input.location == input.location
            {
                return Ok(batch);
            }
        }
    }
    Err(ApiError::Conflict(
        "farm batch reference already exists".into(),
    ))
}

pub(crate) async fn list_events<C: GenericClient + Sync>(
    db: &C,
    scope: &FarmScope,
    batch_id: i64,
) -> Result<Vec<FarmEvent>, ApiError> {
    let rows = db.query(
        &format!("SELECT id,revision,event_json,source_json FROM lumiere_platform.farm_batch_event WHERE {SCOPE} AND batch_id=$3 ORDER BY business_date,id"),
        &[&scope.organization.to_string(), &scope.company.to_string(), &batch_id],
    ).await.map_err(ApiError::internal)?;
    rows.iter().map(FarmEvent::from_row).collect()
}

pub(crate) async fn read_event<C: GenericClient + Sync>(
    db: &C,
    scope: &FarmScope,
    batch_id: i64,
    event_id: i64,
) -> Result<FarmEvent, ApiError> {
    let row = db.query_opt(
        &format!("SELECT id,revision,event_json,source_json FROM lumiere_platform.farm_batch_event WHERE {SCOPE} AND batch_id=$3 AND id=$4"),
        &[&scope.organization.to_string(), &scope.company.to_string(), &batch_id, &event_id],
    ).await.map_err(ApiError::internal)?.ok_or_else(missing_event)?;
    FarmEvent::from_row(&row)
}

async fn request_receipt<C: GenericClient + Sync>(
    db: &C,
    scope: &FarmScope,
    batch_id: i64,
    request_key: &str,
) -> Result<Option<(FarmEvent, Option<String>)>, ApiError> {
    let row = db.query_opt(
        &format!("SELECT event_id AS id,revision,event_json,source_json,reason FROM lumiere_platform.farm_batch_event_revision WHERE {SCOPE} AND batch_id=$3 AND request_key=$4"),
        &[&scope.organization.to_string(), &scope.company.to_string(), &batch_id, &request_key],
    ).await.map_err(ApiError::internal)?;
    row.as_ref()
        .map(|row| Ok((FarmEvent::from_row(row)?, row.get("reason"))))
        .transpose()
}

pub(crate) async fn find_event_by_request<C: GenericClient + Sync>(
    db: &C,
    scope: &FarmScope,
    batch_id: i64,
    request_key: &str,
) -> Result<Option<FarmEvent>, ApiError> {
    Ok(request_receipt(db, scope, batch_id, request_key)
        .await?
        .filter(|(_, reason)| reason.is_none())
        .map(|(event, _)| event))
}

pub(super) async fn event_history(
    db: &Transaction<'_>,
    scope: &FarmScope,
    batch_id: i64,
    event_id: i64,
) -> Result<Vec<Value>, ApiError> {
    let rows = db.query(
        &format!("SELECT event_id AS id,revision,event_json,source_json,reason,recorded_by,recorded_at::text FROM lumiere_platform.farm_batch_event_revision WHERE {SCOPE} AND batch_id=$3 AND event_id=$4 ORDER BY revision DESC LIMIT 100"),
        &[&scope.organization.to_string(), &scope.company.to_string(), &batch_id, &event_id],
    ).await.map_err(ApiError::internal)?;
    if rows.is_empty() {
        return Err(missing_event());
    }
    rows.iter()
        .map(|row| {
            Ok(json!({
                "event": FarmEvent::from_row(row)?.view()?,
                "reason": row.get::<_, Option<&str>>("reason"),
                "recordedBy": row.get::<_, &str>("recorded_by"),
                "recordedAt": row.get::<_, &str>("recorded_at"),
            }))
        })
        .collect()
}

pub(crate) async fn persist_event(
    db: &Transaction<'_>,
    scope: &FarmScope,
    batch_id: i64,
    request_key: &str,
    expected_revision: Option<i32>,
    event: &EventInput,
    source: Option<&EventSource>,
) -> Result<FarmEvent, ApiError> {
    validate_request_key(request_key)?;
    let batch = lock_batch(db, scope, batch_id).await?;
    if let Some((saved, reason)) = request_receipt(db, scope, batch_id, request_key).await? {
        return (reason.is_none() && saved.event == *event)
            .then_some(saved)
            .ok_or_else(key_conflict);
    }
    require_revision(&batch, expected_revision)?;
    prospective_timeline(db, scope, &batch, event, None).await?;
    let event_json = serde_json::to_value(event).map_err(ApiError::internal)?;
    let source_json = source
        .map(serde_json::to_value)
        .transpose()
        .map_err(ApiError::internal)?;
    let row = db.query_one(
        "INSERT INTO lumiere_platform.farm_batch_event (organization_id,company_id,batch_id,business_date,headcount_delta,event_json,source_json)
         VALUES ($1::text::numeric,$2::text::numeric,$3,$4::text::date,$5,$6,$7)
         RETURNING id,revision,event_json,source_json",
        &[&scope.organization.to_string(), &scope.company.to_string(), &batch_id, &event.business_date.to_string(), &event.kind.headcount_delta(), &event_json, &source_json],
    ).await.map_err(ApiError::internal)?;
    let saved = FarmEvent::from_row(&row)?;
    record_revision(db, scope, batch_id, request_key, &saved, None).await?;
    Ok(saved)
}

pub(super) async fn correct_event(
    db: &Transaction<'_>,
    scope: &FarmScope,
    batch_id: i64,
    event_id: i64,
    request_key: &str,
    expected_revision: i32,
    event: &EventInput,
    reason: &str,
) -> Result<FarmEvent, ApiError> {
    validate_request_key(request_key)?;
    let reason = text_field("correction reason", reason, 500)?;
    let batch = lock_batch(db, scope, batch_id).await?;
    if let Some((saved, saved_reason)) = request_receipt(db, scope, batch_id, request_key).await? {
        return (saved.id == event_id
            && saved.event == *event
            && saved_reason.as_ref() == Some(&reason))
        .then_some(saved)
        .ok_or_else(key_conflict);
    }
    require_revision(&batch, Some(expected_revision))?;
    let current = read_event(db, scope, batch_id, event_id).await?;
    if current.event == *event {
        return Err(ApiError::BadRequest(
            "the correction must change a farm event".into(),
        ));
    }
    if db
        .query_opt(
            "SELECT 1 FROM lumiere_platform.farm_processing_link WHERE event_id=$1",
            &[&event_id],
        )
        .await
        .map_err(ApiError::internal)?
        .is_some()
    {
        return Err(ApiError::Conflict(
            "this processing event has verified native stock effects and requires a native reversal".into(),
        ));
    }
    prospective_timeline(db, scope, &batch, event, Some(event_id)).await?;
    let event_json = serde_json::to_value(event).map_err(ApiError::internal)?;
    let row = db.query_one(
        &format!("UPDATE lumiere_platform.farm_batch_event SET business_date=$5::text::date,headcount_delta=$6,event_json=$7,revision=revision+1 WHERE {SCOPE} AND batch_id=$3 AND id=$4 RETURNING id,revision,event_json,source_json"),
        &[&scope.organization.to_string(), &scope.company.to_string(), &batch_id, &event_id, &event.business_date.to_string(), &event.kind.headcount_delta(), &event_json],
    ).await.map_err(ApiError::internal)?;
    let saved = FarmEvent::from_row(&row)?;
    record_revision(db, scope, batch_id, request_key, &saved, Some(&reason)).await?;
    Ok(saved)
}

fn require_revision(batch: &Batch, expected_revision: Option<i32>) -> Result<(), ApiError> {
    if expected_revision.is_some_and(|revision| revision != batch.revision) {
        return Err(ApiError::Conflict(
            "the farm batch changed; reload and review its timeline".into(),
        ));
    }
    Ok(())
}

async fn prospective_timeline(
    db: &Transaction<'_>,
    scope: &FarmScope,
    batch: &Batch,
    event: &EventInput,
    replacing: Option<i64>,
) -> Result<(), ApiError> {
    let mut timeline = list_events(db, scope, batch.id)
        .await?
        .into_iter()
        .filter(|row| Some(row.id) != replacing)
        .map(|row| row.event)
        .collect::<Vec<_>>();
    timeline.push(event.clone());
    validate_timeline(batch.input.start_date, &timeline)
}

async fn record_revision(
    db: &Transaction<'_>,
    scope: &FarmScope,
    batch_id: i64,
    request_key: &str,
    event: &FarmEvent,
    reason: Option<&str>,
) -> Result<(), ApiError> {
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let event_json = serde_json::to_value(&event.event).map_err(ApiError::internal)?;
    let source_json = event
        .source
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(ApiError::internal)?;
    db.execute(
        "INSERT INTO lumiere_platform.farm_batch_event_revision (organization_id,company_id,batch_id,event_id,revision,event_json,source_json,request_key,reason,recorded_by)
         VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8,$9,$10)",
        &[&org, &company, &batch_id, &event.id, &event.revision, &event_json, &source_json, &request_key, &reason, &scope.actor],
    ).await.map_err(ApiError::internal)?;
    db.execute(
        &format!(
            "UPDATE lumiere_platform.farm_batch SET revision=revision+1 WHERE {SCOPE} AND id=$3"
        ),
        &[&org, &company, &batch_id],
    )
    .await
    .map_err(ApiError::internal)?;
    Ok(())
}
