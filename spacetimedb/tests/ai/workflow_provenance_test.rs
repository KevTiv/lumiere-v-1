//! Persisted-fixture tests for harness-generated workflow provenance.
//!
//! Each scenario drives the real reducers and reads the durable state back:
//! source passage → claim → accepted decision → workflow step component. The
//! suite runs as one authenticated sender, so "another person" is expressed by
//! writing the creator onto the row, as in the evidence suite.
use spacetimedb::{ReducerContext, Table};

use crate::ai::evidence_dependency::{
    ai_evidence_dependency, record_ai_evidence_source_change, resolve_ai_evidence_dependency,
};
use crate::ai::evidence_lineage::{
    ai_artifact_component, ai_evidence_claim, ai_evidence_decision,
    review_ai_artifact_component_links, review_ai_evidence_claim, review_ai_evidence_decision,
    AiArtifactComponent, ReviewAiArtifactComponentLinksParams, ReviewAiEvidenceClaimParams,
    ReviewAiEvidenceDecisionParams,
};
use crate::ai::evidence_source::{ai_evidence_passage, record_ai_evidence_source_version};
use crate::ai::skills::{ai_agent_run, AiAgentRun};
use crate::ai::workflow_provenance::{
    ai_workflow_generation, ai_workflow_node_provenance, begin_ai_workflow_generation,
    component_key_for, require_version_provenance_current, stage_ai_workflow_node_provenance,
    version_artifact_ref, StageAiWorkflowNodeProvenanceParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::workflow::definitions::{
    canonical_node_hash, clone_workflow_version_to_draft, create_workflow,
    publish_workflow_version, upsert_workflow_edge, upsert_workflow_node, workflow, workflow_node,
    workflow_version, ConditionFieldDefinition, CreateWorkflowParams, UpsertWorkflowEdgeParams,
    UpsertWorkflowNodeParams, WorkflowBranchKind, WorkflowNodeKind, WorkflowTimerKind,
    WorkflowTimerPolicy, WorkflowTrigger, WorkflowVersionStatus,
};

use super::evidence_provenance_test::{
    accept, assert_eq_str, change, expect_err, hand_claim_to_another_creator,
    seed_accepted_decision, seed_claim, seed_evidence, version_id, version_params, Evidence,
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

fn timer(key: &str, sequence: u32, name: &str) -> UpsertWorkflowNodeParams {
    UpsertWorkflowNodeParams {
        node_key: key.to_string(),
        name: name.to_string(),
        kind: WorkflowNodeKind::Timer,
        sequence,
        split_kind: WorkflowBranchKind::None,
        join_kind: WorkflowBranchKind::None,
        action: None,
        task_policy: None,
        timer_policy: Some(WorkflowTimerPolicy {
            kind: WorkflowTimerKind::Delay,
            delay_seconds: 60,
            calendar_key: None,
        }),
        retry_policy: None,
        subflow: None,
        metadata: None,
    }
}

fn routing(key: &str, kind: WorkflowNodeKind, sequence: u32) -> UpsertWorkflowNodeParams {
    UpsertWorkflowNodeParams {
        timer_policy: None,
        kind,
        ..timer(key, sequence, key)
    }
}

fn edge(key: &str, from: &str, to: &str, sequence: u32) -> UpsertWorkflowEdgeParams {
    UpsertWorkflowEdgeParams {
        edge_key: key.to_string(),
        from_node_key: from.to_string(),
        to_node_key: to.to_string(),
        sequence,
        signal_key: None,
        condition: None,
        metadata: None,
    }
}

fn revision(ctx: &ReducerContext, version_id: u64) -> Result<u64, String> {
    ctx.db
        .workflow_version()
        .id()
        .find(&version_id)
        .map(|v| v.draft_revision)
        .ok_or_else(|| "workflow version missing".to_string())
}

/// `start -> <material...> -> end`, one Timer per material key.
fn build_draft(
    ctx: &ReducerContext,
    f: &OrgFixture,
    key: &str,
    material: &[&str],
) -> Result<u64, String> {
    let org = f.organization_id;
    create_workflow(
        ctx,
        org,
        Some(f.company_id),
        CreateWorkflowParams {
            workflow_key: key.to_string(),
            model: "purchase_order".to_string(),
            name: "Generated workflow".to_string(),
            description: None,
            trigger: WorkflowTrigger::Manual,
            schema_version: 1,
            snapshot_fields: Vec::<ConditionFieldDefinition>::new(),
            metadata: None,
        },
    )?;
    let workflow_id = ctx
        .db
        .workflow()
        .iter()
        .find(|w| w.organization_id == org && w.workflow_key == key)
        .ok_or("workflow missing")?
        .id;
    let version_id = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&workflow_id)
        .find(|v| v.status == WorkflowVersionStatus::Draft)
        .ok_or("draft missing")?
        .id;
    let mut order: Vec<String> = vec!["start".into()];
    upsert_workflow_node(
        ctx,
        org,
        version_id,
        revision(ctx, version_id)?,
        routing("start", WorkflowNodeKind::Start, 1),
    )?;
    for (index, node_key) in material.iter().enumerate() {
        upsert_workflow_node(
            ctx,
            org,
            version_id,
            revision(ctx, version_id)?,
            timer(node_key, 2 + index as u32, node_key),
        )?;
        order.push((*node_key).to_string());
    }
    upsert_workflow_node(
        ctx,
        org,
        version_id,
        revision(ctx, version_id)?,
        routing("end", WorkflowNodeKind::End, 99),
    )?;
    order.push("end".into());
    for (index, pair) in order.windows(2).enumerate() {
        upsert_workflow_edge(
            ctx,
            org,
            version_id,
            revision(ctx, version_id)?,
            edge(&format!("e{index}"), &pair[0], &pair[1], index as u32 + 1),
        )?;
    }
    Ok(version_id)
}

fn seed_run(ctx: &ReducerContext, org: u64, company: u64, status: &str) -> u64 {
    ctx.db
        .ai_agent_run()
        .insert(AiAgentRun {
            id: 0,
            organization_id: org,
            company_id: company,
            skill_id: 0,
            skill_config_id: None,
            agent_id: 0,
            team_member_id: None,
            run_key: format!(
                "run-{org}-{company}-{status}-{}",
                ctx.timestamp.to_micros_since_unix_epoch()
            ),
            status: status.to_string(),
            inputs_json: "{}".to_string(),
            summary: None,
            artifacts_json: None,
            citations_json: None,
            action_draft_ids: vec![],
            step_count: 0,
            tokens_used: 0,
            error_message: None,
            triggered_by_hex: ctx.sender().to_hex().to_string(),
            started_at: ctx.timestamp,
            completed_at: None,
            create_date: ctx.timestamp,
            write_date: ctx.timestamp,
            metadata: None,
        })
        .id
}

/// Everything a generated workflow needs: evidence, a human-reviewed claim
/// and an accepted decision, all in one company.
struct Foundation {
    evidence: Evidence,
    claim_id: u64,
    decision_id: u64,
}

fn seed_foundation(ctx: &ReducerContext, f: &OrgFixture, key: &str) -> Result<Foundation, String> {
    let (org, company) = (f.organization_id, f.company_id);
    let evidence = seed_evidence(ctx, org, company, key, "company")?;
    let claim_id = seed_claim(ctx, org, company, vec![evidence.passage_id])?;
    hand_claim_to_another_creator(ctx, claim_id)?;
    review_ai_evidence_claim(
        ctx,
        org,
        company,
        claim_id,
        ReviewAiEvidenceClaimParams {
            verification_outcome: "supported".into(),
            verification_note: Some("checked".into()),
        },
    )?;
    let decision_id = seed_accepted_decision(ctx, org, company, vec![claim_id], vec![])?;
    Ok(Foundation {
        evidence,
        claim_id,
        decision_id,
    })
}

fn begin(ctx: &ReducerContext, f: &OrgFixture, version_id: u64, run_id: u64) -> Result<(), String> {
    begin_ai_workflow_generation(
        ctx,
        f.organization_id,
        f.company_id,
        version_id,
        revision(ctx, version_id)?,
        run_id,
    )
}

fn stage(
    ctx: &ReducerContext,
    f: &OrgFixture,
    version_id: u64,
    node_key: &str,
    decisions: Vec<u64>,
    claims: Vec<u64>,
) -> Result<(), String> {
    stage_ai_workflow_node_provenance(
        ctx,
        f.organization_id,
        f.company_id,
        version_id,
        revision(ctx, version_id)?,
        StageAiWorkflowNodeProvenanceParams {
            node_key: node_key.to_string(),
            decision_ids: decisions,
            claim_ids: claims,
        },
    )
}

fn publish(ctx: &ReducerContext, f: &OrgFixture, version_id: u64) -> Result<(), String> {
    publish_workflow_version(
        ctx,
        f.organization_id,
        version_id,
        revision(ctx, version_id)?,
    )
}

fn components_of(ctx: &ReducerContext, org: u64, version_id: u64) -> Vec<AiArtifactComponent> {
    ctx.db
        .ai_artifact_component()
        .ai_artifact_component_by_artifact()
        .filter((&org, &version_artifact_ref(version_id)))
        .collect()
}

fn current_component(
    ctx: &ReducerContext,
    org: u64,
    version_id: u64,
    node_key: &str,
) -> Result<AiArtifactComponent, String> {
    components_of(ctx, org, version_id)
        .into_iter()
        .find(|c| c.component_key == component_key_for(node_key) && c.status == "current")
        .ok_or_else(|| format!("no current component for {version_id}/{node_key}"))
}

fn node_hash(ctx: &ReducerContext, version_id: u64, node_key: &str) -> Result<String, String> {
    let node = ctx
        .db
        .workflow_node()
        .workflow_node_by_version()
        .filter(&version_id)
        .find(|n| n.node_key == node_key)
        .ok_or("node missing")?;
    canonical_node_hash(&node)
}

fn is_published(ctx: &ReducerContext, version_id: u64) -> bool {
    ctx.db
        .workflow_version()
        .id()
        .find(&version_id)
        .is_some_and(|v| v.status == WorkflowVersionStatus::Published)
}

/// `node -> decision -> claim -> passage`, walked from persisted rows only.
fn walk_to_passage(
    ctx: &ReducerContext,
    component: &AiArtifactComponent,
    expected_passage: u64,
) -> Result<(), String> {
    let decision_id = *component
        .decision_ids
        .first()
        .ok_or("component has no decision")?;
    let decision = ctx
        .db
        .ai_evidence_decision()
        .id()
        .find(&decision_id)
        .ok_or("decision missing")?;
    assert_eq_str(&decision.status, "accepted", "decision on the chain")?;
    let claim_id = *decision
        .adopted_claim_ids
        .first()
        .ok_or("decision has no claim")?;
    let claim = ctx
        .db
        .ai_evidence_claim()
        .id()
        .find(&claim_id)
        .ok_or("claim missing")?;
    assert_eq_str(
        &claim.verification_method,
        "human_reviewed",
        "claim on the chain",
    )?;
    if !claim.supporting_passage_ids.contains(&expected_passage) {
        return Err("the claim does not rest on the expected passage".into());
    }
    ctx.db
        .ai_evidence_passage()
        .id()
        .find(&expected_passage)
        .ok_or("passage missing")?;
    Ok(())
}

fn root_ancestor(
    ctx: &ReducerContext,
    mut component: AiArtifactComponent,
) -> Result<AiArtifactComponent, String> {
    for _ in 0..16 {
        let Some(parent_id) = component.parent_component_id else {
            return Ok(component);
        };
        component = ctx
            .db
            .ai_artifact_component()
            .id()
            .find(&parent_id)
            .ok_or("ancestor missing")?;
    }
    Err("component ancestry did not terminate".into())
}

// ── Scenarios ────────────────────────────────────────────────────────────────

/// The run, tenant and status of a generated workflow are resolved by the
/// server; a caller cannot borrow another tenant's run, reuse a dead run, or
/// stage links that are not accepted, reviewed and in scope. Human-authored
/// workflows need none of it.
pub fn test_authority_is_server_resolved(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let other = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);

    // A human-authored workflow has no generation row and publishes untouched.
    let human = build_draft(ctx, &f, "wf.human", &["review"])?;
    publish(ctx, &f, human)?;
    if !components_of(ctx, org, human).is_empty() {
        return Err("a human-authored workflow acquired AI provenance".into());
    }
    if ctx
        .db
        .ai_workflow_generation()
        .workflow_version_id()
        .find(&human)
        .is_some()
    {
        return Err("a human-authored workflow was marked harness-generated".into());
    }

    let version = build_draft(ctx, &f, "wf.authority", &["review"])?;
    // Runs of another tenant, and runs that are not live or finished, are refused.
    let foreign_run = seed_run(ctx, other.organization_id, other.company_id, "running");
    expect_err(
        begin(ctx, &f, version, foreign_run),
        "does not belong",
        "cross-tenant run",
    )?;
    let failed_run = seed_run(ctx, org, company, "failed");
    expect_err(
        begin(ctx, &f, version, failed_run),
        "failed run",
        "failed run",
    )?;
    expect_err(
        begin(ctx, &f, version, 987_654_321),
        "not found",
        "unknown run",
    )?;
    // The company must be the workflow's own.
    let run = seed_run(ctx, org, company, "running");
    expect_err(
        begin_ai_workflow_generation(
            ctx,
            org,
            other.company_id,
            version,
            revision(ctx, version)?,
            run,
        ),
        "company",
        "sibling-company generation",
    )?;
    begin(ctx, &f, version, run)?;
    begin(ctx, &f, version, run)?; // idempotent retry
    let second_run = seed_run(ctx, org, company, "running");
    expect_err(
        begin(ctx, &f, version, second_run),
        "different run",
        "second run",
    )?;
    if ctx
        .db
        .ai_workflow_generation()
        .iter()
        .filter(|g| g.workflow_version_id == version)
        .count()
        != 1
    {
        return Err("a retry created a second generation row".into());
    }

    // Staging demands accepted decisions and human-reviewed claims in scope.
    let base = seed_foundation(ctx, &f, "authority-src")?;
    let foreign = seed_foundation(ctx, &other, "foreign-src")?;
    expect_err(
        stage(
            ctx,
            &f,
            version,
            "review",
            vec![foreign.decision_id],
            vec![],
        ),
        "does not belong",
        "another organization's decision",
    )?;
    expect_err(
        stage(
            ctx,
            &f,
            version,
            "review",
            vec![base.decision_id],
            vec![foreign.claim_id],
        ),
        "does not belong",
        "another organization's claim",
    )?;
    expect_err(
        stage(ctx, &f, version, "review", vec![], vec![base.claim_id]),
        "bibliography",
        "claims without a decision",
    )?;
    expect_err(
        stage(
            ctx,
            &f,
            version,
            "no-such-node",
            vec![base.decision_id],
            vec![],
        ),
        "not found",
        "unknown node",
    )?;
    // An unreviewed (model or deterministic) claim is not a reviewed claim.
    let unreviewed = seed_claim(ctx, org, company, vec![base.evidence.passage_id])?;
    expect_err(
        stage(
            ctx,
            &f,
            version,
            "review",
            vec![base.decision_id],
            vec![unreviewed],
        ),
        "reviewed by a person",
        "unreviewed claim",
    )?;
    // A proposed decision is not accepted.
    let proposed = {
        crate::ai::evidence_lineage::record_ai_evidence_decision(
            ctx,
            org,
            company,
            crate::ai::evidence_lineage::RecordAiEvidenceDecisionParams {
                title: "Proposed only".into(),
                adopted_claim_ids: vec![base.claim_id],
                supporting_claim_ids: vec![],
                applicability: vec![],
                alternatives: vec![],
                adaptations: vec![],
                assumptions: vec![],
                rationale: "Not yet accepted.".into(),
                contribution_id: None,
                supersedes_decision_id: None,
            },
        )?;
        ctx.db
            .ai_evidence_decision()
            .iter()
            .filter(|d| d.organization_id == org)
            .map(|d| d.id)
            .max()
            .ok_or("proposed decision")?
    };
    expect_err(
        stage(ctx, &f, version, "review", vec![proposed], vec![]),
        "cannot justify",
        "proposed decision",
    )?;
    Ok(())
}

