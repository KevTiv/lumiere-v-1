use spacetimedb::{ReducerContext, Table};

use crate::sales::pos_config::{
    create_pos_config, pos_config, CreatePosConfigParams, ModuleConfigInput,
};
use crate::sales::pos_transactions::{
    close_pos_session, open_pos_session, pos_session,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::SessionState;

fn module_config() -> ModuleConfigInput {
    ModuleConfigInput {
        module_account: false,
        module_invoice: false,
        module_pos_hr: false,
        module_pos_restaurant: false,
        module_pos_discount: false,
        module_pos_loyalty: false,
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
        cash_control: true,
        auto_validate_terminal_payment: false,
    }
}

fn create_test_config(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
) -> Result<u64, String> {
    create_pos_config(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreatePosConfigParams {
            name: name.to_string(),
            picking_type_id: 0,
            journal_id: 0,
            currency_id: fixture.currency_id,
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
            partner_id: Some(fixture.partner_id),
            analytic_account_id: None,
            payment_method_ids: vec![],
            trusted_config_ids: vec![],
            receipt_header: None,
            receipt_footer: None,
            proxy_ip: None,
            available_pricelist_ids: vec![],
            module_config: module_config(),
        },
    )?;

    ctx.db
        .pos_config()
        .iter()
        .find(|config| {
            config.organization_id == fixture.organization_id
                && config.company_id == fixture.company_id
                && config.name == name
        })
        .map(|config| config.id)
        .ok_or_else(|| "POS config missing after create".to_string())
}

pub fn test_pos_session_close_is_exact_and_replay_safe(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let config_id = create_test_config(ctx, &fixture, "COV-13 POS config")?;

    open_pos_session(ctx, fixture.organization_id, config_id, 100.0)?;
    let opened = ctx
        .db
        .pos_session()
        .iter()
        .find(|session| {
            session.organization_id == fixture.organization_id
                && session.config_id == config_id
                && session.state == SessionState::Opened
        })
        .ok_or("opened POS session missing")?;
    let session_id = opened.id;

    if close_pos_session(ctx, foreign.organization_id, session_id, 125.0).is_ok() {
        return Err("cross-organization POS session close unexpectedly succeeded".to_string());
    }
    let after_denial = ctx
        .db
        .pos_session()
        .id()
        .find(&session_id)
        .ok_or("POS session missing after cross-org denial")?;
    if after_denial.state != SessionState::Opened || after_denial.stop_at.is_some() {
        return Err("cross-org close changed the POS session".to_string());
    }

    close_pos_session(ctx, fixture.organization_id, session_id, 125.0)?;
    let closed = ctx
        .db
        .pos_session()
        .id()
        .find(&session_id)
        .ok_or("closed POS session missing")?;
    let closed_config = ctx
        .db
        .pos_config()
        .id()
        .find(&config_id)
        .ok_or("POS config missing after close")?;

    if closed.state != SessionState::Closed
        || closed.stop_at.is_none()
        || (closed.cash_register_balance_end_real - 125.0).abs() > 0.0001
        || closed.organization_id != fixture.organization_id
        || closed.config_id != config_id
        || closed_config.organization_id != fixture.organization_id
        || closed_config.company_id != fixture.company_id
        || (closed_config.last_session_closing_cash - 125.0).abs() > 0.0001
    {
        return Err("POS close did not persist the exact scoped effect".to_string());
    }

    let stop_at = closed.stop_at;
    let session_write_date = closed.write_date;
    let config_write_date = closed_config.write_date;
    let config_closing_date = closed_config.last_session_closing_date;

    match close_pos_session(ctx, fixture.organization_id, session_id, 125.0) {
        Err(error) if error.contains("Opened or Closing Control") => {}
        Err(error) => {
            return Err(format!("unexpected POS session close replay error: {error}"))
        }
        Ok(()) => return Err("POS session close replay unexpectedly succeeded".to_string()),
    }

    let replayed = ctx
        .db
        .pos_session()
        .id()
        .find(&session_id)
        .ok_or("POS session missing after replay")?;
    let replayed_config = ctx
        .db
        .pos_config()
        .id()
        .find(&config_id)
        .ok_or("POS config missing after replay")?;

    if replayed.state != SessionState::Closed
        || replayed.stop_at != stop_at
        || replayed.write_date != session_write_date
        || (replayed.cash_register_balance_end_real - 125.0).abs() > 0.0001
        || replayed_config.write_date != config_write_date
        || replayed_config.last_session_closing_date != config_closing_date
        || (replayed_config.last_session_closing_cash - 125.0).abs() > 0.0001
    {
        return Err("POS session close replay changed the canonical effect".to_string());
    }

    Ok(())
}
