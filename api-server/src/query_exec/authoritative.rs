//! Actor-authorized single-record reads and bounded child projections.

use super::row_values::{filter_and_strip_soft_deleted, row_company_matches, row_u64};
use crate::error::ApiError;
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap};
use stdb_auth::{
    has_resource_field_projection_permission, has_resource_field_read_permission,
    has_resource_read_permission, registry_get, resolve_http_sql_columns, resource_read_denied,
    FieldAccessContext,
};
use stdb_client::StdbClient;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AuthoritativeResourceScope {
    Organization,
    OrganizationAndCompany,
    OrganizationOptionalCompany,
    OrganizationAndExactOptionalCompany,
}

pub(crate) fn authoritative_resource_scope(resource: &str) -> Option<AuthoritativeResourceScope> {
    match resource {
        "products" | "leads" | "calendar-events" => Some(AuthoritativeResourceScope::Organization),
        "contacts" => Some(AuthoritativeResourceScope::OrganizationOptionalCompany),
        "opportunities" | "stock-locations" => {
            Some(AuthoritativeResourceScope::OrganizationAndExactOptionalCompany)
        }
        "sale-orders"
        | "purchase-orders"
        | "tasks"
        | "account-moves"
        | "account-move-lines"
        | "account-payments"
        | "account-accounts"
        | "expense-sheets"
        | "expenses"
        | "mrp-productions"
        | "subscriptions"
        | "subscription-lines"
        | "stock-pickings"
        | "stock-moves"
        | "stock-move-lines"
        | "stock-cycle-counts"
        | "stock-quants"
        | "fleet-vehicles"
        | "fleet-inspections"
        | "fleet-service-records" => Some(AuthoritativeResourceScope::OrganizationAndCompany),
        _ => None,
    }
}

fn soft_deletable(resource: &str) -> bool {
    matches!(resource, "contacts" | "leads" | "opportunities")
}

