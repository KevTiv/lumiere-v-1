//! Protected AI skill certification request and status routes.
//!
//! The browser may enqueue and inspect certification work. Only the separately
//! authenticated gateway executor can claim or complete requests.

use std::{collections::HashMap, sync::Arc};

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use stdb_auth::FieldAccessContext;
use stdb_config::runtime_is_production;
use tower_cookies::Cookies;

use crate::{
    commands::dispatch_session_reducer,
    error::ApiError,
    query_exec::authorize_membership_company_ids,
    session::parse_stdb_identity_hex,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::{require_org, resolve_session},
};

const MAX_IDEMPOTENCY_KEY_LEN: usize = 160;
const MAX_STATUS_ROWS: usize = 500;
const MAX_PROMOTION_TEXT_LEN: usize = 65_536;
const STATUS_COLUMNS: &str = "id, organization_id, company_id, skill_id, skill_version_id, \
    fixture_id, status, requested_at, requester_superuser_bypass, runtime_profile_id, \
    certification_environment_id, attempt_count, claimed_at, terminal_at, error_code";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CertificationReadiness {
    ready: bool,
    code: &'static str,
}

fn ensure_ai_skill_access(
    field_access: Option<&FieldAccessContext>,
    action: &str,
) -> Result<(), ApiError> {
    if field_access.is_none() && !runtime_is_production() {
        return Ok(());
    }
    let allowed = field_access.is_some_and(|access| {
        access.is_superuser
            || access.role_permissions.iter().any(|permission| {
                permission == "*:*"
                    || permission == "ai_skill:*"
                    || permission == &format!("ai_skill:{action}")
            })
    });
    if allowed {
        Ok(())
    } else {
        Err(ApiError::Forbidden(format!(
            "Permission denied: {action} on ai_skill"
        )))
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RequestCertificationBody {
    company_id: u64,
    skill_version_id: u64,
    fixture_id: u64,
    idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProposeKnowledgePromotionBody {
    company_id: u64,
    idempotency_key: String,
    knowledge_version_id: u64,
    skill_id: Option<u64>,
    skill_key: String,
    skill_name: String,
    manifest_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ReviewKnowledgePromotionBody {
    company_id: u64,
    outcome: String,
    note: Option<String>,
}

fn validate_request(body: &RequestCertificationBody) -> Result<(), ApiError> {
    if body.company_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId must be a positive integer".into(),
        ));
    }
    if body.skill_version_id == 0 {
        return Err(ApiError::BadRequest(
            "skillVersionId must be a positive integer".into(),
        ));
    }
    if body.fixture_id == 0 {
        return Err(ApiError::BadRequest(
            "fixtureId must be a positive integer".into(),
        ));
    }
    let key = body.idempotency_key.as_str();
    if key.is_empty()
        || key.trim() != key
        || key.len() > MAX_IDEMPOTENCY_KEY_LEN
        || key.chars().any(char::is_control)
    {
        return Err(ApiError::BadRequest(
            "idempotencyKey must be trimmed, non-empty, and at most 160 bytes".into(),
        ));
    }
    Ok(())
}

fn validate_promotion(body: &ProposeKnowledgePromotionBody) -> Result<(), ApiError> {
    if body.company_id == 0 || body.knowledge_version_id == 0 || body.skill_id == Some(0) {
        return Err(ApiError::BadRequest(
            "companyId, knowledgeVersionId, and optional skillId must be positive".into(),
        ));
    }
    for (name, value, max) in [
        ("idempotencyKey", body.idempotency_key.as_str(), 160),
        ("skillKey", body.skill_key.as_str(), 160),
        ("skillName", body.skill_name.as_str(), 256),
        (
            "manifestJson",
            body.manifest_json.as_str(),
            MAX_PROMOTION_TEXT_LEN,
        ),
    ] {
        if value.trim().is_empty()
            || value.trim() != value
            || value.len() > max
            || value.chars().any(char::is_control) && name != "manifestJson"
        {
            return Err(ApiError::BadRequest(format!("invalid {name}")));
        }
    }
    Ok(())
}

fn validate_promotion_review(body: &ReviewKnowledgePromotionBody) -> Result<(), ApiError> {
    if body.company_id == 0 || !matches!(body.outcome.as_str(), "accepted" | "rejected") {
        return Err(ApiError::BadRequest(
            "companyId must be positive and outcome must be accepted or rejected".into(),
        ));
    }
    if body.note.as_ref().is_some_and(|note| note.len() > 2_000) {
        return Err(ApiError::BadRequest(
            "note must be at most 2000 bytes".into(),
        ));
    }
    Ok(())
}

async fn request_certification(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<RequestCertificationBody>,
) -> Result<Json<Value>, ApiError> {
    validate_request(&body)?;
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    ensure_ai_skill_access(session.field_access.as_ref(), "write")?;

    let params = json!({
        "companyId": body.company_id,
        "skillVersionId": body.skill_version_id,
        "fixtureId": body.fixture_id,
        "idempotencyKey": body.idempotency_key,
    });
    let context = dispatch_session_reducer(
        &state,
        &session,
        "request_ai_skill_certification",
        json!([organization_id, params]),
    )
    .await?;

    let request_key = certification_request_key(
        organization_id,
        context.actor_identity(),
        &body.idempotency_key,
    )?;
    let mut rows = state
        .stdb
        .query_sql(&format!(
            "SELECT {STATUS_COLUMNS} FROM ai_skill_certification_request \
             WHERE organization_id = {organization_id} AND request_key = '{request_key}' LIMIT 1"
        ))
        .await
        .map_err(|error| {
            ApiError::Internal(format!("load requested AI skill certification: {error}"))
        })?;
    let row = rows
        .pop()
        .ok_or_else(|| ApiError::Internal("certification request was not persisted".into()))?;

    Ok(Json(json!({ "data": row })))
}

fn certification_request_key(
    organization_id: u64,
    identity_hex: &str,
    idempotency_key: &str,
) -> Result<String, ApiError> {
    let identity = parse_stdb_identity_hex(identity_hex).ok_or_else(|| ApiError::Unauthorized)?;
    let digest = Sha256::digest(idempotency_key.as_bytes());
    Ok(format!("{organization_id}:{identity}:sha256:{digest:x}"))
}

fn certification_status_sql(organization_id: u64, request_id: Option<u64>) -> String {
    let request_filter = request_id
        .map(|id| format!(" AND id = {id}"))
        .unwrap_or_default();
    let limit = if request_id.is_some() {
        1
    } else {
        MAX_STATUS_ROWS
    };
    format!(
        "SELECT {STATUS_COLUMNS} \
         FROM ai_skill_certification_request \
         WHERE organization_id = {organization_id}{request_filter} LIMIT {limit}"
    )
}

async fn load_certification_status(
    client: &stdb_client::StdbClient,
    organization_id: u64,
    request_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let mut rows = client
        .query_sql(&certification_status_sql(organization_id, request_id))
        .await
        .map_err(|error| {
            ApiError::Internal(format!("load AI skill certification status: {error}"))
        })?;
    add_current_passing_evidence(client, organization_id, &mut rows).await?;
    rows.sort_by_key(|row| std::cmp::Reverse(row_id(row)));
    Ok(rows)
}

async fn add_current_passing_evidence(
    client: &stdb_client::StdbClient,
    organization_id: u64,
    requests: &mut [Value],
) -> Result<(), ApiError> {
    let queries = [
        format!(
            "SELECT id, certification_request_id, skill_version_id, fixture_id, runtime_profile_id, \
             certification_environment_id, status, source_hash, manifest_hash, fixture_hash, \
             runtime_hash, environment_hash, policy_snapshot_hash, execution_evidence_hash, \
             executor_run_id, failure_kind, failure_reason, executed_at \
             FROM ai_skill_certification_evidence WHERE organization_id = {organization_id} LIMIT 2000"
        ),
        format!(
            "SELECT id, runtime_hash FROM ai_skill_certification_runtime_profile \
             WHERE organization_id = {organization_id} AND is_active = true LIMIT 2"
        ),
        format!(
            "SELECT id, source_hash, manifest_json FROM ai_skill_version \
             WHERE organization_id = {organization_id} LIMIT 2000"
        ),
        format!(
            "SELECT id, fixture_key, input_json, expected_output_json FROM ai_skill_fixture \
             WHERE organization_id = {organization_id} LIMIT 2000"
        ),
        format!(
            "SELECT id, fixture_id, environment_fingerprint \
             FROM ai_skill_certification_environment \
             WHERE organization_id = {organization_id} LIMIT 2000"
        ),
    ];
    let mut results = Vec::with_capacity(queries.len());
    for query in queries {
        results.push(client.query_sql(&query).await.map_err(|error| {
            ApiError::Internal(format!("load AI certification readiness: {error}"))
        })?);
    }

    let evidence = results.remove(0);
    let profiles = results.remove(0);
    let versions = results.remove(0);
    let fixtures = results.remove(0);
    let environments = results.remove(0);

    let evidence_by_request: HashMap<u64, &Value> = evidence
        .iter()
        .filter_map(|row| {
            value_u64(row, "certificationRequestId", "certification_request_id").map(|id| (id, row))
        })
        .collect();
    let version_by_id: HashMap<u64, &Value> = versions
        .iter()
        .filter_map(|row| value_u64(row, "id", "id").map(|id| (id, row)))
        .collect();
    let fixture_by_id: HashMap<u64, &Value> = fixtures
        .iter()
        .filter_map(|row| value_u64(row, "id", "id").map(|id| (id, row)))
        .collect();
    let mut environment_by_fixture = HashMap::<u64, &Value>::new();
    for environment in &environments {
        let Some(fixture_id) = value_u64(environment, "fixtureId", "fixture_id") else {
            continue;
        };
        let id = value_u64(environment, "id", "id").unwrap_or_default();
        let replace = environment_by_fixture
            .get(&fixture_id)
            .and_then(|row| value_u64(row, "id", "id"))
            .is_none_or(|current| id > current);
        if replace {
            environment_by_fixture.insert(fixture_id, environment);
        }
    }
    let active_profile = (profiles.len() == 1).then(|| &profiles[0]);

    for request in requests {
        let readiness = certification_readiness(
            request,
            active_profile,
            &evidence_by_request,
            &version_by_id,
            &fixture_by_id,
            &environment_by_fixture,
        );
        let evidence = value_u64(request, "id", "id")
            .and_then(|request_id| evidence_by_request.get(&request_id).copied())
            .cloned()
            .unwrap_or(Value::Null);
        if let Some(object) = request.as_object_mut() {
            object.insert(
                "hasCurrentPassingEvidence".to_string(),
                Value::Bool(readiness.ready),
            );
            object.insert(
                "readiness".to_string(),
                serde_json::to_value(&readiness).expect("readiness is serializable"),
            );
            object.insert("evidence".to_string(), evidence);
        }
    }
    Ok(())
}

fn certification_readiness(
    request: &Value,
    active_profile: Option<&Value>,
    evidence_by_request: &HashMap<u64, &Value>,
    version_by_id: &HashMap<u64, &Value>,
    fixture_by_id: &HashMap<u64, &Value>,
    environment_by_fixture: &HashMap<u64, &Value>,
) -> CertificationReadiness {
    let status = value_string(request, "status", "status")
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(status.as_str(), "queued" | "running") {
        return readiness(false, "certification_pending");
    }
    if status != "completed" {
        return readiness(false, "certification_failed");
    }
    let Some(request_id) = value_u64(request, "id", "id") else {
        return readiness(false, "invalid_request");
    };
    let Some(version_id) = value_u64(request, "skillVersionId", "skill_version_id") else {
        return readiness(false, "version_unavailable");
    };
    let Some(fixture_id) = value_u64(request, "fixtureId", "fixture_id") else {
        return readiness(false, "fixture_unavailable");
    };
    let Some(evidence) = evidence_by_request.get(&request_id).copied() else {
        return readiness(false, "evidence_missing");
    };
    let Some(profile) = active_profile else {
        return readiness(false, "runtime_unavailable");
    };
    let Some(version) = version_by_id.get(&version_id).copied() else {
        return readiness(false, "version_unavailable");
    };
    let Some(fixture) = fixture_by_id.get(&fixture_id).copied() else {
        return readiness(false, "fixture_unavailable");
    };
    let Some(environment) = environment_by_fixture.get(&fixture_id).copied() else {
        return readiness(false, "environment_unavailable");
    };

    let Some(profile_id) = value_u64(profile, "id", "id") else {
        return readiness(false, "runtime_unavailable");
    };
    let Some(environment_id) = value_u64(environment, "id", "id") else {
        return readiness(false, "environment_unavailable");
    };
    let Some(runtime_hash) = value_string(profile, "runtimeHash", "runtime_hash") else {
        return readiness(false, "runtime_unavailable");
    };
    let Some(environment_hash) = value_string(
        environment,
        "environmentFingerprint",
        "environment_fingerprint",
    ) else {
        return readiness(false, "environment_unavailable");
    };
    let Some(source_hash) = value_string(version, "sourceHash", "source_hash") else {
        return readiness(false, "version_unavailable");
    };
    let Some(manifest_json) = value_string(version, "manifestJson", "manifest_json") else {
        return readiness(false, "version_unavailable");
    };
    let Some(fixture_hash) = fixture_fingerprint(fixture) else {
        return readiness(false, "fixture_unavailable");
    };

    let current = value_string(evidence, "status", "status")
        .is_some_and(|status| status.eq_ignore_ascii_case("passed"))
        && value_u64(request, "runtimeProfileId", "runtime_profile_id") == Some(profile_id)
        && value_u64(evidence, "runtimeProfileId", "runtime_profile_id") == Some(profile_id)
        && value_u64(
            request,
            "certificationEnvironmentId",
            "certification_environment_id",
        ) == Some(environment_id)
        && value_u64(
            evidence,
            "certificationEnvironmentId",
            "certification_environment_id",
        ) == Some(environment_id)
        && value_u64(evidence, "skillVersionId", "skill_version_id") == Some(version_id)
        && value_u64(evidence, "fixtureId", "fixture_id") == Some(fixture_id)
        && value_string(evidence, "runtimeHash", "runtime_hash").as_deref()
            == Some(runtime_hash.as_str())
        && value_string(evidence, "environmentHash", "environment_hash").as_deref()
            == Some(environment_hash.as_str())
        && value_string(evidence, "sourceHash", "source_hash").as_deref()
            == Some(source_hash.as_str())
        && value_string(evidence, "manifestHash", "manifest_hash").as_deref()
            == Some(sha256(manifest_json.as_bytes()).as_str())
        && value_string(evidence, "fixtureHash", "fixture_hash").as_deref()
            == Some(fixture_hash.as_str())
        && ["policySnapshotHash", "executionEvidenceHash"]
            .iter()
            .all(|camel| {
                let snake = if *camel == "policySnapshotHash" {
                    "policy_snapshot_hash"
                } else {
                    "execution_evidence_hash"
                };
                value_string(evidence, camel, snake).is_some_and(|hash| valid_sha256(&hash))
            });
    readiness(
        current,
        if current {
            "ready"
        } else {
            "evidence_stale_or_failed"
        },
    )
}

fn readiness(ready: bool, code: &'static str) -> CertificationReadiness {
    CertificationReadiness { ready, code }
}

fn fixture_fingerprint(fixture: &Value) -> Option<String> {
    let fixture_key = value_string(fixture, "fixtureKey", "fixture_key")?;
    let input = value_string(fixture, "inputJson", "input_json")?;
    let expected = value_string(fixture, "expectedOutputJson", "expected_output_json")?;
    let mut hasher = Sha256::new();
    for value in [
        fixture_key.as_bytes(),
        input.as_bytes(),
        expected.as_bytes(),
    ] {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value);
    }
    Some(format!("sha256:{:x}", hasher.finalize()))
}

