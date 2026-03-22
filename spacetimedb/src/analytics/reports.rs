/// Reports Module — Report templates, scheduling, and analytics metrics
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ReportTemplate** | Layout and format definitions for generated reports |
/// | **ScheduledReport** | Automated periodic report delivery configuration |
/// | **AnalyticsMetric** | KPI / trend metric with cached computed values |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ============================================================================
// PARAMS TYPES
// ============================================================================

/// Params for creating a report template.
/// Scope: `organization_id` + optional `company_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateReportTemplateParams {
    pub name: String,
    pub model: String,
    pub report_type: String,
    pub orientation: String,
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
    pub header_line: bool,
    pub footer_line: bool,
    pub attachment_use: bool,
    pub multi_company: bool,
    pub is_active: bool,
    pub description: Option<String>,
    pub template_content: Option<String>,
    pub paper_format: Option<String>,
    pub print_report_name: Option<String>,
    pub attachment: Option<String>,
    pub metadata: Option<String>,
}

/// Params for updating report template content.
/// Scope: `organization_id` + `template_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateReportTemplateParams {
    pub orientation: String,
    pub template_content: Option<String>,
    pub paper_format: Option<String>,
}

/// Params for creating a scheduled report.
/// Scope: `organization_id` + optional `company_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateScheduledReportParams {
    pub name: String,
    pub report_template_id: u64,
    pub model: String,
    pub frequency: String,
    pub hour: u8,
    pub minute: u8,
    pub attachment_format: String,
    pub next_run: Timestamp,
    pub is_active: bool,
    pub recipients: Vec<String>,
    pub description: Option<String>,
    pub domain: Option<String>,
    pub day_of_week: Option<u8>,
    pub day_of_month: Option<u8>,
    pub subject: Option<String>,
    pub body: Option<String>,
    pub metadata: Option<String>,
}

/// Params for creating an analytics metric.
/// Scope: `organization_id` + optional `company_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAnalyticsMetricParams {
    pub name: String,
    pub category: String,
    pub metric_type: String,
    pub model: String,
    pub field: String,
    pub aggregation: String,
    pub time_period: String,
    pub refresh_frequency_minutes: u32,
    pub is_active: bool,
    pub domain: Option<String>,
    pub target_value: Option<f64>,
    pub target_period: Option<String>,
    pub metadata: Option<String>,
}

/// Params for updating cached metric values after computation.
/// Scope: `organization_id` + `metric_id` are flat reducer params.
/// `change_amount`, `change_percentage`, `trend_direction` are computed — not in params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateMetricValuesParams {
    pub current_value: f64,
    pub previous_value: Option<f64>,
}

// ============================================================================
// TABLES
// ============================================================================

