/// Document Management Module — Files, versions, and folder hierarchy
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **DocumentFolder** | Folder hierarchy for organizing documents |
/// | **Document** | File documents with metadata and access control |
/// | **DocumentVersion** | Version history for documents |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::account_move;
use crate::core::organization::require_company_in_organization;
use crate::crm::contacts::contact;
use crate::expenses::expenses::{expense_sheet, hr_expense};
use crate::helpdesk::tickets::helpdesk_ticket;
use crate::hr::employees::hr_employee;
use crate::inventory::product::product;
use crate::projects::tasks::project_task;
use crate::purchasing::purchase_orders::purchase_order;
use crate::sales::sales_core::sale_order;
use crate::subscriptions::tables::subscription;
use crate::documents::pack_locale::{
    build_default_index_content, compute_purge_after, document_residency_region_for_company,
    document_search_language_for_company, truncate_index_content, validate_fiscal_archive,
};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ============================================================================
// TABLES
// ============================================================================

/// Document Folder — Hierarchical container for organizing documents
#[derive(Clone)]
#[spacetimedb::table(
    accessor = doc_folder,
    public,
    index(accessor = doc_folder_by_org, btree(columns = [organization_id])),
    index(accessor = folder_by_parent, btree(columns = [parent_id])),
    index(accessor = folder_by_owner, btree(columns = [owner_id]))
)]
pub struct DocumentFolder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // Tenant isolation
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<u64>,
    pub parent_path: String,
    pub sequence: u32,
    pub company_id: Option<u64>, // ERP company entity scope (within org)
    pub owner_id: Identity,
    pub storage_id: Option<u64>,
    pub share_link: Option<String>,
    pub share_expires: Option<Timestamp>,
    pub write_access_ids: Vec<Identity>,
    pub read_access_ids: Vec<Identity>,
    pub document_count: u32,
    /// Object-store residency tag (e.g. `au`, `sg`, `br`) — guides blob path selection.
    pub residency_region: Option<String>,
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
    index(accessor = document_by_org, btree(columns = [organization_id])),
    index(name = "by_folder", accessor = document_by_folder, btree(columns = [folder_id])),
    index(accessor = document_by_owner, btree(columns = [owner_id])),
    index(accessor = document_by_company, btree(columns = [company_id]))
)]
pub struct Document {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // Tenant isolation
    pub name: String,
    pub description: Option<String>,
    pub file_name: String,
    pub file_size: u64,
    pub mimetype: String,
    pub checksum: Option<String>,
    pub index_content: Option<String>,
    /// Analyzer/locale hint for FTS (from country pack or explicit index).
    pub index_language: Option<String>,
    pub access_token: Option<String>,
    pub url: Option<String>,
    pub res_model: Option<String>,
    pub res_id: Option<u64>,
    pub res_name: Option<String>,
    pub partner_id: Option<u64>,
    pub owner_id: Identity,
    pub company_id: Option<u64>, // ERP company entity scope (within org)
    pub folder_id: Option<u64>,
    pub tag_ids: Vec<u64>,
    pub is_locked: bool,
    pub locked_by: Option<Identity>,
    pub locked_at: Option<Timestamp>,
    /// When set, lock auto-expires at this timestamp (optional lease TTL).
    pub locked_until: Option<Timestamp>,
    pub is_favorite: bool,
    pub is_shared: bool,
    pub share_link: Option<String>,
    pub share_expires: Option<Timestamp>,
    pub is_deleted: bool,
    pub deleted_at: Option<Timestamp>,
    pub deleted_by: Option<Identity>,
    /// Link to `data_classification` for retention policy.
    pub classification_id: Option<u64>,
    pub retention_days: Option<u32>,
    /// When set and in the past, soft-deleted docs are eligible for hard purge.
    pub purge_after: Option<Timestamp>,
    /// Pack-aware fiscal archive kind (`nfe_xml`, `myinvois_xml`, …).
    pub fiscal_kind: Option<String>,
    /// Object-store residency tag inherited from folder/pack/upload.
    pub residency_region: Option<String>,
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
#[derive(Clone)]
#[spacetimedb::table(
    accessor = document_version,
    public,
    index(name = "by_document", accessor = version_by_document, btree(columns = [document_id])),
    index(accessor = version_by_org, btree(columns = [organization_id]))
)]
pub struct DocumentVersion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
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
/// Scope: `organization_id` + optional `company_id` are flat reducer params.
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
    pub residency_region: Option<String>,
    pub metadata: Option<String>,
}

