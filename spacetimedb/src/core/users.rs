/// User Management & Authentication
///
/// Tables:  UserProfile · UserOrganization · UserSession
/// Pattern: UserProfile is keyed by the SpacetimeDB `Identity`, stamped with
///          the owning organization, and linked to an opaque platform key.
///          UserOrganization links a user to an org+role.
///          UserSession tracks active client connections.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::organization;
use crate::core::permissions::{role, Role};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ============================================================================
// PARAMS TYPES
// ============================================================================

/// Params for updating the calling user's own profile.
/// Scope: no scope param (operates on ctx.sender()).
/// Option fields: None = keep existing value.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateUserProfileParams {
    pub name: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub avatar_url: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub timezone: Option<String>,
    pub language: Option<String>,
    pub signature: Option<String>,
    pub notification_preferences: Option<String>,
    pub ui_preferences: Option<String>,
}

/// Params for adding a user to an organization by role ID.
/// Scope: `user_identity` + `organization_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AddUserToOrganizationParams {
    pub role_id: u64,
    pub company_id: Option<u64>,
    pub job_title: Option<String>,
    pub department_id: Option<u64>,
    pub employee_id: Option<String>,
    pub is_active: bool,
    pub is_default: bool,
    pub metadata: Option<String>,
}

/// Params for adding a user to an organization by role name.
/// Scope: `user_identity` + `organization_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AddOrgMemberParams {
    pub role_name: String,
    pub company_id: Option<u64>,
    pub job_title: Option<String>,
    pub department_id: Option<u64>,
    pub employee_id: Option<String>,
    pub is_active: bool,
    pub is_default: bool,
    pub metadata: Option<String>,
}

/// Params for updating org membership details.
/// Scope: `user_org_id` is a flat reducer param.
/// Option fields: None = keep existing value.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateOrgMemberDetailsParams {
    pub department_id: Option<u64>,
    pub job_title: Option<String>,
    pub employee_id: Option<String>,
}

