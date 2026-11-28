//! Durable execution of explicitly approved import groups.
mod storage;
mod worker;

use std::{collections::BTreeSet, sync::Arc};

use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{scope, task_company_scope, tasks, Scope, StorageScope};
use crate::{
    cold_tier::pg_pool, error::ApiError, platform_control, session::ApiSession, state::AppState,
    trusted_context::TrustedOperationContext, web_session::OrgSession,
};
pub(crate) use worker::start;

pub(super) struct RunAuthority {
    pub session: ApiSession,
    pub context: TrustedOperationContext,
    pub organization_id: u64,
    pub company_id: u64,
    pub actor: String,
    pub creator: String,
}

impl RunAuthority {
    fn storage_scope(&self) -> StorageScope<'_> {
        StorageScope {
            organization: self.organization_id,
            company: self.company_id,
            actor: &self.creator,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SourceRevision {
    #[serde(deserialize_with = "decimal_id", serialize_with = "serialize_id")]
    pub batch_id: i64,
    #[serde(deserialize_with = "decimal_id", serialize_with = "serialize_id")]
    pub item_id: i64,
    pub revision: i32,
}

fn serialize_id<S: serde::Serializer>(id: &i64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_str(id)
}

fn decimal_id<'de, D: Deserializer<'de>>(de: D) -> Result<i64, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Id {
        Number(i64),
        Text(String),
    }
    let id = match Id::deserialize(de)? {
        Id::Number(id) if (1..=9_007_199_254_740_991).contains(&id) => Some(id),
        Id::Text(raw) => raw
            .parse::<i64>()
            .ok()
            .filter(|id| *id > 0 && id.to_string() == raw),
        _ => None,
    };
    id.ok_or_else(|| serde::de::Error::custom("invalid source ID"))
}

pub(super) struct RunGroup {
    pub task_id: String,
    pub id: String,
    pub adapter: String,
    pub config: Value,
    pub rows: Vec<SourceRevision>,
}

pub(super) struct RunChunk {
    pub id: String,
    pub ordinal: i32,
    pub rows: Vec<SourceRevision>,
}

pub(super) struct ChunkReceipt {
    /// Operator-visible verified outcomes, without input bytes or credentials.
    pub result: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Approval {
    company_id: u64,
    request_id: String,
    adapter: String,
    config: Value,
    rows: Vec<SourceRevision>,
    #[serde(default)]
    depends_on: Vec<String>,
}

fn hex_key(value: &str, size: usize) -> bool {
    value.len() == size
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn hash(value: &Value) -> Result<String, ApiError> {
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(value).map_err(ApiError::internal)?,
    )))
}

impl Approval {
    fn plan(
        &self,
        scope: StorageScope<'_>,
        task: String,
    ) -> Result<(RunGroup, Vec<RunChunk>), ApiError> {
        if !hex_key(&task, 32)
            || !hex_key(&self.request_id, 32)
            || self.rows.is_empty()
            || self.rows.len() > 2_000
            || self.rows.iter().any(|row| row.revision <= 0)
            || self
                .rows
                .iter()
                .map(|row| row.item_id)
                .collect::<BTreeSet<_>>()
                .len()
                != self.rows.len()
            || self.depends_on.len() > 16
            || self.depends_on.iter().any(|id| !hex_key(id, 64))
            || self.depends_on.iter().collect::<BTreeSet<_>>().len() != self.depends_on.len()
            || !self.config.is_object()
            || serde_json::to_vec(&self.config)
                .map_err(ApiError::internal)?
                .len()
                > 2_000_000
            || !matches!(
                self.adapter.as_str(),
                "historical_journal" | "shop_sales" | "sales" | "warehouse" | "tracked_master_data"
            )
        {
            return Err(ApiError::BadRequest("invalid approved import group".into()));
        }
        let id = hash(&json!([
            "import-run/v1",
            scope.organization.to_string(),
            scope.company.to_string(),
            scope.actor,
            task,
            self.adapter,
            self.config,
            self.rows,
            self.depends_on
        ]))?;
        let slices: Vec<_> = if sql_only(&self.adapter) {
            self.rows
                .chunk_by(|a, b| a.batch_id == b.batch_id)
                .flat_map(|rows| rows.chunks(200))
                .collect()
        } else {
            self.rows.chunks(200).collect()
        };
        if slices.len() > 32 || (self.adapter == "historical_journal" && slices.len() != 1) {
            return Err(ApiError::BadRequest(
                "too many chunks for one approved group".into(),
            ));
        }
        let chunks = slices
            .into_iter()
            .enumerate()
            .map(|(ordinal, rows)| {
                let digest = hash(&json!(["import-run-chunk/v1", id, ordinal, rows]))?;
                Ok(RunChunk {
                    id: digest[..32].to_owned(),
                    ordinal: ordinal as i32,
                    rows: rows.to_vec(),
                })
            })
            .collect::<Result<Vec<_>, ApiError>>()?;
        Ok((
            RunGroup {
                task_id: task,
                id,
                adapter: self.adapter.clone(),
                config: self.config.clone(),
                rows: self.rows.clone(),
            },
            chunks,
        ))
    }
}

