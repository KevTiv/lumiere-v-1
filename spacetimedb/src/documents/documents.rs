/// Document Management Module — Files, versions, and folder hierarchy
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **DocumentFolder** | Folder hierarchy for organizing documents |
/// | **Document** | File documents with metadata and access control |
/// | **DocumentVersion** | Version history for documents |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ============================================================================
// TABLES
// ============================================================================

/// Document Folder — Hierarchical container for organizing documents
#[spacetimedb::table(
    accessor = document_folder,
    public,
    index(name = "by_parent", accessor = folder_by_parent, btree(columns = [parent_id])),
    index(name = "by_owner", accessor = folder_by_owner, btree(columns = [owner_id]))
)]
pub struct DocumentFolder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<u64>,
    pub parent_path: String,
    pub sequence: u32,
    pub company_id: Option<u64>,
    pub owner_id: Identity,
    pub storage_id: Option<u64>,
    pub share_link: Option<String>,
    pub share_expires: Option<Timestamp>,
    pub write_access_ids: Vec<Identity>,
    pub read_access_ids: Vec<Identity>,
    pub document_count: u32,
    pub is_hidden: bool,
    pub is_readonly: bool,
    pub is_access_restricted: bool,
    pub is_favorite: bool,
    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Document — A file stored in the system with versioning and access control
#[derive(Clone)]
#[spacetimedb::table(
    accessor = document,
    public,
    index(name = "by_folder", accessor = document_by_folder, btree(columns = [folder_id])),
    index(name = "by_owner", accessor = document_by_owner, btree(columns = [owner_id])),
    index(name = "by_company", accessor = document_by_company, btree(columns = [company_id]))
)]
pub struct Document {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub file_name: String,
    pub file_size: u64,
    pub mimetype: String,
    pub checksum: Option<String>,
    pub index_content: Option<String>,
    pub access_token: Option<String>,
    pub url: Option<String>,
    pub res_model: Option<String>,
    pub res_id: Option<u64>,
    pub res_name: Option<String>,
    pub partner_id: Option<u64>,
    pub owner_id: Identity,
    pub company_id: Option<u64>,
    pub folder_id: Option<u64>,
    pub tag_ids: Vec<u64>,
    pub is_locked: bool,
    pub locked_by: Option<Identity>,
    pub locked_at: Option<Timestamp>,
    pub is_favorite: bool,
    pub is_shared: bool,
    pub share_link: Option<String>,
    pub share_expires: Option<Timestamp>,
    pub is_deleted: bool,
    pub deleted_at: Option<Timestamp>,
    pub deleted_by: Option<Identity>,
    pub version_count: u32,
    pub current_version_id: Option<u64>,
    pub download_count: u32,
    pub last_viewed_at: Option<Timestamp>,
    pub last_viewed_by: Option<Identity>,
    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Document Version — Immutable snapshot of a document at a point in time
#[spacetimedb::table(
    accessor = document_version,
    public,
    index(name = "by_document", accessor = version_by_document, btree(columns = [document_id]))
)]
pub struct DocumentVersion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub document_id: u64,
    pub version_number: u32,
    pub name: String,
    pub file_name: String,
    pub file_size: u64,
    pub mimetype: String,
    pub checksum: Option<String>,
    pub url: String,
    pub changes_description: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub is_current: bool,
    pub metadata: Option<String>,
}

// ============================================================================
// INPUT PARAMS
// ============================================================================

/// Params for creating a document folder.
/// Scope: `company_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDocumentFolderParams {
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<u64>,
    pub is_access_restricted: bool,
    pub is_hidden: bool,
    pub is_readonly: bool,
    pub is_favorite: bool,
    pub sequence: u32,
    pub storage_id: Option<u64>,
    pub metadata: Option<String>,
}

/// Params for creating a document.
/// Scope: `company_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDocumentParams {
    pub name: String,
    pub description: Option<String>,
    pub file_name: String,
    pub file_size: u64,
    pub mimetype: String,
    pub url: String,
    pub folder_id: Option<u64>,
    pub res_model: Option<String>,
    pub res_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub tag_ids: Vec<u64>,
    pub is_favorite: bool,
    pub metadata: Option<String>,
}

/// Params for adding a document version.
/// Scope: `company_id` and `document_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AddDocumentVersionParams {
    pub file_name: String,
    pub file_size: u64,
    pub mimetype: String,
    pub url: String,
    pub changes_description: Option<String>,
}

/// Params for updating document metadata.
/// Scope: `company_id` and `document_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateDocumentParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub folder_id: Option<u64>,
    pub tag_ids: Option<Vec<u64>>,
    pub is_favorite: Option<bool>,
    pub res_model: Option<String>,
    pub res_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a document folder
