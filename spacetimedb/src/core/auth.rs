/// Auth — Credential Management & Invite/Reset Tokens
///
/// Tables (all PRIVATE — no `public` flag, not subscribable by WebSocket clients):
///   UserCredential     — organization-owned binding to a platform-control user
///   UserInvite         — org-scoped invite tokens sent by admins
///   PasswordResetToken — short-lived tokens for the forgot-password flow
///
/// Reducers are called via the SpacetimeDB HTTP admin API from the API server.
/// Password hashes, reset-token hashes, and STDB session tokens are canonical
/// platform-control data and never enter this ERP binding.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::core::users::{
    ensure_user_profile_for_organization, find_user_profile_for_identity,
    find_user_profile_for_organization, has_duplicate_platform_user_binding, user_organization,
    user_profile, UserProfile,
};
use crate::helpers::{write_audit_log_v2, AuditLogParams};

// ============================================================================
// TABLES (private — NO `public` flag)
// ============================================================================

#[spacetimedb::table(
    accessor = user_credential,
    index(accessor = user_credential_by_organization, btree(columns = [organization_id])),
    index(accessor = user_credential_by_identity, btree(columns = [identity]))
)]
pub struct UserCredential {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Owning organization, assigned from validated membership by the server
    /// reducer path. This is not client-editable credential data.
    pub organization_id: u64,
    /// Opaque platform-control key; never derived from an organization id.
    pub platform_user_id: String,
    /// Email is a non-authoritative display projection for compatibility.
    pub email: String,
    /// SpacetimeDB identity bound to this organization-owned projection.
    pub identity: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[spacetimedb::table(
    accessor = user_invite,
    index(accessor = user_invite_by_organization, btree(columns = [organization_id]))
)]
pub struct UserInvite {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub role_id: u64,
    pub email: String,
    /// SHA-256 hash of the plaintext invite token (stored; plaintext sent by email).
    pub token_hash: String,
    pub invited_by: Identity,
    pub expires_at: Timestamp,
    pub accepted_at: Option<Timestamp>,
}

#[spacetimedb::table(
    accessor = password_reset_token,
    index(accessor = reset_token_by_organization, btree(columns = [organization_id]))
)]
pub struct PasswordResetToken {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Organization ownership is copied from the target identity's validated
    /// active membership when the binding is created.
    pub organization_id: u64,
    /// Opaque identifier of this platform token. It is not the secret hash.
    pub platform_reset_token_id: String,
    /// Opaque platform-control key for the account being reset.
    pub platform_user_id: String,
    pub expires_at: Timestamp,
    pub used_at: Option<Timestamp>,
}

// ============================================================================
// HELPERS
// ============================================================================

fn audit_organization_for_identity(ctx: &ReducerContext, identity: Identity) -> Option<u64> {
    ctx.db
        .user_organization()
        .user_org_by_user()
        .filter(&identity)
        .find(|uo| uo.is_active && uo.is_default)
        .or_else(|| {
            ctx.db
                .user_organization()
                .user_org_by_user()
                .filter(&identity)
                .find(|uo| uo.is_active)
        })
        .map(|uo| uo.organization_id)
}

/// Asserts the calling identity is a superuser (i.e. the server admin identity).
/// All admin-called reducers must call this first.
fn require_superuser(ctx: &ReducerContext) -> Result<(), String> {
    let caller =
        find_user_profile_for_identity(ctx, ctx.sender()).ok_or("Caller profile not found")?;
    if !caller.is_superuser || !caller.is_active {
        return Err("Unauthorized: caller is not a superuser".to_string());
    }
    Ok(())
}

#[cfg(feature = "dev-module")]
fn require_dev_reducers_enabled() -> Result<(), String> {
    let enabled = option_env!("LUMIERE_ENABLE_DEV_REDUCERS")
        .is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true"));
    if enabled {
        Ok(())
    } else {
        Err("Dev reducers are disabled in this build".to_string())
    }
}

