/// CSV Import Helpers — parse_csv, col, opt_str, opt_u64, etc.
///
/// Utility functions shared by all import reducers.
use chrono::{DateTime, NaiveDate, Utc};
use spacetimedb::Timestamp;

// ── CSV Parsing ────────────────────────────────────────────────────────────────

/// Parse exactly the bounded representation inspected by the API/gateway.
/// Header casing is normalized for native reducer lookup; blank records are
/// preserved and quoted line breaks remain inside one field.
pub fn parse_csv(csv: &str) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let (headers, rows) =
        lumiere_file_inspection::parse_csv(csv).map_err(|error| error.to_string())?;
    let headers = headers
        .into_iter()
        .map(|header| header.to_lowercase())
        .collect();
    Ok((headers, rows))
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

/// Parse an import ID without silently converting malformed values to zero.
/// Empty values remain optional; present IDs must be positive base-10 integers.
pub fn parse_import_id(v: &str) -> Result<Option<u64>, String> {
    let value = v.trim();
    if value.is_empty() {
        return Ok(None);
    }

    let id = value
        .parse::<u64>()
        .map_err(|_| "must be a positive integer ID".to_string())?;
    if id == 0 {
        return Err("must be a positive integer ID".to_string());
    }
    Ok(Some(id))
}

/// Parse a semicolon-separated list of import IDs, rejecting the whole value
/// when any member is malformed instead of silently dropping it.
pub fn parse_import_ids(v: &str) -> Result<Vec<u64>, String> {
    let value = v.trim();
    if value.is_empty() {
        return Ok(Vec::new());
    }

    value
        .split(';')
        .map(|part| parse_import_id(part)?.ok_or_else(|| "contains an empty ID".to_string()))
        .collect()
}

/// Parse a finite accounting number using the same locale conventions as the
/// statement import path. Supported forms include plain decimal numbers,
/// decimal-comma values, US grouped values, and EU grouped decimal values.
/// Separator patterns that cannot be interpreted consistently are rejected.
pub fn parse_import_number(v: &str) -> Result<Option<f64>, String> {
    let compact: String = v
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    if compact.is_empty() {
        return Ok(None);
    }

    let unsigned = compact
        .strip_prefix('+')
        .or_else(|| compact.strip_prefix('-'))
        .unwrap_or(compact.as_str());
    if unsigned.is_empty()
        || !unsigned
            .chars()
            .all(|character| character.is_ascii_digit() || matches!(character, '.' | ','))
    {
        return Err("must be a valid finite number".to_string());
    }

    let comma_count = unsigned.matches(',').count();
    let dot_count = unsigned.matches('.').count();
    let normalized = match (comma_count, dot_count) {
        (0, 0) => compact.clone(),
        (0, 1) => {
            if valid_decimal(unsigned, '.') {
                compact.clone()
            } else {
                return Err("must be a valid finite number".to_string());
            }
        }
        (0, _) if valid_grouped_integer(unsigned, '.') => compact.replace('.', ""),
        (1, 0) if valid_grouped_integer(unsigned, ',') => compact.replace(',', ""),
        (1, 0) if valid_decimal(unsigned, ',') => compact.replace(',', "."),
        (_, 0) if valid_grouped_integer(unsigned, ',') => compact.replace(',', ""),
        (_, 1) if valid_grouped_decimal(unsigned, ',', '.') => compact.replace(',', ""),
        (1, _) if valid_grouped_decimal(unsigned, '.', ',') => {
            compact.replace('.', "").replace(',', ".")
        }
        _ => return Err("has an invalid or ambiguous separator pattern".to_string()),
    };

    let number = normalized
        .parse::<f64>()
        .map_err(|_| "must be a valid finite number".to_string())?;
    if !number.is_finite() {
        return Err("must be a valid finite number".to_string());
    }
    Ok(Some(number))
}

fn valid_decimal(value: &str, separator: char) -> bool {
    let Some((whole, fraction)) = value.split_once(separator) else {
        return false;
    };
    !whole.is_empty()
        && !fraction.is_empty()
        && whole.chars().all(|character| character.is_ascii_digit())
        && fraction.chars().all(|character| character.is_ascii_digit())
}

fn valid_grouped_integer(value: &str, separator: char) -> bool {
    let mut groups = value.split(separator);
    let Some(first) = groups.next() else {
        return false;
    };
    let remaining: Vec<&str> = groups.collect();
    !remaining.is_empty()
        && (1..=3).contains(&first.len())
        && first.chars().all(|character| character.is_ascii_digit())
        && remaining.iter().all(|group| {
            group.len() == 3 && group.chars().all(|character| character.is_ascii_digit())
        })
}