#[reducer]
pub fn create_document_folder(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateDocumentFolderParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "document_folder", "create")?;

    let parent_path = if let Some(pid) = params.parent_id {
        let parent = ctx
            .db
            .document_folder()
            .id()
            .find(&pid)
            .ok_or("Parent folder not found")?;
        format!("{}/{}", parent.parent_path, pid)
    } else {
        "/".to_string()
    };

    let write_access_ids = vec![ctx.sender()];

    let folder = ctx.db.document_folder().insert(DocumentFolder {
        id: 0,
        name: params.name,
        description: params.description,
        parent_id: params.parent_id,
        parent_path,
        sequence: params.sequence,
        company_id: Some(company_id),
        owner_id: ctx.sender(),
        storage_id: params.storage_id,
        share_link: None,
        share_expires: None,
        write_access_ids,
        read_access_ids: Vec::new(),
        document_count: 0,
        is_hidden: params.is_hidden,
        is_readonly: params.is_readonly,
        is_access_restricted: params.is_access_restricted,
        is_favorite: params.is_favorite,
        activity_ids: Vec::new(),
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
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
            company_id: Some(company_id),
            table_name: "document_folder",
            record_id: folder.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!("{{\"name\":\"{}\"}}", folder.name)),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    log::info!("Document folder created: id={}", folder.id);
    Ok(())
}

/// Upload / register a new document
#[reducer]
pub fn create_document(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateDocumentParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "document", "create")?;

    let doc = ctx.db.document().insert(Document {
        id: 0,
        name: params.name,
        description: params.description,
        file_name: params.file_name.clone(),
        file_size: params.file_size,
        mimetype: params.mimetype.clone(),
        checksum: None,
        index_content: None,
        access_token: None,
        url: Some(params.url.clone()),
        res_model: params.res_model,
        res_id: params.res_id,
        res_name: None,
        partner_id: params.partner_id,
        owner_id: ctx.sender(),
        company_id: Some(company_id),
        folder_id: params.folder_id,
        tag_ids: params.tag_ids,
        is_locked: false,
        locked_by: None,
        locked_at: None,
        is_favorite: params.is_favorite,
        is_shared: false,
        share_link: None,
        share_expires: None,
        is_deleted: false,
        deleted_at: None,
        deleted_by: None,
        version_count: 1,
        current_version_id: None,
        download_count: 0,
        last_viewed_at: None,
        last_viewed_by: None,
        activity_ids: Vec::new(),
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    // Create initial version
    let version = ctx.db.document_version().insert(DocumentVersion {
        id: 0,
        document_id: doc.id,
        version_number: 1,
        name: "Initial version".to_string(),
        file_name: params.file_name,
        file_size: params.file_size,
        mimetype: params.mimetype,
        checksum: None,
        url: params.url,
        changes_description: None,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        is_current: true,
        metadata: None,
    });

    let doc_id = doc.id;
    let doc_name = doc.name.clone();

    // Back-link version to document
    ctx.db.document().id().update(Document {
        current_version_id: Some(version.id),
        ..doc
    });

    // Increment folder document count
    if let Some(fid) = params.folder_id {
        if let Some(folder) = ctx.db.document_folder().id().find(&fid) {
            ctx.db.document_folder().id().update(DocumentFolder {
                document_count: folder.document_count + 1,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..folder
            });
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "document",
            record_id: doc_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!("{{\"name\":\"{}\"}}", doc_name)),
            changed_fields: vec!["uploaded".to_string()],
            metadata: None,
        },
    );

    log::info!("Document created: id={}", doc_id);
    Ok(())
}

/// Upload a new version of an existing document
#[reducer]
pub fn add_document_version(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    document_id: u64,
    params: AddDocumentVersionParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "document", "write")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.is_locked && doc.locked_by != Some(ctx.sender()) {
        return Err("Document is locked by another user".to_string());
    }

    let new_version_number = doc.version_count + 1;

    let version = ctx.db.document_version().insert(DocumentVersion {
        id: 0,
        document_id,
        version_number: new_version_number,
        name: format!("Version {}", new_version_number),
        file_name: params.file_name,
        file_size: params.file_size,
        mimetype: params.mimetype,
        checksum: None,
        url: params.url,
        changes_description: params.changes_description,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        is_current: true,
        metadata: None,
    });

    // Mark old current version as not current
    if let Some(old_vid) = doc.current_version_id {
        if let Some(old_v) = ctx.db.document_version().id().find(&old_vid) {
            ctx.db.document_version().id().update(DocumentVersion {
                is_current: false,
                ..old_v
            });
        }
    }

    ctx.db.document().id().update(Document {
        version_count: new_version_number,
        current_version_id: Some(version.id),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "document",
            record_id: document_id,
            action: "UPDATE",
            old_values: Some(format!("{{\"version_count\":{}}}", doc.version_count)),
            new_values: Some(format!("{{\"version_count\":{}}}", new_version_number)),
            changed_fields: vec!["new_version".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Document version added: doc={}, version={}",
        document_id,
        new_version_number
    );
    Ok(())
}

/// Lock a document for exclusive editing
#[reducer]
pub fn lock_document(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    document_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "document", "write")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.is_locked {
        return Err("Document is already locked".to_string());
    }

    ctx.db.document().id().update(Document {
        is_locked: true,
        locked_by: Some(ctx.sender()),
        locked_at: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "document",
            record_id: document_id,
            action: "UPDATE",
            old_values: Some("{\"is_locked\":false}".to_string()),
            new_values: Some("{\"is_locked\":true}".to_string()),
            changed_fields: vec!["locked".to_string()],
            metadata: None,
        },
    );

    log::info!("Document locked: id={}", document_id);
    Ok(())
}

