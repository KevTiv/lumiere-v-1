//! Read-only reconciliation of completed warehouse receipts to purchase lines.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{ensure, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};

use super::types::{ToolContext, ToolOutput, ToolResult};
use crate::wire_decode::snake_to_camel;

const ROW_LIMIT: u32 = 101;
const RESULT_LIMIT: usize = 20;
const QUANTITY_TOLERANCE: f64 = 1e-8;

fn field<'a>(row: &'a Value, name: &str) -> Result<&'a Value> {
    row.get(snake_to_camel(name))
        .or_else(|| row.get(name))
        .with_context(|| format!("Receipt reconciliation requires access to field {name}"))
}

fn id_value(value: &Value) -> Result<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|id| *id > 0)
        .context("Invalid receipt reconciliation identifier")
}

fn id(row: &Value, name: &str) -> Result<u64> {
    id_value(field(row, name)?)
}

fn optional_id(row: &Value, name: &str) -> Result<Option<u64>> {
    let value = field(row, name)?;
    if value.is_null() || value.get("none").is_some() {
        return Ok(None);
    }
    id_value(value.get("some").unwrap_or(value)).map(Some)
}

fn flag(row: &Value, name: &str) -> Result<bool> {
    field(row, name)?
        .as_bool()
        .with_context(|| format!("Invalid receipt reconciliation flag {name}"))
}

fn quantity(row: &Value, name: &str) -> Result<f64> {
    let value = field(row, name)?;
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|value| value.is_finite() && *value >= 0.0)
        .with_context(|| format!("Invalid receipt reconciliation quantity {name}"))
}

fn indexed(rows: Vec<Value>, org_id: u64, company_id: u64) -> Result<BTreeMap<u64, Value>> {
    ensure!(
        rows.len() < ROW_LIMIT as usize,
        "Receipt reconciliation exceeded its source bound"
    );
    let mut indexed = BTreeMap::new();
    for row in rows {
        ensure!(
            id(&row, "organization_id")? == org_id && id(&row, "company_id")? == company_id,
            "Receipt reconciliation row is outside the requested company"
        );
        ensure!(
            indexed.insert(id(&row, "id")?, row).is_none(),
            "Duplicate receipt reconciliation source row"
        );
    }
    Ok(indexed)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    move_id: u64,
    picking_id: u64,
    purchase_order_id: u64,
    purchase_line_id: u64,
    quantity: f64,
}

fn matches_receipt(line: &Value, movement: &Value, order_id: u64, partner_id: u64) -> Result<bool> {
    Ok(id(line, "order_id")? == order_id
        && id(line, "partner_id")? == partner_id
        && id(line, "product_id")? == id(movement, "product_id")?
        && id(line, "product_uom")? == id(movement, "product_uom")?
        && optional_id(line, "product_variant_id")? == optional_id(movement, "product_variant_id")?)
}