fn authoritative_columns(
    resource: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<String>, ApiError> {
    let mut columns =
        resolve_http_sql_columns(resource, field_access).map_err(ApiError::Internal)?;
    // These native detail fields are absent from their default list projection.
    let detail_fields: &[&str] = match resource {
        "sale-orders" => &["pricelist_id"],
        "stock-pickings" => &["scheduled_date", "date_done"],
        "stock-cycle-counts" => &["last_count_date", "next_count_date"],
        "stock-moves" | "stock-quants" => &["product_variant_id"],
        "subscription-lines" => &["currency_id"],
        _ => &[],
    };
    for &field in detail_fields {
        if has_resource_field_read_permission(field_access, resource, field)
            && !columns.iter().any(|column| column == field)
        {
            columns.push(field.into());
        }
    }
    Ok(columns)
}

pub(crate) fn authoritative_record_sql(
    resource: &str,
    organization_id: u64,
    company_id: u64,
    record_id: u64,
    field_access: Option<&FieldAccessContext>,
) -> Result<(String, AuthoritativeResourceScope), ApiError> {
    if record_id == 0 || organization_id == 0 || company_id == 0 {
        return Err(ApiError::Unprocessable(
            "organization, company, and record IDs must be positive".into(),
        ));
    }
    if field_access.is_none_or(|access| access.organization_id != organization_id) {
        return Err(ApiError::NotFound(
            "Authoritative resource not found".into(),
        ));
    }
    if !has_resource_read_permission(field_access, resource) {
        return Err(ApiError::NotFound(
            "Authoritative resource not found".into(),
        ));
    }
    let scope = authoritative_resource_scope(resource)
        .ok_or_else(|| ApiError::NotFound("Authoritative resource not found".into()))?;
    let registry = registry_get(resource)
        .ok_or_else(|| ApiError::NotFound("Authoritative resource not found".into()))?;
    let mut columns = authoritative_columns(resource, field_access)?;
    if soft_deletable(resource) && !columns.iter().any(|column| column == "deleted_at") {
        // This internal deletion marker is removed before the row leaves the owner.
        columns.push("deleted_at".into());
    }
    if resource == "calendar-events" {
        if ["id", "organization_id", "privacy"]
            .iter()
            .any(|field| !columns.iter().any(|column| column == field))
        {
            return Err(ApiError::NotFound(
                "Authoritative resource not found".into(),
            ));
        }
        columns.retain(|column| {
            matches!(
                column.as_str(),
                "id" | "organization_id"
                    | "name"
                    | "start"
                    | "stop"
                    | "allday"
                    | "location"
                    | "state"
                    | "privacy"
            )
        });
        for column in &mut columns {
            if matches!(column.as_str(), "start" | "stop") {
                *column = format!("\"{column}\"");
            }
        }
    }
    let mut sql = format!(
        "SELECT {} FROM {} WHERE organization_id = {organization_id}",
        columns.join(", "),
        registry.table,
    );
    if scope == AuthoritativeResourceScope::OrganizationAndCompany {
        sql.push_str(&format!(" AND company_id = {company_id}"));
    }
    sql.push_str(&format!(" AND id = {record_id}"));
    if resource == "calendar-events" {
        sql.push_str(" AND privacy = 'public'");
    }
    Ok((sql, scope))
}

fn record_matches_scope(
    row: &Value,
    organization_id: u64,
    company_id: u64,
    record_id: u64,
    scope: AuthoritativeResourceScope,
) -> bool {
    row_u64(row, "id", "id") == Ok(Some(record_id))
        && row_u64(row, "organizationId", "organization_id") == Ok(Some(organization_id))
        && match scope {
            AuthoritativeResourceScope::Organization => true,
            AuthoritativeResourceScope::OrganizationOptionalCompany => {
                row_company_matches(row, company_id, true)
            }
            AuthoritativeResourceScope::OrganizationAndCompany
            | AuthoritativeResourceScope::OrganizationAndExactOptionalCompany => {
                row_company_matches(row, company_id, false)
            }
        }
}

pub async fn execute_authorized_resource_record(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    company_id: u64,
    record_id: u64,
    field_access: Option<&FieldAccessContext>,
) -> Result<Option<Value>, ApiError> {
    let (sql, scope) = authoritative_record_sql(
        resource,
        organization_id,
        company_id,
        record_id,
        field_access,
    )?;
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;

    rows.retain(|row| {
        record_matches_scope(row, organization_id, company_id, record_id, scope)
            && (resource != "calendar-events"
                || row.get("privacy").and_then(Value::as_str) == Some("public"))
    });
    if soft_deletable(resource) {
        filter_and_strip_soft_deleted(&mut rows);
    }
    Ok(rows.into_iter().next())
}

const RELATION_LIMIT: usize = 20;
const RELATION_BYTE_LIMIT: usize = 256 * 1024;

async fn bounded_rows(
    client: &StdbClient,
    sql: &str,
    max_rows: usize,
) -> anyhow::Result<Vec<Value>> {
    client
        .with_query_limits(max_rows, RELATION_BYTE_LIMIT)?
        .query_sql(sql)
        .await
}

struct Relation {
    key: &'static str,
    resource: &'static str,
    foreign_key: &'static str,
    foreign_key_camel: &'static str,
}

const fn relation(
    key: &'static str,
    resource: &'static str,
    foreign_key: &'static str,
    foreign_key_camel: &'static str,
) -> Relation {
    Relation {
        key,
        resource,
        foreign_key,
        foreign_key_camel,
    }
}

const COUNT_SHEET: &str = "stock_count_sheet";
const COUNT_SHEET_FIELDS: &[&str] = &[
    "id",
    "organization_id",
    "cycle_count_id",
    "product_id",
    "location_id",
    "lot_id",
    "expected_qty",
    "counted_qty",
    "uom_id",
    "variance",
    "variance_value",
    "is_processed",
    "counted_at",
];

fn related_resources(parent: &str) -> &'static [Relation] {
    match parent {
        "sale-orders" => const { &[relation("lines", "sale-order-lines", "order_id", "orderId")] },
        "purchase-orders" => {
            const {
                &[relation(
                    "lines",
                    "purchase-order-lines",
                    "order_id",
                    "orderId",
                )]
            }
        }
        "account-moves" => {
            const { &[relation("lines", "account-move-lines", "move_id", "moveId")] }
        }
        "account-payments" => {
            const {
                &[relation(
                    "allocations",
                    "payment-reconciliations",
                    "account_payment_id",
                    "accountPaymentId",
                )]
            }
        }
        "subscriptions" => {
            const {
                &[relation(
                    "lines",
                    "subscription-lines",
                    "subscription_id",
                    "subscriptionId",
                )]
            }
        }
        "opportunities" => {
            const {
                &[relation(
                    "lines",
                    "opportunity-lines",
                    "opportunity_id",
                    "opportunityId",
                )]
            }
        }
        "stock-pickings" => {
            const { &[relation("moves", "stock-moves", "picking_id", "pickingId")] }
        }
        "stock-cycle-counts" => {
            const {
                &[relation(
                    "lines",
                    COUNT_SHEET,
                    "cycle_count_id",
                    "cycleCountId",
                )]
            }
        }
        "stock-locations" => {
            const {
                &[relation(
                    "quants",
                    "stock-quants",
                    "location_id",
                    "locationId",
                )]
            }
        }
        "fleet-vehicles" => {
            const {
                &[
                    relation(
                        "inspections",
                        "fleet-inspections",
                        "vehicle_id",
                        "vehicleId",
                    ),
                    relation(
                        "service_records",
                        "fleet-service-records",
                        "vehicle_id",
                        "vehicleId",
                    ),
                ]
            }
        }
        _ => &[],
    }
}

