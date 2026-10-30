//! Atomic, actor-scoped creation of configurable business records.
//!
//! The reserved metadata envelope is a transport protocol, not a trusted claim:
//! the reducer derives its actor, company and complete-input fingerprint itself.

use sha2::{Digest, Sha256};
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use super::{
    form_config, form_config_field, form_role_config, record_custom_field_value, user_custom_field,
    validate_custom_field_value, FieldType, FieldValidation, RecordCustomFieldEntry,
    RecordCustomFieldValue, MAX_CUSTOM_FIELD_ENTRIES,
};
use crate::helpers::{write_audit_log_v2, AuditLogParams};

const ENVELOPE: &str = "__lumiere_create_v1";

#[derive(serde::Deserialize)]
struct CreationOption {
    value: String,
    #[serde(default)]
    disabled: bool,
}

fn effective_validation(raw: &str, required_by_role: bool) -> Result<FieldValidation, String> {
    let mut validation: FieldValidation =
        serde_json::from_str(raw).map_err(|_| "invalid custom-field validation")?;
    validation.required |= required_by_role;
    Ok(validation)
}

/// Immutable recovery evidence. Never expose this table as an organization feed.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = record_creation_receipt,
    index(accessor = record_creation_receipt_by_organization, btree(columns = [organization_id]))
)]
pub struct RecordCreationReceipt {
    #[primary_key]
    pub id: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub model: String,
    pub operation_key: String,
    pub payload_hash: String,
    pub record_id: u64,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

pub(crate) struct CreationIntent {
    id: String,
    operation_key: String,
    payload_hash: String,
    entries: Vec<RecordCustomFieldEntry>,
}

fn envelope(
    metadata: Option<&str>,
) -> Result<(Option<(String, u64)>, Vec<RecordCustomFieldEntry>), String> {
    let Some(raw) = metadata.filter(|raw| !raw.trim().is_empty()) else {
        return Ok((None, Vec::new()));
    };
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|_| "creation metadata must be valid JSON".to_string())?;
    let object = value
        .as_object()
        .ok_or("creation metadata must be an object")?;
    let entries: Vec<_> = object
        .iter()
        .filter(|(key, _)| key.starts_with("custom:"))
        .map(|(key, value)| RecordCustomFieldEntry {
            field_key: key.clone(),
            value_json: value.to_string(),
        })
        .collect();
    if entries.len() > MAX_CUSTOM_FIELD_ENTRIES {
        return Err(format!(
            "too many custom field entries (max {MAX_CUSTOM_FIELD_ENTRIES})"
        ));
    }
    let request = object
        .get(ENVELOPE)
        .map(|value| {
            let request = value.as_object().ok_or("invalid creation envelope")?;
            if request.len() != 2 {
                return Err("invalid creation envelope".to_string());
            }
            let key = request
                .get("operation_key")
                .and_then(|value| value.as_str())
                .ok_or("creation operation key is required")?;
            if key.is_empty()
                || key.len() > 128
                || !key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            {
                return Err("invalid creation operation key".to_string());
            }
            // JSON-safe, exact u64 transport; no floating-point company identifiers.
            let raw_company = request
                .get("company_id")
                .and_then(|value| value.as_str())
                .ok_or("creation company must be an exact string identifier")?;
            let company = raw_company
                .parse::<u64>()
                .map_err(|_| "invalid creation company")?;
            if company == 0 || company.to_string() != raw_company {
                return Err("invalid creation company".to_string());
            }
            Ok((key.to_string(), company))
        })
        .transpose()?;
    if !entries.is_empty() && request.is_none() {
        return Err("custom-field creation requires a durable creation operation key".to_string());
    }
    Ok((request, entries))
}

fn form(model: &str) -> Result<(&'static str, &'static str), String> {
    match model {
        "crm_lead" => Ok(("crm", "new-lead")),
        "opportunity" => Ok(("crm", "new-opportunity")),
        "contact" => Ok(("crm", "new-contact")),
        "sale_order" => Ok(("sales", "new-sale-order")),
        "purchase_order" => Ok(("purchasing", "new-purchase-order")),
        _ => Err("unsupported configurable creation model".to_string()),
    }
}

