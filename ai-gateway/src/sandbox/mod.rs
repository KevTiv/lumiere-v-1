//! Internal seam for a separately isolated JavaScript analysis runtime.
//!
//! The existing governed executor remains the authority and recovery owner.
//! This module registers no route or model tool. This build cannot dispatch
//! customer data: independent runtime/profile certification is still required.

#![allow(dead_code)]

mod client;
mod protocol;

use anyhow::{ensure, Context, Result};
use chrono::{Duration, Utc};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    providers::llm::ToolCallRequest,
    tools::{
        generated::embedded_catalog,
        generated_read::{resolve_actor_grants, GeneratedReadTools},
        types::ToolContext,
    },
};

pub(crate) use client::SandboxControllerClient;
pub(crate) use protocol::{DatasetHandle, DatasetSchema, SandboxScope};
pub(crate) type ExecutionSnapshot = protocol::ExecutionSnapshot;

/// A source-code admission decision, not an environment-controlled feature.
/// A later certification change must also admit the exact runtime/profile and
/// add the capability to the existing governed execution and release policy.
pub(crate) const PRODUCTION_SANDBOX_ADMITTED: bool = false;
pub(crate) const MAX_DATASET_TTL_SECONDS: i64 = 300;

pub(crate) fn require_production_admission() -> Result<()> {
    ensure!(
        PRODUCTION_SANDBOX_ADMITTED,
        "JavaScript sandbox runtime is unavailable pending independent certification"
    );
    Ok(())
}

/// Data acquisition is configured by the released skill adapter. The model
/// does not choose a resource, endpoint, schema, source watermark or identity.
pub(crate) struct ReviewedDatasetSource {
    pub tool_name: String,
    pub schema: DatasetSchema,
    pub max_rows: u32,
    pub watermark: Option<String>,
    pub provenance_ref: Option<String>,
}

/// Acquire with current generated-read authorization and send rows directly to
/// the broker. Only an opaque handle may be returned to a future model node.
/// There is deliberately no fallback that returns the original row payload.
pub(crate) async fn acquire_dataset(
    controller: &SandboxControllerClient,
    context: &ToolContext,
    declared_tool_names: &[String],
    source: &ReviewedDatasetSource,
) -> Result<DatasetHandle> {
    require_production_admission()?;
    acquire_authorized(controller, context, declared_tool_names, source).await
}

async fn acquire_authorized(
    controller: &SandboxControllerClient,
    context: &ToolContext,
    declared_tool_names: &[String],
    source: &ReviewedDatasetSource,
) -> Result<DatasetHandle> {
    controller.ensure_actor(
        context
            .actor
            .as_ref()
            .context("sandbox acquisition requires actor credentials")?,
    )?;
    ensure!(
        context.run_id != 0,
        "sandbox acquisition requires a durable run"
    );
    ensure!(
        source.max_rows > 0,
        "sandbox acquisition row limit must be positive"
    );
    ensure!(
        declared_tool_names
            .iter()
            .any(|name| name == &source.tool_name),
        "sandbox source is not declared by the released skill"
    );
    source.schema.validate()?;

    let before = resolve_actor_grants(context).await?;
    let arguments = json!({"max_rows": source.max_rows});
    let prepared = embedded_catalog()?
        .prepare_read(
            &source.tool_name,
            &arguments,
            context.company_id,
            &before.grants,
        )
        .context("sandbox source is not an admitted generated read")?;
    let call = ToolCallRequest {
        id: None,
        name: source.tool_name.clone(),
        arguments,
        arguments_error: None,
    };
    let output = GeneratedReadTools::new(declared_tool_names)
        .execute(&call, context)
        .await?;

    // In-flight acquisition may span a policy or placement change. Compare
    // after reading, before sending any dataset to the separate controller.
    let after = resolve_actor_grants(context).await?;
    ensure!(
        before.authorization_generation == after.authorization_generation,
        "sandbox authority changed during data acquisition"
    );
    let actor = context
        .actor
        .as_ref()
        .context("sandbox acquisition requires actor credentials")?;
    let scope = SandboxScope {
        actor_identity: actor.identity_hex.trim().to_string(),
        organization_id: context.org_id.to_string(),
        company_id: context.company_id.to_string(),
        run_id: context.run_id.to_string(),
        policy_generation: format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&after.authorization_generation)?)
        ),
    };
    let rows = source.schema.project_rows(
        output
            .data
            .as_array()
            .context("sandbox source did not return a row array")?,
    )?;
    let expires_at = (Utc::now() + Duration::seconds(MAX_DATASET_TTL_SECONDS))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let request = protocol::DatasetIssueRequest {
        scope,
        schema: source.schema.clone(),
        rows,
        expires_at,
        source_capabilities: vec![prepared.capability_key],
        watermark: source.watermark.clone(),
        provenance_ref: source.provenance_ref.clone(),
    };
    controller.issue_dataset(&request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_build_has_no_production_dispatch_authority() {
        // No configuration reader is involved: setting an environment flag
        // cannot change this compile-time release decision.
        assert!(!PRODUCTION_SANDBOX_ADMITTED);
        assert!(require_production_admission().is_err());
    }
}
