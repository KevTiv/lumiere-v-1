use crate::helpers::{check_permission, write_audit_log};
use crate::types::IntakeState;
/// Vendor Management Module — Partner Bank Accounts and Supplier Intake
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ResPartnerBank** | Bank account details for partners/vendors |
/// | **SupplierIntakeRequest** | Supplier onboarding requests |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

// ============================================================================
// VENDOR BANK TABLES
// ============================================================================

/// Partner Bank Account — Bank details for vendors and partners
#[spacetimedb::table(
    accessor = res_partner_bank,
    public,
    index(name = "by_partner", accessor = res_partner_bank_by_partner, btree(columns = [partner_id]))
)]
pub struct ResPartnerBank {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub sanitized_acc_number: Option<String>,
    pub acc_holder_name: Option<String>,
    pub partner_id: u64,
    pub bank_id: Option<u64>,
    pub sequence: u32,
    pub currency_id: Option<u64>,
    pub company_id: Option<u64>,
    pub active: bool,
    pub journal_id: Option<u64>,
    pub allow_out_payment: bool,
    pub has_iban_warning: bool,
    pub lock_trust_fields: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Supplier Intake Request — Vendor onboarding workflow
#[spacetimedb::table(
    accessor = supplier_intake_request,
    public,
    index(name = "by_state", accessor = supplier_intake_request_by_state, btree(columns = [state]))
)]
pub struct SupplierIntakeRequest {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub state: IntakeState,
    pub company_name: String,
    pub contact_name: String,
    pub email: String,
    pub phone: Option<String>,
    pub website: Option<String>,
    pub industry: Option<String>,
    pub product_categories: Vec<String>,
    pub tax_id: Option<String>,
    pub company_registry: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub zip: Option<String>,
    pub country_code: Option<String>,
    pub bank_account_number: Option<String>,
    pub bank_name: Option<String>,
    pub payment_terms_id: Option<u64>,
    pub currency_id: Option<u64>,
    pub min_order_value: Option<f64>,
    pub lead_time_days: Option<u32>,
    pub quality_certificates: Vec<String>,
    pub documents: Vec<String>,
    pub notes: Option<String>,
    pub submitted_by: Option<Identity>,
    pub submitted_at: Option<Timestamp>,
    pub reviewed_by: Option<Identity>,
    pub reviewed_at: Option<Timestamp>,
    pub approved_by: Option<Identity>,
    pub approved_at: Option<Timestamp>,
    pub rejection_reason: Option<String>,
    pub partner_id: Option<u64>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// PARTNER BANK REDUCERS
// ============================================================================

/// Create a new bank account for a partner
#[reducer]
pub fn create_partner_bank(
    ctx: &ReducerContext,
    organization_id: u64,
    partner_id: u64,
    acc_number: String,
    acc_holder_name: Option<String>,
    bank_id: Option<u64>,
    currency_id: Option<u64>,
    company_id: Option<u64>,
    allow_out_payment: bool,
    sequence: Option<u32>,
    journal_id: Option<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "res_partner_bank", "create")?;

    let sanitized = acc_number.replace(' ', "").replace('-', "");

    let bank = ctx.db.res_partner_bank().insert(ResPartnerBank {
        id: 0,
        sanitized_acc_number: Some(sanitized),
        acc_holder_name,
        partner_id,
        bank_id,
        sequence: sequence.unwrap_or(0),
        currency_id,
        company_id,
        active: true,
        journal_id,
        allow_out_payment,
        has_iban_warning: false,
        lock_trust_fields: false,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        company_id,
        "res_partner_bank",
        bank.id,
        "create",
        None,
        None,
        vec!["id".to_string(), "partner_id".to_string()],
    );

    log::info!(
        "Bank account {} created for partner {}",
        bank.id,
        partner_id
    );
    Ok(())
}

/// Update a partner bank account
#[reducer]
pub fn update_partner_bank(
    ctx: &ReducerContext,
    organization_id: u64,
    bank_id: u64,
    acc_number: Option<String>,
    acc_holder_name: Option<String>,
    allow_out_payment: Option<bool>,
    active: Option<bool>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "res_partner_bank", "write")?;

