//! Deterministic margin and supply scenario calculations.
//!
//! This module is intentionally advisory: it computes warnings and reference
//! prices but never mutates a product, pricelist, order, or replenishment rule.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
    pub is_service: bool,
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
pub struct MarginSupplySuggestionEvidence {
    pub metric: &'static str,
    pub source: &'static str,
    pub value: f64,
    pub unit: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginSupplySuggestionProvenance {
    pub calculation_version: &'static str,
    pub source_tables: Vec<&'static str>,
    pub scenario_fingerprint: String,
    pub formula: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginSupplySuggestionContext {
    pub suggestion_id: String,
    pub fingerprint: String,
    pub status: &'static str,
    pub product_id: u64,
    pub sku: Option<String>,
    pub product_name: String,
    pub confidence: &'static str,
    pub data_quality: Vec<&'static str>,
    pub evidence: Vec<MarginSupplySuggestionEvidence>,
    pub provenance: MarginSupplySuggestionProvenance,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginSupplyPriceChangeSuggestion {
    #[serde(flatten)]
    pub context: MarginSupplySuggestionContext,
    pub current_unit_price: MoneyAmount,
    pub suggested_unit_price: MoneyAmount,
    pub price_change: MoneyAmount,
    pub price_change_pct: f64,
    pub conditional_gross_profit_uplift: MoneyAmount,
    pub target_gross_margin_pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginSupplyReplenishmentChangeSuggestion {
    #[serde(flatten)]
    pub context: MarginSupplySuggestionContext,
    pub current_available_quantity: f64,
    pub projected_shortfall: f64,
    pub quantity_unavailable: bool,
    pub suggested_quantity: Option<f64>,
    pub effective_lead_days: i32,
    pub reorder_point: f64,
    pub stressed_unit_cost: Option<MoneyAmount>,
    pub expected_working_capital_requirement: Option<MoneyAmount>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MarginSupplySuggestion {
    PriceChange(MarginSupplyPriceChangeSuggestion),
    ReplenishmentChange(MarginSupplyReplenishmentChangeSuggestion),
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
    pub suggestions: Vec<MarginSupplySuggestion>,
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
    let mut eligible_stock = stock
        .into_iter()
        .filter(|quant| quant.available_quantity.is_finite())
        .collect::<Vec<_>>();
    eligible_stock.sort_by_key(|quant| {
        (
            quant.product_id,
            quant.available_quantity.to_bits(),
            quant.is_outdated,
        )
    });
    let mut stock_by_product = BTreeMap::<u64, (f64, bool)>::new();
    for quant in eligible_stock {
        let entry = stock_by_product.entry(quant.product_id).or_default();
        let total = entry.0 + quant.available_quantity;
        if total.is_finite() {
            entry.0 = total;
        }
        entry.1 |= quant.is_outdated;
    }
    let mut rules_by_product = BTreeMap::<u64, (f64, i32)>::new();
    for rule in replenishment
        .into_iter()
        .filter(|rule| rule.active && rule.product_min_qty.is_finite())
    {
        let entry = rules_by_product.entry(rule.product_id).or_default();
        entry.0 = entry.0.max(rule.product_min_qty.max(0.0));
        entry.1 = entry.1.max(rule.lead_days.max(0));
    }
    let mut eligible_sales = sales
        .into_iter()
        .filter(|line| {
            line.currency_id == currency_id
                && line.display_type.is_none()
                && line.product_uom_qty.is_finite()
                && line.price_subtotal.is_finite()
                && line.purchase_price.is_finite()
                && line.product_uom_qty > 0.0
        })
        .collect::<Vec<_>>();
    eligible_sales.sort_by_key(|line| {
        (
            line.product_template_id.unwrap_or(line.product_id),
            line.product_uom_qty.to_bits(),
            line.price_subtotal.to_bits(),
            line.purchase_price.to_bits(),
            line.product_id,
        )
    });
    let mut sales_by_product = BTreeMap::<u64, (f64, f64, i64, i64, bool, bool)>::new();
    for line in eligible_sales {
        let product_id = line.product_template_id.unwrap_or(line.product_id);
        let entry = sales_by_product.entry(product_id).or_default();
        let total_quantity = entry.0 + line.product_uom_qty;
        if total_quantity.is_finite() {
            entry.0 = total_quantity;
            entry.5 |= !line.is_service;
            if line.purchase_price > 0.0 {
                entry.1 += line.product_uom_qty;
                entry.2 = entry.2.saturating_add(money_minor(line.price_subtotal));
                entry.3 = entry
                    .3
                    .saturating_add(money_minor(line.purchase_price * line.product_uom_qty));
            } else {
                entry.4 = true;
            }
        }
    }

    let demand_factor = 1.0 + scenario.demand_change_pct / 100.0;
    let cost_factor = 1.0 + scenario.input_cost_change_pct / 100.0;
    let target_margin_ratio = scenario.target_margin_pct / 100.0;
    let scenario_fingerprint = scenario_fingerprint(&scenario);
    let mut lines = Vec::with_capacity(sales_by_product.len());
    let mut suggestions = Vec::with_capacity(sales_by_product.len() * 2);

    for (
        product_id,
        (
            quantity,
            analyzed_quantity,
            revenue_minor,
            cost_minor,
            has_missing_cost,
            is_stock_managed,
        ),
    ) in sales_by_product
    {
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
        let (reorder_point, base_lead_days, has_lead_time_baseline) = rules_by_product
            .get(&product_id)
            .map(|(reorder_point, lead_days)| (*reorder_point, *lead_days, true))
            .unwrap_or((0.0, 0, false));
        let effective_lead_days = base_lead_days.saturating_add(scenario.lead_time_change_days);
        let daily_demand = quantity * demand_factor / 30.0;
        let demand_during_lead = daily_demand * f64::from(effective_lead_days);
        let projected_stock_shortfall = (is_stock_managed && has_lead_time_baseline)
            .then(|| (demand_during_lead - available_quantity).max(0.0))
            .unwrap_or(0.0);
        let projected_reorder_point_gap = (is_stock_managed && has_lead_time_baseline)
            .then(|| (demand_during_lead + reorder_point - available_quantity).max(0.0))
            .unwrap_or(0.0);
        let days_of_cover =
            (is_stock_managed && daily_demand > 0.0).then_some(available_quantity / daily_demand);
        let target_unit_price = if has_cost_baseline
            && !has_missing_cost
            && analyzed_quantity > 0.0
            && demand_factor > 0.0
            && target_margin_ratio < 1.0
        {
            let stressed_unit_cost_minor =
                (stressed_cost_minor as f64 / (analyzed_quantity * demand_factor)).round() as i64;
            Some(money(
                (stressed_unit_cost_minor as f64 / (1.0 - target_margin_ratio)).round() as i64,
            ))
        } else {
            None
        };

        let mut warning_codes = Vec::new();
        if has_missing_cost || cost_minor <= 0 {
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
        } else if projected_reorder_point_gap > 0.0 {
            warning_codes.push("REPLENISHMENT_THRESHOLD_BREACH");
        }
        if is_stock_managed && !has_lead_time_baseline {
            warning_codes.push("MISSING_LEAD_TIME_BASELINE");
        }
        if is_stock_managed && outdated_stock {
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
        let sku = product.and_then(|product| product.default_code.clone());
        let product_name = product
            .map(|product| {
                product
                    .display_name
                    .clone()
                    .unwrap_or_else(|| product.name.clone())
            })
            .unwrap_or_else(|| format!("Product #{product_id}"));
        let current_unit_price_minor = if analyzed_quantity > 0.0 {
            (revenue_minor as f64 / analyzed_quantity).round() as i64
        } else {
            0
        };
        let stressed_unit_cost_minor = has_cost_baseline
            .then(|| ((cost_minor as f64 / analyzed_quantity) * cost_factor).round() as i64);

        if !has_missing_cost && warning_codes.contains(&"MARGIN_BELOW_TARGET") {
            if let Some(suggested_unit_price) = target_unit_price.as_ref() {
                let price_change_minor =
                    suggested_unit_price.minor_units - current_unit_price_minor;
                if current_unit_price_minor > 0 && price_change_minor > 0 {
                    let conditional_gross_profit_uplift_minor =
                        scale_money(price_change_minor, quantity * demand_factor);
                    let fingerprint = suggestion_fingerprint(
                        "price_change",
                        product_id,
                        &[
                            (
                                "current_unit_price_minor",
                                current_unit_price_minor.to_string(),
                            ),
                            (
                                "suggested_unit_price_minor",
                                suggested_unit_price.minor_units.to_string(),
                            ),
                            (
                                "stressed_quantity",
                                canonical_quantity(quantity * demand_factor),
                            ),
                            ("scenario", scenario_fingerprint.clone()),
                        ],
                    );
                    suggestions.push(MarginSupplySuggestion::PriceChange(
                        MarginSupplyPriceChangeSuggestion {
                            context: suggestion_context(
                                "price-change",
                                product_id,
                                sku.clone(),
                                product_name.clone(),
                                "medium",
                                vec![
                                    "SALES_PRICE_IS_PERIOD_WEIGHTED_AVERAGE",
                                    "COST_IS_SALES_LINE_SNAPSHOT_NOT_POSTED_COGS",
                                    "USER_PROVIDED_SCENARIO_ASSUMPTIONS",
                                    "NO_PRICE_ELASTICITY_OR_MIX_RESPONSE_MODELED",
                                ],
                                vec![
                                    MarginSupplySuggestionEvidence {
                                        metric: "current_unit_price",
                                        source: "sale_order_line.price_subtotal",
                                        value: current_unit_price_minor as f64,
                                        unit: "minor_currency_units",
                                    },
                                    MarginSupplySuggestionEvidence {
                                        metric: "stressed_unit_cost",
                                        source: "sale_order_line.purchase_price",
                                        value: stressed_unit_cost_minor.unwrap_or_default() as f64,
                                        unit: "minor_currency_units",
                                    },
                                    MarginSupplySuggestionEvidence {
                                        metric: "target_gross_margin",
                                        source: "scenario.target_margin_pct",
                                        value: scenario.target_margin_pct,
                                        unit: "percent",
                                    },
                                    MarginSupplySuggestionEvidence {
                                        metric: "stressed_scenario_quantity",
                                        source: "sale_order_line.product_uom_qty and scenario.demand_change_pct",
                                        value: quantity * demand_factor,
                                        unit: "quantity",
                                    },
                                ],
                                MarginSupplySuggestionProvenance {
                                    calculation_version: "margin_supply_suggestions_v1",
                                    source_tables: vec!["sale_order_line"],
                                    scenario_fingerprint: scenario_fingerprint.clone(),
                                    formula: "suggested_unit_price = stressed_unit_cost / (1 - target_gross_margin); conditional_gross_profit_uplift = price_change * stressed_scenario_quantity; assumes all scenario units sell at the suggested price with no demand elasticity or mix response",
                                },
                                fingerprint,
                            ),
                            current_unit_price: money(current_unit_price_minor),
                            suggested_unit_price: suggested_unit_price.clone(),
                            price_change: money(price_change_minor),
                            price_change_pct: price_change_minor as f64
                                / current_unit_price_minor as f64
                                * 100.0,
                            conditional_gross_profit_uplift: money(
                                conditional_gross_profit_uplift_minor,
                            ),
                            target_gross_margin_pct: scenario.target_margin_pct,
                        },
                    ));
                }
            }
        }

        if projected_stock_shortfall > 0.0 {
            let fingerprint = suggestion_fingerprint(
                "replenishment_change",
                product_id,
                &[
                    ("available_quantity", canonical_quantity(available_quantity)),
                    (
                        "projected_shortfall",
                        canonical_quantity(projected_stock_shortfall),
                    ),
                    ("reorder_point", canonical_quantity(reorder_point)),
                    ("effective_lead_days", effective_lead_days.to_string()),
                    (
                        "stressed_unit_cost_minor",
                        if has_missing_cost {
                            "missing".into()
                        } else {
                            stressed_unit_cost_minor
                                .map_or_else(|| "missing".into(), |value| value.to_string())
                        },
                    ),
                    ("scenario", scenario_fingerprint.clone()),
                ],
            );
            let mut data_quality = vec![
                "DEMAND_IS_THIRTY_DAY_SALES_PROXY",
                "INVENTORY_IS_AGGREGATED_CURRENT_SNAPSHOT",
                "QUANTITY_REQUIRES_LOCATION_OPEN_PO_AND_ORDER_MULTIPLE_DATA",
                "USER_PROVIDED_SCENARIO_ASSUMPTIONS",
            ];
            if outdated_stock {
                data_quality.push("STALE_INVENTORY_COUNT");
            }
            if has_missing_cost || !has_cost_baseline {
                data_quality.push("MISSING_COST_BASELINE");
            }
            suggestions.push(MarginSupplySuggestion::ReplenishmentChange(
                MarginSupplyReplenishmentChangeSuggestion {
                    context: suggestion_context(
                        "replenishment-change",
                        product_id,
                        sku.clone(),
                        product_name.clone(),
                        if outdated_stock || has_missing_cost || !has_cost_baseline {
                            "low"
                        } else {
                            "medium"
                        },
                        data_quality,
                        vec![
                            MarginSupplySuggestionEvidence {
                                metric: "available_quantity",
                                source: "stock_quant.available_quantity",
                                value: available_quantity,
                                unit: "quantity",
                            },
                            MarginSupplySuggestionEvidence {
                                metric: "projected_demand_during_lead",
                                source: "sale_order_line.product_uom_qty",
                                value: demand_during_lead,
                                unit: "quantity",
                            },
                            MarginSupplySuggestionEvidence {
                                metric: "reorder_point",
                                source: "replenishment_rule.product_min_qty",
                                value: reorder_point,
                                unit: "quantity",
                            },
                            MarginSupplySuggestionEvidence {
                                metric: "effective_lead_days",
                                source: "replenishment_rule.lead_days",
                                value: f64::from(effective_lead_days),
                                unit: "days",
                            },
                        ],
                        MarginSupplySuggestionProvenance {
                            calculation_version: "margin_supply_suggestions_v1",
                            source_tables: vec![
                                "sale_order_line",
                                "stock_quant",
                                "replenishment_rule",
                            ],
                            scenario_fingerprint: scenario_fingerprint.clone(),
                            formula: "projected_stock_shortfall = max(0, demand_during_effective_lead - aggregated_available_quantity); actionable quantity withheld pending location, open-PO, and order-multiple review",
                        },
                        fingerprint,
                    ),
                    current_available_quantity: available_quantity,
                    projected_shortfall: projected_stock_shortfall,
                    quantity_unavailable: true,
                    suggested_quantity: None,
                    effective_lead_days,
                    reorder_point,
                    stressed_unit_cost: if has_missing_cost {
                        None
                    } else {
                        stressed_unit_cost_minor.map(money)
                    },
                    expected_working_capital_requirement: None,
                },
            ));
        }
        lines.push(MarginSupplyLine {
            product_id,
            sku,
            product_name,
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
    if lines
        .iter()
        .any(|line| line.warning_codes.contains(&"MISSING_LEAD_TIME_BASELINE"))
    {
        recommendations.push("Add or review an active replenishment rule before relying on stockout timing for the affected products.".into());
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
        suggestions,
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

#[allow(clippy::too_many_arguments)]
fn suggestion_context(
    id_prefix: &str,
    product_id: u64,
    sku: Option<String>,
    product_name: String,
    confidence: &'static str,
    data_quality: Vec<&'static str>,
    evidence: Vec<MarginSupplySuggestionEvidence>,
    provenance: MarginSupplySuggestionProvenance,
    fingerprint: String,
) -> MarginSupplySuggestionContext {
    MarginSupplySuggestionContext {
        suggestion_id: format!(
            "margin-supply:{id_prefix}:{product_id}:{}",
            fingerprint.trim_start_matches("sha256:")
        ),
        fingerprint,
        status: "review_required",
        product_id,
        sku,
        product_name,
        confidence,
        data_quality,
        evidence,
        provenance,
    }
}

fn scenario_fingerprint(scenario: &MarginSupplyScenario) -> String {
    let fields = vec![
        (
            "input_cost_change_pct",
            canonical_number(scenario.input_cost_change_pct),
        ),
        (
            "demand_change_pct",
            canonical_number(scenario.demand_change_pct),
        ),
        (
            "lead_time_change_days",
            scenario.lead_time_change_days.to_string(),
        ),
        (
            "target_margin_pct",
            canonical_number(scenario.target_margin_pct),
        ),
    ];
    suggestion_fingerprint("scenario", 0, &fields)
}

fn suggestion_fingerprint(kind: &str, product_id: u64, fields: &[(&str, String)]) -> String {
    let mut digest = Sha256::new();
    hash_field(
        &mut digest,
        "calculation_version",
        "margin_supply_suggestions_v1",
    );
    hash_field(&mut digest, "kind", kind);
    hash_field(&mut digest, "product_id", &product_id.to_string());
    for (name, value) in fields {
        hash_field(&mut digest, name, value);
    }
    format!("sha256:{}", hex::encode(digest.finalize()))
}

fn hash_field(digest: &mut Sha256, name: &str, value: &str) {
    digest.update((name.len() as u64).to_be_bytes());
    digest.update(name.as_bytes());
    digest.update((value.len() as u64).to_be_bytes());
    digest.update(value.as_bytes());
}

fn canonical_number(value: f64) -> String {
    if value == 0.0 {
        "0".into()
    } else if value.is_finite() {
        format!("{value:.9}")
    } else {
        "invalid".into()
    }
}

fn canonical_quantity(value: f64) -> String {
    canonical_number(value)
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
            provenance: None,
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
                is_service: false,
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
        assert_eq!(report.suggestions.len(), 2);
        let price = report
            .suggestions
            .iter()
            .find_map(|suggestion| match suggestion {
                MarginSupplySuggestion::PriceChange(value) => Some(value),
                MarginSupplySuggestion::ReplenishmentChange(_) => None,
            })
            .expect("price review suggestion");
        assert_eq!(price.context.status, "review_required");
        assert_eq!(price.current_unit_price.minor_units, 10_000);
        assert_eq!(price.suggested_unit_price.minor_units, 10_286);
        assert_eq!(price.conditional_gross_profit_uplift.minor_units, 9_438);
        assert!(price.context.fingerprint.starts_with("sha256:"));

        let replenishment = report
            .suggestions
            .iter()
            .find_map(|suggestion| match suggestion {
                MarginSupplySuggestion::PriceChange(_) => None,
                MarginSupplySuggestion::ReplenishmentChange(value) => Some(value),
            })
            .expect("replenishment review suggestion");
        assert_eq!(replenishment.context.status, "review_required");
        assert_eq!(replenishment.projected_shortfall, 11.5);
        assert!(replenishment.quantity_unavailable);
        assert_eq!(replenishment.suggested_quantity, None);
        assert_eq!(replenishment.expected_working_capital_requirement, None);
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
                is_service: false,
                display_type: None,
            },
            MarginSaleLineRow {
                product_id: 2,
                product_template_id: None,
                product_uom_qty: 1.0,
                price_subtotal: 10.0,
                purchase_price: 5.0,
                currency_id: 7,
                is_service: false,
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
                is_service: false,
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
        assert_eq!(report.lines[0].target_unit_price, None);
        assert!(report
            .suggestions
            .iter()
            .all(|suggestion| !matches!(suggestion, MarginSupplySuggestion::PriceChange(_))));
    }

    #[test]
    fn suggestion_fingerprints_are_stable_when_source_order_changes() {
        let sale = |quantity, subtotal| MarginSaleLineRow {
            product_id: 1,
            product_template_id: None,
            product_uom_qty: quantity,
            price_subtotal: subtotal,
            purchase_price: 80.0,
            currency_id: 7,
            is_service: false,
            display_type: None,
        };
        let stock = |quantity| MarginStockRow {
            product_id: 1,
            available_quantity: quantity,
            is_outdated: false,
        };
        let first = margin_supply_outlook(
            vec![sale(1.1, 110.0), sale(2.2, 220.0), sale(3.3, 330.0)],
            vec![],
            vec![stock(2.0), stock(3.0)],
            vec![MarginReplenishmentRow {
                product_id: 1,
                product_min_qty: 2.0,
                lead_days: 30,
                active: true,
            }],
            7,
            scenario(),
        );
        let second = margin_supply_outlook(
            vec![sale(3.3, 330.0), sale(1.1, 110.0), sale(2.2, 220.0)],
            vec![],
            vec![stock(3.0), stock(2.0)],
            vec![MarginReplenishmentRow {
                product_id: 1,
                product_min_qty: 2.0,
                lead_days: 30,
                active: true,
            }],
            7,
            scenario(),
        );

        let first_ids = first
            .suggestions
            .iter()
            .map(|suggestion| match suggestion {
                MarginSupplySuggestion::PriceChange(value) => &value.context.suggestion_id,
                MarginSupplySuggestion::ReplenishmentChange(value) => &value.context.suggestion_id,
            })
            .collect::<Vec<_>>();
        let second_ids = second
            .suggestions
            .iter()
            .map(|suggestion| match suggestion {
                MarginSupplySuggestion::PriceChange(value) => &value.context.suggestion_id,
                MarginSupplySuggestion::ReplenishmentChange(value) => &value.context.suggestion_id,
            })
            .collect::<Vec<_>>();
        assert_eq!(first_ids, second_ids);
    }

    #[test]
    fn calculation_fingerprint_ignores_import_audit_timestamp() {
        use crate::reports::common::{MarginSupplyScenarioProvenance, MarginSupplyScenarioSource};

        let with_timestamp = |imported_at: &str| MarginSupplyScenario {
            provenance: Some(MarginSupplyScenarioProvenance {
                source: MarginSupplyScenarioSource::ControlledCsv,
                file_name: Some("scenario.csv".into()),
                imported_at: Some(imported_at.into()),
                row_number: Some(2),
            }),
            ..scenario()
        };

        assert_eq!(
            scenario_fingerprint(&with_timestamp("2026-10-18T12:00:00Z")),
            scenario_fingerprint(&with_timestamp("2026-10-19T12:00:00Z")),
        );
    }

    #[test]
    fn non_finite_source_rows_never_produce_suggestions() {
        let report = margin_supply_outlook(
            vec![MarginSaleLineRow {
                product_id: 1,
                product_template_id: None,
                product_uom_qty: f64::NAN,
                price_subtotal: 100.0,
                purchase_price: 50.0,
                currency_id: 7,
                is_service: false,
                display_type: None,
            }],
            vec![],
            vec![MarginStockRow {
                product_id: 1,
                available_quantity: f64::INFINITY,
                is_outdated: false,
            }],
            vec![],
            7,
            scenario(),
        );

        assert!(report.lines.is_empty());
        assert!(report.suggestions.is_empty());
    }

    #[test]
    fn mixed_cost_coverage_withholds_price_suggestion() {
        let sale = |purchase_price| MarginSaleLineRow {
            product_id: 1,
            product_template_id: None,
            product_uom_qty: 1.0,
            price_subtotal: 100.0,
            purchase_price,
            currency_id: 7,
            is_service: false,
            display_type: None,
        };
        let report = margin_supply_outlook(
            vec![sale(80.0), sale(0.0)],
            vec![],
            vec![MarginStockRow {
                product_id: 1,
                available_quantity: 0.0,
                is_outdated: false,
            }],
            vec![MarginReplenishmentRow {
                product_id: 1,
                product_min_qty: 0.0,
                lead_days: 30,
                active: true,
            }],
            7,
            scenario(),
        );

        assert!(report.lines[0]
            .warning_codes
            .contains(&"MISSING_COST_BASELINE"));
        assert_eq!(report.lines[0].baseline_revenue.minor_units, 10_000);
        assert_eq!(report.lines[0].baseline_cost.minor_units, 8_000);
        assert_eq!(report.lines[0].target_unit_price, None);
        assert!(report
            .suggestions
            .iter()
            .all(|suggestion| !matches!(suggestion, MarginSupplySuggestion::PriceChange(_))));
        let replenishment = report
            .suggestions
            .iter()
            .find_map(|suggestion| match suggestion {
                MarginSupplySuggestion::ReplenishmentChange(value) => Some(value),
                MarginSupplySuggestion::PriceChange(_) => None,
            })
            .expect("replenishment review warning");
        assert_eq!(replenishment.context.confidence, "low");
        assert!(replenishment
            .context
            .data_quality
            .contains(&"MISSING_COST_BASELINE"));
        assert_eq!(replenishment.stressed_unit_cost, None);
    }

    #[test]
    fn missing_lead_time_baseline_withholds_stockout_suggestion() {
        let report = margin_supply_outlook(
            vec![MarginSaleLineRow {
                product_id: 1,
                product_template_id: None,
                product_uom_qty: 30.0,
                price_subtotal: 3_000.0,
                purchase_price: 50.0,
                currency_id: 7,
                is_service: false,
                display_type: None,
            }],
            vec![],
            vec![MarginStockRow {
                product_id: 1,
                available_quantity: 0.0,
                is_outdated: false,
            }],
            vec![],
            7,
            scenario(),
        );

        assert_eq!(report.lines[0].projected_stock_shortfall, 0.0);
        assert!(report.lines[0]
            .warning_codes
            .contains(&"MISSING_LEAD_TIME_BASELINE"));
        assert!(report.suggestions.iter().all(|suggestion| !matches!(
            suggestion,
            MarginSupplySuggestion::ReplenishmentChange(_)
        )));
    }

    #[test]
    fn reorder_point_gap_is_not_mislabeled_as_stockout() {
        let report = margin_supply_outlook(
            vec![MarginSaleLineRow {
                product_id: 1,
                product_template_id: None,
                product_uom_qty: 5.0,
                price_subtotal: 500.0,
                purchase_price: 50.0,
                currency_id: 7,
                is_service: false,
                display_type: None,
            }],
            vec![],
            vec![MarginStockRow {
                product_id: 1,
                available_quantity: 12.0,
                is_outdated: false,
            }],
            vec![MarginReplenishmentRow {
                product_id: 1,
                product_min_qty: 10.0,
                lead_days: 30,
                active: true,
            }],
            7,
            MarginSupplyScenario {
                input_cost_change_pct: 0.0,
                demand_change_pct: 0.0,
                lead_time_change_days: 0,
                target_margin_pct: 25.0,
                provenance: None,
            },
        );

        assert_eq!(report.lines[0].projected_stock_shortfall, 0.0);
        assert!(report.lines[0]
            .warning_codes
            .contains(&"REPLENISHMENT_THRESHOLD_BREACH"));
        assert!(!report.lines[0]
            .warning_codes
            .contains(&"STOCKOUT_BEFORE_REPLENISHMENT"));
        assert!(report.suggestions.iter().all(|suggestion| !matches!(
            suggestion,
            MarginSupplySuggestion::ReplenishmentChange(_)
        )));
    }

    #[test]
    fn service_sales_do_not_produce_inventory_warnings() {
        let report = margin_supply_outlook(
            vec![MarginSaleLineRow {
                product_id: 1,
                product_template_id: None,
                product_uom_qty: 5.0,
                price_subtotal: 500.0,
                purchase_price: 50.0,
                currency_id: 7,
                is_service: true,
                display_type: None,
            }],
            vec![],
            vec![],
            vec![],
            7,
            scenario(),
        );

        assert_eq!(report.lines[0].days_of_cover, None);
        assert_eq!(report.lines[0].projected_stock_shortfall, 0.0);
        assert!(!report.lines[0]
            .warning_codes
            .contains(&"MISSING_LEAD_TIME_BASELINE"));
        assert!(!report.lines[0]
            .warning_codes
            .contains(&"STOCKOUT_BEFORE_REPLENISHMENT"));
        assert!(report.suggestions.iter().all(|suggestion| !matches!(
            suggestion,
            MarginSupplySuggestion::ReplenishmentChange(_)
        )));
    }
}
