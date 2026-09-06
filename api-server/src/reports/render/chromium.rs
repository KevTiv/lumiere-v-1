//! Chromium transport for owner-report PDF rendering.
use super::super::service::ReportPreview;
use super::{preview_key, render_html};
use crate::{error::ApiError, state::AppState};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChromiumRenderRequest<'a> {
    html: String,
    filename: &'a str,
    media: &'static str,
}

pub async fn render_pdf(state: &AppState, preview: &ReportPreview) -> Result<Vec<u8>, ApiError> {
    let url =
        state.config.report_renderer_url.as_deref().ok_or_else(|| {
            ApiError::Unavailable("owner-report renderer is not configured".into())
        })?;
    let filename = format!("{}.pdf", preview_key(preview));
    let response = state
        .http
        .post(format!("{}/v1/render/pdf", url.trim_end_matches('/')))
        .json(&ChromiumRenderRequest {
            html: render_html(preview),
            filename: &filename,
            media: "print",
        })
        .send()
        .await
        .map_err(|error| {
            ApiError::Unavailable(format!("owner-report renderer request failed: {error}"))
        })?;
    if !response.status().is_success() {
        return Err(ApiError::Unavailable(format!(
            "owner-report renderer returned {}",
            response.status()
        )));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !content_type.starts_with("application/pdf") {
        return Err(ApiError::Internal(
            "owner-report renderer returned a non-PDF response".into(),
        ));
    }
    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|error| ApiError::Unavailable(format!("failed to read rendered PDF: {error}")))
}
