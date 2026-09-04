/// CRM Wave 2 domain tests — opportunity presence, forecast snapshots, country-pack
/// party validators. In-module test helpers (mirrors `opportunity_lifecycle_test.rs`).
use spacetimedb::{ReducerContext, Table};

use crate::core::country_pack::{set_company_country_pack, SetCompanyCountryPackParams};
use crate::core::users::{find_user_profile_for_identity, user_profile, UserProfile};
use crate::crm::contacts::{create_contact, CreateContactParams};
use crate::crm::forecast::{
    create_forecast_snapshot, crm_forecast_snapshot, CreateCrmForecastSnapshotParams,
};
use crate::crm::opportunities::{
    create_opportunity, opp_stage, opportunity, CreateOpportunityParams, OpportunityStage,
};
use crate::crm::presence::{
    clear_opportunity_presence, opportunity_presence, update_opportunity_presence,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn base_contact_params(name: &str, company_id: u64, tax_id: Option<String>) -> CreateContactParams {
    CreateContactParams {
        name: name.to_string(),
        type_: "company".to_string(),
        email: None,
        phone: None,
        mobile: None,
        company_id: Some(company_id),
        is_customer: false,
        is_vendor: false,
        is_employee: false,
        is_prospect: false,
        is_partner: false,
        customer_rank: 0,
        supplier_rank: 0,
        display_name: None,
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
        tax_id,
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
        metadata: Some(r#"{"test":"wave2"}"#.to_string()),
    }
}

pub fn test_opportunity_presence_upsert_and_clear(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    ensure_test_superuser(ctx)?;
    let caller_profile = find_user_profile_for_identity(ctx, ctx.sender())
        .ok_or("Harness caller profile not found")?;
    ctx.db.user_profile().id().update(UserProfile {
        name: "Harness Tester".to_string(),
        updated_at: ctx.timestamp,
        ..caller_profile
    });
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let stage = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "Harness Presence Stage".to_string(),
        sequence: 1,
        probability: 20.0,
        requirements: None,
        fold: false,
        is_won: false,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"harness":true}"#.to_string()),
    });

    create_opportunity(
        ctx,
        org_id,
        CreateOpportunityParams {
            name: "Harness Presence Opp".to_string(),
            expected_revenue: 1_000.0,
            probability: 20.0,
            stage_id: stage.id,
            priority: "medium".to_string(),
            is_won: false,
            is_lost: false,
            tag_ids: vec![],
            lead_id: None,
            partner_id: Some(fixture.partner_id),
            contact_id: Some(fixture.partner_id),
            campaign_id: None,
            medium_id: None,
            source_id: None,
            user_id: None,
            team_id: None,
            company_id: Some(company_id),
            company_currency_id: Some(1),
            lost_reason_id: None,
            date_open: Some(ctx.timestamp),
            date_closed: None,
            date_deadline: None,
            date_last_stage_update: Some(ctx.timestamp),
            day_open: None,
            day_close: None,
            color: None,
            description: None,
            metadata: Some(r#"{"test":"presence"}"#.to_string()),
        },
    )?;

    let opp = ctx
        .db
        .opportunity()
        .iter()
        .find(|o| o.organization_id == org_id && o.name == "Harness Presence Opp")
        .ok_or("Opportunity not found after create")?;

    update_opportunity_presence(ctx, org_id, opp.id)?;

    let presence_rows: Vec<_> = ctx
        .db
        .opportunity_presence()
        .opp_presence_by_opportunity()
        .filter(&opp.id)
        .collect();
    if presence_rows.len() != 1 {
        return Err(format!(
            "Expected 1 presence row after first update, got {}",
            presence_rows.len()
        ));
    }
    if presence_rows[0].user_id != ctx.sender() {
        return Err("Presence row user_id should be caller identity".to_string());
    }
    if presence_rows[0].user_name != "Harness Tester" {
        return Err("Presence row user_name mismatch".to_string());
    }

    // Upsert: calling again for the same user+opportunity must update in place, not duplicate.
    let caller_profile = find_user_profile_for_identity(ctx, ctx.sender())
        .ok_or("Harness caller profile not found before rename")?;
    ctx.db.user_profile().id().update(UserProfile {
        name: "Harness Viewer Renamed".to_string(),
        updated_at: ctx.timestamp,
        ..caller_profile
    });
    update_opportunity_presence(ctx, org_id, opp.id)?;

    let presence_rows_after_upsert: Vec<_> = ctx
        .db
        .opportunity_presence()
        .opp_presence_by_opportunity()
        .filter(&opp.id)
        .collect();
    if presence_rows_after_upsert.len() != 1 {
        return Err(format!(
            "Expected 1 presence row after upsert, got {}",
            presence_rows_after_upsert.len()
        ));
    }
    if presence_rows_after_upsert[0].user_name != "Harness Viewer Renamed" {
        return Err("Presence row user_name should update on upsert".to_string());
    }

    clear_opportunity_presence(ctx, opp.id)?;

    let presence_rows_after_clear = ctx
        .db
        .opportunity_presence()
        .opp_presence_by_opportunity()
        .filter(&opp.id)
        .count();
    if presence_rows_after_clear != 0 {
        return Err(format!(
            "Expected 0 presence rows after clear, got {}",
            presence_rows_after_clear
        ));
    }

    Ok(())
}

