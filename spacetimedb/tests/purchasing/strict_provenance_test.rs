//! COV-05f1 domain evidence only; parent registers these callable helpers.
//! Requires COV-05f0 capture before execution. No browser/operator claim.
use spacetimedb::{ReducerContext, Table};
use std::time::Duration;

use crate::accounting::fiscal_periods::{
    account_fiscal_year, account_period, create_account_period, create_fiscal_year,
    open_account_period, open_fiscal_year, CreateAccountPeriodParams, CreateFiscalYearParams,
};
use crate::accounting::journal_entries::{
    account_move, account_move_line, create_bill_from_purchase_order, delete_account_move_line,
    post_account_move_impl, post_invoice, update_account_move_line, AccountMove, AccountMoveLine,
    CreateBillFromPurchaseOrderParams, DeleteAccountMoveLineParams, UpdateAccountMoveLineParams,
};
use crate::accounting::line_params::blank_journal_line;
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, confirm_purchase_order, create_purchase_order, purchase_order,
    purchase_order_line, receive_po_line, AddPurchaseOrderLineParams, CreatePurchaseOrderParams,
    PurchaseOrder, PurchaseOrderLine,
};
use crate::test_harness::PurchasingIntegrityFixture;
use crate::types::AccountMoveState;
use crate::workflow::action_registry::guarded_action_receipt;
use crate::workflow::approvals::workflow_human_task;

struct ProvenanceFixture {
    scope: PurchasingIntegrityFixture,
    po_id: u64,
    bill_id: u64,
    sources: Vec<u64>,
}

fn seed(ctx: &ReducerContext) -> Result<ProvenanceFixture, String> {
    let scope = PurchasingIntegrityFixture::seed(ctx)?;
    let s = &scope.primary;
    // Primary purchasing company is distinct from the harness baseline company.
    let date_from = ctx.timestamp - Duration::from_secs(86400);
    let date_to = ctx.timestamp + Duration::from_secs(86400);
    create_fiscal_year(
        ctx,
        s.organization_id,
        s.company_id,
        CreateFiscalYearParams {
            name: "Strict provenance FY".into(),
            date_from,
            date_to,
            type_: "standard".into(),
            is_adjustment: false,
            notes: None,
            metadata: None,
        },
    )?;
    let years: Vec<_> = ctx
        .db
        .account_fiscal_year()
        .fiscal_year_by_company()
        .filter(&s.company_id)
        .collect();
    if years.len() != 1 {
        return Err("strict fixture expected exactly one fiscal year".into());
    }
    let fiscal_year_id = years[0].id;
    create_account_period(
        ctx,
        s.organization_id,
        s.company_id,
        CreateAccountPeriodParams {
            name: "Strict provenance period".into(),
            code: "STRICT".into(),
            date_from,
            date_to,
            fiscal_year_id,
            is_adjustment: false,
            notes: None,
            metadata: None,
        },
    )?;
    let periods: Vec<_> = ctx
        .db
        .account_period()
        .period_by_fiscal_year()
        .filter(&fiscal_year_id)
        .collect();
    if periods.len() != 1 {
        return Err("strict fixture expected exactly one accounting period".into());
    }
    open_fiscal_year(ctx, s.organization_id, s.company_id, fiscal_year_id)?;
    open_account_period(ctx, s.organization_id, s.company_id, periods[0].id)?;
    create_purchase_order(
        ctx,
        s.organization_id,
        CreatePurchaseOrderParams {
            company_id: Some(s.company_id),
            partner_id: s.vendor_id,
            currency_id: s.currency_id,
            origin: None,
            partner_ref: None,
            notes: None,
            date_planned: None,
            payment_term_id: None,
            fiscal_position_id: None,
            incoterm_id: None,
            incoterm_location: None,
            user_id: None,
            invoice_ids: vec![],
            picking_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            activity_ids: vec![],
            is_quantity_copy: None,
            metadata: None,
        },
    )?;
    // Fresh fixture scope has one PO, not a newest/product/name heuristic.
    let orders: Vec<_> = ctx
        .db
        .purchase_order()
        .purchase_order_by_org()
        .filter(&s.organization_id)
        .collect();
    if orders.len() != 1 {
        return Err("strict fixture expected exactly one source PO".into());
    }
    let po_id = orders[0].id;
    for (sequence, price_unit) in [(1, 17.0), (2, 29.0)] {
        add_purchase_order_line(
            ctx,
            s.organization_id,
            po_id,
            AddPurchaseOrderLineParams {
                product_id: s.product_id,
                quantity: 2.0,
                uom_id: s.uom_id,
                price_unit,
                discount: 0.0,
                tax_ids: vec![],
                name: None,
                sequence: Some(sequence),
                display_type: None,
                product_variant_id: None,
                account_analytic_id: None,
                date_planned: None,
                propagate_cancel: None,
                lot_id: None,
                metadata: None,
            },
        )?;
    }
    confirm_purchase_order(ctx, s.organization_id, po_id)?;
    let mut sources: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po_id)
        .map(|line| line.id)
        .collect();
    sources.sort_unstable();
    if sources.len() != 2 {
        return Err("strict fixture expected two source lines".into());
    }
    for &id in &sources {
        receive_po_line(ctx, s.organization_id, id, 2.0, None)?;
    }
    let mut payable_line = blank_journal_line(s.payable_account_id, "Payable".into());
    payable_line.exclude_from_invoice_tab = true;
    create_bill_from_purchase_order(
        ctx,
        s.organization_id,
        po_id,
        CreateBillFromPurchaseOrderParams {
            journal_id: s.journal_id,
            default_expense_account_id: s.expense_account_id,
            invoice_date: ctx.timestamp,
            expense_line: blank_journal_line(s.expense_account_id, String::new()),
            payable_line,
            metadata: None,
        },
    )?;
    let po = ctx
        .db
        .purchase_order()
        .id()
        .find(&po_id)
        .ok_or("fixture PO missing")?;
    if po.invoice_ids.len() != 1 {
        return Err("strict fixture expected exactly one canonical bill".into());
    }
    let bill_id = po.invoice_ids[0];
    for &id in &sources {
        let source = ctx
            .db
            .purchase_order_line()
            .id()
            .find(&id)
            .ok_or("fixture source missing")?;
        if source.invoice_lines.len() != 1 {
            return Err("COV-05f0 must capture exactly one bill line per fixture source before f1 tests run".into());
        }
        let line = ctx
            .db
            .account_move_line()
            .id()
            .find(&source.invoice_lines[0])
            .ok_or("captured bill line missing")?;
        if line.move_id != bill_id
            || line.price_unit != source.price_unit
            || line.partner_id != Some(s.vendor_id)
        {
            return Err("captured fixture provenance disagrees with exact source".into());
        }
    }
    Ok(ProvenanceFixture {
        scope,
        po_id,
        bill_id,
        sources,
    })
}