/// **Trusted local / dev nodes only.** Promotes `ctx.sender()` to `is_superuser` so HTTP calls
/// using `STDB_SERVER_TOKEN` can invoke platform binding reducers.
/// The JWT identity usually has no profile or `is_superuser: false` until this runs or `ensure_dev_admin`.
/// Do **not** rely on this for production security — anyone who can invoke reducers as this identity
/// can escalate; use only with local `spacetime` or controlled deployments.
#[spacetimedb::reducer]
#[cfg(feature = "dev-module")]
pub fn dev_promote_caller_superuser(ctx: &ReducerContext) -> Result<(), String> {
    require_dev_reducers_enabled()?;

    let sender = ctx.sender();
    let organization_id = audit_organization_for_identity(ctx, sender)
        .ok_or("Caller must belong to an organization before an ERP profile can be created")?;
    if let Some(profile) = find_user_profile_for_organization(ctx, sender, organization_id) {
        if profile.is_superuser {
            return Ok(());
        }
        ctx.db.user_profile().id().update(UserProfile {
            is_superuser: true,
            updated_at: ctx.timestamp,
            ..profile
        });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: None,
                table_name: "user_profile",
                record_id: 0,
                action: "UPDATE",
                old_values: Some(serde_json::json!({ "is_superuser": false }).to_string()),
                new_values: Some(serde_json::json!({ "is_superuser": true }).to_string()),
                changed_fields: vec!["is_superuser".to_string()],
                metadata: Some(
                    serde_json::json!({
                        "identity": sender.to_hex().to_string(),
                        "source": "dev_promote_caller_superuser",
                    })
                    .to_string(),
                ),
            },
        );
    } else {
        ctx.db.user_profile().insert(UserProfile {
            id: 0,
            identity: sender,
            platform_user_id: String::new(),
            organization_id,
            email: String::new(),
            email_verified: false,
            name: String::new(),
            first_name: None,
            last_name: None,
            avatar_url: None,
            phone: None,
            mobile: None,
            timezone: "UTC".to_string(),
            language: "en".to_string(),
            signature: None,
            notification_preferences: None,
            ui_preferences: None,
            is_active: true,
            is_superuser: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            last_login: Some(ctx.timestamp),
            metadata: Some("{\"dev_promote_caller_superuser\":true}".to_string()),
        });
        write_audit_log_v2(
            ctx,
            0,
            AuditLogParams {
                company_id: None,
                table_name: "user_profile",
                record_id: 0,
                action: "CREATE",
                old_values: None,
                new_values: Some(serde_json::json!({ "is_superuser": true }).to_string()),
                changed_fields: vec!["is_superuser".to_string()],
                metadata: Some(
                    serde_json::json!({
                        "identity": sender.to_hex().to_string(),
                        "source": "dev_promote_caller_superuser",
                    })
                    .to_string(),
                ),
            },
        );
    }
    Ok(())
}

/// Ensure a `UserProfile` exists for HTTP-provisioned identities (E2E seed,
/// sign-up). A profile is an ERP row, so the identity must already have a
/// validated organization membership before it can be materialized.
fn ensure_user_profile_for_identity(
    ctx: &ReducerContext,
    identity: Identity,
    email: String,
    email_verified: bool,
) {
    let Some(organization_id) = audit_organization_for_identity(ctx, identity) else {
        return;
    };
    ensure_user_profile_for_organization(ctx, identity, organization_id);
    if let Some(profile) = find_user_profile_for_organization(ctx, identity, organization_id) {
        ctx.db.user_profile().id().update(UserProfile {
            email,
            email_verified,
            ..profile
        });
    }
}

// ============================================================================
// REDUCERS — admin-called (from Next.js server via HTTP admin API)
// ============================================================================

