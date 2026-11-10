//! Strict, bounded CSV parsing shared with native reducers to avoid parser differentials.

use crate::{
    validate_content_bytes, validate_controls, InspectionError, MAX_CELL_CHARS, MAX_COLUMNS,
    MAX_MATRIX_CELLS, MAX_ROWS,
};

use serde::{Deserialize, Serialize};

/// Source delimiters supported by the preparation path. Native reducers use commas.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CsvDelimiter {
    #[default]
    Comma,
    Semicolon,
    Tab,
    Pipe,
}

impl CsvDelimiter {
    pub fn name(self) -> &'static str {
        match self {
            Self::Comma => "comma",
            Self::Semicolon => "semicolon",
            Self::Tab => "tab",
            Self::Pipe => "pipe",
        }
    }

    fn character(self) -> char {
        match self {
            Self::Comma => ',',
            Self::Semicolon => ';',
            Self::Tab => '\t',
            Self::Pipe => '|',
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FieldState {
    Start,
    Unquoted,
    Quoted,
    Closed,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RecordMode {
    Import,
    Header,
    Document,
}

/// Parse comma-separated records, quoted line breaks and escaped double quotes.
/// Empty physical records are preserved; a final record terminator adds no row.
///
/// # Errors
/// Rejects invalid quote placement, controls and exceeded byte/shape/cell budgets.
pub fn parse_csv(text: &str) -> Result<(Vec<String>, Vec<Vec<String>>), InspectionError> {
    flat_records(parse_csv_records(text)?)
}

fn flat_records(
    records: Vec<Vec<String>>,
) -> Result<(Vec<String>, Vec<Vec<String>>), InspectionError> {
    let mut records = records.into_iter();
    let headers = records
        .next()
        .ok_or(InspectionError::InvalidCsv("is empty"))?;
    if headers.iter().all(|header| header.is_empty()) {
        return Err(InspectionError::InvalidCsv("header row is empty"));
    }
    let rows: Vec<Vec<String>> = records.collect();
    if let Some(index) = rows.iter().position(|row| row.len() > headers.len()) {
        return Err(InspectionError::CsvRecord {
            record: index + 2,
            reason: "has more fields than the header",
        });
    }
    Ok((headers, rows))
}

/// Parse bounded CSV records without asserting a flat business-table layout.
/// Leading blank records and repeated, differently sized report sections retain
/// their original record positions. Native imports still use [`parse_csv`].
///
/// # Errors
/// Rejects the same malformed quoting, controls and resource limits as flat CSV.
pub fn parse_csv_records(text: &str) -> Result<Vec<Vec<String>>, InspectionError> {
    let offset = validate_input(text)?;
    parse_records(&text[offset..], offset, ',', RecordMode::Import)
}

/// Resolve a document dialect without imposing native import header rules.
/// Only an unambiguous comma interpretation is eligible for existing AI consumers.
pub(crate) fn parse_document_csv(text: &str) -> Result<(Vec<Vec<String>>, bool), InspectionError> {
    let offset = validate_input(text)?;
    let text = &text[offset..];
    let mut selected = parse_records(text, offset, ',', RecordMode::Document);
    let mut best_score = selected
        .as_ref()
        .map_or((0, 0), |rows| document_score(rows));
    let mut unambiguous_comma = best_score.0 > 0;
    let mut alternative_limit = None;
    for delimiter in [';', '\t'] {
        match parse_records(text, offset, delimiter, RecordMode::Document) {
            Ok(candidate) => {
                let score = document_score(&candidate);
                if score.0 > 0 {
                    unambiguous_comma = false;
                }
                if score > best_score {
                    selected = Ok(candidate);
                    best_score = score;
                }
            }
            Err(error @ InspectionError::LimitExceeded(_)) => {
                alternative_limit = Some(error);
            }
            Err(_) => {}
        }
    }
    if best_score.0 == 0 {
        if let Some(error) = alternative_limit {
            return Err(error);
        }
        // Every valid interpretation has a single column.
        unambiguous_comma = true;
    }
    selected.map(|records| (records, unambiguous_comma))
}

pub(crate) fn parse_document_csv_with_delimiter(
    text: &str,
    delimiter: char,
) -> Result<Vec<Vec<String>>, InspectionError> {
    if !matches!(delimiter, ',' | ';' | '\t') {
        return Err(InspectionError::InvalidCsv("uses an unsupported delimiter"));
    }
    let offset = validate_input(text)?;
    parse_records(&text[offset..], offset, delimiter, RecordMode::Document)
}

fn document_score(records: &[Vec<String>]) -> (usize, usize) {
    let mut frequencies = [0; MAX_COLUMNS + 1];
    let mut multi_column_rows = 0;
    let mut consistent_rows = 0;
    for row in records.iter().filter(|row| row.len() > 1).take(64) {
        multi_column_rows += 1;
        frequencies[row.len()] += 1;
        consistent_rows = consistent_rows.max(frequencies[row.len()]);
    }
    (multi_column_rows, consistent_rows)
}

/// Resolve the delimiter from the first logical record, then parse the whole input.
/// Ambiguous headers require explicit selection. This does not classify report layouts.
pub(crate) fn parse_csv_source(
    text: &str,
    selected: Option<CsvDelimiter>,
) -> Result<(CsvDelimiter, Vec<String>, Vec<Vec<String>>), InspectionError> {
    let offset = validate_input(text)?;
    let text = &text[offset..];
    let delimiter = if let Some(delimiter) = selected {
        delimiter
    } else {
        let candidates = [
            CsvDelimiter::Comma,
            CsvDelimiter::Semicolon,
            CsvDelimiter::Tab,
            CsvDelimiter::Pipe,
        ];
        let mut matching = candidates.into_iter().filter(|delimiter| {
            match parse_records(text, offset, delimiter.character(), RecordMode::Header) {
                Ok(records) => records.first().is_some_and(|header| header.len() > 1),
                // An oversized header still identifies its delimiter.
                Err(InspectionError::LimitExceeded("200 columns")) => true,
                Err(_) => false,
            }
        });
        let inferred = matching.next().unwrap_or_default();
        if matching.next().is_some() {
            return Err(InspectionError::InvalidCsv(
                "delimiter is ambiguous; select comma, semicolon, tab, or pipe",
            ));
        }
        inferred
    };
    let (headers, rows) = flat_records(parse_records(
        text,
        offset,
        delimiter.character(),
        RecordMode::Import,
    )?)?;
    Ok((delimiter, headers, rows))
}

fn validate_input(text: &str) -> Result<usize, InspectionError> {
    validate_content_bytes(text.len())?;
    validate_controls(text)?;
    let offset = if text.starts_with('\u{feff}') {
        '\u{feff}'.len_utf8()
    } else {
        0
    };
    if text.len() == offset {
        return Err(InspectionError::InvalidCsv("is empty"));
    }
    Ok(offset)
}

fn parse_records(
    text: &str,
    offset: usize,
    delimiter: char,
    mode: RecordMode,
) -> Result<Vec<Vec<String>>, InspectionError> {
    let mut records = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut state = FieldState::Start;
    let mut chars = text.char_indices().peekable();
    let mut cell_chars = 0usize;
    let mut total_cells = 0usize;
    let mut record_terminated = false;

    while let Some((byte_index, ch)) = chars.next() {
        record_terminated = false;
        if state == FieldState::Quoted {
            if ch == '"' {
                if chars.peek().is_some_and(|(_, next)| *next == '"') {
                    chars.next();
                    push_char(&mut field, '"', &mut cell_chars)?;
                } else {
                    state = FieldState::Closed;
                }
            } else {
                push_char(&mut field, ch, &mut cell_chars)?;
            }
            continue;
        }
        match ch {
            ch if ch == delimiter || matches!(ch, '\r' | '\n') => {
                push_field(&mut row, &mut field, &mut total_cells, mode)?;
                cell_chars = 0;
                state = FieldState::Start;
                if ch != delimiter {
                    if ch == '\r' && chars.peek().is_some_and(|(_, next)| *next == '\n') {
                        chars.next();
                    }
                    push_record(&mut records, &mut row)?;
                    if mode == RecordMode::Header {
                        return Ok(records);
                    }
                    record_terminated = true;
                }
            }
            '"' if state == FieldState::Start => {
                field.clear();
                cell_chars = 0;
                state = FieldState::Quoted;
            }
            '"' => {
                return Err(InspectionError::CsvLocation {
                    record: records.len() + 1,
                    column: row.len() + 1,
                    byte: offset + byte_index,
                    reason: "has a quote in an unquoted field",
                });
            }
            ' ' | '\t' if state == FieldState::Closed => {}
            _ if state == FieldState::Closed => {
                return Err(InspectionError::CsvLocation {
                    record: records.len() + 1,
                    column: row.len() + 1,
                    byte: offset + byte_index,
                    reason: "has data after a closing quote",
                });
            }
            _ => {
                if mode != RecordMode::Document || !matches!(ch, ' ' | '\t') {
                    state = FieldState::Unquoted;
                }
                push_char(&mut field, ch, &mut cell_chars)?;
            }
        }
    }
    if state == FieldState::Quoted {
        return Err(InspectionError::CsvLocation {
            record: records.len() + 1,
            column: row.len() + 1,
            byte: offset + text.len(),
            reason: "has an unterminated quoted field at end of input",
        });
    }
    if !record_terminated {
        push_field(&mut row, &mut field, &mut total_cells, mode)?;
        push_record(&mut records, &mut row)?;
    }
    Ok(records)
}

pub(crate) fn write_comma_csv(headers: &[String], rows: &[Vec<String>]) -> String {
    let mut csv = String::new();
    for row in std::iter::once(headers).chain(rows.iter().map(Vec::as_slice)) {
        for (index, field) in row.iter().enumerate() {
            if index > 0 {
                csv.push(',');
            }
            if field.contains([',', '"', '\r', '\n']) || field.starts_with('\u{feff}') {
                csv.push('"');
                for character in field.chars() {
                    if character == '"' {
                        csv.push('"');
                    }
                    csv.push(character);
                }
                csv.push('"');
            } else {
                csv.push_str(field);
            }
        }
        csv.push('\n');
    }
    csv
}

fn push_char(field: &mut String, ch: char, count: &mut usize) -> Result<(), InspectionError> {
    *count += 1;
    if *count > MAX_CELL_CHARS {
        return Err(InspectionError::LimitExceeded("4000 characters per cell"));
    }
    field.push(ch);
    Ok(())
}

fn push_field(
    row: &mut Vec<String>,
    field: &mut String,
    total_cells: &mut usize,
    mode: RecordMode,
) -> Result<(), InspectionError> {
    if row.len() >= MAX_COLUMNS {
        return Err(InspectionError::LimitExceeded("200 columns"));
    }
    *total_cells += 1;
    if *total_cells > MAX_MATRIX_CELLS {
        return Err(InspectionError::LimitExceeded("1000000 cells"));
    }
    if mode == RecordMode::Document {
        row.push(std::mem::take(field));
    } else {
        row.push(field.trim().to_owned());
        field.clear();
    }
    Ok(())
}

fn push_record(
    records: &mut Vec<Vec<String>>,
    row: &mut Vec<String>,
) -> Result<(), InspectionError> {
    // The first record is the header, so allow MAX_ROWS + 1 records.
    if records.len() > MAX_ROWS {
        return Err(InspectionError::LimitExceeded("25000 rows"));
    }
    records.push(std::mem::take(row));
    Ok(())
}
