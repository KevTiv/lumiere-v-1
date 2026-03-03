/// Activities Module — Activity & Calendar Management

///
/// Tables:
///   - Activity
///   - ActivityType
///   - CalendarEvent
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::check_permission;

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: ACTIVITIES
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = activity,
    public,
    index(accessor = activity_by_org, btree(columns = [organization_id])),
    index(accessor = activity_by_user, btree(columns = [user_id])),
    index(accessor = activity_by_deadline, btree(columns = [date_deadline]))
)]
pub struct Activity {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub activity_type: String,
    pub summary: String,
    pub note: Option<String>,
    pub date_deadline: Option<Timestamp>,
    pub date_done: Option<Timestamp>,
    pub auto: bool,
    pub user_id: Option<Identity>,
    pub assigned_to: Option<Identity>,
    pub res_model: Option<String>,
    pub res_id: Option<u64>,
    pub is_done: bool,
    pub is_system: bool,
    pub priority: String,
    pub state: String,
    pub duration: Option<i32>,
    pub location: Option<String>,
    pub video_url: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = activity_type,
    public,
    index(accessor = activity_type_by_org, btree(columns = [organization_id]))
)]
pub struct ActivityType {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub category: String,
    pub summary: Option<String>,
    pub sequence: i32,
    pub delay_count: Option<i32>,
    pub delay_unit: Option<String>,
    pub delay_from: Option<String>,
    pub icon: Option<String>,
    pub chaining_type: String,
    pub suggested_next_type_id: Option<u64>,
    pub triggered_next_type_id: Option<u64>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = calendar_event,
    public,
    index(accessor = event_by_org, btree(columns = [organization_id])),
    index(accessor = event_by_user, btree(columns = [user_id]))
)]
pub struct CalendarEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub start: Timestamp,
    pub stop: Timestamp,
    pub duration: Option<f64>,
    pub allday: bool,
    pub location: Option<String>,
    pub videocall_location: Option<String>,
    pub privacy: String,
    pub show_as: String,
    pub color: Option<String>,
    pub user_id: Option<Identity>,
    pub partner_ids: Vec<u64>,
    pub alarm_ids: Vec<u64>,
    pub recurrency: bool,
    pub recurrence_id: Option<u64>,
    pub final_date: Option<Timestamp>,
    pub rrule: Option<String>,
    pub rrule_type: Option<String>,
    pub state: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: ACTIVITY MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_activity(
    ctx: &ReducerContext,
    organization_id: u64,
    activity_type: String,
    summary: String,
    note: Option<String>,
    date_deadline: Option<Timestamp>,
    assigned_to: Option<Identity>,
    res_model: Option<String>,
    res_id: Option<u64>,
    priority: String,
    state: String,
    // Additional fields
    duration: Option<i32>,
    location: Option<String>,
    video_url: Option<String>,
    auto: bool,
    is_system: bool,
    // Status fields
    date_done: Option<Timestamp>,
    is_done: bool,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "activity", "create")?;

    if summary.is_empty() {
        return Err("Activity summary cannot be empty".to_string());
    }

    ctx.db.activity().insert(Activity {
        id: 0,
        organization_id,
        activity_type,
        summary,
        note,
        date_deadline,
        date_done,
        auto,
        user_id: Some(ctx.sender()),
        assigned_to,
        res_model,
        res_id,
        is_done,
        is_system,
        priority,
        state,
        duration,
        location,
        video_url,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        deleted_at: None,
        metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn complete_activity(ctx: &ReducerContext, activity_id: u64) -> Result<(), String> {
    let activity = ctx
        .db
        .activity()
        .id()
        .find(&activity_id)
        .ok_or("Activity not found")?;

    check_permission(ctx, activity.organization_id, "activity", "write")?;

    ctx.db.activity().id().update(Activity {
        is_done: true,
        state: "done".to_string(),
        date_done: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        ..activity
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_calendar_event(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    start: Timestamp,
    stop: Timestamp,
    allday: bool,
    user_id: Option<Identity>,
    partner_ids: Vec<u64>,
    privacy: String,
    show_as: String,
    state: String,
    // Additional fields
    description: Option<String>,
    location: Option<String>,
    videocall_location: Option<String>,
    color: Option<String>,
    recurrency: bool,
    recurrence_id: Option<u64>,
    rrule: Option<String>,
    rrule_type: Option<String>,
    final_date: Option<Timestamp>,
    alarm_ids: Vec<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "calendar_event", "create")?;

    if name.is_empty() {
        return Err("Event name cannot be empty".to_string());
    }

    if stop < start {
        return Err("End time must be after start time".to_string());
    }

    let duration = if allday {
        None
    } else {
        Some(
            stop.to_micros_since_unix_epoch() as f64 / 3_600_000_000.0
                - start.to_micros_since_unix_epoch() as f64 / 3_600_000_000.0,
        )
    };

    ctx.db.calendar_event().insert(CalendarEvent {
        id: 0,
        organization_id,
        name,
        description,
        start,
        stop,
        duration,
        allday,
        location,
        videocall_location,
        privacy,
        show_as,
        color,
        user_id,
        partner_ids,
        alarm_ids,
        recurrency,
        recurrence_id,
        final_date,
        rrule,
        rrule_type,
        state,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        metadata,
    });

    Ok(())
}
