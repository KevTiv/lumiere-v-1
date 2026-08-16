//! HLP-005/006/007: CSV import FK validation, cross-team assignment rejection,
//! and the SLA breach flag being system-only. HLP-008: cross-org ticket rejection.
use spacetimedb::rand::Rng;
use spacetimedb::{Identity, ReducerContext, ScheduleAt, Table};

use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::data_ops::helpdesk_imports::{
    import_helpdesk_sla_csv, import_helpdesk_stage_csv, import_helpdesk_ticket_csv,
};
use crate::data_ops::import_tracker::import_job;
use crate::helpdesk::tickets::{
    add_helpdesk_team_member, assign_ticket, create_helpdesk_sla, create_helpdesk_stage,
    create_helpdesk_team, create_ticket, helpdesk_sla, helpdesk_stage, helpdesk_team,
    helpdesk_ticket, run_helpdesk_sla_check, CreateHelpdeskSLAParams, CreateHelpdeskStageParams,
    CreateHelpdeskTeamParams, CreateTicketParams, HelpdeskSlaCheckJob,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::TicketPriority;

fn new_identity(ctx: &ReducerContext) -> Identity {
    Identity::from_byte_array(ctx.rng().gen::<[u8; 32]>())
}

fn seed_team(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_helpdesk_team(
        ctx,
        fixture.organization_id,
        CreateHelpdeskTeamParams {
            name: name.to_string(),
            description: None,
            is_active: true,
        },
    )?;
    ctx.db
        .helpdesk_team()
        .iter()
        .find(|t| t.organization_id == fixture.organization_id && t.name == name)
        .map(|t| t.id)
        .ok_or_else(|| format!("team {name} missing after create"))
}

fn seed_stage(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    team_id: u64,
    name: &str,
) -> Result<u64, String> {
    create_helpdesk_stage(
        ctx,
        fixture.organization_id,
        CreateHelpdeskStageParams {
            name: name.to_string(),
            team_id: Some(team_id),
            sequence: 1,
            is_closed: false,
            description: None,
            template: None,
        },
    )?;
    ctx.db
        .helpdesk_stage()
        .iter()
        .find(|s| s.organization_id == fixture.organization_id && s.name == name)
        .map(|s| s.id)
        .ok_or_else(|| format!("stage {name} missing after create"))
}

fn seed_agent(ctx: &ReducerContext, fixture: &OrgFixture, tag: &str) -> Result<Identity, String> {
    let identity = new_identity(ctx);
    create_contact(
        ctx,
        fixture.organization_id,
        CreateContactParams {
            name: format!("Agent {tag}"),
            type_: "individual".to_string(),
            email: None,
            phone: None,
            mobile: None,
            company_id: Some(fixture.company_id),
            is_customer: false,
            is_vendor: false,
            is_employee: true,
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
            tax_id: None,
            company_registry: None,
            industry: None,
            employees_count: None,
            annual_revenue: None,
            description: None,
            salesperson_id: None,
            assigned_user_id: None,
            parent_id: None,
            user_id: Some(identity),
            color: None,
            metadata: None,
        },
    )?;
    let found = ctx
        .db
        .contact()
        .iter()
        .any(|c| c.organization_id == fixture.organization_id && c.user_id == Some(identity));
    if !found {
        return Err("agent contact missing after create".to_string());
    }
    Ok(identity)
}

/// HLP-005: all four import reducers must reject rows with FK ids that don't
/// exist / don't belong to the org (previously only a non-zero check).
pub fn test_csv_import_rejects_bad_fks(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let team_id = seed_team(ctx, &fixture, "HLP-005 Team")?;
    let stage_id = seed_stage(ctx, &fixture, team_id, "HLP-005 Stage")?;

    // Stage import with a nonexistent team_id must be rejected, not silently accepted.
    let bogus_team_id = team_id + 900_000;
    import_helpdesk_stage_csv(
        ctx,
        fixture.organization_id,
        format!("name,team_id\nBad Stage,{bogus_team_id}"),
    )?;
    let stage_job = ctx
        .db
        .import_job()
        .iter()
        .filter(|j| j.organization_id == fixture.organization_id && j.table_name == "helpdesk_stage")
        .max_by_key(|j| j.id)
        .ok_or("stage import job missing")?;
    if stage_job.error_rows != 1 || stage_job.imported_rows != 0 {
        return Err(format!(
            "stage import accepted a bogus team_id: errors={} imported={}",
            stage_job.error_rows,
            stage_job.imported_rows
        ));
    }
    if ctx
        .db
        .helpdesk_stage()
        .iter()
        .any(|s| s.name == "Bad Stage")
    {
        return Err("bogus-team stage row was inserted".to_string());
    }

    // SLA import with a nonexistent team_id must be rejected.
    import_helpdesk_sla_csv(
        ctx,
        fixture.organization_id,
        format!("name,team_id,stage_id\nBad SLA,{bogus_team_id},{stage_id}"),
    )?;
    let sla_job = ctx
        .db
        .import_job()
        .iter()
        .filter(|j| j.organization_id == fixture.organization_id && j.table_name == "helpdesk_sla")
        .max_by_key(|j| j.id)
        .ok_or("sla import job missing")?;
    if sla_job.error_rows != 1 || sla_job.imported_rows != 0 {
        return Err(format!(
            "sla import accepted a bogus team_id: errors={} imported={}",
            sla_job.error_rows, sla_job.imported_rows
        ));
    }

    // Ticket import: bogus team_id, bogus stage_id (real team), and bogus
    // partner_id (real team+stage) must each be rejected on their own row.
    let other_org = OrgFixture::seed_minimal(ctx)?;
    let bogus_stage_id = stage_id + 900_000;
    let foreign_partner_id = other_org.partner_id;
    let csv = format!(
        "name,team_id,stage_id\n\
         Bad Team Ticket,{bogus_team_id},{stage_id}\n\
         Bad Stage Ticket,{team_id},{bogus_stage_id}"
    );
    import_helpdesk_ticket_csv(ctx, fixture.organization_id, csv)?;
    let ticket_job = ctx
        .db
        .import_job()
        .iter()
        .filter(|j| {
            j.organization_id == fixture.organization_id && j.table_name == "helpdesk_ticket"
        })
        .max_by_key(|j| j.id)
        .ok_or("ticket import job missing")?;
    if ticket_job.error_rows != 2 || ticket_job.imported_rows != 0 {
        return Err(format!(
            "ticket import accepted a bogus FK: errors={} imported={}",
            ticket_job.error_rows,
            ticket_job.imported_rows
        ));
    }

    let csv_partner = format!(
        "name,team_id,stage_id,partner_id\nBad Partner Ticket,{team_id},{stage_id},{foreign_partner_id}"
    );
    import_helpdesk_ticket_csv(ctx, fixture.organization_id, csv_partner)?;
    let partner_job = ctx
        .db
        .import_job()
        .iter()
        .filter(|j| {
            j.organization_id == fixture.organization_id && j.table_name == "helpdesk_ticket"
        })
        .max_by_key(|j| j.id)
        .ok_or("ticket import job (partner) missing")?;
    if partner_job.error_rows != 1 || partner_job.imported_rows != 0 {
        return Err(format!(
            "ticket import accepted a cross-org partner_id: errors={} imported={}",
            partner_job.error_rows,
            partner_job.imported_rows
        ));
    }
    Ok(())
}

/// HLP-006: an agent must be a member of the ticket's own team to be assigned.
pub fn test_cross_team_assignment_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let team_a = seed_team(ctx, &fixture, "HLP-006 Team A")?;
    let team_b = seed_team(ctx, &fixture, "HLP-006 Team B")?;
    let stage_b = seed_stage(ctx, &fixture, team_b, "HLP-006 Stage B")?;
    let agent = seed_agent(ctx, &fixture, "hlp006")?;

    add_helpdesk_team_member(ctx, fixture.organization_id, team_a, agent)?;

    create_ticket(
        ctx,
        fixture.organization_id,
        CreateTicketParams {
            team_id: team_b,
            stage_id: stage_b,
            name: "Cross-team ticket".to_string(),
            description: None,
            priority: TicketPriority::Normal,
            partner_id: None,
            partner_name: None,
            partner_email: None,
            sla_id: None,
            sla_deadline: None,
        },
    )?;
    let ticket_id = ctx
        .db
        .helpdesk_ticket()
        .iter()
        .find(|t| t.organization_id == fixture.organization_id && t.name == "Cross-team ticket")
        .map(|t| t.id)
        .ok_or("ticket missing after create")?;

    let cross_team_error = assign_ticket(ctx, fixture.organization_id, ticket_id, agent)
        .err()
        .ok_or("cross-team assignment unexpectedly succeeded")?;
    if !cross_team_error.contains("not a member") {
        return Err(format!(
            "unexpected cross-team assignment error: {cross_team_error}"
        ));
    }

    add_helpdesk_team_member(ctx, fixture.organization_id, team_b, agent)?;
    assign_ticket(ctx, fixture.organization_id, ticket_id, agent)?;
    let assigned = ctx
        .db
        .helpdesk_ticket()
        .id()
        .find(&ticket_id)
        .ok_or("ticket missing after assign")?;
    if assigned.user_id != Some(agent) {
        return Err("same-team assignment did not persist".to_string());
    }
    Ok(())
}

