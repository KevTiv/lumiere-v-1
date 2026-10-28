//! Session-owned AIH-16 evidence inspection boundary.
//!
//! The browser supplies only target intent. Organization, acting identity and
//! actor token come from [`OrgSession`]; company intent must equal the
//! membership-derived company. The trusted gateway may perform private reads,
//! but only after this boundary resolves an active, exact
//! `ai.evidence.inspect` role grant for the acting user.

use lumiere_auth_context::ActorContext;
#[cfg(test)]
use lumiere_auth_context::ACTOR_TOKEN_HEADER;
use std::{sync::Arc, time::Duration};

use axum::{
    body::Body,
    extract::State,
    http::{
        header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_DISPOSITION},
        HeaderMap, HeaderValue, Request, StatusCode,
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    error::ApiError, query_exec::resolve_membership_company_id,
    routes::ai_capabilities::resolve_effective_capability_grants, state::AppState,
    trusted_context::TrustedOperationContext, web_session::OrgSession,
};

const INSPECT_CAPABILITY: &str = "ai.evidence.inspect";
const GATEWAY_SECRET_HEADER: &str = "x-lumiere-gateway-secret";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct InspectEvidenceBody {
    company_id: u64,
    /// component | decision | claim | knowledge_version | workflow_step | source
    kind: String,
    /// For `workflow_step`, the workflow version id.
    id: u64,
    /// The stable node key; required for, and only allowed with, `workflow_step`.
    #[serde(default)]
    node_key: Option<String>,
}

/// Company intent for the reviewer's queue. Nothing else is accepted: the
/// organization, actor and grants come from the session.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ReviewQueueBody {
    company_id: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RunEvidenceBody {
    company_id: u64,
    run_id: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RunHistoryBody {
    company_id: u64,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    limit: Option<u16>,
}

fn validate_run_history_body(body: &RunHistoryBody) -> Result<(), ApiError> {
    if body.company_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId must be a positive integer".into(),
        ));
    }
    if body
        .cursor
        .as_deref()
        .is_some_and(|cursor| cursor.is_empty() || cursor.len() > 32)
        || body.limit.is_some_and(|limit| limit == 0 || limit > 50)
    {
        return Err(ApiError::BadRequest(
            "run history pagination is invalid".into(),
        ));
    }
    Ok(())
}

fn is_stable_node_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn validate_body(body: &InspectEvidenceBody) -> Result<(), ApiError> {
    if body.company_id == 0 || body.id == 0 {
        return Err(ApiError::BadRequest(
            "companyId and id must be positive integers".into(),
        ));
    }
    if !matches!(
        body.kind.as_str(),
        "component" | "decision" | "claim" | "knowledge_version" | "workflow_step" | "source"
    ) {
        return Err(ApiError::BadRequest(
            "kind must be component, decision, claim, knowledge_version, workflow_step or source"
                .into(),
        ));
    }
    match (body.kind.as_str(), body.node_key.as_deref()) {
        ("workflow_step", Some(key)) if is_stable_node_key(key) => {}
        ("workflow_step", _) => {
            return Err(ApiError::BadRequest(
                "nodeKey is required for a workflow step".into(),
            ));
        }
        (_, Some(_)) => {
            return Err(ApiError::BadRequest(
                "nodeKey is only valid for a workflow step".into(),
            ));
        }
        _ => {}
    }
    Ok(())
}

async fn require_inspection_grant(
    state: &AppState,
    organization_id: u64,
    actor_identity: &str,
) -> Result<(), ApiError> {
    let grants = resolve_effective_capability_grants(
        state,
        organization_id,
        actor_identity,
        chrono::Utc::now().timestamp_micros(),
    )
    .await?;
    if has_inspection_grant(&grants) {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "Evidence inspection is not permitted".into(),
        ))
    }
}

fn has_inspection_grant(grants: &[crate::routes::ai_capabilities::CapabilityGrant]) -> bool {
    grants
        .iter()
        .any(|grant| grant.capability_key == INSPECT_CAPABILITY)
}

fn gateway_secret() -> Result<String, ApiError> {
    std::env::var("LUMIERE_AI_GATEWAY_INTERNAL_SECRET")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::Unavailable("Evidence inspection is unavailable".into()))
}