fn value_u64(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn value_string(row: &Value, camel: &str, snake: &str) -> Option<String> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn valid_sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn value_u64_list(row: &Value, camel: &str, snake: &str) -> Option<Vec<u64>> {
    row.get(camel)
        .or_else(|| row.get(snake))?
        .as_array()?
        .iter()
        .map(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
        .collect()
}

fn knowledge_lineage_hash(version: &Value) -> Option<String> {
    let mut hasher = Sha256::new();
    hasher.update(b"lumiere.ai.knowledge-promotion.v1");
    for part in [
        value_u64(version, "organizationId", "organization_id")?.to_string(),
        value_u64(version, "companyId", "company_id")?.to_string(),
        value_u64(version, "entryId", "entry_id")?.to_string(),
        value_u64(version, "id", "id")?.to_string(),
        value_u64(version, "reviewEpoch", "review_epoch")?.to_string(),
        value_string(version, "title", "title")?,
        value_string(version, "body", "body")?,
    ] {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part.as_bytes());
    }
    for ids in [
        value_u64_list(version, "sourcePassageIds", "source_passage_ids")?,
        value_u64_list(version, "claimIds", "claim_ids")?,
        value_u64_list(version, "decisionIds", "decision_ids")?,
    ] {
        hasher.update((ids.len() as u64).to_be_bytes());
        for id in ids {
            hasher.update(id.to_be_bytes());
        }
    }
    Some(format!("{:x}", hasher.finalize()))
}

async fn bind_manifest_to_knowledge_lineage(
    state: &AppState,
    organization_id: u64,
    company_id: u64,
    knowledge_version_id: u64,
    manifest_json: &str,
) -> Result<String, ApiError> {
    let mut rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, entry_id, review_epoch, title, body, \
             source_passage_ids, claim_ids, decision_ids FROM ai_knowledge_entry_version \
             WHERE organization_id = {organization_id} AND company_id = {company_id} \
             AND id = {knowledge_version_id} LIMIT 1"
        ))
        .await
        .map_err(|error| ApiError::Internal(format!("load knowledge lineage: {error}")))?;
    let version = rows
        .pop()
        .ok_or_else(|| ApiError::NotFound("knowledge version not found".into()))?;
    let lineage_hash = knowledge_lineage_hash(&version)
        .ok_or_else(|| ApiError::Internal("knowledge lineage is incomplete".into()))?;
    let mut manifest: Value = serde_json::from_str(manifest_json)
        .map_err(|_| ApiError::BadRequest("manifestJson must be a JSON object".into()))?;
    let object = manifest
        .as_object_mut()
        .ok_or_else(|| ApiError::BadRequest("manifestJson must be a JSON object".into()))?;
    object.insert(
        "source_hash".to_string(),
        Value::String(format!("sha256:{lineage_hash}")),
    );
    serde_json::to_string(&manifest)
        .map_err(|error| ApiError::Internal(format!("serialize promotion manifest: {error}")))
}

