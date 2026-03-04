/// Budgeting — CrossoveredBudget, CrossoveredBudgetLines, BudgetPost
///
/// # 8.2 Budgeting
///
/// Tables for managing budgets, budget lines, and budget posts.
/// Supports budget planning, tracking, and variance analysis.
///
/// ## Tables
/// - `CrossoveredBudget` — Budget header with date range and state
/// - `CrossoveredBudgetLines` — Budget line items with planned vs actual amounts
/// - `BudgetPost` — Budget positions for categorization
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::BudgetState;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = crossovered_budget,
    public,
    index(accessor = budget_by_company, btree(columns = [company_id])),
    index(accessor = budget_by_state, btree(columns = [state])),
    index(accessor = budget_by_date_range, btree(columns = [date_from, date_to]))
)]
#[derive(Clone)]
pub struct CrossoveredBudget {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub description: Option<String>,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub state: BudgetState,
    pub company_id: u64,
    pub crossovered_budget_line: Vec<u64>,
    pub total_planned: f64,
    pub total_practical: f64,
    pub total_theoretical: f64,
    pub variance_percentage: f64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = crossovered_budget_lines,
    public,
    index(accessor = budget_line_by_budget, btree(columns = [general_budget_id])),
    index(accessor = budget_line_by_analytic, btree(columns = [analytic_account_id])),
    index(accessor = budget_line_by_date, btree(columns = [date_from, date_to]))
)]
#[derive(Clone)]
pub struct CrossoveredBudgetLines {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub general_budget_id: u64,
    pub analytic_account_id: Option<u64>,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub paid_date: Option<Timestamp>,
    pub planned_amount: f64,
    pub practical_amount: f64,
    pub theoretical_amount: f64,
    pub achieve_percentage: f64,
    pub company_id: u64,
    pub is_above_budget: bool,
    pub variance: f64,
    pub variance_percentage: f64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = budget_post,
    public,
    index(accessor = budget_post_by_company, btree(columns = [company_id]))
)]
#[derive(Clone)]
pub struct BudgetPost {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub code: Option<String>,
    pub description: Option<String>,
    pub account_ids: Vec<u64>,
    pub company_id: u64,
    pub is_active: bool,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCrossoveredBudgetParams {
    pub name: String,
    pub description: Option<String>,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub state: BudgetState,
    pub crossovered_budget_line: Vec<u64>,
    pub total_planned: f64,
    pub total_practical: f64,
    pub total_theoretical: f64,
    pub variance_percentage: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateCrossoveredBudgetParams {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub date_from: Option<Timestamp>,
    pub date_to: Option<Timestamp>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCrossoveredBudgetLineParams {
    pub analytic_account_id: Option<u64>,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub paid_date: Option<Timestamp>,
    pub planned_amount: f64,
    pub practical_amount: f64,
    pub theoretical_amount: f64,
    pub achieve_percentage: f64,
    pub is_above_budget: bool,
    pub variance: f64,
    pub variance_percentage: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateCrossoveredBudgetLineParams {
    pub planned_amount: Option<f64>,
    pub analytic_account_id: Option<Option<u64>>,
    pub date_from: Option<Timestamp>,
    pub date_to: Option<Timestamp>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateBudgetLineActualsParams {
    pub practical_amount: f64,
    pub theoretical_amount: f64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateBudgetPostParams {
    pub name: String,
    pub code: Option<String>,
    pub description: Option<String>,
    pub account_ids: Vec<u64>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateBudgetPostParams {
    pub name: Option<String>,
    pub code: Option<Option<String>>,
    pub description: Option<Option<String>>,
    pub account_ids: Option<Vec<u64>>,
    pub is_active: Option<bool>,
    pub metadata: Option<Option<String>>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new budget
#[spacetimedb::reducer]
pub fn create_crossovered_budget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateCrossoveredBudgetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "create")?;

    if params.name.is_empty() {
        return Err("Budget name is required".to_string());
    }

    if params.date_to <= params.date_from {
        return Err("End date must be after start date".to_string());
    }

    let budget = ctx.db.crossovered_budget().insert(CrossoveredBudget {
        id: 0,
        name: params.name.clone(),
        description: params.description,
        date_from: params.date_from,
        date_to: params.date_to,
        state: params.state,
        company_id,
        crossovered_budget_line: params.crossovered_budget_line,
        total_planned: params.total_planned,
        total_practical: params.total_practical,
        total_theoretical: params.total_theoretical,
        variance_percentage: params.variance_percentage,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "crossovered_budget",
            record_id: budget.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "date_from": params.date_from.to_string(),
                    "date_to": params.date_to.to_string()
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "date_from".to_string(),
                "date_to".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Update budget basic information
#[spacetimedb::reducer]
pub fn update_crossovered_budget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    budget_id: u64,
    params: UpdateCrossoveredBudgetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "write")?;

    let mut budget = ctx
        .db
        .crossovered_budget()
        .id()
        .find(&budget_id)
        .ok_or("Budget not found")?;

    if budget.company_id != company_id {
        return Err("Budget does not belong to this company".to_string());
    }

    if budget.state != BudgetState::Draft {
        return Err("Can only modify budgets in Draft state".to_string());
    }

    let old_values = serde_json::json!({
        "name": budget.name,
        "description": budget.description
    });

    let mut changed_fields = Vec::new();

    if let Some(n) = params.name {
        if n.is_empty() {
            return Err("Budget name cannot be empty".to_string());
        }
        budget.name = n;
        changed_fields.push("name".to_string());
    }

    if let Some(desc) = params.description {
        budget.description = desc;
        changed_fields.push("description".to_string());
    }

    if let Some(df) = params.date_from {
        if let Some(dt) = params.date_to {
            if dt <= df {
                return Err("End date must be after start date".to_string());
            }
            budget.date_to = dt;
        }
        if df >= budget.date_to {
            return Err("Start date must be before end date".to_string());
        }
        budget.date_from = df;
        changed_fields.push("date_from".to_string());
        if params.date_to.is_some() {
            changed_fields.push("date_to".to_string());
        }
    } else if let Some(dt) = params.date_to {
        if dt <= budget.date_from {
            return Err("End date must be after start date".to_string());
        }
        budget.date_to = dt;
        changed_fields.push("date_to".to_string());
    }

    if let Some(meta) = params.metadata {
        budget.metadata = meta;
        changed_fields.push("metadata".to_string());
    }

    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "crossovered_budget",
            record_id: budget.id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some(serde_json::json!({ "name": budget.name }).to_string()),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

/// Add a budget line
#[spacetimedb::reducer]
pub fn create_budget_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    budget_id: u64,
    params: CreateCrossoveredBudgetLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "create")?;

    let mut budget = ctx
        .db
        .crossovered_budget()
        .id()
        .find(&budget_id)
        .ok_or("Budget not found")?;

    if budget.company_id != company_id {
        return Err("Budget does not belong to this company".to_string());
    }

    if budget.state != BudgetState::Draft {
        return Err("Can only add lines to budgets in Draft state".to_string());
    }

    if params.date_to <= params.date_from {
        return Err("Line end date must be after start date".to_string());
    }

    if params.date_from < budget.date_from || params.date_to > budget.date_to {
        return Err("Line dates must be within budget date range".to_string());
    }

    if params.planned_amount < 0.0 {
        return Err("Planned amount cannot be negative".to_string());
    }

    let line = ctx
        .db
        .crossovered_budget_lines()
        .insert(CrossoveredBudgetLines {
            id: 0,
            general_budget_id: budget_id,
            analytic_account_id: params.analytic_account_id,
            date_from: params.date_from,
            date_to: params.date_to,
            paid_date: params.paid_date,
            planned_amount: params.planned_amount,
            practical_amount: params.practical_amount,
            theoretical_amount: params.theoretical_amount,
            achieve_percentage: params.achieve_percentage,
            company_id,
            is_above_budget: params.is_above_budget,
            variance: params.variance,
            variance_percentage: params.variance_percentage,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: params.metadata,
        });

    budget.crossovered_budget_line.push(line.id);
    budget.total_planned += params.planned_amount;
    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "crossovered_budget_lines",
            record_id: line.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "budget_id": budget_id, "planned_amount": params.planned_amount })
                    .to_string(),
            ),
            changed_fields: vec!["budget_id".to_string(), "planned_amount".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Update a budget line
#[spacetimedb::reducer]
pub fn update_budget_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: UpdateCrossoveredBudgetLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "write")?;

    let mut line = ctx
        .db
        .crossovered_budget_lines()
        .id()
        .find(&line_id)
        .ok_or("Budget line not found")?;

    if line.company_id != company_id {
        return Err("Budget line does not belong to this company".to_string());
    }

    let mut budget = ctx
        .db
        .crossovered_budget()
        .id()
        .find(&line.general_budget_id)
        .ok_or("Parent budget not found")?;

    if budget.state != BudgetState::Draft {
        return Err("Can only modify lines in Draft budget".to_string());
    }

    let old_planned = line.planned_amount;
    let mut changed_fields = Vec::new();

    if let Some(pa) = params.planned_amount {
        if pa < 0.0 {
            return Err("Planned amount cannot be negative".to_string());
        }
        line.planned_amount = pa;
        changed_fields.push("planned_amount".to_string());
    }

    if let Some(aid) = params.analytic_account_id {
        line.analytic_account_id = aid;
        changed_fields.push("analytic_account_id".to_string());
    }

    if let Some(df) = params.date_from {
        if let Some(dt) = params.date_to {
            if dt <= df {
                return Err("End date must be after start date".to_string());
            }
            line.date_to = dt;
        }
        if df >= line.date_to {
            return Err("Start date must be before end date".to_string());
        }
        if df < budget.date_from {
            return Err("Line dates must be within budget date range".to_string());
        }
        line.date_from = df;
        changed_fields.push("date_from".to_string());
        if params.date_to.is_some() {
            changed_fields.push("date_to".to_string());
        }
    } else if let Some(dt) = params.date_to {
        if dt <= line.date_from {
            return Err("End date must be after start date".to_string());
        }
        if dt > budget.date_to {
            return Err("Line dates must be within budget date range".to_string());
        }
        line.date_to = dt;
        changed_fields.push("date_to".to_string());
    }

    if let Some(meta) = params.metadata {
        line.metadata = meta;
        changed_fields.push("metadata".to_string());
    }

    line.write_uid = Some(ctx.sender());
    line.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget_lines().id().update(line.clone());

    budget.total_planned = budget.total_planned - old_planned + line.planned_amount;
    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "crossovered_budget_lines",
            record_id: line_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "planned_amount": old_planned }).to_string()),
            new_values: Some(
                serde_json::json!({ "planned_amount": line.planned_amount }).to_string(),
            ),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

/// Update budget line with actual amounts (for tracking)
#[spacetimedb::reducer]
pub fn update_budget_line_actuals(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: UpdateBudgetLineActualsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "write")?;

