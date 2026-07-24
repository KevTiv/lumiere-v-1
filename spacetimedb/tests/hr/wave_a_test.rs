//! HR Wave A — isolation, leave balance, payslip artifact, offboarding gate.
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::hr::employees::{
    archive_employee, create_employee, hr_employee, CreateEmployeeParams,
};
use crate::hr::leaves::{
    approve_leave, create_leave_request, create_leave_type, hr_leave, hr_leave_allocation,
    hr_leave_type, submit_leave, CreateLeaveRequestParams, CreateLeaveTypeParams,
};
use crate::hr::offboarding::{
    complete_offboarding_item, start_offboarding, ArchiveEmployeeParams,
    CompleteOffboardingItemParams,
};
use crate::hr::payroll::{
    confirm_payslip, create_payroll_export_intent, create_payroll_structure, create_payslip,
    hr_payroll_export_intent, hr_payroll_structure, hr_payslip, record_payroll_export_result,
    ConfirmPayslipParams, CreatePayrollExportIntentParams, CreatePayrollStructureParams,
    CreatePayslipParams, RecordPayrollExportResultParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{EmploymentType, HrLeaveState, PayslipState};

fn seed_employee(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_employee(
        ctx,
        fixture.organization_id,
        CreateEmployeeParams {
            company_id: Some(fixture.company_id),
            name: name.to_string(),
            job_id: None,
            department_id: None,
            employment_type: EmploymentType::FullTime,
            work_email: None,
            employee_number: None,
            job_title: None,
            parent_id: None,
            coach_id: None,
            work_phone: None,
            mobile_phone: None,
            work_location: None,
            work_contact_partner_id: None,
            date_hired: Some(ctx.timestamp),
            gender: None,
            birthday: None,
            marital: None,
            emergency_contact: None,
            emergency_phone: None,
            barcode: None,
            pin: None,
            image_url: None,
            color: None,
            is_active: true,
            metadata: None,
        },
    )?;
    ctx.db
        .hr_employee()
        .employee_by_company()
        .filter(&fixture.company_id)
        .find(|e| e.name == name)
        .map(|e| e.id)
        .ok_or_else(|| format!("employee {name} missing after create"))
}

fn seed_leave_type(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
    max_leaves: f64,
) -> Result<u64, String> {
    create_leave_type(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateLeaveTypeParams {
            name: name.to_string(),
            allocation_type: "fixed".to_string(),
            max_leaves,
            code: None,
            color: None,
            validity_start: None,
            validity_stop: None,
            is_active: true,
        },
    )?;
    ctx.db
        .hr_leave_type()
        .leave_type_by_org()
        .filter(&fixture.organization_id)
        .find(|lt| lt.name == name && lt.company_id == fixture.company_id)
        .map(|lt| lt.id)
        .ok_or_else(|| format!("leave type {name} missing"))
}

fn seed_payroll_structure(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let name = format!("Test Structure {}", fixture.company_id);
    create_payroll_structure(
        ctx,
        fixture.organization_id,
        CreatePayrollStructureParams {
            name: name.clone(),
            type_: "employee".to_string(),
            is_active: true,
        },
    )?;
    ctx.db
        .hr_payroll_structure()
        .payroll_structure_by_org()
        .filter(&fixture.organization_id)
        .find(|s| s.name == name)
        .map(|s| s.id)
        .ok_or_else(|| "payroll structure missing".to_string())
}

fn create_draft_leave(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    employee_id: u64,
    leave_type_id: u64,
    days: f64,
    tag: &str,
) -> Result<u64, String> {
    let date_from = ctx.timestamp;
    let date_to = ctx.timestamp + Duration::from_secs((days as u64).saturating_mul(86400));
    create_leave_request(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateLeaveRequestParams {
            employee_id,
            leave_type_id,
            date_from,
            date_to,
            number_of_days: days,
            notes: Some(tag.to_string()),
            name: Some(tag.to_string()),
            manager_id: None,
        },
    )?;
    ctx.db
        .hr_leave()
        .leave_by_org()
        .filter(&fixture.organization_id)
        .find(|l| {
            l.company_id == fixture.company_id
                && l.employee_id == employee_id
                && l.notes.as_deref() == Some(tag)
        })
        .map(|l| l.id)
        .ok_or_else(|| format!("leave {tag} missing"))
}

fn latest_payslip_for_employee(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    employee_id: u64,
) -> Result<u64, String> {
    ctx.db
        .hr_payslip()
        .payslip_by_employee()
        .filter(&employee_id)
        .filter(|p| p.organization_id == fixture.organization_id && p.company_id == fixture.company_id)
        .max_by_key(|p| p.id)
        .map(|p| p.id)
        .ok_or_else(|| "payslip missing".to_string())
}

pub fn test_company_isolation_on_leave_and_payslip(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let employee_a = seed_employee(ctx, &fixture_a, "Iso Leave Emp")?;
    let leave_type_a = seed_leave_type(ctx, &fixture_a, "Iso Leave Type", 10.0)?;
    let leave_id = create_draft_leave(ctx, &fixture_a, employee_a, leave_type_a, 2.0, "iso-leave")?;
    submit_leave(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        leave_id,
    )?;

    let cross_leave = approve_leave(
        ctx,
        fixture_b.organization_id,
        fixture_b.company_id,
        leave_id,
    );
    if cross_leave.is_ok() {
        return Err("company B must not approve company A leave".into());
    }

    let structure_a = seed_payroll_structure(ctx, &fixture_a)?;
    create_payslip(
        ctx,
        fixture_a.organization_id,
        CreatePayslipParams {
            company_id: Some(fixture_a.company_id),
            employee_id: employee_a,
            struct_id: structure_a,
            date_from: ctx.timestamp,
            date_to: ctx.timestamp + Duration::from_secs(86400 * 30),
            basic_wage: 5000.0,
            contract_id: None,
            notes: None,
        },
    )?;
    let payslip_id = latest_payslip_for_employee(ctx, &fixture_a, employee_a)?;

    let cross_payslip = confirm_payslip(
        ctx,
        fixture_b.organization_id,
        payslip_id,
        ConfirmPayslipParams {
            company_id: Some(fixture_b.company_id),
            gross_wage: 5000.0,
            net_wage: 4000.0,
            calculation_source: "manual".to_string(),
        },
    );
    if cross_payslip.is_ok() {
        return Err("company B must not confirm company A payslip".into());
    }
    Ok(())
}

pub fn test_leave_approve_consumes_balance(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "Balance Emp")?;
    let leave_type_id = seed_leave_type(ctx, &fixture, "Balance Type", 5.0)?;
    let leave_a = create_draft_leave(ctx, &fixture, employee_id, leave_type_id, 3.0, "bal-a")?;
    submit_leave(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        leave_a,
    )?;

    // Reservation happens at submit (before approval).
    let alloc_after_submit = ctx
        .db
        .hr_leave_allocation()
        .leave_allocation_by_employee()
        .filter(&employee_id)
        .find(|a| a.leave_type_id == leave_type_id)
        .ok_or_else(|| "allocation missing after submit".to_string())?;
    if (alloc_after_submit.used_days - 3.0).abs() > f64::EPSILON {
        return Err(format!(
            "expected 3 reserved days after submit, got {}",
            alloc_after_submit.used_days
        ));
    }

    approve_leave(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        leave_a,
    )?;

    let alloc = ctx
        .db
        .hr_leave_allocation()
        .leave_allocation_by_employee()
        .filter(&employee_id)
        .find(|a| a.leave_type_id == leave_type_id)
        .ok_or_else(|| "allocation missing".to_string())?;
    if (alloc.used_days - 3.0).abs() > f64::EPSILON {
        return Err(format!("expected 3 used days after approve, got {}", alloc.used_days));
    }

    let leave_b = create_draft_leave(ctx, &fixture, employee_id, leave_type_id, 3.0, "bal-b")?;
    let over = submit_leave(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        leave_b,
    );
    if over.is_ok() {
        return Err("over-balance submit should fail".into());
    }
    Ok(())
}

