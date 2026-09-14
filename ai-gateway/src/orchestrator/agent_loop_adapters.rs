//! H4 integration seams. Skill routing remains gated on H5 policy and budget work.

use anyhow::{ensure, Result};
use async_trait::async_trait;
use serde_json::json;
use std::sync::atomic::{AtomicU32, Ordering};

use super::agent_loop::{
    run_loop, LoopEvent, LoopLimits, LoopOutcome, LoopRecorder, LoopStop, LoopTools,
};
use super::invocation_policy::ReviewedInvocationPolicy;
use super::spend_admission::{SpendAdmittedLlm, SpendBinding, SpendLedger};
use crate::{
    providers::llm::{LlmCompletion, LlmRequest, ToolCallRequest},
    tools::{
        registry::AuthorizedToolView,
        types::{hash_tool_input, ToolContext, ToolOutput},
    },
};

/// Internal seam for later governed routing; the caller must first create a
/// durable run. No HTTP handler or skill invokes this until H5 admission exists.
/// Every provider attempt is admitted through `ledger` against `binding`, which
/// must describe the same organization, company and durable run as `context`.
#[allow(clippy::too_many_arguments)]
pub(super) async fn run_recorded_loop(
    llm: &dyn LlmCompletion,
    ledger: &dyn SpendLedger,
    binding: SpendBinding,
    view: &AuthorizedToolView<'_>,
    policy: &ReviewedInvocationPolicy,
    context: &ToolContext,
    request: LlmRequest,
    limits: LoopLimits,
) -> Result<LoopOutcome> {
    policy.ensure_context(context.org_id, context.company_id, &context.skill_key)?;
    ensure!(
        binding.organization_id == context.org_id
            && binding.company_id == context.company_id
            && binding.run_id == context.run_id,
        "spend binding does not match the durable run context"
    );
    let admitted = SpendAdmittedLlm::new(llm, ledger, binding)?;
    let tools = AuthorizedLoopTools { view, context };
    let recorder = StdbLoopRecorder {
        stdb: &context.stdb,
        organization_id: context.org_id,
        company_id: context.company_id,
        run_id: context.run_id,
    };
    let counted = CountingRecorder::new(&recorder);
    // A loop error (for example a failed event write) leaves the run state
    // uncertain, so it propagates without finalizing the durable run.
    let outcome = run_loop(
        context.run_id,
        &admitted,
        &tools,
        policy,
        &counted,
        request,
        limits,
    )
    .await?;
    match run_finalization(&outcome.stop) {
        RunFinalization::Failed { error_code } => {
            super::skill_loader::complete_run(
                &context.stdb,
                context.org_id,
                context.company_id,
                context.run_id,
                "failed",
                None,
                None,
                None,
                counted.max_step(),
                saturating_tokens(&outcome),
                Some(error_code.to_string()),
            )
            .await?;
        }
        RunFinalization::Wait { status, .. } => {
            super::skill_loader::set_run_wait_state(
                &context.stdb,
                context.org_id,
                context.company_id,
                context.run_id,
                status,
            )
            .await?;
        }
    }
    Ok(outcome)
}

/// Binds the loop's tool execution to the H3 invocation view and trusted scope.
pub(super) struct AuthorizedLoopTools<'a> {
    pub view: &'a AuthorizedToolView<'a>,
    pub context: &'a ToolContext,
}

#[async_trait]
impl LoopTools for AuthorizedLoopTools<'_> {
    async fn execute(&self, call: &ToolCallRequest) -> Result<ToolOutput> {
        ensure!(self.context.run_id != 0, "durable run is required");
        // H5 owns draft creation and the pending-approval stop transition.
        ensure!(
            call.name != "action_draft",
            "action drafts require H5 approval handling"
        );
        self.view
            .run_named(&call.name, self.context, &call.arguments)
            .await
    }
}

/// Persists loop events through the existing tenant-authorized reducer.
///
/// The initial event must succeed before a provider call: the reducer verifies
/// that this run exists, belongs to the supplied company and is still active.
/// Each adapter is for one fresh invocation; resumption/step allocation is a
/// separate recovery concern. Final output remains a candidate for the answer gate.
pub(super) struct StdbLoopRecorder<'a> {
    pub stdb: &'a stdb_client::StdbClient,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
}

#[async_trait]
impl LoopRecorder for StdbLoopRecorder<'_> {
    async fn record(&self, event: &LoopEvent) -> Result<()> {
        ensure!(
            self.organization_id != 0 && self.company_id != 0 && self.run_id != 0,
            "nonzero organization, company and run are required"
        );
        let summary =
            json!({"kind":event.kind,"summary":event.summary,"details":event.input}).to_string();
        // Preserve complete evidence or stop. Silently truncating JSON would
        // turn persisted events into misleading or unreadable records.
        ensure!(
            summary.len() <= 8000,
            "loop event exceeds persisted summary limit"
        );
        self.stdb
            .call_reducer(stdb_client::reducer_call!(
                "append_ai_agent_run_step",
                json!([self.organization_id, self.company_id, self.run_id, {
                    "step_no": event.step_no,
                    "tool_name": event.tool_name.as_deref().unwrap_or("agent_loop"),
                    "input_hash": hash_tool_input(&event.input),
                    "output_summary": summary,
                    "output_row_count": null,
                    "citations_json": null,
                    "duration_ms": 0,
                    "error_message": event.error,
                }]),
            ))
            .await?;
        Ok(())
    }
}

