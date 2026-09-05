//! Shared typed report queries, company scope, windows, and row limits.
use super::{CompanyRow, ValidatedPreviewRequest};
use crate::error::ApiError;
use crate::reports::common::{ReportPreviewRequest, ReportScope, SourceRowCount, SourceWatermark};
use crate::reports::timezone::{parse_timezone, ReportDayWindow};
use chrono::NaiveDate;
use serde::de::DeserializeOwned;
use stdb_client::StdbClient;
const MAX_ROWS_PER_SOURCE: usize = 1_000;

pub(super) fn source_watermark(
    window: &ReportDayWindow,
    queried_at: String,
    source_rows: Vec<SourceRowCount>,
) -> SourceWatermark {
    SourceWatermark {
        accounting_cutoff: window.end_sql.clone(),
        window_start_utc: window.start_sql.clone(),
        window_end_utc: window.end_sql.clone(),
        cutoff_label: window.cutoff_label.clone(),
        queried_at,
        source_rows,
    }
}

pub(super) fn scope_for(company: &CompanyRow, window: &ReportDayWindow) -> ReportScope {
    ReportScope {
        organization_id: company.organization_id,
        company_id: company.id,
        local_date: window.local_date.to_string(),
        date_from: window.local_date.to_string(),
        date_to_exclusive: window.local_end_date.to_string(),
        timezone: window.timezone.clone(),
        window_start_utc: window.start_sql.clone(),
        window_end_utc: window.end_sql.clone(),
        cutoff_label: window.cutoff_label.clone(),
    }
}

pub(super) fn sql_id_list(ids: &[u64]) -> String {
    ids.iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

pub(super) async fn query_company(
    client: &StdbClient,
    organization_id: u64,
    company_id: u64,
) -> Result<CompanyRow, ApiError> {
    let sql = format!(
        "SELECT id, organization_id, name, currency_id, deleted_at FROM company WHERE id = {company_id} AND organization_id = {organization_id} LIMIT 1"
    );
    query_typed::<CompanyRow>(client, "company", sql)
        .await?
        .into_iter()
        .find(|company| company.deleted_at.is_none())
        .ok_or_else(|| {
            ApiError::Forbidden("Company does not belong to the session organization".into())
        })
}

pub(super) async fn query_typed<T>(
    client: &StdbClient,
    source: &'static str,
    sql: String,
) -> Result<Vec<T>, ApiError>
where
    T: DeserializeOwned,
{
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|error| ApiError::Internal(format!("{source} report query: {error}")))?;
    if rows.len() > MAX_ROWS_PER_SOURCE {
        return Err(ApiError::Unprocessable(format!(
            "Report source '{source}' exceeds the {MAX_ROWS_PER_SOURCE}-row preview limit"
        )));
    }
    rows.into_iter()
        .map(|row| {
            serde_json::from_value(row).map_err(|error| {
                ApiError::Internal(format!("invalid typed {source} report row: {error}"))
            })
        })
        .collect()
}

pub(super) fn validate_request(
    request: ReportPreviewRequest,
) -> Result<ValidatedPreviewRequest, ApiError> {
    if request.company_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId must be greater than zero".into(),
        ));
    }
    let date = NaiveDate::parse_from_str(request.date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("date must use YYYY-MM-DD".into()))?;
    let timezone = request.timezone.trim();
    if timezone.is_empty()
        || timezone.len() > 64
        || !timezone.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | '_' | '-' | '+' | ':')
        })
    {
        return Err(ApiError::BadRequest(
            "timezone must be a valid non-empty timezone identifier".into(),
        ));
    }
    parse_timezone(timezone)?;

    Ok(ValidatedPreviewRequest {
        company_id: request.company_id,
        date,
        timezone: timezone.to_string(),
    })
}