fn valid_grouped_decimal(value: &str, grouping: char, decimal: char) -> bool {
    let Some((whole, fraction)) = value.split_once(decimal) else {
        return false;
    };
    !fraction.is_empty()
        && fraction.chars().all(|character| character.is_ascii_digit())
        && valid_grouped_integer(whole, grouping)
}

/// Parse canonical microseconds or an unambiguous ISO business date/time.
/// Slash dates are deliberately rejected because their day/month order varies
/// by locale. Date-only values resolve to midnight UTC.
pub fn parse_import_timestamp(v: &str) -> Result<Option<Timestamp>, String> {
    let value = v.trim();
    if value.is_empty() {
        return Ok(None);
    }

    if let Ok(micros) = value.parse::<i64>() {
        return Ok(Some(Timestamp::from_micros_since_unix_epoch(micros)));
    }

    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        let midnight = date
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| "must be a valid ISO date".to_string())?;
        return Ok(Some(Timestamp::from_micros_since_unix_epoch(
            midnight.and_utc().timestamp_micros(),
        )));
    }

    if let Ok(date_time) = DateTime::parse_from_rfc3339(value) {
        return Ok(Some(Timestamp::from_micros_since_unix_epoch(
            date_time.with_timezone(&Utc).timestamp_micros(),
        )));
    }

    Err("must be microseconds since Unix epoch or an ISO date (YYYY-MM-DD/RFC 3339)".to_string())
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
        v.split(';').filter_map(|s| s.trim().parse().ok()).collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_csv_preserves_quoted_commas_and_escaped_quotes() {
        assert_eq!(
            parse_csv("Date,Amount,Note\n2026-01-01,\"1,234.56\",\"Invoice \"\"A\"\"\"")
                .unwrap()
                .1
                .remove(0),
            vec!["2026-01-01", "1,234.56", "Invoice \"A\""]
        );
    }

    #[test]
    fn native_import_and_admission_parse_the_same_records() {
        let csv = "Name,Note\r\nAcme,\"line one\r\nline two\"\r\n\r\nBeta,last";
        let inspected = lumiere_file_inspection::inspect_csv(csv).unwrap();
        let (headers, rows) = parse_csv(csv).unwrap();
        assert_eq!(headers, vec!["name", "note"]);
        assert_eq!(rows, inspected.rows);
        assert!(parse_csv("name\n\"unclosed").is_err());
    }

    #[test]
    fn import_timestamp_accepts_iso_dates_rfc3339_and_legacy_micros() {
        let iso = parse_import_timestamp("2026-02-13").unwrap().unwrap();
        let rfc3339 = parse_import_timestamp("2026-02-13T00:00:00Z")
            .unwrap()
            .unwrap();
        let legacy = parse_import_timestamp("1770940800000000").unwrap().unwrap();

        assert_eq!(iso.to_micros_since_unix_epoch(), 1_770_940_800_000_000);
        assert_eq!(rfc3339.to_micros_since_unix_epoch(), 1_770_940_800_000_000);
        assert_eq!(legacy.to_micros_since_unix_epoch(), 1_770_940_800_000_000);
    }

    #[test]
    fn import_timestamp_rejects_invalid_and_ambiguous_dates() {
        assert!(parse_import_timestamp("2026-02-30").is_err());
        assert!(parse_import_timestamp("02/03/2026").is_err());
        assert!(parse_import_timestamp("13/02/2026").is_err());
    }

    #[test]
    fn import_number_accepts_plain_us_and_eu_formats() {
        assert_eq!(parse_import_number("1234.56").unwrap(), Some(1_234.56));
        assert_eq!(parse_import_number("1,234.56").unwrap(), Some(1_234.56));
        assert_eq!(parse_import_number("1.234,56").unwrap(), Some(1_234.56));
        assert_eq!(parse_import_number("12,34").unwrap(), Some(12.34));
        assert_eq!(parse_import_number("1,234").unwrap(), Some(1_234.0));
    }

    #[test]
    fn import_number_rejects_malformed_or_non_finite_values() {
        assert!(parse_import_number("12,34.56").is_err());
        assert!(parse_import_number("1,23,456").is_err());
        assert!(parse_import_number("NaN").is_err());
        assert!(parse_import_number("1e309").is_err());
    }

    #[test]
    fn import_ids_reject_zero_malformed_and_empty_list_members() {
        assert_eq!(parse_import_id("42").unwrap(), Some(42));
        assert!(parse_import_id("0").is_err());
        assert!(parse_import_id("4.2").is_err());
        assert!(parse_import_ids("1;;2").is_err());
    }
}
