//! Active-version migration tests (WF-15).

use spacetimedb::ReducerContext;

use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::workflow::definitions::{
    clone_workflow_version_to_draft, create_workflow, publish_workflow_version,
    upsert_workflow_edge, upsert_workflow_node, workflow, workflow_version, CreateWorkflowParams,
    UpsertWorkflowEdgeParams, UpsertWorkflowNodeParams, WorkflowBranchKind, WorkflowHumanTaskKind,
    WorkflowNodeKind, WorkflowTaskAssignment, WorkflowTaskPolicy, WorkflowTrigger,
    WorkflowVersionStatus,
};
use crate::workflow::evaluator::{canonical_condition_snapshot_hash, ConditionSnapshot};
use crate::workflow::migration::{
    create_workflow_migration_plan, migrate_workflow_instance, preflight_workflow_migration,
    workflow_migration_instance_result, workflow_migration_plan, workflow_migration_preflight,
    CreateWorkflowMigrationPlanParams, MigrateWorkflowInstanceParams,
    PreflightWorkflowMigrationParams, WorkflowMigrationOutcome, WorkflowNodeMigrationMapping,
};
use crate::workflow::runtime::{
    start_workflow, workflow_decision_event, workflow_instance, workflow_token,
    StartWorkflowParams, WorkflowCommandKind, WorkflowTokenState,
};

pub fn test_workflow_migration(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    test_compatible_migrate_once(ctx)?;
    test_stale_revision_rejected(ctx)?;
    test_missing_mapping_rejected(ctx)?;
    test_unpublished_target_rejected(ctx)?;
    test_human_task_kind_mismatch_rejected(ctx)?;
    Ok(())
}

fn test_compatible_migrate_once(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (workflow_id, v1_id, instance_id, revision) =
        seed_started_instance(ctx, &fixture, "mig.happy")?;
    let v2_id = publish_cloned_v2(ctx, fixture.organization_id, v1_id)?;

    create_workflow_migration_plan(
        ctx,
        fixture.organization_id,
        CreateWorkflowMigrationPlanParams {
            company_id: fixture.company_id,
            workflow_id,
            source_workflow_version_id: v1_id,
            target_workflow_version_id: v2_id,
            node_mappings: identity_nodes(&["start", "middle", "end"]),
            fork_mappings: vec![],
            edge_mappings: identity_edges(&["e_start", "e_middle"]),
            active: true,
        },
    )?;
    let plan = latest_plan(ctx, workflow_id)?;

    preflight_workflow_migration(
        ctx,
        fixture.organization_id,
        PreflightWorkflowMigrationParams {
            company_id: fixture.company_id,
            plan_id: plan.id,
            instance_id,
        },
    )?;
    let preflight = ctx
        .db
        .workflow_migration_preflight()
        .migration_preflight_by_instance()
        .filter(&instance_id)
        .last()
        .ok_or("preflight row missing")?;
    if !preflight.compatible {
        return Err(format!("preflight failed: {:?}", preflight.errors));
    }

    let migrate = MigrateWorkflowInstanceParams {
        company_id: fixture.company_id,
        plan_id: plan.id,
        instance_id,
        expected_instance_revision: revision,
        reason: "cutover to published v2".into(),
        idempotency_key: "mig-happy-1".into(),
        correlation_id: "corr-mig-happy".into(),
        causation_id: None,
    };
    migrate_workflow_instance(ctx, fixture.organization_id, migrate.clone())?;

    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance_id)
        .ok_or("migrated instance missing")?;
    if instance.workflow_version_id != v2_id || instance.revision != revision + 1 {
        return Err(format!(
            "instance not migrated: version={} revision={}",
            instance.workflow_version_id, instance.revision
        ));
    }
    let token = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance_id)
        .find(|t| t.state == WorkflowTokenState::Active)
        .ok_or("active token missing after migrate")?;
    if token.workflow_version_id != v2_id || token.node_key != "start" {
        return Err("token was not remapped onto target version".into());
    }
    let events = ctx
        .db
        .workflow_decision_event()
        .workflow_event_by_instance()
        .filter(&instance_id)
        .filter(|e| e.command_kind == WorkflowCommandKind::Migration)
        .count();
    if events != 1 {
        return Err(format!("expected one Migration event, got {events}"));
    }
    let results = ctx
        .db
        .workflow_migration_instance_result()
        .migration_result_by_instance()
        .filter(&instance_id)
        .filter(|r| matches!(r.outcome, WorkflowMigrationOutcome::Succeeded))
        .count();
    if results != 1 {
        return Err(format!("expected one success result, got {results}"));
    }

    // Identical replay must not bump again.
    migrate_workflow_instance(ctx, fixture.organization_id, migrate)?;
    let again = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance_id)
        .ok_or("instance missing after replay")?;
    if again.revision != revision + 1
        || ctx
            .db
            .workflow_decision_event()
            .workflow_event_by_instance()
            .filter(&instance_id)
            .filter(|e| e.command_kind == WorkflowCommandKind::Migration)
            .count()
            != 1
    {
        return Err("migration replay was not idempotent".into());
    }
    Ok(())
}

