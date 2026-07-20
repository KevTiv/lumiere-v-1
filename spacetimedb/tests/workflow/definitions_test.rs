//! Focused immutable workflow definition tests.
//!
//! The integration owner registers this module and its aggregate reducer.

use spacetimedb::{ReducerContext, Table};

use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::workflow::definitions::{
    canonical_definition_hash, create_workflow, publish_workflow_version, upsert_workflow_edge,
    upsert_workflow_node, validate_workflow_graph, workflow, workflow_edge, workflow_node,
    workflow_version, ConditionFieldDefinition, CreateWorkflowParams, UpsertWorkflowEdgeParams,
    UpsertWorkflowNodeParams, WorkflowActionReference, WorkflowBranchKind, WorkflowEdge,
    WorkflowNode, WorkflowNodeKind, WorkflowTrigger, WorkflowVersionStatus,
};

pub fn test_workflow_definitions(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    test_hash_publish_and_immutability(ctx)?;
    test_stale_draft_revision(ctx)?;
    test_invalid_graphs(ctx)?;
    Ok(())
}

fn test_hash_publish_and_immutability(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (workflow_id, version_id) = create_empty_draft(ctx, &fixture, "wf.hash")?;

    upsert_workflow_node(
        ctx,
        fixture.organization_id,
        version_id,
        1,
        node("start", WorkflowNodeKind::Start, 1),
    )?;
    upsert_workflow_node(
        ctx,
        fixture.organization_id,
        version_id,
        2,
        node("end", WorkflowNodeKind::End, 2),
    )?;
    upsert_workflow_edge(
        ctx,
        fixture.organization_id,
        version_id,
        3,
        edge("start-end", "start", "end"),
    )?;

    let workflow = ctx
        .db
        .workflow()
        .id()
        .find(&workflow_id)
        .ok_or("workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .id()
        .find(&version_id)
        .ok_or("version missing")?;
    let mut nodes: Vec<_> = ctx
        .db
        .workflow_node()
        .workflow_node_by_version()
        .filter(&version_id)
        .collect();
    let mut edges: Vec<_> = ctx
        .db
        .workflow_edge()
        .workflow_edge_by_version()
        .filter(&version_id)
        .collect();
    let first_hash = canonical_definition_hash(&workflow, &version, &nodes, &edges)?;
    nodes.reverse();
    edges.reverse();
    let reordered_hash = canonical_definition_hash(&workflow, &version, &nodes, &edges)?;
    if first_hash != reordered_hash || !first_hash.starts_with("sha256:") {
        return Err("canonical workflow hash is not deterministic".to_string());
    }

    publish_workflow_version(ctx, fixture.organization_id, version_id, 4)?;
    let published = ctx
        .db
        .workflow_version()
        .id()
        .find(&version_id)
        .ok_or("published version missing")?;
    if published.status != WorkflowVersionStatus::Published
        || published.content_hash.as_deref() != Some(&first_hash)
    {
        return Err("published workflow did not retain its canonical hash".to_string());
    }
    let immutable = upsert_workflow_node(
        ctx,
        fixture.organization_id,
        version_id,
        4,
        node("end", WorkflowNodeKind::End, 99),
    )
    .err()
    .ok_or("published workflow accepted a node edit")?;
    if !immutable.contains("immutable") {
        return Err(format!("unexpected immutability error: {immutable}"));
    }
    Ok(())
}

fn test_stale_draft_revision(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (_, version_id) = create_empty_draft(ctx, &fixture, "wf.stale")?;
    upsert_workflow_node(
        ctx,
        fixture.organization_id,
        version_id,
        1,
        node("start", WorkflowNodeKind::Start, 1),
    )?;
    let error = upsert_workflow_node(
        ctx,
        fixture.organization_id,
        version_id,
        1,
        node("end", WorkflowNodeKind::End, 2),
    )
    .err()
    .ok_or("stale draft edit succeeded")?;
    if !error.contains("stale workflow draft revision") {
        return Err(format!("unexpected stale revision error: {error}"));
    }
    if ctx
        .db
        .workflow_node()
        .workflow_node_by_version()
        .filter(&version_id)
        .any(|row| row.node_key == "end")
    {
        return Err("stale draft edit inserted a node".to_string());
    }
    Ok(())
}

fn test_invalid_graphs(ctx: &ReducerContext) -> Result<(), String> {
    let identity = ctx.sender();
    let timestamp = ctx.timestamp;
    let start = row_node(identity, timestamp, 1, "start", WorkflowNodeKind::Start);
    let end = row_node(identity, timestamp, 2, "end", WorkflowNodeKind::End);
    let orphan = row_node(identity, timestamp, 3, "orphan", WorkflowNodeKind::Decision);
    let direct = row_edge(identity, timestamp, 1, "direct", "start", "end");
    let unreachable = validate_workflow_graph(
        &[],
        &[start.clone(), end.clone(), orphan.clone()],
        &[direct.clone()],
    )
    .err()
    .ok_or("unreachable graph validated")?;
    if !unreachable
        .iter()
        .any(|error| error.contains("unreachable"))
    {
        return Err("unreachable graph did not report reachability".to_string());
    }

    let into_orphan = row_edge(identity, timestamp, 2, "into-orphan", "start", "orphan");
    let cycle = row_edge(identity, timestamp, 3, "cycle", "orphan", "start");
    let cyclic = validate_workflow_graph(
        &[],
        &[start.clone(), end.clone(), orphan],
        &[direct, into_orphan, cycle],
    )
    .err()
    .ok_or("cyclic graph validated")?;
    if !cyclic.iter().any(|error| error.contains("cycle")) {
        return Err("cyclic graph did not report its cycle".to_string());
    }

    let mut invalid_end = end;
    invalid_end.kind = WorkflowNodeKind::Action;
    let invalid = validate_workflow_graph(&[], &[start, invalid_end], &[])
        .err()
        .ok_or("invalid node configuration validated")?;
    if !invalid
        .iter()
        .any(|error| error.contains("registered action"))
    {
        return Err("invalid graph did not report its missing action".to_string());
    }

    let mut unregistered = row_node(
        identity,
        timestamp,
        4,
        "unregistered",
        WorkflowNodeKind::Action,
    );
    unregistered.action = Some(WorkflowActionReference {
        action_key: "arbitrary.reducer".to_string(),
        input_schema_version: 1,
        input: Vec::new(),
    });
    let errors = validate_workflow_graph(&[], &[unregistered], &[])
        .err()
        .ok_or("unregistered action validated")?;
    if !errors
        .iter()
        .any(|error| error.contains("unregistered guarded action"))
    {
        return Err("invalid graph did not reject an unregistered action".to_string());
    }
    Ok(())
}

fn create_empty_draft(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    workflow_key: &str,
) -> Result<(u64, u64), String> {
    create_workflow(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            workflow_key: workflow_key.to_string(),
            model: "purchase.order".to_string(),
            name: "Definition test".to_string(),
            description: None,
            trigger: WorkflowTrigger::Manual,
            schema_version: 1,
            snapshot_fields: Vec::<ConditionFieldDefinition>::new(),
            metadata: None,
        },
    )?;
    let workflow = ctx
        .db
        .workflow()
        .iter()
        .find(|row| {
            row.organization_id == fixture.organization_id && row.workflow_key == workflow_key
        })
        .ok_or("created workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow.id)
        .find(|row| row.status == WorkflowVersionStatus::Draft)
        .ok_or("created workflow draft missing")?;
    Ok((workflow.id, version.id))
}

fn node(node_key: &str, kind: WorkflowNodeKind, sequence: u32) -> UpsertWorkflowNodeParams {
    UpsertWorkflowNodeParams {
        node_key: node_key.to_string(),
        name: node_key.to_string(),
        kind,
        sequence,
        split_kind: WorkflowBranchKind::None,
        join_kind: WorkflowBranchKind::None,
        action: None,
        task_policy: None,
        timer_policy: None,
        retry_policy: None,
        subflow: None,
        metadata: None,
    }
}

fn edge(edge_key: &str, from: &str, to: &str) -> UpsertWorkflowEdgeParams {
    UpsertWorkflowEdgeParams {
        edge_key: edge_key.to_string(),
        from_node_key: from.to_string(),
        to_node_key: to.to_string(),
        sequence: 1,
        signal_key: None,
        condition: None,
        metadata: None,
    }
}

fn row_node(
    identity: spacetimedb::Identity,
    timestamp: spacetimedb::Timestamp,
    id: u64,
    key: &str,
    kind: WorkflowNodeKind,
) -> WorkflowNode {
    WorkflowNode {
        id,
        organization_id: 1,
        company_id: Some(1),
        workflow_id: 1,
        workflow_version_id: 1,
        node_key: key.to_string(),
        name: key.to_string(),
        kind,
        sequence: id as u32,
        split_kind: WorkflowBranchKind::None,
        join_kind: WorkflowBranchKind::None,
        action: None,
        task_policy: None,
        timer_policy: None,
        retry_policy: None,
        subflow: None,
        create_uid: identity,
        create_date: timestamp,
        write_uid: identity,
        write_date: timestamp,
        metadata: None,
    }
}

fn row_edge(
    identity: spacetimedb::Identity,
    timestamp: spacetimedb::Timestamp,
    id: u64,
    key: &str,
    from: &str,
    to: &str,
) -> WorkflowEdge {
    WorkflowEdge {
        id,
        organization_id: 1,
        company_id: Some(1),
        workflow_id: 1,
        workflow_version_id: 1,
        edge_key: key.to_string(),
        from_node_key: from.to_string(),
        to_node_key: to.to_string(),
        sequence: id as u32,
        signal_key: None,
        condition: None,
        create_uid: identity,
        create_date: timestamp,
        write_uid: identity,
        write_date: timestamp,
        metadata: None,
    }
}
