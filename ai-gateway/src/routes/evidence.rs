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
use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    orchestrator::evidence_inspector::{
        inspect, inspect_workflow_step, retrieve_reusable_knowledge, ActorIdentity, InspectTarget,
        KnowledgeRetrieval, Viewer,
    },
    orchestrator::review_queue::{build_queue, DEFAULT_QUEUE_LIMIT},
    state::AppState,
};

const ACTOR_GRANT_TIMEOUT: Duration = Duration::from_secs(3);
const INSPECT_CAPABILITY: &str = "ai.evidence.inspect";
const KNOWLEDGE_RETRIEVE_CAPABILITY: &str = "ai.knowledge.retrieve";
/// Exact authority to have persisted evidence passages placed in a RAG answer.
/// Deliberately distinct from `ai.knowledge.retrieve` (reviewed knowledge
/// reuse): holding one never implies the other, and neither is seeded by
/// default.
pub(crate) const RAG_EVIDENCE_RETRIEVE_CAPABILITY: &str = "ai.evidence.retrieve";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InspectRequest {
    /// component | decision | claim | knowledge_version | workflow_step
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
