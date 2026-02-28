pub mod audit_tests;
/// Core Module Test Suite
///
/// Test reducers for Phase 1 Foundation & Infrastructure features.
/// These reducers verify the functionality of all core modules.
pub mod organization_tests;
pub mod permissions_tests;
pub mod privacy_tests;
pub mod queue_tests;
pub mod reference_tests;
pub mod users_tests;

use crate::core::users::user_profile;
use spacetimedb::ReducerContext;

/// Test initialization reducer - creates test data for all modules
#[spacetimedb::reducer]
pub fn run_all_core_tests(ctx: &ReducerContext) -> Result<(), String> {
    // Elevate to superuser so all permission checks pass during tests
    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("Test caller has no UserProfile — connect with a client first")?;

    let was_superuser = profile.is_superuser;
    ctx.db
        .user_profile()
        .identity()
        .update(crate::core::users::UserProfile {
            is_superuser: true,
            ..profile
        });

    // Run organization tests
    match organization_tests::test_organization_lifecycle(ctx) {
        Ok(_) => log::info!("✓ Organization lifecycle tests passed"),
        Err(e) => log::error!("✗ Organization tests failed: {}", e),
    }

    // Run user management tests
    match users_tests::test_user_management(ctx) {
        Ok(_) => log::info!("✓ User management tests passed"),
        Err(e) => log::error!("✗ User management tests failed: {}", e),
    }

    // Run permission tests
    match permissions_tests::test_permission_system(ctx) {
        Ok(_) => log::info!("✓ Permission system tests passed"),
        Err(e) => log::error!("✗ Permission tests failed: {}", e),
    }

    // Run reference data tests
    match reference_tests::test_reference_data(ctx) {
        Ok(_) => log::info!("✓ Reference data tests passed"),
        Err(e) => log::error!("✗ Reference data tests failed: {}", e),
    }

    // Run audit tests
    match audit_tests::test_audit_logging(ctx) {
        Ok(_) => log::info!("✓ Audit logging tests passed"),
        Err(e) => log::error!("✗ Audit tests failed: {}", e),
    }

    // Run queue tests
    match queue_tests::test_queue_system(ctx) {
        Ok(_) => log::info!("✓ Queue system tests passed"),
        Err(e) => log::error!("✗ Queue tests failed: {}", e),
    }

    // Run privacy tests
    match privacy_tests::test_privacy_system(ctx) {
        Ok(_) => log::info!("✓ Privacy system tests passed"),
        Err(e) => log::error!("✗ Privacy tests failed: {}", e),
    }

    // Restore original superuser flag
    if let Some(p) = ctx.db.user_profile().identity().find(ctx.sender()) {
        ctx.db
            .user_profile()
            .identity()
            .update(crate::core::users::UserProfile {
                is_superuser: was_superuser,
                ..p
            });
    }

    log::info!("✅ run_all_core_tests complete");
    Ok(())
}
