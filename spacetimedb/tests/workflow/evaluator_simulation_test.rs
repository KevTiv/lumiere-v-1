//! Typed evaluator and deterministic side-effect-free simulation tests.

use spacetimedb::{ReducerContext, Table};

use crate::core::queue::queue_job;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::workflow::definitions::{
    create_workflow, publish_workflow_version, upsert_workflow_edge, upsert_workflow_node,
    workflow, workflow_node, workflow_version, ConditionComparison, ConditionFieldDefinition,
    ConditionInstruction, ConditionProgram, ConditionValue, ConditionValueType,
    CreateWorkflowParams, FixedPointDecimal, MoneyValue, UpsertWorkflowEdgeParams,
    UpsertWorkflowNodeParams, WorkflowActionReference, WorkflowBranchKind, WorkflowEdge,
    WorkflowHumanTaskKind, WorkflowNode, WorkflowNodeKind, WorkflowTaskAssignment,
    WorkflowTaskPolicy, WorkflowTrigger, WorkflowVersion, WorkflowVersionStatus,
};
use crate::workflow::evaluator::{
    evaluate_condition_program, ConditionEvaluationErrorKind, ConditionSnapshot,
    ConditionSnapshotField,
};
use crate::workflow::runtime::{workflow_instance, workflow_token};
use crate::workflow::simulation::{
    canonical_simulation_trace_bytes, plan_workflow_simulation, simulate_workflow,
    workflow_simulation_result, workflow_simulation_step, SimulateWorkflowParams,
    WorkflowSimulationStepKind,
};

pub fn test_workflow_evaluator_and_simulation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    test_condition_outcomes()?;
    test_trace_is_byte_identical(ctx)?;
    test_simulation_writes_only_simulation_tables(ctx)?;
    Ok(())
}

fn test_condition_outcomes() -> Result<(), String> {
    let money_schema = vec![field("amount", ConditionValueType::Money, true)];
    let greater_than_usd_100 = binary_program(
        "amount",
        ConditionValue::Money(MoneyValue {
            minor_units: 10_000,
            currency: "USD".to_string(),
        }),
        ConditionComparison::GreaterThan,
    );
    let usd_snapshot = snapshot(vec![snapshot_field(
        "amount",
        ConditionValue::Money(MoneyValue {
            minor_units: 15_000,
            currency: "USD".to_string(),
        }),
    )]);
    if !evaluate_condition_program(&greater_than_usd_100, &money_schema, &usd_snapshot)
        .map_err(|error| error.to_string())?
    {
        return Err("money comparison returned false".to_string());
    }

    assert_error_kind(
        evaluate_condition_program(
            &greater_than_usd_100,
            &money_schema,
            &snapshot(vec![snapshot_field(
                "amount",
                ConditionValue::Money(MoneyValue {
                    minor_units: 15_000,
                    currency: "EUR".to_string(),
                }),
            )]),
        ),
        ConditionEvaluationErrorKind::CurrencyMismatch,
    )?;
    assert_error_kind(
        evaluate_condition_program(&greater_than_usd_100, &money_schema, &snapshot(Vec::new())),
        ConditionEvaluationErrorKind::MissingField,
    )?;
    assert_error_kind(
        evaluate_condition_program(
            &greater_than_usd_100,
            &money_schema,
            &snapshot(vec![snapshot_field("amount", ConditionValue::Null)]),
        ),
        ConditionEvaluationErrorKind::NullOperand,
    )?;
    assert_error_kind(
        evaluate_condition_program(
            &greater_than_usd_100,
            &money_schema,
            &snapshot(vec![snapshot_field(
                "amount",
                ConditionValue::Integer(15_000),
            )]),
        ),
        ConditionEvaluationErrorKind::TypeMismatch,
    )?;

    let optional_text_schema = vec![field("memo", ConditionValueType::Text, true)];
    let is_null = binary_program("memo", ConditionValue::Null, ConditionComparison::Equal);
    if !evaluate_condition_program(
        &is_null,
        &optional_text_schema,
        &snapshot(vec![snapshot_field("memo", ConditionValue::Null)]),
    )
    .map_err(|error| error.to_string())?
    {
        return Err("explicit null equality returned false".to_string());
    }

    let decimal_schema = vec![field("ratio", ConditionValueType::Decimal, false)];
    let equivalent_scale = binary_program(
        "ratio",
        ConditionValue::Decimal(FixedPointDecimal {
            coefficient: 100,
            scale: 2,
        }),
        ConditionComparison::Equal,
    );
    if !evaluate_condition_program(
        &equivalent_scale,
        &decimal_schema,
        &snapshot(vec![snapshot_field(
            "ratio",
            ConditionValue::Decimal(FixedPointDecimal {
                coefficient: 1,
                scale: 0,
            }),
        )]),
    )
    .map_err(|error| error.to_string())?
    {
        return Err("equal fixed-point values with different scales did not match".to_string());
    }
    Ok(())
}

