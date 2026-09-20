//! Durable content-addressed capability-execution recovery (GP-03).
//!
//! Binds `ExecutionRecovery` (`ai-gateway/src/orchestrator/governed_services.rs`)
//! to a durable, organization-owned store so a capability proposal repeated by
//! model retry or a resumed run replays the recorded outcome instead of
//! re-executing a mutation. The recovery key is never supplied by the model:
//! the gateway derives it deterministically from `(run_id, capability,
//! arguments)` before either reducer here is called.
//!
//! Mirrors `ai::spend`'s reservation/attempt split — `claim_ai_capability_execution`
//! commits intent before execution runs (idempotent replay on an identical
//! binding, denied on a conflicting one); `record_ai_capability_execution_result`
//! stores the outcome exactly once. Unlike price/spend rows, the row is looked
//! up by its caller-computed `recovery_key` directly, so no id read-back is
//! needed after the claim.
//!
//! This table only proves recovery-key idempotency and durability; it does not
//! by itself make `GovernedCapabilityService` durable. Gateway activation
//! requires a released contract, a `StdbExecutionRecovery` implementation bound
//! to these reducers, and a trusted principal explicitly granted
//! `ai_capability_execution/write` — none of that is added in this slice.

use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::skills::{ai_agent_run, AiAgentRun};
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_RECOVERY_KEY_LEN: usize = 128;
const MAX_CAPABILITY_LEN: usize = 256;
const MAX_OUTPUT_JSON_LEN: usize = 16_384;
const MAX_OUTPUT_HASH_LEN: usize = 64;
const MAX_FAILURE_REASON_LEN: usize = 1_024;

const EXECUTION_CLAIMED: &str = "claimed";
const EXECUTION_SUCCEEDED: &str = "succeeded";
const EXECUTION_FAILED: &str = "failed";

