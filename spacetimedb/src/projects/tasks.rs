/// Tasks Module — Project task management
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProjectTask** | Task definitions within projects |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use crate::projects::projects::{project_project, ProjectProject};
use crate::types::TaskState;

// ============================================================================
// TASK TABLE
// ============================================================================

/// Project Task — A unit of work within a project
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_task,
    public,
    index(name = "by_project", accessor = task_by_project, btree(columns = [project_id])),
    index(name = "by_company", accessor = task_by_company, btree(columns = [company_id])),
    index(name = "by_state", accessor = task_by_state, btree(columns = [state]))
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

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a new task
#[reducer]
pub fn create_task(
    ctx: &ReducerContext,
    company_id: u64,
    project_id: Option<u64>,
    name: String,
    description: Option<String>,
    planned_hours: f64,
    date_deadline: Option<Timestamp>,
    partner_id: Option<u64>,
    parent_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_task", "create")?;

    // Validate project belongs to company
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

    let task = ctx.db.project_task().insert(ProjectTask {
        id: 0,
        name,
        description,
        priority: "0".to_string(),
        sequence: 0,
        stage_id: None,
        state: TaskState::InProgress,
        kanban_state: "normal".to_string(),
        date_assign: Some(ctx.timestamp),
        date_deadline,
        date_start: None,
        date_end: None,
        color: None,
        company_id,
        project_id,
        user_ids: vec![ctx.sender()],
        milestone_id: None,
        planned_hours,
        total_hours_spent: 0.0,
        effective_hours: 0.0,
        progress: 0.0,
        remaining_hours: planned_hours,
        sale_order_id: None,
        sale_line_id: None,
        partner_id,
        partner_email: None,
        parent_id,
        child_ids: Vec::new(),
        subtask_count: 0,
        closed_subtask_count: 0,
        is_closed: false,
        is_blocked: false,
        allow_task_dependencies: false,
        depend_on_ids: Vec::new(),
        dependent_ids: Vec::new(),
        is_private: false,
        permitted_user_ids: Vec::new(),
        activity_ids: Vec::new(),
        activity_state: None,
        activity_date_deadline: None,
        activity_type_id: None,
        activity_user_id: None,
        activity_summary: None,
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    // Update parent task subtask count
    if let Some(pid) = parent_id {
        if let Some(parent) = ctx.db.project_task().id().find(&pid) {
            let mut child_ids = parent.child_ids.clone();
            child_ids.push(task.id);
            ctx.db.project_task().id().update(ProjectTask {
                child_ids,
                subtask_count: parent.subtask_count + 1,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..parent
            });
        }
    }

    // Update project task count
    if let Some(pid) = project_id {
        if let Some(project) = ctx.db.project_project().id().find(&pid) {
            ctx.db.project_project().id().update(ProjectProject {
                task_count: project.task_count + 1,
                task_count_open: project.task_count_open + 1,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..project
            });
        }
    }

    write_audit_log(
        ctx,
        company_id,
        None,
        "project_task",
        task.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Task created: id={}", task.id);
    Ok(())
}

/// Update task state
#[reducer]
pub fn update_task_state(
    ctx: &ReducerContext,
    company_id: u64,
    task_id: u64,
    state: TaskState,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_task", "write")?;

    let task = ctx
        .db
        .project_task()
        .id()
        .find(&task_id)
        .ok_or("Task not found")?;

    if task.company_id != company_id {
        return Err("Task does not belong to this company".to_string());
    }

    let was_closed = task.is_closed;
    let is_closed = matches!(state, TaskState::Done | TaskState::Cancelled);
    let is_blocked = matches!(state, TaskState::ChangesRequested);

    ctx.db.project_task().id().update(ProjectTask {
        state: state.clone(),
        is_closed,
        is_blocked,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..task.clone()
    });

    // Update project counters when task closed/reopened
    if let Some(pid) = task.project_id {
        if let Some(project) = ctx.db.project_project().id().find(&pid) {
            let (task_count_closed, task_count_open) = if is_closed && !was_closed {
                (
                    project.task_count_closed + 1,
                    project.task_count_open.saturating_sub(1),
                )
            } else if !is_closed && was_closed {
                (
                    project.task_count_closed.saturating_sub(1),
                    project.task_count_open + 1,
                )
            } else {
                (project.task_count_closed, project.task_count_open)
            };

            ctx.db.project_project().id().update(ProjectProject {
                task_count_closed,
                task_count_open,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..project
            });
        }
    }

    // Update parent subtask closed count
    if is_closed && !was_closed {
        if let Some(pid) = task.parent_id {
            if let Some(parent) = ctx.db.project_task().id().find(&pid) {
                ctx.db.project_task().id().update(ProjectTask {
                    closed_subtask_count: parent.closed_subtask_count + 1,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..parent
                });
            }
        }
    }

    write_audit_log(
        ctx,
        company_id,
        None,
        "project_task",
        task_id,
        "write",
        None,
        None,
        vec!["state_changed".to_string()],
    );

    log::info!("Task state updated: id={}", task_id);
    Ok(())
}

/// Update task details
#[reducer]
pub fn update_task(
    ctx: &ReducerContext,
    company_id: u64,
    task_id: u64,
    name: String,
    description: Option<String>,
    planned_hours: f64,
    date_deadline: Option<Timestamp>,
    priority: String,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_task", "write")?;

    let task = ctx
        .db
        .project_task()
        .id()
        .find(&task_id)
        .ok_or("Task not found")?;

    if task.company_id != company_id {
        return Err("Task does not belong to this company".to_string());
    }

    let remaining_hours = (planned_hours - task.effective_hours).max(0.0);

    ctx.db.project_task().id().update(ProjectTask {
        name,
        description,
        planned_hours,
        remaining_hours,
        date_deadline,
        priority,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..task
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "project_task",
        task_id,
        "write",
        None,
        None,
        vec!["updated".to_string()],
    );

    log::info!("Task updated: id={}", task_id);
    Ok(())
}

/// Set or clear parent task with circular reference validation
#[reducer]
pub fn set_task_parent(
    ctx: &ReducerContext,
    company_id: u64,
    task_id: u64,
    parent_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_task", "write")?;

    let task = ctx
        .db
        .project_task()
        .id()
        .find(&task_id)
        .ok_or("Task not found")?;

    if task.company_id != company_id {
        return Err("Task does not belong to this company".to_string());
    }

    // Validate parent task constraints
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

        // If both tasks have projects, enforce same project tree
        if let (Some(task_project), Some(parent_project)) = (task.project_id, parent.project_id) {
            if task_project != parent_project {
                return Err("Parent task must belong to the same project".to_string());
            }
        }

        // Circular reference check: walk up parent chain from proposed parent
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

    // Remove from old parent child list
    if let Some(old_parent_id) = task.parent_id {
        if old_parent_id != parent_id.unwrap_or(0) {
            if let Some(old_parent) = ctx.db.project_task().id().find(&old_parent_id) {
                let child_ids: Vec<u64> = old_parent
                    .child_ids
                    .into_iter()
                    .filter(|cid| *cid != task_id)
                    .collect();

                let subtask_count = child_ids.len() as u32;
                let closed_subtask_count = child_ids
                    .iter()
                    .filter_map(|cid| ctx.db.project_task().id().find(cid))
                    .filter(|t| t.is_closed)
                    .count() as u32;

                ctx.db.project_task().id().update(ProjectTask {
                    child_ids,
                    subtask_count,
                    closed_subtask_count,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..old_parent
                });
            }
        }
    }

    // Add to new parent child list
    if let Some(parent) = parent_task {
        let mut child_ids = parent.child_ids.clone();
        if !child_ids.contains(&task_id) {
            child_ids.push(task_id);
        }

        let subtask_count = child_ids.len() as u32;
        let closed_subtask_count = child_ids
            .iter()
            .filter_map(|cid| ctx.db.project_task().id().find(cid))
            .filter(|t| t.is_closed)
            .count() as u32;

        ctx.db.project_task().id().update(ProjectTask {
            child_ids,
            subtask_count,
            closed_subtask_count,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..parent
        });
    }

    // Update task parent
    ctx.db.project_task().id().update(ProjectTask {
        parent_id,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..task
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "project_task",
        task_id,
        "write",
        None,
        None,
        vec!["parent_id".to_string()],
    );

    log::info!("Task parent updated: id={}", task_id);
    Ok(())
}

/// Assign users to a task
#[reducer]
pub fn assign_task_users(
    ctx: &ReducerContext,
    company_id: u64,
    task_id: u64,
    user_ids: Vec<Identity>,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_task", "write")?;

    let task = ctx
        .db
        .project_task()
        .id()
        .find(&task_id)
        .ok_or("Task not found")?;

    if task.company_id != company_id {
        return Err("Task does not belong to this company".to_string());
    }

    let date_assign = if user_ids.is_empty() {
        None
    } else {
        Some(ctx.timestamp)
    };

    ctx.db.project_task().id().update(ProjectTask {
        user_ids,
        date_assign,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..task
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "project_task",
        task_id,
        "write",
        None,
        None,
        vec!["users_assigned".to_string()],
    );

    log::info!("Task users assigned: id={}", task_id);
    Ok(())
}
