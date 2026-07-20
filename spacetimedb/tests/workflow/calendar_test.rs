//! Workflow calendar foundation, activation, overlay and DST tests.

use std::collections::BTreeSet;

use chrono::{NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::workflow::calendar::{
    activate_foundation_calendar_packs, calculate_workflow_deadline, foundation_calendar_packs,
    resolve_local_datetime, workflow_calendar_exception, workflow_calendar_version,
    CalendarExceptionCategory, CalendarExceptionScope, DeadlineRequest, DstOverlapPolicy,
    DstResolution, WorkflowCalendarException, WorkflowCalendarMarket, WorkflowCalendarVersion,
};

pub fn test_foundation_asset_covers_pilot_markets() -> Result<(), String> {
    let packs = foundation_calendar_packs()?;
    let markets: BTreeSet<_> = packs.iter().map(|pack| pack.market).collect();
    let expected = BTreeSet::from([
        WorkflowCalendarMarket::Au,
        WorkflowCalendarMarket::Nz,
        WorkflowCalendarMarket::Za,
        WorkflowCalendarMarket::Br,
        WorkflowCalendarMarket::Ar,
        WorkflowCalendarMarket::Cl,
        WorkflowCalendarMarket::Sg,
        WorkflowCalendarMarket::My,
        WorkflowCalendarMarket::Id,
        WorkflowCalendarMarket::Ph,
    ]);
    if markets != expected {
        return Err("foundation asset does not cover the ten pilot markets exactly".to_string());
    }
    if packs.iter().any(|pack| {
        pack.source.effective_year != 2026
            || !pack.source.url.starts_with("https://")
            || pack.content_hash.len() != 71
    }) {
        return Err("every foundation pack must carry 2026 source/hash metadata".to_string());
    }

    let au = pack(&packs, WorkflowCalendarMarket::Au)?;
    if !au.exceptions.iter().any(|exception| {
        exception.scope == CalendarExceptionScope::Locality
            && exception.subdivision.as_deref() == Some("AU-QLD")
            && exception.locality.as_deref() == Some("Brisbane")
    }) {
        return Err("AU regional/locality overlay fixture is missing".to_string());
    }
    if !au
        .exceptions
        .iter()
        .any(|exception| exception.category == CalendarExceptionCategory::ObservedHoliday)
    {
        return Err("AU observed-day fixture is missing".to_string());
    }

    let nz = pack(&packs, WorkflowCalendarMarket::Nz)?;
    if nz.iana_timezone != "Pacific/Chatham" || nz.subdivision.as_deref() != Some("NZ-CIT") {
        return Err("NZ Chatham calendar/timezone fixture is missing".to_string());
    }

    let cl = pack(&packs, WorkflowCalendarMarket::Cl)?;
    if cl.iana_timezone != "America/Santiago"
        || !cl.exceptions.iter().any(|exception| {
            exception.scope == CalendarExceptionScope::Subdivision
                && exception.subdivision.as_deref() == Some("CL-AP")
        })
    {
        return Err("CL DST/regional overlay fixture is missing".to_string());
    }

    let my = pack(&packs, WorkflowCalendarMarket::My)?;
    // Kelantan foundation: Sunday-Thursday (Mon-Thu + Sun bits).
    if my.subdivision.as_deref() != Some("MY-03") || my.weekday_mask != 0b0100_1111 {
        return Err("MY state-specific workweek fixture is missing".to_string());
    }

    let id = pack(&packs, WorkflowCalendarMarket::Id)?;
    if !id
        .exceptions
        .iter()
        .any(|exception| exception.category == CalendarExceptionCategory::CollectiveLeave)
    {
        return Err("ID collective-leave classification fixture is missing".to_string());
    }

    Ok(())
}

pub fn test_dst_gap_overlap_and_quarter_hour_zone() -> Result<(), String> {
    let sydney = "Australia/Sydney"
        .parse::<Tz>()
        .map_err(|_| "Sydney timezone unavailable")?;
    let gap = resolve_local_datetime(
        sydney,
        parse_local("2026-10-04 02:30:00")?,
        DstOverlapPolicy::Earlier,
    )?;
    if gap.resolution != DstResolution::GapAdvanced
        || gap.resolved_local_value != "2026-10-04 03:00:00"
    {
        return Err(format!("Sydney DST gap resolved incorrectly: {gap:?}"));
    }

    let overlap_local = parse_local("2026-04-05 02:30:00")?;
    let earlier = resolve_local_datetime(sydney, overlap_local, DstOverlapPolicy::Earlier)?;
    let later = resolve_local_datetime(sydney, overlap_local, DstOverlapPolicy::Later)?;
    if earlier.resolution != DstResolution::OverlapEarlier
        || later.resolution != DstResolution::OverlapLater
        || earlier.utc >= later.utc
        || (later.utc - earlier.utc).num_minutes() != 60
    {
        return Err("Sydney overlap policy did not select distinct ordered instants".to_string());
    }

    let santiago = "America/Santiago"
        .parse::<Tz>()
        .map_err(|_| "Santiago timezone unavailable")?;
    let chile_gap = resolve_local_datetime(
        santiago,
        parse_local("2026-09-06 00:30:00")?,
        DstOverlapPolicy::Earlier,
    )?;
    if chile_gap.resolution != DstResolution::GapAdvanced {
        return Err("Chile DST gap fixture was not classified as a gap".to_string());
    }

    let chatham = "Pacific/Chatham"
        .parse::<Tz>()
        .map_err(|_| "Chatham timezone unavailable")?;
    let chatham_local = parse_local("2026-01-15 12:00:00")?;
    let chatham_exact = resolve_local_datetime(chatham, chatham_local, DstOverlapPolicy::Earlier)?;
    if chatham_exact.resolution != DstResolution::Exact || chatham_exact.utc.minute() != 15 {
        return Err("Chatham quarter-hour offset evidence is incorrect".to_string());
    }

    Ok(())
}

pub fn test_deadline_uses_observed_and_local_overlays() -> Result<(), String> {
    let version = fixture_version();
    let observed_monday = fixture_exception(
        version.id,
        "2026-08-10",
        CalendarExceptionCategory::ObservedHoliday,
        CalendarExceptionScope::National,
        None,
        None,
    )?;
    let brisbane_show = fixture_exception(
        version.id,
        "2026-08-12",
        CalendarExceptionCategory::PublicHoliday,
        CalendarExceptionScope::Locality,
        Some("AU-QLD"),
        Some("Brisbane"),
    )?;
    let exceptions = [observed_monday, brisbane_show];

    // Friday 16:00 AEST plus two working hours skips the observed Monday.
    let friday_start = utc_timestamp(2026, 8, 7, 6, 0)?;
    let due = calculate_workflow_deadline(
        &version,
        &exceptions,
        &DeadlineRequest {
            start_utc: friday_start,
            working_minutes: 120,
            subdivision: Some("AU-NSW".to_string()),
            locality: Some("Sydney".to_string()),
        },
    )?;
    if due.requested_local_value != "2026-08-11 10:00:00"
        || due.dst_resolution != DstResolution::Exact
    {
        return Err(format!("observed-day deadline is incorrect: {due:?}"));
    }

    // Tuesday 16:00 plus two hours lands Thursday only for Brisbane.
    let tuesday_start = utc_timestamp(2026, 8, 11, 6, 0)?;
    let brisbane_due = calculate_workflow_deadline(
        &version,
        &exceptions,
        &DeadlineRequest {
            start_utc: tuesday_start,
            working_minutes: 120,
            subdivision: Some("AU-QLD".to_string()),
            locality: Some("Brisbane".to_string()),
        },
    )?;
    if brisbane_due.requested_local_value != "2026-08-13 10:00:00" {
        return Err(format!(
            "locality overlay deadline is incorrect: {brisbane_due:?}"
        ));
    }

    Ok(())
}

pub fn test_foundation_activation_is_idempotent(ctx: &ReducerContext) -> Result<(), String> {
    let first = activate_foundation_calendar_packs(ctx)?;
    if first.inserted_versions + first.replayed_versions != 10 {
        return Err("first foundation activation did not process ten versions".to_string());
    }
    let version_count = ctx.db.workflow_calendar_version().iter().count();
    let exception_count = ctx.db.workflow_calendar_exception().iter().count();

    let second = activate_foundation_calendar_packs(ctx)?;
    if second.inserted_versions != 0 || second.replayed_versions != 10 {
        return Err("second foundation activation did not replay all versions".to_string());
    }
    if ctx.db.workflow_calendar_version().iter().count() != version_count
        || ctx.db.workflow_calendar_exception().iter().count() != exception_count
    {
        return Err("content-hash replay inserted duplicate calendar rows".to_string());
    }
    Ok(())
}

fn pack(
    packs: &[crate::workflow::calendar::WorkflowCalendarPackSeed],
    market: WorkflowCalendarMarket,
) -> Result<&crate::workflow::calendar::WorkflowCalendarPackSeed, String> {
    packs
        .iter()
        .find(|pack| pack.market == market)
        .ok_or_else(|| format!("missing {market:?} calendar pack"))
}

fn fixture_version() -> WorkflowCalendarVersion {
    WorkflowCalendarVersion {
        id: 42,
        calendar_id: 7,
        version_number: 1,
        locale: "en-AU".to_string(),
        subdivision: Some("AU-NSW".to_string()),
        locality: None,
        iana_timezone: "Australia/Sydney".to_string(),
        weekday_mask: 0b0001_1111,
        workday_start_minute: 540,
        cutoff_minute: 1020,
        dst_overlap_policy: DstOverlapPolicy::Earlier,
        effective_from_year: 2026,
        effective_through_year: 2026,
        content_hash: "sha256:b8ebba3d8eef6c93e6b617a3cd7ea3921e6e0228836cad2b345804ce908cd509"
            .to_string(),
        source_authority: "fixture authority".to_string(),
        source_title: "fixture source".to_string(),
        source_url: "https://example.invalid/fixture".to_string(),
        source_published_on: None,
        source_retrieved_on: "2026-07-19".to_string(),
        activated_at: Timestamp::from_micros_since_unix_epoch(0),
    }
}

fn fixture_exception(
    calendar_version_id: u64,
    date: &str,
    category: CalendarExceptionCategory,
    scope: CalendarExceptionScope,
    subdivision: Option<&str>,
    locality: Option<&str>,
) -> Result<WorkflowCalendarException, String> {
    let local_date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| format!("invalid fixture date: {date}"))?;
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).ok_or("invalid epoch fixture")?;
    let local_date_days =
        i32::try_from((local_date - epoch).num_days()).map_err(|_| "fixture date out of range")?;
    Ok(WorkflowCalendarException {
        id: 0,
        calendar_version_id,
        local_date_days,
        name: "fixture exception".to_string(),
        category,
        scope,
        subdivision: subdivision.map(str::to_string),
        locality: locality.map(str::to_string),
        is_working_day: false,
        workday_start_minute: None,
        cutoff_minute: None,
        effective_year: 2026,
        source_authority: "fixture authority".to_string(),
        source_title: "fixture source".to_string(),
        source_url: "https://example.invalid/fixture".to_string(),
        source_published_on: None,
        source_retrieved_on: "2026-07-19".to_string(),
    })
}

fn parse_local(value: &str) -> Result<NaiveDateTime, String> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .map_err(|_| format!("invalid local datetime fixture: {value}"))
}

fn utc_timestamp(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
) -> Result<Timestamp, String> {
    let instant = Utc
        .with_ymd_and_hms(year, month, day, hour, minute, 0)
        .single()
        .ok_or("invalid UTC fixture")?;
    Ok(Timestamp::from_micros_since_unix_epoch(
        instant.timestamp_micros(),
    ))
}
