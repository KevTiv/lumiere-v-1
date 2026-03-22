//! Form Configuration Module — Unified configurable forms across all modules
//!
//! This module provides configurable form fields for all modules in the system.
//! Forms can be customized per organization with role-based visibility and user custom fields.
//!
//! ## Architecture
//!
//! - `FormConfig`: Base configuration for a form (one per organization per form type)
//! - `FormConfigField`: Individual fields within a form configuration
//! - `FormRoleConfig`: Role-based field visibility and requirements
//! - `UserCustomField`: User-specific custom fields extending base forms
//!
//! ## Usage
//!
//! Forms are identified by `module_id` and `form_id` (e.g., "crm:new-lead", "accounting:new-invoice").
//! Custom fields use the `custom:` prefix convention (e.g., "custom:deals_touched").

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

pub mod migrations;

// ═════════════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════════════

/// Field types supported in configurable forms
#[derive(SpacetimeType, Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum FieldType {
    Text,
    Email,
    Password,
    Tel,
    Url,
    Textarea,
    Number,
    Select,
    MultiSelect,
    Checkbox,
    Switch,
    Radio,
    Date,
    Time,
    DateTime,
    File,
    Hidden,
    Rating,
    Slider,
    Tags,
    UserSelect,
    Custom,
}

/// Field width options for form layout
#[derive(SpacetimeType, Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum FieldWidth {
    Full,
    Half,
    Third,
    TwoThirds,
    Quarter,
}

/// Field option for select/radio/multiselect fields
#[derive(SpacetimeType, Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FieldOption {
    pub value: String,
    pub label: String,
    pub color: Option<String>,
    pub icon: Option<String>,
}

/// Validation rules for a field
#[derive(SpacetimeType, Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FieldValidation {
    pub required: bool,
    pub min_length: Option<u32>,
    pub max_length: Option<u32>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub pattern: Option<String>,
    pub message: Option<String>,
}

impl Default for FieldValidation {
    fn default() -> Self {
        Self {
            required: false,
            min_length: None,
            max_length: None,
            min: None,
            max: None,
            pattern: None,
            message: None,
        }
    }
}

/// Parameters for creating a form configuration
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateFormConfigParams {
    pub module_id: String,
    pub form_id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_system_default: bool,
}

/// Parameters for creating a form field
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateFormFieldParams {
    pub field_id: String,
    pub name: String,
    pub label: String,
    pub field_type: FieldType,
    pub description: Option<String>,
    pub placeholder: Option<String>,
    pub default_value: Option<String>,
    pub options: Vec<FieldOption>,
    pub validation: FieldValidation,
    pub ai_suggestions: Vec<String>,
    pub order: u32,
    pub is_system: bool,
    pub is_enabled: bool,
    pub category: Option<String>,
    pub show_in_list: bool,
    pub width: FieldWidth,
    pub section_id: Option<String>,
}

/// Parameters for updating a form field
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateFormFieldParams {
    pub label: Option<String>,
    pub description: Option<String>,
    pub placeholder: Option<String>,
    pub default_value: Option<String>,
    pub options: Option<Vec<FieldOption>>,
    pub validation: Option<FieldValidation>,
    pub ai_suggestions: Option<Vec<String>>,
    pub order: Option<u32>,
    pub is_enabled: Option<bool>,
    pub show_in_list: Option<bool>,
    pub width: Option<FieldWidth>,
}

/// Parameters for creating role configuration
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateRoleConfigParams {
    pub role_id: String,
    pub enabled_fields: Vec<String>,
    pub required_fields: Vec<String>,
    pub default_prompts: Vec<String>,
}

/// Parameters for creating a user custom field
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateUserCustomFieldParams {
    pub configuration_id: u64,
    pub field_id: String,
    pub name: String,
    pub label: String,
    pub field_type: FieldType,
    pub description: Option<String>,
    pub placeholder: Option<String>,
    pub default_value: Option<String>,
    pub options: Vec<FieldOption>,
    pub validation: FieldValidation,
    pub order: u32,
    pub width: FieldWidth,
}

// ═════════════════════════════════════════════════════════════════════════════
// TABLES
// ═════════════════════════════════════════════════════════════════════════════

