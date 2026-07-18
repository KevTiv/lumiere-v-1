//! HR competency skills matrix — separate from AI `ai_skill` registry.
//!
//! # Tables
//! | Table | Description |
//! |-------|-------------|
//! | **HrSkill** | Named competency (e.g. Rust, Project Mgmt) |
//! | **HrEmployeeSkill** | Employee ↔ skill ↔ proficiency level |

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_employee;

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = hr_skill,
    public,
    index(accessor = skill_by_org, btree(columns = [organization_id])),
    index(accessor = skill_by_company, btree(columns = [company_id]))
)]
pub struct HrSkill {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub code: Option<String>,
    pub category: Option<String>,
    pub description: Option<String>,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = hr_employee_skill,
    public,
    index(accessor = emp_skill_by_org, btree(columns = [organization_id])),
    index(accessor = emp_skill_by_company, btree(columns = [company_id])),
    index(accessor = emp_skill_by_employee, btree(columns = [employee_id])),
    index(accessor = emp_skill_by_skill, btree(columns = [skill_id]))
)]
pub struct HrEmployeeSkill {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    pub skill_id: u64,
    /// 1–5 proficiency (soft match uses this).
    pub level: u32,
    pub notes: Option<String>,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateHrSkillParams {
    pub name: String,
    pub code: Option<String>,
    pub category: Option<String>,
    pub description: Option<String>,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateHrSkillParams {
    pub name: Option<String>,
    pub code: Option<Option<String>>,
    pub category: Option<Option<String>>,
    pub description: Option<Option<String>>,
    pub active: Option<bool>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateHrEmployeeSkillParams {
    pub employee_id: u64,
    pub skill_id: u64,
    pub level: u32,
    pub notes: Option<String>,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateHrEmployeeSkillParams {
    pub level: Option<u32>,
    pub notes: Option<Option<String>>,
    pub active: Option<bool>,
    pub metadata: Option<Option<String>>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_hr_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateHrSkillParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_skill", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;
    if params.name.trim().is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }

    let row = ctx.db.hr_skill().insert(HrSkill {
        id: 0,
        organization_id,
        company_id,
        name: params.name,
        code: params.code,
        category: params.category,
        description: params.description,
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
            table_name: "hr_skill",
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
pub fn update_hr_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    skill_id: u64,
    params: UpdateHrSkillParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_skill", "write")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;
    let existing = ctx
        .db
        .hr_skill()
        .id()
        .find(&skill_id)
        .ok_or("HR skill not found")?;
    if existing.organization_id != organization_id {
        return Err("Skill does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let updated = HrSkill {
        name: params.name.unwrap_or(existing.name.clone()),
        code: match params.code {
            Some(v) => v,
            None => existing.code.clone(),
        },
        category: match params.category {
            Some(v) => v,
            None => existing.category.clone(),
        },
        description: match params.description {
            Some(v) => v,
            None => existing.description.clone(),
        },
        active: params.active.unwrap_or(existing.active),
        metadata: match params.metadata {
            Some(v) => v,
            None => existing.metadata.clone(),
        },
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..existing
    };
    ctx.db.hr_skill().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_skill",
            record_id: skill_id,
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
pub fn create_hr_employee_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateHrEmployeeSkillParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee_skill", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    if !(1..=5).contains(&params.level) {
        return Err("skill level must be between 1 and 5".to_string());
    }

    let emp = ctx
        .db
        .hr_employee()
        .id()
        .find(&params.employee_id)
        .ok_or("Employee not found")?;
    if emp.organization_id != organization_id || emp.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }

    let skill = ctx
        .db
        .hr_skill()
        .id()
        .find(&params.skill_id)
        .ok_or("HR skill not found")?;
    if skill.organization_id != organization_id || skill.company_id != company_id {
        return Err("Skill does not belong to this company".to_string());
    }

    let dup = ctx
        .db
        .hr_employee_skill()
        .emp_skill_by_employee()
        .filter(&params.employee_id)
        .any(|r| r.skill_id == params.skill_id && r.active);
    if dup {
        return Err("Employee already has this skill".to_string());
    }

    let row = ctx.db.hr_employee_skill().insert(HrEmployeeSkill {
        id: 0,
        organization_id,
        company_id,
        employee_id: params.employee_id,
        skill_id: params.skill_id,
        level: params.level,
        notes: params.notes,
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
            table_name: "hr_employee_skill",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_id": row.employee_id,
                    "skill_id": row.skill_id,
                    "level": row.level,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "employee_id".to_string(),
                "skill_id".to_string(),
                "level".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_hr_employee_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_skill_id: u64,
    params: UpdateHrEmployeeSkillParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee_skill", "write")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let existing = ctx
        .db
        .hr_employee_skill()
        .id()
        .find(&employee_skill_id)
        .ok_or("Employee skill not found")?;
    if existing.organization_id != organization_id {
        return Err("Employee skill does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if let Some(level) = params.level {
        if !(1..=5).contains(&level) {
            return Err("skill level must be between 1 and 5".to_string());
        }
    }

    let updated = HrEmployeeSkill {
        level: params.level.unwrap_or(existing.level),
        notes: match params.notes {
            Some(v) => v,
            None => existing.notes.clone(),
        },
        active: params.active.unwrap_or(existing.active),
        metadata: match params.metadata {
            Some(v) => v,
            None => existing.metadata.clone(),
        },
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..existing
    };
    ctx.db.hr_employee_skill().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_employee_skill",
            record_id: employee_skill_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "level": updated.level }).to_string()),
            changed_fields: vec!["level".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn delete_hr_employee_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_skill_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee_skill", "delete")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let existing = ctx
        .db
        .hr_employee_skill()
        .id()
        .find(&employee_skill_id)
        .ok_or("Employee skill not found")?;
    if existing.organization_id != organization_id {
        return Err("Employee skill does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    ctx.db.hr_employee_skill().id().delete(&employee_skill_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_employee_skill",
            record_id: employee_skill_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "employee_id": existing.employee_id,
                    "skill_id": existing.skill_id,
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
