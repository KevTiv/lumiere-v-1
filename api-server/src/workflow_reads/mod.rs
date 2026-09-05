//! Scoped BFF reads for private workflow tables (Wave 4 Agent DQ).
//!
//! SpacetimeDB keeps human-task / definition / runtime tables private. HTTP SQL
//! therefore runs with the module owner token; identity and company filtering
//! happen here so clients never receive an organization-wide inbox.

use crate::error::ApiError;
use serde_json::Value;
use stdb_auth::FieldAccessContext;
use stdb_client::StdbClient;

mod candidate_scope;
mod company_scope;
mod definitions;
mod human_tasks;
mod operations;

use candidate_scope::query_human_task_inbox;
use company_scope::{allowed_company_ids, row_company_allowed, row_optional_company_allowed};
use definitions::project_workflow_version;
use human_tasks::{project_human_task, project_task_event};
use operations::{
    project_decision_event, project_migration_plan, project_migration_preflight,
    project_migration_result, project_outbox,
};

const HUMAN_TASK_LIST_COLS: &str =
    "id, organization_id, company_id, workflow_id, workflow_version_id, \
workflow_instance_id, token_id, node_id, node_key, kind, assignment, candidate_role_ids, \
candidate_group_ids, candidate_unit_ids, require_comment_on_reject, subject_model, subject_id, \
condition_revision_hash, subject_revision_hash, guarded_action, status, revision, requested_by, \
requested_at, claimed_by, claimed_at, decided_by, acting_for, decided_at, decision, \
decision_comment, invalidated_by, invalidated_at, invalidation_reason, correlation_id, \
created_at, updated_at";

const HUMAN_TASK_EVENT_COLS: &str = "id, organization_id, company_id, workflow_version_id, \
workflow_instance_id, task_id, command_kind, prior_status, next_status, decision, actor, \
acting_for, matched_role_id, delegation_id, prior_revision, next_revision, idempotency_key, \
input_hash, subject_revision_hash, comment, domain_receipt, correlation_id, recorded_at";

const WORKFLOW_COLS: &str =
    "id, organization_id, company_id, workflow_key, model, create_uid, create_date";

const WORKFLOW_VERSION_COLS: &str =
    "id, organization_id, company_id, workflow_id, version, status, \
schema_version, draft_revision, name, description, trigger, content_hash, create_uid, create_date, \
published_uid, published_date, retired_uid, retired_date, metadata";

const WORKFLOW_NODE_COLS: &str =
    "id, organization_id, company_id, workflow_id, workflow_version_id, \
node_key, name, kind, sequence, split_kind, join_kind, create_uid, create_date, write_uid, \
write_date, metadata";

const WORKFLOW_EDGE_COLS: &str =
    "id, organization_id, company_id, workflow_id, workflow_version_id, \
edge_key, from_node_key, to_node_key, sequence, create_uid, create_date, write_uid, write_date, \
metadata";

const WORKFLOW_INSTANCE_COLS: &str =
    "id, organization_id, company_id, workflow_id, workflow_version_id, \
definition_hash, subject_model, subject_id, subject_revision_hash, state, revision, \
active_token_count, singleton_scope_key, started_by, started_at, completed_at, cancelled_by, \
cancelled_at, correlation_id, causation_id";

const TIMER_COLS: &str = "id, organization_id, company_id, instance_id, token_id, \
expected_token_revision, edge_id, due_at, semantic_key, status, revision, correlation_id, \
created_at";

const OUTBOX_COLS: &str = "id, organization_id, company_id, instance_id, token_id, \
expected_token_revision, edge_id, action_key, semantic_key, delivery_guarantee, queue_job_id, \
status, revision, error_summary, completed_at, correlation_id, created_at";

const DECISION_EVENT_COLS: &str =
    "id, organization_id, company_id, workflow_id, workflow_version_id, \
instance_id, token_id, result_token_id, prior_node_key, next_node_key, command_kind, \
prior_instance_state, next_instance_state, actor, authorization_outcome, action_key, \
prior_revision, next_revision, idempotency_key, domain_receipt, reason, correlation_id, \
recorded_at";

const MIGRATION_PLAN_COLS: &str = "id, organization_id, company_id, workflow_id, \
source_workflow_version_id, target_workflow_version_id, compatibility, active, revision, \
created_by, created_at, updated_by, updated_at";

const MIGRATION_PREFLIGHT_COLS: &str = "id, organization_id, company_id, plan_id, instance_id, \
compatibility, compatible, errors, input_hash, recorded_by, recorded_at";

