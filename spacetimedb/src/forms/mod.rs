//! Form Configuration Module — Unified configurable forms across all modules
//!
//! This module provides configurable form fields for all modules in the system.
//! Forms can be customized per organization with role-based visibility and user custom fields.
//!
//! ## Architecture
//!
//! - `FormConfig`: Base configuration for a form (one per organization per form type)
//! - `FormConfigField`: Individual fields within a form configuration
//! - `FormFieldLabel`: Localized label overrides for form fields
//! - `FormRoleConfig`: Role-based field visibility and requirements
//! - `UserCustomField`: User-specific custom fields extending base forms
//!
//! ## Usage
//!
//! Forms are identified by `module_id` and `form_id` (e.g., "crm:new-lead", "accounting:new-invoice").
//! Custom fields use the `custom:` prefix convention (e.g., "custom:deals_touched").

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::core::organization::require_company_in_organization;
use crate::crm::contacts::contact;
use crate::crm::leads::lead;
use crate::expenses::expenses::{expense_sheet, hr_expense};
use crate::fleet::fleet::fleet_vehicle;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::helpdesk::tickets::helpdesk_ticket;
use crate::hr::contracts::hr_contract;
use crate::hr::employees::hr_employee;
use crate::hr::payroll::hr_payslip;
use crate::inventory::product::product;
use crate::manufacturing::manufacturing_orders::mrp_production;
use crate::projects::projects::project_project;
use crate::projects::tasks::project_task;
use crate::proposals::proposals::proposal;
use crate::purchasing::purchase_orders::{purchase_order, purchase_order_line};
use crate::sales::sales_core::{sale_order, sale_order_line};
use crate::subscriptions::tables::subscription;
use crate::types::AccountMoveState;

pub mod migrations;

/// Max custom-field entries accepted in one EAV upsert (bounds WASM work).
const MAX_CUSTOM_FIELD_ENTRIES: usize = 64;

/// FRM-001: Allowed ERP model names that can carry custom fields.
/// Any model string not in this list is rejected to prevent phantom/garbage data.
const ALLOWED_CUSTOM_FIELD_MODELS: &[&str] = &[
    "sale_order",
    "sale_order_line",
    "purchase_order",
    "purchase_order_line",
    "account_move",
    "account_move_line",
    "hr_employee",
    "hr_contract",
    "hr_expense",
    "expense_sheet",
    "contact",
    "product",
    "product_template",
    "project_project",
    "project_task",
    "helpdesk_ticket",
    "mrp_production",
    "subscription",
    "proposal",
    "hr_payslip",
    "fleet_vehicle",
    "crm_lead",
];

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
    /// Role/condition visibility rules as JSON (empty or `"{}"` when unset).
    pub visibility_json: Option<String>,
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
    /// Role/condition visibility rules as JSON.
    pub visibility_json: Option<String>,
    /// Optimistic concurrency — when set, must match `form_config_field.updated_at` micros.
    pub expected_updated_at_micros: Option<i64>,
}

/// Parameters for upserting a localized field label
#[derive(SpacetimeType, Clone, Debug)]
pub struct SetFormFieldLabelParams {
    pub locale: String,
    pub label: String,
}

/// Parameters for creating role configuration
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateRoleConfigParams {
    pub role_id: String,
    pub enabled_fields: Vec<String>,
    pub required_fields: Vec<String>,
    pub default_prompts: Vec<String>,
}

/// Single custom field value for a business record (EAV row payload).
#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordCustomFieldEntry {
    pub field_key: String,
    pub value_json: String,
}

