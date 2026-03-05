/// Activities Module — Activity & Calendar Management

///
/// Tables:
///   - Activity
///   - ActivityType
///   - CalendarEvent
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::check_permission;

// ══════════════════════════════════════════════════════════════════════════════
// PARAMS TYPES
// ══════════════════════════════════════════════════════════════════════════════

/// Params for creating an activity.
/// Scope: `organization_id` is a flat reducer param (not in this struct).
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateActivityParams {
    pub activity_type: String,
    pub summary: String,
    pub priority: String,
    pub state: String,
    pub auto: bool,
    pub is_system: bool,
    pub is_done: bool,
    pub note: Option<String>,
    pub date_deadline: Option<Timestamp>,
    pub date_done: Option<Timestamp>,
    pub assigned_to: Option<Identity>,
    pub res_model: Option<String>,
    pub res_id: Option<u64>,
    pub duration: Option<i32>,
    pub location: Option<String>,
    pub video_url: Option<String>,
    pub metadata: Option<String>,
}

/// Params for creating a calendar event.
/// Scope: `organization_id` is a flat reducer param (not in this struct).
/// `duration` is computed from `start`/`stop`/`allday` — not in params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCalendarEventParams {
    pub name: String,
    pub start: Timestamp,
    pub stop: Timestamp,
    pub allday: bool,
    pub privacy: String,
    pub show_as: String,
    pub state: String,
    pub recurrency: bool,
    pub partner_ids: Vec<u64>,
    pub alarm_ids: Vec<u64>,
    pub user_id: Option<Identity>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub videocall_location: Option<String>,
    pub color: Option<String>,
    pub recurrence_id: Option<u64>,
    pub rrule: Option<String>,
    pub rrule_type: Option<String>,
    pub final_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

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
    params: CreateActivityParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "activity", "create")?;

    if params.summary.is_empty() {
        return Err("Activity summary cannot be empty".to_string());
    }

    ctx.db.activity().insert(Activity {
        id: 0,
        organization_id,
        activity_type: params.activity_type,
        summary: params.summary,
        note: params.note,
        date_deadline: params.date_deadline,
        date_done: params.date_done,
        auto: params.auto,
        // System-managed: user_id set from caller context
        user_id: Some(ctx.sender()),
        assigned_to: params.assigned_to,
        res_model: params.res_model,
        res_id: params.res_id,
        is_done: params.is_done,
        is_system: params.is_system,
        priority: params.priority,
        state: params.state,
        duration: params.duration,
        location: params.location,
        video_url: params.video_url,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        deleted_at: None,
        metadata: params.metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn complete_activity(
    ctx: &ReducerContext,
    organization_id: u64,
    activity_id: u64,
) -> Result<(), String> {
    let activity = ctx
        .db
        .activity()
        .id()
        .find(&activity_id)
        .ok_or("Activity not found")?;

    if activity.organization_id != organization_id {
        return Err("Activity does not belong to this organization".to_string());
    }
    check_permission(ctx, organization_id, "activity", "write")?;

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
    params: CreateCalendarEventParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "calendar_event", "create")?;

    if params.name.is_empty() {
        return Err("Event name cannot be empty".to_string());
    }

    if params.stop < params.start {
        return Err("End time must be after start time".to_string());
    }

    // duration is computed from start/stop; not provided by caller
    let duration = if params.allday {
        None
    } else {
        Some(
            params.stop.to_micros_since_unix_epoch() as f64 / 3_600_000_000.0
                - params.start.to_micros_since_unix_epoch() as f64 / 3_600_000_000.0,
        )
    };

    ctx.db.calendar_event().insert(CalendarEvent {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        start: params.start,
        stop: params.stop,
        duration,
        allday: params.allday,
        location: params.location,
        videocall_location: params.videocall_location,
        privacy: params.privacy,
        show_as: params.show_as,
        color: params.color,
        user_id: params.user_id,
        partner_ids: params.partner_ids,
        alarm_ids: params.alarm_ids,
        recurrency: params.recurrency,
        recurrence_id: params.recurrence_id,
        final_date: params.final_date,
        rrule: params.rrule,
        rrule_type: params.rrule_type,
        state: params.state,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    Ok(())
}
