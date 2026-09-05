use super::company_scope::optional_company_accounting_resource;
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
    let order = match resource {
        "opportunity-stages" | "activities" | "pricelist-items" => "",
        "pos-loyalty-programs" | "sale-commissions" | "sale-commissions-pending" => {
            " ORDER BY id DESC"
        }
        "landed-costs" | "landed-cost-lines" | "contact-tags" | "contact-categories"
        | "contact-segments" | "quality-alerts" | "calendar-events" => "",
        "mrp-bom-lines" => " ORDER BY bom_id ASC, sequence ASC",
        "mrp-routing-workcenters" => " ORDER BY workcenter_id ASC, sequence ASC",
        "deferred-revenue-schedules" => " ORDER BY id DESC",
        "deferred-revenue-lines" => " ORDER BY schedule_id ASC, sequence ASC",
        "revenue-recognition-rules" => " ORDER BY priority DESC, id DESC",
        "workflow-activities" => " ORDER BY workflow_id ASC, sequence ASC",
        "workflow-transitions" => " ORDER BY id ASC",
        "workflow-workitems" => " ORDER BY instance_id ASC, id ASC",
        _ => "",
    };
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
    let mut sql = select_org_scoped_sql(resource, table, organization_id, fa, &extra_where, order)
        .map_err(ApiError::Internal)?;
    if resource == "calendar-events" {
        sql = sql
            .replace(", start,", ", \"start\",")
            .replace(", stop,", ", \"stop\",");
    }
    Ok(sql)
}
