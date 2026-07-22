use anyhow::{bail, Context};
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
                "SELECT product_id, COUNT(*) AS line_count, SUM(price_subtotal) AS revenue \
                 FROM sale_order_line \
                 WHERE organization_id = {org_id} AND company_id = {company_id} \
                 GROUP BY product_id ORDER BY revenue DESC LIMIT 20"
            ),
            Self::StockMovementByState => format!(
                "SELECT state, COUNT(*) AS move_count, SUM(product_uom_qty) AS total_qty \
                 FROM stock_move \
                 WHERE organization_id = {org_id} AND company_id = {company_id} \
                 GROUP BY state ORDER BY move_count DESC LIMIT 20"
            ),
            Self::PurchaseOrderStateSummary => format!(
                "SELECT state, COUNT(*) AS order_count, SUM(amount_untaxed) AS amount_untaxed, \
                 SUM(amount_total) AS amount_total \
                 FROM purchase_order \
                 WHERE organization_id = {org_id} AND company_id = {company_id} \
                 GROUP BY state ORDER BY order_count DESC LIMIT 20"
            ),
            Self::WorkflowStateSummary => format!(
                "SELECT state, COUNT(*) AS instance_count \
                 FROM workflow_instance \
                 WHERE organization_id = {org_id} AND company_id = {company_id} \
                 GROUP BY state ORDER BY instance_count DESC LIMIT 20"
            ),
        }
    }
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

    let mut results = Vec::with_capacity(operations.len());
    let mut row_count = 0_u32;
    for operation in operations {
        let rows = ctx
            .stdb
            .query_sql(&operation.sql(ctx.org_id, ctx.company_id))
            .await
            .with_context(|| format!("run analytics operation {}", operation.key()))?;
        row_count = row_count.saturating_add(rows.len() as u32);
        results.push(json!({
            "operation": operation.key(),
            "rows": rows,
        }));
    }

    Ok(ToolOutput {
        summary: format!(
            "{} approved analytics operation(s) returned {} row(s)",
            results.len(),
            row_count
        ),
        data: json!({ "operations": results }),
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
    }
}
