use anyhow::{Context, Result};
use serde_json::Value;
use stdb_client::StdbClient;

use super::datasets::{dataset_table_name, DatasetSpec};

pub async fn export_stdb_table(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    spec: &DatasetSpec,
) -> Result<(String, Vec<Value>)> {
    let DatasetSpec::StdbTable {
        key,
        table,
        org_column,
        company_column,
        limit,
        extra_where,
    } = spec
    else {
        anyhow::bail!("not a stdb_table spec");
    };

    if !is_safe_identifier(table)
        || !is_safe_identifier(org_column)
        || (!company_column.is_empty() && !is_safe_identifier(company_column))
    {
        anyhow::bail!("unsafe table or column identifier");
    }

    let limit = (*limit).clamp(1, 10_000);
    let mut sql = format!("SELECT * FROM {table} WHERE {org_column} = {org_id}");
    if !company_column.is_empty() {
        sql.push_str(&format!(" AND {company_column} = {company_id}"));
    }
    if let Some(extra) = extra_where.as_deref().filter(|s| !s.trim().is_empty()) {
        if !extra.chars().all(|c| c.is_ascii_alphanumeric() || " _=<>!.'\"(),".contains(c)) {
            anyhow::bail!("unsafe extra_where clause");
        }
        sql.push_str(" AND (");
        sql.push_str(extra);
        sql.push(')');
    }
    sql.push_str(&format!(" LIMIT {limit}"));

    let rows = stdb.query_sql(&sql).await.with_context(|| format!("export {key}"))?;
    let table_name = dataset_table_name(key)?;
    Ok((table_name, rows))
}

pub fn export_input_rows(
    spec: &DatasetSpec,
    inputs: &Value,
) -> Result<(String, Vec<Value>)> {
    let DatasetSpec::Input { key, input_field } = spec else {
        anyhow::bail!("not an input spec");
    };
    let rows = inputs
        .get(input_field)
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let table_name = dataset_table_name(key)?;
    Ok((table_name, rows))
}

fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}
