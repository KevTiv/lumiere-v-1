/// Permission System
///
/// Tables:  Role · OrgPermission · FieldPermission · UserRoleAssignment
/// Pattern: Roles carry a `permissions` string list (`"resource:action"`).
///          OrgPermission provides typed fine-grained allow/deny rules.
///          FieldPermission provides column allowlists for read/write.
///          PolicySnapshot is a client projection rebuilt on policy mutations.
///          UserRoleAssignment links identities to roles within an organization.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::users::user_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

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

/// Params for assigning a role to a user.
/// Scope: `user_identity` + `role_id` + `organization_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AssignRoleParams {
    pub expires_at_micros: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSodConflictRuleParams {
    pub permission_a: String,
    pub permission_b: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateSodConflictRuleParams {
    pub permission_a: Option<String>,
    pub permission_b: Option<String>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct GrantDelegatedAdminScopeParams {
    pub user_identity: Identity,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum PermissionSubject {
    Role(u64),
    User(Identity),
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum PermissionAction {
    Read,
    Write,
    Create,
    Delete,
    All,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum PermissionEffect {
    Allow,
    Deny,
}

/// Params for `grant_permission`.
#[derive(SpacetimeType, Clone, Debug)]
pub struct GrantOrgPermissionParams {
    pub subject: PermissionSubject,
    pub resource: String,
    pub action: PermissionAction,
    pub effect: PermissionEffect,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum FieldPermissionAction {
    Read,
    Write,
}

/// Params for `grant_field_permission`.
#[derive(SpacetimeType, Clone, Debug)]
pub struct GrantFieldPermissionParams {
    pub subject: PermissionSubject,
    pub resource: String,
    pub action: FieldPermissionAction,
    pub allowed_fields: Vec<String>,
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
    accessor = org_permission,
    public,
    index(accessor = perm_by_org, btree(columns = [organization_id])),
    index(accessor = perm_by_role, btree(columns = [role_id]))
)]
pub struct OrgPermission {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub subject: PermissionSubject,
    /// Denormalized `Some(role_id)` when `subject` is [`PermissionSubject::Role`]; else `None`.
    pub role_id: Option<u64>,
    pub resource: String,
    pub action: PermissionAction,
    pub effect: PermissionEffect,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

/// Column allowlist for a subject on a resource (read or write).
#[spacetimedb::table(
    accessor = field_permission,
    public,
    index(accessor = field_perm_by_org, btree(columns = [organization_id])),
    index(accessor = field_perm_by_role, btree(columns = [role_id]))
)]
pub struct FieldPermission {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub subject: PermissionSubject,
    /// Denormalized `Some(role_id)` when `subject` is [`PermissionSubject::Role`]; else `None`.
    pub role_id: Option<u64>,
    pub resource: String,
    pub action: FieldPermissionAction,
    pub allowed_fields: Vec<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
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

/// Segregation-of-duties conflict: a user must not hold both permissions concurrently.
#[spacetimedb::table(
    accessor = sod_conflict_rule,
    public,
    index(accessor = sod_by_org, btree(columns = [organization_id]))
)]
pub struct SodConflictRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub permission_a: String,
    pub permission_b: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

/// Company-scoped delegated administrator — may manage users/roles for one company only.
#[spacetimedb::table(
    accessor = delegated_admin_scope,
    public,
    index(accessor = delegated_admin_by_org, btree(columns = [organization_id])),
    index(accessor = delegated_admin_by_user, btree(columns = [user_identity]))
)]
pub struct DelegatedAdminScope {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub user_identity: spacetimedb::Identity,
    pub granted_by: spacetimedb::Identity,
    pub granted_at: Timestamp,
    pub is_active: bool,
    pub metadata: Option<String>,
}

// ── Policy snapshot (unified permission cache per user/org) ───────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct PolicyActionGrant {
    pub resource: String,
    pub action: String,
    pub effect: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PolicyFieldPermission {
    pub resource: String,
    pub fields: Vec<String>,
}

#[spacetimedb::table(
    accessor = policy_snapshot,
    public,
    index(accessor = policy_snapshot_by_user, btree(columns = [organization_id, user_identity]))
)]
pub struct PolicySnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub user_identity: Identity,
    pub role_id: u64,
    pub role_name: String,
    pub role_permissions: Vec<String>,
    pub org_permission_grants: Vec<PolicyActionGrant>,
    pub field_permissions: Vec<PolicyFieldPermission>,
    pub is_superuser: bool,
    pub version_hash: String,
    pub refreshed_at: Timestamp,
}

