//! Persistence and lookup helpers for immutable owner-report artifacts.

use std::path::{Path, PathBuf};

use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use crate::{
    config::{ReportArtifactS3Config, ReportArtifactStoreConfig},
    error::ApiError,
    reports::service::ReportPreview,
    state::AppState,
};

#[derive(Debug, serde::Deserialize)]
pub(crate) struct RecordedOwnerReport {
    pub id: u64,
    pub document_id: u64,
    #[serde(alias = "outputHash")]
    pub output_hash: String,
}

pub(crate) async fn record_generated_report(
    state: &AppState,
    client: &stdb_client::StdbClient,
    organization_id: u64,
    preview: &ReportPreview,
    pdf: &[u8],
    correlation_suffix: Option<&str>,
) -> Result<RecordedOwnerReport, ApiError> {
    let value = serde_json::to_value(preview)
        .map_err(|error| ApiError::Internal(format!("serialize generated report: {error}")))?;
    let report_key = value["reportKey"]
        .as_str()
        .ok_or_else(|| ApiError::Internal("typed report did not include reportKey".into()))?;
    let company_id = value["scope"]["companyId"]
        .as_u64()
        .ok_or_else(|| ApiError::Internal("typed report did not include scope.companyId".into()))?;
    let output_hash = hex::encode(Sha256::digest(pdf));
    let artifact_key = format!("{output_hash}.pdf");
    put_artifact(&state.config.report_artifact_store, &artifact_key, pdf).await?;
    let correlation_id = match correlation_suffix {
        Some(suffix) => format!("owner-report:{report_key}:{suffix}"),
        None => format!("owner-report:{report_key}:{}", &output_hash[..16]),
    };
    let params = json!({
        "report_key": report_key,
        "schema_version": value["schemaVersion"].as_u64().unwrap_or(1),
        "parameters_json": json!({ "scope": value["scope"] }).to_string(),
        "source_watermark_json": value["sourceWatermark"].to_string(),
        "output_hash": format!("sha256:{output_hash}"),
        "renderer_version": "chromium-worker-v1",
        "artifact_key": artifact_key,
        "artifact_size": pdf.len(),
        "correlation_id": correlation_id,
        "metadata": json!({ "watermark": value["watermark"] }).to_string(),
    });
    client
        .call_reducer(stdb_client::reducer_call!(
            "record_generated_owner_report",
            json!([organization_id, company_id, params]),
        ))
        .await
        .map_err(|error| ApiError::Internal(format!("record generated owner report: {error}")))?;
    let correlation_sql = correlation_id.replace('\'', "''");
    let rows = client
        .query_sql(&format!(
            "SELECT id, document_id, output_hash FROM generated_owner_report WHERE organization_id = {organization_id} AND correlation_id = '{correlation_sql}' LIMIT 1"
        ))
        .await
        .map_err(|error| ApiError::Internal(format!("read generated owner report: {error}")))?;
    let row = rows
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::Internal("generated owner report was not persisted".into()))?;
    let recorded: RecordedOwnerReport = serde_json::from_value(row).map_err(|error| {
        ApiError::Internal(format!("invalid generated owner report row: {error}"))
    })?;
    let expected_output_hash = format!("sha256:{output_hash}");
    if correlation_hash_decision(&recorded.output_hash, &expected_output_hash)
        == CorrelationHashDecision::Conflict
    {
        return Err(ApiError::Conflict(
            "owner-report correlation already points to a different output".into(),
        ));
    }
    Ok(recorded)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CorrelationHashDecision {
    Same,
    Conflict,
}

fn correlation_hash_decision(stored: &str, expected: &str) -> CorrelationHashDecision {
    if stored == expected {
        CorrelationHashDecision::Same
    } else {
        CorrelationHashDecision::Conflict
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArtifactPut {
    Created,
    Existing,
}

pub(crate) fn artifact_path(root: &Path, artifact_key: &str) -> Result<PathBuf, ApiError> {
    if !artifact_key.ends_with(".pdf") || artifact_key.contains('/') || artifact_key.contains('\\')
    {
        return Err(ApiError::Internal("invalid report artifact key".into()));
    }
    Ok(root.join(artifact_key))
}

async fn put_artifact(
    store: &ReportArtifactStoreConfig,
    artifact_key: &str,
    bytes: &[u8],
) -> Result<ArtifactPut, ApiError> {
    match store {
        ReportArtifactStoreConfig::Disabled => Err(disabled_store_error()),
        ReportArtifactStoreConfig::Local { root } => {
            let path = artifact_path(root, artifact_key)?;
            let directory = path
                .parent()
                .ok_or_else(|| ApiError::Internal("report artifact path has no parent".into()))?;
            tokio::fs::create_dir_all(directory)
                .await
                .map_err(|error| {
                    ApiError::Internal(format!("create report artifact directory: {error}"))
                })?;
            let mut file = match tokio::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)
                .await
            {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    return Ok(ArtifactPut::Existing)
                }
                Err(error) => {
                    return Err(ApiError::Internal(format!(
                        "create report artifact: {error}"
                    )))
                }
            };
            if let Err(error) = file.write_all(bytes).await {
                drop(file);
                let _ = tokio::fs::remove_file(&path).await;
                return Err(ApiError::Internal(format!(
                    "write report artifact: {error}"
                )));
            }
            if let Err(error) = file.flush().await {
                drop(file);
                let _ = tokio::fs::remove_file(&path).await;
                return Err(ApiError::Internal(format!(
                    "flush report artifact: {error}"
                )));
            }
            Ok(ArtifactPut::Created)
        }
        ReportArtifactStoreConfig::S3(config) => {
            if artifact_exists(store, artifact_key).await? {
                return Ok(ArtifactPut::Existing);
            }
            let object_key = s3_object_key(config, artifact_key)?;
            let bucket = s3_bucket(config)?;
            let response = bucket
                .put_object_with_content_type(&object_key, bytes, "application/pdf")
                .await
                .map_err(|error| ApiError::Internal(format!("upload report artifact: {error}")))?;
            ensure_s3_success("upload report artifact", response.status_code())?;
            Ok(ArtifactPut::Created)
        }
    }
}