/// ReportTemplate — Defines the layout, model, and output format of a report
#[derive(Clone)]
#[spacetimedb::table(
    accessor = report_template,
    public,
    index(accessor = report_template_by_org, btree(columns = [organization_id])),
    index(accessor = template_by_model, btree(columns = [model])),
    index(accessor = template_by_company, btree(columns = [company_id]))
)]
pub struct ReportTemplate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // Tenant isolation
    pub name: String,
    pub description: Option<String>,
    pub model: String,                    // ERP model the report runs on
    pub report_type: String,              // PDF, Excel, CSV, HTML
    pub template_content: Option<String>, // Template markup
    pub paper_format: Option<String>,     // A4, Letter, A3, etc.
    pub orientation: String,              // Portrait, Landscape
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
    pub header_line: bool,
    pub footer_line: bool,
    pub print_report_name: Option<String>, // Expression for file name
    pub attachment_use: bool,              // Auto-attach output to record
    pub attachment: Option<String>,        // Attachment name expression
    pub multi_company: bool,
    pub is_active: bool,
    pub company_id: Option<u64>, // ERP company entity scope (within org)
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// ScheduledReport — Periodically generates and delivers a report
#[derive(Clone)]
#[spacetimedb::table(
    accessor = scheduled_report,
    public,
    index(accessor = sched_report_by_org, btree(columns = [organization_id])),
    index(name = "by_template", accessor = sched_report_by_template, btree(columns = [report_template_id])),
    index(accessor = sched_report_by_company, btree(columns = [company_id]))
)]
pub struct ScheduledReport {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // Tenant isolation
    pub name: String,
    pub description: Option<String>,
    pub report_template_id: u64,
    pub model: String,
    pub domain: Option<String>,   // JSON filter applied when generating
    pub frequency: String,        // Daily, Weekly, Monthly, Quarterly
    pub day_of_week: Option<u8>,  // 0=Mon … 6=Sun (for Weekly)
    pub day_of_month: Option<u8>, // 1–31 (for Monthly)
    pub hour: u8,
    pub minute: u8,
    pub recipients: Vec<String>, // Email addresses
    pub subject: Option<String>,
    pub body: Option<String>,
    pub attachment_format: String, // PDF, Excel, CSV
    pub last_run: Option<Timestamp>,
    pub next_run: Timestamp,
    pub is_active: bool,
    pub run_count: u32,
    pub company_id: Option<u64>, // ERP company entity scope (within org)
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// AnalyticsMetric — A named KPI or trend metric with cached computed values
#[derive(Clone)]
#[spacetimedb::table(
    accessor = analytics_metric,
    public,
    index(accessor = analytics_metric_by_org, btree(columns = [organization_id])),
    index(accessor = metric_by_category, btree(columns = [category])),
    index(accessor = metric_by_company, btree(columns = [company_id]))
)]
pub struct AnalyticsMetric {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // Tenant isolation
    pub name: String,
    pub category: String,    // Sales, Inventory, Financial, HR
    pub metric_type: String, // KPI, Trend, Comparison
    pub model: String,
    pub domain: Option<String>,
    pub field: String,       // Field being aggregated
    pub aggregation: String, // Count, Sum, Average, Min, Max
    pub time_period: String, // Today, This Week, This Month, etc.
    pub current_value: Option<f64>,
    pub previous_value: Option<f64>,
    pub change_amount: Option<f64>,
    pub change_percentage: Option<f64>,
    pub trend_direction: Option<String>, // Up, Down, Stable
    pub calculated_at: Option<Timestamp>,
    pub target_value: Option<f64>,
    pub target_period: Option<String>,
    pub is_active: bool,
    pub refresh_frequency_minutes: u32,
    pub last_refresh: Option<Timestamp>,
    pub company_id: Option<u64>, // ERP company entity scope (within org)
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a report template
#[reducer]
pub fn create_report_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateReportTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "report_template", "create")?;

    let tmpl = ctx.db.report_template().insert(ReportTemplate {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        model: params.model,
        report_type: params.report_type,
        template_content: params.template_content,
        paper_format: params.paper_format,
        orientation: params.orientation,
        margin_top: params.margin_top,
        margin_bottom: params.margin_bottom,
        margin_left: params.margin_left,
        margin_right: params.margin_right,
        header_line: params.header_line,
        footer_line: params.footer_line,
        print_report_name: params.print_report_name,
        attachment_use: params.attachment_use,
        attachment: params.attachment,
        multi_company: params.multi_company,
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
            table_name: "report_template",
            record_id: tmpl.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Report template created: id={}, model={}",
        tmpl.id,
        tmpl.model
    );
    Ok(())
}

/// Update report template content
#[reducer]
pub fn update_report_template(
    ctx: &ReducerContext,
    organization_id: u64,
    template_id: u64,
    params: UpdateReportTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "report_template", "write")?;

    let tmpl = ctx
        .db
        .report_template()
        .id()
        .find(&template_id)
        .ok_or("Report template not found")?;

    if tmpl.organization_id != organization_id {
        return Err("Report template does not belong to this organization".to_string());
    }

    ctx.db.report_template().id().update(ReportTemplate {
        template_content: params.template_content,
        paper_format: params.paper_format,
        orientation: params.orientation,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..tmpl
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "report_template",
            record_id: template_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec!["updated".to_string()],
            metadata: None,
        },
    );

    log::info!("Report template updated: id={}", template_id);
    Ok(())
}

