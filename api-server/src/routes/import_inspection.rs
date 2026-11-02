//! Original-file admission. This endpoint returns data, never a reusable grant.

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Query, State},
    http::HeaderMap,
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    error::ApiError,
    file_extraction::{inspect_xlsx, MAX_WORKBOOK_BYTES},
    query_exec::resolve_membership_company_id,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};

fn file_name(headers: &HeaderMap) -> Result<String, ApiError> {
    let encoded = headers
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= 765)
        .ok_or_else(|| ApiError::BadRequest("x-file-name is required".into()))?;
    let name = urlencoding::decode(encoded)
        .map_err(|_| ApiError::BadRequest("invalid file name".into()))?;
    if name.is_empty()
        || name.len() > 255
        || name
            .chars()
            .any(|ch| ch.is_control() || ch == '/' || ch == '\\')
    {
        return Err(ApiError::BadRequest("invalid file name".into()));
    }
    Ok(name.into_owned())
}

async fn inspect_file(
    State(state): State<Arc<AppState>>,
    Query(query): Query<InspectionQuery>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<Value>, ApiError> {
    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    let company_id = resolve_membership_company_id(
        trusted.client(),
        organization_id,
        &session.identity_hex,
        query.company_id()?,
        "cannot inspect files for another company",
    )
    .await?;
    let file_name = file_name(&headers)?;
    let lower = file_name.to_ascii_lowercase();
    let (csv_text, format, sheet_name, source_sha256, policy_version) = if lower.ends_with(".xlsx")
    {
        let extracted = inspect_xlsx(&bytes).await?;
        (
            extracted.csv_text,
            "xlsx",
            Some(extracted.sheet_name),
            extracted.source_sha256,
            extracted.policy_version,
        )
    } else if lower.ends_with(".csv") {
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| ApiError::BadRequest("csv must be UTF-8 text".into()))?;
        let inspected = lumiere_file_inspection::inspect_csv(text)
            .map_err(|error| ApiError::BadRequest(error.to_string()))?;
        (
            text.to_owned(),
            "csv",
            None,
            inspected.content_sha256,
            lumiere_file_inspection::INSPECTION_POLICY_VERSION.to_owned(),
        )
    } else {
        return Err(ApiError::BadRequest("choose a .csv or .xlsx file".into()));
    };
    let inspected = lumiere_file_inspection::inspect_csv(&csv_text)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let admission_id = crate::import_admissions::record_source_admission(
        &state.config.document_blob_store,
        organization_id,
        company_id,
        &session.identity_hex,
        &bytes,
        format,
        &inspected.dataset_sha256,
        &policy_version,
    )
    .await?;
    // Each later apply independently inspects the final CSV body and rechecks
    // scope/permissions; this response cannot authorize different bytes or actions.
    Ok(Json(
        json!({"csvText":csv_text,"headers":inspected.headers,"rows":inspected.rows,
        "format":format,"sheetName":sheet_name,"sourceSha256":source_sha256,"sourceAdmissionId":admission_id,
        "policyVersion":policy_version,"datasetSha256":inspected.dataset_sha256,
        "inspection":inspected.report,"organizationId":organization_id.to_string(),
        "companyId":company_id.to_string()}),
    ))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/import/inspect-file", post(inspect_file))
        .layer(DefaultBodyLimit::max(MAX_WORKBOOK_BYTES))
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct InspectionQuery {
    company_id: Option<String>,
}

impl InspectionQuery {
    fn company_id(&self) -> Result<Option<u64>, ApiError> {
        self.company_id
            .as_deref()
            .map(|raw| {
                raw.parse::<u64>()
                    .ok()
                    .filter(|id| *id > 0 && id.to_string() == raw)
                    .ok_or_else(|| ApiError::BadRequest("invalid companyId".into()))
            })
            .transpose()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn original_file_inspection_requires_an_authenticated_session_before_body_work() {
        use axum::{
            body::Body,
            http::{Request, StatusCode},
        };
        use tower::ServiceExt;
        use tower_cookies::CookieManagerLayer;
        let app = router()
            .layer(CookieManagerLayer::new())
            .with_state(Arc::new(AppState::new(
                crate::session::test_support::test_config(Some("authority-token")),
            )));
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/import/inspect-file?companyId=42")
                    .header("x-file-name", "book.xlsx")
                    .body(Body::from(vec![0u8; MAX_WORKBOOK_BYTES + 1]))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn requested_company_ids_are_canonical_and_bounded() {
        for value in ["0", "-1", "01", "18446744073709551616"] {
            assert!(InspectionQuery {
                company_id: Some(value.into())
            }
            .company_id()
            .is_err());
        }
        assert_eq!(
            InspectionQuery {
                company_id: Some("42".into())
            }
            .company_id()
            .unwrap(),
            Some(42)
        );
    }

    #[test]
    fn uploaded_names_are_bounded_metadata_never_paths() {
        let mut headers = HeaderMap::new();
        assert!(file_name(&headers).is_err());
        for value in ["..%2Fsecret.xlsx", "bad%00.csv", "bad%5Cfile.xlsx"] {
            headers.insert("x-file-name", value.parse().unwrap());
            assert!(file_name(&headers).is_err());
        }
        headers.insert("x-file-name", "Farm%20ledger.xlsx".parse().unwrap());
        assert_eq!(file_name(&headers).unwrap(), "Farm ledger.xlsx");
    }
}
