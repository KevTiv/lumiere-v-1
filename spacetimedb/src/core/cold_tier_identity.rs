/// Cold-tier trusted service identity registry.
///
/// SpacetimeDB's `ReducerContext` has no "is this the module owner" check —
/// `ctx.sender()` is just an `Identity`, indistinguishable at the type level
/// from any other authenticated caller (see `AuthCtx` in the SDK: it only
/// exposes `is_internal()` for scheduled reducers, nothing about ownership).
/// Reducers that must only ever be called by a trusted internal service
/// (the C5 cooling/finalization services) therefore need their own
/// registered-identity check, the same
/// pattern `ai/skill_registry.rs` uses for the AI certification executor.
///
/// The platform control plane owns the authoritative service registration.
/// This table is only the organization-owned application binding/projection
/// of that registration. `identity` and `platform_id` are opaque platform
/// identifiers, not ERP-generated tenant or user identifiers.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::core::organization::organization;
use crate::core::users::find_user_profile_for_identity;

/// Reserved service name for the manifest-driven projection/finalization worker.
pub(crate) const PROJECTION_WORKER_SERVICE: &str = "projection_worker";

/// `service_name` used by the API-server's trusted POS aggregate hydrator.
pub(crate) const POS_ORDER_HYDRATOR_SERVICE: &str = "pos_order_hydrator";

/// `service_name` used by the trusted per-organization reconstruction command.
pub(crate) const ORGANIZATION_RECONSTRUCTOR_SERVICE: &str = "organization_reconstructor";

#[derive(Clone)]
#[spacetimedb::table(
    accessor = cold_tier_service_identity,
    public,
    index(
        accessor = cold_tier_service_identity_by_name,
        btree(columns = [organization_id, service_name])
    ),
    index(
        accessor = cold_tier_service_identity_by_organization,
        btree(columns = [organization_id])
    ),
    index(
        accessor = cold_tier_service_identity_by_platform_identity,
        btree(columns = [organization_id, identity])
    )
)]
pub struct ColdTierServiceIdentity {
    #[primary_key]
    /// Opaque platform-control binding identifier.
    pub platform_id: String,
    /// Direct, non-null tenant ownership for this application projection.
    pub organization_id: u64,
    pub service_name: String,
    pub identity: Identity,
    pub is_active: bool,
    pub registered_by: Identity,
    pub registered_at: Timestamp,
    pub retired_at: Option<Timestamp>,
}

/// Register (or replace) the organization binding for a cold-tier service,
/// e.g. `"projection_worker"`. Retires any prior active identity for that
/// `(organization_id, service_name)` — only one is active per organization.
///
/// Not callable through the public API (see `reducer_allowlist.rs`) — this
/// is a one-time-per-deploy ops action, run the same way
/// `register_ai_skill_certification_runtime_profile` is: directly against
/// SpacetimeDB with the owner token, not from the app.
#[spacetimedb::reducer]
pub fn register_cold_tier_service_identity(
    ctx: &ReducerContext,
    organization_id: u64,
    platform_id: String,
    service_name: String,
    identity: Identity,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization_id must be non-zero".to_string());
    }
    let platform_id = validate_platform_id(&platform_id)?;
    let service_name = service_name.trim().to_string();
    if service_name.is_empty() {
        return Err("service_name is required".to_string());
    }

    if let Some(organization) = ctx.db.organization().id().find(&organization_id) {
        require_superuser(ctx)?;
        if organization.id == 0 || organization.organization_id != organization.id {
            return Err("Organization has invalid server-owned identity".to_string());
        }
        if identity == ctx.sender() {
            return Err(
                "cold-tier service identity must be distinct from the registering administrator"
                    .to_string(),
            );
        }
    } else {
        require_empty_target_reconstruction_bootstrap(ctx, &service_name, identity)?;
    }

    let active: Vec<_> = ctx
        .db
        .cold_tier_service_identity()
        .cold_tier_service_identity_by_name()
        .filter((&organization_id, &service_name))
        .filter(|row| row.is_active)
        .collect();
    for row in active {
        ctx.db
            .cold_tier_service_identity()
            .platform_id()
            .update(ColdTierServiceIdentity {
                is_active: false,
                retired_at: Some(ctx.timestamp),
                ..row
            });
    }

    ctx.db
        .cold_tier_service_identity()
        .insert(ColdTierServiceIdentity {
            platform_id,
            organization_id,
            service_name,
            identity,
            is_active: true,
            registered_by: ctx.sender(),
            registered_at: ctx.timestamp,
            retired_at: None,
        });

    Ok(())
}

