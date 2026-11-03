//! Strict, bounded CSV parsing shared with native reducers to avoid parser differentials.

use crate::{
    validate_content_bytes, validate_controls, InspectionError, MAX_CELL_CHARS, MAX_COLUMNS,
    MAX_MATRIX_CELLS, MAX_ROWS,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum FieldState {
    Start,
    Unquoted,
    Quoted,
    Closed,
}

/// Parse comma-separated records, quoted line breaks and escaped double quotes.
/// Empty physical records are preserved; a final record terminator adds no row.
///
/// # Errors
/// Rejects invalid quote placement, controls and exceeded byte/shape/cell budgets.
pub fn parse_csv(text: &str) -> Result<(Vec<String>, Vec<Vec<String>>), InspectionError> {
    validate_content_bytes(text.len())?;
    validate_controls(text)?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    if text.is_empty() {
        return Err(InspectionError::InvalidCsv("is empty"));
    }
    let mut records = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut state = FieldState::Start;
    let mut chars = text.chars().peekable();
    let mut cell_chars = 0usize;
    let mut total_cells = 0usize;
    let mut record_terminated = false;

    while let Some(ch) = chars.next() {
        record_terminated = false;
        if state == FieldState::Quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
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
            ',' | '\r' | '\n' => {
                push_field(&mut row, &mut field, &mut total_cells)?;
                cell_chars = 0;
                state = FieldState::Start;
                if ch != ',' {
                    if ch == '\r' && chars.peek() == Some(&'\n') {
                        chars.next();
                    }
                    push_record(&mut records, &mut row)?;
                    record_terminated = true;
                }
            }
            '"' if state == FieldState::Start => state = FieldState::Quoted,
            '"' => {
                return Err(InspectionError::InvalidCsv(
                    "has a quote in an unquoted field",
                ))
            }
            ' ' | '\t' if state == FieldState::Closed => {}
            _ if state == FieldState::Closed => {
                return Err(InspectionError::InvalidCsv(
                    "has data after a closing quote",
                ));
            }
            _ => {
                state = FieldState::Unquoted;
                push_char(&mut field, ch, &mut cell_chars)?;
            }
        }
    }
    if state == FieldState::Quoted {
        return Err(InspectionError::InvalidCsv(
            "has an unterminated quoted field",
        ));
    }
    if !record_terminated {
        push_field(&mut row, &mut field, &mut total_cells)?;
        push_record(&mut records, &mut row)?;
    }
    let mut records = records.into_iter();
    let headers = records
        .next()
        .ok_or(InspectionError::InvalidCsv("is empty"))?;
    if headers.iter().all(|header| header.is_empty()) {
        return Err(InspectionError::InvalidCsv("header row is empty"));
    }
    let rows: Vec<Vec<String>> = records.collect();
    if rows.iter().any(|row| row.len() > headers.len()) {
        return Err(InspectionError::InvalidCsv("row is wider than its header"));
    }
    Ok((headers, rows))
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
) -> Result<(), InspectionError> {
    if row.len() >= MAX_COLUMNS {
        return Err(InspectionError::LimitExceeded("200 columns"));
    }
    *total_cells += 1;
    if *total_cells > MAX_MATRIX_CELLS {
        return Err(InspectionError::LimitExceeded("1000000 cells"));
    }
    row.push(field.trim().to_owned());
    field.clear();
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
