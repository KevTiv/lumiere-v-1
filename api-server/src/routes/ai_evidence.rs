//! Session-owned AI evidence contribution routes.

use std::sync::Arc;

use axum::{routing::post, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    commands::{dispatch_ai_evidence_mutation, dispatch_user_evidence_contribution},
    error::ApiError,
    query_exec::resolve_membership_company_id,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};

const MAX_REFERENCE_LENGTH: usize = 256;
const MAX_NOTE_LENGTH: usize = 2_000;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RecordUserContributionBody {
    company_id: u64,
    session_ref: String,
    turn_ref: Option<String>,
    event_ref: String,
    introduced_kind: String,
    source_version_id: Option<u64>,
    /// Alternative to `source_version_id`: the id of an `ai_evidence_passage`
    /// the user is citing (e.g. from a RAG answer's sources). Resolved to its
    /// bound source version server-side — the browser never supplies the
    /// version id itself in this path.
    passage_id: Option<u64>,
    inspection_state: String,
    #[serde(default)]
    is_secondary_quotation: bool,
    note: Option<String>,
}

fn validate_body(body: &RecordUserContributionBody) -> Result<(), ApiError> {
    if body.company_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId must be a positive integer".into(),
        ));
    }
    if [&body.session_ref, &body.event_ref].iter().any(|value| {
        !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    }) {
        return Err(ApiError::BadRequest(
            "sessionRef or eventRef contains unsupported characters".into(),
        ));
    }
    for (name, value) in [
        ("sessionRef", body.session_ref.as_str()),
        ("eventRef", body.event_ref.as_str()),
    ] {
        if value.trim().is_empty() || value.len() > MAX_REFERENCE_LENGTH {
            return Err(ApiError::BadRequest(format!(
                "{name} must be 1..{MAX_REFERENCE_LENGTH} bytes"
            )));
        }
    }
    if body
        .turn_ref
        .as_ref()
        .is_some_and(|value| value.trim().is_empty() || value.len() > MAX_REFERENCE_LENGTH)
    {
        return Err(ApiError::BadRequest(format!(
            "turnRef must be 1..{MAX_REFERENCE_LENGTH} bytes"
        )));
    }
    if body
        .note
        .as_ref()
        .is_some_and(|value| value.len() > MAX_NOTE_LENGTH)
    {
        return Err(ApiError::BadRequest(format!(
            "note must be at most {MAX_NOTE_LENGTH} bytes"
        )));
    }
    if !matches!(body.introduced_kind.as_str(), "source_version" | "concept") {
        return Err(ApiError::BadRequest(
            "introducedKind must be source_version or concept".into(),
        ));
    }
    if body.source_version_id.is_some_and(|id| id == 0)
        || body.passage_id.is_some_and(|id| id == 0)
    {
        return Err(ApiError::BadRequest(
            "sourceVersionId and passageId must be positive when present".into(),
        ));
    }
    match (
        body.introduced_kind.as_str(),
        body.source_version_id,
        body.passage_id,
    ) {
        ("source_version", None, None) => {
            return Err(ApiError::BadRequest(
                "a source_version contribution requires exactly one of sourceVersionId or passageId".into(),
            ));
        }
        ("source_version", Some(_), Some(_)) => {
            return Err(ApiError::BadRequest(
                "provide only one of sourceVersionId or passageId".into(),
            ));
        }
        ("concept", Some(_), _) | ("concept", _, Some(_)) => {
            return Err(ApiError::BadRequest(
                "sourceVersionId and passageId are not allowed for a concept contribution".into(),
            ));
        }
        _ => {}
    }
    if !matches!(
        body.inspection_state.as_str(),
        "unverified_recollection" | "user_reported" | "inspected"
    ) {
        return Err(ApiError::BadRequest(
            "inspectionState must be unverified_recollection, user_reported or inspected".into(),
        ));
    }
    if body.is_secondary_quotation && body.introduced_kind != "source_version" {
        return Err(ApiError::BadRequest(
            "only a source_version contribution may be a secondary quotation".into(),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CaptureDecisionBody {
    company_id: u64,
    session_ref: String,
    turn_ref: Option<String>,
    event_ref: String,
    title: String,
    adopted_claim_ids: Vec<u64>,
    #[serde(default)]
    supporting_claim_ids: Vec<u64>,
    #[serde(default)]
    applicability: Vec<String>,
    #[serde(default)]
    alternatives: Vec<String>,
    #[serde(default)]
    adaptations: Vec<String>,
    #[serde(default)]
    assumptions: Vec<String>,
    rationale: String,
    supersedes_decision_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ReviewEvidenceBody {
    company_id: u64,
    /// claim | decision | component
    kind: String,
    id: u64,
    outcome: String,
    note: Option<String>,
    /// For a component confirmation: the exact content hash the reviewer
    /// inspected. It binds the confirmation to that content; it is not
    /// authority, and the reducer rechecks it against the step's current hash.
    #[serde(default)]
    expected_content_hash: Option<String>,
}

fn is_content_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_positive_ids(name: &str, ids: &[u64], required: bool) -> Result<(), ApiError> {
    if (required && ids.is_empty())
        || ids.len() > 64
        || ids.iter().any(|id| *id == 0)
        || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
    {
        return Err(ApiError::BadRequest(format!("invalid {name}")));
    }
    Ok(())
}

fn validate_text_list(name: &str, values: &[String]) -> Result<(), ApiError> {
    if values.len() > 32
        || values
            .iter()
            .any(|value| value.trim().is_empty() || value.len() > 1_000)
    {
        return Err(ApiError::BadRequest(format!("invalid {name}")));
    }
    Ok(())
}

fn validate_decision_body(body: &CaptureDecisionBody) -> Result<(), ApiError> {
    let contribution = RecordUserContributionBody {
        company_id: body.company_id,
        session_ref: body.session_ref.clone(),
        turn_ref: body.turn_ref.clone(),
        event_ref: body.event_ref.clone(),
        introduced_kind: "concept".into(),
        source_version_id: None,
        passage_id: None,
        inspection_state: "user_reported".into(),
        is_secondary_quotation: false,
        note: Some(body.rationale.clone()),
    };
    validate_body(&contribution)?;
    if body.title.trim().is_empty()
        || body.title.len() > 512
        || body.rationale.trim().is_empty()
        || body.rationale.len() > MAX_NOTE_LENGTH
        || body.supersedes_decision_id == Some(0)
    {
        return Err(ApiError::BadRequest(
            "invalid decision text or revision".into(),
        ));
    }
    validate_positive_ids("adoptedClaimIds", &body.adopted_claim_ids, true)?;
    validate_positive_ids("supportingClaimIds", &body.supporting_claim_ids, false)?;
    if body
        .supporting_claim_ids
        .iter()
        .any(|id| body.adopted_claim_ids.contains(id))
    {
        return Err(ApiError::BadRequest(
            "a claim cannot be both adopted and supporting".into(),
        ));
    }
    for (name, values) in [
        ("applicability", body.applicability.as_slice()),
        ("alternatives", body.alternatives.as_slice()),
        ("adaptations", body.adaptations.as_slice()),
        ("assumptions", body.assumptions.as_slice()),
    ] {
        validate_text_list(name, values)?;
    }
    Ok(())
}

fn row_id(row: &Value) -> Option<u64> {
    row.get("id")
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_u64_field(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

/// Resolve a cited passage to the source version it is bound to. Scoped to
/// the caller's own organization/company so a passage id cannot be used to
/// probe another tenant's evidence graph.
async fn resolve_passage_source_version_id(
    context: &TrustedOperationContext,
    organization_id: u64,
    company_id: u64,
    passage_id: u64,
) -> Result<u64, ApiError> {
    let rows = context
        .client()
        .query_sql_sats(&format!(
            "SELECT * FROM ai_evidence_passage WHERE organization_id = {organization_id} AND company_id = {company_id} AND id = {passage_id} LIMIT 2"
        ))
        .await
        .map_err(ApiError::internal)?;
    if rows.len() != 1 {
        return Err(ApiError::NotFound("cited passage not found".into()));
    }
    row_u64_field(&rows[0], "sourceVersionId", "source_version_id").ok_or_else(|| {
        ApiError::Unprocessable("cited passage is not bound to a source version".into())
    })
}

async fn contribution_id(
    state: &AppState,
    organization_id: u64,
    company_id: u64,
    actor_identity: &str,
    session_ref: &str,
    event_ref: &str,
) -> Result<u64, ApiError> {
    let identity = stdb_auth::identity_sql_literal(actor_identity).map_err(ApiError::Internal)?;
    let sql = format!(
        "SELECT * FROM ai_evidence_contribution WHERE organization_id = {organization_id} AND company_id = {company_id} AND contributor_uid = {identity} AND session_ref = '{session_ref}' AND event_ref = '{event_ref}' LIMIT 2"
    );
    let rows = state
        .stdb
        .query_sql_sats(&sql)
        .await
        .map_err(ApiError::internal)?;
    if rows.len() != 1 {
        return Err(ApiError::Internal(
            "recorded evidence contribution could not be resolved uniquely".into(),
        ));
    }
    row_id(&rows[0]).ok_or_else(|| ApiError::Internal("invalid contribution id".into()))
}

async fn decision_id(
    state: &AppState,
    organization_id: u64,
    company_id: u64,
    contribution_id: u64,
) -> Result<u64, ApiError> {
    let sql = format!(
        "SELECT * FROM ai_evidence_decision WHERE organization_id = {organization_id} AND company_id = {company_id} AND contribution_id = {contribution_id} LIMIT 2"
    );
    let rows = state
        .stdb
        .query_sql_sats(&sql)
        .await
        .map_err(ApiError::internal)?;
    if rows.len() != 1 {
        return Err(ApiError::Internal(
            "recorded evidence decision could not be resolved uniquely".into(),
        ));
    }
    row_id(&rows[0]).ok_or_else(|| ApiError::Internal("invalid decision id".into()))
}

fn opaque_dispatch_error(error: ApiError) -> ApiError {
    match error {
        ApiError::Unauthorized => ApiError::Unauthorized,
        ApiError::Forbidden(_) => ApiError::Forbidden("Evidence mutation is not permitted".into()),
        ApiError::BadRequest(_) | ApiError::Unprocessable(_) => {
            ApiError::Unprocessable("Evidence mutation was rejected".into())
        }
        ApiError::Conflict(_) => ApiError::Conflict("Evidence mutation conflict".into()),
        other => ApiError::internal(other),
    }
}

async fn record_user_contribution(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Json(body): Json<RecordUserContributionBody>,
) -> Result<Json<Value>, ApiError> {
    validate_body(&body)?;
    let read_context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let company_id = resolve_membership_company_id(
        read_context.client(),
        organization_id,
        read_context.actor_identity(),
        Some(body.company_id),
        "evidence contribution company scope mismatch",
    )
    .await
    .map_err(opaque_dispatch_error)?;

    let source_version_id = match (body.source_version_id, body.passage_id) {
        (Some(id), None) => Some(id),
        (None, Some(passage_id)) => Some(
            resolve_passage_source_version_id(
                &read_context,
                organization_id,
                company_id,
                passage_id,
            )
            .await?,
        ),
        (None, None) => None,
        (Some(_), Some(_)) => unreachable!("validate_body rejects both fields set"),
    };

    let event_ref = body.event_ref.trim().to_string();
    let params = json!({
        "contributor_kind": "user",
        "agent_run_id": null,
        "session_ref": body.session_ref.trim(),
        "turn_ref": body.turn_ref.as_deref().map(str::trim),
        "event_ref": event_ref,
        "introduced_kind": body.introduced_kind,
        "source_version_id": source_version_id,
        "inspection_state": body.inspection_state,
        "is_secondary_quotation": body.is_secondary_quotation,
        "note": body.note,
    });
    dispatch_user_evidence_contribution(
        &state,
        &session,
        json!([organization_id, company_id, params]),
    )
    .await
    .map_err(opaque_dispatch_error)?;

    Ok(Json(json!({ "ok": true, "eventRef": event_ref })))
}

async fn capture_decision(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Json(body): Json<CaptureDecisionBody>,
) -> Result<Json<Value>, ApiError> {
    validate_decision_body(&body)?;
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let company_id = resolve_membership_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(body.company_id),
        "evidence decision company scope mismatch",
    )
    .await
    .map_err(opaque_dispatch_error)?;
    let event_ref = body.event_ref.trim().to_string();
    let session_ref = body.session_ref.trim().to_string();
    let rationale = body.rationale.trim().to_string();
    let contribution_params = json!({
        "contributor_kind": "user",
        "agent_run_id": null,
        "session_ref": session_ref.clone(),
        "turn_ref": body.turn_ref.as_deref().map(str::trim),
        "event_ref": event_ref.clone(),
        "introduced_kind": "concept",
        "source_version_id": null,
        "inspection_state": "user_reported",
        "is_secondary_quotation": false,
        "note": rationale.clone(),
    });
    dispatch_user_evidence_contribution(
        &state,
        &session,
        json!([organization_id, company_id, contribution_params]),
    )
    .await
    .map_err(opaque_dispatch_error)?;
    let contribution_id = contribution_id(
        &state,
        organization_id,
        company_id,
        context.actor_identity(),
        &session_ref,
        &event_ref,
    )
    .await?;
    let params = json!({
        "title": body.title.trim(),
        "adopted_claim_ids": body.adopted_claim_ids,
        "supporting_claim_ids": body.supporting_claim_ids,
        "applicability": body.applicability,
        "alternatives": body.alternatives,
        "adaptations": body.adaptations,
        "assumptions": body.assumptions,
        "rationale": rationale,
        "contribution_id": contribution_id,
        "supersedes_decision_id": body.supersedes_decision_id,
    });
    dispatch_ai_evidence_mutation(
        &state,
        &session,
        "record_ai_evidence_decision",
        json!([organization_id, company_id, params]),
    )
    .await
    .map_err(opaque_dispatch_error)?;
    let decision_id = decision_id(&state, organization_id, company_id, contribution_id).await?;
    Ok(Json(json!({
        "ok": true,
        "contributionId": contribution_id,
        "decisionId": decision_id,
        "eventRef": event_ref,
    })))
}

async fn review_evidence(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Json(body): Json<ReviewEvidenceBody>,
) -> Result<Json<Value>, ApiError> {
    if body.company_id == 0
        || body.id == 0
        || body
            .note
            .as_ref()
            .is_some_and(|v| v.len() > MAX_NOTE_LENGTH)
    {
        return Err(ApiError::BadRequest("invalid review target or note".into()));
    }
    let (reducer, params) = match body.kind.as_str() {
        "claim"
            if matches!(
                body.outcome.as_str(),
                "supported" | "unsupported" | "qualified"
            ) =>
        {
            (
                "review_ai_evidence_claim",
                json!({ "verification_outcome": body.outcome, "verification_note": body.note }),
            )
        }
        "decision" if matches!(body.outcome.as_str(), "accepted" | "rejected") => (
            "review_ai_evidence_decision",
            json!({ "outcome": body.outcome, "note": body.note }),
        ),
        "component" if matches!(body.outcome.as_str(), "confirmed" | "unresolved") => {
            if body.outcome == "confirmed"
                && !body
                    .expected_content_hash
                    .as_deref()
                    .is_some_and(is_content_hash)
            {
                return Err(ApiError::BadRequest(
                    "confirming a component needs the content hash reviewed".into(),
                ));
            }
            (
                "review_ai_artifact_component_links",
                json!({
                    "outcome": body.outcome,
                    "note": body.note,
                    "expected_content_hash": body.expected_content_hash,
                }),
            )
        }
        "claim" | "decision" | "component" => {
            return Err(ApiError::BadRequest("invalid review outcome".into()));
        }
        _ => {
            return Err(ApiError::BadRequest(
                "kind must be claim, decision or component".into(),
            ))
        }
    };
    if body.kind != "component" && body.expected_content_hash.is_some() {
        return Err(ApiError::BadRequest(
            "expectedContentHash is only valid for a component".into(),
        ));
    }
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let company_id = resolve_membership_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(body.company_id),
        "evidence review company scope mismatch",
    )
    .await
    .map_err(opaque_dispatch_error)?;
    dispatch_ai_evidence_mutation(
        &state,
        &session,
        reducer,
        json!([organization_id, company_id, body.id, params]),
    )
    .await
    .map_err(opaque_dispatch_error)?;
    Ok(Json(
        json!({ "ok": true, "kind": body.kind, "id": body.id }),
    ))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/ai/evidence/contributions", post(record_user_contribution))
        .route("/ai/evidence/decisions", post(capture_decision))
        .route("/ai/evidence/reviews", post(review_evidence))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query_exec::enforce_requested_company;

    #[test]
    fn sibling_company_is_denied_by_canonical_membership_scope() {
        let error = enforce_requested_company(9, Some(10), "scope mismatch")
            .expect_err("sibling company must be denied");
        assert!(matches!(error, ApiError::Forbidden(_)));
    }

    #[test]
    fn request_contract_rejects_actor_and_organization_spoofing() {
        for extra in [
            json!({ "organizationId": 7 }),
            json!({ "contributorKind": "agent" }),
            json!({ "agentRunId": 22 }),
            json!({ "reducer": "anything" }),
        ] {
            let mut request = json!({
                "companyId": 9,
                "sessionRef": "session-1",
                "eventRef": "event-1",
                "introducedKind": "concept",
                "inspectionState": "unverified_recollection"
            });
            request
                .as_object_mut()
                .expect("object")
                .extend(extra.as_object().expect("extra object").clone());
            assert!(serde_json::from_value::<RecordUserContributionBody>(request).is_err());
        }
    }

    #[test]
    fn request_requires_bounded_idempotency_key() {
        let body = RecordUserContributionBody {
            company_id: 9,
            session_ref: "session-1".into(),
            turn_ref: None,
            event_ref: "x".repeat(MAX_REFERENCE_LENGTH + 1),
            introduced_kind: "concept".into(),
            source_version_id: None,
            passage_id: None,
            inspection_state: "unverified_recollection".into(),
            is_secondary_quotation: false,
            note: None,
        };
        assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn request_requires_consistent_source_and_inspection_semantics() {
        let mut body = RecordUserContributionBody {
            company_id: 9,
            session_ref: "session-1".into(),
            turn_ref: None,
            event_ref: "event-1".into(),
            introduced_kind: "source_version".into(),
            source_version_id: None,
            passage_id: None,
            inspection_state: "inspected".into(),
            is_secondary_quotation: false,
            note: None,
        };
        assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));
        body.introduced_kind = "concept".into();
        body.source_version_id = Some(11);
        assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));
        body.source_version_id = None;
        body.inspection_state = "trusted_by_model".into();
        assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn passage_id_and_source_version_id_are_mutually_exclusive_alternatives() {
        let mut body = RecordUserContributionBody {
            company_id: 9,
            session_ref: "session-1".into(),
            turn_ref: None,
            event_ref: "event-1".into(),
            introduced_kind: "source_version".into(),
            source_version_id: Some(11),
            passage_id: Some(22),
            inspection_state: "user_reported".into(),
            is_secondary_quotation: false,
            note: None,
        };
        assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));

        body.source_version_id = None;
        assert!(validate_body(&body).is_ok());

        body.passage_id = None;
        body.source_version_id = Some(0);
        assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));

        body.source_version_id = None;
        body.passage_id = Some(0);
        assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));

        body.passage_id = Some(22);
        body.introduced_kind = "concept".into();
        assert!(matches!(validate_body(&body), Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn decision_capture_rejects_authority_fields_and_invalid_claim_sets() {
        let request = json!({
            "companyId": 9,
            "sessionRef": "session-1",
            "eventRef": "event-1",
            "title": "Adopt policy",
            "adoptedClaimIds": [11],
            "rationale": "Reviewed against the cited policy.",
            "organizationId": 7,
        });
        assert!(serde_json::from_value::<CaptureDecisionBody>(request).is_err());

        let body = CaptureDecisionBody {
            company_id: 9,
            session_ref: "session-1".into(),
            turn_ref: None,
            event_ref: "event-1".into(),
            title: "Adopt policy".into(),
            adopted_claim_ids: vec![11, 11],
            supporting_claim_ids: vec![],
            applicability: vec![],
            alternatives: vec![],
            adaptations: vec![],
            assumptions: vec![],
            rationale: "Reviewed against the cited policy.".into(),
            supersedes_decision_id: None,
        };
        assert!(matches!(
            validate_decision_body(&body),
            Err(ApiError::BadRequest(_))
        ));
    }

    #[test]
    fn component_confirmation_names_the_exact_content_reviewed() {
        assert!(is_content_hash(&"ab12".repeat(16)));
        for invalid in [
            "",
            "abc",
            &"AB12".repeat(16),
            &"zz12".repeat(16),
            &"a".repeat(65),
        ] {
            assert!(!is_content_hash(invalid), "{invalid}");
        }
        let request = json!({
            "companyId": 9, "kind": "component", "id": 11, "outcome": "confirmed",
            "note": "reviewed the edit", "expectedContentHash": "ab12".repeat(16),
        });
        let body: ReviewEvidenceBody = serde_json::from_value(request).expect("valid");
        assert_eq!(
            body.expected_content_hash.as_deref(),
            Some("ab12".repeat(16).as_str())
        );
    }

    #[test]
    fn review_contract_rejects_actor_spoofing() {
        let request = json!({
            "companyId": 9,
            "kind": "decision",
            "id": 11,
            "outcome": "accepted",
            "note": null,
            "reviewerUid": "forged",
        });
        assert!(serde_json::from_value::<ReviewEvidenceBody>(request).is_err());
    }
}
