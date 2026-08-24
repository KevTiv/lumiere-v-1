use serde_json::{json, Value};

use crate::tools::types::{ToolContext, ToolOutput, ToolResult};

pub async fn execute(ctx: &ToolContext, input: &Value) -> ToolResult {
    let reducer_name = input
        .get("reducer_name")
        .or_else(|| input.get("reducer"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("reducer_name is required"))?
        .to_string();

    if !ctx
        .allowed_action_drafts
        .iter()
        .any(|name| name == &reducer_name)
    {
        anyhow::bail!("reducer '{reducer_name}' is not allowed for this skill");
    }

    let params_json = input
        .get("params_json")
        .or_else(|| input.get("params"))
        .map(|v| {
            if v.is_string() {
                v.as_str().unwrap_or("{}").to_string()
            } else {
                serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string())
            }
        })
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("params_json is required"))?;

    let summary = input
        .get("summary")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Proposed ERP action draft")
        .to_string();

    let confidence = input
        .get("confidence")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.75) as f64;

    let elevated = input
        .get("elevated")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let warnings: Vec<String> = input
        .get("warnings")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let source_query = ctx
        .inputs
        .get("query")
        .or_else(|| ctx.inputs.get("question"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    ctx.stdb
        .call_reducer(stdb_client::reducer_call!(
            "create_ai_action_draft",
            json!([
                ctx.org_id,
                ctx.company_id,
                {
                    "reducer_name": reducer_name,
                    "params_json": params_json,
                    "summary": summary,
                    "confidence": confidence,
                    "elevated": elevated,
                    "warnings_json": if warnings.is_empty() {
                        None
                    } else {
                        Some(serde_json::to_string(&warnings).unwrap_or_else(|_| "[]".to_string()))
                    },
                    "source_query": source_query,
                    "ui_context_json": serde_json::to_string(&json!({
                        "module": "ai_skills",
                        "skill_key": ctx.skill_key,
                        "run_id": ctx.run_id,
                    })).ok(),
                    "expires_at": Value::Null,
                    "metadata": Some(
                        serde_json::to_string(&json!({
                            "run_id": ctx.run_id,
                            "skill_key": ctx.skill_key,
                        }))
                        .unwrap_or_else(|_| "{}".to_string()),
                    ),
                }
            ]),
        ))
        .await
        .map_err(|e| anyhow::anyhow!("create_ai_action_draft failed: {e}"))?;

    let draft_id = lookup_latest_draft_id(&ctx.stdb, ctx.org_id, ctx.company_id, &reducer_name)
        .await
        .unwrap_or(0);

    Ok(ToolOutput {
        summary: format!("Created action draft for {reducer_name}"),
        data: json!({
            "draft_id": draft_id,
            "reducer_name": reducer_name,
            "summary": summary,
            "confidence": confidence,
            "elevated": elevated,
            "warnings": warnings,
        }),
        citations: vec![],
        row_count: Some(1),
    })
}

async fn lookup_latest_draft_id(
    stdb: &stdb_client::StdbClient,
    org_id: u64,
    company_id: u64,
    reducer_name: &str,
) -> anyhow::Result<u64> {
    let escaped = reducer_name.replace('\'', "''");
    let sql = format!(
        "SELECT id FROM ai_action_draft \
         WHERE organization_id = {org_id} AND company_id = {company_id} \
         AND reducer_name = '{escaped}' ORDER BY id DESC LIMIT 1"
    );
    let rows = stdb.query_sql(&sql).await?;
    Ok(rows
        .first()
        .and_then(|row| row.get("id").and_then(|v| v.as_u64()))
        .unwrap_or(0))
}
