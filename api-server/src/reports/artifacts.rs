//! Persistence and lookup helpers for immutable owner-report artifacts.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{error::ApiError, reports::service::ReportPreview, state::AppState};

#[derive(Debug, serde::Deserialize)]
pub(crate) struct RecordedOwnerReport {
    pub id: u64,
    pub document_id: u64,
    #[serde(alias = "outputHash")]
    pub output_hash: String,
    #[serde(alias = "artifactKey")]
    pub artifact_key: String,
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
    let artifact_path = artifact_path(&state.config.report_artifact_dir, &artifact_key)?;
    persist_artifact(&artifact_path, pdf)?;
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
    let result = client
        .call_reducer(stdb_client::reducer_call!(
            "record_generated_owner_report",
            json!([organization_id, company_id, params]),
        ))
        .await
        .map_err(|error| ApiError::Internal(format!("record generated owner report: {error}")));
    if result.is_err() {
        let _ = fs::remove_file(&artifact_path);
    }
    result?;
    let correlation_sql = correlation_id.replace('\'', "''");
    let rows = client
        .query_sql(&format!(
            "SELECT id, document_id, output_hash, artifact_key FROM generated_owner_report WHERE organization_id = {organization_id} AND correlation_id = '{correlation_sql}' LIMIT 1"
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
        if should_remove_new_artifact(&recorded.artifact_key, &artifact_key) {
            let _ = fs::remove_file(&artifact_path);
        }
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

fn should_remove_new_artifact(stored_artifact_key: &str, new_artifact_key: &str) -> bool {
    stored_artifact_key != new_artifact_key
}

pub(crate) fn artifact_path(root: &Path, artifact_key: &str) -> Result<PathBuf, ApiError> {
    if !artifact_key.ends_with(".pdf") || artifact_key.contains('/') || artifact_key.contains('\\')
    {
        return Err(ApiError::Internal("invalid report artifact key".into()));
    }
    Ok(root.join(artifact_key))
}

fn persist_artifact(path: &Path, bytes: &[u8]) -> Result<(), ApiError> {
    let directory = path
        .parent()
        .ok_or_else(|| ApiError::Internal("report artifact path has no parent".into()))?;
    fs::create_dir_all(directory).map_err(|error| {
        ApiError::Internal(format!("create report artifact directory: {error}"))
    })?;
    if path.exists() {
        return Ok(());
    }
    fs::write(path, bytes)
        .map_err(|error| ApiError::Internal(format!("write report artifact: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn persist_artifact_writes_initial_bytes_and_creates_directory() {
        let temp = TempArtifactDir::new();
        let path = temp.path.join("nested/report.pdf");
        persist_artifact(&path, b"first PDF").expect("initial artifact write");
        assert_eq!(
            fs::read(&path).expect("artifact should exist"),
            b"first PDF"
        );
    }

    #[test]
    fn persist_artifact_keeps_existing_file_contents() {
        let temp = TempArtifactDir::new();
        let path = temp.path.join("report.pdf");
        persist_artifact(&path, b"first PDF").expect("initial artifact write");
        persist_artifact(&path, b"second PDF").expect("existing artifact should be accepted");
        assert_eq!(
            fs::read(&path).expect("artifact should exist"),
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

    #[test]
    fn hash_conflict_cleanup_targets_only_a_new_artifact() {
        assert!(should_remove_new_artifact("old.pdf", "new.pdf"));
        assert!(!should_remove_new_artifact("same.pdf", "same.pdf"));
    }
}