/// Parameters for upserting record-level custom field values.
#[derive(SpacetimeType, Clone, Debug)]
pub struct SetRecordCustomFieldValuesParams {
    pub model: String,
    pub record_id: u64,
    pub entries: Vec<RecordCustomFieldEntry>,
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

/// Atomic publish of a form configuration (config + fields + roles) in one transaction.
#[derive(SpacetimeType, Clone, Debug)]
pub struct PublishFormConfigurationParams {
    pub module_id: String,
    pub form_id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_system_default: bool,
    pub fields: Vec<CreateFormFieldParams>,
    pub role_configs: Vec<CreateRoleConfigParams>,
    /// When the form already exists, must match `form_config.updated_at` micros (CAS).
    pub expected_updated_at_micros: Option<i64>,
    /// When true, delete non-system fields whose ids are not in `fields`.
    pub replace_missing_fields: bool,
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
    /// Monotonic version bumped on publish / config-row updates.
    pub config_version: u32,
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
    /// Role/condition visibility rules as JSON (empty string or `"{}"` default).
    pub visibility_json: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// Localized label override for a form config field row
#[spacetimedb::table(public, accessor = form_field_label)]
pub struct FormFieldLabel {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub field_row_id: u64, // form_config_field.id
    pub locale: String, // e.g. "en", "pt-BR"
    pub label: String,
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

/// Record-level custom field value (EAV) — `(org, company, model, record_id, field_key)`.
#[spacetimedb::table(
    public,
    accessor = record_custom_field_value,
    index(
        name = "by_org_company_record",
        accessor = record_custom_field_by_org_company_record,
        btree(columns = [organization_id, company_id, record_id])
    )
)]
pub struct RecordCustomFieldValue {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub organization_id: u64,
    #[index(btree)]
    pub company_id: u64,
    pub model: String,
    pub record_id: u64,
    pub field_key: String,
    pub value_json: String,
    pub create_uid: Option<Identity>,
    pub write_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_date: Option<Timestamp>,
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
// HELPERS — EAV validation / posted guards / def resolution
// ═════════════════════════════════════════════════════════════════════════════

fn timestamp_micros(ts: Timestamp) -> i64 {
    ts.to_micros_since_unix_epoch()
}

fn ensure_expected_updated_at(
    actual: Timestamp,
    expected_micros: Option<i64>,
    label: &str,
) -> Result<(), String> {
    let Some(expected) = expected_micros else {
        return Ok(());
    };
    let actual_micros = timestamp_micros(actual);
    if actual_micros != expected {
        return Err(format!(
            "{label} was modified concurrently (expected updated_at {expected}, got {actual_micros})"
        ));
    }
    Ok(())
}

fn parse_validation_json(raw: &str) -> FieldValidation {
    serde_json::from_str(raw).unwrap_or_default()
}

fn looks_like_email(s: &str) -> bool {
    s.contains('@') && s.contains('.')
}

fn resolve_enabled_custom_field_def(
    ctx: &ReducerContext,
    organization_id: u64,
    field_key: &str,
) -> Result<(FieldType, FieldValidation), String> {
    for field in ctx.db.form_config_field().iter() {
        if field.field_id != field_key || !field.is_enabled {
            continue;
        }
        let Some(config) = ctx.db.form_config().id().find(&field.configuration_id) else {
            continue;
        };
        if config.organization_id != organization_id || !config.is_active {
            continue;
        }
        return Ok((
            field.field_type.clone(),
            parse_validation_json(&field.validation_json),
        ));
    }

    for ucf in ctx.db.user_custom_field().iter() {
        if ucf.organization_id != organization_id
            || ucf.user_id != ctx.sender()
            || ucf.field_id != field_key
        {
            continue;
        }
        let parsed: serde_json::Value =
            serde_json::from_str(&ucf.field_data_json).unwrap_or(serde_json::Value::Null);
        let field_type = parsed
            .get("type")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or(FieldType::Text);
        let validation = parsed
            .get("validation")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        return Ok((field_type, validation));
    }

    Err(format!(
        "unknown or disabled custom field '{}': define it on the form configuration first",
        field_key
    ))
}

fn validate_custom_field_value(
    field_key: &str,
    field_type: &FieldType,
    validation: &FieldValidation,
    value_json: &str,
) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(value_json)
        .map_err(|e| format!("invalid JSON for {field_key}: {e}"))?;

    let is_empty = match &value {
        serde_json::Value::Null => true,
        serde_json::Value::String(s) => s.trim().is_empty(),
        serde_json::Value::Array(a) => a.is_empty(),
        _ => false,
    };

