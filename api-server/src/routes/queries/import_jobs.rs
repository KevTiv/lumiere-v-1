//! Company-scoped import history and exact job diagnostics.

use serde_json::{json, Value};
use stdb_auth::{has_resource_read_permission, resolve_http_sql_columns, resource_read_denied};

use crate::{
    error::ApiError,
    query_exec::{resolve_membership_company_id, row_u64},
    session::normalize_identity_hex_for_sql,
    trusted_context::TrustedOperationContext,
};

const JOBS: &str = "import-jobs";
const ERRORS: &str = "import-job-errors";
const PAGE_SIZE: u32 = 100;

fn cell<'a>(row: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    row.get(camel).or_else(|| row.get(snake))
}

fn text(value: &Value) -> Option<&str> {
    value.as_str().or_else(|| value.get("some")?.as_str())
}

fn job_matches_company(row: &Value, company: u64, actor: &str, administrator: bool) -> bool {
    let metadata = row.get("metadata").and_then(text);
    if let Some(raw) = metadata {
        let Ok(metadata) = serde_json::from_str::<Value>(raw) else {
            return false;
        };
        if metadata
            .get("company_id")
            .is_some_and(|value| !value.is_null())
        {
            return row_u64(&metadata, "company_id", "company_id")
                .ok()
                .flatten()
                == Some(company);
        }
        if metadata.get("correlation_version").is_some() {
            return false;
        }
    }

    // Old import jobs did not capture a company. Keep them available to their
    // submitter and organization administrators without inferring company scope.
    administrator
        || cell(row, "createUid", "create_uid")
            .and_then(|value| {
                value
                    .as_str()
                    .or_else(|| value.get("__identity__")?.as_str())
            })
            .is_some_and(|identity| {
                normalize_identity_hex_for_sql(identity) == normalize_identity_hex_for_sql(actor)
            })
}

fn project_job(row: &Value, job_id: u64, columns: &[String]) -> Value {
    let mut job = serde_json::Map::new();
    for (camel, snake) in [
        ("tableName", "table_name"),
        ("fileName", "file_name"),
        ("totalRows", "total_rows"),
        ("importedRows", "imported_rows"),
        ("errorRows", "error_rows"),
        ("status", "status"),
        ("metadata", "metadata"),
    ] {
        if columns.iter().any(|column| column == snake) {
            if let Some(value) = cell(row, camel, snake) {
                let value = if matches!(snake, "metadata" | "file_name") {
                    text(value).map_or(Value::Null, |value| json!(value))
                } else {
                    value.clone()
                };
                job.insert(camel.to_owned(), value);
            }
        }
    }
    job.insert("id".into(), json!(job_id.to_string()));
    Value::Object(job)
}

fn jobs_in_scope(
    rows: Vec<Value>,
    organization: u64,
    company: u64,
    job_id: Option<u64>,
    actor: &str,
    administrator: bool,
) -> Vec<(u64, Value)> {
    rows.into_iter()
        .filter_map(|row| {
            let id = row_u64(&row, "id", "id").ok().flatten()?;
            (id > 0
                && job_id.is_none_or(|requested| requested == id)
                && row_u64(&row, "organizationId", "organization_id")
                    .ok()
                    .flatten()
                    == Some(organization)
                && job_matches_company(&row, company, actor, administrator))
            .then_some((id, row))
        })
        .collect()
}

