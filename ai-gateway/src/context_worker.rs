use std::{collections::HashMap, sync::Arc, time::Duration};

use dashmap::DashMap;
use tokio::time;
use tracing::{error, info};

use crate::{rig_agent::Activity, state::AppState};

type WatermarkMap = Arc<DashMap<String, i64>>;

const TABLE_SALE_ORDER: &str = "sale_order";
const TABLE_PROJECT_TASK: &str = "project_task";
const TABLE_HR_LEAVE: &str = "hr_leave";
const TABLE_IOT_TELEMETRY: &str = "iot_telemetry";
const TABLE_ACCOUNT_MOVE: &str = "account_move";
const TABLE_MRP_PRODUCTION: &str = "mrp_production";

pub async fn run(state: AppState) {
    let interval_secs = state.config.activity_ingest_interval_secs.max(5);
    info!(
        interval_secs,
        collection = %state.rig.collection_name(),
        "Context activity ingester started"
    );

    let mut interval = time::interval(Duration::from_secs(interval_secs));

    loop {
        interval.tick().await;

        if let Err(err) = ingest_all(&state).await {
            error!(error = %err, "Context activity ingester cycle failed");
        }
    }
}

pub async fn ingest_for_org(state: &AppState, org_id: u64) -> anyhow::Result<usize> {
    let mut total = 0usize;

    total += ingest_sale_orders(state, Some(org_id)).await?;
    total += ingest_project_tasks(state, Some(org_id)).await?;
    total += ingest_hr_leaves(state, Some(org_id)).await?;
    total += ingest_iot_telemetry(state, Some(org_id)).await?;
    total += ingest_account_moves(state, Some(org_id)).await?;
    total += ingest_mrp_production(state, Some(org_id)).await?;

    Ok(total)
}

pub async fn ingest_all(state: &AppState) -> anyhow::Result<usize> {
    let mut total = 0usize;

    total += ingest_sale_orders(state, None).await?;
    total += ingest_project_tasks(state, None).await?;
    total += ingest_hr_leaves(state, None).await?;
    total += ingest_iot_telemetry(state, None).await?;
    total += ingest_account_moves(state, None).await?;
    total += ingest_mrp_production(state, None).await?;

    Ok(total)
}

async fn ingest_sale_orders(state: &AppState, org_filter: Option<u64>) -> anyhow::Result<usize> {
    let rows = state.stdb.query_table(TABLE_SALE_ORDER).await?;
    let activities = rows_to_activities(
        &state.activity_watermarks,
        TABLE_SALE_ORDER,
        rows,
        org_filter,
        |row| {
            let org_id = get_u64(row, "organization_id")?;
            let entity_id = get_u64(row, "id")?.to_string();
            let ts = latest_timestamp_micros(
                row,
                &[
                    "write_date",
                    "confirmation_date",
                    "create_date",
                    "date_order",
                ],
            );
            let amount = get_f64(row, "amount_total").unwrap_or(0.0);
            let state_name = get_string(row, "state").unwrap_or_else(|| "unknown".to_string());
            let customer = row_field(row, "partner_id")
                .map(display_value)
                .unwrap_or_else(|| "unknown customer".to_string());

            Some(Activity {
                org_id,
                entity_type: TABLE_SALE_ORDER.to_string(),
                entity_id,
                text: format!(
                    "Sale order #{id} for {customer}: {amount:.2} [{state_name}]",
                    id = get_u64(row, "id")?,
                ),
                timestamp: ts,
            })
        },
    );

    upsert_batch(state, TABLE_SALE_ORDER, activities).await
}

