//! FLT-005/FLT-006: PosTerminal org isolation and WarehouseGeo FK validation.
use spacetimedb::{ReducerContext, Table};

use crate::core::audit::audit_log;
use crate::core::business_changes::organization_business_change;
use crate::core::persistence::{organization_commit, organization_row_change};
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
        .find(|g| {
            g.organization_id == local.organization_id && g.warehouse_id == local.warehouse_id
        })
        .ok_or("valid warehouse_geo upsert was not persisted")?;

    let correlation_id = format!("warehouse-geo:{}", local.warehouse_id);
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .iter()
        .filter(|commit| {
            commit.organization_id == local.organization_id
                && commit.operation_id == "erp.upsert_warehouse_geo"
                && commit.correlation_id == correlation_id
        })
        .collect();
    if commits.len() != 1 || commits[0].row_change_count != 3 {
        return Err(format!(
            "warehouse geo should emit one three-row organization commit, got {} / {:?}",
            commits.len(),
            commits.first().map(|commit| commit.row_change_count)
        ));
    }
    let commit = &commits[0];
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .iter()
        .filter(|change| {
            change.organization_id == local.organization_id
                && change.commit_sequence == commit.sequence
        })
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    let tables: Vec<_> = changes
        .iter()
        .map(|change| change.table_name.as_str())
        .collect();
    if tables != ["warehouse_geo", "audit_log", "organization_business_change"] {
        return Err(format!(
            "warehouse geo commit should contain the ordered warehouse_geo, audit and private history rows in local org, got {:?}",
            changes
                .iter()
                .map(|change| (&change.organization_id, &change.table_name))
                .collect::<Vec<_>>()
        ));
    }

    let audit_id = serde_json::from_str::<serde_json::Value>(&changes[1].row_identity_json)
        .map_err(|error| format!("warehouse geo audit identity invalid: {error}"))?
        .get("id")
        .and_then(serde_json::Value::as_u64)
        .ok_or("warehouse geo audit identity missing")?;
    let history_id = serde_json::from_str::<serde_json::Value>(&changes[2].row_identity_json)
        .map_err(|error| format!("warehouse geo private history identity invalid: {error}"))?
        .get("id")
        .and_then(serde_json::Value::as_u64)
        .ok_or("warehouse geo private history identity missing")?;
    let audit = ctx
        .db
        .audit_log()
        .id()
        .find(&audit_id)
        .ok_or("warehouse geo audit row missing")?;
    let history = ctx
        .db
        .organization_business_change()
        .id()
        .find(&history_id)
        .ok_or("warehouse geo private history row missing")?;
    if history.audit_log_id != audit.id
        || history.organization_id != local.organization_id
        || audit.organization_id != local.organization_id
        || history.record_id != persisted.id
        || history.resource != "warehouse_geo"
        || history.subject_resource != "warehouse_geo"
        || history.subject_record_id != persisted.id
        || audit.table_name != "warehouse_geo"
        || audit.record_id != persisted.id
        || history.operation != "upsert_warehouse_geo"
        || audit.company_id.is_some()
    {
        return Err("warehouse geo owner commit did not preserve exact audit/private history linkage and scope".into());
    }

    Ok(())
}
