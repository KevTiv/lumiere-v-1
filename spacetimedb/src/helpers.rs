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

/// Insert a structured audit log entry.
///
/// Call this inside any reducer that mutates important data.
/// `old_values` / `new_values` should be JSON-serialised representations
/// of the before/after state (use `serde_json::to_string` or build manually).
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
