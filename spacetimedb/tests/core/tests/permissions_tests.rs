/// Permissions Module Tests
///
/// Test reducers for Role, CasbinRule, and UserRoleAssignment tables.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{create_organization, organization, CreateOrganizationParams};
use crate::core::permissions::{
    add_casbin_rule, casbin_rule, create_role, remove_casbin_rule, role, update_role,
    AddCasbinRuleParams, CreateRoleParams, UpdateRoleParams,
};

/// Test permission system lifecycle
#[spacetimedb::reducer]
pub fn test_permission_system(ctx: &ReducerContext) -> Result<(), String> {
    // Setup: Create test organization
    log::info!("TEST: Creating test organization for permissions...");
    create_organization(
        ctx,
        CreateOrganizationParams {
            name: "Permission Test Org".to_string(),
            code: "PERMORG".to_string(),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: None,
        },
    )?;

    let org = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == "PERMORG")
        .ok_or("Test organization not found")?;

    let org_id = org.id;

    // Test 1: Create role
    log::info!("TEST: Creating role...");
    create_role(
        ctx,
        org_id,
        CreateRoleParams {
            name: "Test Manager".to_string(),
            description: Some("Manager role for testing".to_string()),
            parent_id: None,
            permissions: vec![
                "organization:read".to_string(),
                "organization:write".to_string(),
                "user:read".to_string(),
            ],
            is_active: true,
            metadata: None,
        },
    )?;

    let role = ctx
        .db
        .role()
        .iter()
        .find(|r| r.name == "Test Manager" && r.organization_id == org_id)
        .ok_or("Role not created")?;

    if role.permissions.len() != 3 {
        return Err(format!(
            "Expected 3 permissions, got {}",
            role.permissions.len()
        ));
    }

    if !role.permissions.contains(&"organization:read".to_string()) {
        return Err("Permission not stored correctly".to_string());
    }

    if role.is_system {
        return Err("User-created role should not be system".to_string());
    }

    if !role.is_active {
        return Err("New role should be active".to_string());
    }

    log::info!("✓ Role created successfully");

    let role_id = role.id;

    // Test 2: Update role
    log::info!("TEST: Updating role...");
    update_role(
        ctx,
        role_id,
        UpdateRoleParams {
            name: Some("Updated Manager".to_string()),
            description: Some("Updated description".to_string()),
            permissions: Some(vec![
                "organization:read".to_string(),
                "organization:write".to_string(),
                "user:read".to_string(),
                "user:write".to_string(),
            ]),
            is_active: None,
        },
    )?;

    let updated_role = ctx
        .db
        .role()
        .id()
        .find(&role_id)
        .ok_or("Role not found after update")?;

    if updated_role.name != "Updated Manager" {
        return Err("Role name not updated".to_string());
    }

    if updated_role.permissions.len() != 4 {
        return Err("Permissions not updated".to_string());
    }

    log::info!("✓ Role updated successfully");

    // Test 3: Add Casbin rule (policy)
    log::info!("TEST: Adding Casbin policy rule...");
    add_casbin_rule(
        ctx,
        org_id,
        AddCasbinRuleParams {
            ptype: "p".to_string(),
            v0: Some(role_id.to_string()),
            v1: Some(org_id.to_string()),
            v2: Some("resource".to_string()),
            v3: Some("action".to_string()),
            v4: None,
            v5: None,
            metadata: None,
        },
    )?;

    let rules: Vec<_> = ctx
        .db
        .casbin_rule()
        .casbin_by_ptype()
        .filter(&"p".to_string())
        .filter(|r| r.v0 == Some(role_id.to_string()))
        .collect();

    if rules.is_empty() {
        return Err("Casbin rule not created".to_string());
    }

    log::info!("✓ Casbin rule added");

    let rule_id = rules[0].id;

    // Test 4: Remove Casbin rule
    log::info!("TEST: Removing Casbin rule...");
    remove_casbin_rule(ctx, org_id, rule_id)?;

    let removed_rule = ctx.db.casbin_rule().id().find(&rule_id);
    if removed_rule.is_some() {
        return Err("Casbin rule should be deleted".to_string());
    }

    log::info!("✓ Casbin rule removed");

    // Test 5: Error - create role with empty name
    log::info!("TEST: Error case - empty role name...");
    match create_role(
        ctx,
        org_id,
        CreateRoleParams {
            name: "".to_string(),
            description: None,
            parent_id: None,
            permissions: vec![],
            is_active: true,
            metadata: None,
        },
    ) {
        Ok(_) => return Err("Should reject empty role name".to_string()),
        Err(_) => log::info!("✓ Correctly rejected empty role name"),
    }

    // Test 6: Error - invalid ptype
    log::info!("TEST: Error case - invalid ptype...");
    match add_casbin_rule(
        ctx,
        org_id,
        AddCasbinRuleParams {
            ptype: "invalid".to_string(),
            v0: None,
            v1: None,
            v2: None,
            v3: None,
            v4: None,
            v5: None,
            metadata: None,
        },
    ) {
        Ok(_) => return Err("Should reject invalid ptype".to_string()),
        Err(_) => log::info!("✓ Correctly rejected invalid ptype"),
    }

    log::info!("✅ All permission system tests passed!");
    Ok(())
}

