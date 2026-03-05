/// Data Privacy & Security
///
/// Tables:  DataClassification · DataClassificationRule · PrivacyConsent
/// Pattern: Classifications label sensitivity level (1–4).
///          Rules bind classifications to specific tables/columns.
///          PrivacyConsent tracks GDPR/CCPA opt-in/opt-out per contact.
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::check_permission;

// ============================================================================
// PARAMS TYPES
// ============================================================================

/// Params for creating a data classification.
/// Scope: `organization_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDataClassificationParams {
    pub name: String,
    /// 1 = Public · 2 = Internal · 3 = Confidential · 4 = Restricted
    pub level: u8,
    pub description: Option<String>,
    pub retention_days: Option<u32>,
    pub encryption_required: bool,
    pub metadata: Option<String>,
}

/// Params for creating a data classification rule.
/// Scope: `organization_id` is a flat reducer param.
/// `created_at` is system-derived.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDataClassificationRuleParams {
    pub table_name: String,
    pub column_name: Option<String>, // None = applies to whole table
    pub classification_id: u64,
    pub applies_to: String, // `"all"` or a filter expression
    pub metadata: Option<String>,
}

/// Params for recording a privacy consent grant or revocation.
/// Scope: `organization_id` is a flat reducer param.
/// `granted_at` / `revoked_at` are computed from `granted` + ctx.timestamp.
#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordPrivacyConsentParams {
    pub contact_id: u64,
    pub consent_type: String,
    pub granted: bool,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub metadata: Option<String>,
}

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = data_classification,
    public,
    index(accessor = data_class_by_org, btree(columns = [organization_id]))
)]
pub struct DataClassification {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    /// 1 = Public · 2 = Internal · 3 = Confidential · 4 = Restricted
    pub level: u8,
    pub description: Option<String>,
    pub retention_days: Option<u32>,
    pub encryption_required: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = data_classification_rule,
    public,
    index(accessor = class_rule_by_org, btree(columns = [organization_id]))
)]
pub struct DataClassificationRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub table_name: String,
    pub column_name: Option<String>, // None = applies to whole table
    pub classification_id: u64,
    pub applies_to: String, // `"all"` or a filter expression
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = privacy_consent,
    public,
    index(accessor = consent_by_org,     btree(columns = [organization_id])),
    index(accessor = consent_by_contact, btree(columns = [contact_id]))
)]
pub struct PrivacyConsent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub contact_id: u64,
    pub consent_type: String,
    pub granted: bool,
    pub granted_at: Option<Timestamp>,
    pub revoked_at: Option<Timestamp>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_data_classification(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateDataClassificationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "data_classification", "create")?;

    if !(1..=4).contains(&params.level) {
        return Err(
            "Level must be 1 (Public), 2 (Internal), 3 (Confidential), or 4 (Restricted)"
                .to_string(),
        );
    }

    ctx.db.data_classification().insert(DataClassification {
        id: 0,
        organization_id,
        name: params.name,
        level: params.level,
        description: params.description,
        retention_days: params.retention_days,
        encryption_required: params.encryption_required,
        metadata: params.metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_data_classification_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateDataClassificationRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "data_classification_rule", "create")?;

    ctx.db
        .data_classification()
        .id()
        .find(&params.classification_id)
        .ok_or("Data classification not found")?;

    ctx.db
        .data_classification_rule()
        .insert(DataClassificationRule {
            id: 0,
            organization_id,
            table_name: params.table_name,
            column_name: params.column_name,
            classification_id: params.classification_id,
            applies_to: params.applies_to,
            // System-derived: creation timestamp
            created_at: ctx.timestamp,
            metadata: params.metadata,
        });

    Ok(())
}

/// Record a consent grant or revocation for a contact.
/// Pass `granted = true` to grant, `false` to revoke.
#[spacetimedb::reducer]
pub fn record_privacy_consent(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordPrivacyConsentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "privacy_consent", "create")?;

    ctx.db.privacy_consent().insert(PrivacyConsent {
        id: 0,
        organization_id,
        contact_id: params.contact_id,
        consent_type: params.consent_type,
        granted: params.granted,
        // System-derived: computed from granted flag + ctx.timestamp
        granted_at: if params.granted {
            Some(ctx.timestamp)
        } else {
            None
        },
        revoked_at: if !params.granted {
            Some(ctx.timestamp)
        } else {
            None
        },
        ip_address: params.ip_address,
        user_agent: params.user_agent,
        metadata: params.metadata,
    });

    Ok(())
}
