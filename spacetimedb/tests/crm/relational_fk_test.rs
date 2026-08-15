use spacetimedb::{ReducerContext, Table};

use crate::crm::activities::{
    activity, activity_type, create_activity, ActivityType, CreateActivityParams, CrmActivityTarget,
};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::crm::leads::{
    create_lead, crm_team, lead, update_lead, CreateLeadParams, CrmTeam, UpdateLeadParams,
};
use crate::crm::opportunities::{opp_stage, OpportunityStage};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn insert_stage(
    ctx: &ReducerContext,
    organization_id: u64,
    name: &str,
    is_active: bool,
) -> OpportunityStage {
    ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id,
        name: name.to_string(),
        sequence: 10,
        probability: 25.0,
        requirements: None,
        fold: false,
        is_won: false,
        team_id: None,
        is_active,
        metadata: Some(r#"{"test":"crm-relational-fk"}"#.to_string()),
    })
}

fn insert_team(ctx: &ReducerContext, organization_id: u64, name: &str, is_active: bool) -> CrmTeam {
    ctx.db.crm_team().insert(CrmTeam {
        id: 0,
        organization_id,
        name: name.to_string(),
        is_active,
        metadata: Some(r#"{"test":"crm-relational-fk"}"#.to_string()),
    })
}

fn lead_params(name: &str, stage_id: Option<u64>, team_id: Option<u64>) -> CreateLeadParams {
    CreateLeadParams {
        name: name.to_string(),
        priority: "normal".to_string(),
        state: "new".to_string(),
        expected_revenue: 1_000.0,
        probability: 25.0,
        tag_ids: vec![],
        email: None,
        phone: None,
        mobile: None,
        company_name: None,
        contact_name: None,
        title: None,
        street: None,
        city: None,
        zip: None,
        country_code: None,
        website: None,
        industry: None,
        source_id: None,
        campaign_id: None,
        medium_id: None,
        referred_by: None,
        description: None,
        user_id: None,
        stage_id,
        team_id,
        partner_id: None,
        date_deadline: None,
        metadata: Some(r#"{"test":"crm-relational-fk"}"#.to_string()),
    }
}

fn relation_patch(stage_id: Option<Option<u64>>, team_id: Option<Option<u64>>) -> UpdateLeadParams {
    UpdateLeadParams {
        contact_name: None,
        title: None,
        website: None,
        industry: None,
        referred_by: None,
        description: None,
        street: None,
        city: None,
        zip: None,
        country_code: None,
        expected_revenue: None,
        probability: None,
        stage_id,
        team_id,
    }
}

fn create_test_contact(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    email: &str,
) -> Result<u64, String> {
    create_contact(
        ctx,
        organization_id,
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
            metadata: Some(r#"{"test":"crm-cross-org-contact"}"#.to_string()),
        },
    )?;

    ctx.db
        .contact()
        .iter()
        .find(|contact| {
            contact.organization_id == organization_id && contact.email.as_deref() == Some(email)
        })
        .map(|contact| contact.id)
        .ok_or("contact not persisted after create".to_string())
}

pub fn test_lead_stage_and_team_relations(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let other = OrgFixture::seed_minimal(ctx)?;
    let stage = insert_stage(ctx, fixture.organization_id, "CRM FK Primary Stage", true);
    let team = insert_team(ctx, fixture.organization_id, "CRM FK Primary Team", true);
    let replacement_stage = insert_stage(
        ctx,
        fixture.organization_id,
        "CRM FK Replacement Stage",
        true,
    );
    let replacement_team = insert_team(
        ctx,
        fixture.organization_id,
        "CRM FK Replacement Team",
        true,
    );
    let inactive_stage = insert_stage(ctx, fixture.organization_id, "CRM FK Inactive Stage", false);
    let inactive_team = insert_team(ctx, fixture.organization_id, "CRM FK Inactive Team", false);
    let other_stage = insert_stage(ctx, other.organization_id, "CRM FK Foreign Stage", true);
    let other_team = insert_team(ctx, other.organization_id, "CRM FK Foreign Team", true);

    create_lead(
        ctx,
        fixture.organization_id,
        lead_params("CRM FK Valid Lead", Some(stage.id), Some(team.id)),
    )?;
    let persisted = ctx
        .db
        .lead()
        .iter()
        .find(|lead| {
            lead.organization_id == fixture.organization_id && lead.name == "CRM FK Valid Lead"
        })
        .ok_or("valid lead was not persisted".to_string())?;
    if persisted.stage_id != Some(stage.id) || persisted.team_id != Some(team.id) {
        return Err("valid lead relations were not persisted".to_string());
    }

    update_lead(
        ctx,
        fixture.organization_id,
        persisted.id,
        relation_patch(
            Some(Some(replacement_stage.id)),
            Some(Some(replacement_team.id)),
        ),
    )?;
    let updated = ctx
        .db
        .lead()
        .id()
        .find(&persisted.id)
        .ok_or("lead missing after relation update".to_string())?;
    if updated.stage_id != Some(replacement_stage.id)
        || updated.team_id != Some(replacement_team.id)
    {
        return Err("lead relation update was not persisted".to_string());
    }

    let rejected_name = "CRM FK Rejected Create";
    let create_result = create_lead(
        ctx,
        fixture.organization_id,
        lead_params(rejected_name, Some(other_stage.id), Some(other_team.id)),
    );
    if !matches!(create_result, Err(ref error) if error.contains("does not belong")) {
        return Err(format!(
            "cross-org stage create was not rejected: {create_result:?}"
        ));
    }
    if ctx.db.lead().iter().any(|lead| lead.name == rejected_name) {
        return Err("rejected lead create persisted a row".to_string());
    }

    let inactive_stage_result = create_lead(
        ctx,
        fixture.organization_id,
        lead_params("CRM FK Inactive Stage Lead", Some(inactive_stage.id), None),
    );
    if !matches!(inactive_stage_result, Err(ref error) if error.contains("inactive")) {
        return Err(format!(
            "inactive stage create was not rejected: {inactive_stage_result:?}"
        ));
    }
    let inactive_team_result = create_lead(
        ctx,
        fixture.organization_id,
        lead_params(
            "CRM FK Inactive Team Lead",
            Some(stage.id),
            Some(inactive_team.id),
        ),
    );
    if !matches!(inactive_team_result, Err(ref error) if error.contains("inactive")) {
        return Err(format!(
            "inactive team create was not rejected: {inactive_team_result:?}"
        ));
    }
    if ctx.db.lead().iter().any(|lead| {
        lead.name == "CRM FK Inactive Stage Lead" || lead.name == "CRM FK Inactive Team Lead"
    }) {
        return Err("inactive relation lead create persisted a row".to_string());
    }

    let stage_result = update_lead(
        ctx,
        fixture.organization_id,
        persisted.id,
        relation_patch(Some(Some(other_stage.id)), None),
    );
    if !matches!(stage_result, Err(ref error) if error.contains("does not belong")) {
        return Err(format!(
            "cross-org stage update was not rejected: {stage_result:?}"
        ));
    }
    let team_result = update_lead(
        ctx,
        fixture.organization_id,
        persisted.id,
        relation_patch(None, Some(Some(other_team.id))),
    );
    if !matches!(team_result, Err(ref error) if error.contains("does not belong")) {
        return Err(format!(
            "cross-org team update was not rejected: {team_result:?}"
        ));
    }
    let unchanged = ctx
        .db
        .lead()
        .id()
        .find(&persisted.id)
        .ok_or("lead missing after rejected updates".to_string())?;
    if unchanged.stage_id != Some(replacement_stage.id)
        || unchanged.team_id != Some(replacement_team.id)
    {
        return Err("rejected lead update changed persisted relations".to_string());
    }

    Ok(())
}

pub fn test_activity_type_and_contact_relations(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let other = OrgFixture::seed_minimal(ctx)?;
    let activity_type = ctx.db.activity_type().insert(ActivityType {
        id: 0,
        organization_id: fixture.organization_id,
        name: "CRM FK Follow Up".to_string(),
        category: "call".to_string(),
        summary: None,
        sequence: 10,
        delay_count: None,
        delay_unit: None,
        delay_from: None,
        icon: None,
        chaining_type: "none".to_string(),
        suggested_next_type_id: None,
        triggered_next_type_id: None,
        is_active: true,
        metadata: Some(r#"{"test":"crm-relational-fk"}"#.to_string()),
    });
    let other_type = ctx.db.activity_type().insert(ActivityType {
        id: 0,
        organization_id: other.organization_id,
        name: "CRM FK Foreign Type".to_string(),
        category: "call".to_string(),
        summary: None,
        sequence: 10,
        delay_count: None,
        delay_unit: None,
        delay_from: None,
        icon: None,
        chaining_type: "none".to_string(),
        suggested_next_type_id: None,
        triggered_next_type_id: None,
        is_active: true,
        metadata: Some(r#"{"test":"crm-relational-fk"}"#.to_string()),
    });
    let inactive_type = ctx.db.activity_type().insert(ActivityType {
        id: 0,
        organization_id: fixture.organization_id,
        name: "CRM FK Inactive Type".to_string(),
        category: "call".to_string(),
        summary: None,
        sequence: 20,
        delay_count: None,
        delay_unit: None,
        delay_from: None,
        icon: None,
        chaining_type: "none".to_string(),
        suggested_next_type_id: None,
        triggered_next_type_id: None,
        is_active: false,
        metadata: Some(r#"{"test":"crm-relational-fk"}"#.to_string()),
    });
    let contact_id = create_test_contact(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        "crm-fk-contact@test.local",
    )?;
    let other_contact_id = create_test_contact(
        ctx,
        other.organization_id,
        other.company_id,
        "crm-fk-foreign-contact@test.local",
    )?;

    let activity_params = |type_id, summary: &str, target| CreateActivityParams {
        activity_type_id: type_id,
        summary: summary.to_string(),
        priority: "normal".to_string(),
        state: "planned".to_string(),
        auto: false,
        is_system: false,
        is_done: false,
        note: None,
        date_deadline: Some(ctx.timestamp),
        date_done: None,
        assigned_to: None,
        target,
        duration: None,
        location: None,
        video_url: None,
        metadata: Some(r#"{"test":"crm-relational-fk"}"#.to_string()),
    };

    create_activity(
        ctx,
        fixture.organization_id,
        activity_params(
            activity_type.id,
            "CRM FK Valid Activity",
            Some(CrmActivityTarget::Contact(contact_id)),
        ),
    )?;
    let persisted = ctx
        .db
        .activity()
        .iter()
        .find(|activity| activity.summary == "CRM FK Valid Activity")
        .ok_or("valid activity was not persisted".to_string())?;
    if persisted.activity_type_id != activity_type.id
        || persisted.activity_type != activity_type.name
        || persisted.res_id != Some(contact_id)
    {
        return Err("activity relations or derived type name were not persisted".to_string());
    }

    let type_result = create_activity(
        ctx,
        fixture.organization_id,
        activity_params(
            other_type.id,
            "CRM FK Rejected Type",
            Some(CrmActivityTarget::Contact(contact_id)),
        ),
    );
    if !matches!(type_result, Err(ref error) if error.contains("does not belong")) {
        return Err(format!(
            "cross-org activity type was not rejected: {type_result:?}"
        ));
    }
    let inactive_type_result = create_activity(
        ctx,
        fixture.organization_id,
        activity_params(
            inactive_type.id,
            "CRM FK Rejected Inactive Type",
            Some(CrmActivityTarget::Contact(contact_id)),
        ),
    );
    if !matches!(inactive_type_result, Err(ref error) if error.contains("inactive")) {
        return Err(format!(
            "inactive activity type was not rejected: {inactive_type_result:?}"
        ));
    }
    let contact_result = create_activity(
        ctx,
        fixture.organization_id,
        activity_params(
            activity_type.id,
            "CRM FK Rejected Contact",
            Some(CrmActivityTarget::Contact(other_contact_id)),
        ),
    );
    if !matches!(contact_result, Err(ref error) if error.contains("does not belong")) {
        return Err(format!(
            "cross-org activity contact was not rejected: {contact_result:?}"
        ));
    }
    if ctx.db.activity().iter().any(|activity| {
        activity.summary == "CRM FK Rejected Type"
            || activity.summary == "CRM FK Rejected Inactive Type"
            || activity.summary == "CRM FK Rejected Contact"
    }) {
        return Err("rejected activity create persisted a row".to_string());
    }

    Ok(())
}
