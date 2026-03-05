/// Casbin-Style Permission System
///
/// Tables:  Role · CasbinRule · UserRoleAssignment
/// Pattern: Roles carry a `permissions` string list (`"resource:action"`).
///          CasbinRule provides fine-grained policy overrides (Casbin "p" / "g").
///          UserRoleAssignment links identities to roles within an organization.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::check_permission;

// ============================================================================
// PARAMS TYPES
// ============================================================================

/// Params for creating a role.
/// Scope: `organization_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateRoleParams {
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<u64>,
    pub permissions: Vec<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

/// Params for updating a role.
/// Scope: `role_id` is a flat reducer param.
/// Option fields: None = keep existing value.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateRoleParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub permissions: Option<Vec<String>>,
    pub is_active: Option<bool>,
}

/// Params for adding a Casbin policy or grouping rule.
/// Scope: `organization_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AddCasbinRuleParams {
    pub ptype: String,
    pub v0: Option<String>,
    pub v1: Option<String>,
    pub v2: Option<String>,
    pub v3: Option<String>,
    pub v4: Option<String>,
    pub v5: Option<String>,
    pub metadata: Option<String>,
}

/// Params for assigning a role to a user.
/// Scope: `user_identity` + `role_id` + `organization_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AssignRoleParams {
    pub expires_at_micros: Option<u64>,
    pub metadata: Option<String>,
}

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
    params: CreateRoleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "role", "create")?;

    if params.name.is_empty() {
        return Err("Role name cannot be empty".to_string());
    }

    ctx.db.role().insert(Role {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        parent_id: params.parent_id,
        permissions: params.permissions,
        // System-managed: user-created roles are never system roles
        is_system: false,
        is_active: params.is_active,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_role(
    ctx: &ReducerContext,
    role_id: u64,
    params: UpdateRoleParams,
) -> Result<(), String> {
    let role = ctx.db.role().id().find(&role_id).ok_or("Role not found")?;

    if role.is_system {
        return Err("Cannot modify system roles".to_string());
    }

    check_permission(ctx, role.organization_id, "role", "write")?;

    ctx.db.role().id().update(Role {
        name: params.name.unwrap_or(role.name),
        description: params.description.or(role.description),
        permissions: params.permissions.unwrap_or(role.permissions),
        is_active: params.is_active.unwrap_or(role.is_active),
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
    params: AddCasbinRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "casbin_rule", "create")?;

    if params.ptype != "p" && params.ptype != "g" {
        return Err("ptype must be 'p' (policy) or 'g' (grouping)".to_string());
    }

    ctx.db.casbin_rule().insert(CasbinRule {
        id: 0,
        ptype: params.ptype,
        v0: params.v0,
        v1: params.v1,
        v2: params.v2,
        v3: params.v3,
        v4: params.v4,
        v5: params.v5,
        created_at: ctx.timestamp,
        metadata: params.metadata,
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
    params: AssignRoleParams,
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

    let expires_at = params
        .expires_at_micros
        .map(|m| Timestamp::from_micros_since_unix_epoch(m as i64));

    ctx.db.user_role_assignment().insert(UserRoleAssignment {
        id: 0,
        user_identity,
        role_id,
        organization_id,
        assigned_by: ctx.sender(),
        assigned_at: ctx.timestamp,
        expires_at,
        // System-managed: always active when assigned
        is_active: true,
        metadata: params.metadata,
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
