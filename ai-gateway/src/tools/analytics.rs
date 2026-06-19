use serde_json::{json, Value};

use crate::{
    sandbox::SandboxSession,
    tools::types::{ToolContext, ToolOutput, ToolResult},
};

fn with_sandbox<F, T>(ctx: &ToolContext, f: F) -> anyhow::Result<T>
where
    F: FnOnce(&SandboxSession) -> anyhow::Result<T>,
{
    let sandbox = ctx
        .sandbox
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("analytics sandbox is not initialized for this run"))?;
    let guard = sandbox
        .lock()
        .map_err(|e| anyhow::anyhow!("sandbox lock poisoned: {e}"))?;
    f(&guard)
}

pub async fn execute(ctx: &ToolContext, _input: &Value) -> ToolResult {
    let datasets = with_sandbox(ctx, |sandbox| {
        Ok(sandbox
            .list_datasets()
            .iter()
            .map(|d| {
                json!({
                    "key": d.key,
                    "table_name": d.table_name,
                    "row_count": d.row_count,
                    "columns": d.columns,
                })
            })
            .collect::<Vec<_>>())
    })?;

    Ok(ToolOutput {
        summary: format!("{} dataset(s) available in sandbox", datasets.len()),
        data: json!({ "datasets": datasets }),
        citations: vec![],
        row_count: Some(datasets.len() as u32),
    })
}

pub async fn execute_describe(ctx: &ToolContext, input: &Value) -> ToolResult {
    let key = input
        .get("dataset")
        .or_else(|| input.get("key"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("dataset key is required"))?
        .to_string();

    let info = with_sandbox(ctx, |sandbox| sandbox.describe_dataset(&key))?;
    Ok(ToolOutput {
        summary: format!(
            "Dataset '{}' table {} has {} rows and {} columns",
            info.key,
            info.table_name,
            info.row_count,
            info.columns.len()
        ),
        data: json!({
            "key": info.key,
            "table_name": info.table_name,
            "row_count": info.row_count,
            "columns": info.columns,
        }),
        citations: vec![],
        row_count: Some(info.row_count),
    })
}

pub async fn execute_query(ctx: &ToolContext, input: &Value) -> ToolResult {
    let sql = input
        .get("sql")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("sql is required"))?
        .to_string();

    let max_rows = input
        .get("max_rows")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .or_else(|| {
            ctx.config_json
                .get("max_output_rows")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize)
        });

    let result = with_sandbox(ctx, |sandbox| sandbox.run_query(&sql, max_rows))?;
    Ok(ToolOutput {
        summary: format!(
            "Query returned {} row(s){}",
            result.row_count,
            if result.truncated { " (truncated)" } else { "" }
        ),
        data: json!({
            "sql": sql,
            "columns": result.columns,
            "rows": result.rows,
            "truncated": result.truncated,
        }),
        citations: vec![],
        row_count: Some(result.row_count),
    })
}
