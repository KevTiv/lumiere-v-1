//! Workflow subject snapshot adapter, scope, and runtime integration tests.

use spacetimedb::{ReducerContext, Table};

use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::purchasing::purchase_orders::{
    create_purchase_order, purchase_order, CreatePurchaseOrderParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::workflow::definitions::{
    create_workflow, publish_workflow_version, upsert_workflow_edge, upsert_workflow_node,
    workflow, workflow_version, ConditionFieldDefinition, ConditionValue, ConditionValueType,
    CreateWorkflowParams, FixedPointDecimal, MoneyValue, UpsertWorkflowEdgeParams,
    UpsertWorkflowNodeParams, WorkflowBranchKind, WorkflowNodeKind, WorkflowTrigger,
    WorkflowVersionStatus,
};
use crate::workflow::evaluator::{
    canonical_condition_snapshot_hash, validate_condition_snapshot, ConditionSnapshot,
};
use crate::workflow::runtime::{
    signal_workflow, start_workflow, workflow_instance, SignalWorkflowParams, StartWorkflowParams,
    WorkflowInstanceState,
};
use crate::workflow::subject_snapshot::{
    build_condition_snapshot, request_workflow_subject_snapshot, workflow_subject_snapshot,
    RequestWorkflowSubjectSnapshotParams, SnapshotCurrency, WorkflowSubjectSnapshot,
    WorkflowSubjectSnapshotRow,
};

const GOLDEN_SALE_ORDER_HASH: &str =
    "sha256:8a9abdf076a6bb085bc980a04250dc9f0d4a4f9f400d2bf119e310c23686b0d0";

pub fn test_workflow_subject_snapshots(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    test_closed_adapter_registry()?;
    test_request_scope_and_runtime_hash_checks(ctx)
}

fn test_closed_adapter_registry() -> Result<(), String> {
    let sale_allowlist = vec![
        field("id", ConditionValueType::Integer, false),
        field("state", ConditionValueType::Code, false),
        field("reference", ConditionValueType::Text, true),
        field("amount_total", ConditionValueType::Money, false),
        field("date_order", ConditionValueType::Timestamp, false),
        field("validity_date", ConditionValueType::Date, true),
        field("is_locked", ConditionValueType::Boolean, false),
        field("currency_rate", ConditionValueType::Decimal, false),
    ];
    let sale = build_condition_snapshot("sale_order", 42, &sale_row(), &sale_allowlist)?;
    if sale.subject_revision_hash != GOLDEN_SALE_ORDER_HASH {
        return Err(format!(
            "workflow subject snapshot golden hash drifted: {}",
            sale.subject_revision_hash
        ));
    }
    validate_condition_snapshot(&sale_allowlist, &sale)
        .map_err(|error| format!("sale_order snapshot failed validation: {error}"))?;
    assert_field(&sale, "id", &ConditionValue::Integer(42))?;
    assert_field(&sale, "state", &ConditionValue::Code("Sale".to_string()))?;
    assert_field(
        &sale,
        "reference",
        &ConditionValue::Text("SO-42".to_string()),
    )?;
    assert_field(
        &sale,
        "amount_total",
        &ConditionValue::Money(MoneyValue {
            minor_units: 12_345,
            currency: "USD".to_string(),
        }),
    )?;
    assert_field(
        &sale,
        "date_order",
        &ConditionValue::Timestamp(172_800_000_000),
    )?;
    assert_field(&sale, "validity_date", &ConditionValue::Null)?;
    assert_field(&sale, "is_locked", &ConditionValue::Boolean(true))?;
    assert_field(
        &sale,
        "currency_rate",
        &ConditionValue::Decimal(FixedPointDecimal {
            coefficient: 1_250_000,
            scale: 6,
        }),
    )?;

    let purchase = build_condition_snapshot(
        "purchase_order",
        43,
        &purchase_row(),
        &[
            field("name", ConditionValueType::Text, true),
            field("date_planned", ConditionValueType::Date, true),
            field("receipt_status", ConditionValueType::Code, false),
        ],
    )?;
    assert_field(&purchase, "name", &ConditionValue::Null)?;
    assert_field(&purchase, "date_planned", &ConditionValue::Date(4))?;

    let account_move = build_condition_snapshot(
        "account_move",
        44,
        &account_move_row(),
        &[
            field("date", ConditionValueType::Date, false),
            field("invoice_date", ConditionValueType::Date, true),
            field("move_type", ConditionValueType::Code, false),
        ],
    )?;
    assert_field(&account_move, "date", &ConditionValue::Date(5))?;
    assert_field(&account_move, "invoice_date", &ConditionValue::Null)?;

    let payment = build_condition_snapshot(
        "account_payment",
        45,
        &payment_row(),
        &[
            field("amount", ConditionValueType::Money, false),
            field("date", ConditionValueType::Date, false),
            field("ref", ConditionValueType::Text, true),
        ],
    )?;
    assert_field(&payment, "date", &ConditionValue::Date(6))?;
    assert_field(&payment, "ref", &ConditionValue::Null)?;

    let picking = build_condition_snapshot(
        "stock_picking",
        46,
        &picking_row(),
        &[
            field("name", ConditionValueType::Text, false),
            field("scheduled_date", ConditionValueType::Timestamp, true),
            field("date_done", ConditionValueType::Timestamp, true),
            field("is_return", ConditionValueType::Boolean, false),
            field("picking_code", ConditionValueType::Code, true),
        ],
    )?;
    assert_field(&picking, "date_done", &ConditionValue::Null)?;
    assert_field(&picking, "is_return", &ConditionValue::Boolean(true))?;

    let unsupported = build_condition_snapshot("arbitrary_model", 42, &sale_row(), &[])
        .err()
        .ok_or("unsupported workflow snapshot model was accepted")?;
    if unsupported != "no snapshot adapter for model arbitrary_model" {
        return Err(format!("unexpected unsupported-model error: {unsupported}"));
    }
    let unavailable = build_condition_snapshot(
        "sale_order",
        42,
        &sale_row(),
        &[field("secret", ConditionValueType::Text, false)],
    )
    .err()
    .ok_or("unavailable workflow snapshot field was accepted")?;
    if unavailable != "field_key 'secret' not available for model sale_order" {
        return Err(format!("unexpected unavailable-field error: {unavailable}"));
    }
    Ok(())
}

fn test_request_scope_and_runtime_hash_checks(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let subject_id = seed_purchase_order(ctx, &fixture, "workflow-snapshot-subject")?;
    let (workflow_id, workflow_version_id) =
        seed_snapshot_workflow(ctx, &fixture, "workflow.snapshot.primary")?;
    let request = RequestWorkflowSubjectSnapshotParams {
        subject_model: "purchase_order".to_string(),
        subject_id,
        workflow_version_id,
    };
    request_workflow_subject_snapshot(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        request.clone(),
    )?;
    let first = requested_snapshot(
        ctx,
        fixture.organization_id,
        subject_id,
        workflow_version_id,
    )?;
    request_workflow_subject_snapshot(ctx, fixture.organization_id, fixture.company_id, request)?;
    let replay = requested_snapshot(
        ctx,
        fixture.organization_id,
        subject_id,
        workflow_version_id,
    )?;
    if replay.id != first.id
        || replay.requested_at != first.requested_at
        || replay.subject_revision_hash != first.subject_revision_hash
    {
        return Err(
            "identical snapshot request did not converge without a duplicate write".to_string(),
        );
    }

    let snapshot = ConditionSnapshot {
        subject_model: replay.subject_model,
        subject_id: replay.subject_id,
        subject_revision_hash: replay.subject_revision_hash,
        fields: replay.fields,
    };
    let version = ctx
        .db
        .workflow_version()
        .id()
        .find(&workflow_version_id)
        .ok_or("snapshot test workflow version missing")?;
    validate_condition_snapshot(&version.snapshot_fields, &snapshot)
        .map_err(|error| format!("requested snapshot failed validation: {error}"))?;
    if canonical_condition_snapshot_hash(&snapshot)
        .map_err(|error| format!("requested snapshot hash failed: {error}"))?
        != snapshot.subject_revision_hash
    {
        return Err("requested snapshot hash is not canonical".to_string());
    }

    start_workflow(
        ctx,
        fixture.organization_id,
        StartWorkflowParams {
            company_id: fixture.company_id,
            workflow_id,
            workflow_version_id,
            subject_model: "purchase_order".to_string(),
            subject_id,
            subject_revision_hash: snapshot.subject_revision_hash.clone(),
            singleton_trigger_key: None,
            idempotency_key: "workflow-snapshot-start".to_string(),
            correlation_id: "workflow-snapshot-start-correlation".to_string(),
            causation_id: None,
        },
    )?;
    let instance = ctx
        .db
        .workflow_instance()
        .instance_by_workflow()
        .filter(&workflow_id)
        .find(|row| row.subject_id == subject_id)
        .ok_or("snapshot test workflow instance missing")?;
    if instance.subject_revision_hash != snapshot.subject_revision_hash {
        return Err("workflow instance did not bind the requested snapshot hash".to_string());
    }
    signal_workflow(
        ctx,
        fixture.organization_id,
        SignalWorkflowParams {
            company_id: fixture.company_id,
            instance_id: instance.id,
            expected_revision: 1,
            signal_key: "finish".to_string(),
            snapshot,
            idempotency_key: "workflow-snapshot-signal".to_string(),
            correlation_id: "workflow-snapshot-signal-correlation".to_string(),
            causation_id: None,
        },
    )?;
    let completed = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance.id)
        .ok_or("snapshot test workflow instance disappeared")?;
    if completed.state != WorkflowInstanceState::Completed {
        return Err("builder-made snapshot did not pass the signal workflow checks".to_string());
    }

    let other = OrgFixture::seed_minimal(ctx)?;
    let (_, other_version_id) = seed_snapshot_workflow(ctx, &other, "workflow.snapshot.other")?;
    let error = request_workflow_subject_snapshot(
        ctx,
        other.organization_id,
        other.company_id,
        RequestWorkflowSubjectSnapshotParams {
            subject_model: "purchase_order".to_string(),
            subject_id,
            workflow_version_id: other_version_id,
        },
    )
    .err()
    .ok_or("cross-tenant workflow subject snapshot was accepted")?;
    if !error.contains("does not belong to this organization/company") {
        return Err(format!("unexpected cross-tenant snapshot error: {error}"));
    }
    Ok(())
}

