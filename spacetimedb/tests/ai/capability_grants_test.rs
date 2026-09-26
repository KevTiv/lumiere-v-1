//! AI-CG-001: org-scope enforcement, role-org ownership, and input validation
//! on `set_ai_capability_role_grant` and `delete_ai_capability_role_grant`.
use spacetimedb::{ReducerContext, Table};

use crate::ai::capability_grants::{
    ai_capability_role_grant, delete_ai_capability_role_grant,
    provision_owner_ai_capability_grants, set_ai_capability_role_grant,
    OWNER_AI_CAPABILITY_GRANTS,
};
use crate::core::permissions::{create_role, role, CreateRoleParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn seed_role(ctx: &ReducerContext, organization_id: u64, name: &str) -> Result<u64, String> {
    create_role(
        ctx,
        organization_id,
        CreateRoleParams {
            name: name.to_string(),
            description: None,
            parent_id: None,
            permissions: vec![],
            is_active: true,
            metadata: None,
        },
    )?;
    ctx.db
        .role()
        .iter()
        .filter(|r| r.organization_id == organization_id && r.name == name)
        .map(|r| r.id)
        .next()
        .ok_or_else(|| format!("role {name} not found after create"))
}

/// AI-CG-001: writing a capability grant for a foreign organization is denied.
pub fn test_capability_grant_org_scope(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let local_role_id = seed_role(ctx, local.organization_id, "AI-CG-001 Local Role")?;

    let result = set_ai_capability_role_grant(
        ctx,
        foreign.organization_id,
        local_role_id,
        "inventory.products.read".to_string(),
        100,
        1_048_576,
        true,
    );
    match result {
        Err(ref e) if e.to_lowercase().contains("permission") => {}
        other => {
            return Err(format!(
                "AI-CG-001 expected permission error writing foreign org grant, got {other:?}"
            ))
        }
    }
    Ok(())
}

/// AI-CG-002: a role from a foreign organization is rejected even when the org matches.
pub fn test_capability_grant_role_org_mismatch(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let foreign_role_id = seed_role(ctx, foreign.organization_id, "AI-CG-002 Foreign Role")?;

    let result = set_ai_capability_role_grant(
        ctx,
        local.organization_id,
        foreign_role_id,
        "inventory.products.read".to_string(),
        100,
        1_048_576,
        true,
    );
    match result {
        Err(ref e)
            if e.to_lowercase().contains("organization") || e.to_lowercase().contains("role") => {}
        other => {
            return Err(format!(
                "AI-CG-002 expected role-org mismatch error, got {other:?}"
            ))
        }
    }
    Ok(())
}

/// AI-CG-003: empty capability key and zero limits are rejected.
pub fn test_capability_grant_input_validation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(ctx, fixture.organization_id, "AI-CG-003 Validation Role")?;

    // Empty capability key
    let empty_key = set_ai_capability_role_grant(
        ctx,
        fixture.organization_id,
        role_id,
        "".to_string(),
        100,
        1_048_576,
        true,
    );
    if empty_key.is_ok() {
        return Err("AI-CG-003 expected error for empty capability_key".to_string());
    }

    // Zero max_rows
    let zero_rows = set_ai_capability_role_grant(
        ctx,
        fixture.organization_id,
        role_id,
        "inventory.products.read".to_string(),
        0,
        1_048_576,
        true,
    );
    if zero_rows.is_ok() {
        return Err("AI-CG-003 expected error for zero max_rows".to_string());
    }

    // Zero max_bytes
    let zero_bytes = set_ai_capability_role_grant(
        ctx,
        fixture.organization_id,
        role_id,
        "inventory.products.read".to_string(),
        100,
        0,
        true,
    );
    if zero_bytes.is_ok() {
        return Err("AI-CG-003 expected error for zero max_bytes".to_string());
    }

    // Zero organization_id
    let zero_org = set_ai_capability_role_grant(
        ctx,
        0,
        role_id,
        "inventory.products.read".to_string(),
        100,
        1_048_576,
        true,
    );
    if zero_org.is_ok() {
        return Err("AI-CG-003 expected error for zero organization_id".to_string());
    }

    Ok(())
}

