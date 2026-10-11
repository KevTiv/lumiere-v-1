//! Complete, exact manufacturing outcomes for durable projection replay.
//!
//! Capture only one MO's ownership graph and its bounded stock keys. Comparing
//! full rows before/after excludes unrelated and unchanged reference rows. The
//! commit is recorded in the business reducer transaction, so errors roll back
//! both the domain writes and their durable envelope.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};
use spacetimedb::{ReducerContext, Table};

use crate::accounting::idempotency::accounting_operation_receipt;
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::core::persistence::{
    record_organization_commit, OrganizationCommitInput, RowChange, RowChangeKind,
};
use crate::core::reference::document_sequence;
use crate::inventory::quality::quality_check;
use crate::inventory::stock::{stock_move, stock_move_line, stock_quant};
use crate::manufacturing::bill_of_materials::{
    mrp_bom, mrp_bom_byproduct, mrp_bom_line, mrp_routing_workcenter,
};
use crate::manufacturing::costing::{
    mrp_production_cost, mrp_productivity_cost, mrp_valuation_config,
};
use crate::manufacturing::manufacturing_orders::{mrp_production, mrp_workorder, MrpProduction};
use crate::manufacturing::work_centers::{mrp_workcenter, mrp_workcenter_productivity};

// Dependency-safe parent order, then a stable table/primary-key order.
type RowKey = (u8, String, String);
type SnapshotRows = BTreeMap<RowKey, RowChange>;

fn add_row<T: spacetimedb_sats::Serialize + ?Sized>(
    rows: &mut SnapshotRows,
    rank: u8,
    table: &str,
    identity: Value,
    row: &T,
) -> Result<(), String> {
    let key = (rank, table.to_string(), identity.to_string());
    rows.insert(key, RowChange::upsert_stdb_row(table, identity, row)?);
    Ok(())
}

fn changed_rows(before: SnapshotRows, after: SnapshotRows) -> Vec<RowChange> {
    let mut changes = Vec::new();
    // Tombstones run child-before-parent. Upserts run parent-before-child.
    for (key, old) in before.iter().rev() {
        if !after.contains_key(key) {
            changes.push(RowChange::delete(&old.table_name, old.row_identity.clone()));
        }
    }
    for (key, new) in after {
        let unchanged = before
            .get(&key)
            .is_some_and(|old| match (&old.kind, &new.kind) {
                (RowChangeKind::Upsert(old), RowChangeKind::Upsert(new)) => old == new,
                _ => false,
            });
        if !unchanged {
            changes.push(new);
        }
    }
    changes
}

pub(crate) struct ManufacturingEffectSnapshot {
    organization_id: u64,
    company_id: u64,
    production_id: u64,
    products: BTreeSet<u64>,
    locations: BTreeSet<u64>,
    workcenters: BTreeSet<u64>,
    before: SnapshotRows,
}

impl ManufacturingEffectSnapshot {
    pub(crate) fn capture(ctx: &ReducerContext, mo: &MrpProduction) -> Result<Self, String> {
        Self::capture_with_workcenter(ctx, mo, None)
    }

    pub(crate) fn capture_with_workcenter(
        ctx: &ReducerContext,
        mo: &MrpProduction,
        workcenter_id: Option<u64>,
    ) -> Result<Self, String> {
        let mut snapshot = Self {
            organization_id: mo.organization_id,
            company_id: mo.company_id,
            production_id: mo.id,
            products: BTreeSet::new(),
            locations: BTreeSet::new(),
            workcenters: workcenter_id.into_iter().collect(),
            before: BTreeMap::new(),
        };
        snapshot.before = snapshot.read_owned_rows(ctx, mo)?;
        Ok(snapshot)
    }

