//! Complete source and economic rows for the supported Finance task lifecycle.
//!
//! This collector records existing native outcomes through the organization
//! commit pipeline. It never performs a domain action or infers an association
//! from names, timestamps, or the largest inserted identifier.

use std::collections::{BTreeMap, BTreeSet};

use spacetimedb::ReducerContext;

use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::accounting::payments::account_payment;
use crate::core::audit::audit_log;
use crate::core::persistence::{RowChange, RowChangeKind};
use crate::core::reference::document_sequence;
use crate::crm::contacts::contact;
use crate::inventory::stock::{stock_move, stock_picking};
use crate::purchasing::purchase_orders::{purchase_order, purchase_order_line};
use crate::sales::delivery_shipping::stock_picking_batch;

const MAX_SNAPSHOT_ROWS: usize = 16_384;

type AuditTargets = BTreeMap<&'static str, BTreeSet<u64>>;

/// Append complete, dependency-ordered rows for a PO or ordinary payment.
///
/// The caller owns the supported-action and bank-payment boundaries. Every
/// selected source, child and declared parent is still checked here. Draft
/// sources may have no economic effect yet. A bound or ownership failure aborts
/// the enclosing reducer instead of recording an incomplete durable outcome.
pub(super) fn append_source_effects(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subject_model: &str,
    subject_id: u64,
    changes: &mut Vec<RowChange>,
) -> Result<(), String> {
    let scope = Scope {
        organization_id,
        company_id,
    };
    if organization_id == 0 || company_id == 0 || subject_id == 0 {
        return Err("finance persistence requires a positive source scope".to_string());
    }
    let mut rows = Rows::new(changes)?;
    let mut audits = AuditTargets::new();
    match subject_model {
        "purchase_order" => append_purchase_order(ctx, scope, subject_id, &mut rows, &mut audits)?,
        "account_payment" => append_payment(ctx, scope, subject_id, &mut rows, &mut audits)?,
        _ => return Err("unsupported finance persistence source".to_string()),
    }
    let mut audit_rows: Vec<_> = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&organization_id)
        .filter(|row| {
            row.company_id == Some(company_id)
                && audits
                    .get(row.table_name.as_str())
                    .is_some_and(|ids| ids.contains(&row.record_id))
        })
        .take(MAX_SNAPSHOT_ROWS + 1)
        .collect();
    audit_rows.sort_by_key(|row| row.id);
    for row in audit_rows {
        rows.push(RowChange::upsert_stdb_row(
            "audit_log",
            serde_json::json!({"id": row.id}),
            &row,
        )?)?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct Scope {
    organization_id: u64,
    company_id: u64,
}

impl Scope {
    fn require(self, organization_id: u64, company_id: u64) -> Result<(), String> {
        if organization_id != self.organization_id || company_id != self.company_id {
            return Err(
                "finance persistence row is outside organization/company scope".to_string(),
            );
        }
        Ok(())
    }
}

fn track(audits: &mut AuditTargets, table: &'static str, id: u64) {
    audits.entry(table).or_default().insert(id);
}

fn append_purchase_order(
    ctx: &ReducerContext,
    scope: Scope,
    order_id: u64,
    rows: &mut Rows<'_>,
    audits: &mut AuditTargets,
) -> Result<(), String> {
    let order = ctx
        .db
        .purchase_order()
        .id()
        .find(&order_id)
        .ok_or("finance persistence purchase order missing")?;
    scope.require(order.organization_id, order.company_id)?;
    let vendor = ctx
        .db
        .contact()
        .id()
        .find(&order.partner_id)
        .ok_or("finance persistence purchase order vendor missing")?;
    scope.require(
        vendor.organization_id,
        vendor.company_id.unwrap_or(scope.company_id),
    )?;
    // Confirmation increments this row's supplier_rank even for service-only POs.
    rows.push(RowChange::upsert_stdb_row(
        "contact",
        serde_json::json!({"id": vendor.id}),
        &vendor,
    )?)?;
    rows.push(RowChange::upsert_stdb_row(
        "purchase_order",
        serde_json::json!({"id": order.id}),
        &order,
    )?)?;
    track(audits, "purchase_order", order.id);
    let mut lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order_id)
        .take(MAX_SNAPSHOT_ROWS + 1)
        .collect();
    lines.sort_by_key(|line| line.id);
    let mut line_products = BTreeMap::new();
    for line in lines {
        scope.require(line.organization_id, line.company_id)?;
        if line.order_id != order_id {
            return Err("finance persistence purchase line has a different parent".to_string());
        }
        line_products.insert(line.id, line.product_id);
        rows.push(RowChange::upsert_stdb_row(
            "purchase_order_line",
            serde_json::json!({"id": line.id}),
            &line,
        )?)?;
        track(audits, "purchase_order_line", line.id);
    }

    // The native confirmation helper can reuse an existing incoming picking
    // before it updates order.picking_ids. The typed purchase_id is authoritative.
    let mut pickings: Vec<_> = ctx
        .db
        .stock_picking()
        .picking_by_org()
        .filter(&scope.organization_id)
        .filter(|row| {
            row.purchase_id == Some(order_id)
                && !row.is_return
                && row.picking_code.as_deref() == Some("incoming")
        })
        .take(MAX_SNAPSHOT_ROWS + 1)
        .collect();
    pickings.sort_by_key(|row| row.id);
    let picking_ids: BTreeSet<_> = pickings.iter().map(|row| row.id).collect();
    for id in &order.picking_ids {
        let declared = ctx
            .db
            .stock_picking()
            .id()
            .find(id)
            .ok_or("finance persistence declared purchase picking missing")?;
        scope.require(declared.organization_id, declared.company_id)?;
        if declared.purchase_id != Some(order_id) {
            return Err(
                "finance persistence declared picking has a different purchase order".to_string(),
            );
        }
    }
    // Existing backorders/batches are real parents, not newly inferred effects.
    // A fresh PO confirmation uses no batch and creates no inventory quantities.
    for picking in &pickings {
        scope.require(picking.organization_id, picking.company_id)?;
        if picking
            .backorder_id
            .is_some_and(|id| id >= picking.id || !picking_ids.contains(&id))
        {
            return Err(
                "finance persistence incoming backorder has an inconsistent parent".to_string(),
            );
        }
        if let Some(id) = picking.batch_id {
            let batch = ctx
                .db
                .stock_picking_batch()
                .id()
                .find(&id)
                .ok_or("finance persistence picking batch missing")?;
            scope.require(batch.organization_id, batch.company_id)?;
            if !batch.picking_ids.contains(&picking.id) {
                return Err(
                    "finance persistence picking batch membership is inconsistent".to_string(),
                );
            }
            rows.push(RowChange::upsert_stdb_row(
                "stock_picking_batch",
                serde_json::json!({"id": batch.id}),
                &batch,
            )?)?;
        }
    }
    for picking in &pickings {
        rows.push(RowChange::upsert_stdb_row(
            "stock_picking",
            serde_json::json!({"id": picking.id}),
            picking,
        )?)?;
        track(audits, "stock_picking", picking.id);
    }
    let mut moves = BTreeMap::new();
    for picking in &pickings {
        for movement in ctx.db.stock_move().move_by_picking().filter(&picking.id) {
            scope.require(movement.organization_id, movement.company_id)?;
            if movement.picking_id != Some(picking.id) || movement.picking_key != picking.id {
                return Err(
                    "finance persistence stock move has an inconsistent picking".to_string()
                );
            }
            if movement
                .purchase_line_id
                .is_some_and(|line| line_products.get(&line) != Some(&movement.product_id))
            {
                return Err(
                    "finance persistence stock move has a foreign purchase line".to_string()
                );
            }
            if moves.len() == MAX_SNAPSHOT_ROWS {
                return Err("finance persistence stock moves exceed the snapshot bound".to_string());
            }
            moves.insert(movement.id, movement);
        }
    }
    for movement in moves.into_values() {
        rows.push(RowChange::upsert_stdb_row(
            "stock_move",
            serde_json::json!({"id": movement.id}),
            &movement,
        )?)?;
        track(audits, "stock_move", movement.id);
    }
    Ok(())
}

