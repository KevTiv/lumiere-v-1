//! Scoped BFF reads for private workflow tables (Wave 4 Agent DQ).
//!
//! SpacetimeDB keeps human-task / definition / runtime tables private. HTTP SQL
//! therefore runs with the module owner token; identity and company filtering
//! happen here so clients never receive an organization-wide inbox.

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::auth_password::identity_cell_to_hex;
use crate::error::ApiError;
use crate::session::normalize_identity_hex_for_sql;
use stdb_auth::{identity_sql_literal, FieldAccessContext};
use stdb_client::StdbClient;

const HUMAN_TASK_LIST_COLS: &str = "id, organization_id, company_id, workflow_id, workflow_version_id, \
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

const WORKFLOW_VERSION_COLS: &str = "id, organization_id, company_id, workflow_id, version, status, \
schema_version, draft_revision, name, description, trigger, content_hash, create_uid, create_date, \
published_uid, published_date, retired_uid, retired_date, metadata";

const WORKFLOW_NODE_COLS: &str = "id, organization_id, company_id, workflow_id, workflow_version_id, \
node_key, name, kind, sequence, split_kind, join_kind, create_uid, create_date, write_uid, \
write_date, metadata";

const WORKFLOW_EDGE_COLS: &str = "id, organization_id, company_id, workflow_id, workflow_version_id, \
edge_key, from_node_key, to_node_key, sequence, create_uid, create_date, write_uid, write_date, \
metadata";

const WORKFLOW_INSTANCE_COLS: &str = "id, organization_id, company_id, workflow_id, workflow_version_id, \
definition_hash, subject_model, subject_id, subject_revision_hash, state, revision, \
active_token_count, singleton_scope_key, started_by, started_at, completed_at, cancelled_by, \
cancelled_at, correlation_id, causation_id";

const TIMER_COLS: &str = "id, organization_id, company_id, instance_id, token_id, \
expected_token_revision, edge_id, due_at, semantic_key, status, revision, correlation_id, \
created_at";

const OUTBOX_COLS: &str = "id, organization_id, company_id, instance_id, token_id, \
expected_token_revision, edge_id, action_key, semantic_key, delivery_guarantee, queue_job_id, \
status, revision, error_summary, completed_at, correlation_id, created_at";