/// Form configuration - defines a configurable form for an organization
#[spacetimedb::table(public, accessor = form_config)]
pub struct FormConfig {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub module_id: String,
    pub form_id: String,
    pub name: String,
    pub description: String,
    pub is_active: bool,
    pub is_system_default: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub created_by: Identity,
    pub updated_by: Identity,
}

/// Form configuration field - individual fields within a form
#[spacetimedb::table(public, accessor = form_config_field)]
pub struct FormConfigField {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub configuration_id: u64,
    pub field_id: String,
    pub name: String,
    pub label: String,
    pub field_type: FieldType,
    pub description: String,
    pub placeholder: String,
    pub default_value: String,
    pub options_json: String,        // Serialized Vec<FieldOption>
    pub validation_json: String,     // Serialized FieldValidation
    pub ai_suggestions_json: String, // Serialized Vec<String>
    pub order: u32,
    pub is_system: bool,
    pub is_enabled: bool,
    pub category: String,
    pub show_in_list: bool,
    pub width: FieldWidth,
    pub section_id: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// Role-based form configuration - defines which fields are visible/required per role
#[spacetimedb::table(public, accessor = form_role_config)]
pub struct FormRoleConfig {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub configuration_id: u64,
    pub role_id: String,
    pub enabled_fields_json: String,  // Serialized Vec<String>
    pub required_fields_json: String, // Serialized Vec<String>
    pub default_prompts_json: String, // Serialized Vec<String>
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// User custom field - allows users to add custom fields to forms
#[spacetimedb::table(public, accessor = user_custom_field)]
pub struct UserCustomField {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub organization_id: u64,
    #[index(btree)]
    pub user_id: Identity,
    #[index(btree)]
    pub configuration_id: u64,
    pub field_id: String,
    pub field_data_json: String, // Serialized field definition
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

// ═════════════════════════════════════════════════════════════════════════════
// REDUCERS — Form Configuration Management
// ═════════════════════════════════════════════════════════════════════════════

/// Create a new form configuration
#[spacetimedb::reducer]
pub fn create_form_configuration(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateFormConfigParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "form_configuration", "create")?;

    // Check if configuration already exists
    let existing: Vec<_> = ctx
        .db
        .form_config()
        .iter()
        .filter(|c| {
            c.organization_id == organization_id
                && c.module_id == params.module_id
                && c.form_id == params.form_id
        })
        .collect();

    if !existing.is_empty() {
        return Err(format!(
            "Form configuration already exists for {}:{}",
            params.module_id, params.form_id
        ));
    }

    let config = FormConfig {
        id: 0,
        organization_id,
        module_id: params.module_id.clone(),
        form_id: params.form_id.clone(),
        name: params.name,
        description: params.description.unwrap_or_default(),
        is_active: true,
        is_system_default: params.is_system_default,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        created_by: ctx.sender(),
        updated_by: ctx.sender(),
    };

    let inserted = ctx.db.form_config().insert(config);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "form_config",
            record_id: inserted.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: Some(format!("Created form configuration: {}", params.form_id)),
        },
    );

    log::info!(
        "Created form configuration: {}:{}",
        params.module_id,
        params.form_id
    );
    Ok(())
}