pub(super) async fn read(
    context: &TrustedOperationContext,
    resource: &str,
    company_id: Option<u64>,
    job_id: Option<u64>,
    before: Option<&str>,
    limit: Option<u32>,
) -> Result<Option<Value>, ApiError> {
    if !((resource == JOBS && (job_id.is_some() || company_id.is_some()))
        || (resource == ERRORS && job_id.is_some()))
    {
        return Ok(None);
    }

    let requested_company = company_id
        .filter(|company| *company > 0)
        .ok_or_else(|| ApiError::BadRequest("companyId is required for import jobs".into()))?;
    let limit = limit.unwrap_or(PAGE_SIZE);
    let before = before
        .map(|value| {
            value
                .parse::<u64>()
                .ok()
                .filter(|id| *id > 0)
                .ok_or_else(|| ApiError::BadRequest("Invalid diagnostic cursor".into()))
        })
        .transpose()?;
    if job_id == Some(0) || !(1..=PAGE_SIZE).contains(&limit) {
        return Err(ApiError::BadRequest("Invalid import job page".into()));
    }

    let access = context.field_access();
    if !has_resource_read_permission(Some(access), JOBS)
        || (resource == ERRORS && resource_read_denied(access, ERRORS))
    {
        return Err(ApiError::Forbidden(
            "Import job read permission denied".into(),
        ));
    }
    let columns = resolve_http_sql_columns(JOBS, Some(access)).map_err(ApiError::Internal)?;
    if [
        "table_name",
        "status",
        "total_rows",
        "imported_rows",
        "error_rows",
    ]
    .iter()
    .any(|required| !columns.iter().any(|column| column == required))
    {
        return Err(ApiError::Forbidden(
            "Import job details are restricted".into(),
        ));
    }
    let organization = context.organization_id();
    let company = resolve_membership_company_id(
        context.client(),
        organization,
        context.actor_identity(),
        Some(requested_company),
        "Import job company scope mismatch",
    )
    .await?;
    let mut selected = columns.clone();
    for field in ["metadata", "create_uid"] {
        if !selected.iter().any(|column| column == field) {
            selected.push(field.into());
        }
    }
    let exact_clause = job_id.map_or_else(String::new, |id| format!(" AND id = {id}"));
    let rows = context
        .client()
        .query_sql(&format!(
            "SELECT {} FROM import_job WHERE organization_id = {organization}{exact_clause}",
            selected.join(", "),
        ))
        .await
        .map_err(ApiError::internal)?;
    let administrator = access.is_superuser
        || (access
            .role_permissions
            .iter()
            .any(|permission| permission == "*:*")
            && !access
                .org_permissions
                .iter()
                .any(|permission| !permission.allow));
    let mut scoped = jobs_in_scope(
        rows,
        organization,
        company,
        job_id,
        context.actor_identity(),
        administrator,
    );

    if resource == JOBS {
        if job_id.is_some() && scoped.len() > 1 {
            return Err(ApiError::Conflict("Duplicate import job identifier".into()));
        }
        scoped.sort_unstable_by(|(left, _), (right, _)| right.cmp(left));
        let jobs: Vec<_> = scoped
            .into_iter()
            .take(limit as usize)
            .map(|(id, row)| project_job(&row, id, &columns))
            .collect();
        return Ok(Some(json!({"data": jobs})));
    }

    let [(job_id, _)] = scoped.as_slice() else {
        return Ok(Some(json!({"data": [], "nextCursor": null})));
    };
    let job_id = *job_id;

    // Validation messages and raw values can embed fields from the imported
    // domain. Reuse the import owner's admin rule before exposing those details.
    let detailed = super::super::import_reviews::full_administrator(access);
    let cursor_clause = before.map_or_else(String::new, |id| format!(" AND id < {id}"));
    let rows = context
        .client()
        .query_sql(&format!("SELECT id, organization_id, job_id, row_number, field_name, raw_value, error_message FROM import_job_error WHERE organization_id = {organization} AND job_id = {job_id}{cursor_clause}"))
        .await
        .map_err(ApiError::internal)?;
    Ok(Some(diagnostic_page(
        rows,
        organization,
        job_id,
        before,
        limit as usize,
        detailed,
    )))
}