fn permission_action_label(action: &PermissionAction) -> &'static str {
    match action {
        PermissionAction::Read => "read",
        PermissionAction::Write => "write",
        PermissionAction::Create => "create",
        PermissionAction::Delete => "delete",
        PermissionAction::All => "*",
    }
}

fn permission_effect_label(effect: &PermissionEffect) -> &'static str {
    match effect {
        PermissionEffect::Allow => "allow",
        PermissionEffect::Deny => "deny",
    }
}

fn org_permission_applies_to_user(
    p: &OrgPermission,
    user_identity: Identity,
    role_id: u64,
) -> bool {
    match &p.subject {
        PermissionSubject::Role(r) => *r == role_id,
        PermissionSubject::User(id) => *id == user_identity,
    }
}

fn field_permission_applies_to_user(
    p: &FieldPermission,
    user_identity: Identity,
    role_id: u64,
) -> bool {
    match &p.subject {
        PermissionSubject::Role(r) => *r == role_id,
        PermissionSubject::User(id) => *id == user_identity,
    }
}

fn field_resource_matches(configured: &str, requested: &str) -> bool {
    if configured == "*" || configured == requested {
        return true;
    }
    let configured_norm = configured.replace('-', "_");
    let requested_norm = requested.replace('-', "_");
    configured_norm == requested_norm
}

fn field_permission_action_label(action: &FieldPermissionAction) -> &'static str {
    match action {
        FieldPermissionAction::Read => "read",
        FieldPermissionAction::Write => "write",
    }
}

fn fnv1a_hash(parts: &[&str]) -> String {
    let mut hash: u64 = 14695981039346656037;
    for part in parts {
        for byte in part.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(1099511628211);
        }
        hash ^= u64::from(b'|');
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{:016x}", hash)
}

pub(crate) fn build_policy_snapshot_row(
    ctx: &ReducerContext,
    organization_id: u64,
    user_identity: Identity,
) -> Result<PolicySnapshot, String> {
    use crate::core::users::user_profile;

    let user = ctx
        .db
        .user_profile()
        .identity()
        .find(user_identity)
        .ok_or("User not found")?;

    let user_org = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&user_identity)
        .find(|uo| uo.organization_id == organization_id && uo.is_active)
        .ok_or("Not a member of this organization")?;

    let role = ctx
        .db
        .role()
        .id()
        .find(&user_org.role_id)
        .ok_or("Role not found")?;

    let mut org_permission_grants = Vec::new();
    let mut hash_parts: Vec<String> = Vec::new();

    hash_parts.push(format!("role:{}", role.id));
    hash_parts.push(format!("perms:{}", role.permissions.join(",")));

    for p in ctx
        .db
        .org_permission()
        .perm_by_org()
        .filter(&organization_id)
    {
        if !org_permission_applies_to_user(&p, user_identity, role.id) {
            continue;
        }
        let action = permission_action_label(&p.action).to_string();
        let effect = permission_effect_label(&p.effect).to_string();
        org_permission_grants.push(PolicyActionGrant {
            resource: p.resource.clone(),
            action: action.clone(),
            effect: effect.clone(),
        });
        hash_parts.push(format!("op:{}:{}:{}:{}", p.id, p.resource, action, effect));
    }

    let mut field_permissions = Vec::new();
    for p in ctx
        .db
        .field_permission()
        .field_perm_by_org()
        .filter(&organization_id)
    {
        if !field_permission_applies_to_user(&p, user_identity, role.id) {
            continue;
        }
        // Snapshot surfaces read allowlists for UI/API column projection.
        if p.action != FieldPermissionAction::Read {
            hash_parts.push(format!(
                "fpw:{}:{}:{}",
                p.id,
                p.resource,
                p.allowed_fields.join(",")
            ));
            continue;
        }
        hash_parts.push(format!(
            "fp:{}:{}:{}",
            p.id,
            p.resource,
            p.allowed_fields.join(",")
        ));
        field_permissions.push(PolicyFieldPermission {
            resource: p.resource.clone(),
            fields: p.allowed_fields.clone(),
        });
    }

    let version_hash = fnv1a_hash(&hash_parts.iter().map(String::as_str).collect::<Vec<_>>());

    Ok(PolicySnapshot {
        id: 0,
        organization_id,
        user_identity,
        role_id: role.id,
        role_name: role.name.clone(),
        role_permissions: role.permissions.clone(),
        org_permission_grants,
        field_permissions,
        is_superuser: user.is_superuser,
        version_hash,
        refreshed_at: ctx.timestamp,
    })
}

