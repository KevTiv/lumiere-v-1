//! Durable, tenant-scoped source review documents. These routes never dispatch
//! ERP reducers. Confirmed rows still enter the normal validated import path.
mod model;
#[cfg(test)]
mod postgres_tests;

use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
use stdb_auth::FieldAccessContext;
use tokio_postgres::Row;

use crate::{
    cold_tier::pg_pool, error::ApiError, query_exec::resolve_membership_company_id,
    state::AppState, trusted_context::TrustedOperationContext, web_session::OrgSession,
};
use model::{validate_confirmed_fields, validate_dataset, validate_values, Dataset, ReviewItem};

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Scope {
    company_id: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CreateBody {
    company_id: u64,
    dataset: Dataset,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DecisionBody {
    company_id: u64,
    expected_revision: i32,
    request_key: String,
    state: String,
    reason: String,
    values: BTreeMap<String, Option<String>>,
    #[serde(default)]
    confirmed_fields: Option<BTreeSet<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct BulkDecision {
    item_id: String,
    expected_revision: i32,
    state: String,
    reason: String,
    values: BTreeMap<String, Option<String>>,
    confirmed_fields: BTreeSet<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct BulkBody {
    company_id: u64,
    request_key: String,
    decisions: Vec<BulkDecision>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct HistoryQuery {
    company_id: u64,
    before_revision: Option<i32>,
}

/// Source documents can include fields from several domains. The first release
/// is limited to unrestricted organization administrators, rather than using an
/// import-history grant to bypass a business field restriction.
fn full_administrator(access: &FieldAccessContext) -> bool {
    access
        .role_permissions
        .iter()
        .any(|permission| permission == "*:*")
        && access.field_permissions.is_empty()
        && !access
            .org_permissions
            .iter()
            .any(|permission| !permission.allow)
}

async fn scope(
    state: &AppState,
    session: &crate::session::ApiSession,
    company: u64,
) -> Result<TrustedOperationContext, ApiError> {
    let context = TrustedOperationContext::for_resource_read(state, session)?;
    context.require_current_placement(&state.organization_placements)?;
    if !full_administrator(context.field_access()) {
        return Err(ApiError::Forbidden(
            "Full organization administration access is required for source review".into(),
        ));
    }
    let company = resolve_membership_company_id(
        context.client(),
        context.organization_id(),
        context.actor_identity(),
        Some(company),
        "source review company scope mismatch",
    )
    .await?;
    context.with_company_scope(vec![company])
}

fn item_json(row: &Row) -> Value {
    json!({"id":row.get::<_,String>("id"),"source":row.get::<_,Value>("source_json"),"values":row.get::<_,Value>("proposed_json"),"confirmedFields":row.get::<_,Value>("confirmed_fields"),"state":row.get::<_,String>("state"),"revision":row.get::<_,i32>("revision"),"reviewedBy":row.get::<_,Option<String>>("reviewed_by"),"reviewedAt":row.get::<_,Option<String>>("reviewed_at"),"reason":row.get::<_,Option<String>>("reason")})
}

const ITEM_COLUMNS: &str =
    "id::text,source_json,proposed_json,confirmed_fields,state,revision,reviewed_by,reviewed_at::text,reason";

#[derive(Clone, Copy)]
struct StorageScope<'a> {
    organization: u64,
    company: u64,
    actor: &'a str,
}

async fn list(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Query(query): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    let org = context.organization_id().to_string();
    let company = query.company_id.to_string();
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let rows=client.query("SELECT batch.id::text,batch.title,batch.target_entity,batch.source_file,batch.created_at::text,count(item.id)::int AS total,count(item.id) FILTER (WHERE item.state='needs_review')::int AS pending,count(item.id) FILTER (WHERE item.state='confirmed')::int AS confirmed,count(item.id) FILTER (WHERE item.state='excluded')::int AS excluded FROM lumiere_platform.import_review_batch batch LEFT JOIN lumiere_platform.import_review_item item ON item.batch_id=batch.id AND item.organization_id=batch.organization_id AND item.company_id=batch.company_id WHERE batch.organization_id=$1::text::numeric AND batch.company_id=$2::text::numeric GROUP BY batch.id ORDER BY batch.id DESC LIMIT 100",&[&org,&company]).await.map_err(ApiError::internal)?;
    Ok(Json(
        json!({"data":rows.iter().map(|row|json!({"id":row.get::<_,String>("id"),"title":row.get::<_,String>("title"),"targetEntity":row.get::<_,String>("target_entity"),"sourceFile":row.get::<_,String>("source_file"),"createdAt":row.get::<_,String>("created_at"),"total":row.get::<_,i32>("total"),"pending":row.get::<_,i32>("pending"),"confirmed":row.get::<_,i32>("confirmed"),"excluded":row.get::<_,i32>("excluded")})).collect::<Vec<_>>() }),
    ))
}

async fn create(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<CreateBody>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, body.company_id).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    create_draft(
        &pool,
        StorageScope {
            organization: context.organization_id(),
            company: body.company_id,
            actor: context.actor_identity(),
        },
        &body.dataset,
    )
    .await
}

async fn create_draft(
    pool: &deadpool_postgres::Pool,
    scope: StorageScope<'_>,
    dataset: &Dataset,
) -> Result<Json<Value>, ApiError> {
    validate_dataset(dataset).map_err(ApiError::BadRequest)?;
    let bytes = serde_json::to_vec(dataset).map_err(ApiError::internal)?;
    if bytes.len() > 4_000_000 {
        return Err(ApiError::BadRequest(
            "source review document is too large".into(),
        ));
    }
    let hash = hex::encode(Sha256::digest(bytes));
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let inserted=tx.query_opt("INSERT INTO lumiere_platform.import_review_batch (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7) ON CONFLICT (organization_id,company_id,source_sha256) DO NOTHING RETURNING id",&[&org,&company,&dataset.title,&dataset.target_entity,&dataset.source_file,&hash,&scope.actor]).await.map_err(ApiError::internal)?;
    let (id, replayed) = if let Some(row) = inserted {
        let id: i64 = row.get("id");
        for item in &dataset.items {
            let source = serde_json::to_value(item).map_err(ApiError::internal)?;
            let values = serde_json::to_value(&item.proposed).map_err(ApiError::internal)?;
            tx.execute("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6)",&[&org,&company,&id,&item.key,&source,&values]).await.map_err(ApiError::internal)?;
        }
        (id, false)
    } else {
        let row=tx.query_one("SELECT id FROM lumiere_platform.import_review_batch WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND source_sha256=$3",&[&org,&company,&hash]).await.map_err(ApiError::internal)?;
        (row.get("id"), true)
    };
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(
        json!({"id":id.to_string(),"replayed":replayed,"status":"saved_for_review"}),
    ))
}

async fn read(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(id): Path<i64>,
    Query(query): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    let org = context.organization_id().to_string();
    let company = query.company_id.to_string();
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let batch=client.query_opt("SELECT id::text,title,target_entity,source_file,source_sha256 FROM lumiere_platform.import_review_batch WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND id=$3",&[&org,&company,&id]).await.map_err(ApiError::internal)?.ok_or_else(||ApiError::NotFound("source review not found".into()))?;
    let items=client.query(&format!("SELECT {ITEM_COLUMNS} FROM lumiere_platform.import_review_item WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND batch_id=$3 ORDER BY id LIMIT 1000"),&[&org,&company,&id]).await.map_err(ApiError::internal)?;
    let history=client.query(&format!("{HISTORY_SELECT} WHERE decision.organization_id=$1::text::numeric AND decision.company_id=$2::text::numeric AND item.batch_id=$3 ORDER BY decision.id DESC LIMIT 100"),&[&org,&company,&id]).await.map_err(ApiError::internal)?;
    Ok(Json(
        json!({"id":batch.get::<_,String>("id"),"title":batch.get::<_,String>("title"),"targetEntity":batch.get::<_,String>("target_entity"),"sourceFile":batch.get::<_,String>("source_file"),"sourceSha256":batch.get::<_,String>("source_sha256"),"items":items.iter().map(item_json).collect::<Vec<_>>(),"history":history.iter().map(history_json).collect::<Vec<_>>() }),
    ))
}

async fn decide(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path((batch, id)): Path<(i64, i64)>,
    Json(body): Json<DecisionBody>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, body.company_id).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    save_decision(
        &pool,
        StorageScope {
            organization: context.organization_id(),
            company: body.company_id,
            actor: context.actor_identity(),
        },
        batch,
        id,
        &body,
    )
    .await
}

fn validate_decision_request(body: &DecisionBody, company: u64) -> Result<(), ApiError> {
    if body.company_id != company {
        return Err(ApiError::BadRequest(
            "source review company scope mismatch".into(),
        ));
    }
    if body.expected_revision < 1
        || body.expected_revision == i32::MAX
        || !request_key(&body.request_key, 100)
    {
        return Err(ApiError::BadRequest(
            "invalid review revision or request key".into(),
        ));
    }
    Ok(())
}

fn request_key(value: &str, maximum: usize) -> bool {
    (16..=maximum).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

async fn save_decision(
    pool: &deadpool_postgres::Pool,
    scope: StorageScope<'_>,
    batch: i64,
    id: i64,
    body: &DecisionBody,
) -> Result<Json<Value>, ApiError> {
    validate_decision_request(body, scope.company)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let result = save_decision_in_transaction(&tx, scope, batch, id, body).await?;
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(result))
}

async fn save_decision_in_transaction(
    tx: &tokio_postgres::Transaction<'_>,
    scope: StorageScope<'_>,
    batch: i64,
    id: i64,
    body: &DecisionBody,
) -> Result<Value, ApiError> {
    validate_decision_request(body, scope.company)?;
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let row=tx.query_opt(&format!("SELECT {ITEM_COLUMNS} FROM lumiere_platform.import_review_item WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND batch_id=$3 AND id=$4 FOR UPDATE"),&[&org,&company,&batch,&id]).await.map_err(ApiError::internal)?.ok_or_else(||ApiError::NotFound("source review item not found".into()))?;
    let source: ReviewItem =
        serde_json::from_value(row.get("source_json")).map_err(ApiError::internal)?;
    validate_values(&source, &body.values, &body.state, &body.reason)
        .map_err(ApiError::BadRequest)?;
    // Older clients confirm the whole row. A new partial decision names its
    // fields explicitly; changing an old confirmed value clears that evidence.
    let fields = if let Some(fields) = &body.confirmed_fields {
        fields.clone()
    } else if body.state == "confirmed" {
        body.values
            .iter()
            .filter_map(|(key, value)| {
                value
                    .as_ref()
                    .filter(|value| !value.trim().is_empty())
                    .map(|_| key.clone())
            })
            .collect()
    } else {
        let previous: BTreeSet<String> =
            serde_json::from_value(row.get("confirmed_fields")).map_err(ApiError::internal)?;
        let previous_values: BTreeMap<String, Option<String>> =
            serde_json::from_value(row.get("proposed_json")).map_err(ApiError::internal)?;
        previous
            .into_iter()
            .filter(|key| previous_values.get(key) == body.values.get(key))
            .collect()
    };
    validate_confirmed_fields(&source, &body.values, &fields, &body.state, &body.reason)
        .map_err(ApiError::BadRequest)?;
    let values = serde_json::to_value(&body.values).map_err(ApiError::internal)?;
    let confirmed_fields = serde_json::to_value(&fields).map_err(ApiError::internal)?;
    if let Some(prior)=tx.query_opt("SELECT item_id,revision,proposed_json,confirmed_fields,state,reason,actor_identity FROM lumiere_platform.import_review_decision WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND request_key=$3",&[&org,&company,&body.request_key]).await.map_err(ApiError::internal)? {
        if prior.get::<_,i64>("item_id")!=id || prior.get::<_,i32>("revision")!=body.expected_revision+1 || prior.get::<_,Value>("proposed_json")!=values || prior.get::<_,Value>("confirmed_fields")!=confirmed_fields || prior.get::<_,String>("state")!=body.state || prior.get::<_,String>("reason")!=body.reason || prior.get::<_,String>("actor_identity")!=scope.actor { return Err(ApiError::Conflict("request key was already used for another review decision".into())); }
        return Ok(json!({"item":item_json(&row),"replayed":true}));
    }
    if row.get::<_, i32>("revision") != body.expected_revision {
        return Err(ApiError::Conflict(
            "This item changed. Reload the saved review before applying your correction.".into(),
        ));
    }
    let revision = body.expected_revision + 1;
    tx.execute("INSERT INTO lumiere_platform.import_review_decision (organization_id,company_id,item_id,revision,request_key,proposed_json,confirmed_fields,state,reason,actor_identity) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8,$9,$10)",&[&org,&company,&id,&revision,&body.request_key,&values,&confirmed_fields,&body.state,&body.reason,&scope.actor]).await.map_err(ApiError::internal)?;
    let updated=tx.query_one(&format!("UPDATE lumiere_platform.import_review_item SET proposed_json=$5,state=$6,revision=$7,reviewed_by=$8,reviewed_at=now(),reason=$9,confirmed_fields=$10 WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND batch_id=$3 AND id=$4 RETURNING {ITEM_COLUMNS}"),&[&org,&company,&batch,&id,&values,&body.state,&revision,&scope.actor,&body.reason,&confirmed_fields]).await.map_err(ApiError::internal)?;
    Ok(json!({"item":item_json(&updated),"replayed":false}))
}

async fn decide_bulk(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(batch): Path<i64>,
    Json(body): Json<BulkBody>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, body.company_id).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    save_bulk(
        &pool,
        StorageScope {
            organization: context.organization_id(),
            company: body.company_id,
            actor: context.actor_identity(),
        },
        batch,
        &body,
    )
    .await
}

