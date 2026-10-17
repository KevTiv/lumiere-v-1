/// Dashboards Module — Widgets and dashboard definitions
///
/// **DEPRECATED (MVP):** Do not extend for module dashboard charts. Module dashboards
/// (CRM, Sales, Accounting, etc.) render from client-side `liveSections` built in
/// `frontend/web/app/(modules)/*/*-client.tsx` over SpacetimeDB entity subscriptions.
/// Tables and reducers here are retained (breaking change to remove) and remain used
/// only for seed data and Reports-module write-only CRUD forms — no UI subscribes to
/// `dashboard` / `dashboard_widget` rows for chart rendering. Server-side aggregation
/// is out of scope unless profiling proves client-side `groupBy` slow at scale.
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **DashboardWidget** | Configurable chart/table/KPI widget |
/// | **Dashboard** | Named collection of widgets |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::WidgetType;

// ============================================================================
// PARAMS TYPES
// ============================================================================

/// Params for creating a dashboard widget.
/// Scope: `organization_id` + optional `company_id` are flat reducer params.
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
/// Scope: `organization_id` + `widget_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateWidgetLayoutParams {
    pub position_x: u32,
    pub position_y: u32,
    pub width: u32,
    pub height: u32,
}

/// Params for creating a dashboard.
/// Scope: `organization_id` + optional `company_id` are flat reducer params.
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
/// Scope: `organization_id` + `dashboard_id` are flat reducer params.
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
    index(accessor = widget_by_org, btree(columns = [organization_id])),
    index(accessor = widget_by_company, btree(columns = [company_id]))
)]
pub struct DashboardWidget {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // Tenant isolation
    pub name: String,
    pub widget_type: WidgetType,       // Chart, Table, KPI, List
    pub model: String,                 // ERP model being queried
    pub domain: Option<String>,        // JSON filter expression
    pub fields: Vec<String>,           // Fields to display/aggregate
    pub group_by: Option<String>,      // Grouping field
    pub aggregation: Option<String>,   // Count, Sum, Average, Min, Max
    pub chart_type: Option<String>,    // Bar, Line, Pie, Area, Scatter
    pub sort_order: Option<String>,    // JSON sort spec
    pub limit: Option<u32>,            // Max rows
    pub refresh_interval: Option<u32>, // Seconds between auto-refresh
    pub configuration: Option<String>, // JSON for widget-specific settings
    pub position_x: u32,
    pub position_y: u32,
    pub width: u32,
    pub height: u32,
    pub is_active: bool,
    pub company_id: Option<u64>, // ERP company entity scope (within org)
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
    index(accessor = dashboard_by_org, btree(columns = [organization_id])),
    index(accessor = dashboard_by_company, btree(columns = [company_id]))
)]
pub struct Dashboard {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // Tenant isolation
    pub name: String,
    pub description: Option<String>,
    pub widget_ids: Vec<u64>,
    pub is_system: bool,             // System dashboards cannot be deleted
    pub is_default: bool,            // Shown on login
    pub share_with: Vec<Identity>,   // Specific users
    pub share_with_groups: Vec<u64>, // Group IDs
    pub is_shared: bool,
    pub company_id: Option<u64>, // ERP company entity scope (within org)
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

const DASHBOARD_WIDGET_CREATION_KEY_PREFIX: &str = "lumiere.dashboard-widget.create/v1:";

fn dashboard_widget_creation_key(metadata: Option<&str>) -> Result<Option<&str>, String> {
    let Some(metadata) = metadata else {
        return Ok(None);
    };
    let Some(request_id) = metadata.strip_prefix(DASHBOARD_WIDGET_CREATION_KEY_PREFIX) else {
        return Ok(None);
    };
    if request_id.is_empty() || request_id.len() > 128 || request_id.contains(':') {
        return Err("Invalid dashboard widget creation request id".to_string());
    }
    Ok(Some(request_id))
}

fn dashboard_widget_matches_create(
    widget: &DashboardWidget,
    company_id: Option<u64>,
    params: &CreateDashboardWidgetParams,
) -> bool {
    widget.company_id == company_id
        && widget.name == params.name
        && widget.widget_type == params.widget_type
        && widget.model == params.model
        && widget.domain == params.domain
        && widget.fields == params.fields
        && widget.group_by == params.group_by
        && widget.aggregation == params.aggregation
        && widget.chart_type == params.chart_type
        && widget.sort_order == params.sort_order
        && widget.limit == params.limit
        && widget.refresh_interval == params.refresh_interval
        && widget.configuration == params.configuration
        && widget.position_x == params.position_x
        && widget.position_y == params.position_y
        && widget.width == params.width
        && widget.height == params.height
        && widget.is_active == params.is_active
        && widget.metadata == params.metadata
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Write-time validation of the stored widget definition. Mirrors the
/// resolver's fail-closed parsing (domain, sort order, time/measure binding)
/// so a malformed definition is rejected at write time, not at render time.
pub(crate) fn validate_widget_definition(
    domain: Option<&str>,
    sort_order: Option<&str>,
    configuration: Option<&str>,
) -> Result<(), String> {
    use serde_json::Value;

    if let Some(domain) = domain.map(str::trim).filter(|d| !d.is_empty()) {
        let parsed: Value = serde_json::from_str(domain)
            .map_err(|_| "Widget filter definition is not valid JSON".to_string())?;
        let Value::Object(filters) = parsed else {
            return Err("Widget filter definition must be a JSON object".to_string());
        };
        for (field, expected) in &filters {
            if field.trim().is_empty() {
                return Err("Widget filter definition has an empty field name".to_string());
            }
            let Value::Object(operators) = expected else {
                continue;
            };
            if operators.is_empty() {
                return Err(format!("The filter for {field} has no operator"));
            }
            for (operator, operand) in operators {
                match operator.as_str() {
                    "$in" if !operand.is_array() => {
                        return Err(format!("The $in filter for {field} must use an array"));
                    }
                    "$in" | "$ne" => {}
                    "$gte" | "$lte" | "$gt" | "$lt" => {
                        let numeric = match operand {
                            Value::Number(_) => true,
                            Value::String(text) => text.trim().parse::<f64>().is_ok_and(f64::is_finite),
                            _ => false,
                        };
                        if !numeric {
                            return Err(format!("The {operator} filter for {field} needs a numeric operand"));
                        }
                    }
                    other => {
                        return Err(format!("Unsupported widget filter operator: {other}"));
                    }
                }
            }
        }
    }

    if let Some(sort) = sort_order.map(str::trim).filter(|s| !s.is_empty()) {
        let parsed: Value = serde_json::from_str(sort)
            .map_err(|_| "Widget sort order is not valid JSON".to_string())?;
        let Value::Object(fields) = parsed else {
            return Err("Widget sort order must be a JSON object".to_string());
        };
        let mut entries = fields.iter();
        match (entries.next(), entries.next()) {
            (Some((field, direction)), None) => {
                let direction = direction.as_str().unwrap_or("").to_ascii_lowercase();
                if field.trim().is_empty() || (direction != "asc" && direction != "desc") {
                    return Err("Widget sort direction must be asc or desc".to_string());
                }
            }
            _ => return Err("Widget sort order must contain exactly one field".to_string()),
        }
    }

    // The stored configuration is the widget's time/measure binding; the
    // resolver fails closed on anything else, so reject it here as well.
    if let Some(config) = configuration.map(str::trim).filter(|c| !c.is_empty()) {
        let valid = match serde_json::from_str::<Value>(config) {
            Ok(Value::Object(map)) => {
                let optional_text = |key: &str| {
                    matches!(map.get(key), None | Some(Value::Null) | Some(Value::String(_)))
                };
                map.get("version").and_then(Value::as_u64) == Some(1)
                    && optional_text("timeField")
                    && optional_text("measureField")
                    && map.get("missingTimestampPolicy").and_then(Value::as_str) == Some("reject")
                    && map.get("missingMeasurePolicy").and_then(Value::as_str) == Some("reject")
            }
            _ => false,
        };
        if !valid {
            return Err("Widget time or measure binding is invalid".to_string());
        }
    }
    Ok(())
}

/// Create a dashboard widget
#[reducer]
pub fn create_dashboard_widget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateDashboardWidgetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "dashboard_widget", "create")?;