fn relation_sql(
    relation: &Relation,
    organization_id: u64,
    company_id: u64,
    parent_id: u64,
    access: &FieldAccessContext,
) -> Result<Option<String>, ApiError> {
    let resource = relation.resource;
    if !has_resource_read_permission(Some(access), resource) {
        return Ok(None);
    }
    let (table, columns, company_filter) = if resource == COUNT_SHEET {
        // Count-sheet rows inherit company from the exact, authorized count. A
        // direct count-sheet read cannot establish this scope on its own.
        let columns = COUNT_SHEET_FIELDS
            .iter()
            .copied()
            .filter(|field| has_resource_field_read_permission(Some(access), resource, field))
            .map(str::to_owned)
            .collect::<Vec<_>>();
        (COUNT_SHEET, columns, String::new())
    } else {
        let entry = registry_get(resource)
            .ok_or_else(|| ApiError::Internal("unknown authoritative relation resource".into()))?;
        let columns = authoritative_columns(resource, Some(access))?;
        (
            entry.table.as_str(),
            columns,
            format!(" AND company_id = {company_id}"),
        )
    };
    if !["id", "organization_id", relation.foreign_key]
        .iter()
        .all(|required| columns.iter().any(|column| column.as_str() == *required))
    {
        return Ok(None);
    }
    // A SpacetimeDB Optional<u64> column does not compare to a scalar ID.
    // Stock moves maintain an indexed, required copy that we can filter on.
    let predicate_column = if resource == "stock-moves" {
        "picking_key"
    } else {
        relation.foreign_key
    };
    Ok(Some(format!(
        "SELECT {} FROM {table} WHERE organization_id = {organization_id}{company_filter} AND {predicate_column} = {parent_id} LIMIT {}",
        columns.join(", "), RELATION_LIMIT + 1,
    )))
}

fn verified_relation_rows(
    rows: Vec<Value>,
    relation: &Relation,
    organization_id: u64,
    company_id: u64,
    parent_id: u64,
) -> Option<Vec<Value>> {
    (rows.len() <= RELATION_LIMIT
        && rows.iter().all(|row| {
            row_u64(row, "id", "id").is_ok_and(|id| id.is_some_and(|id| id > 0))
                && row_u64(row, "organizationId", "organization_id") == Ok(Some(organization_id))
                && row_u64(row, relation.foreign_key_camel, relation.foreign_key)
                    == Ok(Some(parent_id))
                && (relation.resource == COUNT_SHEET || row_company_matches(row, company_id, false))
        }))
    .then_some(rows)
}