    let bank = ctx
        .db
        .res_partner_bank()
        .id()
        .find(&bank_id)
        .ok_or("Bank account not found")?;

    let sanitized = acc_number.map(|n| n.replace(' ', "").replace('-', ""));

    ctx.db.res_partner_bank().id().update(ResPartnerBank {
        sanitized_acc_number: sanitized.or(bank.sanitized_acc_number),
        acc_holder_name: acc_holder_name.or(bank.acc_holder_name),
        allow_out_payment: allow_out_payment.unwrap_or(bank.allow_out_payment),
        active: active.unwrap_or(bank.active),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..bank
    });

    write_audit_log(
        ctx,
        organization_id,
        bank.company_id,
        "res_partner_bank",
        bank_id,
        "update",
        None,
        None,
        vec!["id".to_string()],
    );

    log::info!("Bank account {} updated", bank_id);
    Ok(())
}

/// Delete a partner bank account
#[reducer]
pub fn delete_partner_bank(
    ctx: &ReducerContext,
    organization_id: u64,
    bank_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "res_partner_bank", "delete")?;

    let bank = ctx
        .db
        .res_partner_bank()
        .id()
        .find(&bank_id)
        .ok_or("Bank account not found")?;

    ctx.db.res_partner_bank().id().delete(&bank_id);

    write_audit_log(
        ctx,
        organization_id,
        bank.company_id,
        "res_partner_bank",
        bank_id,
        "delete",
        None,
        None,
        vec!["id".to_string()],
    );

    log::info!("Bank account {} deleted", bank_id);
    Ok(())
}

// ============================================================================
// SUPPLIER INTAKE REDUCERS
// ============================================================================

/// Submit a new supplier intake request
#[reducer]
pub fn submit_supplier_intake(
    ctx: &ReducerContext,
    organization_id: u64,
    company_name: String,
    contact_name: String,
    email: String,
    phone: Option<String>,
    website: Option<String>,
    industry: Option<String>,
    product_categories: Vec<String>,
    tax_id: Option<String>,
    company_registry: Option<String>,
    street: Option<String>,
    city: Option<String>,
    zip: Option<String>,
    country_code: Option<String>,
    bank_account_number: Option<String>,
    bank_name: Option<String>,
    payment_terms_id: Option<u64>,
    currency_id: Option<u64>,
    min_order_value: Option<f64>,
    lead_time_days: Option<u32>,
    quality_certificates: Vec<String>,
    documents: Vec<String>,
    notes: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    let intake = ctx
        .db
        .supplier_intake_request()
        .insert(SupplierIntakeRequest {
            id: 0,
            state: IntakeState::Submitted,
            company_name,
            contact_name,
            email,
            phone,
            website,
            industry,
            product_categories,
            tax_id,
            company_registry,
            street,
            city,
            zip,
            country_code,
            bank_account_number,
            bank_name,
            payment_terms_id,
            currency_id,
            min_order_value,
            lead_time_days,
            quality_certificates,
            documents,
            notes,
            submitted_by: Some(ctx.sender()),
            submitted_at: Some(ctx.timestamp),
            reviewed_by: None,
            reviewed_at: None,
            approved_by: None,
            approved_at: None,
            rejection_reason: None,
            partner_id: None,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata,
        });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "supplier_intake_request",
        intake.id,
        "submit",
        None,
        None,
        vec!["id".to_string(), "company_name".to_string()],
    );

    log::info!(
        "Supplier intake {} submitted for {}",
        intake.id,
        intake.company_name
    );
    Ok(())
}

/// Review a supplier intake request
#[reducer]
pub fn review_supplier_intake(
    ctx: &ReducerContext,
    organization_id: u64,
    intake_id: u64,
    notes: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "supplier_intake_request", "review")?;

    let intake = ctx
        .db
        .supplier_intake_request()
        .id()
        .find(&intake_id)
        .ok_or("Supplier intake request not found")?;

    if !matches!(intake.state, IntakeState::Submitted | IntakeState::OnHold) {
        return Err("Can only review submitted or on-hold requests".to_string());
    }

    ctx.db
        .supplier_intake_request()
        .id()
        .update(SupplierIntakeRequest {
            state: IntakeState::UnderReview,
            reviewed_by: Some(ctx.sender()),
            reviewed_at: Some(ctx.timestamp),
            notes,
            updated_at: ctx.timestamp,
            ..intake
        });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "supplier_intake_request",
        intake_id,
        "review",
        Some("Submitted".to_string()),
        Some("UnderReview".to_string()),
        vec!["state".to_string()],
    );

    log::info!("Supplier intake {} is now under review", intake_id);
    Ok(())
}

