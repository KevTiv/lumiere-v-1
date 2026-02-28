/// Google Drive Integration
///
/// Manages connections to Google Drive for document storage and sync.
/// Supports multiple Google Drive accounts per organization.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::helpers::check_permission;
use crate::types::{IntegrationStatus, SyncStatus};

/// Google Drive Connection Configuration
///
/// Note: Only credential references are stored. Actual OAuth tokens and
/// refresh tokens must be stored in an external secret management system.
#[spacetimedb::table(
    accessor = google_drive_connection,
    public,
    index(accessor = gd_conn_by_org, btree(columns = [organization_id]))
)]
pub struct GoogleDriveConnection {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,

    // Display and identification
    pub name: String,
    pub account_email: String,
    pub account_id: String, // Google Drive account identifier

    // Security: Reference to external secret store only
    pub credentials_reference: String, // e.g., "vault://secret/lumiere/google-drive/{org_id}/{conn_id}"

    // Drive configuration
    pub root_folder_id: Option<String>, // Default folder for organization files
    pub shared_drive_id: Option<String>, // For Google Shared Drives
    pub sync_enabled: bool,
    pub auto_sync_files: bool,
    pub allowed_file_types: Vec<String>, // e.g., ["pdf", "docx", "xlsx"]
    pub max_file_size_mb: u32,

    // Webhook configuration for real-time updates
    pub webhook_enabled: bool,
    pub webhook_url: Option<String>,
    pub webhook_secret_reference: Option<String>, // Reference to webhook verification secret

    // Sync settings
    pub sync_direction: SyncDirection, // Upload, Download, Bidirectional
    pub sync_frequency_minutes: u32,
    pub last_sync_at: Option<Timestamp>,
    pub next_sync_at: Option<Timestamp>,

    // Status tracking
    pub status: IntegrationStatus,
    pub sync_status: SyncStatus,
    pub last_error: Option<String>,
    pub error_count: u32,

    // Metadata
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
    pub created_by: Option<String>, // Identity as hex string
    pub metadata: Option<String>,   // JSON for provider-specific settings
}

#[derive(spacetimedb::SpacetimeType, Clone, Debug, PartialEq)]
pub enum SyncDirection {
    UploadOnly,
    DownloadOnly,
    Bidirectional,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new Google Drive connection
///
/// Note: credentials_reference should point to an external secret store
/// where actual OAuth tokens are securely stored.
#[spacetimedb::reducer]
pub fn create_google_drive_connection(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    account_email: String,
    account_id: String,
    credentials_reference: String,
    root_folder_id: Option<String>,
    shared_drive_id: Option<String>,
    sync_enabled: bool,
    webhook_enabled: bool,
    webhook_url: Option<String>,
    webhook_secret_reference: Option<String>,
    sync_direction: SyncDirection,
    sync_frequency_minutes: u32,
    allowed_file_types: Vec<String>,
    max_file_size_mb: u32,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "create")?;

    if name.is_empty() {
        return Err("Connection name cannot be empty".to_string());
    }

    if account_email.is_empty() {
        return Err("Account email cannot be empty".to_string());
    }

    if credentials_reference.is_empty() {
        return Err("Credentials reference cannot be empty".to_string());
    }

    ctx.db
        .google_drive_connection()
        .insert(GoogleDriveConnection {
            id: 0,
            organization_id,
            name,
            account_email,
            account_id,
            credentials_reference,
            root_folder_id,
            shared_drive_id,
            sync_enabled,
            auto_sync_files: sync_enabled,
            allowed_file_types,
            max_file_size_mb,
            webhook_enabled,
            webhook_url,
            webhook_secret_reference,
            sync_direction,
            sync_frequency_minutes,
            last_sync_at: None,
            next_sync_at: None,
            status: IntegrationStatus::Pending,
            sync_status: SyncStatus::PendingAuth,
            last_error: None,
            error_count: 0,
            is_active: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            created_by: Some(ctx.sender().to_hex().to_string()),
            metadata: None,
        });

    Ok(())
}

