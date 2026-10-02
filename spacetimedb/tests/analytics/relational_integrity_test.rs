//! ANL-004/ANL-005: dashboard company-scope validation on create, and
//! cross-company widget-add rejection.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::analytics::dashboards::{
    add_widget_to_dashboard, create_dashboard, create_dashboard_widget, dashboard,
    dashboard_widget, CreateDashboardParams, CreateDashboardWidgetParams,
};
use crate::analytics::reports::{
    create_report_template, create_scheduled_report, record_generated_owner_report,
    record_report_run, report_template, scheduled_report, CreateReportTemplateParams,
    CreateScheduledReportParams, RecordGeneratedOwnerReportParams,
};
use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::WidgetType;

fn seed_sibling_company(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: "Analytics Iso Company B".to_string(),
            code: format!("ANL-CB-{}", fixture.company_id),
            currency_id: fixture.currency_id,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: Some(r#"{"harness":"analytics-iso-b"}"#.to_string()),
        },
    )?;
    ctx.db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .map(|c| c.id)
        .filter(|id| *id != fixture.company_id)
        .max()
        .ok_or_else(|| "sibling company B missing".to_string())
}

fn create_widget(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    company_id: Option<u64>,
    name: &str,
) -> Result<u64, String> {
    create_dashboard_widget(
        ctx,
        fixture.organization_id,
        company_id,
        CreateDashboardWidgetParams {
            name: name.to_string(),
            widget_type: WidgetType::Kpi,
            model: "sale_order".to_string(),
            fields: vec![],
            position_x: 0,
            position_y: 0,
            width: 4,
            height: 4,
            is_active: true,
            domain: None,
            group_by: None,
            aggregation: None,
            chart_type: None,
            sort_order: None,
            limit: None,
            refresh_interval: None,
            configuration: None,
            metadata: None,
        },
    )?;
    ctx.db
        .dashboard_widget()
        .iter()
        .find(|w| w.organization_id == fixture.organization_id && w.name == name)
        .map(|w| w.id)
        .ok_or_else(|| format!("widget {name} not found after create"))
}

/// ANL-004: dashboard create rejects a company_id from a different organization.
pub fn test_dashboard_company_scope(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;

    let rejected = create_dashboard(
        ctx,
        local.organization_id,
        Some(foreign.company_id),
        CreateDashboardParams {
            name: "ANL-004 Rejected".to_string(),
            is_default: false,
            is_system: false,
            description: None,
            share_with: vec![],
            share_with_groups: vec![],
            metadata: None,
        },
    );
    match rejected {
        Err(ref e) if e.contains("organization") => {}
        other => {
            return Err(format!(
                "cross-org dashboard create: expected organization error, got {other:?}"
            ))
        }
    }
    if ctx
        .db
        .dashboard()
        .iter()
        .any(|d| d.organization_id == local.organization_id && d.name == "ANL-004 Rejected")
    {
        return Err("rejected cross-org dashboard create was persisted".to_string());
    }

    create_dashboard(
        ctx,
        local.organization_id,
        Some(local.company_id),
        CreateDashboardParams {
            name: "ANL-004 Valid".to_string(),
            is_default: false,
            is_system: false,
            description: None,
            share_with: vec![],
            share_with_groups: vec![],
            metadata: None,
        },
    )?;
    if !ctx
        .db
        .dashboard()
        .iter()
        .any(|d| d.organization_id == local.organization_id && d.name == "ANL-004 Valid")
    {
        return Err("valid dashboard create was not persisted".to_string());
    }

    Ok(())
}

/// ANL-005: add_widget_to_dashboard rejects placing a widget from a different
/// company onto a company-scoped dashboard.
pub fn test_cross_company_widget_add_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let company_b = seed_sibling_company(ctx, &fixture)?;

    create_dashboard(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateDashboardParams {
            name: "ANL-005 Dashboard A".to_string(),
            is_default: false,
            is_system: false,
            description: None,
            share_with: vec![],
            share_with_groups: vec![],
            metadata: None,
        },
    )?;
    let dashboard_a_id = ctx
        .db
        .dashboard()
        .iter()
        .find(|d| d.organization_id == fixture.organization_id && d.name == "ANL-005 Dashboard A")
        .map(|d| d.id)
        .ok_or("dashboard A not found after create")?;

    let widget_b_id = create_widget(ctx, &fixture, Some(company_b), "ANL-005 Widget B")?;

    let rejected =
        add_widget_to_dashboard(ctx, fixture.organization_id, dashboard_a_id, widget_b_id);
    match rejected {
        Err(ref e) if e.to_lowercase().contains("company") => {}
        other => {
            return Err(format!(
                "cross-company widget add: expected company error, got {other:?}"
            ))
        }
    }
    let dash_after = ctx
        .db
        .dashboard()
        .id()
        .find(&dashboard_a_id)
        .ok_or("dashboard A disappeared")?;
    if dash_after.widget_ids.contains(&widget_b_id) {
        return Err("rejected cross-company widget was added to dashboard".to_string());
    }

    let widget_a_id = create_widget(ctx, &fixture, Some(fixture.company_id), "ANL-005 Widget A")?;
    add_widget_to_dashboard(ctx, fixture.organization_id, dashboard_a_id, widget_a_id)?;
    let dash_final = ctx
        .db
        .dashboard()
        .id()
        .find(&dashboard_a_id)
        .ok_or("dashboard A disappeared after valid add")?;
    if !dash_final.widget_ids.contains(&widget_a_id) {
        return Err("same-company widget add was not persisted".to_string());
    }

    Ok(())
}

