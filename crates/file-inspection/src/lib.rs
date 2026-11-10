//! Content eligibility is a bounded inspection result, never a grant or proof of intent.

mod csv;

pub use csv::{parse_csv, parse_csv_records, CsvDelimiter};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::borrow::Cow;

/// Reinspection is required when this policy changes.
pub const INSPECTION_POLICY_VERSION: &str = "file-inspection-v1";
pub const DOCUMENT_CSV_POLICY_VERSION: &str = "document-csv-inspection-v1";
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
    #[error("csv record {record} {reason}")]
    CsvRecord { record: usize, reason: &'static str },
    #[error("csv record {record}, column {column}, UTF-8 byte offset {byte}: {reason}")]
    CsvLocation {
        record: usize,
        column: usize,
        byte: usize,
        reason: &'static str,
    },
    #[error("csv has invalid UTF-8 at byte {byte}; use UTF-8 or UTF-16 with a byte order mark")]
    CsvEncoding { byte: usize },
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

/// Source preparation separates exact uploaded bytes from the native comma payload.
#[derive(Debug)]
pub struct PreparedCsvSource<'a> {
    pub csv_text: Cow<'a, str>,
    pub delimiter: CsvDelimiter,
    pub encoding: &'static str,
    pub source_sha256: String,
    pub inspected: InspectedCsv,
}

/// Prepare a flat source export for preview and the existing native comma import.
///
/// # Errors
/// Rejects invalid encoding, ambiguous dialect, malformed records, and files or
/// resulting comma payloads that exceed the inspection budgets.
pub fn prepare_csv_source(
    bytes: &[u8],
    selected_delimiter: Option<CsvDelimiter>,
) -> Result<PreparedCsvSource<'_>, InspectionError> {
    validate_content_bytes(bytes.len())?;
    let (text, encoding) = decode_csv_source(bytes)?;
    let (delimiter, headers, rows) = csv::parse_csv_source(&text, selected_delimiter)?;
    let csv_text = if delimiter == CsvDelimiter::Comma {
        text
    } else {
        Cow::Owned(csv::write_comma_csv(&headers, &rows))
    };
    validate_content_bytes(csv_text.len())?;
    let report = inspect_matrix(&headers, &rows)?;
    let dataset_sha256 = matrix_sha256(&headers, &rows);
    let inspected = InspectedCsv {
        headers,
        rows,
        content_sha256: format!("{:x}", Sha256::digest(csv_text.as_bytes())),
        dataset_sha256,
        report,
    };
    Ok(PreparedCsvSource {
        csv_text,
        delimiter,
        encoding,
        source_sha256: format!("{:x}", Sha256::digest(bytes)),
        inspected,
    })
}

fn decode_csv_source(bytes: &[u8]) -> Result<(Cow<'_, str>, &'static str), InspectionError> {
    let utf16 = bytes
        .strip_prefix(&[0xff, 0xfe])
        .map(|body| (body, u16::from_le_bytes as fn([u8; 2]) -> u16, "utf-16le"))
        .or_else(|| {
            bytes
                .strip_prefix(&[0xfe, 0xff])
                .map(|body| (body, u16::from_be_bytes as fn([u8; 2]) -> u16, "utf-16be"))
        });
    if let Some((body, read_unit, encoding)) = utf16 {
        let (units, remainder) = body.as_chunks::<2>();
        if !remainder.is_empty() {
            return Err(InspectionError::InvalidCsv(
                "contains a truncated UTF-16 code unit",
            ));
        }
        let text = char::decode_utf16(units.iter().copied().map(read_unit))
            .collect::<Result<String, _>>()
            .map_err(|_| InspectionError::InvalidCsv("contains invalid UTF-16 text"))?;
        return Ok((Cow::Owned(text), encoding));
    }
    let text = std::str::from_utf8(bytes).map_err(|error| InspectionError::CsvEncoding {
        byte: error.valid_up_to(),
    })?;
    Ok((Cow::Borrowed(text), "utf-8"))
}

/// A report is a record matrix, not an assertion about importable column names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InspectedCsvRecords {
    pub records: Vec<Vec<String>>,
    pub content_sha256: String,
    pub dataset_sha256: String,
    pub report: InspectionReport,
}

/// Inspect every report record, including headings, blank records and footers.
/// Source record and column locations remain stable across section boundaries.
///
/// # Errors
/// Rejects malformed CSV, unsupported controls and exceeded resource budgets.
pub fn inspect_csv_records(text: &str) -> Result<InspectedCsvRecords, InspectionError> {
    Ok(inspect_record_matrix(
        parse_csv_records(text)?,
        text.as_bytes(),
    ))
}

