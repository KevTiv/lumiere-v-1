//! Immutable workflow calendars and deterministic local deadline evidence.
//!
//! Workflow calendars deliberately do not reuse the mutable PSA or HR calendars. A
//! logical [`WorkflowCalendar`] is an insert-only identity. Every material change is a
//! new [`WorkflowCalendarVersion`] with a content hash, and dated overlays are immutable
//! [`WorkflowCalendarException`] rows owned by that version.

use std::cmp::{max, min};

use chrono::{
    DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone,
    Timelike, Utc, Weekday,
};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::organization;

/// Monday is bit zero and Sunday is bit six.
pub const MONDAY_TO_FRIDAY: u8 = 0b0001_1111;
const MAX_LOCAL_RESOLUTION_SECONDS: i64 = 172_800;

/// Pilot geography-pack markets.
#[derive(
    SpacetimeType, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord,
)]
#[serde(rename_all = "UPPERCASE")]
pub enum WorkflowCalendarMarket {
    Au,
    Nz,
    Za,
    Br,
    Ar,
    Cl,
    Sg,
    My,
    Id,
    Ph,
}

/// Ownership boundary for a logical workflow calendar.
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowCalendarScope {
    GlobalPack,
    Organization,
    Company,
}

/// Which UTC instant wins when a local wall clock value occurs twice.
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DstOverlapPolicy {
    Earlier,
    Later,
}

/// Evidence describing how a local wall clock value was resolved.
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DstResolution {
    Exact,
    GapAdvanced,
    OverlapEarlier,
    OverlapLater,
}

/// Geographic applicability of a dated exception.
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalendarExceptionScope {
    National,
    Subdivision,
    Locality,
}

/// Semantics of a dated calendar exception.
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalendarExceptionCategory {
    PublicHoliday,
    ObservedHoliday,
    CollectiveLeave,
    SpecialNonWorkingDay,
    CompanyClosure,
    WorkingDayOverride,
}

/// Stable workflow calendar identity. Rows are never updated in this module.
#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = workflow_calendar,
    index(accessor = workflow_calendar_by_key, btree(columns = [calendar_key])),
    index(accessor = workflow_calendar_by_organization, btree(columns = [organization_id])),
    index(
        accessor = workflow_calendar_by_organization_and_key,
        btree(columns = [organization_id, calendar_key])
    ),
    index(accessor = workflow_calendar_by_company, btree(columns = [company_id]))
)]
pub struct WorkflowCalendar {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub calendar_key: String,
    pub name: String,
    pub market: WorkflowCalendarMarket,
    pub scope: WorkflowCalendarScope,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub created_at: Timestamp,
}

/// Immutable calendar rules. Callers pin this ID when they calculate a timer.
#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = workflow_calendar_version,
    index(accessor = workflow_calendar_version_by_calendar, btree(columns = [calendar_id])),
    index(accessor = workflow_calendar_version_by_hash, btree(columns = [content_hash])),
    index(
        accessor = workflow_calendar_version_by_organization,
        btree(columns = [organization_id])
    )
)]
pub struct WorkflowCalendarVersion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub calendar_id: u64,
    pub version_number: u32,
    pub locale: String,
    pub subdivision: Option<String>,
    pub locality: Option<String>,
    pub iana_timezone: String,
    pub weekday_mask: u8,
    pub workday_start_minute: u16,
    pub cutoff_minute: u16,
    pub dst_overlap_policy: DstOverlapPolicy,
    pub effective_from_year: u16,
    pub effective_through_year: u16,
    pub content_hash: String,
    pub source_authority: String,
    pub source_title: String,
    pub source_url: String,
    pub source_published_on: Option<String>,
    pub source_retrieved_on: String,
    pub activated_at: Timestamp,
}

