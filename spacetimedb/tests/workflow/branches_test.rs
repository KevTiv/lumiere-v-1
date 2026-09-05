//! Structured branch / join tests (WF-07).

use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::purchasing::purchase_orders::{
    create_purchase_order, purchase_order, CreatePurchaseOrderParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::workflow::branches::{select_fork_edges, workflow_fork, workflow_join_arrival};
use crate::workflow::definitions::{
    create_workflow, publish_workflow_version, upsert_workflow_edge, upsert_workflow_node,
    validate_workflow_graph, workflow, workflow_version, CreateWorkflowParams,
    UpsertWorkflowEdgeParams, UpsertWorkflowNodeParams, WorkflowBranchKind, WorkflowNodeKind,
    WorkflowTrigger, WorkflowVersionStatus,
};
use crate::workflow::evaluator::{canonical_condition_snapshot_hash, ConditionSnapshot};
use crate::workflow::runtime::{
    signal_workflow, start_workflow, workflow_instance, workflow_token, SignalWorkflowParams,
    StartWorkflowParams, WorkflowTokenState,
};

pub fn test_workflow_branches(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    test_xor_selects_first_edge()?;
    test_and_join_fires_once(ctx)?;
    test_crossing_fork_rejected()?;
    Ok(())
}

fn test_xor_selects_first_edge() -> Result<(), String> {
    let fork = node(
        1,
        "fork",
        WorkflowNodeKind::Fork,
        WorkflowBranchKind::Xor,
        WorkflowBranchKind::None,
        1,
    );
    let a = edge(1, "b", "fork", "left", 2);
    let b = edge(2, "a", "fork", "right", 1);
    let selected = select_fork_edges(&fork, &[&a, &b], &[], None)?;
    if selected.len() != 1 || selected[0].edge_key != "a" {
        return Err(format!(
            "XOR did not pick first by (sequence, edge_key): {:?}",
            selected.iter().map(|e| &e.edge_key).collect::<Vec<_>>()
        ));
    }
    Ok(())
}

fn test_crossing_fork_rejected() -> Result<(), String> {
    // Unpaired OR fork (no join) must be rejected.
    let nodes = vec![
        node(
            1,
            "start",
            WorkflowNodeKind::Start,
            WorkflowBranchKind::None,
            WorkflowBranchKind::None,
            1,
        ),
        node(
            2,
            "f1",
            WorkflowNodeKind::Fork,
            WorkflowBranchKind::Or,
            WorkflowBranchKind::None,
            2,
        ),
        node(
            3,
            "a",
            WorkflowNodeKind::End,
            WorkflowBranchKind::None,
            WorkflowBranchKind::None,
            3,
        ),
        node(
            4,
            "b",
            WorkflowNodeKind::End,
            WorkflowBranchKind::None,
            WorkflowBranchKind::None,
            4,
        ),
    ];
    let edges = vec![
        edge(1, "e1", "start", "f1", 1),
        edge(2, "e2", "f1", "a", 1),
        edge(3, "e3", "f1", "b", 2),
    ];
    match validate_workflow_graph(&[], &nodes, &edges) {
        Ok(()) => Err("unpaired fork topology was accepted".to_string()),
        Err(errors) => {
            if errors
                .iter()
                .any(|e| e.contains("unclosed") || e.contains("Join"))
            {
                Ok(())
            } else {
                Err(format!("unexpected validation errors: {errors:?}"))
            }
        }
    }
}

fn test_and_join_fires_once(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (workflow_id, version_id) = seed_and_graph(ctx, &fixture)?;
    let subject_id = seed_purchase_order_subject(ctx, &fixture, "wf-branch-and")?;
    let snapshot = ConditionSnapshot {
        subject_model: "purchase_order".into(),
        subject_id,
        subject_revision_hash: String::new(),
        fields: vec![],
    };
    let mut snapshot = snapshot;
    snapshot.subject_revision_hash =
        canonical_condition_snapshot_hash(&snapshot).map_err(|e| e.to_string())?;

    start_workflow(
        ctx,
        fixture.organization_id,
        StartWorkflowParams {
            company_id: fixture.company_id,
            workflow_id,
            workflow_version_id: version_id,
            subject_model: "purchase_order".into(),
            subject_id,
            subject_revision_hash: snapshot.subject_revision_hash.clone(),
            singleton_trigger_key: None,
            idempotency_key: "branch-start-1".into(),
            correlation_id: "corr-branch-1".into(),
            causation_id: None,
        },
    )?;
    let instance = ctx
        .db
        .workflow_instance()
        .instance_by_workflow()
        .filter(&workflow_id)
        .next()
        .ok_or("branch instance missing")?;

    signal_workflow(
        ctx,
        fixture.organization_id,
        SignalWorkflowParams {
            company_id: fixture.company_id,
            instance_id: instance.id,
            expected_revision: instance.revision,
            signal_key: "start".into(),
            snapshot: snapshot.clone(),
            idempotency_key: "branch-signal-start".into(),
            correlation_id: "corr-branch-signal".into(),
            causation_id: None,
        },
    )?;
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance.id)
        .ok_or("instance missing after fork")?;
    let forks: Vec<_> = ctx
        .db
        .workflow_fork()
        .workflow_fork_by_instance()
        .filter(&instance.id)
        .collect();
    if forks.len() != 1 || !forks[0].open || forks[0].emitted_branch_keys.len() != 2 {
        return Err(format!(
            "AND fork expand failed: open={} emitted={}",
            forks.first().map(|f| f.open).unwrap_or(false),
            forks
                .first()
                .map(|f| f.emitted_branch_keys.len())
                .unwrap_or(0)
        ));
    }
    let active: Vec<_> = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
        .filter(|t| t.state == WorkflowTokenState::Active)
        .collect();
    if active.len() != 2 {
        return Err(format!("expected two branch tokens, got {}", active.len()));
    }

    // Complete left then right via signal edges into join.
    for (idx, key) in ["left-done", "right-done"].into_iter().enumerate() {
        let instance = ctx
            .db
            .workflow_instance()
            .id()
            .find(&instance.id)
            .ok_or("instance missing")?;
        let token = ctx
            .db
            .workflow_token()
            .workflow_token_by_instance()
            .filter(&instance.id)
            .find(|t| {
                t.state == WorkflowTokenState::Active
                    && t.branch_key.as_deref()
                        == Some(if idx == 0 { "to-left" } else { "to-right" })
            })
            .ok_or("branch token missing")?;
        // signal from left/right node
        let signal = if idx == 0 { "left" } else { "right" };
        signal_workflow(
            ctx,
            fixture.organization_id,
            SignalWorkflowParams {
                company_id: fixture.company_id,
                instance_id: instance.id,
                expected_revision: instance.revision,
                signal_key: signal.into(),
                snapshot: snapshot.clone(),
                idempotency_key: format!("branch-join-{key}"),
                correlation_id: format!("corr-{key}"),
                causation_id: None,
            },
        )?;
        let _ = token;
    }

    let fork = ctx
        .db
        .workflow_fork()
        .workflow_fork_by_instance()
        .filter(&instance.id)
        .next()
        .ok_or("fork missing after join")?;
    if fork.open {
        return Err("AND join did not close the fork".to_string());
    }
    let arrivals = ctx
        .db
        .workflow_join_arrival()
        .workflow_join_arrival_by_fork()
        .filter(&fork.id)
        .count();
    if arrivals != 2 {
        return Err(format!("expected 2 join arrivals, got {arrivals}"));
    }
    Ok(())
}

