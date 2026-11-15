//! Farm batches and dated observations are the canonical farm activity records.
//! Linked inventory and ledger effects retain their existing native owners.
mod linked_costs;
mod metrics;
mod model;
pub(crate) mod native_links;
#[cfg(test)]
mod postgres_tests;
mod storage;

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::NaiveDate;
use serde::{de::Error as _, Deserialize, Deserializer};
use serde_json::{json, Value};
use stdb_auth::permission_allowed;
use tokio_postgres::IsolationLevel;

use crate::{
    cold_tier::pg_pool, error::ApiError, query_exec::resolve_membership_company_id,
    session::ApiSession, state::AppState, trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};

use model::{date, live_headcount};
pub(crate) use model::{validate_timeline, BatchInput, EventInput, EventKind, EventSource};
pub(crate) use storage::{
    ensure_import_batch, find_batch_by_reference, find_event_by_request, list_events, lock_batch,
    persist_event, read_event,
};

const FARM_RESOURCE: &str = "farm_batch";
const FARM_PACK: &str = "farm_operations";

pub(crate) struct FarmScope {
    pub organization: u64,
    pub company: u64,
    pub actor: String,
    local_date: NaiveDate,
}

pub(crate) enum FarmAccess {
    Read,
    Create,
    Write,
}

impl FarmAccess {
    fn action(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Create => "create",
            Self::Write => "write",
        }
    }
}

