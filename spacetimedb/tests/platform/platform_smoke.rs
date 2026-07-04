use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::documents::documents::{create_document_folder, doc_folder, CreateDocumentFolderParams};
use crate::helpdesk::tickets::{
    create_helpdesk_stage, create_helpdesk_team, create_ticket, helpdesk_stage, helpdesk_team,
    helpdesk_ticket, update_ticket, CreateHelpdeskStageParams, CreateHelpdeskTeamParams,
    CreateTicketParams, UpdateTicketParams,
};
use crate::hr::leaves::{
    create_leave_type, hr_leave_type, update_leave_type, CreateLeaveTypeParams,
    UpdateLeaveTypeParams,
};
use crate::manufacturing::work_centers::{
    create_workcenter, mrp_workcenter, CreateWorkcenterParams,
};
use crate::subscriptions::reducers::{create_subscription_plan, CreateSubscriptionPlanParams};
use crate::subscriptions::tables::subscription_plan;
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{JournalType, TicketPriority};
use crate::workflow::definitions::{create_workflow, workflow, CreateWorkflowParams};

pub fn test_helpdesk_ticket_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_helpdesk_team(
        ctx,
        org_id,
        CreateHelpdeskTeamParams {
            name: "Harness Support".to_string(),
            description: Some("Domain test team".to_string()),
            is_active: true,
        },
    )?;

    let team_id = ctx
        .db
        .helpdesk_team()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == "Harness Support")
        .map(|t| t.id)
        .ok_or("Helpdesk team not found")?;

    create_helpdesk_stage(
        ctx,
        org_id,
        CreateHelpdeskStageParams {
            name: "New".to_string(),
            team_id: Some(team_id),
            sequence: 1,
            is_closed: false,
            description: None,
            template: None,
        },
    )?;

    let stage_id = ctx
        .db
        .helpdesk_stage()
        .iter()
        .find(|s| s.organization_id == org_id && s.name == "New")
        .map(|s| s.id)
        .ok_or("Helpdesk stage not found")?;

    create_ticket(
        ctx,
        org_id,
        CreateTicketParams {
            team_id,
            stage_id,
            name: "Harness ticket".to_string(),
            description: Some("Created by domain harness".to_string()),
            priority: TicketPriority::Normal,
            partner_id: Some(fixture.partner_id),
            partner_name: None,
            partner_email: None,
            sla_id: None,
            sla_deadline: None,
        },
    )?;

    let ticket = ctx
        .db
        .helpdesk_ticket()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == "Harness ticket")
        .ok_or("Helpdesk ticket not found after create")?;

    if ticket.team_id != team_id {
        return Err("Ticket team_id mismatch".to_string());
    }

    create_helpdesk_stage(
        ctx,
        org_id,
        CreateHelpdeskStageParams {
            name: "In Progress".to_string(),
            team_id: Some(team_id),
            sequence: 2,
            is_closed: false,
            description: None,
            template: None,
        },
    )?;

    let in_progress_stage_id = ctx
        .db
        .helpdesk_stage()
        .iter()
        .find(|s| s.organization_id == org_id && s.name == "In Progress")
        .map(|s| s.id)
        .ok_or("In Progress stage not found")?;

    update_ticket(
        ctx,
        org_id,
        ticket.id,
        UpdateTicketParams {
            name: None,
            description: None,
            stage_id: Some(in_progress_stage_id),
            priority: Some(TicketPriority::High),
        },
    )?;

    let updated = ctx
        .db
        .helpdesk_ticket()
        .id()
        .find(&ticket.id)
        .ok_or("Helpdesk ticket not found after update")?;

    if updated.stage_id != in_progress_stage_id {
        return Err("Ticket stage_id not updated".to_string());
    }
    if updated.priority != TicketPriority::High {
        return Err("Ticket priority not updated".to_string());
    }

    Ok(())
}

pub fn test_hr_leave_type_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    let company_id = fixture.company_id;

    create_leave_type(
        ctx,
        org_id,
        company_id,
        CreateLeaveTypeParams {
            name: "Harness Paid Leave".to_string(),
            allocation_type: "fixed".to_string(),
            max_leaves: 20.0,
            code: Some("HPL".to_string()),
            color: None,
            validity_start: None,
            validity_stop: None,
            is_active: true,
        },
    )?;

    let leave_type = ctx
        .db
        .hr_leave_type()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == "Harness Paid Leave")
        .ok_or("Leave type not found after create")?;

    if leave_type.max_leaves != 20.0 {
        return Err(format!(
            "Expected max_leaves 20, got {}",
            leave_type.max_leaves
        ));
    }

    update_leave_type(
        ctx,
        org_id,
        company_id,
        leave_type.id,
        UpdateLeaveTypeParams {
            name: Some("Harness Updated Leave".to_string()),
            max_leaves: Some(25.0),
            is_active: None,
        },
    )?;

    let updated = ctx
        .db
        .hr_leave_type()
        .id()
        .find(&leave_type.id)
        .ok_or("Leave type not found after update")?;

    if updated.name != "Harness Updated Leave" {
        return Err(format!(
            "Expected name 'Harness Updated Leave', got '{}'",
            updated.name
        ));
    }
    if updated.max_leaves != 25.0 {
        return Err(format!(
            "Expected max_leaves 25, got {}",
            updated.max_leaves
        ));
    }

    Ok(())
}