/// Params for creating a document.
/// Scope: `organization_id` + optional `company_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDocumentParams {
    pub name: String,
    pub description: Option<String>,
    pub file_name: String,
    pub file_size: u64,
    pub mimetype: String,
    pub url: String,
    /// SHA-256 hex of the object bytes (required with non-empty url).
    pub checksum: String,
    pub folder_id: Option<u64>,
    pub res_model: Option<String>,
    pub res_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub tag_ids: Vec<u64>,
    pub is_favorite: bool,
    /// Optional extracted text / FTS body (capped server-side).
    pub index_content: Option<String>,
    pub classification_id: Option<u64>,
    pub retention_days: Option<u32>,
    pub fiscal_kind: Option<String>,
    pub residency_region: Option<String>,
    pub metadata: Option<String>,
}

/// Params for adding a document version.
/// Scope: `organization_id` + `document_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AddDocumentVersionParams {
    pub file_name: String,
    pub file_size: u64,
    pub mimetype: String,
    pub url: String,
    /// SHA-256 hex of the object bytes (required with non-empty url).
    pub checksum: String,
    pub changes_description: Option<String>,
}

/// Params for updating document metadata.
/// Scope: `organization_id` + `document_id` are flat reducer params.
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

/// Params for updating a document folder (rename / move / flags).
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateDocumentFolderParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub parent_id: Option<u64>,
    pub sequence: Option<u32>,
    pub is_access_restricted: Option<bool>,
    pub is_hidden: Option<bool>,
    pub is_readonly: Option<bool>,
    pub is_favorite: Option<bool>,
    pub storage_id: Option<u64>,
    pub residency_region: Option<String>,
    pub metadata: Option<String>,
}

// ============================================================================
// HELPERS
// ============================================================================

fn validate_blob_registration(url: &str, file_size: u64, checksum: &str) -> Result<(), String> {
    if url.trim().is_empty() {
        return Err(
            "url is required — upload the file to object storage before registering".to_string(),
        );
    }
    if file_size == 0 {
        return Err("file_size must be greater than zero".to_string());
    }
    let checksum = checksum.trim();
    if checksum.is_empty() {
        return Err("checksum is required (sha-256 hex of object bytes)".to_string());
    }
    if checksum.len() != 64 || !checksum.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("checksum must be a 64-character sha-256 hex digest".to_string());
    }
    Ok(())
}

fn lock_is_expired(doc: &Document, now: Timestamp) -> bool {
    match doc.locked_until {
        Some(until) => now.to_micros_since_unix_epoch() >= until.to_micros_since_unix_epoch(),
        None => false,
    }
}

/// Clear an expired lock in-place and persist. Returns the (possibly refreshed) document.
fn refresh_expired_lock(ctx: &ReducerContext, doc: Document) -> Document {
    if doc.is_locked && lock_is_expired(&doc, ctx.timestamp) {
        let cleared = Document {
            is_locked: false,
            locked_by: None,
            locked_at: None,
            locked_until: None,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..doc
        };
        ctx.db.document().id().update(cleared.clone());
        return cleared;
    }
    doc
}

fn adjust_folder_document_count(ctx: &ReducerContext, folder_id: Option<u64>, delta: i32) {
    let Some(fid) = folder_id else {
        return;
    };
    let Some(folder) = ctx.db.doc_folder().id().find(&fid) else {
        return;
    };
    let next = if delta >= 0 {
        folder.document_count.saturating_add(delta as u32)
    } else {
        folder.document_count.saturating_sub((-delta) as u32)
    };
    ctx.db.doc_folder().id().update(DocumentFolder {
        document_count: next,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..folder
    });
}

fn folder_allows_write(folder: &DocumentFolder, sender: Identity) -> Result<(), String> {
    if folder.is_readonly {
        return Err("Folder is read-only".to_string());
    }
    if !folder.is_access_restricted {
        return Ok(());
    }
    if folder.owner_id == sender || folder.write_access_ids.contains(&sender) {
        return Ok(());
    }
    Err("You do not have write access to this folder".to_string())
}