fn sql_only(key: &str) -> bool {
    matches!(key, "shop_sales" | "sales" | "warehouse")
}

async fn validate(
    state: &AppState,
    authority: &RunAuthority,
    group: &RunGroup,
) -> Result<(), ApiError> {
    match group.adapter.as_str() {
        "shop_sales" | "sales" | "warehouse" => {
            super::module_backfill::validate_durable_group(authority, group)
        }
        "historical_journal" => {
            super::workflow::validate_durable_group(state, authority, group).await
        }
        "tracked_master_data" => {
            super::durable_master_data::validate(state, authority, group).await
        }
        _ => Err(ApiError::BadRequest("unsupported durable adapter".into())),
    }
}

async fn execute(
    state: &AppState,
    authority: &RunAuthority,
    group: &RunGroup,
    chunk: &RunChunk,
) -> Result<ChunkReceipt, ApiError> {
    match group.adapter.as_str() {
        "shop_sales" | "sales" | "warehouse" => {
            super::module_backfill::execute_chunk(state, authority, group, chunk).await
        }
        "historical_journal" => {
            super::workflow::execute_chunk(state, authority, group, chunk).await
        }
        "tracked_master_data" => {
            super::durable_master_data::execute_chunk(state, authority, group, chunk).await
        }
        _ => Err(ApiError::BadRequest("unsupported durable adapter".into())),
    }
}

async fn authorize(
    state: &AppState,
    session: ApiSession,
    company_id: u64,
    task: &str,
) -> Result<RunAuthority, ApiError> {
    let context = scope(state, &session, company_id).await?;
    let organization_id = context.organization_id();
    let actor = context.actor_identity().to_owned();
    let viewer = StorageScope {
        organization: organization_id,
        company: company_id,
        actor: &actor,
    };
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let (creator, _) = tasks::handoff::read_for(pool, &context, viewer, task).await?;
    Ok(RunAuthority {
        session,
        context,
        organization_id,
        company_id,
        actor,
        creator,
    })
}

async fn approve(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(task): Path<String>,
    Json(mut body): Json<Approval>,
) -> Result<Json<Value>, ApiError> {
    let authority = authorize(&state, session, body.company_id, &task).await?;
    body.depends_on.sort_unstable();
    let scope = authority.storage_scope();
    let (group, chunks) = body.plan(scope, task)?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    if let Some(saved) = storage::replay(pool, scope, &group, &body.request_id).await? {
        return Ok(Json(saved));
    }
    validate(&state, &authority, &group).await?;
    let credential =
        platform_control::find_user_credential_by_stdb_identity(pool, &authority.actor)
            .await
            .map_err(ApiError::internal)?
            .ok_or_else(|| {
                ApiError::Forbidden("this user has no durable import identity".into())
            })?;
    let platform_user: String = credential.get("platform_user_id");
    crate::session::load_stored_session(
        &state,
        &authority.actor,
        authority.organization_id,
        &platform_user,
    )
    .await?;
    storage::approve(pool, &authority, &group, &chunks, &body, &platform_user).await?;
    storage::project(pool, scope, &group.task_id, Some(&group.id))
        .await
        .map(Json)
}

async fn list(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(task): Path<String>,
    Query(query): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    let context = task_company_scope(&state, &session, query.company_id).await?;
    let viewer = StorageScope {
        organization: context.organization_id(),
        company: query.company_id,
        actor: context.actor_identity(),
    };
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let (creator, _) = tasks::handoff::read_for(pool, &context, viewer, &task).await?;
    let owner = StorageScope {
        actor: &creator,
        ..viewer
    };
    storage::project(pool, owner, &task, None).await.map(Json)
}

async fn detail(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path((task, run)): Path<(String, String)>,
    Query(query): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    let authority = authorize(&state, session, query.company_id, &task).await?;
    storage::project(
        pg_pool::required_pool().map_err(ApiError::unavailable)?,
        authority.storage_scope(),
        &task,
        Some(&run),
    )
    .await
    .map(Json)
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/import-tasks/:task/runs", get(list).post(approve))
        .route("/import-tasks/:task/runs/:run", get(detail))
        .layer(DefaultBodyLimit::max(2_250_000))
}
