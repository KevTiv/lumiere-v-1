//! H4 integration seams. Skill routing remains gated on H5 policy and budget work.

use anyhow::{ensure, Result};
use async_trait::async_trait;
use serde_json::json;

use super::agent_loop::{run_loop, LoopEvent, LoopLimits, LoopOutcome, LoopRecorder, LoopTools};
use crate::{
    providers::llm::{LlmCompletion, LlmRequest, ToolCallRequest},
    tools::{
        registry::AuthorizedToolView,
        types::{hash_tool_input, ToolContext, ToolOutput},
    },
};

/// Internal seam for later governed routing; the caller must first create a
/// durable run. No HTTP handler or skill invokes this until H5 admission exists.
pub(super) async fn run_recorded_loop(
    llm: &dyn LlmCompletion,
    view: &AuthorizedToolView<'_>,
    context: &ToolContext,
    request: LlmRequest,
    limits: LoopLimits,
) -> Result<LoopOutcome> {
    let tools = AuthorizedLoopTools { view, context };
    let recorder = StdbLoopRecorder {
        stdb: &context.stdb,
        organization_id: context.org_id,
        company_id: context.company_id,
        run_id: context.run_id,
    };
    run_loop(context.run_id, llm, &tools, &recorder, request, limits).await
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
