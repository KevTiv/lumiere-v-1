//! Projection SQL construction and identifier handling.

use anyhow::{bail, Result};

use super::super::conventions::quote_identifier;
use super::{ProjectionCodec, ProjectionMode};

pub(super) fn build_upsert_sql(codec: &ProjectionCodec, value_count: usize) -> Result<String> {
    if value_count != codec.columns.len() {
        bail!(
            "projection codec value count {} does not match {} columns",
            value_count,
            codec.columns.len()
        );
    }
    let table = quote_identifier(&codec.table_name)?;
    let primary_key = quote_identifier(&codec.primary_key)?;
    let organization_column = quote_identifier(&codec.organization_column)?;
    let columns: Vec<String> = codec
        .columns
        .iter()
        .map(|column| quote_identifier(&column.name))
        .collect::<Result<Vec<_>>>()?;
    let placeholders: Vec<String> = codec
        .columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let placeholder = format!("${}", index + 1);
            match column.pg_type.as_str() {
                "NUMERIC(20,0)" => format!("{placeholder}::TEXT::NUMERIC"),
                "JSONB" => format!("{placeholder}::TEXT::JSONB"),
                _ => placeholder,
            }
        })
        .collect();
    let updates: Vec<String> = columns
        .iter()
        .filter(|column| column.as_str() != primary_key)
        .map(|column| format!("{column} = EXCLUDED.{column}"))
        .collect();
    let conflict = if codec.projection_mode == ProjectionMode::AppendHistory || updates.is_empty() {
        "DO NOTHING".to_string()
    } else {
        format!(
            "DO UPDATE SET {} WHERE target.{organization_column} = ${}::TEXT::NUMERIC",
            updates.join(", "),
            value_count + 1,
        )
    };
    let conflict_columns = if codec.organization_partitioned {
        format!("{organization_column}, {primary_key}")
    } else {
        primary_key.clone()
    };
    Ok(format!(
        "INSERT INTO {table} AS target ({columns}) VALUES ({placeholders}) \
         ON CONFLICT ({conflict_columns}) {conflict}",
        columns = columns.join(", "),
        placeholders = placeholders.join(", "),
    ))
}
