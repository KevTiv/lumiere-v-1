//! Session-owned AIH-16 evidence inspection boundary.
//!
//! The browser supplies only target intent. Organization, acting identity and
//! actor token come from [`OrgSession`]; company intent must equal the
//! membership-derived company. The trusted gateway may perform private reads,
//! but only after this boundary resolves an active, exact
//! `ai.evidence.inspect` role grant for the acting user.

use std::{sync::Arc, time::Duration};

use axum::{
    body::Body,
    extract::State,
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue, Request, StatusCode},
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
const ACTOR_IDENTITY_HEADER: &str = "x-lumiere-actor-identity";
const ACTOR_TOKEN_HEADER: &str = "x-lumiere-actor-token";
const ORGANIZATION_HEADER: &str = "x-lumiere-organization-id";
const COMPANY_HEADER: &str = "x-lumiere-company-id";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct InspectEvidenceBody {
    company_id: u64,
    /// component | decision | claim | knowledge_version
    kind: String,
    id: u64,
}

fn validate_body(body: &InspectEvidenceBody) -> Result<(), ApiError> {
    if body.company_id == 0 || body.id == 0 {
        return Err(ApiError::BadRequest(
            "companyId and id must be positive integers".into(),
        ));
    }
    if !matches!(
        body.kind.as_str(),
        "component" | "decision" | "claim" | "knowledge_version"
    ) {
        return Err(ApiError::BadRequest(
            "kind must be component, decision, claim or knowledge_version".into(),
        ));
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

async fn inspect_evidence(
    State(state): State<Arc<AppState>>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Json(body): Json<InspectEvidenceBody>,
) -> Result<Response, ApiError> {
    validate_body(&body)?;
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    require_inspection_grant(&state, organization_id, context.actor_identity()).await?;
    let company_id = resolve_membership_company_id(
        &state.stdb,
        organization_id,
        context.actor_identity(),
        Some(body.company_id),
        "Evidence inspection company scope mismatch",
    )
    .await?;

    let response = state
        .http
        .post(format!(
            "{}/v1/evidence/inspect",
            state.config.ai_gateway_url
        ))
        .timeout(Duration::from_secs(15))
        .header(GATEWAY_SECRET_HEADER, gateway_secret()?)
        .header(ACTOR_IDENTITY_HEADER, context.actor_identity())
        .header(ACTOR_TOKEN_HEADER, &session.stdb_token)
        .header(ORGANIZATION_HEADER, organization_id.to_string())
        .header(COMPANY_HEADER, company_id.to_string())
        .json(&json!({ "kind": body.kind, "id": body.id }))
        .send()
        .await
        .map_err(ApiError::unavailable)?;
    let status = StatusCode::from_u16(response.status().as_u16())
        .map_err(|error| ApiError::Internal(format!("invalid gateway status: {error}")))?;
    if !status.is_success() {
        return Err(match status {
            StatusCode::BAD_REQUEST => ApiError::BadRequest("Evidence target is invalid".into()),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                ApiError::Forbidden("Evidence inspection is not permitted".into())
            }
            StatusCode::NOT_FOUND => ApiError::NotFound("Evidence target not found".into()),
            _ => ApiError::Unavailable("Evidence inspection is unavailable".into()),
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
        .route_layer(middleware::from_fn(no_store))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        };
        assert!(validate_body(&body).is_ok());
        let invalid = InspectEvidenceBody {
            kind: "source".into(),
            ..body
        };
        assert!(matches!(
            validate_body(&invalid),
            Err(ApiError::BadRequest(_))
        ));
    }
}