fn propose(
    pickings: &BTreeMap<u64, Value>,
    moves: &BTreeMap<u64, Value>,
    lines: &BTreeMap<u64, Value>,
) -> Result<Value> {
    let mut candidates = BTreeMap::<u64, Vec<Candidate>>::new();
    let mut linked = BTreeMap::<u64, f64>::new();
    let mut unresolved = BTreeSet::new();
    let mut blocked_lines = BTreeSet::new();
    let mut blocked_orders = BTreeSet::new();

    for (&move_id, movement) in moves {
        if !flag(movement, "is_done")? {
            continue;
        }
        let existing = optional_id(movement, "purchase_line_id")?;
        let picking_id = optional_id(movement, "picking_id")?;
        let picking = picking_id.and_then(|id| pickings.get(&id));
        let purchase_id = picking
            .map(|row| optional_id(row, "purchase_id"))
            .transpose()?
            .flatten();

        let (Some(picking), Some(picking_id), Some(purchase_order_id)) =
            (picking, picking_id, purchase_id)
        else {
            if let Some(line_id) = existing {
                blocked_lines.insert(line_id);
                unresolved.insert(move_id);
            }
            continue;
        };
        let picking_code = field(picking, "picking_code")?;
        if flag(picking, "is_return")?
            || picking_code.get("some").unwrap_or(picking_code).as_str() != Some("incoming")
            || optional_id(movement, "origin_returned_move_id")?.is_some()
            || flag(movement, "scrapped")?
            || field(movement, "move_type")?.as_str() != Some("incoming")
        {
            blocked_orders.insert(purchase_order_id);
            if let Some(line_id) = existing {
                blocked_lines.insert(line_id);
            }
            unresolved.insert(move_id);
            continue;
        }
        let Some(partner_id) = optional_id(picking, "partner_id")? else {
            blocked_orders.insert(purchase_order_id);
            unresolved.insert(move_id);
            continue;
        };
        let received = quantity(movement, "quantity_done")?;
        if received == 0.0 {
            blocked_orders.insert(purchase_order_id);
            unresolved.insert(move_id);
            continue;
        }

        if let Some(line_id) = existing {
            if let Some(line) = lines.get(&line_id) {
                if matches_receipt(line, movement, purchase_order_id, partner_id)? {
                    *linked.entry(line_id).or_default() += received;
                    continue;
                }
            }
            blocked_lines.insert(line_id);
            blocked_orders.insert(purchase_order_id);
            unresolved.insert(move_id);
            continue;
        }

        let mut matching_lines = Vec::new();
        for (&line_id, line) in lines {
            if matches_receipt(line, movement, purchase_order_id, partner_id)? {
                matching_lines.push(line_id);
            }
        }
        let [purchase_line_id] = matching_lines.as_slice() else {
            blocked_orders.insert(purchase_order_id);
            unresolved.insert(move_id);
            continue;
        };
        candidates
            .entry(*purchase_line_id)
            .or_default()
            .push(Candidate {
                move_id,
                picking_id,
                purchase_order_id,
                purchase_line_id: *purchase_line_id,
                quantity: received,
            });
    }

    let mut proposals = Vec::new();
    for (line_id, group) in candidates {
        let line = &lines[&line_id];
        let order_id = id(line, "order_id")?;
        let total = linked.get(&line_id).copied().unwrap_or(0.0)
            + group.iter().map(|candidate| candidate.quantity).sum::<f64>();
        let ordered = quantity(line, "product_qty")?;
        let received = quantity(line, "qty_received")?;
        if blocked_lines.contains(&line_id)
            || blocked_orders.contains(&order_id)
            || !total.is_finite()
            || total - ordered > QUANTITY_TOLERANCE
            || (total - received).abs() > QUANTITY_TOLERANCE
        {
            unresolved.extend(group.iter().map(|candidate| candidate.move_id));
            continue;
        }
        proposals.extend(group);
    }

    proposals.sort_by_key(|proposal| proposal.move_id);
    let proposal_count = proposals.len();
    let unresolved_count = unresolved.len();
    proposals.truncate(RESULT_LIMIT);
    Ok(json!({
        "proposals": proposals,
        "proposalCount": proposal_count,
        "unresolvedMoveIds": unresolved.into_iter().take(RESULT_LIMIT).collect::<Vec<_>>(),
        "unresolvedCount": unresolved_count,
        "truncated": proposal_count > RESULT_LIMIT || unresolved_count > RESULT_LIMIT,
        "scope": "Completed purchase receipt linkage only. Reviewer must recheck source records."
    }))
}

pub(crate) async fn execute(ctx: &ToolContext, input: &Value) -> ToolResult {
    ensure!(
        input.as_object().is_some_and(|object| object.is_empty()),
        "Receipt reconciliation takes no arguments"
    );
    let read = |resource| super::alpha_data::read_rows(ctx, resource, ROW_LIMIT);
    let (pickings, moves, lines) = tokio::try_join!(
        read("stock-pickings"),
        read("stock-moves"),
        read("purchase-order-lines")
    )?;
    let scoped = |rows| indexed(rows, ctx.org_id, ctx.company_id);
    let data = propose(&scoped(pickings)?, &scoped(moves)?, &scoped(lines)?)?;
    Ok(ToolOutput {
        summary: "Reviewed completed receipt links against purchase lines and recorded quantities."
            .into(),
        row_count: data["proposals"].as_array().map(|rows| rows.len() as u32),
        data,
        citations: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picking() -> Value {
        json!({
            "purchaseId": 41, "partnerId": 21, "isReturn": false,
            "pickingCode": {"some": "incoming"}
        })
    }

    fn line() -> Value {
        json!({
            "orderId": 41, "partnerId": 21, "productId": 11,
            "productUom": 1, "productVariantId": null,
            "productQty": 100.0, "qtyReceived": 100.0
        })
    }

    fn receipt(link: Option<u64>, quantity: f64) -> Value {
        json!({
            "pickingId": 31, "purchaseLineId": link, "isDone": true,
            "originReturnedMoveId": null, "scrapped": false, "moveType": "incoming",
            "productId": 11, "productUom": 1, "productVariantId": null,
            "quantityDone": quantity
        })
    }

    #[test]
    fn proposes_only_the_missing_link_when_partial_receipts_reconcile() {
        let pickings = BTreeMap::from([(31, picking())]);
        let moves = BTreeMap::from([(1, receipt(Some(51), 60.0)), (2, receipt(None, 40.0))]);
        let lines = BTreeMap::from([(51, line())]);
        let result = propose(&pickings, &moves, &lines).unwrap();
        assert_eq!(result["proposalCount"], 1);
        assert_eq!(result["proposals"][0]["moveId"], 2);
        assert_eq!(result["proposals"][0]["purchaseLineId"], 51);
    }

    #[test]
    fn competing_lines_and_incomplete_receipts_remain_unresolved() {
        let pickings = BTreeMap::from([(31, picking())]);
        let moves = BTreeMap::from([(1, receipt(None, 60.0))]);
        for lines in [
            BTreeMap::from([(51, line())]),
            BTreeMap::from([(51, line()), (52, line())]),
        ] {
            let result = propose(&pickings, &moves, &lines).unwrap();
            assert_eq!(result["proposalCount"], 0);
            assert_eq!(result["unresolvedMoveIds"], json!([1]));
        }
    }
}
