/// Reports Module — Report templates, scheduling, and analytics metrics
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ReportTemplate** | Layout and format definitions for generated reports |
/// | **ScheduledReport** | Automated periodic report delivery configuration |
/// | **AnalyticsMetric** | KPI / trend metric with cached computed values |
use chrono::{Datelike, Days, LocalResult, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::messaging::{mail_message, MailMessage};
use crate::core::organization::{organization, require_company_in_organization};
use crate::core::queue::{enqueue_job_internal, EnqueueJobParams};
use crate::core::users::user_organization;
use crate::documents::documents::{document, document_version, Document, DocumentVersion};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::MailMessageType;

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
    pub report_template_id: Option<u64>,
    /// A catalogued typed owner-report key. Exactly one of this and
    /// `report_template_id` is required.
    pub owner_report_key: Option<String>,
    /// IANA timezone used when the worker chooses the completed local period.
    pub timezone: Option<String>,
    pub model: String,
    pub frequency: String,
    pub hour: u8,
    pub minute: u8,
    pub attachment_format: String,
    pub next_run: Timestamp,
    pub is_active: bool,
    pub recipients: Vec<String>,
    /// Active organization identities selected for in-app owner-report delivery.
    pub recipient_identities: Vec<String>,
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

/// Immutable metadata for a typed owner-report generation. The binary artifact
/// remains in the document/object store; this row is the scoped audit and
/// provenance record used by report history.
#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordGeneratedOwnerReportParams {
    pub report_key: String,
    pub schema_version: u32,
    pub parameters_json: String,
    pub source_watermark_json: String,
    pub output_hash: String,
    pub renderer_version: String,
    pub artifact_key: String,
    pub artifact_size: u64,
    pub correlation_id: String,
    pub metadata: Option<String>,
}

/// Controlled changes to an owner-report schedule. Generic template schedules
/// intentionally keep their legacy reducer surface.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateOwnerReportScheduleParams {
    pub name: Option<String>,
    pub frequency: Option<String>,
    pub hour: Option<u8>,
    pub minute: Option<u8>,
    pub timezone: Option<String>,
    pub recipient_identities: Option<Vec<String>>,
    pub is_active: Option<bool>,
    pub next_run: Option<Timestamp>,
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
    pub report_template_id: Option<u64>,
    pub owner_report_key: Option<String>,
    pub timezone: Option<String>,
    pub model: String,
    pub domain: Option<String>,   // JSON filter applied when generating
    pub frequency: String,        // Daily, Weekly, Monthly, Quarterly
    pub day_of_week: Option<u8>,  // 0=Mon … 6=Sun (for Weekly)
    pub day_of_month: Option<u8>, // 1–31 (for Monthly)
    pub hour: u8,
    pub minute: u8,
    pub recipients: Vec<String>, // Email addresses
    pub recipient_identities: Vec<String>,
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

/// One immutable execution attempt for a scheduled or manually requested
/// typed owner report. The generated document itself remains immutable in the
/// document store; this row joins that provenance to queue execution.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = scheduled_report_run,
    public,
    index(accessor = scheduled_report_run_by_org, btree(columns = [organization_id])),
    index(accessor = scheduled_report_run_by_schedule, btree(columns = [scheduled_report_id])),
    index(accessor = scheduled_report_run_by_period, btree(columns = [scheduled_report_id, scheduled_period]))
)]
pub struct ScheduledReportRun {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub scheduled_report_id: u64,
    pub scheduled_period: Timestamp,
    pub queue_job_id: Option<u64>,
    pub trigger: String,
    pub status: String,
    pub error_message: Option<String>,
    pub generated_owner_report_id: Option<u64>,
    pub document_id: Option<u64>,
    pub notification_outcome: Option<String>,
    pub created_at: Timestamp,
    pub completed_at: Option<Timestamp>,
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

/// Immutable generated owner-report provenance. This is separate from generic
/// `FinancialReport`: typed owner-report schemas and rendering lifecycle do not
/// share the latter's editable analytical-report semantics.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = generated_owner_report,
    public,
    index(accessor = generated_owner_report_by_org, btree(columns = [organization_id])),
    index(accessor = generated_owner_report_by_company, btree(columns = [company_id])),
    index(accessor = generated_owner_report_by_key, btree(columns = [report_key]))
)]
pub struct GeneratedOwnerReport {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub report_key: String,
    pub schema_version: u32,
    pub parameters_json: String,
    pub source_watermark_json: String,
    pub output_hash: String,
    pub renderer_version: String,
    pub artifact_key: String,
    pub document_id: u64,
    pub correlation_id: String,
    pub generated_by: Identity,
    pub generated_at: Timestamp,
    pub metadata: Option<String>,
}