fn test_stale_revision_rejected(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (workflow_id, v1_id, instance_id, revision) =
        seed_started_instance(ctx, &fixture, "mig.stale")?;
    let v2_id = publish_cloned_v2(ctx, fixture.organization_id, v1_id)?;
    create_workflow_migration_plan(
        ctx,
        fixture.organization_id,
        CreateWorkflowMigrationPlanParams {
            company_id: fixture.company_id,
            workflow_id,
            source_workflow_version_id: v1_id,
            target_workflow_version_id: v2_id,
            node_mappings: identity_nodes(&["start", "middle", "end"]),
            fork_mappings: vec![],
            edge_mappings: identity_edges(&["e_start", "e_middle"]),
            active: true,
        },
    )?;
    let plan = latest_plan(ctx, workflow_id)?;
    let err = migrate_workflow_instance(
        ctx,
        fixture.organization_id,
        MigrateWorkflowInstanceParams {
            company_id: fixture.company_id,
            plan_id: plan.id,
            instance_id,
            expected_instance_revision: revision + 99,
            reason: "stale attempt".into(),
            idempotency_key: "mig-stale-1".into(),
            correlation_id: "corr-mig-stale".into(),
            causation_id: None,
        },
    )
    .err()
    .ok_or("stale revision was accepted")?;
    if !err.contains("stale") {
        return Err(format!("unexpected stale error: {err}"));
    }
    assert_still_on_version(ctx, instance_id, v1_id, revision)
}

fn test_missing_mapping_rejected(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (workflow_id, v1_id, instance_id, revision) =
        seed_started_instance(ctx, &fixture, "mig.missing")?;
    let v2_id = publish_cloned_v2(ctx, fixture.organization_id, v1_id)?;
    create_workflow_migration_plan(
        ctx,
        fixture.organization_id,
        CreateWorkflowMigrationPlanParams {
            company_id: fixture.company_id,
            workflow_id,
            source_workflow_version_id: v1_id,
            target_workflow_version_id: v2_id,
            // Intentionally omit the active token's "start" node.
            node_mappings: identity_nodes(&["middle", "end"]),
            fork_mappings: vec![],
            edge_mappings: vec![],
            active: true,
        },
    )?;
    let plan = latest_plan(ctx, workflow_id)?;
    preflight_workflow_migration(
        ctx,
        fixture.organization_id,
        PreflightWorkflowMigrationParams {
            company_id: fixture.company_id,
            plan_id: plan.id,
            instance_id,
        },
    )?;
    let preflight = ctx
        .db
        .workflow_migration_preflight()
        .migration_preflight_by_instance()
        .filter(&instance_id)
        .last()
        .ok_or("missing-mapping preflight missing")?;
    if preflight.compatible {
        return Err("missing mapping preflight reported compatible".into());
    }
    let err = migrate_workflow_instance(
        ctx,
        fixture.organization_id,
        MigrateWorkflowInstanceParams {
            company_id: fixture.company_id,
            plan_id: plan.id,
            instance_id,
            expected_instance_revision: revision,
            reason: "missing mapping".into(),
            idempotency_key: "mig-missing-1".into(),
            correlation_id: "corr-mig-missing".into(),
            causation_id: None,
        },
    )
    .err()
    .ok_or("missing mapping migrate was accepted")?;
    if !err.contains("no mapping") {
        return Err(format!("unexpected missing-mapping error: {err}"));
    }
    assert_still_on_version(ctx, instance_id, v1_id, revision)
}

