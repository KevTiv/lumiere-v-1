//! Personal, revisioned presentation-module drafts and existing-page preferences.
//!
//! Versions are immutable snapshots.  This module deliberately stops at
//! saving drafts: publication and activation are separate contracts.
//! Stored bindings and pins remain untrusted author intent. Saving grants no
//! read or execution capability; consumers must revalidate the complete draft
//! against the current actor-filtered catalog on every preview or future use.

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::ai::evidence_lineage::{
    bind_ai_artifact_component_inner, require_component_bindable, BindAiArtifactComponentParams,
};
use crate::core::audit::{audit_log, AuditLog};
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::helpers::check_permission;
use crate::workflow::authorization::require_workflow_company_access;

const PERMISSION_RESOURCE: &str = "presentation_module";
const MAX_DEFINITION_BYTES: usize = 64 * 1024;
const MAX_MODULES_PER_OWNER: usize = 100;
const MAX_VERSIONS_PER_MODULE: usize = 256;
const MAX_PAGE_LAYOUTS_PER_OWNER: usize = 512;
const MAX_VERSIONS_PER_PAGE_LAYOUT: usize = 1024;

mod personal_pages;
pub use personal_pages::save_personal_page_layout;

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

/// Stored metadata shared by inert personal preferences and generic draft snapshots.
struct SnapshotDefinition<'a> {
    module_key: &'a str,
    definition_json: &'a str,
    schema_version: u32,
    application_contract: &'a str,
    component_catalog_version: u32,
}

struct WrittenSnapshot {
    head: PresentationModule,
    version: PresentationModuleVersion,
}

/// Append one immutable snapshot after the caller has authorized its exact content.
/// `None` reconciles only the immediately preceding identical personal-layout save.
fn append_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    expected_revision: Option<u64>,
    definition: SnapshotDefinition<'_>,
    reconcile_retry: bool,
) -> Result<Option<WrittenSnapshot>, String> {
    let owner = ctx.sender();
    let scope_key = format!(
        "{organization_id}:{}:{}",
        owner.to_hex(),
        definition.module_key
    );
    let heads = ctx.db.presentation_module();
    let existing = heads.scope_key().find(&scope_key);
    let is_page_layout = definition
        .module_key
        .starts_with(lumiere_presentation_core::PERSONAL_PAGE_NAMESPACE);
    let hash = hex::encode(Sha256::digest(definition.definition_json.as_bytes()));
    let (revision, old_head) = match existing {
        Some(head) => {
            if head.organization_id != organization_id
                || head.owner_identity != owner
                || head.module_key != definition.module_key
                || head.current_revision == 0
            {
                return Err("presentation module is outside the caller scope".to_string());
            }
            if reconcile_retry
                && expected_revision.unwrap_or(0).checked_add(1) == Some(head.current_revision)
            {
                let matching: Vec<_> = ctx
                    .db
                    .presentation_module_version()
                    .presentation_module_version_by_module()
                    .filter(&head.id)
                    .filter(|version| version.revision == head.current_revision)
                    .take(2)
                    .collect();
                if let [version] = matching.as_slice() {
                    if version.organization_id == organization_id
                        && version.owner_identity == owner
                        && version.created_by == owner
                        && version.module_key == definition.module_key
                        && version.definition_hash == hash
                        && version.definition_json == definition.definition_json
                        && version.schema_version == definition.schema_version
                        && version.application_contract == definition.application_contract
                        && version.component_catalog_version == definition.component_catalog_version
                    {
                        return Ok(None);
                    }
                }
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
    let head_limit = if is_page_layout {
        MAX_PAGE_LAYOUTS_PER_OWNER
    } else {
        MAX_MODULES_PER_OWNER
    };
    if old_head.is_none()
        && heads
            .presentation_module_by_owner()
            .filter((&organization_id, &owner))
            .filter(|head| {
                head.module_key
                    .starts_with(lumiere_presentation_core::PERSONAL_PAGE_NAMESPACE)
                    == is_page_layout
            })
            .take(head_limit)
            .count()
            >= head_limit
    {
        return Err("presentation module owner limit reached".to_string());
    }
    let version_limit = if is_page_layout {
        MAX_VERSIONS_PER_PAGE_LAYOUT
    } else {
        MAX_VERSIONS_PER_MODULE
    };
    if let Some(existing) = old_head.as_ref() {
        if ctx
            .db
            .presentation_module_version()
            .presentation_module_version_by_module()
            .filter(&existing.id)
            .take(version_limit)
            .count()
            >= version_limit
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
            id: 0,
            scope_key,
            organization_id,
            owner_identity: owner,
            module_key: definition.module_key.to_owned(),
            current_revision: revision,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        })
    };
    let version = ctx
        .db
        .presentation_module_version()
        .insert(PresentationModuleVersion {
            id: 0,
            organization_id,
            owner_identity: owner,
            module_id: head.id,
            module_key: definition.module_key.to_owned(),
            revision,
            definition_json: definition.definition_json.to_owned(),
            definition_hash: hash,
            schema_version: definition.schema_version,
            application_contract: definition.application_contract.to_owned(),
            component_catalog_version: definition.component_catalog_version,
            created_at: ctx.timestamp,
            created_by: owner,
        });
    Ok(Some(WrittenSnapshot { head, version }))
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
    // Refuse an unbindable evidence binding before writing anything, so a
    // refused save leaves no head, version or audit row behind.
    if let Some(binding) = prepared.evidence_binding.as_ref() {
        if require_workflow_company_access(ctx, organization_id, binding.company_id, owner)? {
            return Err(
                "superuser membership bypass cannot be used for evidence binding".to_string(),
            );
        }
        require_component_bindable(
            ctx,
            organization_id,
            binding.company_id,
            &binding.decision_ids,
            &binding.claim_ids,
        )?;
    }
    let Some(WrittenSnapshot { head, version }) = append_snapshot(
        ctx,
        organization_id,
        expected_revision,
        SnapshotDefinition {
            module_key: &prepared.module_key,
            definition_json: &prepared.definition_json,
            schema_version: prepared.schema_version,
            application_contract: &prepared.application_contract,
            component_catalog_version: prepared.component_catalog_version,
        },
        false,
    )?
    else {
        return Err("draft save unexpectedly reconciled a layout retry".into());
    };
    let revision = version.revision;
    let hash = version.definition_hash.clone();
    if let Some(binding) = prepared.evidence_binding {
        if require_workflow_company_access(ctx, organization_id, binding.company_id, owner)? {
            return Err(
                "superuser membership bypass cannot be used for evidence binding".to_string(),
            );
        }
        bind_ai_artifact_component_inner(
            ctx,
            organization_id,
            binding.company_id,
            BindAiArtifactComponentParams {
                artifact_ref: format!("presentation-module-version:{}", version.id),
                component_key: "definition".to_string(),
                component_kind: "document_section".to_string(),
                content_hash: hash.clone(),
                decision_ids: binding.decision_ids,
                claim_ids: binding.claim_ids,
            },
        )?;
    }
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
            correlation_id: head.scope_key.clone(),
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
