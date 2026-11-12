//! Field-permission grant/revoke and policy snapshot coverage.
use spacetimedb::{ReducerContext, Table};

use crate::core::permissions::{
    create_role, field_permission, grant_field_permission, org_permission, policy_snapshot,
    revoke_field_permission, role, CreateRoleParams, FieldPermissionAction,
    GrantFieldPermissionParams, PermissionSubject,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

/// Exercise raw persisted rows, not a mock policy decision. Restore the caller's
/// pre-existing authority before the remaining registered scenarios run.
pub fn test_persistent_operator_enrollment(ctx: &ReducerContext) -> Result<(), String> {
    use crate::core::{
        audit::audit_log,
        auth::{user_credential, UserCredential},
        platform_operator::enroll_with_policy,
        users::{user_organization, user_profile, UserOrganization, UserProfile},
    };
    use lumiere_policy_core::PersistentPlatformOperatorPolicy;
    // Tables intentionally need not implement Clone; keep copying confined to
    // the test fixture rather than changing the production table definition.
    fn copy_profile(p: &UserProfile) -> UserProfile {
        UserProfile {
            id: p.id,
            identity: p.identity,
            platform_user_id: p.platform_user_id.clone(),
            organization_id: p.organization_id,
            email: p.email.clone(),
            email_verified: p.email_verified,
            name: p.name.clone(),
            first_name: p.first_name.clone(),
            last_name: p.last_name.clone(),
            avatar_url: p.avatar_url.clone(),
            phone: p.phone.clone(),
            mobile: p.mobile.clone(),
            timezone: p.timezone.clone(),
            language: p.language.clone(),
            signature: p.signature.clone(),
            notification_preferences: p.notification_preferences.clone(),
            ui_preferences: p.ui_preferences.clone(),
            is_active: p.is_active,
            is_superuser: p.is_superuser,
            created_at: p.created_at,
            updated_at: p.updated_at,
            last_login: p.last_login,
            metadata: p.metadata.clone(),
        }
    }
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let profiles: Vec<_> = ctx
        .db
        .user_profile()
        .iter()
        .filter(|p| p.identity == ctx.sender())
        .collect();
    let memberships: Vec<_> = ctx
        .db
        .user_organization()
        .iter()
        .filter(|m| m.user_identity == ctx.sender())
        .collect();
    let template = copy_profile(
        profiles
            .iter()
            .find(|p| p.organization_id == fixture.organization_id)
            .ok_or("operator template missing")?,
    );
    let member = memberships
        .iter()
        .find(|m| m.organization_id == fixture.organization_id)
        .ok_or("operator member template missing")?
        .clone();
    create_role(
        ctx,
        fixture.organization_id,
        CreateRoleParams {
            name: "Persistent Operator Empty Role".into(),
            description: None,
            parent_id: None,
            permissions: vec![],
            is_active: true,
            metadata: None,
        },
    )?;
    let empty_role = ctx
        .db
        .role()
        .role_by_org()
        .filter(&fixture.organization_id)
        .find(|r| r.name == "Persistent Operator Empty Role")
        .ok_or("empty role missing")?;
    for p in &profiles {
        ctx.db.user_profile().id().delete(p.id);
    }
    for m in &memberships {
        ctx.db.user_organization().id().delete(m.id);
    }
    let now = ctx.timestamp.to_micros_since_unix_epoch();
    let lease = format!("lumiere-platform-bootstrap-v1:{}:{}", now - 2, now - 1);
    let baseline = ctx.db.user_profile().insert(UserProfile {
        platform_user_id: format!("test-persistent-operator-{}", fixture.organization_id),
        is_active: false,
        is_superuser: false,
        metadata: Some(lease.clone()),
        ..template
    });
    let baseline_member = ctx.db.user_organization().insert(UserOrganization {
        role_id: empty_role.id,
        company_id: Some(fixture.company_id),
        is_active: false,
        is_default: true,
        metadata: Some(lease.clone()),
        ..member
    });
    let policy = PersistentPlatformOperatorPolicy {
        identity_hex: ctx.sender().to_hex().to_string(),
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        approval_ref: "test-reviewed-release".into(),
    };
    let result = (|| -> Result<(), String> {
        let count = || {
            ctx.db
                .audit_log()
                .iter()
                .filter(|a| a.action == "persistent_platform_operator_enrollment")
                .count()
        };
        let initial_count = count();
        enroll_with_policy(ctx, false, &policy)?;
        if count() != initial_count
            || ctx
                .db
                .user_profile()
                .id()
                .find(baseline.id)
                .ok_or("probe deleted profile")?
                .is_active
            || ctx
                .db
                .user_organization()
                .id()
                .find(baseline_member.id)
                .ok_or("probe deleted member")?
                .metadata
                != Some(lease.clone())
        {
            return Err("probe wrote application state".into());
        }
        ctx.db.user_profile().id().update(UserProfile {
            is_active: true,
            ..copy_profile(&baseline)
        });
        if enroll_with_policy(ctx, true, &policy).is_ok() {
            return Err("mixed source state enrolled".into());
        }
        ctx.db.user_organization().id().update(UserOrganization {
            is_active: true,
            ..baseline_member.clone()
        });
        if enroll_with_policy(ctx, false, &policy).is_ok() {
            return Err("active source state probed successfully".into());
        }
        ctx.db.user_profile().id().update(copy_profile(&baseline));
        ctx.db
            .user_organization()
            .id()
            .update(baseline_member.clone());
        for wrong in [
            PersistentPlatformOperatorPolicy {
                identity_hex: "ab".repeat(32),
                ..policy.clone()
            },
            PersistentPlatformOperatorPolicy {
                company_id: policy.company_id + 1,
                ..policy.clone()
            },
            PersistentPlatformOperatorPolicy {
                organization_id: policy.organization_id + 1,
                ..policy.clone()
            },
        ] {
            if enroll_with_policy(ctx, true, &wrong).is_ok() {
                return Err("wrong sender/scope enrolled".into());
            }
        }
        let active = ctx
            .db
            .user_profile()
            .id()
            .find(baseline.id)
            .ok_or("active profile missing")?;
        ctx.db.user_profile().id().update(UserProfile {
            metadata: None,
            ..copy_profile(&active)
        });
        if enroll_with_policy(ctx, true, &policy).is_ok() {
            return Err("ordinary profile enrolled".into());
        }
        ctx.db.user_profile().id().update(copy_profile(&active));
        let credential = ctx.db.user_credential().insert(UserCredential {
            id: 0,
            organization_id: policy.organization_id,
            platform_user_id: active.platform_user_id.clone(),
            identity: ctx.sender(),
            email: active.email.clone(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        });
        let credential_rejected = enroll_with_policy(ctx, true, &policy).is_err();
        ctx.db.user_credential().id().delete(credential.id);
        if !credential_rejected {
            return Err("credentialed principal enrolled".into());
        }
        let duplicate = ctx.db.user_profile().insert(UserProfile {
            id: 0,
            ..copy_profile(&active)
        });
        let duplicate_rejected = enroll_with_policy(ctx, true, &policy).is_err();
        ctx.db.user_profile().id().delete(duplicate.id);
        if !duplicate_rejected {
            return Err("duplicate profile enrolled".into());
        }
        let duplicate_member = ctx.db.user_organization().insert(UserOrganization {
            id: 0,
            ..baseline_member.clone()
        });
        let duplicate_rejected = enroll_with_policy(ctx, true, &policy).is_err();
        ctx.db.user_organization().id().delete(duplicate_member.id);
        if !duplicate_rejected {
            return Err("duplicate membership enrolled".into());
        }
        let existing_role = ctx
            .db
            .role()
            .id()
            .find(empty_role.id)
            .ok_or("role missing")?;
        ctx.db.role().id().update(crate::core::permissions::Role {
            permissions: vec!["*:*".into()],
            ..existing_role
        });
        let privileged_role_rejected = enroll_with_policy(ctx, true, &policy).is_err();
        let existing_role = ctx
            .db
            .role()
            .id()
            .find(empty_role.id)
            .ok_or("role missing")?;
        ctx.db.role().id().update(crate::core::permissions::Role {
            permissions: vec![],
            ..existing_role
        });
        if !privileged_role_rejected {
            return Err("nonempty role enrolled".into());
        }
        let grant = ctx
            .db
            .org_permission()
            .insert(crate::core::permissions::OrgPermission {
                id: 0,
                organization_id: policy.organization_id,
                subject: PermissionSubject::Role(empty_role.id),
                role_id: Some(empty_role.id),
                resource: "*".into(),
                action: crate::core::permissions::PermissionAction::All,
                effect: crate::core::permissions::PermissionEffect::Allow,
                created_by: ctx.sender(),
                created_at: ctx.timestamp,
            });
        let granted_role_rejected = enroll_with_policy(ctx, true, &policy).is_err();
        ctx.db.org_permission().id().delete(grant.id);
        if !granted_role_rejected {
            return Err("OrgPermission-granted role enrolled".into());
        }
        // The authoritative reducer, not just its private caller, must reject
        // every additional authority source and non-dedicated role binding.
        let shared_member = ctx.db.user_organization().insert(UserOrganization {
            id: 0,
            user_identity: spacetimedb::Identity::from_byte_array([91; 32]),
            is_active: true,
            ..baseline_member.clone()
        });
        let shared_role_rejected = enroll_with_policy(ctx, true, &policy).is_err();
        ctx.db.user_organization().id().delete(shared_member.id);
        if !shared_role_rejected {
            return Err("shared operator role enrolled".into());
        }
        for subject in [
            PermissionSubject::Role(empty_role.id),
            PermissionSubject::User(ctx.sender()),
        ] {
            let field =
                ctx.db
                    .field_permission()
                    .insert(crate::core::permissions::FieldPermission {
                        id: 0,
                        organization_id: policy.organization_id,
                        role_id: match subject {
                            PermissionSubject::Role(id) => Some(id),
                            _ => None,
                        },
                        subject,
                        resource: "user_profile".into(),
                        action: FieldPermissionAction::Write,
                        allowed_fields: vec!["is_superuser".into()],
                        created_by: ctx.sender(),
                        created_at: ctx.timestamp,
                    });
            let field_rejected = enroll_with_policy(ctx, true, &policy).is_err();
            ctx.db.field_permission().id().delete(field.id);
            if !field_rejected {
                return Err("role/direct-user field authority enrolled".into());
            }
        }
        {
            use crate::core::permissions::{user_role_assignment, UserRoleAssignment};
            let assignment = ctx.db.user_role_assignment().insert(UserRoleAssignment {
                id: 0,
                user_identity: ctx.sender(),
                role_id: baseline_member.role_id,
                organization_id: policy.organization_id,
                assigned_by: ctx.sender(),
                assigned_at: ctx.timestamp,
                expires_at: None,
                is_active: true,
                metadata: None,
            });
            let assignment_rejected = enroll_with_policy(ctx, true, &policy).is_err();
            ctx.db.user_role_assignment().id().delete(assignment.id);
            if !assignment_rejected {
                return Err("active supplemental assignment enrolled".into());
            }
        }
        // Inactive role history is not a current grant and must be preserved.
        let inactive_history = ctx.db.user_organization().insert(UserOrganization {
            id: 0,
            user_identity: spacetimedb::Identity::from_byte_array([91; 32]),
            is_active: false,
            ..baseline_member.clone()
        });
        enroll_with_policy(ctx, false, &policy)?;
        enroll_with_policy(ctx, true, &policy)?;
        let enrolled = ctx
            .db
            .user_profile()
            .id()
            .find(active.id)
            .ok_or("enrolled missing")?;
        let enrolled_member = ctx
            .db
            .user_organization()
            .id()
            .find(baseline_member.id)
            .ok_or("enrolled member missing")?;
        if !enrolled.is_active
            || !enrolled.is_superuser
            || enrolled.email != active.email
            || enrolled.name != active.name
            || enrolled.platform_user_id != active.platform_user_id
            || enrolled_member.role_id != baseline_member.role_id
            || enrolled_member.company_id != baseline_member.company_id
            || enrolled.metadata != enrolled_member.metadata
            || count() != initial_count + 2
            || !ctx
                .db
                .role()
                .id()
                .find(empty_role.id)
                .is_some_and(|r| r.permissions.is_empty() && r.parent_id.is_none())
        {
            return Err("enrollment changed unrelated state or missed audits".into());
        }
        enroll_with_policy(ctx, true, &policy)?;
        if count() != initial_count + 2 {
            return Err("idempotent enrollment wrote audits".into());
        }
        if !ctx
            .db
            .user_organization()
            .id()
            .find(inactive_history.id)
            .is_some_and(|row| !row.is_active)
        {
            return Err("inactive role history was changed".into());
        }
        ctx.db.user_organization().id().delete(inactive_history.id);
        ctx.db.user_profile().id().update(UserProfile {
            is_superuser: false,
            ..copy_profile(&enrolled)
        });
        if enroll_with_policy(ctx, true, &policy).is_ok() {
            return Err("revoked operator regranted".into());
        }
        ctx.db.user_profile().id().update(UserProfile {
            is_active: false,
            ..copy_profile(&enrolled)
        });
        if enroll_with_policy(ctx, false, &policy).is_ok() {
            return Err("revoked persistent profile probed successfully".into());
        }
        ctx.db.user_profile().id().update(copy_profile(&enrolled));
        ctx.db.user_organization().id().update(UserOrganization {
            is_active: false,
            ..enrolled_member
        });
        if enroll_with_policy(ctx, false, &policy).is_ok() {
            return Err("revoked persistent membership probed successfully".into());
        }
        Ok(())
    })();
    ctx.db.user_profile().id().delete(baseline.id);
    ctx.db.user_organization().id().delete(baseline_member.id);
    for profile in profiles {
        ctx.db.user_profile().insert(profile);
    }
    for membership in memberships {
        ctx.db.user_organization().insert(membership);
    }
    result
}

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

/// The ordinary member reducer may create an expiring identity, never an admin.
pub fn test_setup_membership_carries_lease_without_granting_privilege(
    ctx: &ReducerContext,
) -> Result<(), String> {
    use crate::core::permissions::role;
    use crate::core::users::{
        add_user_to_organization, find_user_profile_for_organization, user_profile,
        AddUserToOrganizationParams, UserProfile,
    };
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role = ctx
        .db
        .role()
        .role_by_org()
        .filter(&fixture.organization_id)
        .next()
        .ok_or("setup role missing")?;
    let identity = spacetimedb::Identity::from_byte_array([43; 32]);
    let issued = ctx.timestamp.to_micros_since_unix_epoch();
    let lease = format!(
        "lumiere-platform-bootstrap-v1:{issued}:{}",
        issued + 3_600_000_000
    );
    let params = AddUserToOrganizationParams {
        role_id: role.id,
        company_id: Some(fixture.company_id),
        job_title: None,
        department_id: None,
        employee_id: None,
        is_active: true,
        is_default: true,
        metadata: Some("lumiere-platform-bootstrap-request-v1".to_string()),
    };
    for invalid in [
        "lumiere-platform-bootstrap-v2:1:10".to_string(),
        format!(
            "lumiere-platform-bootstrap-v1:{issued}:{}",
            issued + 3_600_000_001
        ),
        format!(
            "lumiere-platform-bootstrap-v1:{}:{}",
            issued + 1,
            issued + 10
        ),
    ] {
        if add_user_to_organization(
            ctx,
            identity,
            fixture.organization_id,
            AddUserToOrganizationParams {
                metadata: Some(invalid),
                ..params.clone()
            },
        )
        .is_ok()
            || find_user_profile_for_organization(ctx, identity, fixture.organization_id).is_some()
        {
            return Err("invalid setup lease created a member profile".to_string());
        }
    }
    add_user_to_organization(ctx, identity, fixture.organization_id, params.clone())?;
    let profile = find_user_profile_for_organization(ctx, identity, fixture.organization_id)
        .ok_or("setup profile missing")?;
    if profile.metadata.as_deref() != Some(lease.as_str())
        || profile.is_superuser
        || !profile.is_active
    {
        return Err(
            "setup membership did not preserve lease without granting administrator authority"
                .to_string(),
        );
    }
    // Identical replay is safe; an attempted clock reset must leave the old lease.
    add_user_to_organization(ctx, identity, fixture.organization_id, params.clone())?;
    let replacement = format!(
        "lumiere-platform-bootstrap-v1:{issued}:{}",
        issued + 3_599_000_000
    );
    if add_user_to_organization(
        ctx,
        identity,
        fixture.organization_id,
        AddUserToOrganizationParams {
            metadata: Some(replacement),
            ..params.clone()
        },
    )
    .is_ok()
    {
        return Err("setup membership silently renewed an existing lease".to_string());
    }
    ctx.db.user_profile().id().update(UserProfile {
        metadata: Some(format!(
            "lumiere-platform-bootstrap-v1:{}:{issued}",
            issued - 1
        )),
        ..profile
    });
    if add_user_to_organization(
        ctx,
        identity,
        fixture.organization_id,
        AddUserToOrganizationParams {
            metadata: None,
            ..params
        },
    )
    .is_ok()
    {
        return Err(
            "expired setup access was accepted as an ordinary membership retry".to_string(),
        );
    }
    Ok(())
}
