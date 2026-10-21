use chrono::{NaiveDate, NaiveDateTime};
use serde::Deserialize;
use std::fmt;

/// A static field identifier only: never includes submitted values, URLs or provider text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("invalid VSDC field: {field}")]
pub(crate) struct ValidationError {
    pub(crate) field: &'static str,
}

pub(super) fn invalid(field: &'static str) -> ValidationError {
    ValidationError { field }
}

/// Nonnegative NUMBER(precision,2), held as exact hundredths.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Decimal<const PRECISION: u32>(u64);

impl<const P: u32> Decimal<P> {
    pub(crate) const ZERO: Self = Self(0);

    pub(crate) fn parse(input: &str) -> Result<Self, ValidationError> {
        if !(3..=18).contains(&P) {
            return Err(invalid("decimal precision"));
        }
        let (whole, fraction) = input.split_once('.').unwrap_or((input, ""));
        if whole.is_empty()
            || !whole.bytes().all(|b| b.is_ascii_digit())
            || !fraction.bytes().all(|b| b.is_ascii_digit())
            || fraction.len() > 2
            || (input.contains('.') && fraction.is_empty())
            || whole.len() > (P - 2) as usize
        {
            return Err(invalid("decimal"));
        }
        let whole: u64 = whole.parse().map_err(|_| invalid("decimal"))?;
        let fraction: u64 = if fraction.is_empty() {
            0
        } else {
            fraction.parse::<u64>().map_err(|_| invalid("decimal"))?
                * if fraction.len() == 1 { 10 } else { 1 }
        };
        let minor = whole
            .checked_mul(100)
            .and_then(|v| v.checked_add(fraction))
            .ok_or_else(|| invalid("decimal"))?;
        if minor >= 10_u64.pow(P) {
            return Err(invalid("decimal"));
        }
        Ok(Self(minor))
    }

    pub(crate) fn minor_units(self) -> u64 {
        self.0
    }
}

impl<const P: u32> fmt::Display for Decimal<P> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{:02}", self.0 / 100, self.0 % 100)
    }
}

/// NUMBER(38) without an intermediate serde_json::Value or floating-point conversion.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Counter(u128);

impl Counter {
    pub(crate) fn new(value: u128) -> Result<Self, ValidationError> {
        if value >= 10_u128.pow(38) {
            return Err(invalid("counter"));
        }
        Ok(Self(value))
    }

    pub(crate) fn value(self) -> u128 {
        self.0
    }
}

impl<'de> Deserialize<'de> for Counter {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = u128::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

pub(super) fn text(value: &str, max: usize, field: &'static str) -> Result<(), ValidationError> {
    if value.trim().is_empty() || value.chars().count() > max || value.chars().any(char::is_control)
    {
        return Err(invalid(field));
    }
    Ok(())
}

pub(super) fn optional_text(
    value: Option<&str>,
    max: usize,
    field: &'static str,
) -> Result<(), ValidationError> {
    if let Some(value) = value {
        text(value, max, field)?;
    }
    Ok(())
}

pub(super) fn digits(value: &str, len: usize, field: &'static str) -> Result<(), ValidationError> {
    if value.len() != len || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err(invalid(field));
    }
    Ok(())
}

pub(super) fn date(value: &str, field: &'static str) -> Result<(), ValidationError> {
    digits(value, 8, field)?;
    if value.starts_with("0000") {
        return Err(invalid(field));
    }
    let parsed = NaiveDate::parse_from_str(value, "%Y%m%d").map_err(|_| invalid(field))?;
    if parsed.format("%Y%m%d").to_string() != value {
        return Err(invalid(field));
    }
    Ok(())
}

pub(super) fn datetime(value: &str, field: &'static str) -> Result<(), ValidationError> {
    digits(value, 14, field)?;
    if value.starts_with("0000") || &value[12..] >= "60" {
        return Err(invalid(field));
    }
    let parsed =
        NaiveDateTime::parse_from_str(value, "%Y%m%d%H%M%S").map_err(|_| invalid(field))?;
    if parsed.format("%Y%m%d%H%M%S").to_string() != value {
        return Err(invalid(field));
    }
    Ok(())
}
