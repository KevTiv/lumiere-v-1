//! Harness action-draft bridge — persists red skill proposals as pending drafts.

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    harness::{
        audit::{hash_value, DecisionOutcome, PolicyDecision, PolicyResult},
        data_scope_resolver::ResourceRegistry,
        policy_engine::{PolicyControlledRequest, PolicyEngine},
        red_action_drafts::CREATE_SALE_ORDER_DRAFT_SKILL_KEY,
        release_registry::load_active_manifest,
        skill_registry::SkillRegistry,
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayActionDraftBridgeRequest {
    pub execution: Value,
    pub candidate_output: Option<Value>,
    pub stdb_token: String,
    pub identity_hex: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayActionDraftBridgeResponse {
    pub decision: PolicyResult,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn post_bridge(
    State(state): State<AppState>,
    Json(req): Json<GatewayActionDraftBridgeRequest>,
) -> AppResult<Json<GatewayActionDraftBridgeResponse>> {
    if req.stdb_token.trim().is_empty() {
        return Err(AppError::BadRequest("stdb_token is required".into()));
    }

    let controlled_request: PolicyControlledRequest = serde_json::from_value(serde_json::json!({
        "execution": req.execution,
        "candidateOutput": req.candidate_output.unwrap_or(Value::Null),
    }))
    .map_err(|e| AppError::BadRequest(format!("invalid policy request: {e}")))?;

    let organization_id = controlled_request.execution.organization_id;
    let company_id = controlled_request.execution.company_id;
    let skill_key = controlled_request.execution.skill.skill_key.clone();
    let skill_version = controlled_request.execution.skill.version;

    // Built-in Phase 1 red action-draft skills are loaded directly; org-promoted
    // skills are resolved through the release registry.
    let registry = if skill_key == CREATE_SALE_ORDER_DRAFT_SKILL_KEY {
        SkillRegistry::built_in()
    } else {
        let manifest =
            load_active_manifest(&state.stdb, organization_id, &skill_key, skill_version)
                .await
                .map_err(AppError::Forbidden)?;
        SkillRegistry::exact(manifest)
    };

    let policy = PolicyEngine::new(registry, ResourceRegistry::built_in());
    let decision = policy.execute_controlled(controlled_request);

    let draft_id = if decision.decision.outcome == DecisionOutcome::DraftOnly {
        if let Some(proposal) = &decision.action_draft {
            match persist_draft(
                &state.stdb.with_token(req.stdb_token),
                organization_id,
                company_id,
                req.identity_hex.as_deref().unwrap_or("unknown"),
                proposal,
                &decision.decision,
            )
            .await
            {
                Ok(id) => Some(id),
                Err(message) => {
                    return Ok(Json(GatewayActionDraftBridgeResponse {
                        decision,
                        draft_id: None,
                        error: Some(message),
                    }));
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    Ok(Json(GatewayActionDraftBridgeResponse {
        decision,
        draft_id,
        error: None,
    }))
}

async fn persist_draft(
    stdb: &stdb_client::StdbClient,
    organization_id: u64,
    company_id: u64,
    identity_hex: &str,
    proposal: &crate::harness::audit::ActionDraftProposal,
    policy: &PolicyDecision,
) -> Result<u64, String> {
    let governance_metadata = serde_json::json!({
        "approval_channel": "harness_action_draft_bridge",
        "identity_hex": identity_hex,
        "risk": "red",
        "skill_key": policy.skill.skill_key,
        "skill_version": policy.skill.version,
        "policy_decision_hash": policy.hashes.request_hash,
        "source_snapshot_hash": policy.hashes.input_hash,
        "diff_hash": hash_value(&serde_json::from_str::<Value>(&proposal.params_json).unwrap_or(Value::Null)),
        "required_approver_permission": "ai_action_draft:write",
        "correction_plan": "Use the standard sales-order cancellation workflow before fulfillment; the original action remains auditable.",
    });
    let args = serde_json::json!([
        organization_id,
        company_id,
        {
            "reducer_name": proposal.reducer_name,
            "params_json": proposal.params_json,
            "summary": proposal.summary,
            "confidence": 1.0,
            "elevated": proposal.elevated,
            "warnings_json": if proposal.warnings.is_empty() {
                Value::Null
            } else {
                serde_json::to_value(&proposal.warnings).unwrap_or(Value::Null)
            },
            "source_query": Value::Null,
            "ui_context_json": Value::Null,
            "expires_at": Value::Null,
            "metadata": governance_metadata.to_string(),
        }
    ]);

    stdb.call_reducer("create_ai_action_draft", args)
        .await
        .map_err(|e| format!("create_ai_action_draft failed: {e}"))?;

    fetch_latest_draft_id(stdb, organization_id, company_id, identity_hex).await
}

async fn fetch_latest_draft_id(
    stdb: &stdb_client::StdbClient,
    organization_id: u64,
    company_id: u64,
    identity_hex: &str,
) -> Result<u64, String> {
    let sql = format!(
        "SELECT id FROM ai_action_draft \
         WHERE organization_id = {} AND company_id = {} AND proposed_by = 0x{} \
         ORDER BY id DESC LIMIT 1",
        organization_id,
        company_id,
        identity_hex.trim_start_matches("0x")
    );

    let rows = stdb
        .query_sql(&sql)
        .await
        .map_err(|e| format!("failed to fetch draft id: {e}"))?;

    rows.first()
        .and_then(|row| row.get("id").and_then(Value::as_u64))
        .ok_or_else(|| "could not resolve created draft id".to_string())
}
