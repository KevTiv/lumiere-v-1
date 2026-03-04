/// Dashboards Module — Widgets and dashboard definitions
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **DashboardWidget** | Configurable chart/table/KPI widget |
/// | **Dashboard** | Named collection of widgets |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use crate::types::WidgetType;

// ============================================================================
// TABLES
// ============================================================================

/// DashboardWidget — A single configurable panel on a dashboard
#[derive(Clone)]
#[spacetimedb::table(
    accessor = dashboard_widget,
    public,
    index(name = "by_company", accessor = widget_by_company, btree(columns = [company_id]))
)]
pub struct DashboardWidget {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub widget_type: WidgetType,           // Chart, Table, KPI, List
    pub model: String,                     // ERP model being queried
    pub domain: Option<String>,            // JSON filter expression
    pub fields: Vec<String>,               // Fields to display/aggregate
    pub group_by: Option<String>,          // Grouping field
    pub aggregation: Option<String>,       // Count, Sum, Average, Min, Max
    pub chart_type: Option<String>,        // Bar, Line, Pie, Area, Scatter
    pub sort_order: Option<String>,        // JSON sort spec
    pub limit: Option<u32>,               // Max rows
    pub refresh_interval: Option<u32>,    // Seconds between auto-refresh
    pub configuration: Option<String>,    // JSON for widget-specific settings
    pub position_x: u32,
    pub position_y: u32,
    pub width: u32,
    pub height: u32,
    pub is_active: bool,
    pub company_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Dashboard — A named layout of widgets with sharing configuration
#[derive(Clone)]
#[spacetimedb::table(
    accessor = dashboard,
    public,
    index(name = "by_company", accessor = dashboard_by_company, btree(columns = [company_id]))
)]
pub struct Dashboard {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub widget_ids: Vec<u64>,
    pub is_system: bool,               // System dashboards cannot be deleted
    pub is_default: bool,              // Shown on login
    pub share_with: Vec<Identity>,     // Specific users
    pub share_with_groups: Vec<u64>,   // Group IDs
    pub is_shared: bool,
    pub company_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a dashboard widget
#[reducer]
pub fn create_dashboard_widget(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    name: String,
    widget_type: WidgetType,
    model: String,
    fields: Vec<String>,
    aggregation: Option<String>,
    chart_type: Option<String>,
    position_x: u32,
    position_y: u32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "dashboard_widget", "create")?;

    let widget = ctx.db.dashboard_widget().insert(DashboardWidget {
        id: 0,
        name,
        widget_type,
        model,
        domain: None,
        fields,
        group_by: None,
        aggregation,
        chart_type,
        sort_order: None,
        limit: None,
        refresh_interval: None,
        configuration: None,
        position_x,
        position_y,
        width,
        height,
        is_active: true,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "dashboard_widget",
        widget.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Dashboard widget created: id={}", widget.id);
    Ok(())
}

/// Update widget position and size
#[reducer]
pub fn update_widget_layout(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    widget_id: u64,
    position_x: u32,
    position_y: u32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "dashboard_widget", "write")?;

    let widget = ctx
        .db
        .dashboard_widget()
        .id()
        .find(&widget_id)
        .ok_or("Widget not found")?;

    ctx.db.dashboard_widget().id().update(DashboardWidget {
        position_x,
        position_y,
        width,
        height,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..widget
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "dashboard_widget",
        widget_id,
        "write",
        None,
        None,
        vec!["layout_updated".to_string()],
    );

    log::info!("Widget layout updated: id={}", widget_id);
    Ok(())
}

/// Create a dashboard
#[reducer]
pub fn create_dashboard(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    name: String,
    description: Option<String>,
    is_default: bool,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "dashboard", "create")?;

    let db = ctx.db.dashboard().insert(Dashboard {
        id: 0,
        name,
        description,
        widget_ids: Vec::new(),
        is_system: false,
        is_default,
        share_with: Vec::new(),
        share_with_groups: Vec::new(),
        is_shared: false,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "dashboard",
        db.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Dashboard created: id={}", db.id);
    Ok(())
}

/// Add a widget to a dashboard
#[reducer]
pub fn add_widget_to_dashboard(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    dashboard_id: u64,
    widget_id: u64,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "dashboard", "write")?;

    let dash = ctx
        .db
        .dashboard()
        .id()
        .find(&dashboard_id)
        .ok_or("Dashboard not found")?;

    // Verify widget exists
    ctx.db
        .dashboard_widget()
        .id()
        .find(&widget_id)
        .ok_or("Widget not found")?;

    if dash.widget_ids.contains(&widget_id) {
        return Ok(()); // Idempotent
    }

    let mut widget_ids = dash.widget_ids.clone();
    widget_ids.push(widget_id);

    ctx.db.dashboard().id().update(Dashboard {
        widget_ids,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..dash
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "dashboard",
        dashboard_id,
        "write",
        None,
        None,
        vec!["widget_added".to_string()],
    );

    log::info!("Widget {} added to dashboard {}", widget_id, dashboard_id);
    Ok(())
}

/// Share a dashboard with specific users
#[reducer]
pub fn share_dashboard(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    dashboard_id: u64,
    share_with: Vec<Identity>,
    share_with_groups: Vec<u64>,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "dashboard", "write")?;

    let dash = ctx
        .db
        .dashboard()
        .id()
        .find(&dashboard_id)
        .ok_or("Dashboard not found")?;

    let is_shared = !share_with.is_empty() || !share_with_groups.is_empty();

    ctx.db.dashboard().id().update(Dashboard {
        share_with,
        share_with_groups,
        is_shared,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..dash
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "dashboard",
        dashboard_id,
        "write",
        None,
        None,
        vec!["shared".to_string()],
    );

    log::info!("Dashboard shared: id={}", dashboard_id);
    Ok(())
}
