//! Persisted actual-cost and journal-identity proofs for the manufacturing close owner.

use spacetimedb::{ReducerContext, Table};

use super::relational_integrity_test::{
    create_test_production_with_bom, create_test_workcenter, create_test_workorder,
};
use crate::accounting::chart_of_accounts::{
    account_account, account_journal, create_account_account, create_account_journal,
    CreateAccountAccountParams, CreateAccountJournalParams,
};
use crate::accounting::fiscal_periods::{account_period, close_account_period};
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::inventory::product::product;
use crate::inventory::stock::{stock_move, stock_quant};
use crate::manufacturing::bill_of_materials::{create_bom, mrp_bom, BomLineInput, CreateBomParams};
use crate::manufacturing::costing::{
    configure_manufacturing_valuation, configure_workcenter_cost_rate, mrp_production_cost,
    mrp_productivity_cost, mrp_valuation_config, mrp_workcenter_cost_rate,
    ConfigureManufacturingValuationParams,
};
use crate::manufacturing::manufacturing_orders::{
    confirm_manufacturing_order, consume_mo_materials, finish_manufacturing_order,
    finish_workorder, mrp_production, mrp_workorder, produce_manufacturing_order,
    start_manufacturing_order, start_workorder, update_manufacturing_order, MrpProduction,
    UpdateManufacturingOrderParams,
};
use crate::manufacturing::work_centers::{
    log_workcenter_productivity, CreateWorkcenterProductivityParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountInternalGroup, AccountMoveState, AccountTypeInternal, BomType, JournalType,
};

fn near(actual: f64, expected: f64, label: &str) -> Result<(), String> {
    if !actual.is_finite() || (actual - expected).abs() > 1e-9 {
        return Err(format!("{label}: expected {expected}, got {actual}"));
    }
    Ok(())
}

fn valuation_config(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
) -> Result<ConfigureManufacturingValuationParams, String> {
    let template = ctx
        .db
        .account_account()
        .id()
        .find(&fixture.chart_account_ids[chart_keys::AR])
        .ok_or("chart template missing")?;
    let mut accounts = Vec::new();
    for (code, label, internal_type, internal_group) in [
        (
            "MRPRAW",
            "Raw material stock",
            AccountTypeInternal::Asset,
            AccountInternalGroup::Asset,
        ),
        (
            "MRPOUT",
            "Manufactured stock",
            AccountTypeInternal::Asset,
            AccountInternalGroup::Asset,
        ),
        (
            "MRPWC",
            "Absorbed workcenter cost",
            AccountTypeInternal::Expense,
            AccountInternalGroup::Expense,
        ),
        (
            "MRPVAR",
            "Manufacturing variance",
            AccountTypeInternal::Expense,
            AccountInternalGroup::Expense,
        ),
    ] {
        create_account_account(
            ctx,
            fixture.organization_id,
            CreateAccountAccountParams {
                company_id: Some(fixture.company_id),
                code: code.to_string(),
                name: label.to_string(),
                user_type_id: template.user_type_id,
                currency_id: Some(fixture.currency_id),
                internal_type: Some(internal_type),
                internal_group: Some(internal_group),
                group_id: None,
                reconcile: false,
                tax_ids: vec![],
                note: None,
                opening_debit: 0.0,
                opening_credit: 0.0,
                allowed_journal_ids: vec![],
                non_trade: false,
                is_off_balance: false,
                metadata: None,
            },
        )?;
        accounts.push(
            ctx.db
                .account_account()
                .iter()
                .find(|account| {
                    account.organization_id == fixture.organization_id
                        && account.company_id == fixture.company_id
                        && account.code == code
                })
                .ok_or("manufacturing account missing")?
                .id,
        );
    }
    create_account_journal(
        ctx,
        fixture.organization_id,
        CreateAccountJournalParams {
            company_id: Some(fixture.company_id),
            name: "Manufacturing valuation".to_string(),
            code: "MRPV".to_string(),
            type_: JournalType::Manufacturing,
            currency_id: Some(fixture.currency_id),
            default_account_id: Some(accounts[1]),
            suspense_account_id: None,
            loss_account_id: None,
            profit_account_id: None,
            bank_account_id: None,
            payment_credit_account_id: None,
            payment_debit_account_id: None,
            invoice_reference_type: None,
            invoice_reference_model: None,
            sequence_id: None,
            refund_sequence_id: None,
            sequence_override_regex: None,
            secure_sequence_id: None,
            alias_name: None,
            alias_domain: None,
            sale_activity_type_id: None,
            sale_activity_user_id: None,
            sale_activity_note: None,
            sale_activity_date_deadline: None,
            restrict_mode_hash_table: false,
            active: true,
            at_least_one_inbound: false,
            at_least_one_outbound: false,
            dedicated_payment_method_ids: vec![],
            sale_activity_done: false,
            metadata: None,
        },
    )?;
    let journal = ctx
        .db
        .account_journal()
        .iter()
        .find(|journal| {
            journal.organization_id == fixture.organization_id
                && journal.company_id == fixture.company_id
                && journal.code == "MRPV"
        })
        .ok_or("manufacturing journal missing")?;
    Ok(ConfigureManufacturingValuationParams {
        journal_id: journal.id,
        material_account_id: accounts[0],
        output_account_id: accounts[1],
        workcenter_account_id: accounts[2],
        variance_account_id: accounts[3],
    })
}

