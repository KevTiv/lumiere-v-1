//! Manufacturing actual-cost snapshots and optional company-currency valuation posting.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::idempotency::replayed_result;
use crate::accounting::journal_entries::{
    account_move, account_move_line, add_account_move_line, create_account_move, post_account_move,
    CreateAccountMoveParams,
};
use crate::accounting::line_params::journal_line_params;
use crate::accounting::relations::{require_active_account, require_active_journal};
use crate::core::organization::{company, require_company_in_organization};
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::product;
use crate::inventory::stock::{stock_move, stock_quant};
use crate::manufacturing::manufacturing_orders::{MrpProduction, MrpWorkorder};
use crate::manufacturing::work_centers::{mrp_workcenter, mrp_workcenter_productivity};
use crate::types::{AccountInternalGroup, AccountMoveState, JournalType, MoveType};

#[path = "costing_math.rs"]
mod math;
pub(crate) use math::{allocate_output_cost, validate_cost};

/// Explicit hourly rate; absence is recorded as unconfigured rather than inferred from metadata.
#[derive(Clone)]
#[spacetimedb::table(accessor = mrp_workcenter_cost_rate, public,
    index(accessor = mrp_cost_rate_by_org, btree(columns = [organization_id])))]
pub struct MrpWorkcenterCostRate {
    #[primary_key]
    pub workcenter_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub currency_id: u64,
    pub hourly_rate: f64,
    pub updated_by: Identity,
    pub updated_at: Timestamp,
}

/// Immutable rate and amount used for one authoritative productivity record.
#[derive(Clone)]
#[spacetimedb::table(accessor = mrp_productivity_cost, public,
    index(accessor = mrp_productivity_cost_by_org, btree(columns = [organization_id])),
    index(accessor = mrp_productivity_cost_by_production, btree(columns = [production_id])))]
pub struct MrpProductivityCost {
    #[primary_key]
    pub productivity_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub production_id: u64,
    pub workorder_id: u64,
    pub workcenter_id: u64,
    pub currency_id: u64,
    pub duration_minutes: f64,
    pub hourly_rate: f64,
    pub configured: bool,
    pub value: f64,
    pub created_at: Timestamp,
}

/// Opt-in posting accounts: material inventory and absorbed workcenter cost fund output inventory.
#[derive(Clone)]
#[spacetimedb::table(accessor = mrp_valuation_config, public,
    index(accessor = mrp_valuation_config_by_org, btree(columns = [organization_id])))]
pub struct MrpValuationConfig {
    #[primary_key]
    pub company_id: u64,
    pub organization_id: u64,
    pub currency_id: u64,
    pub journal_id: u64,
    pub material_account_id: u64,
    pub output_account_id: u64,
    pub workcenter_account_id: u64,
    pub variance_account_id: u64,
    pub updated_at: Timestamp,
    pub updated_by: Identity,
}

/// One close owns one immutable cost result and, when configured, one posted journal entry.
#[derive(Clone)]
#[spacetimedb::table(accessor = mrp_production_cost, public,
    index(accessor = mrp_production_cost_by_org, btree(columns = [organization_id])))]
