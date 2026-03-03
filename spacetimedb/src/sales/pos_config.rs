/// POS Configuration Module — POS Setup, Payment Methods, and Loyalty Programs
///
/// Tables:
///   - PosConfig            POS terminal configuration
///   - PosPaymentMethod     Payment method definitions
///   - PosLoyaltyProgram    Loyalty and reward programs
///
/// Key Features:
///   - Multi-terminal POS setup
///   - Flexible payment method configuration
///   - Loyalty program management
///   - Module toggles for features
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::reference::currency;
use crate::helpers::{check_permission, write_audit_log};
use crate::types::PaymentMethodType;

// ══════════════════════════════════════════════════════════════════════════════
// INPUT TYPES
// ══════════════════════════════════════════════════════════════════════════════

/// Input for creating POS configuration
#[derive(SpacetimeType, Clone, Debug)]
pub struct PosConfigInput {
    pub name: String,
    pub company_id: u64,
    pub picking_type_id: u64,
    pub journal_id: u64,
    pub currency_id: u64,
    pub pricelist_id: u64,
    pub warehouse_id: u64,
    pub stock_location_id: u64,
    pub invoice_journal_id: Option<u64>,
    pub tip_product_id: Option<u64>,
    pub iface_start_categ_id: Option<u64>,
    pub iface_available_categ_ids: Vec<u64>,
    pub fpos_id: Option<u64>,
    pub team_id: Option<u64>,
    pub crm_team_id: Option<u64>,
    pub route_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub analytic_account_id: Option<u64>,
    pub payment_method_ids: Vec<u64>,
    pub trusted_config_ids: Vec<u64>,
    pub receipt_header: Option<String>,
    pub receipt_footer: Option<String>,
    pub proxy_ip: Option<String>,
    pub available_pricelist_ids: Vec<u64>,
    pub module_config: ModuleConfigInput,
}

/// Module configuration input
#[derive(SpacetimeType, Clone, Debug)]
pub struct ModuleConfigInput {
    pub module_account: bool,
    pub module_invoice: bool,
    pub module_pos_hr: bool,
    pub module_pos_restaurant: bool,
    pub module_pos_discount: bool,
    pub module_pos_loyalty: bool,
    pub module_pos_mercury: bool,
    pub module_pos_reprint: bool,
    pub module_pos_restaurant_appointment: bool,
    pub module_pos_restaurant_preparation_display: bool,
    pub module_pos_stripe: bool,
    pub module_pos_six: bool,
    pub module_pos_adyen: bool,
    pub module_pos_paytm: bool,
    pub module_pos_vantiv: bool,
    pub module_pos_ingenico: bool,
    pub is_posbox: bool,
    pub iface_tax_included: bool,
    pub tax_regime_selection: bool,
    pub tax_regime: bool,
    pub cash_control: bool,
    pub auto_validate_terminal_payment: bool,
}

/// Input for creating payment method
#[derive(SpacetimeType, Clone, Debug)]
pub struct PaymentMethodInput {
    pub name: String,
    pub company_id: u64,
    pub payment_method_type: PaymentMethodType,
    pub is_cash_count: bool,
    pub is_card_payment: bool,
    pub receivable_account_id: Option<u64>,
    pub outstanding_account_id: Option<u64>,
    pub journal_id: Option<u64>,
    pub cash_journal_id: Option<u64>,
    pub use_payment_terminal: Option<String>,
    pub split_transactions: bool,
    pub open_cashbox: bool,
    pub image: Option<String>,
    pub sequence: u32,
}