/// Load child rows for an already authorized parent. Missing grants, incomplete
/// reads, and scope mismatches omit the relation instead of reporting it empty.
pub(crate) async fn execute_authorized_resource_relations(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    company_id: u64,
    parent_id: u64,
    parent: &Value,
    access: &FieldAccessContext,
) -> Map<String, Value> {
    let mut relations = Map::new();
    if access.organization_id != organization_id
        || !has_resource_read_permission(Some(access), resource)
        || !authoritative_resource_scope(resource).is_some_and(|scope| {
            record_matches_scope(parent, organization_id, company_id, parent_id, scope)
        })
    {
        return relations;
    }
    for relation in related_resources(resource) {
        let sql = match relation_sql(relation, organization_id, company_id, parent_id, access) {
            Ok(Some(sql)) => sql,
            Ok(None) => continue,
            Err(error) => {
                tracing::warn!(resource, relation = relation.key, %error, "Authoritative relation projection unavailable");
                continue;
            }
        };
        let rows = match bounded_rows(client, &sql, RELATION_LIMIT + 1).await {
            Ok(rows) => rows,
            Err(error) => {
                tracing::warn!(resource, relation = relation.key, %error, "Authoritative relation query unavailable");
                continue;
            }
        };
        let Some(mut rows) =
            verified_relation_rows(rows, relation, organization_id, company_id, parent_id)
        else {
            continue;
        };
        if relation.resource == "account-move-lines" {
            enrich_account_labels(client, organization_id, company_id, access, &mut rows).await;
        }
        relations.insert(relation.key.into(), Value::Array(rows));
    }
    relations
}

