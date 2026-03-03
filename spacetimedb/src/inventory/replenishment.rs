/// Replenishment — Tables and Reducers
///
/// Tables:
///   - ReplenishmentRule
///   - StockReorderGroup
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use serde_json;

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

/// Create a new replenishment rule
pub fn create_replenishment_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    location_id: u64,
    product_min_qty: f64,
    product_max_qty: f64,
    company_id: u64,
    warehouse_id: Option<u64>,
    uom_id: u64,
    qty_multiple: f64,
    lead_days: i32,
    route_id: Option<u64>,
    trigger: String,
    group_id: Option<u64>,
    active: bool,
    last_run: Option<Timestamp>,
    next_run: Option<Timestamp>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "replenishment_rule", "create")?;

    let qty_to_order = if product_max_qty > product_min_qty {
        product_max_qty - product_min_qty
    } else {
        0.0
    };

    let trigger_clone = trigger.clone();

    let rule = ctx.db.replenishment_rule().insert(ReplenishmentRule {
        id: 0,
        organization_id,
        product_id,
        location_id,
        warehouse_id,
        uom_id,
        product_min_qty,
        product_max_qty,
        qty_multiple,
        qty_to_order,
        lead_days,
        route_id,
        trigger,
        group_id,
        company_id,
        active,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        last_run,
        next_run,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "replenishment_rule",
        rule.id,
        "create",
        None,
        Some(
            serde_json::json!({
                "product_id": product_id,
                "location_id": location_id,
                "min_qty": product_min_qty,
                "max_qty": product_max_qty,
                "trigger": trigger_clone,
                "active": active
            })
            .to_string(),
        ),
        vec![
            "product_id".to_string(),
            "location_id".to_string(),
            "trigger".to_string(),
        ],
    );

    Ok(())
}

/// Execute replenishment rule
pub fn execute_replenishment_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "replenishment_rule", "execute")?;

    if let Some(mut rule) = ctx.db.replenishment_rule().id().find(&rule_id) {
        if !rule.active {
            return Err("Rule is not active".to_string());
        }

        let last_run = Some(ctx.timestamp);
        let next_run = Some(ctx.timestamp + std::time::Duration::from_secs(86400)); // 24 hours later
        rule.last_run = last_run;
        rule.next_run = next_run;
        ctx.db.replenishment_rule().id().update(rule);

        write_audit_log(
            ctx,
            organization_id,
            None,
            "replenishment_rule",
            rule_id,
            "execute",
            None,
            Some(
                serde_json::json!({
                    "last_run": last_run.unwrap().to_string(),
                    "next_run": next_run.map(|t| t.to_string())
                })
                .to_string(),
            ),
            vec!["last_run".to_string()],
        );
    } else {
        return Err("Rule not found".to_string());
    }

    Ok(())
}
