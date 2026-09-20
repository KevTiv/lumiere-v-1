//! Compatibility interfaces retained while governed execution services own
//! authorization, execution, recovery, approvals, and verification.
//!
//! This module intentionally contains no model/tool loop. A reasoning provider
//! may propose capabilities, but only `GovernedCapabilityService` may admit
//! and execute them.

use anyhow::Result;
use async_trait::async_trait;
use serde_json::Value;

use crate::{
    harness::audit::PolicyDecision,
    providers::llm::ToolCallRequest,
    tools::types::ToolOutput,
};

#[derive(Clone, Debug)]
pub(super) struct LoopEvent {
    pub step_no: u32,
    pub kind: String,
    pub tool_name: Option<String>,
    pub input: Value,
    pub summary: String,
    pub error: Option<String>,
}

/// Compatibility execution interface consumed only by governed execution
/// adapters. Models never receive or invoke this interface directly.
#[async_trait]
pub(super) trait LoopTools: Send + Sync {
    async fn execute(&self, call: &ToolCallRequest) -> Result<ToolOutput>;
}

/// Compatibility policy interface consumed by `GovernedCapabilityService`.
/// The reasoning/model layer has no authority to interpret this decision.
#[async_trait]
pub(super) trait LoopPolicy: Send + Sync {
    async fn evaluate(
        &self,
        call: &ToolCallRequest,
        completed_calls: u32,
    ) -> Result<PolicyDecision>;

    async fn protect_output(
        &self,
        call: &ToolCallRequest,
        completed_calls: u32,
        output: ToolOutput,
    ) -> Result<ToolOutput>;
}

#[async_trait]
pub(super) trait LoopRecorder: Send + Sync {
    async fn record(&self, event: &LoopEvent) -> Result<()>;
}