/// Permit the dedicated reconstructor to bind itself before an organization
/// restore creates any ERP rows. The identity is a build-time public allowlist,
/// not a secret embedded in the module. No other service can use this path and
/// it closes as soon as the destination contains an organization row.
fn require_empty_target_reconstruction_bootstrap(
    ctx: &ReducerContext,
    service_name: &str,
    identity: Identity,
) -> Result<(), String> {
    if identity == Identity::ZERO {
        return Err("reconstruction bootstrap identity must be non-zero".to_string());
    }
    if service_name != ORGANIZATION_RECONSTRUCTOR_SERVICE || identity != ctx.sender() {
        return Err("Organization not found".to_string());
    }
    if ctx.db.organization().iter().next().is_some() {
        return Err("reconstruction bootstrap requires an empty destination".to_string());
    }
    let configured = option_env!("LUMIERE_RECONSTRUCTION_BOOTSTRAP_IDENTITY")
        .ok_or("reconstruction bootstrap identity is not configured")?;
    validate_reconstruction_bootstrap_identity(configured, &ctx.sender().to_hex().to_string())
}

fn validate_reconstruction_bootstrap_identity(
    configured: &str,
    sender_hex: &str,
) -> Result<(), String> {
    let configured = configured
        .trim()
        .strip_prefix("0x")
        .unwrap_or(configured.trim());
    let sender_hex = sender_hex
        .trim()
        .strip_prefix("0x")
        .unwrap_or(sender_hex.trim());
    if configured.len() != 64 || !configured.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("reconstruction bootstrap identity must be 64 hexadecimal characters".into());
    }
    if !configured.eq_ignore_ascii_case(sender_hex) {
        return Err("caller is not the configured reconstruction bootstrap identity".into());
    }
    Ok(())
}

/// True if `ctx.sender()` is the currently-active registered identity for
/// `(organization_id, service_name)`. C5 cold-tier finalize reducers must check this before
/// trusting any caller-supplied checksum/version — the checksum only
/// authenticates *which row*, never *who is allowed to delete it*.
pub(crate) fn is_active_cold_tier_service_identity(
    ctx: &ReducerContext,
    organization_id: u64,
    service_name: &str,
) -> bool {
    let service_name = service_name.to_string();
    let is_active = ctx
        .db
        .cold_tier_service_identity()
        .cold_tier_service_identity_by_name()
        .filter((&organization_id, &service_name))
        .any(|row| row.is_active && row.identity == ctx.sender());
    is_active
}

fn validate_platform_id(platform_id: &str) -> Result<String, String> {
    let platform_id = platform_id.trim();
    if platform_id.is_empty() || platform_id.len() > 256 {
        return Err("platform_id must contain 1..=256 characters".to_string());
    }
    if !platform_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("platform_id must be an opaque platform identifier".to_string());
    }
    Ok(platform_id.to_string())
}

fn require_superuser(ctx: &ReducerContext) -> Result<(), String> {
    let user = find_user_profile_for_identity(ctx, ctx.sender()).ok_or("User not found")?;
    if !user.is_active || !user.is_superuser {
        return Err(
            "only an active platform superuser may register cold-tier service identities"
                .to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_platform_id, validate_reconstruction_bootstrap_identity};

    #[test]
    fn platform_binding_id_must_be_opaque_and_bounded() {
        assert_eq!(
            validate_platform_id(" platform-binding-01 ").as_deref(),
            Ok("platform-binding-01")
        );
        assert!(validate_platform_id("").is_err());
        assert!(validate_platform_id("org/service").is_err());
        assert!(validate_platform_id(&"x".repeat(257)).is_err());
    }

    #[test]
    fn reconstruction_bootstrap_identity_is_exact_and_well_formed() {
        let identity = "ab".repeat(32);
        assert!(validate_reconstruction_bootstrap_identity(&identity, &identity).is_ok());
        assert!(validate_reconstruction_bootstrap_identity(
            &format!("0x{}", identity.to_uppercase()),
            &identity,
        )
        .is_ok());
        assert!(validate_reconstruction_bootstrap_identity("not-an-identity", &identity).is_err());
        assert!(validate_reconstruction_bootstrap_identity(&"cd".repeat(32), &identity).is_err());
    }
}
