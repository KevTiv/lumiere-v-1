//! Explicit release-compiled enrollment, never an ordinary membership renewal.
use super::{
    audit::{audit_log, AuditLog},
    auth::user_credential,
    organization::{company, organization},
    permissions::{
        field_permission, org_permission, role, user_role_assignment, PermissionSubject,
    },
    users::{user_organization, user_profile, UserOrganization, UserProfile},
};
use lumiere_policy_core::{
    PersistentPlatformOperatorPolicy, PERSISTENT_PLATFORM_OPERATOR_METADATA_KEY,
};
use spacetimedb::{reducer, ReducerContext, Table};

#[reducer]
pub fn enroll_persistent_platform_operator(
    ctx: &ReducerContext,
    apply: bool,
) -> Result<(), String> {
    let raw = option_env!("LUMIERE_PERSISTENT_PLATFORM_OPERATOR")
        .ok_or("persistent platform operator policy is not compiled")?;
    enroll_with_policy(ctx, apply, &PersistentPlatformOperatorPolicy::parse(raw)?)
}

fn source_lease(raw: &str, now: i64) -> Result<(), String> {
    if lumiere_policy_core::persistent_operator_source_lease_valid(raw, now) {
        Ok(())
    } else {
        Err("invalid source bootstrap lease".into())
    }
}

/// Only release-compiled policy can supply global native authority.
pub(crate) fn is_persistent_platform_operator(ctx: &ReducerContext) -> bool {
    option_env!("LUMIERE_PERSISTENT_PLATFORM_OPERATOR")
        .and_then(|raw| PersistentPlatformOperatorPolicy::parse(raw).ok())
        .is_some_and(|policy| is_persistent_operator_with_policy(ctx, &policy))
}

/// Internal persisted-test seam; enrollment probes alone are not authority:
/// a disabled bootstrap is eligible for recovery but must never authorize.
pub(crate) fn is_persistent_operator_with_policy(
    ctx: &ReducerContext,
    policy: &PersistentPlatformOperatorPolicy,
) -> bool {
    ctx.db.user_profile().iter().any(|p| {
        p.identity == ctx.sender()
            && p.is_active
            && p.is_superuser
            && p.metadata.as_deref().is_some_and(|raw| {
                serde_json::from_str::<serde_json::Value>(raw)
                    .ok()
                    .is_some_and(|value| {
                        value[PERSISTENT_PLATFORM_OPERATOR_METADATA_KEY].is_object()
                    })
            })
    }) && enroll_with_policy(ctx, false, policy).is_ok()
}

