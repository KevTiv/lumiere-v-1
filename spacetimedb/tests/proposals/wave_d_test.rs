//! Proposals Waves D–E — templates, compliance submit guards, analysis materialize, intents.
use spacetimedb::{ReducerContext, Table};

use crate::proposals::proposals::{
    apply_proposal_analysis, apply_proposal_template, create_proposal,
    create_proposal_integration_intent, create_proposal_template, proposal,
    proposal_compliance_requirement, proposal_integration_intent, proposal_section,
    proposal_template, record_proposal_bid_decision, update_proposal_status,
    upsert_proposal_compliance_requirement, ApplyProposalAnalysisParams,
    CreateProposalIntegrationIntentParams, CreateProposalParams, CreateProposalTemplateParams,
    RecordProposalBidDecisionParams, UpsertProposalComplianceRequirementParams,
};
use crate::test_harness::OrgFixture;

fn create_draft(ctx: &ReducerContext, fixture: &OrgFixture, title: &str) -> Result<u64, String> {
    create_proposal(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateProposalParams {
            title: title.to_string(),
            client_name: "Acme".to_string(),
            currency_id: 1,
            value: 10_000.0,
            deadline: None,
            description: None,
            template_id: None,
            partner_id: None,
            document_folder_id: None,
            metadata: None,
        },
    )?;
    ctx.db
        .proposal()
        .iter()
        .find(|p| {
            p.organization_id == fixture.organization_id
                && p.company_id == fixture.company_id
                && p.title == title
        })
        .map(|p| p.id)
        .ok_or_else(|| format!("proposal {title} missing after create"))
}

fn require_contains(haystack: &[String], needles: &[&str], label: &str) -> Result<(), String> {
    for needle in needles {
        if !haystack.iter().any(|item| item == needle) {
            return Err(format!("expected {label} to include {needle}, got {haystack:?}"));
        }
    }
    Ok(())
}

pub fn test_template_apply_creates_sections(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    create_proposal_template(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateProposalTemplateParams {
            name: "Standard RFP".to_string(),
            category: "general".to_string(),
            locale: "en".to_string(),
            country_pack_key: None,
            sections_json: r#"[
              {"title":"Executive Summary","content":"Overview","sequence":10},
              {"title":"Technical Approach","content":"Approach","sequence":20}
            ]"#
            .to_string(),
            is_active: true,
            metadata: None,
        },
    )?;
    let template_id = ctx
        .db
        .proposal_template()
        .iter()
        .find(|t| t.organization_id == fixture.organization_id && t.name == "Standard RFP")
        .map(|t| t.id)
        .ok_or("template missing")?;

    let proposal_id = create_draft(ctx, &fixture, "Templated Bid")?;
    apply_proposal_template(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        template_id,
    )?;

    let titles: Vec<String> = ctx
        .db
        .proposal_section()
        .iter()
        .filter(|s| s.proposal_id == proposal_id)
        .map(|s| s.title.clone())
        .collect();
    require_contains(&titles, &["Executive Summary", "Technical Approach"], "template sections")?;

    let p = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
        .ok_or("proposal missing")?;
    if p.template_id != Some(template_id) {
        return Err("proposal.template_id not set after apply".to_string());
    }
    Ok(())
}

pub fn test_incomplete_compliance_blocks_submit(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let proposal_id = create_draft(ctx, &fixture, "Compliance Gate")?;
    record_proposal_bid_decision(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        RecordProposalBidDecisionParams {
            decision: "bid".to_string(),
            rationale: "Go".to_string(),
        },
    )?;
    upsert_proposal_compliance_requirement(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        0,
        UpsertProposalComplianceRequirementParams {
            requirement_key: "tax_clearance".to_string(),
            title: "Tax clearance".to_string(),
            description: None,
            is_required: true,
            is_complete: false,
            is_waived: false,
            waiver_rationale: None,
            evidence_document_id: None,
            sequence: 10,
        },
    )?;

    update_proposal_status(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        "review".to_string(),
    )?;
    let err = update_proposal_status(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        "submitted".to_string(),
    )
    .expect_err("incomplete compliance must block submit");
    if !err.to_lowercase().contains("compliance") {
        return Err(format!("expected compliance error, got: {err}"));
    }
    Ok(())
}

pub fn test_analysis_materializes_compliance(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let proposal_id = create_draft(ctx, &fixture, "Analyze Persist")?;
    apply_proposal_analysis(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        ApplyProposalAnalysisParams {
            source: "mock".to_string(),
            is_mock: true,
            findings_json: "[]".to_string(),
            requirements_json: r#"[
              {"id":"iso9001","title":"ISO 9001 certificate","text":"ISO 9001"},
              {"id":"bbbee","title":"B-BBEE affidavit","text":"B-BBEE"}
            ]"#
            .to_string(),
            evaluation_criteria_json: "[]".to_string(),
            suggested_sections_json: r#"["Cover Letter"]"#.to_string(),
            score_json: None,
            materialize_compliance: true,
        },
    )?;

    let keys: Vec<String> = ctx
        .db
        .proposal_compliance_requirement()
        .compliance_by_proposal()
        .filter(&proposal_id)
        .map(|r| r.requirement_key.clone())
        .collect();
    require_contains(&keys, &["iso9001", "bbbee"], "materialized requirements")
}

pub fn test_pdf_integration_intent_created(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let proposal_id = create_draft(ctx, &fixture, "PDF Intent")?;
    create_proposal_integration_intent(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        CreateProposalIntegrationIntentParams {
            proposal_version_id: None,
            intent_type: "pdf_render".to_string(),
            idempotency_key: format!("pdf-{proposal_id}"),
            payload: r#"{"format":"a4"}"#.to_string(),
            metadata: None,
        },
    )?;
    let intent = ctx
        .db
        .proposal_integration_intent()
        .proposal_intent_by_proposal()
        .filter(&proposal_id)
        .find(|i| i.intent_type == "pdf_render")
        .ok_or("pdf_render intent missing")?;
    if intent.status != "pending" {
        return Err(format!("expected pending status, got {}", intent.status));
    }
    Ok(())
}