    let mut line = ctx
        .db
        .crossovered_budget_lines()
        .id()
        .find(&line_id)
        .ok_or("Budget line not found")?;

    if line.company_id != company_id {
        return Err("Budget line does not belong to this company".to_string());
    }

    let budget = ctx
        .db
        .crossovered_budget()
        .id()
        .find(&line.general_budget_id)
        .ok_or("Parent budget not found")?;

    if budget.state != BudgetState::Validate && budget.state != BudgetState::Confirm {
        return Err("Budget must be confirmed to update actuals".to_string());
    }

    let old_practical = line.practical_amount;

    line.practical_amount = params.practical_amount;
    line.theoretical_amount = params.theoretical_amount;
    line.variance = params.practical_amount - line.planned_amount;
    line.variance_percentage = if line.planned_amount > 0.0 {
        (line.variance / line.planned_amount) * 100.0
    } else {
        0.0
    };
    line.achieve_percentage = if line.planned_amount > 0.0 {
        (params.practical_amount / line.planned_amount) * 100.0
    } else {
        0.0
    };
    line.is_above_budget = params.practical_amount > line.planned_amount;

    line.write_uid = Some(ctx.sender());
    line.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget_lines().id().update(line.clone());

    let mut budget = budget;
    budget.total_practical = budget.total_practical - old_practical + params.practical_amount;
    budget.variance_percentage = if budget.total_planned > 0.0 {
        ((budget.total_practical - budget.total_planned) / budget.total_planned) * 100.0
    } else {
        0.0
    };
    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget);

    Ok(())
}

