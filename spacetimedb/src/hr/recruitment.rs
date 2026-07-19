//! Recruitment applicant stub — beyond job-position filter only.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_job_position;

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = hr_applicant,
    public,
    index(accessor = applicant_by_org, btree(columns = [organization_id])),
    index(accessor = applicant_by_company, btree(columns = [company_id])),
    index(accessor = applicant_by_job, btree(columns = [job_position_id]))
)]
pub struct HrApplicant {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub job_position_id: u64,
    pub name: String,
    pub email: Option<String>,
    /// applied | screening | interview | offer | hired | rejected
    pub stage: String,
    pub notes: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateHrApplicantParams {
    pub company_id: Option<u64>,
    pub job_position_id: u64,
    pub name: String,
    pub email: Option<String>,
    pub stage: String,
    pub notes: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateHrApplicantParams {
    pub stage: Option<String>,
    pub email: Option<String>,
    pub notes: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn normalize_stage(stage: &str) -> Result<String, String> {
    let s = stage.trim().to_lowercase();
    match s.as_str() {
        "applied" | "screening" | "interview" | "offer" | "hired" | "rejected" => Ok(s),
        _ => Err(
            "stage must be applied, screening, interview, offer, hired, or rejected".to_string(),
        ),
    }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_hr_applicant(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateHrApplicantParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_applicant", "create")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    let name = params.name.trim().to_string();
    if name.is_empty() {
        return Err("applicant name is required".to_string());
    }
    let stage = normalize_stage(&params.stage)?;
    let job = ctx
        .db
        .hr_job_position()
        .id()
        .find(&params.job_position_id)
        .ok_or("Job position not found")?;
    if job.organization_id != organization_id {
        return Err("Job position belongs to a different organization".to_string());
    }
    if job.company_id != company_id {
        return Err("Job position does not belong to this company".to_string());
    }

    let row = ctx.db.hr_applicant().insert(HrApplicant {
        id: 0,
        organization_id,
        company_id,
        job_position_id: params.job_position_id,
        name,
        email: params.email,
        stage,
        notes: params.notes,
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
            table_name: "hr_applicant",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "job_position_id": row.job_position_id,
                    "name": row.name,
                    "stage": row.stage,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "job_position_id".to_string(),
                "name".to_string(),
                "stage".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_hr_applicant(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    applicant_id: u64,
    params: UpdateHrApplicantParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_applicant", "update")?;
    let row = ctx
        .db
        .hr_applicant()
        .id()
        .find(&applicant_id)
        .ok_or("Applicant not found")?;
    if row.organization_id != organization_id {
        return Err("Applicant belongs to a different organization".to_string());
    }
    if row.company_id != company_id {
        return Err("Applicant does not belong to this company".to_string());
    }

    let stage = if let Some(s) = params.stage.as_ref() {
        Some(normalize_stage(s)?)
    } else {
        None
    };

    let mut changed = Vec::new();
    if stage.is_some() {
        changed.push("stage".to_string());
    }
    if params.email.is_some() {
        changed.push("email".to_string());
    }
    if params.notes.is_some() {
        changed.push("notes".to_string());
    }

    ctx.db.hr_applicant().id().update(HrApplicant {
        stage: stage.unwrap_or(row.stage.clone()),
        email: params.email.or(row.email.clone()),
        notes: params.notes.or(row.notes.clone()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..row
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_applicant",
            record_id: applicant_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: changed,
            metadata: None,
        },
    );
    Ok(())
}