fn folder_allows_read(folder: &DocumentFolder, sender: Identity) -> Result<(), String> {
    if !folder.is_access_restricted {
        return Ok(());
    }
    if folder.owner_id == sender
        || folder.write_access_ids.contains(&sender)
        || folder.read_access_ids.contains(&sender)
    {
        return Ok(());
    }
    Err("You do not have read access to this folder".to_string())
}

fn ensure_folder_company_scope(
    folder: &DocumentFolder,
    company_id: Option<u64>,
) -> Result<(), String> {
    match (folder.company_id, company_id) {
        (Some(fc), Some(c)) if fc != c => Err("Folder does not belong to this company".to_string()),
        _ => Ok(()),
    }
}

// ============================================================================
// RELATIONAL INTEGRITY HELPERS (DOC-001 / DOC-002 / DOC-005)
// ============================================================================

/// Allowed ERP model names for `res_model` on documents.
/// Each entry corresponds to a SpacetimeDB table accessor that can own a document.
/// (DOC-001)
const ALLOWED_RES_MODELS: &[&str] = &[
    "sale_order",
    "purchase_order",
    "account_move",
    "hr_employee",
    "hr_contract",
    "contact",
    "product",
    "project_project",
    "project_task",
    "helpdesk_ticket",
    "mrp_production",
    "hr_expense",
    "expense_sheet",
    "subscription",
    "proposal",
    "document_folder",
    "hr_payslip",
];

