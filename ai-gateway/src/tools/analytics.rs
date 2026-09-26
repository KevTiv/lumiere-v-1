use std::collections::BTreeMap;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use crate::tools::types::{ToolContext, ToolOutput, ToolResult};

/// Named, server-owned analytics operations available to released skills.
///
/// Neither the browser nor the model supplies SQL, table names, columns, or
/// predicates. The operation set is intentionally closed for tenant safety and
/// predictable report semantics.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AnalyticsOperation {
    SalesRevenueByProduct,
    StockMovementByState,
    PurchaseOrderStateSummary,
    WorkflowStateSummary,
}

const MAX_SOURCE_ROWS: usize = 1_000;
const MAX_RESULT_ROWS: usize = 20;

impl AnalyticsOperation {
    fn key(self) -> &'static str {
        match self {
            Self::SalesRevenueByProduct => "sales_revenue_by_product",
            Self::StockMovementByState => "stock_movement_by_state",
            Self::PurchaseOrderStateSummary => "purchase_order_state_summary",
            Self::WorkflowStateSummary => "workflow_state_summary",
        }
    }

    fn sql(self, org_id: u64, company_id: u64) -> String {
        match self {
            Self::SalesRevenueByProduct => format!(
                "SELECT product_id, price_subtotal \
                 FROM sale_order_line \
                 WHERE organization_id = {org_id} AND company_id = {company_id} \
                 LIMIT {}",
                MAX_SOURCE_ROWS + 1
            ),
            Self::StockMovementByState => format!(
                "SELECT state, product_uom_qty \
                 FROM stock_move \
                 WHERE organization_id = {org_id} AND company_id = {company_id} \
                 LIMIT {}",
                MAX_SOURCE_ROWS + 1
            ),
            Self::PurchaseOrderStateSummary => format!(
                "SELECT state, amount_untaxed, amount_total \
                 FROM purchase_order \
                 WHERE organization_id = {org_id} AND company_id = {company_id} \
                 LIMIT {}",
                MAX_SOURCE_ROWS + 1
            ),
            Self::WorkflowStateSummary => format!(
                "SELECT state \
                 FROM workflow_instance \
                 WHERE organization_id = {org_id} AND company_id = {company_id} \
                 LIMIT {}",
                MAX_SOURCE_ROWS + 1
            ),
        }
    }

    fn aggregate(self, rows: Vec<Value>) -> Result<Vec<Value>> {
        if rows.len() > MAX_SOURCE_ROWS {
            bail!(
                "analytics operation '{}' exceeded its {}-row source bound",
                self.key(),
                MAX_SOURCE_ROWS
            );
        }
        match self {
            Self::SalesRevenueByProduct => aggregate_sales(rows),
            Self::StockMovementByState => aggregate_stock_moves(rows),
            Self::PurchaseOrderStateSummary => aggregate_purchase_orders(rows),
            Self::WorkflowStateSummary => aggregate_workflows(rows),
        }
    }
}

fn row_u64(row: &Value, field: &str) -> Result<u64> {
    row.get(field)
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
        .with_context(|| format!("analytics row is missing numeric field '{field}'"))
}

fn row_f64(row: &Value, field: &str) -> Result<f64> {
    row.get(field)
        .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
        .with_context(|| format!("analytics row is missing numeric field '{field}'"))
}

fn row_state(row: &Value) -> Result<String> {
    row.get("state")
        .and_then(Value::as_str)
        .filter(|state| !state.trim().is_empty())
        .map(str::to_string)
        .context("analytics row is missing state")
}

fn truncate_rows(rows: &mut Vec<Value>) {
    rows.truncate(MAX_RESULT_ROWS);
}

fn aggregate_sales(rows: Vec<Value>) -> Result<Vec<Value>> {
    let mut groups = BTreeMap::<u64, (u64, f64)>::new();
    for row in rows {
        let product_id = row_u64(&row, "productId")?;
        let entry = groups.entry(product_id).or_default();
        entry.0 += 1;
        entry.1 += row_f64(&row, "priceSubtotal")?;
    }
    let mut results = groups
        .into_iter()
        .map(|(product_id, (line_count, revenue))| {
            json!({
                "productId": product_id,
                "lineCount": line_count,
                "revenue": revenue,
            })
        })
        .collect::<Vec<_>>();
    results.sort_by(|left, right| {
        row_f64(right, "revenue")
            .unwrap_or_default()
            .total_cmp(&row_f64(left, "revenue").unwrap_or_default())
            .then_with(|| {
                row_u64(left, "productId")
                    .unwrap_or_default()
                    .cmp(&row_u64(right, "productId").unwrap_or_default())
            })
    });
    truncate_rows(&mut results);
    Ok(results)
}

fn aggregate_stock_moves(rows: Vec<Value>) -> Result<Vec<Value>> {
    let mut groups = BTreeMap::<String, (u64, f64)>::new();
    for row in rows {
        let entry = groups.entry(row_state(&row)?).or_default();
        entry.0 += 1;
        entry.1 += row_f64(&row, "productUomQty")?;
    }
    let mut results = groups
        .into_iter()
        .map(|(state, (move_count, total_qty))| {
            json!({"state": state, "moveCount": move_count, "totalQty": total_qty})
        })
        .collect::<Vec<_>>();
    results.sort_by(|left, right| {
        row_u64(right, "moveCount")
            .unwrap_or_default()
            .cmp(&row_u64(left, "moveCount").unwrap_or_default())
            .then_with(|| left["state"].as_str().cmp(&right["state"].as_str()))
    });
    truncate_rows(&mut results);
    Ok(results)
}

