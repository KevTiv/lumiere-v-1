/// HR Payroll — HrPayrollStructure, HrSalaryRule, HrPayslip
///
/// Payroll structures define how wages are computed;
/// payslips are generated per employee per pay period.
use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::PayslipState;

// ── Tables ────────────────────────────────────────────────────────────────────

/// HR Payroll Structure — A named set of salary rules (e.g. "Monthly Staff").
#[spacetimedb::table(
    accessor = hr_payroll_structure,
    public,
    index(accessor = payroll_structure_by_org, btree(columns = [organization_id]))
)]
pub struct HrPayrollStructure {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,  // e.g. "Monthly", "Hourly"
    pub type_: String, // "employee" | "worker"
    pub is_active: bool,
    pub created_at: Timestamp,
}

/// HR Salary Rule — One computation rule within a payroll structure.
#[spacetimedb::table(
    accessor = hr_salary_rule,
    public,
    index(accessor = salary_rule_by_structure, btree(columns = [structure_id])),
    index(accessor = salary_rule_by_org, btree(columns = [organization_id]))
)]
pub struct HrSalaryRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub code: String,           // e.g. "BASIC", "NET", "TAX"
    pub structure_id: u64,      // FK → HrPayrollStructure
    pub category: String,       // "BASIC" | "ALW" | "DED" | "NET"
    pub condition_type: String, // "none" | "range" | "python"
    pub amount_type: String,    // "fix" | "percentage" | "code"
    pub amount_fix: f64,
    pub amount_percentage: f64, // 0–100
    pub sequence: u32,
    pub is_active: bool,
}

/// HR Payslip — A computed payslip for one employee in one pay period.
#[spacetimedb::table(
    accessor = hr_payslip,
    public,
    index(accessor = payslip_by_employee, btree(columns = [employee_id])),
    index(accessor = payslip_by_state, btree(columns = [state])),
    index(accessor = payslip_by_org, btree(columns = [organization_id]))
)]
pub struct HrPayslip {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,             // "Payslip - Alice Smith - March 2026"
    pub number: Option<String>,   // "PAYSLIP-0001" (set on confirm)
    pub employee_id: u64,         // FK → HrEmployee
    pub contract_id: Option<u64>, // FK → HrContract
    pub struct_id: u64,           // FK → HrPayrollStructure
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub basic_wage: f64,
    pub gross_wage: f64,
    pub net_wage: f64,
    pub state: PayslipState,
    pub notes: Option<String>,
    pub created_at: Timestamp,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePayrollStructureParams {
    pub name: String,
    pub type_: String,
    pub is_active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSalaryRuleParams {
    pub name: String,
    pub code: String,
    pub structure_id: u64,
    pub category: String,
    pub condition_type: String,
    pub amount_type: String,
    pub amount_fix: f64,
    pub amount_percentage: f64,
    pub sequence: u32,
    pub is_active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePayslipParams {
    pub employee_id: u64,
    pub struct_id: u64,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub basic_wage: f64,
    pub contract_id: Option<u64>,
    pub notes: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ConfirmPayslipParams {
    pub gross_wage: f64,
    pub net_wage: f64,
}

// ── Reducers: Payroll Structure ───────────────────────────────────────────────

#[reducer]
pub fn create_payroll_structure(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePayrollStructureParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "create")?;
    if params.name.is_empty() {
        return Err("Payroll structure name cannot be empty".to_string());
    }
    let structure = ctx.db.hr_payroll_structure().insert(HrPayrollStructure {
        id: 0,
        organization_id,
        name: params.name,
        type_: params.type_,
        is_active: params.is_active,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "hr_payroll_structure",
            record_id: structure.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Salary Rules ────────────────────────────────────────────────────

#[reducer]
pub fn create_salary_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateSalaryRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "create")?;
    if params.name.is_empty() || params.code.is_empty() {
        return Err("Salary rule name and code cannot be empty".to_string());
    }
    // Verify structure belongs to org
    let structure = ctx
        .db
        .hr_payroll_structure()
        .id()
        .find(&params.structure_id)
        .ok_or("Payroll structure not found")?;
    if structure.organization_id != organization_id {
        return Err("Payroll structure belongs to a different organization".to_string());
    }
    let rule = ctx.db.hr_salary_rule().insert(HrSalaryRule {
        id: 0,
        organization_id,
        name: params.name,
        code: params.code,
        structure_id: params.structure_id,
        category: params.category,
        condition_type: params.condition_type,
        amount_type: params.amount_type,
        amount_fix: params.amount_fix,
        amount_percentage: params.amount_percentage,
        sequence: params.sequence,
        is_active: params.is_active,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "hr_salary_rule",
            record_id: rule.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Payslips ────────────────────────────────────────────────────────

#[reducer]
pub fn create_payslip(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePayslipParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "create")?;
    let payslip = ctx.db.hr_payslip().insert(HrPayslip {
        id: 0,
        organization_id,
        company_id,
        name: format!("Payslip #{}", params.employee_id),
        number: None,
        employee_id: params.employee_id,
        contract_id: params.contract_id,
        struct_id: params.struct_id,
        date_from: params.date_from,
        date_to: params.date_to,
        basic_wage: params.basic_wage,
        gross_wage: params.basic_wage,
        net_wage: params.basic_wage,
        state: PayslipState::Draft,
        notes: params.notes,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_payslip",
            record_id: payslip.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn confirm_payslip(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payslip_id: u64,
    params: ConfirmPayslipParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "confirm")?;
    let payslip = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or("Payslip not found")?;
    if payslip.organization_id != organization_id {
        return Err("Payslip belongs to a different organization".to_string());
    }
    if payslip.company_id != company_id {
        return Err("Payslip does not belong to this company".to_string());
    }
    if payslip.state != PayslipState::Draft {
        return Err("Only draft payslips can be confirmed".to_string());
    }
    ctx.db.hr_payslip().id().update(HrPayslip {
        gross_wage: params.gross_wage,
        net_wage: params.net_wage,
        state: PayslipState::Done,
        ..payslip
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_payslip",
            record_id: payslip_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![
                "gross_wage".to_string(),
                "net_wage".to_string(),
                "state".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn cancel_payslip(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payslip_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "cancel")?;
    let payslip = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or("Payslip not found")?;
    if payslip.organization_id != organization_id {
        return Err("Payslip belongs to a different organization".to_string());
    }
    if payslip.company_id != company_id {
        return Err("Payslip does not belong to this company".to_string());
    }
    if payslip.state == PayslipState::Cancelled {
        return Err("Payslip is already cancelled".to_string());
    }
    ctx.db.hr_payslip().id().update(HrPayslip {
        state: PayslipState::Cancelled,
        ..payslip
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_payslip",
            record_id: payslip_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
