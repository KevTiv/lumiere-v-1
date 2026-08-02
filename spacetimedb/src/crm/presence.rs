/// Opportunity Presence — real-time collaborative presence for CRM opportunity workspaces.
///
/// Mirrors `ProposalPresence` (`crate::proposals::proposals`): tracks which users are
/// currently viewing/editing a given opportunity so clients can render avatars/cursors.
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::crm::opportunities::opportunity;

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
/// No dedicated permission check beyond organization membership (matches
/// `update_proposal_presence`) — presence is a low-risk, ephemeral signal.
#[reducer]
pub fn update_opportunity_presence(
    ctx: &ReducerContext,
    organization_id: u64,
    opportunity_id: u64,
    user_name: String,
) -> Result<(), String> {
    let opp = ctx
        .db
        .opportunity()
        .id()
        .find(&opportunity_id)
        .ok_or_else(|| format!("Opportunity {} not found", opportunity_id))?;

    if opp.organization_id != organization_id {
        return Err("Opportunity does not belong to this organization".to_string());
    }
    let company_id = opp.company_id.ok_or("Opportunity has no company scope")?;

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
