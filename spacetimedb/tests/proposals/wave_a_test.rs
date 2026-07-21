//! Proposals Wave A–C — company isolation, bid decision, status machine, versions.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::proposals::proposals::{
    create_proposal, proposal, proposal_bid_decision, proposal_section, proposal_version,
    record_proposal_bid_decision, restore_proposal_version, save_proposal_version,
    update_proposal_status, upsert_proposal_section, CreateProposalParams,
    RecordProposalBidDecisionParams, UpsertProposalSectionParams,
};
use crate::test_harness::OrgFixture;

fn create_draft(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    title: &str,
) -> Result<u64, String> {
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

fn seed_sibling_company(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: "Proposals Iso Company B".to_string(),
            code: format!("PB-{}", fixture.company_id),
            currency_id: 1,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: Some(r#"{"harness":"proposals-iso-b"}"#.to_string()),
        },
    )?;
    ctx.db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .map(|c| c.id)
        .filter(|id| *id != fixture.company_id)
        .max()
        .ok_or_else(|| "sibling company B missing".to_string())
}

pub fn test_create_requires_company_scope(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let other = OrgFixture::seed_minimal(ctx)?;

    let err = create_proposal(
        ctx,
        fixture.organization_id,
        other.company_id,
        CreateProposalParams {
            title: "Cross Org".to_string(),
            client_name: "X".to_string(),
            currency_id: 1,
            value: 1.0,
            deadline: None,
            description: None,
            template_id: None,
            partner_id: None,
            document_folder_id: None,
            metadata: None,
        },
    )
    .expect_err("foreign company_id must be rejected");

    if !err.contains("Company does not belong") {
        return Err(format!("unexpected create error: {err}"));
    }

    let id = create_draft(ctx, &fixture, "Scoped Proposal")?;
    let row = ctx
        .db
        .proposal()
        .id()
        .find(&id)
        .ok_or("proposal missing")?;
    if row.company_id != fixture.company_id || row.currency_id != 1 {
        return Err("company_id/currency_id not stored".to_string());
    }
    Ok(())
}

pub fn test_company_isolation_on_section_upsert(ctx: &ReducerContext) -> Result<(), String> {
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let company_b = seed_sibling_company(ctx, &fixture_a)?;
    let proposal_id = create_draft(ctx, &fixture_a, "Iso Proposal A")?;

    let err = upsert_proposal_section(
        ctx,
        fixture_a.organization_id,
        company_b,
        proposal_id,
        0,
        0,
        UpsertProposalSectionParams {
            title: "Hijack".to_string(),
            content: "nope".to_string(),
            status: "draft".to_string(),
            sequence: 10,
            ai_suggestion: None,
        },
    )
    .expect_err("company B must not edit company A proposal");

    if !err.contains("does not belong") {
        return Err(format!("unexpected isolation error: {err}"));
    }
    Ok(())
}

pub fn test_bid_decision_required_before_submit(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let proposal_id = create_draft(ctx, &fixture, "Bid Gate")?;

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
    .expect_err("submit without bid decision must fail");
    if !err.contains("bid decision") {
        return Err(format!("unexpected submit error: {err}"));
    }

    record_proposal_bid_decision(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        RecordProposalBidDecisionParams {
            decision: "bid".to_string(),
            rationale: "Strategic fit".to_string(),
        },
    )?;

    let decisions = ctx
        .db
        .proposal_bid_decision()
        .bid_decision_by_proposal()
        .filter(&proposal_id)
        .count();
    if decisions == 0 {
        return Err("bid decision not persisted".to_string());
    }

    update_proposal_status(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        "submitted".to_string(),
    )?;
    Ok(())
}

pub fn test_no_bid_blocks_submit(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let proposal_id = create_draft(ctx, &fixture, "No Bid Gate")?;
    update_proposal_status(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        "review".to_string(),
    )?;
    record_proposal_bid_decision(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        RecordProposalBidDecisionParams {
            decision: "no_bid".to_string(),
            rationale: "Out of scope".to_string(),
        },
    )?;
    let err = update_proposal_status(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        "submitted".to_string(),
    )
    .expect_err("no-bid must block submit");
    if !err.contains("no-bid") {
        return Err(format!("unexpected no-bid error: {err}"));
    }
    Ok(())
}

pub fn test_section_revision_conflict(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let proposal_id = create_draft(ctx, &fixture, "Conflict Proposal")?;
    upsert_proposal_section(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        0,
        0,
        UpsertProposalSectionParams {
            title: "S1".to_string(),
            content: "v1".to_string(),
            status: "draft".to_string(),
            sequence: 10,
            ai_suggestion: None,
        },
    )?;
    let section_id = ctx
        .db
        .proposal_section()
        .proposal_section_by_proposal()
        .filter(&proposal_id)
        .map(|s| s.id)
        .max()
        .ok_or("section missing")?;

    upsert_proposal_section(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        section_id,
        1,
        UpsertProposalSectionParams {
            title: "S1".to_string(),
            content: "v2".to_string(),
            status: "draft".to_string(),
            sequence: 10,
            ai_suggestion: None,
        },
    )?;

    let err = upsert_proposal_section(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        section_id,
        1, // stale
        UpsertProposalSectionParams {
            title: "S1".to_string(),
            content: "stale".to_string(),
            status: "draft".to_string(),
            sequence: 10,
            ai_suggestion: None,
        },
    )
    .expect_err("stale revision must conflict");
    if !err.contains("conflict") {
        return Err(format!("unexpected conflict error: {err}"));
    }
    Ok(())
}

pub fn test_server_version_snapshot_and_restore(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let proposal_id = create_draft(ctx, &fixture, "Version Proposal")?;
    upsert_proposal_section(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        0,
        0,
        UpsertProposalSectionParams {
            title: "Original".to_string(),
            content: "alpha".to_string(),
            status: "draft".to_string(),
            sequence: 10,
            ai_suggestion: None,
        },
    )?;

    save_proposal_version(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        "checkpoint".to_string(),
    )?;

    let version = ctx
        .db
        .proposal_version()
        .proposal_version_by_proposal()
        .filter(&proposal_id)
        .max_by_key(|v| v.version_number)
        .ok_or("version missing")?;
    if !version.sections_json.contains("Original") || !version.sections_json.contains("alpha") {
        return Err("server snapshot missing section content".to_string());
    }
    // Client cannot inject — message only; snapshot built server-side.
    if version.sections_json.contains("injected-evil") {
        return Err("unexpected client injection".to_string());
    }

    let section_id = ctx
        .db
        .proposal_section()
        .proposal_section_by_proposal()
        .filter(&proposal_id)
        .map(|s| s.id)
        .max()
        .ok_or("section missing")?;
    let section = ctx
        .db
        .proposal_section()
        .id()
        .find(&section_id)
        .ok_or("section row")?;
    upsert_proposal_section(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        section_id,
        section.revision,
        UpsertProposalSectionParams {
            title: "Changed".to_string(),
            content: "beta".to_string(),
            status: "draft".to_string(),
            sequence: 10,
            ai_suggestion: None,
        },
    )?;

    restore_proposal_version(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        proposal_id,
        version.id,
    )?;

    let restored = ctx
        .db
        .proposal_section()
        .proposal_section_by_proposal()
        .filter(&proposal_id)
        .find(|s| s.title == "Original" && s.content == "alpha")
        .ok_or("restore did not rewrite sections")?;
    if restored.revision != 1 {
        return Err("restored section revision should reset to 1".to_string());
    }
    Ok(())
}
