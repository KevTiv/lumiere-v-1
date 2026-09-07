//! Scoped imports query handlers.

use super::row_values::sort_rows_by_id_desc;
use super::row_values::{row_id_u64_strict, row_u64};
use crate::error::ApiError;
use serde_json::Value;
use std::collections::HashSet;
use stdb_client::StdbClient;

pub(super) async fn read_import_jobs(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
                "SELECT id, organization_id, table_name, file_name, total_rows, imported_rows, error_rows, status, started_at, completed_at, create_uid, create_date, metadata FROM import_job WHERE organization_id = {organization_id}"
            );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    rows.truncate(100);
    return Ok(rows);
}

pub(super) async fn read_import_job_errors(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let job_sql = format!("SELECT id FROM import_job WHERE organization_id = {organization_id}");
    let job_rows = client
        .query_sql(&job_sql)
        .await
        .map_err(ApiError::internal)?;
    let job_ids: HashSet<u64> = job_rows
        .iter()
        .filter_map(|r| row_id_u64_strict(r).ok())
        .filter(|id| *id > 0)
        .collect();
    if job_ids.is_empty() {
        return Ok(vec![]);
    }
    let sql = format!(
                "SELECT id, organization_id, job_id, row_number, field_name, raw_value, error_message, create_date FROM import_job_error WHERE organization_id = {organization_id}"
            );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    rows.retain(|row| {
        row_u64(row, "jobId", "job_id")
            .ok()
            .flatten()
            .is_some_and(|job_id| job_ids.contains(&job_id))
    });
    sort_rows_by_id_desc(&mut rows);
    rows.truncate(500);
    return Ok(rows);
}

pub(super) async fn read_import_mapping_templates(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
                "SELECT id, organization_id, table_name, name, mapping_json, use_count, create_uid, create_date, write_uid, write_date FROM import_mapping_template WHERE organization_id = {organization_id}"
            );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    rows.sort_by(|a, b| {
        let a_count = row_u64(a, "useCount", "use_count")
            .ok()
            .flatten()
            .unwrap_or_default();
        let b_count = row_u64(b, "useCount", "use_count")
            .ok()
            .flatten()
            .unwrap_or_default();
        b_count.cmp(&a_count).then_with(|| {
            row_id_u64_strict(b)
                .unwrap_or_default()
                .cmp(&row_id_u64_strict(a).unwrap_or_default())
        })
    });
    rows.truncate(200);
    Ok(rows)
}
