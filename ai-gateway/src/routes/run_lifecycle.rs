//! Trusted-BFF surface for durable governed-run lifecycle commands.
//!
//! Tenant and actor authority come only from headers installed by the BFF.
//! Every request re-resolves the acting user's current org/company capability
//! before reading or mutating lifecycle state.

use axum::{extract::State, http::HeaderMap, Json};
use lumiere_auth_context::ActorContext;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use stdb_client::StdbClient;

use crate::{
    error::{AppError, AppResult},
    orchestrator::run_lifecycle::ContinuationToken,
    routes::evidence::{require_scoped_capability_grant, CapabilityGrantBounds},
    state::AppState,
};

const LIFECYCLE_CAPABILITY: &str = "ai.run.lifecycle";
const MAX_LIFECYCLE_ROWS: u64 = 500;
const MAX_LIFECYCLE_BYTES: u64 = 2 * 1024 * 1024;

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
    /// Queue a follow-up that runs after the objective fully settles. It is
    /// authored input only and never interrupts a running turn (use `Steer`).
    EnqueueFollowUp {
        payload: String,
        idempotency_key: String,
    },
    EditFollowUp {
        queued_input_id: u64,
        expected_revision: u64,
        payload: String,
        idempotency_key: String,
    },
    ReorderFollowUp {
        queued_input_id: u64,
        expected_revision: u64,
        target_position: u32,
        idempotency_key: String,
    },
    WithdrawFollowUp {
        queued_input_id: u64,
        expected_revision: u64,
        idempotency_key: String,
    },
    PromoteFollowUp {
        continuation: ContinuationToken,
        queued_input_id: u64,
        expected_revision: u64,
        child_run_key: String,
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
    /// Metadata only: the follow-up text and its author are never returned.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub queued_inputs: Vec<LifecycleQueuedInput>,
    pub events: Vec<LifecycleEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparison: Option<LifecycleComparison>,
    /// Present while a run is, or was, budget parked, so clients can tell it
    /// from a failed run and show when it is expected to resume.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub park: Option<LifecycleBudgetPark>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleBudgetPark {
    pub reason: String,
    pub status: String,
    pub generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_resets_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_park_until: Option<String>,
    pub required_units: u64,
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
pub struct LifecycleQueuedInput {
    pub id: u64,
    pub position: u32,
    pub revision: u64,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub promoted_run_id: Option<u64>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<LifecycleComparisonDetails>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleComparisonDetails {
    pub left_status: String,
    pub right_status: String,
    pub left_step_count: u64,
    pub right_step_count: u64,
    pub left_tokens_used: u64,
    pub right_tokens_used: u64,
    pub tools_only_left: Vec<String>,
    pub tools_only_right: Vec<String>,
    pub tool_diff_truncated: bool,
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
    let granted = require_scoped_capability_grant(
        &state,
        &actor.identity,
        &actor.token,
        actor.organization_id,
        actor.company_id,
        LIFECYCLE_CAPABILITY,
    )
    .await?;
    let bounds = CapabilityGrantBounds {
        max_rows: granted.max_rows.min(MAX_LIFECYCLE_ROWS),
        max_bytes: granted.max_bytes.min(MAX_LIFECYCLE_BYTES),
    };

    let comparison = apply_intent(state.stdb.as_ref(), &actor, req.run_id, req.intent).await?;
    let comparison = load_comparison_details(
        state.stdb.as_ref(),
        actor.organization_id,
        actor.company_id,
        comparison,
    )
    .await?;
    let response = load_response(
        state.stdb.as_ref(),
        actor.organization_id,
        actor.company_id,
        req.run_id,
        comparison,
        usize::try_from(bounds.max_rows).unwrap_or(usize::MAX),
    )
    .await?;
    let response = enforce_lifecycle_bounds(response, bounds)?;
    Ok(Json(response))
}

fn actor_context(headers: &HeaderMap, requested_company_id: u64) -> AppResult<ActorContext> {
    let actor = ActorContext::from_headers(headers)?;
    actor.require_company(requested_company_id)?;
    Ok(actor)
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
                details: None,
            };
            (
                "compare_ai_runs_checked",
                json!({"left": continuation_params(&continuation, run_id)?, "right_run_id": right_run_id, "right": continuation_params(&right, right_run_id)?, "idempotency_key": idempotency_key}),
                Some(comparison),
            )
        }
        RunLifecycleIntent::EnqueueFollowUp {
            payload,
            idempotency_key,
        } => (
            "enqueue_ai_run_follow_up",
            json!({"payload": payload, "idempotency_key": idempotency_key}),
            None,
        ),
        RunLifecycleIntent::EditFollowUp {
            queued_input_id,
            expected_revision,
            payload,
            idempotency_key,
        } => (
            "edit_ai_run_follow_up",
            json!({"queued_input_id": queued_input_id, "expected_revision": expected_revision, "payload": payload, "idempotency_key": idempotency_key}),
            None,
        ),
        RunLifecycleIntent::ReorderFollowUp {
            queued_input_id,
            expected_revision,
            target_position,
            idempotency_key,
        } => (
            "reorder_ai_run_follow_up",
            json!({"queued_input_id": queued_input_id, "expected_revision": expected_revision, "target_position": target_position, "idempotency_key": idempotency_key}),
            None,
        ),
        RunLifecycleIntent::WithdrawFollowUp {
            queued_input_id,
            expected_revision,
            idempotency_key,
        } => (
            "withdraw_ai_run_follow_up",
            json!({"queued_input_id": queued_input_id, "expected_revision": expected_revision, "idempotency_key": idempotency_key}),
            None,
        ),
        RunLifecycleIntent::PromoteFollowUp {
            continuation,
            queued_input_id,
            expected_revision,
            child_run_key,
            idempotency_key,
        } => (
            "promote_ai_run_follow_up",
            json!({"continuation": continuation_params(&continuation, run_id)?, "queued_input_id": queued_input_id, "expected_revision": expected_revision, "child_run_key": child_run_key, "idempotency_key": idempotency_key}),
            None,
        ),
    };
    let mut arguments = scope.to_vec();
    arguments.push(params);
    let arguments = Value::Array(arguments);
    if is_follow_up_reducer(reducer) {
        // The module takes the follow-up author from `ctx.sender()`, so these
        // commands are issued with the acting user's own STDB token rather than
        // the gateway service identity. The module independently authorizes
        // that identity and, on promotion, the author's current grants.
        let actor_client = stdb.with_token(actor.token.clone());
        call_lifecycle_reducer(&actor_client, reducer, arguments).await?;
    } else {
        call_lifecycle_reducer(stdb, reducer, arguments).await?;
    }
    Ok(comparison)
}

