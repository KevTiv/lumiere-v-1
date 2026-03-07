/// Projects Module — Project definitions and management
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProjectProject** | Project definitions |
use serde_json::{Map, Value};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{BillType, PricingType};

// ── Tables ───────────────────────────────────────────────────────────────────

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

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProjectParams {
    pub name: String,
    pub description: Option<String>,
    pub active: bool,
    pub sequence: u32,
    pub currency_id: u64,
    pub partner_id: Option<u64>,
    pub partner_email: Option<String>,
    pub partner_phone: Option<String>,
    pub partner_company_id: Option<u64>,
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
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProjectParams {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub active: Option<bool>,
    pub sequence: Option<u32>,
    pub currency_id: Option<u64>,
    pub partner_id: Option<Option<u64>>,
    pub partner_email: Option<Option<String>>,
    pub partner_phone: Option<Option<String>>,
    pub partner_company_id: Option<Option<u64>>,
    pub date_start: Option<Option<Timestamp>>,
    pub date: Option<Option<Timestamp>>,
    pub date_end: Option<Option<Timestamp>>,
    pub allow_subtasks: Option<bool>,
    pub allow_recurring_tasks: Option<bool>,
    pub allow_task_dependencies: Option<bool>,
    pub allow_timesheets: Option<bool>,
    pub allow_timesheet_timer: Option<bool>,
    pub allow_material: Option<bool>,
    pub allow_worksheets: Option<bool>,
    pub allow_forecast: Option<bool>,
    pub bill_type: Option<String>,
    pub pricing_type: Option<String>,
    pub rating_status: Option<String>,
    pub rating_status_period: Option<String>,
    pub privacy_visibility: Option<String>,
    pub access_instruction_message: Option<Option<String>>,
    pub sale_order_id: Option<Option<u64>>,
    pub sale_line_id: Option<Option<u64>>,
    pub last_update_status: Option<String>,
    pub last_update_color: Option<Option<u8>>,
    pub is_favorite: Option<bool>,
    pub color: Option<Option<u8>>,
    pub stage_id: Option<Option<u64>>,
    pub analytic_account_id: Option<Option<u64>>,
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

fn project_audit_json(project: &ProjectProject) -> Value {
    let mut scheduling = Map::new();
    scheduling.insert(
        "date_start".to_string(),
        timestamp_to_json(project.date_start),
    );
    scheduling.insert("date".to_string(), timestamp_to_json(project.date));
    scheduling.insert("date_end".to_string(), timestamp_to_json(project.date_end));
    scheduling.insert(
        "activity_date_deadline".to_string(),
        timestamp_to_json(project.activity_date_deadline),
    );

    let mut activity = Map::new();
    activity.insert(
        "activity_ids".to_string(),
        serde_json::json!(project.activity_ids),
    );
    activity.insert(
        "activity_state".to_string(),
        serde_json::json!(project.activity_state),
    );
    activity.insert(
        "activity_type_id".to_string(),
        serde_json::json!(project.activity_type_id),
    );
    activity.insert(
        "activity_user_id".to_string(),
        optional_identity_to_json(project.activity_user_id),
    );
    activity.insert(
        "activity_summary".to_string(),
        serde_json::json!(project.activity_summary),
    );

    let mut values = Map::new();
    values.insert("name".to_string(), Value::from(project.name.clone()));
    values.insert(
        "description".to_string(),
        serde_json::json!(project.description),
    );
    values.insert("active".to_string(), Value::from(project.active));
    values.insert("sequence".to_string(), Value::from(project.sequence));
    values.insert("company_id".to_string(), Value::from(project.company_id));
    values.insert("currency_id".to_string(), Value::from(project.currency_id));
    values.insert(
        "partner_id".to_string(),
        serde_json::json!(project.partner_id),
    );
    values.insert(
        "partner_email".to_string(),
        serde_json::json!(project.partner_email),
    );
    values.insert(
        "partner_phone".to_string(),
        serde_json::json!(project.partner_phone),
    );
    values.insert(
        "partner_company_id".to_string(),
        serde_json::json!(project.partner_company_id),
    );
    values.insert("user_id".to_string(), identity_to_json(project.user_id));
    values.insert(
        "allow_subtasks".to_string(),
        Value::from(project.allow_subtasks),
    );
    values.insert(
        "allow_recurring_tasks".to_string(),
        Value::from(project.allow_recurring_tasks),
    );
    values.insert(
        "allow_task_dependencies".to_string(),
        Value::from(project.allow_task_dependencies),
    );
    values.insert(
        "allow_timesheets".to_string(),
        Value::from(project.allow_timesheets),
    );
    values.insert(
        "allow_timesheet_timer".to_string(),
        Value::from(project.allow_timesheet_timer),
    );
    values.insert(
        "allow_material".to_string(),
        Value::from(project.allow_material),
    );
    values.insert(
        "allow_worksheets".to_string(),
        Value::from(project.allow_worksheets),
    );
    values.insert(
        "allow_forecast".to_string(),
        Value::from(project.allow_forecast),
    );
    values.insert(
        "bill_type".to_string(),
        Value::from(project.bill_type.clone()),
    );
    values.insert(
        "pricing_type".to_string(),
        Value::from(project.pricing_type.clone()),
    );
    values.insert(
        "rating_status".to_string(),
        Value::from(project.rating_status.clone()),
    );
    values.insert(
        "rating_status_period".to_string(),
        Value::from(project.rating_status_period.clone()),
    );
    values.insert(
        "privacy_visibility".to_string(),
        Value::from(project.privacy_visibility.clone()),
    );
    values.insert(
        "access_instruction_message".to_string(),
        serde_json::json!(project.access_instruction_message),
    );
    values.insert("task_count".to_string(), Value::from(project.task_count));
    values.insert(
        "task_count_open".to_string(),
        Value::from(project.task_count_open),
    );
    values.insert(
        "task_count_closed".to_string(),
        Value::from(project.task_count_closed),
    );
    values.insert(
        "task_count_in_progress".to_string(),
        Value::from(project.task_count_in_progress),
    );
    values.insert(
        "task_count_blocked".to_string(),
        Value::from(project.task_count_blocked),
    );
    values.insert(
        "sale_order_id".to_string(),
        serde_json::json!(project.sale_order_id),
    );
    values.insert(
        "sale_line_id".to_string(),
        serde_json::json!(project.sale_line_id),
    );
    values.insert(
        "last_update_status".to_string(),
        Value::from(project.last_update_status.clone()),
    );
    values.insert(
        "last_update_color".to_string(),
        serde_json::json!(project.last_update_color),
    );
    values.insert("is_favorite".to_string(), Value::from(project.is_favorite));
    values.insert("color".to_string(), serde_json::json!(project.color));
    values.insert("stage_id".to_string(), serde_json::json!(project.stage_id));
    values.insert(
        "analytic_account_id".to_string(),
        serde_json::json!(project.analytic_account_id),
    );
    values.insert(
        "message_follower_ids".to_string(),
        serde_json::json!(project.message_follower_ids),
    );
    values.insert(
        "message_ids".to_string(),
        serde_json::json!(project.message_ids),
    );
    values.insert(
        "create_uid".to_string(),
        identity_to_json(project.create_uid),
    );
    values.insert(
        "create_date".to_string(),
        timestamp_to_json(Some(project.create_date)),
    );
    values.insert("write_uid".to_string(), identity_to_json(project.write_uid));
    values.insert(
        "write_date".to_string(),
        timestamp_to_json(Some(project.write_date)),
    );
    values.insert("metadata".to_string(), serde_json::json!(project.metadata));
    values.insert("scheduling".to_string(), Value::Object(scheduling));
    values.insert("activity".to_string(), Value::Object(activity));

    Value::Object(values)
}

// ── Reducers ─────────────────────────────────────────────────────────────────

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
#[spacetimedb::reducer]
pub fn create_project(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateProjectParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_project", "create")?;
    validate_project_name_unique(ctx, company_id, &params.name, None)?;

    BillType::from_str(&params.bill_type)?;
    PricingType::from_str(&params.pricing_type)?;

    let project = ctx.db.project_project().insert(ProjectProject {
        id: 0,
        name: params.name.clone(),
        description: params.description.clone(),
        active: params.active,
        sequence: params.sequence,
        company_id,
        currency_id: params.currency_id,
        partner_id: params.partner_id,
        partner_email: params.partner_email.clone(),
        partner_phone: params.partner_phone.clone(),
        partner_company_id: params.partner_company_id,
        user_id: ctx.sender(),
        date_start: params.date_start,
        date: params.date,
        date_end: params.date_end,
        allow_subtasks: params.allow_subtasks,
        allow_recurring_tasks: params.allow_recurring_tasks,
        allow_task_dependencies: params.allow_task_dependencies,
        allow_timesheets: params.allow_timesheets,
        allow_timesheet_timer: params.allow_timesheet_timer,
        allow_material: params.allow_material,
        allow_worksheets: params.allow_worksheets,
        allow_forecast: params.allow_forecast,
        bill_type: params.bill_type.clone(),
        pricing_type: params.pricing_type.clone(),
        rating_status: params.rating_status.clone(),
        rating_status_period: params.rating_status_period.clone(),
        privacy_visibility: params.privacy_visibility.clone(),
        access_instruction_message: params.access_instruction_message.clone(),
        task_count: params.task_count,
        task_count_open: params.task_count_open,
        task_count_closed: params.task_count_closed,
        task_count_in_progress: params.task_count_in_progress,
        task_count_blocked: params.task_count_blocked,
        sale_order_id: params.sale_order_id,
        sale_line_id: params.sale_line_id,
        last_update_status: params.last_update_status.clone(),
        last_update_color: params.last_update_color,
        is_favorite: params.is_favorite,
        color: params.color,
        stage_id: params.stage_id,
        analytic_account_id: params.analytic_account_id,
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_project",
            record_id: project.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(project_audit_json(&project).to_string()),
            changed_fields: vec![
                "name".to_string(),
                "description".to_string(),
                "active".to_string(),
                "sequence".to_string(),
                "currency_id".to_string(),
                "partner_id".to_string(),
                "partner_email".to_string(),
                "partner_phone".to_string(),
                "partner_company_id".to_string(),
                "date_start".to_string(),
                "date".to_string(),
                "date_end".to_string(),
                "allow_subtasks".to_string(),
                "allow_recurring_tasks".to_string(),
                "allow_task_dependencies".to_string(),
                "allow_timesheets".to_string(),
                "allow_timesheet_timer".to_string(),
                "allow_material".to_string(),
                "allow_worksheets".to_string(),
                "allow_forecast".to_string(),
                "bill_type".to_string(),
                "pricing_type".to_string(),
                "rating_status".to_string(),
                "rating_status_period".to_string(),
                "privacy_visibility".to_string(),
                "access_instruction_message".to_string(),
                "task_count".to_string(),
                "task_count_open".to_string(),
                "task_count_closed".to_string(),
                "task_count_in_progress".to_string(),
                "task_count_blocked".to_string(),
                "sale_order_id".to_string(),
                "sale_line_id".to_string(),
                "last_update_status".to_string(),
                "last_update_color".to_string(),
                "is_favorite".to_string(),
                "color".to_string(),
                "stage_id".to_string(),
                "analytic_account_id".to_string(),
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

    log::info!("Project created: id={}", project.id);
    Ok(())
}

/// Update project details
#[spacetimedb::reducer]
pub fn update_project(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: u64,
    params: UpdateProjectParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_project", "write")?;

    let mut project = ctx
        .db
        .project_project()
        .id()
        .find(&project_id)
        .ok_or("Project not found")?;

    if project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }

    let old_values = project_audit_json(&project);

    let mut changed_fields = Vec::new();

    if let Some(name) = params.name {
        validate_project_name_unique(ctx, company_id, &name, Some(project_id))?;
        project.name = name;
        changed_fields.push("name".to_string());
    }

    if let Some(description) = params.description {
        project.description = description;
        changed_fields.push("description".to_string());
    }

    if let Some(active) = params.active {
        project.active = active;
        changed_fields.push("active".to_string());
    }

    if let Some(sequence) = params.sequence {
        project.sequence = sequence;
        changed_fields.push("sequence".to_string());
    }

    if let Some(currency_id) = params.currency_id {
        project.currency_id = currency_id;
        changed_fields.push("currency_id".to_string());
    }

    if let Some(partner_id) = params.partner_id {
        project.partner_id = partner_id;
        changed_fields.push("partner_id".to_string());
    }

    if let Some(partner_email) = params.partner_email {
        project.partner_email = partner_email;
        changed_fields.push("partner_email".to_string());
    }

    if let Some(partner_phone) = params.partner_phone {
        project.partner_phone = partner_phone;
        changed_fields.push("partner_phone".to_string());
    }

    if let Some(partner_company_id) = params.partner_company_id {
        project.partner_company_id = partner_company_id;
        changed_fields.push("partner_company_id".to_string());
    }

    if let Some(date_start) = params.date_start {
        project.date_start = date_start;
        changed_fields.push("date_start".to_string());
    }

    if let Some(date) = params.date {
        project.date = date;
        changed_fields.push("date".to_string());
    }

    if let Some(date_end) = params.date_end {
        project.date_end = date_end;
        changed_fields.push("date_end".to_string());
    }

    if let Some(allow_subtasks) = params.allow_subtasks {
        project.allow_subtasks = allow_subtasks;
        changed_fields.push("allow_subtasks".to_string());
    }

    if let Some(allow_recurring_tasks) = params.allow_recurring_tasks {
        project.allow_recurring_tasks = allow_recurring_tasks;
        changed_fields.push("allow_recurring_tasks".to_string());
    }

    if let Some(allow_task_dependencies) = params.allow_task_dependencies {
        project.allow_task_dependencies = allow_task_dependencies;
        changed_fields.push("allow_task_dependencies".to_string());
    }

    if let Some(allow_timesheets) = params.allow_timesheets {
        project.allow_timesheets = allow_timesheets;
        changed_fields.push("allow_timesheets".to_string());
    }

    if let Some(allow_timesheet_timer) = params.allow_timesheet_timer {
        project.allow_timesheet_timer = allow_timesheet_timer;
        changed_fields.push("allow_timesheet_timer".to_string());
    }

    if let Some(allow_material) = params.allow_material {
        project.allow_material = allow_material;
        changed_fields.push("allow_material".to_string());
    }

    if let Some(allow_worksheets) = params.allow_worksheets {
        project.allow_worksheets = allow_worksheets;
        changed_fields.push("allow_worksheets".to_string());
    }

    if let Some(allow_forecast) = params.allow_forecast {
        project.allow_forecast = allow_forecast;
        changed_fields.push("allow_forecast".to_string());
    }

    if let Some(bill_type) = params.bill_type {
        BillType::from_str(&bill_type)?;
        project.bill_type = bill_type;
        changed_fields.push("bill_type".to_string());
    }

    if let Some(pricing_type) = params.pricing_type {
        PricingType::from_str(&pricing_type)?;
        project.pricing_type = pricing_type;
        changed_fields.push("pricing_type".to_string());
    }

    if let Some(rating_status) = params.rating_status {
        project.rating_status = rating_status;
        changed_fields.push("rating_status".to_string());
    }

    if let Some(rating_status_period) = params.rating_status_period {
        project.rating_status_period = rating_status_period;
        changed_fields.push("rating_status_period".to_string());
    }

    if let Some(privacy_visibility) = params.privacy_visibility {
        project.privacy_visibility = privacy_visibility;
        changed_fields.push("privacy_visibility".to_string());
    }

    if let Some(access_instruction_message) = params.access_instruction_message {
        project.access_instruction_message = access_instruction_message;
        changed_fields.push("access_instruction_message".to_string());
    }

    if let Some(sale_order_id) = params.sale_order_id {
        project.sale_order_id = sale_order_id;
        changed_fields.push("sale_order_id".to_string());
    }

    if let Some(sale_line_id) = params.sale_line_id {
        project.sale_line_id = sale_line_id;
        changed_fields.push("sale_line_id".to_string());
    }

    if let Some(last_update_status) = params.last_update_status {
        project.last_update_status = last_update_status;
        changed_fields.push("last_update_status".to_string());
    }

    if let Some(last_update_color) = params.last_update_color {
        project.last_update_color = last_update_color;
        changed_fields.push("last_update_color".to_string());
    }

    if let Some(is_favorite) = params.is_favorite {
        project.is_favorite = is_favorite;
        changed_fields.push("is_favorite".to_string());
    }

    if let Some(color) = params.color {
        project.color = color;
        changed_fields.push("color".to_string());
    }

    if let Some(stage_id) = params.stage_id {
        project.stage_id = stage_id;
        changed_fields.push("stage_id".to_string());
    }

    if let Some(analytic_account_id) = params.analytic_account_id {
        project.analytic_account_id = analytic_account_id;
        changed_fields.push("analytic_account_id".to_string());
    }

    if let Some(activity_ids) = params.activity_ids {
        project.activity_ids = activity_ids;
        changed_fields.push("activity_ids".to_string());
    }

    if let Some(activity_state) = params.activity_state {
        project.activity_state = activity_state;
        changed_fields.push("activity_state".to_string());
    }

    if let Some(activity_date_deadline) = params.activity_date_deadline {
        project.activity_date_deadline = activity_date_deadline;
        changed_fields.push("activity_date_deadline".to_string());
    }

    if let Some(activity_type_id) = params.activity_type_id {
        project.activity_type_id = activity_type_id;
        changed_fields.push("activity_type_id".to_string());
    }

    if let Some(activity_user_id) = params.activity_user_id {
        project.activity_user_id = activity_user_id;
        changed_fields.push("activity_user_id".to_string());
    }

    if let Some(activity_summary) = params.activity_summary {
        project.activity_summary = activity_summary;
        changed_fields.push("activity_summary".to_string());
    }

    if let Some(message_follower_ids) = params.message_follower_ids {
        project.message_follower_ids = message_follower_ids;
        changed_fields.push("message_follower_ids".to_string());
    }

    if let Some(message_ids) = params.message_ids {
        project.message_ids = message_ids;
        changed_fields.push("message_ids".to_string());
    }

    if let Some(metadata) = params.metadata {
        project.metadata = metadata;
        changed_fields.push("metadata".to_string());
    }

    project.write_uid = ctx.sender();
    project.write_date = ctx.timestamp;

    ctx.db.project_project().id().update(project);

    let new_values = project_audit_json(
        &ctx.db
            .project_project()
            .id()
            .find(&project_id)
            .ok_or("Project not found after update")?,
    );

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_project",
            record_id: project_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some(new_values.to_string()),
            changed_fields,
            metadata: None,
        },
    );

    log::info!("Project updated: id={}", project_id);
    Ok(())
}

/// Dedicated active toggle for a project
#[spacetimedb::reducer]
pub fn set_project_active(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: u64,
    active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_project", "write")?;

    let mut project = ctx
        .db
        .project_project()
        .id()
        .find(&project_id)
        .ok_or("Project not found")?;

    if project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }

    let old_values = serde_json::json!({ "active": project.active });

    project.active = active;
    project.write_uid = ctx.sender();
    project.write_date = ctx.timestamp;

    ctx.db.project_project().id().update(project);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_project",
            record_id: project_id,
            action: "SET_ACTIVE",
            old_values: Some(old_values.to_string()),
            new_values: Some(serde_json::json!({ "active": active }).to_string()),
            changed_fields: vec!["active".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Project active status updated: id={}, active={}",
        project_id,
        active
    );
    Ok(())
}

/// Toggle favorite status for a project
#[spacetimedb::reducer]
pub fn toggle_project_favorite(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_project", "write")?;

    let mut project = ctx
        .db
        .project_project()
        .id()
        .find(&project_id)
        .ok_or("Project not found")?;

    if project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }

    let old_values = serde_json::json!({ "is_favorite": project.is_favorite });
    let is_favorite = !project.is_favorite;

    project.is_favorite = is_favorite;
    project.write_uid = ctx.sender();
    project.write_date = ctx.timestamp;

    ctx.db.project_project().id().update(project);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_project",
            record_id: project_id,
            action: "SET_FAVORITE",
            old_values: Some(old_values.to_string()),
            new_values: Some(serde_json::json!({ "is_favorite": is_favorite }).to_string()),
            changed_fields: vec!["is_favorite".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Project favorite toggled: id={}, favorite={}",
        project_id,
        is_favorite
    );
    Ok(())
}
