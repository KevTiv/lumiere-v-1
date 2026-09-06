/// HR PII purpose scopes, field allowlists, and read-access audit.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Purpose identifiers (align with permission actions where present) ─────────

pub const PURPOSE_HR_ADMIN: &str = "hr_admin";

// HR_EMPLOYEE_SENSITIVE, HR_EMPLOYEE_PIN, HR_CONTRACT_COMP, and HR_PAYSLIP_COMP
// are intentionally duplicated in crates/stdb-auth/src/field_policy.rs. The two
// build universes (root service crates and standalone spacetimedb/) cannot share
// a crate; both copies have live consumers. See architecture rule #10 and
// docs/plan/code-ownership-deduplication-refactor-plan.md D35.

pub const HR_EMPLOYEE_SENSITIVE: &[&str] = &[
    "gender",
    "birthday",
    "marital",
    "emergency_contact",
    "emergency_phone",
    "barcode",
];

pub const HR_EMPLOYEE_PIN: &str = "pin";

pub const HR_CONTRACT_COMP: &[&str] = &["wage"];

pub const HR_PAYSLIP_COMP: &[&str] = &["basic_wage", "gross_wage", "net_wage"];

/// Employee document purposes that require `hr_employee:view_pii`.
pub const HR_DOC_PURPOSES_PII: &[&str] = &["tax_id", "identity"];

pub fn document_purpose_requires_pii(purpose: &str) -> bool {
    let p = purpose.trim().to_lowercase();
    HR_DOC_PURPOSES_PII.contains(&p.as_str())
}

// ── Tables ────────────────────────────────────────────────────────────────────

/// Append-only log of sensitive HR/comp field reads (HTTP query / BFF path).
#[spacetimedb::table(
    accessor = hr_pii_access_log,
    public,
    index(accessor = pii_log_by_org, btree(columns = [organization_id])),
    index(accessor = pii_log_by_actor, btree(columns = [actor_identity]))
)]
pub struct HrPiiAccessLog {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub actor_identity: Identity,
    pub purpose: String,
    pub resource_key: String,
    pub table_name: String,
    /// Primary record id when single-row; `0` for bulk reads.
    pub record_id: u64,
    /// JSON array of column names returned to the caller.
    pub fields_accessed: String,
    pub row_count: u32,
    pub accessed_at: Timestamp,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct LogHrPiiReadParams {
    pub company_id: Option<u64>,
    pub purpose: String,
    pub resource_key: String,
    pub table_name: String,
    pub record_id: u64,
    pub fields_accessed: Vec<String>,
    pub row_count: u32,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// JSON snapshot for employee mutator audits — never includes plaintext `pin`.
pub fn employee_audit_json(emp: &super::employees::HrEmployee) -> String {
    serde_json::json!({
        "name": emp.name,
        "employee_number": emp.employee_number,
        "job_title": emp.job_title,
        "job_id": emp.job_id,
        "department_id": emp.department_id,
        "parent_id": emp.parent_id,
        "coach_id": emp.coach_id,
        "work_email": emp.work_email,
        "work_phone": emp.work_phone,
        "mobile_phone": emp.mobile_phone,
        "work_location": emp.work_location,
        "work_contact_partner_id": emp.work_contact_partner_id,
        "employment_type": format!("{:?}", emp.employment_type),
        "gender": emp.gender,
        "birthday": emp.birthday.map(|t| t.to_duration_since_unix_epoch().unwrap_or_default().as_micros()),
        "marital": emp.marital,
        "emergency_contact": emp.emergency_contact,
        "emergency_phone": emp.emergency_phone,
        "barcode": emp.barcode,
        "pin_set": emp.pin.as_ref().map(|p| !p.is_empty()).unwrap_or(false),
        "is_active": emp.is_active,
        "company_id": emp.company_id,
    })
    .to_string()
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Record a sensitive HR/comp read (invoked from BFF after HTTP SQL queries).
#[reducer]
pub fn log_hr_pii_read(
    ctx: &ReducerContext,
    organization_id: u64,
    params: LogHrPiiReadParams,
) -> Result<(), String> {
    if params.resource_key.is_empty() || params.table_name.is_empty() {
        return Err("resource_key and table_name are required".to_string());
    }
    if params.fields_accessed.is_empty() {
        return Err("fields_accessed cannot be empty".to_string());
    }
    if params.fields_accessed.iter().any(|f| f == HR_EMPLOYEE_PIN) {
        check_permission(ctx, organization_id, "hr_employee", "view_pii")?;
    }
    if HR_CONTRACT_COMP
        .iter()
        .chain(HR_PAYSLIP_COMP.iter())
        .any(|c| params.fields_accessed.iter().any(|f| f == *c))
    {
        let resource = if params.table_name == "hr_contract" {
            "hr_contract"
        } else {
            "hr_payroll"
        };
        check_permission(ctx, organization_id, resource, "view_comp")?;
    }

    let fields_json = serde_json::to_string(&params.fields_accessed)
        .map_err(|e| format!("fields_accessed serialize failed: {e}"))?;
    let purpose = params.purpose.clone();
    let resource_key = params.resource_key.clone();
    let audit_fields_json = fields_json.clone();
    let audit_table: &'static str = match params.table_name.as_str() {
        "hr_employee" => "hr_employee",
        "hr_contract" => "hr_contract",
        "hr_payslip" => "hr_payslip",
        _ => "hr_employee",
    };
    let changed_fields = params.fields_accessed.clone();

    ctx.db.hr_pii_access_log().insert(HrPiiAccessLog {
        id: 0,
        organization_id,
        company_id: params.company_id,
        actor_identity: ctx.sender(),
        purpose: params.purpose,
        resource_key: params.resource_key,
        table_name: params.table_name,
        record_id: params.record_id,
        fields_accessed: fields_json,
        row_count: params.row_count,
        accessed_at: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: audit_table,
            record_id: params.record_id,
            action: "READ",
            old_values: None,
            new_values: Some(format!(
                "{{\"purpose\":\"{purpose}\",\"resource\":\"{resource_key}\",\"fields\":{audit_fields_json},\"row_count\":{}}}",
                params.row_count
            )),
            changed_fields,
            metadata: Some(format!("hr_pii:{purpose}")),
        },
    );

    Ok(())
}
