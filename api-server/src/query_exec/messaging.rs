use crate::error::ApiError;
use serde_json::Value;
use stdb_client::StdbClient;

use super::row_values::sort_rows_by_id_desc;

pub(super) async fn read_queued_mail_messages(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
        "SELECT id, organization_id, model, res_id, author_id, body, message_type, subtype, date, parent_id, attachment_ids, metadata FROM mail_message WHERE organization_id = {organization_id} AND message_type = 'Email'"
    );
    let mut rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    sort_rows_by_id_desc(&mut rows);
    rows.retain(|row| {
        row.get("metadata")
            .and_then(|v| v.as_str())
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .and_then(|meta| {
                meta.get("delivery")
                    .and_then(|d| d.as_str())
                    .map(|d| d == "queued")
            })
            .unwrap_or(false)
    });
    Ok(rows)
}