fn post(ctx: &ReducerContext, f: &ProvenanceFixture) -> Result<(), String> {
    let s = &f.scope.primary;
    post_invoice(
        ctx,
        s.organization_id,
        f.bill_id,
        s.expense_account_id,
        s.expense_account_id,
    )
}

fn source(ctx: &ReducerContext, id: u64) -> Result<PurchaseOrderLine, String> {
    ctx.db
        .purchase_order_line()
        .id()
        .find(&id)
        .ok_or_else(|| "source missing".into())
}

fn order(ctx: &ReducerContext, id: u64) -> Result<PurchaseOrder, String> {
    ctx.db
        .purchase_order()
        .id()
        .find(&id)
        .ok_or_else(|| "PO missing".into())
}

fn restore_source(ctx: &ReducerContext, original: &PurchaseOrderLine) -> Result<(), String> {
    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        invoice_lines: original.invoice_lines.clone(),
        organization_id: original.organization_id,
        company_id: original.company_id,
        order_id: original.order_id,
        product_id: original.product_id,
        price_unit: original.price_unit,
        qty_received: original.qty_received,
        qty_invoiced: original.qty_invoiced,
        ..source(ctx, original.id)?
    });
    Ok(())
}

fn restore_order(ctx: &ReducerContext, original: &PurchaseOrder) -> Result<(), String> {
    ctx.db.purchase_order().id().update(PurchaseOrder {
        invoice_ids: original.invoice_ids.clone(),
        invoice_count: original.invoice_count,
        organization_id: original.organization_id,
        company_id: original.company_id,
        ..order(ctx, original.id)?
    });
    Ok(())
}

