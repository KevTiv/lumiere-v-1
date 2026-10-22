use super::company_scope::optional_company_accounting_resource;
use super::row_values::row_u64;
use crate::error::ApiError;
use stdb_auth::{erp_org_extra_where, select_org_scoped_sql, FieldAccessContext};

/// Resources whose generated table binds `company_id` as `Option<u64>`.
///
/// SpacetimeDB HTTP SQL cannot compare an option-encoded column with a scalar
/// literal. These resources are therefore organization-scoped in SQL and
/// filtered by the caller's fail-closed Rust post-filter.
fn nullable_company_id_resource(resource: &str) -> bool {
    matches!(
        resource,
        "account-account-types"
            | "depreciation-lines"
            | "partner-banks"
            | "product-categories"
            | "stock-locations"
            | "stock-routes"
            | "stock-rules"
            | "tax-deadlines"
    )
}

fn without_nullable_company_predicate(resource: &str, extra_where: &str) -> String {
    if nullable_company_id_resource(resource) {
        extra_where.replace(" AND company_id = :company_id", "")
    } else {
        extra_where.to_owned()
    }
}

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
    let extra_where = if nullable_company_id_resource(resource) {
        without_nullable_company_predicate(resource, extra_where_raw)
    } else if let Some(cid) = inventory_company_id {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nullable_company_resources_never_compare_option_columns_to_scalars() {
        let cases = [
            (
                "account-account-types",
                "account_account_type",
                None,
                None,
                Some(198),
                None,
            ),
            (
                "depreciation-lines",
                "account_asset_depreciation_line",
                None,
                None,
                Some(198),
                None,
            ),
            (
                "partner-banks",
                "res_partner_bank",
                None,
                Some(198),
                None,
                None,
            ),
            (
                "product-categories",
                "product_category",
                Some(198),
                None,
                None,
                None,
            ),
            (
                "stock-locations",
                "stock_location",
                Some(198),
                None,
                None,
                None,
            ),
            ("stock-routes", "stock_route", Some(198), None, None, None),
            ("stock-rules", "stock_rule", Some(198), None, None, None),
            ("tax-deadlines", "tax_deadline", None, None, Some(198), None),
        ];

        for (resource, table, inventory, purchasing, accounting, iot) in cases {
            let sql = select_registered_sql(
                resource, table, 42, None, inventory, purchasing, accounting, iot,
            )
            .expect("registered SQL");
            assert!(
                !sql.contains("company_id = 198"),
                "{resource} emitted an Option<u64> scalar predicate: {sql}"
            );
            assert!(
                !sql.contains(":company_id"),
                "{resource} left a placeholder: {sql}"
            );
            assert!(sql.contains("organization_id = 42"));
        }
    }

    #[test]
    fn required_company_resources_keep_sql_company_scope() {
        let sql = select_registered_sql(
            "account-accounts",
            "account_account",
            42,
            None,
            None,
            None,
            Some(198),
            None,
        )
        .expect("registered SQL");
        assert!(sql.contains("organization_id = 42"));
        assert!(sql.contains("company_id = 198"));
    }
}