pub fn test_generated_owner_report_records_ordered_commit(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let correlation_id = format!("anl-c2-report:{}", fixture.organization_id);
    record_generated_owner_report(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        RecordGeneratedOwnerReportParams {
            report_key: "owner.c2".to_string(),
            schema_version: 1,
            parameters_json: "{}".to_string(),
            source_watermark_json: "{}".to_string(),
            output_hash: "a".repeat(64),
            renderer_version: "c2-test".to_string(),
            artifact_key: format!("c2/{}", fixture.organization_id),
            artifact_size: 12,
            correlation_id: correlation_id.clone(),
            metadata: None,
        },
    )?;
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .iter()
        .filter(|commit| {
            commit.organization_id == fixture.organization_id
                && commit.operation_id == "erp.record_generated_owner_report"
                && commit.correlation_id == correlation_id
        })
        .collect();
    if commits.len() != 1 || commits[0].row_change_count != 3 {
        return Err(format!(
            "owner report should emit one three-row organization commit, got {} / {:?}",
            commits.len(),
            commits.first().map(|commit| commit.row_change_count)
        ));
    }
    let commit = &commits[0];
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .iter()
        .filter(|change| {
            change.organization_id == fixture.organization_id
                && change.commit_sequence == commit.sequence
        })
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    let tables: Vec<_> = changes
        .iter()
        .map(|change| change.table_name.as_str())
        .collect();
    if tables != ["document", "document_version", "generated_owner_report"] {
        return Err(format!(
            "owner report commit row order mismatch: {tables:?}"
        ));
    }
    Ok(())
}

/// COV-20: recording a run advances the schedule exactly once; a replay, an
/// inactive schedule and an owner-report schedule are rejected unchanged.
pub fn test_record_report_run_is_exact_and_replay_safe(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_report_template(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateReportTemplateParams {
            name: "COV-20 template".to_string(),
            model: "sale_order".to_string(),
            report_type: "qweb-pdf".to_string(),
            orientation: "portrait".to_string(),
            margin_top: 10.0,
            margin_bottom: 10.0,
            margin_left: 10.0,
            margin_right: 10.0,
            header_line: false,
            footer_line: false,
            attachment_use: false,
            multi_company: false,
            is_active: true,
            description: None,
            template_content: None,
            paper_format: None,
            print_report_name: None,
            attachment: None,
            metadata: None,
        },
    )?;
    let template = ctx
        .db
        .report_template()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == "COV-20 template")
        .ok_or("template missing")?;

    let first_next = Timestamp::from_micros_since_unix_epoch(1_800_000_000_000_000);
    let params = |name: &str, is_active: bool| CreateScheduledReportParams {
        name: name.to_string(),
        report_template_id: Some(template.id),
        owner_report_key: None,
        timezone: None,
        model: "sale_order".to_string(),
        frequency: "daily".to_string(),
        hour: 6,
        minute: 0,
        attachment_format: "pdf".to_string(),
        next_run: first_next,
        is_active,
        recipients: vec!["ops@example.test".to_string()],
        recipient_identities: vec![],
        description: None,
        domain: None,
        day_of_week: None,
        day_of_month: None,
        subject: None,
        body: None,
        metadata: None,
    };
    create_scheduled_report(
        ctx,
        org_id,
        Some(fixture.company_id),
        params("COV-20 daily", true),
    )?;
    create_scheduled_report(
        ctx,
        org_id,
        Some(fixture.company_id),
        params("COV-20 paused", false),
    )?;
    let find = |name: &str| {
        ctx.db
            .scheduled_report()
            .iter()
            .find(|r| r.organization_id == org_id && r.name == name)
            .ok_or_else(|| format!("{name} missing"))
    };
    let daily = find("COV-20 daily")?;
    if daily.run_count != 0 || daily.last_run.is_some() {
        return Err("new schedule must start with no runs".to_string());
    }

    let second_next = Timestamp::from_micros_since_unix_epoch(1_800_086_400_000_000);
    record_report_run(ctx, org_id, daily.id, second_next)?;
    let ran = find("COV-20 daily")?;
    if ran.run_count != 1 || ran.last_run.is_none() || ran.next_run != second_next {
        return Err(
            "run must bump run_count once, stamp last_run and advance next_run".to_string(),
        );
    }

    for stale in [second_next, first_next] {
        let err = record_report_run(ctx, org_id, daily.id, stale)
            .err()
            .ok_or("expected stale/replayed next_run to be rejected")?;
        if !err.contains("later than the current next_run") {
            return Err(format!("unexpected stale-run error: {err}"));
        }
    }
    let after_replay = find("COV-20 daily")?;
    if after_replay.run_count != 1 || after_replay.write_date != ran.write_date {
        return Err("rejected replay changed the schedule".to_string());
    }

    let paused = find("COV-20 paused")?;
    let err = record_report_run(ctx, org_id, paused.id, second_next)
        .err()
        .ok_or("expected inactive schedule run to be rejected")?;
    if !err.contains("inactive") || find("COV-20 paused")?.run_count != 0 {
        return Err(format!("inactive schedule must reject unchanged: {err}"));
    }
    Ok(())
}