pub(crate) fn upsert_policy_snapshot(
    ctx: &ReducerContext,
    snapshot: PolicySnapshot,
) -> Result<u64, String> {
    let organization_id = snapshot.organization_id;
    let user_identity = snapshot.user_identity;

    if let Some(existing) =
        ctx.db.policy_snapshot().iter().find(|row| {
            row.organization_id == organization_id && row.user_identity == user_identity
        })
    {
        let record_id = existing.id;
        ctx.db.policy_snapshot().id().update(PolicySnapshot {
            id: record_id,
            ..snapshot
        });
        Ok(record_id)
    } else {
        let row = ctx.db.policy_snapshot().insert(snapshot);
        Ok(row.id)
    }
}

fn collect_identities_for_role(
    ctx: &ReducerContext,
    organization_id: u64,
    role_id: u64,
) -> Vec<Identity> {
    let mut identities = Vec::new();
    for uo in
        ctx.db.user_organization().iter().filter(|uo| {
            uo.organization_id == organization_id && uo.role_id == role_id && uo.is_active
        })
    {
        identities.push(uo.user_identity);
    }
    for assignment in ctx
        .db
        .user_role_assignment()
        .role_assign_by_org()
        .filter(&organization_id)
        .filter(|a| a.role_id == role_id && a.is_active)
    {
        identities.push(assignment.user_identity);
    }
    identities.sort_by_key(|id| id.to_hex().to_string());
    identities.dedup();
    identities
}

pub(crate) fn touch_policy_snapshot_for_user(
    ctx: &ReducerContext,
    organization_id: u64,
    user_identity: Identity,
) {
    if let Ok(snapshot) = build_policy_snapshot_row(ctx, organization_id, user_identity) {
        let _ = upsert_policy_snapshot(ctx, snapshot);
    }
}

pub(crate) fn touch_policy_snapshots_for_role(
    ctx: &ReducerContext,
    organization_id: u64,
    role_id: u64,
) {
    for identity in collect_identities_for_role(ctx, organization_id, role_id) {
        touch_policy_snapshot_for_user(ctx, organization_id, identity);
    }
}

pub(crate) fn touch_policy_snapshots_for_subject(
    ctx: &ReducerContext,
    organization_id: u64,
    subject: &PermissionSubject,
) {
    match subject {
        PermissionSubject::Role(role_id) => {
            touch_policy_snapshots_for_role(ctx, organization_id, *role_id);
        }
        PermissionSubject::User(user_identity) => {
            touch_policy_snapshot_for_user(ctx, organization_id, *user_identity);
        }
    }
}

