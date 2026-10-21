//! Shared typed report queries, company scope, windows, and row limits.
use super::{CompanyRow, ValidatedPreviewRequest};
use crate::error::ApiError;
use crate::reports::common::{
    MarginSupplyScenarioSource, ReportPreviewRequest, ReportScope, SourceRowCount, SourceWatermark,
};
use crate::reports::timezone::{parse_timezone, ReportDayWindow};
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use serde::{de::DeserializeOwned, Deserialize};
use stdb_client::StdbClient;
const MAX_ROWS_PER_SOURCE: usize = 1_000;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StdbTimestamp {
    micros_since_unix_epoch: i64,
}

impl StdbTimestamp {
    pub(super) fn is_between(self, start: DateTime<Utc>, end: DateTime<Utc>) -> bool {
        let micros = self.micros_since_unix_epoch;
        start.timestamp_micros() <= micros && micros < end.timestamp_micros()
    }

    pub(super) fn is_before(self, end: DateTime<Utc>) -> bool {
        self.micros_since_unix_epoch < end.timestamp_micros()
    }

    pub(super) fn to_rfc3339(self) -> Result<String, ApiError> {
        DateTime::from_timestamp_micros(self.micros_since_unix_epoch)
            .map(|timestamp| timestamp.to_rfc3339_opts(SecondsFormat::Micros, true))
            .ok_or_else(|| ApiError::Internal("report source timestamp is out of range".into()))
    }
}

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
    let scenario = request.scenario.unwrap_or_default();
    if !scenario.input_cost_change_pct.is_finite()
        || !(-50.0..=500.0).contains(&scenario.input_cost_change_pct)
    {
        return Err(ApiError::BadRequest(
            "scenario.inputCostChangePct must be between -50 and 500".into(),
        ));
    }
    if !scenario.demand_change_pct.is_finite()
        || !(-100.0..=500.0).contains(&scenario.demand_change_pct)
    {
        return Err(ApiError::BadRequest(
            "scenario.demandChangePct must be between -100 and 500".into(),
        ));
    }
    if !(0..=365).contains(&scenario.lead_time_change_days) {
        return Err(ApiError::BadRequest(
            "scenario.leadTimeChangeDays must be between 0 and 365".into(),
        ));
    }
    if !scenario.target_margin_pct.is_finite()
        || !(0.0..=95.0).contains(&scenario.target_margin_pct)
    {
        return Err(ApiError::BadRequest(
            "scenario.targetMarginPct must be between 0 and 95".into(),
        ));
    }
    if let Some(provenance) = scenario.provenance.as_ref() {
        match provenance.source {
            MarginSupplyScenarioSource::Manual => {
                if provenance.file_name.is_some()
                    || provenance.imported_at.is_some()
                    || provenance.row_number.is_some()
                {
                    return Err(ApiError::BadRequest(
                        "manual scenario provenance cannot include CSV import fields".into(),
                    ));
                }
            }
            MarginSupplyScenarioSource::ControlledCsv => {
                let file_name = provenance
                    .file_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| {
                        !value.is_empty()
                            && value.len() <= 255
                            && !value.chars().any(char::is_control)
                    })
                    .ok_or_else(|| {
                        ApiError::BadRequest(
                            "controlled CSV provenance requires a valid fileName".into(),
                        )
                    })?;
                if !file_name.to_ascii_lowercase().ends_with(".csv") {
                    return Err(ApiError::BadRequest(
                        "controlled CSV provenance fileName must end in .csv".into(),
                    ));
                }
                let imported_at = provenance.imported_at.as_deref().ok_or_else(|| {
                    ApiError::BadRequest("controlled CSV provenance requires importedAt".into())
                })?;
                DateTime::parse_from_rfc3339(imported_at).map_err(|_| {
                    ApiError::BadRequest("scenario.provenance.importedAt must use RFC 3339".into())
                })?;
                if !matches!(provenance.row_number, Some(1..=1_000_000)) {
                    return Err(ApiError::BadRequest(
                        "controlled CSV provenance rowNumber must be between 1 and 1000000".into(),
                    ));
                }
            }
        }
    }

    Ok(ValidatedPreviewRequest {
        company_id: request.company_id,
        date,
        timezone: timezone.to_string(),
        scenario,
    })
}
