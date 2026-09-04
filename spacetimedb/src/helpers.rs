/// Cross-cutting helpers available to every domain module.
///
/// - `check_permission`  — multi-tenant RBAC check
/// - `write_audit_log`   — structured audit trail insert
/// - `calculate_tax`     — compute tax amount from AccountTax records
///
/// To add a new helper: add the function here and `use crate::helpers::…`
/// in the domain module that needs it.
use spacetimedb::{Identity, ReducerContext, Table};

use crate::accounting::tax_management::account_tax;
use crate::core::audit::{audit_log, AuditLog};
use crate::core::permissions::{
    org_permission, role, PermissionAction, PermissionEffect, PermissionSubject,
};
use crate::core::reference::{document_sequence, DocumentSequence};
use crate::core::users::{find_user_profile_for_organization, user_organization};
use crate::types::TaxAmountType;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PermissionResolution {
    Allow,
    Deny,
    NotGranted,
}

/// Core permission resolution for a known org membership + role context.
///
/// Resolution order:
///   1. Superuser → Allow
///   2. Role.permissions string list (`"resource:action"` or `"resource:*"`)
///   3. OrgPermission rows for the org (explicit **Deny** wins over **Allow**)
pub fn resolve_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    user_identity: Identity,
    role_id: u64,
    _role_name: &str,
    role_permissions: &[String],
    is_superuser: bool,
    resource: &str,
    action: &str,
) -> PermissionResolution {
    if is_superuser {
        return PermissionResolution::Allow;
    }

    let permission = format!("{}:{}", resource, action);
    let wildcard = format!("{}:*", resource);
    let global_wildcard = "*:*".to_string();

    if role_permissions.contains(&permission)
        || role_permissions.contains(&wildcard)
        || role_permissions.contains(&global_wildcard)
    {
        return PermissionResolution::Allow;
    }

    if let Some(r) = try_org_permission(
        ctx,
        organization_id,
        resource,
        action,
        role_id,
        user_identity,
    ) {
        return match r {
            Ok(()) => PermissionResolution::Allow,
            Err(_) => PermissionResolution::Deny,
        };
    }

    PermissionResolution::NotGranted
}

/// Returns `Ok(())` when allowed, `Err(reason)` otherwise.
pub fn check_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    resource: &str,
    action: &str,
) -> Result<(), String> {
    if action != "read" {
        crate::core::reconstruction::require_writes_unfenced(ctx, organization_id)?;
    }
    let user = find_user_profile_for_organization(ctx, ctx.sender(), organization_id)
        .ok_or("User not found")?;

    if !user.is_active {
        return Err("User account is inactive".to_string());
    }

    let user_org = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|uo| uo.organization_id == organization_id && uo.is_active)
        .ok_or("Not a member of this organization")?;

    let role = ctx
        .db
        .role()
        .id()
        .find(&user_org.role_id)
        .ok_or("Role not found")?;

    match resolve_permission(
        ctx,
        organization_id,
        ctx.sender(),
        role.id,
        &role.name,
        &role.permissions,
        user.is_superuser,
        resource,
        action,
    ) {
        PermissionResolution::Allow => Ok(()),
        PermissionResolution::Deny | PermissionResolution::NotGranted => {
            Err(format!("Permission denied: {} on {}", action, resource))
        }
    }
}

fn org_perm_subject_matches(subject: &PermissionSubject, sender: Identity, role_id: u64) -> bool {
    match subject {
        PermissionSubject::Role(r) => *r == role_id,
        PermissionSubject::User(id) => *id == sender,
    }
}

fn org_perm_resource_matches(rule_res: &str, resource: &str) -> bool {
    rule_res == "*" || rule_res == resource
}

fn org_perm_action_matches(rule_action: &PermissionAction, action: &str) -> bool {
    matches!(rule_action, PermissionAction::All)
        || matches!(
            (rule_action, action),
            (PermissionAction::Read, "read")
                | (PermissionAction::Write, "write")
                | (PermissionAction::Create, "create")
                | (PermissionAction::Delete, "delete")
        )
}

