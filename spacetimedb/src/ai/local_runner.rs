//! Private durable pairing and lease records for the trusted local-runner gateway.
//!
//! Only an active organization-scoped runner service binding can call these
//! reducers or read the backing rows. The gateway separately checks the acting
//! user's current membership, company and capabilities at each entry point.

use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, ViewContext};

use crate::core::cold_tier_identity::{
    cold_tier_service_identity__view, require_active_service_identity,
};
use crate::core::organization::require_company_in_organization;

pub(crate) const RUNNER_SERVICE: &str = "ai_local_runner";
const MAX_PENDING_PAIRS: usize = 256;
const MAX_DEVICES: usize = 1024;
// Allow modest clock skew on requests created by the gateway. At every
// write boundary expiration still uses the durable database transaction clock.
const MAX_PAIR_MS: u64 = 5 * 60 * 1_000 + 10_000;
const MAX_LEASE_MS: u64 = 15 * 60 * 1_000 + 10_000;
const MAX_PAYLOAD_BYTES: usize = 2 * 1024 * 1024;
const CONFLICT: &str = "local runner storage conflict";

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_local_runner_pairing,
    index(accessor = runner_pairing_by_org, btree(columns = [organization_id]))
)]
pub struct AiLocalRunnerPairing {
    #[primary_key]
    pub digest: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub actor_identity: String,
    pub expires_at_ms: u64,
    pub claimed_device_id: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_local_runner_device,
    index(accessor = runner_device_by_org, btree(columns = [organization_id]))
)]
pub struct AiLocalRunnerDevice {
    #[primary_key]
    pub device_id: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub actor_identity: String,
    pub credential_digest: String,
    pub label: String,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_local_runner_run,
    index(accessor = runner_run_by_org, btree(columns = [organization_id])),
    index(accessor = runner_run_by_device, btree(columns = [device_id]))
)]
pub struct AiLocalRunnerRun {
    #[primary_key]
    pub run_id: u64,
    #[unique]
    pub request_key: String,
    #[unique]
    pub mcp_digest: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub actor_identity: String,
    pub device_id: String,
    pub expires_at_ms: u64,
    pub active: bool,
    pub version: u64,
    /// Gateway-owned aggregate and replay entries, committed under one CAS.
    pub payload: String,
}

#[derive(SpacetimeType)]
pub struct IssueRunnerPairing {
    pub company_id: u64,
    pub actor_identity: String,
    pub digest: String,
    pub expires_at_ms: u64,
}

#[derive(SpacetimeType)]
pub struct ClaimRunnerPairing {
    pub digest: String,
    pub device_id: String,
    pub credential_digest: String,
    pub label: String,
}

#[derive(SpacetimeType)]
pub struct StartRunnerRun {
    pub company_id: u64,
    pub actor_identity: String,
    pub run_id: u64,
    pub device_id: String,
    pub request_key: String,
    pub mcp_digest: String,
    pub expires_at_ms: u64,
    pub payload: String,
}

#[derive(SpacetimeType)]
pub struct UpdateRunnerRun {
    pub run_id: u64,
    pub company_id: u64,
    pub actor_identity: String,
    pub device_id: String,
    pub expected_version: u64,
    pub require_fresh: bool,
    pub active: bool,
    pub payload: String,
}

fn now_ms(ctx: &ReducerContext) -> Result<u64, String> {
    u64::try_from(ctx.timestamp.to_micros_since_unix_epoch() / 1_000)
        .map_err(|_| "invalid runner storage clock".into())
}

fn valid_expiry(expires: u64, now: u64, max_ms: u64) -> bool {
    expires > now && expires - now <= max_ms
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_device_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, byte)| {
            if [8, 13, 18, 23].contains(&i) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
}

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label == label.trim()
        && label.len() <= 128
        && !label.chars().any(char::is_control)
}

fn valid_payload(payload: &str) -> bool {
    payload.len() <= MAX_PAYLOAD_BYTES
        && serde_json::from_str::<serde_json::Value>(payload).is_ok_and(|value| value.is_object())
}

fn owner_matches(
    device: &AiLocalRunnerDevice,
    organization_id: u64,
    company_id: u64,
    actor_identity: &str,
) -> bool {
    device.organization_id == organization_id
        && device.company_id == company_id
        && device.actor_identity == actor_identity
}