// Snapshot after fixture corruption, before the rejected command. This checks
// the command itself preserves both economic state and canonical relation sets.
fn expect_rejected(
    ctx: &ReducerContext,
    f: &ProvenanceFixture,
    diagnostic: &str,
) -> Result<(), String> {
    for route in 0..3 {
        expect_route_rejected(ctx, f, diagnostic, route)?;
    }
    Ok(())
}

fn expect_route_rejected(
    ctx: &ReducerContext,
    f: &ProvenanceFixture,
    diagnostic: &str,
    route: u8,
) -> Result<(), String> {
    let bill = ctx
        .db
        .account_move()
        .id()
        .find(&f.bill_id)
        .ok_or("bill missing")?;
    let balances = || {
        let mut values: Vec<_> = ctx
            .db
            .account_move_line()
            .iter()
            .map(|l| {
                (
                    l.id,
                    l.move_id,
                    l.debit,
                    l.credit,
                    l.balance,
                    l.parent_state,
                    l.quantity.to_bits(),
                    l.price_unit.to_bits(),
                    l.partner_id,
                    l.move_name,
                    l.write_uid,
                    l.write_date,
                )
            })
            .collect();
        values.sort_by_key(|l| l.0);
        values
    };
    let relations = || {
        let mut owners: Vec<_> = ctx
            .db
            .purchase_order()
            .iter()
            .map(|p| (p.id, p.invoice_ids, p.invoice_count))
            .collect();
        owners.sort_by_key(|p| p.0);
        let mut sources: Vec<_> = ctx
            .db
            .purchase_order_line()
            .iter()
            .map(|l| {
                (
                    l.id,
                    l.invoice_lines,
                    l.qty_invoiced.to_bits(),
                    l.qty_received.to_bits(),
                    l.price_unit.to_bits(),
                    l.organization_id,
                    l.company_id,
                    l.order_id,
                    l.product_id,
                    l.partner_id,
                )
            })
            .collect();
        sources.sort_by_key(|l| l.0);
        (owners, sources)
    };
    let before_balances = balances();
    let before_relations = relations();
    let approval_counts = (
        ctx.db.workflow_human_task().iter().count(),
        ctx.db.guarded_action_receipt().iter().count(),
    );
    let result = match route {
        0 => post(ctx, f),
        1 => post_account_move_impl(ctx, f.scope.primary.organization_id, f.bill_id, false),
        _ => post_account_move_impl(ctx, f.scope.primary.organization_id, f.bill_id, true),
    };
    let err = result
        .err()
        .ok_or("invalid provenance unexpectedly posted")?;
    if !err.contains(diagnostic) {
        return Err(format!(
            "expected strict provenance diagnostic {diagnostic:?}, got {err:?}"
        ));
    }
    // Cross-scope diagnostics may identify the proven current bill, but never
    // the unproven owner/source rows found by the global uniqueness scan.
    for po in
        ctx.db.purchase_order().iter().filter(|po| {
            po.organization_id != bill.organization_id || po.company_id != bill.company_id
        })
    {
        if mentions_id(&err, "PO owner", po.id) || mentions_id(&err, "PO", po.id) {
            return Err("strict rejection disclosed an unproven PO ID".into());
        }
    }
    for line in ctx.db.purchase_order_line().iter().filter(|line| {
        line.organization_id != bill.organization_id || line.company_id != bill.company_id
    }) {
        if mentions_id(&err, "PO line", line.id) || mentions_id(&err, "source line", line.id) {
            return Err("strict rejection disclosed an unproven source line ID".into());
        }
    }
    let after = ctx
        .db
        .account_move()
        .id()
        .find(&f.bill_id)
        .ok_or("bill lost on rejection")?;
    if after.state != AccountMoveState::Draft
        || after.state != bill.state
        || after.amount_total != bill.amount_total
        || after.amount_residual != bill.amount_residual
        || after.partner_id != bill.partner_id
        || after.name != bill.name
        || after.posted_before != bill.posted_before
        || after.write_uid != bill.write_uid
        || after.write_date != bill.write_date
        || balances() != before_balances
        || relations() != before_relations
        || approval_counts
            != (
                ctx.db.workflow_human_task().iter().count(),
                ctx.db.guarded_action_receipt().iter().count(),
            )
    {
        return Err(
            "rejected provenance post changed Draft, balances, totals or canonical relations"
                .into(),
        );
    }
    Ok(())
}

