//! Actor-authorized reads for the Alpha analytics workspace.

use std::{fmt, time::Duration};

use serde_json::{json, Value};

use super::types::{ToolContext, ToolOutput};
use crate::wire_decode::{row_u64, snake_to_camel};

#[derive(Debug)]
pub(crate) enum ReadError {
    Restricted,
    Unavailable,
    Incomplete,
}

impl fmt::Display for ReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Restricted => "The source is restricted for this actor",
            Self::Unavailable => "The authorized source is unavailable",
            Self::Incomplete => "The source exceeded the read limit",
        })
    }
}

impl std::error::Error for ReadError {}

/// Resource keys must come from a reviewed server-side catalog.
pub(crate) async fn read_rows(
    ctx: &ToolContext,
    resource: &str,
    limit: u32,
) -> Result<Vec<Value>, ReadError> {
    let actor = ctx.actor.as_ref().ok_or(ReadError::Restricted)?;
    let api = ctx
        .state
        .config
        .api_server_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .ok_or(ReadError::Unavailable)?;
    let mut response = ctx
        .state
        .http
        .get(format!("{}/v1/query/{resource}", api.trim_end_matches('/')))
        .bearer_auth(&actor.stdb_token)
        .header("x-stdb-identity", actor.identity_hex.as_str())
        .query(&[("companyId", ctx.company_id), ("limit", u64::from(limit))])
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|_| ReadError::Unavailable)?;
    match response.status().as_u16() {
        200 => {}
        401 | 403 => return Err(ReadError::Restricted),
        _ => return Err(ReadError::Unavailable),
    }

    const MAX_BYTES: usize = 2 * 1024 * 1024;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ReadError::Unavailable)? {
        if chunk.len() > MAX_BYTES.saturating_sub(body.len()) {
            return Err(ReadError::Incomplete);
        }
        body.extend_from_slice(&chunk);
    }
    #[derive(serde::Deserialize)]
    struct Envelope {
        data: Vec<Value>,
    }
    let rows = serde_json::from_slice::<Envelope>(&body)
        .map_err(|_| ReadError::Unavailable)?
        .data;
    if rows.len() > limit as usize {
        return Err(ReadError::Incomplete);
    }
    Ok(rows)
}

// These are representative authorized sources, not an inventory of all tables.
const COVERAGE: &[(&str, &str, &str)] = &[
    ("accounting", "account-moves", "date"),
    ("sales", "sale-orders", "date_order"),
    ("crm", "opportunities", "created_at"),
    ("purchasing", "purchase-orders", "date_order"),
    ("subscriptions", "subscriptions", "date_start"),
    ("expenses", "expenses", "date"),
    ("warehouse", "stock-pickings", ""),
    ("fleet", "fleet-vehicles", ""),
];

const SUPPORT: &[(&str, &str)] = &[
    ("reports", "Uses accounting and operational sources"),
    ("products", "Product catalog is organization-scoped"),
    ("overview", "Combines module summaries"),
    (
        "tasks",
        "Activity records lack an authoritative company field",
    ),
    ("approvals", "Use the authorized workflow queue"),
    (
        "documents",
        "Document processing reads span multiple companies",
    ),
    (
        "calendar",
        "Calendar records lack an authoritative company field",
    ),
    ("settings", "Workspace configuration"),
    ("ai-assistant", "Hosts analytics and evidence review"),
];

const SAMPLE_LIMIT: u32 = 51;

fn source_date(row: &Value, field: &str) -> Option<chrono::NaiveDate> {
    let camel = snake_to_camel(field);
    let value = row
        .get(camel.as_str())
        .or_else(|| row.get(field))?
        .as_str()?;
    chrono::NaiveDate::parse_from_str(value.get(..10)?, "%Y-%m-%d").ok()
}

fn in_scope(ctx: &ToolContext, row: &Value) -> bool {
    row_u64(row, "organizationId", "organization_id") == Some(ctx.org_id)
        && row_u64(row, "companyId", "company_id") == Some(ctx.company_id)
}

fn summarize_rows(rows: &[Value], date_field: &str) -> Value {
    let mut dates: Vec<_> = rows
        .iter()
        .filter_map(|row| source_date(row, date_field))
        .collect();
    dates.sort_unstable();
    json!({
        "status": if rows.is_empty() { "empty" } else if rows.len() >= SAMPLE_LIMIT as usize {
            "incomplete"
        } else { "available" },
        "observedRows": rows.len(),
        "sampleFirstDate": dates.first().map(ToString::to_string),
        "sampleLastDate": dates.last().map(ToString::to_string),
    })
}