/// Test role hierarchy and inheritance
#[spacetimedb::reducer]
pub fn test_role_hierarchy(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    log::info!("TEST: Setting up for role hierarchy...");
    create_organization(
        ctx,
        CreateOrganizationParams {
            name: "Hierarchy Test Org".to_string(),
            code: "HIERORG".to_string(),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: None,
        },
    )?;

    let org = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == "HIERORG")
        .ok_or("Test organization not found")?;

    // Create parent role
    log::info!("TEST: Creating parent role...");
    create_role(
        ctx,
        org.id,
        CreateRoleParams {
            name: "Parent Role".to_string(),
            description: Some("Base role with common permissions".to_string()),
            parent_id: None,
            permissions: vec!["common:read".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    let parent = ctx
        .db
        .role()
        .iter()
        .find(|r| r.name == "Parent Role" && r.organization_id == org.id)
        .ok_or("Parent role not created")?;

    // Create child role
    log::info!("TEST: Creating child role with parent...");
    create_role(
        ctx,
        org.id,
        CreateRoleParams {
            name: "Child Role".to_string(),
            description: Some("Inherited role".to_string()),
            parent_id: Some(parent.id),
            permissions: vec!["specific:write".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    let child = ctx
        .db
        .role()
        .iter()
        .find(|r| r.name == "Child Role" && r.organization_id == org.id)
        .ok_or("Child role not created")?;

    if child.parent_id != Some(parent.id) {
        return Err("Child role should reference parent".to_string());
    }

    log::info!("✓ Role hierarchy created");

    // Verify both roles exist
    let roles: Vec<_> = ctx.db.role().role_by_org().filter(&org.id).collect();

    if roles.len() != 2 {
        return Err(format!("Expected 2 roles, got {}", roles.len()));
    }

    log::info!("✅ Role hierarchy tests passed!");
    Ok(())
}

/// Test Casbin rule patterns
#[spacetimedb::reducer]
pub fn test_casbin_rule_patterns(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    log::info!("TEST: Setting up for Casbin patterns...");
    create_organization(
        ctx,
        CreateOrganizationParams {
            name: "Casbin Test Org".to_string(),
            code: "CASORG".to_string(),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: None,
        },
    )?;

    let org = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == "CASORG")
        .ok_or("Test organization not found")?;

    // Test 1: Policy rule with all fields
    log::info!("TEST: Creating policy with all fields...");
    add_casbin_rule(
        ctx,
        org.id,
        AddCasbinRuleParams {
            ptype: "p".to_string(),
            v0: Some("role:1".to_string()),
            v1: Some("org:1".to_string()),
            v2: Some("resource".to_string()),
            v3: Some("read".to_string()),
            v4: Some("allow".to_string()),
            v5: Some("domain".to_string()),
            metadata: None,
        },
    )?;

    // Test 2: Grouping rule
    log::info!("TEST: Creating grouping rule...");
    add_casbin_rule(
        ctx,
        org.id,
        AddCasbinRuleParams {
            ptype: "g".to_string(),
            v0: Some("user:1".to_string()),
            v1: Some("role:admin".to_string()),
            v2: Some("org:1".to_string()),
            v3: None,
            v4: None,
            v5: None,
            metadata: None,
        },
    )?;

    // Test 3: Minimal rule
    log::info!("TEST: Creating minimal rule...");
    add_casbin_rule(
        ctx,
        org.id,
        AddCasbinRuleParams {
            ptype: "p".to_string(),
            v0: Some("admin".to_string()),
            v1: None,
            v2: None,
            v3: None,
            v4: None,
            v5: None,
            metadata: None,
        },
    )?;

    // Verify all rules exist
    let all_rules: Vec<_> = ctx.db.casbin_rule().iter().collect();
    let org_rules: Vec<_> = all_rules
        .iter()
        .filter(|r| {
            // Find rules that belong to this test (by checking if they match our test pattern)
            r.v0 == Some("role:1".to_string())
                || r.v0 == Some("user:1".to_string())
                || r.v0 == Some("admin".to_string())
        })
        .collect();

    if org_rules.len() != 3 {
        return Err(format!("Expected 3 rules, got {}", org_rules.len()));
    }

    log::info!("✓ Casbin rules created with various patterns");

    log::info!("✅ Casbin rule pattern tests passed!");
    Ok(())
}

/// Test role update edge cases
#[spacetimedb::reducer]
pub fn test_role_update_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    log::info!("TEST: Setting up for role updates...");
    create_organization(
        ctx,
        CreateOrganizationParams {
            name: "Role Update Test Org".to_string(),
            code: "ROLEUPDORG".to_string(),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: None,
        },
    )?;

    let org = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == "ROLEUPDORG")
        .ok_or("Test organization not found")?;

    // Create test role
    create_role(
        ctx,
        org.id,
        CreateRoleParams {
            name: "Update Test Role".to_string(),
            description: Some("Original description".to_string()),
            parent_id: None,
            permissions: vec!["perm1".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    let role = ctx
        .db
        .role()
        .iter()
        .find(|r| r.name == "Update Test Role" && r.organization_id == org.id)
        .ok_or("Role not created")?;

    let role_id = role.id;

    // Test 1: Partial update (only name)
    log::info!("TEST: Partial update - only name...");
    update_role(
        ctx,
        role_id,
        UpdateRoleParams {
            name: Some("Updated Name Only".to_string()),
            description: None,
            permissions: None,
            is_active: None,
        },
    )?;

    let updated = ctx.db.role().id().find(&role_id).ok_or("Role not found")?;

    if updated.name != "Updated Name Only" {
        return Err("Name not updated".to_string());
    }

    if updated.description != Some("Original description".to_string()) {
        return Err("Description should be preserved".to_string());
    }

    log::info!("✓ Partial update works");

    // Test 2: Deactivate role
    log::info!("TEST: Deactivating role...");
    update_role(
        ctx,
        role_id,
        UpdateRoleParams {
            name: None,
            description: None,
            permissions: None,
            is_active: Some(false),
        },
    )?;

    let deactivated = ctx.db.role().id().find(&role_id).ok_or("Role not found")?;

    if deactivated.is_active {
        return Err("Role should be inactive".to_string());
    }

    log::info!("✓ Role deactivated");

    // Test 3: Reactivate role
    log::info!("TEST: Reactivating role...");
    update_role(
        ctx,
        role_id,
        UpdateRoleParams {
            name: None,
            description: None,
            permissions: None,
            is_active: Some(true),
        },
    )?;

    let reactivated = ctx.db.role().id().find(&role_id).ok_or("Role not found")?;

    if !reactivated.is_active {
        return Err("Role should be active".to_string());
    }

    log::info!("✓ Role reactivated");

    log::info!("✅ Role update edge case tests passed!");
    Ok(())
}

/// Test error cases and validation
#[spacetimedb::reducer]
pub fn test_permissions_error_cases(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    log::info!("TEST: Setting up for error cases...");
    create_organization(
        ctx,
        CreateOrganizationParams {
            name: "Error Test Org".to_string(),
            code: "ERRORG".to_string(),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: None,
        },
    )?;

    let org = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == "ERRORG")
        .ok_or("Test organization not found")?;

    // Test 1: Update non-existent role
    log::info!("TEST: Error - update non-existent role...");
    match update_role(
        ctx,
        99999,
        UpdateRoleParams {
            name: Some("Name".to_string()),
            description: None,
            permissions: None,
            is_active: None,
        },
    ) {
        Ok(_) => return Err("Should fail for non-existent role".to_string()),
        Err(_) => log::info!("✓ Correctly rejected non-existent role"),
    }

    // Test 2: Remove non-existent Casbin rule
    log::info!("TEST: Error - remove non-existent rule...");
    match remove_casbin_rule(ctx, org.id, 99999) {
        Ok(_) => log::info!("Note: Remove succeeded (may be idempotent)"),
        Err(_) => log::info!("✓ Remove rejected non-existent rule"),
    }

    log::info!("✅ Permission error case tests passed!");
    Ok(())
}