fn validate_schedule_configuration(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: &CreateScheduledReportParams,
) -> Result<(), String> {
    if params.name.trim().is_empty() {
        return Err("scheduled report name is required".to_string());
    }
    if params.hour > 23 || params.minute > 59 {
        return Err("scheduled report time is invalid".to_string());
    }
    validate_frequency(&params.frequency)?;
    match (&params.report_template_id, &params.owner_report_key) {
        (Some(template_id), None) => {
            let template = ctx
                .db
                .report_template()
                .id()
                .find(template_id)
                .ok_or("Report template not found")?;
            if template.organization_id != organization_id {
                return Err("Report template does not belong to this organization".to_string());
            }
            if params.recipients.is_empty() {
                return Err("At least one recipient is required".to_string());
            }
        }
        (None, Some(report_key)) => {
            if !is_owner_report_key(report_key) {
                return Err("unknown owner report key".to_string());
            }
            if company_id.is_none() {
                return Err("owner-report schedules require a company".to_string());
            }
            if !params.attachment_format.eq_ignore_ascii_case("pdf") {
                return Err("owner-report schedules support PDF output only".to_string());
            }
            validate_timezone(params.timezone.as_deref().unwrap_or("UTC"))?;
            validate_owner_recipients(ctx, organization_id, &params.recipient_identities)?;
        }
        _ => {
            return Err(
                "exactly one of report_template_id or owner_report_key is required".to_string(),
            );
        }
    }
    Ok(())
}

fn validate_frequency(frequency: &str) -> Result<(), String> {
    if ["daily", "weekly", "monthly"]
        .iter()
        .any(|value| frequency.eq_ignore_ascii_case(value))
    {
        Ok(())
    } else {
        Err("frequency must be daily, weekly, or monthly".to_string())
    }
}

fn validate_timezone(timezone: &str) -> Result<(), String> {
    let timezone = timezone.trim();
    if timezone == "UTC" || (timezone.contains('/') && !timezone.chars().any(char::is_whitespace)) {
        Ok(())
    } else {
        Err("timezone must be a valid IANA identifier".to_string())
    }
}

fn is_owner_report_key(key: &str) -> bool {
    matches!(
        key,
        "daily_business_summary_v1"
            | "cash_mobile_money_v1"
            | "customer_balances_v1"
            | "supplier_payables_v1"
            | "low_stock_v1"
            | "stock_movement_v1"
            | "sales_by_product_v1"
            | "purchase_spend_v1"
            | "payment_fee_summary_v1"
            | "monthly_owner_report_v1"
    )
}

fn validate_owner_recipients(
    ctx: &ReducerContext,
    organization_id: u64,
    recipients: &[String],
) -> Result<(), String> {
    if recipients.is_empty() {
        return Err("at least one active recipient identity is required".to_string());
    }
    for recipient in recipients {
        let is_active_member = ctx.db.user_organization().iter().any(|membership| {
            membership.organization_id == organization_id
                && membership.is_active
                && membership
                    .user_identity
                    .to_hex()
                    .eq_ignore_ascii_case(recipient)
        });
        if !is_active_member {
            return Err("recipient must be an active organization member".to_string());
        }
    }
    Ok(())
}