/// Accepted decisions plus current reviewed claims bind every generated step,
/// with the durable record on `AiArtifactComponent`; retries create no
/// duplicates; the chain reconstructs down to the source passage.
pub fn test_generated_workflow_binds_every_step(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);
    let base = seed_foundation(ctx, &f, "bind-src")?;
    let version = build_draft(ctx, &f, "wf.bind", &["collect", "approve"])?;
    let run = seed_run(ctx, org, company, "running");
    begin(ctx, &f, version, run)?;

    // Provenance is required for every generated material step.
    expect_err(
        publish(ctx, &f, version),
        "has no provenance",
        "no provenance at all",
    )?;
    stage(
        ctx,
        &f,
        version,
        "collect",
        vec![base.decision_id],
        vec![base.claim_id],
    )?;
    expect_err(
        publish(ctx, &f, version),
        "'approve'",
        "one step still missing provenance",
    )?;
    if is_published(ctx, version) || !components_of(ctx, org, version).is_empty() {
        return Err("a refused publication left state behind".into());
    }

    // Retrying identical staging is a no-op, and carries the server's run.
    stage(
        ctx,
        &f,
        version,
        "collect",
        vec![base.decision_id],
        vec![base.claim_id],
    )?;
    stage(ctx, &f, version, "approve", vec![base.decision_id], vec![])?;
    stage(ctx, &f, version, "approve", vec![base.decision_id], vec![])?;
    let staged: Vec<_> = ctx
        .db
        .ai_workflow_node_provenance()
        .ai_workflow_node_provenance_by_version()
        .filter(&version)
        .collect();
    if staged.len() != 2
        || staged
            .iter()
            .any(|s| s.status != "current" || s.run_id != run)
    {
        return Err("staging retries were not idempotent or lost the run".into());
    }

    publish(ctx, &f, version)?;
    if !is_published(ctx, version) {
        return Err("a fully provenanced workflow did not publish".into());
    }
    let bound = components_of(ctx, org, version);
    if bound.len() != 2 {
        return Err(format!("expected 2 step components, found {}", bound.len()));
    }
    for (key, claims) in [("collect", vec![base.claim_id]), ("approve", vec![])] {
        let component = current_component(ctx, org, version, key)?;
        assert_eq_str(&component.component_kind, "workflow_step", "component kind")?;
        assert_eq_str(&component.link_state, "linked", "link state")?;
        assert_eq_str(
            &component.content_hash,
            &node_hash(ctx, version, key)?,
            "content hash",
        )?;
        if component.version != 1
            || component.parent_component_id.is_some()
            || component.decision_ids != vec![base.decision_id]
            || component.claim_ids != claims
        {
            return Err(format!(
                "component for '{key}' has the wrong links or ancestry"
            ));
        }
        walk_to_passage(ctx, &component, base.evidence.passage_id)?;
    }
    // Routing-only steps are not material and carry no component.
    if components_of(ctx, org, version)
        .iter()
        .any(|c| c.component_key == "node:start")
    {
        return Err("a routing step acquired a component".into());
    }
    // Publication is one-way: a retry neither republishes nor duplicates.
    expect_err(publish(ctx, &f, version), "immutable", "republishing")?;
    if components_of(ctx, org, version).len() != 2 {
        return Err("a retried publication duplicated components".into());
    }
    Ok(())
}