/// One durable claim/outcome for a content-addressed capability recovery key.
/// `recovery_key` is computed by the gateway from `(run_id, capability,
/// arguments)`; it is never a model-supplied id.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_capability_execution,
    index(accessor = ai_capability_execution_by_org, btree(columns = [organization_id])),
    index(accessor = ai_capability_execution_by_key, btree(columns = [organization_id, recovery_key])),
    index(accessor = ai_capability_execution_by_run, btree(columns = [run_id]))
)]
pub struct AiCapabilityExecution {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub recovery_key: String,
    pub capability: String,
    /// claimed | succeeded | failed
    pub status: String,
    pub output_json: Option<String>,
    pub output_hash: Option<String>,
    pub failure_reason: Option<String>,
    pub claimed_by: spacetimedb::Identity,
    pub write_uid: spacetimedb::Identity,
    pub created_at: Timestamp,
    pub finished_at: Option<Timestamp>,
    pub write_date: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ClaimAiCapabilityExecutionParams {
    pub company_id: u64,
    pub run_id: u64,
    pub recovery_key: String,
    pub capability: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiCapabilityExecutionResultParams {
    pub recovery_key: String,
    /// succeeded | failed
    pub status: String,
    pub output_json: Option<String>,
    pub output_hash: Option<String>,
    pub failure_reason: Option<String>,
}

/// Commit execution intent before the capability actually runs. Replaying an
/// identical binding (same run/company/capability under the same key) is a
/// no-op so a resumed run can call this unconditionally; reusing the key with
/// a different binding is denied rather than silently accepted.
#[reducer]
pub fn claim_ai_capability_execution(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ClaimAiCapabilityExecutionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_capability_execution", "write")?;
    validate_key_and_capability(&params.recovery_key, &params.capability)?;
    if params.company_id == 0 {
        return Err("invalid company".into());
    }
    if let Some(existing) = ctx
        .db
        .ai_capability_execution()
        .ai_capability_execution_by_key()
        .filter((&organization_id, &params.recovery_key))
        .next()
    {
        if claim_matches(&existing, &params) {
            return Ok(());
        }
        return Err("recovery key was already used with a different binding".into());
    }
    require_company_in_organization(ctx, organization_id, params.company_id)?;
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&params.run_id)
        .ok_or_else(|| "run not found".to_string())?;
    validate_run(organization_id, params.company_id, &run)?;

    let row = ctx
        .db
        .ai_capability_execution()
        .insert(AiCapabilityExecution {
            id: 0,
            organization_id,
            company_id: params.company_id,
            run_id: params.run_id,
            recovery_key: params.recovery_key,
            capability: params.capability,
            status: EXECUTION_CLAIMED.into(),
            output_json: None,
            output_hash: None,
            failure_reason: None,
            claimed_by: ctx.sender(),
            write_uid: ctx.sender(),
            created_at: ctx.timestamp,
            finished_at: None,
            write_date: ctx.timestamp,
        });
    audit_execution(ctx, &row, "CREATE", None, "claimed capability execution");
    Ok(())
}

/// Record the outcome of a claimed execution exactly once. Replaying the
/// identical outcome is a no-op; a conflicting replay (different payload for
/// the same key, or a terminal row disagreeing with the new status) is denied.
#[reducer]
pub fn record_ai_capability_execution_result(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordAiCapabilityExecutionResultParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_capability_execution", "write")?;
    let next = match params.status.trim() {
        EXECUTION_SUCCEEDED => EXECUTION_SUCCEEDED,
        EXECUTION_FAILED => EXECUTION_FAILED,
        _ => return Err("status must be succeeded or failed".into()),
    };
    validate_outcome(next, &params)?;

    let execution = ctx
        .db
        .ai_capability_execution()
        .ai_capability_execution_by_key()
        .filter((&organization_id, &params.recovery_key))
        .next()
        .ok_or_else(|| "no claimed execution for this recovery key".to_string())?;

    let replayed = execution.output_json == params.output_json
        && execution.output_hash == params.output_hash
        && execution.failure_reason == params.failure_reason;
    match execution.status.as_str() {
        EXECUTION_CLAIMED => {}
        current if current == next && replayed => return Ok(()),
        current if current == next => return Err("result replay has a different outcome".into()),
        _ => return Err("execution result conflicts with the recorded outcome".into()),
    }

    let previous = execution.status.clone();
    let row = AiCapabilityExecution {
        status: next.into(),
        output_json: params.output_json,
        output_hash: params.output_hash,
        failure_reason: params.failure_reason,
        finished_at: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..execution
    };
    ctx.db.ai_capability_execution().id().update(row.clone());
    audit_execution(
        ctx,
        &row,
        "UPDATE",
        Some(&previous),
        "recorded capability execution result",
    );
    Ok(())
}

fn claim_matches(row: &AiCapabilityExecution, params: &ClaimAiCapabilityExecutionParams) -> bool {
    row.run_id == params.run_id
        && row.company_id == params.company_id
        && row.capability == params.capability
}

fn validate_key_and_capability(recovery_key: &str, capability: &str) -> Result<(), String> {
    if recovery_key.trim().is_empty() || recovery_key.len() > MAX_RECOVERY_KEY_LEN {
        return Err("invalid recovery key".into());
    }
    if capability.trim().is_empty() || capability.len() > MAX_CAPABILITY_LEN {
        return Err("invalid capability name".into());
    }
    Ok(())
}

fn validate_outcome(
    status: &str,
    params: &RecordAiCapabilityExecutionResultParams,
) -> Result<(), String> {
    if let Some(json) = &params.output_json {
        if json.len() > MAX_OUTPUT_JSON_LEN {
            return Err("output payload is too large".into());
        }
    }
    if let Some(hash) = &params.output_hash {
        if hash.is_empty() || hash.len() > MAX_OUTPUT_HASH_LEN {
            return Err("invalid output hash".into());
        }
    }
    if let Some(reason) = &params.failure_reason {
        if reason.is_empty() || reason.len() > MAX_FAILURE_REASON_LEN {
            return Err("invalid failure reason".into());
        }
    }
    if status == EXECUTION_FAILED && params.output_json.is_some() {
        return Err("a failed execution cannot carry an output payload".into());
    }
    if status == EXECUTION_SUCCEEDED && params.failure_reason.is_some() {
        return Err("a succeeded execution cannot carry a failure reason".into());
    }
    Ok(())
}

fn validate_run(organization_id: u64, company_id: u64, run: &AiAgentRun) -> Result<(), String> {
    if run.organization_id != organization_id || run.company_id != company_id {
        return Err("run is outside the requested tenant or company".into());
    }
    if run.status != "pending" && run.status != "running" {
        return Err("run is not active".into());
    }
    Ok(())
}

fn audit_execution(
    ctx: &ReducerContext,
    row: &AiCapabilityExecution,
    action: &'static str,
    previous_status: Option<&str>,
    summary: &str,
) {
    write_audit_log_v2(
        ctx,
        row.organization_id,
        AuditLogParams {
            company_id: Some(row.company_id),
            table_name: "ai_capability_execution",
            record_id: row.id,
            action,
            old_values: previous_status
                .map(|status| serde_json::json!({ "status": status }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "status": row.status,
                    "run_id": row.run_id,
                    "capability": row.capability,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: Some(serde_json::json!({ "summary": summary }).to_string()),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(organization_id: u64, company_id: u64, status: &str) -> AiAgentRun {
        AiAgentRun {
            id: 1,
            organization_id,
            company_id,
            skill_id: 1,
            skill_config_id: None,
            agent_id: 1,
            team_member_id: None,
            run_key: "run-key".into(),
            status: status.into(),
            inputs_json: "{}".into(),
            summary: None,
            artifacts_json: None,
            citations_json: None,
            action_draft_ids: vec![],
            step_count: 0,
            tokens_used: 0,
            error_message: None,
            triggered_by_hex: "0".into(),
            started_at: Timestamp::from_micros_since_unix_epoch(0),
            completed_at: None,
            create_date: Timestamp::from_micros_since_unix_epoch(0),
            write_date: Timestamp::from_micros_since_unix_epoch(0),
            metadata: None,
        }
    }

    fn claim_params() -> ClaimAiCapabilityExecutionParams {
        ClaimAiCapabilityExecutionParams {
            company_id: 1,
            run_id: 1,
            recovery_key: "gp03:capability:deadbeef".into(),
            capability: "erp.search".into(),
        }
    }

    #[test]
    fn validate_run_requires_matching_tenant_and_active_status() {
        assert!(validate_run(1, 1, &run(1, 1, "running")).is_ok());
        assert!(validate_run(1, 1, &run(1, 1, "pending")).is_ok());
        assert!(validate_run(1, 1, &run(2, 1, "running")).is_err());
        assert!(validate_run(1, 1, &run(1, 2, "running")).is_err());
        assert!(validate_run(1, 1, &run(1, 1, "completed")).is_err());
        assert!(validate_run(1, 1, &run(1, 1, "awaiting_approval")).is_err());
    }

    #[test]
    fn key_and_capability_bounds_are_enforced() {
        assert!(validate_key_and_capability("gp03:capability:deadbeef", "erp.search").is_ok());
        assert!(validate_key_and_capability("", "erp.search").is_err());
        assert!(
            validate_key_and_capability(&"x".repeat(MAX_RECOVERY_KEY_LEN + 1), "erp.search")
                .is_err()
        );
        assert!(validate_key_and_capability("gp03:capability:deadbeef", "").is_err());
        assert!(validate_key_and_capability(
            "gp03:capability:deadbeef",
            &"x".repeat(MAX_CAPABILITY_LEN + 1)
        )
        .is_err());
    }

    #[test]
    fn claim_replay_requires_identical_binding() {
        let params = claim_params();
        let mut existing = AiCapabilityExecution {
            id: 1,
            organization_id: 1,
            company_id: params.company_id,
            run_id: params.run_id,
            recovery_key: params.recovery_key.clone(),
            capability: params.capability.clone(),
            status: EXECUTION_CLAIMED.into(),
            output_json: None,
            output_hash: None,
            failure_reason: None,
            claimed_by: spacetimedb::Identity::from_byte_array([0; 32]),
            write_uid: spacetimedb::Identity::from_byte_array([0; 32]),
            created_at: Timestamp::from_micros_since_unix_epoch(0),
            finished_at: None,
            write_date: Timestamp::from_micros_since_unix_epoch(0),
        };
        assert!(claim_matches(&existing, &params));
        existing.capability = "erp.other".into();
        assert!(!claim_matches(&existing, &params));
    }

    #[test]
    fn outcome_payload_bounds_and_status_shape_are_enforced() {
        let ok = RecordAiCapabilityExecutionResultParams {
            recovery_key: "gp03:capability:deadbeef".into(),
            status: EXECUTION_SUCCEEDED.into(),
            output_json: Some("{}".into()),
            output_hash: Some("abc123".into()),
            failure_reason: None,
        };
        assert!(validate_outcome(EXECUTION_SUCCEEDED, &ok).is_ok());

        let too_large = RecordAiCapabilityExecutionResultParams {
            output_json: Some("x".repeat(MAX_OUTPUT_JSON_LEN + 1)),
            ..ok.clone()
        };
        assert!(validate_outcome(EXECUTION_SUCCEEDED, &too_large).is_err());

        let succeeded_with_reason = RecordAiCapabilityExecutionResultParams {
            failure_reason: Some("boom".into()),
            ..ok.clone()
        };
        assert!(validate_outcome(EXECUTION_SUCCEEDED, &succeeded_with_reason).is_err());

        let failed_with_output = RecordAiCapabilityExecutionResultParams {
            status: EXECUTION_FAILED.into(),
            failure_reason: Some("boom".into()),
            ..ok
        };
        assert!(validate_outcome(EXECUTION_FAILED, &failed_with_output).is_err());
    }
}