/// `Some(Ok)` / `Some(Err)` when org-permission rows match; `None` if none apply.
fn try_org_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    resource: &str,
    action: &str,
    role_id: u64,
    user_identity: Identity,
) -> Option<Result<(), String>> {
    let mut saw_deny = false;
    let mut saw_allow = false;

    for p in ctx
        .db
        .org_permission()
        .perm_by_org()
        .filter(&organization_id)
    {
        if !org_perm_subject_matches(&p.subject, user_identity, role_id) {
            continue;
        }
        if !org_perm_resource_matches(&p.resource, resource) {
            continue;
        }
        if !org_perm_action_matches(&p.action, action) {
            continue;
        }
        match p.effect {
            PermissionEffect::Deny => saw_deny = true,
            PermissionEffect::Allow => saw_allow = true,
        }
    }

    if saw_deny {
        return Some(Err(format!(
            "Permission denied: {} on {}",
            action, resource
        )));
    }
    if saw_allow {
        return Some(Ok(()));
    }
    None
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

/// Generate the next human-readable document number for a given document type.
///
/// Atomically reads and bumps the organization-owned counter in the
/// `DocumentSequence` table.
/// Creates a new sequence starting at 1 if none exists yet.
///
/// # Examples
/// ```
/// let so_ref = next_doc_number(ctx, organization_id, "SO");  // "SO-0001"
/// let po_ref = next_doc_number(ctx, organization_id, "PO");  // "PO-0001"
/// ```
pub fn next_doc_number(ctx: &ReducerContext, organization_id: u64, doc_type: &str) -> String {
    let doc_type_key = doc_type.to_string();
    let sequence_key = format!("{organization_id}:{doc_type}");
    let number = if let Some(seq) = ctx
        .db
        .document_sequence()
        .document_sequence_by_organization_and_type()
        .filter((&organization_id, &doc_type_key))
        .next()
    {
        ctx.db
            .document_sequence()
            .sequence_key()
            .update(DocumentSequence {
                next_number: seq.next_number + 1,
                ..seq
            });
        seq.next_number
    } else {
        ctx.db.document_sequence().insert(DocumentSequence {
            sequence_key,
            organization_id,
            doc_type: doc_type_key.clone(),
            next_number: 2,
        });
        1
    };
    format!("{}-{:04}", doc_type, number)
}

/// Compute the combined tax amount for a list of tax IDs applied to a subtotal.
///
/// Handles `Percent`, `Fixed`, and `Division` amount types.
/// `price_include` taxes are already embedded in the subtotal — their tax portion
/// is extracted rather than added on top.
/// Returns `0.0` gracefully when no matching tax records are found.
pub fn calculate_tax(ctx: &ReducerContext, tax_ids: &[u64], subtotal: f64) -> f64 {
    if tax_ids.is_empty() || subtotal == 0.0 {
        return 0.0;
    }
    let mut total_tax = 0.0;
    for &tax_id in tax_ids {
        let Some(tax) = ctx.db.account_tax().id().find(&tax_id) else {
            continue;
        };
        if !tax.active {
            continue;
        }
        let tax_amount = match tax.amount_type {
            TaxAmountType::Percent => {
                if tax.price_include {
                    // Tax already in subtotal: extract it
                    subtotal - subtotal / (1.0 + tax.amount / 100.0)
                } else {
                    subtotal * (tax.amount / 100.0)
                }
            }
            TaxAmountType::Fixed => {
                // Fixed amount — not price_include aware
                tax.amount
            }
            TaxAmountType::Division => {
                // Odoo "division" type: tax = subtotal / (1 - rate) - subtotal
                if tax.amount < 100.0 {
                    subtotal / (1.0 - tax.amount / 100.0) - subtotal
                } else {
                    0.0
                }
            }
            TaxAmountType::PythonCode => 0.0, // cannot evaluate in WASM
        };
        total_tax += tax_amount;
    }
    total_tax
}
