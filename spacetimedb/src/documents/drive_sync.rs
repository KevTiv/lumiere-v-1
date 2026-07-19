//! Wave D — Google Drive / SharePoint sync → Document rows + conflict policy.

use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::documents::documents::{
    add_document_version, create_document, document, CreateDocumentParams, Document,
};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::integrations::google_drive::{google_drive_connection, DriveConflictPolicy};

#[derive(Clone)]
#[spacetimedb::table(
    accessor = document_external_ref,
    public,
    index(accessor = external_ref_by_document, btree(columns = [document_id])),
    index(accessor = external_ref_by_org, btree(columns = [organization_id])),
    index(accessor = external_ref_by_external_id, btree(columns = [external_id]))
)]
pub struct DocumentExternalRef {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub document_id: u64,
    /// google_drive | sharepoint
    pub provider: String,
    pub connection_id: Option<u64>,
    pub external_id: String,
    pub etag: Option<String>,
    pub last_sync_at: Timestamp,
    /// inbound | outbound
    pub last_direction: String,
    pub create_uid: spacetimedb::Identity,
    pub create_date: Timestamp,
    pub write_uid: spacetimedb::Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SyncExternalFileToDocumentParams {
    pub provider: String,
    pub connection_id: Option<u64>,
    pub external_id: String,
    pub etag: Option<String>,
    pub name: String,
    pub file_name: String,
    pub file_size: u64,
    pub mimetype: String,
    pub url: String,
    pub checksum: String,
    pub folder_id: Option<u64>,
    pub company_id: Option<u64>,
    pub metadata: Option<String>,
}

fn resolve_conflict_policy(
    ctx: &ReducerContext,
    organization_id: u64,
    connection_id: Option<u64>,
) -> DriveConflictPolicy {
    let Some(cid) = connection_id else {
        return DriveConflictPolicy::PreferRemote;
    };
    ctx.db
        .google_drive_connection()
        .id()
        .find(&cid)
        .filter(|c| c.organization_id == organization_id)
        .map(|c| c.conflict_policy)
        .unwrap_or(DriveConflictPolicy::PreferRemote)
}

fn find_external_ref(
    ctx: &ReducerContext,
    organization_id: u64,
    provider: &str,
    external_id: &str,
) -> Option<DocumentExternalRef> {
    ctx.db
        .document_external_ref()
        .external_ref_by_external_id()
        .filter(&external_id.to_string())
        .find(|r| r.organization_id == organization_id && r.provider == provider)
}

/// Worker-facing reducer: register or update a DMS document from an external file copy/link.
#[reducer]
pub fn sync_external_file_to_document(
    ctx: &ReducerContext,
    organization_id: u64,
    params: SyncExternalFileToDocumentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "write")?;

    let provider = params.provider.trim().to_ascii_lowercase();
    if provider != "google_drive" && provider != "sharepoint" {
        return Err("provider must be google_drive or sharepoint".to_string());
    }
    let external_id = params.external_id.trim().to_string();
    if external_id.is_empty() {
        return Err("external_id is required".to_string());
    }

    if let Some(cid) = params.connection_id {
        let conn = ctx
            .db
            .google_drive_connection()
            .id()
            .find(&cid)
            .ok_or("Drive connection not found")?;
        if conn.organization_id != organization_id {
            return Err("Drive connection does not belong to this organization".to_string());
        }
        if provider == "google_drive" && !conn.sync_enabled {
            return Err("Drive connection sync is disabled".to_string());
        }
    }

    let policy = resolve_conflict_policy(ctx, organization_id, params.connection_id);
    let existing = find_external_ref(ctx, organization_id, &provider, &external_id);

