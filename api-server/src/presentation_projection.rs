//! Generated-schema-backed, bounded display projection for presentation preview.

use std::sync::OnceLock;

use chrono::{DateTime, SecondsFormat, Utc};
use lumiere_presentation_core::{PreviewField, PreviewRow};
use serde_json::Value;
use stdb_client::sql_column_json_key;

use crate::error::ApiError;

const DISPLAY_LIMIT: usize = 4096;

#[derive(Clone, Debug)]
struct ColumnDescriptor {
    sql_name: String,
    json_key: String,
    nullable: bool,
    kind: ColumnKind,
}

#[derive(Clone, Debug)]
enum ColumnKind {
    U64,
    F64,
    Bool,
    String,
    Timestamp,
    Enum(Vec<String>),
    Identity,
    Unsupported(String),
}

static ACCOUNT_MOVE_COLUMNS: OnceLock<Result<Vec<ColumnDescriptor>, String>> = OnceLock::new();

fn account_move_columns() -> Result<&'static [ColumnDescriptor], ApiError> {
    ACCOUNT_MOVE_COLUMNS
        .get_or_init(|| load_account_move_columns())
        .as_deref()
        .map_err(|error| ApiError::Internal(error.clone()))
}

fn load_account_move_columns() -> Result<Vec<ColumnDescriptor>, String> {
    let manifest: Value =
        serde_json::from_str(lumiere_contracts::manifests::LUMIERE_SCHEMA_MANIFEST)
            .map_err(|error| format!("parse schema manifest: {error}"))?;
    let tables = manifest
        .get("tables")
        .and_then(Value::as_array)
        .ok_or_else(|| "schema manifest tables missing".to_owned())?;
    let table = tables
        .iter()
        .find(|table| table.get("sql_name").and_then(Value::as_str) == Some("account_move"))
        .ok_or_else(|| "account_move schema missing".to_owned())?;
    let columns = table
        .get("columns")
        .and_then(Value::as_array)
        .ok_or_else(|| "account_move columns missing".to_owned())?;
    let enums = manifest
        .get("enum_types")
        .and_then(Value::as_array)
        .ok_or_else(|| "schema manifest enum_types missing".to_owned())?;
    columns
        .iter()
        .map(|column| {
            let sql_name = column
                .get("sql_name")
                .and_then(Value::as_str)
                .ok_or_else(|| "column sql_name missing".to_owned())?
                .to_owned();
            let nullable = column
                .get("nullable")
                .and_then(Value::as_bool)
                .ok_or_else(|| "column nullable missing".to_owned())?;
            let ty = column
                .get("ty")
                .ok_or_else(|| format!("column {sql_name} type missing"))?;
            let kind = match ty.as_str() {
                Some("U64") => ColumnKind::U64,
                Some("F64") => ColumnKind::F64,
                Some("Bool") => ColumnKind::Bool,
                Some("String") => ColumnKind::String,
                Some("Timestamp") => ColumnKind::Timestamp,
                Some("Identity") => ColumnKind::Identity,
                None => {
                    if let Some(named) = ty.get("Enum").and_then(Value::as_str) {
                        let variants = enums
                            .iter()
                            .find(|item| {
                                item.get("rust_name").and_then(Value::as_str) == Some(named)
                            })
                            .and_then(|item| item.get("variants"))
                            .and_then(Value::as_array)
                            .ok_or_else(|| format!("enum {named} missing for column {sql_name}"))?;
                        ColumnKind::Enum(
                            variants
                                .iter()
                                .map(|variant| {
                                    variant
                                        .as_str()
                                        .map(str::to_owned)
                                        .ok_or_else(|| format!("enum {named} has invalid variant"))
                                })
                                .collect::<Result<_, _>>()?,
                        )
                    } else {
                        ColumnKind::Unsupported(ty.to_string())
                    }
                }
                Some(other) => ColumnKind::Unsupported(other.to_owned()),
            };
            Ok(ColumnDescriptor {
                json_key: sql_column_json_key(&sql_name),
                sql_name,
                nullable,
                kind,
            })
        })
        .collect()
}

/// Project an authorized `account_move` row using generated schema metadata.
///
/// `fields` contains generated SQL column names. Unknown columns and values
/// whose shape disagrees with the generated type fail closed.
pub fn project_account_move_row(row: &Value, fields: &[String]) -> Result<PreviewRow, ApiError> {
    let columns = account_move_columns()?;
    let id_column = columns
        .iter()
        .find(|column| column.sql_name == "id")
        .ok_or_else(|| ApiError::Internal("account_move id schema missing".into()))?;
    let id = render_value(
        row.get(&id_column.json_key)
            .ok_or_else(|| ApiError::Unprocessable("account_move row is missing id".into()))?,
        &id_column.kind,
        false,
    )?
    .ok_or_else(|| ApiError::Unprocessable("account_move id cannot be null".into()))?;
    let mut output = Vec::with_capacity(fields.len());
    for field in fields {
        let column = columns
            .iter()
            .find(|column| column.sql_name == *field)
            .ok_or_else(|| {
                ApiError::Unprocessable(format!(
                    "field '{field}' is not generated for account_move"
                ))
            })?;
        let value = match row.get(&column.json_key) {
            Some(value) => render_value(value, &column.kind, column.nullable)?,
            None if column.nullable => None,
            None => {
                return Err(ApiError::Unprocessable(format!(
                    "row is missing non-nullable field '{field}'"
                )))
            }
        };
        output.push(PreviewField {
            field: field.clone(),
            value,
        });
    }
    Ok(PreviewRow { id, fields: output })
}

