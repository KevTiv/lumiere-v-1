/// User Management & Authentication
///
/// Tables:  UserProfile · UserOrganization · UserSession
/// Pattern: UserProfile is keyed by SpacetimeDB `Identity` (auto-created on
///          first connect). UserOrganization links a user to an org+role.
///          UserSession tracks active client connections.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::core::organization::organization;
use crate::core::permissions::role;
use crate::helpers::check_permission;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(accessor = user_profile, public)]
pub struct UserProfile {
    #[primary_key]
    pub identity: Identity,
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

/// Update the calling user's own profile fields.
/// Clients cannot change `is_active` or `is_superuser` through this reducer.
#[spacetimedb::reducer]
pub fn update_user_profile(
    ctx: &ReducerContext,
    name: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    avatar_url: Option<String>,
    phone: Option<String>,
    mobile: Option<String>,
    timezone: Option<String>,
    language: Option<String>,
    signature: Option<String>,
    notification_preferences: Option<String>,
    ui_preferences: Option<String>,
) -> Result<(), String> {
    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("User profile not found")?;

    ctx.db.user_profile().identity().update(UserProfile {
        name: name.unwrap_or(profile.name),
        first_name: first_name.or(profile.first_name),
        last_name: last_name.or(profile.last_name),
        avatar_url: avatar_url.or(profile.avatar_url),
        phone: phone.or(profile.phone),
        mobile: mobile.or(profile.mobile),
        timezone: timezone.unwrap_or(profile.timezone),
        language: language.unwrap_or(profile.language),
        signature: signature.or(profile.signature),
        notification_preferences: notification_preferences.or(profile.notification_preferences),
        ui_preferences: ui_preferences.or(profile.ui_preferences),
        updated_at: ctx.timestamp,
        ..profile
    });

    Ok(())
}

/// Add a user to an organization with a given role.
/// Requires `user_organization:create` on the target organization.
#[spacetimedb::reducer]
pub fn add_user_to_organization(
    ctx: &ReducerContext,
    user_identity: Identity,
    organization_id: u64,
    role_id: u64,
    company_id: Option<u64>,
    job_title: Option<String>,
    // Additional fields
    department_id: Option<u64>,
    employee_id: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "user_organization", "create")?;

    ctx.db
        .organization()
        .id()
        .find(&organization_id)
        .ok_or("Organization not found")?;

    let role = ctx.db.role().id().find(&role_id).ok_or("Role not found")?;

    if role.organization_id != organization_id {
        return Err("Role does not belong to this organization".to_string());
    }

    let already_member = ctx.db.user_organization().iter().any(|uo| {
        uo.user_identity == user_identity && uo.organization_id == organization_id && uo.is_active
    });

    if already_member {
        return Err("User is already an active member of this organization".to_string());
    }

    ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity,
        organization_id,
        company_id,
        role_id,
        department_id,
        job_title,
        employee_id,
        date_joined: ctx.timestamp,
        is_active: true,
        is_default: false,
        metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_user_organization_details(
    ctx: &ReducerContext,
    user_org_id: u64,
    department_id: Option<u64>,
    job_title: Option<String>,
    employee_id: Option<String>,
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
        department_id: department_id.or(membership.department_id),
        job_title: job_title.or(membership.job_title),
        employee_id: employee_id.or(membership.employee_id),
        ..membership
    });

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

    Ok(())
}

/// Register a client session. `expires_at_micros` is microseconds since Unix epoch.
#[spacetimedb::reducer]
pub fn create_user_session(
    ctx: &ReducerContext,
    organization_id: u64,
    session_token: String,
    ip_address: Option<String>,
    user_agent: Option<String>,
    device_info: Option<String>,
    expires_at_micros: u64,
    metadata: Option<String>,
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

    let expires_at = Timestamp::from_micros_since_unix_epoch(expires_at_micros as i64);

    ctx.db.user_session().insert(UserSession {
        id: 0,
        user_identity: ctx.sender(),
        organization_id,
        session_token,
        ip_address,
        user_agent,
        device_info,
        started_at: ctx.timestamp,
        last_activity: ctx.timestamp,
        expires_at,
        is_active: true,
        metadata,
    });

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

    Ok(())
}
