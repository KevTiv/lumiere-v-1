//! Explicit actor-authorized indexing. Clients select identities, never text.
use crate::{
    ai_agent::{ensure_allowed_action, resolve_surface_agent, ResolvedAgentConfig},
    error::{AppError, AppResult},
    harness::{
        entity_registry::lookup_entity_spec, fetch_authorized_live_snapshots,
        resolve_snapshot_candidates, ActorCredentials, EntityRef,
    },
    non_llm_spend::{execute_metered, MeteredResult, MeteredScope, MeteredUnit},
    rig_agent::{activity_fingerprint, activity_for_snapshot, ContextHit},
    state::AppState,
};
use anyhow::{Context, Result};
use axum::{extract::State, Json};
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
fn request_digest(
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
    generation_source_key: Option<&str>,
) -> Result<Vec<f32>> {
    if query.trim().is_empty() || query.len() > 8192 || !state.config.embedding_enabled() {
        anyhow::bail!("query embeddings are disabled or outside their input bound");
    }
    let bounds = super::evidence::require_scoped_capability_grant(
        state,
        &actor.identity_hex,
        &actor.stdb_token,
        org,
        company,
        RETRIEVE_CAPABILITY,
    )
    .await?;
    if bounds.max_rows == 0 || bounds.max_bytes < query.len() as u64 {
        anyhow::bail!("query exceeds evidence grant");
    }
    state
        .vector_store
        .check_ready()
        .await
        .context("document embedding collection is incompatible")?;
    state
        .rig
        .check_ready()
        .await
        .context("activity embedding collection is incompatible")?;
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
            .await?;
            &resolved
        }
    };
    ensure_allowed_action(agent, "embedding_query")?;
    let reader = state
        .spend_read_stdb
        .as_deref()
        .context("embedding spend reader unavailable")?;
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
    execute_query_embedding(
        state.stdb.as_ref(),
        reader,
        state.providers.embedder.as_ref(),
        scope,
        query,
        generation_source_key,
    )
    .await
}

