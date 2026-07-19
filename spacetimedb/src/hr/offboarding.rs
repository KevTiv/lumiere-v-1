/// HR Offboarding — minimal checklist before employee archive.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_employee;

// ── Tables ────────────────────────────────────────────────────────────────────

/// Active offboarding checklist for one employee (MVP: assets / access / docs).
#[spacetimedb::table(
    accessor = hr_offboarding_checklist,
    public,
    index(accessor = offboarding_by_org, btree(columns = [organization_id])),
    index(accessor = offboarding_by_employee, btree(columns = [employee_id]))
)]
pub struct HrOffboardingChecklist {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    /// in_progress | complete
    pub status: String,
    pub assets_returned: bool,
    pub access_revoked: bool,
    pub docs_collected: bool,
    pub assets_notes: Option<String>,
    pub access_notes: Option<String>,
    pub docs_notes: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CompleteOffboardingItemParams {
    /// assets_returned | access_revoked | docs_collected
    pub item: String,
    pub notes: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ArchiveEmployeeParams {
    pub termination_date: Option<Timestamp>,
    pub override_incomplete_checklist: bool,
    pub override_reason: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn find_offboarding_checklist(
    ctx: &ReducerContext,
    employee_id: u64,
) -> Option<HrOffboardingChecklist> {
    ctx.db
        .hr_offboarding_checklist()
        .offboarding_by_employee()
        .filter(&employee_id)
        .max_by_key(|row| row.id)
}

pub fn checklist_is_complete(checklist: &HrOffboardingChecklist) -> bool {
    checklist.assets_returned && checklist.access_revoked && checklist.docs_collected
}

pub fn assert_offboarding_ready_for_archive(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    params: &ArchiveEmployeeParams,
) -> Result<(), String> {
    let checklist = find_offboarding_checklist(ctx, employee_id).ok_or(
        "Start offboarding checklist before archiving employee (start_offboarding)".to_string(),
    )?;
    if checklist.organization_id != organization_id {
        return Err("Offboarding checklist belongs to a different organization".to_string());
    }
    if checklist.company_id != company_id {
        return Err("Offboarding checklist does not belong to this company".to_string());
    }
    if checklist_is_complete(&checklist) {
        return Ok(());
    }
    if params.override_incomplete_checklist {
        let reason = params
            .override_reason
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or(
                "override_reason is required when override_incomplete_checklist is true".to_string(),
            )?;
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "hr_offboarding_checklist",
                record_id: checklist.id,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "override_reason": reason,
                        "assets_returned": checklist.assets_returned,
                        "access_revoked": checklist.access_revoked,
                        "docs_collected": checklist.docs_collected,
                    })
                    .to_string(),
                ),
                changed_fields: vec!["override_incomplete_checklist".to_string()],
                metadata: Some("archive_employee_override".to_string()),
            },
        );
        return Ok(());
    }
    Err(
        "Complete offboarding checklist (assets returned, access revoked, docs collected) before archiving"
            .to_string(),
    )
}

fn persist_checklist(
    ctx: &ReducerContext,
    checklist: HrOffboardingChecklist,
) -> Result<HrOffboardingChecklist, String> {
    let id = checklist.id;
    let status = if checklist_is_complete(&checklist) {
        "complete".to_string()
    } else {
        "in_progress".to_string()
    };
    ctx.db.hr_offboarding_checklist().id().update(HrOffboardingChecklist {
        status,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..checklist
    });
    ctx.db
        .hr_offboarding_checklist()
        .id()
        .find(&id)
        .ok_or_else(|| "Offboarding checklist missing after update".to_string())
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn start_offboarding(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;
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
    if let Some(existing) = find_offboarding_checklist(ctx, employee_id) {
        if existing.status != "complete" || !checklist_is_complete(&existing) {
            return Ok(());
        }
    }

    let row = ctx.db.hr_offboarding_checklist().insert(HrOffboardingChecklist {
        id: 0,
        organization_id,
        company_id,
        employee_id,
        status: "in_progress".to_string(),
        assets_returned: false,
        access_revoked: false,
        docs_collected: false,
        assets_notes: None,
        access_notes: None,
        docs_notes: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_offboarding_checklist",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_id": employee_id,
                    "status": "in_progress",
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn complete_offboarding_item(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    params: CompleteOffboardingItemParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;
    let mut checklist = find_offboarding_checklist(ctx, employee_id).ok_or(
        "Offboarding checklist not found — call start_offboarding first".to_string(),
    )?;
    if checklist.organization_id != organization_id {
        return Err("Offboarding checklist belongs to a different organization".to_string());
    }
    if checklist.company_id != company_id {
        return Err("Offboarding checklist does not belong to this company".to_string());
    }

    let item = params.item.trim();
    let changed_field = match item {
        "assets_returned" => {
            checklist.assets_returned = true;
            checklist.assets_notes = params.notes.or(checklist.assets_notes);
            "assets_returned"
        }
        "access_revoked" => {
            checklist.access_revoked = true;
            checklist.access_notes = params.notes.or(checklist.access_notes);
            "access_revoked"
        }
        "docs_collected" => {
            checklist.docs_collected = true;
            checklist.docs_notes = params.notes.or(checklist.docs_notes);
            "docs_collected"
        }
        _ => {
            return Err(
                "item must be assets_returned, access_revoked, or docs_collected".to_string(),
            );
        }
    };

    checklist.write_uid = ctx.sender();
    checklist.write_date = ctx.timestamp;
    let checklist = persist_checklist(ctx, checklist)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_offboarding_checklist",
            record_id: checklist.id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "item": item,
                    "status": checklist.status,
                })
                .to_string(),
            ),
            changed_fields: vec![changed_field.to_string(), "status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