fn permission_strings_for_user(
    ctx: &ReducerContext,
    organization_id: u64,
    user_identity: Identity,
    extra_role_id: Option<u64>,
) -> Result<Vec<String>, String> {
    let mut perms: Vec<String> = Vec::new();

    for assignment in ctx
        .db
        .user_role_assignment()
        .role_assign_by_user()
        .filter(&user_identity)
        .filter(|a| a.organization_id == organization_id && a.is_active)
    {
        if let Some(role) = ctx.db.role().id().find(&assignment.role_id) {
            perms.extend(role.permissions.clone());
        }
    }

    if let Some(role_id) = extra_role_id {
        if let Some(role) = ctx.db.role().id().find(&role_id) {
            if role.organization_id == organization_id {
                perms.extend(role.permissions.clone());
            }
        }
    }

    perms.sort();
    perms.dedup();
    Ok(perms)
}

fn permission_set_has(permissions: &[String], needle: &str) -> bool {
    if permissions.iter().any(|p| p == "*:*") {
        return true;
    }
    if let Some((resource, _action)) = needle.split_once(':') {
        let wildcard = format!("{resource}:*");
        return permissions.iter().any(|p| p == needle || p == &wildcard);
    }
    false
}

pub(crate) fn validate_sod_for_permissions(
    ctx: &ReducerContext,
    organization_id: u64,
    permissions: &[String],
) -> Result<(), String> {
    if permission_set_has(permissions, "*:*") {
        return Ok(());
    }

    for rule in ctx
        .db
        .sod_conflict_rule()
        .sod_by_org()
        .filter(&organization_id)
        .filter(|r| r.is_active)
    {
        if permission_set_has(permissions, &rule.permission_a)
            && permission_set_has(permissions, &rule.permission_b)
        {
            return Err(format!(
                "segregation of duties conflict: {} and {} cannot be held together",
                rule.permission_a, rule.permission_b
            ));
        }
    }
    Ok(())
}

fn caller_delegated_company_scope(ctx: &ReducerContext, organization_id: u64) -> Option<u64> {
    ctx.db
        .delegated_admin_scope()
        .delegated_admin_by_user()
        .filter(&ctx.sender())
        .find(|s| s.organization_id == organization_id && s.is_active)
        .map(|s| s.company_id)
}

pub(crate) fn ensure_delegated_admin_may_assign_role(
    ctx: &ReducerContext,
    organization_id: u64,
    role: &Role,
) -> Result<(), String> {
    let Some(scope_company_id) = caller_delegated_company_scope(ctx, organization_id) else {
        return Ok(());
    };

    if role.permissions.iter().any(|p| p == "*:*") {
        return Err("delegated administrators cannot assign organization owner roles".to_string());
    }

    if role.name == "owner" || role.is_system {
        return Err("delegated administrators cannot assign system or owner roles".to_string());
    }

    let _ = scope_company_id;
    Ok(())
}

pub(crate) fn ensure_delegated_admin_may_grant_permission(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    if caller_delegated_company_scope(ctx, organization_id).is_some() {
        return Err("delegated administrators cannot grant org permissions".to_string());
    }
    Ok(())
}

/// Field-permission resources must exist in the canonical query resource registry
/// (`crates/stdb-auth/assets/resource_registry.json`), including aliases.
fn ensure_field_permission_resource_registered(resource: &str) -> Result<(), String> {
    if resource == "*" {
        return Ok(());
    }
    let registry: serde_json::Value = serde_json::from_str(include_str!(
        "../../../crates/stdb-auth/assets/resource_registry.json"
    ))
    .map_err(|e| format!("resource registry parse error: {e}"))?;
    let obj = registry
        .as_object()
        .ok_or_else(|| "resource registry must be a JSON object".to_string())?;
    if obj.contains_key(resource) {
        return Ok(());
    }
    for entry in obj.values() {
        if let Some(aliases) = entry.get("aliases").and_then(|a| a.as_array()) {
            if aliases.iter().any(|alias| alias.as_str() == Some(resource)) {
                return Ok(());
            }
        }
    }
    Err(format!(
        "Unknown field-permission resource '{resource}' — must be a registry key or alias"
    ))
}

