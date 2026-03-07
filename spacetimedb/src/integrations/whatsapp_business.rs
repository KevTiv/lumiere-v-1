/// WhatsApp Business Integration
///
/// Manages connections to WhatsApp Business API for messaging,
/// notifications, and customer communication.
/// Supports multiple WhatsApp Business numbers per organization.
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{IntegrationStatus, SyncStatus};

/// WhatsApp Business Account Configuration
///
/// Note: Only credential references are stored. Actual API keys, access tokens,
/// and webhook verification tokens must be stored in an external secret management system.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = whatsapp_business_account,
    public,
    index(accessor = wa_account_by_org, btree(columns = [organization_id]))
)]
pub struct WhatsAppBusinessAccount {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,

    // Display and identification
    pub name: String,                // Display name for this connection
    pub phone_number: String,        // Full phone number with country code (e.g., "+1234567890")
    pub phone_number_id: String,     // WhatsApp Phone Number ID from Meta
    pub business_account_id: String, // WhatsApp Business Account ID from Meta
    pub display_name: String,        // Verified display name shown to customers

    // Security: Reference to external secret store only
    pub credentials_reference: String, // e.g., "vault://secret/lumiere/whatsapp/{org_id}/{account_id}"
    pub webhook_secret_reference: String, // Reference to webhook verification token

    // Messaging capabilities
    pub messaging_enabled: bool,
    pub notifications_enabled: bool,
    pub template_messaging_enabled: bool,
    pub interactive_messaging_enabled: bool,

    // Template and media settings
    pub template_namespace: Option<String>,
    pub default_language: String,       // ISO 639-1 language code
    pub media_provider: Option<String>, // e.g., "meta", "aws_s3", "gcp_storage"

    // Webhook configuration
    pub webhook_enabled: bool,
    pub webhook_url: Option<String>,
    pub subscribed_webhook_events: Vec<String>, // e.g., ["messages", "message_status", "account_alerts"]

    // Rate limiting and quotas
    pub daily_message_limit: u32,
    pub messages_sent_today: u32,
    pub last_message_reset: Option<Timestamp>,

    // Business verification status
    pub verification_status: VerificationStatus,
    pub business_verification_level: VerificationLevel,

    // Quality metrics
    pub quality_score: Option<String>, // e.g., "GREEN", "YELLOW", "RED"
    pub quality_score_updated_at: Option<Timestamp>,

    // Status tracking
    pub status: IntegrationStatus,
    pub sync_status: SyncStatus,
    pub last_health_check: Option<Timestamp>,
    pub last_error: Option<String>,
    pub error_count: u32,

    // Metadata
    pub is_active: bool,
    pub is_primary: bool, // Primary WhatsApp number for the organization
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
    pub created_by: Option<String>, // Identity as hex string
    pub metadata: Option<String>,   // JSON for provider-specific settings
}

#[derive(spacetimedb::SpacetimeType, Clone, Debug, PartialEq)]
pub enum VerificationStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
    Revoked,
}

#[derive(spacetimedb::SpacetimeType, Clone, Debug, PartialEq)]
pub enum VerificationLevel {
    Unverified,
    BusinessPortfolio,
    BusinessVerified,
}

// ============================================================================
// INPUT PARAMS
// ============================================================================

/// Params for creating a WhatsApp Business account.
/// Scope: `organization_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWhatsAppBusinessAccountParams {
    pub name: String,
    pub phone_number: String,
    pub phone_number_id: String,
    pub business_account_id: String,
    pub display_name: String,
    pub credentials_reference: String,
    pub webhook_secret_reference: String,
    pub messaging_enabled: bool,
    pub notifications_enabled: bool,
    pub template_messaging_enabled: bool,
    pub interactive_messaging_enabled: bool,
    pub default_language: String,
    pub webhook_enabled: bool,
    pub webhook_url: Option<String>,
    pub subscribed_webhook_events: Vec<String>,
    pub daily_message_limit: u32,
    pub is_primary: bool,
    pub template_namespace: Option<String>,
    pub media_provider: Option<String>,
    pub metadata: Option<String>,
}

