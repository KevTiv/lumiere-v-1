/// Analytics CSV Imports — ReportTemplate, AnalyticsMetric
use spacetimedb::{ReducerContext, Table};

use crate::analytics::reports::{
    analytics_metric, report_template, AnalyticsMetric, ReportTemplate,
};
use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;

// ── ReportTemplate ────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_report_template_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "report_template", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "report_template",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();
        let model = col(&headers, row, "model").to_string();

        if name.is_empty() || model.is_empty() {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("name"),
                None,
                "name and model are required",
            );
            errors += 1;
            continue;
        }

        let report_type = {
            let v = col(&headers, row, "report_type");
            if v.is_empty() {
                "pdf".to_string()
            } else {
                v.to_string()
            }
        };

        let orientation = {
            let v = col(&headers, row, "orientation");
            if v.is_empty() {
                "Portrait".to_string()
            } else {
                v.to_string()
            }
        };

        ctx.db.report_template().insert(ReportTemplate {
            id: 0,
            organization_id,
            name,
            description: opt_str(col(&headers, row, "description")),
            model,
            report_type,
            template_content: opt_str(col(&headers, row, "template_content")),
            paper_format: opt_str(col(&headers, row, "paper_format")),
            orientation,
            margin_top: {
                let v = parse_f64(col(&headers, row, "margin_top"));
                if v == 0.0 {
                    20.0
                } else {
                    v
                }
            },
            margin_bottom: {
                let v = parse_f64(col(&headers, row, "margin_bottom"));
                if v == 0.0 {
                    20.0
                } else {
                    v
                }
            },
            margin_left: {
                let v = parse_f64(col(&headers, row, "margin_left"));
                if v == 0.0 {
                    15.0
                } else {
                    v
                }
            },
            margin_right: {
                let v = parse_f64(col(&headers, row, "margin_right"));
                if v == 0.0 {
                    15.0
                } else {
                    v
                }
            },
            header_line: parse_bool(col(&headers, row, "header_line")),
            footer_line: parse_bool(col(&headers, row, "footer_line")),
            print_report_name: opt_str(col(&headers, row, "print_report_name")),
            attachment_use: false,
            attachment: None,
            multi_company: parse_bool(col(&headers, row, "multi_company")),
            is_active: true,
            company_id: opt_u64(col(&headers, row, "company_id")),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import report_template: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── AnalyticsMetric ───────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_analytics_metric_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "analytics_metric", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "analytics_metric",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let field = {
            let v = col(&headers, row, "field");
            if v.is_empty() {
                "id".to_string()
            } else {
                v.to_string()
            }
        };

        ctx.db.analytics_metric().insert(AnalyticsMetric {
            id: 0,
            organization_id,
            name,
            category: {
                let v = col(&headers, row, "category");
                if v.is_empty() {
                    "general".to_string()
                } else {
                    v.to_string()
                }
            },
            metric_type: {
                let v = col(&headers, row, "metric_type");
                if v.is_empty() {
                    "KPI".to_string()
                } else {
                    v.to_string()
                }
            },
            model: col(&headers, row, "model").to_string(),
            domain: opt_str(col(&headers, row, "domain")),
            field,
            aggregation: {
                let v = col(&headers, row, "aggregation");
                if v.is_empty() {
                    "Count".to_string()
                } else {
                    v.to_string()
                }
            },
            time_period: {
                let v = col(&headers, row, "time_period");
                if v.is_empty() {
                    "This Month".to_string()
                } else {
                    v.to_string()
                }
            },
            current_value: None,
            previous_value: None,
            change_amount: None,
            change_percentage: None,
            trend_direction: None,
            calculated_at: None,
            target_value: opt_f64(col(&headers, row, "target_value")),
            target_period: opt_str(col(&headers, row, "target_period")),
            is_active: true,
            refresh_frequency_minutes: {
                let v = parse_u32(col(&headers, row, "refresh_frequency_minutes"));
                if v == 0 {
                    60
                } else {
                    v
                }
            },
            last_refresh: None,
            company_id: opt_u64(col(&headers, row, "company_id")),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import analytics_metric: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}
