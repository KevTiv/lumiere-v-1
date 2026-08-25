use serde_json::{json, Value};

use crate::{
    harness::{
        fetch_authorized_live_snapshots, resolve_snapshot_candidates,
        HARNESS_MAX_LIVE_SNAPSHOTS,
    },
    tools::types::{live_snapshot_citation, ToolContext, ToolOutput, ToolResult},
};

pub async fn execute(ctx: &ToolContext, input: &Value) -> ToolResult {
    let actor = ctx
        .actor
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("authenticated actor credentials are required"))?;
    let query = input
        .get("query")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("query is required"))?;

    let limit = input
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(8)
        .clamp(1, 20) as u64;

    let score_threshold = input
        .get("score_threshold")
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .or(Some(0.65));

    let query_vector = ctx.providers().embedder.embed(query).await?;

    let company_hits = ctx
        .vector_store()
        .search(
            query_vector,
            ctx.org_id,
            ctx.company_id,
            None,
            limit,
            score_threshold,
        )
        .await?;

    let org_hits = if ctx.org_id > 0 {
        ctx.rig()
            .search_scope(ctx.org_id, ctx.company_id, query, limit as usize)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let candidates = resolve_snapshot_candidates(
        None,
        &company_hits,
        &org_hits,
        HARNESS_MAX_LIVE_SNAPSHOTS,
    );
    let snapshots = fetch_authorized_live_snapshots(
        &ctx.state,
        actor,
        ctx.org_id,
        ctx.company_id,
        &candidates,
    )
    .await?;
    let citations = snapshots.iter().map(live_snapshot_citation).collect::<Vec<_>>();
    let summary = format!(
        "Semantic retrieval resolved {} scoped snapshot(s) from {} candidate(s)",
        snapshots.len(),
        candidates.len()
    );

    Ok(ToolOutput {
        summary,
        data: json!({ "snapshots": snapshots }),
        citations,
        row_count: Some(snapshots.len() as u32),
    })
}