/// HLP-007: `sla_reached` can never come from user input (CSV import strips
/// it), and only `run_helpdesk_sla_check` — the scheduled system job — ever
/// flips it to true, and only past a real deadline on a still-open ticket.
pub fn test_sla_reached_is_system_only(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let team_id = seed_team(ctx, &fixture, "HLP-007 Team")?;
    let stage_id = seed_stage(ctx, &fixture, team_id, "HLP-007 Stage")?;
    create_helpdesk_sla(
        ctx,
        fixture.organization_id,
        CreateHelpdeskSLAParams {
            name: "HLP-007 SLA".to_string(),
            team_id,
            stage_id,
            priority: TicketPriority::Normal,
            time_days: 0,
            time_hours: 1,
            is_active: true,
        },
    )?;
    let sla_id = ctx
        .db
        .helpdesk_sla()
        .iter()
        .find(|s| s.organization_id == fixture.organization_id && s.name == "HLP-007 SLA")
        .map(|s| s.id)
        .ok_or("sla missing after create")?;

    // CSV import must ignore a user-supplied sla_reached=true column.
    let csv = format!(
        "name,team_id,stage_id,sla_reached\nHLP-007 CSV Ticket,{team_id},{stage_id},true"
    );
    import_helpdesk_ticket_csv(ctx, fixture.organization_id, csv)?;
    let csv_ticket = ctx
        .db
        .helpdesk_ticket()
        .iter()
        .find(|t| t.name == "HLP-007 CSV Ticket")
        .ok_or("csv ticket missing")?;
    if csv_ticket.sla_reached {
        return Err("CSV import let user input set sla_reached".to_string());
    }

    // create_ticket with an sla_id but no explicit deadline must derive one
    // from the SLA policy server-side, and never start out breached.
    create_ticket(
        ctx,
        fixture.organization_id,
        CreateTicketParams {
            team_id,
            stage_id,
            name: "HLP-007 Ticket".to_string(),
            description: None,
            priority: TicketPriority::Normal,
            partner_id: None,
            partner_name: None,
            partner_email: None,
            sla_id: Some(sla_id),
            sla_deadline: None,
        },
    )?;
    let ticket = ctx
        .db
        .helpdesk_ticket()
        .iter()
        .find(|t| t.organization_id == fixture.organization_id && t.name == "HLP-007 Ticket")
        .ok_or("ticket missing after create")?;
    if ticket.sla_reached {
        return Err("newly created ticket started out already breached".to_string());
    }
    let deadline = ticket
        .sla_deadline
        .ok_or("sla_deadline was not derived from the SLA policy")?;
    if deadline <= ctx.timestamp {
        return Err("derived sla_deadline is not in the future".to_string());
    }

    // The system job must be a no-op before the deadline...
    run_helpdesk_sla_check(
        ctx,
        HelpdeskSlaCheckJob {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Time(ctx.timestamp),
            organization_id: fixture.organization_id,
            ticket_id: ticket.id,
        },
    )?;
    let still_open = ctx
        .db
        .helpdesk_ticket()
        .id()
        .find(&ticket.id)
        .ok_or("ticket missing after early check")?;
    if still_open.sla_reached {
        return Err("sla_reached flipped before the deadline passed".to_string());
    }

    // ...and must flip sla_reached once a ticket's own deadline is in the past.
    let overdue = ctx.db.helpdesk_ticket().id().update(crate::helpdesk::tickets::HelpdeskTicket {
        sla_deadline: Some(ctx.timestamp - std::time::Duration::from_secs(60)),
        ..still_open
    });
    run_helpdesk_sla_check(
        ctx,
        HelpdeskSlaCheckJob {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Time(ctx.timestamp),
            organization_id: fixture.organization_id,
            ticket_id: overdue.id,
        },
    )?;
    let breached = ctx
        .db
        .helpdesk_ticket()
        .id()
        .find(&overdue.id)
        .ok_or("ticket missing after breach check")?;
    if !breached.sla_reached {
        return Err("system check did not flip sla_reached past the deadline".to_string());
    }
    Ok(())
}