const MIGRATION_RESULT_COLS: &str = "id, organization_id, company_id, plan_id, instance_id, \
source_workflow_version_id, target_workflow_version_id, outcome, reason, mapping_fingerprint, \
idempotency_key, prior_instance_revision, next_instance_revision, error_summary, recorded_by, \
recorded_at";

pub fn is_private_workflow_resource(resource: &str) -> bool {
    matches!(
        resource,
        "workflow-human-tasks-inbox"
            | "workflow-human-tasks"
            | "workflow-human-task-events"
            | "workflows"
            | "workflow-versions"
            | "workflow-nodes"
            | "workflow-edges"
            | "workflow-instances"
            | "workflow-timers-late"
            | "workflow-outbox-dead"
            | "workflow-decision-events"
            | "workflow-migration-plans"
            | "workflow-migration-preflights"
            | "workflow-migration-results"
            // Legacy keys: fail closed with empty/not-found via early arms below.
            | "approval-requests-inbox"
            | "approval-requests"
            | "approval-rules"
            | "workflow-activities"
            | "workflow-transitions"
            | "workflow-workitems"
    )
}

pub async fn execute_private_workflow_query(
    owner: &StdbClient,
    resource: &str,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<Option<Vec<Value>>, ApiError> {
    match resource {
        "approval-requests-inbox" | "approval-requests" | "approval-rules" => {
            // Replaced by human-task resources; keep keys briefly so clients get [].
            Ok(Some(Vec::new()))
        }
        "workflow-activities" | "workflow-transitions" | "workflow-workitems" => {
            Ok(Some(Vec::new()))
        }
        "workflow-human-tasks-inbox" => {
            let rows =
                query_human_task_inbox(owner, organization_id, identity_hex, field_access, true)
                    .await?;
            Ok(Some(rows))
        }
        "workflow-human-tasks" => {
            let rows =
                query_human_task_inbox(owner, organization_id, identity_hex, field_access, false)
                    .await?;
            Ok(Some(rows))
        }
        "workflow-human-task-events" => {
            let rows = query_org_table(
                owner,
                "workflow_human_task_event",
                HUMAN_TASK_EVENT_COLS,
                organization_id,
            )
            .await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_company_allowed(r, &company_ids))
                .map(project_task_event)
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflows" => {
            let rows = query_org_table(owner, "workflow", WORKFLOW_COLS, organization_id).await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_optional_company_allowed(r, &company_ids))
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-versions" => {
            let rows = query_org_table(
                owner,
                "workflow_version",
                WORKFLOW_VERSION_COLS,
                organization_id,
            )
            .await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_optional_company_allowed(r, &company_ids))
                .map(project_workflow_version)
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-nodes" => {
            let rows = query_org_table(owner, "workflow_node", WORKFLOW_NODE_COLS, organization_id)
                .await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_optional_company_allowed(r, &company_ids))
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-edges" => {
            let rows = query_org_table(owner, "workflow_edge", WORKFLOW_EDGE_COLS, organization_id)
                .await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_optional_company_allowed(r, &company_ids))
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-instances" => {
            let rows = query_org_table(
                owner,
                "workflow_instance",
                WORKFLOW_INSTANCE_COLS,
                organization_id,
            )
            .await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_company_allowed(r, &company_ids))
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-timers-late" => {
            let rows =
                query_org_table(owner, "workflow_timer", TIMER_COLS, organization_id).await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| {
                    row_company_allowed(r, &company_ids)
                        && enum_tag(r, "status").as_deref() == Some("Pending")
                })
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-outbox-dead" => {
            let rows =
                query_org_table(owner, "workflow_outbox", OUTBOX_COLS, organization_id).await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| {
                    row_company_allowed(r, &company_ids)
                        && matches!(
                            enum_tag(r, "status").as_deref(),
                            Some("DeadLettered") | Some("ReconciliationRequired")
                        )
                })
                .map(project_outbox)
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-decision-events" => {
            let rows = query_org_table(
                owner,
                "workflow_decision_event",
                DECISION_EVENT_COLS,
                organization_id,
            )
            .await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_company_allowed(r, &company_ids))
                .map(project_decision_event)
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-migration-plans" => {
            let rows = query_org_table(
                owner,
                "workflow_migration_plan",
                MIGRATION_PLAN_COLS,
                organization_id,
            )
            .await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_company_allowed(r, &company_ids))
                .map(project_migration_plan)
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-migration-preflights" => {
            let rows = query_org_table(
                owner,
                "workflow_migration_preflight",
                MIGRATION_PREFLIGHT_COLS,
                organization_id,
            )
            .await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_company_allowed(r, &company_ids))
                .map(project_migration_preflight)
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-migration-results" => {
            let rows = query_org_table(
                owner,
                "workflow_migration_instance_result",
                MIGRATION_RESULT_COLS,
                organization_id,
            )
            .await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_company_allowed(r, &company_ids))
                .map(project_migration_result)
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        _ => Ok(None),
    }
}