/// When field write allowlists exist for the caller, changed fields must stay in the allow-list.
pub(crate) fn ensure_resource_fields_writable(
    ctx: &ReducerContext,
    organization_id: u64,
    user_identity: Identity,
    role_id: u64,
    _role_name: &str,
    is_superuser: bool,
    resource: &str,
    changed_fields: &[String],
) -> Result<(), String> {
    if is_superuser || changed_fields.is_empty() {
        return Ok(());
    }

    let mut allowed: Option<Vec<String>> = None;
    for rule in ctx
        .db
        .field_permission()
        .field_perm_by_org()
        .filter(&organization_id)
    {
        if rule.action != FieldPermissionAction::Write {
            continue;
        }
        if !field_permission_applies_to_user(&rule, user_identity, role_id) {
            continue;
        }
        if !field_resource_matches(&rule.resource, resource) {
            continue;
        }
        allowed = Some(rule.allowed_fields.clone());
        break;
    }

    let Some(allowed_fields) = allowed else {
        return Ok(());
    };

    for field in changed_fields {
        if !allowed_fields.iter().any(|f| f == field) {
            return Err(format!(
                "field '{field}' is not writable under column-level write policy"
            ));
        }
    }
    Ok(())
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

    let row = ctx.db.role().insert(Role {
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "role",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": row.name,
                    "permissions": row.permissions,
                    "is_active": row.is_active,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "permissions".to_string(),
                "is_active".to_string(),
            ],
            metadata: None,
        },
    );

    touch_policy_snapshots_for_role(ctx, organization_id, row.id);

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

    let old_values = serde_json::json!({
        "name": &role.name,
        "description": &role.description,
        "permissions": &role.permissions,
        "is_active": role.is_active,
    })
    .to_string();
    let organization_id = role.organization_id;

    let updated_name = params.name.unwrap_or_else(|| role.name.clone());
    let updated_description = params.description.or_else(|| role.description.clone());
    let updated_permissions = params
        .permissions
        .unwrap_or_else(|| role.permissions.clone());
    let updated_is_active = params.is_active.unwrap_or(role.is_active);
    let mut changed_fields = Vec::new();
    if updated_name != role.name {
        changed_fields.push("name".to_string());
    }
    if updated_description != role.description {
        changed_fields.push("description".to_string());
    }
    if updated_permissions != role.permissions {
        changed_fields.push("permissions".to_string());
    }
    if updated_is_active != role.is_active {
        changed_fields.push("is_active".to_string());
    }

    ctx.db.role().id().update(Role {
        name: updated_name.clone(),
        description: updated_description.clone(),
        permissions: updated_permissions.clone(),
        is_active: updated_is_active,
        updated_at: ctx.timestamp,
        ..role
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "role",
            record_id: role_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: Some(
                serde_json::json!({
                    "name": updated_name,
                    "description": updated_description,
                    "permissions": updated_permissions,
                    "is_active": updated_is_active,
                })
                .to_string(),
            ),
            changed_fields,
            metadata: None,
        },
    );

    touch_policy_snapshots_for_role(ctx, organization_id, role_id);

    Ok(())
}