/// A stale, revoked or tampered foundation refuses publication and leaves no
/// partial binding; restaging with valid content recovers.
pub fn test_invalid_provenance_blocks_and_leaves_no_bindings(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);
    let base = seed_foundation(ctx, &f, "block-src")?;
    let version = build_draft(ctx, &f, "wf.block", &["first", "second"])?;
    begin(ctx, &f, version, seed_run(ctx, org, company, "running"))?;
    stage(
        ctx,
        &f,
        version,
        "first",
        vec![base.decision_id],
        vec![base.claim_id],
    )?;
    stage(ctx, &f, version, "second", vec![base.decision_id], vec![])?;

    // Editing a staged step's content invalidates its staging.
    let mut edited = timer("second", 3, "second (edited)");
    edited.metadata = Some("edited".into());
    upsert_workflow_node(ctx, org, version, revision(ctx, version)?, edited)?;
    expect_err(publish(ctx, &f, version), "changed after", "edited node")?;
    if is_published(ctx, version) || !components_of(ctx, org, version).is_empty() {
        return Err("an edited step left a partial binding".into());
    }
    stage(ctx, &f, version, "second", vec![base.decision_id], vec![])?;

    // A decision that lost its footing after staging blocks publication, and
    // nothing is bound even for the step that was still valid.
    crate::ai::evidence_lineage::record_ai_evidence_decision(
        ctx,
        org,
        company,
        crate::ai::evidence_lineage::RecordAiEvidenceDecisionParams {
            title: "Replacement".into(),
            adopted_claim_ids: vec![base.claim_id],
            supporting_claim_ids: vec![],
            applicability: vec![],
            alternatives: vec![],
            adaptations: vec![],
            assumptions: vec![],
            rationale: "Supersedes the staged decision.".into(),
            contribution_id: None,
            supersedes_decision_id: Some(base.decision_id),
        },
    )?;
    expect_err(
        publish(ctx, &f, version),
        "cannot justify",
        "superseded decision",
    )?;
    if is_published(ctx, version) || !components_of(ctx, org, version).is_empty() {
        return Err("a superseded decision left a partial binding".into());
    }

    // Restage on the replacement once it is independently accepted.
    let replacement = ctx
        .db
        .ai_evidence_decision()
        .iter()
        .filter(|d| d.organization_id == org && d.supersedes_decision_id == Some(base.decision_id))
        .map(|d| d.id)
        .max()
        .ok_or("replacement")?;
    accept(ctx, org, company, replacement)?;
    // The replaced claim wording is unchanged, so the reviewed claim is still current.
    stage(
        ctx,
        &f,
        version,
        "first",
        vec![replacement],
        vec![base.claim_id],
    )?;
    stage(ctx, &f, version, "second", vec![replacement], vec![])?;

    // Revoked evidence invalidates the foundation: claim, decision and the
    // staged links all fail closed.
    record_ai_evidence_source_change(
        ctx,
        org,
        company,
        base.evidence.version_id,
        change("retracted", None),
    )?;
    let refused = publish(ctx, &f, version)
        .err()
        .ok_or("publication ignored revoked evidence")?;
    if !(refused.contains("cannot justify")
        || refused.contains("required dependency")
        || refused.contains("Claim"))
    {
        return Err(format!("unexpected revoked-evidence error: {refused}"));
    }
    if is_published(ctx, version) || !components_of(ctx, org, version).is_empty() {
        return Err("revoked evidence left a partial binding".into());
    }
    Ok(())
}