/// Params for updating a WhatsApp Business account.
/// Scope: `organization_id` and `account_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateWhatsAppBusinessAccountParams {
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub messaging_enabled: Option<bool>,
    pub notifications_enabled: Option<bool>,
    pub template_messaging_enabled: Option<bool>,
    pub interactive_messaging_enabled: Option<bool>,
    pub default_language: Option<String>,
    pub webhook_enabled: Option<bool>,
    pub webhook_url: Option<String>,
    pub subscribed_webhook_events: Option<Vec<String>>,
    pub daily_message_limit: Option<u32>,
    pub template_namespace: Option<String>,
    pub media_provider: Option<String>,
}

/// Params for updating WhatsApp credentials.
/// Scope: `organization_id` and `account_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateWhatsAppCredentialsParams {
    pub credentials_reference: String,
    pub webhook_secret_reference: String,
}

/// Params for updating verification status.
/// Scope: `organization_id` and `account_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateWhatsAppVerificationParams {
    pub verification_status: VerificationStatus,
    pub business_verification_level: VerificationLevel,
}

/// Params for recording a health check.
/// Scope: `organization_id` and `account_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordWhatsAppHealthCheckParams {
    pub is_healthy: bool,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a new WhatsApp Business account connection
///
/// Note: credentials_reference and webhook_secret_reference should point to
/// an external secret store where actual API keys and tokens are securely stored.
#[spacetimedb::reducer]
pub fn create_whatsapp_business_account(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateWhatsAppBusinessAccountParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "create")?;

    if params.name.is_empty() {
        return Err("Account name cannot be empty".to_string());
    }

    if params.phone_number.is_empty() {
        return Err("Phone number cannot be empty".to_string());
    }

    if params.phone_number_id.is_empty() {
        return Err("Phone number ID cannot be empty".to_string());
    }

    if params.business_account_id.is_empty() {
        return Err("Business account ID cannot be empty".to_string());
    }

    if params.credentials_reference.is_empty() {
        return Err("Credentials reference cannot be empty".to_string());
    }

    if params.webhook_secret_reference.is_empty() {
        return Err("Webhook secret reference cannot be empty".to_string());
    }

    let account = ctx
        .db
        .whatsapp_business_account()
        .insert(WhatsAppBusinessAccount {
            id: 0,
            organization_id,
            name: params.name,
            phone_number: params.phone_number,
            phone_number_id: params.phone_number_id,
            business_account_id: params.business_account_id,
            display_name: params.display_name,
            credentials_reference: params.credentials_reference,
            webhook_secret_reference: params.webhook_secret_reference,
            messaging_enabled: params.messaging_enabled,
            notifications_enabled: params.notifications_enabled,
            template_messaging_enabled: params.template_messaging_enabled,
            interactive_messaging_enabled: params.interactive_messaging_enabled,
            template_namespace: params.template_namespace,
            default_language: params.default_language.to_lowercase(),
            media_provider: params.media_provider,
            webhook_enabled: params.webhook_enabled,
            webhook_url: params.webhook_url,
            subscribed_webhook_events: params.subscribed_webhook_events,
            daily_message_limit: params.daily_message_limit,
            messages_sent_today: 0,
            last_message_reset: None,
            verification_status: VerificationStatus::Pending,
            business_verification_level: VerificationLevel::Unverified,
            quality_score: None,
            quality_score_updated_at: None,
            status: IntegrationStatus::Pending,
            sync_status: SyncStatus::PendingAuth,
            last_health_check: None,
            last_error: None,
            error_count: 0,
            is_active: true,
            is_primary: params.is_primary,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            created_by: Some(ctx.sender().to_hex().to_string()),
            metadata: params.metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "whatsapp_business_account",
            record_id: account.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!(
                "{{\"name\":\"{}\",\"phone_number\":\"{}\"}}",
                account.name, account.phone_number
            )),
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "WhatsApp Business account created: id={}, name={}",
        account.id,
        account.name
    );
    Ok(())
}

