/// CRM contact relationship / parent hierarchy / admin data domain tests —
/// in-module test helpers (mirrors `contact_identity_test.rs` harness patterns).
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{
    company, create_company, organization_settings, CreateCompanyParams, OrganizationSettings,
};
use crate::crm::contacts::{
    contact, contact_relationship, create_contact, create_contact_relationship,
    end_contact_relationship, update_contact_parent, CreateContactParams,
    CreateContactRelationshipParams,
};
use crate::crm::leads::{
    create_lead_lost_reason, create_lead_source, lead_lost_reason, lead_source, update_lead_source,
    CreateLeadLostReasonParams, CreateLeadSourceParams, UpdateLeadSourceParams,
};
use crate::crm::opportunities::{
    create_opportunity_stage, opp_stage, update_opportunity_stage, CreateOpportunityStageParams,
    UpdateOpportunityStageParams,
};
use crate::crm::segments::{
    assignment_rule, create_assignment_rule, update_assignment_rule, CreateAssignmentRuleParams,
    UpdateAssignmentRuleParams,
};
use crate::crm::CRM_MULTI_COMPANY_FLAG;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn enable_multi_company_crm(ctx: &ReducerContext, organization_id: u64) {
    match ctx
        .db
        .organization_settings()
        .organization_id()
        .find(&organization_id)
    {
        Some(settings) => {
            let mut feature_flags = settings.feature_flags.clone();
            if !feature_flags
                .iter()
                .any(|flag| flag == CRM_MULTI_COMPANY_FLAG)
            {
                feature_flags.push(CRM_MULTI_COMPANY_FLAG.to_string());
            }
            ctx.db
                .organization_settings()
                .organization_id()
                .update(OrganizationSettings {
                    feature_flags,
                    updated_at: ctx.timestamp,
                    ..settings
                });
        }
        None => {
            ctx.db.organization_settings().insert(OrganizationSettings {
                organization_id,
                module_config: None,
                feature_flags: vec![CRM_MULTI_COMPANY_FLAG.to_string()],
                integration_keys: None,
                updated_at: ctx.timestamp,
                metadata: Some(r#"{"harness":"crm-relationship"}"#.to_string()),
            });
        }
    }
}

fn create_test_contact(
    ctx: &ReducerContext,
    org_id: u64,
    company_id: u64,
    email: &str,
) -> Result<u64, String> {
    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: email.to_string(),
            type_: "contact".to_string(),
            email: Some(email.to_string()),
            phone: None,
            mobile: None,
            company_id: Some(company_id),
            is_customer: true,
            is_vendor: false,
            is_employee: false,
            is_prospect: false,
            is_partner: false,
            customer_rank: 1,
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

    ctx.db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.email == Some(email.to_string()))
        .map(|c| c.id)
        .ok_or_else(|| format!("Contact {email} not found after create"))
}