fn validate_type(
    key: &str,
    field_type: &FieldType,
    value: &serde_json::Value,
    options: &[CreationOption],
) -> Result<(), String> {
    if value.is_null() {
        return Ok(());
    }
    let valid = match field_type {
        FieldType::Number | FieldType::Rating | FieldType::Slider => {
            value.as_f64().is_some_and(f64::is_finite)
        }
        FieldType::Checkbox | FieldType::Switch => value.is_boolean(),
        FieldType::MultiSelect | FieldType::Tags => value
            .as_array()
            .is_some_and(|values| values.iter().all(|value| value.is_string())),
        FieldType::File | FieldType::Custom | FieldType::Password | FieldType::Hidden => false,
        _ => value.is_string(),
    };
    if !valid {
        return Err(format!("{key} has an unsupported or invalid value type"));
    }
    if matches!(
        field_type,
        FieldType::Select | FieldType::Radio | FieldType::MultiSelect | FieldType::UserSelect
    ) {
        let selected: Vec<_> = if let Some(values) = value.as_array() {
            values.iter().filter_map(|value| value.as_str()).collect()
        } else {
            value
                .as_str()
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect()
        };
        if selected.iter().any(|selected| {
            !options
                .iter()
                .any(|option| option.value == *selected && !option.disabled)
        }) {
            return Err(format!("{key} contains an unavailable option"));
        }
    }
    Ok(())
}

fn validate_entries(
    ctx: &ReducerContext,
    organization_id: u64,
    model: &str,
    entries: &[RecordCustomFieldEntry],
) -> Result<(), String> {
    let (module_id, form_id) = form(model)?;
    validate_entries_for_form(ctx, organization_id, module_id, form_id, entries)
}

fn validate_entries_for_form(
    ctx: &ReducerContext,
    organization_id: u64,
    module_id: &str,
    form_id: &str,
    entries: &[RecordCustomFieldEntry],
) -> Result<(), String> {
    let configurations: Vec<_> = ctx
        .db
        .form_config()
        .form_config_by_organization()
        .filter(&organization_id)
        .filter(|config| {
            config.is_active && config.module_id == module_id && config.form_id == form_id
        })
        .collect();
    if configurations.is_empty() && entries.is_empty() {
        return Ok(());
    }
    if configurations.len() != 1 {
        return Err(
            "custom-field creation requires one active configuration for this form".to_string(),
        );
    }
    let config_id = configurations[0].id;
    let role_ids: std::collections::HashSet<_> =
        crate::core::permissions::effective_roles(ctx, organization_id, ctx.sender())?
            .iter()
            .map(|role| role.id.to_string())
            .collect();
    let policies: Vec<_> = ctx
        .db
        .form_role_config()
        .form_role_config_by_organization()
        .filter(&organization_id)
        .filter(|policy| {
            policy.configuration_id == config_id
                && policy.is_active
                && role_ids.contains(&policy.role_id)
        })
        .collect();
    let role_required: Vec<Vec<String>> = policies
        .iter()
        .map(|policy| {
            serde_json::from_str(&policy.required_fields_json)
                .map_err(|_| "invalid required-field role policy".to_string())
        })
        .collect::<Result<_, _>>()?;
    for field in ctx.db.form_config_field().iter().filter(|field| {
        field.configuration_id == config_id
            && field.is_enabled
            && field.field_id.starts_with("custom:")
    }) {
        let required_by_role = role_required
            .iter()
            .any(|keys| keys.contains(&field.field_id));
        let validation = effective_validation(&field.validation_json, required_by_role)?;
        let has_conditions =
            !field.visibility_json.trim().is_empty() && field.visibility_json.trim() != "{}";
        if validation.required && has_conditions {
            return Err(format!(
                "{} is required but its creation visibility cannot yet be verified",
                field.field_id
            ));
        }
        if validation.required
            && !entries
                .iter()
                .any(|entry| entry.field_key == field.field_id)
        {
            return Err(format!(
                "{} is required by this creation form",
                field.field_id
            ));
        }
    }
    for entry in entries {
        let definitions: Vec<_> = ctx
            .db
            .form_config_field()
            .iter()
            .filter(|field| {
                field.configuration_id == config_id
                    && field.field_id == entry.field_key
                    && field.is_enabled
            })
            .collect();
        let personal: Vec<_> = ctx
            .db
            .user_custom_field()
            .iter()
            .filter(|field| {
                field.configuration_id == config_id
                    && field.organization_id == organization_id
                    && field.user_id == ctx.sender()
                    && field.field_id == entry.field_key
            })
            .collect();
        if definitions.len() + personal.len() != 1 {
            return Err(format!(
                "{} is unavailable or ambiguous for this form",
                entry.field_key
            ));
        }
        let (field_type, validation, options) = if let Some(field) = definitions.first() {
            for policy in &policies {
                let enabled: Vec<String> = serde_json::from_str(&policy.enabled_fields_json)
                    .map_err(|_| "invalid form role policy")?;
                if !enabled.contains(&entry.field_key) {
                    return Err(format!(
                        "{} is not enabled for the current role",
                        entry.field_key
                    ));
                }
            }
            if !field.visibility_json.trim().is_empty() && field.visibility_json.trim() != "{}" {
                return Err(format!(
                    "{} has conditional visibility that cannot yet be verified during creation",
                    entry.field_key
                ));
            }
            (
                field.field_type.clone(),
                effective_validation(
                    &field.validation_json,
                    role_required
                        .iter()
                        .any(|keys| keys.contains(&field.field_id)),
                )?,
                serde_json::from_str::<Vec<CreationOption>>(&field.options_json)
                    .map_err(|_| "invalid custom-field options")?,
            )
        } else {
            let data: serde_json::Value = serde_json::from_str(&personal[0].field_data_json)
                .map_err(|_| "invalid personal custom-field definition")?;
            let field_type: FieldType = serde_json::from_value(
                data.get("type")
                    .cloned()
                    .ok_or("missing custom-field type")?,
            )
            .map_err(|_| "invalid custom-field type")?;
            let validation: FieldValidation = serde_json::from_value(data.get("validation").cloned().unwrap_or_else(|| serde_json::json!({"required":false,"min_length":null,"max_length":null,"min":null,"max":null,"pattern":null,"message":null}))).map_err(|_| "invalid custom-field validation")?;
            let options: Vec<CreationOption> = serde_json::from_value(
                data.get("options")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([])),
            )
            .map_err(|_| "invalid custom-field options")?;
            (field_type, validation, options)
        };
        if validation
            .pattern
            .as_deref()
            .is_some_and(|pattern| !pattern.is_empty() && pattern != "email")
        {
            return Err(format!(
                "{} has a validation pattern that cannot yet be verified during creation",
                entry.field_key
            ));
        }
        let value =
            serde_json::from_str(&entry.value_json).map_err(|_| "invalid custom-field JSON")?;
        validate_type(&entry.field_key, &field_type, &value, &options)?;
        validate_custom_field_value(
            &entry.field_key,
            &field_type,
            &validation,
            &entry.value_json,
        )?;
    }
    Ok(())
}

