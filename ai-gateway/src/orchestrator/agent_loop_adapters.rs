//! Compatibility adapter from the generated/authorized tool registry into the
//! governed capability executor.
//!
//! There is deliberately no provider-driven execution loop here.

use anyhow::{ensure, Result};
use async_trait::async_trait;

use super::agent_loop::LoopTools;
use crate::{
    providers::llm::ToolCallRequest,
    tools::{
        generated::embedded_catalog,
        generated_read::GeneratedReadTools,
        registry::AuthorizedToolView,
        types::{ToolContext, ToolOutput},
    },
};

/// Binds governed capability execution to the authorized tool view and trusted
/// tenant/run scope. The caller must already have passed capability admission.
pub(super) struct AuthorizedLoopTools<'a> {
    pub view: &'a AuthorizedToolView<'a>,
    pub generated: GeneratedReadTools<'a>,
    pub context: &'a ToolContext,
}

#[async_trait]
impl LoopTools for AuthorizedLoopTools<'_> {
    async fn execute(&self, call: &ToolCallRequest) -> Result<ToolOutput> {
        ensure!(self.context.run_id != 0, "durable run is required");
        ensure!(
            call.name != "action_draft",
            "action drafts require governed approval handling"
        );
        if embedded_catalog()?.advertises(&call.name) {
            return self.generated.execute(call, self.context).await;
        }
        self.view
            .run_named(&call.name, self.context, &call.arguments)
            .await
    }
}
