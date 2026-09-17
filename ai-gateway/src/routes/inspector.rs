//! AIH-16 — Source and decision inspector read surface.
//!
//! `POST /v1/inspector` asks the module (via the `request_inspect_ai_*`
//! reducers) to build a claim/decision/component/answer inspection view
//! authorized for a specific caller, then reads the resulting
//! `ai_inspector_result` row with the service client and returns the payload.
//!
//! When the BFF supplies the reviewer's `stdb_token`, the reducer is called
//! through a per-request client so `caller_identity` is the reviewer and
//! `check_permission` evaluates the reviewer's permissions (denied sources
//! stay redacted). Without a token the service client's own identity is used.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use stdb_client::StdbClientError;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

const VIEW_KINDS: [&str; 4] = ["claim", "decision", "component", "answer"];
const CORRELATION_MAX_LEN: usize = 256;
/// One initial read plus up to 3 retries while the reducer result lands.
const RESULT_READ_ATTEMPTS: usize = 4;
const RESULT_READ_RETRY_DELAY_MS: u64 = 150;

#[derive(Debug, Deserialize)]
pub struct InspectRequest {
    pub org_id: u64,
    /// Accepted for BFF parity; the inspector reducers authorize on
    /// organization + target only.
    #[allow(dead_code)] // body-shape parity with the frontend BFF
    pub company_id: Option<u64>,
    pub view_kind: String,
    pub claim_id: Option<u64>,
    pub decision_id: Option<u64>,
    pub component_id: Option<u64>,
    pub run_id: Option<u64>,
    pub correlation: Option<String>,
    /// Reviewer token; when present the inspection is authorized and redacted
    /// for that identity instead of the service identity.
    pub stdb_token: Option<String>,
    /// Accepted for BFF parity; authorization is derived from `stdb_token`.
    #[allow(dead_code)] // body-shape parity with the frontend BFF
    pub identity_hex: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct InspectResponse {
    pub correlation: String,
    pub view_kind: String,
    pub payload: Value,
}

pub async fn post_inspect(
    State(state): State<AppState>,
    Json(req): Json<InspectRequest>,
) -> AppResult<Response> {
    if req.org_id == 0 {
        return Err(AppError::BadRequest("org_id is required".into()));
    }
    let reducer = view_kind_reducer(&req.view_kind).ok_or_else(|| {
        AppError::BadRequest(format!(
            "view_kind must be one of: {}",
            VIEW_KINDS.join(", ")
        ))
    })?;
    let target_id = resolve_target_id(&req)?;
    let correlation = validate_correlation(req.correlation.as_deref())?;

    let call_client = req
        .stdb_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(|token| state.stdb.with_token(token.to_string()))
        .unwrap_or_else(|| state.stdb.as_ref().clone());

    call_inspect_reducer(&call_client, reducer, req.org_id, &correlation, target_id)
        .await
        .map_err(map_reducer_rejection)?;

    // The result row is always read with the service client (owner-level SQL
    // access), mirroring the answer-gate private-table reads.
    let read_sql = build_result_read_sql(req.org_id, &correlation);
    let mut row = None;
    for attempt in 0..RESULT_READ_ATTEMPTS {
        let rows = state
            .stdb
            .query_sql(&read_sql)
            .await
            .map_err(|e| AppError::Internal(format!("read ai_inspector_result: {e}")))?;
        if let Some(found) = rows.into_iter().next() {
            row = Some(found);
            break;
        }
        if attempt + 1 < RESULT_READ_ATTEMPTS {
            tokio::time::sleep(std::time::Duration::from_millis(RESULT_READ_RETRY_DELAY_MS)).await;
        }
    }

    let Some(row) = row else {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "inspection result not found" })),
        )
            .into_response());
    };

    let payload_json = row_str(&row, "payloadJson", "payload_json");
    let payload: Value = serde_json::from_str(&payload_json)
        .map_err(|_| AppError::Internal("inspection payload is not valid JSON".into()))?;
    let view_kind = {
        let from_row = row_str(&row, "viewKind", "view_kind");
        if from_row.is_empty() {
            req.view_kind.clone()
        } else {
            from_row
        }
    };

    Ok(Json(InspectResponse {
        correlation,
        view_kind,
        payload,
    })
    .into_response())
}

// ── Validation helpers ──────────────────────────────────────────────────────

/// Map a validated `view_kind` to its request reducer.
fn view_kind_reducer(view_kind: &str) -> Option<&'static str> {
    match view_kind.trim() {
        "claim" => Some("request_inspect_ai_claim"),
        "decision" => Some("request_inspect_ai_decision"),
        "component" => Some("request_inspect_ai_artifact_component"),
        "answer" => Some("request_inspect_ai_answer"),
        _ => None,
    }
}