fn append_payment(
    ctx: &ReducerContext,
    scope: Scope,
    payment_id: u64,
    rows: &mut Rows<'_>,
    audits: &mut AuditTargets,
) -> Result<(), String> {
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("finance persistence payment missing")?;
    scope.require(payment.organization_id, payment.company_id)?;
    // A payment can already reference a posted entry before its approval gate.
    // Retain only explicitly linked entries; posting does not change invoices.
    let move_ids: BTreeSet<_> = [payment.move_id, payment.reversal_move_id]
        .into_iter()
        .flatten()
        .collect();
    for id in &move_ids {
        let entry = ctx
            .db
            .account_move()
            .id()
            .find(id)
            .ok_or("finance persistence linked payment entry missing")?;
        scope.require(entry.organization_id, entry.company_id)?;
        rows.push(RowChange::upsert_stdb_row(
            "account_move",
            serde_json::json!({"id": entry.id}),
            &entry,
        )?)?;
        track(audits, "account_move", entry.id);
    }
    rows.push(RowChange::upsert_stdb_row(
        "account_payment",
        serde_json::json!({"id": payment.id}),
        &payment,
    )?)?;
    track(audits, "account_payment", payment.id);
    for id in &move_ids {
        let mut lines: Vec<_> = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(id)
            .take(MAX_SNAPSHOT_ROWS + 1)
            .collect();
        lines.sort_by_key(|row| row.id);
        for line in lines {
            scope.require(line.organization_id, line.company_id)?;
            if line.move_id != *id || line.payment_id.is_some_and(|id| id != payment_id) {
                return Err(
                    "finance persistence journal line has a different payment owner".to_string(),
                );
            }
            if line.statement_line_id.is_some() {
                return Err(
                    "bank-linked journal lines require their settlement persistence owner"
                        .to_string(),
                );
            }
            rows.push(RowChange::upsert_stdb_row(
                "account_move_line",
                serde_json::json!({"id": line.id}),
                &line,
            )?)?;
            track(audits, "account_move_line", line.id);
        }
    }
    let doc_type = "PAY".to_string();
    let sequences: Vec<_> = ctx
        .db
        .document_sequence()
        .document_sequence_by_organization_and_type()
        .filter((&scope.organization_id, &doc_type))
        .take(2)
        .collect();
    if sequences.len() > 1 {
        return Err("finance persistence payment sequence is ambiguous".to_string());
    }
    if let Some(sequence) = sequences.first() {
        if sequence.organization_id != scope.organization_id
            || sequence.doc_type != doc_type
            || sequence.sequence_key != format!("{}:PAY", scope.organization_id)
            || sequence.next_number == 0
        {
            return Err(
                "finance persistence payment sequence has an inconsistent owner".to_string(),
            );
        }
        rows.push(RowChange::upsert_stdb_row(
            "document_sequence",
            serde_json::json!({"sequence_key": sequence.sequence_key}),
            sequence,
        )?)?;
    }
    Ok(())
}

