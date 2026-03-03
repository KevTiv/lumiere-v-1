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
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
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

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new budget
#[spacetimedb::reducer]
pub fn create_crossovered_budget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: String,
    description: Option<String>,
    date_from: Timestamp,
    date_to: Timestamp,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "create")?;

    if name.is_empty() {
        return Err("Budget name is required".to_string());
    }

    if date_to <= date_from {
        return Err("End date must be after start date".to_string());
    }

    let budget = ctx.db.crossovered_budget().insert(CrossoveredBudget {
        id: 0,
        name: name.clone(),
        description,
        date_from,
        date_to,
        state: BudgetState::Draft,
        company_id,
        crossovered_budget_line: Vec::new(),
        total_planned: 0.0,
        total_practical: 0.0,
        total_theoretical: 0.0,
        variance_percentage: 0.0,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "crossovered_budget",
        budget.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({ "name": name, "date_from": date_from.to_string(), "date_to": date_to.to_string() })
                .to_string(),
        ),
        vec![
            "name".to_string(),
            "date_from".to_string(),
            "date_to".to_string(),
        ],
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
    name: Option<String>,
    description: Option<String>,
    date_from: Option<Timestamp>,
    date_to: Option<Timestamp>,
    metadata: Option<String>,
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

    // Only allow updates in Draft state
    if budget.state != BudgetState::Draft {
        return Err("Can only modify budgets in Draft state".to_string());
    }

    let old_values = serde_json::json!({
        "name": budget.name,
        "description": budget.description
    });

    let mut changed_fields = Vec::new();

    if let Some(n) = name {
        if n.is_empty() {
            return Err("Budget name cannot be empty".to_string());
        }
        budget.name = n;
        changed_fields.push("name".to_string());
    }

    if description.is_some() {
        budget.description = description;
        changed_fields.push("description".to_string());
    }

    if let Some(df) = date_from {
        if let Some(dt) = date_to {
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
        if date_to.is_some() {
            changed_fields.push("date_to".to_string());
        }
    } else if let Some(dt) = date_to {
        if dt <= budget.date_from {
            return Err("End date must be after start date".to_string());
        }
        budget.date_to = dt;
        changed_fields.push("date_to".to_string());
    }

    if let Some(m) = metadata {
        budget.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "crossovered_budget",
        budget.id,
        "UPDATE",
        Some(old_values.to_string()),
        Some(serde_json::json!({ "name": budget.name }).to_string()),
        changed_fields,
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
    analytic_account_id: Option<u64>,
    date_from: Timestamp,
    date_to: Timestamp,
    planned_amount: f64,
    metadata: Option<String>,
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

    if date_to <= date_from {
        return Err("Line end date must be after start date".to_string());
    }

    // Validate date range is within budget date range
    if date_from < budget.date_from || date_to > budget.date_to {
        return Err("Line dates must be within budget date range".to_string());
    }

    if planned_amount < 0.0 {
        return Err("Planned amount cannot be negative".to_string());
    }

    let line = ctx
        .db
        .crossovered_budget_lines()
        .insert(CrossoveredBudgetLines {
            id: 0,
            general_budget_id: budget_id,
            analytic_account_id,
            date_from,
            date_to,
            paid_date: None,
            planned_amount,
            practical_amount: 0.0,
            theoretical_amount: 0.0,
            achieve_percentage: 0.0,
            company_id,
            is_above_budget: false,
            variance: 0.0,
            variance_percentage: 0.0,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata,
        });

    // Update budget totals
    budget.crossovered_budget_line.push(line.id);
    budget.total_planned += planned_amount;
    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget);

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "crossovered_budget_lines",
        line.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({ "budget_id": budget_id, "planned_amount": planned_amount })
                .to_string(),
        ),
        vec!["budget_id".to_string(), "planned_amount".to_string()],
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
    planned_amount: Option<f64>,
    analytic_account_id: Option<u64>,
    date_from: Option<Timestamp>,
    date_to: Option<Timestamp>,
    metadata: Option<String>,
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

    if let Some(pa) = planned_amount {
        if pa < 0.0 {
            return Err("Planned amount cannot be negative".to_string());
        }
        line.planned_amount = pa;
        changed_fields.push("planned_amount".to_string());
    }

    if analytic_account_id.is_some() {
        line.analytic_account_id = analytic_account_id;
        changed_fields.push("analytic_account_id".to_string());
    }

    if let Some(df) = date_from {
        if let Some(dt) = date_to {
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
        if date_to.is_some() {
            changed_fields.push("date_to".to_string());
        }
    } else if let Some(dt) = date_to {
        if dt <= line.date_from {
            return Err("End date must be after start date".to_string());
        }
        if dt > budget.date_to {
            return Err("Line dates must be within budget date range".to_string());
        }
        line.date_to = dt;
        changed_fields.push("date_to".to_string());
    }

    if let Some(m) = metadata {
        line.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    line.write_uid = Some(ctx.sender());
    line.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget_lines().id().update(line.clone());

    // Update budget totals
    budget.total_planned = budget.total_planned - old_planned + line.planned_amount;
    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget);

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "crossovered_budget_lines",
        line_id,
        "UPDATE",
        Some(serde_json::json!({ "planned_amount": old_planned }).to_string()),
        Some(serde_json::json!({ "planned_amount": line.planned_amount }).to_string()),
        changed_fields,
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
    practical_amount: f64,
    theoretical_amount: f64,
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

    line.practical_amount = practical_amount;
    line.theoretical_amount = theoretical_amount;

    // Calculate variance
    line.variance = practical_amount - line.planned_amount;
    line.variance_percentage = if line.planned_amount > 0.0 {
        (line.variance / line.planned_amount) * 100.0
    } else {
        0.0
    };

    // Calculate achievement percentage
    line.achieve_percentage = if line.planned_amount > 0.0 {
        (practical_amount / line.planned_amount) * 100.0
    } else {
        0.0
    };

    // Check if above budget
    line.is_above_budget = practical_amount > line.planned_amount;

    line.write_uid = Some(ctx.sender());
    line.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget_lines().id().update(line.clone());

    // Update budget totals
    let mut budget = budget;
    budget.total_practical = budget.total_practical - old_practical + practical_amount;
    budget.total_theoretical = budget.total_theoretical;
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
        return Err("Budget must be in Draft state to confirm".to_string());
    }

    if budget.crossovered_budget_line.is_empty() {
        return Err("Budget must have at least one line to confirm".to_string());
    }

    budget.state = BudgetState::Confirm;
    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "crossovered_budget",
        budget_id,
        "CONFIRM",
        Some(serde_json::json!({ "state": "Draft" }).to_string()),
        Some(serde_json::json!({ "state": "Confirm" }).to_string()),
        vec!["state".to_string()],
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

    let mut budget = ctx
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

    budget.state = BudgetState::Validate;
    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "crossovered_budget",
        budget_id,
        "VALIDATE",
        Some(serde_json::json!({ "state": "Confirm" }).to_string()),
        Some(serde_json::json!({ "state": "Validate" }).to_string()),
        vec!["state".to_string()],
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

    let mut budget = ctx
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

    budget.state = BudgetState::Done;
    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "crossovered_budget",
        budget_id,
        "DONE",
        Some(serde_json::json!({ "state": "Validate" }).to_string()),
        Some(serde_json::json!({ "state": "Done" }).to_string()),
        vec!["state".to_string()],
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

    let mut budget = ctx
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

    budget.state = BudgetState::Cancel;
    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "crossovered_budget",
        budget_id,
        "CANCEL",
        None,
        Some(serde_json::json!({ "state": "Cancel" }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

/// Create a budget post
#[spacetimedb::reducer]
pub fn create_budget_post(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: String,
    code: Option<String>,
    description: Option<String>,
    account_ids: Vec<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "budget_post", "create")?;

    if name.is_empty() {
        return Err("Budget post name is required".to_string());
    }

    let post = ctx.db.budget_post().insert(BudgetPost {
        id: 0,
        name: name.clone(),
        code,
        description,
        account_ids,
        company_id,
        is_active: true,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "budget_post",
        post.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "name": name }).to_string()),
        vec!["name".to_string()],
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
    name: Option<String>,
    code: Option<String>,
    description: Option<String>,
    account_ids: Option<Vec<u64>>,
    is_active: Option<bool>,
    metadata: Option<String>,
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

    if let Some(n) = name {
        if n.is_empty() {
            return Err("Budget post name cannot be empty".to_string());
        }
        post.name = n;
        changed_fields.push("name".to_string());
    }

    if code.is_some() {
        post.code = code;
        changed_fields.push("code".to_string());
    }

    if description.is_some() {
        post.description = description;
        changed_fields.push("description".to_string());
    }

    if let Some(accs) = account_ids {
        post.account_ids = accs;
        changed_fields.push("account_ids".to_string());
    }

    if let Some(active) = is_active {
        post.is_active = active;
        changed_fields.push("is_active".to_string());
    }

    if let Some(m) = metadata {
        post.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    post.write_uid = Some(ctx.sender());
    post.write_date = Some(ctx.timestamp);

    ctx.db.budget_post().id().update(post.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "budget_post",
        post_id,
        "UPDATE",
        None,
        Some(serde_json::json!({ "name": post.name }).to_string()),
        changed_fields,
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

    // Update budget totals
    budget.total_planned -= line.planned_amount;
    budget.total_practical -= line.practical_amount;
    budget.total_theoretical -= line.theoretical_amount;
    budget.crossovered_budget_line.retain(|&id| id != line_id);
    budget.write_uid = Some(ctx.sender());
    budget.write_date = Some(ctx.timestamp);

    ctx.db.crossovered_budget().id().update(budget);
    ctx.db.crossovered_budget_lines().id().delete(&line_id);

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "crossovered_budget_lines",
        line_id,
        "DELETE",
        Some(serde_json::json!({ "planned_amount": line.planned_amount }).to_string()),
        None,
        vec!["id".to_string()],
    );

    Ok(())
}