pub fn test_payslip_done_requires_artifact(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "Payslip Artifact Emp")?;
    let structure_id = seed_payroll_structure(ctx, &fixture)?;
    create_payslip(
        ctx,
        fixture.organization_id,
        CreatePayslipParams {
            company_id: Some(fixture.company_id),
            employee_id,
            struct_id: structure_id,
            date_from: ctx.timestamp,
            date_to: ctx.timestamp + Duration::from_secs(86400 * 30),
            basic_wage: 3000.0,
            contract_id: None,
            notes: None,
        },
    )?;
    let payslip_id = latest_payslip_for_employee(ctx, &fixture, employee_id)?;
    confirm_payslip(
        ctx,
        fixture.organization_id,
        payslip_id,
        ConfirmPayslipParams {
            company_id: Some(fixture.company_id),
            gross_wage: 3000.0,
            net_wage: 2500.0,
            calculation_source: "manual".to_string(),
        },
    )?;
    let payslip = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or_else(|| "payslip missing".to_string())?;
    if payslip.state == PayslipState::Done {
        return Err("Verify payslip must not be Done without artifact".into());
    }

    create_payroll_export_intent(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        payslip_id,
        CreatePayrollExportIntentParams {
            pack_key: Some("au".to_string()),
            idempotency_key: format!("test-intent-{payslip_id}"),
            payload: r#"{"employee":"test"}"#.to_string(),
            metadata: None,
        },
    )?;
    let intent_id = ctx
        .db
        .hr_payroll_export_intent()
        .payroll_export_intent_by_payslip()
        .filter(&payslip_id)
        .map(|i| i.id)
        .max()
        .ok_or_else(|| "export intent missing".to_string())?;

    let bad_applied = record_payroll_export_result(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        intent_id,
        RecordPayrollExportResultParams {
            status: "applied".to_string(),
            external_ref: None,
            payload_hash: None,
            last_error: None,
            metadata: None,
        },
    );
    if bad_applied.is_ok() {
        return Err("applied without artifact ref should fail".into());
    }

    record_payroll_export_result(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        intent_id,
        RecordPayrollExportResultParams {
            status: "applied".to_string(),
            external_ref: Some("STP-REF-001".to_string()),
            payload_hash: Some("sha256:test".to_string()),
            last_error: None,
            metadata: None,
        },
    )?;
    let done = ctx
        .db
        .hr_payslip()
        .id()
        .find(&payslip_id)
        .ok_or_else(|| "payslip missing".to_string())?;
    if done.state != PayslipState::Done {
        return Err(format!("expected Done, got {:?}", done.state));
    }
    Ok(())
}