async fn save_bulk(
    pool: &deadpool_postgres::Pool,
    scope: StorageScope<'_>,
    batch: i64,
    body: &BulkBody,
) -> Result<Json<Value>, ApiError> {
    if body.company_id != scope.company
        || !request_key(&body.request_key, 70)
        || body.decisions.is_empty()
        || body.decisions.len() > 1000
    {
        return Err(ApiError::BadRequest("invalid bulk review request".into()));
    }
    let mut decisions = BTreeMap::new();
    for decision in &body.decisions {
        let id = decision
            .item_id
            .parse::<i64>()
            .ok()
            .filter(|id| *id > 0)
            .ok_or_else(|| ApiError::BadRequest("invalid review item".into()))?;
        if decision.item_id != id.to_string() || decisions.insert(id, decision).is_some() {
            return Err(ApiError::BadRequest(
                "duplicate or invalid review item".into(),
            ));
        }
    }
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let lock_scope = format!("source-review-bulk:{org}:{company}");
    tx.query_one(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        &[&lock_scope, &body.request_key],
    )
    .await
    .map_err(ApiError::internal)?;
    let prefix = format!("{}-%", body.request_key);
    let prior = tx.query("SELECT item_id FROM lumiere_platform.import_review_decision WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND request_key LIKE $3", &[&org,&company,&prefix]).await.map_err(ApiError::internal)?;
    if !prior.is_empty() {
        let prior_ids: BTreeSet<i64> = prior.iter().map(|row| row.get("item_id")).collect();
        if prior_ids != decisions.keys().copied().collect() {
            return Err(ApiError::Conflict(
                "request key was already used for a different bulk preview".into(),
            ));
        }
    }
    let mut items = Vec::with_capacity(decisions.len());
    // Stable lock order, one transaction and exact revisions bind the save to
    // the preview. A stale row or invalid value rolls back the complete batch.
    for (id, decision) in decisions {
        let individual = DecisionBody {
            company_id: body.company_id,
            expected_revision: decision.expected_revision,
            request_key: format!("{}-{id}", body.request_key),
            state: decision.state.clone(),
            reason: decision.reason.clone(),
            values: decision.values.clone(),
            confirmed_fields: Some(decision.confirmed_fields.clone()),
        };
        items.push(save_decision_in_transaction(&tx, scope, batch, id, &individual).await?);
    }
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(json!({"results":items})))
}

