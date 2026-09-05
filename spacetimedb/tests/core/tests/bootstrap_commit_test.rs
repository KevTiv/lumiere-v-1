//! C2 proof for the core tenant bootstrap reducer.

use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{
    bootstrap_new_tenant, organization, BootstrapNewTenantParams, CreateOrganizationParams,
    UpsertOrganizationSettingsParams,
};
use crate::core::persistence::{
    organization_commit, organization_row_change, CHANGE_SCHEMA_VERSION, CONTRACT_VERSION,
};

/// Bootstrap emits one complete, ordered commit for the server-created tenant
/// graph, with no organization scope supplied by the caller.
#[spacetimedb::reducer]
pub fn test_bootstrap_new_tenant_records_complete_commit(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let code = format!("C2-BOOT-{}", ctx.timestamp.to_micros_since_unix_epoch());
    bootstrap_new_tenant(
        ctx,
        BootstrapNewTenantParams {
            organization: CreateOrganizationParams {
                name: "C2 Bootstrap Organization".to_string(),
                code: code.clone(),
                timezone: "UTC".to_string(),
                date_format: "YYYY-MM-DD".to_string(),
                language: "en".to_string(),
                is_active: true,
                description: None,
                logo_url: None,
                website: None,
                email: None,
                phone: None,
                currency_id: None,
                metadata: None,
            },
            default_company_name: "C2 Bootstrap Company".to_string(),
            default_company_code: "C2CO".to_string(),
            default_company_currency_id: 0,
            default_company_currency_code: Some("EUR".to_string()),
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            seed_form_configs: false,
            settings: UpsertOrganizationSettingsParams {
                module_config: Some(r#"{"source":"c2-test"}"#.to_string()),
                feature_flags: vec!["c2_bootstrap".to_string()],
                integration_keys: None,
                metadata: None,
            },
        },
    )?;

    let org = ctx
        .db
        .organization()
        .iter()
        .find(|row| row.code == code)
        .ok_or("bootstrap organization missing")?;
    let expected_correlation = format!("bootstrap:organization:{}", org.id);
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .iter()
        .filter(|commit| {
            commit.organization_id == org.id
                && commit.operation_id == "erp.bootstrap_new_tenant"
                && commit.correlation_id == expected_correlation
        })
        .collect();
    if commits.len() != 1 {
        return Err(format!(
            "expected one bootstrap commit, found {}",
            commits.len()
        ));
    }
    let commit = commits[0].clone();
    if commit.actor_identity != ctx.sender()
        || commit.change_schema_version != CHANGE_SCHEMA_VERSION
        || commit.contract_version != CONTRACT_VERSION
    {
        return Err("bootstrap commit metadata is not canonical".to_string());
    }

    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .iter()
        .filter(|change| {
            change.organization_id == org.id && change.commit_sequence == commit.sequence
        })
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    if changes.len() != commit.row_change_count as usize {
        return Err(format!(
            "row-change count mismatch: envelope={}, rows={}",
            commit.row_change_count,
            changes.len()
        ));
    }

    let mut expected_tables = vec!["organization", "currency", "currency"];
    for _ in 0..11 {
        expected_tables.push("country_pack_definition");
    }
    for _ in 0..13 {
        expected_tables.push("country_pack_tax_rule");
    }
    for _ in 0..15 {
        expected_tables.push("hr_country_pack_leave_default");
    }
    expected_tables.extend([
        "organization_settings",
        "activity_type",
        "company",
        "role",
        "user_profile",
        "user_organization",
        "user_role_assignment",
    ]);
    let actual_tables: Vec<_> = changes
        .iter()
        .map(|change| change.table_name.as_str())
        .collect();
    if actual_tables != expected_tables {
        return Err(format!(
            "bootstrap row order mismatch: expected {expected_tables:?}, got {actual_tables:?}"
        ));
    }
    if changes
        .iter()
        .any(|change| change.organization_id != org.id)
    {
        return Err("bootstrap row change escaped the server-derived organization".to_string());
    }
    if changes.iter().any(|change| change.row_json.is_none()) {
        return Err("bootstrap commit must contain full rows for every upsert".to_string());
    }
    Ok(())
}