// OrgSession has verified this presented credential. The gateway calls the
// API to recheck grants, so it must receive the API credential, not the
// native SpacetimeDB token resolved inside the API's WorkOS binding.
fn presented_api_token(
    headers: &HeaderMap,
    cookies: &tower_cookies::Cookies,
) -> Result<String, ApiError> {
    if let Some(value) = headers.get(AUTHORIZATION) {
        return value
            .to_str()
            .ok()
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .map(str::to_owned)
            .ok_or(ApiError::Unauthorized);
    }
    cookies
        .get("stdb_token")
        .map(|cookie| cookie.value().trim().to_owned())
        .filter(|token| !token.is_empty())
        .ok_or(ApiError::Unauthorized)
}

async fn inspect_evidence(
    State(state): State<Arc<AppState>>,
    org: OrgSession,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Json(body): Json<InspectEvidenceBody>,
) -> Result<Response, ApiError> {
    let api_token = presented_api_token(&headers, &cookies)?;
    validate_body(&body)?;
    let mut target = json!({ "kind": body.kind, "id": body.id });
    if let Some(node_key) = &body.node_key {
        target["nodeKey"] = json!(node_key);
    }
    forward_evidence_read(
        &state,
        org,
        body.company_id,
        &api_token,
        "/v1/evidence/inspect",
        target,
        "Evidence inspection",
    )
    .await
}

async fn inspect_run_evidence(
    State(state): State<Arc<AppState>>,
    org: OrgSession,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Json(body): Json<RunEvidenceBody>,
) -> Result<Response, ApiError> {
    let api_token = presented_api_token(&headers, &cookies)?;
    if body.company_id == 0 || body.run_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId and runId must be positive integers".into(),
        ));
    }
    forward_evidence_read(
        &state,
        org,
        body.company_id,
        &api_token,
        "/v1/evidence/run",
        json!({ "runId": body.run_id }),
        "Run evidence inspection",
    )
    .await
}

async fn export_run_evidence(
    State(state): State<Arc<AppState>>,
    org: OrgSession,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Json(body): Json<RunEvidenceBody>,
) -> Result<Response, ApiError> {
    let api_token = presented_api_token(&headers, &cookies)?;
    if body.company_id == 0 || body.run_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId and runId must be positive integers".into(),
        ));
    }
    let run_id = body.run_id;
    let mut response = forward_evidence_read(
        &state,
        org,
        body.company_id,
        &api_token,
        "/v1/evidence/run/export",
        json!({ "runId": run_id }),
        "Run evidence export",
    )
    .await?;
    response.headers_mut().insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "attachment; filename=\"lumiere-run-{run_id}-evidence.json\""
        ))
        .map_err(|error| ApiError::Internal(error.to_string()))?,
    );
    Ok(response)
}

async fn run_history(
    State(state): State<Arc<AppState>>,
    org: OrgSession,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Json(body): Json<RunHistoryBody>,
) -> Result<Response, ApiError> {
    let api_token = presented_api_token(&headers, &cookies)?;
    validate_run_history_body(&body)?;
    forward_evidence_read(
        &state,
        org,
        body.company_id,
        &api_token,
        "/v1/evidence/runs/history",
        json!({ "cursor": body.cursor, "limit": body.limit }),
        "Run history",
    )
    .await
}

/// The reviewer's queue for the caller's own company: pending and flagged
/// claims and decisions, their sources and affected workflow steps.
async fn review_queue(
    State(state): State<Arc<AppState>>,
    org: OrgSession,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Json(body): Json<ReviewQueueBody>,
) -> Result<Response, ApiError> {
    let api_token = presented_api_token(&headers, &cookies)?;
    if body.company_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId must be a positive integer".into(),
        ));
    }
    forward_evidence_read(
        &state,
        org,
        body.company_id,
        &api_token,
        "/v1/evidence/review-queue",
        json!({}),
        "Evidence review queue",
    )
    .await
}

