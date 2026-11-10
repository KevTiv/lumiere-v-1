//! Credential-free, syscall-restricted workbook extraction with bounded pipes.

use std::{process::Stdio, time::Duration};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::Semaphore,
};

use crate::error::ApiError;

pub(crate) const VIEWER_POLICY_VERSION: &str = "xlsx-viewer-seccomp-v1";
pub(crate) const XLSX_POLICY_VERSION: &str = "xlsx-static-seccomp-v1";
pub(crate) const MAX_WORKBOOK_BYTES: usize = 5_000_000;
pub(crate) const OFFICE_PREVIEW_POLICY_VERSION: &str = "office-static-seccomp-v1";
pub(crate) const XLSX_MIME: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
pub(crate) const DOCX_MIME: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_PREVIEW_OUTPUT_BYTES: u64 = 2_000_000;
const MAX_OUTPUT_BYTES: u64 = 12_500_000;
const WORKER_TIMEOUT: Duration = Duration::from_secs(8);
static EXTRACTION_SLOTS: Semaphore = Semaphore::const_new(2);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ExtractedWorkbook {
    pub csv_text: String,
    pub sheet_name: String,
    pub source_sha256: String,
    pub policy_version: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ExtractedOfficePreview {
    preview: OfficePreview,
    source_sha256: String,
    source_size: usize,
    policy_version: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", deny_unknown_fields)]
enum OfficePreview {
    #[serde(rename = "xlsx")]
    Workbook { sheets: Vec<PreviewSheet> },
    #[serde(rename = "docx")]
    Word {
        blocks: Vec<WordBlock>,
        truncated: bool,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PreviewSheet {
    name: String,
    columns: usize,
    rows: Vec<Vec<String>>,
    truncated: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
enum WordBlock {
    Paragraph { text: String },
    Table { rows: Vec<Vec<String>> },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerFailure {
    error: String,
}

/// Parse original workbook bytes; neither a browser conversion nor a caller
/// verdict can replace this boundary. No in-process fallback is permitted.
pub(crate) async fn inspect_xlsx(bytes: &[u8]) -> Result<ExtractedWorkbook, ApiError> {
    inspect_xlsx_with_script(bytes, &worker_script()).await
}

pub(crate) async fn inspect_xlsx_viewer(
    bytes: &[u8],
) -> Result<crate::spreadsheet::ExtractedSpreadsheet, ApiError> {
    let output = run_worker(bytes, &worker_script(), Some("--viewer"), MAX_OUTPUT_BYTES).await?;
    let extracted: crate::spreadsheet::ExtractedSpreadsheet = decode_result(&output)?;
    if extracted.policy_version != VIEWER_POLICY_VERSION
        || extracted.source_sha256 != hex::encode(Sha256::digest(bytes))
    {
        return Err(ApiError::Unavailable(
            "workbook inspection identity mismatch".into(),
        ));
    }
    extracted.validate()?;
    Ok(extracted)
}

async fn inspect_xlsx_with_script(
    bytes: &[u8],
    script: &str,
) -> Result<ExtractedWorkbook, ApiError> {
    let output = run_worker(bytes, script, None, MAX_OUTPUT_BYTES).await?;
    let extracted: ExtractedWorkbook = decode_result(&output)?;
    validate_result(&extracted, bytes)?;
    Ok(extracted)
}

fn worker_script() -> String {
    std::env::var("LUMIERE_WORKBOOK_EXTRACT_SCRIPT").unwrap_or_else(|_| {
        if cfg!(test) {
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../scripts/workbook-extract.py"
            )
            .into()
        } else {
            "/app/scripts/workbook-extract.py".into()
        }
    })
}

/// Extract display-only data from authorized immutable bytes.
pub(crate) async fn inspect_office_preview(
    bytes: &[u8],
    content_type: &str,
) -> Result<ExtractedOfficePreview, ApiError> {
    inspect_office_preview_with_script(bytes, content_type, &worker_script()).await
}

async fn inspect_office_preview_with_script(
    bytes: &[u8],
    content_type: &str,
    script: &str,
) -> Result<ExtractedOfficePreview, ApiError> {
    let mode = match content_type {
        XLSX_MIME => "--preview-xlsx",
        DOCX_MIME => "--preview-docx",
        _ => {
            return Err(ApiError::Unprocessable(
                "Office preview is unavailable for this type".into(),
            ))
        }
    };
    let output = run_worker(bytes, script, Some(mode), MAX_PREVIEW_OUTPUT_BYTES).await?;
    let extracted: ExtractedOfficePreview = serde_json::from_slice(&output).map_err(|_| {
        ApiError::Unavailable("Office inspection returned an invalid result".into())
    })?;
    let shape_matches = match (&extracted.preview, content_type) {
        (OfficePreview::Workbook { sheets }, XLSX_MIME) => {
            !sheets.is_empty()
                && sheets.len() <= 24
                && sheets.iter().all(|sheet| {
                    !sheet.name.trim().is_empty()
                        && sheet.name.len() <= 255
                        && sheet.columns <= 20
                        && sheet.rows.len() <= 100
                        && sheet.rows.iter().all(|row| {
                            row.len() == sheet.columns && row.iter().all(|cell| cell.len() <= 500)
                        })
                })
        }
        (OfficePreview::Word { blocks, .. }, DOCX_MIME) => {
            blocks.len() <= 200
                && blocks.iter().all(|block| match block {
                    WordBlock::Paragraph { text } => text.len() <= 4_000,
                    WordBlock::Table { rows } => {
                        rows.len() <= 100
                            && rows.iter().all(|row| {
                                !row.is_empty()
                                    && row.len() <= 20
                                    && row.iter().all(|cell| cell.len() <= 500)
                            })
                    }
                })
        }
        _ => false,
    };
    if !shape_matches
        || extracted.policy_version != OFFICE_PREVIEW_POLICY_VERSION
        || extracted.source_size != bytes.len()
        || extracted.source_sha256 != format!("{:x}", Sha256::digest(bytes))
    {
        return Err(ApiError::Unavailable(
            "Office inspection identity or shape mismatch".into(),
        ));
    }
    Ok(extracted)
}

fn decode_result<T: serde::de::DeserializeOwned>(output: &[u8]) -> Result<T, ApiError> {
    serde_json::from_slice(output)
        .map_err(|_| ApiError::Unavailable("workbook inspection returned an invalid result".into()))
}

async fn run_worker(
    bytes: &[u8],
    script: &str,
    mode: Option<&str>,
    max_output_bytes: u64,
) -> Result<Vec<u8>, ApiError> {
    if bytes.is_empty() || bytes.len() > MAX_WORKBOOK_BYTES {
        return Err(ApiError::BadRequest(
            "workbook exceeds the 5 MB input limit".into(),
        ));
    }
    let _slot = EXTRACTION_SLOTS
        .try_acquire()
        .map_err(|_| ApiError::Unavailable("workbook inspection is busy; retry shortly".into()))?;
    if !std::path::Path::new(script).is_absolute() {
        return Err(ApiError::Unavailable(
            "workbook inspection is unavailable".into(),
        ));
    }
    let mut child = Command::new("/usr/bin/python3")
        .args(["-I", "-S", script])
        .args(mode)
        .env_clear()
        .current_dir("/")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| ApiError::Unavailable("workbook inspection is unavailable".into()))?;
    let mut input = child
        .stdin
        .take()
        .ok_or_else(|| ApiError::Unavailable("workbook inspection is unavailable".into()))?;
    let output = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::Unavailable("workbook inspection is unavailable".into()))?;
    let errors = child
        .stderr
        .take()
        .ok_or_else(|| ApiError::Unavailable("workbook inspection is unavailable".into()))?;
    let task = async {
        let send = async {
            // A rejected worker may close stdin before consuming all bytes.
            // Preserve its bounded status response rather than exposing a pipe error.
            if let Err(error) = input.write_all(bytes).await {
                if error.kind() != std::io::ErrorKind::BrokenPipe {
                    return Err(error);
                }
            }
            drop(input);
            Ok::<_, std::io::Error>(())
        };
        let receive = async {
            let mut value = Vec::new();
            output
                .take(max_output_bytes + 1)
                .read_to_end(&mut value)
                .await?;
            if value.len() as u64 > max_output_bytes {
                return Err(std::io::Error::other("worker output limit"));
            }
            Ok::<_, std::io::Error>(value)
        };
        let diagnostics = async {
            let mut value = Vec::new();
            errors.take(4097).read_to_end(&mut value).await?;
            if value.len() > 4096 {
                return Err(std::io::Error::other("worker diagnostic limit"));
            }
            Ok::<_, std::io::Error>(())
        };
        tokio::try_join!(send, receive, diagnostics, child.wait())
    };
    let result = tokio::time::timeout(WORKER_TIMEOUT, task).await;
    let (_, output, _, status) = match result {
        Ok(Ok(result)) => result,
        _ => {
            let _ = child.kill().await;
            return Err(ApiError::Unavailable(
                "workbook inspection did not complete".into(),
            ));
        }
    };
    if !status.success() {
        let reason = serde_json::from_slice::<WorkerFailure>(&output).ok();
        if status.code() == Some(65)
            && reason.as_ref().is_some_and(|failure| {
                !failure.error.is_empty()
                    && failure.error.len() <= 100
                    && failure
                        .error
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
            })
        {
            return Err(ApiError::BadRequest(format!(
                "workbook inspection rejected the file: {}",
                reason.map(|r| r.error).unwrap_or_default()
            )));
        }
        return Err(ApiError::Unavailable(
            "workbook isolation is unavailable".into(),
        ));
    }
    Ok(output)
}

fn validate_result(result: &ExtractedWorkbook, source: &[u8]) -> Result<(), ApiError> {
    let source_sha256 = format!("{:x}", Sha256::digest(source));
    if result.policy_version != XLSX_POLICY_VERSION
        || result.source_sha256 != source_sha256
        || result.sheet_name.len() > 255
        || result.csv_text.len() > lumiere_file_inspection::MAX_CONTENT_BYTES
    {
        return Err(ApiError::Unavailable(
            "workbook inspection identity mismatch".into(),
        ));
    }
    // The worker is an untrusted parser result, not an admission authority.
    lumiere_file_inspection::inspect_csv(&result.csv_text)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn real_worker_parses_bound_bytes_and_fails_closed_without_runtime() {
        let bytes = include_bytes!("../tests/fixtures/values-only.xlsx");
        let script = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../scripts/workbook-extract.py"
        );
        let result = inspect_xlsx_with_script(bytes, script).await.unwrap();
        assert_eq!(result.csv_text, "\"Name\"\n\"Acme\"\n");
        assert_eq!(result.source_sha256, format!("{:x}", Sha256::digest(bytes)));
        assert!(
            inspect_xlsx_with_script(bytes, "/nonexistent/workbook-extract.py")
                .await
                .is_err()
        );
        assert!(inspect_xlsx_with_script(b"not a workbook", script)
            .await
            .is_err());
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn office_preview_is_bound_to_its_original_format_and_bytes() {
        let bytes = include_bytes!("../tests/fixtures/values-only.xlsx");
        let script = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../scripts/workbook-extract.py"
        );
        let result = inspect_office_preview_with_script(bytes, XLSX_MIME, script)
            .await
            .unwrap();
        assert_eq!(result.source_size, bytes.len());
        assert_eq!(result.source_sha256, format!("{:x}", Sha256::digest(bytes)));
        let OfficePreview::Workbook { sheets } = result.preview else {
            panic!("expected worksheet preview");
        };
        assert_eq!(sheets[0].rows[1], ["Acme"]);
        assert!(inspect_office_preview_with_script(bytes, DOCX_MIME, script)
            .await
            .is_err());
    }

    #[test]
    fn extracted_result_is_bound_to_source_policy_and_bounded_dataset() {
        let bytes = b"original workbook";
        let mut result = ExtractedWorkbook {
            csv_text: "name\nAcme\n".into(),
            sheet_name: "Sheet 1".into(),
            source_sha256: format!("{:x}", Sha256::digest(bytes)),
            policy_version: XLSX_POLICY_VERSION.into(),
        };
        assert!(validate_result(&result, bytes).is_ok());
        assert!(validate_result(&result, b"substituted bytes").is_err());
        result.policy_version = "old-policy".into();
        assert!(validate_result(&result, bytes).is_err());
        result.policy_version = XLSX_POLICY_VERSION.into();
        result.csv_text = "name\n\"unclosed".into();
        assert!(validate_result(&result, bytes).is_err());
    }
}
