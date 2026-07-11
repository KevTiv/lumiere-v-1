//! IANA timezone report windows for owner reports.
//!
//! All preview queries use a half-open UTC interval `[window_start_utc, window_end_utc)`
//! that corresponds to one local calendar day in the requested timezone.

use chrono::{DateTime, Days, LocalResult, NaiveDate, NaiveTime, SecondsFormat, TimeZone, Utc};
use chrono_tz::Tz;

use crate::error::ApiError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportDayWindow {
    pub local_date: NaiveDate,
    pub local_end_date: NaiveDate,
    pub timezone: String,
    pub window_start_utc: DateTime<Utc>,
    pub window_end_utc: DateTime<Utc>,
    pub start_sql: String,
    pub end_sql: String,
    pub cutoff_label: String,
}

pub fn parse_timezone(timezone: &str) -> Result<Tz, ApiError> {
    timezone
        .parse::<Tz>()
        .map_err(|_| ApiError::BadRequest("timezone must be a valid IANA identifier".into()))
}

pub fn day_window(date: NaiveDate, timezone: &str) -> Result<ReportDayWindow, ApiError> {
    let tz = parse_timezone(timezone)?;
    let local_end_date = date
        .checked_add_days(Days::new(1))
        .ok_or_else(|| ApiError::BadRequest("Date is outside the supported range".into()))?;

    let window_start_utc = local_midnight_utc(tz, date)?;
    let window_end_utc = local_midnight_utc(tz, local_end_date)?;

    let start_sql = format_utc_sql(&window_start_utc);
    let end_sql = format_utc_sql(&window_end_utc);
    let cutoff_label = format!(
        "{} {} local day [{start_sql}, {end_sql}) UTC",
        date.format("%Y-%m-%d"),
        timezone
    );

    Ok(ReportDayWindow {
        local_date: date,
        local_end_date,
        timezone: timezone.to_string(),
        window_start_utc,
        window_end_utc,
        start_sql,
        end_sql,
        cutoff_label,
    })
}

fn local_midnight_utc(tz: Tz, date: NaiveDate) -> Result<DateTime<Utc>, ApiError> {
    let naive = date.and_time(NaiveTime::from_hms_opt(0, 0, 0).expect("midnight is valid"));
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(instant) => Ok(instant.with_timezone(&Utc)),
        LocalResult::Ambiguous(earlier, _) => Ok(earlier.with_timezone(&Utc)),
        LocalResult::None => Err(ApiError::BadRequest(format!(
            "local midnight on {} is invalid in timezone {tz} due to daylight-saving transition",
            date.format("%Y-%m-%d")
        ))),
    }
}

fn format_utc_sql(instant: &DateTime<Utc>) -> String {
    instant.to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_timezone_uses_utc_midnight_boundaries() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 10).expect("valid date");
        let window = day_window(date, "UTC").expect("UTC window");

        assert_eq!(window.start_sql, "2026-07-10T00:00:00Z");
        assert_eq!(window.end_sql, "2026-07-11T00:00:00Z");
        assert!(window.cutoff_label.contains("2026-07-10 UTC local day"));
    }

    #[test]
    fn africa_nairobi_shifts_window_by_three_hours() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 10).expect("valid date");
        let window = day_window(date, "Africa/Nairobi").expect("Nairobi window");

        assert_eq!(window.start_sql, "2026-07-09T21:00:00Z");
        assert_eq!(window.end_sql, "2026-07-10T21:00:00Z");
        assert!(window.cutoff_label.contains("Africa/Nairobi"));
    }

    #[test]
    fn rejects_unknown_timezone() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 10).expect("valid date");
        let error = day_window(date, "Not/A_Real_Zone").expect_err("invalid tz");
        assert!(matches!(error, ApiError::BadRequest(_)));
    }

    #[test]
    fn spring_forward_day_uses_valid_local_midnight() {
        let date = NaiveDate::from_ymd_opt(2026, 3, 8).expect("valid date");
        let window = day_window(date, "America/New_York").expect("local midnight exists");
        assert_eq!(window.start_sql, "2026-03-08T05:00:00Z");
        assert_eq!(window.end_sql, "2026-03-09T04:00:00Z");
    }

    #[test]
    fn fall_back_day_resolves_ambiguous_local_midnight() {
        let date = NaiveDate::from_ymd_opt(2026, 11, 1).expect("valid date");
        let window = day_window(date, "America/New_York").expect("ambiguous midnight resolves");
        assert_eq!(window.start_sql, "2026-11-01T04:00:00Z");
        assert_eq!(window.end_sql, "2026-11-02T05:00:00Z");
    }
}