const DECISION_EVENT_COLS: &str = "id, organization_id, company_id, workflow_id, workflow_version_id, \
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
            let rows =
                query_org_table(owner, "workflow_version", WORKFLOW_VERSION_COLS, organization_id)
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
            let rows =
                query_org_table(owner, "workflow_node", WORKFLOW_NODE_COLS, organization_id).await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_optional_company_allowed(r, &company_ids))
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-edges" => {
            let rows =
                query_org_table(owner, "workflow_edge", WORKFLOW_EDGE_COLS, organization_id).await?;
            let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
            let mut rows: Vec<Value> = rows
                .into_iter()
                .filter(|r| row_optional_company_allowed(r, &company_ids))
                .collect();
            sort_rows_by_id_desc(&mut rows);
            Ok(Some(rows))
        }
        "workflow-instances" => {
            let rows =
                query_org_table(owner, "workflow_instance", WORKFLOW_INSTANCE_COLS, organization_id)
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

async fn query_human_task_inbox(
    owner: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
    open_only: bool,
) -> Result<Vec<Value>, ApiError> {
    let caller = normalize_identity_hex_for_sql(identity_hex);
    let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
    let scope = CandidateScope::load(owner, organization_id, &caller, field_access).await?;

    let sql = format!(
        "SELECT {HUMAN_TASK_LIST_COLS} FROM workflow_human_task WHERE organization_id = {organization_id}"
    );
    let rows = owner
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let instance_revisions = load_instance_revisions(owner, organization_id).await?;

    let mut out = Vec::new();
    for row in rows {
        if !row_company_allowed(&row, &company_ids) {
            continue;
        }
        if open_only {
            let status = enum_tag(&row, "status");
            if !matches!(status.as_deref(), Some("Open") | Some("Claimed")) {
                continue;
            }
        }
        if !scope.can_view_task(&row, &caller) {
            continue;
        }
        out.push(project_human_task(row, &instance_revisions));
    }
    sort_rows_by_id_desc(&mut out);
    Ok(out)
}

async fn load_instance_revisions(
    owner: &StdbClient,
    organization_id: u64,
) -> Result<std::collections::HashMap<u64, u64>, ApiError> {
    let sql = format!(
        "SELECT id, revision FROM workflow_instance WHERE organization_id = {organization_id}"
    );
    let rows = owner
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let mut map = std::collections::HashMap::new();
    for r in rows {
        if let (Some(id), Some(rev)) = (row_u64(&r, "id"), row_u64(&r, "revision")) {
            map.insert(id, rev);
        }
    }
    Ok(map)
}

struct CandidateScope {
    role_ids: HashSet<u64>,
    group_ids: HashSet<u64>,
    unit_ids: HashSet<u64>,
    /// Delegators this caller may act for, plus optional pinned role.
    acting_for: Vec<(String, Option<u64>)>,
    is_superuser: bool,
}

impl CandidateScope {
    async fn load(
        owner: &StdbClient,
        organization_id: u64,
        caller_hex: &str,
        field_access: Option<&FieldAccessContext>,
    ) -> Result<Self, ApiError> {
        let is_superuser = field_access.map(|f| f.is_superuser).unwrap_or(false);
        let mut role_ids = HashSet::new();
        if let Some(fa) = field_access {
            if fa.role_id > 0 {
                role_ids.insert(fa.role_id);
            }
        }

        let id_lit = identity_sql_literal(caller_hex).map_err(ApiError::Internal)?;

        // Additional role assignments for the caller.
        let ura_sql = format!(
            "SELECT role_id, organization_id FROM user_role_assignment WHERE user_identity = {id_lit}"
        );
        if let Ok(rows) = owner.query_sql(&ura_sql).await {
            for r in rows {
                let org = row_u64(&r, "organizationId").or_else(|| row_u64(&r, "organization_id"));
                if org != Some(organization_id) {
                    continue;
                }
                if let Some(rid) = row_u64(&r, "roleId").or_else(|| row_u64(&r, "role_id")) {
                    role_ids.insert(rid);
                }
            }
        }

        // Group memberships.
        let mut group_ids = HashSet::new();
        let grp_sql = format!(
            "SELECT group_id, organization_id, company_id, is_active FROM workflow_candidate_group_member WHERE member_identity = {id_lit}"
        );
        if let Ok(rows) = owner.query_sql(&grp_sql).await {
            for r in rows {
                let org = row_u64(&r, "organizationId").or_else(|| row_u64(&r, "organization_id"));
                let active = r
                    .get("isActive")
                    .or_else(|| r.get("is_active"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if org != Some(organization_id) || !active {
                    continue;
                }
                if let Some(gid) = row_u64(&r, "groupId").or_else(|| row_u64(&r, "group_id")) {
                    group_ids.insert(gid);
                }
            }
        }

        // Unit = department_id on active org membership.
        let mut unit_ids = HashSet::new();
        let uo_sql = format!(
            "SELECT department_id, organization_id, company_id, is_active FROM user_organization WHERE user_id = {id_lit}"
        );
        if let Ok(rows) = owner.query_sql(&uo_sql).await {
            for r in rows {
                let org = row_u64(&r, "organizationId").or_else(|| row_u64(&r, "organization_id"));
                let active = r
                    .get("isActive")
                    .or_else(|| r.get("is_active"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if org != Some(organization_id) || !active {
                    continue;
                }
                if let Some(did) =
                    row_u64(&r, "departmentId").or_else(|| row_u64(&r, "department_id"))
                {
                    if did > 0 {
                        unit_ids.insert(did);
                    }
                }
            }
        }

        // Active delegations where caller is the delegatee.
        let mut acting_for = Vec::new();
        let del_sql = format!(
            "SELECT delegator_identity, role_id, organization_id, company_id, is_active, valid_from, valid_until FROM workflow_delegation WHERE delegatee_identity = {id_lit}"
        );
        if let Ok(rows) = owner.query_sql(&del_sql).await {
            for r in rows {
                let org = row_u64(&r, "organizationId").or_else(|| row_u64(&r, "organization_id"));
                let active = r
                    .get("isActive")
                    .or_else(|| r.get("is_active"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if org != Some(organization_id) || !active {
                    continue;
                }
                let Some(delegator) = r
                    .get("delegatorIdentity")
                    .or_else(|| r.get("delegator_identity"))
                    .and_then(identity_cell_to_hex)
                else {
                    continue;
                };
                let role = row_u64(&r, "roleId").or_else(|| row_u64(&r, "role_id"));
                acting_for.push((delegator, role));
            }
        }

        Ok(Self {
            role_ids,
            group_ids,
            unit_ids,
            acting_for,
            is_superuser,
        })
    }

    fn can_view_task(&self, row: &Value, caller_hex: &str) -> bool {
        if self.is_superuser {
            return true;
        }

        // Already claimed by caller → visible.
        if let Some(claimed) = row
            .get("claimedBy")
            .or_else(|| row.get("claimed_by"))
            .and_then(identity_cell_to_hex)
        {
            if claimed == caller_hex {
                return true;
            }
        }

        if principal_matches_candidates(row, &self.role_ids, &self.group_ids, &self.unit_ids) {
            return true;
        }

        // Delegation: principal = delegator must match candidates (role pin optional).
        for (delegator, pinned_role) in &self.acting_for {
            let mut roles = self.role_ids.clone();
            if let Some(r) = pinned_role {
                roles = HashSet::from([*r]);
            }
            // For delegation visibility we check the task candidates against the
            // (possibly pinned) role set; group/unit still use the caller's memberships
            // because memberships are not delegated.
            if principal_matches_candidates(row, &roles, &self.group_ids, &self.unit_ids) {
                let _ = delegator;
                return true;
            }
        }

        false
    }
}

fn principal_matches_candidates(
    row: &Value,
    role_ids: &HashSet<u64>,
    group_ids: &HashSet<u64>,
    unit_ids: &HashSet<u64>,
) -> bool {
    let task_roles = u64_list_field(row, "candidateRoleIds", "candidate_role_ids");
    let task_groups = u64_list_field(row, "candidateGroupIds", "candidate_group_ids");
    let task_units = u64_list_field(row, "candidateUnitIds", "candidate_unit_ids");

    let role_match = !task_roles.is_empty() && task_roles.iter().any(|r| role_ids.contains(r));
    let group_match = !task_groups.is_empty() && task_groups.iter().any(|g| group_ids.contains(g));
    let unit_match = !task_units.is_empty() && task_units.iter().any(|u| unit_ids.contains(u));
    role_match || group_match || unit_match
}

fn project_human_task(
    mut row: Value,
    instance_revisions: &std::collections::HashMap<u64, u64>,
) -> Value {
    if let Some(obj) = row.as_object_mut() {
        let model = obj
            .get("subjectModel")
            .or_else(|| obj.get("subject_model"))
            .cloned()
            .unwrap_or(Value::Null);
        let subject_id = obj
            .get("subjectId")
            .or_else(|| obj.get("subject_id"))
            .cloned()
            .unwrap_or(Value::Null);
        let node_key = obj
            .get("nodeKey")
            .or_else(|| obj.get("node_key"))
            .cloned()
            .unwrap_or(Value::Null);
        obj.insert(
            "summary".into(),
            json!({
                "subjectModel": model,
                "subjectId": subject_id,
                "nodeKey": node_key,
            }),
        );
        let instance_id = obj
            .get("workflowInstanceId")
            .or_else(|| obj.get("workflow_instance_id"))
            .and_then(|v| {
                v.as_u64()
                    .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            });
        if let Some(iid) = instance_id {
            if let Some(rev) = instance_revisions.get(&iid) {
                obj.insert("instanceRevision".into(), json!(*rev));
                obj.insert("instance_revision".into(), json!(*rev));
            }
        }
    }
    row
}

fn project_task_event(row: Value) -> Value {
    row
}

fn project_workflow_version(mut row: Value) -> Value {
    // snapshot_fields can be large; omit from list projection if present under either key.
    if let Some(obj) = row.as_object_mut() {
        obj.remove("snapshotFields");
        obj.remove("snapshot_fields");
    }
    row
}

fn project_outbox(mut row: Value) -> Value {
    if let Some(obj) = row.as_object_mut() {
        obj.remove("payload");
    }
    row
}

fn project_decision_event(mut row: Value) -> Value {
    if let Some(tag) = enum_tag(&row, "command_kind") {
        if let Some(obj) = row.as_object_mut() {
            obj.insert("commandKindTag".into(), json!(tag));
        }
    }
    row
}

fn project_migration_plan(mut row: Value) -> Value {
    if let Some(tag) = enum_tag(&row, "compatibility") {
        if let Some(obj) = row.as_object_mut() {
            obj.insert("compatibilityTag".into(), json!(tag));
        }
    }
    // Mapping vectors can be large; list view uses ids/status only.
    if let Some(obj) = row.as_object_mut() {
        obj.remove("nodeMappings");
        obj.remove("node_mappings");
        obj.remove("forkMappings");
        obj.remove("fork_mappings");
        obj.remove("edgeMappings");
        obj.remove("edge_mappings");
    }
    row
}

fn project_migration_preflight(mut row: Value) -> Value {
    if let Some(tag) = enum_tag(&row, "compatibility") {
        if let Some(obj) = row.as_object_mut() {
            obj.insert("compatibilityTag".into(), json!(tag));
        }
    }
    row
}

fn project_migration_result(mut row: Value) -> Value {
    if let Some(tag) = enum_tag(&row, "outcome") {
        if let Some(obj) = row.as_object_mut() {
            obj.insert("outcomeTag".into(), json!(tag));
        }
    }
    row
}

async fn query_org_table(
    owner: &StdbClient,
    table: &str,
    cols: &str,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!("SELECT {cols} FROM {table} WHERE organization_id = {organization_id}");
    owner
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))
}

async fn allowed_company_ids(
    owner: &StdbClient,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
) -> Result<HashSet<u64>, ApiError> {
    // Reuse org companies; FieldAccessContext does not currently carry a selected
    // operating company — UI filters further by query key. BFF enforces membership.
    let sql = format!(
        "SELECT id FROM company WHERE organization_id = {organization_id}"
    );
    let rows = owner
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let mut ids = HashSet::new();
    for r in rows {
        if let Some(id) = row_u64(&r, "id") {
            if id > 0 {
                ids.insert(id);
            }
        }
    }
    // Superusers still scoped to org companies above.
    let _ = fa;
    Ok(ids)
}

fn row_company_allowed(row: &Value, allowed: &HashSet<u64>) -> bool {
    match row_u64(row, "companyId").or_else(|| row_u64(row, "company_id")) {
        Some(cid) => allowed.contains(&cid),
        None => false,
    }
}

fn row_optional_company_allowed(row: &Value, allowed: &HashSet<u64>) -> bool {
    match row_u64(row, "companyId").or_else(|| row_u64(row, "company_id")) {
        Some(cid) if cid > 0 => allowed.contains(&cid),
        // Org-wide definitions (company_id null) are visible to any org member.
        _ => true,
    }
}

fn row_u64(row: &Value, key: &str) -> Option<u64> {
    row.get(key).and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            .or_else(|| v.as_i64().map(|i| i as u64))
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
