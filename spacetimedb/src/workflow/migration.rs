//! Future active-version migration (WF-15).
//!
//! Moves running instances between published versions of the same workflow using
//! an explicit mapping plan, side-effect-free preflight, and an atomic per-instance
//! migrate reducer. History is never rewritten; incompatible instances are left
//! pinned to their source version.

use std::collections::{BTreeMap, BTreeSet};

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::workflow::approvals::{
    workflow_human_task, WorkflowHumanTask, WorkflowHumanTaskStatus, WorkflowTaskGuardedAction,
};
use crate::workflow::branches::{workflow_fork, workflow_join_arrival, WorkflowFork};
use crate::workflow::definitions::{
    workflow, workflow_edge, workflow_node, workflow_version, WorkflowBranchKind,
    WorkflowMigrationCompatibility, WorkflowNode, WorkflowNodeKind, WorkflowVersionStatus,
};
use crate::workflow::delivery::{
    workflow_outbox, workflow_timer, WorkflowOutboxStatus, WorkflowTimerStatus,
};
use crate::workflow::runtime::{
    workflow_command_receipt, workflow_decision_event, workflow_instance, workflow_token,
    WorkflowAuthorizationOutcome, WorkflowCommandKind, WorkflowCommandReceipt,
    WorkflowDecisionEvent, WorkflowInstance, WorkflowInstanceState, WorkflowToken,
    WorkflowTokenState,
};

const MAX_KEY_LEN: usize = 256;
const MAX_REASON_LEN: usize = 8_192;

// ============================================================================
// MAPPING TYPES
// ============================================================================

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowNodeMigrationMapping {
    pub from_node_key: String,
    pub to_node_key: String,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowBranchKeyMigrationMapping {
    pub from_branch_key: String,
    pub to_branch_key: String,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowForkMigrationMapping {
    pub from_fork_node_key: String,
    pub to_fork_node_key: String,
    pub branch_key_mappings: Vec<WorkflowBranchKeyMigrationMapping>,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowEdgeMigrationMapping {
    pub from_edge_key: String,
    pub to_edge_key: String,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowMigrationOutcome {
    Succeeded,
    Rejected,
}

// ============================================================================
// TABLES
// ============================================================================

#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = workflow_migration_plan,
    public,
    index(accessor = migration_plan_by_org, btree(columns = [organization_id])),
    index(accessor = migration_plan_by_workflow, btree(columns = [workflow_id])),
    index(accessor = migration_plan_by_source, btree(columns = [source_workflow_version_id])),
    index(accessor = migration_plan_by_target, btree(columns = [target_workflow_version_id]))
)]
pub struct WorkflowMigrationPlan {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub workflow_id: u64,
    pub source_workflow_version_id: u64,
    pub target_workflow_version_id: u64,
    pub node_mappings: Vec<WorkflowNodeMigrationMapping>,
    pub fork_mappings: Vec<WorkflowForkMigrationMapping>,
    pub edge_mappings: Vec<WorkflowEdgeMigrationMapping>,
    pub compatibility: WorkflowMigrationCompatibility,
    pub active: bool,
    pub revision: u64,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_by: Identity,
    pub updated_at: Timestamp,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = workflow_migration_preflight,
    public,
    index(accessor = migration_preflight_by_plan, btree(columns = [plan_id])),
    index(accessor = migration_preflight_by_instance, btree(columns = [instance_id]))
)]
pub struct WorkflowMigrationPreflight {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub plan_id: u64,
    pub instance_id: u64,
    pub compatibility: WorkflowMigrationCompatibility,
    pub compatible: bool,
    pub errors: Vec<String>,
    pub input_hash: String,
    pub recorded_by: Identity,
    pub recorded_at: Timestamp,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = workflow_migration_instance_result,
    public,
    index(accessor = migration_result_by_plan, btree(columns = [plan_id])),
    index(accessor = migration_result_by_instance, btree(columns = [instance_id]))
)]
pub struct WorkflowMigrationInstanceResult {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub plan_id: u64,
    pub instance_id: u64,
    pub source_workflow_version_id: u64,
    pub target_workflow_version_id: u64,
    pub outcome: WorkflowMigrationOutcome,
    pub reason: String,
    pub mapping_fingerprint: String,
    pub idempotency_key: String,
    pub input_hash: String,
    pub prior_instance_revision: u64,
    pub next_instance_revision: Option<u64>,
    pub error_summary: Option<String>,
    pub recorded_by: Identity,
    pub recorded_at: Timestamp,
}