/// Update WhatsApp Business account settings
#[spacetimedb::reducer]
pub fn update_whatsapp_business_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    params: UpdateWhatsAppBusinessAccountParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    let account = ctx
        .db
        .whatsapp_business_account()
        .id()
        .find(&account_id)
        .ok_or("WhatsApp Business account not found")?;

    if account.organization_id != organization_id {
        return Err("Account does not belong to this organization".to_string());
    }

    if account.deleted_at.is_some() {
        return Err("Cannot update deleted account".to_string());
    }

    let mut changed_fields = Vec::new();

    let new_account = WhatsAppBusinessAccount {
        name: params.name.unwrap_or(account.name.clone()),
        display_name: params.display_name.unwrap_or(account.display_name.clone()),
        messaging_enabled: params
            .messaging_enabled
            .unwrap_or(account.messaging_enabled),
        notifications_enabled: params
            .notifications_enabled
            .unwrap_or(account.notifications_enabled),
        template_messaging_enabled: params
            .template_messaging_enabled
            .unwrap_or(account.template_messaging_enabled),
        interactive_messaging_enabled: params
            .interactive_messaging_enabled
            .unwrap_or(account.interactive_messaging_enabled),
        default_language: params
            .default_language
            .map(|l| l.to_lowercase())
            .unwrap_or(account.default_language.clone()),
        webhook_enabled: params.webhook_enabled.unwrap_or(account.webhook_enabled),
        webhook_url: params.webhook_url.or(account.webhook_url.clone()),
        subscribed_webhook_events: params
            .subscribed_webhook_events
            .unwrap_or(account.subscribed_webhook_events.clone()),
        daily_message_limit: params
            .daily_message_limit
            .unwrap_or(account.daily_message_limit),
        template_namespace: params
            .template_namespace
            .or(account.template_namespace.clone()),
        media_provider: params.media_provider.or(account.media_provider.clone()),
        updated_at: ctx.timestamp,
        ..account.clone()
    };

    if new_account.name != account.name {
        changed_fields.push("name");
    }
    if new_account.display_name != account.display_name {
        changed_fields.push("display_name");
    }
    if new_account.messaging_enabled != account.messaging_enabled {
        changed_fields.push("messaging_enabled");
    }
    if new_account.notifications_enabled != account.notifications_enabled {
        changed_fields.push("notifications_enabled");
    }
    if new_account.template_messaging_enabled != account.template_messaging_enabled {
        changed_fields.push("template_messaging_enabled");
    }
    if new_account.interactive_messaging_enabled != account.interactive_messaging_enabled {
        changed_fields.push("interactive_messaging_enabled");
    }
    if new_account.default_language != account.default_language {
        changed_fields.push("default_language");
    }
    if new_account.webhook_enabled != account.webhook_enabled {
        changed_fields.push("webhook_enabled");
    }
    if new_account.webhook_url != account.webhook_url {
        changed_fields.push("webhook_url");
    }
    if new_account.subscribed_webhook_events != account.subscribed_webhook_events {
        changed_fields.push("subscribed_webhook_events");
    }
    if new_account.daily_message_limit != account.daily_message_limit {
        changed_fields.push("daily_message_limit");
    }
    if new_account.template_namespace != account.template_namespace {
        changed_fields.push("template_namespace");
    }
    if new_account.media_provider != account.media_provider {
        changed_fields.push("media_provider");
    }

    ctx.db.whatsapp_business_account().id().update(new_account);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "whatsapp_business_account",
            record_id: account_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: changed_fields.into_iter().map(|s| s.to_string()).collect(),
            metadata: None,
        },
    );

    log::info!("WhatsApp Business account updated: id={}", account_id);
    Ok(())
}