async fn ingest_project_tasks(state: &AppState, org_filter: Option<u64>) -> anyhow::Result<usize> {
    let rows = state.stdb.query_table(TABLE_PROJECT_TASK).await?;
    let activities = rows_to_activities(
        &state.activity_watermarks,
        TABLE_PROJECT_TASK,
        rows,
        org_filter,
        |row| {
            let org_id = get_u64(row, "organization_id")?;
            let entity_id = get_u64(row, "id")?.to_string();
            let ts = latest_timestamp_micros(row, &["write_date", "create_date", "date_assign"]);
            let name = get_string(row, "name").unwrap_or_else(|| "Untitled task".to_string());
            let project = row_field(row, "project_id")
                .map(display_value)
                .unwrap_or_else(|| "unknown project".to_string());
            let stage = row_field(row, "stage_id")
                .map(display_value)
                .unwrap_or_else(|| "no stage".to_string());
            let assigned = row_field(row, "user_ids")
                .map(display_user_list)
                .unwrap_or_else(|| "unassigned".to_string());

            Some(Activity {
                org_id,
                entity_type: TABLE_PROJECT_TASK.to_string(),
                entity_id,
                text: format!(
                    "Task '{name}' in project {project}: stage {stage}, assigned to {assigned}"
                ),
                timestamp: ts,
            })
        },
    );

    upsert_batch(state, TABLE_PROJECT_TASK, activities).await
}

async fn ingest_hr_leaves(state: &AppState, org_filter: Option<u64>) -> anyhow::Result<usize> {
    let rows = state.stdb.query_table(TABLE_HR_LEAVE).await?;
    let activities = rows_to_activities(
        &state.activity_watermarks,
        TABLE_HR_LEAVE,
        rows,
        org_filter,
        |row| {
            let org_id = get_u64(row, "organization_id")?;
            let entity_id = get_u64(row, "id")?.to_string();
            let ts = latest_timestamp_micros(row, &["created_at", "date_from"]);
            let days = get_f64(row, "number_of_days").unwrap_or(0.0);
            let leave_type = row_field(row, "leave_type_id")
                .map(display_value)
                .unwrap_or_else(|| "leave".to_string());
            let employee = row_field(row, "employee_id")
                .map(display_value)
                .unwrap_or_else(|| "unknown employee".to_string());
            let state_name = get_string(row, "state").unwrap_or_else(|| "unknown".to_string());

            Some(Activity {
                org_id,
                entity_type: TABLE_HR_LEAVE.to_string(),
                entity_id,
                text: format!(
                    "Leave: employee {employee} requested {days:.1}d type {leave_type} [{state_name}]"
                ),
                timestamp: ts,
            })
        },
    );

    upsert_batch(state, TABLE_HR_LEAVE, activities).await
}

async fn ingest_iot_telemetry(state: &AppState, org_filter: Option<u64>) -> anyhow::Result<usize> {
    let rows = state.stdb.query_table(TABLE_IOT_TELEMETRY).await?;
    let activities = rows_to_activities(
        &state.activity_watermarks,
        TABLE_IOT_TELEMETRY,
        rows,
        org_filter,
        |row| {
            let org_id = get_u64(row, "organization_id")?;
            let entity_id = get_u64(row, "id")?.to_string();
            let ts = latest_timestamp_micros(row, &["recorded_at"]);
            let device_id = get_u64(row, "device_id")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let sensor_type =
                get_string(row, "sensor_type").unwrap_or_else(|| "unknown".to_string());
            let unit = get_string(row, "unit").unwrap_or_default();

            let value_text = row_field(row, "raw_value")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| {
                    get_f64(row, "value")
                        .map(|v| format!("{v:.2}"))
                        .unwrap_or_else(|| "0".to_string())
                });

            Some(Activity {
                org_id,
                entity_type: TABLE_IOT_TELEMETRY.to_string(),
                entity_id,
                text: format!("Device {device_id} sensor {sensor_type}: {value_text}{unit}"),
                timestamp: ts,
            })
        },
    );

    upsert_batch(state, TABLE_IOT_TELEMETRY, activities).await
}