/// AI-CG-004: second write upserts and delete removes the row.
pub fn test_capability_grant_upsert_and_delete(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(ctx, fixture.organization_id, "AI-CG-004 Upsert Role")?;
    let capability_key = "inventory.products.read".to_string();

    // First write — inserts
    set_ai_capability_role_grant(
        ctx,
        fixture.organization_id,
        role_id,
        capability_key.clone(),
        50,
        512_000,
        true,
    )?;

    let grants_after_insert: Vec<_> = ctx
        .db
        .ai_capability_role_grant()
        .ai_capability_grant_by_role()
        .filter(&role_id)
        .filter(|g| {
            g.organization_id == fixture.organization_id && g.capability_key == capability_key
        })
        .collect();
    if grants_after_insert.len() != 1 {
        return Err(format!(
            "AI-CG-004 expected 1 grant after insert, got {}",
            grants_after_insert.len()
        ));
    }
    let grant_id = grants_after_insert[0].id;

    // Second write with different limits — updates (not inserts another row)
    set_ai_capability_role_grant(
        ctx,
        fixture.organization_id,
        role_id,
        capability_key.clone(),
        200,
        2_097_152,
        false,
    )?;

    let grants_after_update: Vec<_> = ctx
        .db
        .ai_capability_role_grant()
        .ai_capability_grant_by_role()
        .filter(&role_id)
        .filter(|g| {
            g.organization_id == fixture.organization_id && g.capability_key == capability_key
        })
        .collect();
    if grants_after_update.len() != 1 {
        return Err(format!(
            "AI-CG-004 expected 1 grant after update, got {}",
            grants_after_update.len()
        ));
    }
    if grants_after_update[0].max_rows != 200 || grants_after_update[0].is_active {
        return Err("AI-CG-004 upsert did not update limits correctly".to_string());
    }

    // Delete — removes the row
    delete_ai_capability_role_grant(ctx, fixture.organization_id, grant_id)?;

    let grants_after_delete: Vec<_> = ctx
        .db
        .ai_capability_role_grant()
        .ai_capability_grant_by_role()
        .filter(&role_id)
        .filter(|g| {
            g.organization_id == fixture.organization_id && g.capability_key == capability_key
        })
        .collect();
    if !grants_after_delete.is_empty() {
        return Err(format!(
            "AI-CG-004 expected 0 grants after delete, got {}",
            grants_after_delete.len()
        ));
    }

    // Delete of foreign org grant is denied
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let foreign_role_id = seed_role(ctx, foreign.organization_id, "AI-CG-004 Foreign Role")?;
    set_ai_capability_role_grant(
        ctx,
        foreign.organization_id,
        foreign_role_id,
        "inventory.products.read".to_string(),
        10,
        102_400,
        true,
    )?;
    let foreign_grant_id = ctx
        .db
        .ai_capability_role_grant()
        .ai_capability_grant_by_role()
        .filter(&foreign_role_id)
        .filter(|g| g.organization_id == foreign.organization_id)
        .map(|g| g.id)
        .next()
        .ok_or("AI-CG-004 foreign grant not found")?;

    let cross_delete =
        delete_ai_capability_role_grant(ctx, fixture.organization_id, foreign_grant_id);
    match cross_delete {
        Err(ref e)
            if e.to_lowercase().contains("organization")
                || e.to_lowercase().contains("not found") => {}
        other => {
            return Err(format!(
                "AI-CG-004 expected denial for cross-org delete, got {other:?}"
            ))
        }
    }

    Ok(())
}


/// AI-CG-005: the production owner baseline is exact, idempotent, and cannot
/// be applied to an ordinary role.
pub fn test_owner_capability_provisioning(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let owner_role_id = seed_role(ctx, fixture.organization_id, "AI-CG-005 Owner")?;
    let mut owner_role = ctx.db.role().id().find(&owner_role_id).ok_or("owner role missing")?;
    owner_role.permissions = vec!["*:*".to_string()];
    owner_role.is_system = true;
    ctx.db.role().id().update(owner_role.clone());

    provision_owner_ai_capability_grants(ctx, fixture.organization_id, &owner_role)?;
    provision_owner_ai_capability_grants(ctx, fixture.organization_id, &owner_role)?;

    let grants: Vec<_> = ctx
        .db
        .ai_capability_role_grant()
        .ai_capability_grant_by_role()
        .filter(&owner_role_id)
        .filter(|grant| grant.organization_id == fixture.organization_id)
        .collect();

    if grants.len() != OWNER_AI_CAPABILITY_GRANTS.len() {
        return Err(format!(
            "AI-CG-005 expected {} exact owner grants, got {}",
            OWNER_AI_CAPABILITY_GRANTS.len(),
            grants.len()
        ));
    }

    for expected in OWNER_AI_CAPABILITY_GRANTS {
        let grant = grants
            .iter()
            .find(|grant| grant.capability_key == expected.capability_key)
            .ok_or_else(|| format!("AI-CG-005 missing {}", expected.capability_key))?;
        if !grant.is_active
            || grant.max_rows != expected.max_rows
            || grant.max_bytes != expected.max_bytes
        {
            return Err(format!(
                "AI-CG-005 wrong bounds for {}",
                expected.capability_key
            ));
        }
    }

    let ordinary_role_id = seed_role(ctx, fixture.organization_id, "AI-CG-005 Ordinary")?;
    let ordinary_role = ctx
        .db
        .role()
        .id()
        .find(&ordinary_role_id)
        .ok_or("ordinary role missing")?;
    if provision_owner_ai_capability_grants(ctx, fixture.organization_id, &ordinary_role).is_ok() {
        return Err("AI-CG-005 ordinary role unexpectedly received owner grants".to_string());
    }

    Ok(())
}