    if validation.required && is_empty {
        return Err(validation
            .message
            .clone()
            .unwrap_or_else(|| format!("{field_key} is required")));
    }
    if is_empty {
        return Ok(());
    }

    if let Some(s) = value.as_str() {
        let len = s.chars().count() as u32;
        if let Some(min_length) = validation.min_length {
            if len < min_length {
                return Err(format!(
                    "{field_key} must be at least {min_length} characters"
                ));
            }
        }
        if let Some(max_length) = validation.max_length {
            if len > max_length {
                return Err(format!(
                    "{field_key} must be at most {max_length} characters"
                ));
            }
        }
        // No regex crate in WASM — lightweight FieldType / pattern checks only.
        let needs_email = matches!(field_type, FieldType::Email)
            || validation.pattern.as_deref() == Some("email");
        if needs_email && !looks_like_email(s) {
            return Err(if matches!(field_type, FieldType::Email) {
                format!("{field_key} must be a valid email")
            } else {
                format!("{field_key} must match email pattern")
            });
        }
    }

    if let Some(n) = value
        .as_f64()
        .or_else(|| value.as_i64().map(|n| n as f64))
        .or_else(|| value.as_u64().map(|n| n as f64))
    {
        if let Some(min) = validation.min {
            if n < min {
                return Err(format!("{field_key} must be >= {min}"));
            }
        }
        if let Some(max) = validation.max {
            if n > max {
                return Err(format!("{field_key} must be <= {max}"));
            }
        }
    }