/// Schedule a report for periodic delivery
#[reducer]
pub fn create_scheduled_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateScheduledReportParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "scheduled_report", "create")?;

    // Verify template exists and belongs to this org
    let tmpl = ctx
        .db
        .report_template()
        .id()
        .find(&params.report_template_id)
        .ok_or("Report template not found")?;

    if tmpl.organization_id != organization_id {
        return Err("Report template does not belong to this organization".to_string());
    }

    if params.recipients.is_empty() {
        return Err("At least one recipient is required".to_string());
    }

    let report = ctx.db.scheduled_report().insert(ScheduledReport {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        report_template_id: params.report_template_id,
        model: params.model,
        domain: params.domain,
        frequency: params.frequency,
        day_of_week: params.day_of_week,
        day_of_month: params.day_of_month,
        hour: params.hour,
        minute: params.minute,
        recipients: params.recipients,
        subject: params.subject,
        body: params.body,
        attachment_format: params.attachment_format,
        // System-managed: starts with no prior run
        last_run: None,
        next_run: params.next_run,
        is_active: params.is_active,
        // System-managed: starts at 0, incremented by record_report_run
        run_count: 0,
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
            table_name: "scheduled_report",
            record_id: report.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Scheduled report created: id={}, frequency={}",
        report.id,
        report.frequency
    );
    Ok(())
}

/// Record a completed scheduled report run and advance next_run
#[reducer]
pub fn record_report_run(
    ctx: &ReducerContext,
    organization_id: u64,
    report_id: u64,
    next_run: Timestamp,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "scheduled_report", "write")?;

    let report = ctx
        .db
        .scheduled_report()
        .id()
        .find(&report_id)
        .ok_or("Scheduled report not found")?;

    if report.organization_id != organization_id {
        return Err("Scheduled report does not belong to this organization".to_string());
    }

    ctx.db.scheduled_report().id().update(ScheduledReport {
        last_run: Some(ctx.timestamp),
        next_run,
        // System-managed: incremented on each run
        run_count: report.run_count + 1,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..report
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "scheduled_report",
            record_id: report_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec!["run_recorded".to_string()],
            metadata: None,
        },
    );

    log::info!("Scheduled report run recorded: id={}", report_id);
    Ok(())
}

/// Define a new analytics metric
#[reducer]
pub fn create_analytics_metric(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateAnalyticsMetricParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "analytics_metric", "create")?;

    let metric = ctx.db.analytics_metric().insert(AnalyticsMetric {
        id: 0,
        organization_id,
        name: params.name,
        category: params.category,
        metric_type: params.metric_type,
        model: params.model,
        domain: params.domain,
        field: params.field,
        aggregation: params.aggregation,
        time_period: params.time_period,
        // System-managed: populated by update_metric_values after first computation
        current_value: None,
        previous_value: None,
        change_amount: None,
        change_percentage: None,
        trend_direction: None,
        calculated_at: None,
        last_refresh: None,
        target_value: params.target_value,
        target_period: params.target_period,
        is_active: params.is_active,
        refresh_frequency_minutes: params.refresh_frequency_minutes,
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
            table_name: "analytics_metric",
            record_id: metric.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Analytics metric created: id={}, category={}",
        metric.id,
        metric.category
    );
    Ok(())
}

/// Update cached metric values after computation
#[reducer]
pub fn update_metric_values(
    ctx: &ReducerContext,
    organization_id: u64,
    metric_id: u64,
    params: UpdateMetricValuesParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "analytics_metric", "write")?;

    let metric = ctx
        .db
        .analytics_metric()
        .id()
        .find(&metric_id)
        .ok_or("Metric not found")?;

    if metric.organization_id != organization_id {
        return Err("Metric does not belong to this organization".to_string());
    }

    // change_amount, change_percentage, trend_direction are computed from inputs
    let (change_amount, change_percentage, trend_direction) =
        if let Some(prev) = params.previous_value {
            let delta = params.current_value - prev;
            let pct = if prev != 0.0 {
                delta / prev * 100.0
            } else {
                0.0
            };
            let trend = if delta > 0.0 {
                "Up".to_string()
            } else if delta < 0.0 {
                "Down".to_string()
            } else {
                "Stable".to_string()
            };
            (Some(delta), Some(pct), Some(trend))
        } else {
            (None, None, None)
        };

    ctx.db.analytics_metric().id().update(AnalyticsMetric {
        current_value: Some(params.current_value),
        previous_value: params.previous_value,
        change_amount,
        change_percentage,
        trend_direction,
        calculated_at: Some(ctx.timestamp),
        last_refresh: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..metric
    });

    log::info!(
        "Metric values updated: id={}, value={}",
        metric_id,
        params.current_value
    );
    Ok(())
}
