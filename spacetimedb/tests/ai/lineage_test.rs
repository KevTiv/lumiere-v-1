//! AIH-14: claim/decision/component lineage — explicit props, reconstructible.

use spacetimedb::{ReducerContext, Table};

use crate::ai::lineage::{
    ai_artifact_component, ai_claim, ai_decision, create_ai_artifact_component, create_ai_claim,
    create_ai_decision, CreateAiArtifactComponentParams, CreateAiClaimParams,
    CreateAiDecisionParams,
};
use crate::ai::provenance::{
    ai_source_passage, ai_source_version, create_ai_source_passage, create_ai_source_version,
    CreateAiSourcePassageParams, CreateAiSourceVersionParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

/// AIH-14.1: source → claim → decision → component reconstructs after edit/fork.
pub fn test_lineage_reconstructs_after_fork(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    // source + passage — every field explicit via params
    create_ai_source_version(
        ctx,
        fixture.organization_id,
        CreateAiSourceVersionParams {
            company_id: None,
            kind: "book".to_string(),
            title: "AIH-14 Source".to_string(),
            authors_json: Some(r#"["Ada Lovelace"]"#.to_string()),
            publisher: Some("Lumiere Press".to_string()),
            publication_date: Some("2020-01-01".to_string()),
            edition: None,
            version_label: None,
            uri: None,
            doi: None,
            file_reference: None,
            content_hash: "hash-lineage-001".to_string(),
            snapshot_ref: None,
            retrieval_time: None,
            origin: "retrieved".to_string(),
            owner_identity: None,
            scope: "organization".to_string(),
            retention_policy: "retain".to_string(),
            inspection_state: "inspected".to_string(),
        },
    )?;
    let version_id = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|v| v.title == "AIH-14 Source")
        .map(|v| v.id)
        .ok_or("lineage source not found")?;

    create_ai_source_passage(
        ctx,
        fixture.organization_id,
        CreateAiSourcePassageParams {
            source_version_id: version_id,
            passage_kind: "text".to_string(),
            content: "Passage that grounds the claim".to_string(),
            content_hash: "phash-lineage-001".to_string(),
            coordinates_json: Some(r#"{"page":10}"#.to_string()),
            is_original: true,
            processor_ref: None,
            correction_ref: None,
        },
    )?;
    let passage_id = ctx
        .db
        .ai_source_passage()
        .ai_source_passage_by_version()
        .filter(&version_id)
        .next()
        .map(|p| p.id)
        .ok_or("lineage passage not found")?;

    // claim
    create_ai_claim(
        ctx,
        fixture.organization_id,
        CreateAiClaimParams {
            company_id: None,
            source_version_id: Some(version_id),
            source_passage_id: Some(passage_id),
            kind: "sourced_fact".to_string(),
            statement: "The workflow must retain bounded rationale".to_string(),
            assumptions_json: Some(r#"{"assumption":"page 10 is authoritative"}"#.to_string()),
            verification_outcome: Some("verified".to_string()),
            status: "verified".to_string(),
        },
    )?;
    let claim_id = ctx
        .db
        .ai_claim()
        .iter()
        .find(|c| c.statement == "The workflow must retain bounded rationale")
        .map(|c| c.id)
        .ok_or("claim not found")?;

    // decision
    create_ai_decision(
        ctx,
        fixture.organization_id,
        CreateAiDecisionParams {
            company_id: None,
            claim_id: Some(claim_id),
            supporting_claims_json: None,
            supporting_sources_json: Some(format!("[{version_id}]")),
            applicability: Some("workflow generation".to_string()),
            alternatives_json: Some(r#"["skip rationale"]"#.to_string()),
            adaptations_json: Some(r#"{"bounded":"kept rationale under 500 chars"}"#.to_string()),
            rationale: "Adopted claim into workflow design".to_string(),
            status: "approved".to_string(),
            reviewer_identity: None,
        },
    )?;
    let decision_id = ctx
        .db
        .ai_decision()
        .iter()
        .find(|d| d.claim_id == Some(claim_id))
        .map(|d| d.id)
        .ok_or("decision not found")?;

    // component v1
    create_ai_artifact_component(
        ctx,
        fixture.organization_id,
        CreateAiArtifactComponentParams {
            company_id: None,
            component_key: "workflow.step:3".to_string(),
            component_kind: "workflow_step".to_string(),
            version: 1,
            content_hash: "chash-comp-v1".to_string(),
            decision_id: Some(decision_id),
            claim_id: Some(claim_id),
            parent_component_id: None,
            status: "active".to_string(),
        },
    )?;
    let comp_v1 = ctx
        .db
        .ai_artifact_component()
        .iter()
        .find(|c| c.component_key == "workflow.step:3" && c.version == 1)
        .ok_or("component v1 not found")?;

    // Fork/edit — v2 with parent lineage, marked as changed_requires_review
    create_ai_artifact_component(
        ctx,
        fixture.organization_id,
        CreateAiArtifactComponentParams {
            company_id: None,
            component_key: "workflow.step:3".to_string(),
            component_kind: "workflow_step".to_string(),
            version: 2,
            content_hash: "chash-comp-v2".to_string(),
            decision_id: Some(decision_id),
            claim_id: Some(claim_id),
            parent_component_id: Some(comp_v1.id),
            status: "changed_requires_review".to_string(),
        },
    )?;

    // Reconstruct original chain after fork: source → passage → claim → decision → component v2
    let v2 = ctx
        .db
        .ai_artifact_component()
        .iter()
        .find(|c| c.component_key == "workflow.step:3" && c.version == 2)
        .ok_or("component v2 not found")?;
    if v2.parent_component_id != Some(comp_v1.id) {
        return Err("AIH-14.1 fork did not retain parent lineage".to_string());
    }
    let v2_decision = ctx
        .db
        .ai_decision()
        .id()
        .find(&v2.decision_id.ok_or("v2 decision missing")?)
        .ok_or("v2 decision not found")?;
    let v2_claim = ctx
        .db
        .ai_claim()
        .id()
        .find(&v2_claim_id(v2_decision)?)
        .ok_or("v2 claim not found")?;
    if v2_claim.source_passage_id != Some(passage_id) {
        return Err("AIH-14.1 claim→passage link broken after fork".to_string());
    }
    let v2_passage = ctx
        .db
        .ai_source_passage()
        .id()
        .find(&v2_claim.source_passage_id.ok_or("claim passage missing")?)
        .ok_or("v2 passage not found")?;
    if v2_passage.source_version_id != version_id {
        return Err("AIH-14.1 passage→version link broken after fork".to_string());
    }

    // Unresolved/changed component must not be treated as active
    if v2.status != "changed_requires_review" {
        return Err("AIH-14.1 forked component should be changed_requires_review".to_string());
    }

    Ok(())
}

fn v2_claim_id(decision: crate::ai::lineage::AiDecision) -> Result<u64, String> {
    decision
        .claim_id
        .ok_or("decision claim missing".to_string())
}

/// AIH-14.2: changed/unresolved links require review; bibliography alone does not pass.
pub fn test_lineage_changed_requires_review(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    create_ai_source_version(
        ctx,
        fixture.organization_id,
        CreateAiSourceVersionParams {
            company_id: None,
            kind: "paper".to_string(),
            title: "AIH-14 Biblio Source".to_string(),
            authors_json: None,
            publisher: None,
            publication_date: None,
            edition: None,
            version_label: None,
            uri: None,
            doi: None,
            file_reference: None,
            content_hash: "hash-biblio-001".to_string(),
            snapshot_ref: None,
            retrieval_time: None,
            origin: "recalled".to_string(),
            owner_identity: None,
            scope: "organization".to_string(),
            retention_policy: "retain".to_string(),
            inspection_state: "unverified_recollection".to_string(),
        },
    )?;
    let version_id = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|v| v.title == "AIH-14 Biblio Source")
        .map(|v| v.id)
        .ok_or("biblio source not found")?;

    // Claim without component — bibliography without component links
    create_ai_claim(
        ctx,
        fixture.organization_id,
        CreateAiClaimParams {
            company_id: None,
            source_version_id: Some(version_id),
            source_passage_id: None,
            kind: "inference".to_string(),
            statement: "Biblio claim without component".to_string(),
            assumptions_json: None,
            verification_outcome: None,
            status: "pending_review".to_string(),
        },
    )?;
    let claim_id = ctx
        .db
        .ai_claim()
        .iter()
        .find(|c| c.statement == "Biblio claim without component")
        .map(|c| c.id)
        .ok_or("biblio claim not found")?;

    // No component exists for this claim — reconstructing component must fail
    let maybe_component = ctx
        .db
        .ai_artifact_component()
        .iter()
        .find(|c| c.claim_id == Some(claim_id) && c.organization_id == fixture.organization_id);
    if maybe_component.is_some() {
        return Err("AIH-14.2 bibliography alone should not have a component".to_string());
    }

    // Component that references a decision but is marked unresolved must require review
    create_ai_decision(
        ctx,
        fixture.organization_id,
        CreateAiDecisionParams {
            company_id: None,
            claim_id: Some(claim_id),
            supporting_claims_json: None,
            supporting_sources_json: None,
            applicability: None,
            alternatives_json: None,
            adaptations_json: None,
            rationale: "Decision on biblio claim".to_string(),
            status: "pending_review".to_string(),
            reviewer_identity: None,
        },
    )?;
    let decision_id = ctx
        .db
        .ai_decision()
        .iter()
        .find(|d| d.claim_id == Some(claim_id))
        .map(|d| d.id)
        .ok_or("biblio decision not found")?;

    create_ai_artifact_component(
        ctx,
        fixture.organization_id,
        CreateAiArtifactComponentParams {
            company_id: None,
            component_key: "document.section:biblio".to_string(),
            component_kind: "document_section".to_string(),
            version: 1,
            content_hash: "chash-biblio".to_string(),
            decision_id: Some(decision_id),
            claim_id: Some(claim_id),
            parent_component_id: None,
            status: "unresolved".to_string(),
        },
    )?;
    let comp = ctx
        .db
        .ai_artifact_component()
        .iter()
        .find(|c| c.component_key == "document.section:biblio")
        .ok_or("biblio component not found")?;
    if comp.status != "unresolved" {
        return Err("AIH-14.2 unresolved component should stay unresolved".to_string());
    }

    // Component creation without any decision/claim anchor must be denied
    let orphan = create_ai_artifact_component(
        ctx,
        fixture.organization_id,
        CreateAiArtifactComponentParams {
            company_id: None,
            component_key: "orphan".to_string(),
            component_kind: "workflow_step".to_string(),
            version: 1,
            content_hash: "chash-orphan".to_string(),
            decision_id: None,
            claim_id: None,
            parent_component_id: None,
            status: "active".to_string(),
        },
    );
    match orphan {
        Err(ref e) if e.contains("decision or claim") => {}
        other => {
            return Err(format!(
                "AIH-14.2 orphan component: expected decision/claim error, got {other:?}"
            ))
        }
    }

    Ok(())
}