/// Update credentials and webhook secret references (e.g., after token rotation)
#[spacetimedb::reducer]
pub fn update_whatsapp_credentials(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    params: UpdateWhatsAppCredentialsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    if params.credentials_reference.is_empty() {
        return Err("Credentials reference cannot be empty".to_string());
    }

    if params.webhook_secret_reference.is_empty() {
        return Err("Webhook secret reference cannot be empty".to_string());
    }

    let account = ctx
        .db
        .whatsapp_business_account()
        .id()
        .find(&account_id)
        .ok_or("WhatsApp Business account not found")?;

    if account.organization_id != organization_id {
        return Err("Account does not belong to this organization".to_string());
    }

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            credentials_reference: params.credentials_reference,
            webhook_secret_reference: params.webhook_secret_reference,
            updated_at: ctx.timestamp,
            ..account
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "whatsapp_business_account",
            record_id: account_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some("{\"credentials_updated\":true}".to_string()),
            changed_fields: vec![
                "credentials_reference".to_string(),
                "webhook_secret_reference".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!("WhatsApp Business credentials updated: id={}", account_id);
    Ok(())
}

/// Update verification status from Meta API
#[spacetimedb::reducer]
pub fn update_whatsapp_verification_status(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    params: UpdateWhatsAppVerificationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    let account = ctx
        .db
        .whatsapp_business_account()
        .id()
        .find(&account_id)
        .ok_or("WhatsApp Business account not found")?;

    if account.organization_id != organization_id {
        return Err("Account does not belong to this organization".to_string());
    }

    let new_integration_status = match &params.verification_status {
        VerificationStatus::Approved => IntegrationStatus::Active,
        VerificationStatus::Rejected | VerificationStatus::Revoked => IntegrationStatus::Suspended,
        _ => account.status.clone(),
    };

    let old_verification = format!("{:?}", account.verification_status);
    let new_verification = format!("{:?}", params.verification_status);

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            verification_status: params.verification_status,
            business_verification_level: params.business_verification_level,
            status: new_integration_status,
            updated_at: ctx.timestamp,
            ..account
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "whatsapp_business_account",
            record_id: account_id,
            action: "UPDATE",
            old_values: Some(format!(
                "{{\"verification_status\":\"{}\"}}",
                old_verification
            )),
            new_values: Some(format!(
                "{{\"verification_status\":\"{}\"}}",
                new_verification
            )),
            changed_fields: vec![
                "verification_status".to_string(),
                "business_verification_level".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!("WhatsApp Business verification updated: id={}", account_id);
    Ok(())
}

/// Update quality score from Meta API
#[spacetimedb::reducer]
pub fn update_whatsapp_quality_score(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    quality_score: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    let account = ctx
        .db
        .whatsapp_business_account()
        .id()
        .find(&account_id)
        .ok_or("WhatsApp Business account not found")?;

    if account.organization_id != organization_id {
        return Err("Account does not belong to this organization".to_string());
    }

    let old_score = account.quality_score.clone().unwrap_or_default();

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            quality_score: Some(quality_score.clone()),
            quality_score_updated_at: Some(ctx.timestamp),
            updated_at: ctx.timestamp,
            ..account
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "whatsapp_business_account",
            record_id: account_id,
            action: "UPDATE",
            old_values: Some(format!("{{\"quality_score\":\"{}\"}}", old_score)),
            new_values: Some(format!("{{\"quality_score\":\"{}\"}}", quality_score)),
            changed_fields: vec!["quality_score".to_string()],
            metadata: None,
        },
    );

    log::info!("WhatsApp Business quality score updated: id={}", account_id);
    Ok(())
}

/// Record message sent (for quota tracking)
#[spacetimedb::reducer]
pub fn record_whatsapp_message_sent(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    let account = ctx
        .db
        .whatsapp_business_account()
        .id()
        .find(&account_id)
        .ok_or("WhatsApp Business account not found")?;

    if account.organization_id != organization_id {
        return Err("Account does not belong to this organization".to_string());
    }

    // Check if we need to reset daily counter
    let should_reset = account.last_message_reset.map_or(true, |last_reset| {
        let elapsed = ctx
            .timestamp
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .saturating_sub(
                last_reset
                    .to_duration_since_unix_epoch()
                    .unwrap_or_default(),
            );
        elapsed.as_secs() >= 86400 // 24 hours
    });

    let (new_count, new_reset) = if should_reset {
        (1u32, Some(ctx.timestamp))
    } else {
        (account.messages_sent_today + 1, account.last_message_reset)
    };

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            messages_sent_today: new_count,
            last_message_reset: new_reset,
            updated_at: ctx.timestamp,
            ..account
        });

    // Note: Not logging every message to avoid audit log spam
    Ok(())
}

