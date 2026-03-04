/// Reports Module — Report templates, scheduling, and analytics metrics
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ReportTemplate** | Layout and format definitions for generated reports |
/// | **ScheduledReport** | Automated periodic report delivery configuration |
/// | **AnalyticsMetric** | KPI / trend metric with cached computed values |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

// ============================================================================
// TABLES
// ============================================================================

/// ReportTemplate — Defines the layout, model, and output format of a report
#[spacetimedb::table(
    accessor = report_template,
    public,
    index(name = "by_model", accessor = template_by_model, btree(columns = [model])),
    index(name = "by_company", accessor = template_by_company, btree(columns = [company_id]))
)]
pub struct ReportTemplate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub model: String,                     // ERP model the report runs on
    pub report_type: String,               // PDF, Excel, CSV, HTML
    pub template_content: Option<String>,  // Template markup
    pub paper_format: Option<String>,      // A4, Letter, A3, etc.
    pub orientation: String,               // Portrait, Landscape
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
    pub company_id: Option<u64>,
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
    index(name = "by_template", accessor = sched_report_by_template, btree(columns = [report_template_id])),
    index(name = "by_company", accessor = sched_report_by_company, btree(columns = [company_id]))
)]
pub struct ScheduledReport {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub report_template_id: u64,
    pub model: String,
    pub domain: Option<String>,            // JSON filter applied when generating
    pub frequency: String,                 // Daily, Weekly, Monthly, Quarterly
    pub day_of_week: Option<u8>,           // 0=Mon … 6=Sun (for Weekly)
    pub day_of_month: Option<u8>,          // 1–31 (for Monthly)
    pub hour: u8,
    pub minute: u8,
    pub recipients: Vec<String>,           // Email addresses
    pub subject: Option<String>,
    pub body: Option<String>,
    pub attachment_format: String,         // PDF, Excel, CSV
    pub last_run: Option<Timestamp>,
    pub next_run: Timestamp,
    pub is_active: bool,
    pub run_count: u32,
    pub company_id: Option<u64>,
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
    index(name = "by_category", accessor = metric_by_category, btree(columns = [category])),
    index(name = "by_company", accessor = metric_by_company, btree(columns = [company_id]))
)]
pub struct AnalyticsMetric {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub category: String,                  // Sales, Inventory, Financial, HR
    pub metric_type: String,               // KPI, Trend, Comparison
    pub model: String,
    pub domain: Option<String>,
    pub field: String,                     // Field being aggregated
    pub aggregation: String,               // Count, Sum, Average, Min, Max
    pub time_period: String,               // Today, This Week, This Month, etc.
    pub current_value: Option<f64>,
    pub previous_value: Option<f64>,
    pub change_amount: Option<f64>,
    pub change_percentage: Option<f64>,
    pub trend_direction: Option<String>,   // Up, Down, Stable
    pub calculated_at: Option<Timestamp>,
    pub target_value: Option<f64>,
    pub target_period: Option<String>,
    pub is_active: bool,
    pub refresh_frequency_minutes: u32,
    pub last_refresh: Option<Timestamp>,
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

/// Create a report template
#[reducer]
pub fn create_report_template(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    name: String,
    model: String,
    report_type: String,
    orientation: String,
    template_content: Option<String>,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "report_template", "create")?;

