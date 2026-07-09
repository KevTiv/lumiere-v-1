/// Contact role assignments — explicit roles for a contact within an org/company.
///
/// This replaces inference from `Contact` booleans/ranks but does not duplicate HR
/// employee records. Roles are stored as validated strings so tenants can introduce
/// custom roles without a code change; a small curated set is accepted initially.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::require_company_in_organization;
use crate::crm::contacts::{contact, Contact};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = contact_role_assignment,
    public,
    index(accessor = contact_role_by_org, btree(columns = [organization_id])),
    index(accessor = contact_role_by_contact, btree(columns = [contact_id])),
    index(accessor = contact_role_by_contact_role, btree(columns = [contact_id, role]))
)]
#[derive(Clone)]
pub struct ContactRoleAssignment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    /// Company scope. `None` means organization-level role.
    pub company_id: Option<u64>,
    pub contact_id: u64,
    pub role: String,
    pub active_from: Timestamp,
    pub active_until: Option<Timestamp>,
    pub is_active: bool,
    pub assigned_by: Identity,
    pub assigned_at: Timestamp,
    pub ended_at: Option<Timestamp>,
    pub ended_by: Option<Identity>,
    pub metadata: Option<String>,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct AssignContactRoleParams {
    pub contact_id: u64,
    pub company_id: Option<u64>,
    pub role: String,
    pub active_from: Option<Timestamp>,
    pub active_until: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct EndContactRoleParams {
    pub reason: Option<String>,
}

// ── Role validation ───────────────────────────────────────────────────────────

/// Curated initial roles. Custom roles are accepted without code changes; this list
/// is only used for documentation/validation warnings, not hard rejection.
const KNOWN_ROLES: &[&str] = &[
    "customer",
    "supplier",
    "vendor",
    "employee",
    "prospect",
    "partner",
    "farmer",
    "member",
    "distributor",
    "agent",
];

fn validate_role(role: &str) -> Result<String, String> {
    let trimmed = role.trim().to_lowercase();
    if trimmed.is_empty() {
        return Err("Role cannot be empty".to_string());
    }
    if trimmed.len() > 64 {
        return Err("Role cannot exceed 64 characters".to_string());
    }
    Ok(trimmed)
}

fn role_is_known(role: &str) -> bool {
    KNOWN_ROLES.contains(&role)
}

// ── Scope validation helpers ──────────────────────────────────────────────────

fn load_active_contact(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
) -> Result<Contact, String> {
    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("Contact not found")?;

    if contact.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }

    if contact.deleted_at.is_some() {
        return Err("Contact is deleted".to_string());
    }

    Ok(contact)
}

fn validate_company_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
) -> Result<(), String> {
    if let Some(cid) = company_id {
        require_company_in_organization(ctx, organization_id, cid)?;
    }
    Ok(())
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn assign_contact_role(
    ctx: &ReducerContext,
    organization_id: u64,
    params: AssignContactRoleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_role_assignment", "create")?;

    let _contact = load_active_contact(ctx, organization_id, params.contact_id)?;
    validate_company_scope(ctx, organization_id, params.company_id)?;

    let role = validate_role(&params.role)?;

    // If an identical active assignment already exists, update its interval instead of
    // creating a duplicate.
    let existing = ctx
        .db
        .contact_role_assignment()
        .contact_role_by_contact()
        .filter(&params.contact_id)
        .find(|a| {
            a.organization_id == organization_id
                && a.company_id == params.company_id
                && a.role == role
                && a.is_active
        });

    if let Some(existing) = existing {
        let new_active_from = params.active_from.unwrap_or(existing.active_from);
        let new_active_until = params.active_until.or(existing.active_until);
        let mut changed = Vec::new();
        if params.active_from.is_some() {
            changed.push("active_from".to_string());
        }
        if params.active_until.is_some() {
            changed.push("active_until".to_string());
        }

        ctx.db.contact_role_assignment().id().update(ContactRoleAssignment {
            active_from: new_active_from,
            active_until: new_active_until,
            ..existing.clone()
        });

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: existing.company_id,
                table_name: "contact_role_assignment",
                record_id: existing.id,
                action: "UPDATE",
                old_values: Some(
                    serde_json::json!({
                        "active_from": existing.active_from.to_string(),
                        "active_until": existing.active_until.map(|t| t.to_string()),
                    })
                    .to_string(),
                ),
                new_values: Some(
                    serde_json::json!({
                        "active_from": new_active_from.to_string(),
                        "active_until": new_active_until.map(|t| t.to_string()),
                    })
                    .to_string(),
                ),
                changed_fields: changed,
                metadata: None,
            },
        );

        return Ok(());
    }

    let active_from = params.active_from.unwrap_or(ctx.timestamp);

    let assignment = ctx.db.contact_role_assignment().insert(ContactRoleAssignment {
        id: 0,
        organization_id,
        company_id: params.company_id,
        contact_id: params.contact_id,
        role: role.clone(),
        active_from,
        active_until: params.active_until,
        is_active: true,
        assigned_by: ctx.sender(),
        assigned_at: ctx.timestamp,
        ended_at: None,
        ended_by: None,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "contact_role_assignment",
            record_id: assignment.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "contact_id": params.contact_id,
                    "role": role,
                    "company_id": params.company_id,
                    "active_from": active_from.to_string(),
                    "is_known_role": role_is_known(&role),
                })
                .to_string(),
            ),
            changed_fields: vec![
                "contact_id".to_string(),
                "role".to_string(),
                "company_id".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn end_contact_role(
    ctx: &ReducerContext,
    organization_id: u64,
    assignment_id: u64,
    params: EndContactRoleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "contact_role_assignment", "write")?;

    let assignment = ctx
        .db
        .contact_role_assignment()
        .id()
        .find(&assignment_id)
        .ok_or("Role assignment not found")?;

    if assignment.organization_id != organization_id {
        return Err("Assignment does not belong to this organization".to_string());
    }

    if !assignment.is_active {
        return Err("Role assignment is already ended".to_string());
    }

    let reason_metadata = params.reason.as_ref().map(|r| {
        serde_json::json!({ "end_reason": r }).to_string()
    });

    ctx.db.contact_role_assignment().id().update(ContactRoleAssignment {
        is_active: false,
        active_until: Some(ctx.timestamp),
        ended_at: Some(ctx.timestamp),
        ended_by: Some(ctx.sender()),
        metadata: reason_metadata.clone(),
        ..assignment.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: assignment.company_id,
            table_name: "contact_role_assignment",
            record_id: assignment_id,
            action: "END",
            old_values: Some(serde_json::json!({ "is_active": true }).to_string()),
            new_values: Some(serde_json::json!({ "is_active": false }).to_string()),
            changed_fields: vec![
                "is_active".to_string(),
                "active_until".to_string(),
                "ended_at".to_string(),
            ],
            metadata: reason_metadata,
        },
    );

    Ok(())
}

// ── Read helpers used by duplicate detection / reports ─────────────────────────

/// Active role assignments for a contact.
pub fn active_roles_for_contact(
    ctx: &ReducerContext,
    contact_id: u64,
) -> Vec<ContactRoleAssignment> {
    ctx.db
        .contact_role_assignment()
        .contact_role_by_contact()
        .filter(&contact_id)
        .filter(|a| a.is_active && (a.active_until.is_none() || a.active_until > Some(ctx.timestamp)))
        .collect()
}