fn field(key: &str, value_type: ConditionValueType, nullable: bool) -> ConditionFieldDefinition {
    ConditionFieldDefinition {
        field_key: key.to_string(),
        value_type,
        nullable,
    }
}

fn usd() -> SnapshotCurrency {
    SnapshotCurrency {
        code: "USD".to_string(),
        decimal_places: 2,
    }
}

fn sale_row() -> WorkflowSubjectSnapshotRow {
    WorkflowSubjectSnapshotRow::SaleOrder {
        id: 42,
        organization_id: 7,
        company_id: 9,
        state: "Sale".to_string(),
        reference: Some("SO-42".to_string()),
        amount_total: 123.45,
        currency: usd(),
        date_order_micros: 172_800_000_000,
        validity_date_micros: None,
        is_locked: true,
        currency_rate: 1.25,
    }
}

fn purchase_row() -> WorkflowSubjectSnapshotRow {
    WorkflowSubjectSnapshotRow::PurchaseOrder {
        id: 43,
        organization_id: 7,
        company_id: 9,
        state: "Draft".to_string(),
        name: None,
        amount_total: 50.0,
        currency: usd(),
        date_order_micros: 259_200_000_000,
        date_planned_micros: Some(345_600_000_000),
        is_locked: false,
        receipt_status: "nothing".to_string(),
        currency_rate: 1.0,
    }
}

