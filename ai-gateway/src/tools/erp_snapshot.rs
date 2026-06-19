use serde_json::{json, Value};

use crate::{
    harness::snapshot::{
        fetch_live_snapshots, filter_entity_refs_by_allowed_types, EntityRef,
        HARNESS_MAX_LIVE_SNAPSHOTS,
    },
    tools::types::{live_snapshot_citation, ToolContext, ToolOutput, ToolResult},
};

pub async fn execute(ctx: &ToolContext, input: &Value) -> ToolResult {
    let entity_type = input
        .get("entity_type")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("entity_type is required"))?;

    let entity_id = input
        .get("entity_id")
        .and_then(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()))
        .filter(|id| *id > 0)
        .ok_or_else(|| anyhow::anyhow!("entity_id is required"))?;

    let max = input
        .get("max_snapshots")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(HARNESS_MAX_LIVE_SNAPSHOTS)
        .clamp(1, HARNESS_MAX_LIVE_SNAPSHOTS);

    let candidates = filter_entity_refs_by_allowed_types(
        vec![EntityRef {
            entity_type: entity_type.to_string(),
            entity_id,
            priority: 1.0,
        }],
        None,
    );

    if candidates.is_empty() {
        anyhow::bail!("entity_type '{entity_type}' is not supported for snapshots");
    }

    let snapshots = fetch_live_snapshots(
        ctx.stdb.as_ref(),
        ctx.org_id,
        ctx.company_id,
        &candidates[..candidates.len().min(max)],
    )
    .await?;

    let citations: Vec<_> = snapshots.iter().map(live_snapshot_citation).collect();
    let summary = if snapshots.is_empty() {
        format!("No live snapshot found for {entity_type} #{entity_id}")
    } else {
        format!(
            "Fetched {} live snapshot(s) for {entity_type} #{}",
            snapshots.len(),
            entity_id
        )
    };

    Ok(ToolOutput {
        summary,
        data: json!({ "snapshots": snapshots }),
        citations,
        row_count: Some(snapshots.len() as u32),
    })
}
