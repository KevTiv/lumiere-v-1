//! FLT-005/FLT-006: PosTerminal org isolation and WarehouseGeo FK validation.
use spacetimedb::{ReducerContext, Table};

use crate::fleet::fleet::{create_pos_terminal, pos_terminal, upsert_warehouse_geo, warehouse_geo};
use crate::test_harness::OrgFixture;

fn create_terminal(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_pos_terminal(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        name.to_string(),
        None,
        None,
        None,
    )?;
    ctx.db
        .pos_terminal()
        .iter()
        .find(|t| t.organization_id == fixture.organization_id && t.name == name)
        .map(|t| t.id)
        .ok_or_else(|| format!("terminal {name} not found after create"))
}

/// FLT-005: a PosTerminal created for org A must never surface through org B's
/// org-scoped query path (the `pos_terminal_by_org` index, and a raw table
/// scan filtered by org B's id, both used to enforce visibility elsewhere in
/// the codebase since PosTerminal is a `public` table with no dedicated
/// per-org lookup reducer).
pub fn test_pos_terminal_org_isolation(ctx: &ReducerContext) -> Result<(), String> {
    let org_a = OrgFixture::seed_minimal(ctx)?;
    let org_b = OrgFixture::seed_minimal(ctx)?;

    let terminal_id = create_terminal(ctx, &org_a, "FLT-005 Org A Terminal")?;

    // Positive control: org A's own org-scoped query surfaces the terminal.
    let visible_to_a = ctx
        .db
        .pos_terminal()
        .pos_terminal_by_org()
        .filter(&org_a.organization_id)
        .any(|t| t.id == terminal_id);
    if !visible_to_a {
        return Err("terminal not visible to its own organization".to_string());
    }

    // Org B's org-scoped query must never return org A's terminal.
    let leaked_via_index = ctx
        .db
        .pos_terminal()
        .pos_terminal_by_org()
        .filter(&org_b.organization_id)
        .any(|t| t.id == terminal_id);
    if leaked_via_index {
        return Err("org B org-scoped index query leaked org A's PosTerminal".to_string());
    }

    // Full-table scan filtered by org B's id must also never surface it — this
    // covers any query path that bypasses the named index.
    let leaked_via_scan = ctx
        .db
        .pos_terminal()
        .iter()
        .any(|t| t.organization_id == org_b.organization_id && t.id == terminal_id);
    if leaked_via_scan {
        return Err("org B full-table scan leaked org A's PosTerminal".to_string());
    }

    Ok(())
}

/// FLT-006: `upsert_warehouse_geo`'s existing FLT-002 guard must reject both a
/// nonexistent `warehouse_id` and one that belongs to a different
/// organization; a real, same-org warehouse_id must still succeed.
pub fn test_warehouse_geo_rejects_invalid_warehouse(ctx: &ReducerContext) -> Result<(), String> {
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;

    let missing_warehouse_id = local.warehouse_id.max(foreign.warehouse_id) + 1000;

    for (case, warehouse_id, expected) in [
        ("missing", missing_warehouse_id, "not found"),
        ("cross-org", foreign.warehouse_id, "does not belong"),
    ] {
        let before_count = ctx
            .db
            .warehouse_geo()
            .iter()
            .filter(|g| g.organization_id == local.organization_id)
            .count();

        let result = upsert_warehouse_geo(
            ctx,
            local.organization_id,
            warehouse_id,
            -33.8688,
            151.2093,
            None,
            None,
            None,
            None,
        );

        match result {
            Err(ref e) if e.contains(expected) => {}
            other => {
                return Err(format!(
                    "{case} warehouse_id: expected {expected:?} error, got {other:?}"
                ))
            }
        }

        let after_count = ctx
            .db
            .warehouse_geo()
            .iter()
            .filter(|g| g.organization_id == local.organization_id)
            .count();
        if before_count != after_count {
            return Err(format!(
                "{case} warehouse_id create persisted a warehouse_geo row"
            ));
        }
    }

    // Valid, same-org warehouse_id succeeds (positive control).
    upsert_warehouse_geo(
        ctx,
        local.organization_id,
        local.warehouse_id,
        -33.8688,
        151.2093,
        None,
        None,
        None,
        None,
    )?;
    let persisted = ctx
        .db
        .warehouse_geo()
        .iter()
        .any(|g| g.organization_id == local.organization_id && g.warehouse_id == local.warehouse_id);
    if !persisted {
        return Err("valid warehouse_geo upsert was not persisted".to_string());
    }

    Ok(())
}
