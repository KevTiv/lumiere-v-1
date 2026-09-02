//! INT-003/INT-004/INT-005: company_id scoping on the WhatsApp Business and
//! Google Drive integration connector records, plus a create-time
//! `conflict_policy` override for Google Drive.
use spacetimedb::{ReducerContext, Table};

use crate::integrations::google_drive::{
    create_google_drive_connection, google_drive_connection, DriveConflictPolicy, SyncDirection,
};
use crate::integrations::whatsapp_business::{
    create_whatsapp_business_account, delete_whatsapp_business_account,
    set_whatsapp_primary_account, whatsapp_business_account, CreateWhatsAppBusinessAccountParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn whatsapp_params(company_id: Option<u64>, name: &str) -> CreateWhatsAppBusinessAccountParams {
    CreateWhatsAppBusinessAccountParams {
        company_id,
        name: name.to_string(),
        phone_number: "+15550001111".to_string(),
        phone_number_id: format!("phone-id-{name}"),
        business_account_id: format!("business-id-{name}"),
        display_name: name.to_string(),
        credentials_reference: "vault://test/whatsapp".to_string(),
        webhook_secret_reference: "vault://test/whatsapp-webhook".to_string(),
        messaging_enabled: true,
        notifications_enabled: true,
        template_messaging_enabled: false,
        interactive_messaging_enabled: false,
        default_language: "en".to_string(),
        webhook_enabled: false,
        webhook_url: None,
        subscribed_webhook_events: vec![],
        daily_message_limit: 250,
        is_primary: false,
        template_namespace: None,
        media_provider: None,
        metadata: None,
    }
}

/// INT-003: `company_id` is populated on create and validated against
/// `organization_id` (rejecting a company that belongs to a different org).
pub fn test_whatsapp_company_id_populated_and_validated(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let org_a = OrgFixture::seed_minimal(ctx)?;
    let org_b = OrgFixture::seed_minimal(ctx)?;

    // (a) company_id populated on create.
    create_whatsapp_business_account(
        ctx,
        org_a.organization_id,
        whatsapp_params(Some(org_a.company_id), "INT-003 Scoped"),
    )?;
    let scoped = ctx
        .db
        .whatsapp_business_account()
        .iter()
        .find(|a| a.organization_id == org_a.organization_id && a.name == "INT-003 Scoped")
        .ok_or("scoped whatsapp account missing after create")?;
    if scoped.company_id != Some(org_a.company_id) {
        return Err(format!(
            "expected company_id={:?}, got {:?}",
            Some(org_a.company_id),
            scoped.company_id
        ));
    }

    // company_id is optional — org-wide accounts must still be creatable.
    create_whatsapp_business_account(
        ctx,
        org_a.organization_id,
        whatsapp_params(None, "INT-003 OrgWide"),
    )?;
    let org_wide = ctx
        .db
        .whatsapp_business_account()
        .iter()
        .find(|a| a.organization_id == org_a.organization_id && a.name == "INT-003 OrgWide")
        .ok_or("org-wide whatsapp account missing after create")?;
    if org_wide.company_id.is_some() {
        return Err("org-wide whatsapp account should have company_id=None".to_string());
    }

    // (b) a company_id belonging to a different organization must be rejected.
    let before_count = ctx
        .db
        .whatsapp_business_account()
        .iter()
        .filter(|a| a.organization_id == org_a.organization_id)
        .count();
    let result = create_whatsapp_business_account(
        ctx,
        org_a.organization_id,
        whatsapp_params(Some(org_b.company_id), "INT-003 CrossOrg"),
    );
    match result {
        Err(ref e) if e.contains("does not belong to this organization") => {}
        other => {
            return Err(format!(
                "expected cross-org company_id rejection, got {other:?}"
            ))
        }
    }
    let after_count = ctx
        .db
        .whatsapp_business_account()
        .iter()
        .filter(|a| a.organization_id == org_a.organization_id)
        .count();
    if before_count != after_count {
        return Err("rejected cross-org create should not have persisted a row".to_string());
    }

    Ok(())
}

/// Creating or selecting a primary account preserves the one-primary invariant,
/// and deleted accounts cannot be promoted back into active configuration.
pub fn test_whatsapp_primary_account_integrity(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    let mut first = whatsapp_params(Some(fixture.company_id), "Primary One");
    first.is_primary = true;
    create_whatsapp_business_account(ctx, fixture.organization_id, first)?;

    let mut second = whatsapp_params(Some(fixture.company_id), "Primary Two");
    second.is_primary = true;
    create_whatsapp_business_account(ctx, fixture.organization_id, second)?;

    let accounts: Vec<_> = ctx
        .db
        .whatsapp_business_account()
        .iter()
        .filter(|account| account.organization_id == fixture.organization_id)
        .collect();
    let first = accounts
        .iter()
        .find(|account| account.name == "Primary One")
        .ok_or("first WhatsApp account missing")?;
    let second = accounts
        .iter()
        .find(|account| account.name == "Primary Two")
        .ok_or("second WhatsApp account missing")?;
    if first.is_primary || !second.is_primary {
        return Err("creating a new primary must unset the previous primary".to_string());
    }

    let second_id = second.id;
    delete_whatsapp_business_account(ctx, fixture.organization_id, second_id)?;
    let result = set_whatsapp_primary_account(ctx, fixture.organization_id, second_id);
    match result {
        Err(ref error) if error.contains("deleted or inactive") => {}
        other => return Err(format!("expected deleted-primary rejection, got {other:?}")),
    }

    set_whatsapp_primary_account(ctx, fixture.organization_id, first.id)?;
    let restored = ctx
        .db
        .whatsapp_business_account()
        .id()
        .find(&first.id)
        .ok_or("restored primary WhatsApp account missing")?;
    if !restored.is_primary {
        return Err("active WhatsApp account was not promoted to primary".to_string());
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn create_drive_connection(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    name: &str,
    conflict_policy: Option<DriveConflictPolicy>,
) -> Result<(), String> {
    create_google_drive_connection(
        ctx,
        organization_id,
        company_id,
        name.to_string(),
        "drive-user@example.test".to_string(),
        format!("gd-account-{name}"),
        "vault://test/drive".to_string(),
        None,
        None,
        true,
        false,
        None,
        None,
        SyncDirection::Bidirectional,
        conflict_policy,
        60,
        vec!["pdf".to_string()],
        25,
    )
}

/// INT-004: `company_id` is populated on create and validated against
/// `organization_id` (rejecting a company that belongs to a different org).
pub fn test_google_drive_company_id_populated_and_validated(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let org_a = OrgFixture::seed_minimal(ctx)?;
    let org_b = OrgFixture::seed_minimal(ctx)?;

    // (a) company_id populated on create.
    create_drive_connection(
        ctx,
        org_a.organization_id,
        Some(org_a.company_id),
        "INT-004 Scoped",
        None,
    )?;
    let scoped = ctx
        .db
        .google_drive_connection()
        .iter()
        .find(|c| c.organization_id == org_a.organization_id && c.name == "INT-004 Scoped")
        .ok_or("scoped drive connection missing after create")?;
    if scoped.company_id != Some(org_a.company_id) {
        return Err(format!(
            "expected company_id={:?}, got {:?}",
            Some(org_a.company_id),
            scoped.company_id
        ));
    }

    // company_id is optional — org-wide connections must still be creatable.
    create_drive_connection(ctx, org_a.organization_id, None, "INT-004 OrgWide", None)?;
    let org_wide = ctx
        .db
        .google_drive_connection()
        .iter()
        .find(|c| c.organization_id == org_a.organization_id && c.name == "INT-004 OrgWide")
        .ok_or("org-wide drive connection missing after create")?;
    if org_wide.company_id.is_some() {
        return Err("org-wide drive connection should have company_id=None".to_string());
    }

    // (b) a company_id belonging to a different organization must be rejected.
    let before_count = ctx
        .db
        .google_drive_connection()
        .iter()
        .filter(|c| c.organization_id == org_a.organization_id)
        .count();
    let result = create_drive_connection(
        ctx,
        org_a.organization_id,
        Some(org_b.company_id),
        "INT-004 CrossOrg",
        None,
    );
    match result {
        Err(ref e) if e.contains("does not belong to this organization") => {}
        other => {
            return Err(format!(
                "expected cross-org company_id rejection, got {other:?}"
            ))
        }
    }
    let after_count = ctx
        .db
        .google_drive_connection()
        .iter()
        .filter(|c| c.organization_id == org_a.organization_id)
        .count();
    if before_count != after_count {
        return Err("rejected cross-org create should not have persisted a row".to_string());
    }

    Ok(())
}

/// INT-005: `conflict_policy` is settable per connector at creation time —
/// omitting it preserves the previous hardcoded `PreferRemote` default, while
/// passing an explicit value persists that value instead.
pub fn test_google_drive_conflict_policy_configurable(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    // Omitted -> default PreferRemote (matches prior hardcoded behavior).
    create_drive_connection(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        "INT-005 Default",
        None,
    )?;
    let default_conn = ctx
        .db
        .google_drive_connection()
        .iter()
        .find(|c| c.organization_id == fixture.organization_id && c.name == "INT-005 Default")
        .ok_or("default-policy drive connection missing after create")?;
    if default_conn.conflict_policy != DriveConflictPolicy::PreferRemote {
        return Err(format!(
            "expected default conflict_policy=PreferRemote, got {:?}",
            default_conn.conflict_policy
        ));
    }

    // Explicit override -> persisted value differs from the default.
    create_drive_connection(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        "INT-005 Manual",
        Some(DriveConflictPolicy::Manual),
    )?;
    let manual_conn = ctx
        .db
        .google_drive_connection()
        .iter()
        .find(|c| c.organization_id == fixture.organization_id && c.name == "INT-005 Manual")
        .ok_or("manual-policy drive connection missing after create")?;
    if manual_conn.conflict_policy != DriveConflictPolicy::Manual {
        return Err(format!(
            "expected conflict_policy=Manual, got {:?}",
            manual_conn.conflict_policy
        ));
    }
    if manual_conn.conflict_policy == default_conn.conflict_policy {
        return Err(
            "explicit conflict_policy override should differ from the default connection"
                .to_string(),
        );
    }

    Ok(())
}