/// Immutable dated override, including the source used to classify it.
#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = workflow_calendar_exception,
    index(
        accessor = workflow_calendar_exception_by_version,
        btree(columns = [calendar_version_id])
    ),
    index(
        accessor = workflow_calendar_exception_by_date,
        btree(columns = [local_date_days])
    ),
    index(
        accessor = workflow_calendar_exception_by_organization,
        btree(columns = [organization_id])
    )
)]
pub struct WorkflowCalendarException {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub calendar_version_id: u64,
    /// Days since 1970-01-01. This avoids interpreting a local date as a UTC timestamp.
    pub local_date_days: i32,
    pub name: String,
    pub category: CalendarExceptionCategory,
    pub scope: CalendarExceptionScope,
    pub subdivision: Option<String>,
    pub locality: Option<String>,
    pub is_working_day: bool,
    pub workday_start_minute: Option<u16>,
    pub cutoff_minute: Option<u16>,
    pub effective_year: u16,
    pub source_authority: String,
    pub source_title: String,
    pub source_url: String,
    pub source_published_on: Option<String>,
    pub source_retrieved_on: String,
}

/// Official-source metadata carried by each source-controlled pack version.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarSourceMetadata {
    pub authority: String,
    pub title: String,
    pub url: String,
    pub published_on: Option<String>,
    pub retrieved_on: String,
    pub effective_year: u16,
}

/// A dated exception from the source-controlled foundation asset.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarExceptionSeed {
    pub local_date: String,
    pub name: String,
    pub category: CalendarExceptionCategory,
    pub scope: CalendarExceptionScope,
    pub subdivision: Option<String>,
    pub locality: Option<String>,
    pub is_working_day: bool,
    pub workday_start_minute: Option<u16>,
    pub cutoff_minute: Option<u16>,
    pub source: Option<CalendarSourceMetadata>,
}

/// Canonical input for insert-only calendar-version activation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkflowCalendarPackSeed {
    pub calendar_key: String,
    pub name: String,
    pub market: WorkflowCalendarMarket,
    pub locale: String,
    pub subdivision: Option<String>,
    pub locality: Option<String>,
    pub iana_timezone: String,
    pub weekday_mask: u8,
    pub workday_start_minute: u16,
    pub cutoff_minute: u16,
    pub dst_overlap_policy: DstOverlapPolicy,
    pub effective_from_year: u16,
    pub effective_through_year: u16,
    pub content_hash: String,
    pub source: CalendarSourceMetadata,
    pub exceptions: Vec<CalendarExceptionSeed>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct WorkflowCalendarPackAsset {
    schema_version: u16,
    packs: Vec<WorkflowCalendarPackSeed>,
}

/// Result of replaying or inserting an immutable version.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarActivationReceipt {
    pub calendar_id: u64,
    pub calendar_version_id: u64,
    pub content_hash: String,
    pub inserted: bool,
}

/// Summary returned by the seed bridge.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CalendarSeedSummary {
    pub inserted_versions: u32,
    pub replayed_versions: u32,
}

/// Inputs to the pure working-time calculation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeadlineRequest {
    pub start_utc: Timestamp,
    pub working_minutes: u32,
    pub subdivision: Option<String>,
    pub locality: Option<String>,
}

/// Auditable conversion from a local due value to its UTC instant.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowDeadlineEvidence {
    pub calendar_version_id: u64,
    pub calendar_content_hash: String,
    pub iana_timezone: String,
    pub requested_local_value: String,
    pub resolved_local_value: String,
    pub utc_instant: Timestamp,
    pub dst_resolution: DstResolution,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WorkWindow {
    start_minute: u16,
    cutoff_minute: u16,
}

/// Parse and validate the source-controlled ten-market foundation asset.
pub fn foundation_calendar_packs() -> Result<Vec<WorkflowCalendarPackSeed>, String> {
    let asset: WorkflowCalendarPackAsset = serde_json::from_str(include_str!(
        "../../assets/workflow_packs/calendar-foundation-v1.json"
    ))
    .map_err(|error| format!("workflow calendar foundation asset is invalid: {error}"))?;
    if asset.schema_version != 1 {
        return Err("workflow calendar foundation asset schema_version must be 1".to_string());
    }
    if asset.packs.len() != 10 {
        return Err("workflow calendar foundation asset must contain ten market packs".to_string());
    }
    for pack in &asset.packs {
        validate_pack(pack)?;
    }
    Ok(asset.packs)
}

