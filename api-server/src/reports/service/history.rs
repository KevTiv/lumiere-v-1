//! Persisted report artifact lookup and generated-report history.
use super::source_queries::{query_company, query_typed};
use crate::error::ApiError;
use crate::reports::common::GeneratedOwnerReportHistoryRow;
use stdb_client::StdbClient;

pub async fn report_artifact_key(
    client: &StdbClient,
    organization_id: u64,
    report_id: u64,
) -> Result<(u64, String), ApiError> {
    let sql = format!(
        "SELECT id, company_id, artifact_key FROM generated_owner_report WHERE organization_id = {organization_id} AND id = {report_id} LIMIT 1"
    );
    let row: crate::reports::common::GeneratedOwnerReportArtifactRow =
        query_typed(client, "generated_owner_report", sql)
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| ApiError::NotFound("generated owner report not found".into()))?;
    Ok((row.company_id, row.artifact_key))
}

pub async fn report_history(
    client: &StdbClient,
    organization_id: u64,
    company_id: u64,
) -> Result<Vec<GeneratedOwnerReportHistoryRow>, ApiError> {
    query_company(client, organization_id, company_id).await?;
    let sql = format!(
        "SELECT id, company_id, report_key, schema_version, output_hash, renderer_version, document_id, correlation_id, generated_at FROM generated_owner_report WHERE organization_id = {organization_id} AND company_id = {company_id} LIMIT 100"
    );
    query_typed(client, "generated_owner_report", sql).await
}