fn is_follow_up_reducer(reducer: &str) -> bool {
    matches!(
        reducer,
        "enqueue_ai_run_follow_up"
            | "edit_ai_run_follow_up"
            | "reorder_ai_run_follow_up"
            | "withdraw_ai_run_follow_up"
            | "promote_ai_run_follow_up"
    )
}

/// Dispatch a lifecycle command through the pinned generated reducer contract.
/// The name is selected only from the closed intent enum, never request data.
async fn call_lifecycle_reducer(
    stdb: &StdbClient,
    reducer: &str,
    arguments: Value,
) -> AppResult<()> {
    let call = match reducer {
        "ask_ai_run_question" => {
            stdb_client::reducer_call!("ask_ai_run_question", arguments)
        }
        "reply_ai_run_question" => {
            stdb_client::reducer_call!("reply_ai_run_question", arguments)
        }
        "steer_ai_run" => stdb_client::reducer_call!("steer_ai_run", arguments),
        "interrupt_ai_run" => stdb_client::reducer_call!("interrupt_ai_run", arguments),
        "resume_ai_run_checked" => {
            stdb_client::reducer_call!("resume_ai_run_checked", arguments)
        }
        "fork_ai_run_checked" => {
            stdb_client::reducer_call!("fork_ai_run_checked", arguments)
        }
        "compare_ai_runs_checked" => {
            stdb_client::reducer_call!("compare_ai_runs_checked", arguments)
        }
        "enqueue_ai_run_follow_up" => {
            stdb_client::reducer_call!("enqueue_ai_run_follow_up", arguments)
        }
        "edit_ai_run_follow_up" => {
            stdb_client::reducer_call!("edit_ai_run_follow_up", arguments)
        }
        "reorder_ai_run_follow_up" => {
            stdb_client::reducer_call!("reorder_ai_run_follow_up", arguments)
        }
        "withdraw_ai_run_follow_up" => {
            stdb_client::reducer_call!("withdraw_ai_run_follow_up", arguments)
        }
        "promote_ai_run_follow_up" => {
            stdb_client::reducer_call!("promote_ai_run_follow_up", arguments)
        }
        _ => return Err(AppError::Internal("unsupported lifecycle reducer".into())),
    };
    stdb.call_reducer(call)
        .await
        .map_err(|error| lifecycle_error(error.to_string()))
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

fn bounded_tool_differences(
    left: &std::collections::BTreeSet<String>,
    right: &std::collections::BTreeSet<String>,
    limit: usize,
) -> (Vec<String>, Vec<String>, bool) {
    let left_total = left.difference(right).count();
    let right_total = right.difference(left).count();
    (
        left.difference(right).take(limit).cloned().collect(),
        right.difference(left).take(limit).cloned().collect(),
        left_total > limit || right_total > limit,
    )
}

async fn load_comparison_details(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    comparison: Option<LifecycleComparison>,
) -> AppResult<Option<LifecycleComparison>> {
    use std::collections::BTreeSet;

    const MAX_TOOLS: usize = 100;
    const MAX_TOOL_DIFF: usize = 20;
    let Some(mut comparison) = comparison else {
        return Ok(None);
    };
    let load_run = |run_id: u64| async move {
        stdb.query_sql(&format!(
            "SELECT status, step_count, tokens_used FROM ai_agent_run WHERE organization_id = {organization_id} AND company_id = {company_id} AND id = {run_id} LIMIT 1"
        ))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("compared run not found".into()))
    };
    let left = load_run(comparison.left_run_id).await?;
    let right = load_run(comparison.right_run_id).await?;
    let load_tools = |run_id: u64| async move {
        stdb.query_sql(&format!(
            "SELECT tool_name FROM ai_agent_run_step WHERE organization_id = {organization_id} AND run_id = {run_id} ORDER BY id ASC LIMIT {}",
            MAX_TOOLS + 1
        ))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))
    };
    let left_tool_rows = load_tools(comparison.left_run_id).await?;
    let right_tool_rows = load_tools(comparison.right_run_id).await?;
    let tool_diff_truncated = left_tool_rows.len() > MAX_TOOLS || right_tool_rows.len() > MAX_TOOLS;
    let tools = |rows: Vec<Value>| {
        rows.into_iter()
            .take(MAX_TOOLS)
            .filter_map(|row| text(&row, "toolName").ok())
            .filter(|name| !name.is_empty() && name.len() <= 128)
            .collect::<BTreeSet<_>>()
    };
    let left_tools = tools(left_tool_rows);
    let right_tools = tools(right_tool_rows);
    let (tools_only_left, tools_only_right, diff_limit_truncated) =
        bounded_tool_differences(&left_tools, &right_tools, MAX_TOOL_DIFF);
    comparison.details = Some(LifecycleComparisonDetails {
        left_status: text(&left, "status")?,
        right_status: text(&right, "status")?,
        left_step_count: number(&left, "stepCount")?,
        right_step_count: number(&right, "stepCount")?,
        left_tokens_used: number(&left, "tokensUsed")?,
        right_tokens_used: number(&right, "tokensUsed")?,
        tools_only_left,
        tools_only_right,
        tool_diff_truncated: tool_diff_truncated || diff_limit_truncated,
    });
    Ok(Some(comparison))
}

