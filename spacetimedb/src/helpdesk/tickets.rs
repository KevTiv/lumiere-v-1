/// Helpdesk — HelpdeskTeam, HelpdeskStage, HelpdeskSLA, HelpdeskTicket
///
/// Customer support ticketing system. Teams own stages and SLA policies;
/// tickets are assigned to agents within teams.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{HelpdeskTicketState, TicketPriority};

// ── Tables ────────────────────────────────────────────────────────────────────

/// Helpdesk Team — A support group that handles tickets (e.g. "Technical Support").
#[spacetimedb::table(
    accessor = helpdesk_team,
    public,
    index(accessor = team_by_org, btree(columns = [organization_id]))
)]
pub struct HelpdeskTeam {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: Timestamp,
}

/// Helpdesk Stage — A pipeline stage for tickets (e.g. "New", "In Progress", "Closed").
#[spacetimedb::table(
    accessor = helpdesk_stage,
    public,
    index(accessor = stage_by_team, btree(columns = [team_id])),
    index(accessor = stage_by_org, btree(columns = [organization_id]))
)]
pub struct HelpdeskStage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub team_id: Option<u64>,       // FK → HelpdeskTeam (None = shared across all teams)
    pub sequence: u32,
    pub is_closed: bool,            // Terminal stage
    pub template: Option<String>,   // Email template name on entry
    pub created_at: Timestamp,
}

/// Helpdesk SLA — A service level agreement policy for a team.
#[spacetimedb::table(
    accessor = helpdesk_sla,
    public,
    index(accessor = sla_by_team, btree(columns = [team_id])),
    index(accessor = sla_by_org, btree(columns = [organization_id]))
)]
pub struct HelpdeskSLA {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub team_id: u64,               // FK → HelpdeskTeam
    pub stage_id: u64,              // Target stage to reach before deadline
    pub priority: TicketPriority,
    pub time_days: u32,             // Days to resolve
    pub time_hours: u32,            // Hours (in addition to days)
    pub is_active: bool,
    pub created_at: Timestamp,
}

/// Helpdesk Ticket — A customer support request.
#[spacetimedb::table(
    accessor = helpdesk_ticket,
    public,
    index(accessor = ticket_by_team, btree(columns = [team_id])),
    index(accessor = ticket_by_partner, btree(columns = [partner_id])),
    index(accessor = ticket_by_assignee, btree(columns = [organization_id])),
    index(accessor = ticket_by_state, btree(columns = [state]))
)]
pub struct HelpdeskTicket {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,                   // Ticket subject
    pub description: Option<String>,
    pub partner_id: Option<u64>,        // FK → Contact (customer)
    pub partner_name: Option<String>,
    pub partner_email: Option<String>,
    pub team_id: u64,                   // FK → HelpdeskTeam
    pub stage_id: u64,                  // FK → HelpdeskStage
    pub user_id: Option<Identity>,      // Assigned support agent
    pub priority: TicketPriority,
    pub state: HelpdeskTicketState,
    pub sla_id: Option<u64>,            // FK → HelpdeskSLA
    pub sla_deadline: Option<Timestamp>,
    pub sla_reached: bool,
    pub closed_at: Option<Timestamp>,
    pub created_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateHelpdeskTeamParams {
    pub name: String,
    pub description: Option<String>,
    pub is_active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateHelpdeskStageParams {
    pub name: String,
    pub team_id: Option<u64>,
    pub sequence: u32,
    pub is_closed: bool,
    pub description: Option<String>,
    pub template: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateHelpdeskSLAParams {
    pub name: String,
    pub team_id: u64,
    pub stage_id: u64,
    pub priority: TicketPriority,
    pub time_days: u32,
    pub time_hours: u32,
    pub is_active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateTicketParams {
    pub team_id: u64,
    pub stage_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub priority: TicketPriority,
    pub partner_id: Option<u64>,
    pub partner_name: Option<String>,
    pub partner_email: Option<String>,
    pub sla_id: Option<u64>,
    pub sla_deadline: Option<Timestamp>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateTicketParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub stage_id: Option<u64>,
    pub priority: Option<TicketPriority>,
}

// ── Reducers: Teams ───────────────────────────────────────────────────────────

#[reducer]
pub fn create_helpdesk_team(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateHelpdeskTeamParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_team", "create")?;
    if params.name.is_empty() {
        return Err("Team name cannot be empty".to_string());
    }
    let team = ctx.db.helpdesk_team().insert(HelpdeskTeam {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        is_active: params.is_active,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: None,
        table_name: "helpdesk_team",
        record_id: team.id,
        action: "CREATE",
        old_values: None,
        new_values: None,
        changed_fields: vec![],
        metadata: None,
    });
    Ok(())
}

// ── Reducers: Stages ──────────────────────────────────────────────────────────

#[reducer]
pub fn create_helpdesk_stage(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateHelpdeskStageParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_stage", "create")?;
    if params.name.is_empty() {
        return Err("Stage name cannot be empty".to_string());
    }
    let stage = ctx.db.helpdesk_stage().insert(HelpdeskStage {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        team_id: params.team_id,
        sequence: params.sequence,
        is_closed: params.is_closed,
        template: params.template,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: None,
        table_name: "helpdesk_stage",
        record_id: stage.id,
        action: "CREATE",
        old_values: None,
        new_values: None,
        changed_fields: vec![],
        metadata: None,
    });
    Ok(())
}

// ── Reducers: SLAs ────────────────────────────────────────────────────────────

#[reducer]
pub fn create_helpdesk_sla(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateHelpdeskSLAParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_sla", "create")?;
    if params.name.is_empty() {
        return Err("SLA name cannot be empty".to_string());
    }
    let sla = ctx.db.helpdesk_sla().insert(HelpdeskSLA {
        id: 0,
        organization_id,
        name: params.name,
        team_id: params.team_id,
        stage_id: params.stage_id,
        priority: params.priority,
        time_days: params.time_days,
        time_hours: params.time_hours,
        is_active: params.is_active,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: None,
        table_name: "helpdesk_sla",
        record_id: sla.id,
        action: "CREATE",
        old_values: None,
        new_values: None,
        changed_fields: vec![],
        metadata: None,
    });
    Ok(())
}

// ── Reducers: Tickets ─────────────────────────────────────────────────────────

#[reducer]
pub fn create_ticket(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateTicketParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_ticket", "create")?;
    if params.name.is_empty() {
        return Err("Ticket subject cannot be empty".to_string());
    }
    let ticket = ctx.db.helpdesk_ticket().insert(HelpdeskTicket {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        partner_id: params.partner_id,
        partner_name: params.partner_name,
        partner_email: params.partner_email,
        team_id: params.team_id,
        stage_id: params.stage_id,
        user_id: None,
        priority: params.priority,
        state: HelpdeskTicketState::New,
        sla_id: params.sla_id,
        sla_deadline: params.sla_deadline,
        sla_reached: false,
        closed_at: None,
        created_at: ctx.timestamp,
        deleted_at: None,
    });
    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: None,
        table_name: "helpdesk_ticket",
        record_id: ticket.id,
        action: "CREATE",
        old_values: None,
        new_values: None,
        changed_fields: vec![],
        metadata: None,
    });
    Ok(())
}

#[reducer]
pub fn update_ticket(
    ctx: &ReducerContext,
    organization_id: u64,
    ticket_id: u64,
    params: UpdateTicketParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_ticket", "update")?;
    let ticket = ctx.db.helpdesk_ticket().id().find(&ticket_id)
        .ok_or("Ticket not found")?;
    if ticket.organization_id != organization_id {
        return Err("Ticket belongs to a different organization".to_string());
    }
    ctx.db.helpdesk_ticket().id().update(HelpdeskTicket {
        name: params.name.unwrap_or(ticket.name),
        description: params.description.or(ticket.description),
        stage_id: params.stage_id.unwrap_or(ticket.stage_id),
        priority: params.priority.unwrap_or(ticket.priority),
        ..ticket
    });
    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: None,
        table_name: "helpdesk_ticket",
        record_id: ticket_id,
        action: "UPDATE",
        old_values: None,
        new_values: None,
        changed_fields: vec![],
        metadata: None,
    });
    Ok(())
}

