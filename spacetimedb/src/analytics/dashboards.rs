/// Dashboards Module — Widgets and dashboard definitions
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **DashboardWidget** | Configurable chart/table/KPI widget |
/// | **Dashboard** | Named collection of widgets |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::WidgetType;

// ============================================================================
// PARAMS TYPES
// ============================================================================

/// Params for creating a dashboard widget.
/// Scope: `company_id` is a flat reducer param (not in this struct).
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDashboardWidgetParams {
    pub name: String,
    pub widget_type: WidgetType,
    pub model: String,
    pub fields: Vec<String>,
    pub position_x: u32,
    pub position_y: u32,
    pub width: u32,
    pub height: u32,
    pub is_active: bool,
    pub domain: Option<String>,
    pub group_by: Option<String>,
    pub aggregation: Option<String>,
    pub chart_type: Option<String>,
    pub sort_order: Option<String>,
    pub limit: Option<u32>,
    pub refresh_interval: Option<u32>,
    pub configuration: Option<String>,
    pub metadata: Option<String>,
}

/// Params for updating widget position and size.
/// Scope: `company_id` + `widget_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateWidgetLayoutParams {
    pub position_x: u32,
    pub position_y: u32,
    pub width: u32,
    pub height: u32,
}

/// Params for creating a dashboard.
/// Scope: `company_id` is a flat reducer param (not in this struct).
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDashboardParams {
    pub name: String,
    pub is_default: bool,
    pub is_system: bool,
    pub description: Option<String>,
    pub share_with: Vec<Identity>,
    pub share_with_groups: Vec<u64>,
    pub metadata: Option<String>,
}

/// Params for updating dashboard sharing configuration.
/// Scope: `company_id` + `dashboard_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateDashboardShareParams {
    pub share_with: Vec<Identity>,
    pub share_with_groups: Vec<u64>,
}

// ============================================================================
// TABLES
// ============================================================================

/// DashboardWidget — A single configurable panel on a dashboard
#[derive(Clone)]
#[spacetimedb::table(
    accessor = dashboard_widget,
    public,
    index(accessor = widget_by_company, btree(columns = [company_id]))
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
    index(accessor = dashboard_by_company, btree(columns = [company_id]))
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
    params: CreateDashboardWidgetParams,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "dashboard_widget", "create")?;

    let widget = ctx.db.dashboard_widget().insert(DashboardWidget {
        id: 0,
        name: params.name,
        widget_type: params.widget_type,
        model: params.model,
        domain: params.domain,
        fields: params.fields,
        group_by: params.group_by,
        aggregation: params.aggregation,
        chart_type: params.chart_type,
        sort_order: params.sort_order,
        limit: params.limit,
        refresh_interval: params.refresh_interval,
        configuration: params.configuration,
        position_x: params.position_x,
        position_y: params.position_y,
        width: params.width,
        height: params.height,
        is_active: params.is_active,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        cid,
        AuditLogParams {
            company_id,
            table_name: "dashboard_widget",
            record_id: widget.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
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
    params: UpdateWidgetLayoutParams,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "dashboard_widget", "write")?;

    let widget = ctx
        .db
        .dashboard_widget()
        .id()
        .find(&widget_id)
        .ok_or("Widget not found")?;

    if let (Some(wc), Some(rc)) = (company_id, widget.company_id) {
        if wc != rc {
            return Err("Widget does not belong to this company".to_string());
        }
    }

    ctx.db.dashboard_widget().id().update(DashboardWidget {
        position_x: params.position_x,
        position_y: params.position_y,
        width: params.width,
        height: params.height,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..widget
    });

    write_audit_log_v2(
        ctx,
        cid,
        AuditLogParams {
            company_id,
            table_name: "dashboard_widget",
            record_id: widget_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec!["layout_updated".to_string()],
            metadata: None,
        },
    );

    log::info!("Widget layout updated: id={}", widget_id);
    Ok(())
}

/// Create a dashboard
#[reducer]
pub fn create_dashboard(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    params: CreateDashboardParams,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "dashboard", "create")?;

    // is_shared is derived from share_with / share_with_groups
    let is_shared = !params.share_with.is_empty() || !params.share_with_groups.is_empty();

    let db = ctx.db.dashboard().insert(Dashboard {
        id: 0,
        name: params.name,
        description: params.description,
        // System-managed: starts empty, populated via add_widget_to_dashboard
        widget_ids: Vec::new(),
        is_system: params.is_system,
        is_default: params.is_default,
        share_with: params.share_with,
        share_with_groups: params.share_with_groups,
        // System-derived: computed from share_with / share_with_groups
        is_shared,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        cid,
        AuditLogParams {
            company_id,
            table_name: "dashboard",
            record_id: db.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
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

    write_audit_log_v2(
        ctx,
        cid,
        AuditLogParams {
            company_id,
            table_name: "dashboard",
            record_id: dashboard_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec!["widget_added".to_string()],
            metadata: None,
        },
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
    params: UpdateDashboardShareParams,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "dashboard", "write")?;

    let dash = ctx
        .db
        .dashboard()
        .id()
        .find(&dashboard_id)
        .ok_or("Dashboard not found")?;

    if let (Some(wc), Some(rc)) = (company_id, dash.company_id) {
        if wc != rc {
            return Err("Dashboard does not belong to this company".to_string());
        }
    }

    // is_shared is derived from the new share lists
    let is_shared = !params.share_with.is_empty() || !params.share_with_groups.is_empty();

    ctx.db.dashboard().id().update(Dashboard {
        share_with: params.share_with,
        share_with_groups: params.share_with_groups,
        is_shared,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..dash
    });

    write_audit_log_v2(
        ctx,
        cid,
        AuditLogParams {
            company_id,
            table_name: "dashboard",
            record_id: dashboard_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec!["shared".to_string()],
            metadata: None,
        },
    );

    log::info!("Dashboard shared: id={}", dashboard_id);
    Ok(())
}