pub struct MrpProductionCost {
    #[primary_key]
    pub production_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub currency_id: u64,
    pub material_value: f64,
    pub workcenter_value: f64,
    pub total_value: f64,
    pub inventory_value: f64,
    pub variance_value: f64,
    pub raw_move_ids: Vec<u64>,
    pub output_move_ids: Vec<u64>,
    pub productivity_cost_ids: Vec<u64>,
    pub account_move_id: Option<u64>,
    pub account_move_line_ids: Vec<u64>,
    pub created_at: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ConfigureManufacturingValuationParams {
    pub journal_id: u64,
    pub material_account_id: u64,
    pub output_account_id: u64,
    pub workcenter_account_id: u64,
    pub variance_account_id: u64,
}

fn company_currency(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Result<u64, String> {
    require_company_in_organization(ctx, organization_id, company_id)?;
    Ok(ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("company not found")?
        .currency_id)
}

#[reducer]
pub fn configure_workcenter_cost_rate(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    workcenter_id: u64,
    hourly_rate: f64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_workcenter", "write")?;
    validate_cost(hourly_rate, "hourly rate")?;
    let currency_id = company_currency(ctx, organization_id, company_id)?;
    let wc = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter_id)
        .ok_or("workcenter not found")?;
    if wc.organization_id != organization_id || wc.company_id != company_id || !wc.active {
        return Err("workcenter must be active in the configured company".to_string());
    }
    let row = MrpWorkcenterCostRate {
        workcenter_id,
        organization_id,
        company_id,
        currency_id,
        hourly_rate,
        updated_by: ctx.sender(),
        updated_at: ctx.timestamp,
    };
    if ctx
        .db
        .mrp_workcenter_cost_rate()
        .workcenter_id()
        .find(&workcenter_id)
        .is_some()
    {
        ctx.db
            .mrp_workcenter_cost_rate()
            .workcenter_id()
            .update(row);
    } else {
        ctx.db.mrp_workcenter_cost_rate().insert(row);
    }
    audit_configuration(
        ctx,
        organization_id,
        company_id,
        "mrp_workcenter_cost_rate",
        workcenter_id,
    );
    let stored = ctx
        .db
        .mrp_workcenter_cost_rate()
        .workcenter_id()
        .find(&workcenter_id)
        .ok_or("configured rate disappeared")?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.configure_workcenter_cost_rate".to_string(),
            correlation_id: format!("workcenter:{workcenter_id}:cost-rate"),
            changes: vec![RowChange::upsert_stdb_row(
                "mrp_workcenter_cost_rate",
                serde_json::json!({"workcenter_id":workcenter_id}),
                &stored,
            )?],
        },
    )?;
    Ok(())
}

#[reducer]
pub fn configure_manufacturing_valuation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: ConfigureManufacturingValuationParams,
) -> Result<(), String> {
    // Accounting configuration requires accounting authority, in addition to company membership.
    check_permission(ctx, organization_id, "account_journal", "write")?;
    let row = MrpValuationConfig {
        company_id,
        organization_id,
        currency_id: company_currency(ctx, organization_id, company_id)?,
        journal_id: params.journal_id,
        material_account_id: params.material_account_id,
        output_account_id: params.output_account_id,
        workcenter_account_id: params.workcenter_account_id,
        variance_account_id: params.variance_account_id,
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
    };
    validate_valuation_configuration(ctx, &row)?;
    if ctx
        .db
        .mrp_valuation_config()
        .company_id()
        .find(&company_id)
        .is_some()
    {
        ctx.db.mrp_valuation_config().company_id().update(row);
    } else {
        ctx.db.mrp_valuation_config().insert(row);
    }
    audit_configuration(
        ctx,
        organization_id,
        company_id,
        "mrp_valuation_config",
        company_id,
    );
    let stored = ctx
        .db
        .mrp_valuation_config()
        .company_id()
        .find(&company_id)
        .ok_or("valuation configuration disappeared")?;
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.configure_manufacturing_valuation".to_string(),
            correlation_id: format!("company:{company_id}:manufacturing-valuation"),
            changes: vec![RowChange::upsert_stdb_row(
                "mrp_valuation_config",
                serde_json::json!({"company_id":company_id}),
                &stored,
            )?],
        },
    )?;
    Ok(())
}

fn audit_configuration(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    table: &'static str,
    id: u64,
) {
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: table,
            record_id: id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["configuration".to_string()],
            metadata: None,
        },
    );
}