/// Materialize an organization-owned binding after the server has validated
/// membership. The opaque platform key is the only identity shared with the
/// platform-control database; no password, token, or reset secret is accepted.
#[spacetimedb::reducer]
pub fn bind_user_credential(
    ctx: &ReducerContext,
    platform_user_id: String,
    user_identity: Identity,
    email: String,
) -> Result<(), String> {
    require_superuser(ctx)?;
    if platform_user_id.trim().is_empty() || platform_user_id.len() > 128 {
        return Err("platform user id is invalid".to_string());
    }
    let organization_id = audit_organization_for_identity(ctx, user_identity)
        .ok_or("Credential identity must belong to an organization")?;
    if ctx
        .db
        .user_credential()
        .user_credential_by_identity()
        .filter(&user_identity)
        .any(|binding| binding.organization_id == organization_id)
    {
        return Err("Identity already has a credential binding".to_string());
    }
    let row = ctx.db.user_credential().insert(UserCredential {
        id: 0,
        organization_id,
        platform_user_id,
        email,
        identity: user_identity,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "user_credential",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "identity": user_identity.to_hex().to_string() }).to_string(),
            ),
            changed_fields: vec!["platform_user_id".to_string(), "identity".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Attach the canonical platform key to an organization-owned profile binding.
#[spacetimedb::reducer]
pub fn bind_user_profile(
    ctx: &ReducerContext,
    platform_user_id: String,
    user_identity: Identity,
) -> Result<(), String> {
    require_superuser(ctx)?;
    if platform_user_id.trim().is_empty() || platform_user_id.len() > 128 {
        return Err("platform user id is invalid".to_string());
    }
    let profile =
        find_user_profile_for_identity(ctx, user_identity).ok_or("User profile not found")?;
    if !ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&user_identity)
        .any(|membership| {
            membership.organization_id == profile.organization_id && membership.is_active
        })
    {
        return Err("User profile has no active organization membership".to_string());
    }
    if has_duplicate_platform_user_binding(
        ctx,
        profile.organization_id,
        &platform_user_id,
        profile.id,
    ) {
        return Err("Platform user is already bound in this organization".to_string());
    }
    ctx.db.user_profile().id().update(UserProfile {
        platform_user_id,
        updated_at: ctx.timestamp,
        ..profile
    });
    Ok(())
}

/// Project canonical platform-control profile fields into one organization
/// binding. This reducer is intentionally operator-only: clients must use the
/// authenticated API profile route, which updates PostgreSQL first and then
/// invokes this reducer with the server-resolved organization and identity.
///
/// The organization and identity guards prevent a trusted caller from
/// accidentally writing a profile into a different tenant or to a user who is
/// not an active member of that tenant.
#[spacetimedb::reducer]
pub fn project_user_profile(
    ctx: &ReducerContext,
    user_identity: Identity,
    organization_id: u64,
    email: String,
    email_verified: bool,
    name: String,
    first_name: Option<String>,
    last_name: Option<String>,
    timezone: String,
    language: String,
) -> Result<(), String> {
    require_superuser(ctx)?;
    let membership_is_active = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&user_identity)
        .any(|membership| membership.organization_id == organization_id && membership.is_active);
    if !membership_is_active {
        return Err("Profile identity is not an active organization member".to_string());
    }

    let profile = find_user_profile_for_organization(ctx, user_identity, organization_id)
        .ok_or("User profile not found")?;
    let profile_id = profile.id;
    let old_name = profile.name.clone();
    let old_timezone = profile.timezone.clone();
    let old_language = profile.language.clone();
    let old_email = profile.email.clone();
    ctx.db.user_profile().id().update(UserProfile {
        email: email.clone(),
        email_verified,
        name: name.clone(),
        first_name,
        last_name,
        timezone: timezone.clone(),
        language: language.clone(),
        updated_at: ctx.timestamp,
        ..profile
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "user_profile",
            record_id: profile_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "email": old_email,
                    "name": old_name,
                    "timezone": old_timezone,
                    "language": old_language,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "email": email,
                    "name": name,
                    "timezone": timezone,
                    "language": language,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "email".to_string(),
                "email_verified".to_string(),
                "name".to_string(),
                "first_name".to_string(),
                "last_name".to_string(),
                "timezone".to_string(),
                "language".to_string(),
            ],
            metadata: Some(
                serde_json::json!({
                    "identity": user_identity.to_hex().to_string(),
                    "source": "platform_control",
                })
                .to_string(),
            ),
        },
    );

    Ok(())
}

/// Project reset-token metadata into the target user's organization shard.
/// The secret hash remains exclusively in platform-control PostgreSQL.
#[spacetimedb::reducer]
pub fn bind_password_reset_token(
    ctx: &ReducerContext,
    platform_user_id: String,
    platform_reset_token_id: String,
    user_identity: Identity,
    expires_at: Timestamp,
) -> Result<(), String> {
    require_superuser(ctx)?;
    if platform_user_id.trim().is_empty() || platform_user_id.len() > 128 {
        return Err("platform user id is invalid".to_string());
    }
    if platform_reset_token_id.trim().is_empty() || platform_reset_token_id.len() > 128 {
        return Err("platform reset token id is invalid".to_string());
    }
    let organization_id = audit_organization_for_identity(ctx, user_identity)
        .ok_or("Reset-token identity must belong to an organization")?;
    ctx.db.password_reset_token().insert(PasswordResetToken {
        id: 0,
        organization_id,
        platform_reset_token_id,
        platform_user_id,
        expires_at,
        used_at: None,
    });
    Ok(())
}