fn fractional_production(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
) -> Result<MrpProduction, String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("fixture product missing")?;
    create_bom(
        ctx,
        fixture.organization_id,
        CreateBomParams {
            company_id: Some(fixture.company_id),
            type_: BomType::Manufacture,
            product_id: product.id,
            product_qty: 2.0,
            product_uom_id: product.uom_id,
            ready_to_produce: "all_available".to_string(),
            consumption: "flexible".to_string(),
            sequence: 10,
            lines: vec![BomLineInput {
                product_id: product.id,
                product_qty: 2.0,
                product_uom_id: product.uom_id,
                sequence: 1,
                manual_consumption: false,
                attachments_count: 0,
                operation_id: None,
                child_bom_id: None,
                bom_product_template_attribute_value_ids: vec![],
                possible_bom_product_template_attribute_value_ids: vec![],
                metadata: None,
            }],
            picking_type_id: None,
            location_src_id: Some(fixture.location_id),
            location_dest_id: Some(fixture.location_id),
            warehouse_id: Some(fixture.warehouse_id),
            routing_id: None,
            metadata: None,
        },
    )?;
    let bom = ctx
        .db
        .mrp_bom()
        .mrp_bom_by_product()
        .filter(&product.id)
        .find(|bom| {
            bom.organization_id == fixture.organization_id && bom.company_id == fixture.company_id
        })
        .ok_or("fractional BOM missing")?;
    let mo = create_test_production_with_bom(ctx, fixture, "COV07K-FRACTIONAL-COST", Some(bom.id))?;
    update_manufacturing_order(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo.id,
        UpdateManufacturingOrderParams {
            product_qty: Some(0.5),
            date_planned_start: None,
            date_planned_finished: None,
            date_deadline: None,
            origin: None,
            metadata: None,
        },
    )?;
    confirm_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id)?;
    start_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id)?;
    consume_mo_materials(ctx, fixture.organization_id, fixture.company_id, mo.id)?;
    ctx.db
        .mrp_production()
        .id()
        .find(&mo.id)
        .ok_or("fractional MO missing".to_string())
}

