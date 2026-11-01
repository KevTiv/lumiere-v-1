//! Calendar precision of a source observation, independent of its upload time.

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum DatePrecision {
    Day,
    Month,
    Year,
    Interval,
    Undated,
    Invalid,
}

/// Optional, immutable source metadata. Ranges are calendar dates in the
/// company context, with an exclusive end. A month or year is never promoted
/// to a transaction on its first day.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct BusinessDate {
    pub precision: DatePrecision,
    pub from: Option<String>,
    pub to_exclusive: Option<String>,
    pub raw: Option<String>,
}

pub(super) fn calendar_date(value: &str) -> Result<NaiveDate, String> {
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "a calendar date must use YYYY-MM-DD".to_string())?;
    if date.year() < 1 || date.year() > 9999 || date.format("%Y-%m-%d").to_string() != value {
        return Err("a calendar date must use YYYY-MM-DD".into());
    }
    Ok(date)
}

impl BusinessDate {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.raw.as_ref().is_some_and(|value| value.len() > 2000) {
            return Err("source date text is too long".into());
        }
        if matches!(
            self.precision,
            DatePrecision::Undated | DatePrecision::Invalid
        ) {
            if self.from.is_some() || self.to_exclusive.is_some() {
                return Err("unknown source dates cannot have invented boundaries".into());
            }
            return Ok(());
        }
        let from = calendar_date(
            self.from
                .as_deref()
                .ok_or("source date start is required")?,
        )?;
        let to = calendar_date(
            self.to_exclusive
                .as_deref()
                .ok_or("source date exclusive end is required")?,
        )?;
        if to <= from {
            return Err("source date end must be after its start".into());
        }
        let valid = match self.precision {
            DatePrecision::Day => from.succ_opt() == Some(to),
            DatePrecision::Month => {
                from.day() == 1
                    && to.day() == 1
                    && (to.year() * 12 + to.month() as i32)
                        - (from.year() * 12 + from.month() as i32)
                        == 1
            }
            DatePrecision::Year => {
                from.month() == 1
                    && from.day() == 1
                    && to.month() == 1
                    && to.day() == 1
                    && to.year() == from.year() + 1
            }
            DatePrecision::Interval => true,
            DatePrecision::Undated | DatePrecision::Invalid => false,
        };
        if !valid {
            return Err("source date boundaries do not match their declared precision".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn period(precision: DatePrecision, from: &str, to: &str) -> BusinessDate {
        BusinessDate {
            precision,
            from: Some(from.into()),
            to_exclusive: Some(to.into()),
            raw: None,
        }
    }

    #[test]
    fn preserves_old_dates_and_real_month_year_interval_precision() {
        assert!(period(DatePrecision::Day, "1901-01-02", "1901-01-03")
            .validate()
            .is_ok());
        assert!(period(DatePrecision::Month, "2024-02-01", "2024-03-01")
            .validate()
            .is_ok());
        assert!(period(DatePrecision::Year, "2022-01-01", "2023-01-01")
            .validate()
            .is_ok());
        assert!(period(DatePrecision::Interval, "1901-01-01", "2026-01-01")
            .validate()
            .is_ok());
        assert!(period(DatePrecision::Month, "2024-02-02", "2024-03-02")
            .validate()
            .is_err());
        assert!(period(DatePrecision::Day, "2022-02-29", "2022-03-01")
            .validate()
            .is_err());
        assert!(period(DatePrecision::Year, "2022-01-01", "2022-12-31")
            .validate()
            .is_err());
    }

    #[test]
    fn strict_dates_and_unknown_dates_never_acquire_a_fallback_day() {
        for invalid in [
            "2022-2-01",
            "0000-01-01",
            "2022-13-01",
            "2022-01-01T00:00:00Z",
        ] {
            assert!(calendar_date(invalid).is_err());
        }
        let mut date = BusinessDate {
            precision: DatePrecision::Undated,
            from: None,
            to_exclusive: None,
            raw: Some("sometime in the wet season".into()),
        };
        assert!(date.validate().is_ok());
        date.from = Some("2022-01-01".into());
        assert!(date.validate().is_err());
    }
}
