//! Purchasing relational-integrity inventory (Phase 0 — containment).
//!
//! This operational reducer is intentionally read-only. It iterates persisted
//! tables, checks their relationship graph, and writes a structured summary to
//! the module log. It never inserts, updates, or deletes rows.
//!
//! Run with `spacetime call <database> purchasing_integrity_inventory`, then
//! capture the `[purchasing-integrity]` lines from `spacetime logs <database>`.

use std::collections::{HashMap, HashSet};

use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::account_journal;
use crate::accounting::journal_entries::account_move;
use crate::accounting::payment_terms::account_payment_term;
use crate::core::organization::company;
use crate::core::reference::{currency, uom};
use crate::crm::contacts::contact;
use crate::inventory::product::product;
use crate::inventory::stock::stock_picking;
use crate::inventory::warehouse::warehouse;
use crate::purchasing::landed_costs::{stock_landed_cost, stock_landed_cost_lines};
use crate::purchasing::procurement_advanced::{
    commodity_price_index, consignment_agreement, purchase_approval_delegate,
    purchase_blanket_order, purchase_contract, purchasing_integration_intent, vendor_risk_flag,
    vendor_scorecard,
};
use crate::purchasing::purchase_orders::{
    purchase_order, purchase_order_line, purchase_requisition, purchase_requisition_line,
};
use crate::purchasing::purchase_returns::{purchase_return, purchase_return_line};
use crate::purchasing::sourcing::{purchase_rfq, purchase_rfq_bid, purchase_rfq_line};
use crate::purchasing::vendor_management::{res_partner_bank, supplier_intake_request};

const MAX_SAMPLES: usize = 5;

/// Finding rows preserve per-table occurrences. Numeric primary keys are only
/// table-local, so a cross-table diagnostic must not collapse `purchase_order:1`
/// and `purchase_order_line:1` into one violation.
#[derive(Default)]
struct FindingIds(Vec<u64>);

impl FindingIds {
    fn insert(&mut self, id: u64) {
        self.0.push(id);
    }
}

struct Finding {
    category: &'static str,
    description: &'static str,
    count: usize,
    sample_ids: Vec<u64>,
}

impl Finding {
    fn from_ids(category: &'static str, description: &'static str, ids: FindingIds) -> Self {
        let count = ids.0.len();
        let mut sample_ids = ids.0;
        sample_ids.sort_unstable();
        sample_ids.truncate(MAX_SAMPLES);
        Self {
            category,
            description,
            count,
            sample_ids,
        }
    }

    fn log(&self) {
        if self.count == 0 {
            log::info!(
                "[purchasing-integrity] category={} count=0 sample_ids=[] -- {}",
                self.category,
                self.description
            );
        } else {
            log::warn!(
                "[purchasing-integrity] category={} count={} sample_ids={:?} -- {}",
                self.category,
                self.count,
                self.sample_ids,
                self.description
            );
        }
    }
}

fn duplicate_members(ids: &[u64]) -> bool {
    ids.iter().collect::<HashSet<_>>().len() != ids.len()
}

