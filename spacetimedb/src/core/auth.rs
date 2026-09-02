/// Auth — Credential Management & Invite/Reset Tokens
///
/// Tables (all PRIVATE — no `public` flag, not subscribable by WebSocket clients):
///   UserCredential     — email + bcrypt hash + encrypted STDB token + optional WorkOS id
///   UserInvite         — org-scoped invite tokens sent by admins
///   PasswordResetToken — short-lived tokens for the forgot-password flow
///
/// Reducers are called via the SpacetimeDB HTTP admin API from the Next.js server.
/// All admin-called reducers assert `ctx.sender()` is a superuser.
/// The `update_user_email` reducer is called by the connected client after sign-up.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::core::users::{user_organization, user_profile, UserProfile};
use crate::helpers::{write_audit_log_v2, AuditLogParams};

// ============================================================================
// TABLES (private — NO `public` flag)
// ============================================================================

#[spacetimedb::table(accessor = user_credential)]
pub struct UserCredential {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Email is the login key. Unique across all users.
    #[unique]
    pub email: String,
    /// SpacetimeDB identity that owns this credential.
    #[unique]
    pub identity: Identity,
    /// bcrypt hash of the user's password (hashed server-side in Node.js). Empty for SSO-only.
    pub password_hash: String,
    /// WorkOS User Management id when the account uses SSO; None for password-only.
    pub workos_user_id: Option<String>,
    /// SpacetimeDB token encrypted with AES-GCM using STDB_CREDENTIAL_ENCRYPTION_KEY.
    /// Stored encrypted so that even if the SpacetimeDB HTTP SQL API is queried,
    /// the raw token is not exposed.
    pub stdb_token_enc: String,
    pub email_verified: bool,
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

#[spacetimedb::table(accessor = password_reset_token)]
pub struct PasswordResetToken {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub identity: Identity,
    /// SHA-256 hash of the plaintext reset token.
    pub token_hash: String,
    pub expires_at: Timestamp,
    pub used_at: Option<Timestamp>,
}

// ============================================================================
// HELPERS
// ============================================================================

fn audit_organization_for_identity(ctx: &ReducerContext, identity: Identity) -> u64 {
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
        .unwrap_or(0)
}

/// Asserts the calling identity is a superuser (i.e. the server admin identity).
/// All admin-called reducers must call this first.
fn require_superuser(ctx: &ReducerContext) -> Result<(), String> {
    let caller = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("Caller profile not found")?;
    if !caller.is_superuser {
        return Err("Unauthorized: caller is not a superuser".to_string());
    }
    Ok(())
}

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
/// using `STDB_SERVER_TOKEN` can invoke `store_user_credential` and other admin reducers.
/// The JWT identity usually has no profile or `is_superuser: false` until this runs or `ensure_dev_admin`.
/// Do **not** rely on this for production security — anyone who can invoke reducers as this identity
/// can escalate; use only with local `spacetime` or controlled deployments.
#[spacetimedb::reducer]
pub fn dev_promote_caller_superuser(ctx: &ReducerContext) -> Result<(), String> {
    require_dev_reducers_enabled()?;

    let sender = ctx.sender();
    if let Some(profile) = ctx.db.user_profile().identity().find(sender) {
        if profile.is_superuser {
            return Ok(());
        }
        ctx.db.user_profile().identity().update(UserProfile {
            is_superuser: true,
            updated_at: ctx.timestamp,
            ..profile
        });
        write_audit_log_v2(
            ctx,
            audit_organization_for_identity(ctx, sender),
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
            identity: sender,
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

/// Ensure a `UserProfile` exists for HTTP-provisioned identities (E2E seed, sign-up).
/// `identity_connected` only runs on WebSocket connect; BFF-only users need this path.
fn ensure_user_profile_for_identity(
    ctx: &ReducerContext,
    identity: Identity,
    email: String,
    email_verified: bool,
) {
    if ctx.db.user_profile().identity().find(identity).is_some() {
        return;
    }
    ctx.db.user_profile().insert(UserProfile {
        identity,
        email,
        email_verified,
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
        is_superuser: false,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        last_login: Some(ctx.timestamp),
        metadata: None,
    });
}

// ============================================================================
// REDUCERS — admin-called (from Next.js server via HTTP admin API)
// ============================================================================

/// Store a new user's credentials after server-side identity provisioning (sign-up).
/// Called by the server admin identity via HTTP reducer call.
///
/// `new_identity` — the SpacetimeDB identity provisioned via POST /v1/identity
/// `email`        — the user's email (already verified as unique server-side)
/// `password_hash`— bcrypt hash produced server-side
/// `stdb_token_enc` — the new identity's token, AES-GCM encrypted server-side
#[spacetimedb::reducer]
pub fn store_user_credential(
    ctx: &ReducerContext,
    new_identity: Identity,
    email: String,
    password_hash: String,
    stdb_token_enc: String,
) -> Result<(), String> {
    require_superuser(ctx)?;

    // Guard against duplicate email (server already checks, but belt-and-suspenders)
    if ctx.db.user_credential().email().find(&email).is_some() {
        return Err("Email already registered".to_string());
    }
    if ctx
        .db
        .user_credential()
        .identity()
        .find(&new_identity)
        .is_some()
    {
        return Err("Identity already has credentials".to_string());
    }

    let profile_email = email.clone();
    let row = ctx.db.user_credential().insert(UserCredential {
        id: 0,
        email,
        identity: new_identity,
        password_hash,
        workos_user_id: None,
        stdb_token_enc,
        email_verified: false,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });

    ensure_user_profile_for_identity(ctx, new_identity, profile_email, false);

    write_audit_log_v2(
        ctx,
        audit_organization_for_identity(ctx, new_identity),
        AuditLogParams {
            company_id: None,
            table_name: "user_credential",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "identity": new_identity.to_hex().to_string(),
                    "email_verified": false,
                })
                .to_string(),
            ),
            changed_fields: vec!["email".to_string(), "identity".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Store credentials for a new user provisioned via WorkOS SSO (no password).
#[spacetimedb::reducer]
pub fn store_sso_user_credential(
    ctx: &ReducerContext,
    new_identity: Identity,
    email: String,
    stdb_token_enc: String,
    workos_user_id: String,
    email_verified: bool,
) -> Result<(), String> {
    require_superuser(ctx)?;

    if email.is_empty() || workos_user_id.is_empty() {
        return Err("Email and WorkOS user id are required".to_string());
    }

    if ctx.db.user_credential().email().find(&email).is_some() {
        return Err("Email already registered".to_string());
    }
    if ctx
        .db
        .user_credential()
        .identity()
        .find(&new_identity)
        .is_some()
    {
        return Err("Identity already has credentials".to_string());
    }

    let dup_workos = ctx.db.user_credential().iter().any(|c| {
        c.workos_user_id
            .as_ref()
            .is_some_and(|w| w == &workos_user_id)
    });
    if dup_workos {
        return Err("WorkOS user already linked".to_string());
    }

    let profile_email = email.clone();
    let row = ctx.db.user_credential().insert(UserCredential {
        id: 0,
        email,
        identity: new_identity,
        password_hash: String::new(),
        workos_user_id: Some(workos_user_id.clone()),
        stdb_token_enc,
        email_verified,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });

    ensure_user_profile_for_identity(ctx, new_identity, profile_email, email_verified);

    write_audit_log_v2(
        ctx,
        audit_organization_for_identity(ctx, new_identity),
        AuditLogParams {
            company_id: None,
            table_name: "user_credential",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "identity": new_identity.to_hex().to_string(),
                    "workos_user_id": workos_user_id,
                    "email_verified": email_verified,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "email".to_string(),
                "identity".to_string(),
                "workos_user_id".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Link a WorkOS user id to an existing password account (same email).
#[spacetimedb::reducer]
pub fn link_workos_user(
    ctx: &ReducerContext,
    target_identity: Identity,
    workos_user_id: String,
) -> Result<(), String> {
    require_superuser(ctx)?;

    if workos_user_id.is_empty() {
        return Err("WorkOS user id is required".to_string());
    }

    let dup_workos = ctx.db.user_credential().iter().any(|c| {
        c.workos_user_id
            .as_ref()
            .is_some_and(|w| w == &workos_user_id)
    });
    if dup_workos {
        return Err("WorkOS user already linked to another account".to_string());
    }

    let cred = ctx
        .db
        .user_credential()
        .identity()
        .find(&target_identity)
        .ok_or("Credential not found for identity")?;

    if cred.workos_user_id.is_some() {
        return Err("Account already has a WorkOS link".to_string());
    }

    ctx.db.user_credential().id().update(UserCredential {
        workos_user_id: Some(workos_user_id.clone()),
        updated_at: ctx.timestamp,
        ..cred
    });

    write_audit_log_v2(
        ctx,
        audit_organization_for_identity(ctx, target_identity),
        AuditLogParams {
            company_id: None,
            table_name: "user_credential",
            record_id: cred.id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "workos_user_id": workos_user_id,
                    "identity": target_identity.to_hex().to_string(),
                })
                .to_string(),
            ),
            changed_fields: vec!["workos_user_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Update the stored password hash after a successful password reset.
/// Called by the server admin identity via HTTP reducer call.
#[spacetimedb::reducer]
pub fn update_user_password(
    ctx: &ReducerContext,
    target_identity: Identity,
    new_password_hash: String,
) -> Result<(), String> {
    require_superuser(ctx)?;

    let cred = ctx
        .db
        .user_credential()
        .identity()
        .find(&target_identity)
        .ok_or("Credential not found for identity")?;

    ctx.db.user_credential().id().update(UserCredential {
        password_hash: new_password_hash,
        updated_at: ctx.timestamp,
        ..cred
    });

    write_audit_log_v2(
        ctx,
        audit_organization_for_identity(ctx, target_identity),
        AuditLogParams {
            company_id: None,
            table_name: "user_credential",
            record_id: cred.id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "identity": target_identity.to_hex().to_string(),
                    "password_updated": true,
                })
                .to_string(),
            ),
            changed_fields: vec!["password_hash".to_string()],
            metadata: None,
        },
    );

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

/// Mark an invite as accepted (called after the invitee completes sign-up).
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

/// Store a short-lived password reset token for the forgot-password flow.
/// Called by the server admin identity via HTTP reducer call.
#[spacetimedb::reducer]
pub fn create_password_reset_token(
    ctx: &ReducerContext,
    target_identity: Identity,
    token_hash: String,
    expires_at: Timestamp,
) -> Result<(), String> {
    require_superuser(ctx)?;

    let row = ctx.db.password_reset_token().insert(PasswordResetToken {
        id: 0,
        identity: target_identity,
        token_hash,
        expires_at,
        used_at: None,
    });

    write_audit_log_v2(
        ctx,
        audit_organization_for_identity(ctx, target_identity),
        AuditLogParams {
            company_id: None,
            table_name: "password_reset_token",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "identity": target_identity.to_hex().to_string(),
                })
                .to_string(),
            ),
            changed_fields: vec!["identity".to_string(), "token_hash".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Mark a reset token as used so it cannot be replayed.
/// Called by the server admin identity via HTTP reducer call.
#[spacetimedb::reducer]
pub fn mark_reset_token_used(ctx: &ReducerContext, token_id: u64) -> Result<(), String> {
    require_superuser(ctx)?;

    let token = ctx
        .db
        .password_reset_token()
        .id()
        .find(&token_id)
        .ok_or("Reset token not found")?;

    ctx.db
        .password_reset_token()
        .id()
        .update(PasswordResetToken {
            used_at: Some(ctx.timestamp),
            ..token
        });

    write_audit_log_v2(
        ctx,
        audit_organization_for_identity(ctx, token.identity),
        AuditLogParams {
            company_id: None,
            table_name: "password_reset_token",
            record_id: token_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "used_at": null }).to_string()),
            new_values: Some(serde_json::json!({ "used_at": "set" }).to_string()),
            changed_fields: vec!["used_at".to_string()],
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
    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("UserProfile not found — connect first")?;

    ctx.db.user_profile().identity().update(UserProfile {
        email: email.clone(),
        email_verified,
        updated_at: ctx.timestamp,
        ..profile
    });

    write_audit_log_v2(
        ctx,
        audit_organization_for_identity(ctx, ctx.sender()),
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