fn next_run_after(
    schedule: &ScheduledReport,
    timezone: &str,
    now: Timestamp,
) -> Result<Timestamp, String> {
    let timezone = timezone
        .parse::<Tz>()
        .map_err(|_| "timezone must be a valid IANA identifier".to_string())?;
    let mut local_date = chrono::DateTime::<Utc>::from_timestamp_micros(
        schedule.next_run.to_micros_since_unix_epoch(),
    )
    .ok_or("scheduled report next_run is invalid")?
    .with_timezone(&timezone)
    .date_naive();
    let now_micros = now.to_micros_since_unix_epoch();
    loop {
        local_date = advance_schedule_date(local_date, &schedule.frequency)?;
        let local_time = NaiveTime::from_hms_opt(schedule.hour as u32, schedule.minute as u32, 0)
            .ok_or("scheduled report time is invalid")?;
        let local = local_date.and_time(local_time);
        let candidate = match timezone.from_local_datetime(&local) {
            LocalResult::Single(value) | LocalResult::Ambiguous(value, _) => value,
            // A skipped wall time (normally spring-forward) runs at the first
            // valid instant after the gap instead of silently dropping a run.
            LocalResult::None => timezone
                .from_local_datetime(&(local + chrono::Duration::hours(1)))
                .earliest()
                .ok_or("scheduled report time is invalid due to DST")?,
        };
        let candidate_micros = candidate.with_timezone(&Utc).timestamp_micros();
        if candidate_micros > now_micros {
            return Ok(Timestamp::from_micros_since_unix_epoch(candidate_micros));
        }
    }
}

fn advance_schedule_date(date: NaiveDate, frequency: &str) -> Result<NaiveDate, String> {
    if frequency.eq_ignore_ascii_case("daily") {
        return date
            .checked_add_days(Days::new(1))
            .ok_or("scheduled report date is out of range".to_string());
    }
    if frequency.eq_ignore_ascii_case("weekly") {
        return date
            .checked_add_days(Days::new(7))
            .ok_or("scheduled report date is out of range".to_string());
    }
    let (year, month) = if date.month() == 12 {
        (date.year() + 1, 1)
    } else {
        (date.year(), date.month() + 1)
    };
    let last_day = match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    NaiveDate::from_ymd_opt(year, month, date.day().min(last_day))
        .ok_or("scheduled report date is out of range".to_string())
}

fn enqueue_owner_report_run(
    ctx: &ReducerContext,
    report: ScheduledReport,
    period: Timestamp,
    trigger: &str,
) -> Result<(), String> {
    if ctx
        .db
        .scheduled_report_run()
        .iter()
        .any(|run| run.scheduled_report_id == report.id && run.scheduled_period == period)
    {
        return Ok(());
    }
    let run = ctx.db.scheduled_report_run().insert(ScheduledReportRun {
        id: 0,
        organization_id: report.organization_id,
        scheduled_report_id: report.id,
        scheduled_period: period,
        queue_job_id: None,
        trigger: trigger.to_string(),
        status: "queued".to_string(),
        error_message: None,
        generated_owner_report_id: None,
        document_id: None,
        notification_outcome: None,
        created_at: ctx.timestamp,
        completed_at: None,
    });
    let timezone = report
        .timezone
        .clone()
        .filter(|timezone| !timezone.trim().is_empty())
        .or_else(|| {
            ctx.db
                .organization()
                .id()
                .find(&report.organization_id)
                .map(|organization| organization.timezone)
        })
        .unwrap_or_else(|| "UTC".to_string());
    let payload = serde_json::json!({
        "scheduledReportId": report.id,
        "scheduledReportRunId": run.id,
        "reportKey": report.owner_report_key.clone(),
        "companyId": report.company_id,
        "timezone": timezone,
    })
    .to_string();
    let job = enqueue_job_internal(
        ctx,
        report.organization_id,
        EnqueueJobParams {
            company_id: report.company_id,
            queue_name: "owner_report".to_string(),
            job_type: "owner_report.generate".to_string(),
            payload,
            semantic_key: format!(
                "owner_report:{}:{}",
                report.id,
                period.to_micros_since_unix_epoch()
            ),
            priority: 0,
            max_attempts: 3,
            available_at_micros: None,
            correlation_id: format!("scheduled-report-run:{}", run.id),
            causation_id: Some(format!("scheduled-report:{}", report.id)),
            metadata: Some(serde_json::json!({ "scheduled_report_run_id": run.id }).to_string()),
        },
    )?;
    ctx.db
        .scheduled_report_run()
        .id()
        .update(ScheduledReportRun {
            queue_job_id: Some(job.id),
            ..run
        });
    ctx.db.scheduled_report().id().update(ScheduledReport {
        next_run: next_run_after(&report, &timezone, ctx.timestamp)?,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..report
    });
    Ok(())
}

