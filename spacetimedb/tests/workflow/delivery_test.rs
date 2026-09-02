//! Durable timer and outbox coordination tests.

use std::time::Duration;

use spacetimedb::rand::Rng;
use spacetimedb::{ReducerContext, Table};

use crate::core::queue::{
    claim_queue_job, complete_queue_job, queue_effect_receipt, queue_job, queue_worker,
    register_queue_worker, ClaimQueueJobParams, CompleteQueueJobParams, RegisterQueueWorkerParams,
};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::purchasing::purchase_orders::{
    create_purchase_order, purchase_order, CreatePurchaseOrderParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{QueueCompletionOutcome, QueueJobStatus};
use crate::workflow::definitions::{
    create_workflow, publish_workflow_version, upsert_workflow_edge, upsert_workflow_node,
    workflow, workflow_edge, workflow_version, CreateWorkflowParams, UpsertWorkflowEdgeParams,
    UpsertWorkflowNodeParams, WorkflowBranchKind, WorkflowNodeKind, WorkflowTrigger,
    WorkflowVersionStatus,
};
use crate::workflow::delivery::{
    cancel_workflow_outbox_internal, cancel_workflow_timer_internal,
    create_workflow_outbox_internal, create_workflow_timer_internal, fire_workflow_timer_internal,
    record_workflow_outbox_result_internal, workflow_delivery_attempt, workflow_delivery_receipt,
    workflow_outbox, workflow_timer, CancelWorkflowOutboxParams, CancelWorkflowTimerParams,
    CreateWorkflowOutboxParams, CreateWorkflowTimerParams, FireWorkflowTimerParams,
    RecordWorkflowOutboxResultParams, WorkflowDeliveryGuarantee, WorkflowOutbox,
    WorkflowOutboxResultKind, WorkflowOutboxStatus, WorkflowTimer, WorkflowTimerStatus,
};
use crate::workflow::runtime::{
    start_workflow, workflow_decision_event, workflow_instance, workflow_token,
    StartWorkflowParams, WorkflowInstanceState,
};

const SUBJECT_HASH: &str =
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const QUEUE_NAME: &str = "workflow-external";

pub fn test_workflow_delivery(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    timer_fire_is_idempotent_and_wins_cancel_race(ctx)?;
    timer_cancel_is_idempotent_and_wins_fire_race(ctx)?;
    outbox_dispatch_is_linked_and_idempotent(ctx)?;
    successful_result_advances_once_from_queue_receipt(ctx)?;
    ambiguous_non_idempotent_result_requires_reconciliation(ctx)?;
    failed_runtime_advance_leaves_delivery_unchanged(ctx)?;
    Ok(())
}

fn timer_fire_is_idempotent_and_wins_cancel_race(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = seed_delivery_runtime(ctx, "timer-fire")?;
    let timer = create_due_timer(ctx, &fixture, "timer:fire")?;
    let fire = fire_params(&fixture, timer.id, "fire:one");
    let before_event_count = event_count(ctx, fixture.instance_id);

    let receipt = fire_workflow_timer_internal(ctx, fixture.organization_id, fire.clone())?;
    let after = runtime_instance(ctx, fixture.instance_id)?;
    if after.revision != 2 || after.state != WorkflowInstanceState::Completed {
        return Err("timer did not advance the workflow exactly once".to_string());
    }
    let counts = delivery_counts(ctx, timer.id, fixture.instance_id);
    let replay = fire_workflow_timer_internal(ctx, fixture.organization_id, fire.clone())?;
    if replay.scope_key != receipt.scope_key
        || delivery_counts(ctx, timer.id, fixture.instance_id) != counts
        || event_count(ctx, fixture.instance_id) != before_event_count + 1
    {
        return Err("timer fire replay changed durable state".to_string());
    }
    let mut changed_fire = fire;
    changed_fire.expected_instance_revision = 99;
    let mismatch = fire_workflow_timer_internal(ctx, fixture.organization_id, changed_fire)
        .err()
        .ok_or("timer fire receipt accepted changed input")?;
    assert_contains(&mismatch, "different input")?;
    if delivery_counts(ctx, timer.id, fixture.instance_id) != counts {
        return Err("timer fire receipt mismatch changed durable state".to_string());
    }

    let cancel_error = cancel_workflow_timer_internal(
        ctx,
        fixture.organization_id,
        CancelWorkflowTimerParams {
            company_id: fixture.company_id,
            timer_id: timer.id,
            expected_timer_revision: 0,
            idempotency_key: "cancel:lost-race".to_string(),
            reason: "no longer required".to_string(),
        },
    )
    .err()
    .ok_or("timer cancellation won after fire")?;
    assert_contains(&cancel_error, "not pending")?;
    let stored = ctx
        .db
        .workflow_timer()
        .id()
        .find(&timer.id)
        .ok_or("fired timer missing")?;
    if stored.status != WorkflowTimerStatus::Fired || stored.revision != 1 {
        return Err("timer fire projection is inconsistent".to_string());
    }
    Ok(())
}

fn timer_cancel_is_idempotent_and_wins_fire_race(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = seed_delivery_runtime(ctx, "timer-cancel")?;
    let timer = create_due_timer(ctx, &fixture, "timer:cancel")?;
    let cancel = CancelWorkflowTimerParams {
        company_id: fixture.company_id,
        timer_id: timer.id,
        expected_timer_revision: 0,
        idempotency_key: "cancel:one".to_string(),
        reason: "instance no longer waits".to_string(),
    };
    let receipt = cancel_workflow_timer_internal(ctx, fixture.organization_id, cancel.clone())?;
    let counts = delivery_counts(ctx, timer.id, fixture.instance_id);
    let replay = cancel_workflow_timer_internal(ctx, fixture.organization_id, cancel)?;
    if replay.scope_key != receipt.scope_key
        || delivery_counts(ctx, timer.id, fixture.instance_id) != counts
    {
        return Err("timer cancellation replay changed durable state".to_string());
    }
    let fire_error = fire_workflow_timer_internal(
        ctx,
        fixture.organization_id,
        fire_params(&fixture, timer.id, "fire:lost-race"),
    )
    .err()
    .ok_or("timer fired after cancellation")?;
    assert_contains(&fire_error, "not pending")?;
    if runtime_instance(ctx, fixture.instance_id)?.revision != 1 {
        return Err("timer cancellation unexpectedly advanced runtime".to_string());
    }
    Ok(())
}

fn outbox_dispatch_is_linked_and_idempotent(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = seed_delivery_runtime(ctx, "outbox-dispatch")?;
    let params = outbox_params(
        &fixture,
        "outbox:dispatch",
        WorkflowDeliveryGuarantee::ExternallyIdempotent,
        r#"{"amount_minor":1000,"currency":"USD"}"#,
    );
    let outbox = create_workflow_outbox_internal(ctx, fixture.organization_id, params.clone())?;
    let replay = create_workflow_outbox_internal(ctx, fixture.organization_id, params.clone())?;
    if replay.id != outbox.id {
        return Err("outbox replay returned a different intent".to_string());
    }
    let job = ctx
        .db
        .queue_job()
        .id()
        .find(&outbox.queue_job_id)
        .ok_or("outbox queue job missing")?;
    if job.semantic_key != outbox.semantic_key
        || job.input_hash != outbox.input_hash
        || job.company_id != Some(outbox.company_id)
        || job.max_attempts != params.max_attempts
    {
        return Err("outbox and queue semantic linkage differs".to_string());
    }
    if ctx
        .db
        .workflow_outbox()
        .iter()
        .filter(|row| {
            row.organization_id == outbox.organization_id
                && row.company_id == outbox.company_id
                && row.semantic_key == outbox.semantic_key
        })
        .count()
        != 1
        || ctx
            .db
            .queue_job()
            .iter()
            .filter(|row| {
                row.organization_id == outbox.organization_id
                    && row.company_id == Some(outbox.company_id)
                    && row.semantic_key == outbox.semantic_key
            })
            .count()
            != 1
    {
        return Err("outbox dispatch replay inserted duplicate rows".to_string());
    }

    let before = (
        ctx.db.workflow_outbox().iter().count(),
        ctx.db.queue_job().iter().count(),
    );
    let mut changed = params;
    changed.payload = r#"{"amount_minor":1001,"currency":"USD"}"#.to_string();
    let conflict = create_workflow_outbox_internal(ctx, fixture.organization_id, changed)
        .err()
        .ok_or("outbox semantic key accepted changed input")?;
    assert_contains(&conflict, "different input")?;
    if before
        != (
            ctx.db.workflow_outbox().iter().count(),
            ctx.db.queue_job().iter().count(),
        )
    {
        return Err("outbox semantic conflict was not atomic".to_string());
    }
    let cancel = CancelWorkflowOutboxParams {
        company_id: fixture.company_id,
        outbox_id: outbox.id,
        expected_outbox_revision: 0,
        expected_queue_revision: 0,
        idempotency_key: "outbox:cancel".to_string(),
        reason: "dispatch withdrawn".to_string(),
    };
    let receipt = cancel_workflow_outbox_internal(ctx, fixture.organization_id, cancel.clone())?;
    let replay = cancel_workflow_outbox_internal(ctx, fixture.organization_id, cancel)?;
    let cancelled_outbox = ctx
        .db
        .workflow_outbox()
        .id()
        .find(&outbox.id)
        .ok_or("cancelled outbox missing")?;
    let cancelled_job = ctx
        .db
        .queue_job()
        .id()
        .find(&outbox.queue_job_id)
        .ok_or("cancelled outbox queue job missing")?;
    if replay.scope_key != receipt.scope_key
        || cancelled_outbox.status != WorkflowOutboxStatus::Cancelled
        || cancelled_job.status != QueueJobStatus::Cancelled
    {
        return Err("outbox cancellation did not atomically cancel its queue job".to_string());
    }
    Ok(())
}

fn successful_result_advances_once_from_queue_receipt(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = seed_delivery_runtime(ctx, "outbox-success")?;
    let outbox = create_workflow_outbox_internal(
        ctx,
        fixture.organization_id,
        outbox_params(
            &fixture,
            "outbox:success",
            WorkflowDeliveryGuarantee::ExternallyIdempotent,
            r#"{"document_id":42}"#,
        ),
    )?;
    let worker_id = register_worker(ctx, &fixture, "success-worker")?;
    complete_job_success(
        ctx,
        &fixture,
        &outbox,
        worker_id,
        "lease:success",
        "response:v1",
    )?;
    let params = result_params(
        &fixture,
        &outbox,
        worker_id,
        "lease:success",
        WorkflowOutboxResultKind::Succeeded,
        Some("response:v1"),
        None,
        "result:success",
    );
    let receipt =
        record_workflow_outbox_result_internal(ctx, fixture.organization_id, params.clone())?;
    let counts = delivery_counts(ctx, outbox.id, fixture.instance_id);
    let replay =
        record_workflow_outbox_result_internal(ctx, fixture.organization_id, params.clone())?;
    if replay.scope_key != receipt.scope_key
        || delivery_counts(ctx, outbox.id, fixture.instance_id) != counts
    {
        return Err("outbox result replay changed durable state".to_string());
    }
    let mut changed_result = params;
    changed_result.response_fingerprint = Some("response:v2".to_string());
    let mismatch =
        record_workflow_outbox_result_internal(ctx, fixture.organization_id, changed_result)
            .err()
            .ok_or("outbox result receipt accepted changed input")?;
    assert_contains(&mismatch, "different input")?;
    let stored = ctx
        .db
        .workflow_outbox()
        .id()
        .find(&outbox.id)
        .ok_or("completed outbox missing")?;
    if stored.status != WorkflowOutboxStatus::Completed
        || stored.response_fingerprint.as_deref() != Some("response:v1")
        || runtime_instance(ctx, fixture.instance_id)?.state != WorkflowInstanceState::Completed
    {
        return Err("successful outbox result projection is inconsistent".to_string());
    }
    if ctx
        .db
        .queue_effect_receipt()
        .queue_effect_receipt_by_job()
        .filter(&outbox.queue_job_id)
        .count()
        != 1
    {
        return Err("successful outbox result lacks one queue effect receipt".to_string());
    }
    Ok(())
}

fn ambiguous_non_idempotent_result_requires_reconciliation(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = seed_delivery_runtime(ctx, "outbox-ambiguous")?;
    let outbox = create_workflow_outbox_internal(
        ctx,
        fixture.organization_id,
        outbox_params(
            &fixture,
            "outbox:ambiguous",
            WorkflowDeliveryGuarantee::NonIdempotent,
            r#"{"transfer_id":77}"#,
        ),
    )?;
    let job = ctx
        .db
        .queue_job()
        .id()
        .find(&outbox.queue_job_id)
        .ok_or("ambiguous queue job missing")?;
    if job.max_attempts != 1 {
        return Err("non-idempotent outbox was configured for automatic retry".to_string());
    }
    let worker_id = register_worker(ctx, &fixture, "ambiguous-worker")?;
    claim_queue_job(
        ctx,
        fixture.organization_id,
        job.id,
        claim_params(ctx, worker_id, "lease:ambiguous"),
    )?;
    complete_queue_job(
        ctx,
        fixture.organization_id,
        job.id,
        CompleteQueueJobParams {
            expected_revision: 1,
            worker_id,
            lease_token: "lease:ambiguous".to_string(),
            outcome: QueueCompletionOutcome::Failed,
            error_summary: Some("remote result unknown".to_string()),
            response_fingerprint: None,
            retry_jitter_micros: 0,
        },
    )?;
    let params = result_params(
        &fixture,
        &outbox,
        worker_id,
        "lease:ambiguous",
        WorkflowOutboxResultKind::Ambiguous,
        None,
        Some("remote result unknown"),
        "result:ambiguous",
    );
    let receipt =
        record_workflow_outbox_result_internal(ctx, fixture.organization_id, params.clone())?;
    let replay = record_workflow_outbox_result_internal(ctx, fixture.organization_id, params)?;
    if replay.scope_key != receipt.scope_key {
        return Err("ambiguous outbox result did not replay its receipt".to_string());
    }
    let stored = ctx
        .db
        .workflow_outbox()
        .id()
        .find(&outbox.id)
        .ok_or("ambiguous outbox missing")?;
    let queue = ctx
        .db
        .queue_job()
        .id()
        .find(&outbox.queue_job_id)
        .ok_or("ambiguous queue job missing after result")?;
    if stored.status != WorkflowOutboxStatus::ReconciliationRequired
        || queue.status != QueueJobStatus::DeadLettered
        || runtime_instance(ctx, fixture.instance_id)?.revision != 1
    {
        return Err("ambiguous non-idempotent result was not parked safely".to_string());
    }
    Ok(())
}

fn failed_runtime_advance_leaves_delivery_unchanged(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = seed_delivery_runtime(ctx, "outbox-rollback")?;
    let outbox = create_workflow_outbox_internal(
        ctx,
        fixture.organization_id,
        outbox_params(
            &fixture,
            "outbox:rollback",
            WorkflowDeliveryGuarantee::ExternallyIdempotent,
            r#"{"document_id":99}"#,
        ),
    )?;
    let worker_id = register_worker(ctx, &fixture, "rollback-worker")?;
    complete_job_success(
        ctx,
        &fixture,
        &outbox,
        worker_id,
        "lease:rollback",
        "response:rollback",
    )?;
    ctx.db.workflow_outbox().id().update(WorkflowOutbox {
        edge_id: u64::MAX,
        ..outbox.clone()
    });
    let before = delivery_counts(ctx, outbox.id, fixture.instance_id);
    let error = record_workflow_outbox_result_internal(
        ctx,
        fixture.organization_id,
        result_params(
            &fixture,
            &outbox,
            worker_id,
            "lease:rollback",
            WorkflowOutboxResultKind::Succeeded,
            Some("response:rollback"),
            None,
            "result:rollback",
        ),
    )
    .err()
    .ok_or("outbox result advanced through an invalid edge")?;
    assert_contains(&error, "edge")?;
    if delivery_counts(ctx, outbox.id, fixture.instance_id) != before {
        return Err("failed runtime advance partially changed delivery/history".to_string());
    }
    let stored = ctx
        .db
        .workflow_outbox()
        .id()
        .find(&outbox.id)
        .ok_or("rollback outbox missing")?;
    if stored.status != WorkflowOutboxStatus::AwaitingDelivery || stored.revision != 0 {
        return Err("failed runtime advance changed the outbox projection".to_string());
    }
    Ok(())
}

#[derive(Clone)]
struct DeliveryFixture {
    organization_id: u64,
    company_id: u64,
    instance_id: u64,
    token_id: u64,
    edge_id: u64,
}

/// WRK-001: start_workflow validates subject_id against a real row in the
/// table named by subject_model ("purchase_order" here).
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

fn seed_delivery_runtime(ctx: &ReducerContext, label: &str) -> Result<DeliveryFixture, String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let workflow_key = format!("delivery.{label}.{}", ctx.rng().gen::<u64>());
    create_workflow(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            workflow_key: workflow_key.clone(),
            model: "purchase_order".to_string(),
            name: format!("Delivery {label}"),
            description: None,
            trigger: WorkflowTrigger::Signal,
            schema_version: 1,
            snapshot_fields: vec![],
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
        .ok_or("delivery workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow.id)
        .find(|row| row.status == WorkflowVersionStatus::Draft)
        .ok_or("delivery workflow draft missing")?;
    for (revision, key, kind, sequence) in [
        (1, "start", WorkflowNodeKind::Start, 1),
        (2, "end", WorkflowNodeKind::End, 2),
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
    upsert_workflow_edge(
        ctx,
        fixture.organization_id,
        version.id,
        3,
        UpsertWorkflowEdgeParams {
            edge_key: "delivery-complete".to_string(),
            from_node_key: "start".to_string(),
            to_node_key: "end".to_string(),
            sequence: 1,
            signal_key: Some("complete".to_string()),
            condition: None,
            metadata: None,
        },
    )?;
    publish_workflow_version(ctx, fixture.organization_id, version.id, 4)?;
    let subject_id = seed_purchase_order_subject(ctx, &fixture, &workflow_key)?;
    start_workflow(
        ctx,
        fixture.organization_id,
        StartWorkflowParams {
            company_id: fixture.company_id,
            workflow_id: workflow.id,
            workflow_version_id: version.id,
            subject_model: "purchase_order".to_string(),
            subject_id,
            subject_revision_hash: SUBJECT_HASH.to_string(),
            singleton_trigger_key: None,
            idempotency_key: format!("delivery-start:{}", ctx.rng().gen::<u64>()),
            correlation_id: format!("delivery-correlation:{}", ctx.rng().gen::<u64>()),
            causation_id: None,
        },
    )?;
    let instance = ctx
        .db
        .workflow_instance()
        .instance_by_workflow()
        .filter(&workflow.id)
        .max_by_key(|row| row.id)
        .ok_or("delivery workflow instance missing")?;
    let token = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
        .find(|row| row.state == crate::workflow::runtime::WorkflowTokenState::Active)
        .ok_or("delivery workflow token missing")?;
    let edge = ctx
        .db
        .workflow_edge()
        .workflow_edge_by_version()
        .filter(&version.id)
        .find(|row| row.edge_key == "delivery-complete")
        .ok_or("delivery workflow edge missing")?;
    Ok(DeliveryFixture {
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        instance_id: instance.id,
        token_id: token.id,
        edge_id: edge.id,
    })
}

fn create_due_timer(
    ctx: &ReducerContext,
    fixture: &DeliveryFixture,
    semantic_key: &str,
) -> Result<WorkflowTimer, String> {
    let timer = create_workflow_timer_internal(
        ctx,
        fixture.organization_id,
        CreateWorkflowTimerParams {
            company_id: fixture.company_id,
            instance_id: fixture.instance_id,
            token_id: fixture.token_id,
            expected_token_revision: 1,
            edge_id: fixture.edge_id,
            due_at: ctx.timestamp + Duration::from_secs(60),
            semantic_key: semantic_key.to_string(),
            correlation_id: format!("corr:{semantic_key}"),
            causation_id: None,
        },
    )?;
    ctx.db.workflow_timer().id().update(WorkflowTimer {
        due_at: ctx.timestamp,
        ..timer.clone()
    });
    Ok(WorkflowTimer {
        due_at: ctx.timestamp,
        ..timer
    })
}

fn fire_params(
    fixture: &DeliveryFixture,
    timer_id: u64,
    idempotency_key: &str,
) -> FireWorkflowTimerParams {
    FireWorkflowTimerParams {
        company_id: fixture.company_id,
        timer_id,
        expected_timer_revision: 0,
        expected_instance_revision: 1,
        idempotency_key: idempotency_key.to_string(),
        correlation_id: format!("corr:{idempotency_key}"),
        causation_id: None,
    }
}

fn outbox_params(
    fixture: &DeliveryFixture,
    semantic_key: &str,
    guarantee: WorkflowDeliveryGuarantee,
    payload: &str,
) -> CreateWorkflowOutboxParams {
    CreateWorkflowOutboxParams {
        company_id: fixture.company_id,
        instance_id: fixture.instance_id,
        token_id: fixture.token_id,
        expected_token_revision: 1,
        edge_id: fixture.edge_id,
        action_key: "external.test.execute:v1".to_string(),
        payload: payload.to_string(),
        semantic_key: semantic_key.to_string(),
        delivery_guarantee: guarantee,
        queue_name: QUEUE_NAME.to_string(),
        job_type: "workflow.external_action".to_string(),
        priority: 10,
        max_attempts: 3,
        available_at_micros: None,
        correlation_id: format!("corr:{semantic_key}"),
        causation_id: None,
    }
}

fn register_worker(
    ctx: &ReducerContext,
    fixture: &DeliveryFixture,
    name: &str,
) -> Result<u64, String> {
    register_queue_worker(
        ctx,
        fixture.organization_id,
        RegisterQueueWorkerParams {
            company_id: Some(fixture.company_id),
            name: format!("{name}-{}", ctx.rng().gen::<u64>()),
            queues: vec![QUEUE_NAME.to_string()],
            metadata: None,
        },
    )?;
    ctx.db
        .queue_worker()
        .worker_by_org()
        .filter(&fixture.organization_id)
        .filter(|worker| worker.company_id == Some(fixture.company_id))
        .max_by_key(|worker| worker.id)
        .map(|worker| worker.id)
        .ok_or("delivery queue worker missing".to_string())
}

fn claim_params(ctx: &ReducerContext, worker_id: u64, lease_token: &str) -> ClaimQueueJobParams {
    ClaimQueueJobParams {
        expected_revision: 0,
        worker_id,
        lease_token: lease_token.to_string(),
        lease_expires_at_micros: (ctx.timestamp + Duration::from_secs(60))
            .to_micros_since_unix_epoch() as u64,
    }
}

fn complete_job_success(
    ctx: &ReducerContext,
    fixture: &DeliveryFixture,
    outbox: &WorkflowOutbox,
    worker_id: u64,
    lease_token: &str,
    response_fingerprint: &str,
) -> Result<(), String> {
    claim_queue_job(
        ctx,
        fixture.organization_id,
        outbox.queue_job_id,
        claim_params(ctx, worker_id, lease_token),
    )?;
    complete_queue_job(
        ctx,
        fixture.organization_id,
        outbox.queue_job_id,
        CompleteQueueJobParams {
            expected_revision: 1,
            worker_id,
            lease_token: lease_token.to_string(),
            outcome: QueueCompletionOutcome::Succeeded,
            error_summary: None,
            response_fingerprint: Some(response_fingerprint.to_string()),
            retry_jitter_micros: 0,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn result_params(
    fixture: &DeliveryFixture,
    outbox: &WorkflowOutbox,
    worker_id: u64,
    lease_token: &str,
    result: WorkflowOutboxResultKind,
    response_fingerprint: Option<&str>,
    error_summary: Option<&str>,
    idempotency_key: &str,
) -> RecordWorkflowOutboxResultParams {
    RecordWorkflowOutboxResultParams {
        company_id: fixture.company_id,
        outbox_id: outbox.id,
        expected_outbox_revision: 0,
        expected_instance_revision: 1,
        queue_job_id: outbox.queue_job_id,
        worker_id,
        lease_token: lease_token.to_string(),
        result,
        response_fingerprint: response_fingerprint.map(str::to_string),
        error_summary: error_summary.map(str::to_string),
        idempotency_key: idempotency_key.to_string(),
        correlation_id: format!("corr:{idempotency_key}"),
        causation_id: None,
    }
}

fn runtime_instance(
    ctx: &ReducerContext,
    instance_id: u64,
) -> Result<crate::workflow::runtime::WorkflowInstance, String> {
    ctx.db
        .workflow_instance()
        .id()
        .find(&instance_id)
        .ok_or("delivery runtime instance missing".to_string())
}

fn event_count(ctx: &ReducerContext, instance_id: u64) -> usize {
    ctx.db
        .workflow_decision_event()
        .workflow_event_by_instance()
        .filter(&instance_id)
        .count()
}

fn delivery_counts(
    ctx: &ReducerContext,
    object_id: u64,
    instance_id: u64,
) -> (usize, usize, usize) {
    (
        ctx.db
            .workflow_delivery_attempt()
            .workflow_delivery_attempt_by_object()
            .filter(&object_id)
            .count(),
        ctx.db
            .workflow_delivery_receipt()
            .workflow_delivery_receipt_by_object()
            .filter(&object_id)
            .count(),
        event_count(ctx, instance_id),
    )
}

fn assert_contains(error: &str, expected: &str) -> Result<(), String> {
    if error.contains(expected) {
        Ok(())
    } else {
        Err(format!(
            "expected error containing '{expected}', got '{error}'"
        ))
    }
}
