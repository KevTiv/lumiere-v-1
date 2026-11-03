//! Content eligibility is a bounded inspection result, never a grant or proof of intent.

mod csv;

pub use csv::parse_csv;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Reinspection is required when this policy changes.
pub const INSPECTION_POLICY_VERSION: &str = "file-inspection-v1";
pub const MAX_CONTENT_BYTES: usize = 2_000_000;
pub const MAX_ROWS: usize = 25_000;
pub const MAX_COLUMNS: usize = 200;
pub const MAX_CELL_CHARS: usize = 4_000;
pub const MAX_MATRIX_CELLS: usize = 1_000_000;
pub const MAX_FINDINGS: usize = 100;

/// Failures reject processing; they never mean a truncated inspection passed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InspectionError {
    #[error("csv {0}")]
    InvalidCsv(&'static str),
    #[error("content exceeds {0}")]
    LimitExceeded(&'static str),
    #[error("content contains unsupported control characters")]
    ControlCharacter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingKind {
    FormulaInjection,
    PromptInjection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InspectionFinding {
    pub location: String,
    pub kind: FindingKind,
    pub message: String,
}

/// Reports cover the supplied input only. They do not certify an unseen source file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InspectionReport {
    pub policy_version: String,
    pub source_trust: String,
    pub coverage: String,
    pub inspected_rows: usize,
    pub inspected_cells: usize,
    pub findings: Vec<InspectionFinding>,
    pub findings_truncated: bool,
    pub blocked_cell_count: usize,
    pub processing_allowed: bool,
    pub ai_allowed: bool,
}

impl InspectionReport {
    fn new(inspected_rows: usize, inspected_cells: usize) -> Self {
        Self {
            policy_version: INSPECTION_POLICY_VERSION.into(),
            source_trust: "untrusted".into(),
            coverage: "complete_supplied_input".into(),
            inspected_rows,
            inspected_cells,
            findings: Vec::new(),
            findings_truncated: false,
            blocked_cell_count: 0,
            processing_allowed: true,
            ai_allowed: true,
        }
    }

    fn finding(&mut self, location: &str, kind: FindingKind, message: &str) {
        if self.findings.len() < MAX_FINDINGS {
            self.findings.push(InspectionFinding {
                location: location.to_owned(),
                kind,
                message: message.to_owned(),
            });
        } else {
            self.findings_truncated = true;
        }
        self.ai_allowed = false;
    }
}

/// Parsed representation and hashes are produced together by the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InspectedCsv {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub content_sha256: String,
    pub dataset_sha256: String,
    pub report: InspectionReport,
}

/// Inspect every accepted CSV cell and bind the result to the exact bytes and dataset.
///
/// # Errors
/// Rejects malformed CSV, unsupported controls and any exceeded resource budget.
pub fn inspect_csv(text: &str) -> Result<InspectedCsv, InspectionError> {
    let (headers, rows) = parse_csv(text)?;
    let report = inspect_matrix(&headers, &rows)?;
    let dataset_sha256 = matrix_sha256(&headers, &rows);
    Ok(InspectedCsv {
        headers,
        rows,
        content_sha256: format!("{:x}", Sha256::digest(text.as_bytes())),
        dataset_sha256,
        report,
    })
}

/// Inspect all supplied matrix rows, including JSON input that bypasses CSV parsing.
///
/// # Errors
/// Rejects malformed matrix shapes, unsupported controls and exceeded resource budgets.
pub fn inspect_matrix(
    headers: &[String],
    rows: &[Vec<String>],
) -> Result<InspectionReport, InspectionError> {
    validate_matrix(headers, rows)?;
    let cells = headers.len() + rows.iter().map(Vec::len).sum::<usize>();
    let mut report = InspectionReport::new(rows.len(), cells);
    for (index, header) in headers.iter().enumerate() {
        inspect_cell(&mut report, &format!("header[{index}]"), header);
    }
    for (row_index, row) in rows.iter().enumerate() {
        for (column_index, value) in row.iter().enumerate() {
            inspect_cell(
                &mut report,
                &format!("row[{row_index}].col[{column_index}]"),
                value,
            );
        }
    }
    Ok(report)
}

fn inspect_cell(report: &mut InspectionReport, location: &str, value: &str) {
    let formula = is_formula_injection(value);
    let prompt = has_prompt_injection(value);
    if formula || prompt {
        report.blocked_cell_count += 1;
    }
    if formula {
        report.finding(
            location,
            FindingKind::FormulaInjection,
            "cell contains a spreadsheet formula prefix",
        );
    }
    if prompt {
        report.finding(
            location,
            FindingKind::PromptInjection,
            "content contains instruction-like text; AI assistance is withheld",
        );
    }
}

/// Inspect bounded document text without pretending it is a spreadsheet cell.
///
/// # Errors
/// Rejects oversized input and unsupported control characters.
pub fn inspect_text(text: &str) -> Result<InspectionReport, InspectionError> {
    validate_content_bytes(text.len())?;
    validate_controls(text)?;
    let mut report = InspectionReport::new(text.lines().count(), 1);
    if has_prompt_injection(text) {
        report.blocked_cell_count = 1;
        report.finding(
            "text",
            FindingKind::PromptInjection,
            "content contains instruction-like text; AI assistance is withheld",
        );
    }
    Ok(report)
}

/// Detect known instruction patterns. A negative result does not establish benign intent.
pub fn has_prompt_injection(value: &str) -> bool {
    let normalized: String = value
        .chars()
        .filter(|ch| !matches!(ch, '\u{200b}'..='\u{200f}' | '\u{2060}' | '\u{feff}'))
        .flat_map(char::to_lowercase)
        .collect();
    [
        "ignore previous instructions",
        "ignore all previous",
        "system:",
        "assistant:",
        "you are now",
        "disregard prior",
        "<|im_start|>",
        "developer mode",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

/// Signed numbers and plain international phone values are data, not formulas.
/// Exporters must still serialize string values as inert strings independently.
pub fn is_formula_injection(value: &str) -> bool {
    let trimmed = value.trim_start_matches(|ch: char| {
        ch.is_whitespace() || matches!(ch, '\u{200b}'..='\u{200f}' | '\u{2060}' | '\u{feff}')
    });
    let Some(first) = trimmed.chars().next() else {
        return false;
    };
    if matches!(first, '+' | '-') {
        if trimmed.parse::<f64>().is_ok_and(f64::is_finite) {
            return false;
        }
        if first == '+'
            && trimmed
                .chars()
                .skip(1)
                .all(|ch| ch.is_ascii_digit() || matches!(ch, ' ' | '(' | ')' | '-'))
            && trimmed.bytes().filter(u8::is_ascii_digit).count() >= 4
        {
            return false;
        }
    }
    matches!(
        first,
        '=' | '+' | '-' | '@' | '|' | '＝' | '＋' | '－' | '＠'
    )
}

/// Stable length-prefixed digest of the parsed values, including row boundaries.
pub fn matrix_sha256(headers: &[String], rows: &[Vec<String>]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"lumiere-csv-dataset-v1\0");
    digest.update((rows.len() as u64).to_be_bytes());
    for row in std::iter::once(headers).chain(rows.iter().map(Vec::as_slice)) {
        digest.update((row.len() as u64).to_be_bytes());
        for value in row {
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value.as_bytes());
        }
    }
    format!("{:x}", digest.finalize())
}

pub(crate) fn validate_content_bytes(bytes: usize) -> Result<(), InspectionError> {
    if bytes > MAX_CONTENT_BYTES {
        return Err(InspectionError::LimitExceeded("2000000 UTF-8 bytes"));
    }
    Ok(())
}

pub(crate) fn validate_controls(value: &str) -> Result<(), InspectionError> {
    if value
        .chars()
        .any(|ch| ch.is_control() && !matches!(ch, '\t' | '\r' | '\n'))
    {
        return Err(InspectionError::ControlCharacter);
    }
    Ok(())
}

fn validate_matrix(headers: &[String], rows: &[Vec<String>]) -> Result<(), InspectionError> {
    if headers.is_empty() || headers.iter().all(|value| value.trim().is_empty()) {
        return Err(InspectionError::InvalidCsv("header row is empty"));
    }
    if headers.len() > MAX_COLUMNS {
        return Err(InspectionError::LimitExceeded("200 columns"));
    }
    if rows.len() > MAX_ROWS {
        return Err(InspectionError::LimitExceeded("25000 rows"));
    }
    let mut cells = 0usize;
    let mut bytes = rows.len();
    for row in std::iter::once(headers).chain(rows.iter().map(Vec::as_slice)) {
        if row.len() > headers.len() {
            return Err(InspectionError::InvalidCsv("row is wider than its header"));
        }
        cells = cells.saturating_add(row.len());
        bytes = bytes.saturating_add(row.len().saturating_sub(1));
        if cells > MAX_MATRIX_CELLS {
            return Err(InspectionError::LimitExceeded("1000000 cells"));
        }
        for value in row {
            bytes = bytes.saturating_add(value.len());
            validate_content_bytes(bytes)?;
            if value.chars().count() > MAX_CELL_CHARS {
                return Err(InspectionError::LimitExceeded("4000 characters per cell"));
            }
            validate_controls(value)?;
        }
    }
    Ok(())
}
