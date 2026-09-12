//! C2 proof for the core tenant bootstrap reducer.

use serde_json::{Map, Value};
use spacetimedb::{ReducerContext, Table};

use crate::core::country_pack::{country_pack_definition, country_pack_tax_rule};
use crate::core::organization::{
    bootstrap_new_tenant, company, organization, organization_settings, BootstrapNewTenantParams,
    CreateOrganizationParams, UpsertOrganizationSettingsParams,
};
use crate::core::permissions::{role, user_role_assignment};
use crate::core::persistence::{
    organization_commit, organization_row_change, CHANGE_SCHEMA_VERSION, CONTRACT_VERSION,
};
use crate::core::reference::currency;
use crate::core::users::{user_organization, user_profile};
use crate::crm::activities::activity_type;
use crate::forms::{form_config, form_config_field, form_field_label, form_role_config};
use crate::hr::country_pack_hr::hr_country_pack_leave_default;

struct ExpectedChange {
    table_name: &'static str,
    row_identity_json: String,
    row_json: String,
}

fn sort_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys: Vec<_> = object.keys().collect();
            keys.sort_unstable();
            let mut sorted = Map::new();
            for key in keys {
                sorted.insert(key.clone(), sort_json(&object[key]));
            }
            Value::Object(sorted)
        }
        Value::Array(values) => Value::Array(values.iter().map(sort_json).collect()),
        _ => value.clone(),
    }
}

fn canonical_json(value: Value) -> Result<String, String> {
    serde_json::to_string(&sort_json(&value))
        .map_err(|error| format!("serialize expected canonical JSON: {error}"))
}

fn expected_change<T>(
    table_name: &'static str,
    row_identity: Value,
    row: &T,
) -> Result<ExpectedChange, String>
where
    T: spacetimedb_sats::Serialize + ?Sized,
{
    let row_value = serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(row))
        .map_err(|error| format!("serialize expected STDB row: {error}"))?;
    Ok(ExpectedChange {
        table_name,
        row_identity_json: canonical_json(row_identity)?,
        row_json: canonical_json(row_value)?,
    })
}

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
            seed_form_configs: true,
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
    expected_tables.push("form_config");
    for _ in 0..8 {
        expected_tables.push("form_config_field");
    }
    for _ in 0..5 {
        expected_tables.push("form_role_config");
    }
    let actual_tables: Vec<_> = changes
        .iter()
        .map(|change| change.table_name.as_str())
        .collect();
    if actual_tables != expected_tables {
        return Err(format!(
            "bootstrap row order mismatch: expected {expected_tables:?}, got {actual_tables:?}"
        ));
    }

    let mut expected_changes = vec![expected_change(
        "organization",
        serde_json::json!({"id": org.id}),
        &org,
    )?];
    let mut currencies: Vec<_> = ctx
        .db
        .currency()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    currencies.sort_by_key(|row| row.id);
    for row in currencies {
        expected_changes.push(expected_change(
            "currency",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let mut country_packs: Vec<_> = ctx
        .db
        .country_pack_definition()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    country_packs
        .sort_by(|left, right| left.organization_pack_key.cmp(&right.organization_pack_key));
    for row in country_packs {
        expected_changes.push(expected_change(
            "country_pack_definition",
            serde_json::json!({"organization_pack_key": row.organization_pack_key}),
            &row,
        )?);
    }

    let mut country_pack_tax_rules: Vec<_> = ctx
        .db
        .country_pack_tax_rule()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    country_pack_tax_rules.sort_by_key(|row| row.id);
    for row in country_pack_tax_rules {
        expected_changes.push(expected_change(
            "country_pack_tax_rule",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let mut leave_defaults: Vec<_> = ctx
        .db
        .hr_country_pack_leave_default()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    leave_defaults.sort_by_key(|row| row.id);
    for row in leave_defaults {
        expected_changes.push(expected_change(
            "hr_country_pack_leave_default",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let settings = ctx
        .db
        .organization_settings()
        .organization_id()
        .find(&org.id)
        .ok_or("bootstrap settings missing")?;
    expected_changes.push(expected_change(
        "organization_settings",
        serde_json::json!({"organization_id": org.id}),
        &settings,
    )?);

    let mut activities: Vec<_> = ctx
        .db
        .activity_type()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    activities.sort_by_key(|row| row.id);
    for row in activities {
        expected_changes.push(expected_change(
            "activity_type",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let mut companies: Vec<_> = ctx
        .db
        .company()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    companies.sort_by_key(|row| row.id);
    for row in companies {
        expected_changes.push(expected_change(
            "company",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let mut roles: Vec<_> = ctx
        .db
        .role()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    roles.sort_by_key(|row| row.id);
    for row in roles {
        expected_changes.push(expected_change(
            "role",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let mut profiles: Vec<_> = ctx
        .db
        .user_profile()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    profiles.sort_by_key(|row| row.id);
    for row in profiles {
        expected_changes.push(expected_change(
            "user_profile",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let mut memberships: Vec<_> = ctx
        .db
        .user_organization()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    memberships.sort_by_key(|row| row.id);
    for row in memberships {
        expected_changes.push(expected_change(
            "user_organization",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let mut assignments: Vec<_> = ctx
        .db
        .user_role_assignment()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    assignments.sort_by_key(|row| row.id);
    for row in assignments {
        expected_changes.push(expected_change(
            "user_role_assignment",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let mut form_configs: Vec<_> = ctx
        .db
        .form_config()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    form_configs.sort_by_key(|row| row.id);
    for row in form_configs {
        expected_changes.push(expected_change(
            "form_config",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let mut form_fields: Vec<_> = ctx
        .db
        .form_config_field()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    form_fields.sort_by_key(|row| row.id);
    for row in form_fields {
        expected_changes.push(expected_change(
            "form_config_field",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let mut form_labels: Vec<_> = ctx
        .db
        .form_field_label()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    form_labels.sort_by_key(|row| row.id);
    for row in form_labels {
        expected_changes.push(expected_change(
            "form_field_label",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    let mut form_roles: Vec<_> = ctx
        .db
        .form_role_config()
        .iter()
        .filter(|row| row.organization_id == org.id)
        .collect();
    form_roles.sort_by_key(|row| row.id);
    for row in form_roles {
        expected_changes.push(expected_change(
            "form_role_config",
            serde_json::json!({"id": row.id}),
            &row,
        )?);
    }

    if expected_changes.len() != changes.len() {
        return Err(format!(
            "expected {} persisted rows, commit contains {}",
            expected_changes.len(),
            changes.len()
        ));
    }
    for (ordinal, (actual, expected)) in changes.iter().zip(expected_changes.iter()).enumerate() {
        if actual.ordinal != ordinal as u32
            || actual.organization_id != org.id
            || actual.table_name != expected.table_name
            || actual.change_kind != "upsert"
            || actual.row_identity_json != expected.row_identity_json
            || actual.row_json.as_deref() != Some(expected.row_json.as_str())
        {
            return Err(format!(
                "bootstrap row {ordinal} mismatch: actual table={}, identity={}, row={:?}; expected table={}, identity={}, row={}"
                , actual.table_name
                , actual.row_identity_json
                , actual.row_json
                , expected.table_name
                , expected.row_identity_json
                , expected.row_json
            ));
        }
    }
    Ok(())
}