/// HLP-008: `create_ticket` must reject a team_id/stage_id belonging to a
/// different organization than the caller's — proving the org checks already
/// wired into `create_ticket` (alongside HLP-001/002) actually hold.
pub fn test_cross_org_ticket_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let other_org = OrgFixture::seed_minimal(ctx)?;
    let foreign_team = seed_team(ctx, &other_org, "HLP-008 Foreign Team")?;
    let foreign_stage = seed_stage(ctx, &other_org, foreign_team, "HLP-008 Foreign Stage")?;

    let cross_org_team_error = create_ticket(
        ctx,
        fixture.organization_id,
        CreateTicketParams {
            team_id: foreign_team,
            stage_id: foreign_stage,
            name: "Cross-org team ticket".to_string(),
            description: None,
            priority: TicketPriority::Normal,
            partner_id: None,
            partner_name: None,
            partner_email: None,
            sla_id: None,
            sla_deadline: None,
        },
    )
    .err()
    .ok_or("cross-org team_id ticket creation unexpectedly succeeded")?;
    if !cross_org_team_error.contains("does not belong to this organization") {
        return Err(format!(
            "unexpected cross-org team error: {cross_org_team_error}"
        ));
    }
    if ctx
        .db
        .helpdesk_ticket()
        .iter()
        .any(|t| t.name == "Cross-org team ticket")
    {
        return Err("cross-org ticket was persisted despite rejection".to_string());
    }

    let own_team = seed_team(ctx, &fixture, "HLP-008 Own Team")?;
    let cross_org_stage_error = create_ticket(
        ctx,
        fixture.organization_id,
        CreateTicketParams {
            team_id: own_team,
            stage_id: foreign_stage,
            name: "Cross-org stage ticket".to_string(),
            description: None,
            priority: TicketPriority::Normal,
            partner_id: None,
            partner_name: None,
            partner_email: None,
            sla_id: None,
            sla_deadline: None,
        },
    )
    .err()
    .ok_or("cross-org stage_id ticket creation unexpectedly succeeded")?;
    if !cross_org_stage_error.contains("does not belong to this organization") {
        return Err(format!(
            "unexpected cross-org stage error: {cross_org_stage_error}"
        ));
    }
    Ok(())
}
