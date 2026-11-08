//! Atomic folder moves and reversible trash, independent from object-store keys.

use std::collections::BTreeMap;

use spacetimedb::{reducer, ReducerContext, Table};

use crate::core::business_changes::{capture_business_audit, merge_business_audit_changes};
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::helpers::{check_permission, AuditLogParams};

use super::documents::{
    doc_folder, document, Document, DocumentFolder, UpdateDocumentFolderParams,
};
use super::folder_evidence::DocumentEvidenceSnapshot;
use super::folder_hierarchy::{
    authorized_chain, authorized_subtree, path_for_parent, relocated_subtree,
    require_no_access_expansion, require_unique_name, validate_name, FolderAccess,
};
use super::folder_lifecycle;

fn find_folder(
    ctx: &ReducerContext,
    organization_id: u64,
    folder_id: u64,
) -> Result<DocumentFolder, String> {
    let folder = ctx
        .db
        .doc_folder()
        .id()
        .find(&folder_id)
        .ok_or("Folder not found")?;
    if folder.organization_id != organization_id {
        return Err("Folder does not belong to this organization".to_string());
    }
    Ok(folder)
}

fn preflight_subtree_documents(
    ctx: &ReducerContext,
    folders: &[DocumentFolder],
    deleting: bool,
) -> Result<Vec<Document>, String> {
    let folders: BTreeMap<_, _> = folders.iter().map(|folder| (folder.id, folder)).collect();
    let mut documents = Vec::new();
    // Nullable folder indexes cannot be filtered by this SDK. Inspect the table
    // once and reuse the checked rows when retiring derived evidence.
    for doc in ctx.db.document().iter() {
        if let Some(folder) = doc.folder_id.and_then(|id| folders.get(&id)) {
            if doc.organization_id != folder.organization_id {
                return Err("Folder contains a document from another organization".to_string());
            }
            super::folder_hierarchy::ensure_company_scope(folder, doc.company_id)?;
            super::folder_hierarchy::require_company_access(
                ctx,
                doc.organization_id,
                doc.company_id,
            )?;
            // Match the current owner-scoped document read model. A folder action
            // must not silently change availability of a document the actor cannot inspect.
            if doc.owner_id != ctx.sender() {
                return Err("Folder contains a document you cannot manage".to_string());
            }
            if !deleting {
                check_permission(ctx, doc.organization_id, "document", "write")?;
            }
            if !doc.is_deleted
                && doc.is_locked
                && !super::documents::lock_is_expired(&doc, ctx.timestamp)
                && (deleting || doc.locked_by != Some(ctx.sender()))
            {
                return Err(
                    "Folder contains a document whose lock prevents this operation".to_string(),
                );
            }
            if !doc.is_deleted && deleting {
                check_permission(ctx, doc.organization_id, "document", "delete")?;
                if super::legal_hold::document_has_active_legal_hold(
                    ctx,
                    doc.organization_id,
                    doc.id,
                ) {
                    return Err(
                        "Cannot trash a folder containing a document under legal hold".to_string(),
                    );
                }
            }
            documents.push(doc);
        }
    }
    Ok(documents)
}

pub(super) fn prepare_folder_change(
    ctx: &ReducerContext,
    operation: &'static str,
    previous: Option<&DocumentFolder>,
    updated: &DocumentFolder,
    descendants: &[DocumentFolder],
    changed_fields: Vec<String>,
) -> Result<FolderChangeSnapshot, String> {
    let audit_values = |folder: &DocumentFolder| -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({
            "name": folder.name,
            "parent_id": folder.parent_id,
            "is_trashed": folder_lifecycle::is_trashed(folder)?,
        }))
    };
    let before = previous.map(audit_values).transpose()?;
    let after = audit_values(updated)?;
    // Flag/metadata updates and subtree-only path repairs use a summary when
    // this small root projection is unchanged. Every created audit row must be
    // part of the complete commit, rather than dropped as an unchanged delta.
    let old_values = before
        .filter(|before| before != &after)
        .map(|value| value.to_string());
    let audit = capture_business_audit(
        ctx,
        updated.organization_id,
        operation,
        AuditLogParams {
            company_id: updated.company_id,
            table_name: "document_folder",
            record_id: updated.id,
            action: if previous.is_some() {
                "UPDATE"
            } else {
                "CREATE"
            },
            old_values,
            new_values: Some(after.to_string()),
            changed_fields,
            metadata: None,
        },
    )?;
    let mut changes = Vec::with_capacity(descendants.len() + 1);
    for folder in std::iter::once(updated).chain(descendants.iter()) {
        changes.push(RowChange::upsert_stdb_row(
            "doc_folder",
            serde_json::json!({"id": folder.id}),
            folder,
        )?);
    }
    Ok(FolderChangeSnapshot {
        organization_id: updated.organization_id,
        folder_id: updated.id,
        operation,
        changes: merge_business_audit_changes(changes, audit)?,
    })
}

