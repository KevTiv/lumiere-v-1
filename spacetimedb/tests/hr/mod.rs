//! HR domain test suite — invoke via `run_all_hr_tests` reducer.
pub mod department_relations_test;
pub mod job_relationships_test;
pub mod wave_a_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_hr_wave_a_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_a_test::test_company_isolation_on_leave_and_payslip(ctx)
        .map_err(|e| format!("company_isolation: {e}"))?;
    wave_a_test::test_leave_approve_consumes_balance(ctx)
        .map_err(|e| format!("leave_balance: {e}"))?;
    wave_a_test::test_leave_must_be_submitted_before_approve(ctx)
        .map_err(|e| format!("leave_submit_gate: {e}"))?;
    wave_a_test::test_leave_rejects_foreign_leave_type(ctx)
        .map_err(|e| format!("leave_foreign_type: {e}"))?;
    wave_a_test::test_leave_rejects_cross_company_leave_type(ctx)
        .map_err(|e| format!("leave_cross_company_type: {e}"))?;
    wave_a_test::test_payslip_done_requires_artifact(ctx)
        .map_err(|e| format!("payslip_artifact: {e}"))?;
    wave_a_test::test_offboarding_gates_archive(ctx)
        .map_err(|e| format!("offboarding_gate: {e}"))?;
    wave_a_test::test_offboarding_override_audit(ctx)
        .map_err(|e| format!("offboarding_override: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_hr_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_hr_wave_a_test(ctx)?;
    department_relations_test::test_department_create_relationships(ctx)
        .map_err(|e| format!("department_create_relationships: {e}"))?;
    department_relations_test::test_department_update_relationships(ctx)
        .map_err(|e| format!("department_update_relationships: {e}"))?;
    job_relationships_test::test_employee_job_relationships(ctx)
        .map_err(|e| format!("employee_job_relationships: {e}"))?;
    log::info!("✅ run_all_hr_tests complete");
    Ok(())
}