const HISTORY_SELECT: &str = "SELECT decision.item_id::text,decision.revision,decision.proposed_json,decision.confirmed_fields,decision.state,decision.reason,decision.actor_identity,decision.created_at::text,coalesce(previous.proposed_json,item.source_json->'proposed') AS previous_values,coalesce(previous.confirmed_fields,'[]'::jsonb) AS previous_confirmed_fields,coalesce(previous.state,'needs_review') AS previous_state FROM lumiere_platform.import_review_decision decision JOIN lumiere_platform.import_review_item item ON item.id=decision.item_id AND item.organization_id=decision.organization_id AND item.company_id=decision.company_id LEFT JOIN lumiere_platform.import_review_decision previous ON previous.item_id=decision.item_id AND previous.organization_id=decision.organization_id AND previous.company_id=decision.company_id AND previous.revision=decision.revision-1";

fn history_json(row: &Row) -> Value {
    json!({"itemId":row.get::<_,String>("item_id"),"revision":row.get::<_,i32>("revision"),"values":row.get::<_,Value>("proposed_json"),"confirmedFields":row.get::<_,Value>("confirmed_fields"),"state":row.get::<_,String>("state"),"reason":row.get::<_,String>("reason"),"actor":row.get::<_,String>("actor_identity"),"createdAt":row.get::<_,String>("created_at"),"previousValues":row.get::<_,Value>("previous_values"),"previousConfirmedFields":row.get::<_,Value>("previous_confirmed_fields"),"previousState":row.get::<_,String>("previous_state")})
}