/// Validate `res_model` against the whitelist and, when `res_id` is also
/// provided, confirm the referenced record exists in the correct org.
/// (DOC-001 + DOC-002)
fn validate_res_model_and_id(
    ctx: &ReducerContext,
    res_model: Option<&str>,
    res_id: Option<u64>,
    organization_id: u64,
) -> Result<(), String> {
    let model = match res_model {
        None => return Ok(()),
        Some(m) => m,
    };
    if !ALLOWED_RES_MODELS.contains(&model) {
        return Err(format!(
            "res_model '{}' is not in the list of allowed ERP models",
            model
        ));
    }
    let id = match res_id {
        None => return Ok(()), // model is valid; no FK to check
        Some(id) => id,
    };
    // DOC-002: verify the referenced record exists and belongs to this org.
    let exists = match model {
        "sale_order" => ctx
            .db
            .sale_order()
            .id()
            .find(&id)
            .is_some_and(|r| r.organization_id == organization_id),
        "purchase_order" => ctx
            .db
            .purchase_order()
            .id()
            .find(&id)
            .is_some_and(|r| r.organization_id == organization_id),
        "account_move" => ctx
            .db
            .account_move()
            .id()
            .find(&id)
            .is_some_and(|r| r.organization_id == organization_id),
        "hr_employee" => ctx
            .db
            .hr_employee()
            .id()
            .find(&id)
            .is_some_and(|r| r.organization_id == organization_id),
        "contact" => ctx
            .db
            .contact()
            .id()
            .find(&id)
            .is_some_and(|r| r.organization_id == organization_id),
        "product" => ctx
            .db
            .product()
            .id()
            .find(&id)
            .is_some_and(|r| r.organization_id == organization_id),
        "project_task" => ctx
            .db
            .project_task()
            .id()
            .find(&id)
            .is_some_and(|r| r.organization_id == organization_id),
        "helpdesk_ticket" => ctx
            .db
            .helpdesk_ticket()
            .id()
            .find(&id)
            .is_some_and(|r| r.organization_id == organization_id),
        "hr_expense" => ctx
            .db
            .hr_expense()
            .id()
            .find(&id)
            .is_some_and(|r| r.organization_id == organization_id),
        "expense_sheet" => ctx
            .db
            .expense_sheet()
            .id()
            .find(&id)
            .is_some_and(|r| r.organization_id == organization_id),
        "subscription" => ctx
            .db
            .subscription()
            .id()
            .find(&id)
            .is_some_and(|r| r.organization_id == organization_id),
        // For models without a direct FK lookup (e.g., hr_contract, project_project,
        // mrp_production, proposal, document_folder, hr_payslip), we accept the
        // whitelisted model name as sufficient — FK existence can be tightened in
        // a follow-up pass once those tables stabilize.
        _ => true,
    };
    if !exists {
        return Err(format!(
            "res_id {} not found in model '{}' for this organization",
            id, model
        ));
    }
    Ok(())
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a document folder
#[reducer]
pub fn create_document_folder(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateDocumentFolderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document_folder", "create")?;

    let parent_path = if let Some(pid) = params.parent_id {
        let parent = ctx
            .db
            .doc_folder()
            .id()
            .find(&pid)
            .ok_or("Parent folder not found")?;

        if parent.organization_id != organization_id {
            return Err("Parent folder does not belong to this organization".to_string());
        }
        format!("{}/{}", parent.parent_path, pid)
    } else {
        "/".to_string()
    };

    let write_access_ids = vec![ctx.sender()];

    let folder = ctx.db.doc_folder().insert(DocumentFolder {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        parent_id: params.parent_id,
        parent_path,
        sequence: params.sequence,
        company_id,
        owner_id: ctx.sender(),
        storage_id: params.storage_id,
        share_link: None,
        share_expires: None,
        write_access_ids,
        read_access_ids: Vec::new(),
        document_count: 0,
        residency_region: params
            .residency_region
            .or_else(|| document_residency_region_for_company(ctx, organization_id, company_id)),
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
            company_id,
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
    company_id: Option<u64>,
    params: CreateDocumentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "create")?;
    validate_blob_registration(&params.url, params.file_size, &params.checksum)?;

    // DOC-005: Validate company belongs to org when provided
    if let Some(cid) = company_id {
        require_company_in_organization(ctx, organization_id, cid)?;
    }

    // DOC-001 + DOC-002: Validate res_model whitelist and res_id FK
    validate_res_model_and_id(
        ctx,
        params.res_model.as_deref(),
        params.res_id,
        organization_id,
    )?;

    if let Some(ref kind) = params.fiscal_kind {
        validate_fiscal_archive(ctx, organization_id, company_id, kind, &params.mimetype)?;
    }

    let folder_id = params.folder_id;
    let mut folder_residency = None;
    if let Some(fid) = folder_id {
        let folder = ctx
            .db
            .doc_folder()
            .id()
            .find(&fid)
            .ok_or("Folder not found")?;
        if folder.organization_id != organization_id {
            return Err("Folder does not belong to this organization".to_string());
        }
        ensure_folder_company_scope(&folder, company_id)?;
        folder_allows_write(&folder, ctx.sender())?;
        folder_residency = folder.residency_region.clone();
    }

    let checksum = params.checksum.trim().to_lowercase();
    let index_content = Some(truncate_index_content(&build_default_index_content(
        &params.name,
        params.description.as_deref(),
        &params.file_name,
        params.index_content.as_deref(),
    )));
    let index_language = document_search_language_for_company(ctx, organization_id, company_id);
    let residency_region = params
        .residency_region
        .or(folder_residency)
        .or_else(|| document_residency_region_for_company(ctx, organization_id, company_id));

    let doc = ctx.db.document().insert(Document {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        file_name: params.file_name.clone(),
        file_size: params.file_size,
        mimetype: params.mimetype.clone(),
        checksum: Some(checksum.clone()),
        index_content,
        index_language,
        access_token: None,
        url: Some(params.url.clone()),
        res_model: params.res_model,
        res_id: params.res_id,
        res_name: None,
        partner_id: params.partner_id,
        owner_id: ctx.sender(),
        company_id,
        folder_id,
        tag_ids: params.tag_ids,
        is_locked: false,
        locked_by: None,
        locked_at: None,
        locked_until: None,
        is_favorite: params.is_favorite,
        is_shared: false,
        share_link: None,
        share_expires: None,
        is_deleted: false,
        deleted_at: None,
        deleted_by: None,
        classification_id: params.classification_id,
        retention_days: params.retention_days,
        purge_after: None,
        fiscal_kind: params.fiscal_kind,
        residency_region,
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
        organization_id,
        document_id: doc.id,
        version_number: 1,
        name: "Initial version".to_string(),
        file_name: params.file_name,
        file_size: params.file_size,
        mimetype: params.mimetype,
        checksum: Some(checksum),
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

    adjust_folder_document_count(ctx, folder_id, 1);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
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
    document_id: u64,
    params: AddDocumentVersionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "write")?;
    validate_blob_registration(&params.url, params.file_size, &params.checksum)?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.organization_id != organization_id {
        return Err("Document does not belong to this organization".to_string());
    }

    if doc.is_deleted {
        return Err("Cannot version a deleted document".to_string());
    }

    let doc = refresh_expired_lock(ctx, doc);

    if doc.is_locked && doc.locked_by != Some(ctx.sender()) {
        return Err("Document is locked by another user".to_string());
    }

    if let Some(fid) = doc.folder_id {
        if let Some(folder) = ctx.db.doc_folder().id().find(&fid) {
            folder_allows_write(&folder, ctx.sender())?;
        }
    }

    let old_version_count = doc.version_count;
    let company_id = doc.company_id;
    let current_version_id = doc.current_version_id;
    let new_version_number = old_version_count + 1;
    let checksum = params.checksum.trim().to_lowercase();

    let version = ctx.db.document_version().insert(DocumentVersion {
        id: 0,
        organization_id,
        document_id,
        version_number: new_version_number,
        name: format!("Version {}", new_version_number),
        file_name: params.file_name.clone(),
        file_size: params.file_size,
        mimetype: params.mimetype.clone(),
        checksum: Some(checksum.clone()),
        url: params.url.clone(),
        changes_description: params.changes_description,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        is_current: true,
        metadata: None,
    });

    // Mark old current version as not current
    if let Some(old_vid) = current_version_id {
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
        file_name: params.file_name,
        file_size: params.file_size,
        mimetype: params.mimetype,
        checksum: Some(checksum),
        url: Some(params.url),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document",
            record_id: document_id,
            action: "UPDATE",
            old_values: Some(format!("{{\"version_count\":{}}}", old_version_count)),
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

/// Lock a document for exclusive editing.
/// Optional `lease_seconds` sets `locked_until` (TTL); omit/`None` for an open-ended lock.
#[reducer]
pub fn lock_document(
    ctx: &ReducerContext,
    organization_id: u64,
    document_id: u64,
    lease_seconds: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "write")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.organization_id != organization_id {
        return Err("Document does not belong to this organization".to_string());
    }

    if doc.is_deleted {
        return Err("Cannot lock a deleted document".to_string());
    }

    let doc = refresh_expired_lock(ctx, doc);

    if doc.is_locked {
        return Err("Document is already locked".to_string());
    }

    if let Some(fid) = doc.folder_id {
        if let Some(folder) = ctx.db.doc_folder().id().find(&fid) {
            folder_allows_write(&folder, ctx.sender())?;
        }
    }

    let locked_until =
        lease_seconds.map(|secs| ctx.timestamp + std::time::Duration::from_secs(secs.max(1)));

    let company_id = doc.company_id;
    ctx.db.document().id().update(Document {
        is_locked: true,
        locked_by: Some(ctx.sender()),
        locked_at: Some(ctx.timestamp),
        locked_until,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
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
    document_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "write")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.organization_id != organization_id {
        return Err("Document does not belong to this organization".to_string());
    }

    let doc = refresh_expired_lock(ctx, doc);

    if !doc.is_locked {
        return Ok(());
    }

    if doc.locked_by != Some(ctx.sender()) {
        check_permission(ctx, organization_id, "document", "admin")?; // Admins can force-unlock
    }

    let company_id = doc.company_id;
    ctx.db.document().id().update(Document {
        is_locked: false,
        locked_by: None,
        locked_at: None,
        locked_until: None,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
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
    document_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "delete")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.organization_id != organization_id {
        return Err("Document does not belong to this organization".to_string());
    }

    if doc.is_deleted {
        return Err("Document is already deleted".to_string());
    }

    if crate::documents::legal_hold::document_has_active_legal_hold(
        ctx,
        organization_id,
        document_id,
    ) {
        return Err("Cannot delete a document under legal hold".to_string());
    }

    let doc = refresh_expired_lock(ctx, doc);

    if doc.is_locked {
        return Err("Cannot delete a locked document".to_string());
    }

    if let Some(fid) = doc.folder_id {
        if let Some(folder) = ctx.db.doc_folder().id().find(&fid) {
            folder_allows_write(&folder, ctx.sender())?;
        }
    }

    let doc_name = doc.name.clone();
    let company_id = doc.company_id;
    let folder_id = doc.folder_id;

    adjust_folder_document_count(ctx, folder_id, -1);

    let purge_after = doc.retention_days.and_then(|days| {
        if days > 0 {
            Some(compute_purge_after(ctx.timestamp, days))
        } else {
            None
        }
    });

    ctx.db.document().id().update(Document {
        is_deleted: true,
        deleted_at: Some(ctx.timestamp),
        deleted_by: Some(ctx.sender()),
        purge_after,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
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

/// Restore a soft-deleted document (recycle bin).
#[reducer]
pub fn restore_document(
    ctx: &ReducerContext,
    organization_id: u64,
    document_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "write")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.organization_id != organization_id {
        return Err("Document does not belong to this organization".to_string());
    }

    if !doc.is_deleted {
        return Ok(());
    }

    if let Some(fid) = doc.folder_id {
        let folder = ctx
            .db
            .doc_folder()
            .id()
            .find(&fid)
            .ok_or("Folder not found")?;
        if folder.organization_id != organization_id {
            return Err("Folder does not belong to this organization".to_string());
        }
        ensure_folder_company_scope(&folder, doc.company_id)?;
        folder_allows_write(&folder, ctx.sender())?;
    }

    let company_id = doc.company_id;
    let folder_id = doc.folder_id;

    ctx.db.document().id().update(Document {
        is_deleted: false,
        deleted_at: None,
        deleted_by: None,
        purge_after: None,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    adjust_folder_document_count(ctx, folder_id, 1);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document",
            record_id: document_id,
            action: "UPDATE",
            old_values: Some("{\"is_deleted\":true}".to_string()),
            new_values: Some("{\"is_deleted\":false}".to_string()),
            changed_fields: vec!["restored".to_string()],
            metadata: None,
        },
    );

    log::info!("Document restored: id={}", document_id);
    Ok(())
}

/// Update document metadata
#[reducer]
pub fn update_document(
    ctx: &ReducerContext,
    organization_id: u64,
    document_id: u64,
    params: UpdateDocumentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "write")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.organization_id != organization_id {
        return Err("Document does not belong to this organization".to_string());
    }

    if doc.is_deleted {
        return Err("Cannot update a deleted document".to_string());
    }

    let doc = refresh_expired_lock(ctx, doc);

    if doc.is_locked && doc.locked_by != Some(ctx.sender()) {
        return Err("Document is locked by another user".to_string());
    }

    if let Some(fid) = doc.folder_id {
        if let Some(folder) = ctx.db.doc_folder().id().find(&fid) {
            folder_allows_write(&folder, ctx.sender())?;
        }
    }

    let old_folder_id = doc.folder_id;
    let folder_changing = params.folder_id.is_some();
    let target_folder_id = if folder_changing {
        params.folder_id
    } else {
        doc.folder_id
    };
    if let Some(fid) = target_folder_id {
        if Some(fid) != old_folder_id {
            let folder = ctx
                .db
                .doc_folder()
                .id()
                .find(&fid)
                .ok_or("Folder not found")?;
            if folder.organization_id != organization_id {
                return Err("Folder does not belong to this organization".to_string());
            }
            ensure_folder_company_scope(&folder, doc.company_id)?;
            folder_allows_write(&folder, ctx.sender())?;
        }
    }

    // DOC-001 + DOC-002: Validate res_model whitelist and res_id FK when being changed
    let effective_res_model = params.res_model.as_deref().or(doc.res_model.as_deref());
    let effective_res_id = params.res_id.or(doc.res_id);
    if params.res_model.is_some() || params.res_id.is_some() {
        validate_res_model_and_id(ctx, effective_res_model, effective_res_id, organization_id)?;
    }

    // Track changed fields
    let mut changed_fields = Vec::new();
    let company_id = doc.company_id;

    let new_doc = Document {
        name: params.name.unwrap_or(doc.name.clone()),
        description: params.description.or(doc.description.clone()),
        folder_id: target_folder_id,
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

    if new_doc.folder_id != old_folder_id {
        adjust_folder_document_count(ctx, old_folder_id, -1);
        adjust_folder_document_count(ctx, new_doc.folder_id, 1);
    }

    ctx.db.document().id().update(new_doc);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
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

/// Update folder metadata (rename / move / flags).
#[reducer]
pub fn update_document_folder(
    ctx: &ReducerContext,
    organization_id: u64,
    folder_id: u64,
    params: UpdateDocumentFolderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document_folder", "write")?;

    let folder = ctx
        .db
        .doc_folder()
        .id()
        .find(&folder_id)
        .ok_or("Folder not found")?;

    if folder.organization_id != organization_id {
        return Err("Folder does not belong to this organization".to_string());
    }

    folder_allows_write(&folder, ctx.sender())?;

    let parent_changing = params.parent_id.is_some();
    // `None` in Option update means "no change" for parent — use a sentinel: only apply when
    // caller sends Some. Moving to root requires passing parent_id: Some(0) is wrong; keep
    // parent optional as "set if Some". Clearing parent (root) is expressed by omitting move.
    let new_parent_id = if parent_changing {
        params.parent_id
    } else {
        folder.parent_id
    };

    if new_parent_id == Some(folder_id) {
        return Err("Folder cannot be its own parent".to_string());
    }

    let parent_path = if let Some(pid) = new_parent_id {
        let parent = ctx
            .db
            .doc_folder()
            .id()
            .find(&pid)
            .ok_or("Parent folder not found")?;
        if parent.organization_id != organization_id {
            return Err("Parent folder does not belong to this organization".to_string());
        }
        // Prevent cycles: new parent must not be under this folder's path.
        let cycle_marker = format!("/{}/", folder_id);
        if parent.parent_path.contains(&cycle_marker)
            || parent.parent_path.ends_with(&format!("/{}", folder_id))
            || parent.id == folder_id
        {
            return Err("Cannot move folder under one of its descendants".to_string());
        }
        format!("{}/{}", parent.parent_path, pid)
    } else {
        "/".to_string()
    };

    let mut changed_fields = Vec::new();
    let company_id = folder.company_id;
    let updated = DocumentFolder {
        name: params.name.unwrap_or(folder.name.clone()),
        description: params.description.or(folder.description.clone()),
        parent_id: new_parent_id,
        parent_path,
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

    if updated.name != folder.name {
        changed_fields.push("name");
    }
    if updated.parent_id != folder.parent_id {
        changed_fields.push("parent_id");
    }
    if updated.description != folder.description {
        changed_fields.push("description");
    }
    if updated.sequence != folder.sequence {
        changed_fields.push("sequence");
    }

    ctx.db.doc_folder().id().update(updated);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document_folder",
            record_id: folder_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: changed_fields.into_iter().map(|s| s.to_string()).collect(),
            metadata: None,
        },
    );

    log::info!("Document folder updated: id={}", folder_id);
    Ok(())
}

/// Delete an empty document folder (no child folders, no documents).
#[reducer]
pub fn delete_document_folder(
    ctx: &ReducerContext,
    organization_id: u64,
    folder_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document_folder", "delete")?;

    let folder = ctx
        .db
        .doc_folder()
        .id()
        .find(&folder_id)
        .ok_or("Folder not found")?;

    if folder.organization_id != organization_id {
        return Err("Folder does not belong to this organization".to_string());
    }

    folder_allows_write(&folder, ctx.sender())?;

    if folder.document_count > 0 {
        return Err("Cannot delete a folder that still contains documents".to_string());
    }

    let has_children = ctx
        .db
        .doc_folder()
        .iter()
        .any(|f| f.organization_id == organization_id && f.parent_id == Some(folder_id));
    if has_children {
        return Err("Cannot delete a folder that still has child folders".to_string());
    }

    let company_id = folder.company_id;
    let name = folder.name.clone();
    ctx.db.doc_folder().id().delete(&folder_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document_folder",
            record_id: folder_id,
            action: "DELETE",
            old_values: Some(format!("{{\"name\":\"{}\"}}", name)),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
    );

    log::info!("Document folder deleted: id={}", folder_id);
    Ok(())
}

/// Record a document view (increments download_count for downloads)
#[reducer]
pub fn record_document_view(
    ctx: &ReducerContext,
    organization_id: u64,
    document_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "read")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;

    if doc.organization_id != organization_id {
        return Err("Document does not belong to this organization".to_string());
    }

    if doc.is_deleted {
        return Err("Document is deleted".to_string());
    }

    if let Some(fid) = doc.folder_id {
        if let Some(folder) = ctx.db.doc_folder().id().find(&fid) {
            folder_allows_read(&folder, ctx.sender())?;
        }
    }

    ctx.db.document().id().update(Document {
        last_viewed_at: Some(ctx.timestamp),
        last_viewed_by: Some(ctx.sender()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    Ok(())
}