/// Durable run handling for a loop outcome. Only failures are terminal here:
/// a candidate answer still needs the answer gate, and a pending approval
/// waits for the approval flow, so both park the run in a wait state that says
/// which gate it is waiting for instead of leaving it indistinguishable from a
/// run that is still working.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum RunFinalization {
    Failed {
        error_code: &'static str,
    },
    Wait {
        status: &'static str,
        reason: &'static str,
    },
}

pub(super) fn run_finalization(stop: &LoopStop) -> RunFinalization {
    let failed = |error_code| RunFinalization::Failed { error_code };
    match stop {
        LoopStop::CandidateFinal(_) => RunFinalization::Wait {
            status: "agent_settled",
            reason: "candidate answer awaits the answer gate",
        },
        LoopStop::PendingApproval => RunFinalization::Wait {
            status: "awaiting_approval",
            reason: "action awaits approval",
        },
        LoopStop::MalformedCall => failed("agent_loop_stop:malformed_call"),
        LoopStop::ToolDenied => failed("agent_loop_stop:tool_denied"),
        LoopStop::PolicyFailed => failed("agent_loop_stop:policy_failed"),
        LoopStop::ToolFailed => failed("agent_loop_stop:tool_failed"),
        LoopStop::ProviderFailed => failed("agent_loop_stop:provider_failed"),
        LoopStop::NoProgress => failed("agent_loop_stop:no_progress"),
        LoopStop::RoundLimit => failed("agent_loop_stop:round_limit"),
        LoopStop::ToolLimit => failed("agent_loop_stop:tool_limit"),
        LoopStop::TokenLimit => failed("agent_loop_stop:token_limit"),
    }
}

fn saturating_tokens(outcome: &LoopOutcome) -> u32 {
    u32::try_from(outcome.input_tokens.saturating_add(outcome.output_tokens)).unwrap_or(u32::MAX)
}

/// Records through `inner` and remembers the highest persisted step number,
/// which becomes the durable run's step count.
pub(super) struct CountingRecorder<'a> {
    inner: &'a dyn LoopRecorder,
    max_step: AtomicU32,
}

impl<'a> CountingRecorder<'a> {
    pub fn new(inner: &'a dyn LoopRecorder) -> Self {
        Self {
            inner,
            max_step: AtomicU32::new(0),
        }
    }

    pub fn max_step(&self) -> u32 {
        self.max_step.load(Ordering::SeqCst)
    }
}

#[async_trait]
impl LoopRecorder for CountingRecorder<'_> {
    async fn record(&self, event: &LoopEvent) -> Result<()> {
        self.inner.record(event).await?;
        self.max_step.fetch_max(event.step_no, Ordering::SeqCst);
        Ok(())
    }
}

#[cfg(test)]
mod finalization_tests {
    use super::*;
    use anyhow::anyhow;
    use std::sync::Mutex;

    fn event(step_no: u32) -> LoopEvent {
        LoopEvent {
            step_no,
            kind: "provider".into(),
            tool_name: None,
            input: json!({}),
            summary: "s".into(),
            error: None,
        }
    }

    struct FakeRecorder {
        fail_on: Option<u32>,
        seen: Mutex<Vec<u32>>,
    }

    #[async_trait]
    impl LoopRecorder for FakeRecorder {
        async fn record(&self, event: &LoopEvent) -> Result<()> {
            if self.fail_on == Some(event.step_no) {
                return Err(anyhow!("write failed"));
            }
            self.seen.lock().unwrap().push(event.step_no);
            Ok(())
        }
    }

    #[test]
    fn only_failures_finalize_the_durable_run() {
        let waiting = [
            (LoopStop::CandidateFinal("answer".into()), "agent_settled"),
            (LoopStop::PendingApproval, "awaiting_approval"),
        ];
        for (stop, expected) in waiting {
            match run_finalization(&stop) {
                RunFinalization::Wait { status, .. } => assert_eq!(status, expected, "{stop:?}"),
                other => panic!("{stop:?} must park the run in a wait state, got {other:?}"),
            }
        }
        let failed = [
            (LoopStop::MalformedCall, "malformed_call"),
            (LoopStop::ToolDenied, "tool_denied"),
            (LoopStop::PolicyFailed, "policy_failed"),
            (LoopStop::ToolFailed, "tool_failed"),
            (LoopStop::ProviderFailed, "provider_failed"),
            (LoopStop::NoProgress, "no_progress"),
            (LoopStop::RoundLimit, "round_limit"),
            (LoopStop::ToolLimit, "tool_limit"),
            (LoopStop::TokenLimit, "token_limit"),
        ];
        for (stop, code) in failed {
            match run_finalization(&stop) {
                RunFinalization::Failed { error_code } => {
                    assert_eq!(error_code, format!("agent_loop_stop:{code}"), "{stop:?}")
                }
                other => panic!("{stop:?} must finalize as failed, got {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn counting_recorder_tracks_highest_persisted_step() {
        let inner = FakeRecorder {
            fail_on: Some(9),
            seen: Mutex::new(Vec::new()),
        };
        let counted = CountingRecorder::new(&inner);
        counted.record(&event(1)).await.unwrap();
        counted.record(&event(4)).await.unwrap();
        counted.record(&event(3)).await.unwrap();
        assert_eq!(counted.max_step(), 4);
        assert!(counted.record(&event(9)).await.is_err());
        assert_eq!(counted.max_step(), 4, "a failed write is not counted");
        assert_eq!(*inner.seen.lock().unwrap(), vec![1, 4, 3]);
    }

    #[test]
    fn token_total_saturates_to_u32() {
        let outcome = LoopOutcome {
            transcript: Vec::new(),
            stop: LoopStop::TokenLimit,
            input_tokens: u64::MAX,
            output_tokens: 5,
        };
        assert_eq!(saturating_tokens(&outcome), u32::MAX);
    }
}