fn row_id(row: &Value) -> u64 {
    row.get("id")
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
        .unwrap_or_default()
}

async fn list_certifications(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    ensure_ai_skill_access(session.field_access.as_ref(), "read")?;
    let _context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let rows = load_certification_status(&state.stdb, organization_id, None).await?;
    Ok(Json(json!({ "data": rows })))
}

async fn get_certification(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(request_id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    if request_id == 0 {
        return Err(ApiError::BadRequest(
            "certification request id must be positive".into(),
        ));
    }
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    ensure_ai_skill_access(session.field_access.as_ref(), "read")?;
    let _context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let row = load_certification_status(&state.stdb, organization_id, Some(request_id))
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::NotFound("certification request not found".into()))?;
    Ok(Json(json!({ "data": row })))
}

const PROMOTION_COLUMNS: &str = "id, organization_id, company_id, knowledge_entry_id, \
    knowledge_version_id, knowledge_review_epoch, source_passage_ids, claim_ids, decision_ids, \
    requested_skill_id, skill_key, skill_name, lineage_hash, payload_hash, status, \
    certification_state, skill_id, skill_version_id, proposed_by, proposed_at, reviewed_by, \
    reviewed_at, review_note, invalidated_at";

async fn authorize_promotion_company(
    state: &AppState,
    session: &crate::session::ApiSession,
    organization_id: u64,
    company_id: u64,
) -> Result<(), ApiError> {
    authorize_membership_company_ids(
        &state.stdb,
        organization_id,
        &session.identity_hex,
        &[company_id],
        "Cannot access another company's knowledge promotions",
    )
    .await
}