/// Clone and edit keep component ancestry, mark changed content/links, refuse
/// publication until a reviewer confirms exactly the node's current hash, and
/// reconstruct through revisions.
pub fn test_clone_and_edit_preserve_ancestry_and_exact_hash_confirmation(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);
    let base = seed_foundation(ctx, &f, "clone-src")?;
    let v1 = build_draft(ctx, &f, "wf.clone", &["review"])?;
    begin(ctx, &f, v1, seed_run(ctx, org, company, "running"))?;
    stage(
        ctx,
        &f,
        v1,
        "review",
        vec![base.decision_id],
        vec![base.claim_id],
    )?;
    publish(ctx, &f, v1)?;
    let v1_component = current_component(ctx, org, v1, "review")?;

    // Clone: a generated draft that forks each component with parent lineage.
    let clone = |ctx: &ReducerContext, source: u64| -> Result<u64, String> {
        clone_workflow_version_to_draft(ctx, org, source, revision(ctx, source)?)?;
        ctx.db
            .workflow_version()
            .iter()
            .filter(|v| v.organization_id == org && v.status == WorkflowVersionStatus::Draft)
            .map(|v| v.id)
            .max()
            .ok_or_else(|| "clone missing".to_string())
    };
    let v2 = clone(ctx, v1)?;
    let generation = ctx
        .db
        .ai_workflow_generation()
        .workflow_version_id()
        .find(&v2)
        .ok_or("the clone lost its generation marker")?;
    if generation.parent_workflow_version_id != Some(v1) {
        return Err("the clone does not name its parent version".into());
    }
    let v2_component = current_component(ctx, org, v2, "review")?;
    if v2_component.parent_component_id != Some(v1_component.id)
        || v2_component.forked_from_artifact_ref.as_deref() != Some(&version_artifact_ref(v1))
        || v2_component.content_hash != v1_component.content_hash
        || v2_component.link_state != "linked"
    {
        return Err("the cloned component lost its parent lineage".into());
    }
    // Unchanged clone republishes with its links intact.
    publish(ctx, &f, v2)?;

    // A second clone edits the step: content changed, so links read `changed`.
    let v3 = clone(ctx, v2)?;
    let untouched = current_component(ctx, org, v3, "review")?;
    let mut edited = timer("review", 2, "review (edited)");
    edited.metadata = Some("tightened threshold".into());
    upsert_workflow_node(ctx, org, v3, revision(ctx, v3)?, edited)?;
    let edited_hash = node_hash(ctx, v3, "review")?;
    if edited_hash == untouched.content_hash {
        return Err("the edit did not change the node hash".into());
    }
    expect_err(
        publish(ctx, &f, v3),
        "changed after",
        "publishing an unstaged edit",
    )?;
    // Confirming the stale component cannot restore links for content it no longer has.
    expect_err(
        review_ai_artifact_component_links(
            ctx,
            org,
            company,
            untouched.id,
            ReviewAiArtifactComponentLinksParams {
                outcome: "confirmed".into(),
                note: None,
                expected_content_hash: Some(untouched.content_hash.clone()),
            },
        ),
        "changed since",
        "confirming a component whose node moved on",
    )?;

    stage(
        ctx,
        &f,
        v3,
        "review",
        vec![base.decision_id],
        vec![base.claim_id],
    )?;
    let revised = current_component(ctx, org, v3, "review")?;
    assert_eq_str(
        &revised.link_state,
        "changed",
        "link state after a content edit",
    )?;
    assert_eq_str(
        &revised.content_hash,
        &edited_hash,
        "revised component hash",
    )?;
    if revised.version != untouched.version + 1 || revised.parent_component_id != Some(untouched.id)
    {
        return Err("the in-place revision lost its parent".into());
    }
    let root = root_ancestor(ctx, revised.clone())?;
    if root.id != v1_component.id {
        return Err("the revision's ancestry does not reach the original component".into());
    }
    walk_to_passage(ctx, &root, base.evidence.passage_id)?;
    walk_to_passage(ctx, &revised, base.evidence.passage_id)?;
    // Restaging identical content is idempotent.
    stage(
        ctx,
        &f,
        v3,
        "review",
        vec![base.decision_id],
        vec![base.claim_id],
    )?;
    if components_of(ctx, org, v3)
        .iter()
        .filter(|c| c.status == "current")
        .count()
        != 1
    {
        return Err("restaging created a duplicate current component".into());
    }

    // Changed links cannot publish until a reviewer confirms them.
    expect_err(
        publish(ctx, &f, v3),
        "must confirm",
        "publishing changed links",
    )?;
    let confirm = |ctx: &ReducerContext, id: u64, hash: Option<String>| {
        review_ai_artifact_component_links(
            ctx,
            org,
            company,
            id,
            ReviewAiArtifactComponentLinksParams {
                outcome: "confirmed".into(),
                note: Some("reviewed the edit".into()),
                expected_content_hash: hash,
            },
        )
    };
    expect_err(
        confirm(ctx, revised.id, None),
        "must name the content hash",
        "confirming with no hash",
    )?;
    expect_err(
        confirm(ctx, revised.id, Some(untouched.content_hash.clone())),
        "does not match",
        "confirming a different hash",
    )?;
    confirm(ctx, revised.id, Some(edited_hash.clone()))?;
    assert_eq_str(
        &current_component(ctx, org, v3, "review")?.link_state,
        "linked",
        "confirmed state",
    )?;

    // Another edit after the confirmation is not covered by it.
    let mut again = timer("review", 2, "review (edited twice)");
    again.metadata = Some("tightened again".into());
    upsert_workflow_node(ctx, org, v3, revision(ctx, v3)?, again)?;
    let second_hash = node_hash(ctx, v3, "review")?;
    if second_hash == edited_hash {
        return Err("the second edit did not change the node hash".into());
    }
    expect_err(
        publish(ctx, &f, v3),
        "changed after",
        "publishing an edit the reviewer never saw",
    )?;
    let confirmed_component = current_component(ctx, org, v3, "review")?;
    expect_err(
        confirm(ctx, confirmed_component.id, Some(edited_hash.clone())),
        "changed since",
        "confirming the old hash against the new node",
    )?;
    stage(
        ctx,
        &f,
        v3,
        "review",
        vec![base.decision_id],
        vec![base.claim_id],
    )?;
    let latest = current_component(ctx, org, v3, "review")?;
    assert_eq_str(&latest.link_state, "changed", "state after the second edit")?;
    assert_eq_str(&latest.content_hash, &second_hash, "second revision hash")?;
    expect_err(
        publish(ctx, &f, v3),
        "must confirm",
        "publishing before the second review",
    )?;
    confirm(ctx, latest.id, Some(second_hash.clone()))?;
    publish(ctx, &f, v3)?;
    let published = current_component(ctx, org, v3, "review")?;
    assert_eq_str(
        &published.content_hash,
        &second_hash,
        "published content hash",
    )?;
    if root_ancestor(ctx, published)?.id != v1_component.id {
        return Err("the published revision lost its original ancestry".into());
    }

    // Changing the staged links (not the content) is also `changed`.
    let v4 = clone(ctx, v3)?;
    let second_claim = seed_claim(ctx, org, company, vec![base.evidence.passage_id])?;
    hand_claim_to_another_creator(ctx, second_claim)?;
    review_ai_evidence_claim(
        ctx,
        org,
        company,
        second_claim,
        ReviewAiEvidenceClaimParams {
            verification_outcome: "supported".into(),
            verification_note: Some("checked".into()),
        },
    )?;
    stage(
        ctx,
        &f,
        v4,
        "review",
        vec![base.decision_id],
        vec![base.claim_id, second_claim],
    )?;
    assert_eq_str(
        &current_component(ctx, org, v4, "review")?.link_state,
        "changed",
        "state after a link change",
    )?;
    Ok(())
}