async fn ingest_account_moves(state: &AppState, org_filter: Option<u64>) -> anyhow::Result<usize> {
    let rows = state.stdb.query_table(TABLE_ACCOUNT_MOVE).await?;
    let activities = rows_to_activities(
        &state.activity_watermarks,
        TABLE_ACCOUNT_MOVE,
        rows,
        org_filter,
        |row| {
            let org_id = get_u64(row, "organization_id")?;
            let entity_id = get_u64(row, "id")?.to_string();
            let ts = latest_timestamp_micros(row, &["write_date", "create_date", "date"]);
            let name = get_string(row, "name").unwrap_or_else(|| "unnamed".to_string());
            let amount = get_f64(row, "amount_total").unwrap_or(0.0);
            let state_name = get_string(row, "state").unwrap_or_else(|| "unknown".to_string());

            Some(Activity {
                org_id,
                entity_type: TABLE_ACCOUNT_MOVE.to_string(),
                entity_id,
                text: format!("Journal entry {name}: {amount:.2} [{state_name}]"),
                timestamp: ts,
            })
        },
    );

    upsert_batch(state, TABLE_ACCOUNT_MOVE, activities).await
}

async fn ingest_mrp_production(state: &AppState, org_filter: Option<u64>) -> anyhow::Result<usize> {
    let rows = state.stdb.query_table(TABLE_MRP_PRODUCTION).await?;
    let activities = rows_to_activities(
        &state.activity_watermarks,
        TABLE_MRP_PRODUCTION,
        rows,
        org_filter,
        |row| {
            let org_id = get_u64(row, "organization_id")?;
            let entity_id = get_u64(row, "id")?.to_string();
            let ts = latest_timestamp_micros(
                row,
                &[
                    "write_date",
                    "create_date",
                    "date_start",
                    "date_planned_start",
                ],
            );
            let product = row_field(row, "product_id")
                .map(display_value)
                .unwrap_or_else(|| "unknown product".to_string());
            let qty = get_f64(row, "product_qty").unwrap_or(0.0);
            let state_name = get_string(row, "state").unwrap_or_else(|| "unknown".to_string());

            Some(Activity {
                org_id,
                entity_type: TABLE_MRP_PRODUCTION.to_string(),
                entity_id,
                text: format!(
                    "Manufacturing order #{id} for product {product}: qty {qty:.2} [{state_name}]",
                    id = get_u64(row, "id")?,
                ),
                timestamp: ts,
            })
        },
    );

    upsert_batch(state, TABLE_MRP_PRODUCTION, activities).await
}

async fn upsert_batch(
    state: &AppState,
    table: &str,
    activities: Vec<Activity>,
) -> anyhow::Result<usize> {
    if activities.is_empty() {
        return Ok(0);
    }

    let mut max_by_org: HashMap<u64, i64> = HashMap::new();
    for activity in &activities {
        let entry = max_by_org
            .entry(activity.org_id)
            .or_insert(activity.timestamp);
        if activity.timestamp > *entry {
            *entry = activity.timestamp;
        }
    }

    let count = state.rig.upsert_activities(&activities).await?;

    for (org_id, ts) in max_by_org {
        set_watermark(&state.activity_watermarks, org_id, table, ts);
    }

    info!(table, count, "Ingested context activity batch");

    Ok(count)
}

fn rows_to_activities<F>(
    watermarks: &WatermarkMap,
    table: &str,
    rows: Vec<serde_json::Value>,
    org_filter: Option<u64>,
    mut map_row: F,
) -> Vec<Activity>
where
    F: FnMut(&serde_json::Value) -> Option<Activity>,
{
    let mut activities = Vec::new();

    for row in &rows {
        let Some(activity) = map_row(row) else {
            continue;
        };

        if let Some(filter_org_id) = org_filter {
            if activity.org_id != filter_org_id {
                continue;
            }
        }

        let watermark = get_watermark(watermarks, activity.org_id, table);
        if activity.timestamp <= watermark {
            continue;
        }

        activities.push(activity);
    }

    activities
}