fn render_value(
    value: &Value,
    kind: &ColumnKind,
    nullable: bool,
) -> Result<Option<String>, ApiError> {
    if value.is_null() {
        return if nullable {
            Ok(None)
        } else {
            Err(ApiError::Unprocessable(
                "non-nullable generated field is null".into(),
            ))
        };
    }
    let text = match kind {
        ColumnKind::U64 => value.as_u64().map(|number| number.to_string()).or_else(|| {
            value
                .as_str()
                .and_then(|text| text.parse::<u64>().ok())
                .map(|number| number.to_string())
        }),
        ColumnKind::F64 => value
            .as_f64()
            .filter(|number| number.is_finite())
            .map(|number| number.to_string()),
        ColumnKind::Bool => value.as_bool().map(|value| value.to_string()),
        ColumnKind::String => value.as_str().map(str::to_owned),
        ColumnKind::Timestamp => value
            .get("microsSinceUnixEpoch")
            .and_then(|micros| {
                micros
                    .as_i64()
                    .or_else(|| micros.as_str()?.parse::<i64>().ok())
            })
            .and_then(|micros| {
                DateTime::<Utc>::from_timestamp_micros(micros)
                    .map(|timestamp| timestamp.to_rfc3339_opts(SecondsFormat::Micros, true))
            }),
        ColumnKind::Enum(variants) => value
            .as_str()
            .filter(|value| variants.iter().any(|variant| variant == value))
            .map(str::to_owned),
        ColumnKind::Identity => value.as_str().map(str::to_owned),
        ColumnKind::Unsupported(name) => {
            return Err(ApiError::Unprocessable(format!(
                "generated field type '{name}' is not supported for preview"
            )))
        }
    }
    .ok_or_else(|| ApiError::Unprocessable("generated field value has an invalid shape".into()))?;
    Ok(Some(bound_display(text)))
}

fn bound_display(text: String) -> String {
    if text.chars().count() <= DISPLAY_LIMIT {
        return text;
    }
    let suffix = "…";
    let prefix: String = text.chars().take(DISPLAY_LIMIT - 1).collect();
    format!("{prefix}{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preserves_generated_key_mapping_and_u64() {
        assert_eq!(sql_column_json_key("amount_total"), "amountTotal");
        let row = json!({"id": "18446744073709551615", "amountTotal": 121.5});
        let projected = project_account_move_row(&row, &["amount_total".into()]).unwrap();
        assert_eq!(projected.id, u64::MAX.to_string());
        assert_eq!(projected.fields[0].value.as_deref(), Some("121.5"));
    }

    #[test]
    fn rejects_unknown_fields_and_malformed_values() {
        let row = json!({"id": 1, "amountTotal": "bad"});
        assert!(project_account_move_row(&row, &["amount_total".into()]).is_err());
        assert!(project_account_move_row(&row, &["unknown".into()]).is_err());
    }

    #[test]
    fn accepts_transport_timestamp_and_null_optional_field() {
        let row = json!({"id": 1, "invoiceDateDue": {"microsSinceUnixEpoch": "1781987714525007"}, "invoiceOrigin": null});
        let projected =
            project_account_move_row(&row, &["invoice_date_due".into(), "invoice_origin".into()])
                .unwrap();
        assert_eq!(
            projected.fields[0].value.as_deref(),
            Some("2026-06-20T20:35:14.525007Z")
        );
        assert_eq!(projected.fields[1].value, None);
    }

    #[test]
    fn validates_generated_enum_variants() {
        let valid = json!({"id": 1, "moveType": "OutInvoice"});
        assert!(project_account_move_row(&valid, &["move_type".into()]).is_ok());
        let invalid = json!({"id": 1, "moveType": "NotARealMoveType"});
        assert!(project_account_move_row(&invalid, &["move_type".into()]).is_err());
    }

    #[test]
    fn rejects_malformed_timestamp_string() {
        let row = json!({"id": 1, "invoiceDateDue": {"microsSinceUnixEpoch": "not-a-timestamp"}});
        assert!(project_account_move_row(&row, &["invoice_date_due".into()]).is_err());
    }

    #[test]
    fn bounds_unicode_display_without_splitting_codepoints() {
        let row = json!({"id": 1, "name": "é".repeat(DISPLAY_LIMIT + 10)});
        let projected = project_account_move_row(&row, &["name".into()]).unwrap();
        let value = projected.fields[0].value.as_deref().unwrap();
        assert_eq!(value.chars().count(), DISPLAY_LIMIT);
        assert!(value.ends_with('…'));
    }
}
