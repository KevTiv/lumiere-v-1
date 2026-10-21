//! Form Configuration Migrations
//!
//! This module provides migration reducers for seeding default form configurations
//! for existing organizations.

use spacetimedb::{ReducerContext, Table};

use crate::forms::{
    add_form_field, create_form_configuration, form_config, publish_form_configuration,
    set_form_role_config, CreateFormConfigParams, CreateFormFieldParams, CreateRoleConfigParams,
    FieldOption, FieldType, FieldValidation, FieldWidth, PublishFormConfigurationParams,
};
use crate::helpers::check_permission;

/// Shared implementation for `seed_organization_form_configs` and tenant bootstrap.
pub(crate) fn run_seed_organization_form_configs(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    // Initialize Journal form
    seed_journal_form(ctx, organization_id)?;
    seed_operator_workflow_forms(ctx, organization_id)?;

    for module_id in [
        "forensic",
        "crm",
        "inventory",
        "accounting",
        "hr",
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
    check_permission(ctx, organization_id, "form_configuration", "create")?;
    run_seed_organization_form_configs(ctx, organization_id)
}

/// Governed defaults for order-line entry and sales/purchase accounting handoffs.
/// Relation options remain current-company query data supplied by the form owner.
/// No role IDs are guessed: the tenant's form/field policy owns role restrictions.
fn seed_operator_workflow_forms(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    for (module_id, form_id, name) in [
        ("sales", "add-sale-order-line", "Add sale order line"),
        (
            "purchasing",
            "add-purchase-order-line",
            "Add purchase order line",
        ),
        (
            "sales",
            "create-invoice-from-sale-order",
            "Create invoice from sale order",
        ),
        (
            "purchasing",
            "create-bill-from-purchase-order",
            "Create bill from purchase order",
        ),
    ] {
        let existing: Vec<_> = ctx
            .db
            .form_config()
            .iter()
            .filter(|config| {
                config.organization_id == organization_id
                    && config.module_id == module_id
                    && config.form_id == form_id
            })
            .collect();
        match existing.len() {
            0 => {}
            1 => continue, // Preserve operator edits, versions, and deliberate deactivation.
            count => {
                return Err(format!(
                    "Duplicate governed form identity {organization_id}/{module_id}/{form_id}: {count}"
                ));
            }
        }

        publish_form_configuration(
            ctx,
            organization_id,
            PublishFormConfigurationParams {
                module_id: module_id.to_string(),
                form_id: form_id.to_string(),
                name: name.to_string(),
                description: Some(name.to_string()),
                is_system_default: true,
                fields: workflow_form_fields(module_id, form_id),
                role_configs: vec![],
                expected_updated_at_micros: None,
                replace_missing_fields: false,
            },
        )?;
    }
    Ok(())
}

/// Field identities match sales/purchasing-form-configs.ts. Presentation and
/// relation choices are merged by the existing runtime form owner, not seeded IDs.
fn workflow_form_fields(module_id: &str, form_id: &str) -> Vec<CreateFormFieldParams> {
    let mut definitions = if form_id == "create-invoice-from-sale-order" {
        vec![
            ("journalId", "Journal", FieldType::Select, true, None),
            (
                "defaultIncomeAccountId",
                "Income account",
                FieldType::Select,
                true,
                None,
            ),
            (
                "receivableAccountId",
                "Receivable account",
                FieldType::Select,
                true,
                None,
            ),
            (
                "receivableLineName",
                "Receivable line name",
                FieldType::Text,
                false,
                None,
            ),
            ("narration", "Narration", FieldType::Textarea, false, None),
            (
                "incomeExcludeFromInvoiceTab",
                "Exclude income from invoice tab",
                FieldType::Checkbox,
                false,
                Some("false"),
            ),
            (
                "incomeBlocked",
                "Block income line",
                FieldType::Checkbox,
                false,
                Some("false"),
            ),
            (
                "receivableExcludeFromInvoiceTab",
                "Exclude receivable from invoice tab",
                FieldType::Checkbox,
                false,
                Some("true"),
            ),
            (
                "receivableBlocked",
                "Block receivable line",
                FieldType::Checkbox,
                false,
                Some("false"),
            ),
        ]
    } else if form_id == "create-bill-from-purchase-order" {
        vec![
            ("journalId", "Journal", FieldType::Select, true, None),
            (
                "defaultExpenseAccountId",
                "Expense account",
                FieldType::Select,
                true,
                None,
            ),
            (
                "payableAccountId",
                "Payable account",
                FieldType::Select,
                true,
                None,
            ),
            ("invoiceDate", "Invoice date", FieldType::Date, true, None),
            (
                "payableLineName",
                "Payable line name",
                FieldType::Text,
                false,
                None,
            ),
            ("narration", "Narration", FieldType::Textarea, false, None),
            (
                "expenseExcludeFromInvoiceTab",
                "Exclude expense from invoice tab",
                FieldType::Checkbox,
                false,
                Some("false"),
            ),
            (
                "expenseBlocked",
                "Block expense line",
                FieldType::Checkbox,
                false,
                Some("false"),
            ),
            (
                "payableExcludeFromInvoiceTab",
                "Exclude payable from invoice tab",
                FieldType::Checkbox,
                false,
                Some("true"),
            ),
            (
                "payableBlocked",
                "Block payable line",
                FieldType::Checkbox,
                false,
                Some("false"),
            ),
        ]
    } else {
        vec![
            ("orderId", "Order", FieldType::Select, true, None),
            ("productId", "Product", FieldType::Select, true, None),
            ("uomId", "Unit of measure", FieldType::Select, true, None),
            ("quantity", "Quantity", FieldType::Number, true, None),
            ("priceUnit", "Unit price", FieldType::Number, true, None),
        ]
    };
    if module_id == "sales" && form_id == "add-sale-order-line" {
        definitions.extend([
            ("discount", "Discount", FieldType::Number, false, Some("0")),
            ("sequence", "Sequence", FieldType::Number, false, Some("10")),
            ("name", "Description", FieldType::Text, false, None),
            ("taxIds", "Tax IDs", FieldType::Textarea, false, None),
        ]);
    }
    definitions
        .into_iter()
        .enumerate()
        .map(
            |(index, (field_id, label, field_type, required, default_value))| {
                CreateFormFieldParams {
                    field_id: field_id.to_string(),
                    name: field_id.to_string(),
                    label: label.to_string(),
                    field_type,
                    description: None,
                    placeholder: None,
                    default_value: default_value.map(str::to_string),
                    options: vec![],
                    validation: FieldValidation {
                        required,
                        ..Default::default()
                    },
                    ai_suggestions: vec![],
                    order: (index + 1) as u32,
                    is_system: true,
                    is_enabled: true,
                    category: None,
                    show_in_list: false,
                    width: FieldWidth::Full,
                    section_id: None,
                    visibility_json: None,
                }
            },
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn order_line_defaults_match_operator_field_identities() {
        for (module, expected) in [
            (
                "purchasing",
                vec!["orderId", "productId", "uomId", "quantity", "priceUnit"],
            ),
            (
                "sales",
                vec![
                    "orderId",
                    "productId",
                    "uomId",
                    "quantity",
                    "priceUnit",
                    "discount",
                    "sequence",
                    "name",
                    "taxIds",
                ],
            ),
        ] {
            let form_id = if module == "sales" {
                "add-sale-order-line"
            } else {
                "add-purchase-order-line"
            };
            let fields = workflow_form_fields(module, form_id);
            assert_eq!(
                fields
                    .iter()
                    .map(|field| field.field_id.as_str())
                    .collect::<Vec<_>>(),
                expected
            );
            for (index, field) in fields.iter().enumerate() {
                assert_eq!(field.name, field.field_id);
                assert_eq!(field.validation.required, index < 5);
                assert!(field.is_system && field.is_enabled);
                assert!(
                    field.options.is_empty(),
                    "relation choices must not contain seeded tenant IDs"
                );
            }
        }
    }

    #[test]
    fn invoice_defaults_match_operator_fields_and_checkbox_defaults() {
        let fields = workflow_form_fields("sales", "create-invoice-from-sale-order");
        let expected = [
            ("journalId", FieldType::Select, true, None),
            ("defaultIncomeAccountId", FieldType::Select, true, None),
            ("receivableAccountId", FieldType::Select, true, None),
            ("receivableLineName", FieldType::Text, false, None),
            ("narration", FieldType::Textarea, false, None),
            (
                "incomeExcludeFromInvoiceTab",
                FieldType::Checkbox,
                false,
                Some("false"),
            ),
            ("incomeBlocked", FieldType::Checkbox, false, Some("false")),
            (
                "receivableExcludeFromInvoiceTab",
                FieldType::Checkbox,
                false,
                Some("true"),
            ),
            (
                "receivableBlocked",
                FieldType::Checkbox,
                false,
                Some("false"),
            ),
        ];
        assert_eq!(fields.len(), expected.len());
        for (field, (id, field_type, required, default)) in fields.iter().zip(expected) {
            assert_eq!(field.field_id, id);
            assert_eq!(field.name, id);
            assert_eq!(field.field_type, field_type);
            assert_eq!(field.validation.required, required);
            assert_eq!(field.default_value.as_deref(), default);
            assert!(field.is_enabled && field.is_system && field.options.is_empty());
        }
    }

    #[test]
    fn bill_defaults_match_operator_fields_and_checkbox_defaults() {
        let fields = workflow_form_fields("purchasing", "create-bill-from-purchase-order");
        let expected = [
            ("journalId", FieldType::Select, true, None),
            ("defaultExpenseAccountId", FieldType::Select, true, None),
            ("payableAccountId", FieldType::Select, true, None),
            ("invoiceDate", FieldType::Date, true, None),
            ("payableLineName", FieldType::Text, false, None),
            ("narration", FieldType::Textarea, false, None),
            (
                "expenseExcludeFromInvoiceTab",
                FieldType::Checkbox,
                false,
                Some("false"),
            ),
            ("expenseBlocked", FieldType::Checkbox, false, Some("false")),
            (
                "payableExcludeFromInvoiceTab",
                FieldType::Checkbox,
                false,
                Some("true"),
            ),
            ("payableBlocked", FieldType::Checkbox, false, Some("false")),
        ];
        assert_eq!(fields.len(), expected.len());
        for (field, (id, field_type, required, default)) in fields.iter().zip(expected) {
            assert_eq!(field.field_id, id);
            assert_eq!(field.name, id);
            assert_eq!(field.field_type, field_type);
            assert_eq!(field.validation.required, required);
            assert_eq!(field.default_value.as_deref(), default);
            assert!(field.is_enabled && field.is_system && field.options.is_empty());
        }
    }
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
        match run_seed_organization_form_configs(ctx, org_id) {
            Ok(_) => log::info!("Migrated org {}", org_id),
            Err(e) => log::error!("Failed to migrate org {}: {}", org_id, e),
        }
    }

    Ok(())
}