/// Shared boundary for the read routes: the session supplies organization,
/// actor and token, the company must be the caller's membership company, and
/// the exact `ai.evidence.inspect` grant must be active before the trusted
/// gateway is asked to read private tables.
async fn forward_evidence_read(
    state: &AppState,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    company_intent: u64,
    api_token: &str,
    gateway_path: &str,
    gateway_body: Value,
    what: &str,
) -> Result<Response, ApiError> {
    let context = TrustedOperationContext::for_resource_read(state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    require_inspection_grant(state, organization_id, context.actor_identity()).await?;
    let company_id = resolve_membership_company_id(
        &state.stdb,
        organization_id,
        context.actor_identity(),
        Some(company_intent),
        "Evidence inspection company scope mismatch",
    )
    .await?;

    let response = state
        .http
        .post(format!("{}{gateway_path}", state.config.ai_gateway_url))
        .timeout(Duration::from_secs(15))
        .header(GATEWAY_SECRET_HEADER, gateway_secret()?)
        .headers(
            ActorContext::new(
                context.actor_identity(),
                api_token,
                organization_id,
                company_id,
            )
            .and_then(|actor| actor.headers())
            .map_err(|_| ApiError::Unauthorized)?,
        )
        .json(&gateway_body)
        .send()
        .await
        .map_err(ApiError::unavailable)?;
    let status = StatusCode::from_u16(response.status().as_u16())
        .map_err(|error| ApiError::Internal(format!("invalid gateway status: {error}")))?;
    if !status.is_success() {
        return Err(match status {
            StatusCode::BAD_REQUEST => ApiError::BadRequest("Evidence target is invalid".into()),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                ApiError::Forbidden(format!("{what} is not permitted"))
            }
            StatusCode::NOT_FOUND => ApiError::NotFound("Evidence target not found".into()),
            _ => ApiError::Unavailable(format!("{what} is unavailable")),
        });
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| ApiError::Internal(format!("invalid evidence response: {error}")))?;
    let mut headers = HeaderMap::new();
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok((status, headers, Json(payload)).into_response())
}