fn mentions_id(error: &str, label: &str, id: u64) -> bool {
    let needle = format!("{label} {id}");
    error.match_indices(&needle).any(|(offset, matched)| {
        error[offset + matched.len()..]
            .chars()
            .next()
            .map_or(true, |next| !next.is_ascii_digit())
    })
}

pub fn test_strict_po_provenance_exact_source_post(ctx: &ReducerContext) -> Result<(), String> {
    let f = seed(ctx)?;
    // Canonical ownership remains authoritative even when the optional label is absent.
    let draft = ctx
        .db
        .account_move()
        .id()
        .find(&f.bill_id)
        .ok_or("draft bill missing")?;
    ctx.db.account_move().id().update(AccountMove {
        invoice_origin: None,
        ..draft
    });
    post(ctx, &f)?;
    let bill = ctx
        .db
        .account_move()
        .id()
        .find(&f.bill_id)
        .ok_or("posted bill missing")?;
    if bill.state != AccountMoveState::Posted {
        return Err("same-product distinct-price bill did not post".into());
    }
    for id in f.sources {
        let source = ctx
            .db
            .purchase_order_line()
            .id()
            .find(&id)
            .ok_or("posted source missing")?;
        if source.invoice_lines.len() != 1 {
            return Err("posting changed exact source membership".into());
        }
    }
    Ok(())
}