pub fn test_forecast_snapshot_weighted_sum(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let stage_open = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "Harness Forecast Open".to_string(),
        sequence: 1,
        probability: 25.0,
        requirements: None,
        fold: false,
        is_won: false,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"harness":true}"#.to_string()),
    });

    let stage_won = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "Harness Forecast Won".to_string(),
        sequence: 10,
        probability: 100.0,
        requirements: None,
        fold: true,
        is_won: true,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"harness":true}"#.to_string()),
    });

    // Open opp #1: 10_000 * 25% = 2_500
    create_opportunity(
        ctx,
        org_id,
        CreateOpportunityParams {
            name: "Harness Forecast Opp A".to_string(),
            expected_revenue: 10_000.0,
            probability: 25.0,
            stage_id: stage_open.id,
            priority: "medium".to_string(),
            is_won: false,
            is_lost: false,
            tag_ids: vec![],
            lead_id: None,
            partner_id: Some(fixture.partner_id),
            contact_id: Some(fixture.partner_id),
            campaign_id: None,
            medium_id: None,
            source_id: None,
            user_id: None,
            team_id: None,
            company_id: Some(company_id),
            company_currency_id: Some(1),
            lost_reason_id: None,
            date_open: Some(ctx.timestamp),
            date_closed: None,
            date_deadline: None,
            date_last_stage_update: Some(ctx.timestamp),
            day_open: None,
            day_close: None,
            color: None,
            description: None,
            metadata: Some(r#"{"test":"forecast_a"}"#.to_string()),
        },
    )?;

    // Open opp #2: 4_000 * 25% = 1_000
    create_opportunity(
        ctx,
        org_id,
        CreateOpportunityParams {
            name: "Harness Forecast Opp B".to_string(),
            expected_revenue: 4_000.0,
            probability: 25.0,
            stage_id: stage_open.id,
            priority: "medium".to_string(),
            is_won: false,
            is_lost: false,
            tag_ids: vec![],
            lead_id: None,
            partner_id: Some(fixture.partner_id),
            contact_id: Some(fixture.partner_id),
            campaign_id: None,
            medium_id: None,
            source_id: None,
            user_id: None,
            team_id: None,
            company_id: Some(company_id),
            company_currency_id: Some(1),
            lost_reason_id: None,
            date_open: Some(ctx.timestamp),
            date_closed: None,
            date_deadline: None,
            date_last_stage_update: Some(ctx.timestamp),
            day_open: None,
            day_close: None,
            color: None,
            description: None,
            metadata: Some(r#"{"test":"forecast_b"}"#.to_string()),
        },
    )?;

    // Won opp — must be excluded from the open pipeline.
    create_opportunity(
        ctx,
        org_id,
        CreateOpportunityParams {
            name: "Harness Forecast Opp Won".to_string(),
            expected_revenue: 50_000.0,
            probability: 100.0,
            stage_id: stage_won.id,
            priority: "high".to_string(),
            is_won: true,
            is_lost: false,
            tag_ids: vec![],
            lead_id: None,
            partner_id: Some(fixture.partner_id),
            contact_id: Some(fixture.partner_id),
            campaign_id: None,
            medium_id: None,
            source_id: None,
            user_id: None,
            team_id: None,
            company_id: Some(company_id),
            company_currency_id: Some(1),
            lost_reason_id: None,
            date_open: Some(ctx.timestamp),
            date_closed: Some(ctx.timestamp),
            date_deadline: None,
            date_last_stage_update: Some(ctx.timestamp),
            day_open: None,
            day_close: None,
            color: None,
            description: None,
            metadata: Some(r#"{"test":"forecast_won"}"#.to_string()),
        },
    )?;

    create_forecast_snapshot(
        ctx,
        org_id,
        company_id,
        CreateCrmForecastSnapshotParams {
            period_start: ctx.timestamp,
            period_end: ctx.timestamp,
            owner_id: None,
            metadata: Some(r#"{"test":"forecast_snapshot"}"#.to_string()),
        },
    )?;

    let snapshot = ctx
        .db
        .crm_forecast_snapshot()
        .forecast_by_company()
        .filter(&company_id)
        .find(|s| s.organization_id == org_id)
        .ok_or("Forecast snapshot not found after create")?;

    if snapshot.open_count != 2 {
        return Err(format!(
            "Expected open_count 2 (won opp excluded), got {}",
            snapshot.open_count
        ));
    }

    let expected_weighted = 10_000.0 * 0.25 + 4_000.0 * 0.25;
    if (snapshot.weighted_pipeline - expected_weighted).abs() > 0.01 {
        return Err(format!(
            "Expected weighted_pipeline {expected_weighted}, got {}",
            snapshot.weighted_pipeline
        ));
    }

    Ok(())
}

pub fn test_country_pack_rejects_invalid_abn(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    set_company_country_pack(
        ctx,
        org_id,
        company_id,
        SetCompanyCountryPackParams {
            pack_key: "au".to_string(),
            enabled: true,
            configuration: None,
        },
    )?;

    // Too short to be a valid ABN (11 digits required).
    let bad_result = create_contact(
        ctx,
        org_id,
        base_contact_params("Harness Bad ABN Co", company_id, Some("123".to_string())),
    );
    if bad_result.is_ok() {
        return Err("Expected create_contact to reject invalid ABN".to_string());
    }

    // Valid 11-digit ABN (formatting/spacing should be stripped before validation).
    create_contact(
        ctx,
        org_id,
        base_contact_params(
            "Harness Good ABN Co",
            company_id,
            Some("51 824 753 556".to_string()),
        ),
    )?;

    // Disabling the pack must lift the restriction — no strict validation without an
    // enabled pack declaring the identifier kind.
    set_company_country_pack(
        ctx,
        org_id,
        company_id,
        SetCompanyCountryPackParams {
            pack_key: "au".to_string(),
            enabled: false,
            configuration: None,
        },
    )?;

    create_contact(
        ctx,
        org_id,
        base_contact_params("Harness No Pack Co", company_id, Some("123".to_string())),
    )?;

    Ok(())
}
