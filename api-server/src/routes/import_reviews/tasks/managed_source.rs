//! Verify viewer selection provenance before accepting a copy into import review.
use serde_json::Value;

use crate::{
    document_blobs::read_authorized_spreadsheet_source, error::ApiError, session::ApiSession,
    state::AppState,
};

use super::Original;

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
