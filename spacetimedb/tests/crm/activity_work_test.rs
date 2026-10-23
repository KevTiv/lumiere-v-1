//! Record follow-ups retain their source authorization and never advance its lifecycle.
use crate::accounting::journal_entries::account_move;
use crate::accounting_tests::helpers::create_balanced_customer_invoice;
use crate::core::permissions::role;
use crate::core::users::{find_user_profile_for_organization, user_organization, user_profile};
use crate::crm::activities::{
    activity, activity_type, complete_activity, create_activity, ActivityType,
    CreateActivityParams, CrmActivityTarget,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use spacetimedb::rand::Rng;
use spacetimedb::{Identity, ReducerContext, Table};

pub fn test_finance_activity_authorization(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let invoice_id = create_balanced_customer_invoice(ctx, &fixture, 10.0, false)?;
    let activity_type = ctx.db.activity_type().insert(ActivityType {
        id: 0,
        organization_id: fixture.organization_id,
        name: "Follow-up test".into(),
        category: "default".into(),
        summary: None,
        sequence: 1,
        delay_count: None,
        delay_unit: None,
        delay_from: None,
        icon: None,
        chaining_type: "none".into(),
        suggested_next_type_id: None,
        triggered_next_type_id: None,
        is_active: true,
        metadata: None,
    });
    let params = CreateActivityParams {
        activity_type_id: activity_type.id,
        summary: "Follow up invoice".into(),
        priority: "normal".into(),
        state: "planned".into(),
        auto: false,
        is_system: false,
        is_done: false,
        note: None,
        date_deadline: Some(ctx.timestamp),
        date_done: None,
        assigned_to: Some(ctx.sender()),
        target: Some(CrmActivityTarget::AccountMove(invoice_id)),
        duration: None,
        location: None,
        video_url: None,
        metadata: None,
    };
    let mut invalid = params.clone();
    invalid.assigned_to = Some(Identity::from_byte_array(ctx.rng().gen::<[u8; 32]>()));
    if create_activity(ctx, fixture.organization_id, invalid).is_ok() {
        return Err("unknown follow-up recipient accepted".into());
    }
    let mut done = params.clone();
    done.is_done = true;
    if create_activity(ctx, fixture.organization_id, done).is_ok() {
        return Err("finance follow-up created already complete".into());
    }
    create_activity(ctx, fixture.organization_id, params.clone())?;
    let activity_id = ctx
        .db
        .activity()
        .activity_by_org()
        .filter(&fixture.organization_id)
        .find(|row| row.summary == params.summary)
        .ok_or("follow-up missing")?
        .id;
    let source_before = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("source missing")?;

    let original_membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|member| member.organization_id == fixture.organization_id)
        .ok_or("actor membership missing")?;
    let original_role = ctx
        .db
        .role()
        .id()
        .find(&original_membership.role_id)
        .ok_or("actor role missing")?;
    let mut profile =
        find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
            .ok_or("profile missing")?;
    let was_superuser = profile.is_superuser;
    profile.is_superuser = false;
    ctx.db.user_profile().id().update(profile);
    let mut restricted_role = original_role.clone();
    restricted_role.permissions = vec![
        "activity:read".into(),
        "activity:create".into(),
        "activity:write".into(),
    ];
    ctx.db.role().id().update(restricted_role);
    let denied_source_create = create_activity(ctx, fixture.organization_id, params.clone());
    let denied_source_complete = complete_activity(ctx, fixture.organization_id, activity_id);
    ctx.db.role().id().update(original_role);
    let mut restricted_membership = original_membership.clone();
    restricted_membership.company_id = Some(foreign.company_id);
    ctx.db
        .user_organization()
        .id()
        .update(restricted_membership);
    let denied_company_create = create_activity(ctx, fixture.organization_id, params.clone());
    let denied_company_complete = complete_activity(ctx, fixture.organization_id, activity_id);
    ctx.db.user_organization().id().update(original_membership);
    let mut profile =
        find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
            .ok_or("profile missing after tests")?;
    profile.is_superuser = was_superuser;
    ctx.db.user_profile().id().update(profile);
    if denied_source_create.is_ok()
        || denied_source_complete.is_ok()
        || denied_company_create.is_ok()
        || denied_company_complete.is_ok()
    {
        return Err(
            "follow-up operation bypassed current source permission or actor company".into(),
        );
    }
    let mut deleted = ctx
        .db
        .activity()
        .id()
        .find(&activity_id)
        .ok_or("follow-up missing")?;
    deleted.deleted_at = Some(ctx.timestamp);
    ctx.db.activity().id().update(deleted);
    if complete_activity(ctx, fixture.organization_id, activity_id).is_ok() {
        return Err("deleted follow-up completed".into());
    }
    let mut restored = ctx
        .db
        .activity()
        .id()
        .find(&activity_id)
        .ok_or("follow-up missing")?;
    restored.deleted_at = None;
    ctx.db.activity().id().update(restored);
    complete_activity(ctx, fixture.organization_id, activity_id)?;
    let saved = ctx
        .db
        .activity()
        .id()
        .find(&activity_id)
        .ok_or("follow-up missing")?;
    if !saved.is_done || saved.state != "done" || saved.date_done.is_none() {
        return Err("completion did not persist canonical activity state".into());
    }
    let source_after = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("source missing after completion")?;
    if source_before.state != source_after.state
        || source_before.amount_total != source_after.amount_total
    {
        return Err("follow-up completion changed the invoice lifecycle".into());
    }
    Ok(())
}
