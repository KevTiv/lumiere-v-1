/// Projects Module — Project definitions and management
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProjectProject** | Project definitions |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

// ============================================================================
// PROJECT TABLE
// ============================================================================

/// Project — Core project entity with team, timeline, and billing configuration
#[spacetimedb::table(
    accessor = project_project,
    public,
    index(name = "by_company", accessor = project_by_company, btree(columns = [company_id])),
    index(name = "by_user", accessor = project_by_user, btree(columns = [user_id]))
)]
pub struct ProjectProject {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub active: bool,
    pub sequence: u32,
    pub company_id: u64,
    pub currency_id: u64,
    pub partner_id: Option<u64>,
    pub partner_email: Option<String>,
    pub partner_phone: Option<String>,
    pub partner_company_id: Option<u64>,
    pub user_id: Identity,
    pub date_start: Option<Timestamp>,
    pub date: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub allow_subtasks: bool,
    pub allow_recurring_tasks: bool,
    pub allow_task_dependencies: bool,
    pub allow_timesheets: bool,
    pub allow_timesheet_timer: bool,
    pub allow_material: bool,
    pub allow_worksheets: bool,
    pub allow_forecast: bool,
    pub bill_type: String,
    pub pricing_type: String,
    pub rating_status: String,
    pub rating_status_period: String,
    pub privacy_visibility: String,
    pub access_instruction_message: Option<String>,
    pub task_count: u32,
    pub task_count_open: u32,
    pub task_count_closed: u32,
    pub task_count_in_progress: u32,
    pub task_count_blocked: u32,
    pub sale_order_id: Option<u64>,
    pub sale_line_id: Option<u64>,
    pub last_update_status: String,
    pub last_update_color: Option<u8>,
    pub is_favorite: bool,
    pub color: Option<u8>,
    pub stage_id: Option<u64>,
    pub analytic_account_id: Option<u64>,
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

/// Validate that a project name is unique within a company.
fn validate_project_name_unique(
    ctx: &ReducerContext,
    company_id: u64,
    name: &str,
    exclude_project_id: Option<u64>,
) -> Result<(), String> {
    let normalized = name.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }

    let exists = ctx.db.project_project().iter().any(|p| {
        p.company_id == company_id
            && p.active
            && p.name.trim().to_lowercase() == normalized
            && exclude_project_id.map(|id| p.id != id).unwrap_or(true)
    });

    if exists {
        return Err("A project with this name already exists in this company".to_string());
    }

    Ok(())
}

/// Create a new project
#[reducer]
pub fn create_project(
    ctx: &ReducerContext,
    company_id: u64,
    name: String,
    description: Option<String>,
    currency_id: u64,
    partner_id: Option<u64>,
    date_start: Option<Timestamp>,
    date_end: Option<Timestamp>,
    allow_subtasks: bool,
    allow_timesheets: bool,
    privacy_visibility: String,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_project", "create")?;
    validate_project_name_unique(ctx, company_id, &name, None)?;

    let project = ctx.db.project_project().insert(ProjectProject {
        id: 0,
        name,
        description,
        active: true,
        sequence: 0,
        company_id,
        currency_id,
        partner_id,
        partner_email: None,
        partner_phone: None,
        partner_company_id: None,
        user_id: ctx.sender(),
        date_start,
        date: date_end,
        date_end,
        allow_subtasks,
        allow_recurring_tasks: false,
        allow_task_dependencies: false,
        allow_timesheets,
        allow_timesheet_timer: false,
        allow_material: false,
        allow_worksheets: false,
        allow_forecast: false,
        bill_type: "customer_task".to_string(),
        pricing_type: "task_rate".to_string(),
        rating_status: "no".to_string(),
        rating_status_period: "monthly".to_string(),
        privacy_visibility,
        access_instruction_message: None,
        task_count: 0,
        task_count_open: 0,
        task_count_closed: 0,
        task_count_in_progress: 0,
        task_count_blocked: 0,
        sale_order_id: None,
        sale_line_id: None,
        last_update_status: "on_track".to_string(),
        last_update_color: None,
        is_favorite: false,
        color: None,
        stage_id: None,
        analytic_account_id: None,
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

    write_audit_log(
        ctx,
        company_id,
        None,
        "project_project",
        project.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Project created: id={}", project.id);
    Ok(())
}

/// Update project details
#[reducer]
pub fn update_project(
    ctx: &ReducerContext,
    company_id: u64,
    project_id: u64,
    name: String,
    description: Option<String>,
    date_start: Option<Timestamp>,
    date_end: Option<Timestamp>,
    active: bool,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_project", "write")?;

    let project = ctx
        .db
        .project_project()
        .id()
        .find(&project_id)
        .ok_or("Project not found")?;

    if project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }

    validate_project_name_unique(ctx, company_id, &name, Some(project_id))?;

    ctx.db.project_project().id().update(ProjectProject {
        name,
        description,
        active,
        date_start,
        date: date_end,
        date_end,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..project
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "project_project",
        project_id,
        "write",
        None,
        None,
        vec!["updated".to_string()],
    );

    log::info!("Project updated: id={}", project_id);
    Ok(())
}

/// Archive (soft-delete) a project
#[reducer]
pub fn archive_project(
    ctx: &ReducerContext,
    company_id: u64,
    project_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_project", "write")?;

    let project = ctx
        .db
        .project_project()
        .id()
        .find(&project_id)
        .ok_or("Project not found")?;

    if project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }

    ctx.db.project_project().id().update(ProjectProject {
        active: false,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..project
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "project_project",
        project_id,
        "write",
        None,
        None,
        vec!["archived".to_string()],
    );

    log::info!("Project archived: id={}", project_id);
    Ok(())
}

/// Toggle favorite status for a project
#[reducer]
pub fn toggle_project_favorite(
    ctx: &ReducerContext,
    company_id: u64,
    project_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_project", "write")?;

    let project = ctx
        .db
        .project_project()
        .id()
        .find(&project_id)
        .ok_or("Project not found")?;

    if project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }

    let is_favorite = !project.is_favorite;
    ctx.db.project_project().id().update(ProjectProject {
        is_favorite,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..project
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "project_project",
        project_id,
        "write",
        None,
        None,
        vec!["favorite_toggled".to_string()],
    );

    log::info!(
        "Project favorite toggled: id={}, favorite={}",
        project_id,
        is_favorite
    );
    Ok(())
}
