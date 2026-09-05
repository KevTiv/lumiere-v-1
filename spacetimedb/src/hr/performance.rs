/// HR Performance — review cycles, goals, and employee reviews (MVP stub).
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::relations::require_employee_in_scope;

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = hr_performance_cycle,
    public,
    index(accessor = perf_cycle_by_org, btree(columns = [organization_id])),
    index(accessor = perf_cycle_by_company, btree(columns = [company_id]))
)]
pub struct HrPerformanceCycle {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub start_date: Timestamp,
    pub end_date: Timestamp,
    /// draft | active | closed
    pub state: String,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[spacetimedb::table(
    accessor = hr_performance_goal,
    public,
    index(accessor = perf_goal_by_cycle, btree(columns = [cycle_id])),
    index(accessor = perf_goal_by_employee, btree(columns = [employee_id])),
    index(accessor = perf_goal_by_org, btree(columns = [organization_id]))
)]
pub struct HrPerformanceGoal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub cycle_id: u64,
    pub employee_id: u64,
    pub title: String,
    pub description: Option<String>,
    pub target_value: Option<f64>,
    pub weight: f64,
    /// draft | in_progress | achieved | cancelled
    pub state: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[spacetimedb::table(
    accessor = hr_performance_review,
    public,
    index(accessor = perf_review_by_cycle, btree(columns = [cycle_id])),
    index(accessor = perf_review_by_employee, btree(columns = [employee_id])),
    index(accessor = perf_review_by_org, btree(columns = [organization_id]))
)]
pub struct HrPerformanceReview {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub cycle_id: u64,
    pub employee_id: u64,
    pub reviewer_employee_id: Option<u64>,
    /// draft | submitted | completed
    pub state: String,
    pub self_rating: Option<f64>,
    pub manager_rating: Option<f64>,
    pub summary: Option<String>,
    pub submitted_at: Option<Timestamp>,
    pub completed_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePerformanceCycleParams {
    pub name: String,
    pub description: Option<String>,
    pub start_date: Timestamp,
    pub end_date: Timestamp,
    pub state: String,
    pub active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AddPerformanceGoalParams {
    pub employee_id: u64,
    pub title: String,
    pub description: Option<String>,
    pub target_value: Option<f64>,
    pub weight: f64,
    pub state: String,
    pub reviewer_employee_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SubmitPerformanceReviewParams {
    pub self_rating: f64,
    pub summary: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CompletePerformanceReviewParams {
    pub manager_rating: f64,
    pub summary: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn find_review_for_employee_cycle(
    ctx: &ReducerContext,
    cycle_id: u64,
    employee_id: u64,
) -> Option<HrPerformanceReview> {
    ctx.db
        .hr_performance_review()
        .perf_review_by_cycle()
        .filter(&cycle_id)
        .find(|row| row.employee_id == employee_id)
}

fn ensure_review_for_goal(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    cycle_id: u64,
    employee_id: u64,
    reviewer_employee_id: Option<u64>,
) -> Result<HrPerformanceReview, String> {
    if let Some(existing) = find_review_for_employee_cycle(ctx, cycle_id, employee_id) {
        return Ok(existing);
    }

    Ok(ctx.db.hr_performance_review().insert(HrPerformanceReview {
        id: 0,
        organization_id,
        company_id,
        cycle_id,
        employee_id,
        reviewer_employee_id,
        state: "draft".to_string(),
        self_rating: None,
        manager_rating: None,
        summary: None,
        submitted_at: None,
        completed_at: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    }))
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_performance_cycle(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePerformanceCycleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "create")?;
    if params.name.trim().is_empty() {
        return Err("Cycle name cannot be empty".to_string());
    }
    if params.end_date < params.start_date {
        return Err("end_date must be on or after start_date".to_string());
    }
    let state = params.state.trim();
    if !matches!(state, "draft" | "active" | "closed") {
        return Err("Cycle state must be draft, active, or closed".to_string());
    }

    let row = ctx.db.hr_performance_cycle().insert(HrPerformanceCycle {
        id: 0,
        organization_id,
        company_id,
        name: params.name.trim().to_string(),
        description: params.description,
        start_date: params.start_date,
        end_date: params.end_date,
        state: state.to_string(),
        active: params.active,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_performance_cycle",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": row.name,
                    "state": row.state,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn add_performance_goal(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    cycle_id: u64,
    params: AddPerformanceGoalParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "create")?;
    require_employee_in_scope(ctx, organization_id, company_id, params.employee_id)?;

    let cycle = ctx
        .db
        .hr_performance_cycle()
        .id()
        .find(&cycle_id)
        .ok_or("Performance cycle not found")?;
    if cycle.organization_id != organization_id {
        return Err("Cycle belongs to a different organization".to_string());
    }
    if cycle.company_id != company_id {
        return Err("Cycle does not belong to this company".to_string());
    }
    if cycle.state == "closed" {
        return Err("Cannot add goals to a closed cycle".to_string());
    }
    if params.title.trim().is_empty() {
        return Err("Goal title cannot be empty".to_string());
    }
    let goal_state = params.state.trim();
    if !matches!(
        goal_state,
        "draft" | "in_progress" | "achieved" | "cancelled"
    ) {
        return Err("Goal state must be draft, in_progress, achieved, or cancelled".to_string());
    }
    if params.weight < 0.0 {
        return Err("Goal weight cannot be negative".to_string());
    }

    if let Some(reviewer_id) = params.reviewer_employee_id {
        require_employee_in_scope(ctx, organization_id, company_id, reviewer_id)?;
    }

    let _review = ensure_review_for_goal(
        ctx,
        organization_id,
        company_id,
        cycle_id,
        params.employee_id,
        params.reviewer_employee_id,
    )?;

    let goal = ctx.db.hr_performance_goal().insert(HrPerformanceGoal {
        id: 0,
        organization_id,
        company_id,
        cycle_id,
        employee_id: params.employee_id,
        title: params.title.trim().to_string(),
        description: params.description,
        target_value: params.target_value,
        weight: params.weight,
        state: goal_state.to_string(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_performance_goal",
            record_id: goal.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "cycle_id": cycle_id,
                    "employee_id": params.employee_id,
                    "title": goal.title,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "cycle_id".to_string(),
                "employee_id".to_string(),
                "title".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn submit_performance_review(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    review_id: u64,
    params: SubmitPerformanceReviewParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;
    if !(0.0..=5.0).contains(&params.self_rating) {
        return Err("self_rating must be between 0 and 5".to_string());
    }

    let review = ctx
        .db
        .hr_performance_review()
        .id()
        .find(&review_id)
        .ok_or("Performance review not found")?;
    if review.organization_id != organization_id {
        return Err("Review belongs to a different organization".to_string());
    }
    if review.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if review.state != "draft" {
        return Err("Only draft reviews can be submitted".to_string());
    }

    let cycle = ctx
        .db
        .hr_performance_cycle()
        .id()
        .find(&review.cycle_id)
        .ok_or("Performance cycle not found")?;
    if cycle.state == "closed" {
        return Err("Cannot submit review for a closed cycle".to_string());
    }

    ctx.db
        .hr_performance_review()
        .id()
        .update(HrPerformanceReview {
            state: "submitted".to_string(),
            self_rating: Some(params.self_rating),
            summary: params.summary,
            submitted_at: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..review
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_performance_review",
            record_id: review_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "draft" }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": "submitted",
                    "self_rating": params.self_rating,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "state".to_string(),
                "self_rating".to_string(),
                "submitted_at".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn complete_performance_review(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    review_id: u64,
    params: CompletePerformanceReviewParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;
    if !(0.0..=5.0).contains(&params.manager_rating) {
        return Err("manager_rating must be between 0 and 5".to_string());
    }

    let review = ctx
        .db
        .hr_performance_review()
        .id()
        .find(&review_id)
        .ok_or("Performance review not found")?;
    if review.organization_id != organization_id {
        return Err("Review belongs to a different organization".to_string());
    }
    if review.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if review.state != "submitted" {
        return Err("Only submitted reviews can be completed".to_string());
    }

    ctx.db
        .hr_performance_review()
        .id()
        .update(HrPerformanceReview {
            state: "completed".to_string(),
            manager_rating: Some(params.manager_rating),
            summary: params.summary.or(review.summary),
            completed_at: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..review
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_performance_review",
            record_id: review_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "submitted" }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": "completed",
                    "manager_rating": params.manager_rating,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "state".to_string(),
                "manager_rating".to_string(),
                "completed_at".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}