/// The complete folder outcome is recorded by its reducer with a locked literal
/// operation ID. Shared mutation helpers cannot invent persistence identities.
pub(super) struct FolderChangeSnapshot {
    organization_id: u64,
    folder_id: u64,
    operation: &'static str,
    changes: Vec<RowChange>,
}

impl FolderChangeSnapshot {
    pub(super) fn record_folder_commit(
        self,
        ctx: &ReducerContext,
        operation_id: &str,
    ) -> Result<(), String> {
        if operation_id.strip_prefix("erp.") != Some(self.operation) {
            return Err("Folder audit and commit operations do not match".to_string());
        }
        record_organization_commit(
            ctx,
            OrganizationCommitInput {
                organization_id: self.organization_id,
                operation_id: operation_id.to_string(),
                correlation_id: format!(
                    "folder:{}:{}",
                    self.folder_id,
                    ctx.timestamp.to_micros_since_unix_epoch()
                ),
                changes: self.changes,
            },
        )?;
        Ok(())
    }
}

fn relocate_folder(
    ctx: &ReducerContext,
    operation: &'static str,
    folder: DocumentFolder,
    mut updated: DocumentFolder,
    parent_id: Option<u64>,
    restoring: bool,
    mut changed_fields: Vec<String>,
) -> Result<FolderChangeSnapshot, String> {
    let previous_chain = authorized_chain(
        ctx,
        folder.organization_id,
        folder.company_id,
        Some(folder.id),
        FolderAccess::Write,
        restoring,
    )?;
    let parent_chain = authorized_chain(
        ctx,
        folder.organization_id,
        folder.company_id,
        parent_id,
        FolderAccess::Write,
        false,
    )?;
    if parent_chain.iter().any(|parent| parent.id == folder.id) {
        return Err("Cannot move folder under one of its descendants".to_string());
    }
    let mut next_chain = vec![updated.clone()];
    next_chain.extend(parent_chain.iter().cloned());
    require_no_access_expansion(&previous_chain, &next_chain)?;
    require_unique_name(
        ctx,
        folder.organization_id,
        folder.company_id,
        parent_id,
        Some(folder.id),
        &updated.name,
    )?;
    let mut subtree = authorized_subtree(ctx, &folder)?;
    preflight_subtree_documents(ctx, &subtree, false)?;
    updated.parent_id = parent_id;
    if restoring {
        updated.metadata = folder_lifecycle::restored_metadata(&folder)?;
        changed_fields.push("restored".to_string());
    }
    if parent_id != folder.parent_id {
        changed_fields.push("parent_id".to_string());
    }
    // The first entry is always the requested root from authorized_subtree.
    if let Some(root) = subtree.first_mut() {
        *root = updated;
    }
    let mut subtree = relocated_subtree(subtree, parent_id, path_for_parent(&parent_chain))?;
    for descendant in &mut subtree {
        descendant.write_uid = ctx.sender();
        descendant.write_date = ctx.timestamp;
        ctx.db.doc_folder().id().update(descendant.clone());
    }
    let (updated, descendants) = subtree.split_first().ok_or("Folder subtree is empty")?;
    prepare_folder_change(
        ctx,
        operation,
        Some(&folder),
        updated,
        descendants,
        changed_fields,
    )
}

/// Move a folder and its subtree. `None` explicitly selects the organization/company root.
#[reducer]
pub fn move_document_folder(
    ctx: &ReducerContext,
    organization_id: u64,
    folder_id: u64,
    parent_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document_folder", "write")?;
    let folder = find_folder(ctx, organization_id, folder_id)?;
    relocate_folder(
        ctx,
        "move_document_folder",
        folder.clone(),
        folder,
        parent_id,
        false,
        Vec::new(),
    )?
    .record_folder_commit(ctx, "erp.move_document_folder")
}

/// Reversibly hide an authorized subtree. Existing document deletion states stay unchanged.
#[reducer]
pub fn trash_document_folder(
    ctx: &ReducerContext,
    organization_id: u64,
    folder_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document_folder", "delete")?;
    let folder = find_folder(ctx, organization_id, folder_id)?;
    authorized_chain(
        ctx,
        organization_id,
        folder.company_id,
        Some(folder_id),
        FolderAccess::Write,
        true,
    )?;
    if folder_lifecycle::is_trashed(&folder)? {
        return Ok(());
    }
    authorized_chain(
        ctx,
        organization_id,
        folder.company_id,
        Some(folder_id),
        FolderAccess::Write,
        false,
    )?;
    let subtree = authorized_subtree(ctx, &folder)?;
    let documents = preflight_subtree_documents(ctx, &subtree, true)?;
    let evidence_before = DocumentEvidenceSnapshot::capture(ctx, organization_id, &documents)?;
    // Retire derived evidence just as individual document trash does. Restoring
    // a folder does not silently promote or charge for re-indexing those files.
    for doc in documents {
        if !doc.is_deleted {
            if let Some(company_id) = doc.company_id {
                crate::ai::evidence_source::retire_document_evidence(
                    ctx,
                    organization_id,
                    company_id,
                    doc.id,
                    "access_revoked",
                    "document folder was moved to trash",
                )?;
            }
        }
    }
    let evidence_changes = evidence_before.changes(ctx)?;
    let updated = DocumentFolder {
        metadata: Some(folder_lifecycle::trash_metadata(
            &folder,
            ctx.timestamp.to_micros_since_unix_epoch(),
            ctx.sender().to_hex().to_string(),
        )?),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..folder.clone()
    };
    ctx.db.doc_folder().id().update(updated.clone());
    let mut changes = prepare_folder_change(
        ctx,
        "trash_document_folder",
        Some(&folder),
        &updated,
        &[],
        vec!["trashed".to_string()],
    )?;
    changes.changes.extend(evidence_changes);
    changes.record_folder_commit(ctx, "erp.trash_document_folder")
}

