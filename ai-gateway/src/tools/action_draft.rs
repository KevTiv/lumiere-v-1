use serde_json::{json, Value};

use crate::{
    ai_spend::{self, input_request_key, RequestKind, SpendReader},
    orchestrator::{output_gate::admit_generated_output, text_answer_gate::TextEvidence},
    tools::types::{ToolContext, ToolOutput, ToolResult},
};

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

    let mut warnings: Vec<String> = input
        .get("warnings")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    // The reducer draft is pending human approval, but its explanation is
    // still model-authored prose. Preserve the structured pending draft while
    // replacing unsupported prose with a deterministic notice. This tool
    // currently has no server-produced evidence channel, so every raw model
    // explanation is withheld and recorded as a warning.
    let gated = admit_generated_output(
        ctx.org_id,
        ctx.company_id,
        &summary,
        &TextEvidence::default(),
    )
    .await?;
    let explanation_verification = gated.verification.clone();
    let summary = if let Some(released) = gated.released {
        released
    } else {
        let reason = explanation_verification
            .reason
            .clone()
            .unwrap_or_else(|| "output requires review".to_string());
        warnings.push(format!(
            "action-draft explanation withheld pending review: {reason}"
        ));
        "Action draft explanation withheld pending evidence review.".to_string()
    };

    let source_query = ctx
        .inputs
        .get("query")
        .or_else(|| ctx.inputs.get("question"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let params = json!({
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
                "explanation_verification": explanation_verification,
            }))
            .unwrap_or_else(|_| "{}".to_string()),
        ),
    });

    let draft_id = if ctx.run_id > 0 {
        create_run_correlated_draft(ctx, input, params).await?
    } else {
        // Runs without a durable id keep the legacy path until they are migrated.
        ctx.stdb
            .call_reducer(stdb_client::reducer_call!(
                "create_ai_action_draft",
                json!([ctx.org_id, ctx.company_id, params]),
            ))
            .await
            .map_err(|e| anyhow::anyhow!("create_ai_action_draft failed: {e}"))?;
        lookup_latest_draft_id(&ctx.stdb, ctx.org_id, ctx.company_id, &reducer_name)
            .await
            .unwrap_or(0)
    };

    Ok(ToolOutput {
        summary: format!("Created action draft for {reducer_name}"),
        data: json!({
            "draft_id": draft_id,
            "reducer_name": reducer_name,
            "summary": summary,
            "confidence": confidence,
            "elevated": elevated,
            "warnings": warnings,
            "explanation_verification": explanation_verification,
        }),
        citations: vec![],
        row_count: Some(1),
    })
}

/// Create the draft bound to the durable run and an input-derived request key,
/// then resolve its exact id through the private request mapping. A replay of
/// the same invocation returns the same draft instead of creating another.
async fn create_run_correlated_draft(
    ctx: &ToolContext,
    input: &Value,
    params: Value,
) -> anyhow::Result<u64> {
    // Check the read path first so a draft is never created without a way to
    // resolve its exact id.
    let reader_client = ctx.state.spend_read_stdb.as_ref().ok_or_else(|| {
        anyhow::anyhow!("AI_SPEND_READ_STDB_TOKEN is required for run-correlated action drafts")
    })?;
    let request_key = input_request_key(RequestKind::Draft, ctx.run_id, input)?;
    ai_spend::create_run_action_draft(
        &ctx.stdb,
        ctx.org_id,
        ctx.company_id,
        ctx.run_id,
        &request_key,
        params,
    )
    .await?;
    let request = SpendReader::new(reader_client)
        .draft_request(ctx.org_id, ctx.company_id, ctx.run_id, &request_key)
        .await?
        .ok_or_else(|| anyhow::anyhow!("created draft is not visible for {request_key}"))?;
    Ok(request.draft_id)
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
