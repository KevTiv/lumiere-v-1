/// Cold-tier trusted service identity registry.
///
/// SpacetimeDB's `ReducerContext` has no "is this the module owner" check —
/// `ctx.sender()` is just an `Identity`, indistinguishable at the type level
/// from any other authenticated caller (see `AuthCtx` in the SDK: it only
/// exposes `is_internal()` for scheduled reducers, nothing about ownership).
/// Reducers that must only ever be called by a trusted internal service
/// (the audit-log cold drainer today; future cold-tier finalize reducers
/// later) therefore need their own registered-identity check, the same
/// pattern `ai/skill_registry.rs` uses for the AI certification executor.
///
/// This is deliberately simpler than that AI-skill pattern: there's one
/// shared server-token identity for every api-server worker in this
/// codebase (see `AppState::new` / `STDB_SERVER_TOKEN`), not a per-organization
/// executor needing hash-pinned rotation — so one active identity per
/// `service_name`, globally, is enough.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::core::users::user_profile;

/// `service_name` used by the audit-log cold drainer (`api-server/src/cold_tier/audit_drainer.rs`).
pub(crate) const AUDIT_COLD_DRAINER_SERVICE: &str = "audit_cold_drainer";

#[derive(Clone)]
#[spacetimedb::table(
    accessor = cold_tier_service_identity,
    public,
    index(
        accessor = cold_tier_service_identity_by_name,
        btree(columns = [service_name])
    )
)]
pub struct ColdTierServiceIdentity {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub service_name: String,
    pub identity: Identity,
    pub is_active: bool,
    pub registered_by: Identity,
    pub registered_at: Timestamp,
    pub retired_at: Option<Timestamp>,
}

/// Register (or replace) the trusted identity for a cold-tier service, e.g.
/// `"audit_cold_drainer"`. Retires any prior active identity for that same
/// `service_name` — only one is active at a time.
///
/// Not callable through the public API (see `reducer_allowlist.rs`) — this
/// is a one-time-per-deploy ops action, run the same way
/// `register_ai_skill_certification_runtime_profile` is: directly against
/// SpacetimeDB with the owner token, not from the app.
#[spacetimedb::reducer]
pub fn register_cold_tier_service_identity(
    ctx: &ReducerContext,
    service_name: String,
    identity: Identity,
) -> Result<(), String> {
    require_superuser(ctx)?;

    let service_name = service_name.trim().to_string();
    if service_name.is_empty() {
        return Err("service_name is required".to_string());
    }
    if identity == ctx.sender() {
        return Err(
            "cold-tier service identity must be distinct from the registering administrator"
                .to_string(),
        );
    }

    let active: Vec<_> = ctx
        .db
        .cold_tier_service_identity()
        .cold_tier_service_identity_by_name()
        .filter(&service_name)
        .filter(|row| row.is_active)
        .collect();
    for row in active {
        ctx.db
            .cold_tier_service_identity()
            .id()
            .update(ColdTierServiceIdentity {
                is_active: false,
                retired_at: Some(ctx.timestamp),
                ..row
            });
    }

    ctx.db
        .cold_tier_service_identity()
        .insert(ColdTierServiceIdentity {
            id: 0,
            service_name,
            identity,
            is_active: true,
            registered_by: ctx.sender(),
            registered_at: ctx.timestamp,
            retired_at: None,
        });

    Ok(())
}

/// True if `ctx.sender()` is the currently-active registered identity for
/// `service_name`. Cold-tier finalize reducers must check this before
/// trusting any caller-supplied checksum/version — the checksum only
/// authenticates *which row*, never *who is allowed to delete it*.
pub(crate) fn is_active_cold_tier_service_identity(
    ctx: &ReducerContext,
    service_name: &str,
) -> bool {
    ctx.db
        .cold_tier_service_identity()
        .cold_tier_service_identity_by_name()
        .filter(&service_name.to_string())
        .any(|row| row.is_active && row.identity == ctx.sender())
}

fn require_superuser(ctx: &ReducerContext) -> Result<(), String> {
    let user = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("User not found")?;
    if !user.is_active || !user.is_superuser {
        return Err(
            "only an active platform superuser may register cold-tier service identities"
                .to_string(),
        );
    }
    Ok(())
}