/// Add a field to a form configuration
#[spacetimedb::reducer]
pub fn add_form_field(
    ctx: &ReducerContext,
    organization_id: u64,
    configuration_id: u64,
    params: CreateFormFieldParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "form_configuration", "update")?;

    // Verify configuration exists and belongs to organization
    let config = ctx
        .db
        .form_config()
        .id()
        .find(&configuration_id)
        .ok_or("Form configuration not found")?;

    if config.organization_id != organization_id {
        return Err("Configuration does not belong to organization".to_string());
    }

    // Check if field already exists
    let existing: Vec<_> = ctx
        .db
        .form_config_field()
        .iter()
        .filter(|f| f.configuration_id == configuration_id && f.field_id == params.field_id)
        .collect();

    if !existing.is_empty() {
        return Err(format!(
            "Field '{}' already exists in configuration",
            params.field_id
        ));
    }

    let field = FormConfigField {
        id: 0,
        configuration_id,
        field_id: params.field_id.clone(),
        name: params.name,
        label: params.label,
        field_type: params.field_type,
        description: params.description.unwrap_or_default(),
        placeholder: params.placeholder.unwrap_or_default(),
        default_value: params.default_value.unwrap_or_default(),
        options_json: serde_json::to_string(&params.options).unwrap_or_default(),
        validation_json: serde_json::to_string(&params.validation).unwrap_or_default(),
        ai_suggestions_json: serde_json::to_string(&params.ai_suggestions).unwrap_or_default(),
        order: params.order,
        is_system: params.is_system,
        is_enabled: params.is_enabled,
        category: params.category.unwrap_or_default(),
        show_in_list: params.show_in_list,
        width: params.width,
        section_id: params.section_id.unwrap_or_default(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    };

    ctx.db.form_config_field().insert(field);

    // Update configuration timestamp
    ctx.db.form_config().id().update(FormConfig {
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
        ..config
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "form_config_field",
            record_id: configuration_id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: Some(format!("Added field: {}", params.field_id)),
        },
    );

    Ok(())
}

/// Update an existing form field
#[spacetimedb::reducer]
pub fn update_form_field(
    ctx: &ReducerContext,
    organization_id: u64,
    configuration_id: u64,
    field_id: String,
    params: UpdateFormFieldParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "form_configuration", "update")?;

    let field = ctx
        .db
        .form_config_field()
        .iter()
        .find(|f| f.configuration_id == configuration_id && f.field_id == field_id)
        .ok_or("Field not found")?;

    // Verify configuration belongs to organization
    let config = ctx
        .db
        .form_config()
        .id()
        .find(&configuration_id)
        .ok_or("Configuration not found")?;

    if config.organization_id != organization_id {
        return Err("Configuration does not belong to organization".to_string());
    }

    let updated = FormConfigField {
        label: params.label.unwrap_or(field.label),
        description: params.description.unwrap_or(field.description),
        placeholder: params.placeholder.unwrap_or(field.placeholder),
        default_value: params.default_value.unwrap_or(field.default_value),
        options_json: params
            .options
            .map(|o| serde_json::to_string(&o).unwrap_or_default())
            .unwrap_or(field.options_json),
        validation_json: params
            .validation
            .map(|v| serde_json::to_string(&v).unwrap_or_default())
            .unwrap_or(field.validation_json),
        ai_suggestions_json: params
            .ai_suggestions
            .map(|s| serde_json::to_string(&s).unwrap_or_default())
            .unwrap_or(field.ai_suggestions_json),
        order: params.order.unwrap_or(field.order),
        is_enabled: params.is_enabled.unwrap_or(field.is_enabled),
        show_in_list: params.show_in_list.unwrap_or(field.show_in_list),
        width: params.width.unwrap_or(field.width),
        updated_at: ctx.timestamp,
        ..field
    };

    ctx.db.form_config_field().id().update(updated);

    // Update configuration timestamp
    ctx.db.form_config().id().update(FormConfig {
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
        ..config
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "form_config_field",
            record_id: configuration_id,
            action: "update",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: Some(format!("Updated field: {}", field_id)),
        },
    );

    Ok(())
}

/// Delete a form field (only non-system fields can be deleted)
#[spacetimedb::reducer]
pub fn delete_form_field(
    ctx: &ReducerContext,
    organization_id: u64,
    configuration_id: u64,
    field_id: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "form_configuration", "delete")?;

    let field = ctx
        .db
        .form_config_field()
        .iter()
        .find(|f| f.configuration_id == configuration_id && f.field_id == field_id)
        .ok_or("Field not found")?;

    if field.is_system {
        return Err("System fields cannot be deleted".to_string());
    }

    // Verify configuration belongs to organization
    let config = ctx
        .db
        .form_config()
        .id()
        .find(&configuration_id)
        .ok_or("Configuration not found")?;

    if config.organization_id != organization_id {
        return Err("Configuration does not belong to organization".to_string());
    }

    ctx.db.form_config_field().id().delete(&field.id);

    // Update configuration timestamp
    ctx.db.form_config().id().update(FormConfig {
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
        ..config
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "form_config_field",
            record_id: configuration_id,
            action: "delete",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: Some(format!("Deleted field: {}", field_id)),
        },
    );

    Ok(())
}