    fn read_owned_rows(
        &mut self,
        ctx: &ReducerContext,
        mo: &MrpProduction,
    ) -> Result<SnapshotRows, String> {
        if mo.organization_id != self.organization_id
            || mo.company_id != self.company_id
            || mo.id != self.production_id
        {
            return Err("manufacturing commit scope changed".to_string());
        }
        let mut rows = BTreeMap::new();
        add_row(&mut rows, 0, "mrp_production", json!({"id": mo.id}), mo)?;
        self.products.insert(mo.product_id);
        self.locations.extend([
            mo.location_src_id,
            mo.location_dest_id,
            mo.location_finished_id,
        ]);
        let mut operation_ids: BTreeSet<_> = mo.routing_id.into_iter().collect();
        if let Some(bom_id) = mo.bom_id {
            if let Some(bom) = ctx.db.mrp_bom().id().find(&bom_id) {
                operation_ids.extend(bom.routing_id);
                operation_ids.extend(bom.operation_ids);
            }
            for line in ctx.db.mrp_bom_line().mrp_bom_line_by_bom().filter(&bom_id) {
                if line.organization_id == self.organization_id
                    && line.company_id == self.company_id
                {
                    self.products.insert(line.product_id);
                    operation_ids.extend(line.operation_id);
                }
            }
            for line in ctx
                .db
                .mrp_bom_byproduct()
                .mrp_bom_byproduct_by_bom()
                .filter(&bom_id)
            {
                if line.organization_id == self.organization_id
                    && line.company_id == self.company_id
                {
                    self.products.insert(line.product_id);
                }
            }
        }
        // Routing roots refer to operation rows. Include their dependency graph
        // so confirmation-created workcenter projections have a before image.
        let mut pending: Vec<_> = operation_ids.iter().copied().collect();
        while let Some(operation_id) = pending.pop() {
            if let Some(operation) = ctx.db.mrp_routing_workcenter().id().find(&operation_id) {
                if operation.organization_id == self.organization_id
                    && operation.company_id == self.company_id
                {
                    self.workcenters.insert(operation.workcenter_id);
                    for dependency in operation.blocked_by_operation_ids {
                        if operation_ids.insert(dependency) {
                            pending.push(dependency);
                        }
                    }
                }
            }
        }
        let mut workorder_ids = BTreeSet::new();
        for workorder in ctx
            .db
            .mrp_workorder()
            .mrp_workorder_by_production()
            .filter(&mo.id)
        {
            if workorder.organization_id != self.organization_id
                || workorder.company_id != self.company_id
            {
                continue;
            }
            workorder_ids.insert(workorder.id);
            self.workcenters.insert(workorder.workcenter_id);
            add_row(
                &mut rows,
                2,
                "mrp_workorder",
                json!({"id": workorder.id}),
                &workorder,
            )?;
            for time in ctx
                .db
                .mrp_workcenter_productivity()
                .mrp_productivity_by_workorder()
                .filter(&workorder.id)
            {
                if time.organization_id == self.organization_id
                    && time.company_id == self.company_id
                {
                    add_row(
                        &mut rows,
                        3,
                        "mrp_workcenter_productivity",
                        json!({"id": time.id}),
                        &time,
                    )?;
                }
            }
        }
        for center_id in &self.workcenters {
            if let Some(center) = ctx.db.mrp_workcenter().id().find(center_id) {
                if center.organization_id == self.organization_id
                    && center.company_id == self.company_id
                {
                    add_row(
                        &mut rows,
                        1,
                        "mrp_workcenter",
                        json!({"id": center.id}),
                        &center,
                    )?;
                }
            }
        }
        for check in ctx
            .db
            .quality_check()
            .quality_check_by_org()
            .filter(&self.organization_id)
        {
            if check.company_id == self.company_id
                && check.production_id == Some(mo.id)
                && check
                    .workorder_id
                    .is_some_and(|id| workorder_ids.contains(&id))
            {
                add_row(
                    &mut rows,
                    3,
                    "quality_check",
                    json!({"id": check.id}),
                    &check,
                )?;
            }
        }
        let mut move_ids = BTreeSet::new();
        for movement in ctx
            .db
            .stock_move()
            .move_by_org()
            .filter(&self.organization_id)
        {
            if movement.company_id == self.company_id && movement.production_id == Some(mo.id) {
                move_ids.insert(movement.id);
                self.products.insert(movement.product_id);
                self.locations
                    .extend([movement.location_id, movement.location_dest_id]);
                add_row(
                    &mut rows,
                    4,
                    "stock_move",
                    json!({"id": movement.id}),
                    &movement,
                )?;
            }
        }
        for line in ctx
            .db
            .stock_move_line()
            .move_line_by_org()
            .filter(&self.organization_id)
        {
            if line.company_id == self.company_id
                && line.move_id.is_some_and(|id| move_ids.contains(&id))
            {
                add_row(
                    &mut rows,
                    5,
                    "stock_move_line",
                    json!({"id": line.id}),
                    &line,
                )?;
            }
        }
        // Snapshot bounded product/location keys, including their lot variants.
        // Only changed full rows are emitted; unchanged owners/lots never leave
        // this snapshot. Preserve before identities for exhausted-quant deletes.
        for product_id in &self.products {
            for quant in ctx.db.stock_quant().quant_by_product().filter(product_id) {
                if quant.organization_id == self.organization_id
                    && quant.company_id == self.company_id
                    && self.locations.contains(&quant.location_id)
                {
                    add_row(&mut rows, 6, "stock_quant", json!({"id": quant.id}), &quant)?;
                }
            }
        }
        for cost in ctx
            .db
            .mrp_productivity_cost()
            .mrp_productivity_cost_by_production()
            .filter(&mo.id)
        {
            if cost.organization_id == self.organization_id && cost.company_id == self.company_id {
                add_row(
                    &mut rows,
                    7,
                    "mrp_productivity_cost",
                    json!({"productivity_id": cost.productivity_id}),
                    &cost,
                )?;
            }
        }
        if let Some(cost) = ctx.db.mrp_production_cost().production_id().find(&mo.id) {
            if cost.organization_id != self.organization_id || cost.company_id != self.company_id {
                return Err("manufacturing production cost commit scope mismatch".to_string());
            }
            if let Some(move_id) = cost.account_move_id {
                let entry = ctx
                    .db
                    .account_move()
                    .id()
                    .find(&move_id)
                    .ok_or("manufacturing valuation entry missing before commit")?;
                if entry.organization_id != self.organization_id
                    || entry.company_id != self.company_id
                {
                    return Err("manufacturing valuation commit scope mismatch".to_string());
                }
                add_row(
                    &mut rows,
                    7,
                    "account_move",
                    json!({"id": entry.id}),
                    &entry,
                )?;
                for line in ctx
                    .db
                    .account_move_line()
                    .move_line_by_move()
                    .filter(&move_id)
                {
                    if line.organization_id == self.organization_id
                        && line.company_id == self.company_id
                    {
                        add_row(
                            &mut rows,
                            8,
                            "account_move_line",
                            json!({"id": line.id}),
                            &line,
                        )?;
                    }
                }
            }
            add_row(
                &mut rows,
                9,
                "mrp_production_cost",
                json!({"production_id": cost.production_id}),
                &cost,
            )?;
        }
        if ctx
            .db
            .mrp_valuation_config()
            .company_id()
            .find(&self.company_id)
            .is_some()
        {
            for sequence in ctx
                .db
                .document_sequence()
                .document_sequence_by_organization_and_type()
                .filter((&self.organization_id, &"JRNL".to_string()))
            {
                add_row(
                    &mut rows,
                    7,
                    "document_sequence",
                    json!({"sequence_key": sequence.sequence_key}),
                    &sequence,
                )?;
            }
            let key = format!("manufacturing-valuation:{}", mo.id);
            for receipt in ctx
                .db
                .accounting_operation_receipt()
                .accounting_operation_receipt_by_scope()
                .filter((
                    &self.organization_id,
                    &self.company_id,
                    &"create_account_move".to_string(),
                ))
            {
                if receipt.idempotency_key == key {
                    add_row(
                        &mut rows,
                        9,
                        "accounting_operation_receipt",
                        json!({"id": receipt.id}),
                        &receipt,
                    )?;
                }
            }
        }
        Ok(rows)
    }