fn validate_valuation_configuration(
    ctx: &ReducerContext,
    row: &MrpValuationConfig,
) -> Result<(), String> {
    if company_currency(ctx, row.organization_id, row.company_id)? != row.currency_id {
        return Err("manufacturing valuation currency no longer matches company".to_string());
    }
    let journal = require_active_journal(
        ctx,
        row.organization_id,
        row.company_id,
        row.journal_id,
        "manufacturing valuation",
    )?;
    if journal.currency_id.is_some_and(|id| id != row.currency_id) {
        return Err("manufacturing valuation journal must use company currency".to_string());
    }
    if !matches!(
        journal.type_,
        JournalType::General | JournalType::Inventory | JournalType::Manufacturing
    ) {
        return Err(
            "manufacturing valuation requires a general, inventory, or manufacturing journal"
                .to_string(),
        );
    }
    for id in [
        row.material_account_id,
        row.output_account_id,
        row.workcenter_account_id,
        row.variance_account_id,
    ] {
        let account = require_active_account(
            ctx,
            row.organization_id,
            row.company_id,
            id,
            "manufacturing valuation",
        )?;
        if account.currency_id.is_some_and(|id| id != row.currency_id) {
            return Err("manufacturing valuation accounts must use company currency".to_string());
        }
        let inventory = id == row.material_account_id || id == row.output_account_id;
        let expected = if inventory {
            AccountInternalGroup::Asset
        } else {
            AccountInternalGroup::Expense
        };
        if account.internal_group != Some(expected) || account.is_off_balance {
            return Err("manufacturing valuation requires asset inventory and expense cost/variance accounts".to_string());
        }
    }
    Ok(())
}

/// Called by the productivity owner immediately after inserting its authoritative time record.
pub(crate) fn snapshot_productivity_cost(
    ctx: &ReducerContext,
    productivity_id: u64,
    production_id: u64,
) -> Result<(), String> {
    let time = ctx
        .db
        .mrp_workcenter_productivity()
        .id()
        .find(&productivity_id)
        .ok_or("productivity record not found")?;
    let currency_id = company_currency(ctx, time.organization_id, time.company_id)?;
    let rate = ctx
        .db
        .mrp_workcenter_cost_rate()
        .workcenter_id()
        .find(&time.workcenter_id);
    if rate.as_ref().is_some_and(|rate| {
        rate.organization_id != time.organization_id
            || rate.company_id != time.company_id
            || rate.currency_id != currency_id
    }) {
        return Err("workcenter rate does not match productivity scope/currency".to_string());
    }
    let hourly_rate = rate.as_ref().map_or(0.0, |rate| rate.hourly_rate);
    let value = math::operation_cost(time.duration, hourly_rate)?;
    ctx.db.mrp_productivity_cost().insert(MrpProductivityCost {
        productivity_id,
        organization_id: time.organization_id,
        company_id: time.company_id,
        production_id,
        workorder_id: time.workorder_id,
        workcenter_id: time.workcenter_id,
        currency_id,
        duration_minutes: time.duration,
        hourly_rate,
        configured: rate.is_some(),
        value,
        created_at: ctx.timestamp,
    });
    Ok(())
}

pub(crate) struct ProductionCostInputs {
    pub currency_id: u64,
    pub material_value: f64,
    pub workcenter_value: f64,
    pub total_value: f64,
    pub productivity_ids: Vec<u64>,
}

