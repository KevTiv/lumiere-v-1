//! Inbound costing helpers — align quant layers with product cost methods.
//!
//! FIFO/LIFO are represented as multiple `stock_quant` rows at the same
//! product+location+owner with distinct `in_date` / `cost` (no separate layer table).
use spacetimedb::ReducerContext;

use crate::inventory::product::{product, Product};

const COST_EPS: f64 = 1e-6;

/// Normalize product cost_method to a known owned token.
pub fn normalize_cost_method(method: &str) -> String {
    match method.trim().to_ascii_lowercase().as_str() {
        "fifo" => "fifo".to_string(),
        "lifo" => "lifo".to_string(),
        "average" | "avg" | "weighted_average" => "average".to_string(),
        _ => "standard".to_string(),
    }
}

/// Resolve unit cost for an inbound move given product method and move price.
pub fn resolve_inbound_unit_cost(product: &Product, move_price_unit: f64) -> f64 {
    match normalize_cost_method(&product.cost_method).as_str() {
        "standard" => product.standard_price,
        _ if move_price_unit > 0.0 => move_price_unit,
        _ => product.standard_price,
    }
}

pub fn costs_match(a: f64, b: f64) -> bool {
    (a - b).abs() <= COST_EPS
}

/// Look up product or return a clear error.
pub fn product_for_costing(ctx: &ReducerContext, product_id: u64) -> Result<Product, String> {
    ctx.db
        .product()
        .id()
        .find(&product_id)
        .ok_or_else(|| format!("Product {} not found for costing", product_id))
}
