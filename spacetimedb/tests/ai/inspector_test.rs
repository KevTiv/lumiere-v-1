//! AIH-16: source and decision inspector — redaction, navigation, and review context.

use spacetimedb::{Identity, ReducerContext, Table};

use crate::ai::answer_gate::{
    complete_ai_answer_gate, record_ai_claim_validation, CompleteAiAnswerGateParams,
    RecordAiClaimValidationParams,
};
use crate::ai::inspector::{
    inspect_ai_answer, inspect_ai_artifact_component, inspect_ai_claim, inspect_ai_decision,
};
use crate::ai::lineage::{
    ai_artifact_component, ai_claim, ai_decision, create_ai_artifact_component, create_ai_claim,
    create_ai_decision, CreateAiArtifactComponentParams, CreateAiClaimParams,
    CreateAiDecisionParams,
};
use crate::ai::provenance::{
    ai_source_passage, ai_source_version, create_ai_contribution, create_ai_source_passage,
    create_ai_source_version, CreateAiContributionParams, CreateAiSourcePassageParams,
    CreateAiSourceVersionParams,
};
use crate::ai::skills::ai_agent_run;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

// ── Fixture helpers ──────────────────────────────────────────────────────────

fn source_params(title: &str, scope: &str, owner: Option<Identity>) -> CreateAiSourceVersionParams {
    CreateAiSourceVersionParams {
        company_id: None,
        kind: "book".to_string(),
        title: title.to_string(),
        authors_json: Some(r#"["A. Author"]"#.to_string()),
        publisher: Some("Test Press".to_string()),
        publication_date: Some("2026-01-01".to_string()),
        edition: None,
        version_label: None,
        uri: None,
        doi: None,
        file_reference: None,
        content_hash: format!("hash-{title}"),
        snapshot_ref: None,
        retrieval_time: None,
        origin: "retrieved".to_string(),
        owner_identity: owner,
        scope: scope.to_string(),
        retention_policy: "retain".to_string(),
        inspection_state: "inspected".to_string(),
    }
}

fn passage_params(source_version_id: u64, content: &str) -> CreateAiSourcePassageParams {
    CreateAiSourcePassageParams {
        source_version_id,
        passage_kind: "text".to_string(),
        content: content.to_string(),
        content_hash: format!("hash-{content}"),
        coordinates_json: Some(r#"{"page": 12}"#.to_string()),
        is_original: true,
        processor_ref: None,
        correction_ref: None,
    }
}

fn claim_params(
    source_version_id: Option<u64>,
    source_passage_id: Option<u64>,
    statement: &str,
) -> CreateAiClaimParams {
    CreateAiClaimParams {
        company_id: None,
        source_version_id,
        source_passage_id,
        kind: "sourced_fact".to_string(),
        statement: statement.to_string(),
        assumptions_json: None,
        verification_outcome: Some("deterministic".to_string()),
        status: "verified".to_string(),
    }
}

fn decision_params(claim_id: Option<u64>, rationale: &str) -> CreateAiDecisionParams {
    CreateAiDecisionParams {
        company_id: None,
        claim_id,
        supporting_claims_json: None,
        supporting_sources_json: None,
        applicability: Some("general".to_string()),
        alternatives_json: None,
        adaptations_json: Some(r#"["adapted for IFRS"]"#.to_string()),
        rationale: rationale.to_string(),
        status: "approved".to_string(),
        reviewer_identity: None,
    }
}

fn component_params(
    decision_id: Option<u64>,
    claim_id: Option<u64>,
    key: &str,
) -> CreateAiArtifactComponentParams {
    CreateAiArtifactComponentParams {
        company_id: None,
        component_key: key.to_string(),
        component_kind: "workflow_step".to_string(),
        version: 1,
        content_hash: format!("hash-{key}"),
        decision_id,
        claim_id,
        parent_component_id: None,
        status: "active".to_string(),
    }
}

// ── AIH-16.1: claim inspector exposes exact source passage and contributor ───

pub fn test_inspector_claim_shows_exact_source_passage(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    create_ai_source_version(
        ctx,
        fixture.organization_id,
        source_params("AIH-16 Visible Source", "organization", None),
    )?;
    let source_id = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|s| s.title == "AIH-16 Visible Source")
        .map(|s| s.id)
        .ok_or("source not found")?;

    create_ai_source_passage(
        ctx,
        fixture.organization_id,
        passage_params(source_id, "The exact passage text."),
    )?;
    let passage_id = ctx
        .db
        .ai_source_passage()
        .iter()
        .find(|p| p.source_version_id == source_id)
        .map(|p| p.id)
        .ok_or("passage not found")?;

    create_ai_contribution(
        ctx,
        fixture.organization_id,
        CreateAiContributionParams {
            source_version_id: Some(source_id),
            passage_id: Some(passage_id),
            contributor_kind: "user".to_string(),
            session_ref: Some("session-1".to_string()),
            turn_ref: Some("turn-3".to_string()),
            event_ref: None,
            inspection_state: "inspected".to_string(),
        },
    )?;

    create_ai_claim(
        ctx,
        fixture.organization_id,
        claim_params(Some(source_id), Some(passage_id), "The claim statement."),
    )?;
    let claim_id = ctx
        .db
        .ai_claim()
        .iter()
        .find(|c| c.statement == "The claim statement.")
        .map(|c| c.id)
        .ok_or("claim not found")?;

    let view = inspect_ai_claim(ctx, fixture.organization_id, claim_id)?;

    assert_eq!(view.statement, "The claim statement.");
    assert_eq!(view.status, "verified");

    let sv = view
        .source_version
        .as_ref()
        .ok_or("missing source version view")?;
    assert_eq!(sv.availability, "available");
    assert_eq!(sv.title.as_deref(), Some("AIH-16 Visible Source"));
    assert_eq!(sv.authors_json.as_deref(), Some(r#"["A. Author"]"#));

    let sp = view
        .source_passage
        .as_ref()
        .ok_or("missing source passage view")?;
    assert_eq!(sp.availability, "available");
    assert_eq!(sp.content.as_deref(), Some("The exact passage text."));
    assert_eq!(sp.coordinates_json.as_deref(), Some(r#"{"page": 12}"#));

    assert_eq!(view.contributions.len(), 1);
    assert_eq!(view.contributions[0].turn_ref.as_deref(), Some("turn-3"));

    assert_eq!(view.decisions.len(), 0);
    Ok(())
}

// ── AIH-16.2: denied (private) sources reveal no excerpt ─────────────────────

pub fn test_inspector_denied_source_redacts_excerpt(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    let other = Identity::from_byte_array([99; 32]);
    create_ai_source_version(
        ctx,
        fixture.organization_id,
        source_params("AIH-16 Private Source", "private", Some(other)),
    )?;
    let source_id = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|s| s.title == "AIH-16 Private Source")
        .map(|s| s.id)
        .ok_or("source not found")?;

    create_ai_source_passage(
        ctx,
        fixture.organization_id,
        passage_params(source_id, "Secret text that must not leak."),
    )?;
    let passage_id = ctx
        .db
        .ai_source_passage()
        .iter()
        .find(|p| p.source_version_id == source_id)
        .map(|p| p.id)
        .ok_or("passage not found")?;

    create_ai_claim(
        ctx,
        fixture.organization_id,
        claim_params(
            Some(source_id),
            Some(passage_id),
            "Claim with private source.",
        ),
    )?;
    let claim_id = ctx
        .db
        .ai_claim()
        .iter()
        .find(|c| c.statement == "Claim with private source.")
        .map(|c| c.id)
        .ok_or("claim not found")?;

    let view = inspect_ai_claim(ctx, fixture.organization_id, claim_id)?;

    let sv = view
        .source_version
        .as_ref()
        .ok_or("missing source version view")?;
    assert_eq!(sv.availability, "denied");
    assert!(sv.title.is_none());
    assert!(sv.authors_json.is_none());
    assert!(sv.content_hash.is_none());

    let sp = view
        .source_passage
        .as_ref()
        .ok_or("missing source passage view")?;
    assert_eq!(sp.availability, "denied");
    assert!(sp.content.is_none());
    assert!(sp.content_hash.is_none());

    // The claim statement itself is still readable; only the source excerpt is redacted.
    assert_eq!(view.statement, "Claim with private source.");
    Ok(())
}

// ── AIH-16.3: unavailable source references are explicit ─────────────────────

pub fn test_inspector_unavailable_source_is_explicit(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    let missing_source_id: u64 = 9_999_999;
    create_ai_claim(
        ctx,
        fixture.organization_id,
        claim_params(Some(missing_source_id), None, "Claim with missing source."),
    )?;
    let claim_id = ctx
        .db
        .ai_claim()
        .iter()
        .find(|c| c.statement == "Claim with missing source.")
        .map(|c| c.id)
        .ok_or("claim not found")?;

    let view = inspect_ai_claim(ctx, fixture.organization_id, claim_id)?;
    let sv = view
        .source_version
        .as_ref()
        .ok_or("missing source version view")?;
    assert_eq!(sv.id, missing_source_id);
    assert_eq!(sv.availability, "unavailable");
    assert!(sv.title.is_none());
    Ok(())
}

// ── AIH-16.4: component inspector navigates to decision and claim ────────────

pub fn test_inspector_component_navigates_to_decision(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    create_ai_source_version(
        ctx,
        fixture.organization_id,
        source_params("AIH-16 Component Source", "organization", None),
    )?;
    let source_id = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|s| s.title == "AIH-16 Component Source")
        .map(|s| s.id)
        .ok_or("source not found")?;

    create_ai_source_passage(
        ctx,
        fixture.organization_id,
        passage_params(source_id, "Component passage."),
    )?;
    let passage_id = ctx
        .db
        .ai_source_passage()
        .iter()
        .find(|p| p.source_version_id == source_id)
        .map(|p| p.id)
        .ok_or("passage not found")?;

    create_ai_claim(
        ctx,
        fixture.organization_id,
        claim_params(Some(source_id), Some(passage_id), "Component claim."),
    )?;
    let claim_id = ctx
        .db
        .ai_claim()
        .iter()
        .find(|c| c.statement == "Component claim.")
        .map(|c| c.id)
        .ok_or("claim not found")?;

    create_ai_decision(
        ctx,
        fixture.organization_id,
        decision_params(Some(claim_id), "Decision for component."),
    )?;
    let decision_id = ctx
        .db
        .ai_decision()
        .iter()
        .find(|d| d.rationale == "Decision for component.")
        .map(|d| d.id)
        .ok_or("decision not found")?;

    create_ai_artifact_component(
        ctx,
        fixture.organization_id,
        component_params(Some(decision_id), None, "workflow.step:1"),
    )?;
    let component_id = ctx
        .db
        .ai_artifact_component()
        .iter()
        .find(|c| c.component_key == "workflow.step:1")
        .map(|c| c.id)
        .ok_or("component not found")?;

    let view = inspect_ai_artifact_component(ctx, fixture.organization_id, component_id)?;
    assert_eq!(view.component_key, "workflow.step:1");

    let decision_view = view.decision.as_ref().ok_or("missing decision view")?;
    assert_eq!(decision_view.rationale, "Decision for component.");
    assert_eq!(
        decision_view.adaptations_json.as_deref(),
        Some(r#"["adapted for IFRS"]"#)
    );

    let claim_view = decision_view.claim.as_ref().ok_or("missing claim ref")?;
    assert_eq!(claim_view.statement_summary, "Component claim.");

    let source_view = view
        .decision
        .as_ref()
        .and_then(|d| d.claim.as_ref())
        .map(|c| c.id)
        .and_then(|cid| Some(inspect_ai_claim(ctx, fixture.organization_id, cid)))
        .transpose()?
        .and_then(|cv| cv.source_version)
        .ok_or("missing nested source view")?;
    assert_eq!(source_view.availability, "available");
    assert_eq!(
        source_view.title.as_deref(),
        Some("AIH-16 Component Source")
    );
    Ok(())
}

// ── AIH-16.5: answer inspector links gate result, validations, and claims ────

pub fn test_inspector_answer_links_validations_and_claims(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    create_ai_source_version(
        ctx,
        fixture.organization_id,
        source_params("AIH-16 Answer Source", "organization", None),
    )?;
    let source_id = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|s| s.title == "AIH-16 Answer Source")
        .map(|s| s.id)
        .ok_or("source not found")?;

    create_ai_claim(
        ctx,
        fixture.organization_id,
        claim_params(Some(source_id), None, "Answer claim."),
    )?;
    let claim_id = ctx
        .db
        .ai_claim()
        .iter()
        .find(|c| c.statement == "Answer claim.")
        .map(|c| c.id)
        .ok_or("claim not found")?;

    // Insert a minimal agent run directly; the inspector only needs the run row.
    let run = ctx.db.ai_agent_run().insert(crate::ai::skills::AiAgentRun {
        id: 0,
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        skill_id: 0,
        skill_config_id: None,
        agent_id: 0,
        team_member_id: None,
        run_key: "aih16-run".to_string(),
        status: "completed".to_string(),
        inputs_json: "{}".to_string(),
        summary: None,
        artifacts_json: None,
        citations_json: None,
        action_draft_ids: vec![],
        step_count: 1,
        tokens_used: 100,
        error_message: None,
        triggered_by_hex: "0".repeat(64),
        started_at: ctx.timestamp,
        completed_at: Some(ctx.timestamp),
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: None,
    });

    record_ai_claim_validation(
        ctx,
        fixture.organization_id,
        RecordAiClaimValidationParams {
            company_id: None,
            run_id: run.id,
            claim_id: Some(claim_id),
            source_version_id: Some(source_id),
            source_passage_id: None,
            check_kind: "reference_exists".to_string(),
            outcome: "passed".to_string(),
            detail: None,
        },
    )?;

    complete_ai_answer_gate(
        ctx,
        fixture.organization_id,
        CompleteAiAnswerGateParams {
            company_id: None,
            run_id: run.id,
            gate_outcome: "passed".to_string(),
            failed_checks_json: None,
            domain_review_required: false,
        },
    )?;

    let answer = inspect_ai_answer(ctx, fixture.organization_id, run.id)?;
    assert_eq!(answer.run_id, run.id);
    assert_eq!(answer.run_status, "completed");

    let gate = answer.gate_result.as_ref().ok_or("missing gate result")?;
    assert_eq!(gate.gate_outcome, "passed");
    assert!(!gate.domain_review_required);

    assert_eq!(answer.validations.len(), 1);
    assert_eq!(answer.validations[0].check_kind, "reference_exists");
    assert_eq!(answer.validations[0].outcome, "passed");

    assert_eq!(answer.claims.len(), 1);
    assert_eq!(answer.claims[0].statement, "Answer claim.");
    assert_eq!(
        answer.claims[0]
            .source_version
            .as_ref()
            .map(|s| s.availability.as_str()),
        Some("available")
    );
    Ok(())
}

// ── AIH-16.6: decision inspector redacts denied supporting sources ───────────

pub fn test_inspector_decision_redacts_denied_supporting_source(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    create_ai_source_version(
        ctx,
        fixture.organization_id,
        source_params("AIH-16 Public Source", "organization", None),
    )?;
    let public_id = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|s| s.title == "AIH-16 Public Source")
        .map(|s| s.id)
        .ok_or("public source not found")?;

    let other = Identity::from_byte_array([77; 32]);
    create_ai_source_version(
        ctx,
        fixture.organization_id,
        source_params("AIH-16 Private Source", "private", Some(other)),
    )?;
    let private_id = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|s| s.title == "AIH-16 Private Source")
        .map(|s| s.id)
        .ok_or("private source not found")?;

    create_ai_decision(
        ctx,
        fixture.organization_id,
        CreateAiDecisionParams {
            company_id: None,
            claim_id: None,
            supporting_claims_json: None,
            supporting_sources_json: Some(format!("[{public_id},{private_id}]")),
            applicability: None,
            alternatives_json: None,
            adaptations_json: None,
            rationale: "Decision with mixed sources.".to_string(),
            status: "approved".to_string(),
            reviewer_identity: None,
        },
    )?;
    let decision_id = ctx
        .db
        .ai_decision()
        .iter()
        .find(|d| d.rationale == "Decision with mixed sources.")
        .map(|d| d.id)
        .ok_or("decision not found")?;

    let view = inspect_ai_decision(ctx, fixture.organization_id, decision_id)?;
    assert_eq!(view.supporting_sources.len(), 2);

    let public_view = view
        .supporting_sources
        .iter()
        .find(|s| s.id == public_id)
        .ok_or("public source missing")?;
    assert_eq!(public_view.availability, "available");
    assert_eq!(public_view.title.as_deref(), Some("AIH-16 Public Source"));

    let private_view = view
        .supporting_sources
        .iter()
        .find(|s| s.id == private_id)
        .ok_or("private source missing")?;
    assert_eq!(private_view.availability, "denied");
    assert!(private_view.title.is_none());
    assert!(private_view.content_hash.is_none());

    Ok(())
}
