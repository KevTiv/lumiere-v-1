//! Harness action-draft bridge — persists red skill proposals as pending drafts.

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    ai_agent::{ensure_allowed_action, resolve_agent},
    ai_spend::{self, input_request_key, RequestKind, SpendReader},
    error::{AppError, AppResult},
    harness::{
        audit::{hash_serializable, hash_value, DecisionOutcome, PolicyDecision},
        data_scope_resolver::ResourceRegistry,
        policy_engine::{PolicyControlledRequest, PolicyEngine},
        red_action_drafts::CREATE_SALE_ORDER_DRAFT_SKILL_KEY,
        release_registry::load_active_manifest,
        skill_registry::SkillRegistry,
    },
    orchestrator::skill_loader::{complete_run, create_or_recover_generation_surface_run},
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
    pub decision: PolicyDecision,
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
        "candidate_output": req.candidate_output.unwrap_or(Value::Null),
    }))
    .map_err(|e| AppError::BadRequest(format!("invalid policy request: {e}")))?;

    let controlled_request_hash = hash_serializable(&controlled_request);
    let organization_id = controlled_request.execution.organization_id;
    let company_id = controlled_request.execution.company_id;
    let skill_key = controlled_request.execution.skill.skill_key.clone();
    let skill_version = controlled_request.execution.skill.version;
    let correlation_id = controlled_request.execution.correlation_id.clone();
    let run_inputs = serde_json::to_string(&serde_json::json!({
        "surface": "harness_action_draft_bridge",
        "correlation_id": correlation_id,
        "skill_key": skill_key,
        "skill_version": skill_version,
        "controlled_request_hash": controlled_request_hash,
    }))
    .map_err(|error| AppError::BadRequest(format!("invalid run inputs: {error}")))?;

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
            let identity_hex = req
                .identity_hex
                .as_deref()
                .filter(|identity| !identity.trim().is_empty())
                .ok_or_else(|| AppError::BadRequest("identity_hex is required".into()))?;
            let draft_writer = state.stdb.with_token(req.stdb_token);
            let run_writer = state.stdb.as_ref();
            let reader = state.spend_read_stdb.as_deref().ok_or_else(|| {
                AppError::Internal(
                    "spend_read_stdb is required for exact draft readback".to_string(),
                )
            })?;
            let agent = resolve_agent(
                run_writer,
                organization_id,
                None,
                None,
                state.config.ollama_supports_tool_calling,
            )
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?;
            ensure_allowed_action(&agent, "action_draft")
                .map_err(|error| AppError::Forbidden(error.to_string()))?;
            let run_key = bridge_run_key(organization_id, company_id, &correlation_id)?;
            let run = create_or_recover_generation_surface_run(
                run_writer,
                organization_id,
                company_id,
                "action_draft_generation",
                agent.agent_id,
                None,
                &run_key,
                &run_inputs,
                identity_hex,
            )
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?;
            match persist_draft(
                &draft_writer,
                reader,
                organization_id,
                company_id,
                run.run_id,
                identity_hex,
                proposal,
                &decision.decision,
            )
            .await
            {
                Ok(id) => {
                    complete_run(
                        run_writer,
                        organization_id,
                        company_id,
                        run.run_id,
                        "completed",
                        Some("created governed red-action draft".to_string()),
                        None,
                        None,
                        1,
                        0,
                        None,
                    )
                    .await
                    .map_err(|error| AppError::Internal(error.to_string()))?;
                    Some(id)
                }
                Err(message) => {
                    let _ = complete_run(
                        run_writer,
                        organization_id,
                        company_id,
                        run.run_id,
                        "failed",
                        None,
                        None,
                        None,
                        1,
                        0,
                        Some(message.clone()),
                    )
                    .await;
                    return Ok(Json(GatewayActionDraftBridgeResponse {
                        decision: decision.decision.clone(),
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
        decision: decision.decision,
        draft_id,
        error: None,
    }))
}

fn bridge_run_key(
    organization_id: u64,
    company_id: u64,
    correlation_id: &str,
) -> AppResult<String> {
    if correlation_id.trim().is_empty() {
        return Err(AppError::BadRequest("correlation_id is required".into()));
    }
    Ok(format!(
        "harness-action-draft:{}",
        hash_value(&serde_json::json!({
            "surface": "harness_action_draft_bridge",
            "organization_id": organization_id,
            "company_id": company_id,
            "correlation_id": correlation_id,
        }))
    ))
}

async fn persist_draft(
    writer: &stdb_client::StdbClient,
    reader: &stdb_client::StdbClient,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    identity_hex: &str,
    proposal: &crate::harness::audit::ActionDraftProposal,
    policy: &PolicyDecision,
) -> Result<u64, String> {
    let governance_metadata = serde_json::json!({
        "approval_channel": "harness_action_draft_bridge",
        "run_id": run_id,
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
    let params = serde_json::json!({
        "reducer_name": proposal.reducer_name,
        "params_json": proposal.params_json,
        "summary": proposal.summary,
        "confidence": 1.0,
        "elevated": proposal.elevated,
        "warnings_json": if proposal.warnings.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&proposal.warnings)
                .map_err(|error| format!("serialize action draft warnings: {error}"))?)
        },
        "source_query": Value::Null,
        "ui_context_json": Value::Null,
        "expires_at": Value::Null,
        "metadata": Some(governance_metadata.to_string()),
    });
    let request_key = bridge_draft_request_key(run_id, proposal, &policy.hashes.request_hash)?;

    ai_spend::create_run_action_draft(
        writer,
        organization_id,
        company_id,
        run_id,
        &request_key,
        params,
    )
    .await
    .map_err(|error| format!("create run-correlated action draft failed: {error}"))?;

    SpendReader::new(reader)
        .draft_request(organization_id, company_id, run_id, &request_key)
        .await
        .map_err(|error| format!("read exact action draft effect failed: {error}"))?
        .map(|request| request.draft_id)
        .ok_or_else(|| {
            format!("run-correlated action draft is not visible for request {request_key}")
        })
}

