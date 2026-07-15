//! Platform module smoke tests — helpdesk, HR, manufacturing, documents, workflow, subscriptions.
mod country_pack_test;
mod platform_smoke;
mod tenant_isolation_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_all_platform_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_helpdesk_ticket_test(ctx)?;
    run_hr_leave_type_test(ctx)?;
    run_manufacturing_workcenter_test(ctx)?;
    run_documents_folder_test(ctx)?;
    run_workflow_definition_test(ctx)?;
    run_subscription_plan_test(ctx)?;
    run_tenant_isolation_tests(ctx)?;
    run_country_pack_test(ctx)?;
    log::info!("✅ run_all_platform_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_helpdesk_ticket_test(ctx: &ReducerContext) -> Result<(), String> {
    platform_smoke::test_helpdesk_ticket_create(ctx).map_err(|e| format!("helpdesk: {e}"))
}

#[spacetimedb::reducer]
pub fn run_hr_leave_type_test(ctx: &ReducerContext) -> Result<(), String> {
    platform_smoke::test_hr_leave_type_create(ctx).map_err(|e| format!("hr: {e}"))
}

#[spacetimedb::reducer]
pub fn run_manufacturing_workcenter_test(ctx: &ReducerContext) -> Result<(), String> {
    platform_smoke::test_manufacturing_workcenter_create(ctx)
        .map_err(|e| format!("manufacturing: {e}"))
}

#[spacetimedb::reducer]
pub fn run_documents_folder_test(ctx: &ReducerContext) -> Result<(), String> {
    platform_smoke::test_documents_folder_create(ctx).map_err(|e| format!("documents: {e}"))
}

#[spacetimedb::reducer]
pub fn run_workflow_definition_test(ctx: &ReducerContext) -> Result<(), String> {
    platform_smoke::test_workflow_definition_create(ctx).map_err(|e| format!("workflow: {e}"))
}

#[spacetimedb::reducer]
pub fn run_subscription_plan_test(ctx: &ReducerContext) -> Result<(), String> {
    platform_smoke::test_subscription_plan_create(ctx).map_err(|e| format!("subscriptions: {e}"))
}

#[spacetimedb::reducer]
pub fn run_tenant_isolation_tests(ctx: &ReducerContext) -> Result<(), String> {
    tenant_isolation_test::test_cross_tenant_company_scope_blocked(ctx)
        .map_err(|e| format!("cross_tenant_scope: {e}"))?;
    tenant_isolation_test::test_audit_log_append_only(ctx)
        .map_err(|e| format!("audit_append_only: {e}"))
}

#[spacetimedb::reducer]
pub fn run_country_pack_test(ctx: &ReducerContext) -> Result<(), String> {
    country_pack_test::test_country_pack_activation(ctx).map_err(|e| format!("country_pack: {e}"))
}