/// Mark the organization projection for one consumed platform reset token.
/// PostgreSQL remains the concurrency/expiry authority.
#[spacetimedb::reducer]
pub fn mark_password_reset_token_projection_used(
    ctx: &ReducerContext,
    platform_reset_token_id: String,
) -> Result<(), String> {
    require_superuser(ctx)?;
    let ids: Vec<u64> = ctx
        .db
        .password_reset_token()
        .iter()
        .filter(|token| {
            token.platform_reset_token_id == platform_reset_token_id && token.used_at.is_none()
        })
        .map(|token| token.id)
        .collect();
    for id in ids {
        if let Some(token) = ctx.db.password_reset_token().id().find(&id) {
            ctx.db
                .password_reset_token()
                .id()
                .update(PasswordResetToken {
                    used_at: Some(ctx.timestamp),
                    ..token
                });
        }
    }
    Ok(())
}

/// Create an org-scoped invite for a new user.
/// Called by the server admin identity via HTTP reducer call.
#[spacetimedb::reducer]
pub fn create_user_invite(
    ctx: &ReducerContext,
    organization_id: u64,
    role_id: u64,
    email: String,
    token_hash: String,
    invited_by: Identity,
    expires_at: Timestamp,
) -> Result<(), String> {
    require_superuser(ctx)?;

    let email = normalize_invite_email(&email)?;
    let now = ctx.timestamp.to_micros_since_unix_epoch();
    let expiry = expires_at.to_micros_since_unix_epoch();
    if expiry <= now || expiry - now > 7 * 24 * 60 * 60 * 1_000_000 {
        return Err("Invite expiry must be within seven days".into());
    }
    if token_hash.len() != 64 || !token_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid invite token hash".into());
    }
    use crate::core::permissions::role;
    let target_role = ctx
        .db
        .role()
        .id()
        .find(role_id)
        .ok_or("Invite role not found")?;
    if target_role.organization_id != organization_id || !target_role.is_active {
        return Err("Invite role is inactive or belongs to another organization".into());
    }
    require_invite_authority(ctx, organization_id, invited_by)?;
    // Alpha quotas are enforced in the same transaction as insertion, including
    // requests bypassing HTTP. The lifetime cap bounds churn and email abuse.
    let mut total = 0;
    let mut pending = 0;
    for invite in ctx
        .db
        .user_invite()
        .iter()
        .filter(|invite| invite.organization_id == organization_id)
    {
        total += 1;
        if invite.accepted_at.is_none() && invite.expires_at > ctx.timestamp {
            pending += 1;
            if invite.email.eq_ignore_ascii_case(&email) {
                return Err("An active invitation already exists for this address".into());
            }
        }
    }
    if total >= 500 || pending >= 50 {
        return Err("Alpha organization invitation limit reached; contact support".into());
    }
    if ctx
        .db
        .user_organization()
        .iter()
        .filter(|member| member.organization_id == organization_id && member.is_active)
        .count()
        >= 100
    {
        return Err("Alpha organization member limit reached; contact support".into());
    }

    let row = ctx.db.user_invite().insert(UserInvite {
        id: 0,
        organization_id,
        role_id,
        email: email.clone(),
        token_hash,
        invited_by,
        expires_at,
        accepted_at: None,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "user_invite",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "email": email,
                    "role_id": role_id,
                    "invited_by": invited_by.to_hex().to_string(),
                })
                .to_string(),
            ),
            changed_fields: vec!["email".to_string(), "role_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Claim an invite before granting membership; failures require a new invite.
/// Called by the server admin identity via HTTP reducer call.
#[spacetimedb::reducer]
pub fn mark_invite_accepted(ctx: &ReducerContext, invite_id: u64) -> Result<(), String> {
    require_superuser(ctx)?;

    let invite = ctx
        .db
        .user_invite()
        .id()
        .find(&invite_id)
        .ok_or("Invite not found")?;

    if invite.accepted_at.is_some() || invite.expires_at <= ctx.timestamp {
        return Err("Invite is used or expired".into());
    }
    use crate::core::permissions::role;
    let target_role = ctx
        .db
        .role()
        .id()
        .find(invite.role_id)
        .ok_or("Invite role not found")?;
    if target_role.organization_id != invite.organization_id || !target_role.is_active {
        return Err("Invite role is inactive or belongs to another organization".into());
    }

    require_invite_authority(ctx, invite.organization_id, invite.invited_by)?;
    if ctx
        .db
        .user_organization()
        .iter()
        .filter(|member| member.organization_id == invite.organization_id && member.is_active)
        .count()
        >= 100
    {
        return Err("Alpha organization member limit reached; contact support".into());
    }

    ctx.db.user_invite().id().update(UserInvite {
        accepted_at: Some(ctx.timestamp),
        ..invite
    });

    write_audit_log_v2(
        ctx,
        invite.organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "user_invite",
            record_id: invite_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "accepted_at": null }).to_string()),
            new_values: Some(serde_json::json!({ "accepted_at": "set" }).to_string()),
            changed_fields: vec!["accepted_at".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ============================================================================
// REDUCERS — client-called (by the authenticated user's own WebSocket)
// ============================================================================

/// Update the calling user's email and email_verified flag on their UserProfile.
/// Called by the client after sign-up (once the WebSocket connection is established
/// with the new identity's token, triggering UserProfile auto-creation).
#[spacetimedb::reducer]
pub fn update_user_email(
    ctx: &ReducerContext,
    email: String,
    email_verified: bool,
) -> Result<(), String> {
    let profile = find_user_profile_for_identity(ctx, ctx.sender())
        .ok_or("UserProfile not found — connect first")?;
    if !ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .any(|membership| {
            membership.organization_id == profile.organization_id && membership.is_active
        })
    {
        return Err("User profile has no active organization membership".to_string());
    }

    ctx.db.user_profile().id().update(UserProfile {
        email: email.clone(),
        email_verified,
        updated_at: ctx.timestamp,
        ..profile
    });

    let organization_id = audit_organization_for_identity(ctx, ctx.sender())
        .ok_or("User profile has no active organization membership")?;
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "user_profile",
            record_id: 0,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "email": profile.email,
                    "email_verified": profile.email_verified,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({ "email": email, "email_verified": email_verified }).to_string(),
            ),
            changed_fields: vec!["email".to_string(), "email_verified".to_string()],
            metadata: Some(
                serde_json::json!({
                    "identity": ctx.sender().to_hex().to_string(),
                })
                .to_string(),
            ),
        },
    );

    Ok(())
}

