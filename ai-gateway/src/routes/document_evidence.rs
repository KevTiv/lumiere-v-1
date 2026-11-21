//! Metadata readback for the API server's authorized DMS ingestion.

use axum::{extract::State, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use stdb_client::StdbClient;

use crate::{error::AppError, state::AppState};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadbackRequest {
    organization_id: u64,
    company_id: u64,
    document_id: u64,
    passage: Option<PassageSelector>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PassageSelector {
    version_number: u64,
    checksum: String,
    start_byte: usize,
}

/// The gateway's internal-secret middleware authenticates the service. The API
/// server checks the actor's document scope before calling this endpoint.
pub(crate) async fn post_readback(
    State(state): State<AppState>,
    Json(request): Json<ReadbackRequest>,
) -> Result<Json<Value>, AppError> {
    let reader = state
        .spend_read_stdb
        .as_deref()
        .ok_or_else(|| AppError::Unavailable("Document evidence reader is unavailable".into()))?;
    readback(reader, request).await.map(Json)
}

async fn readback(reader: &StdbClient, request: ReadbackRequest) -> Result<Value, AppError> {
    let ReadbackRequest {
        organization_id,
        company_id,
        document_id,
        passage,
    } = request;
    if organization_id == 0 || company_id == 0 || document_id == 0 {
        return Err(AppError::BadRequest(
            "Document evidence scope is required".into(),
        ));
    }

    if let Some(passage) = passage {
        let checksum = passage.checksum.as_bytes();
        if passage.version_number == 0
            || checksum.len() != 64
            || !checksum
                .iter()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
        {
            return Err(AppError::BadRequest(
                "Invalid document version selector".into(),
            ));
        }
        let version = format!("v{}-{}", passage.version_number, &passage.checksum[..16]);
        let passage_key = format!("chars-{}", passage.start_byte);
        let passages = reader
            .query_sql_sats(&format!(
                "SELECT id, content_hash, source_version_id FROM ai_evidence_passage_read \
             WHERE organization_id = {organization_id} AND company_id = {company_id} \
             AND source_kind = 'document' AND source_key = 'document:{document_id}' \
             AND source_version = '{version}' AND passage_key = '{passage_key}' LIMIT 2"
            ))
            .await
            .map_err(readback_error)?;
        return Ok(json!({"passages": passages}));
    }

    let sources = reader
        .query_sql_sats(&format!(
            "SELECT id FROM ai_evidence_source_read WHERE organization_id = {organization_id} \
         AND company_id = {company_id} AND source_kind = 'document' \
         AND source_key = 'document:{document_id}' LIMIT 2"
        ))
        .await
        .map_err(readback_error)?;
    let source_id = match sources.as_slice() {
        [] => return Ok(json!({"sourceId": null, "versions": []})),
        [row] => row["id"]
            .as_u64()
            .or_else(|| row["id"].as_str()?.parse().ok())
            .filter(|id| *id > 0),
        _ => None,
    }
    .ok_or_else(|| AppError::Unavailable("Document evidence source is ambiguous".into()))?;
    let versions = reader.query_sql_sats(&format!(
        "SELECT id, version, status, supersedes_version_id FROM ai_evidence_source_version_read \
         WHERE organization_id = {organization_id} AND company_id = {company_id} AND source_id = {source_id}"
    )).await.map_err(readback_error)?;
    Ok(json!({"sourceId": source_id, "versions": versions}))
}

fn readback_error(error: impl std::fmt::Display) -> AppError {
    tracing::warn!(%error, "document evidence readback failed");
    AppError::Unavailable("Document evidence reader is unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::HeaderMap, routing::post, Router};

    #[tokio::test]
    async fn readback_uses_scoped_views_and_never_returns_passage_text() {
        let app =
            Router::new().route(
                "/v1/database/test/sql",
                post(|headers: HeaderMap, sql: String| async move {
                    assert_eq!(headers["authorization"], "Bearer reader-token");
                    assert!(sql.contains("organization_id = 1 AND company_id = 2"));
                    let (columns, row) = if sql.contains("FROM ai_evidence_source_read ") {
                        assert!(
                            sql.contains("source_kind = 'document' AND source_key = 'document:42'")
                        );
                        (vec![("id", "U64")], json!([13]))
                    } else if sql.contains("FROM ai_evidence_source_version_read ") {
                        assert!(sql.ends_with("source_id = 13"));
                        (
                            vec![("id", "U64"), ("version", "String")],
                            json!([21, "v3-aaaaaaaaaaaaaaaa"]),
                        )
                    } else {
                        assert!(sql.contains("FROM ai_evidence_passage_read "));
                        assert!(sql.contains("source_key = 'document:42'"));
                        assert!(sql.contains(
                            "source_version = 'v3-aaaaaaaaaaaaaaaa' AND passage_key = 'chars-9'"
                        ));
                        assert!(!sql.contains("passage_text"));
                        (
                            vec![("id", "U64"), ("content_hash", "String")],
                            json!([77, "fingerprint"]),
                        )
                    };
                    let elements: Vec<_> = columns
                        .into_iter()
                        .map(|(name, kind)| {
                            json!({
                                "name": {"some": name}, "algebraic_type": {(kind): []},
                            })
                        })
                        .collect();
                    Json(json!([{"schema": {"elements": elements}, "rows": [row]}]))
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let reader = StdbClient::new(
            format!("http://{}", listener.local_addr().unwrap()),
            "test".into(),
            "reader-token".into(),
        );
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let request = |passage| ReadbackRequest {
            organization_id: 1,
            company_id: 2,
            document_id: 42,
            passage,
        };
        assert_eq!(
            readback(&reader, request(None)).await.unwrap(),
            json!({
                "sourceId": 13, "versions": [{"id": 21, "version": "v3-aaaaaaaaaaaaaaaa"}],
            })
        );
        assert_eq!(
            readback(
                &reader,
                request(Some(PassageSelector {
                    version_number: 3,
                    checksum: "a".repeat(64),
                    start_byte: 9
                }))
            )
            .await
            .unwrap(),
            json!({
                "passages": [{"id": 77, "content_hash": "fingerprint"}],
            })
        );
        let invalid = PassageSelector {
            version_number: 3,
            checksum: "not hexadecimal".into(),
            start_byte: 9,
        };
        assert!(matches!(
            readback(&reader, request(Some(invalid))).await,
            Err(AppError::BadRequest(_))
        ));
        server.abort();
    }
}
