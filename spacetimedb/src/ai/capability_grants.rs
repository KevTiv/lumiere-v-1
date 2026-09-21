//! Role-scoped execution grants for reviewed generated AI capabilities.
//!
//! The generated capability artifact owns the global ceilings. These tenant
//! rows only narrow those ceilings for roles already assigned through the
//! ordinary permissions model. Absence of a matching active row is denial.

use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::{
    core::permissions::{role, Role},
    helpers::{check_permission, write_audit_log_v2, AuditLogParams},
};

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_capability_role_grant,
    index(
        accessor = ai_capability_grant_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_capability_grant_by_role,
        btree(columns = [role_id])
    )
)]
pub struct AiCapabilityRoleGrant {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub role_id: u64,
    pub capability_key: String,
    pub max_rows: u32,
    pub max_bytes: u64,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}


#[derive(Clone, Copy)]
pub(crate) struct DefaultAiCapabilityGrant {
    pub capability_key: &'static str,
    pub max_rows: u32,
    pub max_bytes: u64,
}

/// Production baseline for the organization owner.
///
/// These are exact grants, deliberately not a wildcard. They make the
/// read-only/reversible harness control surfaces usable after tenant bootstrap
/// while every other role stays default-deny until explicitly provisioned.
pub(crate) const OWNER_AI_CAPABILITY_GRANTS: [DefaultAiCapabilityGrant; 4] = [
    DefaultAiCapabilityGrant {
        capability_key: "ai.evidence.retrieve",
        max_rows: 20,
        max_bytes: 64 * 1024,
    },
    DefaultAiCapabilityGrant {
        capability_key: "ai.evidence.inspect",
        max_rows: 100,
        max_bytes: 1024 * 1024,
    },
    DefaultAiCapabilityGrant {
        capability_key: "ai.knowledge.retrieve",
        max_rows: 20,
        max_bytes: 64 * 1024,
    },
    DefaultAiCapabilityGrant {
        capability_key: "ai.run.lifecycle",
        max_rows: 100,
        max_bytes: 1024 * 1024,
    },
];

/// Seed or repair the production owner baseline. This is intentionally an
/// internal bootstrap helper: arbitrary role assignment continues to flow
/// through the audited `set_ai_capability_role_grant` reducer.
pub(crate) fn provision_owner_ai_capability_grants(
    ctx: &ReducerContext,
    organization_id: u64,
    owner_role: &Role,
) -> Result<(), String> {
    if organization_id == 0 || owner_role.id == 0 || owner_role.organization_id != organization_id {
        return Err("Owner role does not belong to this organization".to_string());
    }
    if !owner_role.is_active || !owner_role.permissions.iter().any(|permission| permission == "*:*") {
        return Err("AI owner grants require the active full-access owner role".to_string());
    }

    for definition in OWNER_AI_CAPABILITY_GRANTS {
        let existing = ctx
            .db
            .ai_capability_role_grant()
            .ai_capability_grant_by_role()
            .filter(&owner_role.id)
            .find(|grant| {
                grant.organization_id == organization_id
                    && grant.capability_key == definition.capability_key
            });

        if let Some(grant) = existing {
            ctx.db
                .ai_capability_role_grant()
                .id()
                .update(AiCapabilityRoleGrant {
                    max_rows: definition.max_rows,
                    max_bytes: definition.max_bytes,
                    is_active: true,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..grant
                });
        } else {
            ctx.db
                .ai_capability_role_grant()
                .insert(AiCapabilityRoleGrant {
                    id: 0,
                    organization_id,
                    role_id: owner_role.id,
                    capability_key: definition.capability_key.to_string(),
                    max_rows: definition.max_rows,
                    max_bytes: definition.max_bytes,
                    is_active: true,
                    create_uid: ctx.sender(),
                    create_date: ctx.timestamp,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                });
        }
    }
    Ok(())
}

#[reducer]
pub fn set_ai_capability_role_grant(
    ctx: &ReducerContext,
    organization_id: u64,
    role_id: u64,
    capability_key: String,
    max_rows: u32,
    max_bytes: u64,
    is_active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent", "write")?;
    if organization_id == 0 || role_id == 0 {
        return Err("Organization and role must be nonzero".to_string());
    }
    let capability_key = capability_key.trim().to_string();
    if capability_key.is_empty() || capability_key.len() > 160 {
        return Err("Capability key must contain 1 to 160 characters".to_string());
    }
    if max_rows == 0 || max_bytes == 0 {
        return Err("Capability grant limits must be positive".to_string());
    }
    let role = ctx.db.role().id().find(&role_id).ok_or("Role not found")?;
    if role.organization_id != organization_id {
        return Err("Role does not belong to this organization".to_string());
    }

    let existing = ctx
        .db
        .ai_capability_role_grant()
        .ai_capability_grant_by_role()
        .filter(&role_id)
        .find(|grant| {
            grant.organization_id == organization_id && grant.capability_key == capability_key
        });
    let record_id = if let Some(grant) = existing {
        let id = grant.id;
        ctx.db
            .ai_capability_role_grant()
            .id()
            .update(AiCapabilityRoleGrant {
                max_rows,
                max_bytes,
                is_active,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..grant
            });
        id
    } else {
        ctx.db
            .ai_capability_role_grant()
            .insert(AiCapabilityRoleGrant {
                id: 0,
                organization_id,
                role_id,
                capability_key,
                max_rows,
                max_bytes,
                is_active,
                create_uid: ctx.sender(),
                create_date: ctx.timestamp,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
            })
            .id
    };

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_capability_role_grant",
            record_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec![
                "max_rows".to_string(),
                "max_bytes".to_string(),
                "is_active".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn delete_ai_capability_role_grant(
    ctx: &ReducerContext,
    organization_id: u64,
    grant_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent", "write")?;
    let grant = ctx
        .db
        .ai_capability_role_grant()
        .id()
        .find(&grant_id)
        .ok_or("Capability role grant not found")?;
    if grant.organization_id != organization_id {
        return Err("Capability role grant does not belong to this organization".to_string());
    }
    ctx.db.ai_capability_role_grant().id().delete(&grant_id);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_capability_role_grant",
            record_id: grant_id,
            action: "delete",
            old_values: None,
            new_values: None,
            changed_fields: Vec::new(),
            metadata: None,
        },
    );
    Ok(())
}