/// Idempotently materialize organization-owned copies of the foundation packs.
///
/// This bridge only inserts. A new content hash creates a new immutable version; a
/// repeated hash returns the existing version. No current-version pointer is changed.
pub(crate) fn activate_foundation_calendar_packs(
    ctx: &ReducerContext,
) -> Result<CalendarSeedSummary, String> {
    let mut summary = CalendarSeedSummary::default();
    let organization_ids: Vec<u64> = ctx.db.organization().iter().map(|row| row.id).collect();
    if organization_ids.is_empty() {
        return Err("cannot activate workflow calendar packs without an organization".to_string());
    }
    for organization_id in organization_ids {
        for pack in foundation_calendar_packs()? {
            let receipt = activate_calendar_pack(ctx, organization_id, &pack)?;
            if receipt.inserted {
                summary.inserted_versions += 1;
            } else {
                summary.replayed_versions += 1;
            }
        }
    }
    Ok(summary)
}

/// Insert one organization-owned pack version, or return the identical existing version.
pub(crate) fn activate_calendar_pack(
    ctx: &ReducerContext,
    organization_id: u64,
    pack: &WorkflowCalendarPackSeed,
) -> Result<CalendarActivationReceipt, String> {
    validate_pack(pack)?;

    let calendar = match ctx
        .db
        .workflow_calendar()
        .workflow_calendar_by_key()
        .filter(&pack.calendar_key)
        .find(|row| {
            row.scope == WorkflowCalendarScope::GlobalPack
                && row.organization_id == organization_id
                && row.company_id.is_none()
        }) {
        Some(existing) => {
            if existing.name != pack.name || existing.market != pack.market {
                return Err(format!(
                    "calendar key {} is already bound to different immutable metadata",
                    pack.calendar_key
                ));
            }
            existing
        }
        None => ctx.db.workflow_calendar().insert(WorkflowCalendar {
            id: 0,
            calendar_key: pack.calendar_key.clone(),
            name: pack.name.clone(),
            market: pack.market,
            scope: WorkflowCalendarScope::GlobalPack,
            organization_id,
            company_id: None,
            created_at: ctx.timestamp,
        }),
    };

    if let Some(existing) = ctx
        .db
        .workflow_calendar_version()
        .workflow_calendar_version_by_hash()
        .filter(&pack.content_hash)
        .find(|version| version.calendar_id == calendar.id)
    {
        if existing.organization_id != calendar.organization_id {
            return Err("calendar version does not belong to calendar organization".to_string());
        }
        if ctx
            .db
            .workflow_calendar_exception()
            .workflow_calendar_exception_by_version()
            .filter(&existing.id)
            .any(|exception| exception.organization_id != existing.organization_id)
        {
            return Err(
                "calendar exception does not belong to calendar version organization".to_string(),
            );
        }
        ensure_replay_matches(&existing, pack)?;
        return Ok(CalendarActivationReceipt {
            calendar_id: calendar.id,
            calendar_version_id: existing.id,
            content_hash: existing.content_hash,
            inserted: false,
        });
    }

    if ctx
        .db
        .workflow_calendar_version()
        .workflow_calendar_version_by_hash()
        .filter(&pack.content_hash)
        .any(|version| {
            version.calendar_id != calendar.id
                && ctx
                    .db
                    .workflow_calendar()
                    .id()
                    .find(&version.calendar_id)
                    .is_some_and(|row| row.organization_id == organization_id)
        })
    {
        return Err("calendar content hash is already bound to another calendar".to_string());
    }

    let version_number = ctx
        .db
        .workflow_calendar_version()
        .workflow_calendar_version_by_calendar()
        .filter(&calendar.id)
        .map(|version| version.version_number)
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or("calendar version number overflow")?;

    let version = ctx
        .db
        .workflow_calendar_version()
        .insert(WorkflowCalendarVersion {
            id: 0,
            organization_id: calendar.organization_id,
            calendar_id: calendar.id,
            version_number,
            locale: pack.locale.clone(),
            subdivision: pack.subdivision.clone(),
            locality: pack.locality.clone(),
            iana_timezone: pack.iana_timezone.clone(),
            weekday_mask: pack.weekday_mask,
            workday_start_minute: pack.workday_start_minute,
            cutoff_minute: pack.cutoff_minute,
            dst_overlap_policy: pack.dst_overlap_policy,
            effective_from_year: pack.effective_from_year,
            effective_through_year: pack.effective_through_year,
            content_hash: pack.content_hash.clone(),
            source_authority: pack.source.authority.clone(),
            source_title: pack.source.title.clone(),
            source_url: pack.source.url.clone(),
            source_published_on: pack.source.published_on.clone(),
            source_retrieved_on: pack.source.retrieved_on.clone(),
            activated_at: ctx.timestamp,
        });

    for exception in &pack.exceptions {
        let local_date = parse_local_date(&exception.local_date)?;
        let source = exception.source.as_ref().unwrap_or(&pack.source);
        ctx.db
            .workflow_calendar_exception()
            .insert(WorkflowCalendarException {
                id: 0,
                organization_id: version.organization_id,
                calendar_version_id: version.id,
                local_date_days: local_date_days(local_date)?,
                name: exception.name.clone(),
                category: exception.category,
                scope: exception.scope,
                subdivision: exception.subdivision.clone(),
                locality: exception.locality.clone(),
                is_working_day: exception.is_working_day,
                workday_start_minute: exception.workday_start_minute,
                cutoff_minute: exception.cutoff_minute,
                effective_year: source.effective_year,
                source_authority: source.authority.clone(),
                source_title: source.title.clone(),
                source_url: source.url.clone(),
                source_published_on: source.published_on.clone(),
                source_retrieved_on: source.retrieved_on.clone(),
            });
    }

    Ok(CalendarActivationReceipt {
        calendar_id: calendar.id,
        calendar_version_id: version.id,
        content_hash: version.content_hash,
        inserted: true,
    })
}