#[reducer]
pub fn issue_ai_local_runner_pairing(
    ctx: &ReducerContext,
    organization_id: u64,
    params: IssueRunnerPairing,
) -> Result<(), String> {
    require_active_service_identity(ctx, organization_id, RUNNER_SERVICE)?;
    require_company_in_organization(ctx, organization_id, params.company_id)?;
    let now = now_ms(ctx)?;
    if !valid_digest(&params.actor_identity)
        || !valid_digest(&params.digest)
        || !valid_expiry(params.expires_at_ms, now, MAX_PAIR_MS)
    {
        return Err("invalid runner pairing".into());
    }
    let table = ctx.db.ai_local_runner_pairing();
    if let Some(existing) = table.digest().find(&params.digest) {
        return if existing.organization_id == organization_id
            && existing.company_id == params.company_id
            && existing.actor_identity == params.actor_identity
            && existing.expires_at_ms == params.expires_at_ms
            && existing.claimed_device_id.is_none()
        {
            Ok(())
        } else {
            Err(CONFLICT.into())
        };
    }
    let rows: Vec<_> = table
        .runner_pairing_by_org()
        .filter(organization_id)
        .collect();
    for row in &rows {
        if row.expires_at_ms <= now
            || (row.company_id == params.company_id
                && row.actor_identity == params.actor_identity
                && row.claimed_device_id.is_none())
        {
            table.digest().delete(&row.digest);
        }
    }
    if table
        .runner_pairing_by_org()
        .filter(organization_id)
        .count()
        >= MAX_PENDING_PAIRS
    {
        return Err("runner pairing capacity reached".into());
    }
    table.insert(AiLocalRunnerPairing {
        digest: params.digest,
        organization_id,
        company_id: params.company_id,
        actor_identity: params.actor_identity,
        expires_at_ms: params.expires_at_ms,
        claimed_device_id: None,
    });
    Ok(())
}

#[reducer]
pub fn claim_ai_local_runner_pairing(
    ctx: &ReducerContext,
    params: ClaimRunnerPairing,
) -> Result<(), String> {
    if !valid_digest(&params.digest)
        || !valid_device_id(&params.device_id)
        || !valid_digest(&params.credential_digest)
        || !valid_label(&params.label)
    {
        return Err("invalid runner pairing claim".into());
    }
    let pairs = ctx.db.ai_local_runner_pairing();
    let mut offer = pairs.digest().find(&params.digest).ok_or(CONFLICT)?;
    // Use the organization resolved from the server-generated pairing digest.
    require_active_service_identity(ctx, offer.organization_id, RUNNER_SERVICE)
        .map_err(|_| CONFLICT)?;
    if offer.expires_at_ms <= now_ms(ctx)? {
        return Err(CONFLICT.into());
    }
    require_company_in_organization(ctx, offer.organization_id, offer.company_id)
        .map_err(|_| CONFLICT)?;

    let devices = ctx.db.ai_local_runner_device();
    if let Some(existing) = offer.claimed_device_id.as_deref() {
        // Idempotent for the same gateway write after a lost response.
        return if existing == params.device_id
            && devices
                .device_id()
                .find(existing.to_owned())
                .is_some_and(|device| {
                    owner_matches(
                        &device,
                        offer.organization_id,
                        offer.company_id,
                        &offer.actor_identity,
                    ) && device.credential_digest == params.credential_digest
                        && device.label == params.label
                })
        {
            Ok(())
        } else {
            Err(CONFLICT.into())
        };
    }
    if devices.device_id().find(&params.device_id).is_some()
        || devices
            .runner_device_by_org()
            .filter(offer.organization_id)
            .count()
            >= MAX_DEVICES
    {
        return Err(CONFLICT.into());
    }
    devices.insert(AiLocalRunnerDevice {
        device_id: params.device_id.clone(),
        organization_id: offer.organization_id,
        company_id: offer.company_id,
        actor_identity: offer.actor_identity.clone(),
        credential_digest: params.credential_digest,
        label: params.label,
    });
    offer.claimed_device_id = Some(params.device_id);
    pairs.digest().update(offer);
    Ok(())
}

#[reducer]
pub fn revoke_ai_local_runner_device(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    actor_identity: String,
    device_id: String,
) -> Result<(), String> {
    require_active_service_identity(ctx, organization_id, RUNNER_SERVICE)?;
    let devices = ctx.db.ai_local_runner_device();
    let device = devices.device_id().find(&device_id).ok_or(CONFLICT)?;
    if !owner_matches(&device, organization_id, company_id, &actor_identity) {
        return Err(CONFLICT.into());
    }
    devices.device_id().delete(&device_id);
    Ok(())
}