/// Restore a folder into an explicitly selected permitted destination (`None` means root).
#[reducer]
pub fn restore_document_folder(
    ctx: &ReducerContext,
    organization_id: u64,
    folder_id: u64,
    parent_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document_folder", "write")?;
    let folder = find_folder(ctx, organization_id, folder_id)?;
    authorized_chain(
        ctx,
        organization_id,
        folder.company_id,
        Some(folder_id),
        FolderAccess::Write,
        true,
    )?;
    if !folder_lifecycle::is_trashed(&folder)? {
        authorized_chain(
            ctx,
            organization_id,
            folder.company_id,
            Some(folder_id),
            FolderAccess::Write,
            false,
        )?;
        return if folder.parent_id == parent_id {
            Ok(())
        } else {
            Err("Folder is already restored in a different destination".to_string())
        };
    }
    relocate_folder(
        ctx,
        "restore_document_folder",
        folder.clone(),
        folder,
        parent_id,
        true,
        Vec::new(),
    )?
    .record_folder_commit(ctx, "erp.restore_document_folder")
}

pub(super) fn update_folder(
    ctx: &ReducerContext,
    organization_id: u64,
    folder_id: u64,
    params: UpdateDocumentFolderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document_folder", "write")?;
    let folder = find_folder(ctx, organization_id, folder_id)?;
    authorized_chain(
        ctx,
        organization_id,
        folder.company_id,
        Some(folder_id),
        FolderAccess::Write,
        false,
    )?;
    if let Some(metadata) = params.metadata.as_deref() {
        folder_lifecycle::validate_metadata_change(folder.metadata.as_deref(), Some(metadata))?;
    }
    if params
        .is_access_restricted
        .is_some_and(|restricted| restricted != folder.is_access_restricted)
        && folder.owner_id != ctx.sender()
    {
        return Err("Only the folder owner can change its access restriction".to_string());
    }
    let name = validate_name(params.name.as_deref().unwrap_or(&folder.name))?;
    let parent_id = params.parent_id.or(folder.parent_id);
    require_unique_name(
        ctx,
        organization_id,
        folder.company_id,
        parent_id,
        Some(folder_id),
        &name,
    )?;
    let updated = DocumentFolder {
        name,
        description: params.description.or(folder.description.clone()),
        sequence: params.sequence.unwrap_or(folder.sequence),
        is_access_restricted: params
            .is_access_restricted
            .unwrap_or(folder.is_access_restricted),
        is_hidden: params.is_hidden.unwrap_or(folder.is_hidden),
        is_readonly: params.is_readonly.unwrap_or(folder.is_readonly),
        is_favorite: params.is_favorite.unwrap_or(folder.is_favorite),
        storage_id: params.storage_id.or(folder.storage_id),
        residency_region: params.residency_region.or(folder.residency_region.clone()),
        metadata: params.metadata.or(folder.metadata.clone()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..folder.clone()
    };
    let mut changed_fields = Vec::new();
    macro_rules! changed {
        ($($field:ident),* $(,)?) => {
            $(if updated.$field != folder.$field { changed_fields.push(stringify!($field).to_string()); })*
        };
    }
    changed!(
        name,
        description,
        sequence,
        is_access_restricted,
        is_hidden,
        is_readonly,
        is_favorite,
        storage_id,
        residency_region,
        metadata
    );
    let changes = if parent_id != folder.parent_id {
        relocate_folder(
            ctx,
            "update_document_folder",
            folder,
            updated,
            parent_id,
            false,
            changed_fields,
        )?
    } else {
        if changed_fields.is_empty() {
            return Ok(());
        }
        ctx.db.doc_folder().id().update(updated.clone());
        prepare_folder_change(
            ctx,
            "update_document_folder",
            Some(&folder),
            &updated,
            &[],
            changed_fields,
        )?
    };
    changes.record_folder_commit(ctx, "erp.update_document_folder")
}