fn test_unpublished_target_rejected(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (workflow_id, v1_id, _instance_id, _) =
        seed_started_instance(ctx, &fixture, "mig.unpublished")?;
    let v1 = ctx
        .db
        .workflow_version()
        .id()
        .find(&v1_id)
        .ok_or("v1 missing")?;
    clone_workflow_version_to_draft(ctx, fixture.organization_id, v1_id, v1.draft_revision)?;
    let draft = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow_id)
        .find(|v| v.status == WorkflowVersionStatus::Draft)
        .ok_or("draft v2 missing")?;
    let err = create_workflow_migration_plan(
        ctx,
        fixture.organization_id,
        CreateWorkflowMigrationPlanParams {
            company_id: fixture.company_id,
            workflow_id,
            source_workflow_version_id: v1_id,
            target_workflow_version_id: draft.id,
            node_mappings: identity_nodes(&["start", "middle", "end"]),
            fork_mappings: vec![],
            edge_mappings: vec![],
            active: true,
        },
    )
    .err()
    .ok_or("unpublished target plan was accepted")?;
    if !err.contains("not published") {
        return Err(format!("unexpected unpublished error: {err}"));
    }
    Ok(())
}

fn test_human_task_kind_mismatch_rejected(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (workflow_id, v1_id, instance_id, revision) =
        seed_instance_on_human_task(ctx, &fixture, "mig.taskkind")?;
    let v1 = ctx
        .db
        .workflow_version()
        .id()
        .find(&v1_id)
        .ok_or("task v1 missing")?;
    clone_workflow_version_to_draft(ctx, fixture.organization_id, v1_id, v1.draft_revision)?;
    let draft = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow_id)
        .find(|v| v.status == WorkflowVersionStatus::Draft)
        .ok_or("task draft missing")?;
    let mut rev = draft.draft_revision;
    upsert_workflow_node(
        ctx,
        fixture.organization_id,
        draft.id,
        rev,
        UpsertWorkflowNodeParams {
            node_key: "approve".into(),
            name: "Approve Complete".into(),
            kind: WorkflowNodeKind::HumanTask,
            sequence: 2,
            split_kind: WorkflowBranchKind::None,
            join_kind: WorkflowBranchKind::None,
            action: None,
            task_policy: Some(WorkflowTaskPolicy {
                kind: WorkflowHumanTaskKind::Complete,
                assignment: WorkflowTaskAssignment::AnyCandidate,
                candidate_role_ids: vec![1],
                candidate_group_ids: vec![],
                candidate_unit_ids: vec![],
                require_comment_on_reject: false,
            }),
            timer_policy: None,
            retry_policy: None,
            subflow: None,
            metadata: None,
        },
    )?;
    rev += 1;
    publish_workflow_version(ctx, fixture.organization_id, draft.id, rev)?;
    let v2_id = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow_id)
        .find(|v| v.status == WorkflowVersionStatus::Published && v.id != v1_id)
        .map(|v| v.id)
        .ok_or("task v2 missing")?;

    create_workflow_migration_plan(
        ctx,
        fixture.organization_id,
        CreateWorkflowMigrationPlanParams {
            company_id: fixture.company_id,
            workflow_id,
            source_workflow_version_id: v1_id,
            target_workflow_version_id: v2_id,
            node_mappings: identity_nodes(&["start", "approve", "end"]),
            fork_mappings: vec![],
            edge_mappings: identity_edges(&["e_start", "e_approve"]),
            active: true,
        },
    )?;
    let plan = latest_plan(ctx, workflow_id)?;
    let err = migrate_workflow_instance(
        ctx,
        fixture.organization_id,
        MigrateWorkflowInstanceParams {
            company_id: fixture.company_id,
            plan_id: plan.id,
            instance_id,
            expected_instance_revision: revision,
            reason: "kind mismatch".into(),
            idempotency_key: "mig-kind-1".into(),
            correlation_id: "corr-mig-kind".into(),
            causation_id: None,
        },
    )
    .err()
    .ok_or("human task kind mismatch was accepted")?;
    if !err.contains("kind mismatch") && !err.contains("HumanTask") {
        return Err(format!("unexpected kind-mismatch error: {err}"));
    }
    assert_still_on_version(ctx, instance_id, v1_id, revision)
}

// ============================================================================
// FIXTURES
// ============================================================================

