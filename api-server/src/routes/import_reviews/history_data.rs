//! Complete source-review date coverage and bounded historical row reads.
//!
//! These are source observations, never posted ERP documents or live stock.
//! PostgreSQL aggregates the complete authorized scope; row and dataset pages
//! are keyset bounded. A changed inventory invalidates a continuation instead
//! of silently mixing different revisions of a review.

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::Datelike;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio_postgres::{IsolationLevel, Row, Transaction};

use super::{full_administrator, history_period::calendar_date, scope};
use crate::{
    cold_tier::pg_pool, error::ApiError, query_exec::resolve_membership_company_id,
    session::load_field_access_context, state::AppState, trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;

const MAX_PAGE: i64 = 100;
const CURSOR_AUDIENCE: &str = "lumiere-source-history/v1";
const MAX_SAFE_COUNT: i64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct CoverageQuery {
    company_id: u64,
    cursor: Option<String>,
    limit: Option<u32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum DateMode {
    #[default]
    All,
    Dated,
    Undated,
    Invalid,
}

impl DateMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Dated => "dated",
            Self::Undated => "undated",
            Self::Invalid => "invalid",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ReviewState {
    NeedsReview,
    Confirmed,
    Excluded,
}

impl ReviewState {
    fn as_str(self) -> &'static str {
        match self {
            Self::NeedsReview => "needs_review",
            Self::Confirmed => "confirmed",
            Self::Excluded => "excluded",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct RowsQuery {
    company_id: u64,
    batch_id: Option<i64>,
    from: Option<String>,
    to_exclusive: Option<String>,
    #[serde(default)]
    date_mode: DateMode,
    state: Option<ReviewState>,
    cursor: Option<String>,
    snapshot: Option<String>,
    limit: Option<u32>,
}

impl RowsQuery {
    fn validate(&self) -> Result<i64, ApiError> {
        if self.company_id == 0 || self.batch_id.is_some_and(|id| id <= 0) {
            return Err(ApiError::BadRequest(
                "positive companyId and batchId are required".into(),
            ));
        }
        let from = self
            .from
            .as_deref()
            .map(calendar_date)
            .transpose()
            .map_err(ApiError::BadRequest)?;
        let to = self
            .to_exclusive
            .as_deref()
            .map(calendar_date)
            .transpose()
            .map_err(ApiError::BadRequest)?;
        if matches!((from, to), (Some(start), Some(end)) if start >= end) {
            return Err(ApiError::BadRequest(
                "toExclusive must be after from".into(),
            ));
        }
        if matches!(self.date_mode, DateMode::Undated | DateMode::Invalid)
            && (self.from.is_some() || self.to_exclusive.is_some())
        {
            return Err(ApiError::BadRequest(
                "unknown-date filters cannot have calendar boundaries".into(),
            ));
        }
        page_limit(self.limit)
    }

    fn filter_key(&self) -> Result<String, ApiError> {
        fingerprint(
            &json!({"batchId":self.batch_id,"from":self.from,"toExclusive":self.to_exclusive,
            "dateMode":self.date_mode,"state":self.state,"limit":self.limit.unwrap_or(50)}),
        )
    }
}

fn page_limit(limit: Option<u32>) -> Result<i64, ApiError> {
    let limit = i64::from(limit.unwrap_or(50));
    if !(1..=MAX_PAGE).contains(&limit) {
        return Err(ApiError::BadRequest(
            "limit must be between 1 and 100".into(),
        ));
    }
    Ok(limit)
}

fn fingerprint(value: &Value) -> Result<String, ApiError> {
    let bytes = serde_json::to_vec(value).map_err(ApiError::internal)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

#[derive(Debug, Deserialize, Serialize)]
struct Cursor {
    aud: String,
    exp: u64,
    kind: String,
    organization: String,
    company: String,
    actor: String,
    placement: String,
    filter: String,
    snapshot: String,
    after: i64,
}

struct CursorScope<'a> {
    kind: &'a str,
    organization: u64,
    company: u64,
    actor: &'a str,
    placement: u64,
    filter: &'a str,
    snapshot: &'a str,
}

impl CursorScope<'_> {
    fn encode(&self, after: i64, secret: &[u8]) -> Result<String, ApiError> {
        let cursor = Cursor {
            aud: CURSOR_AUDIENCE.into(),
            exp: (chrono::Utc::now().timestamp() + 1800) as u64,
            kind: self.kind.into(),
            organization: self.organization.to_string(),
            company: self.company.to_string(),
            actor: self.actor.into(),
            placement: self.placement.to_string(),
            filter: self.filter.into(),
            snapshot: self.snapshot.into(),
            after,
        };
        encode(
            &Header::new(Algorithm::HS256),
            &cursor,
            &EncodingKey::from_secret(secret),
        )
        .map_err(ApiError::internal)
    }

    fn after(&self, cursor: Option<&str>, secret: &[u8]) -> Result<i64, ApiError> {
        let Some(value) = cursor else { return Ok(0) };
        if value.len() > 4096 {
            return Err(ApiError::BadRequest("invalid history cursor".into()));
        }
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_audience(&[CURSOR_AUDIENCE]);
        let cursor = decode::<Cursor>(value, &DecodingKey::from_secret(secret), &validation)
            .map_err(|_| ApiError::BadRequest("invalid or expired history cursor".into()))?
            .claims;
        if cursor.kind != self.kind
            || cursor.organization != self.organization.to_string()
            || cursor.company != self.company.to_string()
            || cursor.actor != self.actor
            || cursor.placement != self.placement.to_string()
            || cursor.filter != self.filter
            || cursor.after <= 0
        {
            return Err(ApiError::BadRequest(
                "history cursor does not match the authorized scope and filters".into(),
            ));
        }
        if cursor.snapshot != self.snapshot {
            return Err(changed_inventory());
        }
        Ok(cursor.after)
    }
}

fn changed_inventory() -> ApiError {
    ApiError::Conflict(
        "source history changed; refresh coverage and restart from the first page".into(),
    )
}

fn storage_error(error: impl std::fmt::Display) -> ApiError {
    tracing::warn!(error = %error, "source history store unavailable");
    ApiError::Unavailable(
        "source history is unavailable; no complete coverage could be verified".into(),
    )
}

fn cursor_secret(state: &AppState) -> Vec<u8> {
    let mut digest = Sha256::new();
    digest.update(b"lumiere-source-history-cursor-v1\0");
    digest.update(state.stdb.token().as_bytes());
    digest.finalize().to_vec()
}

async fn reauthorize(
    state: &AppState,
    context: &TrustedOperationContext,
    company: u64,
) -> Result<(), ApiError> {
    let access = load_field_access_context(
        &state.stdb,
        context.actor_identity(),
        context.organization_id(),
    )
    .await
    .map_err(storage_error)?
    .ok_or_else(|| ApiError::Forbidden("source history administration access changed".into()))?;
    if access.organization_id != context.organization_id() || !full_administrator(&access) {
        return Err(ApiError::Forbidden(
            "full organization administration access is required for source history".into(),
        ));
    }
    resolve_membership_company_id(
        context.client(),
        context.organization_id(),
        context.actor_identity(),
        Some(company),
        "source history company scope changed",
    )
    .await?;
    context.require_company_scope(&[company])?;
    context.require_current_placement(&state.organization_placements)
}

async fn snapshot(tx: &Transaction<'_>, org: &str, company: &str) -> Result<String, ApiError> {
    let row = tx.query_one(
        "SELECT (SELECT count(*)::text || ':' || coalesce(max(id),0)::text FROM lumiere_platform.import_review_batch WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric) AS batches, count(*)::text AS items, coalesce(max(id),0)::text AS high_water, coalesce(sum(revision::numeric),0)::text AS revisions FROM lumiere_platform.import_review_item WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric",
        &[&org, &company],
    ).await.map_err(storage_error)?;
    fingerprint(
        &json!({"organization":org,"company":company,"batches":row.get::<_,String>("batches"),
        "items":row.get::<_,String>("items"),"highWater":row.get::<_,String>("high_water"),"revisions":row.get::<_,String>("revisions")}),
    )
}

/// Only fixed internal expressions are passed here. A CASE guards every cast,
/// including invalid source dates such as February 31; malformed input is data.
fn safe_date_sql(value: &str) -> String {
    format!("CASE WHEN {value} ~ '^[0-9]{{4}}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND substring({value},1,4) <> '0000' THEN CASE WHEN substring({value},9,2)::int <= extract(day FROM (make_date(substring({value},1,4)::int,substring({value},6,2)::int,1) + interval '1 month - 1 day')) THEN make_date(substring({value},1,4)::int,substring({value},6,2)::int,substring({value},9,2)::int) END END")
}

fn date_sql(scope_filters: &str) -> String {
    include_str!("history_dates.sql")
        .replace("__SCOPE_FILTERS__", scope_filters)
        .replace("__PARSE_FROM__", &safe_date_sql("raw_from"))
        .replace("__PARSE_TO__", &safe_date_sql("raw_to"))
        .replace("__PARSE_SOURCE__", &safe_date_sql("raw_source"))
}

fn normalized_sql() -> String {
    date_sql("")
}

fn row_date_sql(query: &RowsQuery) -> String {
    // Push keyset, dataset and state restrictions into the indexed source scan.
    // The default All available page needs date metadata for at most limit+1
    // rows. Date-filtered pages must evaluate source precision before limiting.
    let filters = "AND ($3::bigint IS NULL OR item.batch_id=$3) AND ($7::text IS NULL OR item.state=$7) AND item.id>$8";
    if query.date_mode == DateMode::All && query.from.is_none() && query.to_exclusive.is_none() {
        date_sql(&format!("{filters} ORDER BY item.id LIMIT $9"))
    } else {
        date_sql(filters)
    }
}

const COUNTS: &str = "count(*)::bigint AS total,
    count(*) FILTER (WHERE date_from IS NOT NULL)::bigint AS dated,
    count(*) FILTER (WHERE date_precision='undated')::bigint AS undated,
    count(*) FILTER (WHERE date_precision='invalid')::bigint AS invalid,
    min(date_from)::text AS min_date, max(date_to_exclusive - 1)::text AS max_date,
    count(*) FILTER (WHERE state='needs_review')::bigint AS needs_review,
    count(*) FILTER (WHERE state='confirmed')::bigint AS confirmed,
    count(*) FILTER (WHERE state='excluded')::bigint AS excluded";

fn count(row: &Row, key: &str) -> Result<i64, ApiError> {
    let count: i64 = row.get(key);
    if !(0..=MAX_SAFE_COUNT).contains(&count) {
        return Err(ApiError::Unavailable(
            "source history count exceeds the supported numeric range".into(),
        ));
    }
    Ok(count)
}

fn counts(row: &Row) -> Result<Value, ApiError> {
    Ok(
        json!({"total":count(row,"total")?,"dated":count(row,"dated")?,"undated":count(row,"undated")?,
        "invalid":count(row,"invalid")?,"minDate":row.get::<_,Option<String>>("min_date"),
        "maxDate":row.get::<_,Option<String>>("max_date"),"states":{"needs_review":count(row,"needs_review")?,
            "confirmed":count(row,"confirmed")?,"excluded":count(row,"excluded")?}}),
    )
}

async fn coverage_data(
    tx: &Transaction<'_>,
    org: &str,
    company: &str,
    after: i64,
    limit: i64,
) -> Result<Value, ApiError> {
    let normalized = normalized_sql();
    let totals_row = tx
        .query_one(
            &format!("{normalized} SELECT {COUNTS} FROM normalized"),
            &[&org, &company],
        )
        .await
        .map_err(storage_error)?;
    let totals = counts(&totals_row)?;
    // LEFT JOIN preserves an empty review document if older imports produced one.
    let dataset_sql = format!("{normalized}, grouped AS (SELECT batch_id, {COUNTS} FROM normalized GROUP BY batch_id)
        SELECT batch.id, batch.title, batch.target_entity, batch.source_file,
            coalesce(grouped.total,0)::bigint AS total, coalesce(grouped.dated,0)::bigint AS dated,
            coalesce(grouped.undated,0)::bigint AS undated, coalesce(grouped.invalid,0)::bigint AS invalid,
            grouped.min_date,grouped.max_date,coalesce(grouped.needs_review,0)::bigint AS needs_review,
            coalesce(grouped.confirmed,0)::bigint AS confirmed,coalesce(grouped.excluded,0)::bigint AS excluded
        FROM lumiere_platform.import_review_batch batch LEFT JOIN grouped ON grouped.batch_id=batch.id
        WHERE batch.organization_id=$1::text::numeric AND batch.company_id=$2::text::numeric AND batch.id>$3
        ORDER BY batch.id LIMIT $4");
    let rows = tx
        .query(&dataset_sql, &[&org, &company, &after, &(limit + 1)])
        .await
        .map_err(storage_error)?;
    let has_more = rows.len() > limit as usize;
    let mut datasets = Vec::with_capacity(limit as usize);
    let mut last_id = 0;
    for row in rows.iter().take(limit as usize) {
        let mut value = counts(row)?;
        last_id = row.get::<_, i64>("id");
        value["id"] = json!(last_id.to_string());
        value["title"] = json!(row.get::<_, String>("title"));
        value["targetEntity"] = json!(row.get::<_, String>("target_entity"));
        value["sourceFile"] = json!(row.get::<_, String>("source_file"));
        value["dateBasis"] = json!("source_business_date");
        datasets.push(value);
    }
    // Buckets count observations by their known starting period. Ranges retain
    // their precision in rows; they are not allocated to invented daily events.
    let year_rows = tx.query(&format!("{normalized} SELECT extract(year FROM date_from)::int AS year, count(*)::bigint AS count FROM normalized WHERE date_from IS NOT NULL GROUP BY year ORDER BY year"), &[&org,&company])
        .await.map_err(storage_error)?;
    let years = year_rows
        .iter()
        .map(|row| Ok(json!({"year":row.get::<_,i32>("year"),"count":count(row,"count")?})))
        .collect::<Result<Vec<_>, ApiError>>()?;
    let short_span = match (totals["minDate"].as_str(), totals["maxDate"].as_str()) {
        (Some(from), Some(to)) => {
            let from = calendar_date(from).map_err(ApiError::Unavailable)?;
            let to = calendar_date(to).map_err(ApiError::Unavailable)?;
            (to.year() - from.year()) * 12 + to.month() as i32 - (from.month() as i32) < 120
        }
        _ => true,
    };
    let mut months = Vec::new();
    if short_span {
        let month_rows = tx.query(&format!("{normalized} SELECT to_char(date_from,'YYYY-MM') AS month, count(*)::bigint AS count FROM normalized WHERE date_from IS NOT NULL GROUP BY month ORDER BY month"), &[&org,&company])
            .await.map_err(storage_error)?;
        for row in month_rows {
            months.push(json!({"month":row.get::<_,String>("month"),"count":count(&row,"count")?}));
        }
    }
    Ok(
        json!({"totals":totals,"datasets":datasets,"years":years,"months":months,
        "bucketGranularity":if short_span {"month"} else {"year"},"bucketBasis":"observation_start",
        "complete":!has_more,"aggregatesComplete":true,"after":if has_more {Some(last_id)} else {None}}),
    )
}

pub(super) async fn coverage(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Query(query): Query<CoverageQuery>,
) -> Result<Json<Value>, ApiError> {
    if query.company_id == 0 {
        return Err(ApiError::BadRequest(
            "positive companyId is required".into(),
        ));
    }
    let limit = page_limit(query.limit)?;
    let context = scope(&state, &session, query.company_id).await?;
    let org = context.organization_id().to_string();
    let company = query.company_id.to_string();
    let pool = pg_pool::required_pool().map_err(storage_error)?;
    let mut client = pool.get().await.map_err(storage_error)?;
    let tx = client
        .build_transaction()
        .isolation_level(IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await
        .map_err(storage_error)?;
    tx.batch_execute("SET LOCAL statement_timeout = '15s'; SET LOCAL jit = off")
        .await
        .map_err(storage_error)?;
    let snapshot = snapshot(&tx, &org, &company).await?;
    let filter = format!("coverage:{limit}");
    let secret = cursor_secret(&state);
    let cursor = CursorScope {
        kind: "coverage",
        organization: context.organization_id(),
        company: query.company_id,
        actor: context.actor_identity(),
        placement: context.placement_generation()?.get(),
        filter: &filter,
        snapshot: &snapshot,
    };
    let after = cursor.after(query.cursor.as_deref(), &secret)?;
    let mut value = coverage_data(&tx, &org, &company, after, limit).await?;
    value["nextCursor"] = match value["after"].as_i64() {
        Some(after) => json!(cursor.encode(after, &secret)?),
        None => Value::Null,
    };
    if let Some(object) = value.as_object_mut() {
        object.remove("after");
    }
    tx.commit().await.map_err(storage_error)?;
    reauthorize(&state, &context, query.company_id).await?;
    value["organizationId"] = json!(org);
    value["companyId"] = json!(company);
    value["snapshot"] = json!(snapshot);
    value["status"] = json!("available");
    value["storage"] = json!("source_review");
    value["dateBasis"] = json!("source_business_date");
    Ok(Json(value))
}

async fn rows_data(
    tx: &Transaction<'_>,
    org: &str,
    company: &str,
    query: &RowsQuery,
    after: i64,
    limit: i64,
) -> Result<(Vec<Value>, Option<i64>), ApiError> {
    if let Some(batch) = query.batch_id {
        if tx.query_opt("SELECT id FROM lumiere_platform.import_review_batch WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND id=$3", &[&org,&company,&batch])
            .await.map_err(storage_error)?.is_none() {
            return Err(ApiError::NotFound("source history dataset not found in this company".into()));
        }
    }
    let sql = format!("{} SELECT id,batch_id,title,target_entity,source_file,source_json,proposed_json,state,revision,confirmed_fields,date_precision,date_from::text,date_to_exclusive::text,date_raw,date_basis
        FROM normalized WHERE ($3::bigint IS NULL OR batch_id=$3)
        AND ($4::text IS NULL OR date_to_exclusive > $4::text::date)
        AND ($5::text IS NULL OR date_from < $5::text::date)
        AND ($6='all' OR ($6='dated' AND date_from IS NOT NULL) OR date_precision=$6)
        AND ($7::text IS NULL OR state=$7) AND id>$8 ORDER BY id LIMIT $9", row_date_sql(query));
    let state = query.state.map(ReviewState::as_str);
    let rows = tx
        .query(
            &sql,
            &[
                &org,
                &company,
                &query.batch_id,
                &query.from,
                &query.to_exclusive,
                &query.date_mode.as_str(),
                &state,
                &after,
                &(limit + 1),
            ],
        )
        .await
        .map_err(storage_error)?;
    let next = if rows.len() > limit as usize {
        rows.get(limit as usize - 1)
            .map(|row| row.get::<_, i64>("id"))
    } else {
        None
    };
    let data = rows.iter().take(limit as usize).map(|row| {
        let source:Value = row.get("source_json");
        json!({"id":row.get::<_,i64>("id").to_string(),"batchId":row.get::<_,i64>("batch_id").to_string(),
            "title":row.get::<_,String>("title"),"targetEntity":row.get::<_,String>("target_entity"),
            "sourceFile":row.get::<_,String>("source_file"),"label":source["label"],"source":source["source"],
            "issue":source["issue"],"fields":source["fields"],"values":row.get::<_,Value>("proposed_json"),
            "state":row.get::<_,String>("state"),"revision":row.get::<_,i32>("revision"),
            "confirmedFields":row.get::<_,Value>("confirmed_fields"),
            "businessDate":{"precision":row.get::<_,String>("date_precision"),"from":row.get::<_,Option<String>>("date_from"),
                "toExclusive":row.get::<_,Option<String>>("date_to_exclusive"),"raw":row.get::<_,Option<String>>("date_raw"),
                "basis":row.get::<_,String>("date_basis")}})
    }).collect();
    Ok((data, next))
}

pub(super) async fn rows(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Query(query): Query<RowsQuery>,
) -> Result<Json<Value>, ApiError> {
    let limit = query.validate()?;
    let context = scope(&state, &session, query.company_id).await?;
    let org = context.organization_id().to_string();
    let company = query.company_id.to_string();
    let pool = pg_pool::required_pool().map_err(storage_error)?;
    let mut client = pool.get().await.map_err(storage_error)?;
    let tx = client
        .build_transaction()
        .isolation_level(IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await
        .map_err(storage_error)?;
    tx.batch_execute("SET LOCAL statement_timeout = '15s'; SET LOCAL jit = off")
        .await
        .map_err(storage_error)?;
    let snapshot = snapshot(&tx, &org, &company).await?;
    if query
        .snapshot
        .as_ref()
        .is_some_and(|expected| expected != &snapshot)
    {
        return Err(changed_inventory());
    }
    let filter = query.filter_key()?;
    let secret = cursor_secret(&state);
    let cursor = CursorScope {
        kind: "rows",
        organization: context.organization_id(),
        company: query.company_id,
        actor: context.actor_identity(),
        placement: context.placement_generation()?.get(),
        filter: &filter,
        snapshot: &snapshot,
    };
    let after = cursor.after(query.cursor.as_deref(), &secret)?;
    let (data, next) = rows_data(&tx, &org, &company, &query, after, limit).await?;
    let next_cursor = next
        .map(|after| cursor.encode(after, &secret))
        .transpose()?;
    tx.commit().await.map_err(storage_error)?;
    reauthorize(&state, &context, query.company_id).await?;
    Ok(Json(
        json!({"organizationId":org,"companyId":company,"data":data,"nextCursor":next_cursor,
        "snapshot":snapshot,"status":"available","storage":"source_review"}),
    ))
}