fn account_move_row() -> WorkflowSubjectSnapshotRow {
    WorkflowSubjectSnapshotRow::AccountMove {
        id: 44,
        organization_id: 7,
        company_id: 9,
        state: "Draft".to_string(),
        name: "INV-44".to_string(),
        move_type: "OutInvoice".to_string(),
        amount_total: 75.0,
        currency: usd(),
        date_micros: 432_000_000_000,
        invoice_date_micros: None,
        to_check: true,
        posted_before: false,
    }
}

fn payment_row() -> WorkflowSubjectSnapshotRow {
    WorkflowSubjectSnapshotRow::AccountPayment {
        id: 45,
        organization_id: 7,
        company_id: 9,
        state: "Paid".to_string(),
        name: Some("PAY-45".to_string()),
        payment_type: "InBound".to_string(),
        partner_type: "Customer".to_string(),
        amount: 25.0,
        currency: usd(),
        date_micros: 518_400_000_000,
        reference: None,
    }
}

fn picking_row() -> WorkflowSubjectSnapshotRow {
    WorkflowSubjectSnapshotRow::StockPicking {
        id: 46,
        organization_id: 7,
        company_id: 9,
        state: "assigned".to_string(),
        name: "PICK-46".to_string(),
        origin: None,
        priority: "2".to_string(),
        scheduled_date_micros: Some(604_800_000_000),
        date_done_micros: None,
        is_locked: false,
        is_return: true,
        move_type: "direct".to_string(),
        picking_code: Some("outgoing".to_string()),
        created_at_micros: 604_800_000_000,
        updated_at_micros: 691_200_000_000,
    }
}

