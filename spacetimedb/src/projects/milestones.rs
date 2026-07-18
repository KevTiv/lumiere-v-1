//! Project milestones — real entity for task.milestone_id FK.
//!
//! # Tables
//! | Table | Description |
//! |-------|-------------|
//! | **ProjectMilestone** | Named delivery milestone on a project |

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::projects::projects::project_project;
use crate::projects::tasks::project_task;

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_milestone,
    public,
    index(accessor = milestone_by_org, btree(columns = [organization_id])),
    index(accessor = milestone_by_company, btree(columns = [company_id])),
    index(accessor = milestone_by_project, btree(columns = [project_id]))
)]
pub struct ProjectMilestone {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub project_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub deadline: Option<Timestamp>,
    pub sequence: u32,
    pub is_reached: bool,
    /// Fixed-fee / milestone bill amount (company currency when billed).
    pub bill_amount: f64,
    /// Completion percent used for partial milestone billing (0–100).
    pub percent_complete: f64,
    /// OutInvoice created by `bill_project_milestone`.
    pub invoice_move_id: Option<u64>,
    /// Amount actually billed onto the linked invoice.
    pub billed_amount: f64,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProjectMilestoneParams {
    pub project_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub deadline: Option<Timestamp>,
    pub sequence: u32,
    pub is_reached: bool,
    pub bill_amount: f64,
    pub percent_complete: f64,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProjectMilestoneParams {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub deadline: Option<Option<Timestamp>>,
    pub sequence: Option<u32>,
    pub is_reached: Option<bool>,
    pub bill_amount: Option<f64>,
    pub percent_complete: Option<f64>,
    pub active: Option<bool>,
    pub metadata: Option<Option<String>>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

pub fn validate_milestone_fk(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: Option<u64>,
    milestone_id: Option<u64>,
) -> Result<(), String> {
    let Some(mid) = milestone_id else {
        return Ok(());
    };
    let ms = ctx
        .db
        .project_milestone()
        .id()
        .find(&mid)
        .ok_or("Milestone not found")?;
    if ms.organization_id != organization_id {
        return Err("Milestone does not belong to this organization".to_string());
    }
    if ms.company_id != company_id {
        return Err("Milestone does not belong to this company".to_string());
    }
    if let Some(pid) = project_id {
        if ms.project_id != pid {
            return Err("Milestone does not belong to the task project".to_string());
        }
    }
    if !ms.active {
        return Err("Milestone is inactive".to_string());
    }
    Ok(())
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_project_milestone(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateProjectMilestoneParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_milestone", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    if params.name.trim().is_empty() {
        return Err("Milestone name cannot be empty".to_string());
    }

    let project = ctx
        .db
        .project_project()
        .id()
        .find(&params.project_id)
        .ok_or("Project not found")?;
    if project.organization_id != organization_id || project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }

    if params.bill_amount < 0.0 {
        return Err("bill_amount cannot be negative".to_string());
    }
    if params.percent_complete < 0.0 || params.percent_complete > 100.0 {
        return Err("percent_complete must be between 0 and 100".to_string());
    }

    let row = ctx.db.project_milestone().insert(ProjectMilestone {
        id: 0,
        organization_id,
        company_id,
        project_id: params.project_id,
        name: params.name,
        description: params.description,
        deadline: params.deadline,
        sequence: params.sequence,
        is_reached: params.is_reached,
        bill_amount: params.bill_amount,
        percent_complete: params.percent_complete,
        invoice_move_id: None,
        billed_amount: 0.0,
        active: params.active,
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
            table_name: "project_milestone",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": row.name,
                    "project_id": row.project_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "project_id".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_project_milestone(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    milestone_id: u64,
    params: UpdateProjectMilestoneParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_milestone", "write")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let existing = ctx
        .db
        .project_milestone()
        .id()
        .find(&milestone_id)
        .ok_or("Milestone not found")?;
    if existing.organization_id != organization_id {
        return Err("Milestone does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if let Some(amt) = params.bill_amount {
        if amt < 0.0 {
            return Err("bill_amount cannot be negative".to_string());
        }
    }
    if let Some(pct) = params.percent_complete {
        if pct < 0.0 || pct > 100.0 {
            return Err("percent_complete must be between 0 and 100".to_string());
        }
    }
    if existing.invoice_move_id.is_some()
        && (params.bill_amount.is_some() || params.percent_complete.is_some())
    {
        return Err("Cannot change bill amounts on a billed milestone".to_string());
    }

    let updated = ProjectMilestone {
        name: params.name.unwrap_or(existing.name.clone()),
        description: match params.description {
            Some(v) => v,
            None => existing.description.clone(),
        },
        deadline: match params.deadline {
            Some(v) => v,
            None => existing.deadline,
        },
        sequence: params.sequence.unwrap_or(existing.sequence),
        is_reached: params.is_reached.unwrap_or(existing.is_reached),
        bill_amount: params.bill_amount.unwrap_or(existing.bill_amount),
        percent_complete: params
            .percent_complete
            .unwrap_or(existing.percent_complete),
        active: params.active.unwrap_or(existing.active),
        metadata: match params.metadata {
            Some(v) => v,
            None => existing.metadata.clone(),
        },
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..existing
    };
    ctx.db.project_milestone().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_milestone",
            record_id: milestone_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": updated.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn delete_project_milestone(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    milestone_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_milestone", "delete")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let existing = ctx
        .db
        .project_milestone()
        .id()
        .find(&milestone_id)
        .ok_or("Milestone not found")?;
    if existing.organization_id != organization_id {
        return Err("Milestone does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let linked = ctx
        .db
        .project_task()
        .iter()
        .any(|t| t.milestone_id == Some(milestone_id));
    if linked {
        return Err("Cannot delete milestone while tasks reference it".to_string());
    }

    ctx.db.project_milestone().id().delete(&milestone_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_milestone",
            record_id: milestone_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": existing.name }).to_string()),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