/// WRK-001: start_workflow validates subject_id against a real row in the
/// table named by subject_model — "branch.subject" is not a recognized model.
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

fn seed_and_graph(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<(u64, u64), String> {
    create_workflow(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            workflow_key: "branch.and".into(),
            model: "purchase_order".into(),
            name: "AND join".into(),
            description: None,
            trigger: WorkflowTrigger::Manual,
            schema_version: 1,
            snapshot_fields: vec![],
            metadata: None,
        },
    )?;
    let wf = ctx
        .db
        .workflow()
        .workflow_by_org()
        .filter(&fixture.organization_id)
        .find(|row| row.workflow_key == "branch.and")
        .ok_or("workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&wf.id)
        .find(|row| row.status == WorkflowVersionStatus::Draft)
        .ok_or("draft missing")?;
    let mut rev = version.draft_revision;
    use crate::workflow::definitions::{
        WorkflowHumanTaskKind, WorkflowTaskAssignment, WorkflowTaskPolicy,
    };
    for (key, name, kind, split, join, seq) in [
        (
            "start",
            "Start",
            WorkflowNodeKind::Start,
            WorkflowBranchKind::None,
            WorkflowBranchKind::None,
            1u32,
        ),
        (
            "fork",
            "Fork",
            WorkflowNodeKind::Fork,
            WorkflowBranchKind::And,
            WorkflowBranchKind::None,
            2,
        ),
        (
            "left",
            "Left",
            WorkflowNodeKind::HumanTask,
            WorkflowBranchKind::None,
            WorkflowBranchKind::None,
            3,
        ),
        (
            "right",
            "Right",
            WorkflowNodeKind::HumanTask,
            WorkflowBranchKind::None,
            WorkflowBranchKind::None,
            4,
        ),
        (
            "join",
            "Join",
            WorkflowNodeKind::Join,
            WorkflowBranchKind::None,
            WorkflowBranchKind::And,
            5,
        ),
        (
            "end",
            "End",
            WorkflowNodeKind::End,
            WorkflowBranchKind::None,
            WorkflowBranchKind::None,
            6,
        ),
    ] {
        let task_policy = if kind == WorkflowNodeKind::HumanTask {
            Some(WorkflowTaskPolicy {
                kind: WorkflowHumanTaskKind::Complete,
                assignment: WorkflowTaskAssignment::AnyCandidate,
                candidate_role_ids: vec![1],
                candidate_group_ids: vec![],
                candidate_unit_ids: vec![],
                require_comment_on_reject: false,
            })
        } else {
            None
        };
        upsert_workflow_node(
            ctx,
            fixture.organization_id,
            version.id,
            rev,
            UpsertWorkflowNodeParams {
                node_key: key.into(),
                name: name.into(),
                kind,
                sequence: seq,
                split_kind: split,
                join_kind: join,
                action: None,
                task_policy,
                timer_policy: None,
                retry_policy: None,
                subflow: None,
                metadata: None,
            },
        )?;
        rev += 1;
    }
    for (ek, from, to, seq, signal) in [
        ("to-fork", "start", "fork", 1u32, Some("start")),
        ("to-left", "fork", "left", 1, None),
        ("to-right", "fork", "right", 2, None),
        ("left-join", "left", "join", 1, Some("left")),
        ("right-join", "right", "join", 1, Some("right")),
        ("joined", "join", "end", 1, None),
    ] {
        upsert_workflow_edge(
            ctx,
            fixture.organization_id,
            version.id,
            rev,
            UpsertWorkflowEdgeParams {
                edge_key: ek.into(),
                from_node_key: from.into(),
                to_node_key: to.into(),
                sequence: seq,
                signal_key: signal.map(str::to_string),
                condition: None,
                metadata: None,
            },
        )?;
        rev += 1;
    }
    publish_workflow_version(ctx, fixture.organization_id, version.id, rev)?;
    Ok((wf.id, version.id))
}

fn node(
    id: u64,
    key: &str,
    kind: WorkflowNodeKind,
    split: WorkflowBranchKind,
    join: WorkflowBranchKind,
    sequence: u32,
) -> crate::workflow::definitions::WorkflowNode {
    let zero = Identity::from_byte_array([0u8; 32]);
    let ts = Timestamp::from_micros_since_unix_epoch(0);
    crate::workflow::definitions::WorkflowNode {
        id,
        organization_id: 1,
        company_id: None,
        workflow_id: 1,
        workflow_version_id: 1,
        node_key: key.into(),
        name: key.into(),
        kind,
        sequence,
        split_kind: split,
        join_kind: join,
        action: None,
        task_policy: None,
        timer_policy: None,
        retry_policy: None,
        subflow: None,
        create_uid: zero,
        create_date: ts,
        write_uid: zero,
        write_date: ts,
        metadata: None,
    }
}

fn edge(
    id: u64,
    key: &str,
    from: &str,
    to: &str,
    sequence: u32,
) -> crate::workflow::definitions::WorkflowEdge {
    let zero = Identity::from_byte_array([0u8; 32]);
    let ts = Timestamp::from_micros_since_unix_epoch(0);
    crate::workflow::definitions::WorkflowEdge {
        id,
        organization_id: 1,
        company_id: None,
        workflow_id: 1,
        workflow_version_id: 1,
        edge_key: key.into(),
        from_node_key: from.into(),
        to_node_key: to.into(),
        sequence,
        signal_key: None,
        condition: None,
        create_uid: zero,
        create_date: ts,
        write_uid: zero,
        write_date: ts,
        metadata: None,
    }
}