async fn history(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path((batch, item)): Path<(i64, i64)>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    let org = context.organization_id().to_string();
    let company = query.company_id.to_string();
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let exists = client.query_opt("SELECT id FROM lumiere_platform.import_review_item WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND batch_id=$3 AND id=$4", &[&org,&company,&batch,&item]).await.map_err(ApiError::internal)?;
    if exists.is_none() {
        return Err(ApiError::NotFound("source review item not found".into()));
    }
    let before = query.before_revision.unwrap_or(i32::MAX);
    if before < 2 {
        return Err(ApiError::BadRequest("invalid history cursor".into()));
    }
    let rows=client.query(&format!("{HISTORY_SELECT} WHERE decision.organization_id=$1::text::numeric AND decision.company_id=$2::text::numeric AND item.batch_id=$3 AND item.id=$4 AND decision.revision<$5 ORDER BY decision.revision DESC LIMIT 101"),&[&org,&company,&batch,&item,&before]).await.map_err(ApiError::internal)?;
    let next = if rows.len() > 100 {
        rows.get(99).map(|row| row.get::<_, i32>("revision"))
    } else {
        None
    };
    Ok(Json(
        json!({"history":rows.iter().take(100).map(history_json).collect::<Vec<_>>(),"nextBeforeRevision":next}),
    ))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/import-reviews", get(list).post(create))
        .route("/import-reviews/:id", get(read))
        .route("/import-reviews/:batch/items/:item", patch(decide))
        .route("/import-reviews/:batch/decisions", post(decide_bulk))
        .route("/import-reviews/:batch/items/:item/history", get(history))
        .layer(DefaultBodyLimit::max(5_000_000))
        .layer(axum::middleware::map_response(
            |mut response: axum::response::Response| async move {
                response.headers_mut().insert(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("private, no-store"),
                );
                response
            },
        ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn review_requires_unrestricted_organization_administration() {
        let mut access = FieldAccessContext::default();
        assert!(!full_administrator(&access));
        access.role_permissions = vec!["import_job:read".into()];
        assert!(!full_administrator(&access));
        access.role_permissions = vec!["*:*".into()];
        assert!(full_administrator(&access));
        access.org_permissions.push(stdb_auth::ActionPermission {
            resource: "account_move".into(),
            action: "read".into(),
            allow: false,
        });
        assert!(!full_administrator(&access));
    }
}
