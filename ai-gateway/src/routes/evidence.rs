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
        inspect, retrieve_reusable_knowledge, ActorIdentity, InspectTarget, KnowledgeRetrieval,
        Viewer,
    },
    state::AppState,
};

const ACTOR_GRANT_TIMEOUT: Duration = Duration::from_secs(3);
const INSPECT_CAPABILITY: &str = "ai.evidence.inspect";
const KNOWLEDGE_RETRIEVE_CAPABILITY: &str = "ai.knowledge.retrieve";
pub(crate) const RAG_EVIDENCE_RETRIEVE_CAPABILITY: &str = "ai.knowledge.retrieve";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InspectRequest {
    /// component | decision | claim | knowledge_version
    pub kind: String,
    pub id: u64,
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

impl CapabilityGrantEnvelope {
    fn permits(&self, actor: &ActorCredentials, capability: &str) -> bool {
        self.organization_id == actor.organization_id
            && self.company_id == actor.company_id
            && self.actor_identity == actor.identity
            && self.grants.iter().any(|grant| {
                grant.capability_key == capability && grant.max_rows > 0 && grant.max_bytes > 0
            })
    }
}

async fn require_actor_grant(
    state: &AppState,
    actor: &ActorCredentials,
    capability: &str,
) -> AppResult<CapabilityGrantEnvelope> {
    let api_server_url =
        state.config.api_server_url.as_deref().ok_or_else(|| {
            AppError::Unavailable("acting-user authorization is unavailable".into())
        })?;
    let response = state
        .http
        .get(format!(
            "{}/v1/ai/capability-grants?companyId={}",
            api_server_url.trim_end_matches('/'),
            actor.company_id
        ))
        .bearer_auth(&actor.token)
        .header("x-stdb-identity", &actor.identity)
        .timeout(ACTOR_GRANT_TIMEOUT)
        .send()
        .await
        .map_err(|_| AppError::Unavailable("acting-user authorization is unavailable".into()))?;
    if !response.status().is_success() {
        return Err(if response.status().is_server_error() {
            AppError::Unavailable("acting-user authorization is unavailable".into())
        } else {
            AppError::Forbidden("evidence inspection is not permitted".into())
        });
    }
    let grants = response
        .json::<CapabilityGrantEnvelope>()
        .await
        .map_err(|_| AppError::Unavailable("acting-user authorization is unavailable".into()))?;
    if grants.permits(actor, capability) {
        Ok(grants)
    } else {
        Err(AppError::Forbidden(
            "evidence inspection is not permitted".into(),
        ))
    }
}

/// Re-check a BFF-supplied acting user's exact capability before a route reads
/// persisted evidence. The envelope must echo the same actor and tenant scope;
/// an unavailable grant service fails closed.
pub(crate) async fn require_scoped_capability_grant(
    state: &AppState,
    actor_identity: &str,
    actor_token: &str,
    organization_id: u64,
    company_id: u64,
    capability: &str,
) -> AppResult<()> {
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
    require_actor_grant(state, &actor, capability).await?;
    Ok(())
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
    let _grants = require_actor_grant(&state, &actor, INSPECT_CAPABILITY).await?;
    let target = InspectTarget::parse(&req.kind, req.id).ok_or_else(|| {
        AppError::BadRequest("kind must be component, decision, claim or knowledge_version".into())
    })?;
    let viewer = Viewer {
        organization_id: actor.organization_id,
        company_id: actor.company_id,
        actor_identity: ActorIdentity::parse(&actor.identity),
    };
    let inspection = inspect(state.stdb.as_ref(), viewer, target)
        .await
        .map_err(|error| {
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
    let _grants = require_actor_grant(&state, &actor, KNOWLEDGE_RETRIEVE_CAPABILITY).await?;
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
}