fn create_owner_report_notifications(
    ctx: &ReducerContext,
    report: &ScheduledReport,
    run_id: u64,
    document_id: u64,
) -> usize {
    let mut delivered = 0;
    for recipient in &report.recipient_identities {
        let active = ctx.db.user_organization().iter().any(|membership| {
            membership.organization_id == report.organization_id
                && membership.is_active
                && membership
                    .user_identity
                    .to_hex()
                    .eq_ignore_ascii_case(recipient)
        });
        if !active {
            continue;
        }
        ctx.db.mail_message().insert(MailMessage {
            id: 0,
            organization_id: report.organization_id,
            model: "scheduled_report_run".to_string(),
            res_id: run_id,
            author_id: ctx.sender(),
            body: format!("Scheduled owner report '{}' is ready.", report.name),
            message_type: MailMessageType::Notification,
            subtype: Some("owner_report.ready".to_string()),
            date: ctx.timestamp,
            parent_id: None,
            attachment_ids: vec![document_id],
            metadata: Some(
                serde_json::json!({ "recipient": recipient, "document_id": document_id })
                    .to_string(),
            ),
        });
        delivered += 1;
    }
    delivered
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Record a completed typed owner-report render. The report service, not the
/// browser, owns all provenance values.
#[reducer]
pub fn record_generated_owner_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RecordGeneratedOwnerReportParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "report", "read")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    if params.report_key.trim().is_empty()
        || params.parameters_json.trim().is_empty()
        || params.source_watermark_json.trim().is_empty()
        || params.output_hash.trim().is_empty()
        || params.renderer_version.trim().is_empty()
        || params.correlation_id.trim().is_empty()
        || params.artifact_key.trim().is_empty()
    {
        return Err("owner-report provenance fields are required".to_string());
    }
    if ctx.db.generated_owner_report().iter().any(|existing| {
        existing.organization_id == organization_id
            && existing.correlation_id == params.correlation_id
    }) {
        return Ok(());
    }
    let artifact_url = format!("report-artifact://{}", params.artifact_key);
    let checksum = params.output_hash.clone();
    let file_name = format!(
        "{}-{}.pdf",
        params.report_key,
        &checksum[..checksum.len().min(16)]
    );
    let mut document = ctx.db.document().insert(Document {
        id: 0,
        organization_id,
        name: format!("Owner report: {}", params.report_key),
        description: Some("Immutable typed owner-report artifact".to_string()),
        file_name: file_name.clone(),
        file_size: params.artifact_size,
        mimetype: "application/pdf".to_string(),
        checksum: Some(checksum.clone()),
        index_content: Some(format!("Owner report: {}", params.report_key)),
        index_language: Some("en".to_string()),
        access_token: None,
        url: Some(artifact_url.clone()),
        res_model: Some("generated_owner_report".to_string()),
        res_id: None,
        res_name: Some(params.report_key.clone()),
        partner_id: None,
        owner_id: ctx.sender(),
        company_id: Some(company_id),
        folder_id: None,
        tag_ids: Vec::new(),
        is_locked: true,
        locked_by: Some(ctx.sender()),
        locked_at: Some(ctx.timestamp),
        locked_until: None,
        is_favorite: false,
        is_shared: false,
        share_link: None,
        share_expires: None,
        is_deleted: false,
        deleted_at: None,
        deleted_by: None,
        classification_id: None,
        retention_days: None,
        purge_after: None,
        fiscal_kind: None,
        residency_region: None,
        version_count: 1,
        current_version_id: None,
        download_count: 0,
        last_viewed_at: None,
        last_viewed_by: None,
        activity_ids: Vec::new(),
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some(
            serde_json::json!({"artifact_key": params.artifact_key.clone()}).to_string(),
        ),
    });
    let version = ctx.db.document_version().insert(DocumentVersion {
        id: 0,
        organization_id,
        document_id: document.id,
        version_number: 1,
        name: "Owner report render".to_string(),
        file_name,
        file_size: params.artifact_size,
        mimetype: "application/pdf".to_string(),
        checksum: Some(checksum),
        url: artifact_url,
        changes_description: Some("Generated by typed owner-report renderer".to_string()),
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        is_current: true,
        metadata: Some(
            serde_json::json!({"renderer_version": params.renderer_version.clone()}).to_string(),
        ),
    });
    document.current_version_id = Some(version.id);
    ctx.db.document().id().update(document.clone());
    let row = ctx
        .db
        .generated_owner_report()
        .insert(GeneratedOwnerReport {
            id: 0,
            organization_id,
            company_id,
            report_key: params.report_key,
            schema_version: params.schema_version,
            parameters_json: params.parameters_json,
            source_watermark_json: params.source_watermark_json,
            output_hash: params.output_hash,
            renderer_version: params.renderer_version,
            artifact_key: params.artifact_key,
            document_id: version.document_id,
            correlation_id: params.correlation_id,
            generated_by: ctx.sender(),
            generated_at: ctx.timestamp,
            metadata: params.metadata,
        });
    document.res_id = Some(row.id);
    ctx.db.document().id().update(document);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "generated_owner_report",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "report_key": row.report_key,
                    "schema_version": row.schema_version,
                    "output_hash": row.output_hash,
                    "correlation_id": row.correlation_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["generated".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

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

    validate_schedule_configuration(ctx, organization_id, company_id, &params)?;

    let report = ctx.db.scheduled_report().insert(ScheduledReport {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        report_template_id: params.report_template_id,
        owner_report_key: params.owner_report_key,
        timezone: params.timezone,
        model: params.model,
        domain: params.domain,
        frequency: params.frequency,
        day_of_week: params.day_of_week,
        day_of_month: params.day_of_month,
        hour: params.hour,
        minute: params.minute,
        recipients: params.recipients,
        recipient_identities: params.recipient_identities,
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

/// Update a typed owner-report schedule. The report key and company scope are
/// immutable so a schedule's historical runs always have one meaning.
#[reducer]
pub fn update_owner_report_schedule(
    ctx: &ReducerContext,
    organization_id: u64,
    report_id: u64,
    params: UpdateOwnerReportScheduleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "scheduled_report", "write")?;
    let report = ctx
        .db
        .scheduled_report()
        .id()
        .find(&report_id)
        .ok_or("Scheduled report not found")?;
    if report.organization_id != organization_id || report.owner_report_key.is_none() {
        return Err("Owner-report schedule not found".to_string());
    }
    if let Some(timezone) = params.timezone.as_deref() {
        validate_timezone(timezone)?;
    }
    if let Some(recipients) = params.recipient_identities.as_ref() {
        validate_owner_recipients(ctx, organization_id, recipients)?;
    }
    if let Some(frequency) = params.frequency.as_deref() {
        validate_frequency(frequency)?;
    }
    if let Some(hour) = params.hour {
        if hour > 23 {
            return Err("hour must be between 0 and 23".to_string());
        }
    }
    if let Some(minute) = params.minute {
        if minute > 59 {
            return Err("minute must be between 0 and 59".to_string());
        }
    }

    ctx.db.scheduled_report().id().update(ScheduledReport {
        name: params.name.unwrap_or(report.name),
        frequency: params.frequency.unwrap_or(report.frequency),
        hour: params.hour.unwrap_or(report.hour),
        minute: params.minute.unwrap_or(report.minute),
        timezone: params.timezone.or(report.timezone),
        recipient_identities: params
            .recipient_identities
            .unwrap_or(report.recipient_identities),
        is_active: params.is_active.unwrap_or(report.is_active),
        next_run: params.next_run.unwrap_or(report.next_run),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..report
    });
    Ok(())
}

/// Atomically dispatch each due owner-report schedule at most once. A long
/// outage creates one catch-up run and advances the schedule beyond now.
#[reducer]
pub fn dispatch_due_owner_reports(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "scheduled_report", "write")?;
    let due_reports: Vec<ScheduledReport> = ctx
        .db
        .scheduled_report()
        .sched_report_by_org()
        .filter(&organization_id)
        .filter(|report| {
            report.is_active
                && report.owner_report_key.is_some()
                && report.next_run <= ctx.timestamp
        })
        .collect();
    for report in due_reports {
        // `ctx.timestamp` is deliberately the catch-up period. It ensures an
        // outage makes one current run rather than backfilling every missed slot.
        enqueue_owner_report_run(ctx, report, ctx.timestamp, "scheduled")?;
    }
    Ok(())
}

/// Queue an immediate owner-report execution through the same immutable run
/// path as automatic dispatch.
#[reducer]
pub fn run_owner_report_schedule(
    ctx: &ReducerContext,
    organization_id: u64,
    report_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "scheduled_report", "write")?;
    let report = ctx
        .db
        .scheduled_report()
        .id()
        .find(&report_id)
        .ok_or("Scheduled report not found")?;
    if report.organization_id != organization_id || report.owner_report_key.is_none() {
        return Err("Owner-report schedule not found".to_string());
    }
    enqueue_owner_report_run(ctx, report, ctx.timestamp, "manual")
}