/// Unlock a document
#[reducer]
pub fn unlock_document(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    document_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "document", "write")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.locked_by != Some(ctx.sender()) {
        check_permission(ctx, company_id, "document", "admin")?; // Admins can force-unlock
    }

    ctx.db.document().id().update(Document {
        is_locked: false,
        locked_by: None,
        locked_at: None,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "document",
            record_id: document_id,
            action: "UPDATE",
            old_values: Some("{\"is_locked\":true}".to_string()),
            new_values: Some("{\"is_locked\":false}".to_string()),
            changed_fields: vec!["unlocked".to_string()],
            metadata: None,
        },
    );

    log::info!("Document unlocked: id={}", document_id);
    Ok(())
}

/// Soft-delete a document
#[reducer]
pub fn delete_document(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    document_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "document", "delete")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.is_locked {
        return Err("Cannot delete a locked document".to_string());
    }

    let doc_name = doc.name.clone();

    // Decrement folder count
    if let Some(fid) = doc.folder_id {
        if let Some(folder) = ctx.db.document_folder().id().find(&fid) {
            ctx.db.document_folder().id().update(DocumentFolder {
                document_count: folder.document_count.saturating_sub(1),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..folder
            });
        }
    }

    ctx.db.document().id().update(Document {
        is_deleted: true,
        deleted_at: Some(ctx.timestamp),
        deleted_by: Some(ctx.sender()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "document",
            record_id: document_id,
            action: "DELETE",
            old_values: Some(format!("{{\"name\":\"{}\"}}", doc_name)),
            new_values: None,
            changed_fields: vec!["soft_deleted".to_string()],
            metadata: None,
        },
    );

    log::info!("Document soft-deleted: id={}", document_id);
    Ok(())
}

/// Update document metadata
#[reducer]
pub fn update_document(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    document_id: u64,
    params: UpdateDocumentParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "document", "write")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.is_locked && doc.locked_by != Some(ctx.sender()) {
        return Err("Document is locked by another user".to_string());
    }

    // Track changed fields
    let mut changed_fields = Vec::new();

    let new_doc = Document {
        name: params.name.unwrap_or(doc.name.clone()),
        description: params.description.or(doc.description.clone()),
        folder_id: params.folder_id.or(doc.folder_id),
        tag_ids: params.tag_ids.unwrap_or(doc.tag_ids.clone()),
        is_favorite: params.is_favorite.unwrap_or(doc.is_favorite),
        res_model: params.res_model.or(doc.res_model.clone()),
        res_id: params.res_id.or(doc.res_id),
        partner_id: params.partner_id.or(doc.partner_id),
        metadata: params.metadata.or(doc.metadata.clone()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc.clone()
    };

    if new_doc.name != doc.name {
        changed_fields.push("name");
    }
    if new_doc.description != doc.description {
        changed_fields.push("description");
    }
    if new_doc.folder_id != doc.folder_id {
        changed_fields.push("folder_id");
    }
    if new_doc.tag_ids != doc.tag_ids {
        changed_fields.push("tag_ids");
    }
    if new_doc.is_favorite != doc.is_favorite {
        changed_fields.push("is_favorite");
    }
    if new_doc.res_model != doc.res_model {
        changed_fields.push("res_model");
    }
    if new_doc.res_id != doc.res_id {
        changed_fields.push("res_id");
    }
    if new_doc.partner_id != doc.partner_id {
        changed_fields.push("partner_id");
    }
    if new_doc.metadata != doc.metadata {
        changed_fields.push("metadata");
    }

    ctx.db.document().id().update(new_doc);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "document",
            record_id: document_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: changed_fields.into_iter().map(|s| s.to_string()).collect(),
            metadata: None,
        },
    );

    log::info!("Document updated: id={}", document_id);
    Ok(())
}

/// Record a document view (increments download_count for downloads)
#[reducer]
pub fn record_document_view(
    ctx: &ReducerContext,
    _organization_id: u64,
    company_id: u64,
    document_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "document", "read")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    ctx.db.document().id().update(Document {
        last_viewed_at: Some(ctx.timestamp),
        last_viewed_by: Some(ctx.sender()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    Ok(())
}