fn test_trace_is_byte_identical(ctx: &ReducerContext) -> Result<(), String> {
    let (workflow, version, mut nodes, mut edges) = pure_definition(ctx);
    let condition_snapshot = snapshot(vec![snapshot_field(
        "amount",
        ConditionValue::Money(MoneyValue {
            minor_units: 15_000,
            currency: "USD".to_string(),
        }),
    )]);
    let first = plan_workflow_simulation(
        &workflow,
        &version,
        &nodes,
        &edges,
        &condition_snapshot,
        None,
    )?;
    nodes.reverse();
    edges.reverse();
    let second = plan_workflow_simulation(
        &workflow,
        &version,
        &nodes,
        &edges,
        &condition_snapshot,
        None,
    )?;
    if canonical_simulation_trace_bytes(&first)? != canonical_simulation_trace_bytes(&second)? {
        return Err("identical snapshot produced different canonical traces".to_string());
    }
    if !first.steps.iter().any(|step| {
        step.kind == WorkflowSimulationStepKind::HumanTaskProposed
            && step.node_key.as_deref() == Some("approve")
    }) || !first.steps.iter().any(|step| {
        step.kind == WorkflowSimulationStepKind::ActionProposed
            && step.detail == "confirm_purchase_order"
    }) {
        return Err("simulation did not trace proposed task and action effects".to_string());
    }
    Ok(())
}