/// Record health check
#[spacetimedb::reducer]
pub fn record_whatsapp_health_check(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    params: RecordWhatsAppHealthCheckParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    let account = ctx
        .db
        .whatsapp_business_account()
        .id()
        .find(&account_id)
        .ok_or("WhatsApp Business account not found")?;

    if account.organization_id != organization_id {
        return Err("Account does not belong to this organization".to_string());
    }

    let (new_sync_status, new_error_count) = if params.is_healthy {
        (SyncStatus::Connected, 0u32)
    } else {
        (SyncStatus::Error, account.error_count + 1)
    };

    let old_status = format!("{:?}", account.sync_status);
    let new_status = format!("{:?}", new_sync_status);

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            last_health_check: Some(ctx.timestamp),
            sync_status: new_sync_status,
            error_count: new_error_count,
            updated_at: ctx.timestamp,
            ..account
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "whatsapp_business_account",
            record_id: account_id,
            action: "UPDATE",
            old_values: Some(format!("{{\"sync_status\":\"{}\"}}", old_status)),
            new_values: Some(format!("{{\"sync_status\":\"{}\"}}", new_status)),
            changed_fields: vec!["sync_status".to_string(), "last_health_check".to_string()],
            metadata: None,
        },
    );

    log::info!("WhatsApp Business health check recorded: id={}", account_id);
    Ok(())
}

/// Set primary WhatsApp account for organization
/// Unsets any other primary accounts in the same organization
#[spacetimedb::reducer]
pub fn set_whatsapp_primary_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;

    // First, unset any existing primary accounts
    let existing_primary: Vec<_> = ctx
        .db
        .whatsapp_business_account()
        .wa_account_by_org()
        .filter(&organization_id)
        .filter(|a| a.is_primary && a.deleted_at.is_none())
        .collect();

    for account in existing_primary {
        if account.id != account_id {
            ctx.db
                .whatsapp_business_account()
                .id()
                .update(WhatsAppBusinessAccount {
                    is_primary: false,
                    updated_at: ctx.timestamp,
                    ..account
                });
        }
    }

    // Set the new primary account
    let account = ctx
        .db
        .whatsapp_business_account()
        .id()
        .find(&account_id)
        .ok_or("WhatsApp Business account not found")?;

    if account.organization_id != organization_id {
        return Err("Account does not belong to this organization".to_string());
    }

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            is_primary: true,
            updated_at: ctx.timestamp,
            ..account
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "whatsapp_business_account",
            record_id: account_id,
            action: "UPDATE",
            old_values: Some("{\"is_primary\":false}".to_string()),
            new_values: Some("{\"is_primary\":true}".to_string()),
            changed_fields: vec!["is_primary".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "WhatsApp Business account set as primary: id={}",
        account_id
    );
    Ok(())
}

/// Soft-delete a WhatsApp Business account
#[spacetimedb::reducer]
pub fn delete_whatsapp_business_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "delete")?;

    let account = ctx
        .db
        .whatsapp_business_account()
        .id()
        .find(&account_id)
        .ok_or("WhatsApp Business account not found")?;

    if account.organization_id != organization_id {
        return Err("Account does not belong to this organization".to_string());
    }

    let account_name = account.name.clone();

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            is_active: false,
            is_primary: false,
            deleted_at: Some(ctx.timestamp),
            updated_at: ctx.timestamp,
            ..account
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "whatsapp_business_account",
            record_id: account_id,
            action: "DELETE",
            old_values: Some(format!("{{\"name\":\"{}\"}}", account_name)),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
    );

    log::info!("WhatsApp Business account soft-deleted: id={}", account_id);
    Ok(())
}
