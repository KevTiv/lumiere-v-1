//! CSV import mapping analysis and preview endpoints.

use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{
    error::{AppError, AppResult},
    skills::{
        analyze_import_mapping, parse_csv_text, preview_import_mapping, scan_csv_content,
        ImportAnalyzeRequest, ImportAnalyzeResponse, ImportPreviewRequest, ImportPreviewResponse,
    },
};

#[derive(Debug, Deserialize)]
pub struct GatewayImportAnalyzeRequest {
    pub target_entity: String,
    #[serde(default)]
    pub headers: Vec<String>,
    #[serde(default)]
    pub sample_rows: Vec<Vec<String>>,
    #[serde(default)]
    pub prior_mappings: Map<String, Value>,
    #[serde(default)]
    pub csv_text: Option<String>,
    #[serde(default)]
    pub bundle_key: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GatewayImportAnalyzeResponse {
    #[serde(flatten)]
    pub analysis: ImportAnalyzeResponse,
}

#[derive(Debug, Deserialize)]
pub struct GatewayImportPreviewRequest {
    pub target_entity: String,
    #[serde(default)]
    pub headers: Vec<String>,
    #[serde(default)]
    pub rows: Vec<Vec<String>>,
    #[serde(default)]
    pub mapping: Map<String, Value>,
    pub max_rows: Option<usize>,
    #[serde(default)]
    pub csv_text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GatewayImportPreviewResponse {
    #[serde(flatten)]
    pub preview: ImportPreviewResponse,
}

fn resolve_csv_input(
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
    csv_text: Option<String>,
) -> Result<(Vec<String>, Vec<Vec<String>>), AppError> {
    if let Some(csv_text) = csv_text.filter(|text| !text.trim().is_empty()) {
        parse_csv_text(&csv_text).map_err(|message| AppError::BadRequest(message))
    } else if headers.is_empty() {
        Err(AppError::BadRequest(
            "headers or csv_text is required".into(),
        ))
    } else {
        Ok((headers, rows))
    }
}

fn ensure_safe_for_ai(headers: &[String], rows: &[Vec<String>]) -> Result<(), AppError> {
    let safety = scan_csv_content(headers, rows);
    if safety.is_safe_for_ai {
        return Ok(());
    }
    Err(AppError::BadRequest(format!(
        "csv content failed safety scan: {} blocked cell(s)",
        safety.blocked_cell_count
    )))
}

pub async fn post_analyze(
    Json(req): Json<GatewayImportAnalyzeRequest>,
) -> AppResult<Json<GatewayImportAnalyzeResponse>> {
    let target_entity = req.target_entity.trim();
    if target_entity.is_empty() {
        return Err(AppError::BadRequest("target_entity is required".into()));
    }

    let (headers, sample_rows) = resolve_csv_input(req.headers, req.sample_rows, req.csv_text)?;
    ensure_safe_for_ai(&headers, &sample_rows)?;

    let analysis = analyze_import_mapping(ImportAnalyzeRequest {
        target_entity: target_entity.to_string(),
        headers,
        sample_rows,
        prior_mappings: req.prior_mappings,
        bundle_key: req.bundle_key,
    })
    .map_err(AppError::BadRequest)?;

    Ok(Json(GatewayImportAnalyzeResponse { analysis }))
}

pub async fn post_preview(
    Json(req): Json<GatewayImportPreviewRequest>,
) -> AppResult<Json<GatewayImportPreviewResponse>> {
    let target_entity = req.target_entity.trim();
    if target_entity.is_empty() {
        return Err(AppError::BadRequest("target_entity is required".into()));
    }
    if req.mapping.is_empty() {
        return Err(AppError::BadRequest("mapping is required".into()));
    }

    let (headers, rows) = resolve_csv_input(req.headers, req.rows, req.csv_text)?;
    ensure_safe_for_ai(&headers, &rows)?;

    let preview = preview_import_mapping(ImportPreviewRequest {
        target_entity: target_entity.to_string(),
        headers,
        rows,
        mapping: req.mapping,
        max_rows: req.max_rows,
    })
    .map_err(AppError::BadRequest)?;

    Ok(Json(GatewayImportPreviewResponse { preview }))
}