fn test_simulation_writes_only_simulation_tables(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    create_workflow(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            workflow_key: format!("wf.simulation.{}", fixture.organization_id),
            model: "purchase.order".to_string(),
            name: "Simulation safety".to_string(),
            description: None,
            trigger: WorkflowTrigger::Manual,
            schema_version: 1,
            snapshot_fields: Vec::new(),
            metadata: None,
        },
    )?;
    let workflow = ctx
        .db
        .workflow()
        .workflow_by_org()
        .filter(&fixture.organization_id)
        .max_by_key(|row| row.id)
        .ok_or_else(|| "simulation test workflow missing".to_string())?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow.id)
        .find(|row| row.status == WorkflowVersionStatus::Draft)
        .ok_or_else(|| "simulation test draft missing".to_string())?;
    upsert_workflow_node(
        ctx,
        fixture.organization_id,
        version.id,
        1,
        upsert_node("start", WorkflowNodeKind::Start, 1),
    )?;
    upsert_workflow_node(
        ctx,
        fixture.organization_id,
        version.id,
        2,
        upsert_node("end", WorkflowNodeKind::End, 2),
    )?;
    upsert_workflow_edge(
        ctx,
        fixture.organization_id,
        version.id,
        3,
        UpsertWorkflowEdgeParams {
            edge_key: "start-end".to_string(),
            from_node_key: "start".to_string(),
            to_node_key: "end".to_string(),
            sequence: 1,
            signal_key: None,
            condition: None,
            metadata: None,
        },
    )?;
    publish_workflow_version(ctx, fixture.organization_id, version.id, 4)?;

    let runtime_before = ctx.db.workflow_instance().iter().count();
    let tokens_before = ctx.db.workflow_token().iter().count();
    let queue_before = ctx.db.queue_job().iter().count();
    let definitions_before = ctx.db.workflow_node().iter().count();
    let results_before = ctx.db.workflow_simulation_result().iter().count();
    let steps_before = ctx.db.workflow_simulation_step().iter().count();

    simulate_workflow(
        ctx,
        fixture.organization_id,
        version.id,
        SimulateWorkflowParams {
            simulation_key: format!("simulation:{}", version.id),
            signal_key: None,
            snapshot: ConditionSnapshot {
                subject_model: "purchase.order".to_string(),
                subject_id: fixture.partner_id,
                subject_revision_hash: "sha256:test-subject-revision".to_string(),
                fields: Vec::new(),
            },
        },
    )?;

    if ctx.db.workflow_instance().iter().count() != runtime_before
        || ctx.db.workflow_token().iter().count() != tokens_before
        || ctx.db.queue_job().iter().count() != queue_before
        || ctx.db.workflow_node().iter().count() != definitions_before
    {
        return Err("simulation mutated a non-simulation table".to_string());
    }
    if ctx.db.workflow_simulation_result().iter().count() != results_before + 1
        || ctx.db.workflow_simulation_step().iter().count() <= steps_before
    {
        return Err("simulation did not persist its result and ordered steps".to_string());
    }
    Ok(())
}

fn assert_error_kind(
    result: Result<bool, crate::workflow::evaluator::ConditionEvaluationError>,
    expected: ConditionEvaluationErrorKind,
) -> Result<(), String> {
    let error = result
        .err()
        .ok_or_else(|| format!("expected condition error {expected:?}"))?;
    if error.kind != expected {
        return Err(format!(
            "unexpected condition error {:?}, expected {expected:?}: {}",
            error.kind, error.message
        ));
    }
    Ok(())
}

fn binary_program(
    field_key: &str,
    right: ConditionValue,
    comparison: ConditionComparison,
) -> ConditionProgram {
    ConditionProgram {
        instructions: vec![
            ConditionInstruction::LoadField(field_key.to_string()),
            ConditionInstruction::PushValue(right),
            ConditionInstruction::Compare(comparison),
        ],
    }
}

fn field(
    field_key: &str,
    value_type: ConditionValueType,
    nullable: bool,
) -> ConditionFieldDefinition {
    ConditionFieldDefinition {
        field_key: field_key.to_string(),
        value_type,
        nullable,
    }
}

fn snapshot(fields: Vec<ConditionSnapshotField>) -> ConditionSnapshot {
    ConditionSnapshot {
        subject_model: "purchase.order".to_string(),
        subject_id: 42,
        subject_revision_hash: "sha256:subject-revision".to_string(),
        fields,
    }
}

fn snapshot_field(field_key: &str, value: ConditionValue) -> ConditionSnapshotField {
    ConditionSnapshotField {
        field_key: field_key.to_string(),
        value,
    }
}

