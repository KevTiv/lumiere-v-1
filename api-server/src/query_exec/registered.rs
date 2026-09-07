use super::company_scope::optional_company_accounting_resource;
use super::row_values::row_u64;
use crate::error::ApiError;
use stdb_auth::{erp_org_extra_where, select_org_scoped_sql, FieldAccessContext};

pub(super) fn select_registered_sql(
    resource: &str,
    table: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
    inventory_company_id: Option<u64>,
    purchasing_company_id: Option<u64>,
    accounting_company_id: Option<u64>,
    iot_company_id: Option<u64>,
) -> Result<String, ApiError> {
    let extra_where_raw = erp_org_extra_where(resource).unwrap_or("");
    let extra_where = if let Some(cid) = inventory_company_id {
        extra_where_raw.replace(":company_id", &cid.to_string())
    } else if let Some(cid) = purchasing_company_id {
        format!("{extra_where_raw} AND company_id = {cid}")
    } else if optional_company_accounting_resource(resource) {
        extra_where_raw.to_owned()
    } else if let Some(cid) = accounting_company_id {
        format!("{extra_where_raw} AND company_id = {cid}")
    } else if let Some(cid) = iot_company_id {
        format!("{extra_where_raw} AND company_id = {cid}")
    } else {
        extra_where_raw.to_owned()
    };
    let mut sql = select_org_scoped_sql(resource, table, organization_id, fa, &extra_where, "")
        .map_err(ApiError::Internal)?;
    if resource == "calendar-events" {
        sql = sql
            .replace(", start,", ", \"start\",")
            .replace(", stop,", ", \"stop\",");
    }
    Ok(sql)
}

fn row_u64_value(row: &serde_json::Value, camel: &str, snake: &str) -> u64 {
    row_u64(row, camel, snake)
        .ok()
        .flatten()
        .unwrap_or_default()
}

pub(super) fn sort_registered_rows(resource: &str, rows: &mut [serde_json::Value]) {
    match resource {
        "pos-loyalty-programs"
        | "sale-commissions"
        | "sale-commissions-pending"
        | "deferred-revenue-schedules" => {
            rows.sort_by_key(|row| std::cmp::Reverse(row_u64_value(row, "id", "id")));
        }
        "mrp-bom-lines" => rows.sort_by_key(|row| {
            (
                row_u64_value(row, "bomId", "bom_id"),
                row_u64_value(row, "sequence", "sequence"),
                row_u64_value(row, "id", "id"),
            )
        }),
        "mrp-routing-workcenters" => rows.sort_by_key(|row| {
            (
                row_u64_value(row, "workcenterId", "workcenter_id"),
                row_u64_value(row, "sequence", "sequence"),
                row_u64_value(row, "id", "id"),
            )
        }),
        "deferred-revenue-lines" => rows.sort_by_key(|row| {
            (
                row_u64_value(row, "scheduleId", "schedule_id"),
                row_u64_value(row, "sequence", "sequence"),
                row_u64_value(row, "id", "id"),
            )
        }),
        "revenue-recognition-rules" => rows.sort_by_key(|row| {
            (
                std::cmp::Reverse(row_u64_value(row, "priority", "priority")),
                std::cmp::Reverse(row_u64_value(row, "id", "id")),
            )
        }),
        "workflow-activities" => rows.sort_by_key(|row| {
            (
                row_u64_value(row, "workflowId", "workflow_id"),
                row_u64_value(row, "sequence", "sequence"),
                row_u64_value(row, "id", "id"),
            )
        }),
        "workflow-transitions" => rows.sort_by_key(|row| row_u64_value(row, "id", "id")),
        "workflow-workitems" => rows.sort_by_key(|row| {
            (
                row_u64_value(row, "instanceId", "instance_id"),
                row_u64_value(row, "id", "id"),
            )
        }),
        _ => {}
    }
}