#[reducer]
pub fn start_ai_local_runner_run(
    ctx: &ReducerContext,
    organization_id: u64,
    params: StartRunnerRun,
) -> Result<(), String> {
    require_active_service_identity(ctx, organization_id, RUNNER_SERVICE)?;
    require_company_in_organization(ctx, organization_id, params.company_id)?;
    let now = now_ms(ctx)?;
    if params.run_id == 0
        || !valid_device_id(&params.device_id)
        || !valid_digest(&params.actor_identity)
        || !valid_digest(&params.request_key)
        || !valid_digest(&params.mcp_digest)
        || !valid_expiry(params.expires_at_ms, now, MAX_LEASE_MS)
        || !valid_payload(&params.payload)
    {
        return Err("invalid runner attempt".into());
    }
    let device = ctx
        .db
        .ai_local_runner_device()
        .device_id()
        .find(&params.device_id)
        .ok_or(CONFLICT)?;
    if !owner_matches(
        &device,
        organization_id,
        params.company_id,
        &params.actor_identity,
    ) {
        return Err(CONFLICT.into());
    }
    let runs = ctx.db.ai_local_runner_run();
    if runs.run_id().find(params.run_id).is_some()
        || runs.request_key().find(&params.request_key).is_some()
        || runs.mcp_digest().find(&params.mcp_digest).is_some()
        || runs
            .runner_run_by_device()
            .filter(&params.device_id)
            .any(|run| run.active && run.expires_at_ms > now)
    {
        return Err(CONFLICT.into());
    }
    runs.insert(AiLocalRunnerRun {
        run_id: params.run_id,
        request_key: params.request_key,
        mcp_digest: params.mcp_digest,
        organization_id,
        company_id: params.company_id,
        actor_identity: params.actor_identity,
        device_id: params.device_id,
        expires_at_ms: params.expires_at_ms,
        active: true,
        version: 0,
        payload: params.payload,
    });
    Ok(())
}

#[reducer]
pub fn update_ai_local_runner_run(
    ctx: &ReducerContext,
    organization_id: u64,
    params: UpdateRunnerRun,
) -> Result<(), String> {
    require_active_service_identity(ctx, organization_id, RUNNER_SERVICE)?;
    let runs = ctx.db.ai_local_runner_run();
    let mut row = runs.run_id().find(params.run_id).ok_or(CONFLICT)?;
    let now = now_ms(ctx)?;
    if row.organization_id != organization_id
        || row.company_id != params.company_id
        || row.actor_identity != params.actor_identity
        || row.device_id != params.device_id
        || row.version != params.expected_version
        || !row.active
        || (params.require_fresh && row.expires_at_ms <= now)
        || (!params.require_fresh && params.active)
    {
        return Err(CONFLICT.into());
    }
    require_company_in_organization(ctx, organization_id, row.company_id).map_err(|_| CONFLICT)?;
    let device = ctx
        .db
        .ai_local_runner_device()
        .device_id()
        .find(&row.device_id)
        .ok_or(CONFLICT)?;
    if !owner_matches(
        &device,
        organization_id,
        row.company_id,
        &row.actor_identity,
    ) {
        return Err(CONFLICT.into());
    }
    if !valid_payload(&params.payload) {
        return Err("invalid runner attempt payload".into());
    }
    let version = row.version.checked_add(1).ok_or(CONFLICT)?;
    row.version = version;
    row.active = params.active;
    row.payload = params.payload;
    runs.run_id().update(row);
    Ok(())
}

fn service_organizations(ctx: &ViewContext) -> Vec<u64> {
    let mut organizations: Vec<_> = ctx
        .db
        .cold_tier_service_identity()
        .cold_tier_service_identity_by_identity()
        .filter(ctx.sender())
        .filter(|row| row.is_active && row.service_name == RUNNER_SERVICE)
        .map(|row| row.organization_id)
        .collect();
    organizations.sort_unstable();
    organizations.dedup();
    organizations
}

#[spacetimedb::view(accessor = ai_local_runner_pairing_read, public, primary_key = digest)]
pub fn ai_local_runner_pairing_read(ctx: &ViewContext) -> Vec<AiLocalRunnerPairing> {
    service_organizations(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_local_runner_pairing()
                .runner_pairing_by_org()
                .filter(org)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_local_runner_device_read, public, primary_key = device_id)]
pub fn ai_local_runner_device_read(ctx: &ViewContext) -> Vec<AiLocalRunnerDevice> {
    service_organizations(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_local_runner_device()
                .runner_device_by_org()
                .filter(org)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_local_runner_run_read, public, primary_key = run_id)]
pub fn ai_local_runner_run_read(ctx: &ViewContext) -> Vec<AiLocalRunnerRun> {
    service_organizations(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_local_runner_run()
                .runner_run_by_org()
                .filter(org)
                .collect::<Vec<_>>()
        })
        .collect()
}