/// Confirm a budget
#[spacetimedb::reducer]
pub fn confirm_budget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    budget_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "write")?;

    let budget = ctx
        .db
        .crossovered_budget()
        .id()
        .find(&budget_id)
        .ok_or("Budget not found")?;

    if budget.company_id != company_id {
        return Err("Budget does not belong to this company".to_string());
    }

    if budget.state != BudgetState::Draft {
        return Err("Budget must be in Draft state to confirm".to_string());
    }

    if budget.crossovered_budget_line.is_empty() {
        return Err("Budget must have at least one line to confirm".to_string());
    }

    ctx.db.crossovered_budget().id().update(CrossoveredBudget {
        state: BudgetState::Confirm,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..budget.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "crossovered_budget",
            record_id: budget_id,
            action: "CONFIRM",
            old_values: Some(serde_json::json!({ "state": "Draft" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Confirm" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Validate a budget
#[spacetimedb::reducer]
pub fn validate_budget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    budget_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "write")?;

    let budget = ctx
        .db
        .crossovered_budget()
        .id()
        .find(&budget_id)
        .ok_or("Budget not found")?;

    if budget.company_id != company_id {
        return Err("Budget does not belong to this company".to_string());
    }

    if budget.state != BudgetState::Confirm {
        return Err("Budget must be confirmed before validation".to_string());
    }

    ctx.db.crossovered_budget().id().update(CrossoveredBudget {
        state: BudgetState::Validate,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..budget.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "crossovered_budget",
            record_id: budget_id,
            action: "VALIDATE",
            old_values: Some(serde_json::json!({ "state": "Confirm" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Validate" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Mark budget as done
#[spacetimedb::reducer]
pub fn done_budget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    budget_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "write")?;

    let budget = ctx
        .db
        .crossovered_budget()
        .id()
        .find(&budget_id)
        .ok_or("Budget not found")?;

    if budget.company_id != company_id {
        return Err("Budget does not belong to this company".to_string());
    }

    if budget.state != BudgetState::Validate {
        return Err("Budget must be validated before marking as done".to_string());
    }

    ctx.db.crossovered_budget().id().update(CrossoveredBudget {
        state: BudgetState::Done,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..budget.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "crossovered_budget",
            record_id: budget_id,
            action: "DONE",
            old_values: Some(serde_json::json!({ "state": "Validate" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Done" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Cancel a budget
#[spacetimedb::reducer]
pub fn cancel_budget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    budget_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "write")?;

    let budget = ctx
        .db
        .crossovered_budget()
        .id()
        .find(&budget_id)
        .ok_or("Budget not found")?;

    if budget.company_id != company_id {
        return Err("Budget does not belong to this company".to_string());
    }

    if budget.state == BudgetState::Done {
        return Err("Cannot cancel a completed budget".to_string());
    }

    ctx.db.crossovered_budget().id().update(CrossoveredBudget {
        state: BudgetState::Cancel,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..budget.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "crossovered_budget",
            record_id: budget_id,
            action: "CANCEL",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "Cancel" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Create a budget post
#[spacetimedb::reducer]
pub fn create_budget_post(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateBudgetPostParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "budget_post", "create")?;

    if params.name.is_empty() {
        return Err("Budget post name is required".to_string());
    }

    let post = ctx.db.budget_post().insert(BudgetPost {
        id: 0,
        name: params.name.clone(),
        code: params.code,
        description: params.description,
        account_ids: params.account_ids,
        company_id,
        is_active: params.is_active,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "budget_post",
            record_id: post.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": params.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Update a budget post
#[spacetimedb::reducer]
pub fn update_budget_post(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    post_id: u64,
    params: UpdateBudgetPostParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "budget_post", "write")?;

    let mut post = ctx
        .db
        .budget_post()
        .id()
        .find(&post_id)
        .ok_or("Budget post not found")?;

    if post.company_id != company_id {
        return Err("Budget post does not belong to this company".to_string());
    }

    let mut changed_fields = Vec::new();

    if let Some(n) = params.name {
        if n.is_empty() {
            return Err("Budget post name cannot be empty".to_string());
        }
        post.name = n;
        changed_fields.push("name".to_string());
    }

    if let Some(c) = params.code {
        post.code = c;
        changed_fields.push("code".to_string());
    }

    if let Some(desc) = params.description {
        post.description = desc;
        changed_fields.push("description".to_string());
    }

    if let Some(accs) = params.account_ids {
        post.account_ids = accs;
        changed_fields.push("account_ids".to_string());
    }

    if let Some(active) = params.is_active {
        post.is_active = active;
        changed_fields.push("is_active".to_string());
    }

    if let Some(meta) = params.metadata {
        post.metadata = meta;
        changed_fields.push("metadata".to_string());
    }

    post.write_uid = Some(ctx.sender());
    post.write_date = Some(ctx.timestamp);

    ctx.db.budget_post().id().update(post.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "budget_post",
            record_id: post_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": post.name }).to_string()),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

/// Delete a budget line
#[spacetimedb::reducer]
pub fn delete_budget_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "delete")?;

    let line = ctx
        .db
        .crossovered_budget_lines()
        .id()
        .find(&line_id)
        .ok_or("Budget line not found")?;

    if line.company_id != company_id {
        return Err("Budget line does not belong to this company".to_string());
    }

    let mut budget = ctx
        .db
        .crossovered_budget()
        .id()
        .find(&line.general_budget_id)
        .ok_or("Parent budget not found")?;

    if budget.state != BudgetState::Draft {
        return Err("Can only delete lines from budgets in Draft state".to_string());
    }

    budget.total_planned -= line.planned_amount;
    budget.total_practical -= line.practical_amount;
    budget.total_theoretical -= line.theoretical_amount;
    budget.crossovered_budget_line.retain(|&id| id != line_id);
    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget);
    ctx.db.crossovered_budget_lines().id().delete(&line_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "crossovered_budget_lines",
            record_id: line_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({ "planned_amount": line.planned_amount }).to_string(),
            ),
            new_values: None,
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