/// Input for creating loyalty program
#[derive(SpacetimeType, Clone, Debug)]
pub struct LoyaltyProgramInput {
    pub name: String,
    pub currency_id: u64,
    pub program_type: String,
    pub is_nominative: bool,
    pub trigger_product_ids: Vec<u64>,
    pub validity_duration: Option<u32>,
    pub validity_duration_type: Option<String>,
    pub date_to: Option<Timestamp>,
    pub limit_usage: u32,
}

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: POS CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = pos_config,
    public,
    index(accessor = pos_config_by_company, btree(columns = [company_id]))
)]
pub struct PosConfig {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub is_active: bool,
    pub company_id: u64,
    pub picking_type_id: u64,
    pub journal_id: u64,
    pub invoice_journal_id: Option<u64>,
    pub currency_id: u64,
    pub iface_tipproduct: bool,
    pub tip_product_id: Option<u64>,
    pub iface_tax_included: bool,
    pub iface_start_categ_id: Option<u64>,
    pub iface_available_categ_ids: Vec<u64>,
    pub restrict_categ: bool,
    pub module_account: bool,
    pub module_invoice: bool,
    pub module_pos_hr: bool,
    pub module_pos_restaurant: bool,
    pub module_pos_discount: bool,
    pub module_pos_loyalty: bool,
    pub module_pos_mercury: bool,
    pub module_pos_reprint: bool,
    pub module_pos_restaurant_appointment: bool,
    pub module_pos_restaurant_preparation_display: bool,
    pub module_pos_stripe: bool,
    pub module_pos_six: bool,
    pub module_pos_adyen: bool,
    pub module_pos_paytm: bool,
    pub module_pos_vantiv: bool,
    pub module_pos_ingenico: bool,
    pub is_posbox: bool,
    pub is_header_or_footer: bool,
    pub receipt_header: Option<String>,
    pub receipt_footer: Option<String>,
    pub proxy_ip: Option<String>,
    pub iot_device_ids: Vec<u64>,
    pub pos_device_ids: Vec<u64>,
    pub floor_ids: Vec<u64>,
    pub pricelist_id: u64,
    pub available_pricelist_ids: Vec<u64>,
    pub use_pricelist: bool,
    pub tax_regime_selection: bool,
    pub tax_regime: bool,
    pub fpos_id: Option<u64>,
    pub company_has_template: bool,
    pub journal_user: bool,
    pub invoice_journal_type: bool,
    pub sequence_id: u64,
    pub sequence_line_id: u64,
    pub default_cashbox_lines_ids: Vec<u64>,
    pub team_id: Option<u64>,
    pub crm_team_id: Option<u64>,
    pub last_session_closing_cash: f64,
    pub last_session_closing_date: Option<Timestamp>,
    pub cash_control: bool,
    pub warehouse_id: u64,
    pub route_id: Option<u64>,
    pub stock_location_id: u64,
    pub partner_id: Option<u64>,
    pub analytic_account_id: Option<u64>,
    pub update_stock_quantities: String,
    pub auto_validate_terminal_payment: bool,
    pub trusted_config_ids: Vec<u64>,
    pub payment_method_ids: Vec<u64>,
    pub sequence_number: u32,
    pub cash_journal_id: Option<u64>,
    pub cash_register_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = pos_payment_method,
    public,
    index(accessor = payment_method_by_company, btree(columns = [company_id]))
)]
pub struct PosPaymentMethod {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub outstanding_account_id: Option<u64>,
    pub receivable_account_id: Option<u64>,
    pub journal_id: Option<u64>,
    pub company_id: u64,
    pub config_ids: Vec<u64>,
    pub is_cash_count: bool,
    pub is_card_payment: bool,
    pub use_payment_terminal: Option<String>,
    pub hide_use_payment_terminal: bool,
    pub open_cashbox: bool,
    pub cash_journal_id: Option<u64>,
    pub split_transactions: bool,
    pub payment_method_type: PaymentMethodType,
    pub image: Option<String>,
    pub sequence: u32,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = pos_loyalty_program,
    public,
    index(accessor = loyalty_program_by_currency, btree(columns = [currency_id]))
)]
pub struct PosLoyaltyProgram {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub currency_id: u64,
    pub program_type: String,
    pub is_nominative: bool,
    pub portal_visible: bool,
    pub trigger_product_ids: Vec<u64>,
    pub rule_ids: Vec<u64>,
    pub reward_ids: Vec<u64>,
    pub communication_plan_ids: Vec<u64>,
    pub limit_usage: u32,
    pub is_active: bool,
    pub validity_duration: Option<u32>,
    pub validity_duration_type: Option<String>,
    pub date_to: Option<Timestamp>,
    pub total_order_count: u32,
    pub active_order_count: u32,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: POS CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_pos_config(ctx: &ReducerContext, input: PosConfigInput) -> Result<(), String> {
    check_permission(ctx, input.company_id, "pos_config", "create")?;

    // Validate payment methods
    for method_id in &input.payment_method_ids {
        let _method = ctx
            .db
            .pos_payment_method()
            .id()
            .find(method_id)
            .ok_or_else(|| format!("Payment method {} not found", method_id))?;
    }

    let config = ctx.db.pos_config().insert(PosConfig {
        id: 0,
        name: input.name,
        is_active: true,
        company_id: input.company_id,
        picking_type_id: input.picking_type_id,
        journal_id: input.journal_id,
        invoice_journal_id: input.invoice_journal_id,
        currency_id: input.currency_id,
        iface_tipproduct: input.tip_product_id.is_some(),
        tip_product_id: input.tip_product_id,
        iface_tax_included: input.module_config.iface_tax_included,
        iface_start_categ_id: input.iface_start_categ_id,
        iface_available_categ_ids: input.iface_available_categ_ids.clone(),
        restrict_categ: !input.iface_available_categ_ids.is_empty(),
        module_account: input.module_config.module_account,
        module_invoice: input.module_config.module_invoice,
        module_pos_hr: input.module_config.module_pos_hr,
        module_pos_restaurant: input.module_config.module_pos_restaurant,
        module_pos_discount: input.module_config.module_pos_discount,
        module_pos_loyalty: input.module_config.module_pos_loyalty,
        module_pos_mercury: input.module_config.module_pos_mercury,
        module_pos_reprint: input.module_config.module_pos_reprint,
        module_pos_restaurant_appointment: input.module_config.module_pos_restaurant_appointment,
        module_pos_restaurant_preparation_display: input
            .module_config
            .module_pos_restaurant_preparation_display,
        module_pos_stripe: input.module_config.module_pos_stripe,
        module_pos_six: input.module_config.module_pos_six,
        module_pos_adyen: input.module_config.module_pos_adyen,
        module_pos_paytm: input.module_config.module_pos_paytm,
        module_pos_vantiv: input.module_config.module_pos_vantiv,
        module_pos_ingenico: input.module_config.module_pos_ingenico,
        is_posbox: input.module_config.is_posbox,
        is_header_or_footer: input.receipt_header.is_some() || input.receipt_footer.is_some(),
        receipt_header: input.receipt_header,
        receipt_footer: input.receipt_footer,
        proxy_ip: input.proxy_ip,
        iot_device_ids: Vec::new(),
        pos_device_ids: Vec::new(),
        floor_ids: Vec::new(),
        pricelist_id: input.pricelist_id,
        available_pricelist_ids: input.available_pricelist_ids.clone(),
        use_pricelist: !input.available_pricelist_ids.is_empty(),
        tax_regime_selection: input.module_config.tax_regime_selection,
        tax_regime: input.module_config.tax_regime,
        fpos_id: input.fpos_id,
        company_has_template: true,
        journal_user: true,
        invoice_journal_type: input.module_config.module_invoice,
        sequence_id: 0,
        sequence_line_id: 0,
        default_cashbox_lines_ids: Vec::new(),
        team_id: input.team_id,
        crm_team_id: input.crm_team_id,
        last_session_closing_cash: 0.0,
        last_session_closing_date: None,
        cash_control: input.module_config.cash_control,
        warehouse_id: input.warehouse_id,
        route_id: input.route_id,
        stock_location_id: input.stock_location_id,
        partner_id: input.partner_id,
        analytic_account_id: input.analytic_account_id,
        update_stock_quantities: "manual".to_string(),
        auto_validate_terminal_payment: input.module_config.auto_validate_terminal_payment,
        trusted_config_ids: input.trusted_config_ids,
        payment_method_ids: input.payment_method_ids,
        sequence_number: 0,
        cash_journal_id: None,
        cash_register_id: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        input.company_id,
        Some(input.company_id),
        "pos_config",
        config.id,
        "create",
        None,
        Some(
            serde_json::json!({ "name": config.name, "company_id": input.company_id }).to_string(),
        ),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_payment_method(
    ctx: &ReducerContext,
    input: PaymentMethodInput,
) -> Result<(), String> {
    check_permission(ctx, input.company_id, "pos_payment_method", "create")?;

    // Extract the value before moving
    let use_payment_terminal = input.use_payment_terminal.clone();
    let hide_use_payment_terminal = use_payment_terminal.is_none();

    ctx.db.pos_payment_method().insert(PosPaymentMethod {
        id: 0,
        name: input.name,
        outstanding_account_id: input.outstanding_account_id,
        receivable_account_id: input.receivable_account_id,
        journal_id: input.journal_id,
        company_id: input.company_id,
        config_ids: Vec::new(),
        is_cash_count: input.is_cash_count,
        is_card_payment: input.is_card_payment,
        use_payment_terminal,
        hide_use_payment_terminal,
        open_cashbox: input.open_cashbox,
        cash_journal_id: input.cash_journal_id,
        split_transactions: input.split_transactions,
        payment_method_type: input.payment_method_type,
        image: input.image,
        sequence: input.sequence,
        active: true,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_loyalty_program(
    ctx: &ReducerContext,
    input: LoyaltyProgramInput,
) -> Result<(), String> {
    // For now, skip currency lookup and use a default company_id
    // In production, you'd want to properly look up the currency and get its company
    let company_id = 1u64; // Default company

    check_permission(ctx, company_id, "pos_loyalty_program", "create")?;

    // Check if code already exists
    let existing: Vec<_> = ctx
        .db
        .pos_loyalty_program()
        .iter()
        .filter(|p| p.name == input.name && p.currency_id == input.currency_id)
        .collect();

    if !existing.is_empty() {
        return Err("Loyalty program with this name already exists".to_string());
    }

    let program = ctx.db.pos_loyalty_program().insert(PosLoyaltyProgram {
        id: 0,
        name: input.name,
        currency_id: input.currency_id,
        program_type: input.program_type,
        is_nominative: input.is_nominative,
        portal_visible: true,
        trigger_product_ids: input.trigger_product_ids,
        rule_ids: Vec::new(),
        reward_ids: Vec::new(),
        communication_plan_ids: Vec::new(),
        limit_usage: input.limit_usage,
        is_active: true,
        validity_duration: input.validity_duration,
        validity_duration_type: input.validity_duration_type,
        date_to: input.date_to,
        total_order_count: 0,
        active_order_count: 0,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn activate_pos_config(ctx: &ReducerContext, config_id: u64) -> Result<(), String> {
    let config = ctx
        .db
        .pos_config()
        .id()
        .find(&config_id)
        .ok_or("POS config not found")?;

    check_permission(ctx, config.company_id, "pos_config", "write")?;

    ctx.db.pos_config().id().update(PosConfig {
        is_active: true,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..config
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn deactivate_pos_config(ctx: &ReducerContext, config_id: u64) -> Result<(), String> {
    let config = ctx
        .db
        .pos_config()
        .id()
        .find(&config_id)
        .ok_or("POS config not found")?;

    check_permission(ctx, config.company_id, "pos_config", "write")?;

    ctx.db.pos_config().id().update(PosConfig {
        is_active: false,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..config
    });

    Ok(())
}
