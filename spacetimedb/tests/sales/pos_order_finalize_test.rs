//! `finalize_pos_order_archive` coverage (cold-tier Phase 2 write path).
//!
//! Mirrors `audit_finalize_test.rs`'s structure but exercises the general
//! version-checked protocol (archive_version + cold_eligible_at) instead of
//! audit_log's checksum-only one — see the module doc on
//! `finalize_pos_order_archive` in `spacetimedb/src/sales/pos_transactions.rs`
//! for why the two protocols differ.
use spacetimedb::{ReducerContext, Table};

use crate::core::persistence::{
    organization_commit, organization_row_change, record_organization_commit,
    OrganizationCommitInput, RowChange, CHANGE_SCHEMA_VERSION, CONTRACT_VERSION,
};
use crate::iot::actions::iot_action;
use crate::iot::registry::{iot_device, IoTDevice};
use crate::sales::pos_config::{
    create_pos_config, pos_config, CreatePosConfigParams, ModuleConfigInput,
};
use crate::sales::pos_transactions::{
    create_pos_order, finalize_pos_order_archive, finalize_pos_order_archive_checked,
    open_pos_session, pos_loyalty_card, pos_order, pos_session, CreatePosOrderLineParams,
    CreatePosOrderParams, PosLoyaltyCard, PosOrder,
};
use crate::test_harness::OrgFixture;
use crate::types::{CardState, PosOrderState};

fn insert_test_order(ctx: &ReducerContext, fixture: &OrgFixture, uid: &str) -> PosOrder {
    ctx.db.pos_order().insert(PosOrder {
        id: 0,
        organization_id: fixture.organization_id,
        uid: uid.to_string(),
        ticket_number: None,
        session_id: 0,
        config_id: 0,
        state: PosOrderState::Paid,
        user_id: ctx.sender(),
        amount_paid: 10.0,
        amount_return: 0.0,
        amount_tax: 0.0,
        amount_total: 10.0,
        amount_discount: 0.0,
        amount_delivery: 0.0,
        amount_subtotal: 10.0,
        company_id: fixture.company_id,
        pricelist_id: 0,
        partner_id: None,
        sequence_number: 1,
        loyalty_points: 0.0,
        to_invoice: false,
        is_tipped: false,
        tip_amount: 0.0,
        access_token: None,
        lines: vec![],
        statement_ids: vec![],
        pos_reference: None,
        sale_journal: 0,
        account_move: None,
        picking_id: None,
        picking_type_id: None,
        location_id: 0,
        note: None,
        nb_print: 0,
        pos_name: None,
        pos_version: None,
        pos_session_version: None,
        crm_team_id: None,
        procurement_group_id: None,
        margin: 0.0,
        margin_percent: 0.0,
        is_partially_paid: false,
        shipping_date: None,
        last_order_preparation_change: None,
        date_order: ctx.timestamp,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
        cold_eligible_at: Some(ctx.timestamp),
        archive_version: 1,
    })
}

fn record_test_order_commit(ctx: &ReducerContext, order: &PosOrder) -> Result<u64, String> {
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id: order.organization_id,
            operation_id: "erp.test_finalize_pos_order".to_string(),
            correlation_id: format!("test-pos-order:{}", order.id),
            changes: vec![RowChange::upsert_stdb_row(
                "pos_order",
                serde_json::json!({"id": order.id}),
                order,
            )?],
        },
    )
}

