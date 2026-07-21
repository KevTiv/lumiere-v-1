//! Form Configuration Migrations
//!
//! This module provides migration reducers for seeding default form configurations
//! for existing organizations.

use spacetimedb::{ReducerContext, Table};

use crate::forms::{
    add_form_field, create_form_configuration, form_config, set_form_role_config,
    CreateFormConfigParams, CreateFormFieldParams, CreateRoleConfigParams, FieldOption, FieldType,
    FieldValidation, FieldWidth,
};

/// Shared implementation for `seed_organization_form_configs` and tenant bootstrap.
pub(crate) fn run_seed_organization_form_configs(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    // Initialize Journal form
    seed_journal_form(ctx, organization_id)?;

    for module_id in [
        "forensic",
        "crm",
        "sales",
        "inventory",
        "accounting",
        "hr",
        "purchasing",
        "projects",
        "documents",
        "manufacturing",
        "helpdesk",
        "expenses",
        "calendar",
        "subscriptions",
        "proposals",
        "reports",
    ] {
        log::warn!(
            "No default form configuration seed exists yet for module '{}' in organization {}",
            module_id,
            organization_id
        );
    }

    log::info!(
        "Seeded implemented default form configurations for organization {}",
        organization_id
    );
    Ok(())
}

/// Seed default form configurations for an organization
/// This should be called during migration or when a new organization is created
#[spacetimedb::reducer]
pub fn seed_organization_form_configs(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    run_seed_organization_form_configs(ctx, organization_id)
}

/// Seed Journal form configuration
fn seed_journal_form(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    // Check if already exists
    let existing: Vec<_> = ctx
        .db
        .form_config()
        .iter()
        .filter(|c| {
            c.organization_id == organization_id
                && c.module_id == "journal"
                && c.form_id == "daily-entry"
        })
        .collect();

    if !existing.is_empty() {
        log::info!(
            "Journal form config already exists for org {}",
            organization_id
        );
        return Ok(());
    }

    // Create form configuration
    let config_params = CreateFormConfigParams {
        module_id: "journal".to_string(),
        form_id: "daily-entry".to_string(),
        name: "Daily Journal".to_string(),
        description: Some("Daily work journal for tracking progress and reflections".to_string()),
        is_system_default: true,
    };

    create_form_configuration(ctx, organization_id, config_params)?;

    // Get the created config
    let config = ctx
        .db
        .form_config()
        .iter()
        .find(|c| {
            c.organization_id == organization_id
                && c.module_id == "journal"
                && c.form_id == "daily-entry"
        })
        .ok_or("Failed to create journal config")?;

    // Add fields
    let mood_options = vec![
        ("great", "Great", "green"),
        ("good", "Good", "blue"),
        ("neutral", "Neutral", "yellow"),
        ("challenging", "Challenging", "orange"),
        ("difficult", "Difficult", "red"),
    ];

    let fields = vec![
        ("mood", "How was your day?", FieldType::Radio, true, 1),
        (
            "accomplishments",
            "What did you accomplish today?",
            FieldType::Textarea,
            true,
            2,
        ),
        (
            "challenges",
            "What challenges did you face?",
            FieldType::Textarea,
            false,
            3,
        ),
        (
            "learnings",
            "What did you learn?",
            FieldType::Textarea,
            false,
            4,
        ),
        (
            "tomorrow_focus",
            "What's your focus for tomorrow?",
            FieldType::Textarea,
            false,
            5,
        ),
        ("energy_level", "Energy Level", FieldType::Slider, false, 6),
        (
            "productivity_score",
            "Productivity Score",
            FieldType::Rating,
            false,
            7,
        ),
        ("tags", "Tags", FieldType::Tags, true, 8),
    ];

    for (field_id, label, field_type, is_system, order) in fields {
        let field_params = CreateFormFieldParams {
            field_id: field_id.to_string(),
            name: field_id.to_string(),
            label: label.to_string(),
            field_type,
            description: None,
            placeholder: None,
            default_value: None,
            options: if field_id == "mood" {
                mood_options
                    .iter()
                    .map(|(value, label, color)| FieldOption {
                        value: value.to_string(),
                        label: label.to_string(),
                        color: Some(color.to_string()),
                        icon: None,
                    })
                    .collect()
            } else {
                vec![]
            },
            validation: FieldValidation {
                required: field_id == "mood" || field_id == "accomplishments",
                ..Default::default()
            },
            ai_suggestions: vec![],
            order,
            is_system,
            is_enabled: true,
            category: None,
            show_in_list: field_id == "tags",
            width: FieldWidth::Full,
            section_id: None,
            visibility_json: None,
        };

        add_form_field(ctx, organization_id, config.id, field_params)?;
    }

    // Add role configs
    let role_configs = vec![
        (
            "role-admin",
            vec![
                "mood",
                "accomplishments",
                "challenges",
                "learnings",
                "tomorrow_focus",
                "energy_level",
                "productivity_score",
                "tags",
            ],
            vec!["mood", "accomplishments"],
        ),
        (
            "role-manager",
            vec![
                "mood",
                "accomplishments",
                "challenges",
                "learnings",
                "tomorrow_focus",
                "energy_level",
                "productivity_score",
                "tags",
            ],
            vec!["mood", "accomplishments"],
        ),
        (
            "role-sales",
            vec![
                "mood",
                "accomplishments",
                "challenges",
                "learnings",
                "tomorrow_focus",
                "tags",
            ],
            vec!["mood", "accomplishments"],
        ),
        (
            "role-warehouse",
            vec!["mood", "accomplishments", "challenges", "tags"],
            vec!["mood", "accomplishments"],
        ),
        (
            "role-viewer",
            vec!["mood", "accomplishments", "learnings", "tags"],
            vec!["mood"],
        ),
    ];

    for (role_id, enabled_fields, required_fields) in role_configs {
        let role_params = CreateRoleConfigParams {
            role_id: role_id.to_string(),
            enabled_fields: enabled_fields.iter().map(|s| s.to_string()).collect(),
            required_fields: required_fields.iter().map(|s| s.to_string()).collect(),
            default_prompts: vec![],
        };

        set_form_role_config(ctx, organization_id, config.id, role_params)?;
    }

    log::info!("Seeded Journal form config for org {}", organization_id);
    Ok(())
}

/// Migration reducer to seed all organizations
/// Call this after deploying the new module version
#[spacetimedb::reducer]
pub fn migrate_all_organizations(ctx: &ReducerContext) -> Result<(), String> {
    // Get all unique organization IDs from form_config table
    let orgs: Vec<u64> = ctx
        .db
        .form_config()
        .iter()
        .map(|c| c.organization_id)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    for org_id in orgs {
        match seed_organization_form_configs(ctx, org_id) {
            Ok(_) => log::info!("Migrated org {}", org_id),
            Err(e) => log::error!("Failed to migrate org {}: {}", org_id, e),
        }
    }

    Ok(())
}
