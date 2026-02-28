/// External Service Integrations Module
///
/// This module manages connections to external services like Google Drive,
/// WhatsApp Business, and other third-party providers.
///
/// Security Note: Only credential references (not actual secrets) are stored.
/// Actual credentials should be stored in external secret management systems
/// like HashiCorp Vault, AWS Secrets Manager, or similar.
use spacetimedb::ReducerContext;

use crate::helpers::check_permission;
use crate::types::{IntegrationStatus, SyncStatus};

use self::google_drive::google_drive_connection;
use self::whatsapp_business::whatsapp_business_account;

// Re-export sub-modules
pub mod google_drive;
pub mod whatsapp_business;

// Re-export tables for convenience
pub use google_drive::GoogleDriveConnection;
pub use whatsapp_business::WhatsAppBusinessAccount;

// Shared trait for integration operations
pub trait OrganizationIntegration {
    fn organization_id(&self) -> u64;
    fn is_active(&self) -> bool;
    fn integration_type(&self) -> crate::types::IntegrationType;
}

/// Generic integration status update reducer
/// This can be used by any integration type to update connection status
#[spacetimedb::reducer]
pub fn update_integration_status(
    ctx: &ReducerContext,
    organization_id: u64,
    integration_id: u64,
    integration_type: crate::types::IntegrationType,
    status: IntegrationStatus,
    sync_status: SyncStatus,
    error_message: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    match integration_type {
        crate::types::IntegrationType::GoogleDrive => {
            let conn = ctx
                .db
                .google_drive_connection()
                .id()
                .find(&integration_id)
                .ok_or("Google Drive connection not found")?;

            if conn.organization_id != organization_id {
                return Err("Integration does not belong to this organization".to_string());
            }

            ctx.db
                .google_drive_connection()
                .id()
                .update(google_drive::GoogleDriveConnection {
                    status: status.clone(),
                    sync_status: sync_status.clone(),
                    last_error: error_message.clone(),
                    updated_at: ctx.timestamp,
                    ..conn
                });
        }
        crate::types::IntegrationType::WhatsAppBusiness => {
            let conn = ctx
                .db
                .whatsapp_business_account()
                .id()
                .find(&integration_id)
                .ok_or("WhatsApp Business account not found")?;

            if conn.organization_id != organization_id {
                return Err("Integration does not belong to this organization".to_string());
            }

            ctx.db.whatsapp_business_account().id().update(
                whatsapp_business::WhatsAppBusinessAccount {
                    status: status.clone(),
                    sync_status: sync_status.clone(),
                    last_error: error_message.clone(),
                    updated_at: ctx.timestamp,
                    ..conn
                },
            );
        }
        _ => {
            return Err(format!(
                "Status update not implemented for {:?}",
                integration_type
            ));
        }
    }

    Ok(())
}

/// Generic integration deletion reducer (soft delete)
#[spacetimedb::reducer]
pub fn delete_integration(
    ctx: &ReducerContext,
    organization_id: u64,
    integration_id: u64,
    integration_type: crate::types::IntegrationType,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "delete")?;

    match integration_type {
        crate::types::IntegrationType::GoogleDrive => {
            let conn = ctx
                .db
                .google_drive_connection()
                .id()
                .find(&integration_id)
                .ok_or("Google Drive connection not found")?;

            if conn.organization_id != organization_id {
                return Err("Integration does not belong to this organization".to_string());
            }

            ctx.db
                .google_drive_connection()
                .id()
                .update(google_drive::GoogleDriveConnection {
                    status: IntegrationStatus::Inactive,
                    is_active: false,
                    deleted_at: Some(ctx.timestamp),
                    updated_at: ctx.timestamp,
                    ..conn
                });
        }
        crate::types::IntegrationType::WhatsAppBusiness => {
            let conn = ctx
                .db
                .whatsapp_business_account()
                .id()
                .find(&integration_id)
                .ok_or("WhatsApp Business account not found")?;

            if conn.organization_id != organization_id {
                return Err("Integration does not belong to this organization".to_string());
            }

            ctx.db.whatsapp_business_account().id().update(
                whatsapp_business::WhatsAppBusinessAccount {
                    status: IntegrationStatus::Inactive,
                    is_active: false,
                    deleted_at: Some(ctx.timestamp),
                    updated_at: ctx.timestamp,
                    ..conn
                },
            );
        }
        _ => {
            return Err(format!(
                "Deletion not implemented for {:?}",
                integration_type
            ));
        }
    }

    Ok(())
}
