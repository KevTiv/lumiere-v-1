/// Audit Module Tests
///
/// Test reducers for AuditLog and AuditRule tables.
use spacetimedb::{ReducerContext, Table};

use crate::core::audit::{
    audit_log, audit_rule,
    log_audit_event, create_audit_rule, update_audit_rule,
};
use crate::core::organization::{organization, create_organization};

/// Test audit logging lifecycle
#[spacetimedb::reducer]
pub fn test_audit_logging(ctx: &ReducerContext) -> Result<(), String> {
    // Test 1: Create test organization
    log::info!("TEST: Creating test organization...");
    create_organization(
        ctx,
        "Audit Test Org".to_string(),
        "AUDITORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "AUDITORG")
        .ok_or("Test organization not found")?;

    let org_id = org.id;
    log::info!("✓ Test organization created");

    // Test 2: Create audit rules
    log::info!("TEST: Creating audit rules...");
    create_audit_rule(
        ctx,
        org_id,
        "user_profile".to_string(),
        false,
        true,
        true,
        true,
    )?;

    create_audit_rule(
        ctx,
        org_id,
        "organization".to_string(),
        true,
        true,
        true,
        false,
    )?;

    let rules: Vec<_> = ctx.db.audit_rule()
        .audit_rule_by_org()
        .filter(&org_id)
        .collect();

    if rules.len() != 2 {
        return Err(format!("Expected 2 audit rules, found {}", rules.len()));
    }

    let user_rule = rules.iter()
        .find(|r| r.table_name == "user_profile")
        .ok_or("User profile audit rule not found")?;

    if !user_rule.log_writes {
        return Err("User profile rule should log writes".to_string());
    }

    if user_rule.log_reads {
        return Err("User profile rule should not log reads".to_string());
    }

    if !user_rule.is_active {
        return Err("Audit rule should be active".to_string());
    }

    log::info!("✓ Audit rules created");

    // Test 3: Log audit events
    log::info!("TEST: Logging audit events...");
    log_audit_event(
        ctx,
        org_id,
        None,
        "user_profile".to_string(),
        1,
        "CREATE".to_string(),
        None,
        Some(r#"{"name": "John", "email": "john@example.com"}"#.to_string()),
        vec!["name".to_string(), "email".to_string()],
        None,
        Some("192.168.1.1".to_string()),
        Some("Mozilla/5.0".to_string()),
    )?;

    log_audit_event(
        ctx,
        org_id,
        None,
        "user_profile".to_string(),
        1,
        "UPDATE".to_string(),
        Some(r#"{"name": "John"}"#.to_string()),
        Some(r#"{"name": "John Doe"}"#.to_string()),
        vec!["name".to_string()],
        Some(1),
        Some("192.168.1.1".to_string()),
        Some("Mozilla/5.0".to_string()),
    )?;

    log_audit_event(
        ctx,
        org_id,
        Some(1),
        "company".to_string(),
        1,
        "DELETE".to_string(),
        Some(r#"{"name": "Old Company"}"#.to_string()),
        None,
        vec!["name".to_string()],
        Some(1),
        Some("192.168.1.2".to_string()),
        Some("Mozilla/5.0".to_string()),
    )?;

    let logs: Vec<_> = ctx.db.audit_log().iter().collect();

    if logs.len() != 3 {
        return Err(format!("Expected 3 audit logs, found {}", logs.len()));
    }

    let create_log = logs.iter()
        .find(|l| l.action == "CREATE")
        .ok_or("CREATE log not found")?;

    if create_log.new_values.is_none() {
        return Err("CREATE log should have new_values".to_string());
    }

    let update_log = logs.iter()
        .find(|l| l.action == "UPDATE")
        .ok_or("UPDATE log not found")?;

    if update_log.old_values.is_none() || update_log.new_values.is_none() {
        return Err("UPDATE log should have old and new values".to_string());
    }

    let delete_log = logs.iter()
        .find(|l| l.action == "DELETE")
        .ok_or("DELETE log not found")?;

    if delete_log.new_values.is_some() {
        return Err("DELETE log should not have new_values".to_string());
    }

    log::info!("✓ Audit events logged");

    // Test 4: Query audit logs by organization
    log::info!("TEST: Querying audit logs by organization...");
    let org_logs: Vec<_> = ctx.db.audit_log()
        .audit_by_org()
        .filter(&org_id)
        .collect();

    if org_logs.len() != 3 {
        return Err("Audit by org index not working".to_string());
    }

    log::info!("✓ Audit logs queried by organization");

    // Test 5: Query audit logs by table
    log::info!("TEST: Querying audit logs by table...");
    let user_logs: Vec<_> = ctx.db.audit_log()
        .audit_by_table()
        .filter(&"user_profile".to_string())
        .collect();

    if user_logs.len() != 2 {
        return Err("Audit by table index not working".to_string());
    }

    log::info!("✓ Audit logs queried by table");

    // Test 6: Update audit rule
    log::info!("TEST: Updating audit rule...");
    let rule_id = user_rule.id;

    update_audit_rule(
        ctx,
        rule_id,
        Some(true),
        Some(false),
        Some(true),
        Some(false),
        Some(false),
    )?;

    let updated_rule = ctx.db.audit_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found after update")?;

    if updated_rule.log_reads != true {
        return Err("log_reads not updated".to_string());
    }

    if updated_rule.log_writes != false {
        return Err("log_writes not updated".to_string());
    }

    if updated_rule.is_active != false {
        return Err("is_active not updated".to_string());
    }

    log::info!("✓ Audit rule updated");

    // Test 7: Audit log with metadata
    log::info!("TEST: Audit log with metadata...");
    // Note: The log_audit_event doesn't accept metadata parameter
    // This is noted as the metadata field exists but isn't used in the reducer
    log::info!("✓ Audit log metadata field exists");

    // Test 8: Verify audit log fields
    log::info!("TEST: Verifying audit log fields...");
    let log = &logs[0];

    if log.user_identity != ctx.sender() {
        return Err("Audit log user_identity should match sender".to_string());
    }

    if log.timestamp.to_micros_since_unix_epoch() == 0 {
        return Err("Audit log timestamp should be set".to_string());
    }

    if log.changed_fields.is_empty() {
        return Err("Audit log should have changed_fields".to_string());
    }

    log::info!("✓ Audit log fields verified");

    // Test 9: Error - non-existent rule update
    log::info!("TEST: Non-existent rule update...");
    let result = update_audit_rule(
        ctx,
        99999,
        None,
        None,
        None,
        None,
        None,
    );

    if result.is_ok() {
        return Err("Should fail for non-existent rule".to_string());
    }

    log::info!("✓ Non-existent rule update rejected");

    log::info!("✅ All audit logging tests passed!");
    Ok(())
}

/// Test audit rule edge cases
#[spacetimedb::reducer]
pub fn test_audit_rule_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    create_organization(
        ctx,
        "Audit Edge Org".to_string(),
        "AUDITEDGE".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "AUDITEDGE")
        .ok_or("Test org not found")?;

    // Test 1: Audit rule with all logging disabled
    log::info!("TEST: Audit rule with all logging disabled...");
    create_audit_rule(
        ctx,
        org.id,
        "disabled_table".to_string(),
        false,
        false,
        false,
        false,
    )?;

    let disabled_rule = ctx.db.audit_rule()
        .iter()
        .find(|r| r.table_name == "disabled_table")
        .ok_or("Disabled rule not found")?;

    if disabled_rule.log_reads || disabled_rule.log_writes ||
       disabled_rule.log_deletes || disabled_rule.log_logins {
        return Err("All logging should be disabled".to_string());
    }

    log::info!("✓ Audit rule with all logging disabled created");

    // Test 2: Audit rule with all logging enabled
    log::info!("TEST: Audit rule with all logging enabled...");
    create_audit_rule(
        ctx,
        org.id,
        "verbose_table".to_string(),
        true,
        true,
        true,
        true,
    )?;

    let verbose_rule = ctx.db.audit_rule()
        .iter()
        .find(|r| r.table_name == "verbose_table")
        .ok_or("Verbose rule not found")?;

    if !verbose_rule.log_reads || !verbose_rule.log_writes ||
       !verbose_rule.log_deletes || !verbose_rule.log_logins {
        return Err("All logging should be enabled".to_string());
    }

    log::info!("✓ Audit rule with all logging enabled created");

    // Test 3: Multiple rules for same table (different orgs)
    log::info!("TEST: Multiple rules for same table...");

    // Create another organization
    create_organization(
        ctx,
        "Audit Org 2".to_string(),
        "AUDIT2".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org2 = ctx.db.organization()
        .iter()
        .find(|o| o.code == "AUDIT2")
        .ok_or("Test org 2 not found")?;

    create_audit_rule(
        ctx,
        org2.id,
        "verbose_table".to_string(),
        false,
        true,
        false,
        false,
    )?;

    let rules_for_table: Vec<_> = ctx.db.audit_rule()
        .iter()
        .filter(|r| r.table_name == "verbose_table")
        .collect();

    if rules_for_table.len() != 2 {
        return Err(format!("Expected 2 rules for verbose_table, found {}",
            rules_for_table.len()));
    }

    log::info!("✓ Multiple rules for same table created");

    // Test 4: Partial update of audit rule
    log::info!("TEST: Partial update of audit rule...");
    update_audit_rule(
        ctx,
        verbose_rule.id,
        None,
        Some(false),
        None,
        None,
        None,
    )?;

    let partial_update = ctx.db.audit_rule()
        .id()
        .find(&verbose_rule.id)
        .ok_or("Rule not found")?;

    // log_reads should remain true (unchanged)
    if !partial_update.log_reads {
        return Err("log_reads should remain unchanged".to_string());
    }

    // log_writes should be false (updated)
    if partial_update.log_writes {
        return Err("log_writes should be updated to false".to_string());
    }

    log::info!("✓ Partial update works correctly");

    log::info!("✅ Audit rule edge case tests passed!");
    Ok(())
}

/// Test audit log data integrity
#[spacetimedb::reducer]
pub fn test_audit_log_data_integrity(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    create_organization(
        ctx,
        "Audit Integrity Org".to_string(),
        "AUDITINT".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "AUDITINT")
        .ok_or("Test org not found")?;

    // Test: Audit log with minimal data
    log::info!("TEST: Audit log with minimal data...");
    log_audit_event(
        ctx,
        org.id,
        None,
        "minimal_table".to_string(),
        1,
        "LOGIN".to_string(),
        None,
        None,
        vec![],
        None,
        None,
        None,
    )?;

    let minimal_log = ctx.db.audit_log()
        .iter()
        .find(|l| l.table_name == "minimal_table")
        .ok_or("Minimal log not found")?;

    if minimal_log.old_values.is_some() || minimal_log.new_values.is_some() {
        return Err("Minimal log should have no values".to_string());
    }

    if minimal_log.session_id.is_some() {
        return Err("Minimal log should have no session".to_string());
    }

    log::info!("✓ Minimal audit log created");

    // Test: Audit log with session
    log::info!("TEST: Audit log with session...");
    log_audit_event(
        ctx,
        org.id,
        Some(1),
        "session_table".to_string(),
        2,
        "LOGOUT".to_string(),
        None,
        None,
        vec![],
        Some(123),
        Some("10.0.0.1".to_string()),
        Some("Chrome/120".to_string()),
    )?;

    let session_log = ctx.db.audit_log()
        .iter()
        .find(|l| l.table_name == "session_table")
        .ok_or("Session log not found")?;

    if session_log.company_id != Some(1) {
        return Err("Company ID not stored".to_string());
    }

    if session_log.session_id != Some(123) {
        return Err("Session ID not stored".to_string());
    }

    if session_log.ip_address != Some("10.0.0.1".to_string()) {
        return Err("IP address not stored".to_string());
    }

    log::info!("✓ Audit log with session data created");

    // Test: Changed fields tracking
    log::info!("TEST: Changed fields tracking...");
    log_audit_event(
        ctx,
        org.id,
        None,
        "fields_table".to_string(),
        3,
        "UPDATE".to_string(),
        Some(r#"{"a": 1, "b": 2, "c": 3}"#.to_string()),
        Some(r#"{"a": 1, "b": 22, "c": 3, "d": 4}"#.to_string()),
        vec!["b".to_string(), "d".to_string()],
        None,
        None,
        None,
    )?;

    let fields_log = ctx.db.audit_log()
        .iter()
        .find(|l| l.table_name == "fields_table")
        .ok_or("Fields log not found")?;

    if fields_log.changed_fields.len() != 2 {
        return Err(format!("Expected 2 changed fields, found {}",
            fields_log.changed_fields.len()));
    }

    if !fields_log.changed_fields.contains(&"b".to_string()) {
        return Err("Changed fields should include 'b'".to_string());
    }

    log::info!("✓ Changed fields tracked");

    // Test: Verify auto-increment ID
    log::info!("TEST: Verify auto-increment ID...");
    let logs: Vec<_> = ctx.db.audit_log().iter().collect();

    if logs.is_empty() {
        return Err("Should have audit logs".to_string());
    }

    // IDs should be unique and positive
    let ids: Vec<u64> = logs.iter().map(|l| l.id).collect();
    if ids.iter().any(|&id| id == 0) {
        return Err("Audit log IDs should be auto-incremented and non-zero".to_string());
    }

    log::info!("✓ Auto-increment IDs working");

    log::info!("✅ Audit log data integrity tests passed!");
    Ok(())
}

/// Test audit authorization
#[spacetimedb::reducer]
pub fn test_audit_authorization(ctx: &ReducerContext) -> Result<(), String> {
    // Setup - create organization where user is a member
    create_organization(
        ctx,
        "Audit Auth Org".to_string(),
        "AUTHORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "AUTHORG")
        .ok_or("Test org not found")?;

    // Test: Log event for org user is member of
    log::info!("TEST: Logging event as member...");
    // Note: This would normally require membership check
    // The log_audit_event checks if sender is member or superuser
    log_audit_event(
        ctx,
        org.id,
        None,
        "auth_table".to_string(),
        1,
        "CREATE".to_string(),
        None,
        None,
        vec![],
        None,
        None,
        None,
    )?;

    log::info!("✓ Event logged by authorized user");

    // Note: Testing unauthorized access would require a different sender identity
    // which is not possible within a single reducer context
    log::info!("✓ Audit authorization pattern documented");

    log::info!("✅ Audit authorization tests passed!");
    Ok(())
}