/// Approve a supplier intake request
#[reducer]
pub fn approve_supplier_intake(
    ctx: &ReducerContext,
    organization_id: u64,
    intake_id: u64,
    partner_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "supplier_intake_request", "approve")?;

    let intake = ctx
        .db
        .supplier_intake_request()
        .id()
        .find(&intake_id)
        .ok_or("Supplier intake request not found")?;

    if !matches!(
        intake.state,
        IntakeState::UnderReview | IntakeState::Submitted
    ) {
        return Err("Can only approve under-review or submitted requests".to_string());
    }

    ctx.db
        .supplier_intake_request()
        .id()
        .update(SupplierIntakeRequest {
            state: IntakeState::Approved,
            approved_by: Some(ctx.sender()),
            approved_at: Some(ctx.timestamp),
            partner_id: Some(partner_id),
            updated_at: ctx.timestamp,
            ..intake
        });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "supplier_intake_request",
        intake_id,
        "approve",
        Some(serde_json::json!({ "state": format!("{:?}", intake.state) }).to_string()),
        Some("Approved".to_string()),
        vec!["state".to_string(), "partner_id".to_string()],
    );

    log::info!(
        "Supplier intake {} approved with partner {}",
        intake_id,
        partner_id
    );
    Ok(())
}

/// Reject a supplier intake request
#[reducer]
pub fn reject_supplier_intake(
    ctx: &ReducerContext,
    organization_id: u64,
    intake_id: u64,
    rejection_reason: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "supplier_intake_request", "approve")?;

    let intake = ctx
        .db
        .supplier_intake_request()
        .id()
        .find(&intake_id)
        .ok_or("Supplier intake request not found")?;

    if matches!(intake.state, IntakeState::Approved | IntakeState::Rejected) {
        return Err("Cannot reject already approved or rejected requests".to_string());
    }

    ctx.db
        .supplier_intake_request()
        .id()
        .update(SupplierIntakeRequest {
            state: IntakeState::Rejected,
            reviewed_by: Some(ctx.sender()),
            reviewed_at: Some(ctx.timestamp),
            rejection_reason: Some(rejection_reason),
            updated_at: ctx.timestamp,
            ..intake
        });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "supplier_intake_request",
        intake_id,
        "reject",
        Some(serde_json::json!({ "state": format!("{:?}", intake.state) }).to_string()),
        Some("Rejected".to_string()),
        vec!["state".to_string()],
    );

    log::info!("Supplier intake {} rejected", intake_id);
    Ok(())
}

/// Put a supplier intake request on hold
#[reducer]
pub fn hold_supplier_intake(
    ctx: &ReducerContext,
    organization_id: u64,
    intake_id: u64,
    notes: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "supplier_intake_request", "review")?;

    let intake = ctx
        .db
        .supplier_intake_request()
        .id()
        .find(&intake_id)
        .ok_or("Supplier intake request not found")?;

    if !matches!(
        intake.state,
        IntakeState::UnderReview | IntakeState::Submitted
    ) {
        return Err("Can only put under-review or submitted requests on hold".to_string());
    }

    ctx.db
        .supplier_intake_request()
        .id()
        .update(SupplierIntakeRequest {
            state: IntakeState::OnHold,
            notes,
            updated_at: ctx.timestamp,
            ..intake
        });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "supplier_intake_request",
        intake_id,
        "hold",
        Some(serde_json::json!({ "state": format!("{:?}", intake.state) }).to_string()),
        Some("OnHold".to_string()),
        vec!["state".to_string()],
    );

    log::info!("Supplier intake {} put on hold", intake_id);
    Ok(())
}