/// Create or update role configuration for a form
#[spacetimedb::reducer]
pub fn set_form_role_config(
    ctx: &ReducerContext,
    organization_id: u64,
    configuration_id: u64,
    params: CreateRoleConfigParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "form_configuration", "update")?;

    // Verify configuration exists and belongs to organization
    let config = ctx
        .db
        .form_config()
        .id()
        .find(&configuration_id)
        .ok_or("Configuration not found")?;

    if config.organization_id != organization_id {
        return Err("Configuration does not belong to organization".to_string());
    }

    // Check if role config already exists
    let existing = ctx
        .db
        .form_role_config()
        .iter()
        .find(|r| r.configuration_id == configuration_id && r.role_id == params.role_id);

    if let Some(existing_config) = existing {
        // Update existing
        ctx.db.form_role_config().id().update(FormRoleConfig {
            enabled_fields_json: serde_json::to_string(&params.enabled_fields).unwrap_or_default(),
            required_fields_json: serde_json::to_string(&params.required_fields)
                .unwrap_or_default(),
            default_prompts_json: serde_json::to_string(&params.default_prompts)
                .unwrap_or_default(),
            updated_at: ctx.timestamp,
            ..existing_config
        });
    } else {
        // Create new
        let role_config = FormRoleConfig {
            id: 0,
            configuration_id,
            role_id: params.role_id.clone(),
            enabled_fields_json: serde_json::to_string(&params.enabled_fields).unwrap_or_default(),
            required_fields_json: serde_json::to_string(&params.required_fields)
                .unwrap_or_default(),
            default_prompts_json: serde_json::to_string(&params.default_prompts)
                .unwrap_or_default(),
            is_active: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        };
        ctx.db.form_role_config().insert(role_config);
    }

    // Update configuration timestamp
    ctx.db.form_config().id().update(FormConfig {
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
        ..config
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "form_role_config",
            record_id: configuration_id,
            action: "update",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: Some(format!("Set role config for: {}", params.role_id)),
        },
    );

    Ok(())
}

/// Add a user custom field
#[spacetimedb::reducer]
pub fn add_user_custom_field(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateUserCustomFieldParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "form_configuration", "create")?;

    // Verify configuration exists and belongs to organization
    let config = ctx
        .db
        .form_config()
        .id()
        .find(&params.configuration_id)
        .ok_or("Configuration not found")?;

    if config.organization_id != organization_id {
        return Err("Configuration does not belong to organization".to_string());
    }

    // Check if custom field already exists for this user
    let existing: Vec<_> = ctx
        .db
        .user_custom_field()
        .iter()
        .filter(|f| {
            f.configuration_id == params.configuration_id
                && f.user_id == ctx.sender()
                && f.field_id == params.field_id
        })
        .collect();

    if !existing.is_empty() {
        return Err(format!(
            "Custom field '{}' already exists for this user",
            params.field_id
        ));
    }

    // Validate field_id starts with custom: prefix
    if !params.field_id.starts_with("custom:") {
        return Err("Custom field IDs must start with 'custom:'".to_string());
    }

    let field_data = serde_json::json!({
        "fieldId": params.field_id,
        "name": params.name,
        "label": params.label,
        "type": params.field_type,
        "description": params.description,
        "placeholder": params.placeholder,
        "defaultValue": params.default_value,
        "options": params.options,
        "validation": params.validation,
        "order": params.order,
        "width": params.width,
    });

    let custom_field = UserCustomField {
        id: 0,
        organization_id,
        user_id: ctx.sender(),
        configuration_id: params.configuration_id,
        field_id: params.field_id.clone(),
        field_data_json: field_data.to_string(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    };

    ctx.db.user_custom_field().insert(custom_field);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "user_custom_field",
            record_id: params.configuration_id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: Some(format!("Added custom field: {}", params.field_id)),
        },
    );

    Ok(())
}

