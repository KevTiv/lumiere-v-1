//! Document and mail template resource reads.

use crate::error::ApiError;
use serde_json::Value;
use stdb_client::StdbClient;

use super::row_values::sort_rows_by_id_desc;

pub(super) async fn read_document_templates(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
        "SELECT id, organization_id, company_id, name, model, report_type, body_html, header_html, footer_html, variable_bindings_json, is_default, is_active, create_date, write_date, metadata FROM document_template WHERE organization_id = {organization_id}"
    );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}

pub(super) async fn read_mail_templates(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
        "SELECT id, organization_id, company_id, name, model, subject, body_html, document_template_id, attach_document, is_default, is_active, create_date, write_date, metadata FROM mail_template WHERE organization_id = {organization_id}"
    );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}