fn pure_definition(
    ctx: &ReducerContext,
) -> (
    crate::workflow::definitions::Workflow,
    WorkflowVersion,
    Vec<WorkflowNode>,
    Vec<WorkflowEdge>,
) {
    let identity = ctx.sender();
    let timestamp = ctx.timestamp;
    let workflow = crate::workflow::definitions::Workflow {
        id: 9_001,
        organization_id: 1,
        company_id: Some(1),
        workflow_key: "wf.pure.simulation".to_string(),
        model: "purchase.order".to_string(),
        create_uid: identity,
        create_date: timestamp,
    };
    let version = WorkflowVersion {
        id: 9_002,
        organization_id: 1,
        company_id: Some(1),
        workflow_id: workflow.id,
        version: 1,
        status: WorkflowVersionStatus::Draft,
        schema_version: 1,
        draft_revision: 1,
        name: "Pure simulation".to_string(),
        description: None,
        trigger: WorkflowTrigger::Manual,
        snapshot_fields: vec![field("amount", ConditionValueType::Money, false)],
        content_hash: None,
        create_uid: identity,
        create_date: timestamp,
        published_uid: None,
        published_date: None,
        retired_uid: None,
        retired_date: None,
        metadata: None,
    };

    let start = row_node(ctx, 1, "start", WorkflowNodeKind::Start, 1);
    let decision = row_node(ctx, 2, "route", WorkflowNodeKind::Decision, 2);
    let mut approve = row_node(ctx, 3, "approve", WorkflowNodeKind::HumanTask, 3);
    approve.task_policy = Some(WorkflowTaskPolicy {
        kind: WorkflowHumanTaskKind::ApproveReject,
        assignment: WorkflowTaskAssignment::AnyCandidate,
        candidate_role_ids: vec![1],
        candidate_group_ids: Vec::new(),
        candidate_unit_ids: Vec::new(),
        require_comment_on_reject: true,
    });
    let mut action = row_node(ctx, 4, "confirm", WorkflowNodeKind::Action, 4);
    action.action = Some(WorkflowActionReference {
        action_key: "confirm_purchase_order".to_string(),
        input_schema_version: 1,
        input: Vec::new(),
    });
    let rejected = row_node(ctx, 5, "rejected", WorkflowNodeKind::End, 5);
    let accepted = row_node(ctx, 6, "accepted", WorkflowNodeKind::End, 6);

    let high_value = binary_program(
        "amount",
        ConditionValue::Money(MoneyValue {
            minor_units: 10_000,
            currency: "USD".to_string(),
        }),
        ConditionComparison::GreaterThan,
    );
    let low_value = binary_program(
        "amount",
        ConditionValue::Money(MoneyValue {
            minor_units: 10_000,
            currency: "USD".to_string(),
        }),
        ConditionComparison::LessThanOrEqual,
    );
    let nodes = vec![start, decision, approve, action, rejected, accepted];
    let edges = vec![
        row_edge(ctx, 1, "start-route", "start", "route", None),
        row_edge(
            ctx,
            2,
            "route-approve",
            "route",
            "approve",
            Some(high_value),
        ),
        row_edge(
            ctx,
            3,
            "route-rejected",
            "route",
            "rejected",
            Some(low_value),
        ),
        row_edge(ctx, 4, "approve-confirm", "approve", "confirm", None),
        row_edge(ctx, 5, "confirm-accepted", "confirm", "accepted", None),
    ];
    (workflow, version, nodes, edges)
}

fn row_node(
    ctx: &ReducerContext,
    id: u64,
    node_key: &str,
    kind: WorkflowNodeKind,
    sequence: u32,
) -> WorkflowNode {
    WorkflowNode {
        id,
        organization_id: 1,
        company_id: Some(1),
        workflow_id: 9_001,
        workflow_version_id: 9_002,
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
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    }
}

fn row_edge(
    ctx: &ReducerContext,
    id: u64,
    edge_key: &str,
    from: &str,
    to: &str,
    condition: Option<ConditionProgram>,
) -> WorkflowEdge {
    WorkflowEdge {
        id,
        organization_id: 1,
        company_id: Some(1),
        workflow_id: 9_001,
        workflow_version_id: 9_002,
        edge_key: edge_key.to_string(),
        from_node_key: from.to_string(),
        to_node_key: to.to_string(),
        sequence: id as u32,
        signal_key: None,
        condition,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    }
}

fn upsert_node(node_key: &str, kind: WorkflowNodeKind, sequence: u32) -> UpsertWorkflowNodeParams {
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
