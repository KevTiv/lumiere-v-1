use serde_json::{json, Value};

use crate::{
    harness::{
        fetch_authorized_live_snapshots, resolve_snapshot_candidates, HARNESS_MAX_LIVE_SNAPSHOTS,
    },
    retrieval_policy::optional_retrieval,
    tools::types::{live_snapshot_citation, ToolContext, ToolOutput, ToolResult},
};

fn authorized_result_summary(snapshot_count: usize, retrieval_degraded: bool) -> String {
    format!(
        "Resolved {snapshot_count} authorized scoped snapshot(s){}",
        if retrieval_degraded {
            " (degraded)"
        } else {
            ""
        }
    )
}

fn build_authorized_output(
    snapshots: Vec<crate::harness::LiveSnapshot>,
    retrieval_degraded: bool,
) -> ToolOutput {
    let citations = snapshots
        .iter()
        .map(live_snapshot_citation)
        .collect::<Vec<_>>();
    let summary = authorized_result_summary(snapshots.len(), retrieval_degraded);
    let row_count = snapshots.len() as u32;

    ToolOutput {
        summary,
        data: json!({
            "snapshots": snapshots,
            "retrieval_degraded": retrieval_degraded
        }),
        citations,
        row_count: Some(row_count),
    }
}

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

    let mut retrieval_degraded = false;
    let company_result = match ctx.providers().embedder.embed(query).await {
        Ok(query_vector) => {
            ctx.vector_store()
                .search(
                    query_vector,
                    ctx.org_id,
                    ctx.company_id,
                    None,
                    limit,
                    score_threshold,
                )
                .await
        }
        Err(error) => Err(error),
    };
    if let Err(error) = &company_result {
        tracing::warn!(error = %error, "ERP semantic retrieval unavailable");
    }
    let company_outcome = optional_retrieval(company_result);
    retrieval_degraded |= company_outcome.degraded;
    let company_hits = company_outcome.value;

    let org_result = if ctx.org_id > 0 {
        ctx.rig()
            .search_scope(ctx.org_id, ctx.company_id, query, limit as usize)
            .await
    } else {
        Ok(Vec::new())
    };
    if let Err(error) = &org_result {
        tracing::warn!(error = %error, "ERP activity retrieval unavailable");
    }
    let org_outcome = optional_retrieval(org_result);
    retrieval_degraded |= org_outcome.degraded;
    let org_hits = org_outcome.value;

    let candidates =
        resolve_snapshot_candidates(None, &company_hits, &org_hits, HARNESS_MAX_LIVE_SNAPSHOTS);
    let snapshot_result =
        fetch_authorized_live_snapshots(&ctx.state, actor, ctx.org_id, ctx.company_id, &candidates)
            .await;
    if let Err(error) = &snapshot_result {
        tracing::warn!(error = %error, "ERP authoritative retrieval unavailable");
    }
    let snapshot_outcome = optional_retrieval(snapshot_result);
    retrieval_degraded |= snapshot_outcome.degraded;
    let snapshots = snapshot_outcome.value;
    Ok(build_authorized_output(snapshots, retrieval_degraded))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn degraded_summary_exposes_only_authorized_result_count() {
        let output = build_authorized_output(Vec::new(), true);
        assert_eq!(
            output.summary,
            "Resolved 0 authorized scoped snapshot(s) (degraded)"
        );
        assert!(!output.summary.contains("candidate"));
        assert!(!output.summary.contains("sale_order"));
        assert!(output.citations.is_empty());
        assert_eq!(output.row_count, Some(0));
        assert_eq!(output.data["retrieval_degraded"], true);
        assert_eq!(output.data["snapshots"], serde_json::json!([]));
    }
}