    Ok(())
}

/// FRM-002: `res_id` must resolve to a real, same-org (and same-company when the
/// model carries one) row before custom fields can be attached. `product_template`
/// shares the `product` table (templates are rows in that same table).
fn ensure_record_allows_custom_field_writes(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    model: &str,
    record_id: u64,
) -> Result<(), String> {
    macro_rules! require_org_and_company {
        ($table:expr, $label:expr) => {{
            let row = $table
                .id()
                .find(&record_id)
                .ok_or_else(|| format!("{} {} not found", $label, record_id))?;
            if row.organization_id != organization_id {
                return Err("Record does not belong to this organization".to_string());
            }
            if row.company_id != company_id {
                return Err("Record does not belong to this company".to_string());
            }
        }};
    }
    macro_rules! require_org_only {
        ($table:expr, $label:expr) => {{
            let row = $table
                .id()
                .find(&record_id)
                .ok_or_else(|| format!("{} {} not found", $label, record_id))?;
            if row.organization_id != organization_id {
                return Err("Record does not belong to this organization".to_string());
            }
        }};
    }

    match model {
        "account_move" => {
            let mv = ctx
                .db
                .account_move()
                .id()
                .find(&record_id)
                .ok_or_else(|| format!("account_move {record_id} not found"))?;
            if mv.organization_id != organization_id {
                return Err("Record does not belong to this organization".to_string());
            }
            if mv.company_id != company_id {
                return Err("Record does not belong to this company".to_string());
            }
            if mv.state == AccountMoveState::Posted || mv.posted_before {
                return Err(
                    "cannot change custom fields on a posted accounting document".to_string(),
                );
            }
        }
        "account_move_line" => require_org_only!(ctx.db.account_move_line(), "account_move_line"),
        "sale_order" => require_org_and_company!(ctx.db.sale_order(), "sale_order"),
        "sale_order_line" => require_org_and_company!(ctx.db.sale_order_line(), "sale_order_line"),
        "purchase_order" => require_org_and_company!(ctx.db.purchase_order(), "purchase_order"),
        "purchase_order_line" => {
            require_org_and_company!(ctx.db.purchase_order_line(), "purchase_order_line")
        }
        "hr_employee" => require_org_and_company!(ctx.db.hr_employee(), "hr_employee"),
        "hr_contract" => require_org_and_company!(ctx.db.hr_contract(), "hr_contract"),
        "hr_expense" => require_org_and_company!(ctx.db.hr_expense(), "hr_expense"),
        "expense_sheet" => require_org_and_company!(ctx.db.expense_sheet(), "expense_sheet"),
        "contact" => require_org_only!(ctx.db.contact(), "contact"),
        "product" | "product_template" => require_org_only!(ctx.db.product(), "product"),
        "project_project" => require_org_and_company!(ctx.db.project_project(), "project_project"),
        "project_task" => require_org_and_company!(ctx.db.project_task(), "project_task"),
        "helpdesk_ticket" => require_org_only!(ctx.db.helpdesk_ticket(), "helpdesk_ticket"),
        "mrp_production" => require_org_and_company!(ctx.db.mrp_production(), "mrp_production"),
        "subscription" => require_org_and_company!(ctx.db.subscription(), "subscription"),
        "proposal" => require_org_and_company!(ctx.db.proposal(), "proposal"),
        "hr_payslip" => require_org_and_company!(ctx.db.hr_payslip(), "hr_payslip"),
        "fleet_vehicle" => require_org_and_company!(ctx.db.fleet_vehicle(), "fleet_vehicle"),
        "crm_lead" => require_org_only!(ctx.db.lead(), "crm_lead"),
        _ => {}
    }
    Ok(())
}

fn form_field_json_payload(params: &CreateFormFieldParams) -> (String, String, String) {
    (
        serde_json::to_string(&params.options).unwrap_or_default(),
        serde_json::to_string(&params.validation).unwrap_or_default(),
        serde_json::to_string(&params.ai_suggestions).unwrap_or_default(),
    )
}

fn insert_or_update_form_field_row(
    ctx: &ReducerContext,
    configuration_id: u64,
    params: &CreateFormFieldParams,
) -> Result<(), String> {
    let existing = ctx
        .db
        .form_config_field()
        .iter()
        .find(|f| f.configuration_id == configuration_id && f.field_id == params.field_id);

    let (options_json, validation_json, ai_suggestions_json) = form_field_json_payload(params);
    let description = params.description.clone().unwrap_or_default();
    let placeholder = params.placeholder.clone().unwrap_or_default();
    let default_value = params.default_value.clone().unwrap_or_default();
    let category = params.category.clone().unwrap_or_default();
    let section_id = params.section_id.clone().unwrap_or_default();

    match existing {
        Some(field) => {
            let visibility_json = params
                .visibility_json
                .clone()
                .unwrap_or_else(|| field.visibility_json.clone());
            ctx.db.form_config_field().id().update(FormConfigField {
                name: params.name.clone(),
                label: params.label.clone(),
                field_type: params.field_type.clone(),
                description,
                placeholder,
                default_value,
                options_json,
                validation_json,
                ai_suggestions_json,
                order: params.order,
                is_system: params.is_system,
                is_enabled: params.is_enabled,
                category,
                show_in_list: params.show_in_list,
                width: params.width.clone(),
                section_id,
                visibility_json,
                updated_at: ctx.timestamp,
                ..field
            });
        }
        None => {
            ctx.db.form_config_field().insert(FormConfigField {
                id: 0,
                configuration_id,
                field_id: params.field_id.clone(),
                name: params.name.clone(),
                label: params.label.clone(),
                field_type: params.field_type.clone(),
                description,
                placeholder,
                default_value,
                options_json,
                validation_json,
                ai_suggestions_json,
                order: params.order,
                is_system: params.is_system,
                is_enabled: params.is_enabled,
                category,
                show_in_list: params.show_in_list,
                width: params.width.clone(),
                section_id,
                visibility_json: params.visibility_json.clone().unwrap_or_default(),
                created_at: ctx.timestamp,
                updated_at: ctx.timestamp,
            });
        }
    }
    Ok(())
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
        config_version: 1,
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
        visibility_json: params.visibility_json.unwrap_or_default(),
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

    ensure_expected_updated_at(
        field.updated_at,
        params.expected_updated_at_micros,
        "form field",
    )?;

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
        visibility_json: params.visibility_json.unwrap_or(field.visibility_json),
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

    let label_ids: Vec<_> = ctx
        .db
        .form_field_label()
        .iter()
        .filter(|l| l.field_row_id == field.id)
        .map(|l| l.id)
        .collect();
    for label_id in label_ids {
        ctx.db.form_field_label().id().delete(&label_id);
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

    let config = ctx
        .db
        .form_config()
        .id()
        .find(&configuration_id)
        .ok_or("Configuration not found")?;

    if config.organization_id != organization_id {
        return Err("Configuration does not belong to organization".to_string());
    }

    upsert_form_role_config_row(ctx, configuration_id, &params);

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

/// Upsert a localized label for a form config field row
#[spacetimedb::reducer]
pub fn set_form_field_label(
    ctx: &ReducerContext,
    organization_id: u64,
    field_row_id: u64,
    params: SetFormFieldLabelParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "form_configuration", "update")?;

    if params.locale.trim().is_empty() {
        return Err("locale is required".to_string());
    }

    let field = ctx
        .db
        .form_config_field()
        .id()
        .find(&field_row_id)
        .ok_or("Field not found")?;

    let config = ctx
        .db
        .form_config()
        .id()
        .find(&field.configuration_id)
        .ok_or("Configuration not found")?;

    if config.organization_id != organization_id {
        return Err("Field does not belong to organization".to_string());
    }

    let existing = ctx
        .db
        .form_field_label()
        .iter()
        .find(|l| l.field_row_id == field_row_id && l.locale == params.locale);

    let record_id = if let Some(row) = existing {
        let id = row.id;
        ctx.db.form_field_label().id().update(FormFieldLabel {
            label: params.label.clone(),
            updated_at: ctx.timestamp,
            ..row
        });
        id
    } else {
        ctx.db
            .form_field_label()
            .insert(FormFieldLabel {
                id: 0,
                field_row_id,
                locale: params.locale.clone(),
                label: params.label.clone(),
                updated_at: ctx.timestamp,
            })
            .id
    };

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "form_field_label",
            record_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "field_row_id": field_row_id,
                    "locale": params.locale,
                    "label": params.label,
                })
                .to_string(),
            ),
            changed_fields: vec!["label".to_string()],
            metadata: None,
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

