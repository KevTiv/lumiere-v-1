//! Wall-clock scheduling for automated owner-report delivery.

use chrono::{DateTime, Days, Duration, LocalResult, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;

pub struct ReportSchedule {
    date_cadence: DateCadence,
    local_time: NaiveTime,
    timezone: Tz,
}

enum DateCadence {
    Daily,
    Weekly,
    Monthly,
}

impl ReportSchedule {
    pub fn new(frequency: &str, hour: u8, minute: u8, timezone: Tz) -> Result<Self, &'static str> {
        let date_cadence = match frequency.to_ascii_lowercase().as_str() {
            "daily" => DateCadence::Daily,
            "weekly" => DateCadence::Weekly,
            "monthly" => DateCadence::Monthly,
            _ => return Err("frequency must be daily, weekly, or monthly"),
        };
        let local_time = NaiveTime::from_hms_opt(hour.into(), minute.into(), 0)
            .ok_or("scheduled report time is invalid")?;
        Ok(Self {
            date_cadence,
            local_time,
            timezone,
        })
    }

    /// Use today's local date as the cadence anchor and pick a time strictly after creation.
    pub fn first_run(&self, now: DateTime<Utc>) -> Result<DateTime<Utc>, &'static str> {
        let today = now.with_timezone(&self.timezone).date_naive();
        self.run_on_or_after(today, now)
    }

    /// Preserve the cadence of the scheduled occurrence even when dispatch is delayed.
    pub fn next_run(
        &self,
        previous: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<DateTime<Utc>, &'static str> {
        let previous_date = previous.with_timezone(&self.timezone).date_naive();
        self.run_on_or_after(self.advance_date(previous_date)?, now)
    }

    fn run_on_or_after(
        &self,
        mut date: NaiveDate,
        now: DateTime<Utc>,
    ) -> Result<DateTime<Utc>, &'static str> {
        loop {
            let local = date.and_time(self.local_time);
            let next = match self.timezone.from_local_datetime(&local) {
                LocalResult::Single(value) | LocalResult::Ambiguous(value, _) => value,
                // Keep the scheduler's policy of shifting a skipped wall time by one hour.
                LocalResult::None => {
                    let shifted = local
                        .checked_add_signed(Duration::hours(1))
                        .ok_or("scheduled report date is out of range")?;
                    self.timezone
                        .from_local_datetime(&shifted)
                        .earliest()
                        .ok_or("scheduled report time is invalid due to DST")?
                }
            }
            .with_timezone(&Utc);
            if next > now {
                return Ok(next);
            }
            date = self.advance_date(date)?;
        }
    }

    fn advance_date(&self, date: NaiveDate) -> Result<NaiveDate, &'static str> {
        let next = match self.date_cadence {
            DateCadence::Daily => date.checked_add_days(Days::new(1)),
            DateCadence::Weekly => date.checked_add_days(Days::new(7)),
            DateCadence::Monthly => date.checked_add_months(chrono::Months::new(1)),
        };
        next.ok_or("scheduled report date is out of range")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(date: &str) -> DateTime<Utc> {
        date.parse().expect("valid UTC fixture")
    }

    #[test]
    fn future_local_time_is_the_first_delivery() {
        let schedule = ReportSchedule::new("daily", 8, 15, chrono_tz::Africa::Kigali).unwrap();
        assert_eq!(
            schedule.first_run(utc("2026-11-15T04:30:00Z")).unwrap(),
            utc("2026-11-15T06:15:00Z")
        );
        assert_eq!(
            schedule.first_run(utc("2026-11-15T06:15:00Z")).unwrap(),
            utc("2026-11-16T06:15:00Z")
        );
    }

    #[test]
    fn elapsed_wall_times_advance_by_the_configured_cadence() {
        let now = utc("2026-01-31T10:00:00Z");
        let weekly = ReportSchedule::new("weekly", 8, 0, chrono_tz::UTC).unwrap();
        let monthly = ReportSchedule::new("monthly", 8, 0, chrono_tz::UTC).unwrap();
        assert_eq!(weekly.first_run(now).unwrap(), utc("2026-02-07T08:00:00Z"));
        assert_eq!(monthly.first_run(now).unwrap(), utc("2026-02-28T08:00:00Z"));
        assert_eq!(
            monthly.next_run(utc("2026-01-31T08:00:00Z"), now).unwrap(),
            utc("2026-02-28T08:00:00Z")
        );
    }

    #[test]
    fn first_run_matches_recurrence_dst_policy() {
        let schedule = ReportSchedule::new("daily", 2, 30, chrono_tz::Europe::Amsterdam).unwrap();
        let now = utc("2026-03-29T00:00:00Z");
        let shifted = utc("2026-03-29T01:30:00Z");
        assert_eq!(schedule.first_run(now).unwrap(), shifted);
        assert_eq!(
            schedule.next_run(utc("2026-03-28T01:30:00Z"), now).unwrap(),
            shifted
        );
        assert_eq!(
            schedule.first_run(utc("2026-10-25T00:00:00Z")).unwrap(),
            utc("2026-10-25T00:30:00Z")
        );
    }

    #[test]
    fn validates_frequency_and_wall_time() {
        assert!(ReportSchedule::new("quarterly", 8, 15, chrono_tz::UTC).is_err());
        assert!(ReportSchedule::new("daily", 24, 15, chrono_tz::UTC).is_err());
        assert!(ReportSchedule::new("daily", 8, 60, chrono_tz::UTC).is_err());
    }
}