/// Correcting or revoking a source flags the workflow component, and the
/// version cannot be reused or republished until a reviewer re-establishes it.
pub fn test_source_revocation_flags_and_blocks_workflow_reuse(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);
    let base = seed_foundation(ctx, &f, "flag-src")?;
    let v1 = build_draft(ctx, &f, "wf.flag", &["review"])?;
    begin(ctx, &f, v1, seed_run(ctx, org, company, "running"))?;
    stage(
        ctx,
        &f,
        v1,
        "review",
        vec![base.decision_id],
        vec![base.claim_id],
    )?;
    publish(ctx, &f, v1)?;
    let version = ctx.db.workflow_version().id().find(&v1).ok_or("version")?;
    require_version_provenance_current(ctx, &version)?;

    // A correction flags the component for review and stops reuse.
    // The corrected wording arrives as a new current version of the same source.
    let mut replacement = version_params("2");
    replacement.snapshot_ref = Some("files/2".into());
    record_ai_evidence_source_version(ctx, org, company, base.evidence.source_id, replacement)?;
    let replacement_id = version_id(ctx, base.evidence.source_id, "2")?;
    record_ai_evidence_source_change(
        ctx,
        org,
        company,
        base.evidence.version_id,
        change("corrected", Some(replacement_id)),
    )?;
    let flagged = current_component(ctx, org, v1, "review")?;
    if flagged.link_state == "linked" {
        return Err("a source correction did not flag the workflow component".into());
    }
    if require_version_provenance_current(ctx, &version).is_ok() {
        return Err("a flagged workflow version was still reusable".into());
    }
    // Its published content stays as it was; only reuse is blocked.
    assert_eq_str(
        &flagged.content_hash,
        &node_hash(ctx, v1, "review")?,
        "published content",
    )?;

    // A clone inherits the flag and cannot publish until the chain is reviewed.
    clone_workflow_version_to_draft(ctx, org, v1, revision(ctx, v1)?)?;
    let v2 = ctx
        .db
        .workflow_version()
        .iter()
        .filter(|v| v.organization_id == org && v.status == WorkflowVersionStatus::Draft)
        .map(|v| v.id)
        .max()
        .ok_or("clone")?;
    let inherited = current_component(ctx, org, v2, "review")?;
    if inherited.link_state == "linked" {
        return Err("the clone laundered a flagged component into linked".into());
    }
    if publish(ctx, &f, v2).is_ok() {
        return Err("a flagged clone published without review".into());
    }
    if is_published(ctx, v2) {
        return Err("a refused publication changed status".into());
    }

    // Honest re-review: reaffirm the corrected source's edges, re-review the
    // claim and decision, then confirm the exact node hash.
    let reaffirm = |ctx: &ReducerContext, kind: &str, id: u64| -> Result<(), String> {
        let edges: Vec<_> = ctx
            .db
            .ai_evidence_dependency()
            .ai_evidence_dependency_by_dependent()
            .filter((&org, &kind.to_string(), &id))
            .filter(|e| e.state == "needs_review")
            .collect();
        for edge in edges {
            resolve_ai_evidence_dependency(
                ctx,
                org,
                company,
                edge.id,
                crate::ai::evidence_dependency::ResolveAiEvidenceDependencyParams {
                    resolution: "reaffirmed".into(),
                    note: "still holds after the correction".into(),
                },
            )?;
        }
        Ok(())
    };
    reaffirm(ctx, "claim", base.claim_id)?;
    hand_claim_to_another_creator(ctx, base.claim_id)?;
    review_ai_evidence_claim(
        ctx,
        org,
        company,
        base.claim_id,
        ReviewAiEvidenceClaimParams {
            verification_outcome: "supported".into(),
            verification_note: Some("re-reviewed after correction".into()),
        },
    )?;
    reaffirm(ctx, "decision", base.decision_id)?;
    crate::ai::evidence_lineage::review_ai_evidence_decision(
        ctx,
        org,
        company,
        base.decision_id,
        ReviewAiEvidenceDecisionParams {
            outcome: "accepted".into(),
            note: None,
        },
    )?;
    reaffirm(ctx, "component", inherited.id)?;
    review_ai_artifact_component_links(
        ctx,
        org,
        company,
        inherited.id,
        ReviewAiArtifactComponentLinksParams {
            outcome: "confirmed".into(),
            note: None,
            expected_content_hash: Some(node_hash(ctx, v2, "review")?),
        },
    )?;
    publish(ctx, &f, v2)?;

    // Revocation is not recoverable by reaffirmation: it fails closed.
    let v3 = {
        clone_workflow_version_to_draft(ctx, org, v2, revision(ctx, v2)?)?;
        ctx.db
            .workflow_version()
            .iter()
            .filter(|v| v.organization_id == org && v.status == WorkflowVersionStatus::Draft)
            .map(|v| v.id)
            .max()
            .ok_or("second clone")?
    };
    record_ai_evidence_source_change(
        ctx,
        org,
        company,
        base.evidence.version_id,
        change("access_revoked", None),
    )?;
    assert_eq_str(
        &current_component(ctx, org, v3, "review")?.link_state,
        "unresolved",
        "revoked foundation on the draft",
    )?;
    if publish(ctx, &f, v3).is_ok() {
        return Err("a workflow on revoked evidence published".into());
    }
    let published_v2 = ctx.db.workflow_version().id().find(&v2).ok_or("v2")?;
    if require_version_provenance_current(ctx, &published_v2).is_ok() {
        return Err("a published workflow on revoked evidence was still reusable".into());
    }
    // Keep the unused-import surface honest: the decision reducer is exercised above.
    let _ = review_ai_evidence_decision;
    Ok(())
}
