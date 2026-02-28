/// WhatsApp Business Integration
///
/// Manages connections to WhatsApp Business API for messaging,
/// notifications, and customer communication.
/// Supports multiple WhatsApp Business numbers per organization.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::helpers::check_permission;
use crate::types::{IntegrationStatus, SyncStatus};

/// WhatsApp Business Account Configuration
///
/// Note: Only credential references are stored. Actual API keys, access tokens,
/// and webhook verification tokens must be stored in an external secret management system.
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

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new WhatsApp Business account connection
///
/// Note: credentials_reference and webhook_secret_reference should point to
/// an external secret store where actual API keys and tokens are securely stored.
#[spacetimedb::reducer]
pub fn create_whatsapp_business_account(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    phone_number: String,
    phone_number_id: String,
    business_account_id: String,
    display_name: String,
    credentials_reference: String,
    webhook_secret_reference: String,
    messaging_enabled: bool,
    notifications_enabled: bool,
    template_messaging_enabled: bool,
    interactive_messaging_enabled: bool,
    default_language: String,
    webhook_enabled: bool,
    webhook_url: Option<String>,
    subscribed_webhook_events: Vec<String>,
    daily_message_limit: u32,
    is_primary: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "create")?;

    if name.is_empty() {
        return Err("Account name cannot be empty".to_string());
    }

    if phone_number.is_empty() {
        return Err("Phone number cannot be empty".to_string());
    }

    if phone_number_id.is_empty() {
        return Err("Phone number ID cannot be empty".to_string());
    }

    if business_account_id.is_empty() {
        return Err("Business account ID cannot be empty".to_string());
    }

    if credentials_reference.is_empty() {
        return Err("Credentials reference cannot be empty".to_string());
    }

    if webhook_secret_reference.is_empty() {
        return Err("Webhook secret reference cannot be empty".to_string());
    }

    ctx.db
        .whatsapp_business_account()
        .insert(WhatsAppBusinessAccount {
            id: 0,
            organization_id,
            name,
            phone_number,
            phone_number_id,
            business_account_id,
            display_name,
            credentials_reference,
            webhook_secret_reference,
            messaging_enabled,
            notifications_enabled,
            template_messaging_enabled,
            interactive_messaging_enabled,
            template_namespace: None,
            default_language: default_language.clone().to_lowercase(),
            media_provider: None,
            webhook_enabled,
            webhook_url,
            subscribed_webhook_events,
            daily_message_limit,
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
            is_primary,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            created_by: Some(ctx.sender().to_hex().to_string()),
            metadata: None,
        });

    Ok(())
}

/// Update WhatsApp Business account settings
#[spacetimedb::reducer]
pub fn update_whatsapp_business_account(
    ctx: &ReducerContext,
    account_id: u64,
    organization_id: u64,
    name: Option<String>,
    display_name: Option<String>,
    messaging_enabled: Option<bool>,
    notifications_enabled: Option<bool>,
    template_messaging_enabled: Option<bool>,
    interactive_messaging_enabled: Option<bool>,
    default_language: Option<String>,
    webhook_enabled: Option<bool>,
    webhook_url: Option<String>,
    subscribed_webhook_events: Option<Vec<String>>,
    daily_message_limit: Option<u32>,
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

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            name: name.unwrap_or(account.name),
            display_name: display_name.unwrap_or(account.display_name),
            messaging_enabled: messaging_enabled.unwrap_or(account.messaging_enabled),
            notifications_enabled: notifications_enabled.unwrap_or(account.notifications_enabled),
            template_messaging_enabled: template_messaging_enabled
                .unwrap_or(account.template_messaging_enabled),
            interactive_messaging_enabled: interactive_messaging_enabled
                .unwrap_or(account.interactive_messaging_enabled),
            default_language: default_language
                .map(|l| l.to_lowercase())
                .unwrap_or(account.default_language),
            webhook_enabled: webhook_enabled.unwrap_or(account.webhook_enabled),
            webhook_url: webhook_url.or(account.webhook_url),
            subscribed_webhook_events: subscribed_webhook_events
                .unwrap_or(account.subscribed_webhook_events),
            daily_message_limit: daily_message_limit.unwrap_or(account.daily_message_limit),
            updated_at: ctx.timestamp,
            ..account
        });

    Ok(())
}

/// Update credentials and webhook secret references (e.g., after token rotation)
#[spacetimedb::reducer]
pub fn update_whatsapp_credentials(
    ctx: &ReducerContext,
    account_id: u64,
    organization_id: u64,
    credentials_reference: Option<String>,
    webhook_secret_reference: Option<String>,
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

    let new_credentials = credentials_reference.filter(|c| !c.is_empty());
    let new_webhook_secret = webhook_secret_reference.filter(|w| !w.is_empty());

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            credentials_reference: new_credentials.unwrap_or(account.credentials_reference),
            webhook_secret_reference: new_webhook_secret
                .unwrap_or(account.webhook_secret_reference),
            updated_at: ctx.timestamp,
            ..account
        });

    Ok(())
}