    validate_widget_definition(
        params.domain.as_deref(),
        params.sort_order.as_deref(),
        params.configuration.as_deref(),
    )?;

    if let Some(cid) = company_id {
        require_company_in_organization(ctx, organization_id, cid)?;
    }

    if dashboard_widget_creation_key(params.metadata.as_deref())?.is_some() {
        let matches: Vec<_> = ctx
            .db
            .dashboard_widget()
            .widget_by_org()
            .filter(&organization_id)
            .filter(|widget| widget.metadata == params.metadata)
            .take(2)
            .collect();
        match matches.as_slice() {
            [] => {}
            [widget] if dashboard_widget_matches_create(widget, company_id, &params) => {
                return Ok(())
            }
            [_] => {
                return Err(
                    "Dashboard widget creation request id was reused with different input"
                        .to_string(),
                )
            }
            _ => {
                return Err(
                    "Dashboard widget creation request id has multiple canonical rows".to_string(),
                )
            }
        }
    }

    let widget = ctx.db.dashboard_widget().insert(DashboardWidget {
        id: 0,
        organization_id,
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
        organization_id,
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
    organization_id: u64,
    company_id: Option<u64>,
    widget_id: u64,
    params: UpdateWidgetLayoutParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "dashboard_widget", "write")?;

    let widget = ctx
        .db
        .dashboard_widget()
        .id()
        .find(&widget_id)
        .ok_or("Widget not found")?;

    if widget.organization_id != organization_id {
        return Err("Widget does not belong to this organization".to_string());
    }

    // ANL-003: when a widget is company-scoped, the caller must present matching scope
    if let Some(widget_company) = widget.company_id {
        match company_id {
            Some(cid) if cid == widget_company => {}
            _ => {
                return Err(
                    "Company scope mismatch — provide the widget's company_id to update it"
                        .to_string(),
                )
            }
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
        organization_id,
        AuditLogParams {
            company_id: None,
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
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateDashboardParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "dashboard", "create")?;

    // ANL-004: validate company_id belongs to this organization when provided
    if let Some(cid) = company_id {
        require_company_in_organization(ctx, organization_id, cid)?;
    }

    // is_shared is derived from share_with / share_with_groups
    let is_shared = !params.share_with.is_empty() || !params.share_with_groups.is_empty();

    let db = ctx.db.dashboard().insert(Dashboard {
        id: 0,
        organization_id,
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
        organization_id,
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
    organization_id: u64,
    dashboard_id: u64,
    widget_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "dashboard", "write")?;

    let dash = ctx
        .db
        .dashboard()
        .id()
        .find(&dashboard_id)
        .ok_or("Dashboard not found")?;

    if dash.organization_id != organization_id {
        return Err("Dashboard does not belong to this organization".to_string());
    }

    // Verify widget exists and belongs to this org
    let widget = ctx
        .db
        .dashboard_widget()
        .id()
        .find(&widget_id)
        .ok_or("Widget not found")?;

    if widget.organization_id != organization_id {
        return Err("Widget does not belong to this organization".to_string());
    }

    // ANL-001: when both dashboard and widget carry a company scope, they must match
    if let (Some(dash_company), Some(widget_company)) = (dash.company_id, widget.company_id) {
        if dash_company != widget_company {
            return Err(
                "Widget company does not match dashboard company — cross-company widget placement is not allowed".to_string(),
            );
        }
    }

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
        organization_id,
        AuditLogParams {
            company_id: None,
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
    organization_id: u64,
    dashboard_id: u64,
    params: UpdateDashboardShareParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "dashboard", "write")?;

    let dash = ctx
        .db
        .dashboard()
        .id()
        .find(&dashboard_id)
        .ok_or("Dashboard not found")?;

    if dash.organization_id != organization_id {
        return Err("Dashboard does not belong to this organization".to_string());
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
        organization_id,
        AuditLogParams {
            company_id: None,
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
