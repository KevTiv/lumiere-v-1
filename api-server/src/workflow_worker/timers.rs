//! Due-timer selection and revision-checked firing.
use super::{now_micros, BATCH_SIZE};
use crate::integration_worker::ScheduledService;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize, Clone)]
pub(super) struct TimerRow {
    pub(super) id: u64,
    #[serde(alias = "organizationId")]
    pub(super) organization_id: u64,
    #[serde(alias = "companyId")]
    pub(super) company_id: u64,
    pub(super) revision: u64,
    #[serde(alias = "instanceId")]
    pub(super) instance_id: u64,
    pub(super) status: String,
    #[serde(alias = "dueAt")]
    pub(super) due_at: Value,
}

#[derive(Debug, Deserialize, Clone)]
struct InstanceRow {
    revision: u64,
}

pub(super) async fn fire_due_timers(
    source_stdb: &stdb_client::StdbClient,
    service: &ScheduledService,
) -> anyhow::Result<()> {
    let organization_id = service.organization_id();
    let rows = source_stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, revision, instance_id, due_at, status \
             FROM workflow_timer WHERE organization_id = {organization_id}"
        ))
        .await?;
    let now = now_micros();
    let mut timers = Vec::with_capacity(rows.len());
    for row in rows {
        let timer = match serde_json::from_value::<TimerRow>(row) {
            Ok(t) => t,
            Err(error) => {
                tracing::warn!(%error, "skip malformed workflow_timer row");
                continue;
            }
        };
        timers.push(timer);
    }
    for timer in select_due_timers(timers, organization_id, now) {
        let instance_revision = instance_revision(source_stdb, timer.instance_id)
            .await
            .unwrap_or(0);
        let idem = timer_fire_idempotency_key(timer.id, timer.revision);
        if let Err(error) = service
            .call(
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
            )
            .await
        {
            tracing::debug!(timer_id = timer.id, %error, "fire_workflow_timer skipped");
        }
    }
    Ok(())
}

pub(super) fn select_due_timers(
    mut rows: Vec<TimerRow>,
    organization_id: u64,
    now_micros: u64,
) -> Vec<TimerRow> {
    rows.retain(|row| {
        row.organization_id == organization_id
            && row.status == "Pending"
            && timestamp_value_micros(&row.due_at)
                .is_some_and(|due_at| timer_is_due(due_at, now_micros))
    });
    rows.sort_by_key(|row| (timestamp_value_micros(&row.due_at), row.id));
    rows.truncate(BATCH_SIZE);
    rows
}

pub(super) async fn instance_revision(
    client: &stdb_client::StdbClient,
    instance_id: u64,
) -> anyhow::Result<u64> {
    let rows = client
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

fn timestamp_value_micros(value: &Value) -> Option<u64> {
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