/// Params for creating a user session.
/// Scope: `organization_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateUserSessionParams {
    pub session_token: String,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub device_info: Option<String>,
    pub expires_at_micros: u64,
    pub metadata: Option<String>,
}

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = user_profile,
    index(accessor = user_profile_by_organization, btree(columns = [organization_id]))
)]
pub struct UserProfile {
    #[primary_key]
    pub identity: Identity,
    /// Opaque key into the platform-control profile; never derived from the
    /// organization or used as a tenant selector.
    pub platform_user_id: String,
    /// Organization ownership is assigned from the caller's validated
    /// membership. It is never accepted from profile update parameters.
    pub organization_id: u64,
    pub email: String,
    pub email_verified: bool,
    pub name: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub avatar_url: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub timezone: String,
    pub language: String,
    pub signature: Option<String>,
    pub notification_preferences: Option<String>, // JSON
    pub ui_preferences: Option<String>,           // JSON
    pub is_active: bool,
    pub is_superuser: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub last_login: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = user_organization,
    public,
    index(accessor = user_org_by_user, btree(columns = [user_identity])),
    index(accessor = user_org_by_org,  btree(columns = [organization_id]))
)]
pub struct UserOrganization {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub user_identity: Identity,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub role_id: u64,
    pub department_id: Option<u64>,
    pub job_title: Option<String>,
    pub employee_id: Option<String>,
    pub date_joined: Timestamp,
    pub is_active: bool,
    pub is_default: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = user_session,
    public,
    index(accessor = session_by_user, btree(columns = [user_identity])),
    index(accessor = session_by_org,  btree(columns = [organization_id]))
)]
pub struct UserSession {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub user_identity: Identity,
    pub organization_id: u64,
    pub session_token: String,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub device_info: Option<String>,
    pub started_at: Timestamp,
    pub last_activity: Timestamp,
    pub expires_at: Timestamp,
    pub is_active: bool,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

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

/// Insert the organization-owned profile for an identity after membership has
/// been established. Identity-connected users who have not completed tenant
/// onboarding do not yet have an ERP profile row.
pub(crate) fn ensure_user_profile_for_organization(
    ctx: &ReducerContext,
    identity: Identity,
    organization_id: u64,
) {
    if ctx.db.user_profile().identity().find(identity).is_some() {
        return;
    }
    ctx.db.user_profile().insert(UserProfile {
        identity,
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
        is_superuser: false,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        last_login: Some(ctx.timestamp),
        metadata: None,
    });
}

/// Update the calling user's own profile fields.
/// Clients cannot change `is_active` or `is_superuser` through this reducer.
#[spacetimedb::reducer]
pub fn update_user_profile(
    ctx: &ReducerContext,
    params: UpdateUserProfileParams,
) -> Result<(), String> {
    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("User profile not found")?;
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

    let updated_name = params.name.unwrap_or(profile.name.clone());
    let updated_first_name = params.first_name.or(profile.first_name.clone());
    let updated_last_name = params.last_name.or(profile.last_name.clone());
    let updated_timezone = params.timezone.unwrap_or(profile.timezone.clone());
    let updated_language = params.language.unwrap_or(profile.language.clone());

    ctx.db.user_profile().identity().update(UserProfile {
        name: updated_name.clone(),
        first_name: updated_first_name.clone(),
        last_name: updated_last_name.clone(),
        avatar_url: params.avatar_url.or(profile.avatar_url),
        phone: params.phone.or(profile.phone),
        mobile: params.mobile.or(profile.mobile),
        timezone: updated_timezone.clone(),
        language: updated_language.clone(),
        signature: params.signature.or(profile.signature),
        notification_preferences: params
            .notification_preferences
            .or(profile.notification_preferences),
        ui_preferences: params.ui_preferences.or(profile.ui_preferences),
        updated_at: ctx.timestamp,
        ..profile
    });

    let organization_id = audit_organization_for_identity(ctx, ctx.sender());
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
                    "name": profile.name,
                    "timezone": profile.timezone,
                    "language": profile.language,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "name": updated_name,
                    "timezone": updated_timezone,
                    "language": updated_language,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "first_name".to_string(),
                "last_name".to_string(),
                "timezone".to_string(),
                "language".to_string(),
            ],
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

/// Add a user to an organization with a given role.
/// Requires `user_organization:create` on the target organization.
#[spacetimedb::reducer]
pub fn add_user_to_organization(
    ctx: &ReducerContext,
    user_identity: Identity,
    organization_id: u64,
    params: AddUserToOrganizationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "user_organization", "create")?;

    ctx.db
        .organization()
        .id()
        .find(&organization_id)
        .ok_or("Organization not found")?;

    let role = ctx
        .db
        .role()
        .id()
        .find(&params.role_id)
        .ok_or("Role not found")?;

    if role.organization_id != organization_id {
        return Err("Role does not belong to this organization".to_string());
    }

    let already_member = ctx.db.user_organization().iter().any(|uo| {
        uo.user_identity == user_identity && uo.organization_id == organization_id && uo.is_active
    });

    if already_member {
        return Err("User is already an active member of this organization".to_string());
    }

