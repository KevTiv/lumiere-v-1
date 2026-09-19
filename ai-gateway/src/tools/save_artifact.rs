use serde_json::{json, Value};

use crate::{
    orchestrator::{output_gate::admit_generated_output, text_answer_gate::TextEvidence},
    tools::types::{ToolContext, ToolOutput, ToolResult},
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
    let gated = admit_generated_output(
        ctx.org_id,
        ctx.company_id,
        &candidate,
        &TextEvidence::default(),
    )
    .await?;
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
