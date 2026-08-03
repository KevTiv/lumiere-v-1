/// HR employee onboarding — checklist templates and per-employee progress.
///
/// Distinct from auth `/(auth)/onboarding` (organization signup).
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_employee;

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = hr_onboarding_template,
    public,
    index(accessor = onboarding_tpl_by_org, btree(columns = [organization_id])),
    index(accessor = onboarding_tpl_by_company, btree(columns = [company_id]))
)]
pub struct HrOnboardingTemplate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[spacetimedb::table(
    accessor = hr_onboarding_template_item,
    public,
    index(accessor = onboarding_tpl_item_by_template, btree(columns = [template_id])),
    index(accessor = onboarding_tpl_item_by_org, btree(columns = [organization_id]))
)]
pub struct HrOnboardingTemplateItem {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub template_id: u64,
    pub title: String,
    pub description: Option<String>,
    pub sequence: u32,
    pub required: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// Per-employee onboarding assignment + item progress rows.
/// `template_item_id = 0` marks the assignment header; otherwise item progress.
#[spacetimedb::table(
    accessor = hr_onboarding_progress,
    public,
    index(accessor = onboarding_prog_by_org, btree(columns = [organization_id])),
    index(accessor = onboarding_prog_by_employee, btree(columns = [employee_id])),
    index(accessor = onboarding_prog_by_template, btree(columns = [template_id]))
)]
pub struct HrOnboardingProgress {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    pub template_id: u64,
    /// `0` = assignment header row; otherwise template item id.
    pub template_item_id: u64,
    /// assignment: in_progress | done — item: pending | complete
    pub status: String,
    pub completed_at: Option<Timestamp>,
    pub notes: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateOnboardingTemplateItemParams {
    pub title: String,
    pub description: Option<String>,
    pub sequence: u32,
    pub required: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateOnboardingTemplateParams {
    pub name: String,
    pub description: Option<String>,
    pub active: bool,
    pub items: Vec<CreateOnboardingTemplateItemParams>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AssignOnboardingTemplateParams {
    pub template_id: u64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CompleteOnboardingItemParams {
    pub template_item_id: u64,
    pub notes: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn assert_employee_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
) -> Result<(), String> {
    let emp = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .ok_or("Employee not found")?;
    if emp.organization_id != organization_id {
        return Err("Employee belongs to a different organization".to_string());
    }
    if emp.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }
    Ok(())
}

pub fn find_active_onboarding_assignment(
    ctx: &ReducerContext,
    employee_id: u64,
) -> Option<HrOnboardingProgress> {
    ctx.db
        .hr_onboarding_progress()
        .onboarding_prog_by_employee()
        .filter(&employee_id)
        .filter(|row| row.template_item_id == 0 && row.status != "done")
        .max_by_key(|row| row.id)
}

fn template_items_for(ctx: &ReducerContext, template_id: u64) -> Vec<HrOnboardingTemplateItem> {
    let mut items: Vec<HrOnboardingTemplateItem> = ctx
        .db
        .hr_onboarding_template_item()
        .onboarding_tpl_item_by_template()
        .filter(&template_id)
        .collect();
    items.sort_by_key(|i| (i.sequence, i.id));
    items
}

fn item_progress_rows(
    ctx: &ReducerContext,
    employee_id: u64,
    template_id: u64,
) -> Vec<HrOnboardingProgress> {
    ctx.db
        .hr_onboarding_progress()
        .onboarding_prog_by_employee()
        .filter(&employee_id)
        .filter(|row| row.template_id == template_id && row.template_item_id > 0)
        .collect()
}

fn all_required_items_complete(ctx: &ReducerContext, employee_id: u64, template_id: u64) -> bool {
    let items = template_items_for(ctx, template_id);
    let progress = item_progress_rows(ctx, employee_id, template_id);
    for item in items.iter().filter(|i| i.required) {
        let done = progress.iter().any(|p| {
            p.template_item_id == item.id && (p.status == "complete" || p.completed_at.is_some())
        });
        if !done {
            return false;
        }
    }
    true
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_onboarding_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateOnboardingTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "create")?;
    if params.name.trim().is_empty() {
        return Err("Template name cannot be empty".to_string());
    }
    if params.items.is_empty() {
        return Err("Template must include at least one checklist item".to_string());
    }

    let template = ctx
        .db
        .hr_onboarding_template()
        .insert(HrOnboardingTemplate {
            id: 0,
            organization_id,
            company_id,
            name: params.name.trim().to_string(),
            description: params.description,
            active: params.active,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });

    let item_count = params.items.len();

    for item in params.items {
        if item.title.trim().is_empty() {
            return Err("Checklist item title cannot be empty".to_string());
        }
        ctx.db
            .hr_onboarding_template_item()
            .insert(HrOnboardingTemplateItem {
                id: 0,
                organization_id,
                company_id,
                template_id: template.id,
                title: item.title.trim().to_string(),
                description: item.description,
                sequence: item.sequence,
                required: item.required,
                create_uid: ctx.sender(),
                create_date: ctx.timestamp,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
            });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_onboarding_template",
            record_id: template.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": template.name,
                    "item_count": item_count,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "items".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn assign_onboarding_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    params: AssignOnboardingTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;
    assert_employee_scope(ctx, organization_id, company_id, employee_id)?;

    let template = ctx
        .db
        .hr_onboarding_template()
        .id()
        .find(&params.template_id)
        .ok_or("Onboarding template not found")?;
    if template.organization_id != organization_id {
        return Err("Template belongs to a different organization".to_string());
    }
    if template.company_id != company_id {
        return Err("Template does not belong to this company".to_string());
    }
    if !template.active {
        return Err("Onboarding template is not active".to_string());
    }

    if let Some(existing) = find_active_onboarding_assignment(ctx, employee_id) {
        if existing.template_id == params.template_id {
            return Ok(());
        }
        return Err(
            "Employee already has an active onboarding assignment — mark it done first".to_string(),
        );
    }

    let items = template_items_for(ctx, params.template_id);
    if items.is_empty() {
        return Err("Template has no checklist items".to_string());
    }

    let header = ctx
        .db
        .hr_onboarding_progress()
        .insert(HrOnboardingProgress {
            id: 0,
            organization_id,
            company_id,
            employee_id,
            template_id: params.template_id,
            template_item_id: 0,
            status: "in_progress".to_string(),
            completed_at: None,
            notes: None,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });

    for item in &items {
        ctx.db
            .hr_onboarding_progress()
            .insert(HrOnboardingProgress {
                id: 0,
                organization_id,
                company_id,
                employee_id,
                template_id: params.template_id,
                template_item_id: item.id,
                status: "pending".to_string(),
                completed_at: None,
                notes: None,
                create_uid: ctx.sender(),
                create_date: ctx.timestamp,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
            });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_onboarding_progress",
            record_id: header.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_id": employee_id,
                    "template_id": params.template_id,
                    "status": "in_progress",
                })
                .to_string(),
            ),
            changed_fields: vec!["employee_id".to_string(), "template_id".to_string()],
            metadata: Some("assign_onboarding_template".to_string()),
        },
    );
    Ok(())
}

