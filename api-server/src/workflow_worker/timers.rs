//! Due-timer selection and revision-checked firing.
use super::{now_micros, BATCH_SIZE};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize, Clone)]
struct TimerRow {
    id: u64,
    #[serde(alias = "companyId")]
    company_id: u64,
    revision: u64,
    #[serde(alias = "workflowInstanceId")]
    workflow_instance_id: u64,
}

#[derive(Debug, Deserialize, Clone)]
struct InstanceRow {
    revision: u64,
}

pub(super) async fn fire_due_timers(state: &AppState, organization_id: u64) -> anyhow::Result<()> {
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, revision, workflow_instance_id, due_at \
             FROM workflow_timer WHERE organization_id = {organization_id} \
             AND status = 'Pending' LIMIT {BATCH_SIZE}"
        ))
        .await?;
    let now = now_micros();
    for row in rows {
        let due_at = timestamp_micros(&row, "dueAt", "due_at").unwrap_or(u64::MAX);
        if !timer_is_due(due_at, now) {
            continue;
        }
        let timer: TimerRow = match serde_json::from_value(row) {
            Ok(t) => t,
            Err(error) => {
                tracing::warn!(%error, "skip malformed workflow_timer row");
                continue;
            }
        };
        let instance_revision = instance_revision(state, timer.workflow_instance_id)
            .await
            .unwrap_or(0);
        let idem = timer_fire_idempotency_key(timer.id, timer.revision);
        if let Err(error) = state
            .stdb
            .call_reducer(stdb_client::reducer_call!(
                "fire_workflow_timer",
                json!([
                    organization_id,
                    {
                        "companyId": timer.company_id,
                        "timerId": timer.id,
                        "expectedTimerRevision": timer.revision,
                        "expectedInstanceRevision": instance_revision,
                        "idempotencyKey": idem,
                        "correlationId": format!("workflow-timer:{}", timer.id),
                        "causationId": format!("workflow-timer:{}", timer.id),
                    }
                ]),
            ))
            .await
        {
            tracing::debug!(timer_id = timer.id, %error, "fire_workflow_timer skipped");
        }
    }
    Ok(())
}

pub(super) async fn instance_revision(state: &AppState, instance_id: u64) -> anyhow::Result<u64> {
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT revision FROM workflow_instance WHERE id = {instance_id} LIMIT 1"
        ))
        .await?;
    let row = rows
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("workflow instance {instance_id} missing"))?;
    let instance: InstanceRow = serde_json::from_value(row)?;
    Ok(instance.revision)
}

/// True when a pending timer is eligible to fire at `now_micros` (WF-10 clock).
pub(super) fn timer_is_due(due_at_micros: u64, now_micros: u64) -> bool {
    due_at_micros <= now_micros
}

pub(super) fn timer_fire_idempotency_key(timer_id: u64, revision: u64) -> String {
    format!("timer-fire:{timer_id}:{revision}")
}

fn timestamp_micros(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    let value = row.get(camel).or_else(|| row.get(snake))?;
    if let Some(micros) = value.as_u64() {
        return Some(micros);
    }
    if let Some(obj) = value.as_object() {
        if let Some(micros) = obj
            .get("__timestamp_micros_since_unix_epoch__")
            .and_then(|v| v.as_u64())
            .or_else(|| obj.get("microsSinceUnixEpoch").and_then(|v| v.as_u64()))
        {
            return Some(micros);
        }
    }
    None
}
