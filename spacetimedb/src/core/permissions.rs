/// Casbin-Style Permission System
///
/// Tables:  Role · CasbinRule · UserRoleAssignment
/// Pattern: Roles carry a `permissions` string list (`"resource:action"`).
///          CasbinRule provides fine-grained policy overrides (Casbin "p" / "g").
///          UserRoleAssignment links identities to roles within an organization.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::check_permission;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = role,
    public,
    index(accessor = role_by_org, btree(columns = [organization_id]))
)]
pub struct Role {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<u64>,
    /// Permission strings in the form `"resource:action"` or `"resource:*"`.
    pub permissions: Vec<String>,
    pub is_system: bool,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = casbin_rule,
    public,
    index(accessor = casbin_by_ptype, btree(columns = [ptype]))
)]
pub struct CasbinRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// `"p"` = policy rule, `"g"` = role-grouping rule.
    pub ptype: String,
    pub v0: Option<String>, // subject (role id or user identity)
    pub v1: Option<String>, // domain / organization_id
    pub v2: Option<String>, // object / resource
    pub v3: Option<String>, // action
    pub v4: Option<String>, // extra (effect, priority …)
    pub v5: Option<String>, // extra
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = user_role_assignment,
    public,
    index(accessor = role_assign_by_user, btree(columns = [user_identity])),
    index(accessor = role_assign_by_org,  btree(columns = [organization_id]))
)]
pub struct UserRoleAssignment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub user_identity: Identity,
    pub role_id: u64,
    pub organization_id: u64,
    pub assigned_by: Identity,
    pub assigned_at: Timestamp,
    pub expires_at: Option<Timestamp>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_role(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    description: Option<String>,
    parent_id: Option<u64>,
    permissions: Vec<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "role", "create")?;

    if name.is_empty() {
        return Err("Role name cannot be empty".to_string());
    }

    ctx.db.role().insert(Role {
        id: 0,
        organization_id,
        name,
        description,
        parent_id,
        permissions,
        is_system: false,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_role(
    ctx: &ReducerContext,
    role_id: u64,
    name: Option<String>,
    description: Option<String>,
    permissions: Option<Vec<String>>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let role = ctx.db.role().id().find(&role_id).ok_or("Role not found")?;

    if role.is_system {
        return Err("Cannot modify system roles".to_string());
    }

    check_permission(ctx, role.organization_id, "role", "write")?;

    ctx.db.role().id().update(Role {
        name: name.unwrap_or(role.name),
        description: description.or(role.description),
        permissions: permissions.unwrap_or(role.permissions),
        is_active: is_active.unwrap_or(role.is_active),
        updated_at: ctx.timestamp,
        ..role
    });

    Ok(())
}

/// Add a Casbin policy or grouping rule.
/// `ptype` must be `"p"` (policy) or `"g"` (grouping).
#[spacetimedb::reducer]
pub fn add_casbin_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    ptype: String,
    v0: Option<String>,
    v1: Option<String>,
    v2: Option<String>,
    v3: Option<String>,
    v4: Option<String>,
    v5: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "casbin_rule", "create")?;

    if ptype != "p" && ptype != "g" {
        return Err("ptype must be 'p' (policy) or 'g' (grouping)".to_string());
    }

    ctx.db.casbin_rule().insert(CasbinRule {
        id: 0,
        ptype,
        v0,
        v1,
        v2,
        v3,
        v4,
        v5,
        created_at: ctx.timestamp,
        metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn remove_casbin_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "casbin_rule", "delete")?;
    ctx.db.casbin_rule().id().delete(&rule_id);
    Ok(())
}

#[spacetimedb::reducer]
pub fn assign_role(
    ctx: &ReducerContext,
    user_identity: Identity,
    role_id: u64,
    organization_id: u64,
    expires_at_micros: Option<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "user_role_assignment", "create")?;

    let role = ctx.db.role().id().find(&role_id).ok_or("Role not found")?;

    if role.organization_id != organization_id {
        return Err("Role does not belong to this organization".to_string());
    }

    let already_assigned = ctx.db.user_role_assignment().iter().any(|a| {
        a.user_identity == user_identity
            && a.role_id == role_id
            && a.organization_id == organization_id
            && a.is_active
    });

    if already_assigned {
        return Err("User already has this role in this organization".to_string());
    }

    let expires_at = expires_at_micros.map(|m| Timestamp::from_micros_since_unix_epoch(m as i64));

    ctx.db.user_role_assignment().insert(UserRoleAssignment {
        id: 0,
        user_identity,
        role_id,
        organization_id,
        assigned_by: ctx.sender(),
        assigned_at: ctx.timestamp,
        expires_at,
        is_active: true,
        metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn revoke_role(
    ctx: &ReducerContext,
    organization_id: u64,
    assignment_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "user_role_assignment", "delete")?;

    let assignment = ctx
        .db
        .user_role_assignment()
        .id()
        .find(&assignment_id)
        .ok_or("Role assignment not found")?;

    ctx.db
        .user_role_assignment()
        .id()
        .update(UserRoleAssignment {
            is_active: false,
            ..assignment
        });

    Ok(())
}