/// Check authorization and immutable replay evidence before any business writes.
pub(crate) fn prepare_creation<T: spacetimedb_sats::ser::Serialize>(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    model: &str,
    metadata: Option<&str>,
    params: &T,
) -> Result<(Option<CreationIntent>, Option<u64>), String> {
    let (request, entries) = envelope(metadata)?;
    let Some((operation_key, requested_company)) = request else {
        validate_entries(ctx, organization_id, model, &entries)?;
        return Ok((None, None));
    };
    form(model)?;
    if requested_company != company_id {
        return Err("creation company does not match authoritative scope".to_string());
    }
    crate::workflow::authorization::require_workflow_company_access(
        ctx,
        organization_id,
        company_id,
        ctx.sender(),
    )?;
    let payload = serde_json::to_vec(spacetimedb_sats::serde::SerdeWrapper::from_ref(params))
        .map_err(|_| "creation input cannot be fingerprinted")?;
    let payload_hash = format!("sha256:{:x}", Sha256::digest(payload));
    let id = format!("{organization_id}:{company_id}:{model}:{operation_key}");
    if let Some(receipt) = ctx.db.record_creation_receipt().id().find(&id) {
        if receipt.organization_id != organization_id
            || receipt.company_id != company_id
            || receipt.model != model
            || receipt.created_by != ctx.sender()
            || receipt.payload_hash != payload_hash
        {
            return Err(
                "creation key was already used by another actor or with different input"
                    .to_string(),
            );
        }
        super::ensure_record_allows_custom_field_writes(
            ctx,
            organization_id,
            company_id,
            model,
            receipt.record_id,
        )?;
        return Ok((None, Some(receipt.record_id)));
    }
    validate_entries(ctx, organization_id, model, &entries)?;
    Ok((
        Some(CreationIntent {
            id,
            operation_key,
            payload_hash,
            entries,
        }),
        None,
    ))
}