// ============================================================================
// INPUT PARAMS
// ============================================================================

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWorkflowMigrationPlanParams {
    pub company_id: u64,
    pub workflow_id: u64,
    pub source_workflow_version_id: u64,
    pub target_workflow_version_id: u64,
    pub node_mappings: Vec<WorkflowNodeMigrationMapping>,
    pub fork_mappings: Vec<WorkflowForkMigrationMapping>,
    pub edge_mappings: Vec<WorkflowEdgeMigrationMapping>,
    pub active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PreflightWorkflowMigrationParams {
    pub company_id: u64,
    pub plan_id: u64,
    pub instance_id: u64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct MigrateWorkflowInstanceParams {
    pub company_id: u64,
    pub plan_id: u64,
    pub instance_id: u64,
    pub expected_instance_revision: u64,
    pub reason: String,
    pub idempotency_key: String,
    pub correlation_id: String,
    pub causation_id: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

#[reducer]
pub fn create_workflow_migration_plan(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateWorkflowMigrationPlanParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    require_company_in_organization(ctx, organization_id, params.company_id)?;

    let workflow = ctx
        .db
        .workflow()
        .id()
        .find(&params.workflow_id)
        .ok_or("workflow not found")?;
    if workflow.organization_id != organization_id {
        return Err("workflow does not belong to this organization".to_string());
    }
    if workflow.company_id.is_some() && workflow.company_id != Some(params.company_id) {
        return Err("workflow does not belong to this company".to_string());
    }

    let source = load_published_version(
        ctx,
        organization_id,
        params.workflow_id,
        params.source_workflow_version_id,
    )?;
    let target = load_published_version(
        ctx,
        organization_id,
        params.workflow_id,
        params.target_workflow_version_id,
    )?;
    if source.id == target.id {
        return Err("source and target workflow versions must differ".to_string());
    }

    validate_mapping_lists(&params.node_mappings, &params.fork_mappings, &params.edge_mappings)?;
    let compatibility = classify_plan_compatibility(&params.node_mappings, &params.fork_mappings, &params.edge_mappings);

    let plan = ctx.db.workflow_migration_plan().insert(WorkflowMigrationPlan {
        id: 0,
        organization_id,
        company_id: params.company_id,
        workflow_id: params.workflow_id,
        source_workflow_version_id: source.id,
        target_workflow_version_id: target.id,
        node_mappings: params.node_mappings,
        fork_mappings: params.fork_mappings,
        edge_mappings: params.edge_mappings,
        compatibility,
        active: params.active,
        revision: 0,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_by: ctx.sender(),
        updated_at: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "workflow_migration_plan",
            record_id: plan.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "source_workflow_version_id": plan.source_workflow_version_id,
                    "target_workflow_version_id": plan.target_workflow_version_id,
                    "active": plan.active,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "source_workflow_version_id".into(),
                "target_workflow_version_id".into(),
                "node_mappings".into(),
                "fork_mappings".into(),
                "edge_mappings".into(),
                "active".into(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn set_workflow_migration_plan_active(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    plan_id: u64,
    active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    let plan = load_plan(ctx, organization_id, company_id, plan_id)?;
    let updated = ctx.db.workflow_migration_plan().id().update(WorkflowMigrationPlan {
        active,
        revision: plan
            .revision
            .checked_add(1)
            .ok_or("migration plan revision overflow")?,
        updated_by: ctx.sender(),
        updated_at: ctx.timestamp,
        ..plan.clone()
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "workflow_migration_plan",
            record_id: updated.id,
            action: "SET_ACTIVE",
            old_values: Some(serde_json::json!({ "active": plan.active }).to_string()),
            new_values: Some(serde_json::json!({ "active": updated.active }).to_string()),
            changed_fields: vec!["active".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn preflight_workflow_migration(
    ctx: &ReducerContext,
    organization_id: u64,
    params: PreflightWorkflowMigrationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    require_company_in_organization(ctx, organization_id, params.company_id)?;
    let plan = load_plan(ctx, organization_id, params.company_id, params.plan_id)?;
    let instance = load_scoped_instance(ctx, organization_id, params.company_id, params.instance_id)?;
    let report = evaluate_migration_compatibility(ctx, &plan, &instance)?;
    let input_hash = preflight_input_hash(organization_id, &params);

    ctx.db
        .workflow_migration_preflight()
        .insert(WorkflowMigrationPreflight {
            id: 0,
            organization_id,
            company_id: params.company_id,
            plan_id: plan.id,
            instance_id: instance.id,
            compatibility: report.compatibility,
            compatible: report.errors.is_empty(),
            errors: report.errors,
            input_hash,
            recorded_by: ctx.sender(),
            recorded_at: ctx.timestamp,
        });
    Ok(())
}

#[reducer]
pub fn migrate_workflow_instance(
    ctx: &ReducerContext,
    organization_id: u64,
    params: MigrateWorkflowInstanceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    require_company_in_organization(ctx, organization_id, params.company_id)?;
    validate_command_key(&params.idempotency_key, "idempotency key")?;
    validate_command_key(&params.correlation_id, "correlation id")?;
    validate_reason(&params.reason)?;

    let plan = load_plan(ctx, organization_id, params.company_id, params.plan_id)?;
    if !plan.active {
        return Err("migration plan is not active".to_string());
    }
    let instance = load_scoped_instance(ctx, organization_id, params.company_id, params.instance_id)?;
    let input_hash = migrate_input_hash(organization_id, &params, &plan);
    let scope_key = format!("{organization_id}:migration:{}", params.idempotency_key);

    if let Some(receipt) = replay_receipt(ctx, &scope_key, &input_hash)? {
        let _ = receipt;
        return Ok(());
    }

    if instance.state != WorkflowInstanceState::Active {
        return Err("workflow instance is terminal".to_string());
    }
    if instance.revision != params.expected_instance_revision {
        return Err(format!(
            "stale workflow instance revision: expected {}, current {}",
            params.expected_instance_revision, instance.revision
        ));
    }

    let report = evaluate_migration_compatibility(ctx, &plan, &instance)?;
    if !report.errors.is_empty() {
        return Err(report.errors.join("; "));
    }

    let target = load_published_version(
        ctx,
        organization_id,
        plan.workflow_id,
        plan.target_workflow_version_id,
    )?;
    let definition_hash = target
        .content_hash
        .clone()
        .ok_or("target workflow version is missing a content hash")?;
    let mapping_fingerprint = plan_mapping_fingerprint(&plan);
    let prior_revision = instance.revision;
    let next_revision = prior_revision
        .checked_add(1)
        .ok_or("workflow instance revision overflow")?;

    let node_map = node_map(&plan);
    let fork_map = fork_map(&plan);
    let edge_map = edge_map(&plan);
    let target_nodes = version_nodes(ctx, target.id);
    let target_edges = version_edges(ctx, target.id);

    // Capture fork_id → branch mappings before rewriting fork node keys.
    let mut fork_branch_maps: BTreeMap<u64, Vec<WorkflowBranchKeyMigrationMapping>> =
        BTreeMap::new();
    for fork in open_forks(ctx, instance.id) {
        let fork_mapping = fork_map
            .get(&fork.fork_node_key)
            .ok_or("open fork missing mapping")?;
        fork_branch_maps.insert(fork.id, fork_mapping.branch_key_mappings.clone());
        let to_fork = target_nodes
            .get(&fork_mapping.to_fork_node_key)
            .ok_or("mapped fork node missing on target")?;
        let join_node_key = match &fork.join_node_key {
            None => None,
            Some(join) => Some(
                node_map
                    .get(join)
                    .cloned()
                    .ok_or_else(|| format!("open fork join '{join}' is not mapped"))?,
            ),
        };
        let expected =
            remap_branch_keys(&fork.expected_branch_keys, &fork_mapping.branch_key_mappings)?;
        let emitted =
            remap_branch_keys(&fork.emitted_branch_keys, &fork_mapping.branch_key_mappings)?;
        let updated_fork = ctx.db.workflow_fork().id().update(WorkflowFork {
            workflow_version_id: target.id,
            fork_node_key: to_fork.node_key.clone(),
            join_node_key,
            expected_branch_keys: expected,
            emitted_branch_keys: emitted,
            revision: fork
                .revision
                .checked_add(1)
                .ok_or("workflow fork revision overflow")?,
            ..fork.clone()
        });
        for arrival in ctx
            .db
            .workflow_join_arrival()
            .workflow_join_arrival_by_fork()
            .filter(&updated_fork.id)
        {
            let mapped_join = node_map
                .get(&arrival.join_node_key)
                .cloned()
                .ok_or_else(|| {
                    format!(
                        "join arrival node '{}' is not mapped",
                        arrival.join_node_key
                    )
                })?;
            let mapped_branch =
                remap_one_branch_key(&arrival.branch_key, &fork_mapping.branch_key_mappings)?;
            ctx.db.workflow_join_arrival().id().update(
                crate::workflow::branches::WorkflowJoinArrival {
                    join_node_key: mapped_join,
                    branch_key: mapped_branch,
                    ..arrival
                },
            );
        }
    }

    let mut remapped_tokens = Vec::new();
    for token in active_tokens(ctx, instance.id) {
        let to_key = node_map
            .get(&token.node_key)
            .cloned()
            .ok_or_else(|| format!("active token node '{}' is not mapped", token.node_key))?;
        let to_node = target_nodes
            .get(&to_key)
            .ok_or_else(|| format!("mapped node '{to_key}' missing on target"))?;
        let branch_key = match (&token.branch_key, token.fork_id) {
            (Some(branch), Some(fork_id)) => {
                let mappings = fork_branch_maps
                    .get(&fork_id)
                    .ok_or("token fork mapping missing")?;
                Some(remap_one_branch_key(branch, mappings)?)
            }
            (Some(branch), None) => Some(branch.clone()),
            (None, _) => None,
        };
        let updated = ctx.db.workflow_token().id().update(WorkflowToken {
            workflow_version_id: target.id,
            node_id: to_node.id,
            node_key: to_node.node_key.clone(),
            branch_key,
            revision: token
                .revision
                .checked_add(1)
                .ok_or("workflow token revision overflow")?,
            ..token.clone()
        });
        remapped_tokens.push(updated);
    }

    for task in open_human_tasks(ctx, instance.id) {
        let to_key = node_map
            .get(&task.node_key)
            .cloned()
            .ok_or_else(|| format!("open human task node '{}' is not mapped", task.node_key))?;
        let to_node = target_nodes
            .get(&to_key)
            .ok_or_else(|| format!("mapped human task node '{to_key}' missing on target"))?;
        ctx.db.workflow_human_task().id().update(WorkflowHumanTask {
            workflow_version_id: target.id,
            node_id: to_node.id,
            node_key: to_node.node_key.clone(),
            revision: task
                .revision
                .checked_add(1)
                .ok_or("workflow human task revision overflow")?,
            updated_at: ctx.timestamp,
            ..task
        });
    }

    for timer in pending_timers(ctx, instance.id) {
        let source_edge = ctx
            .db
            .workflow_edge()
            .id()
            .find(&timer.edge_id)
            .ok_or("pending timer edge not found")?;
        let to_edge_key = edge_map
            .get(&source_edge.edge_key)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "pending timer edge '{}' is not mapped",
                    source_edge.edge_key
                )
            })?;
        let to_edge = target_edges
            .get(&to_edge_key)
            .ok_or_else(|| format!("mapped edge '{to_edge_key}' missing on target"))?;
        ctx.db.workflow_timer().id().update(crate::workflow::delivery::WorkflowTimer {
            edge_id: to_edge.id,
            revision: timer
                .revision
                .checked_add(1)
                .ok_or("workflow timer revision overflow")?,
            ..timer
        });
    }

    let updated_instance = ctx.db.workflow_instance().id().update(WorkflowInstance {
        workflow_version_id: target.id,
        definition_hash,
        revision: next_revision,
        ..instance.clone()
    });

    let result_token_ids: Vec<u64> = remapped_tokens.iter().map(|t| t.id).collect();
    ctx.db
        .workflow_command_receipt()
        .insert(WorkflowCommandReceipt {
            scope_key,
            organization_id,
            company_id: params.company_id,
            command_kind: WorkflowCommandKind::Migration,
            idempotency_key: params.idempotency_key.clone(),
            input_hash: input_hash.clone(),
            result_instance_id: updated_instance.id,
            result_instance_revision: updated_instance.revision,
            result_instance_state: updated_instance.state.clone(),
            result_token_ids: result_token_ids.clone(),
            correlation_id: params.correlation_id.clone(),
            causation_id: params.causation_id.clone(),
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });

    let primary_token = remapped_tokens.first();
    ctx.db
        .workflow_decision_event()
        .insert(WorkflowDecisionEvent {
            id: 0,
            organization_id,
            company_id: params.company_id,
            workflow_id: updated_instance.workflow_id,
            workflow_version_id: updated_instance.workflow_version_id,
            instance_id: updated_instance.id,
            token_id: primary_token.map(|t| t.id),
            result_token_id: primary_token.map(|t| t.id),
            prior_node_key: primary_token.map(|t| {
                // After remap this is the target key; still useful as next.
                t.node_key.clone()
            }),
            next_node_key: primary_token.map(|t| t.node_key.clone()),
            command_kind: WorkflowCommandKind::Migration,
            prior_instance_state: Some(WorkflowInstanceState::Active),
            next_instance_state: WorkflowInstanceState::Active,
            prior_token_state: primary_token.map(|t| t.state.clone()),
            next_token_state: primary_token.map(|t| t.state.clone()),
            actor: ctx.sender(),
            acting_for: None,
            matched_role_id: None,
            delegation_id: None,
            authorization_outcome: WorkflowAuthorizationOutcome::Allowed,
            condition_result: None,
            subject_model: updated_instance.subject_model.clone(),
            subject_id: updated_instance.subject_id,
            subject_revision_hash: updated_instance.subject_revision_hash.clone(),
            action_key: None,
            prior_revision,
            next_revision,
            idempotency_key: params.idempotency_key.clone(),
            input_hash: input_hash.clone(),
            domain_receipt: Some(mapping_fingerprint.clone()),
            reason: Some(params.reason.clone()),
            correlation_id: params.correlation_id.clone(),
            causation_id: params.causation_id.clone(),
            recorded_at: ctx.timestamp,
        });

    ctx.db
        .workflow_migration_instance_result()
        .insert(WorkflowMigrationInstanceResult {
            id: 0,
            organization_id,
            company_id: params.company_id,
            plan_id: plan.id,
            instance_id: updated_instance.id,
            source_workflow_version_id: plan.source_workflow_version_id,
            target_workflow_version_id: plan.target_workflow_version_id,
            outcome: WorkflowMigrationOutcome::Succeeded,
            reason: params.reason.clone(),
            mapping_fingerprint,
            idempotency_key: params.idempotency_key.clone(),
            input_hash,
            prior_instance_revision: prior_revision,
            next_instance_revision: Some(next_revision),
            error_summary: None,
            recorded_by: ctx.sender(),
            recorded_at: ctx.timestamp,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "workflow_instance",
            record_id: updated_instance.id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "workflow_version_id": instance.workflow_version_id,
                    "revision": prior_revision,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "workflow_version_id": updated_instance.workflow_version_id,
                    "revision": next_revision,
                    "plan_id": plan.id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "workflow_version_id".into(),
                "definition_hash".into(),
                "revision".into(),
            ],
            metadata: Some(serde_json::json!({ "command": "migration" }).to_string()),
        },
    );
    Ok(())
}

// ============================================================================
// COMPATIBILITY
// ============================================================================

struct CompatibilityReport {
    compatibility: WorkflowMigrationCompatibility,
    errors: Vec<String>,
}

fn evaluate_migration_compatibility(
    ctx: &ReducerContext,
    plan: &WorkflowMigrationPlan,
    instance: &WorkflowInstance,
) -> Result<CompatibilityReport, String> {
    let mut errors = Vec::new();

    if instance.workflow_id != plan.workflow_id {
        errors.push("instance workflow does not match migration plan".into());
    }
    if instance.workflow_version_id != plan.source_workflow_version_id {
        errors.push("instance is not pinned to the plan source version".into());
    }
    if instance.state != WorkflowInstanceState::Active {
        errors.push("instance is not active".into());
    }

    let source = match load_published_version(
        ctx,
        plan.organization_id,
        plan.workflow_id,
        plan.source_workflow_version_id,
    ) {
        Ok(v) => v,
        Err(e) => {
            errors.push(e);
            return Ok(CompatibilityReport {
                compatibility: WorkflowMigrationCompatibility::Incompatible,
                errors,
            });
        }
    };
    let target = match load_published_version(
        ctx,
        plan.organization_id,
        plan.workflow_id,
        plan.target_workflow_version_id,
    ) {
        Ok(v) => v,
        Err(e) => {
            errors.push(e);
            return Ok(CompatibilityReport {
                compatibility: WorkflowMigrationCompatibility::Incompatible,
                errors,
            });
        }
    };
    let _ = source;

    let node_map = node_map(plan);
    let fork_map = fork_map(plan);
    let edge_map = edge_map(plan);
    let target_nodes = version_nodes(ctx, target.id);
    let target_edges = version_edges(ctx, target.id);

    for token in active_tokens(ctx, instance.id) {
        match node_map.get(&token.node_key) {
            None => errors.push(format!(
                "active token node '{}' has no mapping",
                token.node_key
            )),
            Some(to_key) => match target_nodes.get(to_key) {
                None => errors.push(format!("mapped node '{to_key}' missing on target")),
                Some(to_node) => {
                    let Some(from_node) = ctx.db.workflow_node().id().find(&token.node_id) else {
                        errors.push(format!("source node for token {} missing", token.id));
                        continue;
                    };
                    if let Err(e) = nodes_compatible(&from_node, to_node) {
                        errors.push(e);
                    }
                }
            },
        }
    }

    for task in open_human_tasks(ctx, instance.id) {
        match node_map.get(&task.node_key) {
            None => errors.push(format!(
                "open human task node '{}' has no mapping",
                task.node_key
            )),
            Some(to_key) => match target_nodes.get(to_key) {
                None => errors.push(format!(
                    "mapped human task node '{to_key}' missing on target"
                )),
                Some(to_node) => {
                    if to_node.kind != WorkflowNodeKind::HumanTask {
                        errors.push(format!(
                            "human task node '{}' maps to non-HumanTask '{to_key}'",
                            task.node_key
                        ));
                        continue;
                    }
                    let Some(policy) = &to_node.task_policy else {
                        errors.push(format!("target human task '{to_key}' has no task policy"));
                        continue;
                    };
                    if policy.kind != task.kind {
                        errors.push(format!(
                            "human task kind mismatch for '{}': {:?} -> {:?}",
                            task.node_key, task.kind, policy.kind
                        ));
                    }
                    if let Err(e) = guarded_action_compatible(task.guarded_action.as_ref(), to_node)
                    {
                        errors.push(e);
                    }
                }
            },
        }
    }

    for fork in open_forks(ctx, instance.id) {
        match fork_map.get(&fork.fork_node_key) {
            None => errors.push(format!(
                "open fork '{}' has no fork mapping",
                fork.fork_node_key
            )),
            Some(mapping) => match target_nodes.get(&mapping.to_fork_node_key) {
                None => errors.push(format!(
                    "mapped fork '{}' missing on target",
                    mapping.to_fork_node_key
                )),
                Some(to_fork) => {
                    if to_fork.kind != WorkflowNodeKind::Fork {
                        errors.push(format!(
                            "fork '{}' maps to non-Fork '{}'",
                            fork.fork_node_key, mapping.to_fork_node_key
                        ));
                    }
                    if to_fork.split_kind != fork.split_kind
                        || to_fork.split_kind == WorkflowBranchKind::None
                    {
                        errors.push(format!(
                            "fork split_kind mismatch for '{}'",
                            fork.fork_node_key
                        ));
                    }
                    for key in fork
                        .expected_branch_keys
                        .iter()
                        .chain(fork.emitted_branch_keys.iter())
                    {
                        if remap_one_branch_key(key, &mapping.branch_key_mappings).is_err() {
                            errors.push(format!(
                                "fork '{}' branch key '{key}' is not mapped",
                                fork.fork_node_key
                            ));
                        }
                    }
                    if let Some(join) = &fork.join_node_key {
                        match node_map.get(join) {
                            None => errors.push(format!(
                                "open fork join '{join}' has no node mapping"
                            )),
                            Some(to_join) => {
                                if !target_nodes
                                    .get(to_join)
                                    .is_some_and(|n| n.kind == WorkflowNodeKind::Join)
                                {
                                    errors.push(format!(
                                        "fork join '{join}' maps to non-Join '{to_join}'"
                                    ));
                                }
                            }
                        }
                    }
                }
            },
        }
    }

    for timer in pending_timers(ctx, instance.id) {
        let Some(source_edge) = ctx.db.workflow_edge().id().find(&timer.edge_id) else {
            errors.push(format!("pending timer {} has missing edge", timer.id));
            continue;
        };
        match edge_map.get(&source_edge.edge_key) {
            None => errors.push(format!(
                "pending timer edge '{}' has no mapping",
                source_edge.edge_key
            )),
            Some(to_key) => {
                if !target_edges.contains_key(to_key) {
                    errors.push(format!("mapped edge '{to_key}' missing on target"));
                }
            }
        }
    }

    for outbox in open_outboxes(ctx, instance.id) {
        errors.push(format!(
            "instance has open outbox {} in status {:?}; migration refused",
            outbox.id, outbox.status
        ));
    }

    let compatibility = if !errors.is_empty() {
        WorkflowMigrationCompatibility::Incompatible
    } else {
        plan.compatibility.clone()
    };
    Ok(CompatibilityReport {
        compatibility,
        errors,
    })
}

fn nodes_compatible(from: &WorkflowNode, to: &WorkflowNode) -> Result<(), String> {
    if from.kind != to.kind {
        return Err(format!(
            "node kind mismatch for '{}': {:?} -> {:?} ('{}')",
            from.node_key, from.kind, to.kind, to.node_key
        ));
    }
    match from.kind {
        WorkflowNodeKind::Fork => {
            if from.split_kind != to.split_kind {
                return Err(format!(
                    "fork split_kind mismatch for '{}'",
                    from.node_key
                ));
            }
        }
        WorkflowNodeKind::Join => {
            if from.join_kind != to.join_kind {
                return Err(format!("join kind mismatch for '{}'", from.node_key));
            }
        }
        WorkflowNodeKind::HumanTask => {
            let from_policy = from
                .task_policy
                .as_ref()
                .ok_or_else(|| format!("source human task '{}' missing policy", from.node_key))?;
            let to_policy = to
                .task_policy
                .as_ref()
                .ok_or_else(|| format!("target human task '{}' missing policy", to.node_key))?;
            if from_policy.kind != to_policy.kind {
                return Err(format!(
                    "human task kind mismatch for '{}': {:?} -> {:?}",
                    from.node_key, from_policy.kind, to_policy.kind
                ));
            }
        }
        WorkflowNodeKind::Action => {
            let from_action = from
                .action
                .as_ref()
                .ok_or_else(|| format!("source action node '{}' missing action", from.node_key))?;
            let to_action = to
                .action
                .as_ref()
                .ok_or_else(|| format!("target action node '{}' missing action", to.node_key))?;
            if from_action.action_key != to_action.action_key
                || from_action.input_schema_version != to_action.input_schema_version
            {
                return Err(format!(
                    "action schema mismatch for '{}'",
                    from.node_key
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

fn guarded_action_compatible(
    task_action: Option<&WorkflowTaskGuardedAction>,
    to_node: &WorkflowNode,
) -> Result<(), String> {
    match (task_action, to_node.action.as_ref()) {
        (None, None) => Ok(()),
        (Some(task), Some(def)) => {
            if task.key.as_str() != def.action_key || task.schema_version != def.input_schema_version
            {
                return Err(format!(
                    "guarded action schema mismatch for '{}'",
                    to_node.node_key
                ));
            }
            Ok(())
        }
        (Some(_), None) => Err(format!(
            "target human task '{}' lost guarded action",
            to_node.node_key
        )),
        (None, Some(_)) => Ok(()),
    }
}

// ============================================================================
// HELPERS
// ============================================================================

fn load_plan(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    plan_id: u64,
) -> Result<WorkflowMigrationPlan, String> {
    let plan = ctx
        .db
        .workflow_migration_plan()
        .id()
        .find(&plan_id)
        .ok_or("migration plan not found")?;
    if plan.organization_id != organization_id || plan.company_id != company_id {
        return Err("migration plan does not belong to this company".to_string());
    }
    Ok(plan)
}

fn load_scoped_instance(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    instance_id: u64,
) -> Result<WorkflowInstance, String> {
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance_id)
        .ok_or("workflow instance not found")?;
    if instance.organization_id != organization_id || instance.company_id != company_id {
        return Err("workflow instance does not belong to this company".to_string());
    }
    Ok(instance)
}

fn load_published_version(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_id: u64,
    version_id: u64,
) -> Result<crate::workflow::definitions::WorkflowVersion, String> {
    let version = ctx
        .db
        .workflow_version()
        .id()
        .find(&version_id)
        .ok_or("workflow version not found")?;
    if version.organization_id != organization_id || version.workflow_id != workflow_id {
        return Err("workflow version scope mismatch".to_string());
    }
    if version.status != WorkflowVersionStatus::Published {
        return Err(format!(
            "workflow version {} is not published",
            version.id
        ));
    }
    Ok(version)
}

fn validate_mapping_lists(
    nodes: &[WorkflowNodeMigrationMapping],
    forks: &[WorkflowForkMigrationMapping],
    edges: &[WorkflowEdgeMigrationMapping],
) -> Result<(), String> {
    let mut from_nodes = BTreeSet::new();
    for mapping in nodes {
        validate_stable_key("from_node_key", &mapping.from_node_key)?;
        validate_stable_key("to_node_key", &mapping.to_node_key)?;
        if !from_nodes.insert(mapping.from_node_key.clone()) {
            return Err(format!(
                "duplicate node mapping from '{}'",
                mapping.from_node_key
            ));
        }
    }
    let mut from_forks = BTreeSet::new();
    for mapping in forks {
        validate_stable_key("from_fork_node_key", &mapping.from_fork_node_key)?;
        validate_stable_key("to_fork_node_key", &mapping.to_fork_node_key)?;
        if !from_forks.insert(mapping.from_fork_node_key.clone()) {
            return Err(format!(
                "duplicate fork mapping from '{}'",
                mapping.from_fork_node_key
            ));
        }
        let mut from_branches = BTreeSet::new();
        for branch in &mapping.branch_key_mappings {
            validate_stable_key("from_branch_key", &branch.from_branch_key)?;
            validate_stable_key("to_branch_key", &branch.to_branch_key)?;
            if !from_branches.insert(branch.from_branch_key.clone()) {
                return Err(format!(
                    "duplicate branch mapping from '{}' on fork '{}'",
                    branch.from_branch_key, mapping.from_fork_node_key
                ));
            }
        }
    }
    let mut from_edges = BTreeSet::new();
    for mapping in edges {
        validate_stable_key("from_edge_key", &mapping.from_edge_key)?;
        validate_stable_key("to_edge_key", &mapping.to_edge_key)?;
        if !from_edges.insert(mapping.from_edge_key.clone()) {
            return Err(format!(
                "duplicate edge mapping from '{}'",
                mapping.from_edge_key
            ));
        }
    }
    Ok(())
}

fn classify_plan_compatibility(
    nodes: &[WorkflowNodeMigrationMapping],
    forks: &[WorkflowForkMigrationMapping],
    edges: &[WorkflowEdgeMigrationMapping],
) -> WorkflowMigrationCompatibility {
    let identity_nodes = nodes
        .iter()
        .all(|m| m.from_node_key == m.to_node_key);
    let identity_forks = forks.iter().all(|m| {
        m.from_fork_node_key == m.to_fork_node_key
            && m.branch_key_mappings
                .iter()
                .all(|b| b.from_branch_key == b.to_branch_key)
    });
    let identity_edges = edges.iter().all(|m| m.from_edge_key == m.to_edge_key);
    if identity_nodes && identity_forks && identity_edges {
        WorkflowMigrationCompatibility::Exact
    } else {
        WorkflowMigrationCompatibility::NodeMappingRequired
    }
}

fn node_map(plan: &WorkflowMigrationPlan) -> BTreeMap<String, String> {
    plan.node_mappings
        .iter()
        .map(|m| (m.from_node_key.clone(), m.to_node_key.clone()))
        .collect()
}

fn fork_map(plan: &WorkflowMigrationPlan) -> BTreeMap<String, WorkflowForkMigrationMapping> {
    plan.fork_mappings
        .iter()
        .map(|m| (m.from_fork_node_key.clone(), m.clone()))
        .collect()
}

fn edge_map(plan: &WorkflowMigrationPlan) -> BTreeMap<String, String> {
    plan.edge_mappings
        .iter()
        .map(|m| (m.from_edge_key.clone(), m.to_edge_key.clone()))
        .collect()
}

fn version_nodes(ctx: &ReducerContext, version_id: u64) -> BTreeMap<String, WorkflowNode> {
    ctx.db
        .workflow_node()
        .workflow_node_by_version()
        .filter(&version_id)
        .map(|n| (n.node_key.clone(), n))
        .collect()
}

fn version_edges(
    ctx: &ReducerContext,
    version_id: u64,
) -> BTreeMap<String, crate::workflow::definitions::WorkflowEdge> {
    ctx.db
        .workflow_edge()
        .workflow_edge_by_version()
        .filter(&version_id)
        .map(|e| (e.edge_key.clone(), e))
        .collect()
}

fn active_tokens(ctx: &ReducerContext, instance_id: u64) -> Vec<WorkflowToken> {
    ctx.db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance_id)
        .filter(|t| t.state == WorkflowTokenState::Active)
        .collect()
}

fn open_human_tasks(ctx: &ReducerContext, instance_id: u64) -> Vec<WorkflowHumanTask> {
    ctx.db
        .workflow_human_task()
        .human_task_by_instance()
        .filter(&instance_id)
        .filter(|t| {
            matches!(
                t.status,
                WorkflowHumanTaskStatus::Open | WorkflowHumanTaskStatus::Claimed
            )
        })
        .collect()
}

fn open_forks(ctx: &ReducerContext, instance_id: u64) -> Vec<WorkflowFork> {
    ctx.db
        .workflow_fork()
        .workflow_fork_by_instance()
        .filter(&instance_id)
        .filter(|f| f.open)
        .collect()
}

fn pending_timers(
    ctx: &ReducerContext,
    instance_id: u64,
) -> Vec<crate::workflow::delivery::WorkflowTimer> {
    ctx.db
        .workflow_timer()
        .workflow_timer_by_instance()
        .filter(&instance_id)
        .filter(|t| t.status == WorkflowTimerStatus::Pending)
        .collect()
}

fn open_outboxes(
    ctx: &ReducerContext,
    instance_id: u64,
) -> Vec<crate::workflow::delivery::WorkflowOutbox> {
    ctx.db
        .workflow_outbox()
        .workflow_outbox_by_instance()
        .filter(&instance_id)
        .filter(|o| {
            matches!(
                o.status,
                WorkflowOutboxStatus::AwaitingDelivery
                    | WorkflowOutboxStatus::DeadLettered
                    | WorkflowOutboxStatus::ReconciliationRequired
            )
        })
        .collect()
}

fn remap_branch_keys(
    keys: &[String],
    mappings: &[WorkflowBranchKeyMigrationMapping],
) -> Result<Vec<String>, String> {
    keys.iter()
        .map(|k| remap_one_branch_key(k, mappings))
        .collect()
}

fn remap_one_branch_key(
    key: &str,
    mappings: &[WorkflowBranchKeyMigrationMapping],
) -> Result<String, String> {
    if let Some(mapped) = mappings.iter().find(|m| m.from_branch_key == key) {
        return Ok(mapped.to_branch_key.clone());
    }
    // Empty branch map means identity (Exact plans with no renames).
    if mappings.is_empty() {
        return Ok(key.to_string());
    }
    Err(format!("branch key '{key}' is not mapped"))
}

fn plan_mapping_fingerprint(plan: &WorkflowMigrationPlan) -> String {
    let mut fields = Vec::new();
    fields.push(plan.id.to_string());
    fields.push(plan.source_workflow_version_id.to_string());
    fields.push(plan.target_workflow_version_id.to_string());
    for m in &plan.node_mappings {
        fields.push(format!("{}->{}", m.from_node_key, m.to_node_key));
    }
    for m in &plan.fork_mappings {
        fields.push(format!("{}->{}", m.from_fork_node_key, m.to_fork_node_key));
        for b in &m.branch_key_mappings {
            fields.push(format!("{}=>{}", b.from_branch_key, b.to_branch_key));
        }
    }
    for m in &plan.edge_mappings {
        fields.push(format!("{}->{}", m.from_edge_key, m.to_edge_key));
    }
    canonical_field_hash(&fields)
}

fn replay_receipt(
    ctx: &ReducerContext,
    scope_key: &str,
    input_hash: &str,
) -> Result<Option<WorkflowCommandReceipt>, String> {
    let Some(receipt) = ctx
        .db
        .workflow_command_receipt()
        .scope_key()
        .find(scope_key.to_string())
    else {
        return Ok(None);
    };
    if receipt.input_hash != input_hash {
        return Err("idempotency key was already used with different input".to_string());
    }
    Ok(Some(receipt))
}

fn preflight_input_hash(organization_id: u64, params: &PreflightWorkflowMigrationParams) -> String {
    canonical_field_hash(&[
        organization_id.to_string(),
        params.company_id.to_string(),
        params.plan_id.to_string(),
        params.instance_id.to_string(),
    ])
}

fn migrate_input_hash(
    organization_id: u64,
    params: &MigrateWorkflowInstanceParams,
    plan: &WorkflowMigrationPlan,
) -> String {
    canonical_field_hash(&[
        organization_id.to_string(),
        params.company_id.to_string(),
        params.plan_id.to_string(),
        params.instance_id.to_string(),
        params.expected_instance_revision.to_string(),
        params.reason.clone(),
        plan_mapping_fingerprint(plan),
    ])
}

fn canonical_field_hash(fields: &[String]) -> String {
    let mut hasher = Sha256::new();
    for field in fields {
        hasher.update((field.len() as u64).to_be_bytes());
        hasher.update(field.as_bytes());
    }
    format!("sha256:{:x}", hasher.finalize())
}

fn validate_command_key(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_KEY_LEN {
        return Err(format!("{field} must be 1..{MAX_KEY_LEN} characters"));
    }
    Ok(())
}

fn validate_reason(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > MAX_REASON_LEN {
        return Err(format!(
            "reason must be 1..{MAX_REASON_LEN} characters"
        ));
    }
    Ok(())
}

fn validate_stable_key(field: &str, value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_KEY_LEN {
        return Err(format!("{field} must be 1..{MAX_KEY_LEN} characters"));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(format!(
            "{field} may only contain ascii alphanumerics, '_', '-', '.'"
        ));
    }
    Ok(())
}