#[spacetimedb::reducer]
pub fn grant_field_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    params: GrantFieldPermissionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "field_permission", "create")?;
    ensure_delegated_admin_may_grant_permission(ctx, organization_id)?;

    if params.resource.is_empty() {
        return Err("resource cannot be empty".to_string());
    }
    ensure_field_permission_resource_registered(&params.resource)?;
    if params.allowed_fields.is_empty() {
        return Err("allowed_fields cannot be empty".to_string());
    }

    let role_id = match &params.subject {
        PermissionSubject::Role(rid) => Some(*rid),
        PermissionSubject::User(_) => None,
    };

    // Replace existing allowlist for the same subject/resource/action.
    let existing: Vec<u64> = ctx
        .db
        .field_permission()
        .field_perm_by_org()
        .filter(&organization_id)
        .filter(|row| {
            row.subject == params.subject
                && row.resource == params.resource
                && row.action == params.action
        })
        .map(|row| row.id)
        .collect();
    for id in existing {
        ctx.db.field_permission().id().delete(&id);
    }

    let row = ctx.db.field_permission().insert(FieldPermission {
        id: 0,
        organization_id,
        subject: params.subject.clone(),
        role_id,
        resource: params.resource.clone(),
        action: params.action.clone(),
        allowed_fields: params.allowed_fields.clone(),
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "field_permission",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "resource": params.resource,
                    "action": field_permission_action_label(&params.action),
                    "allowed_fields": params.allowed_fields,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "resource".to_string(),
                "action".to_string(),
                "allowed_fields".to_string(),
            ],
            metadata: None,
        },
    );

    touch_policy_snapshots_for_subject(ctx, organization_id, &params.subject);

    Ok(())
}

#[spacetimedb::reducer]
pub fn revoke_field_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    permission_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "field_permission", "delete")?;

    let row = ctx
        .db
        .field_permission()
        .id()
        .find(&permission_id)
        .ok_or("Field permission not found")?;

    if row.organization_id != organization_id {
        return Err("Field permission does not belong to this organization".to_string());
    }

    let subject = row.subject.clone();
    let old_values = serde_json::json!({
        "resource": row.resource,
        "action": field_permission_action_label(&row.action),
        "allowed_fields": row.allowed_fields,
    })
    .to_string();

    ctx.db.field_permission().id().delete(&permission_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "field_permission",
            record_id: permission_id,
            action: "DELETE",
            old_values: Some(old_values),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    touch_policy_snapshots_for_subject(ctx, organization_id, &subject);

    Ok(())
}

#[spacetimedb::reducer]
pub fn grant_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    params: GrantOrgPermissionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "org_permission", "create")?;
    ensure_delegated_admin_may_grant_permission(ctx, organization_id)?;

    if params.resource.is_empty() {
        return Err("resource cannot be empty".to_string());
    }

    let role_id = match &params.subject {
        PermissionSubject::Role(rid) => Some(*rid),
        PermissionSubject::User(_) => None,
    };

    let row = ctx.db.org_permission().insert(OrgPermission {
        id: 0,
        organization_id,
        subject: params.subject.clone(),
        role_id,
        resource: params.resource.clone(),
        action: params.action.clone(),
        effect: params.effect.clone(),
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "org_permission",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "resource": params.resource,
                    "action": format!("{:?}", params.action),
                    "effect": format!("{:?}", params.effect),
                })
                .to_string(),
            ),
            changed_fields: vec![
                "resource".to_string(),
                "action".to_string(),
                "effect".to_string(),
            ],
            metadata: None,
        },
    );

    touch_policy_snapshots_for_subject(ctx, organization_id, &params.subject);

    Ok(())
}

