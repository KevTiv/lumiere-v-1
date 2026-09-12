//! Shared attachment response construction for document routes.

use crate::error::ApiError;
use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};

pub(super) fn attachment_response(
    filename: String,
    content_type: &'static str,
    body: Vec<u8>,
) -> Result<Response, ApiError> {
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(content_type)),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
                    .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
            ),
        ],
        body,
    )
        .into_response())
}