/// Delete a user custom field
#[spacetimedb::reducer]
pub fn delete_user_custom_field(
    ctx: &ReducerContext,
    organization_id: u64,
    custom_field_id: u64,
) -> Result<(), String> {
    let field = ctx
        .db
        .user_custom_field()
        .id()
        .find(&custom_field_id)
        .ok_or("Custom field not found")?;

    // Users can only delete their own custom fields
    if field.user_id != ctx.sender() {
        return Err("Can only delete your own custom fields".to_string());
    }

    if field.organization_id != organization_id {
        return Err("Field does not belong to organization".to_string());
    }

    ctx.db.user_custom_field().id().delete(&custom_field_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "user_custom_field",
            record_id: custom_field_id,
            action: "delete",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: Some(format!("Deleted custom field: {}", field.field_id)),
        },
    );

    Ok(())
}

// ═════════════════════════════════════════════════════════════════════════════
// QUERY HELPERS (for client use)
// ═════════════════════════════════════════════════════════════════════════════

/// Get form configuration by module and form ID
/// Returns the configuration with all fields
#[spacetimedb::reducer]
pub fn get_form_configuration(
    ctx: &ReducerContext,
    organization_id: u64,
    module_id: String,
    form_id: String,
) -> Result<(), String> {
    let config: Vec<_> = ctx
        .db
        .form_config()
        .iter()
        .filter(|c| {
            c.organization_id == organization_id
                && c.module_id == module_id
                && c.form_id == form_id
                && c.is_active
        })
        .collect();

    // This reducer doesn't return data - clients subscribe to tables
    // The config data will be automatically synced via table subscriptions
    if config.is_empty() {
        return Err(format!(
            "No form configuration found for {}:{}",
            module_id, form_id
        ));
    }

    log::info!("Form configuration retrieved: {}:{}", module_id, form_id);
    Ok(())
}

/// Get all form configurations for an organization
#[spacetimedb::reducer]
pub fn get_organization_form_configs(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    let _configs: Vec<_> = ctx
        .db
        .form_config()
        .iter()
        .filter(|c| c.organization_id == organization_id)
        .collect();

    // Data synced via table subscriptions
    log::info!(
        "Retrieved form configs for organization {}",
        organization_id
    );
    Ok(())
}

// ═════════════════════════════════════════════════════════════════════════════
// INITIALIZATION — Seed default configurations
// ═════════════════════════════════════════════════════════════════════════════

/// Initialize default form configurations
/// Called during module initialization or migration
#[spacetimedb::reducer]
pub fn initialize_default_form_configs(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    // Only admins can initialize defaults
    check_permission(ctx, organization_id, "form_configuration", "create")?;

    // Journal form configuration
    init_journal_form_config(ctx, organization_id)?;

    // Forensic form configuration
    init_forensic_form_config(ctx, organization_id)?;

    log::info!(
        "Default form configurations initialized for organization {}",
        organization_id
    );
    Ok(())
}

