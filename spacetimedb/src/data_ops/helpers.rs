/// CSV Import Helpers — parse_csv, col, opt_str, opt_u64, etc.
///
/// Utility functions shared by all import reducers.
use spacetimedb::Timestamp;

// ── CSV Parsing ────────────────────────────────────────────────────────────────

/// Split a raw CSV string into (headers, rows).
/// Each row is a Vec<String> with one entry per column.
pub fn parse_csv(csv: &str) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let mut lines = csv.lines();
    let header_line = lines.next().ok_or("CSV is empty")?;
    let headers: Vec<String> = header_line
        .split(',')
        .map(|h| h.trim().to_lowercase())
        .collect();
    let rows: Vec<Vec<String>> = lines
        .map(|line| split_csv_row(line))
        .collect();
    Ok((headers, rows))
}

/// Split one CSV line, respecting double-quoted fields.
pub fn split_csv_row(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '"' if !in_quotes => in_quotes = true,
            '"' if in_quotes => {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    current.push('"');
                } else {
                    in_quotes = false;
                }
            }
            ',' if !in_quotes => {
                fields.push(current.trim().to_string());
                current = String::new();
            }
            _ => current.push(ch),
        }
    }
    fields.push(current.trim().to_string());
    fields
}

// ── Field Accessors ────────────────────────────────────────────────────────────

/// Get a string value from a row by header name. Returns "" if not found.
pub fn col<'a>(headers: &[String], row: &'a [String], name: &str) -> &'a str {
    headers
        .iter()
        .position(|h| h == name)
        .and_then(|i| row.get(i))
        .map(|s| s.trim())
        .unwrap_or("")
}

// ── Type Parsers ───────────────────────────────────────────────────────────────

/// Parse optional string — empty → None.
pub fn opt_str(v: &str) -> Option<String> {
    if v.is_empty() {
        None
    } else {
        Some(v.to_string())
    }
}

/// Parse optional u64 — empty → None.
pub fn opt_u64(v: &str) -> Option<u64> {
    if v.is_empty() {
        None
    } else {
        v.parse().ok()
    }
}

/// Parse optional i32 — empty → None.
pub fn opt_i32(v: &str) -> Option<i32> {
    if v.is_empty() {
        None
    } else {
        v.parse().ok()
    }
}

/// Parse optional f64 — empty → None.
pub fn opt_f64(v: &str) -> Option<f64> {
    if v.is_empty() {
        None
    } else {
        v.parse().ok()
    }
}

/// Parse optional Timestamp from micros string — empty → None.
pub fn opt_timestamp(v: &str) -> Option<Timestamp> {
    if v.is_empty() {
        None
    } else {
        v.parse::<i64>()
            .ok()
            .map(Timestamp::from_micros_since_unix_epoch)
    }
}

/// Parse semicolon-separated strings.
pub fn vec_str(v: &str) -> Vec<String> {
    if v.is_empty() {
        Vec::new()
    } else {
        v.split(';').map(|s| s.trim().to_string()).collect()
    }
}

/// Parse semicolon-separated u64s.
pub fn vec_u64(v: &str) -> Vec<u64> {
    if v.is_empty() {
        Vec::new()
    } else {
        v.split(';')
            .filter_map(|s| s.trim().parse().ok())
            .collect()
    }
}

/// Parse boolean: "true"/"1"/"yes" → true, else false.
pub fn parse_bool(v: &str) -> bool {
    matches!(v.to_lowercase().as_str(), "true" | "1" | "yes")
}

/// Parse u64, defaulting to 0.
pub fn parse_u64(v: &str) -> u64 {
    v.parse().unwrap_or(0)
}

/// Parse i32, defaulting to 0.
pub fn parse_i32(v: &str) -> i32 {
    v.parse().unwrap_or(0)
}

/// Parse u32, defaulting to 0.
pub fn parse_u32(v: &str) -> u32 {
    v.parse().unwrap_or(0)
}

/// Parse u8, defaulting to 0.
pub fn parse_u8(v: &str) -> u8 {
    v.parse().unwrap_or(0)
}

/// Parse f64, defaulting to 0.0.
pub fn parse_f64(v: &str) -> f64 {
    v.parse().unwrap_or(0.0)
}