    let tmpl = ctx.db.report_template().insert(ReportTemplate {
        id: 0,
        name,
        description: None,
        model,
        report_type,
        template_content,
        paper_format: Some("A4".to_string()),
        orientation,
        margin_top: 10.0,
        margin_bottom: 10.0,
        margin_left: 10.0,
        margin_right: 10.0,
        header_line: true,
        footer_line: true,
        print_report_name: None,
        attachment_use: false,
        attachment: None,
        multi_company: false,
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
        "report_template",
        tmpl.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Report template created: id={}, model={}", tmpl.id, tmpl.model);
    Ok(())
}

/// Update report template content
#[reducer]
pub fn update_report_template(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    template_id: u64,
    template_content: Option<String>,
    paper_format: Option<String>,
    orientation: String,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "report_template", "write")?;

    let tmpl = ctx
        .db
        .report_template()
        .id()
        .find(&template_id)
        .ok_or("Report template not found")?;

    ctx.db.report_template().id().update(ReportTemplate {
        template_content,
        paper_format,
        orientation,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..tmpl
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "report_template",
        template_id,
        "write",
        None,
        None,
        vec!["updated".to_string()],
    );

    log::info!("Report template updated: id={}", template_id);
    Ok(())
}

/// Schedule a report for periodic delivery
#[reducer]
pub fn create_scheduled_report(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    name: String,
    report_template_id: u64,
    model: String,
    frequency: String,
    hour: u8,
    minute: u8,
    recipients: Vec<String>,
    attachment_format: String,
    next_run: Timestamp,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "scheduled_report", "create")?;

    // Verify template exists
    ctx.db
        .report_template()
        .id()
        .find(&report_template_id)
        .ok_or("Report template not found")?;

    if recipients.is_empty() {
        return Err("At least one recipient is required".to_string());
    }

    let report = ctx.db.scheduled_report().insert(ScheduledReport {
        id: 0,
        name,
        description: None,
        report_template_id,
        model,
        domain: None,
        frequency,
        day_of_week: None,
        day_of_month: None,
        hour,
        minute,
        recipients,
        subject: None,
        body: None,
        attachment_format,
        last_run: None,
        next_run,
        is_active: true,
        run_count: 0,
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
        "scheduled_report",
        report.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
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
    company_id: Option<u64>,
    report_id: u64,
    next_run: Timestamp,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "scheduled_report", "write")?;

    let report = ctx
        .db
        .scheduled_report()
        .id()
        .find(&report_id)
        .ok_or("Scheduled report not found")?;

    ctx.db.scheduled_report().id().update(ScheduledReport {
        last_run: Some(ctx.timestamp),
        next_run,
        run_count: report.run_count + 1,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..report
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "scheduled_report",
        report_id,
        "write",
        None,
        None,
        vec!["run_recorded".to_string()],
    );

    log::info!("Scheduled report run recorded: id={}", report_id);
    Ok(())
}

/// Define a new analytics metric
#[reducer]
pub fn create_analytics_metric(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    name: String,
    category: String,
    metric_type: String,
    model: String,
    field: String,
    aggregation: String,
    time_period: String,
    refresh_frequency_minutes: u32,
    target_value: Option<f64>,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "analytics_metric", "create")?;

    let metric = ctx.db.analytics_metric().insert(AnalyticsMetric {
        id: 0,
        name,
        category,
        metric_type,
        model,
        domain: None,
        field,
        aggregation,
        time_period,
        current_value: None,
        previous_value: None,
        change_amount: None,
        change_percentage: None,
        trend_direction: None,
        calculated_at: None,
        target_value,
        target_period: None,
        is_active: true,
        refresh_frequency_minutes,
        last_refresh: None,
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
        "analytics_metric",
        metric.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Analytics metric created: id={}, category={}", metric.id, metric.category);
    Ok(())
}

/// Update cached metric values after computation
#[reducer]
pub fn update_metric_values(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    metric_id: u64,
    current_value: f64,
    previous_value: Option<f64>,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "analytics_metric", "write")?;

    let metric = ctx
        .db
        .analytics_metric()
        .id()
        .find(&metric_id)
        .ok_or("Metric not found")?;

    let (change_amount, change_percentage, trend_direction) =
        if let Some(prev) = previous_value {
            let delta = current_value - prev;
            let pct = if prev != 0.0 { delta / prev * 100.0 } else { 0.0 };
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
        current_value: Some(current_value),
        previous_value,
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
        current_value
    );
    Ok(())
}
