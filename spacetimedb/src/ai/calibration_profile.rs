//! GP-09 (governed intelligence program): durable calibration profile
//! storage — companion to `ai-gateway/src/orchestrator/probabilistic.rs`,
//! which owns the actual raw-to-calibrated interpolation logic and the
//! `Confidence::Raw`/`Confidence::Calibrated` type separation.
//!
//! A calibration profile maps a provider's raw, untrusted confidence to a
//! calibrated one via monotonic piecewise-linear breakpoints, stored here
//! as opaque JSON — same "durable evidence, not a second schema to keep in
//! sync" posture as every other GP table. A version, once registered, is
//! immutable; `register_ai_calibration_profile` is idempotent on an
//! identical replay and rejects a differing one, same contract as GP-05
//! through GP-07's tables. `organization_id` always identifies a real
//! organization row (no sentinel values — see the GP-07 fix).
//!
//! Read (not written) by production code: `ai-gateway`'s
//! `StdbCalibrationProfileStore` queries this table directly via SQL (it
//! is `public`, unlike the ledger-style private tables elsewhere in this
//! module tree) to resolve a `CalibrationProfileRef` a `GateCondition::
//! ThresholdPolicy` branch names. `register_ai_calibration_profile`
//! itself is not yet called by any production reducer — profiles are
//! registered out of band (e.g. an admin script or a future
//! calibration-management surface), the same way model profiles and
//! intelligence policies are.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::check_permission;

const MAX_BREAKPOINTS_JSON_LEN: usize = 32_000;

#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = ai_calibration_profile,
    public,
    index(
        accessor = ai_calibration_profile_by_org,
        btree(columns = [organization_id])
    )
)]
pub struct AiCalibrationProfile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub profile_name: String,
    pub profile_version: u32,
    pub description: String,
    /// JSON array of `[raw, calibrated]` pairs, strictly increasing in
    /// `raw`, covering `0.0` through `1.0`. Validated shape only, by the
    /// ai-gateway side — this table stores it as opaque evidence.
    pub breakpoints_json: String,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RegisterAiCalibrationProfileParams {
    pub profile_name: String,
    pub profile_version: u32,
    pub description: String,
    pub breakpoints_json: String,
}

/// Register (or idempotently replay) one immutable calibration profile
/// version, scoped to `organization_id`.
#[reducer]
pub fn register_ai_calibration_profile(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RegisterAiCalibrationProfileParams,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err(
            "register_ai_calibration_profile requires a non-zero organization_id".to_string(),
        );
    }
    check_permission(ctx, organization_id, "ai_calibration_profile", "create")?;

    if params.profile_name.trim().is_empty() {
        return Err("profile_name is required".to_string());
    }
    if params.profile_version == 0 {
        return Err("profile_version must be positive".to_string());
    }
    if params.description.trim().is_empty() {
        return Err("description is required".to_string());
    }
    if params.breakpoints_json.len() > MAX_BREAKPOINTS_JSON_LEN {
        return Err("breakpoints_json is too long".to_string());
    }

    if let Some(existing) = find_profile(
        ctx,
        organization_id,
        &params.profile_name,
        params.profile_version,
    ) {
        if existing.description == params.description
            && existing.breakpoints_json == params.breakpoints_json
        {
            return Ok(());
        }
        return Err(format!(
            "calibration profile '{}' v{} is already registered with different content",
            params.profile_name, params.profile_version
        ));
    }

    ctx.db
        .ai_calibration_profile()
        .insert(AiCalibrationProfile {
            id: 0,
            organization_id,
            profile_name: params.profile_name,
            profile_version: params.profile_version,
            description: params.description,
            breakpoints_json: params.breakpoints_json,
            is_active: true,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });
    Ok(())
}

/// Deprecate or reactivate one registered version. Never rewrites the
/// immutable breakpoints — only whether it is currently usable.
#[reducer]
pub fn set_ai_calibration_profile_active(
    ctx: &ReducerContext,
    organization_id: u64,
    profile_name: String,
    profile_version: u32,
    is_active: bool,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err(
            "set_ai_calibration_profile_active requires a non-zero organization_id".to_string(),
        );
    }
    check_permission(ctx, organization_id, "ai_calibration_profile", "write")?;

    let profile = find_profile(ctx, organization_id, &profile_name, profile_version)
        .ok_or("Calibration profile not found")?;
    ctx.db
        .ai_calibration_profile()
        .id()
        .update(AiCalibrationProfile {
            is_active,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..profile
        });
    Ok(())
}

fn find_profile(
    ctx: &ReducerContext,
    organization_id: u64,
    profile_name: &str,
    profile_version: u32,
) -> Option<AiCalibrationProfile> {
    ctx.db
        .ai_calibration_profile()
        .ai_calibration_profile_by_org()
        .filter(&organization_id)
        .find(|p| p.profile_name == profile_name && p.profile_version == profile_version)
}
