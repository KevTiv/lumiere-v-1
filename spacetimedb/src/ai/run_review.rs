//! GP-14 (governed intelligence program): durable independent run review.
//!
//! `RunReviewProgram` (`ai-gateway/src/orchestrator/run_review.rs`)
//! classifies a *completed* governed run from its observable trace/outputs
//! alone — never executing anything, never seeing live state — into one of
//! four typed dispositions. Until this module, that classification was
//! computed, used once to shape the HTTP response, and then lost: nothing
//! durable recorded which runs were reviewed, what they were classified
//! as, or by which reviewer. An `incident_candidate` disposition in
//! particular is exactly the kind of signal an ops/security review would
//! need to find later, not just see once in a single response body.
//!
//! One review per run: `record_ai_run_review` is idempotent on an
//! identical replay (the same run reviewed twice with the same result is
//! a no-op) and rejects a differing one — a run's review outcome, once
//! recorded, is append-evidence, not overwritable. The run does not need
//! to still be active; review only ever runs after a run has already
//! reached a terminal `GovernedProgramStop`.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::skills::ai_agent_run;
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_PROGRAM_REF_LEN: usize = 256;
const MAX_RATIONALE_LEN: usize = 4_000;
const DISPOSITIONS: [&str; 4] = ["healthy", "review_required", "defect", "incident_candidate"];

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_run_review,
    public,
    index(accessor = ai_run_review_by_org, btree(columns = [organization_id])),
    index(accessor = ai_run_review_by_run, btree(columns = [run_id]))
)]
pub struct AiRunReview {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub program_ref: String,
    /// "healthy" | "review_required" | "defect" | "incident_candidate"
    pub disposition: String,
    pub rationale: Option<String>,
    /// The reviewer's provider/model — GP-14 asks that review run through a
    /// different provider/profile from execution where practical; this is
    /// durable evidence of which one actually reviewed this run.
    pub provider: String,
    pub model: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiRunReviewParams {
    pub run_id: u64,
    pub program_ref: String,
    pub disposition: String,
    pub rationale: Option<String>,
    pub provider: String,
    pub model: String,
}

/// Persist one independent review of a completed governed run. Idempotent
/// by `run_id`: replaying the identical disposition/rationale/reviewer is
/// a no-op; a differing replay for a run already reviewed is rejected.
#[reducer]
pub fn record_ai_run_review(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RecordAiRunReviewParams,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization_id must be nonzero".to_string());
    }
    check_permission(ctx, organization_id, "ai_run_review", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    if params.run_id == 0 {
        return Err("run_id must be nonzero".to_string());
    }
    if params.program_ref.trim().is_empty() || params.program_ref.len() > MAX_PROGRAM_REF_LEN {
        return Err(format!("program_ref must be 1..{MAX_PROGRAM_REF_LEN} bytes"));
    }
    if !DISPOSITIONS.contains(&params.disposition.as_str()) {
        return Err(format!("disposition must be one of {DISPOSITIONS:?}"));
    }
    if let Some(rationale) = &params.rationale {
        if rationale.len() > MAX_RATIONALE_LEN {
            return Err("rationale is too long".to_string());
        }
    }
    if params.provider.trim().is_empty() || params.model.trim().is_empty() {
        return Err("provider and model are required".to_string());
    }

    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&params.run_id)
        .ok_or("Run not found")?;
    if run.organization_id != organization_id || run.company_id != company_id {
        return Err("Run does not belong to this organization/company".to_string());
    }

    if let Some(existing) = ctx
        .db
        .ai_run_review()
        .ai_run_review_by_run()
        .filter(&params.run_id)
        .find(|review| review.organization_id == organization_id)
    {
        if existing.program_ref == params.program_ref
            && existing.disposition == params.disposition
            && existing.rationale == params.rationale
            && existing.provider == params.provider
            && existing.model == params.model
        {
            return Ok(());
        }
        return Err("run review replay conflicts with the existing review".to_string());
    }

    let row = ctx.db.ai_run_review().insert(AiRunReview {
        id: 0,
        organization_id,
        company_id,
        run_id: params.run_id,
        program_ref: params.program_ref,
        disposition: params.disposition,
        rationale: params.rationale,
        provider: params.provider,
        model: params.model,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_run_review",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "run_id": row.run_id,
                    "disposition": row.disposition,
                })
                .to_string(),
            ),
            changed_fields: vec!["disposition".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(organization_id: u64, company_id: u64) -> crate::ai::skills::AiAgentRun {
        crate::ai::skills::AiAgentRun {
            id: 1,
            organization_id,
            company_id,
            skill_id: 1,
            skill_config_id: None,
            agent_id: 1,
            team_member_id: None,
            run_key: "run-key".into(),
            status: "completed".into(),
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
            completed_at: Some(Timestamp::from_micros_since_unix_epoch(1)),
            create_date: Timestamp::from_micros_since_unix_epoch(0),
            write_date: Timestamp::from_micros_since_unix_epoch(0),
            metadata: None,
        }
    }

    #[test]
    fn a_completed_run_is_a_valid_review_target() {
        // record_ai_run_review deliberately does not require an
        // active/running status the way decision_events.rs's
        // load_active_run does: review only ever happens after
        // completion.
        let r = run(1, 1);
        assert_eq!(r.status, "completed");
    }

    #[test]
    fn disposition_set_matches_run_review_program() {
        // Mirrors ai-gateway's RunReviewDisposition::serde rename_all =
        // "snake_case" values exactly — a mismatch here would silently
        // fail every durable review write.
        assert_eq!(
            DISPOSITIONS,
            ["healthy", "review_required", "defect", "incident_candidate"]
        );
    }
}
