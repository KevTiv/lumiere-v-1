//! Verify viewer selection provenance before accepting a copy into import review.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    document_blobs::read_authorized_spreadsheet_source, error::ApiError, session::ApiSession,
    state::AppState,
};

use super::{Original, StorageScope};

pub(super) const DOCUMENT_TASK_PREFIX: &str = "managed-document-v1:";

pub(super) fn document_task_identity(
    company_id: u64,
    document_id: u64,
    version_id: u64,
) -> (String, String) {
    let conversation = format!("{DOCUMENT_TASK_PREFIX}{document_id}:{version_id}");
    let request = hex::encode(Sha256::digest(format!("{company_id}:{conversation}")));
    (request[..32].to_owned(), conversation)
}

pub(super) fn document_reference(conversation_key: &str) -> Option<Value> {
    let (document, version) = conversation_key
        .strip_prefix(DOCUMENT_TASK_PREFIX)?
        .split_once(':')?;
    let canonical_id = |value: &str| {
        value
            .parse::<u64>()
            .ok()
            .is_some_and(|id| id > 0 && id.to_string() == value)
    };
    (canonical_id(document) && canonical_id(version))
        .then(|| json!({"documentId": document, "versionId": version}))
}

pub(super) fn verify_document_version(
    source: &crate::spreadsheet::Source,
    document_id: &str,
    version_id: &str,
    checksum: &str,
) -> Result<(), ApiError> {
    if source.document_id != document_id
        || source.version_id != version_id
        || source.checksum != checksum
    {
        return Err(ApiError::Conflict(
            "the selected document version changed".into(),
        ));
    }
    Ok(())
}

/// A matching checksum proves the bytes, while the saved reference proves provenance.
pub(super) async fn find_saved_document_task(
    pool: &deadpool_postgres::Pool,
    scope: StorageScope<'_>,
    source: &crate::spreadsheet::Source,
    conversation_key: &str,
) -> Result<Option<String>, ApiError> {
    let client = pool.get().await.map_err(ApiError::internal)?;
    let row = client
        .query_opt(
            "SELECT task.request_id
             FROM lumiere_platform.import_task task
             JOIN lumiere_platform.import_task_source file USING
                  (organization_id, company_id, actor_identity, request_id)
             WHERE task.organization_id=$1::text::numeric AND task.company_id=$2::text::numeric
               AND task.actor_identity=$3 AND file.ordinal=0 AND file.source_sha256=$4
               AND NOT EXISTS (
                 SELECT 1 FROM lumiere_platform.import_task_source sibling
                 WHERE sibling.organization_id=task.organization_id
                   AND sibling.company_id=task.company_id
                   AND sibling.actor_identity=task.actor_identity
                   AND sibling.request_id=task.request_id AND sibling.ordinal<>0
               )
               AND (task.conversation_key=$5 OR EXISTS (
                 SELECT 1 FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(task.preparation_json->'files')='array'
                     THEN task.preparation_json->'files' ELSE '[]'::jsonb END
                 ) rule
                 WHERE rule->>'sourceSha256'=$4
                   AND rule->'managedSelection'->>'documentId'=$6
                   AND rule->'managedSelection'->>'versionId'=$7
               ))
             ORDER BY (task.conversation_key=$5) DESC, task.created_at DESC, task.request_id DESC
             LIMIT 1",
            &[
                &scope.organization.to_string(),
                &scope.company.to_string(),
                &scope.actor,
                &source.checksum,
                &conversation_key,
                &source.document_id,
                &source.version_id,
            ],
        )
        .await
        .map_err(ApiError::internal)?;
    Ok(row.map(|row| row.get("request_id")))
}

pub(super) fn has_selection(preparation: &Value) -> bool {
    preparation["files"].as_array().is_some_and(|files| {
        files
            .iter()
            .any(|file| file.get("managedSelection").is_some())
    })
}

fn invalid_reference() -> ApiError {
    ApiError::BadRequest("invalid managed import source reference".into())
}

fn unavailable() -> ApiError {
    ApiError::NotFound("the exact selected document version is unavailable".into())
}

fn selection_id(selection: &Value, field: &str) -> Result<u64, ApiError> {
    selection[field]
        .as_str()
        .and_then(|value| {
            value
                .parse::<u64>()
                .ok()
                .filter(|id| id.to_string() == value)
        })
        .filter(|id| *id > 0)
        .ok_or_else(invalid_reference)
}

pub(super) async fn verify_submission(
    state: &AppState,
    session: &ApiSession,
    company_id: u64,
    preparation: &Value,
    originals: &[Original],
) -> Result<(), ApiError> {
    if !has_selection(preparation) {
        return Ok(());
    }
    let [rule] = preparation["files"]
        .as_array()
        .ok_or_else(invalid_reference)?
        .as_slice()
    else {
        return Err(invalid_reference());
    };
    let [original] = originals else {
        return Err(invalid_reference());
    };
    if rule["fileName"] != original.file_name || rule["sourceSha256"] != original.sha256 {
        return Err(invalid_reference());
    }

    let selection = &rule["managedSelection"];
    let document_id = selection_id(selection, "documentId")?;
    let version_id = selection_id(selection, "versionId")?;
    let current = selection["current"]
        .as_bool()
        .ok_or_else(invalid_reference)?;
    let (source, blob) = read_authorized_spreadsheet_source(
        state,
        session,
        Some(company_id),
        document_id,
        (!current).then_some(version_id),
        Some(&original.sha256),
    )
    .await?;
    if source.version_id != version_id.to_string()
        || blob.checksum != original.sha256
        || blob.bytes != original.bytes
        || blob.inspection.file_name != original.file_name
        || (original.file_name.to_ascii_lowercase().ends_with(".xlsx")
            != (blob.content_type == crate::spreadsheet::XLSX_CONTENT_TYPE))
    {
        return Err(unavailable());
    }
    Ok(())
}