/// Exactly one nonzero target id is required, and it must match `view_kind`.
fn resolve_target_id(req: &InspectRequest) -> Result<u64, AppError> {
    let ids: [(&str, Option<u64>); 4] = [
        ("claim_id", req.claim_id),
        ("decision_id", req.decision_id),
        ("component_id", req.component_id),
        ("run_id", req.run_id),
    ];
    let supplied: Vec<(&str, u64)> = ids
        .iter()
        .filter_map(|(name, id)| id.filter(|v| *v > 0).map(|v| (*name, v)))
        .collect();
    if supplied.len() != 1 {
        return Err(AppError::BadRequest(format!(
            "exactly one of {} is required (nonzero)",
            ids.iter()
                .map(|(name, _)| *name)
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    let (name, id) = supplied[0];
    let expected = match req.view_kind.trim() {
        "claim" => "claim_id",
        "decision" => "decision_id",
        "component" => "component_id",
        "answer" => "run_id",
        _ => "view_kind",
    };
    if name != expected {
        return Err(AppError::BadRequest(format!(
            "{name} does not match view_kind {}",
            req.view_kind.trim()
        )));
    }
    Ok(id)
}

/// Validate a caller-supplied correlation, or generate a uuid v4 when absent.
/// Quotes, semicolons and backslashes are rejected so the value can never
/// break out of the SQL string literal it is interpolated into.
fn validate_correlation(raw: Option<&str>) -> Result<String, AppError> {
    let Some(supplied) = raw.map(str::trim).filter(|c| !c.is_empty()) else {
        return Ok(new_correlation());
    };
    if supplied.len() > CORRELATION_MAX_LEN {
        return Err(AppError::BadRequest(
            "correlation must be 1..=256 characters".into(),
        ));
    }
    if supplied.contains(['\'', '"', ';', '\\']) {
        return Err(AppError::BadRequest(
            "correlation contains unsupported characters".into(),
        ));
    }
    Ok(supplied.to_string())
}

fn new_correlation() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ── Reducer call and error mapping ──────────────────────────────────────────

/// The `reducer_call!` macro needs a literal reducer name, so dispatch here.
/// Args mirror the module reducers: `[organization_id, correlation, target_id]`.
async fn call_inspect_reducer(
    client: &stdb_client::StdbClient,
    reducer: &str,
    org_id: u64,
    correlation: &str,
    target_id: u64,
) -> anyhow::Result<()> {
    let args = json!([org_id, correlation, target_id]);
    match reducer {
        "request_inspect_ai_claim" => {
            client
                .call_reducer(stdb_client::reducer_call!("request_inspect_ai_claim", args))
                .await
        }
        "request_inspect_ai_decision" => {
            client
                .call_reducer(stdb_client::reducer_call!(
                    "request_inspect_ai_decision",
                    args
                ))
                .await
        }
        "request_inspect_ai_artifact_component" => {
            client
                .call_reducer(stdb_client::reducer_call!(
                    "request_inspect_ai_artifact_component",
                    args
                ))
                .await
        }
        "request_inspect_ai_answer" => {
            client
                .call_reducer(stdb_client::reducer_call!(
                    "request_inspect_ai_answer",
                    args
                ))
                .await
        }
        other => anyhow::bail!("unknown inspector reducer {other}"),
    }
}

/// SpacetimeDB reports reducer failures (permission denial, validation) as
/// HTTP 530 with the reducer's message in the body; surface those as 403 so
/// the reviewer sees the module's rejection reason. Everything else stays an
/// internal error.
fn map_reducer_rejection(error: anyhow::Error) -> AppError {
    let Some(client_error) = error.downcast_ref::<StdbClientError>() else {
        return AppError::Internal(error.to_string());
    };
    let Some(body) = client_error.response_body() else {
        return AppError::Internal(error.to_string());
    };
    if client_error.status_code() != Some(530) {
        return AppError::Internal(error.to_string());
    }
    AppError::Forbidden(reducer_error_message(body))
}

/// The reducer error body is a plain message; extract a JSON `error` field
/// defensively if the body happens to be structured.
fn reducer_error_message(body: &str) -> String {
    if let Ok(parsed) = serde_json::from_str::<Value>(body) {
        if let Some(message) = parsed.get("error").and_then(Value::as_str) {
            return message.to_string();
        }
        if let Value::String(message) = parsed {
            return message;
        }
    }
    body.to_string()
}

// ── Result read ─────────────────────────────────────────────────────────────

fn build_result_read_sql(org_id: u64, correlation: &str) -> String {
    let escaped = correlation.replace('\'', "''");
    format!(
        "SELECT id, view_kind, payload_json FROM ai_inspector_result \
         WHERE organization_id = {org_id} AND correlation = '{escaped}'"
    )
}

fn row_str(row: &Value, camel: &str, snake: &str) -> String {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(view_kind: &str, ids: &[(&str, u64)]) -> InspectRequest {
        let mut req = InspectRequest {
            org_id: 9,
            company_id: Some(2),
            view_kind: view_kind.into(),
            claim_id: None,
            decision_id: None,
            component_id: None,
            run_id: None,
            correlation: None,
            stdb_token: None,
            identity_hex: None,
        };
        for (name, id) in ids {
            match *name {
                "claim_id" => req.claim_id = Some(*id),
                "decision_id" => req.decision_id = Some(*id),
                "component_id" => req.component_id = Some(*id),
                "run_id" => req.run_id = Some(*id),
                _ => panic!("unknown id field {name}"),
            }
        }
        req
    }

    #[test]
    fn view_kind_maps_to_its_reducer() {
        assert_eq!(view_kind_reducer("claim"), Some("request_inspect_ai_claim"));
        assert_eq!(
            view_kind_reducer("decision"),
            Some("request_inspect_ai_decision")
        );
        assert_eq!(
            view_kind_reducer("component"),
            Some("request_inspect_ai_artifact_component")
        );
        assert_eq!(
            view_kind_reducer("answer"),
            Some("request_inspect_ai_answer")
        );
        assert_eq!(view_kind_reducer(" Claim "), None);
        assert_eq!(view_kind_reducer("source"), None);
        assert_eq!(view_kind_reducer(""), None);
    }

    #[test]
    fn target_id_requires_exactly_one_match() {
        assert_eq!(
            resolve_target_id(&request("claim", &[("claim_id", 5)])).unwrap(),
            5
        );
        assert_eq!(
            resolve_target_id(&request("decision", &[("decision_id", 7)])).unwrap(),
            7
        );
        assert_eq!(
            resolve_target_id(&request("component", &[("component_id", 3)])).unwrap(),
            3
        );
        assert_eq!(
            resolve_target_id(&request("answer", &[("run_id", 42)])).unwrap(),
            42
        );

        // Mismatched id for the view kind.
        assert!(resolve_target_id(&request("claim", &[("run_id", 42)])).is_err());
        // None supplied.
        assert!(resolve_target_id(&request("claim", &[])).is_err());
        // Two supplied.
        assert!(resolve_target_id(&request("claim", &[("claim_id", 5), ("run_id", 42)])).is_err());
        // Zero is not a target.
        assert!(resolve_target_id(&request("claim", &[("claim_id", 0)])).is_err());
    }

    #[test]
    fn correlation_is_generated_trimmed_or_rejected() {
        let generated = validate_correlation(None).expect("generated");
        assert!(!generated.is_empty());
        assert!(uuid::Uuid::parse_str(&generated).is_ok());

        // Blank input behaves like absent input.
        assert!(
            uuid::Uuid::parse_str(&validate_correlation(Some("  ")).expect("generated")).is_ok()
        );

        assert_eq!(
            validate_correlation(Some("  review-42  ")).expect("valid"),
            "review-42"
        );

        let exactly_256: String = "c".repeat(256);
        assert_eq!(
            validate_correlation(Some(&exactly_256)).expect("valid"),
            exactly_256
        );
        let too_long: String = "c".repeat(257);
        assert!(matches!(
            validate_correlation(Some(&too_long)),
            Err(AppError::BadRequest(_))
        ));

        for hostile in [
            "o'brien",
            "safe'; DROP TABLE x; --",
            "back\\slash",
            "semi;colon",
            "quo\"te",
        ] {
            assert!(
                matches!(
                    validate_correlation(Some(hostile)),
                    Err(AppError::BadRequest(_))
                ),
                "correlation {hostile:?} must be rejected"
            );
        }
    }

    #[test]
    fn result_read_sql_is_paranoid_about_quotes() {
        assert_eq!(
            build_result_read_sql(9, "abc-123"),
            "SELECT id, view_kind, payload_json FROM ai_inspector_result \
             WHERE organization_id = 9 AND correlation = 'abc-123'"
        );
        // Even though quotes are rejected at validation time, the builder
        // still escapes them.
        assert_eq!(
            build_result_read_sql(9, "a'b"),
            "SELECT id, view_kind, payload_json FROM ai_inspector_result \
             WHERE organization_id = 9 AND correlation = 'a''b'"
        );
    }

    #[test]
    fn reducer_rejection_maps_530_to_forbidden_with_message() {
        let error = anyhow::Error::new(StdbClientError::Http(
            "530 <unknown status code>".into(),
            "Permission denied: read on ai_source".into(),
        ));
        assert!(
            matches!(map_reducer_rejection(error), AppError::Forbidden(ref m)
                if m == "Permission denied: read on ai_source")
        );

        let json_error = anyhow::Error::new(StdbClientError::Http(
            "530 <unknown status code>".into(),
            "{\"error\":\"claim not found\"}".into(),
        ));
        assert!(
            matches!(map_reducer_rejection(json_error), AppError::Forbidden(ref m)
                if m == "claim not found")
        );
    }

    #[test]
    fn non_reducer_failures_stay_internal() {
        let http_400 = anyhow::Error::new(StdbClientError::Http(
            "400 Bad Request".into(),
            "Unsupported".into(),
        ));
        assert!(matches!(
            map_reducer_rejection(http_400),
            AppError::Internal(_)
        ));

        let parse_error = anyhow::Error::new(StdbClientError::Parse("bad json".into()));
        assert!(matches!(
            map_reducer_rejection(parse_error),
            AppError::Internal(_)
        ));

        let plain = anyhow::anyhow!("network unreachable");
        assert!(matches!(
            map_reducer_rejection(plain),
            AppError::Internal(_)
        ));
    }
}
