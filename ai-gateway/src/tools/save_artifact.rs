use serde_json::{json, Value};

use crate::tools::types::{ToolContext, ToolOutput, ToolResult};

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

    Ok(ToolOutput {
        summary: format!("Saved {kind} artifact: {title}"),
        data: json!({
            "kind": kind,
            "title": title,
            "content": content,
            "run_id": ctx.run_id,
        }),
        citations: vec![],
        row_count: None,
    })
}