/// Update Google Drive connection settings
#[spacetimedb::reducer]
pub fn update_google_drive_connection(
    ctx: &ReducerContext,
    connection_id: u64,
    organization_id: u64,
    name: Option<String>,
    root_folder_id: Option<String>,
    shared_drive_id: Option<String>,
    sync_enabled: Option<bool>,
    auto_sync_files: Option<bool>,
    allowed_file_types: Option<Vec<String>>,
    max_file_size_mb: Option<u32>,
    webhook_enabled: Option<bool>,
    webhook_url: Option<String>,
    sync_direction: Option<SyncDirection>,
    sync_frequency_minutes: Option<u32>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    let conn = ctx
        .db
        .google_drive_connection()
        .id()
        .find(&connection_id)
        .ok_or("Google Drive connection not found")?;

    if conn.organization_id != organization_id {
        return Err("Connection does not belong to this organization".to_string());
    }

    if conn.deleted_at.is_some() {
        return Err("Cannot update deleted connection".to_string());
    }

    ctx.db
        .google_drive_connection()
        .id()
        .update(GoogleDriveConnection {
            name: name.unwrap_or(conn.name),
            root_folder_id: root_folder_id.or(conn.root_folder_id),
            shared_drive_id: shared_drive_id.or(conn.shared_drive_id),
            sync_enabled: sync_enabled.unwrap_or(conn.sync_enabled),
            auto_sync_files: auto_sync_files.unwrap_or(conn.auto_sync_files),
            allowed_file_types: allowed_file_types.unwrap_or(conn.allowed_file_types),
            max_file_size_mb: max_file_size_mb.unwrap_or(conn.max_file_size_mb),
            webhook_enabled: webhook_enabled.unwrap_or(conn.webhook_enabled),
            webhook_url: webhook_url.or(conn.webhook_url),
            sync_direction: sync_direction.unwrap_or(conn.sync_direction),
            sync_frequency_minutes: sync_frequency_minutes.unwrap_or(conn.sync_frequency_minutes),
            updated_at: ctx.timestamp,
            ..conn
        });

    Ok(())
}

/// Update credentials reference (e.g., after token rotation)
#[spacetimedb::reducer]
pub fn update_google_drive_credentials(
    ctx: &ReducerContext,
    connection_id: u64,
    organization_id: u64,
    credentials_reference: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    if credentials_reference.is_empty() {
        return Err("Credentials reference cannot be empty".to_string());
    }

    let conn = ctx
        .db
        .google_drive_connection()
        .id()
        .find(&connection_id)
        .ok_or("Google Drive connection not found")?;

    if conn.organization_id != organization_id {
        return Err("Connection does not belong to this organization".to_string());
    }

    ctx.db
        .google_drive_connection()
        .id()
        .update(GoogleDriveConnection {
            credentials_reference,
            updated_at: ctx.timestamp,
            ..conn
        });

    Ok(())
}

/// Record a successful sync operation
#[spacetimedb::reducer]
pub fn record_google_drive_sync(
    ctx: &ReducerContext,
    connection_id: u64,
    organization_id: u64,
    next_sync_at: Option<Timestamp>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    let conn = ctx
        .db
        .google_drive_connection()
        .id()
        .find(&connection_id)
        .ok_or("Google Drive connection not found")?;

    if conn.organization_id != organization_id {
        return Err("Connection does not belong to this organization".to_string());
    }

    ctx.db
        .google_drive_connection()
        .id()
        .update(GoogleDriveConnection {
            last_sync_at: Some(ctx.timestamp),
            next_sync_at,
            sync_status: SyncStatus::Connected,
            last_error: None,
            error_count: 0,
            updated_at: ctx.timestamp,
            ..conn
        });

    Ok(())
}

/// Record a sync error
#[spacetimedb::reducer]
pub fn record_google_drive_sync_error(
    ctx: &ReducerContext,
    connection_id: u64,
    organization_id: u64,
    error_message: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    let conn = ctx
        .db
        .google_drive_connection()
        .id()
        .find(&connection_id)
        .ok_or("Google Drive connection not found")?;

    if conn.organization_id != organization_id {
        return Err("Connection does not belong to this organization".to_string());
    }

    let new_error_count = conn.error_count + 1;
    let new_status = if new_error_count >= 5 {
        IntegrationStatus::Suspended
    } else {
        conn.status.clone()
    };

    ctx.db
        .google_drive_connection()
        .id()
        .update(GoogleDriveConnection {
            sync_status: SyncStatus::Error,
            last_error: Some(error_message),
            error_count: new_error_count,
            status: new_status,
            updated_at: ctx.timestamp,
            ..conn
        });

    Ok(())
}