fn lifecycle_response_size(response: &RunLifecycleResponse) -> AppResult<u64> {
    serde_json::to_vec(response)
        .map(|encoded| encoded.len() as u64)
        .map_err(|error| AppError::Internal(error.to_string()))
}

fn enforce_lifecycle_bounds(
    mut response: RunLifecycleResponse,
    bounds: CapabilityGrantBounds,
) -> AppResult<RunLifecycleResponse> {
    if bounds.max_rows == 0 {
        return Err(AppError::Forbidden(
            "run lifecycle row grant is empty".into(),
        ));
    }
    let mut remaining = usize::try_from(bounds.max_rows.saturating_sub(1)).unwrap_or(usize::MAX);
    if response.questions.len() > remaining {
        response.questions.truncate(remaining);
        response.truncated = true;
    }
    remaining = remaining.saturating_sub(response.questions.len());
    if response.queued_inputs.len() > remaining {
        response.queued_inputs.truncate(remaining);
        response.truncated = true;
    }
    remaining = remaining.saturating_sub(response.queued_inputs.len());
    if response.events.len() > remaining {
        response.events.truncate(remaining);
        response.truncated = true;
    }
    remaining = remaining.saturating_sub(response.events.len());
    if response
        .comparison
        .as_ref()
        .is_some_and(|comparison| comparison.details.is_some())
    {
        if remaining == 0 {
            if let Some(comparison) = response.comparison.as_mut() {
                comparison.details = None;
            }
            response.truncated = true;
        } else {
            remaining -= 1;
        }
    }
    if let Some(details) = response
        .comparison
        .as_mut()
        .and_then(|comparison| comparison.details.as_mut())
    {
        if details.tools_only_left.len() > remaining {
            details.tools_only_left.truncate(remaining);
            details.tool_diff_truncated = true;
            response.truncated = true;
        }
        remaining = remaining.saturating_sub(details.tools_only_left.len());
        if details.tools_only_right.len() > remaining {
            details.tools_only_right.truncate(remaining);
            details.tool_diff_truncated = true;
            response.truncated = true;
        }
    }

    while lifecycle_response_size(&response)? > bounds.max_bytes {
        let removed_tool = response
            .comparison
            .as_mut()
            .and_then(|comparison| comparison.details.as_mut())
            .is_some_and(|details| {
                let removed = details.tools_only_right.pop().is_some()
                    || details.tools_only_left.pop().is_some();
                if removed {
                    details.tool_diff_truncated = true;
                }
                removed
            });
        if removed_tool {
            response.truncated = true;
            continue;
        }
        if response.events.pop().is_some()
            || response.queued_inputs.pop().is_some()
            || response.questions.pop().is_some()
        {
            response.truncated = true;
            continue;
        }
        if response
            .comparison
            .as_mut()
            .is_some_and(|comparison| comparison.details.take().is_some())
        {
            response.truncated = true;
            continue;
        }
        return Err(AppError::Forbidden(
            "run lifecycle response exceeds the acting user's byte grant".into(),
        ));
    }
    Ok(response)
}

