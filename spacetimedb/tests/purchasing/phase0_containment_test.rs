//! Phase 0 containment tests for purchasing relational-integrity remediation.

use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{organization_settings, OrganizationSettings};
use crate::purchasing::{
    require_purchasing_ri_phase0_unsafe_actions_enabled, PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_phase0_unsafe_actions_require_explicit_tenant_opt_in(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    let blocked = require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, fixture.organization_id);
    if blocked.is_ok() {
        return Err("expected unsafe purchasing action to be blocked without opt-in".to_string());
    }

    ctx.db.organization_settings().insert(OrganizationSettings {
        organization_id: fixture.organization_id,
        module_config: None,
        feature_flags: vec![PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG.to_string()],
        integration_keys: None,
        updated_at: ctx.timestamp,
        metadata: Some(r#"{"test":"purchasing-phase0-containment"}"#.to_string()),
    });

    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, fixture.organization_id)
}