async fn query_org_table(
    owner: &StdbClient,
    table: &str,
    cols: &str,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!("SELECT {cols} FROM {table} WHERE organization_id = {organization_id}");
    owner.query_sql(&sql).await.map_err(ApiError::internal)
}

fn row_u64(row: &Value, key: &str) -> Option<u64> {
    row.get(key).and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    })
}

fn enum_tag(row: &Value, camel: &str) -> Option<String> {
    let snake = camel
        .chars()
        .enumerate()
        .flat_map(|(i, c)| {
            if c.is_uppercase() && i > 0 {
                vec!['_', c.to_ascii_lowercase()]
            } else {
                vec![c.to_ascii_lowercase()]
            }
        })
        .collect::<String>();
    let v = row.get(camel).or_else(|| row.get(&snake))?;
    if let Some(s) = v.as_str() {
        return Some(s.to_string());
    }
    // Tagged unit enum object: { "Open": [] } or { "tag": "Open" }
    if let Some(obj) = v.as_object() {
        if obj.len() == 1 {
            return obj.keys().next().cloned();
        }
        if let Some(tag) = obj.get("tag").and_then(|t| t.as_str()) {
            return Some(tag.to_string());
        }
    }
    None
}

fn u64_list_field(row: &Value, camel: &str, snake: &str) -> Vec<u64> {
    let Some(v) = row.get(camel).or_else(|| row.get(snake)) else {
        return Vec::new();
    };
    match v {
        Value::Array(arr) => arr
            .iter()
            .filter_map(|x| {
                x.as_u64()
                    .or_else(|| x.as_str().and_then(|s| s.parse().ok()))
                    .or_else(|| x.as_i64().map(|i| i as u64))
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn row_id_u64(row: &Value) -> u64 {
    row_u64(row, "id").unwrap_or(0)
}

fn sort_rows_by_id_desc(rows: &mut [Value]) {
    rows.sort_by(|a, b| row_id_u64(b).cmp(&row_id_u64(a)));
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::candidate_scope::principal_matches_candidates;
    use serde_json::json;
    use std::collections::HashSet;

    #[test]
    fn malformed_company_scope_is_not_an_organization_wide_definition() {
        let allowed = HashSet::from([7]);
        for value in [
            json!(-1),
            json!(0),
            json!(1.5),
            json!("bad"),
            json!({}),
            json!("18446744073709551616"),
        ] {
            assert!(!row_optional_company_allowed(
                &json!({"companyId": value}),
                &allowed
            ));
        }
        assert!(row_optional_company_allowed(
            &json!({"company_id": null}),
            &allowed
        ));
        assert!(row_optional_company_allowed(&json!({}), &allowed));
        assert!(row_optional_company_allowed(
            &json!({"company_id": "7"}),
            &allowed
        ));
        assert!(!row_optional_company_allowed(
            &json!({"company_id": 8}),
            &allowed
        ));
        assert_eq!(row_u64(&json!({"id": -1}), "id"), None);
        assert_eq!(row_u64(&json!({"id": u64::MAX}), "id"), Some(u64::MAX));
    }

    #[test]
    fn private_resource_detection() {
        assert!(is_private_workflow_resource("workflow-human-tasks-inbox"));
        assert!(is_private_workflow_resource("workflows"));
        assert!(!is_private_workflow_resource("contacts"));
    }

    #[test]
    fn candidate_role_match() {
        let row = json!({
            "candidateRoleIds": [1, 2],
            "candidateGroupIds": [],
            "candidateUnitIds": [],
        });
        let roles = HashSet::from([2u64]);
        assert!(principal_matches_candidates(
            &row,
            &roles,
            &HashSet::new(),
            &HashSet::new()
        ));
        assert!(!principal_matches_candidates(
            &row,
            &HashSet::from([9u64]),
            &HashSet::new(),
            &HashSet::new()
        ));
    }
}