/// Resolve consumed cost from immutable move snapshots; never from subsequently edited prices.
pub(crate) fn production_cost_inputs(
    ctx: &ReducerContext,
    mo: &MrpProduction,
    workorders: &[MrpWorkorder],
) -> Result<ProductionCostInputs, String> {
    if ctx
        .db
        .mrp_production_cost()
        .production_id()
        .find(&mo.id)
        .is_some()
    {
        return Err("manufacturing order already owns a cost result".to_string());
    }
    let currency_id = company_currency(ctx, mo.organization_id, mo.company_id)?;
    let mut raw_ids = mo.move_raw_ids.clone();
    raw_ids.sort_unstable();
    if raw_ids.windows(2).any(|ids| ids[0] == ids[1]) {
        return Err("manufacturing raw move identities contain duplicates".to_string());
    }
    let mut authoritative_raw_ids: Vec<_> = ctx
        .db
        .stock_move()
        .iter()
        .filter(|movement| movement.raw_material_production_id == Some(mo.id))
        .map(|movement| movement.id)
        .collect();
    authoritative_raw_ids.sort_unstable();
    if authoritative_raw_ids != raw_ids {
        return Err("manufacturing raw move ownership is inconsistent".to_string());
    }
    let mut material_value = 0.0;
    for id in &raw_ids {
        let movement = ctx
            .db
            .stock_move()
            .id()
            .find(id)
            .ok_or("raw move not found for costing")?;
        let metadata: serde_json::Value = serde_json::from_str(
            movement
                .metadata
                .as_deref()
                .ok_or("raw move has no cost snapshot")?,
        )
        .map_err(|_| "raw move cost snapshot is malformed")?;
        let snapshot = &metadata["manufacturing_material_cost"];
        if snapshot["currency_id"].as_u64() != Some(currency_id)
            || snapshot["product_id"].as_u64() != Some(movement.product_id)
            || snapshot["stock_uom_id"].as_u64() != Some(movement.product_uom)
            || snapshot["production_id"].as_u64() != Some(mo.id)
            || snapshot["source_location_id"].as_u64() != Some(movement.location_id)
            || snapshot["source_quant_id"].as_u64().is_none()
            || snapshot["consumed_quantity"].as_f64() != Some(movement.quantity_done)
            || snapshot["unit_cost"].as_f64() != Some(movement.price_unit)
        {
            return Err(
                "raw move cost snapshot does not match authoritative move/currency".to_string(),
            );
        }
        let value = snapshot["value"]
            .as_f64()
            .ok_or("raw material cost value missing")?;
        validate_cost(value, "material cost")?;
        validate_cost(movement.price_unit, "material move unit cost")?;
        if (value - movement.quantity_done * movement.price_unit).abs() > 1e-9 * value.max(1.0) {
            return Err("raw material cost value does not match consumed quantity".to_string());
        }
        material_value += value;
    }
    validate_cost(material_value, "total material cost")?;
    let valuation_config = ctx
        .db
        .mrp_valuation_config()
        .company_id()
        .find(&mo.company_id);
    if let Some(config) = &valuation_config {
        if config.organization_id != mo.organization_id {
            return Err("manufacturing valuation configuration scope mismatch".to_string());
        }
        validate_valuation_configuration(ctx, config)?;
        // Preflight posting authority/period before any finished stock effects are applied.
        check_permission(ctx, mo.organization_id, "account_move", "create")?;
        check_permission(ctx, mo.organization_id, "account_move", "write")?;
        check_permission(ctx, mo.organization_id, "account_move_line", "create")?;
        ensure_accounting_period_open_for_date(ctx, mo.company_id, ctx.timestamp)?;
    }
    let configured_valuation = valuation_config.is_some();
    let mut productivity_ids = Vec::new();
    let mut workcenter_value = 0.0;
    for wo in workorders {
        let mut authoritative_times: Vec<_> = ctx
            .db
            .mrp_workcenter_productivity()
            .mrp_productivity_by_workorder()
            .filter(&wo.id)
            .collect();
        authoritative_times.sort_by_key(|time| time.id);
        let mut owned = wo.time_ids.clone();
        owned.sort_unstable();
        if authoritative_times
            .iter()
            .map(|time| time.id)
            .collect::<Vec<_>>()
            != owned
        {
            return Err("workorder productivity identities are inconsistent".to_string());
        }
        for time in authoritative_times {
            let snapshot = ctx
                .db
                .mrp_productivity_cost()
                .productivity_id()
                .find(&time.id)
                .ok_or("productivity has no cost snapshot")?;
            if snapshot.organization_id != mo.organization_id
                || snapshot.company_id != mo.company_id
                || snapshot.production_id != mo.id
                || snapshot.workorder_id != wo.id
                || snapshot.workcenter_id != wo.workcenter_id
                || snapshot.currency_id != currency_id
                || snapshot.duration_minutes != time.duration
                || (configured_valuation && !snapshot.configured)
            {
                return Err(
                    "productivity cost snapshot does not match scope/time or lacks configured rate"
                        .to_string(),
                );
            }
            validate_cost(snapshot.value, "workcenter cost snapshot")?;
            let expected_value =
                math::operation_cost(snapshot.duration_minutes, snapshot.hourly_rate)?;
            if (snapshot.value - expected_value).abs() > 1e-9 * expected_value.max(1.0) {
                return Err(
                    "workcenter cost snapshot does not match its applied rate and duration"
                        .to_string(),
                );
            }
            workcenter_value += snapshot.value;
            productivity_ids.push(time.id);
        }
    }
    validate_cost(workcenter_value, "total workcenter cost")?;
    let total_value = material_value + workcenter_value;
    validate_cost(total_value, "total production cost")?;
    Ok(ProductionCostInputs {
        currency_id,
        material_value,
        workcenter_value,
        total_value,
        productivity_ids,
    })
}