pub fn test_strict_po_provenance_rejections(ctx: &ReducerContext) -> Result<(), String> {
    let f = seed(ctx)?;
    let po = ctx
        .db
        .purchase_order()
        .id()
        .find(&f.po_id)
        .ok_or("PO missing")?;
    let first = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&f.sources[0])
        .ok_or("source missing")?;
    let second = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&f.sources[1])
        .ok_or("source missing")?;
    let bill = ctx
        .db
        .account_move()
        .id()
        .find(&f.bill_id)
        .ok_or("bill missing")?;
    let invoice_line_id = first.invoice_lines[0];
    let other = ctx.db.purchase_order().insert(PurchaseOrder {
        id: 0,
        invoice_ids: vec![],
        invoice_count: 0,
        organization_id: f.scope.foreign.organization_id,
        company_id: f.scope.foreign.company_id,
        ..order(ctx, po.id)?
    });

    // Legacy missing provenance is deliberately not backfilled by product.
    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        invoice_lines: vec![],
        ..source(ctx, first.id)?
    });
    expect_rejected(ctx, &f, "no exact source")?;
    restore_source(ctx, &first)?;

    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        invoice_lines: vec![invoice_line_id, invoice_line_id],
        ..source(ctx, first.id)?
    });
    expect_rejected(ctx, &f, "duplicate source")?;
    restore_source(ctx, &first)?;
    let mut memberships = second.invoice_lines.clone();
    memberships.push(invoice_line_id);
    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        invoice_lines: memberships,
        ..source(ctx, second.id)?
    });
    expect_rejected(ctx, &f, "duplicate source")?;
    restore_source(ctx, &second)?;

    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        product_id: f.scope.foreign.product_id,
        ..source(ctx, first.id)?
    });
    expect_rejected(ctx, &f, "product disagrees")?;
    restore_source(ctx, &first)?;
    for (organization_id, company_id) in [
        (f.scope.foreign.organization_id, first.company_id),
        (first.organization_id, f.scope.cross_company_id),
    ] {
        ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
            organization_id,
            company_id,
            ..source(ctx, first.id)?
        });
        expect_rejected(ctx, &f, "scope or parent")?;
        restore_source(ctx, &first)?;
    }
    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        order_id: other.id,
        ..source(ctx, first.id)?
    });
    expect_rejected(ctx, &f, "scope or parent")?;
    restore_source(ctx, &first)?;
    // No source lines must not silently exempt the bill from matching.
    for id in [first.id, second.id] {
        ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
            order_id: other.id,
            ..source(ctx, id)?
        });
    }
    expect_rejected(ctx, &f, "no source lines")?;
    restore_source(ctx, &first)?;
    restore_source(ctx, &second)?;

    ctx.db.purchase_order().id().update(PurchaseOrder {
        invoice_ids: vec![f.bill_id, f.bill_id],
        ..order(ctx, po.id)?
    });
    expect_rejected(ctx, &f, "duplicate PO owners")?;
    restore_order(ctx, &po)?;
    // Two actual canonical owners, rather than a second origin label.
    let duplicate = ctx.db.purchase_order().insert(PurchaseOrder {
        id: 0,
        ..order(ctx, po.id)?
    });
    expect_rejected(ctx, &f, "duplicate PO owners")?;
    ctx.db.purchase_order().id().delete(duplicate.id);
    for (organization_id, company_id) in [
        (f.scope.foreign.organization_id, po.company_id),
        (po.organization_id, f.scope.cross_company_id),
    ] {
        ctx.db.purchase_order().id().update(PurchaseOrder {
            organization_id,
            company_id,
            ..order(ctx, po.id)?
        });
        expect_rejected(ctx, &f, "outside bill scope")?;
        restore_order(ctx, &po)?;
    }
    ctx.db.account_move().id().update(AccountMove {
        invoice_origin: Some(format!("PO{}", other.id)),
        ..bill.clone()
    });
    expect_rejected(ctx, &f, "origin disagrees")?;
    ctx.db.account_move().id().update(bill.clone());
    ctx.db.purchase_order().id().update(PurchaseOrder {
        invoice_ids: vec![],
        invoice_count: 0,
        ..order(ctx, po.id)?
    });
    expect_rejected(ctx, &f, "without canonical PO ownership")?;
    restore_order(ctx, &po)?;

    // Exact membership is not permission to overbill or change the source price.
    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        price_unit: first.price_unit + 10.0,
        ..source(ctx, first.id)?
    });
    expect_rejected(ctx, &f, "bill price")?;
    restore_source(ctx, &first)?;
    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        qty_received: 0.0,
        ..source(ctx, first.id)?
    });
    expect_rejected(ctx, &f, "three-way match failed")?;
    restore_source(ctx, &first)?;

    // Persisted nonfinite values bypass ordinary comparisons unless explicitly
    // rejected. Bit snapshots retain NaN equality for unchanged-state evidence.
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for field in 0..3 {
            ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
                qty_received: if field == 0 {
                    value
                } else {
                    first.qty_received
                },
                qty_invoiced: if field == 1 {
                    value
                } else {
                    first.qty_invoiced
                },
                price_unit: if field == 2 { value } else { first.price_unit },
                ..source(ctx, first.id)?
            });
            expect_rejected(ctx, &f, "nonfinite")?;
            restore_source(ctx, &first)?;
        }
        let original = ctx
            .db
            .account_move_line()
            .id()
            .find(&invoice_line_id)
            .ok_or("bill product line missing")?;
        for field in 0..2 {
            ctx.db.account_move_line().id().update(AccountMoveLine {
                quantity: if field == 0 { value } else { original.quantity },
                price_unit: if field == 1 {
                    value
                } else {
                    original.price_unit
                },
                ..original.clone()
            });
            expect_rejected(ctx, &f, "nonfinite")?;
            ctx.db.account_move_line().id().update(original.clone());
        }
    }
    // A reverse edge pointing outside the owning graph must be rejected even
    // when the actual current bill product line still has its correct edge.
    let original = ctx
        .db
        .account_move_line()
        .id()
        .find(&invoice_line_id)
        .ok_or("bill product line missing")?;
    let outside = ctx.db.account_move_line().insert(AccountMoveLine {
        id: 0,
        organization_id: f.scope.foreign.organization_id,
        company_id: f.scope.foreign.company_id,
        ..original.clone()
    });
    let mut edges = first.invoice_lines.clone();
    edges.push(outside.id);
    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        invoice_lines: edges,
        ..source(ctx, first.id)?
    });
    expect_rejected(ctx, &f, "scope or parent")?;
    restore_source(ctx, &first)?;
    ctx.db.account_move_line().id().delete(outside.id);
    let outside = ctx.db.account_move_line().insert(AccountMoveLine {
        id: 0,
        move_id: u64::MAX,
        ..original
    });
    let mut edges = first.invoice_lines.clone();
    edges.push(outside.id);
    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        invoice_lines: edges,
        ..source(ctx, first.id)?
    });
    expect_rejected(ctx, &f, "scope or parent")?;
    restore_source(ctx, &first)?;
    ctx.db.account_move_line().id().delete(outside.id);
    ctx.db.account_move().id().update(AccountMove {
        partner_id: Some(f.scope.foreign.vendor_id),
        ..bill.clone()
    });
    expect_rejected(ctx, &f, "partner disagrees")?;
    ctx.db.account_move().id().update(bill.clone());
    let partner_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&f.bill_id)
        .collect();
    for original in partner_lines {
        ctx.db.account_move_line().id().update(AccountMoveLine {
            partner_id: Some(f.scope.foreign.vendor_id),
            ..original.clone()
        });
        expect_rejected(ctx, &f, "partner disagrees")?;
        ctx.db.account_move_line().id().update(original);
    }

    // Real reducer path: delete product, then rebalance payable. The old
    // invoice_lines edge remains, so every posting owner must fail closed.
    let removed = ctx
        .db
        .account_move_line()
        .id()
        .find(&invoice_line_id)
        .ok_or("bill product line missing")?;
    delete_account_move_line(
        ctx,
        f.scope.primary.organization_id,
        invoice_line_id,
        DeleteAccountMoveLineParams {
            company_id: Some(f.scope.primary.company_id),
        },
    )?;
    let payable = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&f.bill_id)
        .find(|line| line.account_id == f.scope.primary.payable_account_id)
        .ok_or("payable missing")?;
    update_account_move_line(
        ctx,
        f.scope.primary.organization_id,
        payable.id,
        UpdateAccountMoveLineParams {
            quantity: None,
            price_unit: None,
            expected_quantity: None,
            expected_price_unit: None,
            company_id: Some(f.scope.primary.company_id),
            name: None,
            debit: None,
            credit: Some(payable.credit - removed.debit),
            partner_id: None,
            analytic_account_id: None,
            metadata: None,
        },
    )?;
    let balance: f64 = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&f.bill_id)
        .map(|line| line.debit - line.credit)
        .sum();
    if balance.abs() > 0.01 {
        return Err(
            "deletion/rebalance fixture must remain balanced before strict rejection".into(),
        );
    }
    expect_rejected(ctx, &f, "dangling source")?;
    ctx.db.purchase_order().id().delete(other.id);
    Ok(())
}