/// Upsert custom field values on a business record (keys must start with `custom:`).
/// Validates against enabled field definitions; blocks writes on posted `account_move` rows.
#[spacetimedb::reducer]
pub fn set_record_custom_field_values(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SetRecordCustomFieldValuesParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, &params.model, "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    if params.model.trim().is_empty() {
        return Err("model is required".to_string());
    }
    // FRM-001: reject models not in the allowed ERP model set
    if !ALLOWED_CUSTOM_FIELD_MODELS.contains(&params.model.as_str()) {
        return Err(format!(
            "model '{}' is not in the allowed ERP model set for custom fields",
            params.model
        ));
    }
    if params.record_id == 0 {
        return Err("record_id is required".to_string());
    }
    if params.entries.len() > MAX_CUSTOM_FIELD_ENTRIES {
        return Err(format!(
            "too many custom field entries (max {MAX_CUSTOM_FIELD_ENTRIES})"
        ));
    }

    ensure_record_allows_custom_field_writes(
        ctx,
        organization_id,
        company_id,
        &params.model,
        params.record_id,
    )?;

    for entry in &params.entries {
        if !entry.field_key.starts_with("custom:") {
            return Err(format!(
                "field_key must start with 'custom:': {}",
                entry.field_key
            ));
        }
        let (field_type, validation) =
            resolve_enabled_custom_field_def(ctx, organization_id, &entry.field_key)?;
        validate_custom_field_value(
            &entry.field_key,
            &field_type,
            &validation,
            &entry.value_json,
        )?;
    }

    let existing_for_record: Vec<_> = ctx
        .db
        .record_custom_field_value()
        .iter()
        .filter(|r| {
            r.organization_id == organization_id
                && r.company_id == company_id
                && r.model == params.model
                && r.record_id == params.record_id
        })
        .collect();

    let changed_keys: Vec<String> = params.entries.iter().map(|e| e.field_key.clone()).collect();
    let model = params.model.clone();
    let record_id = params.record_id;
    let mut last_id = 0u64;
    let mut old_snapshot = serde_json::Map::new();
    let mut new_snapshot = serde_json::Map::new();

    for entry in &params.entries {
        new_snapshot.insert(
            entry.field_key.clone(),
            serde_json::Value::String(entry.value_json.clone()),
        );

        if let Some(existing_row) = existing_for_record
            .iter()
            .find(|r| r.field_key == entry.field_key)
        {
            old_snapshot.insert(
                entry.field_key.clone(),
                serde_json::Value::String(existing_row.value_json.clone()),
            );
            last_id = existing_row.id;
            let row = ctx
                .db
                .record_custom_field_value()
                .id()
                .find(&existing_row.id)
                .ok_or_else(|| {
                    format!(
                        "record_custom_field_value {} vanished during update",
                        existing_row.id
                    )
                })?;
            ctx.db
                .record_custom_field_value()
                .id()
                .update(RecordCustomFieldValue {
                    value_json: entry.value_json.clone(),
                    write_uid: Some(ctx.sender()),
                    write_date: Some(ctx.timestamp),
                    ..row
                });
        } else {
            let inserted = ctx
                .db
                .record_custom_field_value()
                .insert(RecordCustomFieldValue {
                    id: 0,
                    organization_id,
                    company_id,
                    model: model.clone(),
                    record_id,
                    field_key: entry.field_key.clone(),
                    value_json: entry.value_json.clone(),
                    create_uid: Some(ctx.sender()),
                    write_uid: Some(ctx.sender()),
                    create_date: Some(ctx.timestamp),
                    write_date: Some(ctx.timestamp),
                });
            last_id = inserted.id;
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "record_custom_field_value",
            record_id: last_id,
            action: "UPDATE",
            old_values: Some(serde_json::Value::Object(old_snapshot).to_string()),
            new_values: Some(
                serde_json::json!({
                    "model": model,
                    "record_id": record_id,
                    "values": serde_json::Value::Object(new_snapshot),
                })
                .to_string(),
            ),
            changed_fields: changed_keys,
            metadata: None,
        },
    );

    Ok(())
}

