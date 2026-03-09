/// Tasks Module — Project task management
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProjectTask** | Task definitions within projects |
use serde_json::{Map, Value};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::projects::projects::{project_project, ProjectProject};
use crate::types::TaskState;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Project Task — A unit of work within a project
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_task,
    public,
    index(name = "by_project", accessor = task_by_project, btree(columns = [project_id])),
    index(accessor = task_by_company, btree(columns = [company_id])),
    index(accessor = task_by_state, btree(columns = [state]))
)]
pub struct ProjectTask {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub priority: String,
    pub sequence: u32,
    pub stage_id: Option<u64>,
    pub state: TaskState,
    pub kanban_state: String,
    pub date_assign: Option<Timestamp>,
    pub date_deadline: Option<Timestamp>,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub color: Option<u8>,
    pub company_id: u64,
    pub project_id: Option<u64>,
    pub user_ids: Vec<Identity>,
    pub milestone_id: Option<u64>,
    pub planned_hours: f64,
    pub total_hours_spent: f64,
    pub effective_hours: f64,
    pub progress: f64,
    pub remaining_hours: f64,
    pub sale_order_id: Option<u64>,
    pub sale_line_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub partner_email: Option<String>,
    pub parent_id: Option<u64>,
    pub child_ids: Vec<u64>,
    pub subtask_count: u32,
    pub closed_subtask_count: u32,
    pub is_closed: bool,
    pub is_blocked: bool,
    pub allow_task_dependencies: bool,
    pub depend_on_ids: Vec<u64>,
    pub dependent_ids: Vec<u64>,
    pub is_private: bool,
    pub permitted_user_ids: Vec<Identity>,
    pub activity_ids: Vec<u64>,
    pub activity_state: Option<String>,
    pub activity_date_deadline: Option<Timestamp>,
    pub activity_type_id: Option<u64>,
    pub activity_user_id: Option<Identity>,
    pub activity_summary: Option<String>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateTaskParams {
    pub project_id: Option<u64>,
    pub name: String,
    pub description: Option<String>,
    pub priority: String,
    pub sequence: u32,
    pub stage_id: Option<u64>,
    pub state: TaskState,
    pub kanban_state: String,
    pub date_deadline: Option<Timestamp>,
    pub date_start: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub color: Option<u8>,
    pub user_ids: Vec<Identity>,
    pub milestone_id: Option<u64>,
    pub planned_hours: f64,
    pub total_hours_spent: f64,
    pub effective_hours: f64,
    pub progress: f64,
    pub remaining_hours: f64,
    pub sale_order_id: Option<u64>,
    pub sale_line_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub partner_email: Option<String>,
    pub parent_id: Option<u64>,
    pub child_ids: Vec<u64>,
    pub subtask_count: u32,
    pub closed_subtask_count: u32,
    pub is_closed: bool,
    pub is_blocked: bool,
    pub allow_task_dependencies: bool,
    pub depend_on_ids: Vec<u64>,
    pub dependent_ids: Vec<u64>,
    pub is_private: bool,
    pub permitted_user_ids: Vec<Identity>,
    pub activity_ids: Vec<u64>,
    pub activity_state: Option<String>,
    pub activity_date_deadline: Option<Timestamp>,
    pub activity_type_id: Option<u64>,
    pub activity_user_id: Option<Identity>,
    pub activity_summary: Option<String>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateTaskParams {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub priority: Option<String>,
    pub sequence: Option<u32>,
    pub stage_id: Option<Option<u64>>,
    pub state: Option<TaskState>,
    pub kanban_state: Option<String>,
    pub date_assign: Option<Option<Timestamp>>,
    pub date_deadline: Option<Option<Timestamp>>,
    pub date_start: Option<Option<Timestamp>>,
    pub date_end: Option<Option<Timestamp>>,
    pub color: Option<Option<u8>>,
    pub project_id: Option<Option<u64>>,
    pub user_ids: Option<Vec<Identity>>,
    pub milestone_id: Option<Option<u64>>,
    pub planned_hours: Option<f64>,
    pub total_hours_spent: Option<f64>,
    pub effective_hours: Option<f64>,
    pub progress: Option<f64>,
    pub sale_order_id: Option<Option<u64>>,
    pub sale_line_id: Option<Option<u64>>,
    pub partner_id: Option<Option<u64>>,
    pub partner_email: Option<Option<String>>,
    pub child_ids: Option<Vec<u64>>,
    pub subtask_count: Option<u32>,
    pub closed_subtask_count: Option<u32>,
    pub is_closed: Option<bool>,
    pub is_blocked: Option<bool>,
    pub allow_task_dependencies: Option<bool>,
    pub depend_on_ids: Option<Vec<u64>>,
    pub dependent_ids: Option<Vec<u64>>,
    pub is_private: Option<bool>,
    pub permitted_user_ids: Option<Vec<Identity>>,
    pub activity_ids: Option<Vec<u64>>,
    pub activity_state: Option<Option<String>>,
    pub activity_date_deadline: Option<Option<Timestamp>>,
    pub activity_type_id: Option<Option<u64>>,
    pub activity_user_id: Option<Option<Identity>>,
    pub activity_summary: Option<Option<String>>,
    pub message_follower_ids: Option<Vec<u64>>,
    pub message_ids: Option<Vec<u64>>,
    pub metadata: Option<Option<String>>,
}

fn timestamp_to_json(timestamp: Option<Timestamp>) -> Value {
    match timestamp {
        Some(ts) => Value::String(
            ts.to_duration_since_unix_epoch()
                .unwrap_or_default()
                .as_micros()
                .to_string(),
        ),
        None => Value::Null,
    }
}

fn identity_to_json(identity: Identity) -> Value {
    Value::String(identity.to_hex().to_string())
}

fn optional_identity_to_json(identity: Option<Identity>) -> Value {
    match identity {
        Some(id) => identity_to_json(id),
        None => Value::Null,
    }
}

fn identity_vec_to_json(identities: &[Identity]) -> Value {
    Value::Array(
        identities
            .iter()
            .map(|identity| identity_to_json(*identity))
            .collect(),
    )
}

fn task_update_old_values(task: &ProjectTask) -> Value {
    let mut scheduling_snapshot = Map::new();
    scheduling_snapshot.insert(
        "date_assign".to_string(),
        timestamp_to_json(task.date_assign),
    );
    scheduling_snapshot.insert(
        "date_deadline".to_string(),
        timestamp_to_json(task.date_deadline),
    );
    scheduling_snapshot.insert("date_start".to_string(), timestamp_to_json(task.date_start));
    scheduling_snapshot.insert("date_end".to_string(), timestamp_to_json(task.date_end));

    let mut effort_snapshot = Map::new();
    effort_snapshot.insert("planned_hours".to_string(), Value::from(task.planned_hours));
    effort_snapshot.insert(
        "total_hours_spent".to_string(),
        Value::from(task.total_hours_spent),
    );
    effort_snapshot.insert(
        "effective_hours".to_string(),
        Value::from(task.effective_hours),
    );
    effort_snapshot.insert("progress".to_string(), Value::from(task.progress));
    effort_snapshot.insert(
        "remaining_hours".to_string(),
        Value::from(task.remaining_hours),
    );

    let mut hierarchy_snapshot = Map::new();
    hierarchy_snapshot.insert("project_id".to_string(), serde_json::json!(task.project_id));
    hierarchy_snapshot.insert("parent_id".to_string(), serde_json::json!(task.parent_id));
    hierarchy_snapshot.insert("child_ids".to_string(), serde_json::json!(task.child_ids));
    hierarchy_snapshot.insert("subtask_count".to_string(), Value::from(task.subtask_count));
    hierarchy_snapshot.insert(
        "closed_subtask_count".to_string(),
        Value::from(task.closed_subtask_count),
    );

    let mut access_snapshot = Map::new();
    access_snapshot.insert("user_ids".to_string(), identity_vec_to_json(&task.user_ids));
    access_snapshot.insert("is_private".to_string(), Value::from(task.is_private));
    access_snapshot.insert(
        "permitted_user_ids".to_string(),
        identity_vec_to_json(&task.permitted_user_ids),
    );

    let mut activity_snapshot = Map::new();
    activity_snapshot.insert(
        "activity_ids".to_string(),
        serde_json::json!(task.activity_ids),
    );
    activity_snapshot.insert(
        "activity_state".to_string(),
        serde_json::json!(task.activity_state),
    );
    activity_snapshot.insert(
        "activity_date_deadline".to_string(),
        timestamp_to_json(task.activity_date_deadline),
    );
    activity_snapshot.insert(
        "activity_type_id".to_string(),
        serde_json::json!(task.activity_type_id),
    );
    activity_snapshot.insert(
        "activity_user_id".to_string(),
        optional_identity_to_json(task.activity_user_id),
    );
    activity_snapshot.insert(
        "activity_summary".to_string(),
        serde_json::json!(task.activity_summary),
    );

    let mut relations_snapshot = Map::new();
    relations_snapshot.insert(
        "milestone_id".to_string(),
        serde_json::json!(task.milestone_id),
    );
    relations_snapshot.insert(
        "sale_order_id".to_string(),
        serde_json::json!(task.sale_order_id),
    );
    relations_snapshot.insert(
        "sale_line_id".to_string(),
        serde_json::json!(task.sale_line_id),
    );
    relations_snapshot.insert("partner_id".to_string(), serde_json::json!(task.partner_id));
    relations_snapshot.insert(
        "partner_email".to_string(),
        serde_json::json!(task.partner_email),
    );
    relations_snapshot.insert(
        "message_follower_ids".to_string(),
        serde_json::json!(task.message_follower_ids),
    );
    relations_snapshot.insert(
        "message_ids".to_string(),
        serde_json::json!(task.message_ids),
    );

    let mut old_values = Map::new();
    old_values.insert("name".to_string(), Value::from(task.name.clone()));
    old_values.insert(
        "description".to_string(),
        serde_json::json!(task.description),
    );
    old_values.insert("priority".to_string(), Value::from(task.priority.clone()));
    old_values.insert("sequence".to_string(), Value::from(task.sequence));
    old_values.insert("stage_id".to_string(), serde_json::json!(task.stage_id));
    old_values.insert(
        "state".to_string(),
        Value::from(format!("{:?}", task.state)),
    );
    old_values.insert(
        "kanban_state".to_string(),
        Value::from(task.kanban_state.clone()),
    );
    old_values.insert("color".to_string(), serde_json::json!(task.color));
    old_values.insert("is_closed".to_string(), Value::from(task.is_closed));
    old_values.insert("is_blocked".to_string(), Value::from(task.is_blocked));
    old_values.insert(
        "allow_task_dependencies".to_string(),
        Value::from(task.allow_task_dependencies),
    );
    old_values.insert(
        "depend_on_ids".to_string(),
        serde_json::json!(task.depend_on_ids),
    );
    old_values.insert(
        "dependent_ids".to_string(),
        serde_json::json!(task.dependent_ids),
    );
    old_values.insert("metadata".to_string(), serde_json::json!(task.metadata));
    old_values.insert("scheduling".to_string(), Value::Object(scheduling_snapshot));
    old_values.insert("effort".to_string(), Value::Object(effort_snapshot));
    old_values.insert("hierarchy".to_string(), Value::Object(hierarchy_snapshot));
    old_values.insert("access".to_string(), Value::Object(access_snapshot));
    old_values.insert("activity".to_string(), Value::Object(activity_snapshot));
    old_values.insert("relations".to_string(), Value::Object(relations_snapshot));

    Value::Object(old_values)
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_task(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateTaskParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_task", "create")?;

    if params.name.trim().is_empty() {
        return Err("Task name cannot be empty".to_string());
    }

    if let Some(pid) = params.project_id {
        let project = ctx
            .db
            .project_project()
            .id()
            .find(&pid)
            .ok_or("Project not found")?;
        if project.company_id != company_id {
            return Err("Project does not belong to this company".to_string());
        }
    }

    if let Some(pid) = params.parent_id {
        let parent = ctx
            .db
            .project_task()
            .id()
            .find(&pid)
            .ok_or("Parent task not found")?;

        if parent.company_id != company_id {
            return Err("Parent task does not belong to this company".to_string());
        }

        if let (Some(task_project_id), Some(parent_project_id)) =
            (params.project_id, parent.project_id)
        {
            if task_project_id != parent_project_id {
                return Err("Parent task must belong to the same project".to_string());
            }
        }
    }

    let task = ctx.db.project_task().insert(ProjectTask {
        id: 0,
        name: params.name.clone(),
        description: params.description.clone(),
        priority: params.priority.clone(),
        sequence: params.sequence,
        stage_id: params.stage_id,
        state: params.state.clone(),
        kanban_state: params.kanban_state.clone(),
        date_assign: if params.user_ids.is_empty() {
            None
        } else {
            Some(ctx.timestamp)
        },
        date_deadline: params.date_deadline,
        date_start: params.date_start,
        date_end: params.date_end,
        color: params.color,
        company_id,
        project_id: params.project_id,
        user_ids: params.user_ids.clone(),
        milestone_id: params.milestone_id,
        planned_hours: params.planned_hours,
        total_hours_spent: params.total_hours_spent,
        effective_hours: params.effective_hours,
        progress: params.progress,
        remaining_hours: params.remaining_hours,
        sale_order_id: params.sale_order_id,
        sale_line_id: params.sale_line_id,
        partner_id: params.partner_id,
        partner_email: params.partner_email.clone(),
        parent_id: params.parent_id,
        child_ids: params.child_ids.clone(),
        subtask_count: params.subtask_count,
        closed_subtask_count: params.closed_subtask_count,
        is_closed: params.is_closed,
        is_blocked: params.is_blocked,
        allow_task_dependencies: params.allow_task_dependencies,
        depend_on_ids: params.depend_on_ids.clone(),
        dependent_ids: params.dependent_ids.clone(),
        is_private: params.is_private,
        permitted_user_ids: params.permitted_user_ids.clone(),
        activity_ids: params.activity_ids.clone(),
        activity_state: params.activity_state.clone(),
        activity_date_deadline: params.activity_date_deadline,
        activity_type_id: params.activity_type_id,
        activity_user_id: params.activity_user_id,
        activity_summary: params.activity_summary.clone(),
        message_follower_ids: params.message_follower_ids.clone(),
        message_ids: params.message_ids.clone(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata.clone(),
    });

    if let Some(pid) = params.parent_id {
        if let Some(parent) = ctx.db.project_task().id().find(&pid) {
            let mut child_ids = parent.child_ids.clone();
            if !child_ids.contains(&task.id) {
                child_ids.push(task.id);
            }

            let closed_subtask_count = child_ids
                .iter()
                .filter_map(|child_id| ctx.db.project_task().id().find(child_id))
                .filter(|child| child.is_closed)
                .count() as u32;

            ctx.db.project_task().id().update(ProjectTask {
                child_ids: child_ids.clone(),
                subtask_count: child_ids.len() as u32,
                closed_subtask_count,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..parent
            });
        }
    }

    if let Some(pid) = params.project_id {
        if let Some(project) = ctx.db.project_project().id().find(&pid) {
            let task_count_open = if task.is_closed {
                project.task_count_open
            } else {
                project.task_count_open + 1
            };

            let task_count_closed = if task.is_closed {
                project.task_count_closed + 1
            } else {
                project.task_count_closed
            };

            let task_count_in_progress = if matches!(task.state, TaskState::InProgress) {
                project.task_count_in_progress + 1
            } else {
                project.task_count_in_progress
            };

            let task_count_blocked = if task.is_blocked {
                project.task_count_blocked + 1
            } else {
                project.task_count_blocked
            };

            ctx.db.project_project().id().update(ProjectProject {
                task_count: project.task_count + 1,
                task_count_open,
                task_count_closed,
                task_count_in_progress,
                task_count_blocked,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..project
            });
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_task",
            record_id: task.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": task.name,
                    "project_id": task.project_id,
                    "state": format!("{:?}", task.state),
                    "planned_hours": task.planned_hours,
                    "parent_id": task.parent_id
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "description".to_string(),
                "priority".to_string(),
                "sequence".to_string(),
                "stage_id".to_string(),
                "state".to_string(),
                "kanban_state".to_string(),
                "date_deadline".to_string(),
                "date_start".to_string(),
                "date_end".to_string(),
                "color".to_string(),
                "project_id".to_string(),
                "user_ids".to_string(),
                "milestone_id".to_string(),
                "planned_hours".to_string(),
                "total_hours_spent".to_string(),
                "effective_hours".to_string(),
                "progress".to_string(),
                "remaining_hours".to_string(),
                "sale_order_id".to_string(),
                "sale_line_id".to_string(),
                "partner_id".to_string(),
                "partner_email".to_string(),
                "parent_id".to_string(),
                "child_ids".to_string(),
                "subtask_count".to_string(),
                "closed_subtask_count".to_string(),
                "is_closed".to_string(),
                "is_blocked".to_string(),
                "allow_task_dependencies".to_string(),
                "depend_on_ids".to_string(),
                "dependent_ids".to_string(),
                "is_private".to_string(),
                "permitted_user_ids".to_string(),
                "activity_ids".to_string(),
                "activity_state".to_string(),
                "activity_date_deadline".to_string(),
                "activity_type_id".to_string(),
                "activity_user_id".to_string(),
                "activity_summary".to_string(),
                "message_follower_ids".to_string(),
                "message_ids".to_string(),
                "metadata".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!("Task created: id={}", task.id);
    Ok(())
}

#[spacetimedb::reducer]
pub fn update_task_state(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    task_id: u64,
    state: TaskState,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_task", "write")?;

    let mut task = ctx
        .db
        .project_task()
        .id()
        .find(&task_id)
        .ok_or("Task not found")?;

    if task.company_id != company_id {
        return Err("Task does not belong to this company".to_string());
    }

    let mut old_values = Map::new();
    old_values.insert(
        "state".to_string(),
        Value::from(format!("{:?}", task.state)),
    );
    old_values.insert("is_closed".to_string(), Value::from(task.is_closed));
    old_values.insert("is_blocked".to_string(), Value::from(task.is_blocked));
    let old_values = Value::Object(old_values);

    let was_closed = task.is_closed;
    let was_blocked = task.is_blocked;
    let was_in_progress = matches!(task.state, TaskState::InProgress);

    let is_closed = matches!(state, TaskState::Done | TaskState::Cancelled);
    let is_blocked = matches!(state, TaskState::ChangesRequested);
    let is_in_progress = matches!(state, TaskState::InProgress);

    task.state = state.clone();
    task.is_closed = is_closed;
    task.is_blocked = is_blocked;
    task.write_uid = ctx.sender();
    task.write_date = ctx.timestamp;

    ctx.db.project_task().id().update(task.clone());

    if let Some(pid) = task.project_id {
        if let Some(project) = ctx.db.project_project().id().find(&pid) {
            let task_count_closed = if is_closed && !was_closed {
                project.task_count_closed + 1
            } else if !is_closed && was_closed {
                project.task_count_closed.saturating_sub(1)
            } else {
                project.task_count_closed
            };

            let task_count_open = if is_closed && !was_closed {
                project.task_count_open.saturating_sub(1)
            } else if !is_closed && was_closed {
                project.task_count_open + 1
            } else {
                project.task_count_open
            };

            let task_count_in_progress = if is_in_progress && !was_in_progress {
                project.task_count_in_progress + 1
            } else if !is_in_progress && was_in_progress {
                project.task_count_in_progress.saturating_sub(1)
            } else {
                project.task_count_in_progress
            };

            let task_count_blocked = if is_blocked && !was_blocked {
                project.task_count_blocked + 1
            } else if !is_blocked && was_blocked {
                project.task_count_blocked.saturating_sub(1)
            } else {
                project.task_count_blocked
            };

            ctx.db.project_project().id().update(ProjectProject {
                task_count_closed,
                task_count_open,
                task_count_in_progress,
                task_count_blocked,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..project
            });
        }
    }

    if was_closed != is_closed {
        if let Some(pid) = task.parent_id {
            if let Some(parent) = ctx.db.project_task().id().find(&pid) {
                let closed_subtask_count = parent
                    .child_ids
                    .iter()
                    .filter_map(|child_id| ctx.db.project_task().id().find(child_id))
                    .filter(|child| child.is_closed)
                    .count() as u32;

                ctx.db.project_task().id().update(ProjectTask {
                    closed_subtask_count,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..parent
                });
            }
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_task",
            record_id: task_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some({
                let mut new_values = Map::new();
                new_values.insert(
                    "state".to_string(),
                    Value::from(format!("{:?}", task.state)),
                );
                new_values.insert("is_closed".to_string(), Value::from(task.is_closed));
                new_values.insert("is_blocked".to_string(), Value::from(task.is_blocked));
                Value::Object(new_values).to_string()
            }),
            changed_fields: vec![
                "state".to_string(),
                "is_closed".to_string(),
                "is_blocked".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!("Task state updated: id={}", task_id);
    Ok(())
}

#[spacetimedb::reducer]
pub fn update_task(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    task_id: u64,
    params: UpdateTaskParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_task", "write")?;

    let mut task = ctx
        .db
        .project_task()
        .id()
        .find(&task_id)
        .ok_or("Task not found")?;

    if task.company_id != company_id {
        return Err("Task does not belong to this company".to_string());
    }

    let old_values = task_update_old_values(&task);

    let mut changed_fields = Vec::new();

    if let Some(name) = params.name {
        if name.trim().is_empty() {
            return Err("Task name cannot be empty".to_string());
        }
        task.name = name;
        changed_fields.push("name".to_string());
    }

    if let Some(description) = params.description {
        task.description = description;
        changed_fields.push("description".to_string());
    }

    if let Some(priority) = params.priority {
        task.priority = priority;
        changed_fields.push("priority".to_string());
    }

    if let Some(sequence) = params.sequence {
        task.sequence = sequence;
        changed_fields.push("sequence".to_string());
    }

    if let Some(stage_id) = params.stage_id {
        task.stage_id = stage_id;
        changed_fields.push("stage_id".to_string());
    }

    if let Some(state) = params.state {
        let is_closed = matches!(state, TaskState::Done | TaskState::Cancelled);
        let is_blocked = matches!(state, TaskState::ChangesRequested);
        task.state = state;
        task.is_closed = is_closed;
        task.is_blocked = is_blocked;
        changed_fields.push("state".to_string());
        changed_fields.push("is_closed".to_string());
        changed_fields.push("is_blocked".to_string());
    }

    if let Some(kanban_state) = params.kanban_state {
        task.kanban_state = kanban_state;
        changed_fields.push("kanban_state".to_string());
    }

    if let Some(date_assign) = params.date_assign {
        task.date_assign = date_assign;
        changed_fields.push("date_assign".to_string());
    }

    if let Some(date_deadline) = params.date_deadline {
        task.date_deadline = date_deadline;
        changed_fields.push("date_deadline".to_string());
    }

    if let Some(date_start) = params.date_start {
        task.date_start = date_start;
        changed_fields.push("date_start".to_string());
    }

    if let Some(date_end) = params.date_end {
        task.date_end = date_end;
        changed_fields.push("date_end".to_string());
    }

    if let Some(color) = params.color {
        task.color = color;
        changed_fields.push("color".to_string());
    }

    if let Some(project_id) = params.project_id {
        if let Some(pid) = project_id {
            let project = ctx
                .db
                .project_project()
                .id()
                .find(&pid)
                .ok_or("Project not found")?;
            if project.company_id != company_id {
                return Err("Project does not belong to this company".to_string());
            }
        }
        task.project_id = project_id;
        changed_fields.push("project_id".to_string());
    }

    if let Some(user_ids) = params.user_ids {
        task.date_assign = if user_ids.is_empty() {
            None
        } else {
            Some(ctx.timestamp)
        };
        task.user_ids = user_ids;
        changed_fields.push("user_ids".to_string());
        changed_fields.push("date_assign".to_string());
    }

    if let Some(milestone_id) = params.milestone_id {
        task.milestone_id = milestone_id;
        changed_fields.push("milestone_id".to_string());
    }

    if let Some(planned_hours) = params.planned_hours {
        task.planned_hours = planned_hours;
        task.remaining_hours = (task.planned_hours - task.effective_hours).max(0.0);
        changed_fields.push("planned_hours".to_string());
        changed_fields.push("remaining_hours".to_string());
    }

    if let Some(total_hours_spent) = params.total_hours_spent {
        task.total_hours_spent = total_hours_spent;
        changed_fields.push("total_hours_spent".to_string());
    }

    if let Some(effective_hours) = params.effective_hours {
        task.effective_hours = effective_hours;
        task.remaining_hours = (task.planned_hours - task.effective_hours).max(0.0);
        changed_fields.push("effective_hours".to_string());
        changed_fields.push("remaining_hours".to_string());
    }

    if let Some(progress) = params.progress {
        task.progress = progress;
        changed_fields.push("progress".to_string());
    }

    if let Some(sale_order_id) = params.sale_order_id {
        task.sale_order_id = sale_order_id;
        changed_fields.push("sale_order_id".to_string());
    }

    if let Some(sale_line_id) = params.sale_line_id {
        task.sale_line_id = sale_line_id;
        changed_fields.push("sale_line_id".to_string());
    }

    if let Some(partner_id) = params.partner_id {
        task.partner_id = partner_id;
        changed_fields.push("partner_id".to_string());
    }

    if let Some(partner_email) = params.partner_email {
        task.partner_email = partner_email;
        changed_fields.push("partner_email".to_string());
    }

    if let Some(child_ids) = params.child_ids {
        task.subtask_count = child_ids.len() as u32;
        task.closed_subtask_count = child_ids
            .iter()
            .filter_map(|child_id| ctx.db.project_task().id().find(child_id))
            .filter(|child| child.is_closed)
            .count() as u32;
        task.child_ids = child_ids;
        changed_fields.push("child_ids".to_string());
        changed_fields.push("subtask_count".to_string());
        changed_fields.push("closed_subtask_count".to_string());
    }

    if let Some(subtask_count) = params.subtask_count {
        task.subtask_count = subtask_count;
        changed_fields.push("subtask_count".to_string());
    }

    if let Some(closed_subtask_count) = params.closed_subtask_count {
        task.closed_subtask_count = closed_subtask_count;
        changed_fields.push("closed_subtask_count".to_string());
    }

    if let Some(is_closed) = params.is_closed {
        task.is_closed = is_closed;
        changed_fields.push("is_closed".to_string());
    }

    if let Some(is_blocked) = params.is_blocked {
        task.is_blocked = is_blocked;
        changed_fields.push("is_blocked".to_string());
    }

    if let Some(allow_task_dependencies) = params.allow_task_dependencies {
        task.allow_task_dependencies = allow_task_dependencies;
        changed_fields.push("allow_task_dependencies".to_string());
    }

    if let Some(depend_on_ids) = params.depend_on_ids {
        task.depend_on_ids = depend_on_ids;
        changed_fields.push("depend_on_ids".to_string());
    }

    if let Some(dependent_ids) = params.dependent_ids {
        task.dependent_ids = dependent_ids;
        changed_fields.push("dependent_ids".to_string());
    }

    if let Some(is_private) = params.is_private {
        task.is_private = is_private;
        changed_fields.push("is_private".to_string());
    }

    if let Some(permitted_user_ids) = params.permitted_user_ids {
        task.permitted_user_ids = permitted_user_ids;
        changed_fields.push("permitted_user_ids".to_string());
    }

    if let Some(activity_ids) = params.activity_ids {
        task.activity_ids = activity_ids;
        changed_fields.push("activity_ids".to_string());
    }

    if let Some(activity_state) = params.activity_state {
        task.activity_state = activity_state;
        changed_fields.push("activity_state".to_string());
    }

    if let Some(activity_date_deadline) = params.activity_date_deadline {
        task.activity_date_deadline = activity_date_deadline;
        changed_fields.push("activity_date_deadline".to_string());
    }

    if let Some(activity_type_id) = params.activity_type_id {
        task.activity_type_id = activity_type_id;
        changed_fields.push("activity_type_id".to_string());
    }

    if let Some(activity_user_id) = params.activity_user_id {
        task.activity_user_id = activity_user_id;
        changed_fields.push("activity_user_id".to_string());
    }

    if let Some(activity_summary) = params.activity_summary {
        task.activity_summary = activity_summary;
        changed_fields.push("activity_summary".to_string());
    }

    if let Some(message_follower_ids) = params.message_follower_ids {
        task.message_follower_ids = message_follower_ids;
        changed_fields.push("message_follower_ids".to_string());
    }

    if let Some(message_ids) = params.message_ids {
        task.message_ids = message_ids;
        changed_fields.push("message_ids".to_string());
    }

    if let Some(metadata) = params.metadata {
        task.metadata = metadata;
        changed_fields.push("metadata".to_string());
    }

    task.write_uid = ctx.sender();
    task.write_date = ctx.timestamp;

    ctx.db.project_task().id().update(task.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_task",
            record_id: task_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some({
                let mut new_values = Map::new();
                new_values.insert("name".to_string(), Value::from(task.name.clone()));
                new_values.insert(
                    "description".to_string(),
                    serde_json::json!(task.description),
                );
                new_values.insert("priority".to_string(), Value::from(task.priority.clone()));
                new_values.insert("planned_hours".to_string(), Value::from(task.planned_hours));
                new_values.insert(
                    "remaining_hours".to_string(),
                    Value::from(task.remaining_hours),
                );
                new_values.insert(
                    "date_deadline".to_string(),
                    timestamp_to_json(task.date_deadline),
                );
                Value::Object(new_values).to_string()
            }),
            changed_fields,
            metadata: None,
        },
    );

    log::info!("Task updated: id={}", task_id);
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_task_parent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    task_id: u64,
    parent_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_task", "write")?;

    let task = ctx
        .db
        .project_task()
        .id()
        .find(&task_id)
        .ok_or("Task not found")?;

    if task.company_id != company_id {
        return Err("Task does not belong to this company".to_string());
    }

    let mut old_values = Map::new();
    old_values.insert("parent_id".to_string(), serde_json::json!(task.parent_id));
    let old_values = Value::Object(old_values);

    let parent_task = if let Some(pid) = parent_id {
        if pid == task_id {
            return Err("Task cannot be parent of itself".to_string());
        }

        let parent = ctx
            .db
            .project_task()
            .id()
            .find(&pid)
            .ok_or("Parent task not found")?;

        if parent.company_id != company_id {
            return Err("Parent task does not belong to this company".to_string());
        }

        if let (Some(task_project), Some(parent_project)) = (task.project_id, parent.project_id) {
            if task_project != parent_project {
                return Err("Parent task must belong to the same project".to_string());
            }
        }

        let mut current = Some(pid);
        let mut depth = 0u32;
        while let Some(current_id) = current {
            if current_id == task_id {
                return Err("Circular dependency detected in task hierarchy".to_string());
            }

            let current_task = ctx
                .db
                .project_task()
                .id()
                .find(&current_id)
                .ok_or("Task in parent chain not found")?;

            current = current_task.parent_id;
            depth += 1;
            if depth > 100 {
                return Err("Task hierarchy too deep".to_string());
            }
        }

        Some(parent)
    } else {
        None
    };

    if let Some(old_parent_id) = task.parent_id {
        if old_parent_id != parent_id.unwrap_or(0) {
            if let Some(old_parent) = ctx.db.project_task().id().find(&old_parent_id) {
                let child_ids: Vec<u64> = old_parent
                    .child_ids
                    .into_iter()
                    .filter(|cid| *cid != task_id)
                    .collect();

                let closed_subtask_count = child_ids
                    .iter()
                    .filter_map(|cid| ctx.db.project_task().id().find(cid))
                    .filter(|t| t.is_closed)
                    .count() as u32;

                ctx.db.project_task().id().update(ProjectTask {
                    child_ids: child_ids.clone(),
                    subtask_count: child_ids.len() as u32,
                    closed_subtask_count,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..old_parent
                });
            }
        }
    }

    if let Some(parent) = parent_task {
        let mut child_ids = parent.child_ids.clone();
        if !child_ids.contains(&task_id) {
            child_ids.push(task_id);
        }

        let closed_subtask_count = child_ids
            .iter()
            .filter_map(|cid| ctx.db.project_task().id().find(cid))
            .filter(|t| t.is_closed)
            .count() as u32;

        ctx.db.project_task().id().update(ProjectTask {
            child_ids: child_ids.clone(),
            subtask_count: child_ids.len() as u32,
            closed_subtask_count,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..parent
        });
    }

    ctx.db.project_task().id().update(ProjectTask {
        parent_id,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..task
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_task",
            record_id: task_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some({
                let mut new_values = Map::new();
                new_values.insert("parent_id".to_string(), serde_json::json!(parent_id));
                Value::Object(new_values).to_string()
            }),
            changed_fields: vec!["parent_id".to_string()],
            metadata: None,
        },
    );

    log::info!("Task parent updated: id={}", task_id);
    Ok(())
}

#[spacetimedb::reducer]
pub fn assign_task_users(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    task_id: u64,
    user_ids: Vec<Identity>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_task", "write")?;

    let task = ctx
        .db
        .project_task()
        .id()
        .find(&task_id)
        .ok_or("Task not found")?;

    if task.company_id != company_id {
        return Err("Task does not belong to this company".to_string());
    }

    let mut old_values = Map::new();
    old_values.insert("user_ids".to_string(), identity_vec_to_json(&task.user_ids));
    old_values.insert(
        "date_assign".to_string(),
        timestamp_to_json(task.date_assign),
    );
    let old_values = Value::Object(old_values);

    let date_assign = if user_ids.is_empty() {
        None
    } else {
        Some(ctx.timestamp)
    };

    ctx.db.project_task().id().update(ProjectTask {
        user_ids: user_ids.clone(),
        date_assign,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..task
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_task",
            record_id: task_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some({
                let mut new_values = Map::new();
                new_values.insert("user_ids".to_string(), identity_vec_to_json(&user_ids));
                new_values.insert("date_assign".to_string(), timestamp_to_json(date_assign));
                Value::Object(new_values).to_string()
            }),
            changed_fields: vec!["user_ids".to_string(), "date_assign".to_string()],
            metadata: None,
        },
    );

    log::info!("Task users assigned: id={}", task_id);
    Ok(())
}