fn assert_field(
    snapshot: &ConditionSnapshot,
    field_key: &str,
    expected: &ConditionValue,
) -> Result<(), String> {
    let actual = snapshot
        .fields
        .iter()
        .find(|field| field.field_key == field_key)
        .map(|field| &field.value)
        .ok_or_else(|| format!("snapshot field '{field_key}' missing"))?;
    if actual != expected {
        return Err(format!(
            "snapshot field '{field_key}' mismatch: expected {expected:?}, got {actual:?}"
        ));
    }
    Ok(())
}

fn seed_purchase_order(
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
        .find(|row| {
            row.organization_id == fixture.organization_id
                && row.display_name == format!("Vendor {tag}")
        })
        .map(|row| row.id)
        .ok_or("snapshot test vendor missing")?;
    create_purchase_order(
        ctx,
        fixture.organization_id,
        CreatePurchaseOrderParams {
            company_id: Some(fixture.company_id),
            partner_id: vendor_id,
            currency_id: fixture.currency_id,
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
        .find(|row| {
            row.organization_id == fixture.organization_id && row.origin.as_deref() == Some(tag)
        })
        .map(|row| row.id)
        .ok_or("snapshot test purchase order missing".to_string())
}

fn seed_snapshot_workflow(
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
            model: "purchase_order".to_string(),
            name: "Workflow subject snapshot test".to_string(),
            description: None,
            trigger: WorkflowTrigger::Signal,
            schema_version: 1,
            snapshot_fields: vec![field("amount_total", ConditionValueType::Money, false)],
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
        .ok_or("snapshot test workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow.id)
        .find(|row| row.status == WorkflowVersionStatus::Draft)
        .ok_or("snapshot test draft missing")?;
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
            edge_key: "start-end".to_string(),
            from_node_key: "start".to_string(),
            to_node_key: "end".to_string(),
            sequence: 1,
            signal_key: Some("finish".to_string()),
            condition: None,
            metadata: None,
        },
    )?;
    publish_workflow_version(ctx, fixture.organization_id, version.id, 4)?;
    Ok((workflow.id, version.id))
}

fn requested_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    subject_id: u64,
    workflow_version_id: u64,
) -> Result<WorkflowSubjectSnapshot, String> {
    ctx.db
        .workflow_subject_snapshot()
        .workflow_subject_snapshot_by_organization()
        .filter(&organization_id)
        .find(|row| row.subject_id == subject_id && row.workflow_version_id == workflow_version_id)
        .ok_or("requested workflow subject snapshot missing".to_string())
}