pub(crate) async fn authorize(
    state: &AppState,
    session: &ApiSession,
    company: u64,
    access: FarmAccess,
) -> Result<FarmScope, ApiError> {
    let context = TrustedOperationContext::for_resource_read(state, session)?;
    context.require_current_placement(&state.organization_placements)?;
    let field_access = context.field_access();
    let action = access.action();
    if !permission_allowed(field_access, FARM_RESOURCE, "read")
        || !permission_allowed(field_access, FARM_RESOURCE, action)
    {
        return Err(ApiError::Forbidden("Farm batch access is required".into()));
    }
    let organization = context.organization_id();
    let company = resolve_membership_company_id(
        context.client(),
        organization,
        context.actor_identity(),
        Some(company),
        "farm batch company scope mismatch",
    )
    .await?;
    let enabled = context
        .client()
        .query_sql(&format!(
            "SELECT enabled FROM company_vertical_pack
         WHERE organization_id={organization} AND company_id={company} AND pack_key='{FARM_PACK}'"
        ))
        .await
        .map_err(ApiError::internal)?;
    if !enabled
        .iter()
        .any(|pack| pack.get("enabled").and_then(Value::as_bool) == Some(true))
    {
        return Err(ApiError::Forbidden(
            "Farm Operations is unavailable for this company".into(),
        ));
    }
    let organization_settings = context
        .client()
        .query_sql(&format!(
            "SELECT timezone FROM organization WHERE id={organization}"
        ))
        .await
        .map_err(ApiError::internal)?;
    let timezone = organization_settings
        .first()
        .and_then(|organization| organization.get("timezone").and_then(Value::as_str))
        .and_then(|timezone| timezone.parse::<chrono_tz::Tz>().ok())
        .unwrap_or(chrono_tz::UTC);
    Ok(FarmScope {
        organization,
        company,
        actor: context.actor_identity().to_owned(),
        local_date: chrono::Utc::now().with_timezone(&timezone).date_naive(),
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ScopeQuery {
    company_id: u64,
    as_of: Option<String>,
    before_id: Option<i64>,
}

impl ScopeQuery {
    fn as_of(&self, local_date: NaiveDate) -> Result<NaiveDate, ApiError> {
        self.as_of
            .as_deref()
            .map(date::parse)
            .transpose()
            .map(|date| date.unwrap_or(local_date))
            .map_err(|cause| ApiError::BadRequest(cause.into()))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody {
    #[serde(deserialize_with = "company_id")]
    company_id: u64,
    request_key: String,
    #[serde(flatten)]
    input: BatchInput,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct EventBody {
    #[serde(deserialize_with = "company_id")]
    company_id: u64,
    request_key: String,
    expected_revision: i32,
    event: EventInput,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CorrectionBody {
    #[serde(deserialize_with = "company_id")]
    company_id: u64,
    request_key: String,
    expected_revision: i32,
    event: EventInput,
    reason: String,
}

fn company_id<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum CompanyId {
        Decimal(String),
        Number(u64),
    }
    let id = match CompanyId::deserialize(deserializer)? {
        CompanyId::Decimal(value) => value.parse().map_err(D::Error::custom)?,
        CompanyId::Number(value) => value,
    };
    if id == 0 {
        return Err(D::Error::custom("company ID must be positive"));
    }
    Ok(id)
}

async fn list(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
    let scope = authorize(&state, &session, query.company_id, FarmAccess::Read).await?;
    let as_of = query.as_of(scope.local_date)?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let db = pool.get().await.map_err(ApiError::internal)?;
    let (data, next) =
        storage::list_batches(&db, &scope, as_of, query.before_id.unwrap_or(i64::MAX)).await?;
    Ok(Json(
        json!({"data": data, "asOf": as_of.to_string(), "nextBeforeId": next}),
    ))
}

async fn create(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<CreateBody>,
) -> Result<Json<Value>, ApiError> {
    let scope = authorize(&state, &session, body.company_id, FarmAccess::Create).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut db = pool.get().await.map_err(ApiError::internal)?;
    let transaction = db.transaction().await.map_err(ApiError::internal)?;
    let batch =
        storage::create_batch(&transaction, &scope, &body.request_key, &body.input, false).await?;
    let live_headcount = if batch.revision == 1 {
        0
    } else {
        let events = list_events(&transaction, &scope, batch.id)
            .await?
            .into_iter()
            .map(|row| row.event)
            .collect::<Vec<_>>();
        live_headcount(&events, Some(scope.local_date))?
    };
    transaction.commit().await.map_err(ApiError::internal)?;
    Ok(Json(json!({"data": batch.view(live_headcount)})))
}

async fn detail(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(batch_id): Path<i64>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
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
    let batch = storage::read_batch(&transaction, &scope, batch_id).await?;
    let rows = list_events(&transaction, &scope, batch_id).await?;
    let events = rows.iter().map(|row| row.event.clone()).collect::<Vec<_>>();
    let mut data = batch.view(live_headcount(&events, Some(as_of))?);
    data["events"] = json!(rows
        .iter()
        .map(storage::FarmEvent::view)
        .collect::<Result<Vec<_>, _>>()?);
    data["asOf"] = json!(as_of.to_string());
    data["metrics"] = json!(metrics::compute(&events, as_of, None));
    transaction.commit().await.map_err(ApiError::internal)?;
    Ok(Json(json!({"data": data})))
}

async fn append_event(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(batch_id): Path<i64>,
    Json(body): Json<EventBody>,
) -> Result<Json<Value>, ApiError> {
    let scope = authorize(&state, &session, body.company_id, FarmAccess::Write).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut db = pool.get().await.map_err(ApiError::internal)?;
    let transaction = db.transaction().await.map_err(ApiError::internal)?;
    let event = persist_event(
        &transaction,
        &scope,
        batch_id,
        &body.request_key,
        Some(body.expected_revision),
        &body.event,
        None,
    )
    .await?;
    let data = event.view()?;
    transaction.commit().await.map_err(ApiError::internal)?;
    Ok(Json(json!({"data": data})))
}

async fn revise_event(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path((batch_id, event_id)): Path<(i64, i64)>,
    Json(body): Json<CorrectionBody>,
) -> Result<Json<Value>, ApiError> {
    let scope = authorize(&state, &session, body.company_id, FarmAccess::Write).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut db = pool.get().await.map_err(ApiError::internal)?;
    let transaction = db.transaction().await.map_err(ApiError::internal)?;
    let event = storage::correct_event(
        &transaction,
        &scope,
        batch_id,
        event_id,
        &body.request_key,
        body.expected_revision,
        &body.event,
        &body.reason,
    )
    .await?;
    let data = event.view()?;
    transaction.commit().await.map_err(ApiError::internal)?;
    Ok(Json(json!({"data": data})))
}

async fn history(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path((batch_id, event_id)): Path<(i64, i64)>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
    let scope = authorize(&state, &session, query.company_id, FarmAccess::Read).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut db = pool.get().await.map_err(ApiError::internal)?;
    let transaction = db.transaction().await.map_err(ApiError::internal)?;
    let data = storage::event_history(&transaction, &scope, batch_id, event_id).await?;
    transaction.commit().await.map_err(ApiError::internal)?;
    Ok(Json(json!({"data": data})))
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/farm-batches", get(list).post(create))
        .route("/farm-batches/:batch_id", get(detail))
        .route("/farm-batches/:batch_id/events", post(append_event))
        .route(
            "/farm-batches/:batch_id/events/:event_id",
            patch(revise_event),
        )
        .route(
            "/farm-batches/:batch_id/events/:event_id/history",
            get(history),
        )
        .merge(native_links::router())
        .merge(linked_costs::router())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_body_accepts_lossless_browser_company_ids() {
        let body: CreateBody = serde_json::from_value(json!({
            "companyId": "18446744073709551615",
            "requestKey": "create-new",
            "reference": "Flock-01",
            "species": "Chicken",
            "location": "House 1",
            "startDate": "2026-01-01",
        }))
        .unwrap();
        assert_eq!(body.company_id, u64::MAX);
        assert_eq!(body.input.reference, "Flock-01");
    }
}