/// Convert a wall-clock delay into working-time minutes for deadline math.
///
/// Escalation/timer policies store `delay_seconds`; calendars advance by working
/// minutes. Sub-minute delays round up to one working minute.
pub fn working_minutes_from_delay_seconds(delay_seconds: u64) -> u32 {
    delay_seconds.saturating_add(59).saturating_div(60).max(1) as u32
}

/// Replay a timer policy against a calendar version (WF-18 recompute input).
pub fn calculate_deadline_from_delay_seconds(
    version: &WorkflowCalendarVersion,
    exceptions: &[WorkflowCalendarException],
    start_utc: Timestamp,
    delay_seconds: u64,
) -> Result<WorkflowDeadlineEvidence, String> {
    calculate_workflow_deadline(
        version,
        exceptions,
        &DeadlineRequest {
            start_utc,
            working_minutes: working_minutes_from_delay_seconds(delay_seconds),
            subdivision: version.subdivision.clone(),
            locality: version.locality.clone(),
        },
    )
}

/// Add working minutes using immutable rules and return local/UTC/DST evidence.
pub fn calculate_workflow_deadline(
    version: &WorkflowCalendarVersion,
    exceptions: &[WorkflowCalendarException],
    request: &DeadlineRequest,
) -> Result<WorkflowDeadlineEvidence, String> {
    if exceptions.iter().any(|exception| {
        exception.calendar_version_id == version.id
            && exception.organization_id != version.organization_id
    }) {
        return Err(
            "calendar exception does not belong to calendar version organization".to_string(),
        );
    }
    validate_version_rules(version)?;
    let timezone = parse_timezone(&version.iana_timezone)?;
    let start_utc =
        DateTime::<Utc>::from_timestamp_micros(request.start_utc.to_micros_since_unix_epoch())
            .ok_or("deadline start instant is out of range")?;
    let mut cursor = start_utc.with_timezone(&timezone).naive_local();
    let mut remaining = request.working_minutes;

    loop {
        let Some(window) = work_window_for_date(
            version,
            exceptions,
            cursor.date(),
            request.subdivision.as_deref(),
            request.locality.as_deref(),
        )?
        else {
            cursor = next_local_day(cursor.date())?.and_time(minute_to_time(0)?);
            continue;
        };

        let start = cursor.date().and_time(minute_to_time(window.start_minute)?);
        let cutoff = cursor
            .date()
            .and_time(minute_to_time(window.cutoff_minute)?);
        cursor = max(cursor, start);
        if cursor >= cutoff {
            cursor = next_local_day(cursor.date())?.and_time(minute_to_time(0)?);
            continue;
        }

        if remaining == 0 {
            break;
        }
        let available = (cutoff - cursor).num_minutes() as u32;
        let consumed = min(available, remaining);
        cursor = cursor
            .checked_add_signed(Duration::minutes(i64::from(consumed)))
            .ok_or("deadline local value is out of range")?;
        remaining -= consumed;
        if remaining == 0 {
            break;
        }
        cursor = next_local_day(cursor.date())?.and_time(minute_to_time(0)?);
    }

    let resolved = resolve_local_datetime(timezone, cursor, version.dst_overlap_policy)?;
    Ok(WorkflowDeadlineEvidence {
        calendar_version_id: version.id,
        calendar_content_hash: version.content_hash.clone(),
        iana_timezone: version.iana_timezone.clone(),
        requested_local_value: cursor.to_string(),
        resolved_local_value: resolved.resolved_local_value,
        utc_instant: Timestamp::from_micros_since_unix_epoch(resolved.utc.timestamp_micros()),
        dst_resolution: resolved.resolution,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedLocalDateTime {
    pub requested_local_value: String,
    pub resolved_local_value: String,
    pub utc: DateTime<Utc>,
    pub resolution: DstResolution,
}

/// Resolve one local value. Gaps advance to the first valid instant; overlaps obey policy.
pub fn resolve_local_datetime(
    timezone: Tz,
    requested: NaiveDateTime,
    overlap_policy: DstOverlapPolicy,
) -> Result<ResolvedLocalDateTime, String> {
    let requested_local_value = requested.to_string();
    let (resolved, resolution) = match timezone.from_local_datetime(&requested) {
        LocalResult::Single(value) => (value, DstResolution::Exact),
        LocalResult::Ambiguous(first, second) => match overlap_policy {
            DstOverlapPolicy::Earlier => (
                if first.timestamp_micros() <= second.timestamp_micros() {
                    first
                } else {
                    second
                },
                DstResolution::OverlapEarlier,
            ),
            DstOverlapPolicy::Later => (
                if first.timestamp_micros() >= second.timestamp_micros() {
                    first
                } else {
                    second
                },
                DstResolution::OverlapLater,
            ),
        },
        LocalResult::None => {
            let mut candidate = requested;
            let mut found = None;
            for _ in 0..MAX_LOCAL_RESOLUTION_SECONDS {
                candidate = candidate
                    .checked_add_signed(Duration::seconds(1))
                    .ok_or("local DST gap search overflow")?;
                match timezone.from_local_datetime(&candidate) {
                    LocalResult::Single(value) => {
                        found = Some(value);
                        break;
                    }
                    LocalResult::Ambiguous(first, second) => {
                        found = Some(if first.timestamp_micros() <= second.timestamp_micros() {
                            first
                        } else {
                            second
                        });
                        break;
                    }
                    LocalResult::None => {}
                }
            }
            (
                found.ok_or("no valid local instant found within 48 hours of DST gap")?,
                DstResolution::GapAdvanced,
            )
        }
    };

    Ok(ResolvedLocalDateTime {
        requested_local_value,
        resolved_local_value: resolved.naive_local().to_string(),
        utc: resolved.with_timezone(&Utc),
        resolution,
    })
}

fn validate_pack(pack: &WorkflowCalendarPackSeed) -> Result<(), String> {
    if pack.calendar_key.trim().is_empty() || pack.name.trim().is_empty() {
        return Err("calendar key and name are required".to_string());
    }
    parse_timezone(&pack.iana_timezone)?;
    validate_rule_values(
        pack.weekday_mask,
        pack.workday_start_minute,
        pack.cutoff_minute,
        pack.effective_from_year,
        pack.effective_through_year,
    )?;
    validate_content_hash(&pack.content_hash)?;
    validate_source(&pack.source)?;
    for exception in &pack.exceptions {
        let date = parse_local_date(&exception.local_date)?;
        if date.year()
            != i32::from(
                exception
                    .source
                    .as_ref()
                    .unwrap_or(&pack.source)
                    .effective_year,
            )
        {
            return Err(format!(
                "calendar exception {} does not match its effective year",
                exception.local_date
            ));
        }
        validate_exception_scope(exception)?;
        if let Some(source) = &exception.source {
            validate_source(source)?;
        }
        if exception.is_working_day {
            let start = exception
                .workday_start_minute
                .unwrap_or(pack.workday_start_minute);
            let cutoff = exception.cutoff_minute.unwrap_or(pack.cutoff_minute);
            if start >= cutoff || cutoff > 1_440 {
                return Err("working-day exception has an invalid work window".to_string());
            }
        } else if exception.workday_start_minute.is_some() || exception.cutoff_minute.is_some() {
            return Err("non-working exception cannot define a work window".to_string());
        }
    }
    Ok(())
}

fn validate_version_rules(version: &WorkflowCalendarVersion) -> Result<(), String> {
    parse_timezone(&version.iana_timezone)?;
    validate_rule_values(
        version.weekday_mask,
        version.workday_start_minute,
        version.cutoff_minute,
        version.effective_from_year,
        version.effective_through_year,
    )?;
    validate_content_hash(&version.content_hash)
}

fn validate_rule_values(
    weekday_mask: u8,
    workday_start_minute: u16,
    cutoff_minute: u16,
    effective_from_year: u16,
    effective_through_year: u16,
) -> Result<(), String> {
    if weekday_mask == 0 || weekday_mask & !0b0111_1111 != 0 {
        return Err("weekday mask must contain at least one of Monday through Sunday".to_string());
    }
    if workday_start_minute >= cutoff_minute || cutoff_minute > 1_440 {
        return Err(
            "calendar workday start/cutoff must describe a non-empty local day".to_string(),
        );
    }
    if effective_from_year > effective_through_year {
        return Err("calendar effective year range is invalid".to_string());
    }
    Ok(())
}

fn validate_content_hash(content_hash: &str) -> Result<(), String> {
    let Some(hex) = content_hash.strip_prefix("sha256:") else {
        return Err("calendar content hash must use the sha256: prefix".to_string());
    };
    if hex.len() != 64
        || !hex
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("calendar content hash must be a lowercase SHA-256 digest".to_string());
    }
    Ok(())
}

fn validate_source(source: &CalendarSourceMetadata) -> Result<(), String> {
    if source.authority.trim().is_empty()
        || source.title.trim().is_empty()
        || !source.url.starts_with("https://")
        || parse_local_date(&source.retrieved_on).is_err()
    {
        return Err("calendar source metadata is incomplete or invalid".to_string());
    }
    if source.effective_year == 0 {
        return Err("calendar source effective year is required".to_string());
    }
    if let Some(published_on) = &source.published_on {
        parse_local_date(published_on)?;
    }
    Ok(())
}

fn validate_exception_scope(exception: &CalendarExceptionSeed) -> Result<(), String> {
    match exception.scope {
        CalendarExceptionScope::National => {
            if exception.subdivision.is_some() || exception.locality.is_some() {
                return Err("national exception cannot have subdivision/locality".to_string());
            }
        }
        CalendarExceptionScope::Subdivision => {
            if exception.subdivision.is_none() || exception.locality.is_some() {
                return Err("subdivision exception requires only subdivision".to_string());
            }
        }
        CalendarExceptionScope::Locality => {
            if exception.subdivision.is_none() || exception.locality.is_none() {
                return Err("locality exception requires subdivision and locality".to_string());
            }
        }
    }
    Ok(())
}

fn ensure_replay_matches(
    existing: &WorkflowCalendarVersion,
    pack: &WorkflowCalendarPackSeed,
) -> Result<(), String> {
    if existing.locale != pack.locale
        || existing.subdivision != pack.subdivision
        || existing.locality != pack.locality
        || existing.iana_timezone != pack.iana_timezone
        || existing.weekday_mask != pack.weekday_mask
        || existing.workday_start_minute != pack.workday_start_minute
        || existing.cutoff_minute != pack.cutoff_minute
        || existing.dst_overlap_policy != pack.dst_overlap_policy
        || existing.effective_from_year != pack.effective_from_year
        || existing.effective_through_year != pack.effective_through_year
        || existing.source_authority != pack.source.authority
        || existing.source_title != pack.source.title
        || existing.source_url != pack.source.url
        || existing.source_published_on != pack.source.published_on
        || existing.source_retrieved_on != pack.source.retrieved_on
    {
        return Err("calendar content hash replay has different canonical input".to_string());
    }
    Ok(())
}

fn work_window_for_date(
    version: &WorkflowCalendarVersion,
    exceptions: &[WorkflowCalendarException],
    date: NaiveDate,
    subdivision: Option<&str>,
    locality: Option<&str>,
) -> Result<Option<WorkWindow>, String> {
    let effective_year = u16::try_from(date.year()).map_err(|_| "date year is out of range")?;
    if effective_year < version.effective_from_year
        || effective_year > version.effective_through_year
    {
        return Err("deadline date falls outside calendar effective years".to_string());
    }
    let day_index = local_date_days(date)?;
    let mut window = if weekday_is_working(version.weekday_mask, date.weekday()) {
        Some(WorkWindow {
            start_minute: version.workday_start_minute,
            cutoff_minute: version.cutoff_minute,
        })
    } else {
        None
    };

    let mut matching: Vec<&WorkflowCalendarException> = exceptions
        .iter()
        .filter(|exception| {
            exception.calendar_version_id == version.id
                && exception.local_date_days == day_index
                && exception_applies(exception, subdivision, locality)
        })
        .collect();
    matching.sort_by_key(|exception| exception_specificity(exception.scope));
    for exception in matching {
        window = if exception.is_working_day {
            Some(WorkWindow {
                start_minute: exception
                    .workday_start_minute
                    .unwrap_or(version.workday_start_minute),
                cutoff_minute: exception.cutoff_minute.unwrap_or(version.cutoff_minute),
            })
        } else {
            None
        };
    }
    Ok(window)
}

fn exception_applies(
    exception: &WorkflowCalendarException,
    subdivision: Option<&str>,
    locality: Option<&str>,
) -> bool {
    match exception.scope {
        CalendarExceptionScope::National => true,
        CalendarExceptionScope::Subdivision => exception.subdivision.as_deref() == subdivision,
        CalendarExceptionScope::Locality => {
            exception.subdivision.as_deref() == subdivision
                && exception.locality.as_deref() == locality
        }
    }
}

fn exception_specificity(scope: CalendarExceptionScope) -> u8 {
    match scope {
        CalendarExceptionScope::National => 0,
        CalendarExceptionScope::Subdivision => 1,
        CalendarExceptionScope::Locality => 2,
    }
}

fn weekday_is_working(mask: u8, weekday: Weekday) -> bool {
    let bit = match weekday {
        Weekday::Mon => 0,
        Weekday::Tue => 1,
        Weekday::Wed => 2,
        Weekday::Thu => 3,
        Weekday::Fri => 4,
        Weekday::Sat => 5,
        Weekday::Sun => 6,
    };
    mask & (1 << bit) != 0
}

fn minute_to_time(minute: u16) -> Result<NaiveTime, String> {
    if minute > 1_440 {
        return Err("local minute must be between 0 and 1440".to_string());
    }
    if minute == 1_440 {
        return NaiveTime::from_hms_opt(23, 59, 59)
            .ok_or("calendar cutoff minute is invalid".to_string());
    }
    NaiveTime::from_hms_opt(u32::from(minute / 60), u32::from(minute % 60), 0)
        .ok_or("calendar local minute is invalid".to_string())
}

fn parse_timezone(value: &str) -> Result<Tz, String> {
    value
        .parse::<Tz>()
        .map_err(|_| format!("invalid IANA timezone: {value}"))
}

fn parse_local_date(value: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| format!("invalid ISO local date: {value}"))
}

fn local_date_days(date: NaiveDate) -> Result<i32, String> {
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).ok_or("Unix epoch date is invalid")?;
    i32::try_from((date - epoch).num_days()).map_err(|_| "local date is out of range".to_string())
}

fn next_local_day(date: NaiveDate) -> Result<NaiveDate, String> {
    date.checked_add_signed(Duration::days(1))
        .ok_or("deadline local date is out of range".to_string())
}

#[allow(dead_code)]
fn local_minute(value: NaiveDateTime) -> u16 {
    (value.hour() * 60 + value.minute()) as u16
}
