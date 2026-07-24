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
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use stdb_auth::FieldAccessContext;
use stdb_config::runtime_is_production;
use tower_cookies::Cookies;

use crate::{
    error::ApiError,
    session::parse_stdb_identity_hex,
    state::AppState,
    web_session::{require_org, resolve_session},
};

const MAX_IDEMPOTENCY_KEY_LEN: usize = 160;
const MAX_STATUS_ROWS: usize = 500;
const STATUS_COLUMNS: &str = "id, organization_id, company_id, skill_id, skill_version_id, \
    fixture_id, status, requested_at, requester_superuser_bypass, runtime_profile_id, \
    certification_environment_id, attempt_count, claimed_at, terminal_at, error_code";

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
    state
        .client_with_token(&session.stdb_token)
        .call_reducer(
            "request_ai_skill_certification",
            json!([organization_id, params]),
        )
        .await
        .map_err(|error| {
            ApiError::Unprocessable(format!("request AI skill certification: {error}"))
        })?;

    let request_key = certification_request_key(
        organization_id,
        &session.identity_hex,
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
    state: &AppState,
    organization_id: u64,
    request_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let mut rows = state
        .stdb
        .query_sql(&certification_status_sql(organization_id, request_id))
        .await
        .map_err(|error| {
            ApiError::Internal(format!("load AI skill certification status: {error}"))
        })?;
    add_current_passing_evidence(state, organization_id, &mut rows).await?;
    rows.sort_by_key(|row| std::cmp::Reverse(row_id(row)));
    Ok(rows)
}

async fn add_current_passing_evidence(
    state: &AppState,
    organization_id: u64,
    requests: &mut [Value],
) -> Result<(), ApiError> {
    let queries = [
        format!(
            "SELECT certification_request_id, skill_version_id, fixture_id, runtime_profile_id, \
             certification_environment_id, status, source_hash, manifest_hash, fixture_hash, \
             runtime_hash, environment_hash, policy_snapshot_hash, execution_evidence_hash \
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
        results.push(state.stdb.query_sql(&query).await.map_err(|error| {
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
        let current = request_has_current_passing_evidence(
            request,
            active_profile,
            &evidence_by_request,
            &version_by_id,
            &fixture_by_id,
            &environment_by_fixture,
        );
        if let Some(object) = request.as_object_mut() {
            object.insert(
                "hasCurrentPassingEvidence".to_string(),
                Value::Bool(current),
            );
        }
    }
    Ok(())
}

fn request_has_current_passing_evidence(
    request: &Value,
    active_profile: Option<&Value>,
    evidence_by_request: &HashMap<u64, &Value>,
    version_by_id: &HashMap<u64, &Value>,
    fixture_by_id: &HashMap<u64, &Value>,
    environment_by_fixture: &HashMap<u64, &Value>,
) -> bool {
    if value_string(request, "status", "status")
        .is_none_or(|status| !status.eq_ignore_ascii_case("completed"))
    {
        return false;
    }
    let Some(request_id) = value_u64(request, "id", "id") else {
        return false;
    };
    let Some(version_id) = value_u64(request, "skillVersionId", "skill_version_id") else {
        return false;
    };
    let Some(fixture_id) = value_u64(request, "fixtureId", "fixture_id") else {
        return false;
    };
    let Some(evidence) = evidence_by_request.get(&request_id).copied() else {
        return false;
    };
    let Some(profile) = active_profile else {
        return false;
    };
    let Some(version) = version_by_id.get(&version_id).copied() else {
        return false;
    };
    let Some(fixture) = fixture_by_id.get(&fixture_id).copied() else {
        return false;
    };
    let Some(environment) = environment_by_fixture.get(&fixture_id).copied() else {
        return false;
    };

    let Some(profile_id) = value_u64(profile, "id", "id") else {
        return false;
    };
    let Some(environment_id) = value_u64(environment, "id", "id") else {
        return false;
    };
    let Some(runtime_hash) = value_string(profile, "runtimeHash", "runtime_hash") else {
        return false;
    };
    let Some(environment_hash) = value_string(
        environment,
        "environmentFingerprint",
        "environment_fingerprint",
    ) else {
        return false;
    };
    let Some(source_hash) = value_string(version, "sourceHash", "source_hash") else {
        return false;
    };
    let Some(manifest_json) = value_string(version, "manifestJson", "manifest_json") else {
        return false;
    };
    let Some(fixture_hash) = fixture_fingerprint(fixture) else {
        return false;
    };

    value_string(evidence, "status", "status")
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
            })
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
    let rows = load_certification_status(&state, organization_id, None).await?;
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
    let row = load_certification_status(&state, organization_id, Some(request_id))
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::NotFound("certification request not found".into()))?;
    Ok(Json(json!({ "data": row })))
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

        assert!(request_has_current_passing_evidence(
            &request,
            Some(&profile),
            &evidence_by_request,
            &version_by_id,
            &fixture_by_id,
            &environment_by_fixture,
        ));

        let stale_profile = json!({"id": 6, "runtimeHash": runtime_hash});
        assert!(!request_has_current_passing_evidence(
            &request,
            Some(&stale_profile),
            &evidence_by_request,
            &version_by_id,
            &fixture_by_id,
            &environment_by_fixture,
        ));
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