async fn no_store(request: Request<Body>, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/ai/evidence/inspect", post(inspect_evidence))
        .route("/ai/evidence/runs/inspect", post(inspect_run_evidence))
        .route("/ai/evidence/runs/export", post(export_run_evidence))
        .route("/ai/evidence/runs/history", post(run_history))
        .route("/ai/evidence/review-queue", post(review_queue))
        .route_layer(middleware::from_fn(no_store))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspection_forwards_the_verified_api_credential_for_grant_readback() {
        let cookies = tower_cookies::Cookies::default();
        cookies.add(tower_cookies::Cookie::new("stdb_token", "cookie-session"));
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer workos-session"),
        );
        headers.insert(
            ACTOR_TOKEN_HEADER,
            HeaderValue::from_static("forged-native-token"),
        );
        assert_eq!(
            presented_api_token(&headers, &cookies).unwrap(),
            "workos-session"
        );
        headers.remove(AUTHORIZATION);
        assert_eq!(
            presented_api_token(&headers, &cookies).unwrap(),
            "cookie-session"
        );
    }

    #[test]
    fn inspection_never_falls_back_from_rejected_explicit_credentials() {
        let cookies = tower_cookies::Cookies::default();
        cookies.add(tower_cookies::Cookie::new("stdb_token", "cookie-session"));
        for invalid in ["", "Basic rejected", "Bearer "] {
            let mut headers = HeaderMap::new();
            headers.insert(AUTHORIZATION, HeaderValue::from_str(invalid).unwrap());
            assert!(matches!(
                presented_api_token(&headers, &cookies),
                Err(ApiError::Unauthorized)
            ));
        }
        assert!(matches!(
            presented_api_token(&HeaderMap::new(), &tower_cookies::Cookies::default()),
            Err(ApiError::Unauthorized)
        ));
    }

    #[test]
    fn browser_contract_rejects_authority_fields() {
        for field in [
            json!({ "organizationId": 7 }),
            json!({ "actorIdentity": "forged" }),
            json!({ "actorToken": "forged" }),
            json!({ "grants": [INSPECT_CAPABILITY] }),
        ] {
            let mut body = json!({ "companyId": 9, "kind": "claim", "id": 11 });
            body.as_object_mut()
                .expect("request object")
                .extend(field.as_object().expect("field object").clone());
            assert!(serde_json::from_value::<InspectEvidenceBody>(body).is_err());
        }
    }

    #[test]
    fn only_exact_capability_grants_access() {
        use crate::routes::ai_capabilities::CapabilityGrant;

        assert!(has_inspection_grant(&[CapabilityGrant {
            capability_key: INSPECT_CAPABILITY.into(),
            max_rows: 1,
            max_bytes: 1,
        }]));
        assert!(!has_inspection_grant(&[]));
        assert!(!has_inspection_grant(&[CapabilityGrant {
            capability_key: "*".into(),
            max_rows: 1,
            max_bytes: 1,
        }]));
    }

    #[test]
    fn target_shape_is_bounded() {
        let body = InspectEvidenceBody {
            company_id: 9,
            kind: "claim".into(),
            id: 11,
            node_key: None,
        };
        assert!(validate_body(&body).is_ok());
        let valid_source = InspectEvidenceBody {
            kind: "source".into(),
            company_id: body.company_id,
            id: body.id,
            node_key: None,
        };
        assert!(validate_body(&valid_source).is_ok());
        let invalid = InspectEvidenceBody {
            kind: "answer".into(),
            ..body
        };
        assert!(matches!(
            validate_body(&invalid),
            Err(ApiError::BadRequest(_))
        ));
    }

    #[test]
    fn workflow_step_needs_a_stable_node_key_and_nothing_else_may_carry_one() {
        let step = |node_key: Option<&str>, kind: &str| InspectEvidenceBody {
            company_id: 9,
            kind: kind.into(),
            id: 42,
            node_key: node_key.map(str::to_string),
        };
        assert!(validate_body(&step(Some("review-step"), "workflow_step")).is_ok());
        for invalid in [
            step(None, "workflow_step"),
            step(Some(""), "workflow_step"),
            step(Some("bad key'"), "workflow_step"),
            step(Some(&"x".repeat(129)), "workflow_step"),
            step(Some("review"), "claim"),
        ] {
            assert!(matches!(
                validate_body(&invalid),
                Err(ApiError::BadRequest(_))
            ));
        }
    }

    #[test]
    fn run_inspection_accepts_only_company_and_run_intent() {
        assert!(serde_json::from_value::<RunEvidenceBody>(json!({
            "companyId": 9,
            "runId": 42
        }))
        .is_ok());
        for extra in [
            json!({ "organizationId": 7 }),
            json!({ "actorIdentity": "forged" }),
            json!({ "includeRawToolOutput": true }),
            json!({ "grants": [INSPECT_CAPABILITY] }),
        ] {
            let mut body = json!({ "companyId": 9, "runId": 42 });
            body.as_object_mut()
                .expect("request object")
                .extend(extra.as_object().expect("extra object").clone());
            assert!(serde_json::from_value::<RunEvidenceBody>(body).is_err());
        }
    }

    #[test]
    fn run_history_accepts_only_bounded_pagination_intent() {
        assert!(serde_json::from_value::<RunHistoryBody>(json!({
            "companyId": 9,
            "cursor": "AQID",
            "limit": 20
        }))
        .is_ok());
        for invalid in [
            json!({"companyId": 9, "limit": 0}),
            json!({"companyId": 9, "limit": 51}),
            json!({"companyId": 9, "cursor": "x".repeat(33)}),
        ] {
            let body: RunHistoryBody = serde_json::from_value(invalid).expect("shape");
            assert!(validate_run_history_body(&body).is_err());
        }
        assert!(serde_json::from_value::<RunHistoryBody>(json!({
            "companyId": 9,
            "organizationId": 7
        }))
        .is_err());
    }

    #[test]
    fn review_queue_accepts_only_company_intent() {
        assert!(serde_json::from_value::<ReviewQueueBody>(json!({ "companyId": 9 })).is_ok());
        for extra in [
            json!({ "organizationId": 7 }),
            json!({ "actorIdentity": "forged" }),
            json!({ "limit": 1_000_000 }),
            json!({ "grants": ["ai.evidence.inspect"] }),
        ] {
            let mut body = json!({ "companyId": 9 });
            body.as_object_mut()
                .expect("request object")
                .extend(extra.as_object().expect("extra object").clone());
            assert!(serde_json::from_value::<ReviewQueueBody>(body).is_err());
        }
    }
}
