//! Runtime concurrency, idempotency and terminal-state tests.

use spacetimedb::{ReducerContext, Table};

use crate::core::persistence::{organization_commit, organization_row_change};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::purchasing::purchase_orders::{
    create_purchase_order, purchase_order, CreatePurchaseOrderParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::workflow::definitions::{
    create_workflow, publish_workflow_version, upsert_workflow_edge, upsert_workflow_node,
    workflow, workflow_version, ConditionComparison, ConditionFieldDefinition,
    ConditionInstruction, ConditionProgram, ConditionValue, ConditionValueType,
    CreateWorkflowParams, MoneyValue, UpsertWorkflowEdgeParams, UpsertWorkflowNodeParams,
    WorkflowBranchKind, WorkflowNodeKind, WorkflowTrigger, WorkflowVersionStatus,
};
use crate::workflow::evaluator::{
    canonical_condition_snapshot_hash, ConditionSnapshot, ConditionSnapshotField,
};
use crate::workflow::runtime::{
    cancel_workflow, signal_workflow, start_workflow, workflow_command_receipt,
    workflow_decision_event, workflow_instance, workflow_token, CancelWorkflowParams,
    SignalWorkflowParams, StartWorkflowParams, WorkflowCommandKind, WorkflowInstanceState,
    WorkflowTokenState,
};

const REVISION_B: &str = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

pub fn test_workflow_runtime(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    test_start_replay_mismatch_singleton_and_scope(ctx)?;
    test_signal_replay_stale_and_terminal(ctx)?;
    test_cancel_replay_and_terminal_behavior(ctx)?;
    Ok(())
}

fn test_start_replay_mismatch_singleton_and_scope(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (workflow_id, version_id) = seed_runtime_definition(ctx, &fixture, "runtime.start", true)?;
    let subject_id = seed_purchase_order_subject(ctx, &fixture, "wf-runtime-start")?;
    let params = start_params(
        &fixture,
        workflow_id,
        version_id,
        subject_id,
        "start-101",
        Some("record-101"),
    );

    start_workflow(ctx, fixture.organization_id, params.clone())?;
    let instance = latest_instance(ctx, fixture.organization_id, workflow_id)?;
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&fixture.organization_id)
        .collect();
    let commit = commits
        .iter()
        .max_by_key(|commit| commit.sequence)
        .ok_or("workflow start commit missing")?;
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter(&fixture.organization_id)
        .filter(|change| change.commit_sequence == commit.sequence)
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    let token_id = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
        .next()
        .map(|token| token.id)
        .ok_or("workflow start token missing")?;
    if commit.operation_id != "erp.start_workflow"
        || commit.row_change_count != 2
        || changes.len() != 2
        || changes[0].table_name != "workflow_instance"
        || changes[1].table_name != "workflow_token"
        || changes[0].row_identity_json != format!(r#"{{"id":{}}}"#, instance.id)
        || changes[1].row_identity_json != format!(r#"{{"id":{token_id}}}"#)
        || changes[0].ordinal != 0
        || changes[1].ordinal != 1
        || changes
            .iter()
            .any(|change| change.organization_id != fixture.organization_id)
    {
        return Err(
            "workflow start commit did not preserve parent-before-child org rows".to_string(),
        );
    }
    let counts = runtime_counts(ctx, instance.id);
    start_workflow(ctx, fixture.organization_id, params.clone())?;
    if runtime_counts(ctx, instance.id) != counts {
        return Err("identical start replay changed runtime state".to_string());
    }
    let receipt = ctx
        .db
        .workflow_command_receipt()
        .workflow_receipt_by_instance()
        .filter(&instance.id)
        .find(|row| row.command_kind == WorkflowCommandKind::Start)
        .ok_or("start receipt missing")?;
    if receipt.result_instance_id != instance.id
        || receipt.result_instance_revision != 1
        || receipt.result_instance_state != WorkflowInstanceState::Active
        || receipt.result_token_ids.len() != 1
    {
        return Err("start receipt did not retain stable replay result".to_string());
    }

    let mut reused = params.clone();
    reused.subject_revision_hash = REVISION_B.to_string();
    let error = start_workflow(ctx, fixture.organization_id, reused)
        .err()
        .ok_or("changed start input reused an idempotency key")?;
    if !error.contains("different input") || runtime_counts(ctx, instance.id) != counts {
        return Err(format!("start key mismatch was not atomic: {error}"));
    }

    let mut singleton_collision = params;
    singleton_collision.idempotency_key = "start-101-other-command".to_string();
    singleton_collision.correlation_id = "corr-start-other".to_string();
    let error = start_workflow(ctx, fixture.organization_id, singleton_collision)
        .err()
        .ok_or("singleton trigger started twice")?;
    if !error.contains("already started") || runtime_counts(ctx, instance.id) != counts {
        return Err(format!("singleton start conflict was not atomic: {error}"));
    }

    let other = OrgFixture::seed_minimal(ctx)?;
    let mut cross_company = start_params(
        &fixture,
        workflow_id,
        version_id,
        102,
        "start-cross-company",
        Some("record-102"),
    );
    cross_company.company_id = other.company_id;
    let before_instances = ctx
        .db
        .workflow_instance()
        .instance_by_org()
        .filter(&fixture.organization_id)
        .count();
    let error = start_workflow(ctx, fixture.organization_id, cross_company)
        .err()
        .ok_or("cross-organization company started a workflow")?;
    if !error.contains("does not belong to this organization")
        || ctx
            .db
            .workflow_instance()
            .instance_by_org()
            .filter(&fixture.organization_id)
            .count()
            != before_instances
    {
        return Err(format!("cross-company start was not atomic: {error}"));
    }
    Ok(())
}

fn test_signal_replay_stale_and_terminal(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (workflow_id, version_id) =
        seed_runtime_definition(ctx, &fixture, "runtime.signal", false)?;
    let subject_id = seed_purchase_order_subject(ctx, &fixture, "wf-runtime-signal")?;
    start_workflow(
        ctx,
        fixture.organization_id,
        start_params(
            &fixture,
            workflow_id,
            version_id,
            subject_id,
            "start-201",
            None,
        ),
    )?;
    let instance = latest_instance(ctx, fixture.organization_id, workflow_id)?;
    let next = signal_params(&fixture, instance.id, subject_id, 1, "next", "signal-next");

    signal_workflow(ctx, fixture.organization_id, next.clone())?;
    let after_next = require_instance(ctx, instance.id)?;
    if after_next.revision != 2
        || after_next.state != WorkflowInstanceState::Active
        || after_next.active_token_count != 1
    {
        return Err("signal did not advance the active instance exactly once".to_string());
    }
    let counts = runtime_counts(ctx, instance.id);
    signal_workflow(ctx, fixture.organization_id, next.clone())?;
    if runtime_counts(ctx, instance.id) != counts
        || require_instance(ctx, instance.id)?.revision != 2
    {
        return Err("identical signal replay changed runtime state".to_string());
    }

    let mut changed = next;
    changed.signal_key = "finish".to_string();
    let error = signal_workflow(ctx, fixture.organization_id, changed)
        .err()
        .ok_or("changed signal reused an idempotency key")?;
    if !error.contains("different input") || runtime_counts(ctx, instance.id) != counts {
        return Err(format!("signal key mismatch was not atomic: {error}"));
    }

    let stale = signal_params(
        &fixture,
        instance.id,
        subject_id,
        1,
        "finish",
        "signal-stale",
    );
    let error = signal_workflow(ctx, fixture.organization_id, stale)
        .err()
        .ok_or("stale signal revision advanced")?;
    if !error.contains("stale workflow instance revision")
        || runtime_counts(ctx, instance.id) != counts
    {
        return Err(format!("stale signal was not atomic: {error}"));
    }

    let finish = signal_params(
        &fixture,
        instance.id,
        subject_id,
        2,
        "finish",
        "signal-finish",
    );
    signal_workflow(ctx, fixture.organization_id, finish)?;
    let completed = require_instance(ctx, instance.id)?;
    if completed.state != WorkflowInstanceState::Completed
        || completed.revision != 3
        || completed.active_token_count != 0
    {
        return Err("terminal signal did not complete the instance".to_string());
    }
    if ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
        .filter(|row| row.state == WorkflowTokenState::Active)
        .next()
        .is_some()
    {
        return Err("completed instance retained an active token".to_string());
    }

    let completed_counts = runtime_counts(ctx, instance.id);
    let terminal = signal_params(
        &fixture,
        instance.id,
        subject_id,
        3,
        "finish",
        "signal-terminal",
    );
    let error = signal_workflow(ctx, fixture.organization_id, terminal)
        .err()
        .ok_or("terminal instance accepted a new signal")?;
    if !error.contains("terminal") || runtime_counts(ctx, instance.id) != completed_counts {
        return Err(format!("terminal signal was not atomic: {error}"));
    }
    Ok(())
}

fn test_cancel_replay_and_terminal_behavior(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (workflow_id, version_id) =
        seed_runtime_definition(ctx, &fixture, "runtime.cancel", false)?;
    let subject_id = seed_purchase_order_subject(ctx, &fixture, "wf-runtime-cancel")?;
    start_workflow(
        ctx,
        fixture.organization_id,
        start_params(
            &fixture,
            workflow_id,
            version_id,
            subject_id,
            "start-301",
            None,
        ),
    )?;
    let instance = latest_instance(ctx, fixture.organization_id, workflow_id)?;
    let cancel = CancelWorkflowParams {
        company_id: fixture.company_id,
        instance_id: instance.id,
        expected_revision: 1,
        reason: "operator cancelled test workflow".to_string(),
        idempotency_key: "cancel-301".to_string(),
        correlation_id: "corr-cancel-301".to_string(),
        causation_id: Some("start-301".to_string()),
    };

    cancel_workflow(ctx, fixture.organization_id, cancel.clone())?;
    let cancelled = require_instance(ctx, instance.id)?;
    if cancelled.state != WorkflowInstanceState::Cancelled
        || cancelled.revision != 2
        || cancelled.active_token_count != 0
    {
        return Err("cancel command did not produce a terminal projection".to_string());
    }
    let counts = runtime_counts(ctx, instance.id);
    cancel_workflow(ctx, fixture.organization_id, cancel)?;
    if runtime_counts(ctx, instance.id) != counts
        || require_instance(ctx, instance.id)?.revision != 2
    {
        return Err("identical cancel replay changed runtime state".to_string());
    }

    let second = CancelWorkflowParams {
        company_id: fixture.company_id,
        instance_id: instance.id,
        expected_revision: 2,
        reason: "second cancellation".to_string(),
        idempotency_key: "cancel-301-second".to_string(),
        correlation_id: "corr-cancel-301-second".to_string(),
        causation_id: None,
    };
    let error = cancel_workflow(ctx, fixture.organization_id, second)
        .err()
        .ok_or("terminal instance accepted a second cancellation")?;
    if !error.contains("terminal") || runtime_counts(ctx, instance.id) != counts {
        return Err(format!("terminal cancellation was not atomic: {error}"));
    }
    Ok(())
}

/// WRK-001: start_workflow validates subject_id against a real row in the
/// table named by subject_model ("purchase_order" here) — a bare numeric
/// placeholder is rejected, so tests need an actual purchase order.
fn seed_purchase_order_subject(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    tag: &str,
) -> Result<u64, String> {
    create_contact(
        ctx,
        fixture.organization_id,
        CreateContactParams {
            name: format!("Vendor {tag}"),
            type_: "contact".to_string(),
            email: None,
            phone: None,
            mobile: None,
            company_id: Some(fixture.company_id),
            is_customer: false,
            is_vendor: true,
            is_employee: false,
            is_prospect: false,
            is_partner: false,
            customer_rank: 0,
            supplier_rank: 1,
            display_name: Some(format!("Vendor {tag}")),
            first_name: None,
            last_name: None,
            title: None,
            email_secondary: None,
            fax: None,
            website: None,
            street: None,
            street2: None,
            city: None,
            state_code: None,
            zip: None,
            country_code: None,
            tax_id: None,
            company_registry: None,
            industry: None,
            employees_count: None,
            annual_revenue: None,
            description: None,
            salesperson_id: None,
            assigned_user_id: None,
            parent_id: None,
            user_id: None,
            color: None,
            metadata: None,
        },
    )?;
    let vendor_id = ctx
        .db
        .contact()
        .iter()
        .find(|c| {
            c.organization_id == fixture.organization_id
                && c.display_name == format!("Vendor {tag}")
        })
        .map(|c| c.id)
        .ok_or_else(|| format!("vendor contact {tag} missing"))?;
    create_purchase_order(
        ctx,
        fixture.organization_id,
        CreatePurchaseOrderParams {
            company_id: Some(fixture.company_id),
            partner_id: vendor_id,
            currency_id: 1,
            origin: Some(tag.to_string()),
            partner_ref: None,
            notes: None,
            date_planned: None,
            payment_term_id: None,
            fiscal_position_id: None,
            incoterm_id: None,
            incoterm_location: None,
            user_id: None,
            invoice_ids: vec![],
            picking_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            activity_ids: vec![],
            is_quantity_copy: None,
            metadata: None,
        },
    )?;
    ctx.db
        .purchase_order()
        .iter()
        .find(|p| p.organization_id == fixture.organization_id && p.origin.as_deref() == Some(tag))
        .map(|p| p.id)
        .ok_or_else(|| format!("purchase order {tag} missing"))
}

fn seed_runtime_definition(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    workflow_key: &str,
    singleton: bool,
) -> Result<(u64, u64), String> {
    create_workflow(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            workflow_key: workflow_key.to_string(),
            model: "purchase_order".to_string(),
            name: "Runtime test".to_string(),
            description: None,
            trigger: WorkflowTrigger::Signal,
            schema_version: 1,
            snapshot_fields: vec![ConditionFieldDefinition {
                field_key: "amount".to_string(),
                value_type: ConditionValueType::Money,
                nullable: false,
            }],
            metadata: Some(format!("{{\"singleton_trigger\":{singleton}}}")),
        },
    )?;
    let workflow = ctx
        .db
        .workflow()
        .iter()
        .find(|row| {
            row.organization_id == fixture.organization_id && row.workflow_key == workflow_key
        })
        .ok_or("runtime test workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow.id)
        .find(|row| row.status == WorkflowVersionStatus::Draft)
        .ok_or("runtime test draft missing")?;

    for (revision, key, kind, sequence) in [
        (1, "start", WorkflowNodeKind::Start, 1),
        (2, "middle", WorkflowNodeKind::Decision, 2),
        (3, "end", WorkflowNodeKind::End, 3),
    ] {
        upsert_workflow_node(
            ctx,
            fixture.organization_id,
            version.id,
            revision,
            UpsertWorkflowNodeParams {
                node_key: key.to_string(),
                name: key.to_string(),
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
            },
        )?;
    }
    for (revision, edge_key, from, to, signal, sequence) in [
        (4, "start-middle", "start", "middle", "next", 1),
        (5, "middle-end", "middle", "end", "finish", 2),
    ] {
        upsert_workflow_edge(
            ctx,
            fixture.organization_id,
            version.id,
            revision,
            UpsertWorkflowEdgeParams {
                edge_key: edge_key.to_string(),
                from_node_key: from.to_string(),
                to_node_key: to.to_string(),
                sequence,
                signal_key: Some(signal.to_string()),
                condition: (edge_key == "middle-end").then_some(ConditionProgram {
                    instructions: vec![
                        ConditionInstruction::LoadField("amount".to_string()),
                        ConditionInstruction::PushValue(ConditionValue::Money(MoneyValue {
                            minor_units: 100,
                            currency: "USD".to_string(),
                        })),
                        ConditionInstruction::Compare(ConditionComparison::GreaterThan),
                    ],
                }),
                metadata: None,
            },
        )?;
    }
    publish_workflow_version(ctx, fixture.organization_id, version.id, 6)?;
    Ok((workflow.id, version.id))
}

fn start_params(
    fixture: &OrgFixture,
    workflow_id: u64,
    workflow_version_id: u64,
    subject_id: u64,
    idempotency_key: &str,
    singleton_trigger_key: Option<&str>,
) -> StartWorkflowParams {
    let snapshot = runtime_snapshot(subject_id);
    StartWorkflowParams {
        company_id: fixture.company_id,
        workflow_id,
        workflow_version_id,
        subject_model: "purchase_order".to_string(),
        subject_id,
        subject_revision_hash: snapshot.subject_revision_hash,
        singleton_trigger_key: singleton_trigger_key.map(ToOwned::to_owned),
        idempotency_key: idempotency_key.to_string(),
        correlation_id: format!("corr-{idempotency_key}"),
        causation_id: None,
    }
}

fn signal_params(
    fixture: &OrgFixture,
    instance_id: u64,
    subject_id: u64,
    expected_revision: u64,
    signal_key: &str,
    idempotency_key: &str,
) -> SignalWorkflowParams {
    SignalWorkflowParams {
        company_id: fixture.company_id,
        instance_id,
        expected_revision,
        signal_key: signal_key.to_string(),
        snapshot: runtime_snapshot(subject_id),
        idempotency_key: idempotency_key.to_string(),
        correlation_id: format!("corr-{idempotency_key}"),
        causation_id: None,
    }
}

fn runtime_snapshot(subject_id: u64) -> ConditionSnapshot {
    let mut snapshot = ConditionSnapshot {
        subject_model: "purchase_order".to_string(),
        subject_id,
        subject_revision_hash: String::new(),
        fields: vec![ConditionSnapshotField {
            field_key: "amount".to_string(),
            value: ConditionValue::Money(MoneyValue {
                minor_units: 1_000,
                currency: "USD".to_string(),
            }),
        }],
    };
    snapshot.subject_revision_hash = canonical_condition_snapshot_hash(&snapshot)
        .expect("runtime test snapshot must be canonical");
    snapshot
}

fn latest_instance(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_id: u64,
) -> Result<crate::workflow::runtime::WorkflowInstance, String> {
    ctx.db
        .workflow_instance()
        .instance_by_workflow()
        .filter(&workflow_id)
        .filter(|row| row.organization_id == organization_id)
        .max_by_key(|row| row.id)
        .ok_or_else(|| "runtime test instance missing".to_string())
}

fn require_instance(
    ctx: &ReducerContext,
    instance_id: u64,
) -> Result<crate::workflow::runtime::WorkflowInstance, String> {
    ctx.db
        .workflow_instance()
        .id()
        .find(&instance_id)
        .ok_or_else(|| "runtime test instance missing".to_string())
}

fn runtime_counts(ctx: &ReducerContext, instance_id: u64) -> (usize, usize, usize) {
    (
        ctx.db
            .workflow_token()
            .workflow_token_by_instance()
            .filter(&instance_id)
            .count(),
        ctx.db
            .workflow_decision_event()
            .workflow_event_by_instance()
            .filter(&instance_id)
            .count(),
        ctx.db
            .workflow_command_receipt()
            .workflow_receipt_by_instance()
            .filter(&instance_id)
            .count(),
    )
}