fn seed_started_instance(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    workflow_key: &str,
) -> Result<(u64, u64, u64, u64), String> {
    let (workflow_id, version_id) = seed_linear_v1(ctx, fixture, workflow_key)?;
    let snapshot = empty_snapshot(7)?;
    start_workflow(
        ctx,
        fixture.organization_id,
        StartWorkflowParams {
            company_id: fixture.company_id,
            workflow_id,
            workflow_version_id: version_id,
            subject_model: "mig.subject".into(),
            subject_id: 7,
            subject_revision_hash: snapshot.subject_revision_hash,
            singleton_trigger_key: None,
            idempotency_key: format!("start-{workflow_key}"),
            correlation_id: format!("corr-{workflow_key}"),
            causation_id: None,
        },
    )?;
    let instance = ctx
        .db
        .workflow_instance()
        .instance_by_workflow()
        .filter(&workflow_id)
        .next()
        .ok_or("started instance missing")?;
    Ok((workflow_id, version_id, instance.id, instance.revision))
}

fn seed_linear_v1(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    workflow_key: &str,
) -> Result<(u64, u64), String> {
    create_workflow(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            workflow_key: workflow_key.into(),
            model: "mig.subject".into(),
            name: "Migration linear".into(),
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
        .workflow_by_key()
        .filter(&workflow_key.to_string())
        .find(|w| w.organization_id == fixture.organization_id)
        .ok_or("migration workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow.id)
        .find(|v| v.status == WorkflowVersionStatus::Draft)
        .ok_or("migration draft missing")?;
    let mut rev = version.draft_revision;
    for (key, kind, seq) in [
        ("start", WorkflowNodeKind::Start, 1),
        ("middle", WorkflowNodeKind::Decision, 2),
        ("end", WorkflowNodeKind::End, 3),
    ] {
        upsert_workflow_node(
            ctx,
            fixture.organization_id,
            version.id,
            rev,
            UpsertWorkflowNodeParams {
                node_key: key.into(),
                name: key.into(),
                kind,
                sequence: seq,
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
        rev += 1;
    }
    for (ek, from, to, seq, signal) in [
        ("e_start", "start", "middle", 1, Some("go")),
        ("e_middle", "middle", "end", 1, None),
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
    Ok((workflow.id, version.id))
}

fn seed_human_task_v1(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    workflow_key: &str,
) -> Result<(u64, u64), String> {
    create_workflow(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            workflow_key: workflow_key.into(),
            model: "mig.subject".into(),
            name: "Migration human".into(),
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
        .workflow_by_key()
        .filter(&workflow_key.to_string())
        .find(|w| w.organization_id == fixture.organization_id)
        .ok_or("human migration workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow.id)
        .find(|v| v.status == WorkflowVersionStatus::Draft)
        .ok_or("human migration draft missing")?;
    let mut rev = version.draft_revision;
    for (key, kind, seq, policy) in [
        ("start", WorkflowNodeKind::Start, 1, None),
        (
            "approve",
            WorkflowNodeKind::HumanTask,
            2,
            Some(WorkflowTaskPolicy {
                kind: WorkflowHumanTaskKind::ApproveReject,
                assignment: WorkflowTaskAssignment::AnyCandidate,
                candidate_role_ids: vec![1],
                candidate_group_ids: vec![],
                candidate_unit_ids: vec![],
                require_comment_on_reject: false,
            }),
        ),
        ("end", WorkflowNodeKind::End, 3, None),
    ] {
        upsert_workflow_node(
            ctx,
            fixture.organization_id,
            version.id,
            rev,
            UpsertWorkflowNodeParams {
                node_key: key.into(),
                name: key.into(),
                kind,
                sequence: seq,
                split_kind: WorkflowBranchKind::None,
                join_kind: WorkflowBranchKind::None,
                action: None,
                task_policy: policy,
                timer_policy: None,
                retry_policy: None,
                subflow: None,
                metadata: None,
            },
        )?;
        rev += 1;
    }
    for (ek, from, to, seq, signal) in [
        ("e_start", "start", "approve", 1, Some("go")),
        ("e_approve", "approve", "end", 1, Some("approved")),
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
    Ok((workflow.id, version.id))
}

fn seed_instance_on_human_task(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    workflow_key: &str,
) -> Result<(u64, u64, u64, u64), String> {
    use crate::workflow::approvals::{
        create_workflow_human_task_internal, CreateWorkflowHumanTaskParams,
    };
    use crate::workflow::runtime::signal_workflow;
    use crate::workflow::runtime::SignalWorkflowParams;

    let (workflow_id, version_id) = seed_human_task_v1(ctx, fixture, workflow_key)?;
    let snapshot = empty_snapshot(9)?;
    start_workflow(
        ctx,
        fixture.organization_id,
        StartWorkflowParams {
            company_id: fixture.company_id,
            workflow_id,
            workflow_version_id: version_id,
            subject_model: "mig.subject".into(),
            subject_id: 9,
            subject_revision_hash: snapshot.subject_revision_hash.clone(),
            singleton_trigger_key: None,
            idempotency_key: format!("start-{workflow_key}"),
            correlation_id: format!("corr-{workflow_key}"),
            causation_id: None,
        },
    )?;
    let instance = ctx
        .db
        .workflow_instance()
        .instance_by_workflow()
        .filter(&workflow_id)
        .next()
        .ok_or("human-task instance missing")?;
    signal_workflow(
        ctx,
        fixture.organization_id,
        SignalWorkflowParams {
            company_id: fixture.company_id,
            instance_id: instance.id,
            expected_revision: instance.revision,
            signal_key: "go".into(),
            snapshot: snapshot.clone(),
            idempotency_key: format!("signal-{workflow_key}"),
            correlation_id: format!("corr-signal-{workflow_key}"),
            causation_id: None,
        },
    )?;
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance.id)
        .ok_or("instance missing after signal")?;
    let token = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
        .find(|t| t.state == WorkflowTokenState::Active && t.node_key == "approve")
        .ok_or("token not on approve")?;
    create_workflow_human_task_internal(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateWorkflowHumanTaskParams {
            instance_id: instance.id,
            token_id: token.id,
            guarded_action: None,
            requested_by: ctx.sender(),
            correlation_id: format!("task-{workflow_key}"),
            subject_revision_hash: None,
        },
    )?;
    Ok((workflow_id, version_id, instance.id, instance.revision))
}

fn publish_cloned_v2(
    ctx: &ReducerContext,
    organization_id: u64,
    source_version_id: u64,
) -> Result<u64, String> {
    let source = ctx
        .db
        .workflow_version()
        .id()
        .find(&source_version_id)
        .ok_or("clone source missing")?;
    clone_workflow_version_to_draft(
        ctx,
        organization_id,
        source_version_id,
        source.draft_revision,
    )?;
    let draft = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&source.workflow_id)
        .find(|v| v.status == WorkflowVersionStatus::Draft)
        .ok_or("cloned draft missing")?;
    publish_workflow_version(ctx, organization_id, draft.id, draft.draft_revision)?;
    Ok(draft.id)
}

fn identity_nodes(keys: &[&str]) -> Vec<WorkflowNodeMigrationMapping> {
    keys.iter()
        .map(|k| WorkflowNodeMigrationMapping {
            from_node_key: (*k).into(),
            to_node_key: (*k).into(),
        })
        .collect()
}

fn identity_edges(keys: &[&str]) -> Vec<crate::workflow::migration::WorkflowEdgeMigrationMapping> {
    keys.iter()
        .map(
            |k| crate::workflow::migration::WorkflowEdgeMigrationMapping {
                from_edge_key: (*k).into(),
                to_edge_key: (*k).into(),
            },
        )
        .collect()
}

fn latest_plan(
    ctx: &ReducerContext,
    workflow_id: u64,
) -> Result<crate::workflow::migration::WorkflowMigrationPlan, String> {
    ctx.db
        .workflow_migration_plan()
        .migration_plan_by_workflow()
        .filter(&workflow_id)
        .last()
        .ok_or_else(|| "migration plan missing".into())
}

fn assert_still_on_version(
    ctx: &ReducerContext,
    instance_id: u64,
    version_id: u64,
    revision: u64,
) -> Result<(), String> {
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance_id)
        .ok_or("instance missing")?;
    if instance.workflow_version_id != version_id || instance.revision != revision {
        return Err(format!(
            "instance mutated on rejected migrate: version={} revision={}",
            instance.workflow_version_id, instance.revision
        ));
    }
    Ok(())
}

fn empty_snapshot(subject_id: u64) -> Result<ConditionSnapshot, String> {
    let mut snapshot = ConditionSnapshot {
        subject_model: "mig.subject".into(),
        subject_id,
        subject_revision_hash: String::new(),
        fields: vec![],
    };
    snapshot.subject_revision_hash =
        canonical_condition_snapshot_hash(&snapshot).map_err(|e| e.to_string())?;
    Ok(snapshot)
}