pub fn test_contact_relationship_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let left_id = create_test_contact(ctx, org_id, company_id, "relationship-left@test.local")?;
    let right_id = create_test_contact(ctx, org_id, company_id, "relationship-right@test.local")?;

    create_company(
        ctx,
        org_id,
        CreateCompanyParams {
            name: "Relationship Company B".to_string(),
            code: format!("REL-B-{company_id}"),
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
            metadata: None,
        },
    )?;
    enable_multi_company_crm(ctx, org_id);
    let sibling_company_id = ctx
        .db
        .company()
        .company_by_org()
        .filter(&org_id)
        .map(|company| company.id)
        .filter(|id| *id != company_id)
        .max()
        .ok_or("Relationship sibling company missing")?;
    let sibling_id = create_test_contact(
        ctx,
        org_id,
        sibling_company_id,
        "relationship-sibling@test.local",
    )?;

    if create_contact_relationship(
        ctx,
        org_id,
        CreateContactRelationshipParams {
            left_contact_id: left_id,
            right_contact_id: sibling_id,
            relationship_type: "cross_company".to_string(),
            start_date: None,
            notes: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("Cross-company contact relationship should be rejected".to_string());
    }

    // Self-link rejected
    if create_contact_relationship(
        ctx,
        org_id,
        CreateContactRelationshipParams {
            left_contact_id: left_id,
            right_contact_id: left_id,
            relationship_type: "self".to_string(),
            start_date: None,
            notes: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("Self-link relationship should be rejected".to_string());
    }

    create_contact_relationship(
        ctx,
        org_id,
        CreateContactRelationshipParams {
            left_contact_id: left_id,
            right_contact_id: right_id,
            relationship_type: "business_partner".to_string(),
            start_date: Some(ctx.timestamp),
            notes: Some("Harness relationship".to_string()),
            metadata: None,
        },
    )?;

    let relationship = ctx
        .db
        .contact_relationship()
        .iter()
        .find(|r| {
            r.organization_id == org_id
                && r.left_contact_id == left_id
                && r.right_contact_id == right_id
        })
        .ok_or("Relationship not found after create")?;

    if !relationship.is_active {
        return Err("New relationship should be active".to_string());
    }
    if relationship.end_date.is_some() {
        return Err("New relationship should not have an end_date".to_string());
    }

    end_contact_relationship(ctx, org_id, relationship.id)?;

    let ended = ctx
        .db
        .contact_relationship()
        .id()
        .find(&relationship.id)
        .ok_or("Relationship missing after end")?;

    if ended.is_active {
        return Err("Relationship should be inactive after end".to_string());
    }
    if ended.end_date.is_none() {
        return Err("end_date should be set after ending relationship".to_string());
    }

    // Ending an already-ended relationship should fail.
    if end_contact_relationship(ctx, org_id, relationship.id).is_ok() {
        return Err("Ending an already-ended relationship should fail".to_string());
    }

    Ok(())
}

pub fn test_contact_parent_hierarchy_cycle_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let a_id = create_test_contact(ctx, org_id, company_id, "parent-a@test.local")?;
    let b_id = create_test_contact(ctx, org_id, company_id, "parent-b@test.local")?;
    let c_id = create_test_contact(ctx, org_id, company_id, "parent-c@test.local")?;

    // Self-parent rejected
    if update_contact_parent(ctx, org_id, company_id, a_id, Some(a_id)).is_ok() {
        return Err("Contact should not be allowed to be its own parent".to_string());
    }

    // B -> A, C -> B (valid chain)
    update_contact_parent(ctx, org_id, company_id, b_id, Some(a_id))?;
    update_contact_parent(ctx, org_id, company_id, c_id, Some(b_id))?;

    let b_row = ctx
        .db
        .contact()
        .id()
        .find(&b_id)
        .ok_or("Contact B missing after parent update")?;
    if b_row.parent_id != Some(a_id) {
        return Err("Contact B parent_id should be A".to_string());
    }

    // A -> C would close the cycle A -> C -> B -> A; must be rejected.
    if update_contact_parent(ctx, org_id, company_id, a_id, Some(c_id)).is_ok() {
        return Err("Setting a cyclical parent chain should be rejected".to_string());
    }

    let a_row = ctx
        .db
        .contact()
        .id()
        .find(&a_id)
        .ok_or("Contact A missing after rejected parent update")?;
    if a_row.parent_id.is_some() {
        return Err("Contact A parent_id should remain unset after rejected cycle".to_string());
    }

    // Clearing a parent is allowed.
    update_contact_parent(ctx, org_id, company_id, c_id, None)?;
    let c_row = ctx
        .db
        .contact()
        .id()
        .find(&c_id)
        .ok_or("Contact C missing after clearing parent")?;
    if c_row.parent_id.is_some() {
        return Err("Contact C parent_id should be cleared".to_string());
    }

    Ok(())
}

