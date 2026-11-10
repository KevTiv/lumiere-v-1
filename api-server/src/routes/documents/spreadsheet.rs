//! Authenticated, exact-version metadata and bounded spreadsheet reads.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use tokio::sync::Semaphore;

use crate::{
    document_blobs::read_authorized_spreadsheet,
    error::ApiError,
    spreadsheet::{Direction, Position, Rectangle, Source, Workbook},
    state::AppState,
    web_session::OrgSession,
};

static SEARCH_SLOTS: Semaphore = Semaphore::const_new(4);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Scope {
    organization_id: Option<u64>,
    company_id: Option<u64>,
    checksum: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RangeQuery {
    sheet_id: String,
    row_start: usize,
    row_count: usize,
    column_start: usize,
    column_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SearchQuery {
    sheet_id: String,
    query: String,
    after_row: Option<usize>,
    after_column: Option<usize>,
    #[serde(default)]
    direction: Direction,
}

pub(super) async fn metadata(
    State(state): State<Arc<AppState>>,
    Path(path): Path<(u64, String)>,
    Query(scope): Query<Scope>,
    session: OrgSession,
) -> Result<Response, ApiError> {
    let (source, workbook) = open(&state, path, session, scope).await?;
    Ok(private(Json(workbook.metadata(&source)).into_response()))
}

pub(super) async fn range(
    State(state): State<Arc<AppState>>,
    Path(path): Path<(u64, String)>,
    Query(scope): Query<Scope>,
    Query(query): Query<RangeQuery>,
    session: OrgSession,
) -> Result<Response, ApiError> {
    let rectangle = Rectangle {
        row_start: query.row_start,
        row_count: query.row_count,
        column_start: query.column_start,
        column_count: query.column_count,
    };
    rectangle.validate_request()?;
    let (source, workbook) = open(&state, path, session, scope).await?;
    let data = workbook
        .sheet(&query.sheet_id)?
        .range(&source, rectangle)
        .to_bytes()?;
    let response = match data {
        Some(data) => ([(header::CONTENT_TYPE, "application/json")], data).into_response(),
        None => (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({
                "code": "range_too_large",
                "error": "Spreadsheet range exceeds 8 MiB",
            })),
        )
            .into_response(),
    };
    Ok(private(response))
}

pub(super) async fn search(
    State(state): State<Arc<AppState>>,
    Path(path): Path<(u64, String)>,
    Query(scope): Query<Scope>,
    Query(query): Query<SearchQuery>,
    session: OrgSession,
) -> Result<Response, ApiError> {
    if query.query.trim().is_empty() || query.query.len() > 256 {
        return Err(ApiError::BadRequest(
            "Invalid spreadsheet search text".into(),
        ));
    }
    let cursor = match (query.after_row, query.after_column) {
        (Some(row), Some(column)) => Some(Position { row, column }),
        (None, None) => None,
        _ => {
            return Err(ApiError::BadRequest(
                "Incomplete spreadsheet search cursor".into(),
            ))
        }
    };
    let (source, workbook) = open(&state, path, session, scope).await?;
    let slot = SEARCH_SLOTS
        .try_acquire()
        .map_err(|_| ApiError::Unavailable("Spreadsheet search is busy; retry shortly".into()))?;
    let result = tokio::task::spawn_blocking(move || {
        let _slot = slot;
        let result =
            workbook
                .sheet(&query.sheet_id)?
                .search(&source, &query.query, cursor, query.direction);
        serde_json::to_value(result).map_err(ApiError::internal)
    })
    .await
    .map_err(ApiError::internal)??;
    Ok(private(Json(result).into_response()))
}

async fn open(
    state: &AppState,
    (document_id, version): (u64, String),
    session: OrgSession,
    scope: Scope,
) -> Result<(Source, Arc<Workbook>), ApiError> {
    if scope
        .organization_id
        .is_some_and(|id| id != session.organization_id)
    {
        return Err(ApiError::Forbidden(
            "Spreadsheet organization mismatch".into(),
        ));
    }
    if document_id == 0 || scope.company_id == Some(0) {
        return Err(ApiError::BadRequest("Invalid spreadsheet source ID".into()));
    }
    let version_id = if version == "current" {
        None
    } else {
        Some(
            version
                .parse::<u64>()
                .ok()
                .filter(|id| *id > 0)
                .ok_or_else(|| ApiError::BadRequest("Invalid spreadsheet version ID".into()))?,
        )
    };
    read_authorized_spreadsheet(
        state,
        &session.session,
        scope.company_id,
        document_id,
        version_id,
        scope.checksum.as_deref(),
    )
    .await
    .map_err(|error| match error {
        ApiError::BadRequest(message)
            if message.starts_with("workbook inspection rejected the file:") =>
        {
            ApiError::Unprocessable(message)
        }
        error => error,
    })
}

fn private(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response
}
