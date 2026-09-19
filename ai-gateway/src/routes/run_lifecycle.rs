//! Trusted-BFF surface for durable governed-run lifecycle commands.
//!
//! Tenant and actor authority come only from headers installed by the BFF.
//! Every request re-resolves the acting user's current org/company capability
//! before reading or mutating lifecycle state.

use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use stdb_client::StdbClient;

use crate::{
    error::{AppError, AppResult},
    orchestrator::run_lifecycle::ContinuationToken,
    routes::evidence::require_scoped_capability_grant,
    state::AppState,
};

const LIFECYCLE_CAPABILITY: &str = "ai.run.lifecycle";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RunLifecycleRequest {
    pub company_id: u64,
    pub run_id: u64,
    pub intent: RunLifecycleIntent,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RunLifecycleIntent {
    View,
    Ask {
        continuation: ContinuationToken,
        question_key: String,
        prompt: String,
        response_schema_json: Option<String>,
        required: bool,
        idempotency_key: String,
    },
    Reply {
        continuation: ContinuationToken,
        question_id: u64,
        expected_question_revision: u64,
        answer: Value,
        idempotency_key: String,
    },
    Steer {
        continuation: ContinuationToken,
        instruction: String,
        idempotency_key: String,
    },
    Interrupt {
        continuation: ContinuationToken,
        reason: String,
        idempotency_key: String,
    },
    Resume {
        continuation: ContinuationToken,
        idempotency_key: String,
    },
    Fork {
        continuation: ContinuationToken,
        fork_key: String,
        child_run_key: String,
        idempotency_key: String,
    },
    Compare {
        continuation: ContinuationToken,
        right_run_id: u64,
        right: ContinuationToken,
        idempotency_key: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLifecycleResponse {
    pub run_id: u64,
    pub state: String,
    pub continuation: ContinuationToken,
    pub questions: Vec<LifecycleQuestion>,
    pub events: Vec<LifecycleEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparison: Option<LifecycleComparison>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleQuestion {
    pub id: u64,
    pub key: String,
    pub prompt: String,
    pub status: String,
    pub required: bool,
    pub revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answer: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleEvent {
    pub id: u64,
    pub kind: String,
    pub from_version: u64,
    pub to_version: u64,
    pub cursor: u32,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleComparison {
    pub left_run_id: u64,
    pub right_run_id: u64,
    pub left_continuation: ContinuationToken,
    pub right_continuation: ContinuationToken,
}

struct ActorContext {
    organization_id: u64,
    company_id: u64,
    identity: String,
    token: String,
}

pub async fn post_run_lifecycle(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RunLifecycleRequest>,
) -> AppResult<Json<RunLifecycleResponse>> {
    if req.run_id == 0 || req.company_id == 0 {
        return Err(AppError::BadRequest(
            "runId and companyId are required".into(),
        ));
    }
    let actor = actor_context(&headers, req.company_id)?;
    require_scoped_capability_grant(
        &state,
        &actor.identity,
        &actor.token,
        actor.organization_id,
        actor.company_id,
        LIFECYCLE_CAPABILITY,
    )
    .await?;

    let comparison = apply_intent(state.stdb.as_ref(), &actor, req.run_id, req.intent).await?;
    let response = load_response(
        state.stdb.as_ref(),
        actor.organization_id,
        actor.company_id,
        req.run_id,
        comparison,
    )
    .await?;
    Ok(Json(response))
}

fn actor_context(headers: &HeaderMap, requested_company_id: u64) -> AppResult<ActorContext> {
    let required = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Forbidden("acting-user context is required".into()))
    };
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
    if company_id != requested_company_id {
        return Err(AppError::Forbidden(
            "requested company does not match the acting-user scope".into(),
        ));
    }
    Ok(ActorContext {
        organization_id,
        company_id,
        identity: required("x-lumiere-actor-identity")?.to_string(),
        token: required("x-lumiere-actor-token")?.to_string(),
    })
}

async fn apply_intent(
    stdb: &StdbClient,
    actor: &ActorContext,
    run_id: u64,
    intent: RunLifecycleIntent,
) -> AppResult<Option<LifecycleComparison>> {
    let scope = [
        json!(actor.organization_id),
        json!(actor.company_id),
        json!(run_id),
    ];
    let (reducer, params, comparison) = match intent {
        RunLifecycleIntent::View => return Ok(None),
        RunLifecycleIntent::Ask {
            continuation,
            question_key,
            prompt,
            response_schema_json,
            required,
            idempotency_key,
        } => (
            "ask_ai_run_question",
            json!({"continuation": continuation_params(&continuation, run_id)?, "question_key": question_key, "prompt": prompt, "response_schema_json": response_schema_json, "required": required, "respondent_identity_hex": actor.identity, "respondent_role": "acting_user", "idempotency_key": idempotency_key}),
            None,
        ),
        RunLifecycleIntent::Reply {
            continuation,
            question_id,
            expected_question_revision,
            answer,
            idempotency_key,
        } => (
            "reply_ai_run_question",
            json!({"continuation": continuation_params(&continuation, run_id)?, "question_id": question_id, "expected_question_revision": expected_question_revision, "answer_json": serde_json::to_string(&answer).map_err(|error| AppError::BadRequest(error.to_string()))?, "respondent_identity_hex": actor.identity, "respondent_role": "acting_user", "idempotency_key": idempotency_key}),
            None,
        ),
        RunLifecycleIntent::Steer {
            continuation,
            instruction,
            idempotency_key,
        } => (
            "steer_ai_run",
            json!({"continuation": continuation_params(&continuation, run_id)?, "instruction": instruction, "idempotency_key": idempotency_key}),
            None,
        ),
        RunLifecycleIntent::Interrupt {
            continuation,
            reason,
            idempotency_key,
        } => (
            "interrupt_ai_run",
            json!({"continuation": continuation_params(&continuation, run_id)?, "reason": reason, "idempotency_key": idempotency_key}),
            None,
        ),
        RunLifecycleIntent::Resume {
            continuation,
            idempotency_key,
        } => (
            "resume_ai_run_checked",
            json!({"continuation": continuation_params(&continuation, run_id)?, "idempotency_key": idempotency_key}),
            None,
        ),
        RunLifecycleIntent::Fork {
            continuation,
            fork_key,
            child_run_key,
            idempotency_key,
        } => (
            "fork_ai_run_checked",
            json!({"continuation": continuation_params(&continuation, run_id)?, "fork_key": fork_key, "child_run_key": child_run_key, "idempotency_key": idempotency_key}),
            None,
        ),
        RunLifecycleIntent::Compare {
            continuation,
            right_run_id,
            right,
            idempotency_key,
        } => {
            continuation
                .validate()
                .map_err(|error| AppError::BadRequest(error.to_string()))?;
            right
                .validate()
                .map_err(|error| AppError::BadRequest(error.to_string()))?;
            let comparison = LifecycleComparison {
                left_run_id: run_id,
                right_run_id,
                left_continuation: continuation.clone(),
                right_continuation: right.clone(),
            };
            (
                "compare_ai_runs_checked",
                json!({"left": continuation_params(&continuation, run_id)?, "right_run_id": right_run_id, "right": continuation_params(&right, right_run_id)?, "idempotency_key": idempotency_key}),
                Some(comparison),
            )
        }
    };
    let mut arguments = scope.to_vec();
    arguments.push(params);
    let arguments = Value::Array(arguments);
    call_lifecycle_reducer(stdb, reducer, arguments).await?;
    Ok(comparison)
}

/// Release bridge for lifecycle reducers added in the current source tree.
/// The name is selected only from the closed intent enum, never request data.
async fn call_lifecycle_reducer(
    stdb: &StdbClient,
    reducer: &str,
    arguments: Value,
) -> AppResult<()> {
    if !matches!(
        reducer,
        "ask_ai_run_question"
            | "reply_ai_run_question"
            | "steer_ai_run"
            | "interrupt_ai_run"
            | "resume_ai_run_checked"
            | "fork_ai_run_checked"
            | "compare_ai_runs_checked"
    ) {
        return Err(AppError::Internal("unsupported lifecycle reducer".into()));
    }
    let response = stdb
        .http()
        .post(format!(
            "{}/v1/database/{}/call/{reducer}",
            stdb.base_url(),
            stdb.module()
        ))
        .bearer_auth(stdb.token())
        .json(&arguments)
        .send()
        .await
        .map_err(|_| AppError::Unavailable("run lifecycle persistence is unavailable".into()))?;
    if response.status().is_success() {
        return Ok(());
    }
    let message = response.text().await.unwrap_or_default();
    Err(lifecycle_error(message))
}

fn continuation_params(token: &ContinuationToken, expected_run_id: u64) -> AppResult<Value> {
    token
        .validate()
        .map_err(|error| AppError::BadRequest(error.to_string()))?;
    if token.run_id != expected_run_id {
        return Err(AppError::BadRequest(
            "continuation runId does not match the requested run".into(),
        ));
    }
    Ok(
        json!({"checkpoint_hash": token.checkpoint_hash, "cursor": token.cursor, "concurrency_version": token.concurrency_version}),
    )
}

async fn load_response(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    comparison: Option<LifecycleComparison>,
) -> AppResult<RunLifecycleResponse> {
    let state = stdb.query_sql(&format!("SELECT * FROM ai_run_lifecycle_state WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} LIMIT 1"))
        .await.map_err(|error| AppError::Internal(error.to_string()))?.into_iter().next()
        .ok_or_else(|| AppError::NotFound("run lifecycle not found".into()))?;
    let questions = stdb.query_sql(&format!("SELECT * FROM ai_run_question WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} ORDER BY id ASC"))
        .await.map_err(|error| AppError::Internal(error.to_string()))?;
    let events = stdb.query_sql(&format!("SELECT * FROM ai_run_lifecycle_event WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} ORDER BY id ASC"))
        .await.map_err(|error| AppError::Internal(error.to_string()))?;
    let checkpoint_hash = text(&state, "checkpointHash")?;
    Ok(RunLifecycleResponse {
        run_id,
        state: text(&state, "state")?,
        continuation: ContinuationToken {
            run_id,
            checkpoint_hash,
            cursor: number(&state, "cursor")? as u32,
            concurrency_version: number(&state, "concurrencyVersion")?,
        },
        questions: questions
            .into_iter()
            .map(question_from_row)
            .collect::<AppResult<_>>()?,
        events: events
            .into_iter()
            .map(event_from_row)
            .collect::<AppResult<_>>()?,
        comparison,
    })
}

fn question_from_row(row: Value) -> AppResult<LifecycleQuestion> {
    Ok(LifecycleQuestion {
        id: number(&row, "id")?,
        key: text(&row, "questionKey")?,
        prompt: text(&row, "prompt")?,
        status: text(&row, "status")?,
        required: row
            .get("required")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        revision: number(&row, "revision")?,
        answer: row
            .get("answerJson")
            .and_then(Value::as_str)
            .and_then(|value| serde_json::from_str(value).ok()),
    })
}

fn event_from_row(row: Value) -> AppResult<LifecycleEvent> {
    Ok(LifecycleEvent {
        id: number(&row, "id")?,
        kind: text(&row, "eventKind")?,
        from_version: number(&row, "fromVersion")?,
        to_version: number(&row, "toVersion")?,
        cursor: number(&row, "cursor")? as u32,
        created_at: row
            .get("createdAt")
            .map(Value::to_string)
            .unwrap_or_default(),
    })
}

fn text(row: &Value, key: &str) -> AppResult<String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| AppError::Internal(format!("lifecycle row is missing {key}")))
}

fn number(row: &Value, key: &str) -> AppResult<u64> {
    row.get(key)
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_i64().map(|value| value as u64))
        })
        .ok_or_else(|| AppError::Internal(format!("lifecycle row is missing {key}")))
}

