//! Field-permission grant/revoke and policy snapshot coverage.
use spacetimedb::{ReducerContext, Table};

use crate::core::permissions::{
    create_role, field_permission, grant_field_permission, policy_snapshot,
    revoke_field_permission, role, CreateRoleParams, FieldPermissionAction,
    GrantFieldPermissionParams, PermissionSubject,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_grant_and_revoke_field_permission(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_role(
        ctx,
        org_id,
        CreateRoleParams {
            name: "Field Perm Role".to_string(),
            description: None,
            parent_id: None,
            permissions: vec!["contact:write".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    let role = ctx
        .db
        .role()
        .role_by_org()
        .filter(&org_id)
        .find(|r| r.name == "Field Perm Role")
        .ok_or("Field Perm Role not found")?;

    grant_field_permission(
        ctx,
        org_id,
        GrantFieldPermissionParams {
            subject: PermissionSubject::Role(role.id),
            resource: "contact".to_string(),
            action: FieldPermissionAction::Write,
            allowed_fields: vec!["name".to_string(), "email".to_string()],
        },
    )?;

    let granted: Vec<_> = ctx
        .db
        .field_permission()
        .field_perm_by_org()
        .filter(&org_id)
        .filter(|row| row.resource == "contact" && row.role_id == Some(role.id))
        .collect();
    if granted.len() != 1 {
        return Err(format!(
            "expected one contact field permission, found {}",
            granted.len()
        ));
    }
    let permission_id = granted[0].id;
    if granted[0].allowed_fields != ["name".to_string(), "email".to_string()] {
        return Err("allowed_fields mismatch after grant".to_string());
    }

    // Superuser snapshot should include the freshly granted field allowlist when present.
    let snapshot = ctx
        .db
        .policy_snapshot()
        .iter()
        .find(|row| row.organization_id == org_id && row.user_identity == ctx.sender());
    if let Some(snap) = snapshot {
        let has_contact = snap
            .field_permissions
            .iter()
            .any(|fp| fp.resource == "contact" && fp.fields.iter().any(|f| f == "name"));
        if !has_contact {
            return Err("policy snapshot missing contact field permission after grant".to_string());
        }
    }

    revoke_field_permission(ctx, org_id, permission_id)?;

    let remaining = ctx
        .db
        .field_permission()
        .field_perm_by_org()
        .filter(&org_id)
        .filter(|row| row.id == permission_id)
        .count();
    if remaining != 0 {
        return Err("field permission still present after revoke".to_string());
    }

    Ok(())
}