/// Attach an immutable generated artifact to a run and fan out internal
/// notifications to recipients who are still active organization members.
#[reducer]
pub fn complete_scheduled_owner_report_run(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
    generated_owner_report_id: u64,
    document_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "scheduled_report", "write")?;
    let run = ctx
        .db
        .scheduled_report_run()
        .id()
        .find(&run_id)
        .ok_or("Scheduled report run not found")?;
    if run.organization_id != organization_id {
        return Err("Scheduled report run does not belong to this organization".to_string());
    }
    if run.generated_owner_report_id.is_some() {
        return Ok(());
    }
    let report = ctx
        .db
        .scheduled_report()
        .id()
        .find(&run.scheduled_report_id)
        .ok_or("Scheduled report not found")?;
    let notifications = create_owner_report_notifications(ctx, &report, run.id, document_id);
    ctx.db
        .scheduled_report_run()
        .id()
        .update(ScheduledReportRun {
            status: "completed".to_string(),
            generated_owner_report_id: Some(generated_owner_report_id),
            document_id: Some(document_id),
            notification_outcome: Some(format!("delivered:{notifications}")),
            completed_at: Some(ctx.timestamp),
            error_message: None,
            ..run
        });
    ctx.db.scheduled_report().id().update(ScheduledReport {
        last_run: Some(ctx.timestamp),
        run_count: report.run_count + 1,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..report
    });
    Ok(())
}