    if let Some(xref) = existing {
        let doc = ctx
            .db
            .document()
            .id()
            .find(&xref.document_id)
            .ok_or("Linked document missing for external ref")?;
        if doc.organization_id != organization_id {
            return Err("Linked document org mismatch".to_string());
        }

        let etag_unchanged = matches!((&params.etag, &xref.etag), (Some(a), Some(b)) if a == b);
        let etag_changed = matches!((&params.etag, &xref.etag), (Some(a), Some(b)) if a != b)
            || (params.etag.is_some() && xref.etag.is_none());

        match policy {
            DriveConflictPolicy::Skip => {
                ctx.db
                    .document_external_ref()
                    .id()
                    .update(DocumentExternalRef {
                        last_sync_at: ctx.timestamp,
                        last_direction: "inbound_skipped".to_string(),
                        write_uid: ctx.sender(),
                        write_date: ctx.timestamp,
                        ..xref
                    });
                return Ok(());
            }
            DriveConflictPolicy::Manual if etag_changed => {
                return Err(
                    "conflict: remote file changed; Manual policy requires operator resolve"
                        .to_string(),
                );
            }
            DriveConflictPolicy::PreferLocal => {
                ctx.db
                    .document_external_ref()
                    .id()
                    .update(DocumentExternalRef {
                        etag: params.etag.or(xref.etag.clone()),
                        last_sync_at: ctx.timestamp,
                        last_direction: "inbound_skipped_local".to_string(),
                        write_uid: ctx.sender(),
                        write_date: ctx.timestamp,
                        ..xref
                    });
                return Ok(());
            }
            DriveConflictPolicy::PreferRemote | DriveConflictPolicy::Manual => {
                if etag_unchanged {
                    ctx.db
                        .document_external_ref()
                        .id()
                        .update(DocumentExternalRef {
                            last_sync_at: ctx.timestamp,
                            write_uid: ctx.sender(),
                            write_date: ctx.timestamp,
                            ..xref
                        });
                    return Ok(());
                }
            }
        }

        if !doc.is_deleted {
            add_document_version(
                ctx,
                organization_id,
                doc.id,
                crate::documents::documents::AddDocumentVersionParams {
                    file_name: params.file_name.clone(),
                    file_size: params.file_size,
                    mimetype: params.mimetype.clone(),
                    url: params.url.clone(),
                    checksum: params.checksum.clone(),
                    changes_description: Some(format!("Synced from {provider}")),
                },
            )?;
            // Update display name if remote renamed.
            if !params.name.trim().is_empty() && params.name != doc.name {
                ctx.db.document().id().update(Document {
                    name: params.name.clone(),
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..doc
                });
            }
        }

        ctx.db
            .document_external_ref()
            .id()
            .update(DocumentExternalRef {
                etag: params.etag.clone(),
                last_sync_at: ctx.timestamp,
                last_direction: "inbound".to_string(),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                metadata: params.metadata.clone().or(xref.metadata.clone()),
                ..xref
            });

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: doc.company_id,
                table_name: "document_external_ref",
                record_id: xref.id,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "external_id": external_id,
                        "policy": format!("{:?}", policy),
                    })
                    .to_string(),
                ),
                changed_fields: vec!["etag".to_string(), "last_sync_at".to_string()],
                metadata: Some("{\"wave\":\"d\",\"sync\":\"update\"}".to_string()),
            },
        );
        return Ok(());
    }

    // New inbound file → create Document.
    create_document(
        ctx,
        organization_id,
        params.company_id,
        CreateDocumentParams {
            name: params.name.clone(),
            description: Some(format!("Imported from {provider}")),
            file_name: params.file_name.clone(),
            file_size: params.file_size,
            mimetype: params.mimetype.clone(),
            url: params.url.clone(),
            checksum: params.checksum.clone(),
            folder_id: params.folder_id,
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            index_content: None,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: Some(
                params
                    .metadata
                    .clone()
                    .unwrap_or_else(|| {
                        serde_json::json!({
                            "external_provider": provider,
                            "external_id": external_id,
                        })
                        .to_string()
                    }),
            ),
        },
    )?;

    let checksum_lc = params.checksum.trim().to_ascii_lowercase();
    let doc = ctx
        .db
        .document()
        .iter()
        .filter(|d| {
            d.organization_id == organization_id
                && d.url.as_deref() == Some(params.url.as_str())
                && d.checksum.as_deref() == Some(checksum_lc.as_str())
        })
        .max_by_key(|d| d.id)
        .ok_or("document missing after sync create")?;

    let xref = ctx.db.document_external_ref().insert(DocumentExternalRef {
        id: 0,
        organization_id,
        document_id: doc.id,
        provider: provider.clone(),
        connection_id: params.connection_id,
        external_id: external_id.clone(),
        etag: params.etag,
        last_sync_at: ctx.timestamp,
        last_direction: "inbound".to_string(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: doc.company_id,
            table_name: "document_external_ref",
            record_id: xref.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "document_id": doc.id,
                    "provider": provider,
                    "external_id": external_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["external_id".to_string()],
            metadata: Some("{\"wave\":\"d\",\"sync\":\"create\"}".to_string()),
        },
    );
    Ok(())
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetDriveConflictPolicyParams {
    pub conflict_policy: DriveConflictPolicy,
}

#[reducer]
pub fn set_google_drive_conflict_policy(
    ctx: &ReducerContext,
    organization_id: u64,
    connection_id: u64,
    params: SetDriveConflictPolicyParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;
    let conn = ctx
        .db
        .google_drive_connection()
        .id()
        .find(&connection_id)
        .ok_or("Drive connection not found")?;
    if conn.organization_id != organization_id {
        return Err("Drive connection does not belong to this organization".to_string());
    }

    use crate::integrations::google_drive::GoogleDriveConnection;
    ctx.db
        .google_drive_connection()
        .id()
        .update(GoogleDriveConnection {
            conflict_policy: params.conflict_policy.clone(),
            updated_at: ctx.timestamp,
            ..conn
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "google_drive_connection",
            record_id: connection_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "conflict_policy": format!("{:?}", params.conflict_policy) })
                    .to_string(),
            ),
            changed_fields: vec!["conflict_policy".to_string()],
            metadata: Some("{\"wave\":\"d\"}".to_string()),
        },
    );
    Ok(())
}
