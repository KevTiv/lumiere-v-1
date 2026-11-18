//! Platform-operator correction of AI runs that the gateway recorded as
//! completed although the evidence gate withheld the answer (before #442).
//!
//! Evidence used: the run's own `summary`. The gateway wrote the gated answer
//! (or the withheld notice) there server-side, so a completed run whose summary
//! is the withheld notice was never a released answer. The browser-authored
//! chat message is deliberately not used as authority. The run row does not
//! store a verification outcome, so the notice is the strongest available
//! server-recorded evidence.

use lumiere_policy_core::withheld_answer::is_withheld_answer_notice;
use spacetimedb::{reducer, ReducerContext, SpacetimeType};

use crate::ai::run_lifecycle::ai_run_lifecycle_state;
use crate::ai::skills::{ai_agent_run, AiAgentRun};
use crate::helpers::{check_global_operator_target, write_audit_log_v2, AuditLogParams};

const MAX_RUNS_PER_CALL: usize = 100;
const CORRECTION_REASON: &str =
    "answer was withheld by the evidence gate but recorded as completed";

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CorrectWithheldAiAgentRunsParams {
    pub run_ids: Vec<u64>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Move named completed runs to failed. All-or-nothing: one ineligible run
/// rejects the call and rolls everything back.
#[reducer]
pub fn correct_withheld_ai_agent_runs(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CorrectWithheldAiAgentRunsParams,
) -> Result<(), String> {
    // Only the release-compiled, enrolled non-human platform operator. An
    // organization administrator, even a superuser, is not enough.
    if !crate::core::platform_operator::is_persistent_platform_operator(ctx) {
        return Err("platform operator required".into());
    }
    check_global_operator_target(ctx, organization_id, "write")?;
    validate_run_ids(&params.run_ids)?;

    for run_id in params.run_ids {
        let run = ctx
            .db
            .ai_agent_run()
            .id()
            .find(&run_id)
            .ok_or("Run not found")?;
        if run.organization_id != organization_id || run.company_id != company_id {
            return Err("Run does not belong to this organization and company".into());
        }
        withheld_completed_run(&run.status, run.summary.as_deref())?;
        if ctx
            .db
            .ai_run_lifecycle_state()
            .run_id()
            .find(&run_id)
            .is_some()
        {
            return Err("run has lifecycle state and cannot be corrected here".into());
        }

        let previous_status = run.status.clone();
        ctx.db.ai_agent_run().id().update(AiAgentRun {
            status: "failed".into(),
            error_message: Some(CORRECTION_REASON.into()),
            write_date: ctx.timestamp,
            ..run
        });

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "ai_agent_run",
                record_id: run_id,
                action: "UPDATE",
                old_values: Some(serde_json::json!({ "status": previous_status }).to_string()),
                new_values: Some(serde_json::json!({ "status": "failed" }).to_string()),
                changed_fields: vec!["status".to_string(), "error_message".to_string()],
                metadata: Some(
                    serde_json::json!({ "correction": "withheld_run_completed", "workstream": "AIH-35" })
                        .to_string(),
                ),
            },
        );
    }
    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn validate_run_ids(run_ids: &[u64]) -> Result<(), String> {
    if run_ids.is_empty() || run_ids.len() > MAX_RUNS_PER_CALL {
        return Err(format!(
            "run_ids must contain 1 to {MAX_RUNS_PER_CALL} runs"
        ));
    }
    let mut seen = std::collections::HashSet::new();
    if run_ids.iter().any(|id| *id == 0 || !seen.insert(*id)) {
        return Err("run_ids must be unique positive IDs".into());
    }
    Ok(())
}

/// A run is correctable only when it is completed and its recorded summary is a
/// withheld notice.
fn withheld_completed_run(status: &str, summary: Option<&str>) -> Result<(), String> {
    if status != "completed" {
        return Err("only a completed run can be corrected".into());
    }
    if !summary.is_some_and(is_withheld_answer_notice) {
        return Err("run is not recorded as a withheld answer".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_completed_runs_with_a_withheld_summary_are_eligible() {
        let notice = "This answer could not be verified and was withheld: reason";
        assert!(withheld_completed_run("completed", Some(notice)).is_ok());
        assert!(withheld_completed_run("failed", Some(notice)).is_err());
        assert!(withheld_completed_run("running", Some(notice)).is_err());
        assert!(withheld_completed_run("completed", Some("Stock is 4 units")).is_err());
        assert!(withheld_completed_run("completed", None).is_err());
    }

    #[test]
    fn run_id_list_is_bounded_unique_and_positive() {
        assert!(validate_run_ids(&[4100, 4102]).is_ok());
        assert!(validate_run_ids(&[]).is_err());
        assert!(validate_run_ids(&[0]).is_err());
        assert!(validate_run_ids(&[7, 7]).is_err());
        assert!(validate_run_ids(&(1..=101).collect::<Vec<u64>>()).is_err());
    }

    #[test]
    fn reducer_checks_operator_before_any_read_or_write() {
        let source = include_str!("withheld_run_correction.rs");
        let body = &source[source
            .find("pub fn correct_withheld_ai_agent_runs")
            .unwrap()..];
        let operator = body.find("is_persistent_platform_operator").unwrap();
        assert!(operator < body.find("ai_agent_run()").unwrap());
        assert!(operator < body.find("write_audit_log_v2").unwrap());
        assert!(body.contains("write_audit_log_v2"));
    }
}
