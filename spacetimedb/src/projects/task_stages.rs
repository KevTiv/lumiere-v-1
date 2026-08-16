/// Task Stages Module — Kanban columns for tasks within a project
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProjectTaskStage** | Ordered kanban stage for tasks in one project |
use spacetimedb::{reducer, table, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::helpers::check_permission;
use crate::projects::projects::project_project;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Project Task Stage — A kanban column (e.g. "To Do", "In Progress", "Done")
/// scoped to a single project, mirroring `ProjectMilestone`'s org/company/project
/// scoping convention.
#[table(
    accessor = project_task_stage,
    public,
    index(accessor = task_stage_by_org, btree(columns = [organization_id])),
    index(accessor = task_stage_by_project, btree(columns = [project_id]))
)]
pub struct ProjectTaskStage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub project_id: u64,
    pub name: String,
    pub sequence: u32,
    /// Marks a "done"-equivalent column — tasks landing here are considered complete.
    pub is_closed: bool,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

// ── Input params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProjectTaskStageParams {
    pub project_id: u64,
    pub name: String,
    pub sequence: u32,
    pub is_closed: bool,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_project_task_stage(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateProjectTaskStageParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_task_stage", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    if params.name.trim().is_empty() {
        return Err("Stage name cannot be empty".to_string());
    }

    let project = ctx
        .db
        .project_project()
        .id()
        .find(&params.project_id)
        .ok_or("Project not found")?;
    if project.organization_id != organization_id || project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }

    ctx.db.project_task_stage().insert(ProjectTaskStage {
        id: 0,
        organization_id,
        company_id,
        project_id: params.project_id,
        name: params.name,
        sequence: params.sequence,
        is_closed: params.is_closed,
        active: true,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
    });
    Ok(())
}

// ── Internal helper (called from tasks.rs) ────────────────────────────────────

/// PRJ-004: validate a task's stage_id belongs to this org/company, and — when
/// the task has a project — to that same project. Mirrors `validate_milestone_fk`.
pub fn require_task_stage(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: Option<u64>,
    stage_id: Option<u64>,
) -> Result<(), String> {
    let Some(stage_id) = stage_id else {
        return Ok(());
    };
    let stage = ctx
        .db
        .project_task_stage()
        .id()
        .find(&stage_id)
        .ok_or("Task stage not found")?;
    if stage.organization_id != organization_id {
        return Err("Task stage does not belong to this organization".to_string());
    }
    if stage.company_id != company_id {
        return Err("Task stage does not belong to this company".to_string());
    }
    if let Some(pid) = project_id {
        if stage.project_id != pid {
            return Err("Task stage does not belong to the task project".to_string());
        }
    }
    if !stage.active {
        return Err("Task stage is inactive".to_string());
    }
    Ok(())
}
