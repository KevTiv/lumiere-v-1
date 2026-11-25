//! Role-scoped execution grants for reviewed generated AI capabilities.
//!
//! The generated capability artifact owns the global ceilings. These tenant
//! rows only narrow those ceilings for roles already assigned through the
//! ordinary permissions model. Absence of a matching active row is denial.

use serde::Deserialize;
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DefaultAiCapabilityGrant {
    pub capability_key: String,
    pub max_rows: u32,
    pub max_bytes: u64,
}

/// Exact Owner defaults read by tenant bootstrap and the release publisher.
pub(crate) fn owner_ai_capability_grants() -> Result<Vec<DefaultAiCapabilityGrant>, String> {
    serde_json::from_str(include_str!("../../assets/ai-owner-capability-grants.json"))
        .map_err(|error| format!("invalid Owner AI capability defaults: {error}"))
}

pub(crate) fn is_system_owner(role: &Role) -> bool {
    role.is_system
        && role.name.eq_ignore_ascii_case("owner")
        && role
            .permissions
            .iter()
            .any(|permission| permission == "*:*")
}

/// Read-only harness descriptor access. Part of the owner baseline.
pub(crate) const AI_HARNESS_DESCRIPTOR_READ_CAPABILITY: &str = "ai.harness.descriptor.read";

/// Resolving a budget park can resume spend. Deliberately NOT in
/// [`owner_ai_capability_grants`]: default-deny until an administrator
/// provisions it through the audited `set_ai_capability_role_grant` reducer.
pub(crate) const AI_RUN_BUDGET_RESOLVE_CAPABILITY: &str = "ai.run.budget.resolve";

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
    if !owner_role.is_active || !is_system_owner(owner_role) {
        return Err("AI owner grants require the active full-access owner role".to_string());
    }

    for definition in owner_ai_capability_grants()? {
        let exists = ctx
            .db
            .ai_capability_role_grant()
            .ai_capability_grant_by_role()
            .filter(&owner_role.id)
            .any(|grant| {
                grant.organization_id == organization_id
                    && grant.capability_key == definition.capability_key
            });

        // Defaults are insert-only. A tenant's explicit bounds or disabled
        // grant stay authoritative across release and provisioning repairs.
        if !exists {
            ctx.db
                .ai_capability_role_grant()
                .insert(AiCapabilityRoleGrant {
                    id: 0,
                    organization_id,
                    role_id: owner_role.id,
                    capability_key: definition.capability_key,
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
    let is_owner_default = ctx
        .db
        .role()
        .id()
        .find(&grant.role_id)
        .is_some_and(|role| role.organization_id == organization_id && is_system_owner(&role))
        && owner_ai_capability_grants()?
            .iter()
            .any(|default| default.capability_key == grant.capability_key);
    let (action, changed_fields) = if is_owner_default {
        // A removed default is a durable denial, so release reconciliation
        // can distinguish it from a grant that has never been provisioned.
        ctx.db
            .ai_capability_role_grant()
            .id()
            .update(AiCapabilityRoleGrant {
                is_active: false,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..grant
            });
        ("write", vec!["is_active".to_string()])
    } else {
        ctx.db.ai_capability_role_grant().id().delete(&grant_id);
        ("delete", Vec::new())
    };
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_capability_role_grant",
            record_id: grant_id,
            action,
            old_values: None,
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_baseline_is_the_exact_reviewed_key_set() {
        let owner_grants = owner_ai_capability_grants().unwrap();
        let mut keys: Vec<&str> = owner_grants
            .iter()
            .map(|grant| grant.capability_key.as_str())
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "ai.context.index",
                "ai.document.ocr",
                "ai.evidence.inspect",
                "ai.evidence.retrieve",
                "ai.harness.descriptor.read",
                "ai.knowledge.retrieve",
                "ai.run.lifecycle",
            ]
        );
        for grant in owner_grants {
            assert!(!grant.capability_key.contains('*'), "no wildcard grants");
            assert!(grant.max_rows > 0 && grant.max_bytes > 0);
        }
    }

    #[test]
    fn owner_index_grant_is_bounded_and_does_not_enable_shared_reindex() {
        let owner_grants = owner_ai_capability_grants().unwrap();
        let grant = owner_grants
            .iter()
            .find(|grant| grant.capability_key == "ai.context.index")
            .expect("owner record indexing grant");
        assert_eq!((grant.max_rows, grant.max_bytes), (8, 64 * 1024));
        assert!(owner_grants
            .iter()
            .all(|grant| grant.capability_key != "embedding_reindex"));
    }

    #[test]
    fn budget_resolve_is_not_in_the_owner_baseline() {
        assert!(owner_ai_capability_grants()
            .unwrap()
            .iter()
            .all(|grant| grant.capability_key != AI_RUN_BUDGET_RESOLVE_CAPABILITY));
    }

    #[test]
    fn descriptor_grant_has_small_exact_bounds() {
        let grant = owner_ai_capability_grants()
            .unwrap()
            .into_iter()
            .find(|grant| grant.capability_key == AI_HARNESS_DESCRIPTOR_READ_CAPABILITY)
            .expect("descriptor grant in owner baseline");
        assert_eq!(grant.max_rows, 1);
        assert_eq!(grant.max_bytes, 64 * 1024);
    }

    #[test]
    fn owner_document_ocr_has_bounded_pages_and_bytes() {
        let grant = owner_ai_capability_grants()
            .unwrap()
            .into_iter()
            .find(|grant| grant.capability_key == "ai.document.ocr")
            .expect("owner OCR grant");
        assert_eq!((grant.max_rows, grant.max_bytes), (20, 10 * 1024 * 1024));
    }
}