fn aggregate_purchase_orders(rows: Vec<Value>) -> Result<Vec<Value>> {
    let mut groups = BTreeMap::<String, (u64, f64, f64)>::new();
    for row in rows {
        let entry = groups.entry(row_state(&row)?).or_default();
        entry.0 += 1;
        entry.1 += row_f64(&row, "amountUntaxed")?;
        entry.2 += row_f64(&row, "amountTotal")?;
    }
    let mut results = groups
        .into_iter()
        .map(|(state, (order_count, amount_untaxed, amount_total))| {
            json!({
                "state": state,
                "orderCount": order_count,
                "amountUntaxed": amount_untaxed,
                "amountTotal": amount_total,
            })
        })
        .collect::<Vec<_>>();
    results.sort_by(|left, right| {
        row_u64(right, "orderCount")
            .unwrap_or_default()
            .cmp(&row_u64(left, "orderCount").unwrap_or_default())
            .then_with(|| left["state"].as_str().cmp(&right["state"].as_str()))
    });
    truncate_rows(&mut results);
    Ok(results)
}

fn aggregate_workflows(rows: Vec<Value>) -> Result<Vec<Value>> {
    let mut groups = BTreeMap::<String, u64>::new();
    for row in rows {
        *groups.entry(row_state(&row)?).or_default() += 1;
    }
    let mut results = groups
        .into_iter()
        .map(|(state, instance_count)| json!({"state": state, "instanceCount": instance_count}))
        .collect::<Vec<_>>();
    results.sort_by(|left, right| {
        row_u64(right, "instanceCount")
            .unwrap_or_default()
            .cmp(&row_u64(left, "instanceCount").unwrap_or_default())
            .then_with(|| left["state"].as_str().cmp(&right["state"].as_str()))
    });
    truncate_rows(&mut results);
    Ok(results)
}

fn operations_for_skill(skill_key: &str) -> &'static [AnalyticsOperation] {
    match skill_key {
        "report_analysis" => &[
            AnalyticsOperation::SalesRevenueByProduct,
            AnalyticsOperation::StockMovementByState,
        ],
        "process_research" => &[
            AnalyticsOperation::StockMovementByState,
            AnalyticsOperation::PurchaseOrderStateSummary,
            AnalyticsOperation::WorkflowStateSummary,
        ],
        _ => &[],
    }
}

pub async fn execute(ctx: &ToolContext, _input: &Value) -> ToolResult {
    let operations = operations_for_skill(&ctx.skill_key);
    if operations.is_empty() {
        bail!(
            "skill '{}' does not have an approved analytics operation",
            ctx.skill_key
        );
    }

    let mut artifacts = Vec::new();
    let mut row_count = 0_u32;
    for operation in operations {
        let rows = ctx
            .stdb
            .query_sql(&operation.sql(ctx.org_id, ctx.company_id))
            .await
            .with_context(|| format!("run analytics operation {}", operation.key()))?;
        let rows = operation
            .aggregate(rows)
            .with_context(|| format!("aggregate analytics operation {}", operation.key()))?;
        row_count = row_count.saturating_add(rows.len() as u32);
        artifacts.extend(rows.into_iter().map(|row| {
            json!({
                "summary": format!("approved analytics operation {}", operation.key()),
                "artifacts": {
                    "operation": operation.key(),
                    "row": row,
                },
            })
        }));
    }

    Ok(ToolOutput {
        summary: format!(
            "{} approved analytics operation(s) returned {} row(s)",
            operations.len(),
            row_count
        ),
        data: json!({ "artifacts": artifacts }),
        citations: vec![],
        row_count: Some(row_count),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_analysis_has_only_named_operations() {
        assert_eq!(
            operations_for_skill("report_analysis"),
            &[
                AnalyticsOperation::SalesRevenueByProduct,
                AnalyticsOperation::StockMovementByState,
            ]
        );
    }

    #[test]
    fn generated_queries_bind_tenant_scope() {
        let sql = AnalyticsOperation::SalesRevenueByProduct.sql(12, 34);
        assert!(sql.contains("organization_id = 12"));
        assert!(sql.contains("company_id = 34"));
        assert!(!sql.contains("GROUP BY"));
        assert!(!sql.contains("ORDER BY"));
        assert!(sql.contains(&format!("LIMIT {}", MAX_SOURCE_ROWS + 1)));
    }

    #[test]
    fn sales_rows_are_aggregated_and_ranked_in_rust() {
        let rows = AnalyticsOperation::SalesRevenueByProduct
            .aggregate(vec![
                json!({"productId": 2, "priceSubtotal": 10.0}),
                json!({"productId": 1, "priceSubtotal": 25.0}),
                json!({"productId": 2, "priceSubtotal": 20.0}),
            ])
            .unwrap();

        assert_eq!(
            rows,
            vec![
                json!({"productId": 2, "lineCount": 2, "revenue": 30.0}),
                json!({"productId": 1, "lineCount": 1, "revenue": 25.0}),
            ]
        );
    }

    #[test]
    fn source_bound_fails_closed_instead_of_returning_partial_analytics() {
        let rows = vec![json!({"state": "Draft"}); MAX_SOURCE_ROWS + 1];
        let error = AnalyticsOperation::WorkflowStateSummary
            .aggregate(rows)
            .unwrap_err();

        assert!(error
            .to_string()
            .contains("exceeded its 1000-row source bound"));
    }
}