/// The paid embedding boundary; the source key is supplied only by server code.
async fn execute_query_embedding(
    stdb: &stdb_client::StdbClient,
    reader: &stdb_client::StdbClient,
    embedder: &dyn crate::providers::EmbedProvider,
    scope: MeteredScope,
    query: &str,
    generation_source_key: Option<&str>,
) -> Result<Vec<f32>> {
    if let Some(key) = generation_source_key {
        crate::orchestrator::skill_loader::require_generation_source(
            stdb,
            scope.organization_id,
            key,
        )
        .await?;
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
    let candidates = state
        .rig
        .search_scope_with_vector(
            req.org_id,
            req.company_id,
            &actor.identity_hex,
            vector,
            top_k,
        )
        .await
        .map_err(|_| unavailable("activity retrieval unavailable"))?;
    let mut hits =
        reauthorize_activity_hits(&state, &actor, req.org_id, req.company_id, candidates)
            .await
            .map_err(|_| unavailable("authoritative resolver unavailable"))?;
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
    if hits.len() > 50 {
        anyhow::bail!("activity candidate bound exceeded");
    }
    let bounds = super::evidence::require_scoped_capability_grant(
        state,
        &actor.identity_hex,
        &actor.stdb_token,
        org,
        company,
        RETRIEVE_CAPABILITY,
    )
    .await?;
    let limit = usize::try_from(bounds.max_rows)
        .unwrap_or(usize::MAX)
        .min(hits.len());
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
    for hit in hits.into_iter().take(limit) {
        let record = &hit.record.semantic;
        if record.organization_id == org
            && record.company_id == company
            && hit.record.actor_identity == actor.identity_hex
            && record.embedding_model == state.config.embedding_model_name()
            && allowed.contains(&(
                record.resource_kind.clone(),
                record.resource_id.clone(),
                record.source_fingerprint.clone(),
            ))
        {
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
    accepted.truncate(limit);
    while serde_json::to_vec(&accepted)?.len() as u64 > bounds.max_bytes {
        if accepted.pop().is_none() {
            break;
        }
    }
    Ok(accepted)
}

pub async fn post_ingest(
    State(state): State<AppState>,
    Json(req): Json<ContextIngestRequest>,
) -> AppResult<Json<ContextIngestResponse>> {
    let refs = references(&req.resources).map_err(|e| AppError::BadRequest(e.to_string()))?;
    if !state.config.embedding_enabled() {
        return Err(unavailable("embeddings disabled"));
    }
    let actor = ActorCredentials::new(req.stdb_token, req.identity_hex)
        .map_err(|_| AppError::Forbidden("authenticated actor required".into()))?;
    let bounds = super::evidence::require_scoped_capability_grant(
        &state,
        &actor.identity_hex,
        &actor.stdb_token,
        req.org_id,
        req.company_id,
        INDEX_CAPABILITY,
    )
    .await?;
    if refs.len() as u64 > bounds.max_rows {
        return Err(AppError::Forbidden("activity row grant exceeded".into()));
    }
    let snapshots =
        fetch_authorized_live_snapshots(&state, &actor, req.org_id, req.company_id, &refs)
            .await
            .map_err(|_| unavailable("authorized indexing projection unavailable"))?;
    let mut activities = Vec::new();
    let mut bytes = 0usize;
    for snapshot in &snapshots {
        let activity =
            activity_for_snapshot(req.org_id, req.company_id, &actor.identity_hex, snapshot)
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
    let mut response = ContextIngestResponse {
        indexed: 0,
        unchanged: 0,
        withheld: refs.len() - activities.len(),
        automatic_backfill: false,
    };
    for reference in &refs {
        if !activities.iter().any(|a| {
            a.entity_type == reference.entity_type && a.entity_id == reference.entity_id.to_string()
        }) {
            state
                .rig
                .delete_reference(
                    req.org_id,
                    req.company_id,
                    &actor.identity_hex,
                    &reference.entity_type,
                    &reference.entity_id.to_string(),
                )
                .await
                .map_err(|_| unavailable("activity index removal unavailable"))?;
        }
    }
    let agent = resolve_surface_agent(
        state.stdb.as_ref(),
        req.org_id,
        req.company_id,
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
        if state
            .rig
            .activity_is_current(&activity)
            .await
            .map_err(|_| unavailable("activity index read unavailable"))?
        {
            response.unchanged += 1;
            continue;
        }
        let model = state.config.embedding_model_name();
        let scope = MeteredScope {
            organization_id: req.org_id,
            company_id: req.company_id,
            agent_id: agent.agent_id,
            run_id: 0,
            actor_identity: actor.identity_hex.clone(),
            request_key: request_digest(
                "index",
                req.org_id,
                req.company_id,
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
            &state,
            &actor.identity_hex,
            &actor.stdb_token,
            req.org_id,
            req.company_id,
            INDEX_CAPABILITY,
        )
        .await?;
        let current = fetch_authorized_live_snapshots(
            &state,
            &actor,
            req.org_id,
            req.company_id,
            &[EntityRef {
                entity_type: activity.entity_type.clone(),
                entity_id: activity
                    .entity_id
                    .parse()
                    .map_err(|_| unavailable("invalid projection identity"))?,
                priority: 1.0,
            }],
        )
        .await
        .map_err(|_| unavailable("publication revalidation unavailable"))?;
        let unchanged = current
            .first()
            .and_then(|snapshot| {
                activity_for_snapshot(req.org_id, req.company_id, &actor.identity_hex, snapshot)
                    .ok()
            })
            .is_some_and(|fresh| activity_fingerprint(&fresh) == activity_fingerprint(&activity));
        if !unchanged {
            state
                .rig
                .delete_reference(
                    req.org_id,
                    req.company_id,
                    &actor.identity_hex,
                    &activity.entity_type,
                    &activity.entity_id,
                )
                .await
                .map_err(|_| unavailable("activity index removal unavailable"))?;
            response.withheld += 1;
            continue;
        }
        state
            .rig
            .upsert_activities_with_vectors(&[activity], vec![vector])
            .await
            .map_err(|_| unavailable("activity publication unavailable"))?;
        response.indexed += 1;
    }
    Ok(Json(response))
}
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn revoked_or_stale_rag_source_blocks_embedding_before_spend_or_io() {
        use crate::orchestrator::skill_loader::tests::{generation_source_rows, sats_rows};
        use axum::{extract::State, routing::post, Router};
        use std::sync::{Arc, Mutex};

        struct NeverEmbed;
        #[async_trait::async_trait]
        impl crate::providers::EmbedProvider for NeverEmbed {
            async fn embed(&self, _: &str) -> Result<Vec<f32>> {
                panic!("revoked source must not embed")
            }
            async fn embed_batch(&self, _: &[String]) -> Result<Vec<Vec<f32>>> {
                panic!("revoked source must not embed")
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
                generation_source_rows(&statement, "rag_generation", *case.lock().unwrap())
                    .expect("source rejection must precede any spend SQL"),
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
        crate::orchestrator::skill_loader::require_generation_source(&stdb, 1, "rag_generation")
            .await
            .unwrap();
        for changed in ["missing", "stale"] {
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
            assert!(error.is::<crate::error::GenerationSourceUnavailable>());
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
