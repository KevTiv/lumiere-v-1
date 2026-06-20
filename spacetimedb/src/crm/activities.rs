/// Activities Module — Activity & Calendar Management

///
/// Tables:
///   - Activity
///   - ActivityType
///   - CalendarEvent
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

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

/// Params for updating a calendar event.
/// All fields are optional; only provided values are updated.
/// `duration` is recomputed from `start`/`stop`/`allday` when any of those change.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateCalendarEventParams {
    pub name: Option<String>,
    pub start: Option<Timestamp>,
    pub stop: Option<Timestamp>,
    pub allday: Option<bool>,
    pub privacy: Option<String>,
    pub show_as: Option<String>,
    pub state: Option<String>,
    pub recurrency: Option<bool>,
    pub partner_ids: Option<Vec<u64>>,
    pub alarm_ids: Option<Vec<u64>>,
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

    let activity = ctx.db.activity().insert(Activity {
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "activity",
            record_id: activity.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "summary": activity.summary,
                    "activity_type": activity.activity_type,
                    "state": activity.state,
                })
                .to_string(),
            ),
            changed_fields: vec!["summary".to_string(), "activity_type".to_string()],
            metadata: None,
        },
    );

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

    let old_is_done = activity.is_done;
    let old_state = activity.state.clone();
    let old_date_done = activity.date_done.map(|ts| ts.to_micros_since_unix_epoch());

    ctx.db.activity().id().update(Activity {
        is_done: true,
        state: "done".to_string(),
        date_done: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        ..activity
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "activity",
            record_id: activity_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "is_done": old_is_done,
                    "state": old_state,
                    "date_done": old_date_done,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "is_done": true,
                    "state": "done",
                })
                .to_string(),
            ),
            changed_fields: vec![
                "is_done".to_string(),
                "state".to_string(),
                "date_done".to_string(),
            ],
            metadata: None,
        },
    );

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

    let event = ctx.db.calendar_event().insert(CalendarEvent {
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "calendar_event",
            record_id: event.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": event.name,
                    "start": event.start.to_micros_since_unix_epoch(),
                    "stop": event.stop.to_micros_since_unix_epoch(),
                    "state": event.state,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "start".to_string(), "stop".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_calendar_event(
    ctx: &ReducerContext,
    organization_id: u64,
    event_id: u64,
    params: UpdateCalendarEventParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "calendar_event", "write")?;

    let event = ctx
        .db
        .calendar_event()
        .id()
        .find(&event_id)
        .ok_or("Calendar event not found")?;

    if event.organization_id != organization_id {
        return Err("Calendar event does not belong to this organization".to_string());
    }

    // Validate name if provided
    if let Some(ref name) = params.name {
        if name.is_empty() {
            return Err("Event name cannot be empty".to_string());
        }
    }

    // Determine new start/stop/allday values
    let new_start = params.start.unwrap_or(event.start);
    let new_stop = params.stop.unwrap_or(event.stop);
    let new_allday = params.allday.unwrap_or(event.allday);

    // Validate time range if either start or stop was provided
    if params.start.is_some() || params.stop.is_some() {
        if new_stop < new_start {
            return Err("End time must be after start time".to_string());
        }
    }

    // Recompute duration if start, stop, or allday changed
    let new_duration = if new_allday {
        None
    } else {
        Some(
            new_stop.to_micros_since_unix_epoch() as f64 / 3_600_000_000.0
                - new_start.to_micros_since_unix_epoch() as f64 / 3_600_000_000.0,
        )
    };

    let mut changed_fields = Vec::new();
    if params.name.is_some() {
        changed_fields.push("name".to_string());
    }
    if params.start.is_some() {
        changed_fields.push("start".to_string());
    }
    if params.stop.is_some() {
        changed_fields.push("stop".to_string());
    }
    if params.allday.is_some() {
        changed_fields.push("allday".to_string());
    }
    if params.privacy.is_some() {
        changed_fields.push("privacy".to_string());
    }
    if params.show_as.is_some() {
        changed_fields.push("show_as".to_string());
    }
    if params.state.is_some() {
        changed_fields.push("state".to_string());
    }
    if params.description.is_some() {
        changed_fields.push("description".to_string());
    }
    if params.location.is_some() {
        changed_fields.push("location".to_string());
    }
    if params.videocall_location.is_some() {
        changed_fields.push("videocall_location".to_string());
    }
    if params.color.is_some() {
        changed_fields.push("color".to_string());
    }
    if params.user_id.is_some() {
        changed_fields.push("user_id".to_string());
    }
    if params.partner_ids.is_some() {
        changed_fields.push("partner_ids".to_string());
    }
    if params.alarm_ids.is_some() {
        changed_fields.push("alarm_ids".to_string());
    }
    if params.recurrency.is_some() {
        changed_fields.push("recurrency".to_string());
    }
    if params.recurrence_id.is_some() {
        changed_fields.push("recurrence_id".to_string());
    }
    if params.final_date.is_some() {
        changed_fields.push("final_date".to_string());
    }
    if params.rrule.is_some() {
        changed_fields.push("rrule".to_string());
    }
    if params.rrule_type.is_some() {
        changed_fields.push("rrule_type".to_string());
    }
    if params.metadata.is_some() {
        changed_fields.push("metadata".to_string());
    }

    let old_name = event.name.clone();
    let old_state = event.state.clone();

    ctx.db.calendar_event().id().update(CalendarEvent {
        name: params.name.unwrap_or(event.name),
        description: params.description.or(event.description),
        start: new_start,
        stop: new_stop,
        duration: new_duration,
        allday: new_allday,
        location: params.location.or(event.location),
        videocall_location: params.videocall_location.or(event.videocall_location),
        privacy: params.privacy.unwrap_or(event.privacy),
        show_as: params.show_as.unwrap_or(event.show_as),
        color: params.color.or(event.color),
        user_id: params.user_id.or(event.user_id),
        partner_ids: params.partner_ids.unwrap_or(event.partner_ids),
        alarm_ids: params.alarm_ids.unwrap_or(event.alarm_ids),
        recurrency: params.recurrency.unwrap_or(event.recurrency),
        recurrence_id: params.recurrence_id.or(event.recurrence_id),
        final_date: params.final_date.or(event.final_date),
        rrule: params.rrule.or(event.rrule),
        rrule_type: params.rrule_type.or(event.rrule_type),
        state: params.state.unwrap_or(event.state),
        metadata: params.metadata.or(event.metadata),
        ..event
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "calendar_event",
            record_id: event_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "name": old_name,
                    "state": old_state,
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_calendar_event(
    ctx: &ReducerContext,
    organization_id: u64,
    event_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "calendar_event", "delete")?;

    let event = ctx
        .db
        .calendar_event()
        .id()
        .find(&event_id)
        .ok_or("Calendar event not found")?;

    if event.organization_id != organization_id {
        return Err("Calendar event does not belong to this organization".to_string());
    }

    ctx.db.calendar_event().id().delete(&event_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "calendar_event",
            record_id: event_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "name": event.name,
                    "state": event.state,
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}