async fn list_knowledge_promotions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(company_id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    if company_id == 0 {
        return Err(ApiError::BadRequest("company id must be positive".into()));
    }
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    ensure_ai_skill_access(session.field_access.as_ref(), "read")?;
    authorize_promotion_company(&state, &session, organization_id, company_id).await?;
    let _context = TrustedOperationContext::for_resource_read(&state, &session)?
        .with_company_scope(vec![company_id])?;
    let mut rows = state
        .stdb
        .query_sql(&format!(
            "SELECT {PROMOTION_COLUMNS} FROM ai_knowledge_skill_promotion \
             WHERE organization_id = {organization_id} AND company_id = {company_id} LIMIT {MAX_STATUS_ROWS}"
        ))
        .await
        .map_err(|error| ApiError::Internal(format!("load knowledge promotions: {error}")))?;
    rows.sort_by_key(|row| std::cmp::Reverse(row_id(row)));
    Ok(Json(json!({ "data": rows })))
}

async fn propose_knowledge_promotion(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<ProposeKnowledgePromotionBody>,
) -> Result<Json<Value>, ApiError> {
    validate_promotion(&body)?;
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    ensure_ai_skill_access(session.field_access.as_ref(), "write")?;
    authorize_promotion_company(&state, &session, organization_id, body.company_id).await?;
    let manifest_json = bind_manifest_to_knowledge_lineage(
        &state,
        organization_id,
        body.company_id,
        body.knowledge_version_id,
        &body.manifest_json,
    )
    .await?;
    dispatch_session_reducer(
        &state,
        &session,
        "propose_ai_knowledge_skill_promotion",
        json!([organization_id, body.company_id, {
            "idempotencyKey": body.idempotency_key,
            "knowledgeVersionId": body.knowledge_version_id,
            "skillId": body.skill_id,
            "skillKey": body.skill_key,
            "skillName": body.skill_name,
            "manifestJson": manifest_json,
        }]),
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn review_knowledge_promotion(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(promotion_id): Path<u64>,
    Json(body): Json<ReviewKnowledgePromotionBody>,
) -> Result<Json<Value>, ApiError> {
    if promotion_id == 0 {
        return Err(ApiError::BadRequest("promotion id must be positive".into()));
    }
    validate_promotion_review(&body)?;
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    ensure_ai_skill_access(session.field_access.as_ref(), "write")?;
    authorize_promotion_company(&state, &session, organization_id, body.company_id).await?;
    dispatch_session_reducer(
        &state,
        &session,
        "review_ai_knowledge_skill_promotion",
        json!([organization_id, body.company_id, promotion_id, {
            "outcome": body.outcome,
            "note": body.note,
        }]),
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/ai/skills/certifications",
            get(list_certifications).post(request_certification),
        )
        .route(
            "/ai/skills/certifications/:request_id",
            get(get_certification),
        )
        .route(
            "/ai/knowledge/skill-promotions",
            axum::routing::post(propose_knowledge_promotion),
        )
        .route(
            "/ai/knowledge/skill-promotions/company/:company_id",
            get(list_knowledge_promotions),
        )
        .route(
            "/ai/knowledge/skill-promotions/:promotion_id/review",
            axum::routing::post(review_knowledge_promotion),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_body() -> RequestCertificationBody {
        RequestCertificationBody {
            company_id: 1,
            skill_version_id: 2,
            fixture_id: 3,
            idempotency_key: "certification:2:3".to_string(),
        }
    }

    #[test]
    fn certification_request_requires_bounded_identifiers() {
        assert!(validate_request(&valid_body()).is_ok());

        let mut body = valid_body();
        body.company_id = 0;
        assert!(validate_request(&body).is_err());

        let mut body = valid_body();
        body.idempotency_key = " padded ".to_string();
        assert!(validate_request(&body).is_err());

        let mut body = valid_body();
        body.idempotency_key = "x".repeat(MAX_IDEMPOTENCY_KEY_LEN + 1);
        assert!(validate_request(&body).is_err());
    }

    #[test]
    fn certification_request_rejects_caller_asserted_results() {
        let parsed = serde_json::from_value::<RequestCertificationBody>(json!({
            "companyId": 1,
            "skillVersionId": 2,
            "fixtureId": 3,
            "idempotencyKey": "certification:2:3",
            "actualOutputJson": {"forged": true},
        }));
        assert!(parsed.is_err());
    }

    #[test]
    fn certification_request_key_is_actor_scoped_and_hashed() {
        let identity = "a".repeat(64);
        let key = certification_request_key(41, &identity, "retry-safe-key")
            .expect("valid identity should create a request key");

        assert!(key.starts_with(&format!("41:{identity}:sha256:")));
        assert!(!key.contains("retry-safe-key"));
        assert!(certification_request_key(41, "not-an-identity", "key").is_err());
    }

    #[test]
    fn certification_status_requires_ai_skill_permission() {
        let denied = FieldAccessContext {
            organization_id: 41,
            role_id: 1,
            role_name: "viewer".to_string(),
            is_superuser: false,
            role_permissions: vec!["contact:read".to_string()],
            identity_hex: "a".repeat(64),
            field_permissions: vec![],
        };
        assert!(ensure_ai_skill_access(Some(&denied), "read").is_err());

        let mut allowed = denied;
        allowed.role_permissions.push("ai_skill:read".to_string());
        assert!(ensure_ai_skill_access(Some(&allowed), "read").is_ok());
    }

    #[test]
    fn promotion_readiness_rejects_stale_runtime_or_environment() {
        let runtime_hash = format!("sha256:{}", "a".repeat(64));
        let environment_hash = format!("sha256:{}", "b".repeat(64));
        let manifest_json = "{\"skill_key\":\"report_composer\"}";
        let fixture = json!({
            "id": 3,
            "fixtureKey": "41:2:smoke",
            "inputJson": "{\"value\":1}",
            "expectedOutputJson": "{\"value\":2}",
        });
        let fixture_hash = fixture_fingerprint(&fixture).expect("fixture hash");
        let request = json!({
            "id": 7,
            "status": "Completed",
            "skillVersionId": 2,
            "fixtureId": 3,
            "runtimeProfileId": 4,
            "certificationEnvironmentId": 5,
        });
        let evidence = json!({
            "certificationRequestId": 7,
            "status": "Passed",
            "skillVersionId": 2,
            "fixtureId": 3,
            "runtimeProfileId": 4,
            "certificationEnvironmentId": 5,
            "runtimeHash": runtime_hash,
            "environmentHash": environment_hash,
            "sourceHash": format!("sha256:{}", "c".repeat(64)),
            "manifestHash": sha256(manifest_json.as_bytes()),
            "fixtureHash": fixture_hash,
            "policySnapshotHash": format!("sha256:{}", "d".repeat(64)),
            "executionEvidenceHash": format!("sha256:{}", "e".repeat(64)),
        });
        let profile = json!({"id": 4, "runtimeHash": runtime_hash});
        let version = json!({
            "id": 2,
            "sourceHash": format!("sha256:{}", "c".repeat(64)),
            "manifestJson": manifest_json,
        });
        let environment = json!({
            "id": 5,
            "fixtureId": 3,
            "environmentFingerprint": environment_hash,
        });
        let evidence_by_request = HashMap::from([(7, &evidence)]);
        let version_by_id = HashMap::from([(2, &version)]);
        let fixture_by_id = HashMap::from([(3, &fixture)]);
        let environment_by_fixture = HashMap::from([(3, &environment)]);

        assert!(
            certification_readiness(
                &request,
                Some(&profile),
                &evidence_by_request,
                &version_by_id,
                &fixture_by_id,
                &environment_by_fixture,
            )
            .ready
        );
        assert_eq!(
            certification_readiness(
                &request,
                Some(&profile),
                &evidence_by_request,
                &version_by_id,
                &fixture_by_id,
                &environment_by_fixture,
            )
            .code,
            "ready"
        );

        let stale_profile = json!({"id": 6, "runtimeHash": runtime_hash});
        assert!(
            !certification_readiness(
                &request,
                Some(&stale_profile),
                &evidence_by_request,
                &version_by_id,
                &fixture_by_id,
                &environment_by_fixture,
            )
            .ready
        );
        assert_eq!(
            certification_readiness(
                &request,
                Some(&stale_profile),
                &evidence_by_request,
                &version_by_id,
                &fixture_by_id,
                &environment_by_fixture,
            )
            .code,
            "evidence_stale_or_failed"
        );
    }

    #[test]
    fn certification_readiness_explains_pending_and_missing_evidence() {
        let empty = HashMap::new();
        let queued = json!({"id": 7, "status": "Queued"});
        assert_eq!(
            certification_readiness(&queued, None, &empty, &empty, &empty, &empty).code,
            "certification_pending"
        );

        let completed = json!({
            "id": 7,
            "status": "Completed",
            "skillVersionId": 2,
            "fixtureId": 3,
        });
        assert_eq!(
            certification_readiness(&completed, None, &empty, &empty, &empty, &empty).code,
            "evidence_missing"
        );
    }

    #[test]
    fn certification_status_query_is_always_organization_scoped() {
        let list = certification_status_sql(41, None);
        assert!(list.contains("organization_id = 41"));
        assert!(!list.contains("AND id ="));
        assert!(list.ends_with("LIMIT 500"));

        let one = certification_status_sql(41, Some(73));
        assert!(one.contains("organization_id = 41"));
        assert!(one.contains("AND id = 73"));
        assert!(one.ends_with("LIMIT 1"));
    }
}
