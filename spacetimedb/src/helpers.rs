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
    effective_permission_strings, effective_roles, org_permission, PermissionAction,
    PermissionEffect, PermissionSubject,
};
use crate::core::reference::{document_sequence, DocumentSequence};
use crate::core::users::find_user_profile_for_organization;
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
///   2. Explicit denies across every effective role and the identity
///   3. Effective role permissions and explicit grants
pub fn resolve_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    user_identity: Identity,
    _role_id: u64,
    _role_name: &str,
    _role_permissions: &[String],
    is_superuser: bool,
    resource: &str,
    action: &str,
) -> PermissionResolution {
    let Ok(roles) = effective_roles(ctx, organization_id, user_identity) else {
        return PermissionResolution::NotGranted;
    };
    if roles_allow_permission(
        ctx,
        organization_id,
        user_identity,
        &roles,
        is_superuser,
        resource,
        action,
    ) {
        PermissionResolution::Allow
    } else {
        PermissionResolution::Deny
    }
}

/// Evaluate an explicit proposed effective role set for the same actor and tenant.
pub(crate) fn roles_allow_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    user_identity: Identity,
    roles: &[crate::core::permissions::Role],
    is_superuser: bool,
    resource: &str,
    action: &str,
) -> bool {
    let rows: Vec<_> = ctx
        .db
        .org_permission()
        .perm_by_org()
        .filter(&organization_id)
        .filter(|p| match p.subject {
            PermissionSubject::Role(id) => roles.iter().any(|r| r.id == id),
            PermissionSubject::User(id) => id == user_identity,
        })
        .collect();
    let resource = crate::core::permissions::canonical_policy_resource(resource);
    let grant_resources: Vec<_> = rows
        .iter()
        .map(|p| crate::core::permissions::canonical_policy_resource(&p.resource))
        .collect();
    let grants: Vec<_> = rows
        .iter()
        .enumerate()
        .map(|(i, p)| lumiere_policy_core::Grant {
            resource: &grant_resources[i],
            action: match p.action {
                PermissionAction::Read => "read",
                PermissionAction::Write => "write",
                PermissionAction::Create => "create",
                PermissionAction::Delete => "delete",
                PermissionAction::All => "*",
            },
            allow: p.effect == PermissionEffect::Allow,
        })
        .collect();
    let permissions = crate::core::permissions::canonical_permission_strings(
        &effective_permission_strings(roles),
    );
    lumiere_policy_core::allows_in_module(
        is_superuser,
        &permissions,
        &grants,
        &resource,
        action,
        permission_resource_module(&resource),
    )
}

pub(crate) fn permission_resource_module(resource: &str) -> Option<&'static str> {
    static MODULES: std::sync::OnceLock<std::collections::HashMap<String, String>> =
        std::sync::OnceLock::new();
    let modules = MODULES.get_or_init(|| {
        let manifest: serde_json::Value = serde_json::from_str(include_str!(
            "../../lumiere-codegen/storage-policy-manifest.json"
        ))
        .expect("checked storage policy manifest");
        manifest["policies"]
            .as_array()
            .expect("storage policies")
            .iter()
            .filter_map(|p| {
                Some((
                    p["table"].as_str()?.to_owned(),
                    p["module"].as_str()?.to_owned(),
                ))
            })
            .collect()
    });
    lumiere_policy_core::operation_resource_module(resource)
        .or_else(|| modules.get(&resource.replace('-', "_")).map(String::as_str))
}

/// Returns `Ok(())` when allowed, `Err(reason)` otherwise.
pub fn check_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    resource: &str,
    action: &str,
) -> Result<(), String> {
    let user = find_user_profile_for_organization(ctx, ctx.sender(), organization_id)
        .ok_or("User not found")?;

    if !user.is_active {
        return Err("User account is inactive".to_string());
    }

    let roles = effective_roles(ctx, organization_id, ctx.sender())?;
    let role = &roles[0];

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
        PermissionResolution::Allow => {
            if action != "read" {
                crate::core::reconstruction::require_writes_unfenced(ctx, organization_id)?;
            }
            Ok(())
        }
        PermissionResolution::Deny | PermissionResolution::NotGranted => {
            Err(format!("Permission denied: {} on {}", action, resource))
        }
    }
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