fn normalize_invite_email(raw: &str) -> Result<String, String> {
    let email = raw.trim().to_ascii_lowercase();
    if email.len() > 254
        || !email.is_ascii()
        || email
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        || email.split('@').count() != 2
        || email.starts_with('@')
        || email.ends_with('@')
    {
        return Err("Invalid invitation email".into());
    }
    Ok(email)
}

fn require_invite_authority(
    ctx: &ReducerContext,
    organization_id: u64,
    invited_by: Identity,
) -> Result<(), String> {
    use crate::core::permissions::{role, user_role_assignment};
    if !ctx.db.user_organization().iter().any(|member| {
        member.user_identity == invited_by
            && member.organization_id == organization_id
            && member.is_active
    }) {
        return Err("Inviter is not an active member".into());
    }
    let authorized = ctx.db.user_role_assignment().iter().any(|assignment| {
        assignment.user_identity == invited_by
            && assignment.organization_id == organization_id
            && assignment.is_active
            && assignment
                .expires_at
                .map_or(true, |expiry| expiry > ctx.timestamp)
            && ctx
                .db
                .role()
                .id()
                .find(assignment.role_id)
                .is_some_and(|role| {
                    role.organization_id == organization_id
                        && role.is_active
                        && matches!(
                            role.name.to_ascii_lowercase().as_str(),
                            "owner" | "admin" | "administrator"
                        )
                })
    });
    if !authorized {
        return Err("Inviter lacks active administrator authority".into());
    }
    Ok(())
}
