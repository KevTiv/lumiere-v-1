//! Personal, revisioned presentation-module drafts.
//!
//! Versions are immutable snapshots.  This module deliberately stops at
//! saving drafts: publication and activation are separate contracts.
//! Stored bindings and pins remain untrusted author intent. Saving grants no
//! read or execution capability; consumers must revalidate the complete draft
//! against the current actor-filtered catalog on every preview or future use.

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::core::audit::{audit_log, AuditLog};
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::helpers::check_permission;

const PERMISSION_RESOURCE: &str = "presentation_module";
const MAX_DEFINITION_BYTES: usize = 64 * 1024;
const MAX_MODULES_PER_OWNER: usize = 100;
const MAX_VERSIONS_PER_MODULE: usize = 256;

#[derive(Clone)]
#[spacetimedb::table(
    accessor = presentation_module,
    index(accessor = presentation_module_by_org, btree(columns = [organization_id])),
    index(accessor = presentation_module_by_owner, btree(columns = [organization_id, owner_identity]))
)]
pub struct PresentationModule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub scope_key: String,
    pub organization_id: u64,
    pub owner_identity: Identity,
    pub module_key: String,
    pub current_revision: u64,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = presentation_module_version,
    index(accessor = presentation_module_version_by_org, btree(columns = [organization_id])),
    index(accessor = presentation_module_version_by_module, btree(columns = [module_id])),
    index(accessor = presentation_module_version_by_owner, btree(columns = [organization_id, owner_identity]))
)]
pub struct PresentationModuleVersion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub owner_identity: Identity,
    pub module_id: u64,
    pub module_key: String,
    pub revision: u64,
    pub definition_json: String,
    pub definition_hash: String,
    pub schema_version: u32,
    pub application_contract: String,
    pub component_catalog_version: u32,
    pub created_at: Timestamp,
    pub created_by: Identity,
}

/// Save one personal draft snapshot, guarded by an optional expected head revision.
#[reducer]
pub fn save_presentation_module(
    ctx: &ReducerContext,
    organization_id: u64,
    expected_revision: Option<u64>,
    definition_json: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, PERMISSION_RESOURCE, "write")?;
    if definition_json.len() > MAX_DEFINITION_BYTES {
        return Err("presentation module definition exceeds size limit".to_string());
    }

    let prepared =
        lumiere_presentation_core::prepare_saved_draft(&definition_json, expected_revision)?;
    let owner = ctx.sender();
    let scope_key = format!(
        "{organization_id}:{}:{}",
        owner.to_hex(),
        prepared.module_key
    );
    let heads = ctx.db.presentation_module();
    let (revision, old_head) = match heads.scope_key().find(&scope_key) {
        Some(head) => {
            if head.organization_id != organization_id || head.owner_identity != owner {
                return Err("presentation module is outside the caller scope".to_string());
            }
            let expected = expected_revision.ok_or_else(|| {
                "expected revision is required when updating a presentation module".to_string()
            })?;
            if head.current_revision != expected {
                return Err(format!(
                    "stale presentation module revision: expected {expected}, current {}",
                    head.current_revision
                ));
            }
            (
                head.current_revision
                    .checked_add(1)
                    .ok_or_else(|| "presentation module revision overflow".to_string())?,
                Some(head),
            )
        }
        None => {
            if expected_revision.is_some() {
                return Err("presentation module does not exist".to_string());
            }
            (1, None)
        }
    };
    if old_head.is_none()
        && heads
            .presentation_module_by_owner()
            .filter((&organization_id, &owner))
            .take(MAX_MODULES_PER_OWNER)
            .count()
            >= MAX_MODULES_PER_OWNER
    {
        return Err("presentation module owner limit reached".to_string());
    }
    if let Some(existing) = old_head.as_ref() {
        if ctx
            .db
            .presentation_module_version()
            .presentation_module_version_by_module()
            .filter(&existing.id)
            .take(MAX_VERSIONS_PER_MODULE)
            .count()
            >= MAX_VERSIONS_PER_MODULE
        {
            return Err("presentation module version limit reached".to_string());
        }
    }
    let head = if let Some(head) = old_head {
        let updated = PresentationModule {
            current_revision: revision,
            updated_at: ctx.timestamp,
            ..head
        };
        heads.id().update(updated.clone());
        updated
    } else {
        heads.insert(PresentationModule {
            scope_key: scope_key.clone(),
            id: 0,
            organization_id,
            owner_identity: owner,
            module_key: prepared.module_key.clone(),
            current_revision: revision,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        })
    };
    let hash = hex::encode(Sha256::digest(prepared.definition_json.as_bytes()));
    let version = ctx
        .db
        .presentation_module_version()
        .insert(PresentationModuleVersion {
            id: 0,
            organization_id,
            owner_identity: owner,
            module_id: head.id,
            module_key: prepared.module_key.clone(),
            revision,
            definition_json: prepared.definition_json.clone(),
            definition_hash: hash.clone(),
            schema_version: prepared.schema_version,
            application_contract: prepared.application_contract.clone(),
            component_catalog_version: prepared.component_catalog_version,
            created_at: ctx.timestamp,
            created_by: owner,
        });
    let audit = ctx.db.audit_log().insert(AuditLog {
        id: 0,
        organization_id,
        company_id: None,
        table_name: "presentation_module_version".to_string(),
        record_id: version.id,
        action: "CREATE".to_string(),
        old_values: None,
        new_values: Some(serde_json::json!({"moduleKey": version.module_key, "revision": revision, "definitionHash": version.definition_hash}).to_string()),
        changed_fields: vec!["definition".to_string(), "revision".to_string()],
        user_identity: owner,
        session_id: ctx.connection_id().map(|c| c.to_u128() as u64),
        ip_address: None,
        user_agent: None,
        timestamp: ctx.timestamp,
        metadata: Some("draft-only; no publish or activation".to_string()),
    });
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.save_presentation_module".to_string(),
            correlation_id: scope_key,
            changes: vec![
                RowChange::upsert_stdb_row(
                    "presentation_module",
                    serde_json::json!({"id": head.id}),
                    &head,
                )?,
                RowChange::upsert_stdb_row(
                    "presentation_module_version",
                    serde_json::json!({"id": version.id}),
                    &version,
                )?,
                RowChange::upsert_stdb_row(
                    "audit_log",
                    serde_json::json!({"id": audit.id}),
                    &audit,
                )?,
            ],
        },
    )?;

    Ok(())
}