pub fn test_opportunity_stage_and_lead_admin(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_opportunity_stage(
        ctx,
        org_id,
        CreateOpportunityStageParams {
            name: "Harness Negotiation".to_string(),
            sequence: 5,
            probability: 60.0,
            requirements: Some("Signed NDA".to_string()),
            fold: false,
            is_won: false,
            team_id: None,
            is_active: true,
            metadata: None,
        },
    )?;

    let stage = ctx
        .db
        .opp_stage()
        .iter()
        .find(|s| s.organization_id == org_id && s.name == "Harness Negotiation")
        .ok_or("Opportunity stage not found after create")?;

    update_opportunity_stage(
        ctx,
        org_id,
        stage.id,
        UpdateOpportunityStageParams {
            name: None,
            sequence: None,
            probability: Some(75.0),
            requirements: None,
            fold: None,
            is_won: Some(true),
            team_id: None,
            is_active: None,
            metadata: None,
        },
    )?;

    let updated_stage = ctx
        .db
        .opp_stage()
        .id()
        .find(&stage.id)
        .ok_or("Opportunity stage missing after update")?;

    if updated_stage.probability != 75.0 {
        return Err(format!(
            "Expected stage probability 75.0, got {}",
            updated_stage.probability
        ));
    }
    if !updated_stage.is_won {
        return Err("Expected stage is_won=true after update".to_string());
    }
    if updated_stage.name != "Harness Negotiation" {
        return Err("Stage name should be unchanged when omitted from update".to_string());
    }

    create_lead_source(
        ctx,
        org_id,
        CreateLeadSourceParams {
            name: "Harness Referral".to_string(),
            description: Some("Word of mouth".to_string()),
            sequence: 1,
            is_active: true,
            metadata: None,
        },
    )?;

    let source = ctx
        .db
        .lead_source()
        .iter()
        .find(|s| s.organization_id == org_id && s.name == "Harness Referral")
        .ok_or("Lead source not found after create")?;

    update_lead_source(
        ctx,
        org_id,
        source.id,
        UpdateLeadSourceParams {
            name: None,
            description: None,
            sequence: Some(2),
            is_active: Some(false),
            metadata: None,
        },
    )?;

    let updated_source = ctx
        .db
        .lead_source()
        .id()
        .find(&source.id)
        .ok_or("Lead source missing after update")?;

    if updated_source.sequence != 2 {
        return Err("Lead source sequence should be updated".to_string());
    }
    if updated_source.is_active {
        return Err("Lead source should be inactive after update".to_string());
    }

    create_lead_lost_reason(
        ctx,
        org_id,
        CreateLeadLostReasonParams {
            name: "Harness Budget".to_string(),
            description: Some("No budget this quarter".to_string()),
            is_active: true,
            metadata: None,
        },
    )?;

    let lost_reason_exists = ctx
        .db
        .lead_lost_reason()
        .iter()
        .any(|r| r.organization_id == org_id && r.name == "Harness Budget");
    if !lost_reason_exists {
        return Err("Lead lost reason not found after create".to_string());
    }

    Ok(())
}

pub fn test_assignment_rule_admin(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_assignment_rule(
        ctx,
        org_id,
        CreateAssignmentRuleParams {
            name: "Harness Round Robin".to_string(),
            model: "lead".to_string(),
            domain: Some(r#"[["state","=","new"]]"#.to_string()),
            assign_type: "round_robin".to_string(),
            user_ids: vec![ctx.sender()],
            team_id: None,
            priority: 10,
            is_active: true,
            metadata: None,
        },
    )?;

    let rule = ctx
        .db
        .assignment_rule()
        .iter()
        .find(|r| r.organization_id == org_id && r.name == "Harness Round Robin")
        .ok_or("Assignment rule not found after create")?;

    if rule.user_ids.len() != 1 {
        return Err("Assignment rule should have exactly one assigned user".to_string());
    }

    update_assignment_rule(
        ctx,
        org_id,
        rule.id,
        UpdateAssignmentRuleParams {
            name: None,
            model: None,
            domain: None,
            assign_type: None,
            user_ids: None,
            team_id: None,
            priority: Some(20),
            is_active: Some(false),
            metadata: None,
        },
    )?;

    let updated_rule = ctx
        .db
        .assignment_rule()
        .id()
        .find(&rule.id)
        .ok_or("Assignment rule missing after update")?;

    if updated_rule.priority != 20 {
        return Err("Assignment rule priority should be updated".to_string());
    }
    if updated_rule.is_active {
        return Err("Assignment rule should be inactive after update".to_string());
    }

    Ok(())
}