#[reducer]
pub fn assign_ticket(
    ctx: &ReducerContext,
    organization_id: u64,
    ticket_id: u64,
    agent_id: Identity,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_ticket", "update")?;
    let ticket = ctx.db.helpdesk_ticket().id().find(&ticket_id)
        .ok_or("Ticket not found")?;
    if ticket.organization_id != organization_id {
        return Err("Ticket belongs to a different organization".to_string());
    }
    ctx.db.helpdesk_ticket().id().update(HelpdeskTicket {
        user_id: Some(agent_id),
        state: HelpdeskTicketState::InProgress,
        ..ticket
    });
    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: None,
        table_name: "helpdesk_ticket",
        record_id: ticket_id,
        action: "UPDATE",
        old_values: None,
        new_values: None,
        changed_fields: vec!["user_id".to_string(), "state".to_string()],
        metadata: None,
    });
    Ok(())
}

#[reducer]
pub fn close_ticket(
    ctx: &ReducerContext,
    organization_id: u64,
    ticket_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_ticket", "update")?;
    let ticket = ctx.db.helpdesk_ticket().id().find(&ticket_id)
        .ok_or("Ticket not found")?;
    if ticket.organization_id != organization_id {
        return Err("Ticket belongs to a different organization".to_string());
    }
    ctx.db.helpdesk_ticket().id().update(HelpdeskTicket {
        state: HelpdeskTicketState::Closed,
        closed_at: Some(ctx.timestamp),
        ..ticket
    });
    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: None,
        table_name: "helpdesk_ticket",
        record_id: ticket_id,
        action: "UPDATE",
        old_values: None,
        new_values: None,
        changed_fields: vec!["state".to_string(), "closed_at".to_string()],
        metadata: None,
    });
    Ok(())
}

#[reducer]
pub fn reopen_ticket(
    ctx: &ReducerContext,
    organization_id: u64,
    ticket_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_ticket", "update")?;
    let ticket = ctx.db.helpdesk_ticket().id().find(&ticket_id)
        .ok_or("Ticket not found")?;
    if ticket.organization_id != organization_id {
        return Err("Ticket belongs to a different organization".to_string());
    }
    ctx.db.helpdesk_ticket().id().update(HelpdeskTicket {
        state: HelpdeskTicketState::InProgress,
        closed_at: None,
        ..ticket
    });
    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: None,
        table_name: "helpdesk_ticket",
        record_id: ticket_id,
        action: "UPDATE",
        old_values: None,
        new_values: None,
        changed_fields: vec!["state".to_string(), "closed_at".to_string()],
        metadata: None,
    });
    Ok(())
}