async fn load_response(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    comparison: Option<LifecycleComparison>,
    row_limit: usize,
) -> AppResult<RunLifecycleResponse> {
    let state = stdb.query_sql(&format!("SELECT * FROM ai_run_lifecycle_state WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} LIMIT 1"))
        .await.map_err(|error| AppError::Internal(error.to_string()))?.into_iter().next()
        .ok_or_else(|| AppError::NotFound("run lifecycle not found".into()))?;
    let questions = stdb.query_sql(&format!("SELECT * FROM ai_run_question WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} ORDER BY id ASC LIMIT {row_limit}"))
        .await.map_err(|error| AppError::Internal(error.to_string()))?;
    let queued_inputs = stdb
        .query_sql(&queued_inputs_sql(
            organization_id,
            company_id,
            run_id,
            row_limit,
        ))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let events = stdb.query_sql(&format!("SELECT * FROM ai_run_lifecycle_event WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} ORDER BY id ASC LIMIT {row_limit}"))
        .await.map_err(|error| AppError::Internal(error.to_string()))?;
    // The park table exists only in modules that include the budget-park
    // reducers; a missing table or row simply means the run was never parked.
    let park = stdb.query_sql(&format!("SELECT * FROM ai_run_budget_park WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} LIMIT 1"))
        .await.ok().and_then(|rows| rows.into_iter().next()).and_then(|row| park_from_row(&row));
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
        queued_inputs: sorted_queue(
            queued_inputs
                .into_iter()
                .map(queued_input_from_row)
                .collect::<AppResult<Vec<_>>>()?,
        ),
        events: events
            .into_iter()
            .map(event_from_row)
            .collect::<AppResult<_>>()?,
        comparison,
        park,
        truncated: false,
    })
}