pub(crate) async fn read_artifact(
    store: &ReportArtifactStoreConfig,
    artifact_key: &str,
) -> Result<Option<Vec<u8>>, ApiError> {
    match store {
        ReportArtifactStoreConfig::Disabled => Err(disabled_store_error()),
        ReportArtifactStoreConfig::Local { root } => {
            let path = artifact_path(root, artifact_key)?;
            match tokio::fs::read(path).await {
                Ok(bytes) => Ok(Some(bytes)),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(error) => Err(ApiError::Internal(format!("read report artifact: {error}"))),
            }
        }
        ReportArtifactStoreConfig::S3(config) => {
            let object_key = s3_object_key(config, artifact_key)?;
            let response = s3_bucket(config)?
                .get_object(&object_key)
                .await
                .map_err(|error| {
                    ApiError::Internal(format!("download report artifact: {error}"))
                })?;
            match response.status_code() {
                200 => Ok(Some(response.to_vec())),
                404 => Ok(None),
                status => Err(s3_status_error("download report artifact", status)),
            }
        }
    }
}

pub(crate) async fn artifact_exists(
    store: &ReportArtifactStoreConfig,
    artifact_key: &str,
) -> Result<bool, ApiError> {
    match store {
        ReportArtifactStoreConfig::Disabled => Err(disabled_store_error()),
        ReportArtifactStoreConfig::Local { root } => {
            let path = artifact_path(root, artifact_key)?;
            match tokio::fs::metadata(path).await {
                Ok(metadata) => Ok(metadata.is_file()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
                Err(error) => Err(ApiError::Internal(format!(
                    "inspect report artifact: {error}"
                ))),
            }
        }
        ReportArtifactStoreConfig::S3(config) => {
            let object_key = s3_object_key(config, artifact_key)?;
            let (_, status) = s3_bucket(config)?
                .head_object(&object_key)
                .await
                .map_err(|error| ApiError::Internal(format!("inspect report artifact: {error}")))?;
            match status {
                200 => Ok(true),
                404 => Ok(false),
                status => Err(s3_status_error("inspect report artifact", status)),
            }
        }
    }
}

/// Delete an artifact only from an explicit retention/repair workflow.
///
/// Generation failures intentionally do not call this function: hash-named
/// objects can already be referenced by another report or process.
#[allow(dead_code)]
pub(crate) async fn cleanup_artifact(
    store: &ReportArtifactStoreConfig,
    artifact_key: &str,
) -> Result<(), ApiError> {
    match store {
        ReportArtifactStoreConfig::Disabled => Err(disabled_store_error()),
        ReportArtifactStoreConfig::Local { root } => {
            let path = artifact_path(root, artifact_key)?;
            match tokio::fs::remove_file(path).await {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(ApiError::Internal(format!(
                    "delete report artifact: {error}"
                ))),
            }
        }
        ReportArtifactStoreConfig::S3(config) => {
            let object_key = s3_object_key(config, artifact_key)?;
            let response = s3_bucket(config)?
                .delete_object(&object_key)
                .await
                .map_err(|error| ApiError::Internal(format!("delete report artifact: {error}")))?;
            match response.status_code() {
                200 | 204 | 404 => Ok(()),
                status => Err(s3_status_error("delete report artifact", status)),
            }
        }
    }
}

fn s3_bucket(config: &ReportArtifactS3Config) -> Result<Box<s3::Bucket>, ApiError> {
    let credentials = s3::creds::Credentials::new(
        Some(&config.access_key_id),
        Some(&config.secret_access_key),
        None,
        None,
        None,
    )
    .map_err(|error| {
        ApiError::Internal(format!("configure report artifact credentials: {error}"))
    })?;
    let region = s3::Region::Custom {
        region: config.region.clone(),
        endpoint: config.endpoint.clone(),
    };
    s3::Bucket::new(&config.bucket, region, credentials)
        .map_err(|error| ApiError::Internal(format!("configure report artifact bucket: {error}")))
}

fn s3_object_key(config: &ReportArtifactS3Config, artifact_key: &str) -> Result<String, ApiError> {
    artifact_path(Path::new(""), artifact_key)?;
    Ok(format!("{}/{}", config.prefix, artifact_key))
}

fn ensure_s3_success(operation: &str, status: u16) -> Result<(), ApiError> {
    if (200..300).contains(&status) {
        Ok(())
    } else {
        Err(s3_status_error(operation, status))
    }
}

fn s3_status_error(operation: &str, status: u16) -> ApiError {
    ApiError::Internal(format!("{operation}: object store returned HTTP {status}"))
}

fn disabled_store_error() -> ApiError {
    ApiError::Internal("report artifact storage is disabled for this process role".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ReportArtifactStoreConfig;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempArtifactDir {
        path: PathBuf,
    }

    impl TempArtifactDir {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos();
            Self {
                path: std::env::temp_dir().join(format!(
                    "lumiere-owner-report-artifacts-{}-{nonce}",
                    std::process::id()
                )),
            }
        }
    }

    impl Drop for TempArtifactDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn artifact_key_rejects_invalid_paths() {
        let root = Path::new("/tmp/reports");
        for key in [
            "report",
            "report.txt",
            "reports/report.pdf",
            "reports\\report.pdf",
        ] {
            assert!(
                artifact_path(root, key).is_err(),
                "key should be rejected: {key}"
            );
        }
    }

    #[test]
    fn artifact_path_accepts_pdf_key_without_rewriting_it() {
        let root = Path::new("/tmp/reports");
        assert_eq!(
            artifact_path(root, "0123456789abcdef.pdf").expect("valid artifact key"),
            root.join("0123456789abcdef.pdf")
        );
    }

    #[tokio::test]
    async fn local_store_persists_and_reads_report_across_store_instances() {
        let temp = TempArtifactDir::new();
        let first_store = ReportArtifactStoreConfig::Local {
            root: temp.path.clone(),
        };
        assert_eq!(
            put_artifact(&first_store, "report.pdf", b"first PDF")
                .await
                .expect("initial artifact write"),
            ArtifactPut::Created
        );
        drop(first_store);
        let restarted_store = ReportArtifactStoreConfig::Local {
            root: temp.path.clone(),
        };
        assert_eq!(
            read_artifact(&restarted_store, "report.pdf")
                .await
                .expect("artifact read after restart"),
            Some(b"first PDF".to_vec())
        );
        assert!(artifact_exists(&restarted_store, "report.pdf")
            .await
            .expect("artifact existence check"));
    }

    #[tokio::test]
    async fn local_store_keeps_existing_content_addressed_object() {
        let temp = TempArtifactDir::new();
        let store = ReportArtifactStoreConfig::Local {
            root: temp.path.clone(),
        };
        put_artifact(&store, "report.pdf", b"first PDF")
            .await
            .expect("initial artifact write");
        assert_eq!(
            put_artifact(&store, "report.pdf", b"second PDF")
                .await
                .expect("existing artifact should be accepted"),
            ArtifactPut::Existing
        );
        assert_eq!(
            fs::read(temp.path.join("report.pdf")).expect("artifact should exist"),
            b"first PDF"
        );
    }

    #[test]
    fn correlation_hash_accepts_same_hash_and_rejects_different_hash() {
        assert_eq!(
            correlation_hash_decision("sha256:abc", "sha256:abc"),
            CorrelationHashDecision::Same
        );
        assert_eq!(
            correlation_hash_decision("sha256:abc", "sha256:def"),
            CorrelationHashDecision::Conflict
        );
    }

    #[tokio::test]
    async fn cleanup_is_idempotent_for_explicit_retention_workflows() {
        let temp = TempArtifactDir::new();
        let store = ReportArtifactStoreConfig::Local {
            root: temp.path.clone(),
        };
        put_artifact(&store, "report.pdf", b"PDF")
            .await
            .expect("artifact write");
        cleanup_artifact(&store, "report.pdf")
            .await
            .expect("artifact cleanup");
        cleanup_artifact(&store, "report.pdf")
            .await
            .expect("repeat artifact cleanup");
        assert!(!artifact_exists(&store, "report.pdf")
            .await
            .expect("artifact existence check"));
    }

    #[tokio::test]
    async fn disabled_store_fails_closed() {
        let store = ReportArtifactStoreConfig::Disabled;
        assert!(put_artifact(&store, "report.pdf", b"PDF").await.is_err());
        assert!(read_artifact(&store, "report.pdf").await.is_err());
        assert!(artifact_exists(&store, "report.pdf").await.is_err());
        assert!(cleanup_artifact(&store, "report.pdf").await.is_err());
    }
}
