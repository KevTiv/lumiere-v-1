//! Explicit actor-authorized indexing. Clients select identities, never text.
use crate::{
    ai_agent::{ensure_allowed_action, resolve_surface_agent, ResolvedAgentConfig},
    error::{AppError, AppResult},
    harness::{
        entity_registry::lookup_entity_spec, fetch_authorized_live_snapshots,
        resolve_snapshot_candidates, ActorCredentials, EntityRef,
    },
    non_llm_spend::{execute_metered, MeteredResult, MeteredScope, MeteredUnit},
    rig_agent::{
        activity_fingerprint, activity_for_snapshot, company_reindex_activity, ContextHit,
    },
    state::AppState,
};
use anyhow::{Context, Result};
use axum::{extract::State, Json};
use lumiere_auth_context::CapabilityGrantBounds;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
const MAX_REFERENCES: usize = 8;
const MAX_PROJECTION_BYTES: usize = 64 * 1024;
const INDEX_CAPABILITY: &str = "ai.context.index";
const RETRIEVE_CAPABILITY: &str = "ai.evidence.retrieve";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextSearchRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub query: String,
    pub top_k: Option<usize>,
    pub stdb_token: String,
    pub identity_hex: String,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextCoverageRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub stdb_token: String,
    pub identity_hex: String,
}
#[derive(Debug, Serialize)]
pub struct ContextCoverageResponse {
    pub indexed_points: u64,
}
#[derive(Debug, Serialize)]
pub struct ContextSearchResponse {
    pub hits: Vec<ContextHit>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivityReference {
    pub resource_kind: String,
    pub resource_id: String,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextIngestRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub resources: Vec<ActivityReference>,
    pub stdb_token: String,
    pub identity_hex: String,
}
#[derive(Debug, Serialize)]
pub struct ContextIngestResponse {
    pub indexed: usize,
    pub unchanged: usize,
    pub withheld: usize,
    pub automatic_backfill: bool,
}
fn unavailable(message: &str) -> AppError {
    AppError::Unavailable(message.into())
}
pub(crate) fn request_digest(
    label: &str,
    org: u64,
    company: u64,
    actor: &str,
    model: &str,
    bytes: &[u8],
) -> String {
    let mut hasher = Sha256::new();
    for part in [
        label.as_bytes(),
        &org.to_le_bytes(),
        &company.to_le_bytes(),
        actor.as_bytes(),
        model.as_bytes(),
        bytes,
    ] {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    format!("context:{label}:{:x}", hasher.finalize())
}
fn references(resources: &[ActivityReference]) -> Result<Vec<EntityRef>> {
    if resources.is_empty() || resources.len() > MAX_REFERENCES {
        anyhow::bail!("activity indexing requires one to eight references");
    }
    let mut seen = HashSet::new();
    resources
        .iter()
        .map(|r| {
            let spec = lookup_entity_spec(&r.resource_kind)
                .context("unsupported activity resource kind")?;
            let id = r
                .resource_id
                .parse::<u64>()
                .context("invalid activity identity")?;
            if r.resource_kind != spec.entity_type || id == 0 || r.resource_id != id.to_string() {
                anyhow::bail!(
                    "activity references require canonical kind and positive u64 decimal identity"
                );
            }
            if !seen.insert((spec.entity_type, id)) {
                anyhow::bail!("duplicate activity identity");
            }
            Ok(EntityRef {
                entity_type: spec.entity_type.to_owned(),
                entity_id: id,
                priority: 1.0,
            })
        })
        .collect()
}
#[derive(Debug, thiserror::Error)]
#[error("query embedding failed at {0}")]
pub(super) struct QueryEmbeddingStage(pub &'static str);

/// Reuses one settled vector for the same actor/model/query, including lost replies.
/// Callers may reuse it across document and activity ANN, but still reauthorize hits.
pub(crate) async fn admitted_query_vector(
    state: &AppState,
    actor: &ActorCredentials,
    org: u64,
    company: u64,
    query: &str,
    _operation_ref: &str,
    agent: Option<&ResolvedAgentConfig>,
    generation_skill_key: Option<&str>,
) -> Result<Vec<f32>> {
    if query.trim().is_empty() || query.len() > 8192 || !state.config.embedding_enabled() {
        return Err(QueryEmbeddingStage("configuration_or_input_bound").into());
    }
    let bounds = super::evidence::require_scoped_capability_grant(
        state,
        &actor.identity_hex,
        &actor.stdb_token,
        org,
        company,
        RETRIEVE_CAPABILITY,
    )
    .await
    .context(QueryEmbeddingStage("evidence_grant"))?;
    if bounds.max_rows == 0 || bounds.max_bytes < query.len() as u64 {
        return Err(QueryEmbeddingStage("evidence_grant_bound").into());
    }
    state
        .vector_store
        .check_ready()
        .await
        .context(QueryEmbeddingStage("document_collection"))?;
    state
        .rig
        .check_ready()
        .await
        .context(QueryEmbeddingStage("activity_collection"))?;
    let resolved;
    let agent = match agent {
        Some(agent) => agent,
        None => {
            resolved = resolve_surface_agent(
                state.stdb.as_ref(),
                org,
                company,
                "embedding_query",
                None,
                None,
                state.config.ollama_supports_tool_calling,
            )
            .await
            .context(QueryEmbeddingStage("embedding_agent"))?;
            &resolved
        }
    };
    ensure_allowed_action(agent, "embedding_query").context(QueryEmbeddingStage("agent_action"))?;
    let reader = state
        .spend_read_stdb
        .as_deref()
        .context(QueryEmbeddingStage("spend_reader"))?;
    let model = state.config.embedding_model_name();
    let scope = MeteredScope {
        organization_id: org,
        company_id: company,
        agent_id: agent.agent_id,
        run_id: 0,
        actor_identity: actor.identity_hex.clone(),
        request_key: request_digest(
            "query",
            org,
            company,
            &actor.identity_hex,
            &model,
            query.as_bytes(),
        ),
        model,
        unit: MeteredUnit::Tokens,
        allowance: u32::try_from(query.len() + 128)?,
    };
    if let Some(key) = generation_skill_key {
        crate::orchestrator::skill_access::ActorSkillAccess::new(
            state,
            org,
            company,
            &actor.stdb_token,
            &actor.identity_hex,
        )?
        .require(key)
        .await?;
    }
    execute_query_embedding(
        state.stdb.as_ref(),
        reader,
        state.providers.embedder.as_ref(),
        scope,
        query,
        generation_skill_key,
    )
    .await
}

/// The paid embedding boundary; the skill key is supplied only by server code.
async fn execute_query_embedding(
    stdb: &stdb_client::StdbClient,
    reader: &stdb_client::StdbClient,
    embedder: &dyn crate::providers::EmbedProvider,
    scope: MeteredScope,
    query: &str,
    generation_skill_key: Option<&str>,
) -> Result<Vec<f32>> {
    if let Some(key) = generation_skill_key {
        crate::orchestrator::skill_loader::require_enabled_skill(
            stdb,
            scope.organization_id,
            scope.company_id,
            key,
        )
        .await
        .context(QueryEmbeddingStage("skill_recheck"))?;
    }
    execute_metered(stdb, reader, scope, || async {
        let response = embedder.embed_batch_with_usage(&[query.to_owned()]).await?;
        let units = response
            .input_tokens
            .context("embedding provider omitted actual token usage")?;
        let mut vectors = response.vectors;
        if vectors.len() != 1 {
            anyhow::bail!("embedding provider returned unexpected vector count");
        }
        Ok(MeteredResult {
            value: vectors.remove(0),
            units,
        })
    })
    .await
    .context(QueryEmbeddingStage("metered_execution"))
}

pub async fn post_search(
    State(state): State<AppState>,
    Json(req): Json<ContextSearchRequest>,
) -> AppResult<Json<ContextSearchResponse>> {
    let actor = ActorCredentials::new(req.stdb_token, req.identity_hex)
        .map_err(|_| AppError::Forbidden("authenticated actor required".into()))?;
    state
        .rig
        .check_ready()
        .await
        .map_err(|_| unavailable("activity index unavailable"))?;
    let vector = admitted_query_vector(
        &state,
        &actor,
        req.org_id,
        req.company_id,
        &req.query,
        "context_search",
        None,
        None,
    )
    .await
    .map_err(|_| unavailable("query embedding admission unavailable"))?;
    let bounds = super::evidence::require_scoped_capability_grant(
        &state,
        &actor.identity_hex,
        &actor.stdb_token,
        req.org_id,
        req.company_id,
        RETRIEVE_CAPABILITY,
    )
    .await?;
    let top_k = req
        .top_k
        .unwrap_or(8)
        .clamp(1, 50)
        .min(bounds.max_rows as usize);
    if top_k == 0 {
        return Err(AppError::Forbidden(
            "activity retrieval not permitted".into(),
        ));
    }
    let mut hits =
        search_authorized_activity(&state, &actor, req.org_id, req.company_id, vector, top_k)
            .await
            .map_err(|_| unavailable("authorized activity retrieval unavailable"))?;
    while serde_json::to_vec(&hits)
        .map_err(|_| unavailable("activity encoding failed"))?
        .len() as u64
        > bounds.max_bytes
    {
        if hits.pop().is_none() {
            break;
        }
    }
    Ok(Json(ContextSearchResponse { hits }))
}

/// Search distinct company and actor lanes so unapproved shared candidates
/// cannot consume the actor's private candidate slots. Only authorized hits
/// can participate in the final ranking.
pub(crate) async fn search_authorized_activity(
    state: &AppState,
    actor: &ActorCredentials,
    org: u64,
    company: u64,
    vector: Vec<f32>,
    top_k: usize,
) -> Result<Vec<ContextHit>> {
    let (private, shared) = tokio::try_join!(
        state.rig.search_scope_with_vector(
            org,
            company,
            &actor.identity_hex,
            vector.clone(),
            top_k
        ),
        state
            .rig
            .search_company_reindex_with_vector(org, company, vector, top_k),
    )?;
    if private.is_empty() && shared.is_empty() {
        return Ok(Vec::new());
    }
    let bounds = activity_read_bounds(state, actor, org, company).await?;
    let private_count = (bounds.max_rows.min(50) as usize).min(private.len());
    let shared_count = bounds.max_rows.min(50) as usize - private_count;
    let (mut private, shared) = tokio::try_join!(
        resolve_private_activity_hits(state, actor, org, company, private, private_count),
        reauthorize_company_hits(state, actor, org, company, shared, shared_count),
    )?;
    private.extend(shared);
    private.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut seen = HashSet::new();
    private.retain(|hit| {
        seen.insert((
            hit.record.semantic.resource_kind.clone(),
            hit.record.semantic.resource_id.clone(),
        ))
    });
    private.truncate(top_k);
    truncate_activity_bytes(&mut private, bounds.max_bytes)?;
    Ok(private)
}

async fn reauthorize_company_hits(
    state: &AppState,
    actor: &ActorCredentials,
    org: u64,
    company: u64,
    mut hits: Vec<ContextHit>,
    limit: usize,
) -> Result<Vec<ContextHit>> {
    let model = state.config.embedding_model_name();
    hits.retain(|hit| {
        hit.record.is_company_reindex()
            && hit.record.semantic.organization_id == org
            && hit.record.semantic.company_id == company
            && hit.record.semantic.embedding_model == model
    });
    hits.truncate(limit);
    if hits.is_empty() {
        return Ok(hits);
    }
    let refs = resolve_snapshot_candidates(None, &[], &hits, hits.len());
    let snapshots = fetch_authorized_live_snapshots(state, actor, org, company, &refs).await?;
    // A reader has no authority to remove or repair another principal's
    // shared point. Missing, redacted, and stale candidates simply disappear.
    hits.retain(|hit| {
        snapshots
            .iter()
            .any(|snapshot| shared_hit_matches_snapshot(hit, org, company, snapshot))
    });
    Ok(hits)
}

fn shared_hit_matches_snapshot(
    hit: &ContextHit,
    org: u64,
    company: u64,
    snapshot: &crate::harness::LiveSnapshot,
) -> bool {
    let record = &hit.record.semantic;
    record.resource_kind == snapshot.entity_type
        && record.resource_id == snapshot.entity_id.to_string()
        && company_reindex_activity(
            org,
            company,
            &snapshot.entity_type,
            snapshot.entity_id,
            &snapshot.row,
        )
        .is_some_and(|activity| activity_fingerprint(&activity) == record.source_fingerprint)
}

/// Resolve current owner data and require the exact actor-filtered source fingerprint.
/// Missing, revoked, deleted and changed references are excluded and removed.
pub(crate) async fn reauthorize_activity_hits(
    state: &AppState,
    actor: &ActorCredentials,
    org: u64,
    company: u64,
    hits: Vec<ContextHit>,
) -> Result<Vec<ContextHit>> {
    if hits.is_empty() {
        return Ok(Vec::new());
    }
    let bounds = activity_read_bounds(state, actor, org, company).await?;
    let limit = (bounds.max_rows.min(50) as usize).min(hits.len());
    let mut hits = resolve_private_activity_hits(state, actor, org, company, hits, limit).await?;
    truncate_activity_bytes(&mut hits, bounds.max_bytes)?;
    Ok(hits)
}

async fn activity_read_bounds(
    state: &AppState,
    actor: &ActorCredentials,
    org: u64,
    company: u64,
) -> AppResult<CapabilityGrantBounds> {
    super::evidence::require_scoped_capability_grant(
        state,
        &actor.identity_hex,
        &actor.stdb_token,
        org,
        company,
        RETRIEVE_CAPABILITY,
    )
    .await
}

fn truncate_activity_bytes(hits: &mut Vec<ContextHit>, max_bytes: u64) -> Result<()> {
    while !hits.is_empty() && serde_json::to_vec(&hits)?.len() as u64 > max_bytes {
        hits.pop();
    }
    Ok(())
}

async fn resolve_private_activity_hits(
    state: &AppState,
    actor: &ActorCredentials,
    org: u64,
    company: u64,
    mut hits: Vec<ContextHit>,
    limit: usize,
) -> Result<Vec<ContextHit>> {
    anyhow::ensure!(hits.len() <= 50, "activity candidate bound exceeded");
    let model = state.config.embedding_model_name();
    hits.retain(|hit| {
        hit.record.actor_identity == actor.identity_hex
            && !hit.record.is_company_reindex()
            && hit.record.semantic.organization_id == org
            && hit.record.semantic.company_id == company
            && hit.record.semantic.embedding_model == model
    });
    hits.truncate(limit);
    if hits.is_empty() {
        return Ok(hits);
    }
    let refs = resolve_snapshot_candidates(None, &[], &hits, limit);
    let snapshots = fetch_authorized_live_snapshots(state, actor, org, company, &refs).await?;
    let allowed: HashSet<_> = snapshots
        .iter()
        .filter_map(|snapshot| {
            let activity =
                activity_for_snapshot(org, company, &actor.identity_hex, snapshot).ok()?;
            Some((
                activity.entity_type.clone(),
                activity.entity_id.clone(),
                activity_fingerprint(&activity),
            ))
        })
        .collect();
    let mut accepted = Vec::with_capacity(hits.len());
    for hit in hits {
        let record = &hit.record.semantic;
        if allowed.contains(&(
            record.resource_kind.clone(),
            record.resource_id.clone(),
            record.source_fingerprint.clone(),
        )) {
            accepted.push(hit);
        } else {
            state
                .rig
                .delete_reference(
                    org,
                    company,
                    &actor.identity_hex,
                    &record.resource_kind,
                    &record.resource_id,
                )
                .await?;
        }
    }
    Ok(accepted)
}

/// Per-reference result of one ingest pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IngestOutcome {
    Indexed,
    Unchanged,
    Withheld,
}

#[derive(Debug, Default)]
pub(crate) struct IngestReport {
    pub indexed: usize,
    pub unchanged: usize,
    pub withheld: usize,
    /// `(resource kind, resource id, outcome)` for every requested reference.
    pub outcomes: Vec<(String, u64, IngestOutcome)>,
}

impl IngestReport {
    fn record(&mut self, kind: &str, id: u64, outcome: IngestOutcome) {
        match outcome {
            IngestOutcome::Indexed => self.indexed += 1,
            IngestOutcome::Unchanged => self.unchanged += 1,
            IngestOutcome::Withheld => self.withheld += 1,
        }
        self.outcomes.push((kind.to_owned(), id, outcome));
    }
}

/// Per-company indexed point count. The actor must hold the retrieval grant;
/// the number is a coverage signal and never an authorization.
pub async fn post_coverage(
    State(state): State<AppState>,
    Json(req): Json<ContextCoverageRequest>,
) -> AppResult<Json<ContextCoverageResponse>> {
    let actor = ActorCredentials::new(req.stdb_token, req.identity_hex)
        .map_err(|_| AppError::Forbidden("authenticated actor required".into()))?;
    super::evidence::require_scoped_capability_grant(
        &state,
        &actor.identity_hex,
        &actor.stdb_token,
        req.org_id,
        req.company_id,
        RETRIEVE_CAPABILITY,
    )
    .await?;
    let indexed_points = state
        .rig
        .count_company_points(req.org_id, req.company_id)
        .await
        .map_err(|_| unavailable("activity index unavailable"))?;
    Ok(Json(ContextCoverageResponse { indexed_points }))
}

pub async fn post_ingest(
    State(state): State<AppState>,
    Json(req): Json<ContextIngestRequest>,
) -> AppResult<Json<ContextIngestResponse>> {
    let refs = references(&req.resources).map_err(|e| AppError::BadRequest(e.to_string()))?;
    let actor = ActorCredentials::new(req.stdb_token, req.identity_hex)
        .map_err(|_| AppError::Forbidden("authenticated actor required".into()))?;
    let report = ingest_references(&state, &actor, req.org_id, req.company_id, &refs).await?;
    Ok(Json(ContextIngestResponse {
        indexed: report.indexed,
        unchanged: report.unchanged,
        withheld: report.withheld,
        automatic_backfill: false,
    }))
}

/// The one indexing path, shared by the explicit endpoint and the queue drain:
/// `embedding_index` agent action, the actor's `ai.context.index` grant,
/// field-filtered projection, spend admission and settlement, publication
/// revalidation, then the Qdrant upsert. Callers bound `refs` to eight.
pub(crate) async fn ingest_references(
    state: &AppState,
    actor: &ActorCredentials,
    org_id: u64,
    company_id: u64,
    refs: &[EntityRef],
) -> AppResult<IngestReport> {
    if refs.is_empty() || refs.len() > MAX_REFERENCES {
        return Err(AppError::BadRequest(
            "activity indexing requires one to eight references".into(),
        ));
    }
    if !state.config.embedding_enabled() {
        return Err(unavailable("embeddings disabled"));
    }
    let bounds = super::evidence::require_scoped_capability_grant(
        state,
        &actor.identity_hex,
        &actor.stdb_token,
        org_id,
        company_id,
        INDEX_CAPABILITY,
    )
    .await?;
    if refs.len() as u64 > bounds.max_rows {
        return Err(AppError::Forbidden("activity row grant exceeded".into()));
    }
    let snapshots = fetch_authorized_live_snapshots(state, actor, org_id, company_id, refs)
        .await
        .map_err(|_| unavailable("authorized indexing projection unavailable"))?;
    let mut activities = Vec::new();
    let mut bytes = 0usize;
    for snapshot in &snapshots {
        let activity = activity_for_snapshot(org_id, company_id, &actor.identity_hex, snapshot)
            .map_err(|_| {
                AppError::BadRequest("activity projection outside its input bound".into())
            })?;
        bytes = bytes.saturating_add(activity.text.len());
        activities.push(activity);
    }
    if bytes > MAX_PROJECTION_BYTES || bytes as u64 > bounds.max_bytes {
        return Err(AppError::Forbidden("activity byte grant exceeded".into()));
    }
    state
        .rig
        .check_ready()
        .await
        .map_err(|_| unavailable("activity index unavailable"))?;
    let mut report = IngestReport::default();
    for reference in refs {
        if !activities.iter().any(|a| {
            a.entity_type == reference.entity_type && a.entity_id == reference.entity_id.to_string()
        }) {
            state
                .rig
                .delete_reference(
                    org_id,
                    company_id,
                    &actor.identity_hex,
                    &reference.entity_type,
                    &reference.entity_id.to_string(),
                )
                .await
                .map_err(|_| unavailable("activity index removal unavailable"))?;
            report.record(
                &reference.entity_type,
                reference.entity_id,
                IngestOutcome::Withheld,
            );
        }
    }
    let agent = resolve_surface_agent(
        state.stdb.as_ref(),
        org_id,
        company_id,
        "activity_indexing",
        None,
        None,
        state.config.ollama_supports_tool_calling,
    )
    .await
    .map_err(|_| unavailable("activity indexing agent not configured"))?;
    ensure_allowed_action(&agent, "embedding_index")
        .map_err(|_| AppError::Forbidden("activity indexing action not permitted".into()))?;
    let reader = state
        .spend_read_stdb
        .as_deref()
        .ok_or_else(|| unavailable("embedding spend reader unavailable"))?;
    for activity in activities {
        let entity_id: u64 = activity
            .entity_id
            .parse()
            .map_err(|_| unavailable("invalid projection identity"))?;
        if state
            .rig
            .activity_is_current(&activity)
            .await
            .map_err(|_| unavailable("activity index read unavailable"))?
        {
            report.record(&activity.entity_type, entity_id, IngestOutcome::Unchanged);
            continue;
        }
        let model = state.config.embedding_model_name();
        let scope = MeteredScope {
            organization_id: org_id,
            company_id,
            agent_id: agent.agent_id,
            run_id: 0,
            actor_identity: actor.identity_hex.clone(),
            request_key: request_digest(
                "index",
                org_id,
                company_id,
                &actor.identity_hex,
                &model,
                activity_fingerprint(&activity).as_bytes(),
            ),
            model,
            unit: MeteredUnit::Tokens,
            allowance: u32::try_from(activity.text.len() + 128)
                .map_err(|_| AppError::BadRequest("projection too large".into()))?,
        };
        let vector: Vec<f32> = execute_metered(state.stdb.as_ref(), reader, scope, || async {
            let response = state
                .providers
                .embedder
                .embed_batch_with_usage(&[activity.text.clone()])
                .await?;
            let units = response
                .input_tokens
                .context("embedding provider omitted actual token usage")?;
            let mut vectors = response.vectors;
            if vectors.len() != 1 {
                anyhow::bail!("embedding provider returned unexpected vector count");
            }
            Ok(MeteredResult {
                value: vectors.remove(0),
                units,
            })
        })
        .await
        .map_err(|_| unavailable("activity embedding admission or settlement unavailable"))?;
        super::evidence::require_scoped_capability_grant(
            state,
            &actor.identity_hex,
            &actor.stdb_token,
            org_id,
            company_id,
            INDEX_CAPABILITY,
        )
        .await?;
        let current = fetch_authorized_live_snapshots(
            state,
            actor,
            org_id,
            company_id,
            &[EntityRef {
                entity_type: activity.entity_type.clone(),
                entity_id,
                priority: 1.0,
            }],
        )
        .await
        .map_err(|_| unavailable("publication revalidation unavailable"))?;
        let unchanged = current
            .first()
            .and_then(|snapshot| {
                activity_for_snapshot(org_id, company_id, &actor.identity_hex, snapshot).ok()
            })
            .is_some_and(|fresh| activity_fingerprint(&fresh) == activity_fingerprint(&activity));
        if !unchanged {
            state
                .rig
                .delete_reference(
                    org_id,
                    company_id,
                    &actor.identity_hex,
                    &activity.entity_type,
                    &activity.entity_id,
                )
                .await
                .map_err(|_| unavailable("activity index removal unavailable"))?;
            report.record(&activity.entity_type, entity_id, IngestOutcome::Withheld);
            continue;
        }
        let kind = activity.entity_type.clone();
        state
            .rig
            .upsert_activities_with_vectors(&[activity], vec![vector])
            .await
            .map_err(|_| unavailable("activity publication unavailable"))?;
        report.record(&kind, entity_id, IngestOutcome::Indexed);
    }
    Ok(report)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_candidate_requires_the_readers_current_exact_projection() {
        use crate::{
            harness::LiveSnapshot,
            qdrant_client::SemanticIndexRecord,
            rig_agent::{ActivityIndexRecord, COMPANY_REINDEX_SCOPE},
        };
        let activity = company_reindex_activity(
            7, 11, "sale_order", 42,
            &serde_json::json!({"reference":"SO-42","amountTotal":900,"privateNote":"do not embed"}),
        ).unwrap();
        assert!(!activity.text.contains("900"));
        assert!(!activity.text.contains("do not embed"));
        assert_eq!(activity.timestamp, 0);
        let hit = ContextHit {
            score: 0.9,
            record: ActivityIndexRecord {
                actor_identity: COMPANY_REINDEX_SCOPE.into(),
                activity_timestamp: 0,
                semantic: SemanticIndexRecord {
                    organization_id: 7,
                    company_id: 11,
                    resource_kind: "sale_order".into(),
                    resource_id: "42".into(),
                    source_fingerprint: activity_fingerprint(&activity),
                    resource_version: activity_fingerprint(&activity),
                    embedding_model: "mistral-embed".into(),
                    indexed_at: "t".into(),
                    tags: vec![COMPANY_REINDEX_SCOPE.into()],
                },
            },
        };
        let mut snapshot = LiveSnapshot {
            entity_type: "sale_order".into(),
            entity_id: 42,
            label: "Sale order #42".into(),
            snapshot_at: "now".into(),
            relations: Vec::new(),
            row: serde_json::json!({"reference":"SO-42"}),
        };
        assert!(shared_hit_matches_snapshot(&hit, 7, 11, &snapshot));
        assert!(!shared_hit_matches_snapshot(&hit, 7, 12, &snapshot));
        assert!(!shared_hit_matches_snapshot(&hit, 8, 11, &snapshot));
        snapshot.row = serde_json::json!({"id":42,"amountTotal":900});
        assert!(!shared_hit_matches_snapshot(&hit, 7, 11, &snapshot));
        snapshot.row = serde_json::json!({"reference":"renamed"});
        assert!(!shared_hit_matches_snapshot(&hit, 7, 11, &snapshot));
    }

    #[tokio::test]
    async fn shared_lookup_drops_hidden_fields_and_revoked_readers() {
        use crate::{
            providers,
            qdrant_client::VectorStore,
            rate_limit::AgentRateLimiter,
            rig_agent::{ActivityIndexRecord, RigContext, COMPANY_REINDEX_SCOPE},
        };
        use axum::{
            http::{HeaderMap, StatusCode},
            response::IntoResponse,
            routing::get,
            Router,
        };
        use serde_json::json;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };

        let revoked = Arc::new(AtomicBool::new(false));
        let revoke = revoked.clone();
        let app = Router::new().route(
            "/v1/authoritative/sale-orders/42",
            get(move |headers: HeaderMap| {
                let revoke = revoke.clone();
                async move {
                    let token = headers.get("authorization").and_then(|v| v.to_str().ok());
                    let identity = headers.get("x-stdb-identity").and_then(|v| v.to_str().ok());
                    let data = match (token, identity) {
                        (Some("Bearer fixture-a"), Some("reader-a"))
                            if !revoke.load(Ordering::Relaxed) =>
                        {
                            json!({"id":42,"organizationId":7,"companyId":11,"reference":"SO-42"})
                        }
                        (Some("Bearer fixture-b"), Some("reader-b")) => {
                            json!({"id":42,"organizationId":7,"companyId":11})
                        }
                        _ => return StatusCode::FORBIDDEN.into_response(),
                    };
                    Json(json!({"data":data})).into_response()
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut config = providers::readiness_tests::test_config();
        config.api_server_url = Some(format!("http://{}", listener.local_addr().unwrap()));
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let http = reqwest::Client::new();
        let providers = providers::build(&config, http.clone()).unwrap();
        let rig = RigContext::new(&config, providers.clone()).await.unwrap();
        let vectors = VectorStore::new(&config.qdrant_url, None, config.qdrant_collection.clone())
            .await
            .unwrap();
        let activity =
            company_reindex_activity(7, 11, "sale_order", 42, &json!({"reference":"SO-42"}))
                .unwrap();
        let hit = ContextHit {
            score: 0.9,
            record: ActivityIndexRecord {
                actor_identity: COMPANY_REINDEX_SCOPE.into(),
                activity_timestamp: 0,
                semantic: crate::qdrant_client::SemanticIndexRecord {
                    organization_id: 7,
                    company_id: 11,
                    resource_kind: "sale_order".into(),
                    resource_id: "42".into(),
                    source_fingerprint: activity_fingerprint(&activity),
                    resource_version: activity_fingerprint(&activity),
                    embedding_model: config.embedding_model_name(),
                    indexed_at: "t".into(),
                    tags: vec![COMPANY_REINDEX_SCOPE.into()],
                },
            },
        };
        let state = AppState {
            stdb: Arc::new(stdb_client::StdbClient::new(
                config.stdb_host.clone(),
                config.stdb_module.clone(),
                config.stdb_token.clone(),
            )),
            config: Arc::new(config),
            providers,
            vector_store: Arc::new(vectors),
            rig: Arc::new(rig),
            spend_read_stdb: None,
            http: Arc::new(http),
            activity_watermarks: Default::default(),
            download_jobs: Default::default(),
            kaggle_search_cache: Default::default(),
            agent_rate_limiter: Arc::new(AgentRateLimiter::new()),
        };
        let alice = ActorCredentials::new("fixture-a", "reader-a").unwrap();
        let bob = ActorCredentials::new("fixture-b", "reader-b").unwrap();
        assert_eq!(
            reauthorize_company_hits(&state, &alice, 7, 11, vec![hit.clone()], 1)
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(
            reauthorize_company_hits(&state, &bob, 7, 11, vec![hit.clone()], 1)
                .await
                .unwrap()
                .is_empty()
        );
        revoked.store(true, Ordering::Relaxed);
        assert!(
            reauthorize_company_hits(&state, &alice, 7, 11, vec![hit], 1)
                .await
                .unwrap()
                .is_empty()
        );
        server.abort();
    }

    #[tokio::test]
    async fn disabled_rag_skill_blocks_embedding_before_spend_or_io() {
        use crate::orchestrator::skill_loader::tests::{sats_rows, skill_availability_rows};
        use axum::{extract::State, routing::post, Router};
        use std::sync::{Arc, Mutex};

        struct NeverEmbed;
        #[async_trait::async_trait]
        impl crate::providers::EmbedProvider for NeverEmbed {
            async fn embed(&self, _: &str) -> Result<Vec<f32>> {
                panic!("disabled skill must not embed")
            }
            async fn embed_batch(&self, _: &[String]) -> Result<Vec<Vec<f32>>> {
                panic!("disabled skill must not embed")
            }
            fn dimensions(&self) -> u64 {
                1
            }
            fn name(&self) -> &'static str {
                "never"
            }
        }
        async fn sql(
            State(case): State<Arc<Mutex<&'static str>>>,
            statement: String,
        ) -> Json<serde_json::Value> {
            Json(sats_rows(
                skill_availability_rows(&statement, "rag_generation", *case.lock().unwrap())
                    .expect("skill availability check must precede any spend SQL"),
            ))
        }
        let case = Arc::new(Mutex::new("active"));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let stdb = stdb_client::StdbClient::new(
            format!("http://{}", listener.local_addr().unwrap()),
            "fixture".into(),
            "gateway".into(),
        );
        let app = Router::new()
            .route("/v1/database/fixture/sql", post(sql))
            .with_state(case.clone());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        crate::orchestrator::skill_loader::require_enabled_skill(&stdb, 1, 3, "rag_generation")
            .await
            .unwrap();
        for changed in ["missing", "disabled"] {
            *case.lock().unwrap() = changed;
            let error = execute_query_embedding(
                &stdb,
                &stdb,
                &NeverEmbed,
                MeteredScope {
                    organization_id: 1,
                    company_id: 3,
                    agent_id: 42,
                    run_id: 0,
                    actor_identity: "actor".into(),
                    request_key: "query".into(),
                    model: "mistral-embed".into(),
                    unit: MeteredUnit::Tokens,
                    allowance: 128,
                },
                "answer",
                Some("rag_generation"),
            )
            .await
            .unwrap_err();
            assert!(error.is::<crate::error::SkillUnavailable>());
            assert_eq!(
                error.downcast_ref::<QueryEmbeddingStage>().unwrap().0,
                "skill_recheck"
            );
        }
        server.abort();
    }

    #[test]
    fn references_require_canonical_bounded_exact_identity() {
        let resource = |id: &str| ActivityReference {
            resource_kind: "sale_order".into(),
            resource_id: id.into(),
        };
        assert_eq!(
            references(&[resource("18446744073709551615")]).unwrap()[0].entity_id,
            u64::MAX
        );
        for id in ["0", "01", "-1", "1.0", "1e3", "18446744073709551616"] {
            assert!(references(&[resource(id)]).is_err());
        }
        assert!(references(&[]).is_err());
        assert!(references(&[resource("1"), resource("1")]).is_err());
        assert!(references(
            &(1..=9)
                .map(|id| resource(&id.to_string()))
                .collect::<Vec<_>>()
        )
        .is_err());
        assert!(references(&[ActivityReference {
            resource_kind: "private_table".into(),
            resource_id: "1".into()
        }])
        .is_err());
        assert!(serde_json::from_value::<ActivityReference>(
            serde_json::json!({"resource_kind":"sale_order", "resource_id":"1", "text":"forged"})
        )
        .is_err());
    }
    #[test]
    fn metering_key_is_stable_and_scope_model_content_bound() {
        let key = request_digest("index", 7, 9, "actor", "mistral-embed", b"content");
        assert_eq!(
            key,
            request_digest("index", 7, 9, "actor", "mistral-embed", b"content")
        );
        for other in [
            request_digest("index", 7, 10, "actor", "mistral-embed", b"content"),
            request_digest("index", 7, 9, "other", "mistral-embed", b"content"),
            request_digest("index", 7, 9, "actor", "different-model", b"content"),
            request_digest("index", 7, 9, "actor", "mistral-embed", b"changed"),
        ] {
            assert_ne!(key, other);
        }
    }
}
