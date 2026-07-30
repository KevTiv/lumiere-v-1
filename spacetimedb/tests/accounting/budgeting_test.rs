//! ACC-RI-009 — budget-line actuals are server-derived.

use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::budgeting::{
    confirm_budget, create_budget_line, create_crossovered_budget, crossovered_budget,
    crossovered_budget_lines, update_budget_line_actuals, CreateCrossoveredBudgetLineParams,
    CreateCrossoveredBudgetParams, UpdateBudgetLineActualsParams,
};
use crate::test_harness::{chart_keys, OrgFixture};

fn require_close(label: &str, actual: f64, expected: f64) -> Result<(), String> {
    if (actual - expected).abs() > f64::EPSILON {
        return Err(format!("{label}: expected {expected}, got {actual}"));
    }
    Ok(())
}

/// Creating a line persists zero actuals; the confirmed-budget recompute owns them thereafter.
pub fn test_budget_line_actuals_are_server_derived_and_recomputed_on_confirm(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let revenue_account_id = fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .copied()
        .ok_or("harness missing REVENUE")?;
    let budget_name = format!("ACC-RI-009 budget {}", fixture.company_id);
    let date_from = ctx.timestamp - Duration::from_secs(30 * 86400);
    let date_to = ctx.timestamp + Duration::from_secs(30 * 86400);

    create_crossovered_budget(
        ctx,
        fixture.organization_id,
        CreateCrossoveredBudgetParams {
            company_id: Some(fixture.company_id),
            name: budget_name.clone(),
            description: None,
            date_from,
            date_to,
            metadata: Some(r#"{"test":"acc_ri_009"}"#.to_string()),
        },
    )?;
    let budget_id = ctx
        .db
        .crossovered_budget()
        .iter()
        .find(|budget| {
            budget.organization_id == fixture.organization_id
                && budget.company_id == fixture.company_id
                && budget.name == budget_name
        })
        .map(|budget| budget.id)
        .ok_or("ACC-RI-009 budget missing after create")?;

    create_budget_line(
        ctx,
        fixture.organization_id,
        budget_id,
        // Compile-time regression guard: this literal uses every surviving create field.
        // If caller-owned actuals return as required fields, this construction stops compiling.
        CreateCrossoveredBudgetLineParams {
            analytic_account_id: None,
            project_id: None,
            date_from,
            date_to,
            paid_date: None,
            planned_amount: 200.0,
            metadata: Some(format!(
                r#"{{"test":"acc_ri_009","revenue_account_id":{revenue_account_id}}}"#
            )),
        },
    )?;

    let created_budget = ctx
        .db
        .crossovered_budget()
        .id()
        .find(&budget_id)
        .ok_or("ACC-RI-009 budget missing after line create")?;
    let line_id = created_budget
        .crossovered_budget_line
        .first()
        .copied()
        .ok_or("ACC-RI-009 budget line id was not linked to its parent")?;
    let created_line = ctx
        .db
        .crossovered_budget_lines()
        .id()
        .find(&line_id)
        .ok_or("ACC-RI-009 budget line missing after persisted reload")?;

    require_close(
        "created practical_amount",
        created_line.practical_amount,
        0.0,
    )?;
    require_close(
        "created theoretical_amount",
        created_line.theoretical_amount,
        0.0,
    )?;
    require_close(
        "created achieve_percentage",
        created_line.achieve_percentage,
        0.0,
    )?;
    if created_line.is_above_budget {
        return Err("created is_above_budget must be false".to_string());
    }
    require_close("created variance", created_line.variance, 0.0)?;
    require_close(
        "created variance_percentage",
        created_line.variance_percentage,
        0.0,
    )?;
    if created_line.variance == -created_line.planned_amount {
        return Err("created variance used the former client default".to_string());
    }

    confirm_budget(ctx, fixture.organization_id, budget_id)?;
    update_budget_line_actuals(
        ctx,
        fixture.organization_id,
        line_id,
        UpdateBudgetLineActualsParams {
            practical_amount: 250.0,
            theoretical_amount: 180.0,
        },
    )?;

    let recomputed_line = ctx
        .db
        .crossovered_budget_lines()
        .id()
        .find(&line_id)
        .ok_or("ACC-RI-009 budget line missing after actuals recompute")?;
    require_close(
        "recomputed practical_amount",
        recomputed_line.practical_amount,
        250.0,
    )?;
    require_close(
        "recomputed theoretical_amount",
        recomputed_line.theoretical_amount,
        180.0,
    )?;
    require_close("recomputed variance", recomputed_line.variance, 50.0)?;
    require_close(
        "recomputed variance_percentage",
        recomputed_line.variance_percentage,
        25.0,
    )?;
    require_close(
        "recomputed achieve_percentage",
        recomputed_line.achieve_percentage,
        125.0,
    )?;
    if !recomputed_line.is_above_budget {
        return Err("recomputed is_above_budget must be true".to_string());
    }

    let recomputed_budget = ctx
        .db
        .crossovered_budget()
        .id()
        .find(&budget_id)
        .ok_or("ACC-RI-009 parent budget missing after actuals recompute")?;
    require_close(
        "recomputed budget total_practical",
        recomputed_budget.total_practical,
        250.0,
    )?;
    require_close(
        "recomputed budget variance_percentage",
        recomputed_budget.variance_percentage,
        25.0,
    )
}
