use serde_json::{json, Value};

use crate::{
    orchestrator::{
        output_gate::{
            admit_structured_output, persist_or_withhold_generated_output, GeneratedOutputDraft,
            PublicationIdentity,
        },
        text_answer_gate::TextEvidence,
    },
    tools::types::{hash_tool_input, ToolContext, ToolOutput, ToolResult},
};

pub async fn execute(ctx: &ToolContext, input: &Value) -> ToolResult {
    let title = input
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Skill artifact");

    let kind = input
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("markdown");

    let content = input.get("content").cloned().unwrap_or(Value::Null);

    // This tool is currently return-only; it must not present an unverified
    // model-authored body as a saved/published artifact.  A future durable
    // artifact contract can pass its server-produced evidence here.
    let candidate = match &content {
        Value::String(text) => text.clone(),
        value => serde_json::to_string(value).unwrap_or_default(),
    };
    let structured = GeneratedOutputDraft::single_claim(candidate, Vec::new());
    let mut gated = admit_structured_output(
        ctx.org_id,
        ctx.company_id,
        &structured,
        &TextEvidence::default(),
    )
    .await?;
    persist_or_withhold_generated_output(
        &mut gated,
        ctx.state.stdb.as_ref(),
        ctx.state.spend_read_stdb.as_deref(),
        PublicationIdentity {
            organization_id: ctx.org_id,
            company_id: ctx.company_id,
            session_ref: format!("run:{}:artifact:{}", ctx.run_id, hash_tool_input(input)),
            event_ref: "artifact_body".to_string(),
            note: "artifact body admitted by the publication gate".to_string(),
        },
    )
    .await;
    let Some(released) = gated.released else {
        anyhow::bail!(
            "artifact body withheld by answer gate: {}",
            gated
                .verification
                .reason
                .unwrap_or_else(|| "output requires review".to_string())
        );
    };

    Ok(ToolOutput {
        summary: format!("Prepared {kind} artifact for review: {title}"),
        data: json!({
            "kind": kind,
            "title": title,
            "content": released,
            "run_id": ctx.run_id,
        }),
        citations: vec![],
        row_count: None,
    })
}