/// Required parent IDs, optional external IDs, and company references that use
/// `0` instead of `None` are unsafe because they cannot resolve to a real row.
fn check_zero_ids(ctx: &ReducerContext) -> Finding {
    let mut ids = FindingIds::default();
    for row in ctx.db.purchase_order().iter() {
        if row.company_id == 0 || row.partner_id == 0 || row.currency_id == 0 {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_order_line().iter() {
        if row.order_id == 0 || row.company_id == 0 || row.product_id == 0 || row.product_uom == 0 {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_requisition().iter() {
        if row.company_id == 0 {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_requisition_line().iter() {
        if row.requisition_id == 0
            || row.company_id == 0
            || row.product_id == 0
            || row.product_uom == 0
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_rfq().iter() {
        if row.company_id == 0 || row.currency_id == 0 {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_rfq_line().iter() {
        if row.rfq_id == 0 || row.company_id == 0 || row.product_id == 0 || row.product_uom == 0 {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_rfq_bid().iter() {
        if row.rfq_id == 0 || row.company_id == 0 || row.partner_id == 0 || row.currency_id == 0 {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_return().iter() {
        if row.company_id == 0 || row.partner_id == 0 {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_return_line().iter() {
        if row.purchase_return_id == 0
            || row.company_id == 0
            || row.product_id == 0
            || row.product_uom == 0
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.stock_landed_cost().iter() {
        if row.company_id == 0
            || row.currency_id == 0
            || row.account_move_id == Some(0)
            || row.account_journal_id == Some(0)
            || row.vendor_bill_id == Some(0)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.stock_landed_cost_lines().iter() {
        if row.landed_cost_id == 0 || row.product_id == 0 || row.currency_id == 0 {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.res_partner_bank().iter() {
        if row.partner_id == 0
            || row.bank_id == Some(0)
            || row.currency_id == Some(0)
            || row.company_id == Some(0)
            || row.journal_id == Some(0)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.supplier_intake_request().iter() {
        if row.payment_terms_id == Some(0)
            || row.currency_id == Some(0)
            || row.partner_id == Some(0)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchasing_integration_intent().iter() {
        if row.company_id == 0 || row.purchase_order_id == Some(0) {
            ids.insert(row.id);
        }
    }
    Finding::from_ids(
        "zero_relation_ids",
        "required purchasing relation IDs or optional company/PO IDs use sentinel 0",
        ids,
    )
}

/// Missing parent/external target rows. Global currencies are checked for
/// existence only; organization-scoped targets are checked again for scope.
fn check_dangling_relations(ctx: &ReducerContext) -> Finding {
    let company_ids: HashSet<u64> = ctx.db.company().iter().map(|r| r.id).collect();
    let contact_ids: HashSet<u64> = ctx.db.contact().iter().map(|r| r.id).collect();
    let product_ids: HashSet<u64> = ctx.db.product().iter().map(|r| r.id).collect();
    let uom_ids: HashSet<u64> = ctx.db.uom().iter().map(|r| r.id).collect();
    let currency_ids: HashSet<u64> = ctx.db.currency().iter().map(|r| r.id).collect();
    let order_ids: HashSet<u64> = ctx.db.purchase_order().iter().map(|r| r.id).collect();
    let order_line_ids: HashSet<u64> = ctx.db.purchase_order_line().iter().map(|r| r.id).collect();
    let req_ids: HashSet<u64> = ctx.db.purchase_requisition().iter().map(|r| r.id).collect();
    let rfq_ids: HashSet<u64> = ctx.db.purchase_rfq().iter().map(|r| r.id).collect();
    let return_ids: HashSet<u64> = ctx.db.purchase_return().iter().map(|r| r.id).collect();
    let landed_cost_ids: HashSet<u64> = ctx.db.stock_landed_cost().iter().map(|r| r.id).collect();
    let picking_ids: HashSet<u64> = ctx.db.stock_picking().iter().map(|r| r.id).collect();
    let move_ids: HashSet<u64> = ctx.db.account_move().iter().map(|r| r.id).collect();
    let journal_ids: HashSet<u64> = ctx.db.account_journal().iter().map(|r| r.id).collect();
    let term_ids: HashSet<u64> = ctx.db.account_payment_term().iter().map(|r| r.id).collect();
    let warehouse_ids: HashSet<u64> = ctx.db.warehouse().iter().map(|r| r.id).collect();
    let mut ids = FindingIds::default();

    for row in ctx.db.purchase_order().iter() {
        if !company_ids.contains(&row.company_id)
            || !contact_ids.contains(&row.partner_id)
            || !currency_ids.contains(&row.currency_id)
            || row
                .payment_term_id
                .is_some_and(|id| !term_ids.contains(&id))
            || row.invoice_ids.iter().any(|id| !move_ids.contains(id))
            || row.picking_ids.iter().any(|id| !picking_ids.contains(id))
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_order_line().iter() {
        if !order_ids.contains(&row.order_id)
            || !product_ids.contains(&row.product_id)
            || !uom_ids.contains(&row.product_uom)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_requisition().iter() {
        if !company_ids.contains(&row.company_id)
            || row.vendor_id.is_some_and(|id| !contact_ids.contains(&id))
            || row
                .line_ids
                .iter()
                .any(|id| !ctx.db.purchase_requisition_line().id().find(id).is_some())
            || row.purchase_ids.iter().any(|id| !order_ids.contains(id))
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_requisition_line().iter() {
        if !req_ids.contains(&row.requisition_id)
            || !product_ids.contains(&row.product_id)
            || !uom_ids.contains(&row.product_uom)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_rfq().iter() {
        if !company_ids.contains(&row.company_id)
            || !currency_ids.contains(&row.currency_id)
            || row.requisition_id.is_some_and(|id| !req_ids.contains(&id))
            || row
                .purchase_order_id
                .is_some_and(|id| !order_ids.contains(&id))
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_rfq_line().iter() {
        if !rfq_ids.contains(&row.rfq_id)
            || !product_ids.contains(&row.product_id)
            || !uom_ids.contains(&row.product_uom)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_rfq_bid().iter() {
        if !rfq_ids.contains(&row.rfq_id)
            || !contact_ids.contains(&row.partner_id)
            || !currency_ids.contains(&row.currency_id)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_return().iter() {
        if !company_ids.contains(&row.company_id)
            || !contact_ids.contains(&row.partner_id)
            || row
                .purchase_order_id
                .is_some_and(|id| !order_ids.contains(&id))
            || row.picking_id.is_some_and(|id| !picking_ids.contains(&id))
            || row.credit_move_id.is_some_and(|id| !move_ids.contains(&id))
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_return_line().iter() {
        if !return_ids.contains(&row.purchase_return_id)
            || !product_ids.contains(&row.product_id)
            || !uom_ids.contains(&row.product_uom)
            || row
                .purchase_order_line_id
                .is_some_and(|id| !order_line_ids.contains(&id))
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.stock_landed_cost().iter() {
        if !company_ids.contains(&row.company_id)
            || !currency_ids.contains(&row.currency_id)
            || row.picking_ids.iter().any(|id| !picking_ids.contains(id))
            || row
                .account_move_id
                .is_some_and(|id| !move_ids.contains(&id))
            || row
                .account_journal_id
                .is_some_and(|id| !journal_ids.contains(&id))
            || row.vendor_bill_id.is_some_and(|id| !move_ids.contains(&id))
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.stock_landed_cost_lines().iter() {
        if !landed_cost_ids.contains(&row.landed_cost_id)
            || !product_ids.contains(&row.product_id)
            || !currency_ids.contains(&row.currency_id)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.res_partner_bank().iter() {
        if !contact_ids.contains(&row.partner_id)
            || row.company_id.is_some_and(|id| !company_ids.contains(&id))
            || row
                .currency_id
                .is_some_and(|id| !currency_ids.contains(&id))
            || row.journal_id.is_some_and(|id| !journal_ids.contains(&id))
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.supplier_intake_request().iter() {
        if row.partner_id.is_some_and(|id| !contact_ids.contains(&id))
            || row
                .payment_terms_id
                .is_some_and(|id| !term_ids.contains(&id))
            || row
                .currency_id
                .is_some_and(|id| !currency_ids.contains(&id))
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.consignment_agreement().iter() {
        if !company_ids.contains(&row.company_id)
            || !contact_ids.contains(&row.partner_id)
            || !product_ids.contains(&row.product_id)
            || !warehouse_ids.contains(&row.warehouse_id)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_blanket_order().iter() {
        if !company_ids.contains(&row.company_id)
            || !contact_ids.contains(&row.partner_id)
            || !currency_ids.contains(&row.currency_id)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_contract().iter() {
        if !company_ids.contains(&row.company_id) || !contact_ids.contains(&row.partner_id) {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.vendor_scorecard().iter() {
        if !company_ids.contains(&row.company_id) || !contact_ids.contains(&row.partner_id) {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.vendor_risk_flag().iter() {
        if !company_ids.contains(&row.company_id) || !contact_ids.contains(&row.partner_id) {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_approval_delegate().iter() {
        if !company_ids.contains(&row.company_id) {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.commodity_price_index().iter() {
        if !company_ids.contains(&row.company_id) {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchasing_integration_intent().iter() {
        if !company_ids.contains(&row.company_id)
            || row
                .purchase_order_id
                .is_some_and(|id| !order_ids.contains(&id))
        {
            ids.insert(row.id);
        }
    }
    Finding::from_ids(
        "dangling_relations",
        "purchasing relation fields whose referenced row is absent",
        ids,
    )
}

/// Relationships that exist but cross tenant/company boundaries, including a
/// purchasing record's claimed company belonging to another organization.
fn check_cross_scope(ctx: &ReducerContext) -> Finding {
    let companies: HashMap<u64, u64> = ctx
        .db
        .company()
        .iter()
        .map(|r| (r.id, r.organization_id))
        .collect();
    let contacts: HashMap<u64, (u64, Option<u64>)> = ctx
        .db
        .contact()
        .iter()
        .map(|r| (r.id, (r.organization_id, r.company_id)))
        .collect();
    let products: HashMap<u64, u64> = ctx
        .db
        .product()
        .iter()
        .map(|r| (r.id, r.organization_id))
        .collect();
    let uoms: HashMap<u64, u64> = ctx
        .db
        .uom()
        .iter()
        .map(|r| (r.id, r.organization_id))
        .collect();
    let orders: HashMap<u64, (u64, u64, u64, u64)> = ctx
        .db
        .purchase_order()
        .iter()
        .map(|r| {
            (
                r.id,
                (r.organization_id, r.company_id, r.partner_id, r.currency_id),
            )
        })
        .collect();
    let requisitions: HashMap<u64, (u64, u64)> = ctx
        .db
        .purchase_requisition()
        .iter()
        .map(|r| (r.id, (r.organization_id, r.company_id)))
        .collect();
    let rfqs: HashMap<u64, (u64, u64, u64)> = ctx
        .db
        .purchase_rfq()
        .iter()
        .map(|r| (r.id, (r.organization_id, r.company_id, r.currency_id)))
        .collect();
    let returns: HashMap<u64, (u64, u64, u64, Option<u64>)> = ctx
        .db
        .purchase_return()
        .iter()
        .map(|r| {
            (
                r.id,
                (
                    r.organization_id,
                    r.company_id,
                    r.partner_id,
                    r.purchase_order_id,
                ),
            )
        })
        .collect();
    let landed_costs: HashMap<u64, (u64, u64)> = ctx
        .db
        .stock_landed_cost()
        .iter()
        .map(|r| (r.id, (r.organization_id, r.company_id)))
        .collect();
    let pickings: HashMap<u64, (u64, u64)> = ctx
        .db
        .stock_picking()
        .iter()
        .map(|r| (r.id, (r.organization_id, r.company_id)))
        .collect();
    let journals: HashMap<u64, (u64, u64)> = ctx
        .db
        .account_journal()
        .iter()
        .map(|r| (r.id, (r.organization_id, r.company_id)))
        .collect();
    let accounting_moves: HashMap<u64, (u64, u64)> = ctx
        .db
        .account_move()
        .iter()
        .map(|r| (r.id, (r.organization_id, r.company_id)))
        .collect();
    let mut ids = FindingIds::default();
    let company_wrong = |org: u64, company_id: u64| {
        companies
            .get(&company_id)
            .is_some_and(|company_org| *company_org != org)
    };
    let contact_wrong = |org: u64, company_id: u64, contact_id: u64| {
        contacts
            .get(&contact_id)
            .is_some_and(|(target_org, target_company)| {
                *target_org != org || target_company.is_some_and(|id| id != company_id)
            })
    };
    let product_wrong = |org: u64, product_id: u64| {
        products
            .get(&product_id)
            .is_some_and(|target_org| *target_org != org)
    };
    let uom_wrong = |org: u64, uom_id: u64| {
        uoms.get(&uom_id)
            .is_some_and(|target_org| *target_org != org)
    };

    for row in ctx.db.purchase_order().iter() {
        if company_wrong(row.organization_id, row.company_id)
            || contact_wrong(row.organization_id, row.company_id, row.partner_id)
            || row.picking_ids.iter().any(|id| {
                pickings
                    .get(id)
                    .is_some_and(|scope| *scope != (row.organization_id, row.company_id))
            })
            || row.invoice_ids.iter().any(|id| {
                accounting_moves
                    .get(id)
                    .is_some_and(|scope| *scope != (row.organization_id, row.company_id))
            })
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_order_line().iter() {
        if let Some((org, company_id, _, _)) = orders.get(&row.order_id) {
            if *org != row.organization_id
                || *company_id != row.company_id
                || product_wrong(row.organization_id, row.product_id)
                || uom_wrong(row.organization_id, row.product_uom)
            {
                ids.insert(row.id);
            }
        }
    }
    for row in ctx.db.purchase_requisition().iter() {
        if company_wrong(row.organization_id, row.company_id)
            || row
                .vendor_id
                .is_some_and(|id| contact_wrong(row.organization_id, row.company_id, id))
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_requisition_line().iter() {
        if let Some((org, company_id)) = requisitions.get(&row.requisition_id) {
            if *org != row.organization_id
                || *company_id != row.company_id
                || product_wrong(row.organization_id, row.product_id)
                || uom_wrong(row.organization_id, row.product_uom)
            {
                ids.insert(row.id);
            }
        }
    }
    for row in ctx.db.purchase_rfq().iter() {
        if company_wrong(row.organization_id, row.company_id) {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_rfq_line().iter() {
        if let Some((org, company_id, _)) = rfqs.get(&row.rfq_id) {
            if *org != row.organization_id
                || *company_id != row.company_id
                || product_wrong(row.organization_id, row.product_id)
                || uom_wrong(row.organization_id, row.product_uom)
            {
                ids.insert(row.id);
            }
        }
    }
    for row in ctx.db.purchase_rfq_bid().iter() {
        if let Some((org, company_id, _)) = rfqs.get(&row.rfq_id) {
            if *org != row.organization_id
                || *company_id != row.company_id
                || contact_wrong(row.organization_id, row.company_id, row.partner_id)
            {
                ids.insert(row.id);
            }
        }
    }
    for row in ctx.db.purchase_return().iter() {
        if company_wrong(row.organization_id, row.company_id)
            || contact_wrong(row.organization_id, row.company_id, row.partner_id)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_return_line().iter() {
        if let Some((org, company_id, _, _)) = returns.get(&row.purchase_return_id) {
            if *org != row.organization_id
                || *company_id != row.company_id
                || product_wrong(row.organization_id, row.product_id)
                || uom_wrong(row.organization_id, row.product_uom)
            {
                ids.insert(row.id);
            }
        }
    }
    for row in ctx.db.stock_landed_cost().iter() {
        if company_wrong(row.organization_id, row.company_id)
            || row.picking_ids.iter().any(|id| {
                pickings
                    .get(id)
                    .is_some_and(|scope| *scope != (row.organization_id, row.company_id))
            })
            || row.account_journal_id.is_some_and(|id| {
                journals
                    .get(&id)
                    .is_some_and(|scope| *scope != (row.organization_id, row.company_id))
            })
            || [row.account_move_id, row.vendor_bill_id]
                .into_iter()
                .flatten()
                .any(|id| {
                    accounting_moves
                        .get(&id)
                        .is_some_and(|scope| *scope != (row.organization_id, row.company_id))
                })
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.stock_landed_cost_lines().iter() {
        if let Some((org, _)) = landed_costs.get(&row.landed_cost_id) {
            if *org != row.organization_id || product_wrong(row.organization_id, row.product_id) {
                ids.insert(row.id);
            }
        }
    }
    for row in ctx.db.res_partner_bank().iter() {
        if contacts
            .get(&row.partner_id)
            .is_some_and(|(org, _)| *org != row.organization_id)
            || row
                .company_id
                .is_some_and(|id| company_wrong(row.organization_id, id))
            || row.journal_id.is_some_and(|journal_id| {
                journals
                    .get(&journal_id)
                    .is_some_and(|(journal_org, journal_company)| {
                        *journal_org != row.organization_id
                            || row.company_id.is_some_and(|id| id != *journal_company)
                    })
            })
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.supplier_intake_request().iter() {
        if row.partner_id.is_some_and(|id| {
            contacts
                .get(&id)
                .is_some_and(|(org, _)| *org != row.organization_id)
        }) {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.consignment_agreement().iter() {
        if company_wrong(row.organization_id, row.company_id)
            || contact_wrong(row.organization_id, row.company_id, row.partner_id)
            || product_wrong(row.organization_id, row.product_id)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_blanket_order().iter() {
        if company_wrong(row.organization_id, row.company_id)
            || contact_wrong(row.organization_id, row.company_id, row.partner_id)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_contract().iter() {
        if company_wrong(row.organization_id, row.company_id)
            || contact_wrong(row.organization_id, row.company_id, row.partner_id)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.vendor_scorecard().iter() {
        if company_wrong(row.organization_id, row.company_id)
            || contact_wrong(row.organization_id, row.company_id, row.partner_id)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.vendor_risk_flag().iter() {
        if company_wrong(row.organization_id, row.company_id)
            || contact_wrong(row.organization_id, row.company_id, row.partner_id)
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_approval_delegate().iter() {
        if company_wrong(row.organization_id, row.company_id) {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.commodity_price_index().iter() {
        if company_wrong(row.organization_id, row.company_id) {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchasing_integration_intent().iter() {
        if company_wrong(row.organization_id, row.company_id)
            || row.purchase_order_id.is_some_and(|id| {
                orders.get(&id).is_some_and(|scope| {
                    scope.0 != row.organization_id || scope.1 != row.company_id
                })
            })
        {
            ids.insert(row.id);
        }
    }
    Finding::from_ids("cross_organization_or_company", "existing purchasing relations whose organization or company does not match the referencing row", ids)
}

/// Header vectors must mirror the authoritative child table while avoiding
/// repeated IDs. This intentionally does not repair anything.
fn check_duplicate_and_mismatched_collections(ctx: &ReducerContext) -> Finding {
    let req_lines: HashMap<u64, HashSet<u64>> =
        ctx.db
            .purchase_requisition_line()
            .iter()
            .fold(HashMap::new(), |mut map, row| {
                map.entry(row.requisition_id).or_default().insert(row.id);
                map
            });
    let rfq_lines: HashMap<u64, HashSet<u64>> =
        ctx.db
            .purchase_rfq_line()
            .iter()
            .fold(HashMap::new(), |mut map, row| {
                map.entry(row.rfq_id).or_default().insert(row.id);
                map
            });
    let rfq_bids: HashMap<u64, HashSet<u64>> =
        ctx.db
            .purchase_rfq_bid()
            .iter()
            .fold(HashMap::new(), |mut map, row| {
                map.entry(row.rfq_id).or_default().insert(row.id);
                map
            });
    let return_lines: HashMap<u64, HashSet<u64>> =
        ctx.db
            .purchase_return_line()
            .iter()
            .fold(HashMap::new(), |mut map, row| {
                map.entry(row.purchase_return_id)
                    .or_default()
                    .insert(row.id);
                map
            });
    let cost_lines: HashMap<u64, HashSet<u64>> =
        ctx.db
            .stock_landed_cost_lines()
            .iter()
            .fold(HashMap::new(), |mut map, row| {
                map.entry(row.landed_cost_id).or_default().insert(row.id);
                map
            });
    let mut ids = FindingIds::default();
    for row in ctx.db.purchase_order().iter() {
        if duplicate_members(&row.invoice_ids)
            || duplicate_members(&row.picking_ids)
            || duplicate_members(&row.message_follower_ids)
            || duplicate_members(&row.message_ids)
            || duplicate_members(&row.activity_ids)
            || row.picking_count as usize != row.picking_ids.len()
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_requisition().iter() {
        if duplicate_members(&row.line_ids)
            || duplicate_members(&row.purchase_ids)
            || row.line_ids.iter().copied().collect::<HashSet<_>>()
                != req_lines.get(&row.id).cloned().unwrap_or_default()
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_rfq().iter() {
        if duplicate_members(&row.line_ids)
            || duplicate_members(&row.bid_ids)
            || row.line_ids.iter().copied().collect::<HashSet<_>>()
                != rfq_lines.get(&row.id).cloned().unwrap_or_default()
            || row.bid_ids.iter().copied().collect::<HashSet<_>>()
                != rfq_bids.get(&row.id).cloned().unwrap_or_default()
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.purchase_return().iter() {
        if duplicate_members(&row.line_ids)
            || row.line_ids.iter().copied().collect::<HashSet<_>>()
                != return_lines.get(&row.id).cloned().unwrap_or_default()
        {
            ids.insert(row.id);
        }
    }
    for row in ctx.db.stock_landed_cost().iter() {
        if duplicate_members(&row.picking_ids)
            || duplicate_members(&row.cost_lines)
            || duplicate_members(&row.valuation_adjustment_lines)
            || row.cost_lines.iter().copied().collect::<HashSet<_>>()
                != cost_lines.get(&row.id).cloned().unwrap_or_default()
        {
            ids.insert(row.id);
        }
    }
    Finding::from_ids(
        "duplicate_or_mismatched_collections",
        "duplicate header-vector members, stale header vectors, or PO picking_count disagreement",
        ids,
    )
}

/// A small set of high-risk relation contracts where both targets exist but
/// their business attributes contradict the parent/source record.
fn check_business_relation_mismatches(ctx: &ReducerContext) -> Finding {
    let orders: HashMap<u64, (u64, u64, u64, u64)> = ctx
        .db
        .purchase_order()
        .iter()
        .map(|r| {
            (
                r.id,
                (r.organization_id, r.company_id, r.partner_id, r.currency_id),
            )
        })
        .collect();
    let rfqs: HashMap<u64, (u64, u64, u64)> = ctx
        .db
        .purchase_rfq()
        .iter()
        .map(|r| (r.id, (r.organization_id, r.company_id, r.currency_id)))
        .collect();
    let order_lines: HashMap<u64, (u64, u64, u64, u64, u64)> = ctx
        .db
        .purchase_order_line()
        .iter()
        .map(|r| {
            (
                r.id,
                (
                    r.order_id,
                    r.company_id,
                    r.product_id,
                    r.product_uom,
                    r.partner_id,
                ),
            )
        })
        .collect();
    let mut ids = FindingIds::default();
    for row in ctx.db.purchase_order_line().iter() {
        if let Some((_, company_id, partner_id, currency_id)) = orders.get(&row.order_id) {
            if row.company_id != *company_id
                || row.partner_id != *partner_id
                || row.currency_id != *currency_id
            {
                ids.insert(row.id);
            }
        }
    }
    for row in ctx.db.purchase_rfq_bid().iter() {
        if let Some((_, company_id, currency_id)) = rfqs.get(&row.rfq_id) {
            if row.company_id != *company_id || row.currency_id != *currency_id {
                ids.insert(row.id);
            }
        }
    }
    for row in ctx.db.purchase_return().iter() {
        if let Some(order_id) = row.purchase_order_id {
            if let Some((_, company_id, partner_id, _)) = orders.get(&order_id) {
                if row.company_id != *company_id || row.partner_id != *partner_id {
                    ids.insert(row.id);
                }
            }
        }
    }
    for row in ctx.db.purchase_return_line().iter() {
        if let Some(source_line_id) = row.purchase_order_line_id {
            if let Some((source_order_id, company_id, product_id, uom_id, _)) =
                order_lines.get(&source_line_id)
            {
                let parent_order_matches = ctx
                    .db
                    .purchase_return()
                    .id()
                    .find(&row.purchase_return_id)
                    .is_some_and(|parent| parent.purchase_order_id == Some(*source_order_id));
                if row.company_id != *company_id
                    || row.product_id != *product_id
                    || row.product_uom != *uom_id
                    || !parent_order_matches
                {
                    ids.insert(row.id);
                }
            }
        }
    }
    Finding::from_ids("mismatched_business_relations", "PO line, RFQ bid, purchase return, and sourced return-line fields that contradict their stored parent/source", ids)
}

/// Integration retries are only safe when their immutable logical-request key
/// is unique within organization, company, provider, and intent type.
fn check_duplicate_integration_intents(ctx: &ReducerContext) -> Finding {
    let mut seen: HashMap<(u64, u64, String, String, String), u64> = HashMap::new();
    let mut ids = HashSet::new();
    for row in ctx.db.purchasing_integration_intent().iter() {
        let key = (
            row.organization_id,
            row.company_id,
            row.provider.clone(),
            row.intent_type.clone(),
            row.idempotency_key.clone(),
        );
        if let Some(previous) = seen.insert(key, row.id) {
            ids.insert(previous);
            ids.insert(row.id);
        }
    }
    Finding::from_ids(
        "duplicate_integration_intents",
        "duplicate integration idempotency tuples (organization, company, provider, intent type, key)",
        FindingIds(ids.into_iter().collect()),
    )
}

/// Run the complete Phase 0 Purchasing inventory. This reducer performs no
/// database mutations and is safe to run repeatedly against populated data.
#[spacetimedb::reducer]
pub fn purchasing_integrity_inventory(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("[purchasing-integrity] === Purchasing relational-integrity inventory: start ===");
    let findings = [
        check_zero_ids(ctx),
        check_dangling_relations(ctx),
        check_cross_scope(ctx),
        check_duplicate_and_mismatched_collections(ctx),
        check_business_relation_mismatches(ctx),
        check_duplicate_integration_intents(ctx),
    ];
    let total_violations: usize = findings
        .iter()
        .map(|finding| {
            finding.log();
            finding.count
        })
        .sum();
    log::info!("[purchasing-integrity] === Purchasing relational-integrity inventory: done -- categories={} total_violations={} ===", findings.len(), total_violations);
    Ok(())
}
