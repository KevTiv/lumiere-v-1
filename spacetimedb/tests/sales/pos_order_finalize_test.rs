//! `finalize_pos_order_archive` coverage (cold-tier Phase 2 write path).
//!
//! Mirrors `audit_finalize_test.rs`'s structure but exercises the general
//! version-checked protocol (archive_version + cold_eligible_at) instead of
//! audit_log's checksum-only one — see the module doc on
//! `finalize_pos_order_archive` in `spacetimedb/src/sales/pos_transactions.rs`
//! for why the two protocols differ.
use spacetimedb::{ReducerContext, Table};

use crate::sales::pos_transactions::{
    finalize_pos_order_archive, finalize_pos_order_archive_checked, pos_order, PosOrder,
};
use crate::test_harness::OrgFixture;
use crate::types::PosOrderState;

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

    finalize_pos_order_archive_checked(ctx, order.id, order.archive_version, expected_micros)?;

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
    let result = finalize_pos_order_archive_checked(ctx, order.id, order.archive_version, 1);
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

    finalize_pos_order_archive_checked(ctx, order.id, order.archive_version, expected_micros)?;
    // Second call for the same (now-deleted) id must succeed, not error.
    finalize_pos_order_archive_checked(ctx, order.id, order.archive_version, expected_micros)?;

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
    let result = finalize_pos_order_archive(ctx, order.id, order.archive_version, expected_micros);
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