/// Inspect the original document bytes without applying import header rules.
/// Alternate dialects and encodings are available for manual viewing.
/// # Errors
/// Rejects invalid text, unsupported controls, and records outside inspection budgets.
pub fn inspect_document_csv(bytes: &[u8]) -> Result<InspectedCsvRecords, InspectionError> {
    let (text, utf8) = decode_document_csv(bytes, None)?;
    let (records, unambiguous_comma) = csv::parse_document_csv(&text)?;
    let mut inspected = inspect_record_matrix(records, bytes);
    inspected.report.policy_version = DOCUMENT_CSV_POLICY_VERSION.into();
    inspected.report.ai_allowed &= utf8 && unambiguous_comma;
    Ok(inspected)
}

/// Resolve the precise CSV interpretation selected by the document viewer.
/// # Errors
/// Rejects unsupported options, mismatched BOMs, invalid text, and exceeded limits.
pub fn parse_document_csv_with_options(
    bytes: &[u8],
    encoding: &str,
    delimiter: char,
) -> Result<Vec<Vec<String>>, InspectionError> {
    use encoding_rs::{UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252};
    let encoding = match encoding {
        "utf-8" => UTF_8,
        "utf-16le" => UTF_16LE,
        "utf-16be" => UTF_16BE,
        "windows-1252" => WINDOWS_1252,
        _ => {
            return Err(InspectionError::InvalidCsv(
                "uses an unsupported text encoding",
            ))
        }
    };
    let (text, _) = decode_document_csv(bytes, Some(encoding))?;
    csv::parse_document_csv_with_delimiter(&text, delimiter)
}

fn decode_document_csv<'a>(
    bytes: &'a [u8],
    selected: Option<&'static encoding_rs::Encoding>,
) -> Result<(Cow<'a, str>, bool), InspectionError> {
    use encoding_rs::{UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252};
    validate_content_bytes(bytes.len())?;
    let bom = match bytes {
        [0xff, 0xfe, 0x00, 0x00, ..] | [0x00, 0x00, 0xfe, 0xff, ..] => {
            return Err(InspectionError::InvalidCsv(
                "has an unsupported UTF-32 byte order mark",
            ));
        }
        [0xef, 0xbb, 0xbf, ..] => Some(UTF_8),
        [0xff, 0xfe, ..] => Some(UTF_16LE),
        [0xfe, 0xff, ..] => Some(UTF_16BE),
        _ => None,
    };
    if let (Some(selected), Some(bom)) = (selected, bom) {
        if selected != bom {
            return Err(InspectionError::InvalidCsv(
                "encoding does not match the byte order mark",
            ));
        }
    }
    // Inspect a lossless legacy interpretation for manual admission only.
    // The viewer requires the user to select the encoding explicitly.
    let encoding = match selected.or(bom) {
        Some(encoding) => encoding,
        None => match std::str::from_utf8(bytes) {
            Ok(text) => return Ok((Cow::Borrowed(text), true)),
            Err(_) => WINDOWS_1252,
        },
    };
    if encoding == UTF_8 {
        let text = std::str::from_utf8(bytes).map_err(|error| InspectionError::CsvEncoding {
            byte: error.valid_up_to(),
        })?;
        return Ok((Cow::Borrowed(text), true));
    }
    let text = encoding
        .decode_without_bom_handling_and_without_replacement(bytes)
        .ok_or(InspectionError::InvalidCsv("contains invalid encoded text"))?;
    Ok((text, false))
}

fn inspect_record_matrix(records: Vec<Vec<String>>, source: &[u8]) -> InspectedCsvRecords {
    let cells = records.iter().map(Vec::len).sum();
    let mut report = InspectionReport::new(records.len(), cells);
    for (row, record) in records.iter().enumerate() {
        for (column, value) in record.iter().enumerate() {
            inspect_cell(&mut report, &format!("record[{row}].col[{column}]"), value);
        }
    }
    let mut digest = Sha256::new();
    digest.update(b"lumiere-csv-records-v1\0");
    digest.update((records.len() as u64).to_be_bytes());
    for record in &records {
        digest.update((record.len() as u64).to_be_bytes());
        for value in record {
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value.as_bytes());
        }
    }
    InspectedCsvRecords {
        records,
        content_sha256: format!("{:x}", Sha256::digest(source)),
        dataset_sha256: format!("{:x}", digest.finalize()),
        report,
    }
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