#[spacetimedb::reducer]
pub fn revoke_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    permission_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "org_permission", "delete")?;

    let row = ctx
        .db
        .org_permission()
        .id()
        .find(&permission_id)
        .ok_or("Permission not found")?;

    if row.organization_id != organization_id {
        return Err("Permission does not belong to this organization".to_string());
    }

    let subject = row.subject.clone();
    let old_values = serde_json::json!({
        "resource": row.resource,
        "action": format!("{:?}", row.action),
        "effect": format!("{:?}", row.effect),
    })
    .to_string();

    ctx.db.org_permission().id().delete(&permission_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "org_permission",
            record_id: permission_id,
            action: "DELETE",
            old_values: Some(old_values),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    touch_policy_snapshots_for_subject(ctx, organization_id, &subject);

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_sod_conflict_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateSodConflictRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "role", "create")?;

    if params.permission_a.is_empty() || params.permission_b.is_empty() {
        return Err("Both permission_a and permission_b are required".to_string());
    }
    if params.permission_a == params.permission_b {
        return Err("SoD rule permissions must differ".to_string());
    }

    let row = ctx.db.sod_conflict_rule().insert(SodConflictRule {
        id: 0,
        organization_id,
        permission_a: params.permission_a.clone(),
        permission_b: params.permission_b.clone(),
        description: params.description.clone(),
        is_active: params.is_active,
        created_at: ctx.timestamp,
        metadata: params.metadata.clone(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "sod_conflict_rule",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "permission_a": params.permission_a,
                    "permission_b": params.permission_b,
                    "is_active": params.is_active,
                })
                .to_string(),
            ),
            changed_fields: vec!["permission_a".to_string(), "permission_b".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_sod_conflict_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    rule_id: u64,
    params: UpdateSodConflictRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "role", "update")?;

    let rule = ctx
        .db
        .sod_conflict_rule()
        .id()
        .find(&rule_id)
        .ok_or("SoD conflict rule not found")?;

    if rule.organization_id != organization_id {
        return Err("SoD conflict rule does not belong to this organization".to_string());
    }

    let permission_a = params
        .permission_a
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(rule.permission_a.clone());
    let permission_b = params
        .permission_b
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(rule.permission_b.clone());

    if permission_a == permission_b {
        return Err("SoD rule permissions must differ".to_string());
    }

    let old_values = serde_json::json!({
        "permission_a": rule.permission_a,
        "permission_b": rule.permission_b,
        "is_active": rule.is_active,
    })
    .to_string();

    let mut changed_fields = Vec::new();
    if params.permission_a.is_some() {
        changed_fields.push("permission_a".to_string());
    }
    if params.permission_b.is_some() {
        changed_fields.push("permission_b".to_string());
    }
    if params.description.is_some() {
        changed_fields.push("description".to_string());
    }
    if params.is_active.is_some() {
        changed_fields.push("is_active".to_string());
    }
    if params.metadata.is_some() {
        changed_fields.push("metadata".to_string());
    }

    ctx.db.sod_conflict_rule().id().update(SodConflictRule {
        permission_a: permission_a.clone(),
        permission_b: permission_b.clone(),
        description: params.description.or(rule.description),
        is_active: params.is_active.unwrap_or(rule.is_active),
        metadata: params.metadata.or(rule.metadata),
        ..rule
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "sod_conflict_rule",
            record_id: rule_id,
            action: if params.is_active == Some(false) {
                "SET_ACTIVE"
            } else {
                "UPDATE"
            },
            old_values: Some(old_values),
            new_values: Some(
                serde_json::json!({
                    "permission_a": permission_a,
                    "permission_b": permission_b,
                    "is_active": params.is_active.unwrap_or(rule.is_active),
                })
                .to_string(),
            ),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn grant_delegated_admin_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: GrantDelegatedAdminScopeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "user_role_assignment", "create")?;
    crate::core::organization::require_company_in_organization(ctx, organization_id, company_id)?;

    if caller_delegated_company_scope(ctx, organization_id).is_some() {
        return Err("delegated administrators cannot grant delegated admin scope".to_string());
    }

    let existing = ctx
        .db
        .delegated_admin_scope()
        .delegated_admin_by_user()
        .filter(&params.user_identity)
        .find(|s| {
            s.organization_id == organization_id && s.company_id == company_id && s.is_active
        });

    if existing.is_some() {
        return Err("User already has delegated admin scope for this company".to_string());
    }

    let row = ctx.db.delegated_admin_scope().insert(DelegatedAdminScope {
        id: 0,
        organization_id,
        company_id,
        user_identity: params.user_identity,
        granted_by: ctx.sender(),
        granted_at: ctx.timestamp,
        is_active: true,
        metadata: params.metadata.clone(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "delegated_admin_scope",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "user_identity": params.user_identity.to_hex().to_string(),
                    "company_id": company_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["user_identity".to_string(), "company_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn revoke_delegated_admin_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    scope_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "user_role_assignment", "delete")?;

    let scope = ctx
        .db
        .delegated_admin_scope()
        .id()
        .find(&scope_id)
        .ok_or("Delegated admin scope not found")?;

    if scope.organization_id != organization_id {
        return Err("Delegated admin scope does not belong to this organization".to_string());
    }

    if !scope.is_active {
        return Err("Delegated admin scope is already inactive".to_string());
    }

    let old_values = serde_json::json!({
        "user_identity": scope.user_identity.to_hex().to_string(),
        "company_id": scope.company_id,
        "is_active": scope.is_active,
    })
    .to_string();

    ctx.db
        .delegated_admin_scope()
        .id()
        .update(DelegatedAdminScope {
            is_active: false,
            ..scope
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(scope.company_id),
            table_name: "delegated_admin_scope",
            record_id: scope_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: Some(
                serde_json::json!({
                    "user_identity": scope.user_identity.to_hex().to_string(),
                    "company_id": scope.company_id,
                    "is_active": false,
                })
                .to_string(),
            ),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );

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

    ensure_delegated_admin_may_assign_role(ctx, organization_id, &role)?;

    let effective_permissions =
        permission_strings_for_user(ctx, organization_id, user_identity, Some(role_id))?;
    validate_sod_for_permissions(ctx, organization_id, &effective_permissions)?;

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

    let row = ctx.db.user_role_assignment().insert(UserRoleAssignment {
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "user_role_assignment",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "user_identity": user_identity.to_hex().to_string(),
                    "role_id": role_id,
                    "is_active": row.is_active,
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

    touch_policy_snapshot_for_user(ctx, organization_id, user_identity);

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

    if assignment.organization_id != organization_id {
        return Err("Role assignment does not belong to this organization".to_string());
    }

    let old_values = serde_json::json!({
        "user_identity": assignment.user_identity.to_hex().to_string(),
        "role_id": assignment.role_id,
        "is_active": assignment.is_active,
    })
    .to_string();

    let user_identity = assignment.user_identity;
    let role_id = assignment.role_id;

    ctx.db
        .user_role_assignment()
        .id()
        .update(UserRoleAssignment {
            is_active: false,
            ..assignment
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "user_role_assignment",
            record_id: assignment_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: Some(
                serde_json::json!({
                    "user_identity": user_identity.to_hex().to_string(),
                    "role_id": role_id,
                    "is_active": false,
                })
                .to_string(),
            ),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );

    touch_policy_snapshot_for_user(ctx, organization_id, user_identity);

    Ok(())
}

/// Rebuild and cache the unified permission snapshot for the caller in an organization.
#[spacetimedb::reducer]
pub fn refresh_policy_snapshot(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    let snapshot = build_policy_snapshot_row(ctx, organization_id, ctx.sender())?;
    upsert_policy_snapshot(ctx, snapshot)?;
    Ok(())
}

/// Seed / bootstrap: insert a typed permission row without `check_permission`.
pub(crate) fn seed_insert_org_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    subject: PermissionSubject,
    resource: String,
    action: PermissionAction,
    effect: PermissionEffect,
) {
    let role_id = match &subject {
        PermissionSubject::Role(rid) => Some(*rid),
        PermissionSubject::User(_) => None,
    };
    ctx.db.org_permission().insert(OrgPermission {
        id: 0,
        organization_id,
        subject,
        role_id,
        resource,
        action,
        effect,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
}