pub fn test_offboarding_gates_archive(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "Offboard Emp")?;

    let blocked = archive_employee(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        employee_id,
        ArchiveEmployeeParams {
            termination_date: None,
            override_incomplete_checklist: false,
            override_reason: None,
        },
    );
    if blocked.is_ok() {
        return Err("archive without checklist should fail".into());
    }

    start_offboarding(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        employee_id,
    )?;
    for item in ["assets_returned", "access_revoked", "docs_collected"] {
        complete_offboarding_item(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            employee_id,
            CompleteOffboardingItemParams {
                item: item.to_string(),
                notes: None,
            },
        )?;
    }

    archive_employee(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        employee_id,
        ArchiveEmployeeParams {
            termination_date: None,
            override_incomplete_checklist: false,
            override_reason: None,
        },
    )?;
    let archived = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .ok_or_else(|| "employee missing".to_string())?;
    if archived.is_active {
        return Err("employee should be inactive after archive".into());
    }
    Ok(())
}

pub fn test_offboarding_override_audit(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "Override Emp")?;
    start_offboarding(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        employee_id,
    )?;
    complete_offboarding_item(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        employee_id,
        CompleteOffboardingItemParams {
            item: "assets_returned".to_string(),
            notes: None,
        },
    )?;

    archive_employee(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        employee_id,
        ArchiveEmployeeParams {
            termination_date: None,
            override_incomplete_checklist: true,
            override_reason: Some("HR director waiver".to_string()),
        },
    )?;
    Ok(())
}

pub fn test_leave_must_be_submitted_before_approve(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "Draft Leave Emp")?;
    let leave_type_id = seed_leave_type(ctx, &fixture, "Draft Type", 5.0)?;
    let leave_id = create_draft_leave(ctx, &fixture, employee_id, leave_type_id, 1.0, "draft-only")?;
    let leave = ctx
        .db
        .hr_leave()
        .id()
        .find(&leave_id)
        .ok_or_else(|| "leave missing".to_string())?;
    if leave.state != HrLeaveState::Draft {
        return Err("leave should start in Draft".into());
    }
    let early = approve_leave(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        leave_id,
    );
    if early.is_ok() {
        return Err("draft leave approve should fail".into());
    }
    Ok(())
}
