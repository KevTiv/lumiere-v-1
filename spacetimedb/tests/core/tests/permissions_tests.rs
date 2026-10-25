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

/// Expired operator metadata must block the real privileged registration path.
pub fn test_expired_operator_cannot_register_certification_runtime(
    ctx: &ReducerContext,
) -> Result<(), String> {
    use crate::ai::skill_registry::{
        register_ai_skill_certification_runtime_profile,
        RegisterAiSkillCertificationRuntimeProfileParams,
    };
    use crate::core::users::{find_user_profile_for_identity, user_profile, UserProfile};
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let original = find_user_profile_for_identity(ctx, ctx.sender())
        .ok_or("operator fixture profile missing")?;
    let leased = ctx
        .db
        .user_profile()
        .id()
        .find(original.id)
        .ok_or("operator fixture binding missing")?;
    let now = ctx.timestamp.to_micros_since_unix_epoch();
    ctx.db.user_profile().id().update(UserProfile {
        metadata: Some(format!(
            "lumiere-platform-bootstrap-v1:{}:{now}",
            now.saturating_sub(1000)
        )),
        ..leased
    });
    let resolved = find_user_profile_for_identity(ctx, ctx.sender());
    let registration = register_ai_skill_certification_runtime_profile(
        ctx,
        fixture.organization_id,
        RegisterAiSkillCertificationRuntimeProfileParams {
            profile_key: "expired-operator-must-not-register".to_string(),
            runtime_hash: format!("sha256:{}", "a".repeat(64)),
            executor_identity: spacetimedb::Identity::from_byte_array([42; 32]),
            metadata: None,
        },
    );
    // Restore the test authority before evaluating assertions, including failure.
    ctx.db.user_profile().id().update(original);
    if !resolved.is_some_and(|profile| !profile.is_active && !profile.is_superuser) {
        return Err("expired operator remained active or privileged".to_string());
    }
    match registration {
        Err(error) if error.contains("only an active platform superuser") => Ok(()),
        Err(error) => Err(format!(
            "registration did not reject expired authority: {error}"
        )),
        Ok(()) => Err("expired operator registered a certification runtime".to_string()),
    }
}