/// Crate-only seam for persisted test scenarios; no runtime policy reducer exists.
pub(crate) fn enroll_with_policy(
    ctx: &ReducerContext,
    apply: bool,
    policy: &PersistentPlatformOperatorPolicy,
) -> Result<(), String> {
    // Revalidate even crate-supplied policy structs.
    let policy = PersistentPlatformOperatorPolicy::parse(&format!(
        "{}:{}:{}:{}",
        policy.identity_hex, policy.organization_id, policy.company_id, policy.approval_ref
    ))?;
    if ctx.sender().to_hex().to_string() != policy.identity_hex {
        return Err("operator sender mismatch".into());
    }
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
    if profiles.len() != 1 || memberships.len() != 1 {
        return Err("operator requires unique profile and membership".into());
    }
    let mut profile = profiles
        .into_iter()
        .next()
        .ok_or("operator profile missing")?;
    let membership = memberships
        .into_iter()
        .next()
        .ok_or("operator membership missing")?;
    if profile.organization_id != policy.organization_id
        || profile.platform_user_id.trim().is_empty()
        || membership.organization_id != policy.organization_id
        || membership.company_id != Some(policy.company_id)
        || !membership.is_default
        || ctx
            .db
            .user_profile()
            .iter()
            .any(|p| p.id != profile.id && p.platform_user_id == profile.platform_user_id)
        || ctx
            .db
            .user_credential()
            .iter()
            .any(|c| c.identity == ctx.sender() || c.platform_user_id == profile.platform_user_id)
    {
        return Err("invalid operator binding or credentialed principal".into());
    }
    let org = ctx
        .db
        .organization()
        .id()
        .find(policy.organization_id)
        .ok_or("operator organization missing")?;
    let company = ctx
        .db
        .company()
        .id()
        .find(policy.company_id)
        .ok_or("operator company missing")?;
    let role = ctx
        .db
        .role()
        .id()
        .find(membership.role_id)
        .ok_or("operator role missing")?;
    if !org.is_active
        || org.organization_id != org.id
        || company.organization_id != org.id
        || company.deleted_at.is_some()
        || role.organization_id != org.id
        || !role.is_active
        || role.parent_id.is_some()
        || !role.permissions.is_empty()
        || ctx
            .db
            .user_organization()
            .iter()
            .any(|m| m.id != membership.id && m.role_id == role.id && m.is_active)
        || ctx
            .db
            .user_role_assignment()
            .iter()
            .any(|a| a.is_active && (a.user_identity == ctx.sender() || a.role_id == role.id))
        || ctx.db.field_permission().iter().any(|g| {
            g.role_id == Some(role.id)
                || matches!(g.subject, PermissionSubject::Role(id) if id == role.id)
                || matches!(g.subject, PermissionSubject::User(id) if id == ctx.sender())
        })
        || ctx.db.org_permission().iter().any(|g| {
            g.role_id == Some(role.id)
                || matches!(g.subject, PermissionSubject::Role(id) if id == role.id)
                || matches!(g.subject, PermissionSubject::User(id) if id == ctx.sender())
        })
    {
        return Err("operator requires valid scope and empty non-inherited role".into());
    }
    let raw = profile
        .metadata
        .as_deref()
        .ok_or("operator bootstrap origin missing")?;
    if membership.metadata.as_deref() != Some(raw) {
        return Err("operator metadata origins differ".into());
    }
    let now = ctx.timestamp.to_micros_since_unix_epoch();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
        let record = &value[PERSISTENT_PLATFORM_OPERATOR_METADATA_KEY];
        let source = record["sourceBootstrapLease"]
            .as_str()
            .ok_or("persistent source missing")?;
        source_lease(source, now)?;
        if record["identityHex"].as_str() == Some(policy.identity_hex.as_str())
            && record["organizationId"].as_u64() == Some(policy.organization_id)
            && record["companyId"].as_u64() == Some(policy.company_id)
            && record["approvalRef"].as_str() == Some(policy.approval_ref.as_str())
            && record["enrolledAtMicros"]
                .as_i64()
                .is_some_and(|t| t >= 0 && t <= now)
            && profile.is_active
            && profile.is_superuser
            && membership.is_active
        {
            return Ok(());
        }
        return Err("persistent operator revoked or policy conflicts".into());
    }
    source_lease(raw, now)?;
    // This reviewed recovery is only for the existing fully disabled bootstrap
    // principal. Mixed or active source states are outside the approved release.
    if profile.is_active || profile.is_superuser || membership.is_active {
        return Err(
            "operator recovery requires fully inactive non-superuser bootstrap rows".into(),
        );
    }
    if !apply {
        return Ok(());
    }
    super::reconstruction::require_writes_unfenced(ctx, org.id)?;
    let metadata = serde_json::json!({
        PERSISTENT_PLATFORM_OPERATOR_METADATA_KEY: {
            "identityHex": policy.identity_hex,
            "organizationId": policy.organization_id,
            "companyId": policy.company_id,
            "approvalRef": policy.approval_ref,
            "sourceBootstrapLease": raw,
            "enrolledAtMicros": now
        }
    })
    .to_string();
    for (table, id, old, new, fields) in [
        (
            "user_profile",
            profile.id,
            serde_json::json!({"metadata": profile.metadata, "is_active": profile.is_active, "is_superuser": profile.is_superuser, "updated_at": profile.updated_at.to_micros_since_unix_epoch()}),
            serde_json::json!({"metadata": metadata, "is_active": true, "is_superuser": true, "updated_at": now}),
            vec!["metadata", "is_active", "is_superuser", "updated_at"],
        ),
        (
            "user_organization",
            membership.id,
            serde_json::json!({"metadata": membership.metadata, "is_active": membership.is_active}),
            serde_json::json!({"metadata": metadata, "is_active": true}),
            vec!["metadata", "is_active"],
        ),
    ] {
        ctx.db.audit_log().insert(AuditLog {
            id: 0,
            organization_id: org.id,
            company_id: Some(company.id),
            table_name: table.into(),
            record_id: id,
            action: "persistent_platform_operator_enrollment".into(),
            old_values: Some(old.to_string()),
            new_values: Some(new.to_string()),
            changed_fields: fields.into_iter().map(String::from).collect(),
            user_identity: ctx.sender(),
            session_id: None,
            ip_address: None,
            user_agent: None,
            timestamp: ctx.timestamp,
            metadata: Some(metadata.clone()),
        });
    }
    profile.metadata = Some(metadata.clone());
    ctx.db.user_profile().id().update(UserProfile {
        is_active: true,
        is_superuser: true,
        updated_at: ctx.timestamp,
        ..profile
    });
    ctx.db.user_organization().id().update(UserOrganization {
        metadata: Some(metadata),
        is_active: true,
        ..membership
    });
    Ok(())
}
