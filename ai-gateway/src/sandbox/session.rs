use anyhow::{Context, Result};
use duckdb::Connection;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use stdb_client::StdbClient;

use super::{
    datasets::DatasetSpec,
    export::{export_input_rows, export_stdb_table},
    query::validate_read_only_sql,
};

const DEFAULT_MAX_OUTPUT_ROWS: usize = 500;

#[derive(Clone, Debug, Serialize)]
pub struct DatasetInfo {
    pub key: String,
    pub table_name: String,
    pub row_count: u32,
    pub columns: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Value>,
    pub row_count: u32,
    pub truncated: bool,
}

pub struct SandboxSession {
    pub run_id: u64,
    workspace_dir: PathBuf,
    conn: Connection,
    pub datasets: Vec<DatasetInfo>,
}

impl SandboxSession {
    pub async fn materialize(
        stdb: &StdbClient,
        org_id: u64,
        company_id: u64,
        run_id: u64,
        specs: &[DatasetSpec],
        inputs: &Value,
    ) -> Result<Self> {
        let workspace_dir = workspace_path(run_id);
        if workspace_dir.exists() {
            fs::remove_dir_all(&workspace_dir).ok();
        }
        fs::create_dir_all(&workspace_dir)
            .with_context(|| format!("create sandbox workspace {}", workspace_dir.display()))?;

        let conn = Connection::open_in_memory().context("open duckdb")?;
        let mut datasets = Vec::new();

        for spec in specs {
            let (table_name, rows) = match spec {
                DatasetSpec::StdbTable { .. } => {
                    export_stdb_table(stdb, org_id, company_id, spec).await?
                }
                DatasetSpec::Input { .. } => export_input_rows(spec, inputs)?,
            };
            let row_count = rows.len() as u32;
            let columns = load_rows_into_table(&conn, &workspace_dir, &table_name, &rows)?;
            let key = match spec {
                DatasetSpec::StdbTable { key, .. } | DatasetSpec::Input { key, .. } => key.clone(),
            };
            datasets.push(DatasetInfo {
                key,
                table_name,
                row_count,
                columns,
            });
        }

        Ok(SandboxSession {
            run_id,
            workspace_dir,
            conn,
            datasets,
        })
    }

    pub fn list_datasets(&self) -> &[DatasetInfo] {
        &self.datasets
    }

    pub fn describe_dataset(&self, key: &str) -> Result<DatasetInfo> {
        self.datasets
            .iter()
            .find(|d| d.key == key)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("dataset '{key}' not found"))
    }

    pub fn run_query(&self, sql: &str, max_output_rows: Option<usize>) -> Result<QueryResult> {
        let sql = validate_read_only_sql(sql)?;
        let max_rows = max_output_rows
            .unwrap_or(DEFAULT_MAX_OUTPUT_ROWS)
            .clamp(1, 5_000);

        let mut stmt = self.conn.prepare(&sql).context("prepare sandbox sql")?;
        let col_count = stmt.column_count();
        let mut columns = Vec::with_capacity(col_count);
        for i in 0..col_count {
            columns.push(
                stmt.column_name(i)
                    .map(|name| name.to_string())
                    .unwrap_or_else(|_| "column".to_string()),
            );
        }

        let mut rows = Vec::new();
        let mut row_iter = stmt.query([]).context("execute sandbox sql")?;
        let mut truncated = false;
        while let Some(row) = row_iter.next().context("fetch sandbox row")? {
            if rows.len() >= max_rows {
                truncated = true;
                break;
            }
            let mut obj = serde_json::Map::new();
            for (idx, col) in columns.iter().enumerate() {
                let value = duckdb_value_to_json(row, idx);
                obj.insert(col.clone(), value);
            }
            rows.push(Value::Object(obj));
        }

        Ok(QueryResult {
            row_count: rows.len() as u32,
            columns,
            rows,
            truncated,
        })
    }
}

impl Drop for SandboxSession {
    fn drop(&mut self) {
        if self.workspace_dir.exists() {
            fs::remove_dir_all(&self.workspace_dir).ok();
        }
    }
}

fn workspace_path(run_id: u64) -> PathBuf {
    std::env::temp_dir()
        .join("lumiere-runs")
        .join(run_id.to_string())
}

fn load_rows_into_table(
    conn: &Connection,
    workspace_dir: &Path,
    table_name: &str,
    rows: &[Value],
) -> Result<Vec<String>> {
    if rows.is_empty() {
        conn.execute(
            &format!("CREATE TABLE {table_name} (placeholder VARCHAR)"),
            [],
        )
        .context("create empty sandbox table")?;
        return Ok(vec!["placeholder".to_string()]);
    }

    let json_path = workspace_dir.join(format!("{table_name}.json"));
    fs::write(&json_path, serde_json::to_string(rows)?).context("write dataset json")?;
    let escaped = json_path.to_string_lossy().replace('\'', "''");
    conn.execute(
        &format!("CREATE TABLE {table_name} AS SELECT * FROM read_json_auto('{escaped}')"),
        [],
    )
    .context("import dataset into duckdb")?;

    let mut stmt = conn
        .prepare(&format!("DESCRIBE {table_name}"))
        .context("describe imported table")?;
    let mut columns = Vec::new();
    let mut rows_iter = stmt.query([]).context("describe query")?;
    while let Some(row) = rows_iter.next().context("describe row")? {
        columns.push(
            row.get::<_, String>(0)
                .unwrap_or_else(|_| "column".to_string()),
        );
    }
    Ok(columns)
}

fn duckdb_value_to_json(row: &duckdb::Row, idx: usize) -> Value {
    if let Ok(v) = row.get::<_, i64>(idx) {
        return Value::Number(v.into());
    }
    if let Ok(v) = row.get::<_, f64>(idx) {
        if let Some(num) = serde_json::Number::from_f64(v) {
            return Value::Number(num);
        }
    }
    if let Ok(v) = row.get::<_, String>(idx) {
        return Value::String(v);
    }
    if let Ok(v) = row.get::<_, bool>(idx) {
        return Value::Bool(v);
    }
    Value::Null
}

pub fn default_analysis_sql(skill_key: &str) -> Option<&'static str> {
    match skill_key {
        "report_analysis" => Some(
            "SELECT product_id, COUNT(*) AS line_count, SUM(price_subtotal) AS revenue \
             FROM sale_order_lines GROUP BY product_id ORDER BY revenue DESC LIMIT 20",
        ),
        "process_research" => Some(
            "SELECT state, COUNT(*) AS move_count, SUM(product_uom_qty) AS total_qty \
             FROM stock_moves GROUP BY state ORDER BY move_count DESC LIMIT 20",
        ),
        _ => None,
    }
}
