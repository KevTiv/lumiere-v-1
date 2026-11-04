//! Actor-authorized summaries of bounded operational queues.

use std::collections::BTreeMap;

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    alpha_data::read_rows,
    types::{ToolContext, ToolOutput, ToolResult},
};
use crate::wire_decode::row_u64;

const ROW_LIMIT: u32 = 100;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Queue {
    CrmOpportunities,
    WarehouseTransfers,
    FleetInspections,
    WorkflowInstances,
    ApprovalInbox,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    queue: Queue,
}

impl Queue {
    fn resource(self) -> &'static str {
        match self {
            Self::CrmOpportunities => "opportunities",
            Self::WarehouseTransfers => "stock-pickings",
            Self::FleetInspections => "fleet-inspections",
            Self::WorkflowInstances => "workflow-instances",
            Self::ApprovalInbox => "workflow-human-tasks-inbox",
        }
    }

    fn classify(self, row: &Value) -> Result<&'static str> {
        let bucket = match self {
            Self::CrmOpportunities => {
                let won = required_bool(row, "isWon", "is_won")?;
                let lost = required_bool(row, "isLost", "is_lost")?;
                match (won, lost) {
                    (false, false) => "open",
                    (true, false) => "won",
                    (false, true) => "lost",
                    (true, true) => "conflicting_outcome",
                }
            }
            Self::WarehouseTransfers => match status(row, "state")?.as_str() {
                "draft" => "draft",
                "confirmed" | "waiting" | "partially_available" => "waiting",
                "assigned" | "ready" => "ready",
                "done" | "received" => "completed",
                "cancel" | "cancelled" => "cancelled",
                _ => "unclassified",
            },
            Self::FleetInspections => match status(row, "outcome")?.as_str() {
                "passed" => "passed",
                "failed" => "failed",
                "attentionrequired" | "attention_required" => "attention_required",
                _ => "unclassified",
            },
            Self::WorkflowInstances => match status(row, "state")?.as_str() {
                "active" => "active",
                "completed" => "completed",
                "cancelled" => "cancelled",
                "failed" => "failed",
                _ => "unclassified",
            },
            Self::ApprovalInbox => "awaiting_review",
        };
        Ok(bucket)
    }
}

fn required_bool(row: &Value, camel: &str, snake: &str) -> Result<bool> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_bool)
        .context("queue outcome fields are unavailable")
}

fn status(row: &Value, field: &str) -> Result<String> {
    let value = row.get(field).context("queue state field is unavailable")?;
    let label = value.as_str().or_else(|| {
        let object = value.as_object()?;
        if let Some(tag) = object.get("tag") {
            return tag.as_str();
        }
        if object.len() == 1 {
            return object.keys().next().map(String::as_str);
        }
        None
    });
    label
        .filter(|label| !label.is_empty())
        .map(str::to_ascii_lowercase)
        .context("queue state field could not be decoded")
}

fn summarize(queue: Queue, rows: &[Value], org: u64, company: u64) -> Result<Value> {
    if rows.len() > ROW_LIMIT as usize {
        bail!("operational queue exceeded its requested row bound");
    }

    let mut counts = BTreeMap::<&str, usize>::new();
    for row in rows {
        if row_u64(row, "organizationId", "organization_id") != Some(org)
            || row_u64(row, "companyId", "company_id") != Some(company)
        {
            bail!("operational queue returned a row outside the requested company scope");
        }
        *counts.entry(queue.classify(row)?).or_default() += 1;
    }

    Ok(json!({
        "resource": queue.resource(),
        "rowsObserved": rows.len(),
        "rowLimit": ROW_LIMIT,
        "atRowLimit": rows.len() == ROW_LIMIT as usize,
        "counts": counts
    }))
}

pub(crate) async fn execute(ctx: &ToolContext, input: &Value) -> ToolResult {
    let request: Input =
        serde_json::from_value(input.clone()).context("invalid operational queue input")?;
    let rows = read_rows(ctx, request.queue.resource(), ROW_LIMIT).await?;
    let data = summarize(request.queue, &rows, ctx.org_id, ctx.company_id)?;
    Ok(ToolOutput {
        summary: format!(
            "Observed {} rows in the authorized operational queue",
            rows.len()
        ),
        data,
        citations: vec![],
        row_count: Some(rows.len() as u32),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_known_inspection_outcomes_without_exposing_row_data() {
        let rows = [
            json!({"organizationId":7,"companyId":11,"outcome":{"AttentionRequired":[]},"notes":"private"}),
            json!({"organizationId":7,"companyId":11,"outcome":{"tag":"Failed"}}),
            json!({"organizationId":7,"companyId":11,"outcome":"future_state"}),
        ];
        let result = summarize(Queue::FleetInspections, &rows, 7, 11).unwrap();
        assert_eq!(
            result["counts"],
            json!({"attention_required":1,"failed":1,"unclassified":1})
        );
        assert!(!result.to_string().contains("private"));
        assert!(!result.to_string().contains("future_state"));
    }

    #[test]
    fn refuses_foreign_and_unscoped_records() {
        for row in [
            json!({"organizationId":8,"companyId":11}),
            json!({"organizationId":7,"companyId":12}),
            json!({"organizationId":7}),
        ] {
            assert!(summarize(Queue::ApprovalInbox, &[row], 7, 11).is_err());
        }
    }

    #[test]
    fn missing_outcome_cannot_be_reported_as_open() {
        let row = json!({"organizationId":7,"companyId":11,"isWon":false});
        assert!(summarize(Queue::CrmOpportunities, &[row], 7, 11).is_err());
    }

    #[test]
    fn labels_the_row_bound_instead_of_implying_a_complete_queue() {
        let row = json!({"organizationId":7,"companyId":11});
        let result =
            summarize(Queue::ApprovalInbox, &vec![row; ROW_LIMIT as usize], 7, 11).unwrap();
        assert_eq!(result["atRowLimit"], true);
        assert_eq!(result["counts"]["awaiting_review"], ROW_LIMIT);
    }
}
