use spacetimedb::{Identity, ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::ai::intelligence::{
    ai_document_processing_job, approve_document_processing_job, complete_document_processing_job,
    create_document_processing_job, CompleteDocumentProcessingJobParams,
    CreateDocumentProcessingJobParams,
};
use crate::core::country_pack::{
    country_pack_definition, set_company_country_pack, SetCompanyCountryPackParams,
};
use crate::documents::documents::{
    create_document, create_document_folder, delete_document, delete_document_folder, doc_folder,
    document, document_version, lock_document, restore_document, update_document,
    update_document_folder, CreateDocumentFolderParams, CreateDocumentParams, Document,
    DocumentFolder, UpdateDocumentFolderParams, UpdateDocumentParams,
};
use crate::documents::drive_sync::{
    document_external_ref, set_google_drive_conflict_policy, sync_external_file_to_document,
    SetDriveConflictPolicyParams, SyncExternalFileToDocumentParams,
};
use crate::documents::esign::{
    complete_document_signature_request, create_document_signature_request,
    document_signature_request, CompleteDocumentSignatureRequestParams,
    CreateDocumentSignatureRequestParams,
};
use crate::documents::legal_hold::{
    apply_document_legal_hold, document_legal_hold, release_document_legal_hold,
    ApplyDocumentLegalHoldParams, ReleaseDocumentLegalHoldParams,
};
use crate::documents::pack_locale::{
    document_search_analyzer_for_company, document_search_language_for_company,
};
use crate::documents::presence::{
    clear_document_presence, document_presence, update_document_presence,
};
use crate::documents::regional::{
    purge_expired_documents, set_document_index_content, set_document_retention,
    SetDocumentIndexContentParams, SetDocumentRetentionParams,
};
use crate::helpdesk::tickets::{
    create_helpdesk_stage, create_helpdesk_team, create_ticket, helpdesk_stage, helpdesk_team,
    helpdesk_ticket, update_ticket, CreateHelpdeskStageParams, CreateHelpdeskTeamParams,
    CreateTicketParams, UpdateTicketParams,
};
use crate::hr::leaves::{
    create_leave_type, hr_leave_type, update_leave_type, CreateLeaveTypeParams,
    UpdateLeaveTypeParams,
};
use crate::integrations::google_drive::{
    create_google_drive_connection, google_drive_connection, DriveConflictPolicy, SyncDirection,
};
use crate::manufacturing::work_centers::{
    create_workcenter, mrp_workcenter, CreateWorkcenterParams,
};
use crate::subscriptions::reducers::{create_subscription_plan, CreateSubscriptionPlanParams};
use crate::subscriptions::tables::subscription_plan;
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{JournalType, TicketPriority};
use crate::workflow::definitions::{
    create_workflow, workflow, workflow_version, CreateWorkflowParams, WorkflowTrigger,
    WorkflowVersionStatus,
};

fn seed_helpdesk_team_and_stage(
    ctx: &ReducerContext,
    org_id: u64,
    team_name: &str,
    stage_name: &str,
) -> Result<(u64, u64), String> {
    create_helpdesk_team(
        ctx,
        org_id,
        CreateHelpdeskTeamParams {
            name: team_name.to_string(),
            description: Some("Domain test team".to_string()),
            is_active: true,
        },
    )?;

    let team_id = ctx
        .db
        .helpdesk_team()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == team_name)
        .map(|t| t.id)
        .ok_or("Helpdesk team not found")?;

    create_helpdesk_stage(
        ctx,
        org_id,
        CreateHelpdeskStageParams {
            name: stage_name.to_string(),
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
        .find(|s| s.organization_id == org_id && s.name == stage_name && s.team_id == Some(team_id))
        .map(|s| s.id)
        .ok_or("Helpdesk stage not found")?;

    Ok((team_id, stage_id))
}

pub fn test_helpdesk_ticket_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    let (team_id, stage_id) = seed_helpdesk_team_and_stage(ctx, org_id, "Harness Support", "New")?;

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

/// Soft-FK: ticket create must reject a team from another organization.
pub fn test_helpdesk_rejects_foreign_team(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    let (foreign_team_id, foreign_stage_id) = seed_helpdesk_team_and_stage(
        ctx,
        fixture_b.organization_id,
        "Foreign Org Team",
        "Foreign Stage",
    )?;

    let err = create_ticket(
        ctx,
        fixture_a.organization_id,
        CreateTicketParams {
            team_id: foreign_team_id,
            stage_id: foreign_stage_id,
            name: "Cross-org ticket".to_string(),
            description: None,
            priority: TicketPriority::Normal,
            partner_id: None,
            partner_name: None,
            partner_email: None,
            sla_id: None,
            sla_deadline: None,
        },
    )
    .expect_err("foreign team must be rejected");

    if !err.contains("does not belong") && !err.contains("not found") {
        return Err(format!("unexpected foreign-team error: {err}"));
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
            residency_region: None,
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

pub fn test_documents_create_rejects_empty_blob(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let err = create_document(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateDocumentParams {
            name: "Empty".to_string(),
            description: None,
            file_name: "empty.pdf".to_string(),
            file_size: 0,
            mimetype: "application/pdf".to_string(),
            url: String::new(),
            checksum: String::new(),
            folder_id: None,
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    )
    .err()
    .ok_or("expected empty blob registration to fail")?;
    if !err.contains("url is required") && !err.contains("file_size") && !err.contains("checksum") {
        return Err(format!("unexpected error: {err}"));
    }
    Ok(())
}

pub fn test_documents_create_and_lock(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let checksum = "a".repeat(64);

    create_document_folder(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentFolderParams {
            name: "Wave A Folder".to_string(),
            description: None,
            parent_id: None,
            is_access_restricted: false,
            is_hidden: false,
            is_readonly: false,
            is_favorite: false,
            sequence: 2,
            storage_id: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let folder = ctx
        .db
        .doc_folder()
        .iter()
        .find(|f| f.organization_id == org_id && f.name == "Wave A Folder")
        .ok_or("folder missing")?;

    create_document(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentParams {
            name: "Wave A Doc".to_string(),
            description: None,
            file_name: "wave-a.pdf".to_string(),
            file_size: 128,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/default/deadbeef".to_string(),
            checksum: checksum.clone(),
            folder_id: Some(folder.id),
            // DOC-002 validates res_id against the real table for res_model — a
            // hardcoded id 42 predates that check and no longer exists. contact
            // is the simplest whitelisted model with a fixture-provided real row.
            res_model: Some("contact".to_string()),
            res_id: Some(fixture.partner_id),
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    )?;

    let doc = ctx
        .db
        .document()
        .iter()
        .find(|d| d.organization_id == org_id && d.name == "Wave A Doc")
        .ok_or("document missing")?;
    if doc.checksum.as_deref() != Some(checksum.as_str()) {
        return Err("checksum not stored".to_string());
    }
    if doc.res_model.as_deref() != Some("contact") || doc.res_id != Some(fixture.partner_id) {
        return Err("res link not stored".to_string());
    }
    let version = ctx
        .db
        .document_version()
        .iter()
        .find(|v| v.document_id == doc.id && v.is_current)
        .ok_or("version missing")?;
    if version.organization_id != org_id {
        return Err("version organization_id mismatch".to_string());
    }

    lock_document(ctx, org_id, doc.id, None)?;
    let locked = ctx
        .db
        .document()
        .id()
        .find(&doc.id)
        .ok_or("doc gone after lock")?;
    if !locked.is_locked {
        return Err("expected locked".to_string());
    }

    Ok(())
}

pub fn test_documents_folder_acl_blocks_write(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_document_folder(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentFolderParams {
            name: "Restricted Folder".to_string(),
            description: None,
            parent_id: None,
            is_access_restricted: true,
            is_hidden: false,
            is_readonly: false,
            is_favorite: false,
            sequence: 3,
            storage_id: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let folder = ctx
        .db
        .doc_folder()
        .iter()
        .find(|f| f.organization_id == org_id && f.name == "Restricted Folder")
        .ok_or("restricted folder missing")?;

    // Strip write ACL so even the creator fails subsequent writes (owner still allowed —
    // clear owner by pointing write list empty and using a different synthetic owner).
    // Owner always has write; simulate non-owner by clearing write_access and changing owner.
    let foreign = Identity::from_byte_array([9u8; 32]);
    ctx.db.doc_folder().id().update(DocumentFolder {
        owner_id: foreign,
        write_access_ids: vec![],
        read_access_ids: vec![],
        ..folder.clone()
    });

    let err = create_document(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentParams {
            name: "Blocked".to_string(),
            description: None,
            file_name: "blocked.pdf".to_string(),
            file_size: 10,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/default/aa".to_string(),
            checksum: "b".repeat(64),
            folder_id: Some(folder.id),
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    )
    .err()
    .ok_or("expected ACL denial")?;
    if !err.contains("write access") {
        return Err(format!("unexpected ACL error: {err}"));
    }
    Ok(())
}

pub fn test_documents_company_isolation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    create_document_folder(
        ctx,
        fixture_a.organization_id,
        Some(fixture_a.company_id),
        CreateDocumentFolderParams {
            name: "Company A Folder".to_string(),
            description: None,
            parent_id: None,
            is_access_restricted: false,
            is_hidden: false,
            is_readonly: false,
            is_favorite: false,
            sequence: 1,
            storage_id: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let folder_a = ctx
        .db
        .doc_folder()
        .iter()
        .find(|f| f.organization_id == fixture_a.organization_id && f.name == "Company A Folder")
        .ok_or("folder a missing")?;

    let company_mismatch = create_document(
        ctx,
        fixture_a.organization_id,
        Some(fixture_b.company_id),
        CreateDocumentParams {
            name: "Cross company".to_string(),
            description: None,
            file_name: "x.pdf".to_string(),
            file_size: 10,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/default/cc".to_string(),
            checksum: "c".repeat(64),
            folder_id: Some(folder_a.id),
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    )
    .err()
    .ok_or("expected company mismatch to fail")?;
    if !company_mismatch.to_lowercase().contains("company") {
        return Err(format!(
            "expected company isolation, got: {company_mismatch}"
        ));
    }

    let org_mismatch = create_document(
        ctx,
        fixture_b.organization_id,
        Some(fixture_b.company_id),
        CreateDocumentParams {
            name: "Cross org".to_string(),
            description: None,
            file_name: "y.pdf".to_string(),
            file_size: 10,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/default/dd".to_string(),
            checksum: "d".repeat(64),
            folder_id: Some(folder_a.id),
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    )
    .err()
    .ok_or("expected cross-org folder create to fail")?;
    if !org_mismatch.contains("organization") {
        return Err(format!("expected org isolation, got: {org_mismatch}"));
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
            workflow_key: "harness.sale-approval".to_string(),
            name: "Harness Approval".to_string(),
            model: "sale.order".to_string(),
            description: Some("Domain test workflow".to_string()),
            trigger: WorkflowTrigger::Manual,
            schema_version: 1,
            snapshot_fields: Vec::new(),
            metadata: Some(r#"{"test":"workflow"}"#.to_string()),
        },
    )?;

    let wf = ctx
        .db
        .workflow()
        .iter()
        .find(|w| w.organization_id == org_id && w.workflow_key == "harness.sale-approval")
        .ok_or("Workflow not found after create")?;

    if wf.model != "sale.order" {
        return Err("Workflow model mismatch".to_string());
    }

    let draft = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&wf.id)
        .find(|version| version.status == WorkflowVersionStatus::Draft)
        .ok_or("Workflow draft not found after create")?;
    if draft.name != "Harness Approval" || draft.draft_revision != 1 {
        return Err("Workflow draft header mismatch".to_string());
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
            payment_mode: "draft_invoice".to_string(),
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

pub fn test_documents_wave_b_restore_and_folder_ops(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let checksum = "d".repeat(64);

    create_document_folder(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentFolderParams {
            name: "Wave B Source".to_string(),
            description: None,
            parent_id: None,
            is_access_restricted: false,
            is_hidden: false,
            is_readonly: false,
            is_favorite: false,
            sequence: 1,
            storage_id: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    create_document_folder(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentFolderParams {
            name: "Wave B Dest".to_string(),
            description: None,
            parent_id: None,
            is_access_restricted: false,
            is_hidden: false,
            is_readonly: false,
            is_favorite: false,
            sequence: 2,
            storage_id: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let source = ctx
        .db
        .doc_folder()
        .iter()
        .find(|f| f.organization_id == org_id && f.name == "Wave B Source")
        .ok_or("source folder missing")?;
    let dest = ctx
        .db
        .doc_folder()
        .iter()
        .find(|f| f.organization_id == org_id && f.name == "Wave B Dest")
        .ok_or("dest folder missing")?;

    update_document_folder(
        ctx,
        org_id,
        source.id,
        UpdateDocumentFolderParams {
            name: Some("Wave B Source Renamed".to_string()),
            description: None,
            parent_id: None,
            sequence: None,
            is_access_restricted: None,
            is_hidden: None,
            is_readonly: None,
            is_favorite: None,
            storage_id: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let renamed = ctx
        .db
        .doc_folder()
        .id()
        .find(&source.id)
        .ok_or("folder gone after rename")?;
    if renamed.name != "Wave B Source Renamed" {
        return Err("folder rename failed".to_string());
    }

    create_document(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentParams {
            name: "Wave B Doc".to_string(),
            description: None,
            file_name: "wave-b.pdf".to_string(),
            file_size: 64,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/default/waveb".to_string(),
            checksum: checksum.clone(),
            folder_id: Some(source.id),
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let doc = ctx
        .db
        .document()
        .iter()
        .find(|d| d.organization_id == org_id && d.name == "Wave B Doc")
        .ok_or("wave b doc missing")?;

    let source_after_create = ctx
        .db
        .doc_folder()
        .id()
        .find(&source.id)
        .ok_or("source gone")?;
    if source_after_create.document_count != 1 {
        return Err(format!(
            "expected source count 1, got {}",
            source_after_create.document_count
        ));
    }

    update_document(
        ctx,
        org_id,
        doc.id,
        UpdateDocumentParams {
            name: None,
            description: None,
            folder_id: Some(dest.id),
            tag_ids: None,
            is_favorite: None,
            res_model: None,
            res_id: None,
            partner_id: None,
            metadata: None,
        },
    )?;
    let source_after_move = ctx
        .db
        .doc_folder()
        .id()
        .find(&source.id)
        .ok_or("source gone after move")?;
    let dest_after_move = ctx
        .db
        .doc_folder()
        .id()
        .find(&dest.id)
        .ok_or("dest gone after move")?;
    if source_after_move.document_count != 0 || dest_after_move.document_count != 1 {
        return Err(format!(
            "folder counts after move: source={}, dest={}",
            source_after_move.document_count, dest_after_move.document_count
        ));
    }

    delete_document(ctx, org_id, doc.id)?;
    let deleted = ctx
        .db
        .document()
        .id()
        .find(&doc.id)
        .ok_or("doc gone after soft-delete")?;
    if !deleted.is_deleted {
        return Err("expected soft-deleted".to_string());
    }
    let dest_after_delete = ctx
        .db
        .doc_folder()
        .id()
        .find(&dest.id)
        .ok_or("dest gone after delete")?;
    if dest_after_delete.document_count != 0 {
        return Err("dest count should be 0 after delete".to_string());
    }

    restore_document(ctx, org_id, doc.id)?;
    let restored = ctx
        .db
        .document()
        .id()
        .find(&doc.id)
        .ok_or("doc gone after restore")?;
    if restored.is_deleted {
        return Err("expected restored".to_string());
    }
    let dest_after_restore = ctx
        .db
        .doc_folder()
        .id()
        .find(&dest.id)
        .ok_or("dest gone after restore")?;
    if dest_after_restore.document_count != 1 {
        return Err("dest count should be 1 after restore".to_string());
    }

    // Empty source folder can be deleted; dest still has a document.
    delete_document_folder(ctx, org_id, source.id)?;
    if ctx.db.doc_folder().id().find(&source.id).is_some() {
        return Err("source folder should be deleted".to_string());
    }
    let dest_delete_err = delete_document_folder(ctx, org_id, dest.id)
        .err()
        .ok_or("expected non-empty folder delete failure")?;
    if !dest_delete_err.contains("still contains documents") {
        return Err(format!("unexpected delete error: {dest_delete_err}"));
    }

    lock_document(ctx, org_id, doc.id, Some(3_600))?;
    let leased = ctx
        .db
        .document()
        .id()
        .find(&doc.id)
        .ok_or("doc gone after lease lock")?;
    if leased.locked_until.is_none() {
        return Err("expected locked_until for leased lock".to_string());
    }

    Ok(())
}

pub fn test_documents_wave_c_index_retention_fiscal(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let checksum = "c".repeat(64);

    if ctx
        .db
        .country_pack_definition()
        .pack_key()
        .find(&"au".to_string())
        .is_none()
    {
        return Err("au country pack missing — run migrations".into());
    }
    set_company_country_pack(
        ctx,
        org_id,
        fixture.company_id,
        SetCompanyCountryPackParams {
            pack_key: "au".into(),
            enabled: true,
            configuration: None,
        },
    )?;

    let lang = document_search_language_for_company(ctx, org_id, Some(fixture.company_id))
        .ok_or("expected au document_search_language")?;
    if lang != "en" {
        return Err(format!("expected au search language en, got {lang}"));
    }
    let analyzer = document_search_analyzer_for_company(ctx, org_id, Some(fixture.company_id))
        .ok_or("expected au document_search_analyzer")?;
    if analyzer != "english" {
        return Err(format!("expected au analyzer english, got {analyzer}"));
    }

    create_document_folder(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentFolderParams {
            name: "Wave C Folder".to_string(),
            description: None,
            parent_id: None,
            is_access_restricted: false,
            is_hidden: false,
            is_readonly: false,
            is_favorite: false,
            sequence: 1,
            storage_id: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let folder = ctx
        .db
        .doc_folder()
        .iter()
        .find(|f| f.organization_id == org_id && f.name == "Wave C Folder")
        .ok_or("wave c folder missing")?;
    if folder.residency_region.as_deref() != Some("au") {
        return Err(format!(
            "expected folder residency au from pack, got {:?}",
            folder.residency_region
        ));
    }

    let fiscal_err = create_document(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentParams {
            name: "Bad fiscal".to_string(),
            description: None,
            file_name: "nfe.pdf".to_string(),
            file_size: 32,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/au/badfiscal".to_string(),
            checksum: checksum.clone(),
            folder_id: Some(folder.id),
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: Some("nfe_xml".to_string()),
            residency_region: None,
            metadata: None,
        },
    )
    .err()
    .ok_or("expected fiscal MIME rejection")?;
    if !fiscal_err.contains("fiscal_kind") {
        return Err(format!("unexpected fiscal error: {fiscal_err}"));
    }

    let tax_invoice_mime_err = create_document(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentParams {
            name: "Wave C Indexed".to_string(),
            description: Some("searchable body phrase".to_string()),
            file_name: "wave-c.txt".to_string(),
            file_size: 48,
            mimetype: "text/plain".to_string(),
            url: "/api/documents/blobs/object/1/au/wavec".to_string(),
            checksum: checksum.clone(),
            folder_id: Some(folder.id),
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: Some("extra extract token".to_string()),
            classification_id: None,
            retention_days: Some(30),
            fiscal_kind: Some("tax_invoice_pdf".to_string()),
            residency_region: None,
            metadata: None,
        },
    )
    .err()
    .ok_or_else(|| "tax_invoice_pdf requires application/pdf".to_string())?;
    if !tax_invoice_mime_err.contains("MIME") && !tax_invoice_mime_err.contains("fiscal_kind") {
        return Err(format!(
            "unexpected tax_invoice error: {tax_invoice_mime_err}"
        ));
    }

    create_document(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentParams {
            name: "Wave C Indexed".to_string(),
            description: Some("searchable body phrase".to_string()),
            file_name: "wave-c.pdf".to_string(),
            file_size: 48,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/au/wavec".to_string(),
            checksum: checksum.clone(),
            folder_id: Some(folder.id),
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: Some("extra extract token".to_string()),
            classification_id: None,
            retention_days: Some(30),
            fiscal_kind: Some("tax_invoice_pdf".to_string()),
            residency_region: None,
            metadata: None,
        },
    )?;

    let doc = ctx
        .db
        .document()
        .iter()
        .find(|d| d.organization_id == org_id && d.name == "Wave C Indexed")
        .ok_or("wave c doc missing")?;
    let index = doc
        .index_content
        .as_deref()
        .ok_or("expected default index_content")?;
    if !index.contains("Wave C Indexed")
        || !index.contains("searchable body phrase")
        || !index.contains("extra extract token")
    {
        return Err(format!("index_content incomplete: {index}"));
    }
    if doc.index_language.as_deref() != Some("en") {
        return Err(format!(
            "expected index_language en, got {:?}",
            doc.index_language
        ));
    }
    if doc.residency_region.as_deref() != Some("au") {
        return Err(format!(
            "expected residency au, got {:?}",
            doc.residency_region
        ));
    }
    if doc.fiscal_kind.as_deref() != Some("tax_invoice_pdf") {
        return Err(format!("expected fiscal_kind, got {:?}", doc.fiscal_kind));
    }
    if doc.retention_days != Some(30) {
        return Err(format!(
            "expected retention_days 30, got {:?}",
            doc.retention_days
        ));
    }

    set_document_index_content(
        ctx,
        org_id,
        doc.id,
        SetDocumentIndexContentParams {
            content: "reindexed unique phrase xyzzy".to_string(),
            language: Some("en".to_string()),
        },
    )?;
    let reindexed = ctx
        .db
        .document()
        .id()
        .find(&doc.id)
        .ok_or("doc gone after reindex")?;
    if reindexed.index_content.as_deref() != Some("reindexed unique phrase xyzzy") {
        return Err("reindex did not replace index_content".to_string());
    }

    set_document_retention(
        ctx,
        org_id,
        doc.id,
        SetDocumentRetentionParams {
            classification_id: None,
            retention_days: Some(7),
        },
    )?;
    delete_document(ctx, org_id, doc.id)?;
    let soft = ctx
        .db
        .document()
        .id()
        .find(&doc.id)
        .ok_or("doc gone after soft-delete")?;
    if soft.purge_after.is_none() {
        return Err("expected purge_after after soft-delete with retention".to_string());
    }

    // Force eligibility for purge (domain test can mutate rows).
    ctx.db.document().id().update(Document {
        purge_after: Some(ctx.timestamp),
        ..soft
    });
    purge_expired_documents(ctx, org_id)?;
    if ctx.db.document().id().find(&doc.id).is_some() {
        return Err("expected hard purge of expired document".to_string());
    }

    Ok(())
}

pub fn test_documents_wave_d_hold_ocr_drive_esign_presence(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let checksum = "d".repeat(64);

    create_document(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentParams {
            name: "Wave D Hold Doc".to_string(),
            description: None,
            file_name: "hold.pdf".to_string(),
            file_size: 64,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/default/hold".to_string(),
            checksum: checksum.clone(),
            folder_id: None,
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: Some(7),
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let doc = ctx
        .db
        .document()
        .iter()
        .find(|d| d.organization_id == org_id && d.name == "Wave D Hold Doc")
        .ok_or("wave d doc missing")?;

    apply_document_legal_hold(
        ctx,
        org_id,
        doc.id,
        ApplyDocumentLegalHoldParams {
            reason: "litigation hold".to_string(),
            metadata: None,
        },
    )?;
    let doc_id = doc.id;
    let doc_url = doc.url.clone().unwrap_or_default();
    let doc_version_id = doc.current_version_id;

    let del_err = delete_document(ctx, org_id, doc_id)
        .err()
        .ok_or("expected legal hold to block delete")?;
    if !del_err.contains("legal hold") {
        return Err(format!("unexpected delete error: {del_err}"));
    }

    // Soft-delete bypass for purge test: force deleted + purge_after while hold active.
    let held = ctx
        .db
        .document()
        .id()
        .find(&doc_id)
        .ok_or("doc missing before purge probe")?;
    ctx.db.document().id().update(Document {
        is_deleted: true,
        deleted_at: Some(ctx.timestamp),
        purge_after: Some(ctx.timestamp),
        ..held
    });
    purge_expired_documents(ctx, org_id)?;
    if ctx.db.document().id().find(&doc_id).is_none() {
        return Err("legal hold must block purge".to_string());
    }

    let hold = ctx
        .db
        .document_legal_hold()
        .iter()
        .find(|h| h.document_id == doc_id && h.is_active)
        .ok_or("active hold missing")?;
    release_document_legal_hold(
        ctx,
        org_id,
        hold.id,
        ReleaseDocumentLegalHoldParams { metadata: None },
    )?;

    // Restore for OCR / presence / e-sign paths.
    let after_hold = ctx
        .db
        .document()
        .id()
        .find(&doc_id)
        .ok_or("doc missing after hold release")?;
    ctx.db.document().id().update(Document {
        is_deleted: false,
        deleted_at: None,
        deleted_by: None,
        purge_after: None,
        ..after_hold
    });

    update_document_presence(ctx, org_id, doc_id, "Tester".to_string())?;
    if ctx
        .db
        .document_presence()
        .iter()
        .filter(|p| p.document_id == doc_id)
        .count()
        != 1
    {
        return Err("expected document presence row".to_string());
    }
    clear_document_presence(ctx, doc_id)?;

    create_document_processing_job(
        ctx,
        org_id,
        Some(fixture.company_id),
        CreateDocumentProcessingJobParams {
            document_type: "invoice".to_string(),
            job_type: "OCR".to_string(),
            ai_agent_id: None,
            input_data: Some(format!("{{\"url\":\"{doc_url}\"}}")),
            document_id: Some(doc_id),
            document_version_id: doc_version_id,
            metadata: None,
        },
    )?;
    let job = ctx
        .db
        .ai_document_processing_job()
        .iter()
        .filter(|j| j.document_id == Some(doc_id))
        .max_by_key(|j| j.id)
        .ok_or("ocr job missing")?;
    complete_document_processing_job(
        ctx,
        org_id,
        Some(fixture.company_id),
        job.id,
        CompleteDocumentProcessingJobParams {
            extracted_data: Some(r#"{"vendor":"Acme","total":12.5}"#.to_string()),
            confidence_score: Some(0.9),
            model_used: Some("text-extract".to_string()),
            tokens_used: Some(10),
            cost: Some(0.0),
            error_message: None,
        },
    )?;
    approve_document_processing_job(ctx, org_id, Some(fixture.company_id), job.id)?;
    let indexed = ctx
        .db
        .document()
        .id()
        .find(&doc_id)
        .ok_or("doc gone after OCR approve")?;
    if !indexed
        .index_content
        .as_deref()
        .unwrap_or("")
        .contains("Acme")
    {
        return Err("approved OCR should populate index_content".to_string());
    }

    create_document_signature_request(
        ctx,
        org_id,
        doc_id,
        CreateDocumentSignatureRequestParams {
            provider: "external_tsp".to_string(),
            external_envelope_id: "env-wave-d-1".to_string(),
            signers_json: Some(r#"[{"email":"a@example.com"}]"#.to_string()),
            metadata: None,
        },
    )?;
    let sig = ctx
        .db
        .document_signature_request()
        .iter()
        .find(|s| s.document_id == doc_id && s.status == "pending")
        .ok_or("signature request missing")?;
    let signed_checksum = "e".repeat(64);
    complete_document_signature_request(
        ctx,
        org_id,
        sig.id,
        CompleteDocumentSignatureRequestParams {
            file_name: "hold-signed.pdf".to_string(),
            file_size: 80,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/default/hold-signed".to_string(),
            checksum: signed_checksum,
            changes_description: None,
            metadata: None,
        },
    )?;
    let completed_sig = ctx
        .db
        .document_signature_request()
        .id()
        .find(&sig.id)
        .ok_or("sig gone")?;
    if completed_sig.status != "completed" || completed_sig.completed_version_id.is_none() {
        return Err("signature completion should set version".to_string());
    }

    create_google_drive_connection(
        ctx,
        org_id,
        "Wave D Drive".to_string(),
        "drive@example.com".to_string(),
        "gd-acc-1".to_string(),
        "vault://test/drive".to_string(),
        None,
        None,
        true,
        false,
        None,
        None,
        SyncDirection::Bidirectional,
        60,
        vec!["pdf".to_string()],
        25,
    )?;
    let conn = ctx
        .db
        .google_drive_connection()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == "Wave D Drive")
        .ok_or("drive connection missing")?;
    set_google_drive_conflict_policy(
        ctx,
        org_id,
        conn.id,
        SetDriveConflictPolicyParams {
            conflict_policy: DriveConflictPolicy::PreferRemote,
        },
    )?;

    let sync_checksum = "f".repeat(64);
    sync_external_file_to_document(
        ctx,
        org_id,
        SyncExternalFileToDocumentParams {
            provider: "google_drive".to_string(),
            connection_id: Some(conn.id),
            external_id: "gfile-1".to_string(),
            etag: Some("etag-1".to_string()),
            name: "Imported Drive File".to_string(),
            file_name: "imported.pdf".to_string(),
            file_size: 100,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/default/imported".to_string(),
            checksum: sync_checksum.clone(),
            folder_id: None,
            company_id: Some(fixture.company_id),
            metadata: None,
        },
    )?;
    let xref = ctx
        .db
        .document_external_ref()
        .iter()
        .find(|r| r.organization_id == org_id && r.external_id == "gfile-1")
        .ok_or("external ref missing")?;
    // Second sync with new etag should version.
    sync_external_file_to_document(
        ctx,
        org_id,
        SyncExternalFileToDocumentParams {
            provider: "google_drive".to_string(),
            connection_id: Some(conn.id),
            external_id: "gfile-1".to_string(),
            etag: Some("etag-2".to_string()),
            name: "Imported Drive File".to_string(),
            file_name: "imported-v2.pdf".to_string(),
            file_size: 120,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/1/default/imported-v2".to_string(),
            checksum: "a".repeat(64),
            folder_id: None,
            company_id: Some(fixture.company_id),
            metadata: None,
        },
    )?;
    let synced_doc = ctx
        .db
        .document()
        .id()
        .find(&xref.document_id)
        .ok_or("synced doc missing")?;
    if synced_doc.version_count < 2 {
        return Err(format!(
            "expected version bump after PreferRemote sync, got {}",
            synced_doc.version_count
        ));
    }

    Ok(())
}

/// Forms platform: publish config, bind EAV values to defs, reject unknown keys.
pub fn test_forms_custom_field_eav(ctx: &ReducerContext) -> Result<(), String> {
    use crate::crm::leads::{create_lead, lead, CreateLeadParams};
    use crate::forms::{
        add_form_field, form_config, publish_form_configuration, record_custom_field_value,
        set_record_custom_field_values, CreateFormFieldParams, FieldType, FieldValidation,
        FieldWidth, PublishFormConfigurationParams, RecordCustomFieldEntry,
        SetRecordCustomFieldValuesParams,
    };

    fn text_field(
        field_id: &str,
        label: &str,
        order: u32,
        is_system: bool,
        validation: FieldValidation,
        width: FieldWidth,
        show_in_list: bool,
    ) -> CreateFormFieldParams {
        CreateFormFieldParams {
            field_id: field_id.to_string(),
            name: field_id.trim_start_matches("custom:").to_string(),
            label: label.to_string(),
            field_type: FieldType::Text,
            description: None,
            placeholder: None,
            default_value: None,
            options: vec![],
            validation,
            ai_suggestions: vec![],
            order,
            is_system,
            is_enabled: true,
            category: None,
            show_in_list,
            width,
            section_id: None,
            visibility_json: None,
        }
    }

    fn set_eav(
        ctx: &ReducerContext,
        org_id: u64,
        company_id: u64,
        lead_id: u64,
        field_key: &str,
        value_json: &str,
    ) -> Result<(), String> {
        set_record_custom_field_values(
            ctx,
            org_id,
            company_id,
            SetRecordCustomFieldValuesParams {
                model: "crm_lead".to_string(),
                record_id: lead_id,
                entries: vec![RecordCustomFieldEntry {
                    field_key: field_key.to_string(),
                    value_json: value_json.to_string(),
                }],
            },
        )
    }

    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_lead(
        ctx,
        org_id,
        CreateLeadParams {
            name: "EAV Test Lead".to_string(),
            priority: "normal".to_string(),
            state: "new".to_string(),
            expected_revenue: 0.0,
            probability: 0.0,
            tag_ids: vec![],
            email: None,
            phone: None,
            mobile: None,
            company_name: None,
            contact_name: None,
            title: None,
            street: None,
            city: None,
            zip: None,
            country_code: None,
            website: None,
            industry: None,
            source_id: None,
            campaign_id: None,
            medium_id: None,
            referred_by: None,
            description: None,
            user_id: None,
            stage_id: None,
            team_id: None,
            partner_id: None,
            date_deadline: None,
            metadata: None,
        },
    )?;
    let lead_id = ctx
        .db
        .lead()
        .iter()
        .find(|l| l.organization_id == org_id && l.name == "EAV Test Lead")
        .map(|l| l.id)
        .ok_or("EAV test lead missing after create")?;

    publish_form_configuration(
        ctx,
        org_id,
        PublishFormConfigurationParams {
            module_id: "crm".to_string(),
            form_id: "new-lead".to_string(),
            name: "New Lead".to_string(),
            description: Some("test".to_string()),
            is_system_default: false,
            fields: vec![text_field(
                "name",
                "Name",
                1,
                true,
                FieldValidation {
                    required: true,
                    ..FieldValidation::default()
                },
                FieldWidth::Full,
                true,
            )],
            role_configs: vec![],
            expected_updated_at_micros: None,
            replace_missing_fields: false,
        },
    )?;

    let config = ctx
        .db
        .form_config()
        .iter()
        .find(|c| c.organization_id == org_id && c.module_id == "crm" && c.form_id == "new-lead")
        .ok_or("published form_config missing")?;

    add_form_field(
        ctx,
        org_id,
        config.id,
        text_field(
            "custom:region_code",
            "Region",
            10,
            false,
            FieldValidation {
                required: true,
                min_length: Some(2),
                ..FieldValidation::default()
            },
            FieldWidth::Half,
            false,
        ),
    )?;

    if set_eav(ctx, org_id, company_id, lead_id, "custom:unknown", "\"x\"").is_ok() {
        return Err("unknown custom field should be rejected".to_string());
    }
    if set_eav(ctx, org_id, company_id, lead_id, "custom:region_code", "\"\"").is_ok() {
        return Err("required custom field empty value should be rejected".to_string());
    }

    set_eav(ctx, org_id, company_id, lead_id, "custom:region_code", "\"APAC\"")?;

    let row = ctx
        .db
        .record_custom_field_value()
        .iter()
        .find(|r| {
            r.organization_id == org_id
                && r.company_id == company_id
                && r.model == "crm_lead"
                && r.record_id == lead_id
                && r.field_key == "custom:region_code"
        })
        .ok_or("EAV row missing after upsert")?;
    if row.value_json != "\"APAC\"" {
        return Err(format!("unexpected value_json {}", row.value_json));
    }

    Ok(())
}

/// FRM-002: res_id existence/org checks now apply beyond account_move — proven
/// here against the "contact" model (missing and cross-org record_id rejected;
/// a real, same-org record succeeds).
pub fn test_forms_custom_field_record_existence(ctx: &ReducerContext) -> Result<(), String> {
    use crate::crm::contacts::{contact, create_contact, CreateContactParams};
    use crate::forms::{
        add_form_field, form_config, publish_form_configuration, record_custom_field_value,
        set_record_custom_field_values, CreateFormFieldParams, FieldType, FieldValidation,
        FieldWidth, PublishFormConfigurationParams, RecordCustomFieldEntry,
        SetRecordCustomFieldValuesParams,
    };

    fn set_eav(
        ctx: &ReducerContext,
        org_id: u64,
        company_id: u64,
        record_id: u64,
    ) -> Result<(), String> {
        set_record_custom_field_values(
            ctx,
            org_id,
            company_id,
            SetRecordCustomFieldValuesParams {
                model: "contact".to_string(),
                record_id,
                entries: vec![RecordCustomFieldEntry {
                    field_key: "custom:anything".to_string(),
                    value_json: "\"x\"".to_string(),
                }],
            },
        )
    }

    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;

    publish_form_configuration(
        ctx,
        local.organization_id,
        PublishFormConfigurationParams {
            module_id: "crm".to_string(),
            form_id: "new-contact".to_string(),
            name: "New Contact".to_string(),
            description: None,
            is_system_default: false,
            fields: vec![],
            role_configs: vec![],
            expected_updated_at_micros: None,
            replace_missing_fields: false,
        },
    )?;
    let config = ctx
        .db
        .form_config()
        .iter()
        .find(|c| {
            c.organization_id == local.organization_id
                && c.module_id == "crm"
                && c.form_id == "new-contact"
        })
        .ok_or("published form_config missing")?;
    add_form_field(
        ctx,
        local.organization_id,
        config.id,
        CreateFormFieldParams {
            field_id: "custom:anything".to_string(),
            name: "custom:anything".to_string(),
            label: "Anything".to_string(),
            field_type: FieldType::Text,
            description: None,
            placeholder: None,
            default_value: None,
            options: vec![],
            validation: FieldValidation::default(),
            ai_suggestions: vec![],
            order: 1,
            is_system: false,
            is_enabled: true,
            category: None,
            show_in_list: false,
            width: FieldWidth::Full,
            section_id: None,
            visibility_json: None,
        },
    )?;

    let make_contact = |ctx: &ReducerContext, fixture: &OrgFixture, name: &str| -> Result<u64, String> {
        create_contact(
            ctx,
            fixture.organization_id,
            CreateContactParams {
                name: name.to_string(),
                type_: "contact".to_string(),
                email: None,
                phone: None,
                mobile: None,
                company_id: Some(fixture.company_id),
                is_customer: true,
                is_vendor: false,
                is_employee: false,
                is_prospect: false,
                is_partner: false,
                customer_rank: 0,
                supplier_rank: 0,
                display_name: None,
                first_name: None,
                last_name: None,
                title: None,
                email_secondary: None,
                fax: None,
                website: None,
                street: None,
                street2: None,
                city: None,
                state_code: None,
                zip: None,
                country_code: None,
                tax_id: None,
                company_registry: None,
                industry: None,
                employees_count: None,
                annual_revenue: None,
                description: None,
                salesperson_id: None,
                assigned_user_id: None,
                parent_id: None,
                user_id: None,
                color: None,
                metadata: None,
            },
        )?;
        ctx.db
            .contact()
            .iter()
            .find(|c| c.organization_id == fixture.organization_id && c.name == name)
            .map(|c| c.id)
            .ok_or_else(|| format!("contact {name} missing after create"))
    };

    let foreign_contact_id = make_contact(ctx, &foreign, "FRM-002 Foreign Contact")?;
    let missing_contact_id = ctx.db.contact().iter().map(|c| c.id).max().unwrap_or(0) + 1000;

    if set_eav(ctx, local.organization_id, local.company_id, missing_contact_id).is_ok() {
        return Err("missing contact record_id should be rejected".to_string());
    }
    if set_eav(ctx, local.organization_id, local.company_id, foreign_contact_id).is_ok() {
        return Err("cross-org contact record_id should be rejected".to_string());
    }

    let local_contact_id = make_contact(ctx, &local, "FRM-002 Local Contact")?;
    set_eav(ctx, local.organization_id, local.company_id, local_contact_id)?;
    if !ctx.db.record_custom_field_value().iter().any(|r| {
        r.organization_id == local.organization_id
            && r.model == "contact"
            && r.record_id == local_contact_id
    }) {
        return Err("valid contact EAV write was not persisted".to_string());
    }

    Ok(())
}

/// DOC-006: create_document already validates folder_id FK existence, org
/// match, and company scope — this proves the cross-org rejection path
/// specifically (no existing test covered it).
pub fn test_documents_folder_fk_rejects_cross_org(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;

    create_document_folder(
        ctx,
        foreign.organization_id,
        Some(foreign.company_id),
        CreateDocumentFolderParams {
            name: "DOC-006 Foreign Folder".to_string(),
            description: None,
            parent_id: None,
            is_access_restricted: false,
            is_hidden: false,
            is_readonly: false,
            is_favorite: false,
            sequence: 1,
            storage_id: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let foreign_folder_id = ctx
        .db
        .doc_folder()
        .iter()
        .find(|f| f.organization_id == foreign.organization_id && f.name == "DOC-006 Foreign Folder")
        .map(|f| f.id)
        .ok_or("foreign folder missing")?;

    let checksum = "b".repeat(64);
    let missing = create_document(
        ctx,
        local.organization_id,
        Some(local.company_id),
        CreateDocumentParams {
            name: "DOC-006 Missing Folder Doc".to_string(),
            description: None,
            file_name: "doc.pdf".to_string(),
            file_size: 128,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/2/default/deadbeef".to_string(),
            checksum: checksum.clone(),
            folder_id: Some(999_999_999),
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    );
    if missing.is_ok() {
        return Err("missing folder_id should reject".to_string());
    }

    let cross_org = create_document(
        ctx,
        local.organization_id,
        Some(local.company_id),
        CreateDocumentParams {
            name: "DOC-006 Cross Org Doc".to_string(),
            description: None,
            file_name: "doc.pdf".to_string(),
            file_size: 128,
            mimetype: "application/pdf".to_string(),
            url: "/api/documents/blobs/object/3/default/deadbeef".to_string(),
            checksum,
            folder_id: Some(foreign_folder_id),
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    );
    if cross_org.is_ok() {
        return Err("cross-org folder_id should reject".to_string());
    }
    Ok(())
}

/// DOC-008: create_document rejects an oversized file and a disallowed
/// mimetype, and accepts a valid combination.
pub fn test_documents_upload_rejects_oversized_and_disallowed_mimetype(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    let base = |name: &str, file_size: u64, mimetype: &str, checksum: String| CreateDocumentParams {
        name: name.to_string(),
        description: None,
        file_name: "doc.bin".to_string(),
        file_size,
        mimetype: mimetype.to_string(),
        url: "/api/documents/blobs/object/4/default/deadbeef".to_string(),
        checksum,
        folder_id: None,
        res_model: None,
        res_id: None,
        partner_id: None,
        tag_ids: vec![],
        is_favorite: false,
        index_content: None,
        classification_id: None,
        retention_days: None,
        fiscal_kind: None,
        residency_region: None,
        metadata: None,
    };

    let oversized = create_document(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        base(
            "DOC-008 Oversized",
            51 * 1024 * 1024,
            "application/pdf",
            "c".repeat(64),
        ),
    );
    if oversized.is_ok() {
        return Err("oversized file_size should reject".to_string());
    }

    let disallowed = create_document(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        base(
            "DOC-008 Disallowed Mime",
            128,
            "application/x-msdownload",
            "d".repeat(64),
        ),
    );
    if disallowed.is_ok() {
        return Err("disallowed mimetype should reject".to_string());
    }

    create_document(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        base("DOC-008 Valid", 1024, "application/pdf", "e".repeat(64)),
    )?;
    if !ctx
        .db
        .document()
        .iter()
        .any(|d| d.organization_id == fixture.organization_id && d.name == "DOC-008 Valid")
    {
        return Err("valid document was not persisted".to_string());
    }
    Ok(())
}
