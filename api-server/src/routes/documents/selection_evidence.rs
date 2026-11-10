//! Current, bounded spreadsheet evidence for a read-only assistant turn.
use std::sync::Arc;

use axum::{extract::State, http::header, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    document_blobs::read_authorized_spreadsheet_source,
    error::ApiError,
    spreadsheet::{Rectangle, Workbook, XLSX_CONTENT_TYPE},
    state::AppState,
    web_session::OrgSession,
};

const MAX_EVIDENCE_BYTES: usize = 8192;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Selection {
    organization_id: u64,
    company_id: u64,
    document_id: String,
    version_id: String,
    current: bool,
    checksum: String,
    sheet_name: String,
    first_row: usize,
    last_row: usize,
    first_column: usize,
    last_column: usize,
    delimiter: Option<char>,
    encoding: Option<String>,
    header_row: Option<usize>,
}

fn invalid() -> ApiError {
    ApiError::BadRequest("Select a smaller valid spreadsheet range for the assistant".into())
}

fn positive_id(value: &str) -> Result<u64, ApiError> {
    value
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0 && id.to_string() == value)
        .ok_or_else(invalid)
}

pub(super) async fn read(
    State(state): State<Arc<AppState>>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Json(selection): Json<Selection>,
) -> Result<([(header::HeaderName, &'static str); 1], Json<Value>), ApiError> {
    if selection.organization_id != organization_id || selection.company_id == 0 {
        return Err(ApiError::Forbidden(
            "Spreadsheet evidence scope mismatch".into(),
        ));
    }
    let document_id = positive_id(&selection.document_id)?;
    let version_id = positive_id(&selection.version_id)?;
    let row_start = selection.first_row.checked_sub(1).ok_or_else(invalid)?;
    let column_start = selection.first_column.checked_sub(1).ok_or_else(invalid)?;
    let row_count = selection
        .last_row
        .checked_sub(row_start)
        .ok_or_else(invalid)?;
    let column_count = selection
        .last_column
        .checked_sub(column_start)
        .ok_or_else(invalid)?;
    if selection.sheet_name.is_empty()
        || selection.sheet_name.len() > 255
        || selection.sheet_name.chars().any(char::is_control)
        || selection
            .header_row
            .is_some_and(|row| row == 0 || row > selection.first_row)
    {
        return Err(invalid());
    }
    let rectangle = Rectangle {
        row_start,
        row_count,
        column_start,
        column_count,
    };
    rectangle.validate_request()?;
    let (source, blob) = read_authorized_spreadsheet_source(
        &state,
        &session,
        Some(selection.company_id),
        document_id,
        (!selection.current).then_some(version_id),
        Some(&selection.checksum),
    )
    .await?;
    if source.version_id != selection.version_id {
        return Err(ApiError::Conflict("Spreadsheet version changed".into()));
    }

    let workbook = if blob.content_type == XLSX_CONTENT_TYPE {
        if selection.delimiter.is_some() || selection.encoding.is_some() {
            return Err(invalid());
        }
        Workbook::read(&blob.content_type, blob.bytes).await?
    } else {
        let encoding = selection.encoding.as_deref().ok_or_else(invalid)?;
        let delimiter = selection.delimiter.ok_or_else(invalid)?;
        Workbook::read_csv_selection(&blob.bytes, encoding, delimiter)?
    };
    let sheet = workbook.sheet_named(&selection.sheet_name)?;
    let cells = sheet.range(&source, rectangle).assistant_cells(rectangle)?;
    let headings = if let Some(row) = selection.header_row {
        let header = Rectangle {
            row_start: row - 1,
            row_count: 1,
            ..rectangle
        };
        sheet.range(&source, header).assistant_cells(header)?
    } else {
        Vec::new()
    };
    let evidence = json!({
        "organizationId": organization_id.to_string(),
        "companyId": selection.company_id.to_string(),
        "documentId": source.document_id,
        "versionId": source.version_id,
        "checksum": source.checksum,
        "sheetName": selection.sheet_name,
        "firstRow": selection.first_row,
        "lastRow": selection.last_row,
        "firstColumn": selection.first_column,
        "lastColumn": selection.last_column,
        "delimiter": selection.delimiter,
        "encoding": selection.encoding,
        "headerRow": selection.header_row,
        "headings": headings,
        "cells": cells,
    });
    if serde_json::to_vec(&evidence)
        .map_err(ApiError::internal)?
        .len()
        > MAX_EVIDENCE_BYTES
    {
        return Err(invalid());
    }
    Ok((
        [(header::CACHE_CONTROL, "private, no-store")],
        Json(evidence),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spreadsheet_request_accepts_only_an_exact_reference() {
        let payload = json!({
            "organizationId": 7, "companyId": 3,
            "documentId": "9007199254740993", "versionId": "15",
            "current": false, "checksum": "a".repeat(64), "sheetName": "CSV",
            "firstRow": 2, "lastRow": 3, "firstColumn": 1, "lastColumn": 1,
            "delimiter": ";", "encoding": "windows-1252", "headerRow": 1,
        });
        let selection: Selection = serde_json::from_value(payload.clone()).unwrap();
        assert_eq!(
            positive_id(&selection.document_id).unwrap(),
            9_007_199_254_740_993
        );
        assert!(positive_id("01").is_err());
        let mut forged = payload;
        forged["cells"] = json!([["forged"]]);
        assert!(serde_json::from_value::<Selection>(forged).is_err());
    }

    #[test]
    fn spreadsheet_selection_excludes_cells_outside_the_rectangle() {
        let source = crate::spreadsheet::Source {
            document_id: "9".into(),
            version_id: "12".into(),
            checksum: "a".repeat(64),
        };
        let workbook =
            Workbook::read_csv_selection(b"unsafe;display\n=1+1;0007\n", "utf-8", ';').unwrap();
        let sheet = workbook.sheet_named("CSV").unwrap();
        let selected = Rectangle {
            row_start: 1,
            row_count: 1,
            column_start: 1,
            column_count: 1,
        };
        let cells = sheet
            .range(&source, selected)
            .assistant_cells(selected)
            .unwrap();
        assert_eq!(cells[0]["value"], "0007");
        assert_eq!(cells[0]["row"], 2);
        assert_eq!(cells[0]["column"], 2);
        let unsafe_cell = Rectangle {
            column_start: 0,
            ..selected
        };
        assert!(sheet
            .range(&source, unsafe_cell)
            .assistant_cells(unsafe_cell)
            .is_err());
    }
}
