//! Deterministic margin and supply scenario calculations.
//!
//! This module is intentionally advisory: it computes warnings and reference
//! prices but never mutates a product, pricelist, order, or replenishment rule.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{common::MarginSupplyScenario, daily_business_summary::MoneyAmount};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginSaleLineRow {
    pub product_id: u64,
    pub product_template_id: Option<u64>,
    pub product_uom_qty: f64,
    pub price_subtotal: f64,
    pub purchase_price: f64,
    pub currency_id: u64,
    pub display_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginProductRow {
    pub product_tmpl_id: u64,
    pub name: String,
    pub display_name: Option<String>,
    pub default_code: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginStockRow {
    pub product_id: u64,
    pub available_quantity: f64,
    pub is_outdated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginReplenishmentRow {
    pub product_id: u64,
    pub product_min_qty: f64,
    pub lead_days: i32,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginSupplyLine {
    pub product_id: u64,
    pub sku: Option<String>,
    pub product_name: String,
    pub quantity_sold: f64,
    pub available_quantity: f64,
    pub baseline_revenue: MoneyAmount,
    pub baseline_cost: MoneyAmount,
    pub baseline_gross_profit: MoneyAmount,
    pub baseline_margin_pct: Option<f64>,
    pub stressed_revenue: MoneyAmount,
    pub stressed_cost: MoneyAmount,
    pub stressed_gross_profit: MoneyAmount,
    pub stressed_margin_pct: Option<f64>,
    pub margin_change_points: Option<f64>,
    pub profit_at_risk: MoneyAmount,
    /// Advisory reference only; no product or pricelist value is changed.
    pub target_unit_price: Option<MoneyAmount>,
    pub effective_lead_days: i32,
    pub days_of_cover: Option<f64>,
    pub projected_stock_shortfall: f64,
    pub severity: &'static str,
    pub warning_codes: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginSupplyOutlookReportV1 {
    pub scenario: MarginSupplyScenario,
    pub product_count: usize,
    pub warning_count: usize,
    pub critical_count: usize,
    pub baseline_revenue: MoneyAmount,
    pub baseline_cost: MoneyAmount,
    pub baseline_gross_profit: MoneyAmount,
    pub baseline_margin_pct: Option<f64>,
    pub stressed_revenue: MoneyAmount,
    pub stressed_cost: MoneyAmount,
    pub stressed_gross_profit: MoneyAmount,
    pub stressed_margin_pct: Option<f64>,
    pub profit_at_risk: MoneyAmount,
    pub projected_stock_shortfall: f64,
    pub recommendations: Vec<String>,
    pub lines: Vec<MarginSupplyLine>,
}

pub fn margin_supply_outlook(
    sales: Vec<MarginSaleLineRow>,
    products: Vec<MarginProductRow>,
    stock: Vec<MarginStockRow>,
    replenishment: Vec<MarginReplenishmentRow>,
    currency_id: u64,
    scenario: MarginSupplyScenario,
) -> MarginSupplyOutlookReportV1 {
    let products = products
        .into_iter()
        .map(|product| (product.product_tmpl_id, product))
        .collect::<BTreeMap<_, _>>();
    let mut stock_by_product = BTreeMap::<u64, (f64, bool)>::new();
    for quant in stock {
        let entry = stock_by_product.entry(quant.product_id).or_default();
        entry.0 += quant.available_quantity;
        entry.1 |= quant.is_outdated;
    }
    let mut rules_by_product = BTreeMap::<u64, (f64, i32)>::new();
    for rule in replenishment.into_iter().filter(|rule| rule.active) {
        let entry = rules_by_product.entry(rule.product_id).or_default();
        entry.0 = entry.0.max(rule.product_min_qty.max(0.0));
        entry.1 = entry.1.max(rule.lead_days.max(0));
    }
    let mut sales_by_product = BTreeMap::<u64, (f64, i64, i64)>::new();
    for line in sales.into_iter().filter(|line| {
        line.currency_id == currency_id && line.display_type.is_none() && line.product_uom_qty > 0.0
    }) {
        let product_id = line.product_template_id.unwrap_or(line.product_id);
        let entry = sales_by_product.entry(product_id).or_default();
        entry.0 += line.product_uom_qty;
        entry.1 += money_minor(line.price_subtotal);
        entry.2 += money_minor(line.purchase_price.max(0.0) * line.product_uom_qty);
    }

    let demand_factor = 1.0 + scenario.demand_change_pct / 100.0;
    let cost_factor = 1.0 + scenario.input_cost_change_pct / 100.0;
    let target_margin_ratio = scenario.target_margin_pct / 100.0;
    let mut lines = Vec::with_capacity(sales_by_product.len());

    for (product_id, (quantity, revenue_minor, cost_minor)) in sales_by_product {
        let stressed_revenue_minor = scale_money(revenue_minor, demand_factor);
        let stressed_cost_minor = scale_money(cost_minor, demand_factor * cost_factor);
        let has_cost_baseline = cost_minor > 0;
        let baseline_profit_minor = has_cost_baseline
            .then_some(revenue_minor - cost_minor)
            .unwrap_or(0);
        let stressed_profit_minor = has_cost_baseline
            .then_some(stressed_revenue_minor - stressed_cost_minor)
            .unwrap_or(0);
        let baseline_margin_pct = if has_cost_baseline {
            margin_pct(baseline_profit_minor, revenue_minor)
        } else {
            None
        };
        let stressed_margin_pct = if has_cost_baseline {
            margin_pct(stressed_profit_minor, stressed_revenue_minor)
        } else {
            None
        };
        let profit_at_risk_minor = (baseline_profit_minor - stressed_profit_minor).max(0);
        let (available_quantity, outdated_stock) = stock_by_product
            .get(&product_id)
            .copied()
            .unwrap_or_default();
        let (reorder_point, base_lead_days) = rules_by_product
            .get(&product_id)
            .copied()
            .unwrap_or_default();
        let effective_lead_days = base_lead_days + scenario.lead_time_change_days;
        let daily_demand = quantity * demand_factor / 30.0;
        let demand_during_lead = daily_demand * f64::from(effective_lead_days);
        let projected_stock_shortfall =
            (demand_during_lead + reorder_point - available_quantity).max(0.0);
        let days_of_cover = (daily_demand > 0.0).then_some(available_quantity / daily_demand);
        let target_unit_price = if has_cost_baseline
            && quantity > 0.0
            && demand_factor > 0.0
            && target_margin_ratio < 1.0
        {
            let stressed_unit_cost_minor =
                (stressed_cost_minor as f64 / (quantity * demand_factor)).round() as i64;
            Some(money(
                (stressed_unit_cost_minor as f64 / (1.0 - target_margin_ratio)).round() as i64,
            ))
        } else {
            None
        };

        let mut warning_codes = Vec::new();
        if cost_minor <= 0 {
            warning_codes.push("MISSING_COST_BASELINE");
        }
        if stressed_margin_pct.is_some_and(|margin| margin < scenario.target_margin_pct) {
            warning_codes.push("MARGIN_BELOW_TARGET");
        }
        if profit_at_risk_minor > 0 {
            warning_codes.push("PROFIT_AT_RISK");
        }
        if projected_stock_shortfall > 0.0 {
            warning_codes.push("STOCKOUT_BEFORE_REPLENISHMENT");
        }
        if outdated_stock {
            warning_codes.push("STALE_INVENTORY_COUNT");
        }
        let severity = if stressed_profit_minor < 0 || projected_stock_shortfall > 0.0 {
            "critical"
        } else if warning_codes.is_empty() {
            "ok"
        } else {
            "warning"
        };
        let product = products.get(&product_id);
        lines.push(MarginSupplyLine {
            product_id,
            sku: product.and_then(|product| product.default_code.clone()),
            product_name: product
                .map(|product| {
                    product
                        .display_name
                        .clone()
                        .unwrap_or_else(|| product.name.clone())
                })
                .unwrap_or_else(|| format!("Product #{product_id}")),
            quantity_sold: quantity,
            available_quantity,
            baseline_revenue: money(revenue_minor),
            baseline_cost: money(cost_minor),
            baseline_gross_profit: money(baseline_profit_minor),
            baseline_margin_pct,
            stressed_revenue: money(stressed_revenue_minor),
            stressed_cost: money(stressed_cost_minor),
            stressed_gross_profit: money(stressed_profit_minor),
            stressed_margin_pct,
            margin_change_points: baseline_margin_pct
                .zip(stressed_margin_pct)
                .map(|(baseline, stressed)| stressed - baseline),
            profit_at_risk: money(profit_at_risk_minor),
            target_unit_price,
            effective_lead_days,
            days_of_cover,
            projected_stock_shortfall,
            severity,
            warning_codes,
        });
    }
    lines.sort_by(|left, right| {
        severity_rank(left.severity)
            .cmp(&severity_rank(right.severity))
            .then(
                right
                    .profit_at_risk
                    .minor_units
                    .cmp(&left.profit_at_risk.minor_units),
            )
            .then(left.product_id.cmp(&right.product_id))
    });

    let baseline_revenue_minor: i64 = lines
        .iter()
        .filter(|line| line.baseline_cost.minor_units > 0)
        .map(|line| line.baseline_revenue.minor_units)
        .sum();
    let baseline_cost_minor: i64 = lines
        .iter()
        .map(|line| line.baseline_cost.minor_units)
        .sum();
    let stressed_revenue_minor: i64 = lines
        .iter()
        .filter(|line| line.baseline_cost.minor_units > 0)
        .map(|line| line.stressed_revenue.minor_units)
        .sum();
    let stressed_cost_minor: i64 = lines
        .iter()
        .map(|line| line.stressed_cost.minor_units)
        .sum();
    let baseline_profit_minor = baseline_revenue_minor - baseline_cost_minor;
    let stressed_profit_minor = stressed_revenue_minor - stressed_cost_minor;
    let profit_at_risk_minor = (baseline_profit_minor - stressed_profit_minor).max(0);
    let critical_count = lines
        .iter()
        .filter(|line| line.severity == "critical")
        .count();
    let warning_count = lines.iter().filter(|line| line.severity != "ok").count();
    let projected_stock_shortfall = lines
        .iter()
        .map(|line| line.projected_stock_shortfall)
        .sum();
    let mut recommendations = Vec::new();
    if lines
        .iter()
        .any(|line| line.warning_codes.contains(&"MARGIN_BELOW_TARGET"))
    {
        recommendations.push("Review affected products' cost assumptions, discounts, and advisory target prices before the next commercial decision.".into());
    }
    if projected_stock_shortfall > 0.0 {
        recommendations.push("Review replenishment quantities and supplier lead times for products projected to run short; this report does not create purchase orders.".into());
    }
    if lines
        .iter()
        .any(|line| line.warning_codes.contains(&"MISSING_COST_BASELINE"))
    {
        recommendations.push("Complete missing sales-line cost snapshots before relying on gross-margin projections.".into());
    }

    MarginSupplyOutlookReportV1 {
        scenario,
        product_count: lines.len(),
        warning_count,
        critical_count,
        baseline_revenue: money(baseline_revenue_minor),
        baseline_cost: money(baseline_cost_minor),
        baseline_gross_profit: money(baseline_profit_minor),
        baseline_margin_pct: margin_pct(baseline_profit_minor, baseline_revenue_minor),
        stressed_revenue: money(stressed_revenue_minor),
        stressed_cost: money(stressed_cost_minor),
        stressed_gross_profit: money(stressed_profit_minor),
        stressed_margin_pct: margin_pct(stressed_profit_minor, stressed_revenue_minor),
        profit_at_risk: money(profit_at_risk_minor),
        projected_stock_shortfall,
        recommendations,
        lines,
    }
}

fn severity_rank(severity: &str) -> u8 {
    match severity {
        "critical" => 0,
        "warning" => 1,
        _ => 2,
    }
}

fn margin_pct(profit_minor: i64, revenue_minor: i64) -> Option<f64> {
    (revenue_minor != 0).then_some(profit_minor as f64 / revenue_minor as f64 * 100.0)
}

fn scale_money(value: i64, factor: f64) -> i64 {
    (value as f64 * factor).round() as i64
}

fn money_minor(value: f64) -> i64 {
    (value * 100.0).round() as i64
}

fn money(minor_units: i64) -> MoneyAmount {
    MoneyAmount {
        minor_units,
        scale: 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scenario() -> MarginSupplyScenario {
        MarginSupplyScenario {
            input_cost_change_pct: 20.0,
            demand_change_pct: 10.0,
            lead_time_change_days: 5,
            target_margin_pct: 30.0,
        }
    }

    #[test]
    fn models_margin_erosion_and_stockout_without_mutating_inputs() {
        let report = margin_supply_outlook(
            vec![MarginSaleLineRow {
                product_id: 10,
                product_template_id: Some(1),
                product_uom_qty: 30.0,
                price_subtotal: 3_000.0,
                purchase_price: 60.0,
                currency_id: 7,
                display_type: None,
            }],
            vec![MarginProductRow {
                product_tmpl_id: 1,
                name: "Widget".into(),
                display_name: None,
                default_code: Some("W-1".into()),
            }],
            vec![MarginStockRow {
                product_id: 1,
                available_quantity: 5.0,
                is_outdated: false,
            }],
            vec![MarginReplenishmentRow {
                product_id: 1,
                product_min_qty: 2.0,
                lead_days: 10,
                active: true,
            }],
            7,
            scenario(),
        );

        assert_eq!(report.baseline_revenue.minor_units, 300_000);
        assert_eq!(report.baseline_cost.minor_units, 180_000);
        assert_eq!(report.stressed_revenue.minor_units, 330_000);
        assert_eq!(report.stressed_cost.minor_units, 237_600);
        assert_eq!(report.profit_at_risk.minor_units, 27_600);
        assert_eq!(report.critical_count, 1);
        assert!(report.lines[0]
            .warning_codes
            .contains(&"STOCKOUT_BEFORE_REPLENISHMENT"));
        assert!(report.lines[0].target_unit_price.is_some());
    }

    #[test]
    fn excludes_other_currencies_and_display_lines() {
        let lines = vec![
            MarginSaleLineRow {
                product_id: 1,
                product_template_id: None,
                product_uom_qty: 1.0,
                price_subtotal: 10.0,
                purchase_price: 5.0,
                currency_id: 8,
                display_type: None,
            },
            MarginSaleLineRow {
                product_id: 2,
                product_template_id: None,
                product_uom_qty: 1.0,
                price_subtotal: 10.0,
                purchase_price: 5.0,
                currency_id: 7,
                display_type: Some("note".into()),
            },
        ];
        let report = margin_supply_outlook(lines, vec![], vec![], vec![], 7, scenario());
        assert_eq!(report.product_count, 0);
    }

    #[test]
    fn excludes_missing_costs_from_margin_totals() {
        let report = margin_supply_outlook(
            vec![MarginSaleLineRow {
                product_id: 1,
                product_template_id: None,
                product_uom_qty: 2.0,
                price_subtotal: 100.0,
                purchase_price: 0.0,
                currency_id: 7,
                display_type: None,
            }],
            vec![],
            vec![],
            vec![],
            7,
            scenario(),
        );

        assert_eq!(report.baseline_revenue.minor_units, 0);
        assert_eq!(report.baseline_gross_profit.minor_units, 0);
        assert_eq!(report.baseline_margin_pct, None);
        assert!(report.lines[0]
            .warning_codes
            .contains(&"MISSING_COST_BASELINE"));
    }
}
