/// Cross-cutting helpers available to every domain module.
///
/// - `check_permission` — multi-tenant RBAC + Casbin policy check
/// - `write_audit_log`  — structured audit trail insert
///
/// To add a new helper: add the function here and `use crate::helpers::…`
/// in the domain module that needs it.
use spacetimedb::{ReducerContext, Table};

use crate::core::audit::{audit_log, AuditLog};
use crate::core::permissions::{casbin_rule, role};
use crate::core::users::{user_organization, user_profile};

/// Returns `Ok(())` when the calling identity holds `resource:action`
/// in `organization_id`, `Err(reason)` otherwise.
///
/// Resolution order:
///   1. Superuser → always allowed
///   2. Role.permissions string list (`"resource:action"` or `"resource:*"`)
///   3. CasbinRule table (policy type `"p"`)
pub fn check_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    resource: &str,
    action: &str,
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

    if user.is_superuser {
        return Ok(());
    }

    let user_org = ctx
        .db
        .user_organization()
        .iter()
        .find(|uo| {
            uo.user_identity == ctx.sender()
                && uo.organization_id == organization_id
                && uo.is_active
        })
        .ok_or("Not a member of this organization")?;

    let role = ctx
        .db
        .role()
        .id()
        .find(&user_org.role_id)
        .ok_or("Role not found")?;

    let permission = format!("{}:{}", resource, action);
    let wildcard = format!("{}:*", resource);
    let global_wildcard = "*:*".to_string();

    if role.permissions.contains(&permission)
        || role.permissions.contains(&wildcard)
        || role.permissions.contains(&global_wildcard)
    {
        return Ok(());
    }

    // Fine-grained Casbin override check
    let role_str = role.id.to_string();
    let org_str = organization_id.to_string();
    let has_casbin = ctx
        .db
        .casbin_rule()
        .casbin_by_ptype()
        .filter(&"p".to_string())
        .any(|r| {
            r.v0.as_deref() == Some(&role_str)
                && r.v1.as_deref() == Some(&org_str)
                && r.v2.as_deref() == Some(resource)
                && (r.v3.as_deref() == Some(action) || r.v3.as_deref() == Some("*"))
        });

    if has_casbin {
        return Ok(());
    }

    Err(format!("Permission denied: {} on {}", action, resource))
}

/// Params for `write_audit_log_v2`. All fields are named — no positional `None` ambiguity.
/// Use this for all new reducer code. Prefer over `write_audit_log`.
#[derive(Clone, Debug)]
pub struct AuditLogParams {
    pub company_id: Option<u64>,
    pub table_name: &'static str,
    pub record_id: u64,
    pub action: &'static str,
    pub old_values: Option<String>,
    pub new_values: Option<String>,
    pub changed_fields: Vec<String>,
    pub metadata: Option<String>,
}

/// Struct-based audit log writer. Preferred over `write_audit_log` for new code.
///
/// Context-derived fields (never passed by callers):
/// - `session_id`  — lower 64 bits of `ctx.connection_id()` (128-bit session token)
/// - `ip_address`  — not available in SpacetimeDB 2.0.1 WASM sandbox; always None
/// - `user_agent`  — not available in SpacetimeDB 2.0.1 WASM sandbox; always None
pub fn write_audit_log_v2(ctx: &ReducerContext, organization_id: u64, params: AuditLogParams) {
    let session_id = ctx.connection_id().map(|c| c.to_u128() as u64);
    ctx.db.audit_log().insert(AuditLog {
        id: 0,
        organization_id,
        company_id: params.company_id,
        table_name: params.table_name.to_string(),
        record_id: params.record_id,
        action: params.action.to_string(),
        old_values: params.old_values,
        new_values: params.new_values,
        changed_fields: params.changed_fields,
        user_identity: ctx.sender(),
        session_id,
        ip_address: None,
        user_agent: None,
        timestamp: ctx.timestamp,
        metadata: params.metadata,
    });
}

/// Insert a structured audit log entry.
///
/// Call this inside any reducer that mutates important data.
/// `old_values` / `new_values` should be JSON-serialised representations
/// of the before/after state (use `serde_json::to_string` or build manually).
/// @deprecated — use `write_audit_log_v2` with `AuditLogParams` for new code.
pub fn write_audit_log(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    table_name: &str,
    record_id: u64,
    action: &str,
    old_values: Option<String>,
    new_values: Option<String>,
    changed_fields: Vec<String>,
) {
    ctx.db.audit_log().insert(AuditLog {
        id: 0,
        organization_id,
        company_id,
        table_name: table_name.to_string(),
        record_id,
        action: action.to_string(),
        old_values,
        new_values,
        changed_fields,
        user_identity: ctx.sender(),
        session_id: None,
        ip_address: None,
        user_agent: None,
        timestamp: ctx.timestamp,
        metadata: None,
    });
}