pub fn test_actual_cost_and_posted_valuation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let config = valuation_config(ctx, &fixture)?;
    configure_manufacturing_valuation(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        config.clone(),
    )?;
    let mo = fractional_production(ctx, &fixture)?;
    let raw = ctx
        .db
        .stock_move()
        .id()
        .find(&mo.move_raw_ids[0])
        .ok_or("raw cost move missing")?;
    near(raw.quantity_done, 0.5, "normalized fractional raw quantity")?;
    near(raw.price_unit, 10.0, "snapshotted quant cost")?;
    let raw_ids = mo.move_raw_ids.clone();
    consume_mo_materials(ctx, fixture.organization_id, fixture.company_id, mo.id)?;
    if ctx
        .db
        .mrp_production()
        .id()
        .find(&mo.id)
        .ok_or("MO missing")?
        .move_raw_ids
        != raw_ids
    {
        return Err("material retry changed raw identities".to_string());
    }
    let center = create_test_workcenter(ctx, &fixture, "COV07K costing center", true)?;
    configure_workcenter_cost_rate(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        center.id,
        20.0,
    )?;
    let wo = create_test_workorder(ctx, &fixture, mo.id, center.id, "COV07K costing operation")?;
    start_workorder(ctx, fixture.organization_id, fixture.company_id, wo.id)?;
    log_workcenter_productivity(
        ctx,
        fixture.organization_id,
        center.id,
        CreateWorkcenterProductivityParams {
            workorder_id: wo.id,
            loss_id: None,
            duration: 90.0,
            description: None,
            metadata: None,
        },
    )?;
    let wo = ctx
        .db
        .mrp_workorder()
        .id()
        .find(&wo.id)
        .ok_or("costed workorder missing")?;
    let time_id = *wo.time_ids.first().ok_or("costed time missing")?;
    let snapshot = ctx
        .db
        .mrp_productivity_cost()
        .productivity_id()
        .find(&time_id)
        .ok_or("cost snapshot missing")?;
    near(snapshot.value, 30.0, "actual 90 minute labor cost")?;
    if !snapshot.configured
        || snapshot.currency_id != fixture.currency_id
        || snapshot.production_id != mo.id
    {
        return Err("cost snapshot scope/configuration mismatch".to_string());
    }
    // Subsequent rate configuration must never rewrite the cost of existing time.
    configure_workcenter_cost_rate(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        center.id,
        100.0,
    )?;
    near(
        ctx.db
            .mrp_productivity_cost()
            .productivity_id()
            .find(&time_id)
            .ok_or("snapshot disappeared")?
            .hourly_rate,
        20.0,
        "immutable applied rate",
    )?;
    finish_workorder(ctx, fixture.organization_id, fixture.company_id, wo.id)?;
    produce_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id, 0.5)?;
    finish_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id)?;
    let result = ctx
        .db
        .mrp_production_cost()
        .production_id()
        .find(&mo.id)
        .ok_or("production cost missing")?;
    near(result.material_value, 5.0, "material value")?;
    near(result.workcenter_value, 30.0, "labor value")?;
    near(result.total_value, 35.0, "conserved actual cost")?;
    near(
        result.inventory_value,
        5.0,
        "standard output inventory value",
    )?;
    near(result.variance_value, 30.0, "standard actual variance")?;
    if result.raw_move_ids != raw_ids
        || result.productivity_cost_ids != vec![time_id]
        || result.currency_id != fixture.currency_id
        || result.output_move_ids.len() != 1
    {
        return Err("production cost exact owner identities mismatch".to_string());
    }
    let output = ctx
        .db
        .stock_move()
        .id()
        .find(&result.output_move_ids[0])
        .ok_or("output missing")?;
    near(output.price_unit, 70.0, "actual allocated output unit cost")?;
    let entry_id = result.account_move_id.ok_or("valuation entry ID missing")?;
    let entry = ctx
        .db
        .account_move()
        .id()
        .find(&entry_id)
        .ok_or("valuation entry missing")?;
    if entry.state != AccountMoveState::Posted
        || entry.company_id != fixture.company_id
        || entry.organization_id != fixture.organization_id
        || entry.journal_id != config.journal_id
    {
        return Err("valuation entry is not posted in exact configured scope".to_string());
    }
    let lines: Vec<_> = result
        .account_move_line_ids
        .iter()
        .filter_map(|id| ctx.db.account_move_line().id().find(id))
        .collect();
    if lines.len() != 4 || lines.iter().any(|line| line.move_id != entry_id) {
        return Err("valuation cost lost exact journal line identities".to_string());
    }
    near(
        lines.iter().map(|line| line.debit).sum(),
        35.0,
        "journal debit conservation",
    )?;
    near(
        lines.iter().map(|line| line.credit).sum(),
        35.0,
        "journal credit conservation",
    )?;
    for (account, debit, credit) in [
        (config.output_account_id, 5.0, 0.0),
        (config.material_account_id, 0.0, 5.0),
        (config.workcenter_account_id, 0.0, 30.0),
        (config.variance_account_id, 30.0, 0.0),
    ] {
        let matching: Vec<_> = lines
            .iter()
            .filter(|line| line.account_id == account)
            .collect();
        if matching.len() != 1 {
            return Err("valuation account line identity mismatch".to_string());
        }
        near(matching[0].debit, debit, "valuation line debit")?;
        near(matching[0].credit, credit, "valuation line credit")?;
    }
    if finish_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id).is_ok() {
        return Err("close retry accepted a completed MO".to_string());
    }
    let replay = ctx
        .db
        .mrp_production_cost()
        .production_id()
        .find(&mo.id)
        .ok_or("replay lost cost")?;
    if replay.account_move_id != Some(entry_id)
        || replay.account_move_line_ids != result.account_move_line_ids
        || replay.output_move_ids != result.output_move_ids
    {
        return Err("close retry changed exact valuation effect set".to_string());
    }
    // Quant is consumed then received once at standard cost: 100 - .5 + .5 = 100.
    let quant = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&fixture.product_id)
        .find(|q| {
            q.organization_id == fixture.organization_id
                && q.company_id == fixture.company_id
                && q.location_id == fixture.location_id
        })
        .ok_or("costed stock quant missing")?;
    near(quant.quantity, 100.0, "closed inventory quantity")?;
    near(quant.value, 1000.0, "closed standard inventory value")?;
    Ok(())
}