pub fn test_manufacturing_workcenter_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_workcenter(
        ctx,
        org_id,
        CreateWorkcenterParams {
            company_id: Some(fixture.company_id),
            name: "Harness Assembly".to_string(),
            active: true,
            code: Some("WC-ASM".to_string()),
            working_state: "normal".to_string(),
            oee_target: 85.0,
            time_efficiency: 100.0,
            capacity: 1.0,
            capacity_ids: vec![],
            oee: 0.0,
            performance: 0.0,
            blocked_time: 0.0,
            productive_time: 0.0,
            productivity_ids: vec![],
            order_ids: vec![],
            workorder_count: 0,
            workorder_ready_count: 0,
            workorder_progress_count: 0,
            workorder_pending_count: 0,
            workorder_late_count: 0,
            alternative_workcenter_ids: vec![],
            color: None,
            resource_calendar_id: None,
            tag_ids: vec![],
            default_capacity_parent_id: None,
            default_time_efficiency: 100.0,
            default_oee_target: 85.0,
            sequence: 1,
            metadata: Some(r#"{"test":"workcenter"}"#.to_string()),
        },
    )?;

    let wc = ctx
        .db
        .mrp_workcenter()
        .iter()
        .find(|w| w.organization_id == org_id && w.code == Some("WC-ASM".to_string()))
        .ok_or("Workcenter not found after create")?;

    if !wc.active {
        return Err("Expected active workcenter".to_string());
    }

    Ok(())
}

pub fn test_documents_folder_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_document_folder(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentFolderParams {
            name: "Harness Docs".to_string(),
            description: Some("Domain test folder".to_string()),
            parent_id: None,
            is_access_restricted: false,
            is_hidden: false,
            is_readonly: false,
            is_favorite: false,
            sequence: 1,
            storage_id: None,
            metadata: Some(r#"{"test":"folder"}"#.to_string()),
        },
    )?;

    let folder = ctx
        .db
        .doc_folder()
        .iter()
        .find(|f| f.organization_id == org_id && f.name == "Harness Docs")
        .ok_or("Document folder not found after create")?;

    if folder.sequence != 1 {
        return Err("Unexpected folder sequence".to_string());
    }

    Ok(())
}

pub fn test_workflow_definition_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_workflow(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            name: "Harness Approval".to_string(),
            model: "sale.order".to_string(),
            state_field: "state".to_string(),
            on_create: false,
            is_active: true,
            description: Some("Domain test workflow".to_string()),
            metadata: Some(r#"{"test":"workflow"}"#.to_string()),
        },
    )?;

    let wf = ctx
        .db
        .workflow()
        .iter()
        .find(|w| w.organization_id == org_id && w.name == "Harness Approval")
        .ok_or("Workflow not found after create")?;

    if wf.model != "sale.order" {
        return Err("Workflow model mismatch".to_string());
    }

    Ok(())
}

pub fn test_subscription_plan_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("Harness missing revenue account")?;

    let journal_code = format!("SUB{company_id}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: "Harness Subscription Journal".to_string(),
            code: journal_code.clone(),
            type_: JournalType::Sale,
            currency_id: Some(1),
            default_account_id: Some(revenue_id),
            suspense_account_id: None,
            loss_account_id: None,
            profit_account_id: None,
            bank_account_id: None,
            payment_credit_account_id: None,
            payment_debit_account_id: None,
            invoice_reference_type: None,
            invoice_reference_model: None,
            sequence_id: None,
            refund_sequence_id: None,
            sequence_override_regex: None,
            secure_sequence_id: None,
            alias_name: None,
            alias_domain: None,
            sale_activity_type_id: None,
            sale_activity_user_id: None,
            sale_activity_note: None,
            sale_activity_date_deadline: None,
            restrict_mode_hash_table: false,
            active: true,
            at_least_one_inbound: true,
            at_least_one_outbound: true,
            dedicated_payment_method_ids: vec![],
            sale_activity_done: false,
            metadata: None,
        },
    )?;

    let journal_id = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == journal_code)
        .map(|j| j.id)
        .ok_or("Subscription journal not found")?;

    create_subscription_plan(
        ctx,
        org_id,
        CreateSubscriptionPlanParams {
            company_id: Some(company_id),
            name: "Harness Monthly".to_string(),
            code: "H-MONTH".to_string(),
            description: Some("Domain test plan".to_string()),
            currency_id: 1,
            journal_id,
            product_id: fixture.product_id,
            billing_period: "month".to_string(),
            billing_period_unit: 1,
            recurring_invoice_day: 1,
            trial_period: false,
            trial_duration: 0,
            trial_unit: "day".to_string(),
            auto_close_limit: 0,
            payment_mode: "manual".to_string(),
            template_id: None,
            invoice_mail_template_id: None,
            website_url: None,
            is_published: false,
            is_default: false,
            color: 0,
            image_1920_url: None,
            active: true,
            recurring_rule_count: 1,
            recurring_rule_min_unit: "month".to_string(),
            recurring_rule_max_unit: "month".to_string(),
            recurring_rule_min_count: 1,
            recurring_rule_max_count: 12,
            metadata: Some(r#"{"test":"subscription_plan"}"#.to_string()),
        },
    )?;

    let plan = ctx
        .db
        .subscription_plan()
        .iter()
        .find(|p| p.organization_id == org_id && p.code == "H-MONTH")
        .ok_or("Subscription plan not found after create")?;

    if plan.product_id != fixture.product_id {
        return Err("Subscription plan product mismatch".to_string());
    }

    Ok(())
}
