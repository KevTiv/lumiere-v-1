//! Scoped worklists query handlers.

use super::row_values::row_enum_tag_is;
use super::row_values::row_u64;
use crate::error::ApiError;
use serde_json::Value;
use stdb_auth::registry_get;
use stdb_auth::select_org_scoped_sql;
use stdb_auth::FieldAccessContext;
use stdb_client::StdbClient;

pub(super) async fn read_timesheets_to_validate(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let reg = registry_get(resource)
        .ok_or_else(|| ApiError::NotFound(format!("Unknown resource: \"{resource}\"")))?;
    let extra_where = if resource == "timesheets-to-validate" {
        " AND validation_status = 'draft'"
    } else {
        " AND validation_status = 'validated' AND timesheet_invoice_type = 'billable'"
    };
    let sql = select_org_scoped_sql(resource, &reg.table, organization_id, fa, extra_where, "")
        .map_err(ApiError::Internal)?;
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    rows.retain(|row| {
        row_u64(row, "timesheetInvoiceId", "timesheet_invoice_id")
            .ok()
            .flatten()
            .is_none()
    });
    return Ok(rows);
}

pub(super) async fn read_sale_orders_to_approve(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    let registry = registry_get(resource)
        .ok_or_else(|| ApiError::NotFound(format!("Unknown resource: \"{resource}\"")))?;
    let extra_where = if resource == "expenses-missing-receipt" {
        " AND has_receipt = false"
    } else {
        ""
    };
    let sql = select_org_scoped_sql(
        resource,
        &registry.table,
        organization_id,
        fa,
        extra_where,
        "",
    )
    .map_err(ApiError::Internal)?;
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    let expected: &[&str] = match resource {
        "sale-orders-to-approve" => &["ToApprove"],
        "leaves-to-approve" => &["Confirm", "ValidatedOne"],
        "payslips-to-export" => &["Verify"],
        "expense-sheets-to-approve" => &["Submitted"],
        "expenses-missing-receipt" => &["Draft"],
        "expense-policy-exceptions" => &["Pending"],
        _ => unreachable!(),
    };
    rows.retain(|row| row_enum_tag_is(row, "state", expected));
    return Ok(rows);
}