pub fn test_configuration_scope_and_closed_period(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let center = create_test_workcenter(ctx, &fixture, "COV07K configuration center", true)?;
    for rate in [f64::NAN, f64::INFINITY, -1.0] {
        if configure_workcenter_cost_rate(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            center.id,
            rate,
        )
        .is_ok()
        {
            return Err("invalid hourly rate accepted".to_string());
        }
    }
    if configure_workcenter_cost_rate(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        center.id,
        20.0,
    )
    .is_ok()
        || ctx
            .db
            .mrp_workcenter_cost_rate()
            .workcenter_id()
            .find(&center.id)
            .is_some()
    {
        return Err("invalid/cross-company rate persisted".to_string());
    }
    let config = valuation_config(ctx, &fixture)?;
    let foreign_config = valuation_config(ctx, &foreign)?;
    if configure_manufacturing_valuation(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        foreign_config,
    )
    .is_ok()
        || ctx
            .db
            .mrp_valuation_config()
            .company_id()
            .find(&fixture.company_id)
            .is_some()
    {
        return Err("cross-company journal/accounts configuration persisted".to_string());
    }
    configure_manufacturing_valuation(ctx, fixture.organization_id, fixture.company_id, config)?;
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&fixture.organization_id)
        .filter(|commit| commit.operation_id == "erp.configure_manufacturing_valuation")
        .collect();
    if commits.len() != 1 {
        return Err("valuation configuration must emit one exact durable commit".to_string());
    }
    let changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .iter()
        .filter(|change| {
            change.organization_id == fixture.organization_id
                && change.commit_sequence == commits[0].sequence
        })
        .collect();
    if changes.len() != 1
        || changes[0].table_name != "mrp_valuation_config"
        || changes[0].row_json.is_none()
    {
        return Err("valuation configuration durable row missing".to_string());
    }
    let mo = fractional_production(ctx, &fixture)?;
    produce_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id, 0.5)?;
    let periods: Vec<_> = ctx
        .db
        .account_period()
        .period_by_company()
        .filter(&fixture.company_id)
        .filter(|period| ctx.timestamp >= period.date_from && ctx.timestamp <= period.date_to)
        .collect();
    if periods.is_empty() {
        return Err("fixture open period missing".to_string());
    }
    for period in periods {
        close_account_period(ctx, fixture.organization_id, fixture.company_id, period.id)?;
    }
    let before_move_count = ctx
        .db
        .stock_move()
        .iter()
        .filter(|movement| movement.production_id == Some(mo.id))
        .count();
    if finish_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id).is_ok() {
        return Err("manufacturing valuation escaped a closed accounting period".to_string());
    }
    if ctx
        .db
        .stock_move()
        .iter()
        .filter(|movement| movement.production_id == Some(mo.id))
        .count()
        != before_move_count
        || ctx
            .db
            .mrp_production_cost()
            .production_id()
            .find(&mo.id)
            .is_some()
        || !ctx
            .db
            .mrp_production()
            .id()
            .find(&mo.id)
            .ok_or("closed-period MO missing")?
            .move_finished_ids
            .is_empty()
    {
        return Err("closed-period rejection changed finished/cost effects".to_string());
    }
    Ok(())
}