fn timestamp_rfc3339(row: &Value, key: &str) -> Option<String> {
    let value = row.get(key)?;
    let micros = value
        .get("__timestamp_micros_since_unix_epoch__")
        .unwrap_or(value)
        .as_i64()?;
    chrono::DateTime::from_timestamp_micros(micros).map(|time| time.to_rfc3339())
}

fn park_from_row(row: &Value) -> Option<LifecycleBudgetPark> {
    Some(LifecycleBudgetPark {
        reason: text(row, "reason").ok()?,
        status: text(row, "status").ok()?,
        generation: number(row, "parkGeneration").ok()?,
        window_resets_at: timestamp_rfc3339(row, "windowResetsAt"),
        max_park_until: timestamp_rfc3339(row, "maxParkUntil"),
        required_units: number(row, "requiredUnits").ok()?,
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

/// Explicit column list: the follow-up payload and author identity are never
/// selected, so they cannot reach the gateway process, logs or a response.
fn queued_inputs_sql(
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    row_limit: usize,
) -> String {
    format!("SELECT queued_input_id, position, revision, status, promoted_run_id FROM ai_run_queued_input WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} ORDER BY queued_input_id ASC LIMIT {row_limit}")
}

fn queued_input_from_row(row: Value) -> AppResult<LifecycleQueuedInput> {
    Ok(LifecycleQueuedInput {
        id: number(&row, "queuedInputId")?,
        position: number(&row, "position")? as u32,
        revision: number(&row, "revision")?,
        status: text(&row, "status")?,
        promoted_run_id: optional_number(&row, "promotedRunId"),
    })
}

/// Queued items first in promotion order, then settled items by id.
fn sorted_queue(mut items: Vec<LifecycleQueuedInput>) -> Vec<LifecycleQueuedInput> {
    items.sort_by_key(|item| (item.status != "queued", item.position, item.id));
    items
}

fn optional_number(row: &Value, key: &str) -> Option<u64> {
    let value = row.get(key)?;
    value
        .as_u64()
        .or_else(|| value.get("some").and_then(Value::as_u64))
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
        || message.contains("author")
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
    fn park_projection_exposes_reason_and_expected_resume_but_nothing_private() {
        let park = park_from_row(&json!({
            "reason": "budget_exhausted", "status": "parked", "parkGeneration": 2,
            "windowResetsAt": {"__timestamp_micros_since_unix_epoch__": 1_790_000_000_000_000i64},
            "maxParkUntil": 1_792_000_000_000_000i64, "requiredUnits": 40,
            "provider": "mistral", "agentId": 7
        }))
        .expect("park row");
        let encoded = serde_json::to_value(park).unwrap();
        assert_eq!(encoded["reason"], "budget_exhausted");
        assert_eq!(encoded["status"], "parked");
        assert_eq!(encoded["generation"], 2);
        assert!(encoded["windowResetsAt"]
            .as_str()
            .unwrap()
            .starts_with("2026-"));
        assert!(encoded.get("provider").is_none() && encoded.get("agentId").is_none());
        assert!(park_from_row(&json!({"status": "parked"})).is_none());
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

    #[test]
    fn comparison_tool_differences_are_sorted_and_bounded() {
        use std::collections::BTreeSet;

        let left = ["shared", "z-left", "a-left"]
            .into_iter()
            .map(str::to_string)
            .collect::<BTreeSet<_>>();
        let right = ["shared", "b-right", "y-right"]
            .into_iter()
            .map(str::to_string)
            .collect::<BTreeSet<_>>();
        let (left_only, right_only, truncated) = bounded_tool_differences(&left, &right, 1);
        assert_eq!(left_only, vec!["a-left"]);
        assert_eq!(right_only, vec!["b-right"]);
        assert!(truncated);
    }

    fn lifecycle_response() -> RunLifecycleResponse {
        RunLifecycleResponse {
            run_id: 8,
            state: "running".into(),
            continuation: ContinuationToken {
                run_id: 8,
                checkpoint_hash: "a".repeat(64),
                cursor: 1,
                concurrency_version: 1,
            },
            questions: (1..=3)
                .map(|id| LifecycleQuestion {
                    id,
                    key: format!("q{id}"),
                    prompt: "prompt".repeat(50),
                    status: "open".into(),
                    required: true,
                    revision: 1,
                    answer: None,
                })
                .collect(),
            events: (1..=3)
                .map(|id| LifecycleEvent {
                    id,
                    kind: "advanced".into(),
                    from_version: id,
                    to_version: id + 1,
                    cursor: id as u32,
                    created_at: "now".into(),
                })
                .collect(),
            queued_inputs: vec![],
            comparison: None,
            park: None,
            truncated: false,
        }
    }

    #[test]
    fn lifecycle_rows_are_intersected_with_the_grant() {
        let bounded = enforce_lifecycle_bounds(
            lifecycle_response(),
            CapabilityGrantBounds {
                max_rows: 3,
                max_bytes: 1_000_000,
            },
        )
        .expect("bounded lifecycle");
        assert_eq!(bounded.questions.len(), 2);
        assert!(bounded.events.is_empty());
        assert!(bounded.truncated);
    }

    #[test]
    fn follow_up_read_never_selects_payload_or_author() {
        let sql = queued_inputs_sql(7, 9, 42, 10);
        assert!(sql.contains("FROM ai_run_queued_input"));
        assert!(!sql.contains('*'));
        assert!(!sql.contains("payload"));
        assert!(!sql.contains("author"));
    }

    #[test]
    fn follow_up_projection_redacts_payload_and_author() {
        let item = queued_input_from_row(json!({
            "queuedInputId": 3, "position": 2, "revision": 5, "status": "queued",
            "promotedRunId": null, "payload": "secret follow-up text", "author": "private"
        }))
        .expect("row");
        let encoded = serde_json::to_string(&item).unwrap();
        assert!(!encoded.contains("secret follow-up text"));
        assert!(!encoded.contains("private"));
        assert!(!encoded.contains("payload"));
        assert!(!encoded.contains("author"));
        assert_eq!(item.id, 3);
        let promoted = queued_input_from_row(json!({
            "queuedInputId": 4, "position": 1, "revision": 2, "status": "promoted",
            "promotedRunId": {"some": 77}
        }))
        .expect("row");
        assert_eq!(promoted.promoted_run_id, Some(77));
    }

    #[test]
    fn follow_up_queue_is_listed_in_promotion_order() {
        let item = |id: u64, position: u32, status: &str| LifecycleQueuedInput {
            id,
            position,
            revision: 1,
            status: status.into(),
            promoted_run_id: None,
        };
        let sorted = sorted_queue(vec![
            item(1, 1, "promoted"),
            item(2, 3, "queued"),
            item(3, 2, "queued"),
            item(4, 1, "withdrawn"),
        ]);
        let ids: Vec<u64> = sorted.iter().map(|item| item.id).collect();
        assert_eq!(ids, vec![3, 2, 1, 4]);
    }

    #[test]
    fn follow_up_intents_cannot_carry_an_author_or_authority() {
        let ok: RunLifecycleIntent = serde_json::from_value(json!({
            "kind": "enqueue_follow_up", "payload": "later", "idempotency_key": "k1"
        }))
        .expect("enqueue");
        assert!(matches!(ok, RunLifecycleIntent::EnqueueFollowUp { .. }));
        for forged in ["author", "author_identity", "status", "position"] {
            let result = serde_json::from_value::<RunLifecycleIntent>(json!({
                "kind": "enqueue_follow_up", "payload": "later", "idempotency_key": "k1",
                forged: "x"
            }));
            assert!(result.is_err(), "{forged} must be rejected");
        }
        let promote = serde_json::from_value::<RunLifecycleIntent>(json!({
            "kind": "promote_follow_up", "queued_input_id": 1, "expected_revision": 1,
            "child_run_key": "c", "idempotency_key": "k2",
            "continuation": {"runId": 8, "checkpointHash": "a".repeat(64), "cursor": 1, "concurrencyVersion": 1}
        }));
        assert!(matches!(
            promote,
            Ok(RunLifecycleIntent::PromoteFollowUp { .. })
        ));
    }

    #[test]
    fn follow_up_commands_use_the_acting_users_token_but_steer_does_not() {
        for reducer in [
            "enqueue_ai_run_follow_up",
            "edit_ai_run_follow_up",
            "reorder_ai_run_follow_up",
            "withdraw_ai_run_follow_up",
            "promote_ai_run_follow_up",
        ] {
            assert!(is_follow_up_reducer(reducer), "{reducer}");
        }
        for reducer in ["steer_ai_run", "interrupt_ai_run", "resume_ai_run_checked"] {
            assert!(!is_follow_up_reducer(reducer), "{reducer}");
        }
    }

    #[test]
    fn follow_up_authority_denials_map_to_forbidden() {
        for message in [
            "only the author can change a queued follow-up",
            "author does not hold the ai.run.lifecycle grant",
            "author authority lapsed; the follow-up cannot be promoted",
        ] {
            assert!(matches!(
                lifecycle_error(message.into()),
                AppError::Forbidden(_)
            ));
        }
        assert!(matches!(
            lifecycle_error(
                "run is only agent_settled; follow-ups promote after it is fully settled".into()
            ),
            AppError::BadRequest(_)
        ));
    }

    #[test]
    fn lifecycle_bounds_cover_queued_inputs() {
        let mut response = lifecycle_response();
        response.questions.clear();
        response.events.clear();
        response.queued_inputs = (1..=4)
            .map(|id| LifecycleQueuedInput {
                id,
                position: id as u32,
                revision: 1,
                status: "queued".into(),
                promoted_run_id: None,
            })
            .collect();
        let bounded = enforce_lifecycle_bounds(
            response,
            CapabilityGrantBounds {
                max_rows: 3,
                max_bytes: 1_000_000,
            },
        )
        .expect("bounded");
        assert_eq!(bounded.queued_inputs.len(), 2);
        assert!(bounded.truncated);
    }

    #[test]
    fn lifecycle_rejects_an_empty_row_grant() {
        let result = enforce_lifecycle_bounds(
            lifecycle_response(),
            CapabilityGrantBounds {
                max_rows: 0,
                max_bytes: 1_000_000,
            },
        );
        assert!(matches!(result, Err(AppError::Forbidden(_))));
    }

    #[test]
    fn lifecycle_drops_comparison_details_when_no_row_remains() {
        let mut response = lifecycle_response();
        response.questions.clear();
        response.events.clear();
        response.comparison = Some(LifecycleComparison {
            left_run_id: 8,
            right_run_id: 9,
            left_continuation: response.continuation.clone(),
            right_continuation: ContinuationToken {
                run_id: 9,
                checkpoint_hash: "b".repeat(64),
                cursor: 2,
                concurrency_version: 2,
            },
            details: Some(LifecycleComparisonDetails {
                left_status: "completed".into(),
                right_status: "failed".into(),
                left_step_count: 2,
                right_step_count: 3,
                left_tokens_used: 20,
                right_tokens_used: 30,
                tools_only_left: vec!["left.tool".into()],
                tools_only_right: vec!["right.tool".into()],
                tool_diff_truncated: false,
            }),
        });
        let bounded = enforce_lifecycle_bounds(
            response,
            CapabilityGrantBounds {
                max_rows: 1,
                max_bytes: 1_000_000,
            },
        )
        .expect("bounded lifecycle");
        assert!(bounded
            .comparison
            .as_ref()
            .is_some_and(|comparison| comparison.details.is_none()));
        assert!(bounded.truncated);
    }

    #[test]
    fn lifecycle_optional_rows_are_removed_to_meet_byte_grant() {
        let minimal = {
            let mut response = lifecycle_response();
            response.questions.clear();
            response.events.clear();
            response
        };
        let max_bytes = lifecycle_response_size(&minimal).expect("minimal size");
        let bounded = enforce_lifecycle_bounds(
            lifecycle_response(),
            CapabilityGrantBounds {
                max_rows: 100,
                max_bytes,
            },
        )
        .expect("bounded lifecycle");
        assert!(bounded.questions.is_empty());
        assert!(bounded.events.is_empty());
        assert!(bounded.truncated);
        assert!(lifecycle_response_size(&bounded).expect("bounded size") <= max_bytes);
    }
}
