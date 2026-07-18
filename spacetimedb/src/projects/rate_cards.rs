/// Project rate cards — server-side cost/sell rate resolution for PSA timesheets
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProjectRateCard** | Named rate card header (company + optional project scope) |
/// | **ProjectRateCardLine** | Scoped lines (employee / task / project) with cost & sell rates |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::projects::projects::project_project;
use crate::projects::tasks::project_task;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Rate card header — groups lines for a company (optionally scoped to one project)
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_rate_card,
    public,
    index(accessor = rate_card_by_org, btree(columns = [organization_id])),
    index(accessor = rate_card_by_company, btree(columns = [company_id])),
    index(accessor = rate_card_by_project, btree(columns = [project_id]))
)]
pub struct ProjectRateCard {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub currency_id: u64,
    /// When set, card applies only to this project; when None, company-wide
    pub project_id: Option<u64>,
    pub active: bool,
    pub effective_from: Option<Timestamp>,
    pub effective_to: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Rate card line — employee / task / project scope with cost and sell rates
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_rate_card_line,
    public,
    index(accessor = rate_card_line_by_org, btree(columns = [organization_id])),
    index(accessor = rate_card_line_by_company, btree(columns = [company_id])),
    index(accessor = rate_card_line_by_card, btree(columns = [rate_card_id])),
    index(accessor = rate_card_line_by_employee, btree(columns = [employee_id])),
    index(accessor = rate_card_line_by_task, btree(columns = [task_id]))
)]
pub struct ProjectRateCardLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
    pub company_id: u64,
    pub rate_card_id: u64,
    /// `employee` | `task` | `project`
    pub scope: String,
    pub employee_id: Option<u64>,
    pub task_id: Option<u64>,
    pub currency_id: u64,
    pub cost_rate: f64,
    pub sell_rate: f64,
    pub active: bool,
    pub effective_from: Option<Timestamp>,
    pub effective_to: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProjectRateCardParams {
    pub name: String,
    pub currency_id: u64,
    pub project_id: Option<u64>,
    pub active: bool,
    pub effective_from: Option<Timestamp>,
    pub effective_to: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProjectRateCardParams {
    pub name: Option<String>,
    pub currency_id: Option<u64>,
    pub project_id: Option<Option<u64>>,
    pub active: Option<bool>,
    pub effective_from: Option<Option<Timestamp>>,
    pub effective_to: Option<Option<Timestamp>>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProjectRateCardLineParams {
    pub rate_card_id: u64,
    /// `employee` | `task` | `project`
    pub scope: String,
    pub employee_id: Option<u64>,
    pub task_id: Option<u64>,
    pub currency_id: u64,
    pub cost_rate: f64,
    pub sell_rate: f64,
    pub active: bool,
    pub effective_from: Option<Timestamp>,
    pub effective_to: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProjectRateCardLineParams {
    pub scope: Option<String>,
    pub employee_id: Option<Option<u64>>,
    pub task_id: Option<Option<u64>>,
    pub currency_id: Option<u64>,
    pub cost_rate: Option<f64>,
    pub sell_rate: Option<f64>,
    pub active: Option<bool>,
    pub effective_from: Option<Option<Timestamp>>,
    pub effective_to: Option<Option<Timestamp>>,
    pub metadata: Option<Option<String>>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

pub struct ResolvedRates {
    pub cost_rate: f64,
    pub sell_rate: f64,
    pub currency_id: u64,
    pub from_rate_card: bool,
}

fn normalize_scope(scope: &str) -> Result<String, String> {
    let s = scope.trim().to_ascii_lowercase();
    match s.as_str() {
        "employee" | "task" | "project" => Ok(s),
        _ => Err("scope must be employee, task, or project".to_string()),
    }
}

fn validate_line_scope(
    scope: &str,
    employee_id: Option<u64>,
    task_id: Option<u64>,
) -> Result<(), String> {
    match scope {
        "employee" => {
            if employee_id.is_none() {
                return Err("employee scope requires employee_id".to_string());
            }
        }
        "task" => {
            if task_id.is_none() {
                return Err("task scope requires task_id".to_string());
            }
        }
        "project" => {
            // project-level line: neither employee nor task required
        }
        _ => return Err("scope must be employee, task, or project".to_string()),
    }
    Ok(())
}

fn ts_in_range(at: Timestamp, from: Option<Timestamp>, to: Option<Timestamp>) -> bool {
    if let Some(f) = from {
        if at.to_micros_since_unix_epoch() < f.to_micros_since_unix_epoch() {
            return false;
        }
    }
    if let Some(t) = to {
        if at.to_micros_since_unix_epoch() > t.to_micros_since_unix_epoch() {
            return false;
        }
    }
    true
}

fn line_specificity(line: &ProjectRateCardLine) -> u8 {
    let has_emp = line.employee_id.is_some();
    let has_task = line.task_id.is_some();
    match (has_emp, has_task, line.scope.as_str()) {
        (true, true, _) => 4,
        (true, false, _) => 3,
        (false, true, _) => 2,
        (_, _, "project") => 1,
        _ => 0,
    }
}

/// Look up the best matching rate card line for a timesheet context.
/// Prefer more specific scopes: employee+task > employee > task > project.
pub fn lookup_rate_card_rates(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: u64,
    employee_id: u64,
    task_id: Option<u64>,
    currency_id: u64,
    at: Timestamp,
) -> Option<ResolvedRates> {
    let mut candidates: Vec<(u8, ProjectRateCardLine)> = Vec::new();

    for card in ctx.db.project_rate_card().rate_card_by_company().filter(&company_id) {
        if card.organization_id != organization_id || !card.active {
            continue;
        }
        if let Some(pid) = card.project_id {
            if pid != project_id {
                continue;
            }
        }
        if !ts_in_range(at, card.effective_from, card.effective_to) {
            continue;
        }

        for line in ctx
            .db
            .project_rate_card_line()
            .rate_card_line_by_card()
            .filter(&card.id)
        {
            if line.organization_id != organization_id
                || line.company_id != company_id
                || !line.active
            {
                continue;
            }
            if line.currency_id != currency_id {
                continue;
            }
            if !ts_in_range(at, line.effective_from, line.effective_to) {
                continue;
            }

            let matches = match line.scope.as_str() {
                "employee" => line.employee_id == Some(employee_id)
                    && (line.task_id.is_none() || line.task_id == task_id),
                "task" => line.task_id.is_some() && line.task_id == task_id,
                "project" => line.employee_id.is_none() && line.task_id.is_none(),
                _ => false,
            };
            if !matches {
                continue;
            }
            let score = line_specificity(&line);
            candidates.push((score, line));
        }
    }

    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.first().map(|(_, line)| ResolvedRates {
        cost_rate: line.cost_rate,
        sell_rate: line.sell_rate,
        currency_id: line.currency_id,
        from_rate_card: true,
    })
}

/// Resolve cost/sell for logging/timer/validate.
/// When a rate card matches on a billable project, card rates win (client sell_rate ignored).
/// Otherwise: cost from client (required if no card); sell = client sell_rate or cost.
pub fn resolve_timesheet_rates(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: u64,
    employee_id: u64,
    task_id: Option<u64>,
    currency_id: u64,
    at: Timestamp,
    billable_project: bool,
    client_cost: Option<f64>,
    client_sell: Option<f64>,
) -> Result<(f64, f64), String> {
    let card = lookup_rate_card_rates(
        ctx,
        organization_id,
        company_id,
        project_id,
        employee_id,
        task_id,
        currency_id,
        at,
    );

    if billable_project {
        if let Some(rates) = card {
            return Ok((rates.cost_rate, rates.sell_rate));
        }
    } else if let Some(rates) = card {
        // Non-billable: card still fills omitted rates
        let cost = client_cost.filter(|c| *c > 0.0).unwrap_or(rates.cost_rate);
        let sell = client_sell.unwrap_or(rates.sell_rate);
        return Ok((cost, sell));
    }

    let cost = client_cost.filter(|c| *c > 0.0).ok_or_else(|| {
        "employee_cost is required when no matching rate card exists".to_string()
    })?;
    let sell = client_sell.unwrap_or(cost);
    if sell < 0.0 {
        return Err("sell_rate cannot be negative".to_string());
    }
    Ok((cost, sell))
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_project_rate_card(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateProjectRateCardParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_rate_card", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    if params.name.trim().is_empty() {
        return Err("Rate card name cannot be empty".to_string());
    }

    if let Some(pid) = params.project_id {
        let project = ctx
            .db
            .project_project()
            .id()
            .find(&pid)
            .ok_or("Project not found")?;
        if project.organization_id != organization_id || project.company_id != company_id {
            return Err("Project does not belong to this company".to_string());
        }
    }

    let row = ctx.db.project_rate_card().insert(ProjectRateCard {
        id: 0,
        organization_id,
        company_id,
        name: params.name,
        currency_id: params.currency_id,
        project_id: params.project_id,
        active: params.active,
        effective_from: params.effective_from,
        effective_to: params.effective_to,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_rate_card",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": row.name,
                    "currency_id": row.currency_id,
                    "project_id": row.project_id,
                    "active": row.active,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "currency_id".to_string(),
                "project_id".to_string(),
                "active".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_project_rate_card(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rate_card_id: u64,
    params: UpdateProjectRateCardParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_rate_card", "write")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let existing = ctx
        .db
        .project_rate_card()
        .id()
        .find(&rate_card_id)
        .ok_or("Rate card not found")?;
    if existing.organization_id != organization_id {
        return Err("Rate card does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if let Some(Some(pid)) = params.project_id {
        let project = ctx
            .db
            .project_project()
            .id()
            .find(&pid)
            .ok_or("Project not found")?;
        if project.organization_id != organization_id || project.company_id != company_id {
            return Err("Project does not belong to this company".to_string());
        }
    }

    let old_values = serde_json::json!({
        "name": existing.name,
        "active": existing.active,
        "currency_id": existing.currency_id,
    });

    let updated = ProjectRateCard {
        name: params.name.unwrap_or(existing.name.clone()),
        currency_id: params.currency_id.unwrap_or(existing.currency_id),
        project_id: match params.project_id {
            Some(v) => v,
            None => existing.project_id,
        },
        active: params.active.unwrap_or(existing.active),
        effective_from: match params.effective_from {
            Some(v) => v,
            None => existing.effective_from,
        },
        effective_to: match params.effective_to {
            Some(v) => v,
            None => existing.effective_to,
        },
        metadata: match params.metadata {
            Some(v) => v,
            None => existing.metadata.clone(),
        },
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..existing
    };

    ctx.db.project_rate_card().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_rate_card",
            record_id: rate_card_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some(
                serde_json::json!({
                    "name": updated.name,
                    "active": updated.active,
                    "currency_id": updated.currency_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "active".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_project_rate_card_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateProjectRateCardLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_rate_card", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let scope = normalize_scope(&params.scope)?;
    validate_line_scope(&scope, params.employee_id, params.task_id)?;
    if params.cost_rate < 0.0 || params.sell_rate < 0.0 {
        return Err("cost_rate and sell_rate cannot be negative".to_string());
    }

    let card = ctx
        .db
        .project_rate_card()
        .id()
        .find(&params.rate_card_id)
        .ok_or("Rate card not found")?;
    if card.organization_id != organization_id || card.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if let Some(tid) = params.task_id {
        let task = ctx
            .db
            .project_task()
            .id()
            .find(&tid)
            .ok_or("Task not found")?;
        if task.organization_id != organization_id || task.company_id != company_id {
            return Err("Task does not belong to this company".to_string());
        }
        if let Some(pid) = card.project_id {
            if task.project_id != Some(pid) {
                return Err("Task does not belong to the rate card project".to_string());
            }
        }
    }

    let row = ctx.db.project_rate_card_line().insert(ProjectRateCardLine {
        id: 0,
        organization_id,
        company_id,
        rate_card_id: params.rate_card_id,
        scope,
        employee_id: params.employee_id,
        task_id: params.task_id,
        currency_id: params.currency_id,
        cost_rate: params.cost_rate,
        sell_rate: params.sell_rate,
        active: params.active,
        effective_from: params.effective_from,
        effective_to: params.effective_to,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_rate_card_line",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "rate_card_id": row.rate_card_id,
                    "scope": row.scope,
                    "cost_rate": row.cost_rate,
                    "sell_rate": row.sell_rate,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "scope".to_string(),
                "cost_rate".to_string(),
                "sell_rate".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_project_rate_card_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: UpdateProjectRateCardLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_rate_card", "write")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let existing = ctx
        .db
        .project_rate_card_line()
        .id()
        .find(&line_id)
        .ok_or("Rate card line not found")?;
    if existing.organization_id != organization_id {
        return Err("Rate card line does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let scope = match params.scope {
        Some(ref s) => normalize_scope(s)?,
        None => existing.scope.clone(),
    };
    let employee_id = match params.employee_id {
        Some(v) => v,
        None => existing.employee_id,
    };
    let task_id = match params.task_id {
        Some(v) => v,
        None => existing.task_id,
    };
    validate_line_scope(&scope, employee_id, task_id)?;

    if let Some(c) = params.cost_rate {
        if c < 0.0 {
            return Err("cost_rate cannot be negative".to_string());
        }
    }
    if let Some(s) = params.sell_rate {
        if s < 0.0 {
            return Err("sell_rate cannot be negative".to_string());
        }
    }

    let old_values = serde_json::json!({
        "cost_rate": existing.cost_rate,
        "sell_rate": existing.sell_rate,
        "active": existing.active,
    });

    let updated = ProjectRateCardLine {
        scope,
        employee_id,
        task_id,
        currency_id: params.currency_id.unwrap_or(existing.currency_id),
        cost_rate: params.cost_rate.unwrap_or(existing.cost_rate),
        sell_rate: params.sell_rate.unwrap_or(existing.sell_rate),
        active: params.active.unwrap_or(existing.active),
        effective_from: match params.effective_from {
            Some(v) => v,
            None => existing.effective_from,
        },
        effective_to: match params.effective_to {
            Some(v) => v,
            None => existing.effective_to,
        },
        metadata: match params.metadata {
            Some(v) => v,
            None => existing.metadata.clone(),
        },
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..existing
    };

    ctx.db.project_rate_card_line().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_rate_card_line",
            record_id: line_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some(
                serde_json::json!({
                    "cost_rate": updated.cost_rate,
                    "sell_rate": updated.sell_rate,
                    "active": updated.active,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "cost_rate".to_string(),
                "sell_rate".to_string(),
                "active".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}
