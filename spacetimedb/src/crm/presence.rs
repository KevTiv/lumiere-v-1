/// Opportunity Presence — real-time collaborative presence for CRM opportunity workspaces.
///
/// Mirrors `ProposalPresence` (`crate::proposals::proposals`): tracks which users are
/// currently viewing/editing a given opportunity so clients can render avatars/cursors.
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::core::users::user_profile;
use crate::crm::opportunities::opportunity;
use crate::crm::require_single_company_crm_scope;
use crate::helpers::check_permission;

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = opportunity_presence,
    index(accessor = opp_presence_by_opportunity, btree(columns = [opportunity_id])),
    index(accessor = opp_presence_by_user, btree(columns = [user_id]))
)]
pub struct OpportunityPresence {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
    pub company_id: u64,
    pub opportunity_id: u64,
    pub user_id: Identity,
    pub user_name: String,
    pub last_seen: Timestamp,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Update (upsert) the caller's presence in an opportunity workspace.
///
/// Verifies caller is an active member of the organization and passes the CRM company scope
/// check for the opportunity. Display name is derived server-side from the authenticated
/// user's profile — presence is a low-risk, ephemeral signal.
#[reducer]
pub fn update_opportunity_presence(
    ctx: &ReducerContext,
    organization_id: u64,
    opportunity_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "opportunity", "read")?;

    let user = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("user not found")?;

    let opp = ctx
        .db
        .opportunity()
        .id()
        .find(&opportunity_id)
        .ok_or("opportunity not found")?;

    if opp.organization_id != organization_id {
        return Err("opportunity does not belong to this organization".to_string());
    }

    let company_id = opp.company_id.ok_or("opportunity has no company scope")?;
    require_single_company_crm_scope(ctx, organization_id, Some(company_id))?;

    let user_name = user.name.clone();

    let existing = ctx
        .db
        .opportunity_presence()
        .opp_presence_by_user()
        .filter(&ctx.sender())
        .find(|p| p.opportunity_id == opportunity_id);

    if let Some(row) = existing {
        ctx.db
            .opportunity_presence()
            .id()
            .update(OpportunityPresence {
                user_name,
                last_seen: ctx.timestamp,
                ..row
            });
    } else {
        ctx.db.opportunity_presence().insert(OpportunityPresence {
            id: 0,
            organization_id,
            company_id,
            opportunity_id,
            user_id: ctx.sender(),
            user_name,
            last_seen: ctx.timestamp,
        });
    }

    Ok(())
}

/// Remove the caller's presence from an opportunity workspace.
#[reducer]
pub fn clear_opportunity_presence(ctx: &ReducerContext, opportunity_id: u64) -> Result<(), String> {
    let ids: Vec<u64> = ctx
        .db
        .opportunity_presence()
        .opp_presence_by_user()
        .filter(&ctx.sender())
        .filter(|p| p.opportunity_id == opportunity_id)
        .map(|p| p.id)
        .collect();

    for id in ids {
        ctx.db.opportunity_presence().id().delete(&id);
    }

    Ok(())
}