type RowKey = (String, String);

struct Rows<'a> {
    changes: &'a mut Vec<RowChange>,
    positions: BTreeMap<RowKey, usize>,
}

fn row_key(row: &RowChange) -> RowKey {
    (row.table_name.clone(), row.row_identity.to_string())
}

fn same_outcome(left: &RowChange, right: &RowChange) -> bool {
    match (&left.kind, &right.kind) {
        (RowChangeKind::Upsert(left), RowChangeKind::Upsert(right)) => left == right,
        (RowChangeKind::Delete, RowChangeKind::Delete) => true,
        _ => false,
    }
}

impl<'a> Rows<'a> {
    fn new(changes: &'a mut Vec<RowChange>) -> Result<Self, String> {
        let mut positions = BTreeMap::new();
        for (index, row) in changes.iter().enumerate() {
            if let Some(prior) = positions.get(&row_key(row)) {
                if !same_outcome(&changes[*prior], row) {
                    return Err(
                        "finance persistence has conflicting outcomes for one row".to_string()
                    );
                }
            } else {
                positions.insert(row_key(row), index);
            }
        }
        let mut retained = BTreeSet::new();
        changes.retain(|row| retained.insert(row_key(row)));
        if changes.len() > MAX_SNAPSHOT_ROWS {
            return Err("finance persistence exceeds the durable snapshot bound".to_string());
        }
        let positions = changes
            .iter()
            .enumerate()
            .map(|(index, row)| (row_key(row), index))
            .collect();
        Ok(Self { changes, positions })
    }

    fn push(&mut self, change: RowChange) -> Result<(), String> {
        let key = row_key(&change);
        if let Some(index) = self.positions.get(&key) {
            return if same_outcome(&self.changes[*index], &change) {
                Ok(())
            } else {
                Err("finance persistence has conflicting outcomes for one row".to_string())
            };
        }
        if self.changes.len() == MAX_SNAPSHOT_ROWS {
            return Err("finance persistence exceeds the durable snapshot bound".to_string());
        }
        self.positions.insert(key, self.changes.len());
        self.changes.push(change);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: u64, value: u64) -> RowChange {
        RowChange {
            table_name: "purchase_order".to_string(),
            row_identity: serde_json::json!({"id": id}),
            kind: RowChangeKind::Upsert(serde_json::json!({"id": id, "value": value})),
        }
    }

    #[test]
    fn duplicate_snapshots_preserve_order_and_conflicting_outcomes_fail_closed() {
        let mut changes = vec![row(1, 3), row(1, 3), row(2, 4)];
        let mut rows = Rows::new(&mut changes).unwrap();
        rows.push(row(1, 3)).unwrap();
        rows.push(row(3, 5)).unwrap();
        assert!(rows.push(row(1, 4)).is_err());
        assert!(rows
            .push(RowChange::delete(
                "purchase_order",
                serde_json::json!({"id": 1})
            ))
            .is_err());
        assert_eq!(rows.changes.len(), 3);
        assert_eq!(rows.changes[0].row_identity, serde_json::json!({"id": 1}));
        assert_eq!(rows.changes[2].row_identity, serde_json::json!({"id": 3}));
        let mut conflicting = vec![row(1, 3), row(1, 4)];
        assert!(Rows::new(&mut conflicting).is_err());
    }

    #[test]
    fn complete_snapshot_bound_rejects_an_additional_identity_but_allows_exact_deduplication() {
        let mut changes: Vec<_> = (1..=MAX_SNAPSHOT_ROWS as u64)
            .map(|id| row(id, 1))
            .collect();
        let mut rows = Rows::new(&mut changes).unwrap();
        rows.push(row(1, 1)).unwrap();
        assert!(rows.push(row(MAX_SNAPSHOT_ROWS as u64 + 1, 1)).is_err());
        assert_eq!(rows.changes.len(), MAX_SNAPSHOT_ROWS);
    }
}