fn get_watermark(watermarks: &WatermarkMap, org_id: u64, table: &str) -> i64 {
    watermarks
        .get(&watermark_key(org_id, table))
        .map(|v| *v)
        .unwrap_or(0)
}

fn set_watermark(watermarks: &WatermarkMap, org_id: u64, table: &str, ts: i64) {
    watermarks.insert(watermark_key(org_id, table), ts);
}

fn watermark_key(org_id: u64, table: &str) -> String {
    format!("{org_id}:{table}")
}

fn snake_to_camel_key(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut upper = false;
    for c in s.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.push(c.to_ascii_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

fn row_field<'a>(row: &'a serde_json::Value, snake_key: &str) -> Option<&'a serde_json::Value> {
    let camel = snake_to_camel_key(snake_key);
    row.get(snake_key).or_else(|| row.get(&camel))
}

fn latest_timestamp_micros(row: &serde_json::Value, fields: &[&str]) -> i64 {
    fields
        .iter()
        .filter_map(|field| row_field(row, field))
        .map(timestamp_to_micros)
        .max()
        .unwrap_or(0)
}

fn timestamp_to_micros(value: &serde_json::Value) -> i64 {
    if let Some(v) = value.as_i64() {
        return v;
    }

    if let Some(v) = value.as_u64() {
        return v as i64;
    }

    if let Some(s) = value.as_str() {
        if let Ok(parsed) = s.parse::<i64>() {
            return parsed;
        }
    }

    if let Some(obj) = value.as_object() {
        for key in [
            "micros",
            "microseconds",
            "timestamp_micros",
            "unix_micros",
            "seconds",
        ] {
            if let Some(inner) = obj.get(key) {
                let n = timestamp_to_micros(inner);
                if n > 0 {
                    return if key == "seconds" { n * 1_000_000 } else { n };
                }
            }
        }
    }

    0
}

fn get_u64(row: &serde_json::Value, key: &str) -> Option<u64> {
    row_field(row, key).and_then(value_to_u64)
}

fn get_f64(row: &serde_json::Value, key: &str) -> Option<f64> {
    row_field(row, key).and_then(value_to_f64)
}

fn get_string(row: &serde_json::Value, key: &str) -> Option<String> {
    row_field(row, key).map(display_value)
}

fn value_to_u64(value: &serde_json::Value) -> Option<u64> {
    if let Some(v) = value.as_u64() {
        return Some(v);
    }
    if let Some(v) = value.as_i64() {
        return (v >= 0).then_some(v as u64);
    }
    if let Some(s) = value.as_str() {
        return s.parse::<u64>().ok();
    }
    None
}

fn value_to_f64(value: &serde_json::Value) -> Option<f64> {
    if let Some(v) = value.as_f64() {
        return Some(v);
    }
    if let Some(v) = value.as_i64() {
        return Some(v as f64);
    }
    if let Some(v) = value.as_u64() {
        return Some(v as f64);
    }
    if let Some(s) = value.as_str() {
        return s.parse::<f64>().ok();
    }
    None
}

fn display_value(value: &serde_json::Value) -> String {
    if let Some(s) = value.as_str() {
        return s.to_string();
    }
    if let Some(v) = value.as_u64() {
        return v.to_string();
    }
    if let Some(v) = value.as_i64() {
        return v.to_string();
    }
    if let Some(v) = value.as_f64() {
        return format!("{v:.2}");
    }
    if let Some(arr) = value.as_array() {
        return arr.iter().map(display_value).collect::<Vec<_>>().join(", ");
    }
    value.to_string()
}

fn display_user_list(value: &serde_json::Value) -> String {
    value
        .as_array()
        .map(|arr| {
            let rendered = arr.iter().map(display_value).collect::<Vec<_>>();
            if rendered.is_empty() {
                "unassigned".to_string()
            } else {
                rendered.join(", ")
            }
        })
        .unwrap_or_else(|| display_value(value))
}