    pub(crate) fn record(mut self, ctx: &ReducerContext, operation_id: &str) -> Result<(), String> {
        let mo = ctx
            .db
            .mrp_production()
            .id()
            .find(&self.production_id)
            .ok_or("manufacturing order disappeared before commit recording")?;
        let after = self.read_owned_rows(ctx, &mo)?;
        let changes = changed_rows(self.before, after);
        if changes.is_empty() {
            return Ok(());
        }
        record_organization_commit(
            ctx,
            OrganizationCommitInput {
                organization_id: self.organization_id,
                operation_id: operation_id.to_string(),
                correlation_id: format!(
                    "manufacturing-order:{}:{operation_id}",
                    self.production_id
                ),
                changes,
            },
        )?;
        Ok(())
    }
}

pub(crate) fn record_created_order(ctx: &ReducerContext, mo: &MrpProduction) -> Result<(), String> {
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id: mo.organization_id,
            operation_id: "erp.create_manufacturing_order".to_string(),
            correlation_id: format!("manufacturing-order:{}:create", mo.id),
            changes: vec![RowChange::upsert_stdb_row(
                "mrp_production",
                json!({"id": mo.id}),
                mo,
            )?],
        },
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(rank: u8, table: &str, id: u64, quantity: u64) -> (RowKey, RowChange) {
        let identity = json!({"id": id});
        (
            (rank, table.to_string(), identity.to_string()),
            RowChange {
                table_name: table.to_string(),
                row_identity: identity,
                kind: RowChangeKind::Upsert(json!({"id": id, "quantity": quantity})),
            },
        )
    }

    #[test]
    fn changed_rows_exclude_unchanged_references_and_preserve_quant_tombstones() {
        let before = BTreeMap::from([
            row(0, "mrp_production", 1, 1),
            row(6, "stock_quant", 2, 3),
            row(6, "stock_quant", 3, 7),
        ]);
        let after = BTreeMap::from([
            row(0, "mrp_production", 1, 2),
            row(4, "stock_move", 4, 3),
            row(6, "stock_quant", 3, 7),
        ]);
        let changes = changed_rows(before, after);
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].table_name, "stock_quant");
        assert_eq!(changes[0].row_identity, json!({"id": 2}));
        assert!(matches!(changes[0].kind, RowChangeKind::Delete));
        assert_eq!(changes[1].table_name, "mrp_production");
        assert_eq!(changes[2].table_name, "stock_move");
    }

    #[test]
    fn idempotent_replay_has_no_durable_row_changes() {
        let before = BTreeMap::from([row(0, "mrp_production", 1, 1)]);
        let after = BTreeMap::from([row(0, "mrp_production", 1, 1)]);
        assert!(changed_rows(before, after).is_empty());
    }
}