/// Retain a failed attempt on the immutable run. A later successful retry
/// updates this same run, so retries cannot duplicate artifacts or messages.
#[reducer]
pub fn fail_scheduled_owner_report_run(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
    error_message: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "scheduled_report", "write")?;
    let run = ctx
        .db
        .scheduled_report_run()
        .id()
        .find(&run_id)
        .ok_or("Scheduled report run not found")?;
    if run.organization_id != organization_id {
        return Err("Scheduled report run does not belong to this organization".to_string());
    }
    ctx.db
        .scheduled_report_run()
        .id()
        .update(ScheduledReportRun {
            status: "failed".to_string(),
            error_message: Some(error_message),
            ..run
        });
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

#[cfg(test)]
mod scheduled_owner_report_tests {
    use super::*;

    #[test]
    fn monthly_cadence_clamps_month_end() {
        let january_31 = NaiveDate::from_ymd_opt(2026, 1, 31).expect("valid date");
        assert_eq!(
            advance_schedule_date(january_31, "monthly").expect("advance date"),
            NaiveDate::from_ymd_opt(2026, 2, 28).expect("valid date"),
        );
    }

    #[test]
    fn cadence_rejects_unsupported_values() {
        assert!(validate_frequency("quarterly").is_err());
    }
}

// ============================================================================
// SAVED REPORTS / PIVOT DEFINITIONS
// ============================================================================

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSavedReportParams {
    pub name: String,
    pub model: String,
    pub row_dimension: String,
    pub column_dimension: Option<String>,
    pub measure_field: String,
    pub measure_op: String,
    pub filter_json: Option<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateSavedReportParams {
    pub name: Option<String>,
    pub row_dimension: Option<String>,
    pub column_dimension: Option<Option<String>>,
    pub measure_field: Option<String>,
    pub measure_op: Option<String>,
    pub filter_json: Option<Option<String>>,
    pub is_active: Option<bool>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = saved_report,
    public,
    index(accessor = saved_report_by_org, btree(columns = [organization_id])),
    index(accessor = saved_report_by_company, btree(columns = [company_id])),
    index(accessor = saved_report_by_model, btree(columns = [model]))
)]
pub struct SavedReport {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub model: String,
    pub row_dimension: String,
    pub column_dimension: Option<String>,
    pub measure_field: String,
    pub measure_op: String,
    pub filter_json: Option<String>,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[reducer]
pub fn create_saved_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSavedReportParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "saved_report", "create")?;
    if params.name.trim().is_empty() {
        return Err("Saved report name is required".to_string());
    }
    let row = ctx.db.saved_report().insert(SavedReport {
        id: 0,
        organization_id,
        company_id,
        name: params.name.trim().to_string(),
        model: params.model,
        row_dimension: params.row_dimension,
        column_dimension: params.column_dimension,
        measure_field: params.measure_field,
        measure_op: params.measure_op,
        filter_json: params.filter_json,
        is_active: params.is_active,
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
            company_id: Some(company_id),
            table_name: "saved_report",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": row.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_saved_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    saved_report_id: u64,
    params: UpdateSavedReportParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "saved_report", "write")?;
    let existing = ctx
        .db
        .saved_report()
        .id()
        .find(&saved_report_id)
        .ok_or("Saved report not found")?;
    if existing.organization_id != organization_id {
        return Err("Saved report does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Saved report does not belong to this company".to_string());
    }
    ctx.db.saved_report().id().update(SavedReport {
        name: params.name.unwrap_or(existing.name),
        row_dimension: params.row_dimension.unwrap_or(existing.row_dimension),
        column_dimension: params.column_dimension.unwrap_or(existing.column_dimension),
        measure_field: params.measure_field.unwrap_or(existing.measure_field),
        measure_op: params.measure_op.unwrap_or(existing.measure_op),
        filter_json: params.filter_json.unwrap_or(existing.filter_json),
        is_active: params.is_active.unwrap_or(existing.is_active),
        metadata: params.metadata.or(existing.metadata),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..existing
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "saved_report",
            record_id: saved_report_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["row_dimension".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn delete_saved_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    saved_report_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "saved_report", "delete")?;
    let existing = ctx
        .db
        .saved_report()
        .id()
        .find(&saved_report_id)
        .ok_or("Saved report not found")?;
    if existing.organization_id != organization_id {
        return Err("Saved report does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Saved report does not belong to this company".to_string());
    }
    ctx.db.saved_report().id().delete(&saved_report_id);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "saved_report",
            record_id: saved_report_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": existing.name }).to_string()),
            new_values: None,
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