    let row = ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity,
        organization_id,
        company_id: params.company_id,
        role_id: params.role_id,
        department_id: params.department_id,
        job_title: params.job_title,
        employee_id: params.employee_id,
        date_joined: ctx.timestamp,
        is_active: params.is_active,
        is_default: params.is_default,
        metadata: params.metadata,
    });

    // Materialize the organization-owned profile only after membership has
    // been validated. The API server binds its opaque platform key separately.
    ensure_user_profile_for_organization(ctx, user_identity, organization_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "user_organization",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "user_identity": user_identity.to_hex().to_string(),
                    "role_id": params.role_id,
                    "is_active": params.is_active,
                    "is_default": params.is_default,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "user_identity".to_string(),
                "role_id".to_string(),
                "is_active".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Add a user to an organization by role name (owner/admin/manager/user/viewer, etc.).
/// This is onboarding-friendly for clients that don't have role IDs yet.
#[spacetimedb::reducer]
pub fn add_org_member(
    ctx: &ReducerContext,
    user_identity: Identity,
    organization_id: u64,
    params: AddOrgMemberParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "user_organization", "create")?;

    ctx.db
        .organization()
        .id()
        .find(&organization_id)
        .ok_or("Organization not found")?;

    let normalized_role = params.role_name.trim().to_lowercase();
    if normalized_role.is_empty() {
        return Err("Role name cannot be empty".to_string());
    }

    let selected_role: Role = ctx
        .db
        .role()
        .iter()
        .find(|r| {
            r.organization_id == organization_id
                && r.is_active
                && r.name.trim().to_lowercase() == normalized_role
        })
        .ok_or("Role not found in organization")?;

    let already_member = ctx.db.user_organization().iter().any(|uo| {
        uo.user_identity == user_identity && uo.organization_id == organization_id && uo.is_active
    });

    if already_member {
        return Err("User is already an active member of this organization".to_string());
    }

    let row = ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity,
        organization_id,
        company_id: params.company_id,
        role_id: selected_role.id,
        department_id: params.department_id,
        job_title: params.job_title,
        employee_id: params.employee_id,
        date_joined: ctx.timestamp,
        is_active: params.is_active,
        is_default: params.is_default,
        metadata: params.metadata,
    });

    // Materialize the profile only after this validated membership exists.
    ensure_user_profile_for_organization(ctx, user_identity, organization_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "user_organization",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "user_identity": user_identity.to_hex().to_string(),
                    "role_id": selected_role.id,
                    "role_name": selected_role.name,
                    "is_active": params.is_active,
                    "is_default": params.is_default,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "user_identity".to_string(),
                "role_id".to_string(),
                "is_active".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Update an existing org membership's role using role name.
#[spacetimedb::reducer]
pub fn update_org_member_role(
    ctx: &ReducerContext,
    user_org_id: u64,
    role_name: String,
) -> Result<(), String> {
    let membership = ctx
        .db
        .user_organization()
        .id()
        .find(&user_org_id)
        .ok_or("User organization membership not found")?;

    check_permission(
        ctx,
        membership.organization_id,
        "user_organization",
        "write",
    )?;

    let normalized_role = role_name.trim().to_lowercase();
    if normalized_role.is_empty() {
        return Err("Role name cannot be empty".to_string());
    }

    let selected_role: Role = ctx
        .db
        .role()
        .iter()
        .find(|r| {
            r.organization_id == membership.organization_id
                && r.is_active
                && r.name.trim().to_lowercase() == normalized_role
        })
        .ok_or("Role not found in organization")?;

    ctx.db.user_organization().id().update(UserOrganization {
        role_id: selected_role.id,
        ..membership
    });

    write_audit_log_v2(
        ctx,
        membership.organization_id,
        AuditLogParams {
            company_id: membership.company_id,
            table_name: "user_organization",
            record_id: user_org_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "role_id": membership.role_id }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "role_id": selected_role.id,
                    "role_name": selected_role.name,
                })
                .to_string(),
            ),
            changed_fields: vec!["role_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_org_member_details(
    ctx: &ReducerContext,
    user_org_id: u64,
    params: UpdateOrgMemberDetailsParams,
) -> Result<(), String> {
    let membership = ctx
        .db
        .user_organization()
        .id()
        .find(&user_org_id)
        .ok_or("User organization membership not found")?;

    check_permission(
        ctx,
        membership.organization_id,
        "user_organization",
        "write",
    )?;

    let updated_department_id = params.department_id.or(membership.department_id);
    let updated_job_title = params.job_title.or(membership.job_title.clone());
    let updated_employee_id = params.employee_id.or(membership.employee_id.clone());

    ctx.db.user_organization().id().update(UserOrganization {
        department_id: updated_department_id,
        job_title: updated_job_title.clone(),
        employee_id: updated_employee_id.clone(),
        ..membership
    });

    write_audit_log_v2(
        ctx,
        membership.organization_id,
        AuditLogParams {
            company_id: membership.company_id,
            table_name: "user_organization",
            record_id: user_org_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "department_id": membership.department_id,
                    "job_title": membership.job_title,
                    "employee_id": membership.employee_id,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "department_id": updated_department_id,
                    "job_title": updated_job_title,
                    "employee_id": updated_employee_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "department_id".to_string(),
                "job_title".to_string(),
                "employee_id".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_user_organization_status(
    ctx: &ReducerContext,
    user_org_id: u64,
    is_active: bool,
    is_default: bool,
) -> Result<(), String> {
    let membership = ctx
        .db
        .user_organization()
        .id()
        .find(&user_org_id)
        .ok_or("User organization membership not found")?;

    check_permission(
        ctx,
        membership.organization_id,
        "user_organization",
        "write",
    )?;

    ctx.db.user_organization().id().update(UserOrganization {
        is_active,
        is_default,
        ..membership
    });

    write_audit_log_v2(
        ctx,
        membership.organization_id,
        AuditLogParams {
            company_id: membership.company_id,
            table_name: "user_organization",
            record_id: user_org_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "is_active": membership.is_active,
                    "is_default": membership.is_default,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({ "is_active": is_active, "is_default": is_default }).to_string(),
            ),
            changed_fields: vec!["is_active".to_string(), "is_default".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Soft-deactivate a user's membership in an organization.
#[spacetimedb::reducer]
pub fn remove_user_from_organization(
    ctx: &ReducerContext,
    user_identity: Identity,
    organization_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "user_organization", "delete")?;

    let membership = ctx
        .db
        .user_organization()
        .iter()
        .find(|uo| {
            uo.user_identity == user_identity
                && uo.organization_id == organization_id
                && uo.is_active
        })
        .ok_or("User is not an active member of this organization")?;

    ctx.db.user_organization().id().update(UserOrganization {
        is_active: false,
        ..membership
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: membership.company_id,
            table_name: "user_organization",
            record_id: membership.id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "is_active": true }).to_string()),
            new_values: Some(serde_json::json!({ "is_active": false }).to_string()),
            changed_fields: vec!["is_active".to_string()],
            metadata: Some(
                serde_json::json!({
                    "user_identity": user_identity.to_hex().to_string(),
                })
                .to_string(),
            ),
        },
    );

    Ok(())
}

/// Register a client session.
#[spacetimedb::reducer]
pub fn create_user_session(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateUserSessionParams,
) -> Result<(), String> {
    let user = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("User not found")?;

    if !user.is_active {
        return Err("User account is inactive".to_string());
    }

    let expires_at = Timestamp::from_micros_since_unix_epoch(params.expires_at_micros as i64);

    let row = ctx.db.user_session().insert(UserSession {
        id: 0,
        user_identity: ctx.sender(),
        organization_id,
        session_token: params.session_token,
        ip_address: params.ip_address,
        user_agent: params.user_agent,
        device_info: params.device_info,
        started_at: ctx.timestamp,
        last_activity: ctx.timestamp,
        expires_at,
        // System-managed: always active when created
        is_active: true,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "user_session",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "user_identity": ctx.sender().to_hex().to_string(),
                    "expires_at_micros": params.expires_at_micros,
                })
                .to_string(),
            ),
            changed_fields: vec!["user_identity".to_string(), "expires_at".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Terminate a specific session. Only the session owner can end it.
#[spacetimedb::reducer]
pub fn end_user_session(ctx: &ReducerContext, session_id: u64) -> Result<(), String> {
    let session = ctx
        .db
        .user_session()
        .id()
        .find(&session_id)
        .ok_or("Session not found")?;

    if session.user_identity != ctx.sender() {
        return Err("Cannot end another user's session".to_string());
    }

    ctx.db.user_session().id().update(UserSession {
        is_active: false,
        ..session
    });

    write_audit_log_v2(
        ctx,
        session.organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "user_session",
            record_id: session_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "is_active": true }).to_string()),
            new_values: Some(serde_json::json!({ "is_active": false }).to_string()),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