pub(crate) async fn coverage(ctx: &ToolContext) -> ToolOutput {
    let mut sources = Vec::new();
    for batch in COVERAGE.chunks(3) {
        let results = futures::future::join_all(batch.iter().map(|&(module, resource, date)| async move {
            let mut result = match read_rows(ctx, resource, SAMPLE_LIMIT).await {
                Ok(rows) if rows.iter().all(|row| in_scope(ctx, row)) => summarize_rows(&rows, date),
                Ok(_) => json!({ "status": "restricted" }),
                Err(error) => json!({ "status": match error {
                    ReadError::Restricted => "restricted",
                    ReadError::Unavailable => "unavailable",
                    ReadError::Incomplete => "incomplete",
                } }),
            };
            result["module"] = json!(module);
            result["source"] = json!(resource);
            result
        })).await;
        sources.extend(results);
    }
    sources.extend(SUPPORT.iter().map(|(module, reason)| json!({
        "module": module, "status": "supporting", "reason": reason,
    })));
    ToolOutput {
        summary: "Data coverage for the active company".into(),
        row_count: Some(sources.len() as u32),
        data: json!({ "sources": sources }),
        citations: Vec::new(),
    }
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivitySource {
    Sales,
    Purchasing,
    Expenses,
    Subscriptions,
}

impl ActivitySource {
    fn key(self) -> &'static str {
        match self {
            Self::Sales => "sales",
            Self::Purchasing => "purchasing",
            Self::Expenses => "expenses",
            Self::Subscriptions => "subscriptions",
        }
    }
}

/// Compare a selected period with the preceding period of the same length.
pub(crate) async fn compare_activity(
    ctx: &ToolContext,
    source: ActivitySource,
    from: &str,
    through: &str,
) -> anyhow::Result<ToolOutput> {
    use anyhow::{ensure, Context};
    use chrono::{Days, NaiveDate};

    let parse = |text: &str| {
        ensure!(text.len() == 10, "Expected a calendar date in YYYY-MM-DD format");
        NaiveDate::parse_from_str(text, "%Y-%m-%d").context("Invalid calendar date")
    };
    let start = parse(from)?;
    let end = parse(through)?;
    let days = end.signed_duration_since(start).num_days() + 1;
    ensure!((1..=366).contains(&days), "Select a period of up to 366 days");
    let baseline_start = start
        .checked_sub_days(Days::new(days as u64))
        .context("Invalid baseline")?;
    let baseline_end = start.pred_opt().context("Invalid baseline")?;
    let &(_, resource, date_field) = COVERAGE
        .iter()
        .find(|(module, _, _)| *module == source.key())
        .context("Activity source is unavailable")?;

    const LIMIT: u32 = 501;
    let rows = read_rows(ctx, resource, LIMIT).await?;
    ensure!(rows.len() < LIMIT as usize, ReadError::Incomplete);
    ensure!(rows.iter().all(|row| in_scope(ctx, row)), ReadError::Restricted);

    let mut current = 0_i64;
    let mut baseline = 0_i64;
    for row in rows {
        let date = source_date(&row, date_field).context("Activity date is missing or restricted")?;
        if (start..=end).contains(&date) {
            current += 1;
        } else if (baseline_start..=baseline_end).contains(&date) {
            baseline += 1;
        }
    }

    Ok(ToolOutput {
        summary: "Record activity compared with the preceding period".into(),
        data: json!({
            "activity": {
                "source": resource,
                "dateField": date_field,
                "current": { "from": start.to_string(), "through": end.to_string(), "count": current },
                "baseline": { "from": baseline_start.to_string(), "through": baseline_end.to_string(), "count": baseline },
                "change": current - baseline,
            }
        }),
        citations: Vec::new(),
        row_count: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinguishes_empty_and_bounded_samples() {
        assert_eq!(summarize_rows(&[], "date")["status"], "empty");
        let rows = vec![json!({"date": "2026-10-01T00:00:00Z"}); SAMPLE_LIMIT as usize];
        let result = summarize_rows(&rows, "date");
        assert_eq!(result["status"], "incomplete");
        assert_eq!(result["sampleFirstDate"], "2026-10-01");
    }
}
