/// HR CSV Imports — HrResource, HrDepartment, HrJobPosition, HrEmployee,
///                  HrContract, HrLeaveType, HrLeave,
///                  HrPayrollStructure, HrSalaryRule, HrPayslip
use spacetimedb::{ReducerContext, Table};

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;
use crate::hr::contracts::{hr_contract, HrContract};
use crate::hr::employees::{
    hr_department, hr_employee, hr_job_position, hr_resource, HrDepartment, HrEmployee,
    HrJobPosition, HrResource,
};
use crate::hr::leaves::{hr_leave, hr_leave_type, HrLeave, HrLeaveType};
use crate::hr::payroll::{
    hr_payroll_structure, hr_payslip, hr_salary_rule, HrPayrollStructure, HrPayslip, HrSalaryRule,
};
use crate::types::{ContractState, EmploymentType, HrLeaveState, PayslipState};

// ── HrResource ────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_hr_resource_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_resource", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "hr_resource", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let resource_type = {
            let t = col(&headers, row, "resource_type");
            if t == "material" {
                "material".to_string()
            } else {
                "user".to_string()
            }
        };

        ctx.db.hr_resource().insert(HrResource {
            id: 0,
            organization_id,
            name,
            resource_type,
            user_id: None,
            time_efficiency: {
                let e = parse_f64(col(&headers, row, "time_efficiency"));
                if e == 0.0 {
                    100.0
                } else {
                    e
                }
            },
            is_active: parse_bool(col(&headers, row, "is_active")),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import hr_resource: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── HrDepartment ──────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_hr_department_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_department", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "hr_department",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let company_id = parse_u64(col(&headers, row, "company_id"));

        ctx.db.hr_department().insert(HrDepartment {
            id: 0,
            organization_id,
            company_id,
            name,
            complete_name: opt_str(col(&headers, row, "complete_name")),
            parent_id: opt_u64(col(&headers, row, "parent_id")),
            manager_id: opt_u64(col(&headers, row, "manager_id")),
            note: opt_str(col(&headers, row, "note")),
            is_active: parse_bool(col(&headers, row, "is_active")),
            color: opt_u64(col(&headers, row, "color")).map(|v| v as u32),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import hr_department: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── HrJobPosition ─────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_hr_job_position_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_job_position", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "hr_job_position",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let company_id = parse_u64(col(&headers, row, "company_id"));
        let state = {
            let s = col(&headers, row, "state");
            if s == "open" {
                "open".to_string()
            } else {
                "recruit".to_string()
            }
        };

        ctx.db.hr_job_position().insert(HrJobPosition {
            id: 0,
            organization_id,
            company_id,
            name,
            department_id: opt_u64(col(&headers, row, "department_id")),
            expected_employees: parse_u32(col(&headers, row, "expected_employees")),
            no_of_employee: parse_u32(col(&headers, row, "no_of_employee")),
            description: opt_str(col(&headers, row, "description")),
            requirements: opt_str(col(&headers, row, "requirements")),
            state,
            is_active: parse_bool(col(&headers, row, "is_active")),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import hr_job_position: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── HrEmployee ────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_hr_employee_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "hr_employee", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let company_id = parse_u64(col(&headers, row, "company_id"));
        let employment_type = match col(&headers, row, "employment_type") {
            "part_time" | "parttime" => EmploymentType::PartTime,
            "contract" => EmploymentType::Contract,
            "intern" => EmploymentType::Intern,
            _ => EmploymentType::FullTime,
        };

        ctx.db.hr_employee().insert(HrEmployee {
            id: 0,
            organization_id,
            company_id,
            user_id: None,
            resource_id: opt_u64(col(&headers, row, "resource_id")),
            name,
            employee_number: opt_str(col(&headers, row, "employee_number")),
            job_title: opt_str(col(&headers, row, "job_title")),
            job_id: opt_u64(col(&headers, row, "job_id")),
            department_id: opt_u64(col(&headers, row, "department_id")),
            parent_id: opt_u64(col(&headers, row, "parent_id")),
            coach_id: opt_u64(col(&headers, row, "coach_id")),
            work_email: opt_str(col(&headers, row, "work_email")),
            work_phone: opt_str(col(&headers, row, "work_phone")),
            mobile_phone: opt_str(col(&headers, row, "mobile_phone")),
            work_location: opt_str(col(&headers, row, "work_location")),
            date_hired: opt_timestamp(col(&headers, row, "date_hired")),
            date_terminated: opt_timestamp(col(&headers, row, "date_terminated")),
            employment_type,
            gender: opt_str(col(&headers, row, "gender")),
            birthday: opt_timestamp(col(&headers, row, "birthday")),
            marital: opt_str(col(&headers, row, "marital")),
            emergency_contact: opt_str(col(&headers, row, "emergency_contact")),
            emergency_phone: opt_str(col(&headers, row, "emergency_phone")),
            barcode: opt_str(col(&headers, row, "barcode")),
            pin: opt_str(col(&headers, row, "pin")),
            image_url: opt_str(col(&headers, row, "image_url")),
            color: opt_u64(col(&headers, row, "color")).map(|v| v as u32),
            is_active: parse_bool(col(&headers, row, "is_active")),
            created_at: ctx.timestamp,
            deleted_at: None,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import hr_employee: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── HrContract ────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_hr_contract_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_contract", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "hr_contract", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let employee_id = parse_u64(col(&headers, row, "employee_id"));
        if employee_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("employee_id"),
                None,
                "employee_id is required",
            );
            errors += 1;
            continue;
        }

        let company_id = parse_u64(col(&headers, row, "company_id"));
        let state = match col(&headers, row, "state") {
            "open" => ContractState::Open,
            "expired" => ContractState::Expired,
            "cancelled" => ContractState::Cancelled,
            _ => ContractState::New,
        };

        ctx.db.hr_contract().insert(HrContract {
            id: 0,
            organization_id,
            company_id,
            name,
            employee_id,
            job_id: opt_u64(col(&headers, row, "job_id")),
            department_id: opt_u64(col(&headers, row, "department_id")),
            date_start: opt_timestamp(col(&headers, row, "date_start")).unwrap_or(ctx.timestamp),
            date_end: opt_timestamp(col(&headers, row, "date_end")),
            wage: parse_f64(col(&headers, row, "wage")),
            currency_id: parse_u64(col(&headers, row, "currency_id")),
            state,
            notes: opt_str(col(&headers, row, "notes")),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import hr_contract: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── HrLeaveType ───────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_hr_leave_type_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_leave_type", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "hr_leave_type",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let company_id = parse_u64(col(&headers, row, "company_id"));

        ctx.db.hr_leave_type().insert(HrLeaveType {
            id: 0,
            organization_id,
            company_id,
            name,
            code: opt_str(col(&headers, row, "code")),
            color: opt_u64(col(&headers, row, "color")).map(|v| v as u32),
            allocation_type: {
                let a = col(&headers, row, "allocation_type");
                if a.is_empty() {
                    "fixed".to_string()
                } else {
                    a.to_string()
                }
            },
            validity_start: opt_timestamp(col(&headers, row, "validity_start")),
            validity_stop: opt_timestamp(col(&headers, row, "validity_stop")),
            max_leaves: parse_f64(col(&headers, row, "max_leaves")),
            is_active: parse_bool(col(&headers, row, "is_active")),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import hr_leave_type: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── HrLeave ───────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_hr_leave_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_leave", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "hr_leave", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let employee_id = parse_u64(col(&headers, row, "employee_id"));

        if employee_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("employee_id"),
                None,
                "employee_id is required",
            );
            errors += 1;
            continue;
        }

        let leave_type_id = parse_u64(col(&headers, row, "leave_type_id"));
        if leave_type_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("leave_type_id"),
                None,
                "leave_type_id is required",
            );
            errors += 1;
            continue;
        }

        let company_id = parse_u64(col(&headers, row, "company_id"));
        let state = match col(&headers, row, "state") {
            "confirm" => HrLeaveState::Confirm,
            "refused" => HrLeaveState::Refused,
            "validated" => HrLeaveState::Validated,
            "validated1" | "validated_one" => HrLeaveState::ValidatedOne,
            _ => HrLeaveState::Draft,
        };

        ctx.db.hr_leave().insert(HrLeave {
            id: 0,
            organization_id,
            company_id,
            employee_id,
            leave_type_id,
            name: opt_str(col(&headers, row, "name")),
            state,
            date_from: opt_timestamp(col(&headers, row, "date_from")).unwrap_or(ctx.timestamp),
            date_to: opt_timestamp(col(&headers, row, "date_to")).unwrap_or(ctx.timestamp),
            number_of_days: parse_f64(col(&headers, row, "number_of_days")),
            notes: opt_str(col(&headers, row, "notes")),
            manager_id: opt_u64(col(&headers, row, "manager_id")),
            first_approver_id: None,
            second_approver_id: None,
            created_at: ctx.timestamp,
            deleted_at: None,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import hr_leave: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── HrPayrollStructure ────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_hr_payroll_structure_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "hr_payroll_structure",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let type_ = {
            let t = col(&headers, row, "type_");
            if t.is_empty() {
                "employee".to_string()
            } else {
                t.to_string()
            }
        };

        ctx.db.hr_payroll_structure().insert(HrPayrollStructure {
            id: 0,
            organization_id,
            name,
            type_,
            is_active: parse_bool(col(&headers, row, "is_active")),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import hr_payroll_structure: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── HrSalaryRule ──────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_hr_salary_rule_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "hr_salary_rule",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let code = col(&headers, row, "code").to_string();
        if code.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("code"), None, "code is required");
            errors += 1;
            continue;
        }

        let structure_id = parse_u64(col(&headers, row, "structure_id"));
        if structure_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("structure_id"),
                None,
                "structure_id is required",
            );
            errors += 1;
            continue;
        }

        let condition_type = {
            let c = col(&headers, row, "condition_type");
            if c.is_empty() {
                "none".to_string()
            } else {
                c.to_string()
            }
        };

        let amount_type = {
            let a = col(&headers, row, "amount_type");
            if a.is_empty() {
                "fix".to_string()
            } else {
                a.to_string()
            }
        };

        ctx.db.hr_salary_rule().insert(HrSalaryRule {
            id: 0,
            organization_id,
            name,
            code,
            structure_id,
            category: {
                let c = col(&headers, row, "category");
                if c.is_empty() {
                    "BASIC".to_string()
                } else {
                    c.to_string()
                }
            },
            condition_type,
            amount_type,
            amount_fix: parse_f64(col(&headers, row, "amount_fix")),
            amount_percentage: parse_f64(col(&headers, row, "amount_percentage")),
            sequence: parse_u32(col(&headers, row, "sequence")),
            is_active: parse_bool(col(&headers, row, "is_active")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import hr_salary_rule: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── HrPayslip ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_hr_payslip_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_payroll", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "hr_payslip", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let employee_id = parse_u64(col(&headers, row, "employee_id"));

        if employee_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("employee_id"),
                None,
                "employee_id is required",
            );
            errors += 1;
            continue;
        }

        let struct_id = parse_u64(col(&headers, row, "struct_id"));
        if struct_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("struct_id"),
                None,
                "struct_id is required",
            );
            errors += 1;
            continue;
        }

        let company_id = parse_u64(col(&headers, row, "company_id"));
        let name = {
            let n = col(&headers, row, "name").to_string();
            if n.is_empty() {
                format!("Payslip #{}", employee_id)
            } else {
                n
            }
        };
        let basic_wage = parse_f64(col(&headers, row, "basic_wage"));
        let state = match col(&headers, row, "state") {
            "verify" => PayslipState::Verify,
            "done" => PayslipState::Done,
            "cancelled" => PayslipState::Cancelled,
            _ => PayslipState::Draft,
        };

        ctx.db.hr_payslip().insert(HrPayslip {
            id: 0,
            organization_id,
            company_id,
            name,
            number: opt_str(col(&headers, row, "number")),
            employee_id,
            contract_id: opt_u64(col(&headers, row, "contract_id")),
            struct_id,
            date_from: opt_timestamp(col(&headers, row, "date_from")).unwrap_or(ctx.timestamp),
            date_to: opt_timestamp(col(&headers, row, "date_to")).unwrap_or(ctx.timestamp),
            basic_wage,
            gross_wage: {
                let g = parse_f64(col(&headers, row, "gross_wage"));
                if g == 0.0 {
                    basic_wage
                } else {
                    g
                }
            },
            net_wage: {
                let n = parse_f64(col(&headers, row, "net_wage"));
                if n == 0.0 {
                    basic_wage
                } else {
                    n
                }
            },
            state,
            notes: opt_str(col(&headers, row, "notes")),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import hr_payslip: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}
