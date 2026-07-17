//! Inventory exception queues — short ATP, expired lots, open QC fails.
//!
//! Denormalized rows so clients can subscribe with simple string equality filters
//! (timestamp / float SQL filters are unreliable across STDB subscription surfaces).
use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::quality::quality_check;
use crate::inventory::stock::stock_quant;
use crate::inventory::tracking::stock_production_lot;
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = inventory_exception,
    public,
    index(accessor = inventory_exception_by_org, btree(columns = [organization_id])),
    index(accessor = inventory_exception_by_company, btree(columns = [company_id])),
    index(accessor = inventory_exception_by_type, btree(columns = [exception_type])),
    index(accessor = inventory_exception_by_state, btree(columns = [state])),
    index(accessor = inventory_exception_by_dedupe, btree(columns = [dedupe_key]))
)]
pub struct InventoryException {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// short_atp | expired_lot | open_qc
    pub exception_type: String,
    /// open | resolved
    pub state: String,
    /// Stable key for upsert: "{type}:{entity_id}"
    pub dedupe_key: String,
    pub product_id: Option<u64>,
    pub location_id: Option<u64>,
    pub quant_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub quality_check_id: Option<u64>,
    pub summary: String,
    pub detected_at: Timestamp,
    pub resolved_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RefreshInventoryExceptionsParams {
    /// When true, only scan and upsert; when false (default), also resolve stale opens.
    pub upsert_only: bool,
    pub metadata: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn lot_is_expired(ctx: &ReducerContext, lot: &crate::inventory::tracking::StockProductionLot) -> bool {
    let now = ctx.timestamp;
    if let Some(removal) = lot.removal_date {
        if removal <= now {
            return true;
        }
    }
    if let Some(exp) = lot.expiration_date {
        if exp <= now {
            return true;
        }
    }
    false
}

fn upsert_open_exception(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    exception_type: &str,
    dedupe_key: String,
    summary: String,
    product_id: Option<u64>,
    location_id: Option<u64>,
    quant_id: Option<u64>,
    lot_id: Option<u64>,
    quality_check_id: Option<u64>,
) {
    if let Some(existing) = ctx
        .db
        .inventory_exception()
        .inventory_exception_by_dedupe()
        .filter(&dedupe_key)
        .find(|e| e.organization_id == organization_id && e.company_id == company_id)
    {
        if existing.state == "open" {
            ctx.db.inventory_exception().id().update(InventoryException {
                summary: summary.clone(),
                product_id,
                location_id,
                quant_id,
                lot_id,
                quality_check_id,
                metadata: existing.metadata.clone(),
                ..existing
            });
            return;
        }
        // Re-open previously resolved.
        ctx.db.inventory_exception().id().update(InventoryException {
            state: "open".to_string(),
            summary,
            product_id,
            location_id,
            quant_id,
            lot_id,
            quality_check_id,
            detected_at: ctx.timestamp,
            resolved_at: None,
            ..existing
        });
        return;
    }

    ctx.db.inventory_exception().insert(InventoryException {
        id: 0,
        organization_id,
        company_id,
        exception_type: exception_type.to_string(),
        state: "open".to_string(),
        dedupe_key,
        product_id,
        location_id,
        quant_id,
        lot_id,
        quality_check_id,
        summary,
        detected_at: ctx.timestamp,
        resolved_at: None,
        metadata: None,
    });
}

fn resolve_by_dedupe(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    dedupe_key: &str,
) {
    let Some(existing) = ctx
        .db
        .inventory_exception()
        .inventory_exception_by_dedupe()
        .filter(&dedupe_key.to_string())
        .find(|e| {
            e.organization_id == organization_id
                && e.company_id == company_id
                && e.state == "open"
        })
    else {
        return;
    };
    ctx.db.inventory_exception().id().update(InventoryException {
        state: "resolved".to_string(),
        resolved_at: Some(ctx.timestamp),
        ..existing
    });
}

/// Record an open QC exception after a failed quality check.
pub(crate) fn record_open_qc_exception(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    quality_check_id: u64,
    product_id: Option<u64>,
    qty_failed: f64,
) {
    upsert_open_exception(
        ctx,
        organization_id,
        company_id,
        "open_qc",
        format!("open_qc:{quality_check_id}"),
        format!("Quality check {quality_check_id} failed (qty {qty_failed})"),
        product_id,
        None,
        None,
        None,
        Some(quality_check_id),
    );
}

fn refresh_company_exceptions(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    upsert_only: bool,
) -> (u32, u32) {
    let mut upserted = 0u32;
    let mut resolved = 0u32;

    // Short ATP: company-owned quants with on-hand but no available.
    let mut live_short: Vec<String> = Vec::new();
    for quant in ctx
        .db
        .stock_quant()
        .quant_by_org()
        .filter(&organization_id)
        .filter(|q| q.company_id == company_id && q.owner_id.is_none())
    {
        let short = quant.quantity > 1e-9 && quant.available_quantity <= 1e-9;
        let key = format!("short_atp:{}", quant.id);
        if short {
            upsert_open_exception(
                ctx,
                organization_id,
                company_id,
                "short_atp",
                key.clone(),
                format!(
                    "Short ATP product {} @ loc {} (qty {}, avail {})",
                    quant.product_id, quant.location_id, quant.quantity, quant.available_quantity
                ),
                Some(quant.product_id),
                Some(quant.location_id),
                Some(quant.id),
                quant.lot_id,
                None,
            );
            live_short.push(key);
            upserted = upserted.saturating_add(1);
        }
    }

    // Expired lots.
    let mut live_expired: Vec<String> = Vec::new();
    for lot in ctx
        .db
        .stock_production_lot()
        .lot_by_company()
        .filter(&company_id)
        .filter(|l| l.organization_id == organization_id)
    {
        let key = format!("expired_lot:{}", lot.id);
        if lot_is_expired(ctx, &lot) {
            upsert_open_exception(
                ctx,
                organization_id,
                company_id,
                "expired_lot",
                key.clone(),
                format!(
                    "Lot {} ({}) expired for product {}",
                    lot.name, lot.id, lot.product_id
                ),
                Some(lot.product_id),
                lot.location_id,
                None,
                Some(lot.id),
                None,
            );
            live_expired.push(key);
            upserted = upserted.saturating_add(1);
        }
    }

    // Open QC fails.
    let mut live_qc: Vec<String> = Vec::new();
    for check in ctx
        .db
        .quality_check()
        .quality_check_by_org()
        .filter(&organization_id)
        .filter(|c| c.company_id == company_id && c.quality_state == "fail")
    {
        let key = format!("open_qc:{}", check.id);
        upsert_open_exception(
            ctx,
            organization_id,
            company_id,
            "open_qc",
            key.clone(),
            format!(
                "Open QC fail {} product {:?}",
                check.id, check.product_id
            ),
            check.product_id,
            check.failure_location_id,
            None,
            check.lot_id,
            Some(check.id),
        );
        live_qc.push(key);
        upserted = upserted.saturating_add(1);
    }

    if !upsert_only {
        for ex in ctx
            .db
            .inventory_exception()
            .inventory_exception_by_company()
            .filter(&company_id)
            .filter(|e| e.organization_id == organization_id && e.state == "open")
        {
            let still_live = match ex.exception_type.as_str() {
                "short_atp" => live_short.iter().any(|k| k == &ex.dedupe_key),
                "expired_lot" => live_expired.iter().any(|k| k == &ex.dedupe_key),
                "open_qc" => live_qc.iter().any(|k| k == &ex.dedupe_key),
                _ => true,
            };
            if !still_live {
                resolve_by_dedupe(ctx, organization_id, company_id, &ex.dedupe_key);
                resolved = resolved.saturating_add(1);
            }
        }
    }

    (upserted, resolved)
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Scan company stock/lots/QC and upsert/resolve exception queue rows.
#[reducer]
pub fn refresh_inventory_exceptions(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RefreshInventoryExceptionsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "read")?;
    let (upserted, resolved) =
        refresh_company_exceptions(ctx, organization_id, company_id, params.upsert_only);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "inventory_exception",
            record_id: company_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "upserted": upserted,
                    "resolved": resolved,
                })
                .to_string(),
            ),
            changed_fields: vec!["state".to_string()],
            metadata: params.metadata,
        },
    );
    Ok(())
}

#[reducer]
pub fn resolve_inventory_exception(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    exception_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "update")?;
    let ex = ctx
        .db
        .inventory_exception()
        .id()
        .find(&exception_id)
        .ok_or("Inventory exception not found")?;
    if ex.organization_id != organization_id || ex.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if ex.state != "open" {
        return Ok(());
    }

    ctx.db.inventory_exception().id().update(InventoryException {
        state: "resolved".to_string(),
        resolved_at: Some(ctx.timestamp),
        ..ex
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "inventory_exception",
            record_id: exception_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "open" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "resolved" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