#[spacetimedb::reducer]
pub fn test_pos_order_finalize_deletes_on_version_match(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let order = insert_test_order(ctx, &fixture, "finalize-match");
    let expected_micros = order
        .cold_eligible_at
        .ok_or("cold_eligible_at should be set")?
        .to_micros_since_unix_epoch();
    let sequence = record_test_order_commit(ctx, &order)?;

    finalize_pos_order_archive_checked(
        ctx,
        order.id,
        order.archive_version,
        expected_micros,
        sequence,
        sequence,
        CHANGE_SCHEMA_VERSION,
        CONTRACT_VERSION,
    )?;

    if ctx.db.pos_order().id().find(order.id).is_some() {
        return Err("row should have been deleted on version match".to_string());
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn test_pos_order_finalize_refuses_on_version_mismatch(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let order = insert_test_order(ctx, &fixture, "finalize-version-mismatch");
    let expected_micros = order
        .cold_eligible_at
        .ok_or("cold_eligible_at should be set")?
        .to_micros_since_unix_epoch();

    // Wrong archive_version — simulates the row having mutated since the
    // worker read it.
    let result = finalize_pos_order_archive_checked(
        ctx,
        order.id,
        order.archive_version + 1,
        expected_micros,
        0,
        0,
        CHANGE_SCHEMA_VERSION,
        CONTRACT_VERSION,
    );
    if result.is_ok() {
        return Err("finalize should reject a stale archive_version".to_string());
    }
    if ctx.db.pos_order().id().find(order.id).is_none() {
        return Err("row should NOT have been deleted on version mismatch".to_string());
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn test_pos_order_finalize_refuses_on_cold_eligible_at_mismatch(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let order = insert_test_order(ctx, &fixture, "finalize-eligible-at-mismatch");

    // Wrong expected cold_eligible_at — simulates a rehydrate-then-re-archive
    // race where the worker's stale read no longer matches the row.
    let result = finalize_pos_order_archive_checked(
        ctx,
        order.id,
        order.archive_version,
        1,
        0,
        0,
        CHANGE_SCHEMA_VERSION,
        CONTRACT_VERSION,
    );
    if result.is_ok() {
        return Err("finalize should reject a stale cold_eligible_at".to_string());
    }
    if ctx.db.pos_order().id().find(order.id).is_none() {
        return Err("row should NOT have been deleted on cold_eligible_at mismatch".to_string());
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn test_pos_order_finalize_is_idempotent_when_already_gone(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let order = insert_test_order(ctx, &fixture, "finalize-idempotent");
    let expected_micros = order
        .cold_eligible_at
        .ok_or("cold_eligible_at should be set")?
        .to_micros_since_unix_epoch();
    let sequence = record_test_order_commit(ctx, &order)?;

    finalize_pos_order_archive_checked(
        ctx,
        order.id,
        order.archive_version,
        expected_micros,
        sequence,
        sequence,
        CHANGE_SCHEMA_VERSION,
        CONTRACT_VERSION,
    )?;
    // Second call for the same (now-deleted) id must succeed, not error.
    finalize_pos_order_archive_checked(
        ctx,
        order.id,
        order.archive_version,
        expected_micros,
        sequence,
        sequence,
        CHANGE_SCHEMA_VERSION,
        CONTRACT_VERSION,
    )?;

    Ok(())
}

#[spacetimedb::reducer]
pub fn test_pos_order_finalize_rejects_unregistered_caller(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let order = insert_test_order(ctx, &fixture, "finalize-unregistered-caller");
    let expected_micros = order
        .cold_eligible_at
        .ok_or("cold_eligible_at should be set")?
        .to_micros_since_unix_epoch();

    // The test-runner identity is never registered as the
    // pos_order_cold_drainer service identity, so the public reducer must
    // refuse the call even though version/eligibility match.
    let result = finalize_pos_order_archive(
        ctx,
        order.id,
        order.archive_version,
        expected_micros,
        1,
        1,
        CHANGE_SCHEMA_VERSION,
        CONTRACT_VERSION.to_string(),
    );
    if result.is_ok() {
        return Err(
            "finalize_pos_order_archive should reject a caller that isn't the registered drainer identity"
                .to_string(),
        );
    }
    if ctx.db.pos_order().id().find(order.id).is_none() {
        return Err(
            "row should still be present — the identity gate must run before any deletion"
                .to_string(),
        );
    }
    Ok(())
}

pub fn test_create_pos_order_records_ordered_commit(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let config_name = format!("C2 POS {}", fixture.organization_id);
    create_pos_config(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreatePosConfigParams {
            name: config_name.clone(),
            picking_type_id: 0,
            journal_id: 0,
            currency_id: 1,
            pricelist_id: 0,
            warehouse_id: fixture.warehouse_id,
            stock_location_id: fixture.location_id,
            invoice_journal_id: None,
            tip_product_id: None,
            iface_start_categ_id: None,
            iface_available_categ_ids: vec![],
            fpos_id: None,
            team_id: None,
            crm_team_id: None,
            route_id: None,
            partner_id: None,
            analytic_account_id: None,
            payment_method_ids: vec![],
            trusted_config_ids: vec![],
            receipt_header: None,
            receipt_footer: None,
            proxy_ip: None,
            available_pricelist_ids: vec![],
            module_config: ModuleConfigInput {
                module_account: false,
                module_invoice: false,
                module_pos_hr: false,
                module_pos_restaurant: false,
                module_pos_discount: false,
                module_pos_loyalty: true,
                module_pos_mercury: false,
                module_pos_reprint: false,
                module_pos_restaurant_appointment: false,
                module_pos_restaurant_preparation_display: false,
                module_pos_stripe: false,
                module_pos_six: false,
                module_pos_adyen: false,
                module_pos_paytm: false,
                module_pos_vantiv: false,
                module_pos_ingenico: false,
                is_posbox: false,
                iface_tax_included: false,
                tax_regime_selection: false,
                tax_regime: false,
                cash_control: false,
                auto_validate_terminal_payment: false,
            },
        },
    )?;
    let config = ctx
        .db
        .pos_config()
        .iter()
        .find(|config| {
            config.organization_id == fixture.organization_id && config.name == config_name
        })
        .ok_or("C2 POS config was not persisted")?;
    open_pos_session(ctx, fixture.organization_id, config.id, 0.0)?;
    let session = ctx
        .db
        .pos_session()
        .iter()
        .find(|session| {
            session.organization_id == fixture.organization_id && session.config_id == config.id
        })
        .ok_or("C2 POS session was not persisted")?;
    let loyalty_card = ctx.db.pos_loyalty_card().insert(PosLoyaltyCard {
        id: 0,
        organization_id: fixture.organization_id,
        partner_id: Some(fixture.partner_id),
        code: format!("C2-POS-LOYALTY-{}", fixture.organization_id),
        points: 10.0,
        points_display: "10 points".to_string(),
        currency_id: 1,
        balance: 0.1,
        expiration_date: None,
        state: CardState::Active,
        is_active: true,
        order_ids: vec![],
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });
    let _device = ctx.db.iot_device().insert(IoTDevice {
        id: 0,
        hub_id: 0,
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        name: "C2 POS display".to_string(),
        device_type: "CustomerDisplay".to_string(),
        identifier: format!("c2-pos-display-{}", fixture.organization_id),
        status: "Online".to_string(),
        capabilities: vec![],
        last_seen: None,
        workcenter_id: None,
        stock_location_id: None,
        pos_config_id: Some(config.id),
        quality_check_id: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });
    create_pos_order(
        ctx,
        fixture.organization_id,
        CreatePosOrderParams {
            session_id: session.id,
            partner_id: Some(fixture.partner_id),
            lines: vec![CreatePosOrderLineParams {
                product_id: fixture.product_id,
                qty: 1.0,
                uom_id: 1,
                price_unit: 10.0,
                discount: 0.0,
                tax_ids: vec![],
                tax_amount: 0.0,
                price_extra: 0.0,
                name: Some("C2 POS line".to_string()),
                full_product_name: Some("C2 POS line".to_string()),
                customer_note: None,
                attribute_value_ids: vec![],
                is_reward_line: true,
                reward_id: None,
                coupon_id: None,
                refunded_orderline_id: None,
                loyalty_points: Some(5.0),
            }],
            payments: vec![],
            to_invoice: false,
        },
    )?;
    let order = ctx
        .db
        .pos_order()
        .iter()
        .find(|order| {
            order.organization_id == fixture.organization_id && order.session_id == session.id
        })
        .ok_or("C2 POS order was not persisted")?;
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .iter()
        .filter(|commit| {
            commit.organization_id == fixture.organization_id
                && commit.operation_id == "erp.create_pos_order"
                && commit.correlation_id == format!("pos-session:{}:order:{}", session.id, order.id)
        })
        .collect();
    if commits.len() != 1 || commits[0].row_change_count != 5 {
        return Err(format!(
            "POS order commit count mismatch: {} / {:?}",
            commits.len(),
            commits.first().map(|commit| commit.row_change_count)
        ));
    }
    let commit = &commits[0];
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .iter()
        .filter(|change| {
            change.organization_id == fixture.organization_id
                && change.commit_sequence == commit.sequence
        })
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    let tables: Vec<_> = changes
        .iter()
        .map(|change| change.table_name.as_str())
        .collect();
    if tables
        != [
            "pos_session",
            "pos_order",
            "pos_order_line",
            "pos_loyalty_card",
            "iot_action",
        ]
    {
        return Err(format!("POS order commit row order mismatch: {tables:?}"));
    }
    let updated_card = ctx
        .db
        .pos_loyalty_card()
        .id()
        .find(&loyalty_card.id)
        .ok_or("C2 loyalty card was not persisted")?;
    if updated_card.points != 15.0 || changes[3].row_json.is_none() {
        return Err("POS order commit omitted the updated loyalty card full row".to_string());
    }
    let actions: Vec<_> = ctx
        .db
        .iot_action()
        .iter()
        .filter(|action| {
            action.organization_id == fixture.organization_id
                && action.device_id == _device.id
                && action.triggered_by == "create_pos_order"
        })
        .collect();
    if actions.len() != 1 || changes[4].row_json.is_none() {
        return Err("POS order commit omitted the created IoT action full row".to_string());
    }

    Ok(())
}