/// Delete all custom field values for a business record.
#[spacetimedb::reducer]
pub fn delete_record_custom_field_values(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    model: String,
    record_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, &model, "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    // FRM-001: reject models not in the allowed ERP model set
    if !ALLOWED_CUSTOM_FIELD_MODELS.contains(&model.as_str()) {
        return Err(format!(
            "model '{}' is not in the allowed ERP model set for custom fields",
            model
        ));
    }
    ensure_record_allows_custom_field_writes(ctx, organization_id, company_id, &model, record_id)?;

    let rows: Vec<_> = ctx
        .db
        .record_custom_field_value()
        .iter()
        .filter(|r| {
            r.organization_id == organization_id
                && r.company_id == company_id
                && r.model == model
                && r.record_id == record_id
        })
        .collect();

    for row in &rows {
        ctx.db.record_custom_field_value().id().delete(&row.id);
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "record_custom_field_value",
            record_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "model": model,
                    "cleared_count": rows.len(),
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec![],
            metadata: Some(format!("Cleared custom fields for {}:{}", model, record_id)),
        },
    );

    Ok(())
}

fn upsert_form_role_config_row(
    ctx: &ReducerContext,
    configuration_id: u64,
    params: &CreateRoleConfigParams,
) {
    let enabled_fields_json = serde_json::to_string(&params.enabled_fields).unwrap_or_default();
    let required_fields_json = serde_json::to_string(&params.required_fields).unwrap_or_default();
    let default_prompts_json = serde_json::to_string(&params.default_prompts).unwrap_or_default();

    let existing = ctx
        .db
        .form_role_config()
        .iter()
        .find(|r| r.configuration_id == configuration_id && r.role_id == params.role_id);

    if let Some(existing_config) = existing {
        ctx.db.form_role_config().id().update(FormRoleConfig {
            enabled_fields_json,
            required_fields_json,
            default_prompts_json,
            updated_at: ctx.timestamp,
            ..existing_config
        });
    } else {
        ctx.db.form_role_config().insert(FormRoleConfig {
            id: 0,
            configuration_id,
            role_id: params.role_id.clone(),
            enabled_fields_json,
            required_fields_json,
            default_prompts_json,
            is_active: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        });
    }
}

