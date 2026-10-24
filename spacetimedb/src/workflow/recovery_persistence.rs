//! Complete, tenant-checked workflow snapshots for explicit recovery commits.
//!
//! These collectors only feed the existing organization commit pipeline. They
//! do not apply workflow transitions or create an independent recovery store.

use std::collections::BTreeSet;

use spacetimedb::ReducerContext;

use crate::core::audit::audit_log;
use crate::core::persistence::RowChange;

use super::approvals::{
    workflow_human_task, workflow_human_task_candidate, workflow_human_task_event,
    workflow_human_task_receipt,
};
use super::branches::{workflow_fork, workflow_join_arrival};
use super::definitions::{workflow, workflow_edge, workflow_node, workflow_version};
use super::runtime::{
    workflow_command_receipt, workflow_decision_event, workflow_instance, workflow_token,
};

const MAX_SNAPSHOT_ROWS: usize = 16_384;

/// Retain complete selected runtime/task histories and their pinned definitions.
///
/// A successful recovery must be reconstructable with its old votes and causal
/// evidence. The row bound fails the enclosing reducer transaction instead of
/// silently truncating durable history. Callers append their new typed receipt
/// and record the commit in that same transaction.
pub(super) fn snapshot_instances(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    instance_ids: &[u64],
) -> Result<Vec<RowChange>, String> {
    let mut changes = Vec::new();
    let mut versions = BTreeSet::new();
    let mut definitions = BTreeSet::new();
    let mut tasks = BTreeSet::new();
    let instance_ids: BTreeSet<_> = instance_ids.iter().copied().collect();
    for instance_id in &instance_ids {
        let instance = ctx
            .db
            .workflow_instance()
            .id()
            .find(instance_id)
            .ok_or("recovery persistence instance missing")?;
        require_scope(
            instance.organization_id,
            instance.company_id,
            organization_id,
            company_id,
        )?;
        versions.insert((instance.workflow_id, instance.workflow_version_id));
        push(
            &mut changes,
            RowChange::upsert_stdb_row(
                "workflow_instance",
                serde_json::json!({"id": instance.id}),
                &instance,
            )?,
        )?;
        for row in ctx
            .db
            .workflow_fork()
            .workflow_fork_by_instance()
            .filter(instance_id)
        {
            require_scope(
                row.organization_id,
                row.company_id,
                organization_id,
                company_id,
            )?;
            versions.insert((instance.workflow_id, row.workflow_version_id));
            for arrival in ctx
                .db
                .workflow_join_arrival()
                .workflow_join_arrival_by_fork()
                .filter(&row.id)
            {
                require_scope(
                    arrival.organization_id,
                    arrival.company_id,
                    organization_id,
                    company_id,
                )?;
                if arrival.instance_id != instance.id {
                    return Err("recovery persistence arrival is outside instance".to_string());
                }
                push(
                    &mut changes,
                    RowChange::upsert_stdb_row(
                        "workflow_join_arrival",
                        serde_json::json!({"id": arrival.id}),
                        &arrival,
                    )?,
                )?;
            }
            push(
                &mut changes,
                RowChange::upsert_stdb_row(
                    "workflow_fork",
                    serde_json::json!({"id": row.id}),
                    &row,
                )?,
            )?;
        }
        for row in ctx
            .db
            .workflow_token()
            .workflow_token_by_instance()
            .filter(instance_id)
        {
            require_scope(
                row.organization_id,
                row.company_id,
                organization_id,
                company_id,
            )?;
            versions.insert((instance.workflow_id, row.workflow_version_id));
            push(
                &mut changes,
                RowChange::upsert_stdb_row(
                    "workflow_token",
                    serde_json::json!({"id": row.id}),
                    &row,
                )?,
            )?;
        }
        for row in ctx
            .db
            .workflow_decision_event()
            .workflow_event_by_instance()
            .filter(instance_id)
        {
            require_scope(
                row.organization_id,
                row.company_id,
                organization_id,
                company_id,
            )?;
            versions.insert((row.workflow_id, row.workflow_version_id));
            push(
                &mut changes,
                RowChange::upsert_stdb_row(
                    "workflow_decision_event",
                    serde_json::json!({"id": row.id}),
                    &row,
                )?,
            )?;
        }
        for row in ctx
            .db
            .workflow_command_receipt()
            .workflow_receipt_by_instance()
            .filter(instance_id)
        {
            require_scope(
                row.organization_id,
                row.company_id,
                organization_id,
                company_id,
            )?;
            push(
                &mut changes,
                RowChange::upsert_stdb_row(
                    "workflow_command_receipt",
                    serde_json::json!({"scope_key": row.scope_key}),
                    &row,
                )?,
            )?;
        }
        for task in ctx
            .db
            .workflow_human_task()
            .human_task_by_instance()
            .filter(instance_id)
        {
            require_scope(
                task.organization_id,
                task.company_id,
                organization_id,
                company_id,
            )?;
            tasks.insert(task.id);
            versions.insert((task.workflow_id, task.workflow_version_id));
            push(
                &mut changes,
                RowChange::upsert_stdb_row(
                    "workflow_human_task",
                    serde_json::json!({"id": task.id}),
                    &task,
                )?,
            )?;
            for row in ctx
                .db
                .workflow_human_task_candidate()
                .human_task_candidate_by_task()
                .filter(&task.id)
            {
                require_scope(
                    row.organization_id,
                    row.company_id,
                    organization_id,
                    company_id,
                )?;
                push(
                    &mut changes,
                    RowChange::upsert_stdb_row(
                        "workflow_human_task_candidate",
                        serde_json::json!({"id": row.id}),
                        &row,
                    )?,
                )?;
            }
            for row in ctx
                .db
                .workflow_human_task_event()
                .human_task_event_by_task()
                .filter(&task.id)
            {
                require_scope(
                    row.organization_id,
                    row.company_id,
                    organization_id,
                    company_id,
                )?;
                versions.insert((task.workflow_id, row.workflow_version_id));
                push(
                    &mut changes,
                    RowChange::upsert_stdb_row(
                        "workflow_human_task_event",
                        serde_json::json!({"id": row.id}),
                        &row,
                    )?,
                )?;
            }
            for row in ctx
                .db
                .workflow_human_task_receipt()
                .human_task_receipt_by_task()
                .filter(&task.id)
            {
                require_scope(
                    row.organization_id,
                    row.company_id,
                    organization_id,
                    company_id,
                )?;
                push(
                    &mut changes,
                    RowChange::upsert_stdb_row(
                        "workflow_human_task_receipt",
                        serde_json::json!({"scope_key": row.scope_key}),
                        &row,
                    )?,
                )?;
            }
        }
    }
    // Migration remaps only active runtime/task projections. Historical tokens,
    // decisions and task events still refer to the versions that produced them.
    for (workflow_id, version_id) in versions {
        let version = ctx
            .db
            .workflow_version()
            .id()
            .find(&version_id)
            .ok_or("recovery persistence version missing")?;
        let definition = ctx
            .db
            .workflow()
            .id()
            .find(&workflow_id)
            .ok_or("recovery persistence workflow missing")?;
        if version.organization_id != organization_id
            || version.workflow_id != workflow_id
            || definition.organization_id != organization_id
            || version.company_id != definition.company_id
            || definition.company_id.is_some_and(|id| id != company_id)
        {
            return Err("recovery persistence definition is outside scope".to_string());
        }
        if definitions.insert(definition.id) {
            push(
                &mut changes,
                RowChange::upsert_stdb_row(
                    "workflow",
                    serde_json::json!({"id": definition.id}),
                    &definition,
                )?,
            )?;
        }
        push(
            &mut changes,
            RowChange::upsert_stdb_row(
                "workflow_version",
                serde_json::json!({"id": version.id}),
                &version,
            )?,
        )?;
        for row in ctx
            .db
            .workflow_node()
            .workflow_node_by_version()
            .filter(&version.id)
        {
            if row.organization_id != organization_id {
                return Err("recovery persistence node is outside scope".to_string());
            }
            push(
                &mut changes,
                RowChange::upsert_stdb_row(
                    "workflow_node",
                    serde_json::json!({"id": row.id}),
                    &row,
                )?,
            )?;
        }
        for row in ctx
            .db
            .workflow_edge()
            .workflow_edge_by_version()
            .filter(&version.id)
        {
            if row.organization_id != organization_id {
                return Err("recovery persistence edge is outside scope".to_string());
            }
            push(
                &mut changes,
                RowChange::upsert_stdb_row(
                    "workflow_edge",
                    serde_json::json!({"id": row.id}),
                    &row,
                )?,
            )?;
        }
    }
    for row in ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&organization_id)
        .filter(|row| {
            row.company_id == Some(company_id)
                && ((row.table_name == "workflow_instance"
                    && instance_ids.contains(&row.record_id))
                    || (row.table_name == "workflow_human_task" && tasks.contains(&row.record_id)))
        })
    {
        push(
            &mut changes,
            RowChange::upsert_stdb_row("audit_log", serde_json::json!({"id": row.id}), &row)?,
        )?;
    }
    // Index iteration order is not a contract. Stable table/id ordering puts
    // referenced definitions, runtime parents and earlier parent tokens first.
    changes.sort_by(|left, right| {
        dependency_rank(&left.table_name)
            .cmp(&dependency_rank(&right.table_name))
            .then_with(|| {
                left.row_identity
                    .get("id")
                    .and_then(serde_json::Value::as_u64)
                    .cmp(
                        &right
                            .row_identity
                            .get("id")
                            .and_then(serde_json::Value::as_u64),
                    )
            })
            .then_with(|| {
                left.row_identity
                    .to_string()
                    .cmp(&right.row_identity.to_string())
            })
    });
    Ok(changes)
}

fn push(changes: &mut Vec<RowChange>, change: RowChange) -> Result<(), String> {
    if changes.len() == MAX_SNAPSHOT_ROWS {
        return Err("workflow recovery history exceeds the durable snapshot limit".to_string());
    }
    changes.push(change);
    Ok(())
}

fn require_scope(
    row_organization: u64,
    row_company: u64,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    if row_organization != organization_id || row_company != company_id {
        return Err("recovery persistence row is outside organization/company scope".to_string());
    }
    Ok(())
}

fn dependency_rank(table: &str) -> u8 {
    match table {
        "workflow" => 0,
        "workflow_version" => 1,
        "workflow_node" => 2,
        "workflow_edge" => 3,
        "workflow_instance" => 4,
        "workflow_fork" => 5,
        "workflow_token" => 6,
        "workflow_join_arrival" => 7,
        "workflow_decision_event" => 8,
        "workflow_command_receipt" => 9,
        "workflow_human_task" => 10,
        "workflow_human_task_candidate" => 11,
        "workflow_human_task_event" => 12,
        "workflow_human_task_receipt" => 13,
        "audit_log" => 14,
        _ => unreachable!("recovery collector has a closed set of tables"),
    }
}