/// Update verification status from Meta API
#[spacetimedb::reducer]
pub fn update_whatsapp_verification_status(
    ctx: &ReducerContext,
    account_id: u64,
    organization_id: u64,
    verification_status: VerificationStatus,
    business_verification_level: VerificationLevel,
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

    let new_integration_status = match &verification_status {
        VerificationStatus::Approved => IntegrationStatus::Active,
        VerificationStatus::Rejected | VerificationStatus::Revoked => IntegrationStatus::Suspended,
        _ => account.status.clone(),
    };

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            verification_status,
            business_verification_level,
            status: new_integration_status,
            updated_at: ctx.timestamp,
            ..account
        });

    Ok(())
}

/// Update quality score from Meta API
#[spacetimedb::reducer]
pub fn update_whatsapp_quality_score(
    ctx: &ReducerContext,
    account_id: u64,
    organization_id: u64,
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

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            quality_score: Some(quality_score),
            quality_score_updated_at: Some(ctx.timestamp),
            updated_at: ctx.timestamp,
            ..account
        });

    Ok(())
}

/// Record message sent (for quota tracking)
#[spacetimedb::reducer]
pub fn record_whatsapp_message_sent(
    ctx: &ReducerContext,
    account_id: u64,
    organization_id: u64,
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

    Ok(())
}

/// Record health check
#[spacetimedb::reducer]
pub fn record_whatsapp_health_check(
    ctx: &ReducerContext,
    account_id: u64,
    organization_id: u64,
    is_healthy: bool,
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

    let (new_sync_status, new_error_count) = if is_healthy {
        (SyncStatus::Connected, 0u32)
    } else {
        (SyncStatus::Error, account.error_count + 1)
    };

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

    Ok(())
}

/// Set primary WhatsApp account for organization
/// Unsets any other primary accounts in the same organization
#[spacetimedb::reducer]
pub fn set_whatsapp_primary_account(
    ctx: &ReducerContext,
    account_id: u64,
    organization_id: u64,
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
                    id: account.id,
                    organization_id: account.organization_id,
                    name: account.name,
                    phone_number: account.phone_number,
                    phone_number_id: account.phone_number_id,
                    business_account_id: account.business_account_id,
                    display_name: account.display_name,
                    credentials_reference: account.credentials_reference,
                    webhook_secret_reference: account.webhook_secret_reference,
                    messaging_enabled: account.messaging_enabled,
                    notifications_enabled: account.notifications_enabled,
                    template_messaging_enabled: account.template_messaging_enabled,
                    interactive_messaging_enabled: account.interactive_messaging_enabled,
                    template_namespace: account.template_namespace,
                    default_language: account.default_language,
                    media_provider: account.media_provider,
                    webhook_enabled: account.webhook_enabled,
                    webhook_url: account.webhook_url,
                    subscribed_webhook_events: account.subscribed_webhook_events,
                    daily_message_limit: account.daily_message_limit,
                    messages_sent_today: account.messages_sent_today,
                    last_message_reset: account.last_message_reset,
                    verification_status: account.verification_status,
                    business_verification_level: account.business_verification_level,
                    quality_score: account.quality_score,
                    quality_score_updated_at: account.quality_score_updated_at,
                    status: account.status,
                    sync_status: account.sync_status,
                    last_health_check: account.last_health_check,
                    last_error: account.last_error,
                    error_count: account.error_count,
                    is_primary: false,
                    is_active: account.is_active,
                    created_at: account.created_at,
                    updated_at: ctx.timestamp,
                    deleted_at: account.deleted_at,
                    created_by: account.created_by,
                    metadata: account.metadata,
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
            id: account.id,
            organization_id: account.organization_id,
            name: account.name,
            phone_number: account.phone_number,
            phone_number_id: account.phone_number_id,
            business_account_id: account.business_account_id,
            display_name: account.display_name,
            credentials_reference: account.credentials_reference,
            webhook_secret_reference: account.webhook_secret_reference,
            messaging_enabled: account.messaging_enabled,
            notifications_enabled: account.notifications_enabled,
            template_messaging_enabled: account.template_messaging_enabled,
            interactive_messaging_enabled: account.interactive_messaging_enabled,
            template_namespace: account.template_namespace,
            default_language: account.default_language,
            media_provider: account.media_provider,
            webhook_enabled: account.webhook_enabled,
            webhook_url: account.webhook_url,
            subscribed_webhook_events: account.subscribed_webhook_events,
            daily_message_limit: account.daily_message_limit,
            messages_sent_today: account.messages_sent_today,
            last_message_reset: account.last_message_reset,
            verification_status: account.verification_status,
            business_verification_level: account.business_verification_level,
            quality_score: account.quality_score,
            quality_score_updated_at: account.quality_score_updated_at,
            status: account.status,
            sync_status: account.sync_status,
            last_health_check: account.last_health_check,
            last_error: account.last_error,
            error_count: account.error_count,
            is_primary: true,
            is_active: account.is_active,
            created_at: account.created_at,
            updated_at: ctx.timestamp,
            deleted_at: account.deleted_at,
            created_by: account.created_by,
            metadata: account.metadata,
        });

    Ok(())
}