/// Snapshot the quant valuation actually removed by the bounded single-quant consumption path.
pub(crate) fn material_cost_snapshot(
    ctx: &ReducerContext,
    mo: &MrpProduction,
    product_id: u64,
    location_id: u64,
    quantity: f64,
) -> Result<(f64, String), String> {
    let currency_id = company_currency(ctx, mo.organization_id, mo.company_id)?;
    let component = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("material product not found for cost snapshot")?;
    if component.organization_id != mo.organization_id || component.currency_id != currency_id {
        return Err("material product cost currency/scope must match company".to_string());
    }
    let quants: Vec<_> = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .filter(|q| {
            q.organization_id == mo.organization_id
                && q.company_id == mo.company_id
                && q.location_id == location_id
                && q.lot_id.is_none()
                && q.package_id.is_none()
                && q.owner_id.is_none()
        })
        .collect();
    if quants.len() != 1 {
        return Err("material costing requires one exact source quant identity".to_string());
    }
    let source = &quants[0];
    if source.quantity < quantity
        || source.available_quantity < quantity
        || !source.quantity.is_finite()
        || !source.available_quantity.is_finite()
        || !quantity.is_finite()
        || quantity <= 0.0
    {
        return Err("material consumption exceeds finite source stock".to_string());
    }
    if source.currency_id.is_some_and(|id| id != currency_id) {
        return Err("material quant must use company currency".to_string());
    }
    validate_cost(source.cost, "material quant unit cost")?;
    validate_cost(source.value, "material quant value")?;
    if (source.value - source.quantity * source.cost).abs() > 1e-9 * source.value.max(1.0) {
        return Err("material quant value does not match cost and quantity".to_string());
    }
    let value = source.cost * quantity;
    validate_cost(value, "material consumption value")?;
    Ok((
        source.cost,
        serde_json::json!({"manufacturing_material_cost": {
            "source_quant_id": source.id, "currency_id": currency_id,
            "product_id": product_id, "stock_uom_id": component.uom_id,
            "production_id": mo.id, "source_location_id": location_id,
            "unit_cost": source.cost, "consumed_quantity": quantity, "value": value,
        }})
        .to_string(),
    ))
}