#[reducer]
pub fn complete_onboarding_item(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    params: CompleteOnboardingItemParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;
    assert_employee_scope(ctx, organization_id, company_id, employee_id)?;

    let assignment = find_active_onboarding_assignment(ctx, employee_id)
        .ok_or("No active onboarding assignment — assign a template first".to_string())?;
    if assignment.organization_id != organization_id || assignment.company_id != company_id {
        return Err("Onboarding assignment scope mismatch".to_string());
    }

    let template_item = ctx
        .db
        .hr_onboarding_template_item()
        .id()
        .find(&params.template_item_id)
        .ok_or("Template item not found")?;
    if template_item.template_id != assignment.template_id {
        return Err("Template item does not belong to the assigned template".to_string());
    }

    let mut progress = item_progress_rows(ctx, employee_id, assignment.template_id)
        .into_iter()
        .find(|p| p.template_item_id == params.template_item_id)
        .ok_or("Onboarding item progress not found")?;

    if progress.status == "complete" {
        return Ok(());
    }

    progress.status = "complete".to_string();
    progress.completed_at = Some(ctx.timestamp);
    progress.notes = params.notes.or(progress.notes);
    progress.write_uid = ctx.sender();
    progress.write_date = ctx.timestamp;
    let progress_id = progress.id;
    ctx.db.hr_onboarding_progress().id().update(progress);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_onboarding_progress",
            record_id: progress_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "template_item_id": params.template_item_id,
                    "status": "complete",
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string(), "completed_at".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn mark_onboarding_done(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;
    assert_employee_scope(ctx, organization_id, company_id, employee_id)?;

    let mut assignment = find_active_onboarding_assignment(ctx, employee_id)
        .ok_or("No active onboarding assignment — assign a template first".to_string())?;
    if assignment.organization_id != organization_id || assignment.company_id != company_id {
        return Err("Onboarding assignment scope mismatch".to_string());
    }

    if !all_required_items_complete(ctx, employee_id, assignment.template_id) {
        return Err("Complete all required onboarding items before marking done".to_string());
    }

    assignment.status = "done".to_string();
    assignment.completed_at = Some(ctx.timestamp);
    assignment.write_uid = ctx.sender();
    assignment.write_date = ctx.timestamp;
    let assignment_id = assignment.id;
    ctx.db.hr_onboarding_progress().id().update(assignment);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_onboarding_progress",
            record_id: assignment_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_id": employee_id,
                    "status": "done",
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: Some("mark_onboarding_done".to_string()),
        },
    );
    Ok(())
}
