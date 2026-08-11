//! Inventory preflight audit — INV-RI-016
//!
//! Scans inventory tables for known data integrity violations and records them.
//! Call `run_inventory_preflight_audit` before enabling inventory in production.

use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::integration::inventory_integration_intent;
use crate::inventory::inventory_adjustments::inventory_adjustment;
use crate::inventory::inventory_close::inventory_close;
use crate::inventory::warehouse::warehouse;

// ── Tables ────────────────────────────────────────────────────────────────────

/// Header record for one audit run.
#[spacetimedb::table(accessor = inventory_audit_run, public,
    index(accessor = audit_runs_by_org, btree(columns = [organization_id])))]
pub struct InventoryAuditRun {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub started_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub violation_count: u32,
    pub run_by: Identity,
}

/// One violation found during a preflight audit run.
#[spacetimedb::table(accessor = inventory_audit_violation, public,
    index(accessor = violations_by_run, btree(columns = [run_id])),
    index(accessor = violations_by_org, btree(columns = [organization_id])))]
pub struct InventoryAuditViolation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub run_id: u64,
    pub organization_id: u64,
    pub violation_type: String,
    pub table_name: String,
    pub record_id: u64,
    pub field_name: Option<String>,
    pub description: String,
    pub severity: String, // "critical" | "warning"
    pub resolved: bool,
    pub created_at: Timestamp,
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn record_violation(
    ctx: &ReducerContext,
    run_id: u64,
    organization_id: u64,
    violation_type: &str,
    table_name: &str,
    record_id: u64,
    field_name: Option<&str>,
    description: &str,
    severity: &str,
) {
    ctx.db
        .inventory_audit_violation()
        .insert(InventoryAuditViolation {
            id: 0,
            run_id,
            organization_id,
            violation_type: violation_type.to_string(),
            table_name: table_name.to_string(),
            record_id,
            field_name: field_name.map(|s| s.to_string()),
            description: description.to_string(),
            severity: severity.to_string(),
            resolved: false,
            created_at: ctx.timestamp,
        });
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Run a preflight audit of inventory tables for the given organization.
///
/// Inserts an `InventoryAuditRun` header row, runs each violation check,
/// then stamps `completed_at` and `violation_count` on the header row.
///
/// Permission required: `inventory_audit / run`
#[spacetimedb::reducer]
pub fn run_inventory_preflight_audit(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "inventory_audit", "run")?;

    // Insert the run header (completed_at is None until we finish).
    let run = ctx.db.inventory_audit_run().insert(InventoryAuditRun {
        id: 0,
        organization_id,
        company_id,
        started_at: ctx.timestamp,
        completed_at: None,
        violation_count: 0,
        run_by: ctx.sender(),
    });
    let run_id = run.id;

    let mut violation_count: u32 = 0;

    // ── Check A: inventory_adjustment rows with company_id == 0 ──────────────
    for adj in ctx
        .db
        .inventory_adjustment()
        .iter()
        .filter(|a| a.organization_id == organization_id)
    {
        if adj.company_id == 0 {
            record_violation(
                ctx,
                run_id,
                organization_id,
                "missing_company",
                "inventory_adjustment",
                adj.id,
                Some("company_id"),
                "inventory_adjustment row has company_id = 0",
                "critical",
            );
            violation_count += 1;
        }
    }

    // ── Check B: processed adjustments without a stock-move linkage ──────────
    for adj in ctx.db.inventory_adjustment().iter().filter(|a| {
        a.organization_id == organization_id && a.state == "processed" && a.move_id.is_none()
    }) {
        record_violation(
            ctx,
            run_id,
            organization_id,
            "processed_without_effect",
            "inventory_adjustment",
            adj.id,
            None,
            "adjustment is processed but has no stock move",
            "critical",
        );
        violation_count += 1;
    }

    // ── Check C: integration intents applied without a quant (approximate) ───
    // We log applied intents that have no product/location info as a warning.
    // A full quant-existence check requires knowing product + location per intent,
    // which is stored externally.  Log count-level warning here.
    let applied_intent_count = ctx
        .db
        .inventory_integration_intent()
        .iter()
        .filter(|i| i.organization_id == organization_id && i.applied)
        .count();

    if applied_intent_count > 0 {
        // Record a single advisory violation so operators are aware.
        record_violation(
            ctx,
            run_id,
            organization_id,
            "applied_intent_without_quant_check",
            "inventory_integration_intent",
            0,
            None,
            &format!(
                "{} applied integration intent(s) found; verify each has a matching stock quant",
                applied_intent_count
            ),
            "warning",
        );
        violation_count += 1;
    }

    // ── Check D: inventory close rows marked closed with no GL move ───────────
    for close in ctx.db.inventory_close().iter().filter(|c| {
        c.organization_id == organization_id && c.state == "closed" && c.account_move_id.is_none()
    }) {
        record_violation(
            ctx,
            run_id,
            organization_id,
            "close_without_gl_move",
            "inventory_close",
            close.id,
            Some("account_move_id"),
            "inventory close is closed but has no accounting move",
            "critical",
        );
        violation_count += 1;
    }

    // ── Check E: warehouse rows with lot_stock_id == 0 ───────────────────────
    for wh in ctx
        .db
        .warehouse()
        .iter()
        .filter(|w| w.organization_id == organization_id)
    {
        if wh.lot_stock_id == 0 {
            record_violation(
                ctx,
                run_id,
                organization_id,
                "zero_id",
                "warehouse",
                wh.id,
                Some("lot_stock_id"),
                "warehouse has lot_stock_id = 0 (unvalidated FK)",
                "warning",
            );
            violation_count += 1;
        }
    }

    // ── Stamp the run header with results ─────────────────────────────────────
    ctx.db.inventory_audit_run().id().update(InventoryAuditRun {
        completed_at: Some(ctx.timestamp),
        violation_count,
        ..run
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "inventory_audit_run",
            record_id: run_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!(
                r#"{{"run_id":{},"violation_count":{}}}"#,
                run_id, violation_count
            )),
            changed_fields: vec!["violation_count".to_string(), "completed_at".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Delete all violations for an organization, optionally scoped to one run.
///
/// Permission required: `inventory_audit / delete`
#[spacetimedb::reducer]
pub fn clear_inventory_audit_violations(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "inventory_audit", "delete")?;

    let to_delete: Vec<u64> = ctx
        .db
        .inventory_audit_violation()
        .iter()
        .filter(|v| {
            v.organization_id == organization_id
                && match run_id {
                    Some(rid) => v.run_id == rid,
                    None => true,
                }
        })
        .map(|v| v.id)
        .collect();

    let deleted_count = to_delete.len() as u64;

    for vid in to_delete {
        ctx.db.inventory_audit_violation().id().delete(&vid);
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "inventory_audit_violation",
            record_id: run_id.unwrap_or(0),
            action: "DELETE",
            old_values: Some(format!(r#"{{"deleted_count":{}}}"#, deleted_count)),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

/// Mark a single violation as resolved.
///
/// The caller must belong to the same organization as the violation.
/// Permission required: `inventory_audit / update`
#[spacetimedb::reducer]
pub fn resolve_inventory_audit_violation(
    ctx: &ReducerContext,
    violation_id: u64,
) -> Result<(), String> {
    let violation = ctx
        .db
        .inventory_audit_violation()
        .id()
        .find(&violation_id)
        .ok_or_else(|| format!("InventoryAuditViolation {} not found", violation_id))?;

    check_permission(ctx, violation.organization_id, "inventory_audit", "update")?;

    if violation.resolved {
        return Ok(()); // idempotent
    }

    let organization_id = violation.organization_id;

    ctx.db
        .inventory_audit_violation()
        .id()
        .update(InventoryAuditViolation {
            resolved: true,
            ..violation
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "inventory_audit_violation",
            record_id: violation_id,
            action: "UPDATE",
            old_values: Some(r#"{"resolved":false}"#.to_string()),
            new_values: Some(r#"{"resolved":true}"#.to_string()),
            changed_fields: vec!["resolved".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