fn init_journal_form_config(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    let module_id = "journal".to_string();
    let form_id = "daily-entry".to_string();

    // Check if already exists
    let existing: Vec<_> = ctx
        .db
        .form_config()
        .iter()
        .filter(|c| {
            c.organization_id == organization_id && c.module_id == module_id && c.form_id == form_id
        })
        .collect();

    if !existing.is_empty() {
        log::info!("Journal form config already exists");
        return Ok(());
    }

    // Create configuration
    let config = FormConfig {
        id: 0,
        organization_id,
        module_id: module_id.clone(),
        form_id: form_id.clone(),
        name: "Daily Journal".to_string(),
        description: "Daily work journal for tracking progress and reflections".to_string(),
        is_active: true,
        is_system_default: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        created_by: ctx.sender(),
        updated_by: ctx.sender(),
    };

    let inserted = ctx.db.form_config().insert(config);

    // Add default fields
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
        ("tags", "Tags", FieldType::Tags, false, 8),
    ];

    for (field_id, label, field_type, is_system, order) in fields {
        let field = FormConfigField {
            id: 0,
            configuration_id: inserted.id,
            field_id: field_id.to_string(),
            name: field_id.to_string(),
            label: label.to_string(),
            field_type,
            description: String::new(),
            placeholder: String::new(),
            default_value: String::new(),
            options_json: String::new(),
            validation_json: if field_id == "mood" || field_id == "accomplishments" {
                serde_json::to_string(&FieldValidation {
                    required: true,
                    ..Default::default()
                })
                .unwrap_or_default()
            } else {
                serde_json::to_string(&FieldValidation::default()).unwrap_or_default()
            },
            ai_suggestions_json: String::new(),
            order,
            is_system,
            is_enabled: true,
            category: String::new(),
            show_in_list: false,
            width: FieldWidth::Full,
            section_id: String::new(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        };
        ctx.db.form_config_field().insert(field);
    }

    // Add mood options
    let mood_options = vec![
        FieldOption {
            value: "great".to_string(),
            label: "Great".to_string(),
            color: Some("green".to_string()),
            icon: Some("star".to_string()),
        },
        FieldOption {
            value: "good".to_string(),
            label: "Good".to_string(),
            color: Some("teal".to_string()),
            icon: Some("smile".to_string()),
        },
        FieldOption {
            value: "neutral".to_string(),
            label: "Neutral".to_string(),
            color: Some("yellow".to_string()),
            icon: Some("meh".to_string()),
        },
        FieldOption {
            value: "challenging".to_string(),
            label: "Challenging".to_string(),
            color: Some("orange".to_string()),
            icon: Some("frown".to_string()),
        },
        FieldOption {
            value: "difficult".to_string(),
            label: "Difficult".to_string(),
            color: Some("red".to_string()),
            icon: Some("cloud".to_string()),
        },
    ];

    // Update mood field with options
    if let Some(mood_field) = ctx
        .db
        .form_config_field()
        .iter()
        .find(|f| f.configuration_id == inserted.id && f.field_id == "mood")
    {
        ctx.db.form_config_field().id().update(FormConfigField {
            options_json: serde_json::to_string(&mood_options).unwrap_or_default(),
            ..mood_field
        });
    }

    log::info!("Journal form configuration initialized");
    Ok(())
}

