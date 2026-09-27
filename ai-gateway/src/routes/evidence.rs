//! AIH-16/17: read-only source/decision inspection and scoped knowledge reuse.
//!
//! Both routes are reads. They re-authorize against the organization and
//! company at request time (see `orchestrator::evidence_inspector`) and never
//! return an excerpt for a source outside that scope, or for a passage whose
//! access was revoked or whose content was deleted.

use std::time::Duration;

use axum::{
    extract::State,
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    orchestrator::evidence_inspector::{
        inspect, inspect_workflow_step, retrieve_reusable_knowledge, ActorIdentity, InspectTarget,
        Inspection, KnowledgeRetrieval, Viewer,
    },
    orchestrator::review_queue::{build_queue, DEFAULT_QUEUE_LIMIT},
    state::AppState,
};

const ACTOR_GRANT_TIMEOUT: Duration = Duration::from_secs(3);
const INSPECT_CAPABILITY: &str = "ai.evidence.inspect";
const KNOWLEDGE_RETRIEVE_CAPABILITY: &str = "ai.knowledge.retrieve";
const MAX_RUN_TRANSCRIPT_STEPS: usize = 200;
const MAX_RUN_CLAIMS: usize = 100;
/// Exact authority to have persisted evidence passages placed in a RAG answer.
/// Deliberately distinct from `ai.knowledge.retrieve` (reviewed knowledge
/// reuse): holding one never implies the other, and neither is seeded by
/// default.
pub(crate) const RAG_EVIDENCE_RETRIEVE_CAPABILITY: &str = "ai.evidence.retrieve";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RunInspectionRequest {
    pub run_id: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTranscriptStep {
    pub id: u64,
    pub step_no: u64,
    pub tool_name: String,
    /// Raw tool arguments are never exposed; only their persisted hash.
    pub input_hash: String,
    /// Result payloads stay private. This bounded status is enough to reconstruct
    /// the observable run without exporting sensitive tool output.
    pub result_summary: String,
    pub output_row_count: Option<u64>,
    pub duration_ms: u64,
    pub error: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvidenceInspection {
    pub run_id: u64,
    pub status: String,
    pub answer: Option<String>,
    pub step_count: u64,
    pub tokens_used: u64,
    pub error_message: Option<String>,
    pub transcript: Vec<RunTranscriptStep>,
    pub contribution_ids: Vec<u64>,
    pub claim_ids: Vec<u64>,
    pub claims: Vec<Inspection>,
}

#[derive(Clone, Copy)]
enum RunResponseShape {
    Inspection,
    Export,
}

fn serialized_run_size(
    inspection: &RunEvidenceInspection,
    shape: RunResponseShape,
) -> AppResult<usize> {
    let encoded = match shape {
        RunResponseShape::Inspection => serde_json::to_vec(inspection),
        RunResponseShape::Export => serde_json::to_vec(&json!({
            "schemaVersion": 1,
            "kind": "lumiere_run_evidence_export",
            "run": inspection,
        })),
    }
    .map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(encoded.len())
}

/// Reduce optional run detail until the exact response envelope fits the
/// actor's byte grant. The required run identity and counters are never
/// silently truncated; an impossibly small grant fails closed.
fn enforce_run_byte_bound(
    inspection: &mut RunEvidenceInspection,
    max_bytes: u64,
    shape: RunResponseShape,
) -> AppResult<()> {
    let fits = |inspection: &RunEvidenceInspection| {
        serialized_run_size(inspection, shape).map(|size| size as u64 <= max_bytes)
    };
    while !inspection.claims.is_empty() && !fits(inspection)? {
        inspection.claims.pop();
        inspection.claim_ids.pop();
    }
    while !inspection.transcript.is_empty() && !fits(inspection)? {
        inspection.transcript.pop();
    }
    while !inspection.contribution_ids.is_empty() && !fits(inspection)? {
        inspection.contribution_ids.pop();
    }
    if !fits(inspection)? {
        inspection.answer = None;
        inspection.error_message = None;
    }
    if !fits(inspection)? {
        return Err(AppError::Forbidden(
            "evidence response exceeds the acting user's grant".into(),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InspectRequest {
    /// component | decision | claim | knowledge_version | workflow_step | source
    pub kind: String,
    /// For `workflow_step`, the workflow version id.
    pub id: u64,
    /// The stable node key; required for, and only allowed with, `workflow_step`.
    #[serde(default)]
    pub node_key: Option<String>,
}

struct ActorCredentials {
    identity: String,
    token: String,
    organization_id: u64,
    company_id: u64,
}

impl ActorCredentials {
    fn from_headers(headers: &HeaderMap) -> AppResult<Self> {
        let required = |name: &str| {
            headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| AppError::Forbidden("acting-user context is required".into()))
        };
        // Identity and token are forwarded by the session-owning API server.
        // The internal-secret middleware authenticates that server; these
        // values are deliberately not accepted in the JSON body.
        let identity = required("x-lumiere-actor-identity")?.to_string();
        if ActorIdentity::parse(&identity).is_none() {
            return Err(AppError::Forbidden("acting-user context is invalid".into()));
        }
        let token = required("x-lumiere-actor-token")?.to_string();
        let organization_id = required("x-lumiere-organization-id")?
            .parse::<u64>()
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| AppError::Forbidden("acting-user context is invalid".into()))?;
        let company_id = required("x-lumiere-company-id")?
            .parse::<u64>()
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| AppError::Forbidden("acting-user context is invalid".into()))?;
        Ok(Self {
            identity,
            token,
            organization_id,
            company_id,
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilityGrantEnvelope {
    #[serde(rename = "organizationId")]
    organization_id: u64,
    #[serde(rename = "companyId")]
    company_id: u64,
    #[serde(rename = "actorIdentity")]
    actor_identity: String,
    #[serde(rename = "knowledgeTeamRefs", default)]
    _knowledge_team_refs: Vec<String>,
    grants: Vec<CapabilityGrant>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CapabilityGrant {
    capability_key: String,
    max_rows: u64,
    max_bytes: u64,
}

/// The row and byte limits an actor's role grant places on one capability.
/// Callers must intersect these with their own global ceilings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CapabilityGrantBounds {
    pub max_rows: u64,
    pub max_bytes: u64,
}

impl CapabilityGrantEnvelope {
    /// The bounds granted for exactly `capability`, or `None` when the
    /// envelope is for another actor or scope, or grants nothing usable.
    ///
    /// The API server already merges an actor's roles; if a malformed
    /// envelope still repeats a capability, the smallest limits win so a
    /// duplicate can only narrow authority.
    fn bounds_for(
        &self,
        actor: &ActorCredentials,
        capability: &str,
    ) -> Option<CapabilityGrantBounds> {
        if self.organization_id != actor.organization_id
            || self.company_id != actor.company_id
            || self.actor_identity != actor.identity
        {
            return None;
        }
        self.grants
            .iter()
            .filter(|grant| {
                grant.capability_key == capability && grant.max_rows > 0 && grant.max_bytes > 0
            })
            .map(|grant| CapabilityGrantBounds {
                max_rows: grant.max_rows,
                max_bytes: grant.max_bytes,
            })
            .reduce(|left, right| CapabilityGrantBounds {
                max_rows: left.max_rows.min(right.max_rows),
                max_bytes: left.max_bytes.min(right.max_bytes),
            })
    }

    fn permits(&self, actor: &ActorCredentials, capability: &str) -> bool {
        self.bounds_for(actor, capability).is_some()
    }
}

/// Ask the session-owning API server for the actor's current grants. Any
/// transport failure, timeout, non-success status or malformed envelope is an
/// error: authority that cannot be established is denied.
async fn fetch_actor_grants(
    http: &reqwest::Client,
    api_server_url: &str,
    actor: &ActorCredentials,
    timeout: Duration,
) -> AppResult<CapabilityGrantEnvelope> {
    let response = http
        .get(format!(
            "{}/v1/ai/capability-grants?companyId={}",
            api_server_url.trim_end_matches('/'),
            actor.company_id
        ))
        .bearer_auth(&actor.token)
        .header("x-stdb-identity", &actor.identity)
        .timeout(timeout)
        .send()
        .await
        .map_err(|_| AppError::Unavailable("acting-user authorization is unavailable".into()))?;
    if !response.status().is_success() {
        return Err(if response.status().is_server_error() {
            AppError::Unavailable("acting-user authorization is unavailable".into())
        } else {
            AppError::Forbidden("evidence access is not permitted".into())
        });
    }
    response
        .json::<CapabilityGrantEnvelope>()
        .await
        .map_err(|_| AppError::Unavailable("acting-user authorization is unavailable".into()))
}

async fn require_actor_grant_bounds(
    state: &AppState,
    actor: &ActorCredentials,
    capability: &str,
) -> AppResult<CapabilityGrantBounds> {
    let api_server_url =
        state.config.api_server_url.as_deref().ok_or_else(|| {
            AppError::Unavailable("acting-user authorization is unavailable".into())
        })?;
    let grants =
        fetch_actor_grants(&state.http, api_server_url, actor, ACTOR_GRANT_TIMEOUT).await?;
    grants
        .bounds_for(actor, capability)
        .ok_or_else(|| AppError::Forbidden("evidence access is not permitted".into()))
}

/// Re-check a BFF-supplied acting user's exact capability before a route reads
/// persisted evidence. The envelope must echo the same actor and tenant scope;
/// an unavailable grant service fails closed. The returned bounds are the
/// actor's own limits; a caller must still intersect them with its ceilings.
pub(crate) async fn require_scoped_capability_grant(
    state: &AppState,
    actor_identity: &str,
    actor_token: &str,
    organization_id: u64,
    company_id: u64,
    capability: &str,
) -> AppResult<CapabilityGrantBounds> {
    let actor = ActorCredentials {
        identity: actor_identity.trim().to_string(),
        token: actor_token.trim().to_string(),
        organization_id,
        company_id,
    };
    if ActorIdentity::parse(&actor.identity).is_none()
        || actor.token.is_empty()
        || actor.organization_id == 0
        || actor.company_id == 0
    {
        return Err(AppError::Forbidden("acting-user context is invalid".into()));
    }
    require_actor_grant_bounds(state, &actor, capability).await
}

pub async fn post_inspect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<InspectRequest>,
) -> AppResult<Response> {
    if req.id == 0 {
        return Err(AppError::BadRequest("id is required".into()));
    }
    let actor = ActorCredentials::from_headers(&headers)?;
    // Resolve the exact acting-user grant again at the gateway boundary. This
    // happens before the target row or any nested lineage node is loaded.
    let _grants = require_actor_grant_bounds(&state, &actor, INSPECT_CAPABILITY).await?;
    let viewer = Viewer {
        organization_id: actor.organization_id,
        company_id: actor.company_id,
        actor_identity: ActorIdentity::parse(&actor.identity),
    };
    let inspected = if req.kind == "workflow_step" {
        // A step is addressed by workflow version and stable node key.
        let node_key = req
            .node_key
            .as_deref()
            .filter(|key| !key.is_empty() && key.len() <= 128)
            .ok_or_else(|| {
                AppError::BadRequest("nodeKey is required for a workflow step".into())
            })?;
        inspect_workflow_step(state.stdb.as_ref(), viewer, req.id, node_key).await
    } else {
        if req.node_key.is_some() {
            return Err(AppError::BadRequest(
                "nodeKey is only valid for a workflow step".into(),
            ));
        }
        let target = InspectTarget::parse(&req.kind, req.id).ok_or_else(|| {
            AppError::BadRequest(
                "kind must be component, decision, claim, knowledge_version or workflow_step"
                    .into(),
            )
        })?;
        inspect(state.stdb.as_ref(), viewer, target).await
    };
    let inspection = inspected.map_err(|error| {
        // A record outside the caller's scope reads as absent, not forbidden.
        if error.to_string().contains("not found") {
            AppError::NotFound(error.to_string())
        } else {
            AppError::Internal(error.to_string())
        }
    })?;
    let mut response = Json(inspection).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

fn row_u64(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_text(row: &Value, camel: &str, snake: &str) -> Option<String> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn redacted_step(row: &Value) -> Option<RunTranscriptStep> {
    let row_count = row_u64(row, "outputRowCount", "output_row_count");
    let error_message = row_text(row, "errorMessage", "error_message");
    Some(RunTranscriptStep {
        id: row_u64(row, "id", "id")?,
        step_no: row_u64(row, "stepNo", "step_no")?,
        tool_name: row_text(row, "toolName", "tool_name")?,
        input_hash: row_text(row, "inputHash", "input_hash")?,
        result_summary: if error_message.is_some() {
            "tool failed".to_string()
        } else if let Some(count) = row_count {
            format!("{count} row(s)")
        } else {
            "completed".to_string()
        },
        output_row_count: row_count,
        duration_ms: row_u64(row, "durationMs", "duration_ms").unwrap_or_default(),
        error: error_message.is_some(),
    })
}

async fn inspect_run(
    state: &AppState,
    actor: &ActorCredentials,
    run_id: u64,
    shape: RunResponseShape,
) -> AppResult<RunEvidenceInspection> {
    if run_id == 0 {
        return Err(AppError::BadRequest("runId is required".into()));
    }
    let grant = require_actor_grant_bounds(state, actor, INSPECT_CAPABILITY).await?;
    let runs = state
        .stdb
        .query_sql(&format!(
            "SELECT * FROM ai_agent_run WHERE organization_id = {} AND company_id = {} AND id = {} LIMIT 1",
            actor.organization_id, actor.company_id, run_id
        ))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let run = runs
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("run not found".into()))?;

    let mut transcript = state
        .stdb
        .query_sql(&format!(
            "SELECT * FROM ai_agent_run_step WHERE organization_id = {} AND run_id = {}",
            actor.organization_id, run_id
        ))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?
        .iter()
        .filter_map(redacted_step)
        .collect::<Vec<_>>();
    transcript.sort_by_key(|step| (step.step_no, step.id));
    let mut remaining_rows =
        usize::try_from(grant.max_rows.saturating_sub(1)).unwrap_or(usize::MAX);
    transcript.truncate(MAX_RUN_TRANSCRIPT_STEPS.min(remaining_rows));
    remaining_rows = remaining_rows.saturating_sub(transcript.len());

    let contributions = state
        .stdb
        .query_sql(&format!(
            "SELECT * FROM ai_evidence_contribution WHERE organization_id = {} AND company_id = {}",
            actor.organization_id, actor.company_id
        ))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let mut contribution_ids = contributions
        .iter()
        .filter(|row| row_u64(row, "agentRunId", "agent_run_id") == Some(run_id))
        .filter_map(|row| row_u64(row, "id", "id"))
        .collect::<Vec<_>>();
    contribution_ids.sort_unstable();
    contribution_ids.dedup();
    contribution_ids.truncate(remaining_rows);
    remaining_rows = remaining_rows.saturating_sub(contribution_ids.len());

    let viewer = Viewer {
        organization_id: actor.organization_id,
        company_id: actor.company_id,
        actor_identity: ActorIdentity::parse(&actor.identity),
    };
    let contribution_set = contribution_ids
        .iter()
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    let claim_rows = state
        .stdb
        .query_sql(&format!(
            "SELECT * FROM ai_evidence_claim WHERE organization_id = {} AND company_id = {}",
            actor.organization_id, actor.company_id
        ))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let mut claim_ids = claim_rows
        .iter()
        .filter(|row| {
            row_u64(row, "contributionId", "contribution_id")
                .is_some_and(|id| contribution_set.contains(&id))
        })
        .filter_map(|row| row_u64(row, "id", "id"))
        .collect::<Vec<_>>();
    claim_ids.sort_unstable();
    claim_ids.dedup();
    claim_ids.truncate(MAX_RUN_CLAIMS.min(remaining_rows));

    let mut claims = Vec::with_capacity(claim_ids.len());
    for claim_id in &claim_ids {
        let inspection = inspect(state.stdb.as_ref(), viewer, InspectTarget::Claim(*claim_id))
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?;
        claims.push(inspection);
    }

    let mut inspection = RunEvidenceInspection {
        run_id,
        status: row_text(&run, "status", "status").unwrap_or_else(|| "unknown".into()),
        answer: row_text(&run, "summary", "summary"),
        step_count: row_u64(&run, "stepCount", "step_count").unwrap_or_default(),
        tokens_used: row_u64(&run, "tokensUsed", "tokens_used").unwrap_or_default(),
        error_message: row_text(&run, "errorMessage", "error_message"),
        transcript,
        contribution_ids,
        claim_ids,
        claims,
    };
    enforce_run_byte_bound(&mut inspection, grant.max_bytes, shape)?;
    Ok(inspection)
}

pub async fn post_run_inspect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RunInspectionRequest>,
) -> AppResult<Response> {
    let actor = ActorCredentials::from_headers(&headers)?;
    let inspection = inspect_run(&state, &actor, req.run_id, RunResponseShape::Inspection).await?;
    let mut response = Json(inspection).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

pub async fn post_run_export(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RunInspectionRequest>,
) -> AppResult<Response> {
    let actor = ActorCredentials::from_headers(&headers)?;
    let inspection = inspect_run(&state, &actor, req.run_id, RunResponseShape::Export).await?;
    let mut response = Json(json!({
        "schemaVersion": 1,
        "kind": "lumiere_run_evidence_export",
        "run": inspection,
    }))
    .into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

/// The reviewer's queue for the acting user's company. It grants no review
/// right: it needs the same exact `ai.evidence.inspect` grant as inspection,
/// and the review reducers still enforce permission, membership and
/// independence.
pub async fn post_review_queue(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let actor = ActorCredentials::from_headers(&headers)?;
    let _grants = require_actor_grant_bounds(&state, &actor, INSPECT_CAPABILITY).await?;
    let viewer = Viewer {
        organization_id: actor.organization_id,
        company_id: actor.company_id,
        actor_identity: ActorIdentity::parse(&actor.identity),
    };
    let queue = build_queue(state.stdb.as_ref(), viewer, DEFAULT_QUEUE_LIMIT)
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let mut response = Json(queue).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct KnowledgeRetrieveRequest {
    pub entry_key: String,
}

pub async fn post_knowledge_retrieve(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<KnowledgeRetrieveRequest>,
) -> AppResult<Json<KnowledgeRetrieval>> {
    if req.entry_key.trim().is_empty() || req.entry_key.len() > 128 {
        return Err(AppError::BadRequest("entryKey is invalid".into()));
    }
    let actor = ActorCredentials::from_headers(&headers)?;
    let _grants = require_actor_grant_bounds(&state, &actor, KNOWLEDGE_RETRIEVE_CAPABILITY).await?;
    let viewer = Viewer {
        organization_id: actor.organization_id,
        company_id: actor.company_id,
        actor_identity: ActorIdentity::parse(&actor.identity),
    };
    let retrieval = retrieve_reusable_knowledge(state.stdb.as_ref(), viewer, &req.entry_key)
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(Json(retrieval))
}

#[cfg(test)]
mod route_tests {
    use super::*;
    use serde_json::json;

    fn actor_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-lumiere-actor-identity",
            HeaderValue::from_static(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
        );
        headers.insert("x-lumiere-actor-token", HeaderValue::from_static("token"));
        headers.insert("x-lumiere-organization-id", HeaderValue::from_static("7"));
        headers.insert("x-lumiere-company-id", HeaderValue::from_static("9"));
        headers
    }

    #[test]
    fn run_transcript_never_exposes_raw_tool_output() {
        let step = redacted_step(&json!({
            "id": 1,
            "stepNo": 2,
            "toolName": "erp.search",
            "inputHash": "abc123",
            "outputSummary": "customer secret should never leave the gateway",
            "outputRowCount": 3,
            "durationMs": 17,
            "errorMessage": null
        }))
        .expect("redacted step");
        let encoded = serde_json::to_value(step).expect("serialize");
        assert_eq!(encoded["resultSummary"], "3 row(s)");
        assert_eq!(encoded["inputHash"], "abc123");
        assert!(encoded.get("outputSummary").is_none());
        assert!(!encoded.to_string().contains("customer secret"));
    }

    #[test]
    fn run_export_is_trimmed_to_the_exact_byte_grant() {
        let mut inspection = RunEvidenceInspection {
            run_id: 11,
            status: "completed".to_string(),
            answer: Some("sensitive answer".repeat(50)),
            step_count: 1,
            tokens_used: 20,
            error_message: None,
            transcript: vec![RunTranscriptStep {
                id: 1,
                step_no: 1,
                tool_name: "erp.search".to_string(),
                input_hash: "abc123".to_string(),
                result_summary: "3 row(s)".to_string(),
                output_row_count: Some(3),
                duration_ms: 17,
                error: false,
            }],
            contribution_ids: vec![7, 8],
            claim_ids: vec![],
            claims: vec![],
        };
        let minimal = RunEvidenceInspection {
            run_id: 11,
            status: "completed".to_string(),
            answer: None,
            step_count: 1,
            tokens_used: 20,
            error_message: None,
            transcript: vec![],
            contribution_ids: vec![],
            claim_ids: vec![],
            claims: vec![],
        };
        let max_bytes = serialized_run_size(&minimal, RunResponseShape::Export)
            .expect("serialize minimal export") as u64;

        enforce_run_byte_bound(&mut inspection, max_bytes, RunResponseShape::Export)
            .expect("trim export");

        assert!(inspection.answer.is_none());
        assert!(inspection.transcript.is_empty());
        assert!(inspection.contribution_ids.is_empty());
        assert!(
            serialized_run_size(&inspection, RunResponseShape::Export)
                .expect("serialize bounded export") as u64
                <= max_bytes
        );
    }

    #[test]
    fn actor_scope_is_header_only_and_fail_closed() {
        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor context");
        assert_eq!(actor.identity, "a".repeat(64));
        assert_eq!(actor.token, "token");
        assert_eq!(actor.organization_id, 7);
        assert_eq!(actor.company_id, 9);

        let mut missing = actor_headers();
        missing.remove("x-lumiere-actor-token");
        assert!(ActorCredentials::from_headers(&missing).is_err());

        let mut malformed = actor_headers();
        malformed.insert("x-lumiere-company-id", HeaderValue::from_static("other"));
        assert!(ActorCredentials::from_headers(&malformed).is_err());
    }

    #[test]
    fn browser_body_cannot_choose_authority() {
        for extra in [
            json!({ "orgId": 7 }),
            json!({ "companyId": 9 }),
            json!({ "actorIdentity": "forged" }),
            json!({ "actorToken": "forged" }),
            json!({ "grants": ["ai.evidence.inspect"] }),
        ] {
            let mut body = json!({ "kind": "claim", "id": 11 });
            body.as_object_mut()
                .expect("body object")
                .extend(extra.as_object().expect("extra object").clone());
            assert!(serde_json::from_value::<InspectRequest>(body).is_err());
        }
    }

    #[test]
    fn grant_envelope_requires_exact_positive_capability() {
        let parse = |value| serde_json::from_value::<CapabilityGrantEnvelope>(value);
        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        assert!(parse(json!({
            "organizationId": 7,
            "companyId": 9,
            "actorIdentity": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "grants": [{
                "capabilityKey": "ai.evidence.inspect",
                "maxRows": 1,
                "maxBytes": 1
            }]
        }))
        .expect("grant envelope")
        .permits(&actor, INSPECT_CAPABILITY));
        for denied in [
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": []}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": [{"capabilityKey": "*", "maxRows": 1, "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": [{"capabilityKey": "ai.evidence.inspect", "maxRows": 0, "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": [{"capabilityKey": "ai.evidence.inspect", "maxRows": 1}]}),
            json!({"organizationId": 8, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": [{"capabilityKey": "ai.evidence.inspect", "maxRows": 1, "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 10, "actorIdentity": "a".repeat(64), "grants": [{"capabilityKey": "ai.evidence.inspect", "maxRows": 1, "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "other", "grants": [{"capabilityKey": "ai.evidence.inspect", "maxRows": 1, "maxBytes": 1}]}),
        ] {
            match parse(denied) {
                Ok(envelope) => assert!(!envelope.permits(&actor, INSPECT_CAPABILITY)),
                Err(_) => {}
            }
        }
        assert!(parse(json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": [], "actor": "forged"})).is_err());
    }

    #[test]
    fn knowledge_reuse_requires_its_own_exact_capability() {
        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        let envelope = serde_json::from_value::<CapabilityGrantEnvelope>(json!({
            "organizationId": 7,
            "companyId": 9,
            "actorIdentity": "a".repeat(64),
            "knowledgeTeamRefs": ["department:42"],
            "grants": [{
                "capabilityKey": KNOWLEDGE_RETRIEVE_CAPABILITY,
                "maxRows": 1,
                "maxBytes": 1
            }]
        }))
        .expect("grant envelope");
        assert!(envelope.permits(&actor, KNOWLEDGE_RETRIEVE_CAPABILITY));
        assert!(!envelope.permits(&actor, INSPECT_CAPABILITY));
    }

    #[test]
    fn knowledge_body_cannot_choose_actor_scope_or_team() {
        assert!(serde_json::from_value::<KnowledgeRetrieveRequest>(json!({
            "entryKey": "sl",
            "orgId": 7
        }))
        .is_err());
        assert!(serde_json::from_value::<KnowledgeRetrieveRequest>(json!({
            "entryKey": "sl",
            "companyId": 9
        }))
        .is_err());
        assert!(serde_json::from_value::<KnowledgeRetrieveRequest>(json!({
            "entryKey": "sl",
            "knowledgeTeamRefs": ["department:42"]
        }))
        .is_err());
    }

    #[test]
    fn actor_grant_resolution_has_a_short_timeout() {
        assert_eq!(ACTOR_GRANT_TIMEOUT, Duration::from_secs(3));
    }

    fn envelope(grants: serde_json::Value) -> CapabilityGrantEnvelope {
        serde_json::from_value(json!({
            "organizationId": 7,
            "companyId": 9,
            "actorIdentity": "a".repeat(64),
            "grants": grants,
        }))
        .expect("grant envelope")
    }

    #[test]
    fn rag_uses_its_own_exact_evidence_capability() {
        assert_eq!(RAG_EVIDENCE_RETRIEVE_CAPABILITY, "ai.evidence.retrieve");
        assert_ne!(
            RAG_EVIDENCE_RETRIEVE_CAPABILITY,
            KNOWLEDGE_RETRIEVE_CAPABILITY
        );
        assert_ne!(RAG_EVIDENCE_RETRIEVE_CAPABILITY, INSPECT_CAPABILITY);

        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        // Neither neighbouring capability, a wildcard, nor a prefix authorizes RAG.
        for held in [
            KNOWLEDGE_RETRIEVE_CAPABILITY,
            INSPECT_CAPABILITY,
            "*",
            "ai.evidence",
            "ai.evidence.retrieve.extra",
            "AI.EVIDENCE.RETRIEVE",
        ] {
            let held = envelope(json!([{"capabilityKey": held, "maxRows": 5, "maxBytes": 500}]));
            assert!(!held.permits(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY));
        }
        // And an empty grant set (the default: nothing is seeded) denies.
        assert!(envelope(json!([]))
            .bounds_for(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY)
            .is_none());
    }

    #[test]
    fn exact_actor_org_and_company_match_returns_typed_bounds() {
        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        let granted = envelope(json!([
            {"capabilityKey": "ai.evidence.inspect", "maxRows": 99, "maxBytes": 999},
            {"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 4, "maxBytes": 2048},
        ]));
        assert_eq!(
            granted.bounds_for(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY),
            Some(CapabilityGrantBounds {
                max_rows: 4,
                max_bytes: 2048
            })
        );

        for (field, value) in [
            ("organizationId", json!(8)),
            ("companyId", json!(10)),
            ("actorIdentity", json!("b".repeat(64))),
        ] {
            let mut foreign = json!({
                "organizationId": 7,
                "companyId": 9,
                "actorIdentity": "a".repeat(64),
                "grants": [{"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 4, "maxBytes": 2048}],
            });
            foreign[field] = value;
            let foreign: CapabilityGrantEnvelope =
                serde_json::from_value(foreign).expect("foreign envelope");
            assert!(
                foreign
                    .bounds_for(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY)
                    .is_none(),
                "{field} mismatch must deny"
            );
        }
    }

    #[test]
    fn duplicate_capability_rows_can_only_narrow_bounds() {
        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        let duplicated = envelope(json!([
            {"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 10, "maxBytes": 100},
            {"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 3, "maxBytes": 900},
            {"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 0, "maxBytes": 1},
        ]));
        assert_eq!(
            duplicated.bounds_for(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY),
            Some(CapabilityGrantBounds {
                max_rows: 3,
                max_bytes: 100
            })
        );
    }

    #[test]
    fn malformed_grant_envelopes_do_not_parse() {
        for malformed in [
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a", "grants": [{"capabilityKey": "x", "maxRows": -1, "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a", "grants": [{"capabilityKey": "x", "maxRows": "1", "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a", "grants": [{"capabilityKey": "x", "maxRows": 1, "maxBytes": 1, "extra": true}]}),
            json!({"organizationId": 7, "companyId": 9, "grants": []}),
            json!({"companyId": 9, "actorIdentity": "a", "grants": []}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a"}),
            json!({"grants": []}),
            json!("grants"),
        ] {
            assert!(
                serde_json::from_value::<CapabilityGrantEnvelope>(malformed.clone()).is_err(),
                "{malformed}"
            );
        }
    }

    /// Serve `handler` on an ephemeral loopback port for one test.
    async fn grant_service(router: axum::Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind grant service");
        let address = listener.local_addr().expect("local addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn grant_service_outcomes_fail_closed() {
        use axum::{http::StatusCode, routing::get, Router};

        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        let http = reqwest::Client::new();
        let short = Duration::from_millis(150);

        // Healthy: parses to a typed envelope.
        let body = json!({
            "organizationId": 7,
            "companyId": 9,
            "actorIdentity": "a".repeat(64),
            "grants": [{"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 2, "maxBytes": 64}],
        });
        let healthy = grant_service(Router::new().route(
            "/v1/ai/capability-grants",
            get(move || {
                let body = body.clone();
                async move { axum::Json(body) }
            }),
        ))
        .await;
        let envelope = fetch_actor_grants(&http, &healthy, &actor, short)
            .await
            .expect("healthy grant service");
        assert!(envelope.permits(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY));

        // Timeout: no answer within the deadline is "unavailable", never "allowed".
        let slow = grant_service(Router::new().route(
            "/v1/ai/capability-grants",
            get(|| async {
                tokio::time::sleep(Duration::from_secs(5)).await;
                axum::Json(json!({"grants": []}))
            }),
        ))
        .await;
        let started = std::time::Instant::now();
        assert!(matches!(
            fetch_actor_grants(&http, &slow, &actor, short).await,
            Err(AppError::Unavailable(_))
        ));
        assert!(started.elapsed() < Duration::from_secs(2));

        // Server error is unavailable; client error (revoked session) is forbidden.
        let broken = grant_service(Router::new().route(
            "/v1/ai/capability-grants",
            get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
        ))
        .await;
        assert!(matches!(
            fetch_actor_grants(&http, &broken, &actor, short).await,
            Err(AppError::Unavailable(_))
        ));
        let unauthorized = grant_service(Router::new().route(
            "/v1/ai/capability-grants",
            get(|| async { StatusCode::UNAUTHORIZED }),
        ))
        .await;
        assert!(matches!(
            fetch_actor_grants(&http, &unauthorized, &actor, short).await,
            Err(AppError::Forbidden(_))
        ));

        // A 200 with a malformed envelope is unavailable, not an empty allow.
        let malformed = grant_service(Router::new().route(
            "/v1/ai/capability-grants",
            get(|| async { axum::Json(json!({"grants": [{"capabilityKey": "x"}]})) }),
        ))
        .await;
        assert!(matches!(
            fetch_actor_grants(&http, &malformed, &actor, short).await,
            Err(AppError::Unavailable(_))
        ));

        // Nothing listening at all.
        assert!(matches!(
            fetch_actor_grants(&http, "http://127.0.0.1:9", &actor, short).await,
            Err(AppError::Unavailable(_))
        ));
    }
}
