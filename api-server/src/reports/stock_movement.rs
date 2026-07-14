//! Completed inventory movements with operational valuation references.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::daily_business_summary::MoneyAmount;

const MAX_MOVEMENT_LINES: usize = 100;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockMovementSourceRow {
    pub id: u64,
    pub product_id: u64,
    pub product_tmpl_id: u64,
    pub location_id: u64,
    pub location_dest_id: u64,
    pub quantity_done: f64,
    pub price_unit: f64,
    pub date: Option<String>,
    pub reference: Option<String>,
    pub move_type: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockMovementProductSourceRow {
    pub product_tmpl_id: u64,
    pub name: String,
    pub display_name: Option<String>,
    pub default_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockLocationSourceRow {
    pub id: u64,
    pub name: String,
    pub complete_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockMovementLine {
    pub move_id: u64,
    pub product_id: u64,
    pub sku: Option<String>,
    pub product_name: String,
    pub source_location: String,
    pub destination_location: String,
    pub quantity: f64,
    pub unit_valuation_reference: MoneyAmount,
    pub valuation_reference: MoneyAmount,
    pub moved_at: Option<String>,
    pub reference: Option<String>,
    pub move_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockMovementReportV1 {
    pub movement_count: usize,
    pub quantity_moved: f64,
    pub valuation_reference: MoneyAmount,
    pub lines: Vec<StockMovementLine>,
}

pub fn aggregate_stock_movement(
    moves: Vec<StockMovementSourceRow>,
    products: Vec<StockMovementProductSourceRow>,
    locations: Vec<StockLocationSourceRow>,
) -> StockMovementReportV1 {
    let products = products
        .into_iter()
        .map(|product| (product.product_tmpl_id, product))
        .collect::<BTreeMap<_, _>>();
    let locations = locations
        .into_iter()
        .map(|location| {
            let label = location.complete_name.unwrap_or(location.name);
            (location.id, label)
        })
        .collect::<BTreeMap<_, _>>();

    let mut lines = moves
        .into_iter()
        .map(|move_| {
            let product = products.get(&move_.product_tmpl_id);
            let quantity = move_.quantity_done;
            StockMovementLine {
                move_id: move_.id,
                product_id: move_.product_id,
                sku: product.and_then(|row| row.default_code.clone()),
                product_name: product
                    .map(|row| row.display_name.clone().unwrap_or_else(|| row.name.clone()))
                    .unwrap_or_else(|| format!("Product #{}", move_.product_id)),
                source_location: locations
                    .get(&move_.location_id)
                    .cloned()
                    .unwrap_or_else(|| format!("Location #{}", move_.location_id)),
                destination_location: locations
                    .get(&move_.location_dest_id)
                    .cloned()
                    .unwrap_or_else(|| format!("Location #{}", move_.location_dest_id)),
                quantity,
                unit_valuation_reference: money(move_.price_unit),
                valuation_reference: money(quantity * move_.price_unit),
                moved_at: move_.date,
                reference: move_.reference,
                move_type: move_.move_type,
            }
        })
        .collect::<Vec<_>>();
    lines.sort_by(|left, right| {
        right
            .moved_at
            .cmp(&left.moved_at)
            .then(right.move_id.cmp(&left.move_id))
    });

    let movement_count = lines.len();
    let quantity_moved = lines.iter().map(|line| line.quantity).sum();
    let valuation_reference = lines.iter().fold(0_i64, |total, line| {
        total + line.valuation_reference.minor_units
    });
    lines.truncate(MAX_MOVEMENT_LINES);

    StockMovementReportV1 {
        movement_count,
        quantity_moved,
        valuation_reference: MoneyAmount {
            minor_units: valuation_reference,
            scale: 2,
        },
        lines,
    }
}

fn money(value: f64) -> MoneyAmount {
    MoneyAmount {
        minor_units: (value * 100.0).round() as i64,
        scale: 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_completed_movements_with_product_and_location_labels() {
        let report = aggregate_stock_movement(
            vec![StockMovementSourceRow {
                id: 4,
                product_id: 8,
                product_tmpl_id: 8,
                location_id: 2,
                location_dest_id: 3,
                quantity_done: 5.0,
                price_unit: 12.5,
                date: Some("2026-07-13T09:00:00Z".into()),
                reference: Some("RCPT-4".into()),
                move_type: "direct".into(),
            }],
            vec![StockMovementProductSourceRow {
                product_tmpl_id: 8,
                name: "Rice".into(),
                display_name: Some("Premium Rice".into()),
                default_code: Some("RICE-5".into()),
            }],
            vec![
                StockLocationSourceRow {
                    id: 2,
                    name: "Vendors".into(),
                    complete_name: Some("Partners/Vendors".into()),
                },
                StockLocationSourceRow {
                    id: 3,
                    name: "Stock".into(),
                    complete_name: Some("WH/Stock".into()),
                },
            ],
        );

        assert_eq!(report.movement_count, 1);
        assert_eq!(report.quantity_moved, 5.0);
        assert_eq!(report.valuation_reference.minor_units, 6_250);
        assert_eq!(report.lines[0].product_name, "Premium Rice");
        assert_eq!(report.lines[0].source_location, "Partners/Vendors");
        assert_eq!(report.lines[0].destination_location, "WH/Stock");
    }

    #[test]
    fn retains_totals_when_detail_lines_are_capped() {
        let moves = (0..=MAX_MOVEMENT_LINES)
            .map(|id| StockMovementSourceRow {
                id: id as u64,
                product_id: 1,
                product_tmpl_id: 1,
                location_id: 1,
                location_dest_id: 2,
                quantity_done: 1.0,
                price_unit: 2.0,
                date: Some(format!("2026-07-13T00:{id:02}:00Z")),
                reference: None,
                move_type: "direct".into(),
            })
            .collect();
        let report = aggregate_stock_movement(moves, vec![], vec![]);

        assert_eq!(report.movement_count, MAX_MOVEMENT_LINES + 1);
        assert_eq!(report.lines.len(), MAX_MOVEMENT_LINES);
        assert_eq!(report.valuation_reference.minor_units, 20_200);
    }
}