fn init_forensic_form_config(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    let module_id = "forensic".to_string();
    let form_id = "incident-report".to_string();

    // Check if already exists
    let existing: Vec<_> = ctx
        .db
        .form_config()
        .iter()
        .filter(|c| {
            c.organization_id == organization_id && c.module_id == module_id && c.form_id == form_id
        })
        .collect();

    if !existing.is_empty() {
        log::info!("Forensic form config already exists");
        return Ok(());
    }

    // Create configuration
    let config = FormConfig {
        id: 0,
        organization_id,
        module_id: module_id.clone(),
        form_id: form_id.clone(),
        name: "Incident Report".to_string(),
        description: "Forensic incident report for tracking and analyzing issues".to_string(),
        is_active: true,
        is_system_default: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        created_by: ctx.sender(),
        updated_by: ctx.sender(),
    };

    let inserted = ctx.db.form_config().insert(config);

    // Add default fields
    let fields = vec![
        ("title", "Incident Title", FieldType::Text, true, 1),
        ("category", "Category", FieldType::Select, true, 2),
        ("severity", "Severity", FieldType::Radio, true, 3),
        (
            "incident_date",
            "Incident Date",
            FieldType::DateTime,
            true,
            4,
        ),
        ("description", "Description", FieldType::Textarea, true, 5),
        (
            "affected_area",
            "Affected Area",
            FieldType::MultiSelect,
            false,
            6,
        ),
        (
            "immediate_actions",
            "Immediate Actions Taken",
            FieldType::Textarea,
            false,
            7,
        ),
        (
            "root_cause",
            "Root Cause Analysis",
            FieldType::Textarea,
            false,
            8,
        ),
        (
            "financial_impact",
            "Estimated Financial Impact",
            FieldType::Number,
            false,
            9,
        ),
        (
            "customers_affected",
            "Customers Affected",
            FieldType::Number,
            false,
            10,
        ),
        ("assigned_to", "Assign To", FieldType::UserSelect, true, 11),
        ("department", "Department", FieldType::Select, true, 12),
        ("tags", "Tags", FieldType::Tags, false, 13),
        ("attachments", "Attachments", FieldType::File, false, 14),
    ];

    for (field_id, label, field_type, is_system, order) in fields {
        let field = FormConfigField {
            id: 0,
            configuration_id: inserted.id,
            field_id: field_id.to_string(),
            name: field_id.to_string(),
            label: label.to_string(),
            field_type,
            description: String::new(),
            placeholder: String::new(),
            default_value: String::new(),
            options_json: String::new(),
            validation_json: if field_id == "title"
                || field_id == "category"
                || field_id == "severity"
                || field_id == "description"
                || field_id == "assigned_to"
                || field_id == "department"
            {
                serde_json::to_string(&FieldValidation {
                    required: true,
                    ..Default::default()
                })
                .unwrap_or_default()
            } else {
                serde_json::to_string(&FieldValidation::default()).unwrap_or_default()
            },
            ai_suggestions_json: String::new(),
            order,
            is_system,
            is_enabled: true,
            category: String::new(),
            show_in_list: false,
            width: if field_id == "title" || field_id == "description" {
                FieldWidth::Full
            } else {
                FieldWidth::Half
            },
            section_id: String::new(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        };
        ctx.db.form_config_field().insert(field);
    }

    // Add category options
    let category_options = vec![
        FieldOption {
            value: "process-failure".to_string(),
            label: "Process Failure".to_string(),
            color: Some("orange".to_string()),
            icon: None,
        },
        FieldOption {
            value: "system-error".to_string(),
            label: "System Error".to_string(),
            color: Some("red".to_string()),
            icon: None,
        },
        FieldOption {
            value: "data-discrepancy".to_string(),
            label: "Data Discrepancy".to_string(),
            color: Some("yellow".to_string()),
            icon: None,
        },
        FieldOption {
            value: "compliance-issue".to_string(),
            label: "Compliance Issue".to_string(),
            color: Some("purple".to_string()),
            icon: None,
        },
        FieldOption {
            value: "security-incident".to_string(),
            label: "Security Incident".to_string(),
            color: Some("red".to_string()),
            icon: None,
        },
        FieldOption {
            value: "performance-issue".to_string(),
            label: "Performance Issue".to_string(),
            color: Some("blue".to_string()),
            icon: None,
        },
        FieldOption {
            value: "customer-complaint".to_string(),
            label: "Customer Complaint".to_string(),
            color: Some("amber".to_string()),
            icon: None,
        },
        FieldOption {
            value: "quality-defect".to_string(),
            label: "Quality Defect".to_string(),
            color: Some("orange".to_string()),
            icon: None,
        },
        FieldOption {
            value: "supply-chain".to_string(),
            label: "Supply Chain".to_string(),
            color: Some("teal".to_string()),
            icon: None,
        },
        FieldOption {
            value: "other".to_string(),
            label: "Other".to_string(),
            color: Some("gray".to_string()),
            icon: None,
        },
    ];

    // Update category field with options
    if let Some(category_field) = ctx
        .db
        .form_config_field()
        .iter()
        .find(|f| f.configuration_id == inserted.id && f.field_id == "category")
    {
        ctx.db.form_config_field().id().update(FormConfigField {
            options_json: serde_json::to_string(&category_options).unwrap_or_default(),
            ..category_field
        });
    }

    // Add severity options
    let severity_options = vec![
        FieldOption {
            value: "critical".to_string(),
            label: "Critical".to_string(),
            color: Some("red".to_string()),
            icon: None,
        },
        FieldOption {
            value: "high".to_string(),
            label: "High".to_string(),
            color: Some("orange".to_string()),
            icon: None,
        },
        FieldOption {
            value: "medium".to_string(),
            label: "Medium".to_string(),
            color: Some("yellow".to_string()),
            icon: None,
        },
        FieldOption {
            value: "low".to_string(),
            label: "Low".to_string(),
            color: Some("green".to_string()),
            icon: None,
        },
    ];

    if let Some(severity_field) = ctx
        .db
        .form_config_field()
        .iter()
        .find(|f| f.configuration_id == inserted.id && f.field_id == "severity")
    {
        ctx.db.form_config_field().id().update(FormConfigField {
            options_json: serde_json::to_string(&severity_options).unwrap_or_default(),
            ..severity_field
        });
    }

    log::info!("Forensic form configuration initialized");
    Ok(())
}