/// Publish a full form configuration (identity + fields + roles) in one transaction.
#[spacetimedb::reducer]
pub fn publish_form_configuration(
    ctx: &ReducerContext,
    organization_id: u64,
    params: PublishFormConfigurationParams,
) -> Result<(), String> {
    if params.module_id.trim().is_empty() || params.form_id.trim().is_empty() {
        return Err("module_id and form_id are required".to_string());
    }
    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }

    let existing = ctx.db.form_config().iter().find(|c| {
        c.organization_id == organization_id
            && c.module_id == params.module_id
            && c.form_id == params.form_id
    });

    let permission_action = if existing.is_some() {
        "update"
    } else {
        "create"
    };
    check_permission(
        ctx,
        organization_id,
        "form_configuration",
        permission_action,
    )?;

    let configuration_id = match existing {
        Some(config) => {
            ensure_expected_updated_at(
                config.updated_at,
                params.expected_updated_at_micros,
                "form configuration",
            )?;
            let id = config.id;
            ctx.db.form_config().id().update(FormConfig {
                name: params.name.clone(),
                description: params.description.clone().unwrap_or_default(),
                is_system_default: params.is_system_default,
                is_active: true,
                config_version: config.config_version.saturating_add(1),
                updated_at: ctx.timestamp,
                updated_by: ctx.sender(),
                ..config
            });
            id
        }
        None => {
            if params.expected_updated_at_micros.is_some() {
                return Err(
                    "form configuration does not exist yet; omit expected_updated_at_micros"
                        .to_string(),
                );
            }
            ctx.db
                .form_config()
                .insert(FormConfig {
                    id: 0,
                    organization_id,
                    module_id: params.module_id.clone(),
                    form_id: params.form_id.clone(),
                    name: params.name.clone(),
                    description: params.description.clone().unwrap_or_default(),
                    is_active: true,
                    is_system_default: params.is_system_default,
                    config_version: 1,
                    created_at: ctx.timestamp,
                    updated_at: ctx.timestamp,
                    created_by: ctx.sender(),
                    updated_by: ctx.sender(),
                })
                .id
        }
    };

    let published_ids: std::collections::HashSet<&str> =
        params.fields.iter().map(|f| f.field_id.as_str()).collect();

    for field in &params.fields {
        insert_or_update_form_field_row(ctx, configuration_id, field)?;
    }

    if params.replace_missing_fields {
        let to_delete: Vec<_> = ctx
            .db
            .form_config_field()
            .iter()
            .filter(|f| {
                f.configuration_id == configuration_id
                    && !f.is_system
                    && !published_ids.contains(f.field_id.as_str())
            })
            .map(|f| f.id)
            .collect();
        for id in to_delete {
            let label_ids: Vec<_> = ctx
                .db
                .form_field_label()
                .iter()
                .filter(|l| l.field_row_id == id)
                .map(|l| l.id)
                .collect();
            for label_id in label_ids {
                ctx.db.form_field_label().id().delete(&label_id);
            }
            ctx.db.form_config_field().id().delete(&id);
        }
    }

    for role in &params.role_configs {
        upsert_form_role_config_row(ctx, configuration_id, role);
    }

    if let Some(config) = ctx.db.form_config().id().find(&configuration_id) {
        ctx.db.form_config().id().update(FormConfig {
            updated_at: ctx.timestamp,
            updated_by: ctx.sender(),
            ..config
        });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "form_config",
            record_id: configuration_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "module_id": params.module_id,
                    "form_id": params.form_id,
                    "field_count": params.fields.len(),
                    "role_count": params.role_configs.len(),
                })
                .to_string(),
            ),
            changed_fields: vec![
                "fields".to_string(),
                "role_configs".to_string(),
                "name".to_string(),
            ],
            metadata: Some("publish_form_configuration".to_string()),
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
    let config_count = ctx
        .db
        .form_config()
        .iter()
        .filter(|c| c.organization_id == organization_id)
        .count();

    // Data synced via table subscriptions
    log::info!(
        "Retrieved {} form configs for organization {}",
        config_count,
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
        config_version: 1,
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
            visibility_json: String::new(),
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
        config_version: 1,
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
            visibility_json: String::new(),
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