fn bridge_draft_request_key(
    run_id: u64,
    proposal: &crate::harness::audit::ActionDraftProposal,
    policy_decision_hash: &str,
) -> Result<String, String> {
    let request_input = serde_json::json!({
        "surface": "harness_action_draft_bridge",
        "reducer_name": proposal.reducer_name,
        "params_json": proposal.params_json,
        "summary": proposal.summary,
        "policy_decision_hash": policy_decision_hash,
    });
    input_request_key(RequestKind::Draft, run_id, &request_input)
        .map_err(|error| format!("build stable draft request key: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::audit::ActionDraftProposal;

    fn proposal() -> ActionDraftProposal {
        ActionDraftProposal {
            reducer_name: "create_sale_order".to_string(),
            params_json: r#"{"company_id":7,"customer_id":11}"#.to_string(),
            summary: "Create sale order draft".to_string(),
            elevated: true,
            warnings: vec!["requires approval".to_string()],
        }
    }

    #[test]
    fn replay_uses_the_same_run_scoped_request_key() {
        let draft = proposal();
        let first = bridge_draft_request_key(41, &draft, "policy-hash").expect("first key");
        let replay = bridge_draft_request_key(41, &draft, "policy-hash").expect("replay key");

        assert_eq!(first, replay);
    }

    #[test]
    fn replay_uses_the_same_durable_run_key() {
        let first = bridge_run_key(9, 7, "corr-41").expect("first run key");
        let replay = bridge_run_key(9, 7, "corr-41").expect("replay run key");

        assert_eq!(first, replay);
    }

    #[test]
    fn concurrent_replays_converge_on_one_durable_run_key() {
        let workers = (0..16)
            .map(|_| std::thread::spawn(|| bridge_run_key(9, 7, "corr-41").expect("run key")))
            .collect::<Vec<_>>();
        let keys = workers
            .into_iter()
            .map(|worker| worker.join().expect("worker result"))
            .collect::<std::collections::HashSet<_>>();

        assert_eq!(keys.len(), 1);
    }

    #[test]
    fn durable_run_key_is_tenant_bound() {
        let first = bridge_run_key(9, 7, "corr-41").expect("first run key");
        let other_company = bridge_run_key(9, 8, "corr-41").expect("other company run key");

        assert_ne!(first, other_company);
    }

    #[test]
    fn concurrent_runs_do_not_share_request_identity() {
        let draft = proposal();
        let first = bridge_draft_request_key(41, &draft, "policy-hash").expect("first key");
        let second = bridge_draft_request_key(42, &draft, "policy-hash").expect("second key");

        assert_ne!(first, second);
    }

    #[test]
    fn changed_proposal_does_not_replay_an_existing_effect() {
        let first = proposal();
        let mut changed = proposal();
        changed.params_json = r#"{"company_id":7,"customer_id":12}"#.to_string();

        let first_key = bridge_draft_request_key(41, &first, "policy-hash").expect("first key");
        let changed_key =
            bridge_draft_request_key(41, &changed, "policy-hash").expect("changed key");

        assert_ne!(first_key, changed_key);
    }
}
