//! Bounded, actor-authorized searches for references to live records.

use super::authoritative::{authoritative_resource_scope, AuthoritativeResourceScope};
use super::row_values::{row_company_matches, row_not_soft_deleted, row_u64};
use crate::error::ApiError;
use chrono::{Days, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use stdb_auth::{
    has_resource_field_read_permission, has_resource_read_permission, registry_get,
    FieldAccessContext,
};
use stdb_client::StdbClient;

const MAX_ROWS: usize = 64;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AuthoritativeSearchQuery {
    pub company_id: u64,
    label: Option<String>,
    date: Option<String>,
    record_id: Option<u64>,
    move_kind: Option<AccountMoveKind>,
    posted: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AccountMoveKind {
    JournalEntry,
    Invoice,
    VendorBill,
}

impl AccountMoveKind {
    fn value(self) -> &'static str {
        match self {
            Self::JournalEntry => "Entry",
            Self::Invoice => "OutInvoice",
            Self::VendorBill => "InInvoice",
        }
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum AuthoritativeSearchResult {
    Match { id: u64 },
    Empty,
    Ambiguous,
}

#[derive(Clone, Copy)]
struct SearchColumns {
    label: &'static str,
    alternate: Option<&'static str>,
    date: Option<&'static str>,
    soft_delete: bool,
}

fn search_columns(resource: &str) -> Option<SearchColumns> {
    let (label, alternate, date, soft_delete) = match resource {
        "account-moves" => ("name", Some("ref_"), Some("date"), false),
        "account-payments" => ("name", Some("ref_"), Some("date"), false),
        "sale-orders" => ("reference", None, Some("date_order"), false),
        "purchase-orders" => ("name", None, Some("date_order"), false),
        "products" => ("name", Some("default_code"), None, false),
        "contacts" => ("name", Some("display_name"), None, true),
        "leads" => ("name", None, Some("created_at"), true),
        "opportunities" => ("name", None, Some("created_at"), true),
        "expenses" => ("name", None, Some("date"), false),
        "expense-sheets" => ("name", None, Some("created_at"), false),
        "subscriptions" => ("code", None, Some("date_start"), false),
        "stock-pickings" | "stock-cycle-counts" => ("name", None, None, false),
        "stock-locations" => ("name", Some("complete_name"), None, false),
        "fleet-vehicles" => ("name", Some("license_plate"), None, false),
        "tasks" => ("name", None, None, false),
        _ => return None,
    };
    Some(SearchColumns {
        label,
        alternate,
        date,
        soft_delete,
    })
}

fn not_found() -> ApiError {
    ApiError::NotFound("Authoritative resource not found".into())
}

fn valid_label(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.chars().all(|c| {
            c.is_alphanumeric()
                || matches!(
                    c,
                    ' ' | '-'
                        | '_'
                        | '/'
                        | '.'
                        | ','
                        | ':'
                        | '#'
                        | '('
                        | ')'
                        | '&'
                        | '+'
                        | '\''
                        | '’'
                        | '·'
                )
        })
}

fn label_words(value: &str) -> Vec<String> {
    value
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect()
}

fn matches_label(row: &Value, labels: &[&str], label: &str) -> bool {
    let expected = label_words(label);
    !expected.is_empty()
        && labels.iter().any(|field| {
            row.get(*field)
                .or_else(|| row.get(&camel_key(field)))
                .and_then(Value::as_str)
                .is_some_and(|value| {
                    let words = label_words(value);
                    words
                        .windows(expected.len())
                        .any(|window| window == expected)
                })
        })
}

// SpacetimeDB does not compare a nullable string column to a scalar
// literal. Filter those labels after retrieving a bounded candidate window.
fn scalar_label(resource: &str, field: &str) -> bool {
    !matches!(
        (resource, field),
        ("account-payments", _)
            | ("sale-orders", "reference")
            | (
                _,
                "ref_" | "default_code" | "license_plate" | "complete_name"
            )
    )
}

fn matches_exact_label(row: &Value, labels: &[&str], label: &str) -> bool {
    labels.iter().any(|field| {
        row.get(*field)
            .or_else(|| row.get(&camel_key(field)))
            .and_then(Value::as_str)
            .is_some_and(|value| value.eq_ignore_ascii_case(label))
    })
}

fn camel_key(value: &str) -> String {
    let mut parts = value.split('_');
    let mut camel = parts.next().unwrap_or_default().to_owned();
    for part in parts {
        let mut chars = part.chars();
        if let Some(initial) = chars.next() {
            camel.extend(initial.to_uppercase());
            camel.extend(chars);
        }
    }
    camel
}

fn search_sql<'a>(
    resource: &str,
    org_id: u64,
    query: &'a AuthoritativeSearchQuery,
    access: &FieldAccessContext,
) -> Result<
    (
        String,
        AuthoritativeResourceScope,
        SearchColumns,
        Vec<&'static str>,
        Option<&'a str>,
        bool,
    ),
    ApiError,
> {
    if org_id == 0
        || query.company_id == 0
        || access.organization_id != org_id
        || !has_resource_read_permission(Some(access), resource)
    {
        return Err(not_found());
    }
    let scope = authoritative_resource_scope(resource).ok_or_else(not_found)?;
    let registry = registry_get(resource).ok_or_else(not_found)?;
    let columns = search_columns(resource).ok_or_else(not_found)?;
    let label = query.label.as_deref().map(str::trim);
    if label.is_some_and(|value| !valid_label(value))
        || (label.is_none() && query.date.is_none() && query.record_id.is_none())
        || query.record_id == Some(0)
        || (query.record_id.is_some() && label.is_some())
    {
        return Err(ApiError::BadRequest(
            "A bounded record label or date is required".into(),
        ));
    }
    let allowed = |column| has_resource_field_read_permission(Some(access), resource, column);
    let labels: Vec<&str> = std::iter::once(columns.label)
        .chain(columns.alternate)
        .filter(|column| allowed(column))
        .collect();
    if label.is_some() && labels.is_empty() {
        return Err(not_found());
    }

    // Scope fields and deletion markers are used for enforcement only.
    let mut projection = vec!["id", "organization_id"];
    let mut conditions = vec![format!("organization_id = {org_id}")];
    match scope {
        AuthoritativeResourceScope::OrganizationAndCompany => {
            projection.push("company_id");
            conditions.push(format!("company_id = {}", query.company_id));
        }
        AuthoritativeResourceScope::OrganizationOptionalCompany
        | AuthoritativeResourceScope::OrganizationAndExactOptionalCompany => {
            projection.push("company_id");
        }
        AuthoritativeResourceScope::Organization => {}
    }
    if columns.soft_delete {
        projection.push("deleted_at");
    }

    let mut filter_exact_label = false;
    if let Some(id) = query.record_id {
        conditions.push(format!("id = {id}"));
    }
    if let Some(date) = &query.date {
        let date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| ApiError::BadRequest("Unsupported search date".into()))?;
        let date_column = columns
            .date
            .filter(|column| allowed(column))
            .ok_or_else(not_found)?;
        let next = date
            .checked_add_days(Days::new(1))
            .ok_or_else(|| ApiError::BadRequest("Unsupported search date".into()))?;
        conditions.push(format!(
            "{date_column} >= '{date}T00:00:00Z' AND {date_column} < '{next}T00:00:00Z'"
        ));
        if label.is_some() {
            projection.extend(labels.iter().copied());
        }
    } else if let Some(label) = label {
        let scalar_fields: Vec<_> = labels
            .iter()
            .copied()
            .filter(|field| scalar_label(resource, field))
            .collect();
        if scalar_fields.is_empty() {
            projection.extend(labels.iter().copied());
            filter_exact_label = true;
        } else {
            let literal = label.replace('\'', "''");
            let predicate = scalar_fields
                .iter()
                .map(|column| format!("{column} = '{literal}'"))
                .collect::<Vec<_>>()
                .join(" OR ");
            conditions.push(format!("({predicate})"));
        }
    }

    if let Some(kind) = query.move_kind {
        if resource != "account-moves" || !allowed("move_type") {
            return Err(not_found());
        }
        conditions.push(format!("move_type = '{}'", kind.value()));
    }
    if query.posted == Some(true) {
        if resource != "account-moves" || !allowed("state") {
            return Err(not_found());
        }
        conditions.push("state = 'Posted'".into());
    }
    let table = &registry.table;
    let sql = format!(
        "SELECT {} FROM {table} WHERE {} LIMIT {}",
        projection.join(", "),
        conditions.join(" AND "),
        MAX_ROWS + 1,
    );
    Ok((sql, scope, columns, labels, label, filter_exact_label))
}

fn resolve_rows(
    rows: &[Value],
    org_id: u64,
    query: &AuthoritativeSearchQuery,
    scope: AuthoritativeResourceScope,
    columns: SearchColumns,
    labels: &[&str],
    label: Option<&str>,
    filter_exact_label: bool,
) -> AuthoritativeSearchResult {
    let complete = rows.len() <= MAX_ROWS;
    let mut ids = rows.iter().filter_map(|row| {
        if row_u64(row, "organizationId", "organization_id")
            .ok()
            .flatten()
            != Some(org_id)
            || (scope != AuthoritativeResourceScope::Organization
                && !row_company_matches(
                    row,
                    query.company_id,
                    scope == AuthoritativeResourceScope::OrganizationOptionalCompany,
                ))
            || (columns.soft_delete && !row_not_soft_deleted(row))
            || (query.date.is_some()
                && label.is_some_and(|label| !matches_label(row, labels, label)))
            || (filter_exact_label
                && label.is_some_and(|label| !matches_exact_label(row, labels, label)))
        {
            return None;
        }
        row_u64(row, "id", "id").ok().flatten().filter(|id| *id > 0)
    });
    match ids.next() {
        Some(id) => {
            if ids.any(|other| other != id) {
                AuthoritativeSearchResult::Ambiguous
            } else if complete {
                AuthoritativeSearchResult::Match { id }
            } else {
                // Optional-company and soft-delete resources can produce
                // masked rows. Do not distinguish their presence.
                AuthoritativeSearchResult::Empty
            }
        }
        None => AuthoritativeSearchResult::Empty,
    }
}

/// Finds a unique visible match and returns only its ID. Truncated or
/// ambiguous searches never nominate an arbitrary record.
pub(crate) async fn execute_authorized_resource_search(
    client: &StdbClient,
    resource: &str,
    org_id: u64,
    query: &AuthoritativeSearchQuery,
    access: &FieldAccessContext,
) -> Result<AuthoritativeSearchResult, ApiError> {
    let (sql, scope, columns, labels, label, filter_exact_label) =
        search_sql(resource, org_id, query, access)?;
    let rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    Ok(resolve_rows(
        &rows,
        org_id,
        query,
        scope,
        columns,
        &labels,
        label,
        filter_exact_label,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn query() -> AuthoritativeSearchQuery {
        serde_json::from_value(json!({
            "companyId": 7,
            "label": "electricity",
            "date": "2024-04-09",
            "moveKind": "journal_entry",
            "posted": true,
        }))
        .unwrap()
    }

    fn access() -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 42,
            role_id: 1,
            role_permissions: vec!["account_move:read".into()],
            ..FieldAccessContext::default()
        }
    }

    #[test]
    fn journal_search_is_bounded_and_field_authorized() {
        let input = query();
        let mut access = access();
        let (sql, ..) = search_sql("account-moves", 42, &input, &access).unwrap();
        assert!(sql.contains("organization_id = 42 AND company_id = 7"));
        assert!(sql.contains("date >= '2024-04-09T00:00:00Z' AND date < '2024-04-10T00:00:00Z'"));
        assert!(sql.contains("move_type = 'Entry' AND state = 'Posted' LIMIT 65"));
        assert!(!sql.contains("electricity"));
        assert!(search_sql("account-moves", 41, &input, &access).is_err());
        access.field_permissions.push(
            serde_json::from_value(json!({
                "organizationId": 42, "roleId": 1, "resource": "account-moves",
                "action": "read", "allowedFields": ["name"]
            }))
            .unwrap(),
        );
        assert!(search_sql("account-moves", 42, &input, &access).is_err());
    }

    #[test]
    fn journal_id_search_retains_posting_and_date_constraints() {
        let mut input = query();
        input.label = None;
        input.record_id = Some(9);
        let (sql, ..) = search_sql("account-moves", 42, &input, &access()).unwrap();
        assert!(sql.contains("AND id = 9 AND date >= '2024-04-09T00:00:00Z'"));
        assert!(sql.contains("move_type = 'Entry' AND state = 'Posted'"));
    }

    #[test]
    fn unique_label_match_rejects_foreign_companies_and_ambiguity() {
        let input = query();
        let (_, scope, columns, labels, label, filter_exact_label) =
            search_sql("account-moves", 42, &input, &access()).unwrap();
        let resolve = |rows: &[Value]| {
            resolve_rows(
                rows,
                42,
                &input,
                scope,
                SearchColumns { ..columns },
                &labels,
                label,
                filter_exact_label,
            )
        };
        let local = json!({"id": 9, "organizationId": 42, "companyId": 7, "name": "Kicukiro electricity 2024-04-09 · row 4271"});
        let foreign =
            json!({"id": 10, "organizationId": 42, "companyId": 8, "name": "Electricity"});
        let second = json!({"id": 11, "organizationId": 42, "companyId": 7, "name": "Electricity"});
        assert_eq!(
            resolve(&[local.clone(), foreign]),
            AuthoritativeSearchResult::Match { id: 9 }
        );
        assert_eq!(
            resolve(&[local.clone(), second]),
            AuthoritativeSearchResult::Ambiguous
        );
        assert_eq!(resolve(&vec![local; 65]), AuthoritativeSearchResult::Empty);
    }
}