pub fn test_strict_provenance_manual_vendor_bill(ctx: &ReducerContext) -> Result<(), String> {
    for origin in [
        Some("Manual vendor invoice"),
        Some("PO Box renewal"),
        Some("PORT charges"),
        Some("PODCAST sponsorship"),
        Some("PO00123"),
        Some("PO+123"),
        None,
    ] {
        test_manual_origin(ctx, origin)?;
    }
    Ok(())
}

fn test_manual_origin(ctx: &ReducerContext, origin: Option<&str>) -> Result<(), String> {
    let f = seed(ctx)?;
    let bill = ctx
        .db
        .account_move()
        .id()
        .find(&f.bill_id)
        .ok_or("bill missing")?;
    let po = ctx
        .db
        .purchase_order()
        .id()
        .find(&f.po_id)
        .ok_or("PO missing")?;
    // Convert this balanced fixture to a genuine non-PO manual bill: remove
    // both owner relations, not just the label. No fake product-source link.
    ctx.db.purchase_order().id().update(PurchaseOrder {
        invoice_ids: vec![],
        invoice_count: 0,
        ..po
    });
    for &id in &f.sources {
        let source = ctx
            .db
            .purchase_order_line()
            .id()
            .find(&id)
            .ok_or("source missing")?;
        ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
            invoice_lines: vec![],
            ..source
        });
    }
    ctx.db.account_move().id().update(AccountMove {
        invoice_origin: Some("PO123".into()),
        ..bill.clone()
    });
    expect_rejected(ctx, &f, "without canonical PO ownership")?;
    ctx.db.account_move().id().update(AccountMove {
        invoice_origin: origin.map(str::to_string),
        ..bill
    });
    post(ctx, &f)?;
    if ctx
        .db
        .account_move()
        .id()
        .find(&f.bill_id)
        .ok_or("manual bill missing")?
        .state
        != AccountMoveState::Posted
    {
        return Err("legitimate manual vendor bill did not post".into());
    }
    Ok(())
}
