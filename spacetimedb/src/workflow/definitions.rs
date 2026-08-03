//! Immutable, versioned workflow definitions.
//!
//! A [`Workflow`] is the stable, scoped identity of a workflow. All executable
//! content belongs to a [`WorkflowVersion`]. Only draft versions can be edited;
//! publishing validates the complete graph and seals it with a canonical
//! SHA-256 content hash.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_CONDITION_INSTRUCTIONS: usize = 64;
const MAX_CONDITION_STACK_DEPTH: usize = 32;
const MAX_STABLE_KEY_LEN: usize = 128;
const MAX_DECIMAL_SCALE: u32 = 18;

// ============================================================================
// TYPED DEFINITION CONTRACTS
// ============================================================================

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowVersionStatus {
    Draft,
    Published,
    Retired,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowTrigger {
    Manual,
    RecordCreated,
    RecordChanged,
    Signal,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowNodeKind {
    Start,
    End,
    Decision,
    HumanTask,
    Action,
    Timer,
    Fork,
    Join,
    Subflow,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowBranchKind {
    None,
    Xor,
    Or,
    And,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowHumanTaskKind {
    ApproveReject,
    Complete,
    EvidenceReview,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowTaskAssignment {
    AnyCandidate,
    SingleCandidate,
    AllCandidates,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowTimerKind {
    Delay,
    Deadline,
    Escalation,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowRetryKind {
    None,
    Fixed,
    Exponential,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowMigrationCompatibility {
    Exact,
    NodeMappingRequired,
    Incompatible,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum ConditionValueType {
    Null,
    Boolean,
    Integer,
    Decimal,
    Money,
    Text,
    Date,
    Timestamp,
    Code,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct FixedPointDecimal {
    pub coefficient: i64,
    pub scale: u32,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct MoneyValue {
    pub minor_units: i64,
    pub currency: String,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ConditionValue {
    Null,
    Boolean(bool),
    Integer(i64),
    Decimal(FixedPointDecimal),
    Money(MoneyValue),
    Text(String),
    Date(i32),
    Timestamp(i64),
    Code(String),
}

impl ConditionValue {
    #[must_use]
    pub fn value_type(&self) -> ConditionValueType {
        match self {
            Self::Null => ConditionValueType::Null,
            Self::Boolean(_) => ConditionValueType::Boolean,
            Self::Integer(_) => ConditionValueType::Integer,
            Self::Decimal(_) => ConditionValueType::Decimal,
            Self::Money(_) => ConditionValueType::Money,
            Self::Text(_) => ConditionValueType::Text,
            Self::Date(_) => ConditionValueType::Date,
            Self::Timestamp(_) => ConditionValueType::Timestamp,
            Self::Code(_) => ConditionValueType::Code,
        }
    }
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct ConditionFieldDefinition {
    pub field_key: String,
    pub value_type: ConditionValueType,
    pub nullable: bool,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum ConditionComparison {
    Equal,
    NotEqual,
    LessThan,
    LessThanOrEqual,
    GreaterThan,
    GreaterThanOrEqual,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ConditionInstruction {
    PushValue(ConditionValue),
    LoadField(String),
    Compare(ConditionComparison),
    And,
    Or,
    Not,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct ConditionProgram {
    pub instructions: Vec<ConditionInstruction>,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct WorkflowActionInput {
    pub name: String,
    pub value: ConditionValue,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct WorkflowActionReference {
    pub action_key: String,
    pub input_schema_version: u32,
    pub input: Vec<WorkflowActionInput>,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowTaskPolicy {
    pub kind: WorkflowHumanTaskKind,
    pub assignment: WorkflowTaskAssignment,
    pub candidate_role_ids: Vec<u64>,
    pub candidate_group_ids: Vec<u64>,
    pub candidate_unit_ids: Vec<u64>,
    pub require_comment_on_reject: bool,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowTimerPolicy {
    pub kind: WorkflowTimerKind,
    pub delay_seconds: u64,
    pub calendar_key: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowRetryPolicy {
    pub kind: WorkflowRetryKind,
    pub max_attempts: u32,
    pub initial_delay_seconds: u64,
    pub max_delay_seconds: u64,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowSubflowReference {
    pub workflow_id: u64,
    pub workflow_version_id: u64,
}

// ============================================================================
// REDUCER PARAMS
// ============================================================================

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWorkflowParams {
    pub workflow_key: String,
    pub model: String,
    pub name: String,
    pub description: Option<String>,
    pub trigger: WorkflowTrigger,
    pub schema_version: u32,
    pub snapshot_fields: Vec<ConditionFieldDefinition>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateWorkflowDraftParams {
    pub name: String,
    pub description: Option<String>,
    pub trigger: WorkflowTrigger,
    pub schema_version: u32,
    pub snapshot_fields: Vec<ConditionFieldDefinition>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertWorkflowNodeParams {
    pub node_key: String,
    pub name: String,
    pub kind: WorkflowNodeKind,
    pub sequence: u32,
    pub split_kind: WorkflowBranchKind,
    pub join_kind: WorkflowBranchKind,
    pub action: Option<WorkflowActionReference>,
    pub task_policy: Option<WorkflowTaskPolicy>,
    pub timer_policy: Option<WorkflowTimerPolicy>,
    pub retry_policy: Option<WorkflowRetryPolicy>,
    pub subflow: Option<WorkflowSubflowReference>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertWorkflowEdgeParams {
    pub edge_key: String,
    pub from_node_key: String,
    pub to_node_key: String,
    pub sequence: u32,
    pub signal_key: Option<String>,
    pub condition: Option<ConditionProgram>,
    pub metadata: Option<String>,
}

// ============================================================================
// AUTHORITATIVE TABLES
// ============================================================================

/// Stable organization/company-scoped identity for one logical workflow.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow,
    index(accessor = workflow_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_by_company, btree(columns = [company_id])),
    index(accessor = workflow_by_key, btree(columns = [workflow_key])),
    index(accessor = workflow_by_model, btree(columns = [model]))
)]
pub struct Workflow {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub workflow_key: String,
    pub model: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

/// Immutable executable content header after publication.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_version,
    index(accessor = workflow_version_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_version_by_company, btree(columns = [company_id])),
    index(accessor = workflow_version_by_workflow, btree(columns = [workflow_id])),
    index(accessor = workflow_version_by_status, btree(columns = [status]))
)]
pub struct WorkflowVersion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub workflow_id: u64,
    pub version: u32,
    pub status: WorkflowVersionStatus,
    pub schema_version: u32,
    pub draft_revision: u64,
    pub name: String,
    pub description: Option<String>,
    pub trigger: WorkflowTrigger,
    pub snapshot_fields: Vec<ConditionFieldDefinition>,
    pub content_hash: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub published_uid: Option<Identity>,
    pub published_date: Option<Timestamp>,
    pub retired_uid: Option<Identity>,
    pub retired_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

/// Version-pinned node. Reducers update or delete it only while its version is Draft.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_node,
    index(accessor = workflow_node_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_node_by_version, btree(columns = [workflow_version_id])),
    index(accessor = workflow_node_by_key, btree(columns = [node_key]))
)]
pub struct WorkflowNode {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub workflow_id: u64,
    pub workflow_version_id: u64,
    pub node_key: String,
    pub name: String,
    pub kind: WorkflowNodeKind,
    pub sequence: u32,
    pub split_kind: WorkflowBranchKind,
    pub join_kind: WorkflowBranchKind,
    pub action: Option<WorkflowActionReference>,
    pub task_policy: Option<WorkflowTaskPolicy>,
    pub timer_policy: Option<WorkflowTimerPolicy>,
    pub retry_policy: Option<WorkflowRetryPolicy>,
    pub subflow: Option<WorkflowSubflowReference>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Version-pinned directed edge with an optional bounded typed condition.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_edge,
    index(accessor = workflow_edge_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_edge_by_version, btree(columns = [workflow_version_id])),
    index(accessor = workflow_edge_by_from, btree(columns = [from_node_key])),
    index(accessor = workflow_edge_by_to, btree(columns = [to_node_key]))
)]
pub struct WorkflowEdge {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub workflow_id: u64,
    pub workflow_version_id: u64,
    pub edge_key: String,
    pub from_node_key: String,
    pub to_node_key: String,
    pub sequence: u32,
    pub signal_key: Option<String>,
    pub condition: Option<ConditionProgram>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a stable workflow and its initial draft version.
#[reducer]
pub fn create_workflow(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateWorkflowParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "create")?;
    validate_stable_key("workflow key", &params.workflow_key)?;
    validate_required_text("model", &params.model)?;
    validate_version_header(&params.name, params.schema_version, &params.snapshot_fields)?;

    if ctx.db.workflow().iter().any(|row| {
        row.organization_id == organization_id
            && row.company_id == company_id
            && row.workflow_key == params.workflow_key
    }) {
        return Err("workflow key already exists in this organization/company".to_string());
    }

    let workflow = ctx.db.workflow().insert(Workflow {
        id: 0,
        organization_id,
        company_id,
        workflow_key: params.workflow_key,
        model: params.model,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
    });

    let version = ctx.db.workflow_version().insert(WorkflowVersion {
        id: 0,
        organization_id,
        company_id,
        workflow_id: workflow.id,
        version: 1,
        status: WorkflowVersionStatus::Draft,
        schema_version: params.schema_version,
        draft_revision: 1,
        name: params.name,
        description: params.description,
        trigger: params.trigger,
        snapshot_fields: params.snapshot_fields,
        content_hash: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        published_uid: None,
        published_date: None,
        retired_uid: None,
        retired_date: None,
        metadata: params.metadata,
    });

    audit_definition_change(
        ctx,
        organization_id,
        company_id,
        "workflow",
        workflow.id,
        "create",
        "created",
    );
    audit_definition_change(
        ctx,
        organization_id,
        company_id,
        "workflow_version",
        version.id,
        "create",
        "draft_created",
    );
    Ok(())
}

/// Replace the editable header of a draft and advance its revision.
#[reducer]
pub fn update_workflow_draft(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_version_id: u64,
    expected_revision: u64,
    params: UpdateWorkflowDraftParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    let version = load_draft(ctx, organization_id, workflow_version_id, expected_revision)?;
    validate_version_header(&params.name, params.schema_version, &params.snapshot_fields)?;

    ctx.db.workflow_version().id().update(WorkflowVersion {
        name: params.name,
        description: params.description,
        trigger: params.trigger,
        schema_version: params.schema_version,
        snapshot_fields: params.snapshot_fields,
        metadata: params.metadata,
        draft_revision: next_revision(version.draft_revision)?,
        ..version.clone()
    });
    audit_definition_change(
        ctx,
        organization_id,
        version.company_id,
        "workflow_version",
        version.id,
        "write",
        "draft_updated",
    );
    Ok(())
}

/// Insert a node or replace the node with the same stable key in a draft.
#[reducer]
pub fn upsert_workflow_node(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_version_id: u64,
    expected_revision: u64,
    params: UpsertWorkflowNodeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    let version = load_draft(ctx, organization_id, workflow_version_id, expected_revision)?;
    validate_node_params(&params)?;

    let existing = nodes_for_version(ctx, workflow_version_id)
        .into_iter()
        .find(|node| node.node_key == params.node_key);
    let node_id = if let Some(node) = existing {
        let node_id = node.id;
        ctx.db.workflow_node().id().update(WorkflowNode {
            name: params.name,
            kind: params.kind,
            sequence: params.sequence,
            split_kind: params.split_kind,
            join_kind: params.join_kind,
            action: params.action,
            task_policy: params.task_policy,
            timer_policy: params.timer_policy,
            retry_policy: params.retry_policy,
            subflow: params.subflow,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata,
            ..node
        });
        node_id
    } else {
        ctx.db
            .workflow_node()
            .insert(WorkflowNode {
                id: 0,
                organization_id,
                company_id: version.company_id,
                workflow_id: version.workflow_id,
                workflow_version_id,
                node_key: params.node_key,
                name: params.name,
                kind: params.kind,
                sequence: params.sequence,
                split_kind: params.split_kind,
                join_kind: params.join_kind,
                action: params.action,
                task_policy: params.task_policy,
                timer_policy: params.timer_policy,
                retry_policy: params.retry_policy,
                subflow: params.subflow,
                create_uid: ctx.sender(),
                create_date: ctx.timestamp,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                metadata: params.metadata,
            })
            .id
    };

    advance_draft_revision(ctx, &version)?;
    audit_definition_change(
        ctx,
        organization_id,
        version.company_id,
        "workflow_node",
        node_id,
        "write",
        "draft_node_upserted",
    );
    Ok(())
}

/// Delete a node and its incident edges from a draft.
#[reducer]
pub fn delete_workflow_node(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_version_id: u64,
    expected_revision: u64,
    node_key: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    let version = load_draft(ctx, organization_id, workflow_version_id, expected_revision)?;
    let node = nodes_for_version(ctx, workflow_version_id)
        .into_iter()
        .find(|row| row.node_key == node_key)
        .ok_or_else(|| "workflow node not found".to_string())?;

    for edge in edges_for_version(ctx, workflow_version_id)
        .into_iter()
        .filter(|edge| edge.from_node_key == node.node_key || edge.to_node_key == node.node_key)
    {
        ctx.db.workflow_edge().id().delete(&edge.id);
    }
    ctx.db.workflow_node().id().delete(&node.id);
    advance_draft_revision(ctx, &version)?;
    audit_definition_change(
        ctx,
        organization_id,
        version.company_id,
        "workflow_node",
        node.id,
        "delete",
        "draft_node_deleted",
    );
    Ok(())
}

/// Insert an edge or replace the edge with the same stable key in a draft.
#[reducer]
pub fn upsert_workflow_edge(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_version_id: u64,
    expected_revision: u64,
    params: UpsertWorkflowEdgeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    let version = load_draft(ctx, organization_id, workflow_version_id, expected_revision)?;
    validate_edge_params(&version.snapshot_fields, &params)?;

    let nodes = nodes_for_version(ctx, workflow_version_id);
    if !nodes
        .iter()
        .any(|node| node.node_key == params.from_node_key)
        || !nodes.iter().any(|node| node.node_key == params.to_node_key)
    {
        return Err("workflow edge endpoints must be nodes in the same draft".to_string());
    }

    let existing = edges_for_version(ctx, workflow_version_id)
        .into_iter()
        .find(|edge| edge.edge_key == params.edge_key);
    let edge_id = if let Some(edge) = existing {
        let edge_id = edge.id;
        ctx.db.workflow_edge().id().update(WorkflowEdge {
            from_node_key: params.from_node_key,
            to_node_key: params.to_node_key,
            sequence: params.sequence,
            signal_key: params.signal_key,
            condition: params.condition,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata,
            ..edge
        });
        edge_id
    } else {
        ctx.db
            .workflow_edge()
            .insert(WorkflowEdge {
                id: 0,
                organization_id,
                company_id: version.company_id,
                workflow_id: version.workflow_id,
                workflow_version_id,
                edge_key: params.edge_key,
                from_node_key: params.from_node_key,
                to_node_key: params.to_node_key,
                sequence: params.sequence,
                signal_key: params.signal_key,
                condition: params.condition,
                create_uid: ctx.sender(),
                create_date: ctx.timestamp,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                metadata: params.metadata,
            })
            .id
    };

    advance_draft_revision(ctx, &version)?;
    audit_definition_change(
        ctx,
        organization_id,
        version.company_id,
        "workflow_edge",
        edge_id,
        "write",
        "draft_edge_upserted",
    );
    Ok(())
}

/// Delete an edge from a draft.
#[reducer]
pub fn delete_workflow_edge(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_version_id: u64,
    expected_revision: u64,
    edge_key: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    let version = load_draft(ctx, organization_id, workflow_version_id, expected_revision)?;
    let edge = edges_for_version(ctx, workflow_version_id)
        .into_iter()
        .find(|row| row.edge_key == edge_key)
        .ok_or_else(|| "workflow edge not found".to_string())?;
    ctx.db.workflow_edge().id().delete(&edge.id);
    advance_draft_revision(ctx, &version)?;
    audit_definition_change(
        ctx,
        organization_id,
        version.company_id,
        "workflow_edge",
        edge.id,
        "delete",
        "draft_edge_deleted",
    );
    Ok(())
}

/// Validate and seal a draft. Published content cannot be edited by any reducer.
#[reducer]
pub fn publish_workflow_version(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_version_id: u64,
    expected_revision: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    let version = load_draft(ctx, organization_id, workflow_version_id, expected_revision)?;
    let workflow = load_workflow(ctx, organization_id, version.workflow_id)?;
    let nodes = nodes_for_version(ctx, workflow_version_id);
    let edges = edges_for_version(ctx, workflow_version_id);
    validate_workflow_graph(&version.snapshot_fields, &nodes, &edges)
        .map_err(|errors| format!("workflow graph is invalid: {}", errors.join("; ")))?;
    let content_hash = canonical_definition_hash(&workflow, &version, &nodes, &edges)?;

    ctx.db.workflow_version().id().update(WorkflowVersion {
        status: WorkflowVersionStatus::Published,
        content_hash: Some(content_hash),
        published_uid: Some(ctx.sender()),
        published_date: Some(ctx.timestamp),
        ..version.clone()
    });
    audit_definition_change(
        ctx,
        organization_id,
        version.company_id,
        "workflow_version",
        version.id,
        "publish",
        "published",
    );
    Ok(())
}

/// Clone a published or retired version into the next numbered draft.
#[reducer]
pub fn clone_workflow_version_to_draft(
    ctx: &ReducerContext,
    organization_id: u64,
    source_workflow_version_id: u64,
    expected_revision: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    let source = load_version(ctx, organization_id, source_workflow_version_id)?;
    if source.draft_revision != expected_revision {
        return Err(stale_revision_message(
            expected_revision,
            source.draft_revision,
        ));
    }
    if source.status == WorkflowVersionStatus::Draft {
        return Err("clone source must be published or retired".to_string());
    }

    let versions: Vec<_> = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&source.workflow_id)
        .collect();
    if versions
        .iter()
        .any(|version| version.status == WorkflowVersionStatus::Draft)
    {
        return Err("workflow already has an editable draft".to_string());
    }
    let next_version = versions
        .iter()
        .map(|version| version.version)
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| "workflow version number overflow".to_string())?;

    let draft = ctx.db.workflow_version().insert(WorkflowVersion {
        id: 0,
        version: next_version,
        status: WorkflowVersionStatus::Draft,
        draft_revision: 1,
        content_hash: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        published_uid: None,
        published_date: None,
        retired_uid: None,
        retired_date: None,
        ..source.clone()
    });

    for source_node in nodes_for_version(ctx, source.id) {
        ctx.db.workflow_node().insert(WorkflowNode {
            id: 0,
            workflow_version_id: draft.id,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..source_node
        });
    }
    for source_edge in edges_for_version(ctx, source.id) {
        ctx.db.workflow_edge().insert(WorkflowEdge {
            id: 0,
            workflow_version_id: draft.id,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..source_edge
        });
    }

    audit_definition_change(
        ctx,
        organization_id,
        source.company_id,
        "workflow_version",
        draft.id,
        "create",
        "cloned_to_draft",
    );
    Ok(())
}

/// Retire a published version without changing its sealed content or hash.
#[reducer]
pub fn retire_workflow_version(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_version_id: u64,
    expected_revision: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "write")?;
    let version = load_version(ctx, organization_id, workflow_version_id)?;
    if version.draft_revision != expected_revision {
        return Err(stale_revision_message(
            expected_revision,
            version.draft_revision,
        ));
    }
    if version.status != WorkflowVersionStatus::Published {
        return Err("only a published workflow version can be retired".to_string());
    }
    ctx.db.workflow_version().id().update(WorkflowVersion {
        status: WorkflowVersionStatus::Retired,
        retired_uid: Some(ctx.sender()),
        retired_date: Some(ctx.timestamp),
        ..version.clone()
    });
    audit_definition_change(
        ctx,
        organization_id,
        version.company_id,
        "workflow_version",
        version.id,
        "retire",
        "retired",
    );
    Ok(())
}

// ============================================================================
// PURE VALIDATION AND CANONICALIZATION
// ============================================================================

/// Validate a complete graph before publication or import.
pub fn validate_workflow_graph(
    snapshot_fields: &[ConditionFieldDefinition],
    nodes: &[WorkflowNode],
    edges: &[WorkflowEdge],
) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();
    if let Err(error) = validate_snapshot_fields(snapshot_fields) {
        errors.push(error);
    }
    if nodes.is_empty() {
        errors.push("graph must contain nodes".to_string());
        return Err(errors);
    }

    let mut nodes_by_key = BTreeMap::new();
    for node in nodes {
        if let Err(error) = validate_node(node) {
            errors.push(format!("node '{}': {error}", node.node_key));
        }
        if nodes_by_key.insert(node.node_key.as_str(), node).is_some() {
            errors.push(format!("duplicate node key '{}'", node.node_key));
        }
    }

    let starts: Vec<_> = nodes
        .iter()
        .filter(|node| node.kind == WorkflowNodeKind::Start)
        .collect();
    if starts.len() != 1 {
        errors.push("graph must contain exactly one Start node".to_string());
    }
    if !nodes.iter().any(|node| node.kind == WorkflowNodeKind::End) {
        errors.push("graph must contain at least one End node".to_string());
    }

    let mut edge_keys = BTreeSet::new();
    let mut adjacency: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut indegree: BTreeMap<&str, usize> =
        nodes_by_key.keys().map(|key| (*key, 0usize)).collect();
    let mut outgoing: BTreeMap<&str, usize> =
        nodes_by_key.keys().map(|key| (*key, 0usize)).collect();

    for edge in edges {
        if !edge_keys.insert(edge.edge_key.as_str()) {
            errors.push(format!("duplicate edge key '{}'", edge.edge_key));
        }
        if let Err(error) = validate_edge(snapshot_fields, edge) {
            errors.push(format!("edge '{}': {error}", edge.edge_key));
        }
        if edge.from_node_key == edge.to_node_key {
            errors.push(format!("edge '{}' cannot target its source", edge.edge_key));
        }
        let from_exists = nodes_by_key.contains_key(edge.from_node_key.as_str());
        let to_exists = nodes_by_key.contains_key(edge.to_node_key.as_str());
        if !from_exists || !to_exists {
            errors.push(format!(
                "edge '{}' references a node outside the version",
                edge.edge_key
            ));
            continue;
        }
        adjacency
            .entry(edge.from_node_key.as_str())
            .or_default()
            .push(edge.to_node_key.as_str());
        *outgoing.entry(edge.from_node_key.as_str()).or_default() += 1;
        *indegree.entry(edge.to_node_key.as_str()).or_default() += 1;
    }

    for node in nodes {
        let incoming_count = indegree.get(node.node_key.as_str()).copied().unwrap_or(0);
        let outgoing_count = outgoing.get(node.node_key.as_str()).copied().unwrap_or(0);
        if node.kind == WorkflowNodeKind::Start && incoming_count != 0 {
            errors.push(format!(
                "Start node '{}' cannot have incoming edges",
                node.node_key
            ));
        }
        if node.kind == WorkflowNodeKind::End && outgoing_count != 0 {
            errors.push(format!(
                "End node '{}' cannot have outgoing edges",
                node.node_key
            ));
        }
        if node.kind != WorkflowNodeKind::Start && incoming_count == 0 {
            errors.push(format!("node '{}' has no incoming edge", node.node_key));
        }
        if node.kind != WorkflowNodeKind::End && outgoing_count == 0 {
            errors.push(format!("node '{}' has no outgoing edge", node.node_key));
        }
    }

    if let Some(start) = starts.first() {
        let mut reachable = BTreeSet::new();
        let mut queue = VecDeque::from([start.node_key.as_str()]);
        while let Some(key) = queue.pop_front() {
            if !reachable.insert(key) {
                continue;
            }
            if let Some(targets) = adjacency.get(key) {
                queue.extend(targets.iter().copied());
            }
        }
        for node in nodes {
            if !reachable.contains(node.node_key.as_str()) {
                errors.push(format!("node '{}' is unreachable", node.node_key));
            }
        }
    }

    let mut cycle_indegree = indegree;
    let mut roots: VecDeque<_> = cycle_indegree
        .iter()
        .filter_map(|(key, degree)| (*degree == 0).then_some(*key))
        .collect();
    let mut visited = 0usize;
    while let Some(key) = roots.pop_front() {
        visited += 1;
        if let Some(targets) = adjacency.get(key) {
            for target in targets {
                if let Some(degree) = cycle_indegree.get_mut(target) {
                    *degree -= 1;
                    if *degree == 0 {
                        roots.push_back(target);
                    }
                }
            }
        }
    }
    if visited != nodes.len() {
        errors.push("graph contains a cycle".to_string());
    }

    validate_fork_join_topology(nodes, edges, &mut errors);

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Restrict OR/AND (and XOR) splits to paired, nested, non-crossing joins.
pub fn validate_fork_join_topology(
    nodes: &[WorkflowNode],
    edges: &[WorkflowEdge],
    errors: &mut Vec<String>,
) {
    let nodes_by_key: BTreeMap<&str, &WorkflowNode> = nodes
        .iter()
        .map(|node| (node.node_key.as_str(), node))
        .collect();
    let mut outgoing: BTreeMap<&str, Vec<&WorkflowEdge>> = BTreeMap::new();
    let mut incoming: BTreeMap<&str, Vec<&WorkflowEdge>> = BTreeMap::new();
    for edge in edges {
        outgoing
            .entry(edge.from_node_key.as_str())
            .or_default()
            .push(edge);
        incoming
            .entry(edge.to_node_key.as_str())
            .or_default()
            .push(edge);
    }
    for outs in outgoing.values_mut() {
        outs.sort_by(|a, b| {
            a.sequence
                .cmp(&b.sequence)
                .then_with(|| a.edge_key.cmp(&b.edge_key))
        });
    }

    for node in nodes {
        let outs = outgoing
            .get(node.node_key.as_str())
            .map(|rows| rows.len())
            .unwrap_or(0);
        let ins = incoming
            .get(node.node_key.as_str())
            .map(|rows| rows.len())
            .unwrap_or(0);
        match node.kind {
            WorkflowNodeKind::Fork => {
                if outs < 2 {
                    errors.push(format!(
                        "Fork '{}' must have at least two outgoing edges",
                        node.node_key
                    ));
                }
            }
            WorkflowNodeKind::Join => {
                if ins < 2 {
                    errors.push(format!(
                        "Join '{}' must have at least two incoming edges",
                        node.node_key
                    ));
                }
                if outs != 1 {
                    errors.push(format!(
                        "Join '{}' must have exactly one outgoing edge",
                        node.node_key
                    ));
                }
            }
            _ => {}
        }
    }

    let Some(start) = nodes
        .iter()
        .find(|node| node.kind == WorkflowNodeKind::Start)
    else {
        return;
    };
    let mut stack: Vec<(&str, WorkflowBranchKind)> = Vec::new();
    let mut visited = BTreeSet::new();
    let mut queue = VecDeque::from([start.node_key.as_str()]);
    while let Some(key) = queue.pop_front() {
        if !visited.insert(key) {
            continue;
        }
        let Some(node) = nodes_by_key.get(key) else {
            continue;
        };
        match node.kind {
            WorkflowNodeKind::Fork => {
                stack.push((node.node_key.as_str(), node.split_kind.clone()));
            }
            WorkflowNodeKind::Join => match stack.pop() {
                None => errors.push(format!(
                    "Join '{}' has no matching open Fork (crossing or unpaired)",
                    node.node_key
                )),
                Some((fork_key, split_kind)) => {
                    if split_kind != node.join_kind {
                        errors.push(format!(
                            "Join '{}' kind {:?} does not match Fork '{}' split {:?}",
                            node.node_key, node.join_kind, fork_key, split_kind
                        ));
                    }
                }
            },
            _ => {}
        }
        if let Some(targets) = outgoing.get(key) {
            for edge in targets {
                queue.push_back(edge.to_node_key.as_str());
            }
        }
    }
    if !stack.is_empty() {
        errors.push(format!(
            "unclosed Fork region(s): {}",
            stack
                .iter()
                .map(|(key, _)| *key)
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
}

/// Return a deterministic SHA-256 hash of executable definition content.
/// Database IDs, revisions, lifecycle status, actors, and timestamps are excluded.
pub fn canonical_definition_hash(
    workflow: &Workflow,
    version: &WorkflowVersion,
    nodes: &[WorkflowNode],
    edges: &[WorkflowEdge],
) -> Result<String, String> {
    validate_workflow_graph(&version.snapshot_fields, nodes, edges)
        .map_err(|errors| format!("cannot hash invalid workflow graph: {}", errors.join("; ")))?;

    let mut bytes = Vec::with_capacity(1024);
    put_string(&mut bytes, "lumiere.workflow-definition");
    put_u32(&mut bytes, version.schema_version);
    put_string(&mut bytes, &workflow.workflow_key);
    put_string(&mut bytes, &workflow.model);
    put_string(&mut bytes, &version.name);
    put_optional_string(&mut bytes, version.description.as_deref());
    put_u8(&mut bytes, trigger_tag(&version.trigger));

    let mut fields = version.snapshot_fields.clone();
    fields.sort_by(|left, right| left.field_key.cmp(&right.field_key));
    put_len(&mut bytes, fields.len())?;
    for field in &fields {
        put_string(&mut bytes, &field.field_key);
        put_u8(&mut bytes, value_type_tag(&field.value_type));
        put_bool(&mut bytes, field.nullable);
    }

    let mut ordered_nodes: Vec<_> = nodes.iter().collect();
    ordered_nodes.sort_by(|left, right| {
        (left.sequence, left.node_key.as_str()).cmp(&(right.sequence, right.node_key.as_str()))
    });
    put_len(&mut bytes, ordered_nodes.len())?;
    for node in ordered_nodes {
        encode_node(&mut bytes, node)?;
    }

    let mut ordered_edges: Vec<_> = edges.iter().collect();
    ordered_edges.sort_by(|left, right| {
        (
            left.sequence,
            left.edge_key.as_str(),
            left.from_node_key.as_str(),
            left.to_node_key.as_str(),
        )
            .cmp(&(
                right.sequence,
                right.edge_key.as_str(),
                right.from_node_key.as_str(),
                right.to_node_key.as_str(),
            ))
    });
    put_len(&mut bytes, ordered_edges.len())?;
    for edge in ordered_edges {
        encode_edge(&mut bytes, edge)?;
    }

    put_optional_string(&mut bytes, version.metadata.as_deref());
    let digest = Sha256::digest(bytes);
    Ok(format!("sha256:{digest:x}"))
}

/// Validate one typed condition program against the version's snapshot allowlist.
pub fn validate_condition_program(
    program: &ConditionProgram,
    snapshot_fields: &[ConditionFieldDefinition],
) -> Result<(), String> {
    if program.instructions.is_empty() {
        return Err("condition program cannot be empty".to_string());
    }
    if program.instructions.len() > MAX_CONDITION_INSTRUCTIONS {
        return Err(format!(
            "condition program exceeds {MAX_CONDITION_INSTRUCTIONS} instructions"
        ));
    }
    let field_types: BTreeMap<_, _> = snapshot_fields
        .iter()
        .map(|field| (field.field_key.as_str(), field.value_type.clone()))
        .collect();
    let mut stack: Vec<ConditionValueType> = Vec::new();

    for instruction in &program.instructions {
        match instruction {
            ConditionInstruction::PushValue(value) => {
                validate_condition_value(value)?;
                stack.push(value.value_type());
            }
            ConditionInstruction::LoadField(field_key) => {
                let value_type = field_types
                    .get(field_key.as_str())
                    .ok_or_else(|| format!("snapshot field '{field_key}' is not allowlisted"))?;
                stack.push((*value_type).clone());
            }
            ConditionInstruction::Compare(operator) => {
                let right = stack
                    .pop()
                    .ok_or_else(|| "comparison is missing its right operand".to_string())?;
                let left = stack
                    .pop()
                    .ok_or_else(|| "comparison is missing its left operand".to_string())?;
                validate_comparison_types(operator, &left, &right)?;
                stack.push(ConditionValueType::Boolean);
            }
            ConditionInstruction::And | ConditionInstruction::Or => {
                pop_boolean(&mut stack, "Boolean operator")?;
                pop_boolean(&mut stack, "Boolean operator")?;
                stack.push(ConditionValueType::Boolean);
            }
            ConditionInstruction::Not => {
                pop_boolean(&mut stack, "NOT")?;
                stack.push(ConditionValueType::Boolean);
            }
        }
        if stack.len() > MAX_CONDITION_STACK_DEPTH {
            return Err(format!(
                "condition stack exceeds depth {MAX_CONDITION_STACK_DEPTH}"
            ));
        }
    }

    if stack != [ConditionValueType::Boolean] {
        return Err("condition program must produce exactly one Boolean result".to_string());
    }
    Ok(())
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

fn load_workflow(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_id: u64,
) -> Result<Workflow, String> {
    let workflow = ctx
        .db
        .workflow()
        .id()
        .find(&workflow_id)
        .ok_or_else(|| "workflow not found".to_string())?;
    if workflow.organization_id != organization_id {
        return Err("workflow does not belong to this organization".to_string());
    }
    Ok(workflow)
}

fn load_version(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_version_id: u64,
) -> Result<WorkflowVersion, String> {
    let version = ctx
        .db
        .workflow_version()
        .id()
        .find(&workflow_version_id)
        .ok_or_else(|| "workflow version not found".to_string())?;
    if version.organization_id != organization_id {
        return Err("workflow version does not belong to this organization".to_string());
    }
    Ok(version)
}

fn load_draft(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_version_id: u64,
    expected_revision: u64,
) -> Result<WorkflowVersion, String> {
    let version = load_version(ctx, organization_id, workflow_version_id)?;
    if version.status != WorkflowVersionStatus::Draft {
        return Err("published and retired workflow versions are immutable".to_string());
    }
    if version.draft_revision != expected_revision {
        return Err(stale_revision_message(
            expected_revision,
            version.draft_revision,
        ));
    }
    Ok(version)
}

fn stale_revision_message(expected: u64, actual: u64) -> String {
    format!("stale workflow draft revision: expected {expected}, current {actual}")
}

fn next_revision(current: u64) -> Result<u64, String> {
    current
        .checked_add(1)
        .ok_or_else(|| "workflow draft revision overflow".to_string())
}

fn advance_draft_revision(ctx: &ReducerContext, version: &WorkflowVersion) -> Result<(), String> {
    ctx.db.workflow_version().id().update(WorkflowVersion {
        draft_revision: next_revision(version.draft_revision)?,
        ..version.clone()
    });
    Ok(())
}

fn nodes_for_version(ctx: &ReducerContext, workflow_version_id: u64) -> Vec<WorkflowNode> {
    ctx.db
        .workflow_node()
        .workflow_node_by_version()
        .filter(&workflow_version_id)
        .collect()
}

fn edges_for_version(ctx: &ReducerContext, workflow_version_id: u64) -> Vec<WorkflowEdge> {
    ctx.db
        .workflow_edge()
        .workflow_edge_by_version()
        .filter(&workflow_version_id)
        .collect()
}

fn validate_version_header(
    name: &str,
    schema_version: u32,
    snapshot_fields: &[ConditionFieldDefinition],
) -> Result<(), String> {
    validate_required_text("workflow name", name)?;
    if schema_version == 0 {
        return Err("workflow schema version must be positive".to_string());
    }
    validate_snapshot_fields(snapshot_fields)
}

fn validate_snapshot_fields(fields: &[ConditionFieldDefinition]) -> Result<(), String> {
    let mut keys = BTreeSet::new();
    for field in fields {
        validate_stable_key("snapshot field key", &field.field_key)?;
        if field.value_type == ConditionValueType::Null {
            return Err(format!(
                "snapshot field '{}' cannot declare Null as its value type",
                field.field_key
            ));
        }
        if !keys.insert(field.field_key.as_str()) {
            return Err(format!("duplicate snapshot field '{}'", field.field_key));
        }
    }
    Ok(())
}

fn validate_node_params(params: &UpsertWorkflowNodeParams) -> Result<(), String> {
    validate_stable_key("node key", &params.node_key)?;
    validate_required_text("node name", &params.name)?;
    validate_node_configuration(
        &params.kind,
        &params.split_kind,
        &params.join_kind,
        params.action.as_ref(),
        params.task_policy.as_ref(),
        params.timer_policy.as_ref(),
        params.retry_policy.as_ref(),
        params.subflow.as_ref(),
    )
}

fn validate_node(node: &WorkflowNode) -> Result<(), String> {
    validate_stable_key("node key", &node.node_key)?;
    validate_required_text("node name", &node.name)?;
    validate_node_configuration(
        &node.kind,
        &node.split_kind,
        &node.join_kind,
        node.action.as_ref(),
        node.task_policy.as_ref(),
        node.timer_policy.as_ref(),
        node.retry_policy.as_ref(),
        node.subflow.as_ref(),
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_node_configuration(
    kind: &WorkflowNodeKind,
    split_kind: &WorkflowBranchKind,
    join_kind: &WorkflowBranchKind,
    action: Option<&WorkflowActionReference>,
    task_policy: Option<&WorkflowTaskPolicy>,
    timer_policy: Option<&WorkflowTimerPolicy>,
    retry_policy: Option<&WorkflowRetryPolicy>,
    subflow: Option<&WorkflowSubflowReference>,
) -> Result<(), String> {
    if matches!(kind, WorkflowNodeKind::Start | WorkflowNodeKind::End)
        && (*split_kind != WorkflowBranchKind::None || *join_kind != WorkflowBranchKind::None)
    {
        return Err("Start and End nodes cannot declare split/join behavior".to_string());
    }
    if *kind == WorkflowNodeKind::Fork && *split_kind == WorkflowBranchKind::None {
        return Err("Fork node requires a typed split kind".to_string());
    }
    if *kind == WorkflowNodeKind::Join && *join_kind == WorkflowBranchKind::None {
        return Err("Join node requires a typed join kind".to_string());
    }
    match (kind, action) {
        (WorkflowNodeKind::Action, Some(action)) => validate_action(action)?,
        (WorkflowNodeKind::Action, None) => {
            return Err("Action node requires a registered action reference".to_string())
        }
        (_, Some(_)) => return Err("only an Action node can declare an action".to_string()),
        _ => {}
    }
    match (kind, task_policy) {
        (WorkflowNodeKind::HumanTask, Some(policy)) => validate_task_policy(policy)?,
        (WorkflowNodeKind::HumanTask, None) => {
            return Err("HumanTask node requires a task policy".to_string())
        }
        (_, Some(_)) => return Err("only a HumanTask node can declare a task policy".to_string()),
        _ => {}
    }
    match (kind, timer_policy) {
        (WorkflowNodeKind::Timer, Some(policy)) => validate_timer_policy(policy)?,
        (WorkflowNodeKind::Timer, None) => {
            return Err("Timer node requires a timer policy".to_string())
        }
        (_, Some(_)) => return Err("only a Timer node can declare a timer policy".to_string()),
        _ => {}
    }
    if let Some(policy) = retry_policy {
        validate_retry_policy(policy)?;
        if !matches!(kind, WorkflowNodeKind::Action | WorkflowNodeKind::Timer) {
            return Err("retry policy is supported only on Action and Timer nodes".to_string());
        }
    }
    match (kind, subflow) {
        (WorkflowNodeKind::Subflow, Some(reference)) => {
            if reference.workflow_id == 0 || reference.workflow_version_id == 0 {
                return Err("Subflow node requires a pinned workflow and version".to_string());
            }
        }
        (WorkflowNodeKind::Subflow, None) => {
            return Err("Subflow node requires a pinned version reference".to_string())
        }
        (_, Some(_)) => return Err("only a Subflow node can declare a subflow".to_string()),
        _ => {}
    }
    Ok(())
}

fn validate_action(action: &WorkflowActionReference) -> Result<(), String> {
    validate_stable_key("action key", &action.action_key)?;
    super::action_registry::resolve_guarded_action(
        &action.action_key,
        action.input_schema_version,
    )?;
    if !action.input.is_empty() {
        return Err(
            "pilot guarded actions derive their typed subject input from the workflow instance"
                .to_string(),
        );
    }
    let mut names = BTreeSet::new();
    for input in &action.input {
        validate_stable_key("action input name", &input.name)?;
        validate_condition_value(&input.value)?;
        if !names.insert(input.name.as_str()) {
            return Err(format!("duplicate action input '{}'", input.name));
        }
    }
    Ok(())
}

fn validate_task_policy(policy: &WorkflowTaskPolicy) -> Result<(), String> {
    if policy.candidate_role_ids.is_empty()
        && policy.candidate_group_ids.is_empty()
        && policy.candidate_unit_ids.is_empty()
    {
        return Err("task policy requires at least one candidate scope".to_string());
    }
    Ok(())
}

fn validate_timer_policy(policy: &WorkflowTimerPolicy) -> Result<(), String> {
    if policy.delay_seconds == 0 {
        return Err("timer delay must be positive".to_string());
    }
    if let Some(calendar_key) = policy.calendar_key.as_deref() {
        validate_stable_key("calendar key", calendar_key)?;
    }
    Ok(())
}

fn validate_retry_policy(policy: &WorkflowRetryPolicy) -> Result<(), String> {
    match policy.kind {
        WorkflowRetryKind::None => {
            if policy.max_attempts != 1
                || policy.initial_delay_seconds != 0
                || policy.max_delay_seconds != 0
            {
                return Err("None retry policy must have one attempt and zero delays".to_string());
            }
        }
        WorkflowRetryKind::Fixed | WorkflowRetryKind::Exponential => {
            if policy.max_attempts < 2 || policy.initial_delay_seconds == 0 {
                return Err("retry policy requires at least two attempts and a delay".to_string());
            }
            if policy.max_delay_seconds < policy.initial_delay_seconds {
                return Err("retry maximum delay cannot be below its initial delay".to_string());
            }
        }
    }
    Ok(())
}

fn validate_edge_params(
    snapshot_fields: &[ConditionFieldDefinition],
    params: &UpsertWorkflowEdgeParams,
) -> Result<(), String> {
    validate_stable_key("edge key", &params.edge_key)?;
    validate_stable_key("source node key", &params.from_node_key)?;
    validate_stable_key("target node key", &params.to_node_key)?;
    if params.from_node_key == params.to_node_key {
        return Err("workflow edge cannot target its source".to_string());
    }
    if let Some(signal_key) = params.signal_key.as_deref() {
        validate_stable_key("signal key", signal_key)?;
    }
    if let Some(program) = params.condition.as_ref() {
        validate_condition_program(program, snapshot_fields)?;
    }
    Ok(())
}

fn validate_edge(
    snapshot_fields: &[ConditionFieldDefinition],
    edge: &WorkflowEdge,
) -> Result<(), String> {
    validate_stable_key("edge key", &edge.edge_key)?;
    validate_stable_key("source node key", &edge.from_node_key)?;
    validate_stable_key("target node key", &edge.to_node_key)?;
    if let Some(signal_key) = edge.signal_key.as_deref() {
        validate_stable_key("signal key", signal_key)?;
    }
    if let Some(program) = edge.condition.as_ref() {
        validate_condition_program(program, snapshot_fields)?;
    }
    Ok(())
}

fn validate_condition_value(value: &ConditionValue) -> Result<(), String> {
    match value {
        ConditionValue::Decimal(decimal) if decimal.scale > MAX_DECIMAL_SCALE => {
            Err(format!("decimal scale cannot exceed {MAX_DECIMAL_SCALE}"))
        }
        ConditionValue::Money(money)
            if money.currency.len() != 3
                || !money.currency.bytes().all(|byte| byte.is_ascii_uppercase()) =>
        {
            Err("money currency must be a three-letter uppercase code".to_string())
        }
        ConditionValue::Code(code) => validate_stable_key("condition code", code),
        _ => Ok(()),
    }
}

fn validate_comparison_types(
    operator: &ConditionComparison,
    left: &ConditionValueType,
    right: &ConditionValueType,
) -> Result<(), String> {
    let equality = matches!(
        operator,
        ConditionComparison::Equal | ConditionComparison::NotEqual
    );
    if equality && (*left == ConditionValueType::Null || *right == ConditionValueType::Null) {
        return Ok(());
    }
    if left != right {
        return Err(format!(
            "comparison operand types differ: {left:?} and {right:?}"
        ));
    }
    if !equality && matches!(left, ConditionValueType::Null | ConditionValueType::Boolean) {
        return Err(format!("{left:?} values do not support ordered comparison"));
    }
    Ok(())
}

fn pop_boolean(stack: &mut Vec<ConditionValueType>, operation: &str) -> Result<(), String> {
    let value_type = stack
        .pop()
        .ok_or_else(|| format!("{operation} is missing an operand"))?;
    if value_type != ConditionValueType::Boolean {
        return Err(format!("{operation} requires Boolean operands"));
    }
    Ok(())
}

fn validate_required_text(field: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} is required"))
    } else {
        Ok(())
    }
}

fn validate_stable_key(field: &str, value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_STABLE_KEY_LEN {
        return Err(format!(
            "{field} must contain 1..={MAX_STABLE_KEY_LEN} characters"
        ));
    }
    if !value.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'/' | b':')
    }) {
        return Err(format!("{field} contains unsupported characters"));
    }
    Ok(())
}

fn audit_definition_change(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    table_name: &'static str,
    record_id: u64,
    action: &'static str,
    changed_field: &'static str,
) {
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name,
            record_id,
            action,
            old_values: None,
            new_values: None,
            changed_fields: vec![changed_field.to_string()],
            metadata: None,
        },
    );
}

fn put_u8(bytes: &mut Vec<u8>, value: u8) {
    bytes.push(value);
}

fn put_bool(bytes: &mut Vec<u8>, value: bool) {
    put_u8(bytes, u8::from(value));
}

fn put_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_be_bytes());
}

fn put_u64(bytes: &mut Vec<u8>, value: u64) {
    bytes.extend_from_slice(&value.to_be_bytes());
}

fn put_i32(bytes: &mut Vec<u8>, value: i32) {
    bytes.extend_from_slice(&value.to_be_bytes());
}

fn put_i64(bytes: &mut Vec<u8>, value: i64) {
    bytes.extend_from_slice(&value.to_be_bytes());
}

fn put_len(bytes: &mut Vec<u8>, len: usize) -> Result<(), String> {
    let len = u32::try_from(len).map_err(|_| "canonical collection is too large".to_string())?;
    put_u32(bytes, len);
    Ok(())
}

fn put_string(bytes: &mut Vec<u8>, value: &str) {
    put_u64(bytes, value.len() as u64);
    bytes.extend_from_slice(value.as_bytes());
}

fn put_optional_string(bytes: &mut Vec<u8>, value: Option<&str>) {
    put_bool(bytes, value.is_some());
    if let Some(value) = value {
        put_string(bytes, value);
    }
}

fn encode_node(bytes: &mut Vec<u8>, node: &WorkflowNode) -> Result<(), String> {
    put_string(bytes, &node.node_key);
    put_string(bytes, &node.name);
    put_u8(bytes, node_kind_tag(&node.kind));
    put_u32(bytes, node.sequence);
    put_u8(bytes, branch_kind_tag(&node.split_kind));
    put_u8(bytes, branch_kind_tag(&node.join_kind));
    encode_optional_action(bytes, node.action.as_ref())?;
    encode_optional_task(bytes, node.task_policy.as_ref())?;
    encode_optional_timer(bytes, node.timer_policy.as_ref());
    encode_optional_retry(bytes, node.retry_policy.as_ref());
    put_bool(bytes, node.subflow.is_some());
    if let Some(subflow) = node.subflow.as_ref() {
        put_u64(bytes, subflow.workflow_id);
        put_u64(bytes, subflow.workflow_version_id);
    }
    put_optional_string(bytes, node.metadata.as_deref());
    Ok(())
}

fn encode_edge(bytes: &mut Vec<u8>, edge: &WorkflowEdge) -> Result<(), String> {
    put_string(bytes, &edge.edge_key);
    put_string(bytes, &edge.from_node_key);
    put_string(bytes, &edge.to_node_key);
    put_u32(bytes, edge.sequence);
    put_optional_string(bytes, edge.signal_key.as_deref());
    put_bool(bytes, edge.condition.is_some());
    if let Some(condition) = edge.condition.as_ref() {
        put_len(bytes, condition.instructions.len())?;
        for instruction in &condition.instructions {
            encode_instruction(bytes, instruction);
        }
    }
    put_optional_string(bytes, edge.metadata.as_deref());
    Ok(())
}

fn encode_optional_action(
    bytes: &mut Vec<u8>,
    action: Option<&WorkflowActionReference>,
) -> Result<(), String> {
    put_bool(bytes, action.is_some());
    if let Some(action) = action {
        put_string(bytes, &action.action_key);
        put_u32(bytes, action.input_schema_version);
        let mut input: Vec<_> = action.input.iter().collect();
        input.sort_by(|left, right| left.name.cmp(&right.name));
        put_len(bytes, input.len())?;
        for item in input {
            put_string(bytes, &item.name);
            encode_value(bytes, &item.value);
        }
    }
    Ok(())
}

fn encode_optional_task(
    bytes: &mut Vec<u8>,
    policy: Option<&WorkflowTaskPolicy>,
) -> Result<(), String> {
    put_bool(bytes, policy.is_some());
    if let Some(policy) = policy {
        put_u8(bytes, human_task_kind_tag(&policy.kind));
        put_u8(bytes, task_assignment_tag(&policy.assignment));
        encode_sorted_u64s(bytes, &policy.candidate_role_ids)?;
        encode_sorted_u64s(bytes, &policy.candidate_group_ids)?;
        encode_sorted_u64s(bytes, &policy.candidate_unit_ids)?;
        put_bool(bytes, policy.require_comment_on_reject);
    }
    Ok(())
}

fn encode_optional_timer(bytes: &mut Vec<u8>, policy: Option<&WorkflowTimerPolicy>) {
    put_bool(bytes, policy.is_some());
    if let Some(policy) = policy {
        put_u8(bytes, timer_kind_tag(&policy.kind));
        put_u64(bytes, policy.delay_seconds);
        put_optional_string(bytes, policy.calendar_key.as_deref());
    }
}

fn encode_optional_retry(bytes: &mut Vec<u8>, policy: Option<&WorkflowRetryPolicy>) {
    put_bool(bytes, policy.is_some());
    if let Some(policy) = policy {
        put_u8(bytes, retry_kind_tag(&policy.kind));
        put_u32(bytes, policy.max_attempts);
        put_u64(bytes, policy.initial_delay_seconds);
        put_u64(bytes, policy.max_delay_seconds);
    }
}

fn encode_sorted_u64s(bytes: &mut Vec<u8>, values: &[u64]) -> Result<(), String> {
    let mut values = values.to_vec();
    values.sort_unstable();
    put_len(bytes, values.len())?;
    for value in values {
        put_u64(bytes, value);
    }
    Ok(())
}

fn encode_instruction(bytes: &mut Vec<u8>, instruction: &ConditionInstruction) {
    match instruction {
        ConditionInstruction::PushValue(value) => {
            put_u8(bytes, 0);
            encode_value(bytes, value);
        }
        ConditionInstruction::LoadField(field_key) => {
            put_u8(bytes, 1);
            put_string(bytes, field_key);
        }
        ConditionInstruction::Compare(operator) => {
            put_u8(bytes, 2);
            put_u8(bytes, comparison_tag(operator));
        }
        ConditionInstruction::And => put_u8(bytes, 3),
        ConditionInstruction::Or => put_u8(bytes, 4),
        ConditionInstruction::Not => put_u8(bytes, 5),
    }
}

fn encode_value(bytes: &mut Vec<u8>, value: &ConditionValue) {
    put_u8(bytes, value_type_tag(&value.value_type()));
    match value {
        ConditionValue::Null => {}
        ConditionValue::Boolean(value) => put_bool(bytes, *value),
        ConditionValue::Integer(value) => put_i64(bytes, *value),
        ConditionValue::Decimal(value) => {
            put_i64(bytes, value.coefficient);
            put_u32(bytes, value.scale);
        }
        ConditionValue::Money(value) => {
            put_i64(bytes, value.minor_units);
            put_string(bytes, &value.currency);
        }
        ConditionValue::Text(value) | ConditionValue::Code(value) => put_string(bytes, value),
        ConditionValue::Date(value) => put_i32(bytes, *value),
        ConditionValue::Timestamp(value) => put_i64(bytes, *value),
    }
}

fn trigger_tag(value: &WorkflowTrigger) -> u8 {
    match value {
        WorkflowTrigger::Manual => 0,
        WorkflowTrigger::RecordCreated => 1,
        WorkflowTrigger::RecordChanged => 2,
        WorkflowTrigger::Signal => 3,
    }
}

fn node_kind_tag(value: &WorkflowNodeKind) -> u8 {
    match value {
        WorkflowNodeKind::Start => 0,
        WorkflowNodeKind::End => 1,
        WorkflowNodeKind::Decision => 2,
        WorkflowNodeKind::HumanTask => 3,
        WorkflowNodeKind::Action => 4,
        WorkflowNodeKind::Timer => 5,
        WorkflowNodeKind::Fork => 6,
        WorkflowNodeKind::Join => 7,
        WorkflowNodeKind::Subflow => 8,
    }
}

fn branch_kind_tag(value: &WorkflowBranchKind) -> u8 {
    match value {
        WorkflowBranchKind::None => 0,
        WorkflowBranchKind::Xor => 1,
        WorkflowBranchKind::Or => 2,
        WorkflowBranchKind::And => 3,
    }
}

fn value_type_tag(value: &ConditionValueType) -> u8 {
    match value {
        ConditionValueType::Null => 0,
        ConditionValueType::Boolean => 1,
        ConditionValueType::Integer => 2,
        ConditionValueType::Decimal => 3,
        ConditionValueType::Money => 4,
        ConditionValueType::Text => 5,
        ConditionValueType::Date => 6,
        ConditionValueType::Timestamp => 7,
        ConditionValueType::Code => 8,
    }
}

fn comparison_tag(value: &ConditionComparison) -> u8 {
    match value {
        ConditionComparison::Equal => 0,
        ConditionComparison::NotEqual => 1,
        ConditionComparison::LessThan => 2,
        ConditionComparison::LessThanOrEqual => 3,
        ConditionComparison::GreaterThan => 4,
        ConditionComparison::GreaterThanOrEqual => 5,
    }
}

fn human_task_kind_tag(value: &WorkflowHumanTaskKind) -> u8 {
    match value {
        WorkflowHumanTaskKind::ApproveReject => 0,
        WorkflowHumanTaskKind::Complete => 1,
        WorkflowHumanTaskKind::EvidenceReview => 2,
    }
}

fn task_assignment_tag(value: &WorkflowTaskAssignment) -> u8 {
    match value {
        WorkflowTaskAssignment::AnyCandidate => 0,
        WorkflowTaskAssignment::SingleCandidate => 1,
        WorkflowTaskAssignment::AllCandidates => 2,
    }
}

fn timer_kind_tag(value: &WorkflowTimerKind) -> u8 {
    match value {
        WorkflowTimerKind::Delay => 0,
        WorkflowTimerKind::Deadline => 1,
        WorkflowTimerKind::Escalation => 2,
    }
}

fn retry_kind_tag(value: &WorkflowRetryKind) -> u8 {
    match value {
        WorkflowRetryKind::None => 0,
        WorkflowRetryKind::Fixed => 1,
        WorkflowRetryKind::Exponential => 2,
    }
}