/// Persist close result and optionally post through normal accounting owners and lock checks.
pub(crate) fn record_production_cost(
    ctx: &ReducerContext,
    mo: &MrpProduction,
    input: ProductionCostInputs,
    output_move_ids: &[u64],
) -> Result<(), String> {
    let mut inventory_value = 0.0;
    for id in output_move_ids {
        let movement = ctx
            .db
            .stock_move()
            .id()
            .find(id)
            .ok_or("output move missing for valuation")?;
        let metadata: serde_json::Value = serde_json::from_str(
            movement
                .metadata
                .as_deref()
                .ok_or("output cost snapshot missing")?,
        )
        .map_err(|_| "output cost snapshot malformed")?;
        let value = metadata["manufacturing_output_cost"]["inventory_value"]
            .as_f64()
            .ok_or("output inventory value missing")?;
        validate_cost(value, "output inventory value")?;
        inventory_value += value;
    }
    validate_cost(inventory_value, "total output inventory value")?;
    let variance_value = input.total_value - inventory_value;
    if !variance_value.is_finite() {
        return Err("manufacturing variance must be finite".to_string());
    }
    let mut account_move_id = None;
    let mut account_move_line_ids = Vec::new();
    if let Some(config) = ctx
        .db
        .mrp_valuation_config()
        .company_id()
        .find(&mo.company_id)
    {
        if config.organization_id != mo.organization_id {
            return Err("valuation configuration scope mismatch".to_string());
        }
        validate_valuation_configuration(ctx, &config)?;
        if inventory_value > 0.0 || input.total_value > 0.0 {
            let reference = format!("MO/{}/VALUATION", mo.id);
            let params = CreateAccountMoveParams {
                idempotency_key: format!("manufacturing-valuation:{}", mo.id),
                company_id: Some(mo.company_id),
                journal_id: config.journal_id,
                move_type: MoveType::Entry,
                date: ctx.timestamp,
                name: String::new(),
                ref_: Some(reference.clone()),
                auto_post: false,
                to_check: false,
                is_storno: false,
                partner_id: None,
                partner_bank_id: None,
                fiscal_position_id: None,
                invoice_date: None,
                invoice_date_due: None,
                invoice_payment_term_id: None,
                payment_reference: None,
                invoice_origin: None,
                invoice_partner_display_name: None,
                invoice_cash_rounding_id: None,
                partner_shipping_id: None,
                sale_order_id: None,
                invoice_incoterm_id: None,
                incoterm_location: None,
                campaign_id: None,
                source_id: None,
                medium_id: None,
                secure_sequence_number: None,
                metadata: Some(
                    serde_json::json!({"manufacturing_production_id":mo.id}).to_string(),
                ),
            };
            let payload_fingerprint = format!("{params:?}");
            let key = params.idempotency_key.clone();
            create_account_move(ctx, mo.organization_id, params)?;
            let entry_id = replayed_result(
                ctx,
                mo.organization_id,
                mo.company_id,
                "create_account_move",
                &key,
                &payload_fingerprint,
            )?
            .ok_or("manufacturing valuation owner did not return an exact receipt")?;
            let created: Vec<_> = ctx
                .db
                .account_move()
                .iter()
                .filter(|row| {
                    row.ref_.as_deref() == Some(reference.as_str())
                        && row.organization_id == mo.organization_id
                        && row.company_id == mo.company_id
                })
                .collect();
            if created.len() != 1 || created[0].id != entry_id {
                return Err("manufacturing valuation journal identity is ambiguous".to_string());
            }
            for (seq, (account, debit, credit, label)) in [
                (
                    config.output_account_id,
                    inventory_value,
                    0.0,
                    "manufactured inventory",
                ),
                (
                    config.material_account_id,
                    0.0,
                    input.material_value,
                    "consumed materials",
                ),
                (
                    config.workcenter_account_id,
                    0.0,
                    input.workcenter_value,
                    "absorbed workcenter cost",
                ),
                (
                    config.variance_account_id,
                    variance_value.max(0.0),
                    (-variance_value).max(0.0),
                    "manufacturing variance",
                ),
            ]
            .into_iter()
            .enumerate()
            {
                if debit > 0.0 || credit > 0.0 {
                    add_account_move_line(
                        ctx,
                        mo.organization_id,
                        entry_id,
                        journal_line_params(
                            account,
                            format!("MO {} {label}", mo.id),
                            debit,
                            credit,
                            seq as u32 + 1,
                        ),
                    )?;
                }
            }
            post_account_move(ctx, mo.organization_id, entry_id)?;
            let posted = ctx
                .db
                .account_move()
                .id()
                .find(&entry_id)
                .ok_or("valuation entry disappeared")?;
            if posted.state != AccountMoveState::Posted {
                return Err("manufacturing valuation entry did not post".to_string());
            }
            account_move_line_ids = ctx
                .db
                .account_move_line()
                .iter()
                .filter(|line| line.move_id == entry_id)
                .map(|line| line.id)
                .collect();
            account_move_line_ids.sort_unstable();
            account_move_id = Some(entry_id);
        }
    }
    ctx.db.mrp_production_cost().insert(MrpProductionCost {
        production_id: mo.id,
        organization_id: mo.organization_id,
        company_id: mo.company_id,
        currency_id: input.currency_id,
        material_value: input.material_value,
        workcenter_value: input.workcenter_value,
        total_value: input.total_value,
        inventory_value,
        variance_value,
        raw_move_ids: mo.move_raw_ids.clone(),
        output_move_ids: output_move_ids.to_vec(),
        productivity_cost_ids: input.productivity_ids,
        account_move_id,
        account_move_line_ids,
        created_at: ctx.timestamp,
    });
    Ok(())
}