fn diagnostic_page(
    rows: Vec<Value>,
    organization: u64,
    job: u64,
    before: Option<u64>,
    limit: usize,
    detailed: bool,
) -> Value {
    let mut matched: Vec<_> = rows
        .into_iter()
        .filter_map(|row| {
            let id = row_u64(&row, "id", "id").ok().flatten()?;
            (id > 0
                && before.is_none_or(|before| id < before)
                && row_u64(&row, "organizationId", "organization_id")
                    .ok()
                    .flatten()
                    == Some(organization)
                && row_u64(&row, "jobId", "job_id").ok().flatten() == Some(job))
            .then_some((id, row))
        })
        .collect();
    matched.sort_unstable_by(|(left, _), (right, _)| right.cmp(left));
    let next_cursor = (matched.len() > limit).then(|| matched[limit - 1].0.to_string());
    let items: Vec<_> = matched.into_iter().take(limit).map(|(id, row)| {
        json!({
            "id": id.to_string(),
            "jobId": job.to_string(),
            "rowNumber": cell(&row, "rowNumber", "row_number"),
            "fieldName": detailed.then(|| cell(&row, "fieldName", "field_name").and_then(text)).flatten(),
            "rawValue": detailed.then(|| cell(&row, "rawValue", "raw_value").and_then(text)).flatten(),
            "errorMessage": if detailed {
                cell(&row, "errorMessage", "error_message").and_then(Value::as_str).unwrap_or("Import validation failed")
            } else {
                "Import validation failed"
            },
        })
    }).collect();
    json!({"data": items, "nextCursor": next_cursor})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jobs_use_saved_company_and_legacy_jobs_require_the_submitter_or_admin() {
        let tracked = json!({"create_uid":"012a", "metadata":"{\"company_id\":42,\"correlation_version\":1}"});
        assert!(job_matches_company(&tracked, 42, "012a", false));
        assert!(!job_matches_company(&tracked, 43, "012a", true));
        let actor = "ab".repeat(32);
        let legacy = json!({"create_uid":{"__identity__":format!("0x{actor}")}});
        assert!(job_matches_company(
            &legacy,
            42,
            &actor.to_uppercase(),
            false
        ));
        assert!(!job_matches_company(&legacy, 42, "012b", false));
        assert!(job_matches_company(&legacy, 42, "012b", true));
        assert!(!job_matches_company(
            &json!({"metadata":"bad"}),
            42,
            "012a",
            true
        ));
    }

    #[test]
    fn another_company_cannot_displace_older_jobs_from_the_scoped_history() {
        let mut rows: Vec<_> = (2..=200)
            .map(|id| {
                json!({
                    "id":id, "organization_id":7, "metadata":"{\"company_id\":43}"
                })
            })
            .collect();
        rows.push(json!({"id":1, "organization_id":7, "metadata":"{\"company_id\":42}"}));
        rows.push(json!({"id":201, "organization_id":8, "metadata":"{\"company_id\":42}"}));
        let scoped = jobs_in_scope(rows, 7, 42, None, "012a", true);
        assert_eq!(
            scoped.into_iter().map(|(id, _)| id).collect::<Vec<_>>(),
            [1]
        );
    }

    #[test]
    fn diagnostic_pages_cover_more_than_the_global_feed_limit_and_redact_restricted_rows() {
        let job_rows: Vec<_> = (1..=650)
            .map(|id| {
                json!({
                    "id": id, "organization_id": 7, "job_id": 42, "row_number": id,
                    "field_name": {"some":"private"}, "raw_value":{"some":"sensitive"},
                    "error_message":"sensitive source value"
                })
            })
            .chain([
                json!({"id":701, "organization_id":8, "job_id":42}),
                json!({"id":702, "organization_id":7, "job_id":43}),
            ])
            .collect();
        let mut cursor = None;
        let mut seen = Vec::new();
        loop {
            let page = diagnostic_page(job_rows.clone(), 7, 42, cursor, 100, false);
            let rows = page["data"].as_array().unwrap();
            assert!(rows.iter().all(|row| row["rawValue"].is_null()
                && row["fieldName"].is_null()
                && row["errorMessage"] == "Import validation failed"));
            seen.extend(
                rows.iter()
                    .map(|row| row["id"].as_str().unwrap().parse::<u64>().unwrap()),
            );
            let Some(next) = page["nextCursor"].as_str() else {
                break;
            };
            cursor = Some(next.parse().unwrap());
        }
        assert_eq!(seen, (1..=650).rev().collect::<Vec<_>>());
    }
}
