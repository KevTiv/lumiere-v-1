//! Read farm totals from one authorized, date-bounded database snapshot.

use std::{collections::BTreeMap, sync::Arc};

use axum::{
    extract::{Query, State},
    Json,
};
use serde_json::{json, Value};
use tokio_postgres::IsolationLevel;

use super::{authorize, metrics, EventInput, FarmAccess, ScopeQuery};
use crate::{cold_tier::pg_pool, error::ApiError, state::AppState, web_session::OrgSession};

const MAX_BATCHES: usize = 20;
const MAX_EVENTS: usize = 10_000;

pub(super) async fn read(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
    if query.before_id.is_some() {
        return Err(ApiError::BadRequest(
            "Farm portfolio totals cannot be paginated".into(),
        ));
    }
    let scope = authorize(&state, &session, query.company_id, FarmAccess::Read).await?;
    let as_of = query.as_of(scope.local_date)?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut db = pool.get().await.map_err(ApiError::internal)?;
    let transaction = db
        .build_transaction()
        .isolation_level(IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await
        .map_err(ApiError::internal)?;
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let cutoff = as_of.to_string();
    let batches = transaction
        .query(
            "SELECT id, reference FROM lumiere_platform.farm_batch
         WHERE organization_id = $1::text::numeric AND company_id = $2::text::numeric
           AND start_date <= $3::text::date ORDER BY id DESC LIMIT $4",
            &[&org, &company, &cutoff, &((MAX_BATCHES + 1) as i64)],
        )
        .await
        .map_err(ApiError::internal)?;
    let too_large =
        || ApiError::Unprocessable("Farm portfolio exceeds the batch or event read limit".into());
    if batches.len() > MAX_BATCHES {
        return Err(too_large());
    }
    let ids: Vec<i64> = batches.iter().map(|row| row.get("id")).collect();
    let events = if ids.is_empty() {
        Vec::new()
    } else {
        transaction
            .query(
                "SELECT batch_id, event_json FROM lumiere_platform.farm_batch_event
             WHERE organization_id = $1::text::numeric AND company_id = $2::text::numeric
               AND batch_id = ANY($3::bigint[]) AND business_date <= $4::text::date
             ORDER BY batch_id, business_date, id LIMIT $5",
                &[&org, &company, &ids, &cutoff, &((MAX_EVENTS + 1) as i64)],
            )
            .await
            .map_err(ApiError::internal)?
    };
    if events.len() > MAX_EVENTS {
        return Err(too_large());
    }
    let mut by_batch: BTreeMap<i64, Vec<EventInput>> = BTreeMap::new();
    for event in events {
        by_batch
            .entry(event.get("batch_id"))
            .or_default()
            .push(serde_json::from_value(event.get("event_json")).map_err(ApiError::internal)?);
    }
    let mut recorded_deaths = 0u128;
    let mut headcount = 0u128;
    let mut missing_headcount = 0usize;
    for id in ids {
        let events = by_batch.remove(&id).unwrap_or_default();
        let values = metrics::compute(&events, as_of, None);
        recorded_deaths += u128::from(values.recorded_deaths);
        match values.live_headcount {
            metrics::Metric::Available { value } => headcount += u128::from(value),
            metrics::Metric::Unavailable { .. } => missing_headcount += 1,
        }
    }
    transaction.commit().await.map_err(ApiError::internal)?;
    let sources: Vec<_> = batches.iter().take(5).map(|row| {
        json!({ "id": row.get::<_, i64>("id").to_string(), "reference": row.get::<_, &str>("reference") })
    }).collect();
    Ok(Json(json!({ "data": {
        "companyId": company,
        "asOf": cutoff,
        "batches": batches.len(),
        "recordedDeaths": recorded_deaths.to_string(),
        "liveHeadcount": (missing_headcount == 0).then(|| headcount.to_string()),
        "sources": sources,
    } })))
}
