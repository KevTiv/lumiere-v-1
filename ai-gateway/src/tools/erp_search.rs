use serde_json::{json, Value};

use crate::tools::types::{SkillCitation, ToolContext, ToolOutput, ToolResult};

pub async fn execute(ctx: &ToolContext, input: &Value) -> ToolResult {
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
        .search(query_vector, ctx.company_id, None, limit, score_threshold)
        .await?;

    let org_hits = if ctx.org_id > 0 {
        ctx.rig()
            .search_org(ctx.org_id, query, limit as usize)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let citations: Vec<SkillCitation> = company_hits
        .iter()
        .map(|hit| SkillCitation {
            kind: "memory".to_string(),
            trust: "retrieved".to_string(),
            content_type: Some(hit.content_type.clone()),
            entity_id: Some(hit.content_id.to_string()),
            score: Some(hit.score),
            text_snippet: Some(hit.text_snippet.clone()),
            label: None,
            snapshot_at: None,
            url: None,
            title: None,
            fetched_at: None,
        })
        .chain(org_hits.iter().map(|hit| SkillCitation {
            kind: "activity".to_string(),
            trust: "retrieved".to_string(),
            content_type: Some(hit.entity_type.clone()),
            entity_id: Some(hit.entity_id.clone()),
            score: Some(hit.score),
            text_snippet: Some(hit.text.clone()),
            label: None,
            snapshot_at: None,
            url: None,
            title: None,
            fetched_at: None,
        }))
        .collect();

    let summary = format!(
        "Semantic search returned {} company hits and {} activity hits",
        company_hits.len(),
        org_hits.len()
    );

    Ok(ToolOutput {
        summary,
        data: json!({
            "company_hits": company_hits.iter().map(|hit| json!({
                "score": hit.score,
                "company_id": hit.company_id,
                "content_type": hit.content_type,
                "content_id": hit.content_id,
                "text_snippet": hit.text_snippet,
            })).collect::<Vec<_>>(),
            "activity_hits": org_hits,
        }),
        citations,
        row_count: Some((company_hits.len() + org_hits.len()) as u32),
    })
}
