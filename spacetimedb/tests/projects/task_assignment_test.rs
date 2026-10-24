//! Assignment recipient validation is exercised through the existing project test reducer.
use spacetimedb::rand::Rng;
use spacetimedb::{Identity, ReducerContext, Table};

use crate::core::users::{
    ensure_user_profile_for_organization, find_user_profile_for_organization, user_organization,
    user_profile, UserOrganization,
};
use crate::projects::tasks::{
    assign_task_users, create_task, project_task, update_task, UpdateTaskParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

use super::wave_c_test::{sample_task, seed_project};

fn seed_recipient(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    company_id: Option<u64>,
    membership_active: bool,
    profile_active: bool,
) -> Result<Identity, String> {
    let identity = Identity::from_byte_array(ctx.rng().gen::<[u8; 32]>());
    let role_id = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|membership| membership.organization_id == fixture.organization_id)
        .ok_or("fixture membership missing")?
        .role_id;
    ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity: identity,
        organization_id: fixture.organization_id,
        company_id,
        role_id,
        department_id: None,
        job_title: None,
        employee_id: None,
        date_joined: ctx.timestamp,
        is_active: membership_active,
        is_default: false,
        metadata: None,
    });
    ensure_user_profile_for_organization(ctx, identity, fixture.organization_id);
    if !profile_active {
        let mut profile =
            find_user_profile_for_organization(ctx, identity, fixture.organization_id)
                .ok_or("recipient profile missing")?;
        profile.is_active = false;
        ctx.db.user_profile().id().update(profile);
    }
    Ok(identity)
}

pub fn test_task_assignment_scope(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let project = seed_project(ctx, &fixture, "Assignment scope")?;
    let ada = seed_recipient(ctx, &fixture, Some(fixture.company_id), true, true)?;
    let org_wide = seed_recipient(ctx, &fixture, None, true, true)?;
    let inactive_membership = seed_recipient(ctx, &fixture, Some(fixture.company_id), false, true)?;
    let inactive_profile = seed_recipient(ctx, &fixture, Some(fixture.company_id), true, false)?;
    let wrong_company = seed_recipient(ctx, &fixture, Some(foreign.company_id), true, true)?;
    let wrong_org = seed_recipient(ctx, &foreign, Some(foreign.company_id), true, true)?;
    let missing = Identity::from_byte_array(ctx.rng().gen::<[u8; 32]>());
    let mut params = sample_task(
        fixture.company_id,
        project,
        "Assigned task",
        None,
        "assignment",
    );
    params.user_ids = vec![ada];
    create_task(ctx, fixture.organization_id, params)?;
    let id = ctx
        .db
        .project_task()
        .iter()
        .find(|task| {
            task.organization_id == fixture.organization_id && task.name == "Assigned task"
        })
        .ok_or("assigned task missing")?
        .id;

    for rejected in [
        vec![inactive_membership],
        vec![inactive_profile],
        vec![wrong_company],
        vec![wrong_org],
        vec![missing],
        vec![ada, ada],
    ] {
        if assign_task_users(ctx, fixture.organization_id, id, rejected.clone()).is_ok() {
            return Err("invalid assignee accepted by assignment command".into());
        }
        if update_task(
            ctx,
            fixture.organization_id,
            id,
            assignment_update(fixture.company_id, rejected.clone()),
        )
        .is_ok()
        {
            return Err("invalid assignee accepted by task update".into());
        }
        let mut invalid = sample_task(
            fixture.company_id,
            project,
            "Must not be created",
            None,
            "invalid",
        );
        invalid.user_ids = rejected;
        if create_task(ctx, fixture.organization_id, invalid).is_ok() {
            return Err("invalid assignee accepted by task create".into());
        }
        if ctx
            .db
            .project_task()
            .id()
            .find(&id)
            .ok_or("task missing")?
            .user_ids
            != vec![ada]
        {
            return Err("rejected assignment changed the task".into());
        }
    }
    assign_task_users(ctx, fixture.organization_id, id, vec![ada, org_wide])?;
    let saved = ctx.db.project_task().id().find(&id).ok_or("task missing")?;
    if saved.user_ids != vec![ada, org_wide] || saved.date_assign.is_none() {
        return Err("eligible assignment was not persisted".into());
    }
    assign_task_users(ctx, fixture.organization_id, id, vec![])?;
    let cleared = ctx.db.project_task().id().find(&id).ok_or("task missing")?;
    if !cleared.user_ids.is_empty() || cleared.date_assign.is_some() {
        return Err("intentional clear did not remove the assignment".into());
    }

    // A project-task role grant does not grant the actor access to another company.
    let original_membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|membership| membership.organization_id == fixture.organization_id)
        .ok_or("actor membership missing")?;
    let mut restricted_membership = original_membership.clone();
    restricted_membership.company_id = Some(foreign.company_id);
    ctx.db
        .user_organization()
        .id()
        .update(restricted_membership);
    let mut profile =
        find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
            .ok_or("actor profile missing")?;
    let was_superuser = profile.is_superuser;
    profile.is_superuser = false;
    ctx.db.user_profile().id().update(profile);
    let assigned = assign_task_users(ctx, fixture.organization_id, id, vec![ada]);
    let updated = update_task(
        ctx,
        fixture.organization_id,
        id,
        assignment_update(fixture.company_id, vec![ada]),
    );
    let created = create_task(
        ctx,
        fixture.organization_id,
        sample_task(fixture.company_id, project, "Denied actor", None, "denied"),
    );
    ctx.db.user_organization().id().update(original_membership);
    let mut profile =
        find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
            .ok_or("actor profile missing after access test")?;
    profile.is_superuser = was_superuser;
    ctx.db.user_profile().id().update(profile);
    if assigned.is_ok() || updated.is_ok() || created.is_ok() {
        return Err("actor could mutate a task outside their company membership".into());
    }
    Ok(())
}

fn assignment_update(company_id: u64, user_ids: Vec<Identity>) -> UpdateTaskParams {
    UpdateTaskParams {
        company_id: Some(company_id),
        user_ids: Some(user_ids),
        name: None,
        description: None,
        priority: None,
        sequence: None,
        stage_id: None,
        state: None,
        kanban_state: None,
        date_assign: None,
        date_deadline: None,
        date_start: None,
        date_end: None,
        color: None,
        project_id: None,
        milestone_id: None,
        wbs_code: None,
        wbs_level: None,
        planned_hours: None,
        total_hours_spent: None,
        effective_hours: None,
        progress: None,
        sale_order_id: None,
        sale_line_id: None,
        partner_id: None,
        partner_email: None,
        child_ids: None,
        subtask_count: None,
        closed_subtask_count: None,
        is_closed: None,
        is_blocked: None,
        allow_task_dependencies: None,
        depend_on_ids: None,
        dependent_ids: None,
        is_private: None,
        permitted_user_ids: None,
        activity_ids: None,
        activity_state: None,
        activity_date_deadline: None,
        activity_type_id: None,
        activity_user_id: None,
        activity_summary: None,
        message_follower_ids: None,
        message_ids: None,
        metadata: None,
    }
}
