/// Data Privacy & Security
///
/// Tables:  DataClassification · DataClassificationRule · PrivacyConsent
/// Pattern: Classifications label sensitivity level (1–4).
///          Rules bind classifications to specific tables/columns.
///          PrivacyConsent tracks GDPR/CCPA opt-in/opt-out per contact.
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::crm::contacts::contact;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

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
    index(accessor = consent_by_org,     btree(columns = [organization_id])),
    index(accessor = consent_by_contact, btree(columns = [contact_id]))
)]
pub struct PrivacyConsent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
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

    let row = ctx.db.data_classification().insert(DataClassification {
        id: 0,
        organization_id,
        name: params.name.clone(),
        level: params.level,
        description: params.description.clone(),
        retention_days: params.retention_days,
        encryption_required: params.encryption_required,
        metadata: params.metadata.clone(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "data_classification",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "level": params.level,
                    "encryption_required": params.encryption_required,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "level".to_string(),
                "encryption_required".to_string(),
            ],
            metadata: None,
        },
    );

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

    let row = ctx
        .db
        .data_classification_rule()
        .insert(DataClassificationRule {
            id: 0,
            organization_id,
            table_name: params.table_name.clone(),
            column_name: params.column_name.clone(),
            classification_id: params.classification_id,
            applies_to: params.applies_to.clone(),
            // System-derived: creation timestamp
            created_at: ctx.timestamp,
            metadata: params.metadata.clone(),
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "data_classification_rule",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "table_name": params.table_name,
                    "column_name": params.column_name,
                    "classification_id": params.classification_id,
                    "applies_to": params.applies_to,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "table_name".to_string(),
                "classification_id".to_string(),
                "applies_to".to_string(),
            ],
            metadata: None,
        },
    );

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

    let contact = ctx
        .db
        .contact()
        .id()
        .find(&params.contact_id)
        .ok_or("Contact not found")?;
    if contact.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }
    let company_id = contact.company_id.ok_or("Contact has no company scope")?;

    let row = ctx.db.privacy_consent().insert(PrivacyConsent {
        id: 0,
        organization_id,
        company_id,
        contact_id: params.contact_id,
        consent_type: params.consent_type.clone(),
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
        ip_address: params.ip_address.clone(),
        user_agent: params.user_agent.clone(),
        metadata: params.metadata.clone(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "privacy_consent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "contact_id": params.contact_id,
                    "consent_type": params.consent_type,
                    "granted": params.granted,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "contact_id".to_string(),
                "consent_type".to_string(),
                "granted".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Purge rows past their classification retention window (operational messages only in v1).
#[spacetimedb::reducer]
pub fn execute_retention_purge(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    use crate::core::operational_messaging::operational_message;

    check_permission(ctx, organization_id, "data_classification", "write")?;

    let mut purged_count = 0u32;

    for classification in ctx
        .db
        .data_classification()
        .data_class_by_org()
        .filter(&organization_id)
    {
        let Some(retention_days) = classification.retention_days else {
            continue;
        };
        if retention_days == 0 {
            continue;
        }

        let cutoff_micros = ctx
            .timestamp
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_micros()
            .saturating_sub(u128::from(retention_days) * 86_400_000_000);

        let cutoff = Timestamp::from_micros_since_unix_epoch(cutoff_micros as i64);

        for rule in ctx
            .db
            .data_classification_rule()
            .class_rule_by_org()
            .filter(&organization_id)
            .filter(|r| r.classification_id == classification.id)
        {
            if rule.table_name != "operational_message" {
                continue;
            }

            let stale_ids: Vec<u64> = ctx
                .db
                .operational_message()
                .iter()
                .filter(|m| m.organization_id == organization_id && m.created_at < cutoff)
                .map(|m| m.id)
                .collect();

            for id in stale_ids {
                ctx.db.operational_message().id().delete(&id);
                purged_count += 1;
            }
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "data_classification",
            record_id: 0,
            action: "RETENTION_PURGE",
            old_values: None,
            new_values: Some(serde_json::json!({ "purged_count": purged_count }).to_string()),
            changed_fields: vec!["purged_count".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
