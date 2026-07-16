//! Inventory period close — snapshot quants and lock stock mutations.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::stock::stock_quant;
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = inventory_close,
    public,
    index(accessor = inventory_close_by_org, btree(columns = [organization_id])),
    index(accessor = inventory_close_by_company, btree(columns = [company_id])),
    index(accessor = inventory_close_by_state, btree(columns = [state]))
)]
pub struct InventoryClose {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub as_of: Timestamp,
    /// draft | closed
    pub state: String,
    /// When true, stock mutations for the company are blocked.
    pub locked: bool,
    pub line_count: u32,
    pub total_quantity: f64,
    pub total_value: f64,
    pub closed_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = inventory_close_line,
    public,
    index(accessor = inventory_close_line_by_close, btree(columns = [close_id])),
    index(accessor = inventory_close_line_by_org, btree(columns = [organization_id]))
)]
pub struct InventoryCloseLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub close_id: u64,
    pub product_id: u64,
    pub location_id: u64,
    pub lot_id: Option<u64>,
    pub quantity: f64,
    pub reserved_quantity: f64,
    pub available_quantity: f64,
    pub cost: f64,
    pub value: f64,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateInventoryCloseParams {
    pub name: String,
    pub as_of: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Fail closed when the company has a locked inventory close.
pub(crate) fn assert_inventory_writable(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    let locked = ctx
        .db
        .inventory_close()
        .inventory_close_by_company()
        .filter(&company_id)
        .any(|c| {
            c.organization_id == organization_id && c.state == "closed" && c.locked
        });
    if locked {
        return Err(
            "Inventory is locked by a closed inventory period — reopen before mutating stock"
                .to_string(),
        );
    }
    Ok(())
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_inventory_close(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateInventoryCloseParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "create")?;
    if params.name.trim().is_empty() {
        return Err("Close name cannot be empty".to_string());
    }
    let row = ctx.db.inventory_close().insert(InventoryClose {
        id: 0,
        organization_id,
        company_id,
        name: params.name.clone(),
        as_of: params.as_of.unwrap_or(ctx.timestamp),
        state: "draft".to_string(),
        locked: false,
        line_count: 0,
        total_quantity: 0.0,
        total_value: 0.0,
        closed_at: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "inventory_close",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": row.name, "state": row.state }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Snapshot company quants and lock stock mutations.
#[reducer]
pub fn run_inventory_close(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    close_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "update")?;
    let close = ctx
        .db
        .inventory_close()
        .id()
        .find(&close_id)
        .ok_or("Inventory close not found")?;
    if close.organization_id != organization_id || close.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if close.state != "draft" {
        return Err(format!("Only draft closes can be run (state: {})", close.state));
    }

    // Clear any prior lines (idempotent re-run of draft).
    let existing: Vec<u64> = ctx
        .db
        .inventory_close_line()
        .inventory_close_line_by_close()
        .filter(&close_id)
        .map(|l| l.id)
        .collect();
    for id in existing {
        ctx.db.inventory_close_line().id().delete(&id);
    }

    let mut line_count = 0u32;
    let mut total_quantity = 0.0;
    let mut total_value = 0.0;

    for quant in ctx
        .db
        .stock_quant()
        .quant_by_org()
        .filter(&organization_id)
        .filter(|q| q.company_id == company_id)
    {
        ctx.db.inventory_close_line().insert(InventoryCloseLine {
            id: 0,
            organization_id,
            company_id,
            close_id,
            product_id: quant.product_id,
            location_id: quant.location_id,
            lot_id: quant.lot_id,
            quantity: quant.quantity,
            reserved_quantity: quant.reserved_quantity,
            available_quantity: quant.available_quantity,
            cost: quant.cost,
            value: quant.value,
            metadata: None,
        });
        line_count = line_count.saturating_add(1);
        total_quantity += quant.quantity;
        total_value += quant.value;
    }

    ctx.db.inventory_close().id().update(InventoryClose {
        state: "closed".to_string(),
        locked: true,
        line_count,
        total_quantity,
        total_value,
        closed_at: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..close
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "inventory_close",
            record_id: close_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "draft" }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": "closed",
                    "locked": true,
                    "line_count": line_count,
                    "total_value": total_value,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "state".to_string(),
                "locked".to_string(),
                "line_count".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn reopen_inventory_close(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    close_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "update")?;
    let close = ctx
        .db
        .inventory_close()
        .id()
        .find(&close_id)
        .ok_or("Inventory close not found")?;
    if close.organization_id != organization_id || close.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if close.state != "closed" {
        return Err("Only closed periods can be reopened".to_string());
    }

    ctx.db.inventory_close().id().update(InventoryClose {
        locked: false,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some(
            serde_json::json!({
                "reopened_at": ctx.timestamp.to_micros_since_unix_epoch(),
                "prior": close.metadata,
            })
            .to_string(),
        ),
        ..close
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "inventory_close",
            record_id: close_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "locked": true }).to_string()),
            new_values: Some(serde_json::json!({ "locked": false }).to_string()),
            changed_fields: vec!["locked".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
