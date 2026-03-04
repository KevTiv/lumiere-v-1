/// Document Management Module — Files, versions, and folder hierarchy
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **DocumentFolder** | Folder hierarchy for organizing documents |
/// | **Document** | File documents with metadata and access control |
/// | **DocumentVersion** | Version history for documents |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

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
// REDUCERS
// ============================================================================

/// Create a document folder
#[reducer]
pub fn create_document_folder(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    name: String,
    parent_id: Option<u64>,
    is_access_restricted: bool,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "document_folder", "create")?;

    let parent_path = if let Some(pid) = parent_id {
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

    let folder = ctx.db.document_folder().insert(DocumentFolder {
        id: 0,
        name,
        description: None,
        parent_id,
        parent_path,
        sequence: 0,
        company_id,
        owner_id: ctx.sender(),
        storage_id: None,
        share_link: None,
        share_expires: None,
        write_access_ids: vec![ctx.sender()],
        read_access_ids: Vec::new(),
        document_count: 0,
        is_hidden: false,
        is_readonly: false,
        is_access_restricted,
        is_favorite: false,
        activity_ids: Vec::new(),
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "document_folder",
        folder.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Document folder created: id={}", folder.id);
    Ok(())
}

/// Upload / register a new document
#[reducer]
pub fn create_document(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    name: String,
    file_name: String,
    file_size: u64,
    mimetype: String,
    url: String,
    folder_id: Option<u64>,
    res_model: Option<String>,
    res_id: Option<u64>,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "document", "create")?;

    let doc = ctx.db.document().insert(Document {
        id: 0,
        name,
        description: None,
        file_name: file_name.clone(),
        file_size,
        mimetype: mimetype.clone(),
        checksum: None,
        index_content: None,
        access_token: None,
        url: Some(url.clone()),
        res_model,
        res_id,
        res_name: None,
        partner_id: None,
        owner_id: ctx.sender(),
        company_id,
        folder_id,
        tag_ids: Vec::new(),
        is_locked: false,
        locked_by: None,
        locked_at: None,
        is_favorite: false,
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
        metadata: None,
    });

    // Create initial version
    let version = ctx.db.document_version().insert(DocumentVersion {
        id: 0,
        document_id: doc.id,
        version_number: 1,
        name: "Initial version".to_string(),
        file_name,
        file_size,
        mimetype,
        checksum: None,
        url,
        changes_description: None,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        is_current: true,
        metadata: None,
    });

    // Back-link version to document
    ctx.db.document().id().update(Document {
        current_version_id: Some(version.id),
        ..doc
    });

    // Increment folder document count
    if let Some(fid) = folder_id {
        if let Some(folder) = ctx.db.document_folder().id().find(&fid) {
            ctx.db.document_folder().id().update(DocumentFolder {
                document_count: folder.document_count + 1,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..folder
            });
        }
    }

    write_audit_log(
        ctx,
        cid,
        None,
        "document",
        doc.id,
        "create",
        None,
        None,
        vec!["uploaded".to_string()],
    );

    log::info!("Document created: id={}", doc.id);
    Ok(())
}

/// Upload a new version of an existing document
#[reducer]
pub fn add_document_version(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    document_id: u64,
    file_name: String,
    file_size: u64,
    mimetype: String,
    url: String,
    changes_description: Option<String>,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "document", "write")?;

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
        file_name,
        file_size,
        mimetype,
        checksum: None,
        url,
        changes_description,
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

    write_audit_log(
        ctx,
        cid,
        None,
        "document",
        document_id,
        "write",
        None,
        None,
        vec!["new_version".to_string()],
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
    company_id: Option<u64>,
    document_id: u64,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "document", "write")?;

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

    write_audit_log(
        ctx,
        cid,
        None,
        "document",
        document_id,
        "write",
        None,
        None,
        vec!["locked".to_string()],
    );

    log::info!("Document locked: id={}", document_id);
    Ok(())
}

/// Unlock a document
#[reducer]
pub fn unlock_document(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    document_id: u64,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "document", "write")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.locked_by != Some(ctx.sender()) {
        check_permission(ctx, cid, "document", "admin")?; // Admins can force-unlock
    }

    ctx.db.document().id().update(Document {
        is_locked: false,
        locked_by: None,
        locked_at: None,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "document",
        document_id,
        "write",
        None,
        None,
        vec!["unlocked".to_string()],
    );

    log::info!("Document unlocked: id={}", document_id);
    Ok(())
}

/// Soft-delete a document
#[reducer]
pub fn delete_document(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    document_id: u64,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "document", "delete")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.is_locked {
        return Err("Cannot delete a locked document".to_string());
    }

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

    write_audit_log(
        ctx,
        cid,
        None,
        "document",
        document_id,
        "delete",
        None,
        None,
        vec!["soft_deleted".to_string()],
    );

    log::info!("Document soft-deleted: id={}", document_id);
    Ok(())
}

/// Record a document view (increments download_count for downloads)
#[reducer]
pub fn record_document_view(
    ctx: &ReducerContext,
    document_id: u64,
) -> Result<(), String> {
    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    ctx.db.document().id().update(Document {
        last_viewed_at: Some(ctx.timestamp),
        last_viewed_by: Some(ctx.sender()),
        ..doc
    });

    Ok(())
}