fn lifecycle_error(message: String) -> AppError {
    if message.contains("stale or forged") || message.contains("revision conflict") {
        AppError::BadRequest(message)
    } else if message.contains("does not belong")
        || message.contains("authority")
        || message.contains("respondent")
    {
        AppError::Forbidden(message)
    } else {
        AppError::BadRequest(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actor_scope_rejects_body_company_mismatch() {
        let mut headers = HeaderMap::new();
        headers.insert("x-lumiere-organization-id", "7".parse().unwrap());
        headers.insert("x-lumiere-company-id", "9".parse().unwrap());
        headers.insert(
            "x-lumiere-actor-identity",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                .parse()
                .unwrap(),
        );
        headers.insert("x-lumiere-actor-token", "token".parse().unwrap());
        assert!(actor_context(&headers, 10).is_err());
        let actor = actor_context(&headers, 9).expect("matching scope");
        assert_eq!(actor.organization_id, 7);
    }

    #[test]
    fn response_projection_does_not_expose_private_event_payload() {
        let event = event_from_row(json!({"id": 1, "eventKind": "steered", "fromVersion": 1, "toVersion": 2, "cursor": 4, "createdAt": "now", "payloadJson": {"secret": true}, "createUid": "private"})).unwrap();
        let encoded = serde_json::to_value(event).unwrap();
        assert!(encoded.get("payloadJson").is_none());
        assert!(encoded.get("createUid").is_none());
    }

    #[test]
    fn continuation_must_name_the_requested_run() {
        let token = ContinuationToken {
            run_id: 8,
            checkpoint_hash: "a".repeat(64),
            cursor: 1,
            concurrency_version: 1,
        };
        assert!(continuation_params(&token, 8).is_ok());
        assert!(continuation_params(&token, 9).is_err());
    }
}
