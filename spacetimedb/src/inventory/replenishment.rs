/// Replenishment — Tables and Reducers
///
/// Tables:
///   - ReplenishmentRule
///   - StockReorderGroup
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Replenishment Rule
#[spacetimedb::table(
    accessor = replenishment_rule,
    public,
    index(accessor = replenishment_by_org, btree(columns = [organization_id])),
    index(accessor = replenishment_by_product, btree(columns = [product_id])),
    index(accessor = replenishment_by_location, btree(columns = [location_id]))
)]
pub struct ReplenishmentRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub product_id: u64,
    pub location_id: u64,
    pub warehouse_id: Option<u64>,
    pub uom_id: u64,
    pub product_min_qty: f64,
    pub product_max_qty: f64,
    pub qty_multiple: f64,
    pub qty_to_order: f64,
    pub lead_days: i32,
    pub route_id: Option<u64>,
    pub trigger: String,
    pub group_id: Option<u64>,
    pub company_id: u64,
    pub active: bool,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub last_run: Option<Timestamp>,
    pub next_run: Option<Timestamp>,
    pub metadata: Option<String>,
}

/// Stock Reorder Group
#[spacetimedb::table(
    accessor = stock_reorder_group,
    public,
    index(accessor = reorder_group_by_org, btree(columns = [organization_id]))
)]
pub struct StockReorderGroup {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub rule_ids: Vec<u64>,
    pub active: bool,
    pub company_id: u64,
    pub lead_days: i32,
    pub trigger: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateReplenishmentRuleParams {
    pub product_id: u64,
    pub location_id: u64,
    pub warehouse_id: Option<u64>,
    pub uom_id: u64,
    pub product_min_qty: f64,
    pub product_max_qty: f64,
    pub qty_multiple: f64,
    pub lead_days: i32,
    pub route_id: Option<u64>,
    pub trigger: String,
    pub group_id: Option<u64>,
    pub active: bool,
    pub last_run: Option<Timestamp>,
    pub next_run: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new replenishment rule
#[spacetimedb::reducer]
pub fn create_replenishment_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateReplenishmentRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "replenishment_rule", "create")?;

    // qty_to_order derived from min/max quantities
    let qty_to_order = if params.product_max_qty > params.product_min_qty {
        params.product_max_qty - params.product_min_qty
    } else {
        0.0
    };

    let rule = ctx.db.replenishment_rule().insert(ReplenishmentRule {
        id: 0,
        organization_id,
        product_id: params.product_id,
        location_id: params.location_id,
        warehouse_id: params.warehouse_id,
        uom_id: params.uom_id,
        product_min_qty: params.product_min_qty,
        product_max_qty: params.product_max_qty,
        qty_multiple: params.qty_multiple,
        qty_to_order,
        lead_days: params.lead_days,
        route_id: params.route_id,
        trigger: params.trigger.clone(),
        group_id: params.group_id,
        company_id,
        active: params.active,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        last_run: params.last_run,
        next_run: params.next_run,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "replenishment_rule",
            record_id: rule.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "product_id": params.product_id,
                    "location_id": params.location_id,
                    "min_qty": params.product_min_qty,
                    "max_qty": params.product_max_qty,
                    "trigger": params.trigger,
                    "active": params.active,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "product_id".to_string(),
                "location_id".to_string(),
                "trigger".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Execute replenishment rule — sets last_run to now and schedules next_run in 24h
#[spacetimedb::reducer]
pub fn execute_replenishment_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "replenishment_rule", "execute")?;

    let rule = ctx
        .db
        .replenishment_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    if rule.organization_id != organization_id {
        return Err("Rule does not belong to this organization".to_string());
    }
    if rule.company_id != company_id {
        return Err("Rule does not belong to this company".to_string());
    }
    if !rule.active {
        return Err("Rule is not active".to_string());
    }

    let last_run = ctx.timestamp;
    let next_run = ctx.timestamp + std::time::Duration::from_secs(86400);

    ctx.db.replenishment_rule().id().update(ReplenishmentRule {
        last_run: Some(last_run),
        next_run: Some(next_run),
        updated_at: ctx.timestamp,
        ..rule
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "replenishment_rule",
            record_id: rule_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "last_run": last_run.to_string(),
                    "next_run": next_run.to_string(),
                })
                .to_string(),
            ),
            changed_fields: vec!["last_run".to_string(), "next_run".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
