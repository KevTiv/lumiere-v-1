/// Helpdesk CSV Imports — HelpdeskTeam, HelpdeskStage, HelpdeskSLA, HelpdeskTicket
use spacetimedb::{ReducerContext, Table};

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpdesk::tickets::{
    helpdesk_sla, helpdesk_stage, helpdesk_team, helpdesk_ticket, HelpdeskSLA, HelpdeskStage,
    HelpdeskTeam, HelpdeskTicket,
};
use crate::helpers::check_permission;
use crate::types::{HelpdeskTicketState, TicketPriority};

// ── HelpdeskTeam ──────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_helpdesk_team_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_team", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "helpdesk_team",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        ctx.db.helpdesk_team().insert(HelpdeskTeam {
            id: 0,
            organization_id,
            name,
            description: opt_str(col(&headers, row, "description")),
            is_active: parse_bool(col(&headers, row, "is_active")),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import helpdesk_team: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── HelpdeskStage ─────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_helpdesk_stage_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_stage", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "helpdesk_stage",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        ctx.db.helpdesk_stage().insert(HelpdeskStage {
            id: 0,
            organization_id,
            name,
            description: opt_str(col(&headers, row, "description")),
            team_id: opt_u64(col(&headers, row, "team_id")),
            sequence: parse_u32(col(&headers, row, "sequence")),
            is_closed: parse_bool(col(&headers, row, "is_closed")),
            template: opt_str(col(&headers, row, "template")),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import helpdesk_stage: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── HelpdeskSLA ───────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_helpdesk_sla_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_sla", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "helpdesk_sla",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let team_id = parse_u64(col(&headers, row, "team_id"));
        if team_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("team_id"),
                None,
                "team_id is required",
            );
            errors += 1;
            continue;
        }

        let priority = match col(&headers, row, "priority") {
            "high" => TicketPriority::High,
            "urgent" => TicketPriority::Urgent,
            "low" => TicketPriority::Low,
            _ => TicketPriority::Normal,
        };

        ctx.db.helpdesk_sla().insert(HelpdeskSLA {
            id: 0,
            organization_id,
            name,
            team_id,
            stage_id: parse_u64(col(&headers, row, "stage_id")),
            priority,
            time_days: parse_u32(col(&headers, row, "time_days")),
            time_hours: parse_u32(col(&headers, row, "time_hours")),
            is_active: parse_bool(col(&headers, row, "is_active")),
            created_at: ctx.timestamp,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import helpdesk_sla: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── HelpdeskTicket ────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_helpdesk_ticket_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "helpdesk_ticket", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "helpdesk_ticket",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let team_id = parse_u64(col(&headers, row, "team_id"));
        if team_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("team_id"),
                None,
                "team_id is required",
            );
            errors += 1;
            continue;
        }

        let priority = match col(&headers, row, "priority") {
            "high" => TicketPriority::High,
            "urgent" => TicketPriority::Urgent,
            "low" => TicketPriority::Low,
            _ => TicketPriority::Normal,
        };

        let state = match col(&headers, row, "state") {
            "in_progress" | "inprogress" => HelpdeskTicketState::InProgress,
            "on_hold" | "onhold" => HelpdeskTicketState::OnHold,
            "closed" => HelpdeskTicketState::Closed,
            "cancelled" => HelpdeskTicketState::Cancelled,
            _ => HelpdeskTicketState::New,
        };

        ctx.db.helpdesk_ticket().insert(HelpdeskTicket {
            id: 0,
            organization_id,
            name,
            description: opt_str(col(&headers, row, "description")),
            partner_id: opt_u64(col(&headers, row, "partner_id")),
            partner_name: opt_str(col(&headers, row, "partner_name")),
            partner_email: opt_str(col(&headers, row, "partner_email")),
            team_id,
            stage_id: parse_u64(col(&headers, row, "stage_id")),
            user_id: None,
            priority,
            state,
            sla_id: opt_u64(col(&headers, row, "sla_id")),
            sla_deadline: opt_timestamp(col(&headers, row, "sla_deadline")),
            sla_reached: parse_bool(col(&headers, row, "sla_reached")),
            closed_at: opt_timestamp(col(&headers, row, "closed_at")),
            created_at: ctx.timestamp,
            deleted_at: None,
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import helpdesk_ticket: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}