/// The inserted business record, EAV rows and exact recovery receipt share the reducer transaction.
pub(crate) fn finish_creation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    model: &str,
    record_id: u64,
    intent: Option<CreationIntent>,
) -> Result<(), String> {
    let Some(intent) = intent else {
        return Ok(());
    };
    persist_new_record_fields(
        ctx,
        organization_id,
        company_id,
        model,
        record_id,
        &intent.entries,
    );
    ctx.db
        .record_creation_receipt()
        .insert(RecordCreationReceipt {
            id: intent.id,
            organization_id,
            company_id,
            model: model.to_string(),
            operation_key: intent.operation_key,
            payload_hash: intent.payload_hash,
            record_id,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
    Ok(())
}

/// Owners with an existing immutable idempotency receipt (Accounting) reuse the
/// field validation/persistence without introducing a second retry protocol.
pub(crate) fn prepare_owned_custom_fields(
    ctx: &ReducerContext,
    organization_id: u64,
    module_id: &str,
    form_id: &str,
    metadata: Option<&str>,
) -> Result<Vec<RecordCustomFieldEntry>, String> {
    let raw = metadata
        .filter(|raw| !raw.trim().is_empty())
        .unwrap_or("{}");
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "creation metadata must be valid JSON")?;
    let object = value
        .as_object()
        .ok_or("creation metadata must be an object")?;
    if object.contains_key(ENVELOPE) {
        return Err("existing creation owner does not accept a second retry envelope".into());
    }
    let entries: Vec<_> = object
        .iter()
        .filter(|(key, _)| key.starts_with("custom:"))
        .map(|(key, value)| RecordCustomFieldEntry {
            field_key: key.clone(),
            value_json: value.to_string(),
        })
        .collect();
    if entries.len() > MAX_CUSTOM_FIELD_ENTRIES {
        return Err("too many custom field entries".into());
    }
    validate_entries_for_form(ctx, organization_id, module_id, form_id, &entries)?;
    Ok(entries)
}

pub(crate) fn persist_new_record_fields(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    model: &str,
    record_id: u64,
    entries: &[RecordCustomFieldEntry],
) {
    for entry in entries {
        ctx.db
            .record_custom_field_value()
            .insert(RecordCustomFieldValue {
                id: 0,
                organization_id,
                company_id,
                model: model.to_string(),
                record_id,
                field_key: entry.field_key.clone(),
                value_json: entry.value_json.clone(),
                create_uid: Some(ctx.sender()),
                write_uid: Some(ctx.sender()),
                create_date: Some(ctx.timestamp),
                write_date: Some(ctx.timestamp),
            });
    }
    if !entries.is_empty() {
        write_audit_log_v2(ctx, organization_id, AuditLogParams {
            company_id: Some(company_id), table_name: "record_custom_field_value", record_id,
            action: "CREATE", old_values: None,
            new_values: Some(serde_json::json!({ "model": model, "record_id": record_id, "values": entries.iter().map(|entry| (&entry.field_key, &entry.value_json)).collect::<std::collections::BTreeMap<_, _>>() }).to_string()),
            changed_fields: entries.iter().map(|entry| entry.field_key.clone()).collect(), metadata: None,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_creation_requires_exact_durable_envelope() {
        assert!(envelope(Some(r#"{"custom:risk":false}"#)).is_err());
        let (request, entries) = envelope(Some(r#"{"custom:risk":false,"custom:score":0,"__lumiere_create_v1":{"operation_key":"attempt-1","company_id":"9007199254740993"}}"#)).expect("valid envelope");
        assert_eq!(request, Some(("attempt-1".into(), 9007199254740993)));
        assert_eq!(entries[0].value_json, "false");
        assert_eq!(entries[1].value_json, "0");
    }

    #[test]
    fn malformed_or_lossy_scope_is_never_a_create() {
        for raw in [
            "[]",
            "bad",
            r#"{"__lumiere_create_v1":{"operation_key":"x' OR 1=1","company_id":"1"}}"#,
            r#"{"__lumiere_create_v1":{"operation_key":"x","company_id":1}}"#,
            r#"{"__lumiere_create_v1":{"operation_key":"x","company_id":"01"}}"#,
        ] {
            assert!(envelope(Some(raw)).is_err(), "{raw}");
        }
    }

    #[test]
    fn custom_types_and_option_membership_are_checked_before_writes() {
        assert!(
            validate_type("custom:x", &FieldType::Number, &serde_json::json!("5"), &[]).is_err()
        );
        assert!(validate_type(
            "custom:x",
            &FieldType::Checkbox,
            &serde_json::json!(false),
            &[]
        )
        .is_ok());
        assert!(validate_type(
            "custom:x",
            &FieldType::Select,
            &serde_json::json!("missing"),
            &[]
        )
        .is_err());
        assert!(validate_type(
            "custom:x",
            &FieldType::File,
            &serde_json::json!("file-id"),
            &[]
        )
        .is_err());
    }

    #[test]
    fn effective_role_required_fields_reject_null_and_empty_values() {
        let validation = effective_validation(r#"{"required":false,"min_length":null,"max_length":null,"min":null,"max":null,"pattern":null,"message":null}"#, true).expect("valid rule");
        for value in ["null", r#""""#, r#""  ""#] {
            assert!(validate_custom_field_value(
                "custom:required",
                &FieldType::Text,
                &validation,
                value
            )
            .is_err());
        }
        assert!(effective_validation("invalid", false).is_err());
    }

    #[test]
    fn disabled_options_are_never_accepted_by_direct_create_calls() {
        let options = vec![
            CreationOption {
                value: "blocked".into(),
                disabled: true,
            },
            CreationOption {
                value: "allowed".into(),
                disabled: false,
            },
        ];
        assert!(validate_type(
            "custom:choice",
            &FieldType::Select,
            &serde_json::json!("blocked"),
            &options
        )
        .is_err());
        assert!(validate_type(
            "custom:choice",
            &FieldType::Select,
            &serde_json::json!("allowed"),
            &options
        )
        .is_ok());
    }
}