async fn enrich_account_labels(
    client: &StdbClient,
    organization_id: u64,
    company_id: u64,
    access: &FieldAccessContext,
    lines: &mut [Value],
) {
    let account_id = |row: &Value| row_u64(row, "accountId", "account_id").ok().flatten();
    let ids: BTreeSet<_> = lines
        .iter()
        .filter_map(account_id)
        .filter(|id| *id > 0)
        .collect();
    if ids.is_empty() || !has_resource_read_permission(Some(access), "account-accounts") {
        return;
    }
    let columns = ["code", "name"]
        .into_iter()
        .filter(|column| {
            has_resource_field_read_permission(Some(access), "account-accounts", column)
        })
        .collect::<Vec<_>>();
    if columns.is_empty() {
        return;
    }
    let id_filter = ids
        .iter()
        .map(|id| format!("id = {id}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!(
        "SELECT id, organization_id, company_id, {} FROM account_account WHERE organization_id = {organization_id} AND company_id = {company_id} AND ({id_filter})",
        columns.join(", "),
    );
    let accounts = match bounded_rows(client, &sql, ids.len()).await {
        Ok(accounts) => accounts,
        Err(error) => {
            tracing::warn!(%error, "Authoritative journal account labels unavailable");
            return;
        }
    };
    let accounts: HashMap<_, _> = accounts
        .into_iter()
        .filter_map(|row| {
            let id = row_u64(&row, "id", "id").ok().flatten()?;
            (ids.contains(&id)
                && record_matches_scope(
                    &row,
                    organization_id,
                    company_id,
                    id,
                    AuthoritativeResourceScope::OrganizationAndCompany,
                ))
            .then_some((id, row))
        })
        .collect();
    for line in lines {
        let Some(account) = account_id(line).and_then(|id| accounts.get(&id)) else {
            continue;
        };
        let Some(fields) = line.as_object_mut() else {
            continue;
        };
        for (field, target) in [("code", "account_code"), ("name", "account_name")] {
            if columns.contains(&field) {
                if let Some(value) = account.get(field).filter(|value| value.is_string()) {
                    fields.insert(target.into(), value.clone());
                }
            }
        }
    }
}

const CURRENCY_FIELDS: [(&str, &str, &str); 2] = [
    ("currencyId", "currency_id", "currency_code"),
    (
        "companyCurrencyId",
        "company_currency_id",
        "company_currency_code",
    ),
];

fn currency_ids(row: &Value) -> impl Iterator<Item = (u64, &'static str)> + '_ {
    CURRENCY_FIELDS
        .into_iter()
        .filter_map(|(camel, snake, code)| {
            row_u64(row, camel, snake)
                .ok()
                .flatten()
                .filter(|id| *id > 0)
                .map(|id| (id, code))
        })
}

/// Bind visible currency IDs to the authenticated tenant's reference codes.
pub(crate) async fn enrich_authoritative_currency(
    client: &StdbClient,
    organization_id: u64,
    parent: &mut Value,
    relations: &mut Map<String, Value>,
    access: &FieldAccessContext,
) {
    // Currencies are authenticated session reference data. Honor explicit read
    // and field denials for both aliases before resolving a code.
    if ["currency", "currencies"].iter().any(|resource| {
        resource_read_denied(access, resource)
            || !has_resource_field_projection_permission(Some(access), resource, "code")
    }) {
        return;
    }
    let ids: BTreeSet<_> = std::iter::once(&*parent)
        .chain(relations.values().filter_map(Value::as_array).flatten())
        .flat_map(currency_ids)
        .map(|(id, _)| id)
        .collect();
    if ids.is_empty() {
        return;
    }
    let id_filter = ids
        .iter()
        .map(|id| format!("id = {id}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!("SELECT id, organization_id, code FROM currency WHERE organization_id = {organization_id} AND ({id_filter})");
    let rows = match bounded_rows(client, &sql, ids.len()).await {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(%error, "Authoritative currency reference unavailable");
            return;
        }
    };
    let codes: HashMap<_, _> = rows
        .into_iter()
        .filter_map(|row| {
            let id = row_u64(&row, "id", "id").ok().flatten()?;
            let code = row.get("code")?.as_str()?;
            (ids.contains(&id)
                && record_matches_scope(
                    &row,
                    organization_id,
                    0,
                    id,
                    AuthoritativeResourceScope::Organization,
                ))
            .then(|| (id, code.to_owned()))
        })
        .collect();
    for row in std::iter::once(parent).chain(
        relations
            .values_mut()
            .filter_map(Value::as_array_mut)
            .flatten(),
    ) {
        let fields: Vec<_> = currency_ids(row)
            .filter_map(|(id, key)| codes.get(&id).map(|code| (key, code)))
            .collect();
        let Some(row) = row.as_object_mut() else {
            continue;
        };
        for (key, code) in fields {
            row.insert(key.into(), Value::String(code.clone()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn access(permissions: &[&str]) -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 42,
            role_id: 1,
            role_permissions: permissions
                .iter()
                .map(|permission| (*permission).into())
                .collect(),
            ..FieldAccessContext::default()
        }
    }

    #[test]
    fn alpha_authoritative_resources_enforce_exact_id_and_company_scope() {
        for resource in [
            "stock-pickings",
            "stock-moves",
            "stock-move-lines",
            "stock-quants",
            "stock-cycle-counts",
            "fleet-vehicles",
            "fleet-inspections",
            "fleet-service-records",
            "expenses",
            "subscriptions",
            "subscription-lines",
            "account-move-lines",
            "account-accounts",
        ] {
            let entry = registry_get(resource).expect("canonical Alpha resource");
            let grant = format!("{}:read", entry.table);
            let (sql, scope) =
                authoritative_record_sql(resource, 42, 7, 9, Some(&access(&[&grant])))
                    .expect("authorized exact read");
            assert_eq!(scope, AuthoritativeResourceScope::OrganizationAndCompany);
            assert!(
                sql.contains(&format!(
                    "FROM {} WHERE organization_id = 42 AND company_id = 7 AND id = 9",
                    entry.table
                )),
                "{sql}"
            );
            assert!(authoritative_record_sql(resource, 42, 7, 9, Some(&access(&[]))).is_err());
        }
    }

    #[test]
    fn calendar_exact_read_stays_organization_scoped_and_quotes_native_timestamps() {
        let (sql, scope) = authoritative_record_sql(
            "calendar-events",
            42,
            7,
            9,
            Some(&access(&["calendar_event:read"])),
        )
        .unwrap();
        assert_eq!(scope, AuthoritativeResourceScope::Organization);
        assert!(sql.contains("\"start\", \"stop\""), "{sql}");
        assert!(
            sql.ends_with(
                "FROM calendar_event WHERE organization_id = 42 AND id = 9 AND privacy = 'public'"
            ),
            "{sql}"
        );
        assert!(!sql.contains("description"), "{sql}");
        assert!(!sql.contains("partner_ids"), "{sql}");
        assert!(authoritative_record_sql("calendar-events", 42, 7, 9, Some(&access(&[]))).is_err());
    }

    #[test]
    fn optional_company_rows_require_exact_company_and_deleted_markers_stay_internal() {
        let mut actor = access(&["opportunity:read", "lead:read", "stock_location:read"]);
        actor.field_permissions.push(
            serde_json::from_value(json!({
                "organizationId": 42, "roleId":1, "resource": "opportunities", "action": "read",
                "allowedFields": ["name"]
            }))
            .unwrap(),
        );
        let (sql, scope) =
            authoritative_record_sql("opportunities", 42, 7, 9, Some(&actor)).unwrap();
        assert_eq!(
            scope,
            AuthoritativeResourceScope::OrganizationAndExactOptionalCompany
        );
        assert!(sql.contains("deleted_at"), "{sql}");
        assert!(!sql.contains("company_id = 7"), "{sql}");
        assert!(!sql.contains("expected_revenue"), "{sql}");
        for company in [Value::Null, json!({"some": [8]}), json!("invalid")] {
            assert!(!record_matches_scope(
                &json!({"id": 9, "organization_id": 42, "company_id": company}),
                42,
                7,
                9,
                scope
            ));
        }
        let row = json!({"id": "9", "organizationId": "42", "companyId": {"some": ["7"]}, "deleted_at": null});
        assert!(record_matches_scope(&row, 42, 7, 9, scope));
        assert!(!record_matches_scope(&row, 42, 7, 10, scope));
        assert!(!record_matches_scope(&row, 43, 7, 9, scope));
        let mut rows = vec![
            row.clone(),
            json!({"id": 10, "deleted_at": {"some": [123]}}),
        ];
        filter_and_strip_soft_deleted(&mut rows);
        assert_eq!(rows.len(), 1);
        assert!(rows[0].get("deleted_at").is_none());
        let (_, lead_scope) = authoritative_record_sql("leads", 42, 7, 9, Some(&actor)).unwrap();
        assert_eq!(lead_scope, AuthoritativeResourceScope::Organization);
    }

    #[test]
    fn relation_sql_requires_child_grant_and_filters_by_exact_parent_and_company() {
        let journal = &related_resources("account-moves")[0];
        assert!(
            relation_sql(journal, 42, 7, 9, &access(&["account_move:read"]))
                .unwrap()
                .is_none()
        );
        let mut actor = access(&[
            "account_move_line:read",
            "stock_move:read",
            "stock_count_sheet:*",
        ]);
        let sql = relation_sql(journal, 42, 7, 9, &actor).unwrap().unwrap();
        assert!(sql.ends_with("FROM account_move_line WHERE organization_id = 42 AND company_id = 7 AND move_id = 9 LIMIT 21"), "{sql}");
        actor.field_permissions.push(serde_json::from_value(json!({
            "organizationId": 42, "roleId":1, "resource": "account-move-lines", "action": "read",
            "allowedFields": ["debit"]
        })).unwrap());
        assert!(relation_sql(journal, 42, 7, 9, &actor).unwrap().is_none());
        let picking = &related_resources("stock-pickings")[0];
        let sql = relation_sql(picking, 42, 7, 9, &actor).unwrap().unwrap();
        assert!(sql.ends_with("FROM stock_move WHERE organization_id = 42 AND company_id = 7 AND picking_key = 9 LIMIT 21"), "{sql}");
        let count = &related_resources("stock-cycle-counts")[0];
        let sql = relation_sql(count, 42, 7, 9, &actor).unwrap().unwrap();
        assert!(
            sql.ends_with(
                "FROM stock_count_sheet WHERE organization_id = 42 AND cycle_count_id = 9 LIMIT 21"
            ),
            "{sql}"
        );
        assert!(authoritative_resource_scope("stock_count_sheet").is_none());
    }

    #[test]
    fn relation_rows_distinguish_authorized_empty_reads_from_wrong_scope_and_overflow() {
        let journal = &related_resources("account-moves")[0];
        let valid = json!({"id": 1, "organization_id": 42, "company_id": 7, "move_id": 9});
        assert_eq!(
            verified_relation_rows(Vec::new(), journal, 42, 7, 9),
            Some(Vec::new())
        );
        assert_eq!(
            verified_relation_rows(vec![valid.clone()], journal, 42, 7, 9),
            Some(vec![valid.clone()])
        );
        assert!(
            verified_relation_rows(vec![valid; RELATION_LIMIT + 1], journal, 42, 7, 9).is_none()
        );
        for wrong in [
            json!({"id": 1, "organization_id": 43, "company_id": 7, "move_id": 9}),
            json!({"id": 2, "organization_id": 42, "company_id": 8, "move_id": 9}),
            json!({"id": 3, "organization_id": 42, "company_id": 7, "move_id": 10}),
            json!({"id": 4, "organization_id": 42, "move_id": 9}),
        ] {
            assert!(verified_relation_rows(vec![wrong], journal, 42, 7, 9).is_none());
        }
        let count = &related_resources("stock-cycle-counts")[0];
        let row = json!({"id": 1, "organization_id": 42, "cycle_count_id": 9});
        assert!(verified_relation_rows(vec![row.clone()], count, 42, 7, 9).is_some());
        assert!(verified_relation_rows(vec![row], count, 42, 7, 10).is_none());
    }

    #[test]
    fn finance_board_sources_use_company_and_field_authorization() {
        for (resource, grant, table) in [
            (
                "account-payments",
                "account_payment:read",
                "account_payment",
            ),
            ("expense-sheets", "expense_sheet:read", "expense_sheet"),
        ] {
            let mut access = FieldAccessContext {
                organization_id: 42,
                role_id: 1,
                role_permissions: vec![grant.into()],
                ..FieldAccessContext::default()
            };
            let (sql, scope) = authoritative_record_sql(resource, 42, 7, 9, Some(&access)).unwrap();
            assert_eq!(scope, AuthoritativeResourceScope::OrganizationAndCompany);
            assert!(
                sql.contains(&format!(
                    "FROM {table} WHERE organization_id = 42 AND company_id = 7 AND id = 9"
                )),
                "{sql}"
            );
            access.field_permissions.push(
                serde_json::from_value(json!({
                    "organizationId": 42, "roleId": 1, "resource": resource,
                    "action": "read", "allowedFields": ["state"]
                }))
                .unwrap(),
            );
            let (sql, _) = authoritative_record_sql(resource, 42, 7, 9, Some(&access)).unwrap();
            assert!(!sql.contains("name"), "{sql}");
            assert!(!sql.contains("amount"), "{sql}");
            assert!(sql.contains("state"));
            assert!(authoritative_record_sql(resource, 43, 7, 9, Some(&access)).is_err());
            access.role_permissions.clear();
            assert!(authoritative_record_sql(resource, 42, 7, 9, Some(&access)).is_err());
        }
    }
}
