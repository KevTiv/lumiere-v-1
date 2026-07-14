//! Current inventory snapshot for the low-stock owner report.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockQuantSourceRow {
    pub product_id: u64,
    pub quantity: f64,
    pub reserved_quantity: f64,
    pub available_quantity: f64,
    pub is_outdated: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSourceRow {
    /// Stock quants reference the product template, not a product-variant row.
    pub product_tmpl_id: u64,
    pub name: String,
    pub display_name: Option<String>,
    pub default_code: Option<String>,
    pub virtual_available: f64,
    pub reordering_min_qty: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LowStockLine {
    pub product_id: u64,
    pub sku: Option<String>,
    pub name: String,
    pub on_hand: f64,
    pub reserved: f64,
    pub available: f64,
    pub reorder_point: f64,
    pub forecast: f64,
    pub supplier_hint: String,
    pub outdated_quant: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LowStockReportV1 {
    pub alert_count: usize,
    pub lines: Vec<LowStockLine>,
}

pub fn aggregate_low_stock(
    products: Vec<ProductSourceRow>,
    quants: Vec<StockQuantSourceRow>,
) -> LowStockReportV1 {
    let mut totals = BTreeMap::<u64, (f64, f64, f64, bool)>::new();
    for quant in quants {
        let entry = totals.entry(quant.product_id).or_default();
        entry.0 += quant.quantity;
        entry.1 += quant.reserved_quantity;
        entry.2 += quant.available_quantity;
        entry.3 |= quant.is_outdated;
    }
    let mut lines = products
        .into_iter()
        .filter_map(|product| {
            let (on_hand, reserved, available, outdated_quant) =
                totals.remove(&product.product_tmpl_id).unwrap_or_default();
            let reorder_point = product.reordering_min_qty.max(0.0);
            (available <= reorder_point || outdated_quant).then_some(LowStockLine {
                product_id: product.product_tmpl_id,
                sku: product.default_code,
                name: product.display_name.unwrap_or(product.name),
                on_hand,
                reserved,
                available,
                reorder_point,
                forecast: product.virtual_available,
                supplier_hint: "Supplier follow-up required".into(),
                outdated_quant,
            })
        })
        .collect::<Vec<_>>();
    lines.sort_by(|left, right| {
        left.available
            .total_cmp(&right.available)
            .then(left.product_id.cmp(&right.product_id))
    });
    LowStockReportV1 {
        alert_count: lines.len(),
        lines,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn includes_threshold_breaches_and_outdated_quants_in_available_order() {
        let report = aggregate_low_stock(
            vec![
                ProductSourceRow {
                    product_tmpl_id: 1,
                    name: "Rice".into(),
                    display_name: None,
                    default_code: Some("RICE".into()),
                    virtual_available: 8.0,
                    reordering_min_qty: 5.0,
                },
                ProductSourceRow {
                    product_tmpl_id: 2,
                    name: "Sugar".into(),
                    display_name: None,
                    default_code: None,
                    virtual_available: 12.0,
                    reordering_min_qty: 3.0,
                },
            ],
            vec![
                StockQuantSourceRow {
                    product_id: 1,
                    quantity: 6.0,
                    reserved_quantity: 2.0,
                    available_quantity: 4.0,
                    is_outdated: false,
                },
                StockQuantSourceRow {
                    product_id: 2,
                    quantity: 10.0,
                    reserved_quantity: 0.0,
                    available_quantity: 10.0,
                    is_outdated: true,
                },
            ],
        );

        assert_eq!(report.alert_count, 2);
        assert_eq!(report.lines[0].product_id, 1);
        assert_eq!(report.lines[0].available, 4.0);
        assert!(report.lines[1].outdated_quant);
    }
}
