//! Canonical Helpdesk relation reducer regression, invoked by the existing suite.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::journal_entries::{account_move, AccountMove};
use crate::accounting_tests::helpers::create_balanced_customer_invoice;
use crate::core::persistence::organization_commit;
use crate::core::users::{user_organization, UserOrganization};
use crate::helpdesk::related_records::{
    helpdesk_ticket_related_record, set_helpdesk_related_record, HelpdeskRelatedRecord,
    SetHelpdeskRelatedRecordParams,
};
use crate::helpdesk::tickets::{
    create_helpdesk_stage, create_helpdesk_team, create_ticket, helpdesk_stage, helpdesk_team,
    helpdesk_ticket, CreateHelpdeskStageParams, CreateHelpdeskTeamParams, CreateTicketParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::TicketPriority;

fn seed_ticket(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let name = format!("related-record-{}", fixture.organization_id);
    create_helpdesk_team(
        ctx,
        fixture.organization_id,
        CreateHelpdeskTeamParams {
            name: name.clone(),
            description: None,
            is_active: true,
        },
    )?;
    let team_id = ctx
        .db
        .helpdesk_team()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.name == name)
        .map(|row| row.id)
        .ok_or("team missing")?;
    create_helpdesk_stage(
        ctx,
        fixture.organization_id,
        CreateHelpdeskStageParams {
            name: name.clone(),
            team_id: Some(team_id),
            sequence: 1,
            is_closed: false,
            description: None,
            template: None,
        },
    )?;
    let stage_id = ctx
        .db
        .helpdesk_stage()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.name == name)
        .map(|row| row.id)
        .ok_or("stage missing")?;
    create_ticket(
        ctx,
        fixture.organization_id,
        CreateTicketParams {
            team_id,
            stage_id,
            name: name.clone(),
            description: None,
            priority: TicketPriority::Normal,
            partner_id: None,
            partner_name: None,
            partner_email: None,
            sla_id: None,
            sla_deadline: None,
        },
    )?;
    ctx.db
        .helpdesk_ticket()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.name == name)
        .map(|row| row.id)
        .ok_or_else(|| "ticket missing".to_string())
}

pub fn test_related_record_scope_and_clear(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let ticket_id = seed_ticket(ctx, &fixture)?;
    let own_move = create_balanced_customer_invoice(ctx, &fixture, 32.0, false)?;
    let foreign_move = create_balanced_customer_invoice(ctx, &foreign, 64.0, false)?;
    let set = |org, company, ticket, target| {
        set_helpdesk_related_record(
            ctx,
            org,
            company,
            ticket,
            SetHelpdeskRelatedRecordParams { target },
        )
    };
    let commits_before = ctx.db.organization_commit().iter().count();
    for (org, company, ticket, target) in [
        (
            fixture.organization_id,
            fixture.company_id,
            ticket_id,
            HelpdeskRelatedRecord::AccountMove(0),
        ),
        (
            fixture.organization_id,
            fixture.company_id,
            ticket_id,
            HelpdeskRelatedRecord::SaleOrder(u64::MAX),
        ),
        (
            fixture.organization_id,
            fixture.company_id,
            ticket_id,
            HelpdeskRelatedRecord::AccountMove(foreign_move),
        ),
        (
            foreign.organization_id,
            foreign.company_id,
            ticket_id,
            HelpdeskRelatedRecord::AccountMove(foreign_move),
        ),
    ] {
        if set(org, company, ticket, Some(target)).is_ok() {
            return Err("invalid relation scope or missing target was accepted".to_string());
        }
    }
    if ctx
        .db
        .helpdesk_ticket_related_record()
        .ticket_id()
        .find(&ticket_id)
        .is_some()
        || ctx.db.organization_commit().iter().count() != commits_before
    {
        return Err("rejected relation changed persisted state".to_string());
    }

    set(
        fixture.organization_id,
        fixture.company_id,
        ticket_id,
        Some(HelpdeskRelatedRecord::AccountMove(own_move)),
    )?;
    let relation = ctx
        .db
        .helpdesk_ticket_related_record()
        .ticket_id()
        .find(&ticket_id)
        .ok_or("relation missing")?;
    if relation.target != HelpdeskRelatedRecord::AccountMove(own_move)
        || relation.company_id != fixture.company_id
    {
        return Err("canonical relation has wrong target or company".to_string());
    }
    // A restricted native membership must not clear a relation in another company,
    // even for a superuser with ticket-write permission.
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == fixture.organization_id && row.is_active)
        .ok_or("membership missing")?;
    let original_company = membership.company_id;
    ctx.db.user_organization().id().update(UserOrganization {
        company_id: Some(foreign.company_id),
        ..membership.clone()
    });
    let restricted_clear = set(fixture.organization_id, fixture.company_id, ticket_id, None);
    ctx.db.user_organization().id().update(UserOrganization {
        company_id: original_company,
        ..membership
    });
    if restricted_clear.is_ok()
        || ctx
            .db
            .helpdesk_ticket_related_record()
            .ticket_id()
            .find(&ticket_id)
            .is_none()
    {
        return Err("company-restricted caller cleared relation".to_string());
    }

    // A foreign target company must fail independently of organization equality.
    let move_row = ctx
        .db
        .account_move()
        .id()
        .find(&own_move)
        .ok_or("invoice missing")?;
    ctx.db.account_move().id().update(AccountMove {
        company_id: foreign.company_id,
        ..move_row
    });
    if set(
        fixture.organization_id,
        fixture.company_id,
        ticket_id,
        Some(HelpdeskRelatedRecord::AccountMove(own_move)),
    )
    .is_ok()
    {
        return Err("same-organization wrong-company target accepted".to_string());
    }
    // Clearing must work even when the target is no longer visible/valid.
    set(fixture.organization_id, fixture.company_id, ticket_id, None)?;
    if ctx
        .db
        .helpdesk_ticket_related_record()
        .ticket_id()
        .find(&ticket_id)
        .is_some()
    {
        return Err("clear retained relation".to_string());
    }
    let move_row = ctx
        .db
        .account_move()
        .id()
        .find(&own_move)
        .ok_or("invoice missing after clear")?;
    ctx.db.account_move().id().update(AccountMove {
        company_id: fixture.company_id,
        ..move_row
    });
    Ok(())
}
