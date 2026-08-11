//! Persisted-data and negative-boundary proof for Purchasing Phase 1 relations.

use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{account_journal, AccountJournal};
use crate::purchasing::purchase_orders::{purchase_requisition, PurchaseRequisition};
use crate::purchasing::sourcing::{
    add_purchase_rfq_bid, create_purchase_rfq, purchase_rfq, purchase_rfq_bid, purchase_rfq_line,
    CreatePurchaseRfqBidParams, CreatePurchaseRfqLineParams, CreatePurchaseRfqParams,
};
use crate::purchasing::vendor_management::{
    approve_supplier_intake, create_partner_bank, res_partner_bank, review_supplier_intake,
    submit_supplier_intake, supplier_intake_request, CreatePartnerBankParams,
    SubmitSupplierIntakeParams,
};
use crate::test_harness::PurchasingIntegrityFixture;
use crate::types::{IntakeState, JournalType, RequisitionState};

fn intake_params() -> SubmitSupplierIntakeParams {
    SubmitSupplierIntakeParams {
        company_name: "Phase 1 Intake Vendor".to_string(),
        contact_name: "Phase 1 Contact".to_string(),
        email: "phase1-intake@example.test".to_string(),
        phone: None,
        website: None,
        industry: None,
        product_categories: vec!["test-category".to_string()],
        tax_id: None,
        company_registry: None,
        street: None,
        city: None,
        zip: None,
        country_code: None,
        bank_account_number: None,
        bank_name: None,
        payment_terms_id: None,
        currency_id: None,
        min_order_value: None,
        lead_time_days: None,
        quality_certificates: vec![],
        documents: vec![],
        notes: Some("phase-1-proof".to_string()),
        metadata: Some(r#"{"test":"purchasing-phase-1"}"#.to_string()),
    }
}

fn rfq_params(product_id: u64, uom_id: u64, currency_id: u64) -> CreatePurchaseRfqParams {
    CreatePurchaseRfqParams {
        requisition_id: None,
        currency_id,
        notes: Some("phase-1-proof".to_string()),
        lines: vec![CreatePurchaseRfqLineParams {
            product_id,
            product_uom: uom_id,
            product_uom_qty: 17.0,
            name: Some("Phase 1 RFQ line".to_string()),
            sequence: Some(17),
        }],
        metadata: Some(r#"{"test":"purchasing-phase-1"}"#.to_string()),
    }
}

pub fn test_phase1_vendor_and_rfq_relations(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = PurchasingIntegrityFixture::seed(ctx)?;
    let primary = &fixture.primary;
    let foreign = &fixture.foreign;

    // Supplier intake is an authenticated internal command. The stored row
    // must retain the authorized organization, and its lifecycle cannot be
    // advanced through a foreign organization scope or foreign vendor.
    submit_supplier_intake(ctx, primary.organization_id, intake_params())?;
    let intake = ctx
        .db
        .supplier_intake_request()
        .iter()
        .filter(|row| {
            row.organization_id == primary.organization_id
                && row.company_name == "Phase 1 Intake Vendor"
        })
        .max_by_key(|row| row.id)
        .ok_or("phase 1 supplier intake was not persisted")?;
    if intake.state != IntakeState::Submitted || intake.submitted_by != Some(ctx.sender()) {
        return Err("supplier intake did not persist authenticated submit provenance".to_string());
    }
    if review_supplier_intake(ctx, foreign.organization_id, intake.id, None).is_ok() {
        return Err("foreign organization reviewed a supplier intake".to_string());
    }
    if approve_supplier_intake(ctx, primary.organization_id, intake.id, foreign.vendor_id).is_ok() {
        return Err("foreign organization vendor was approved for supplier intake".to_string());
    }
    approve_supplier_intake(ctx, primary.organization_id, intake.id, primary.vendor_id)?;
    let approved = ctx
        .db
        .supplier_intake_request()
        .id()
        .find(&intake.id)
        .ok_or("approved supplier intake missing")?;
    if approved.organization_id != primary.organization_id
        || approved.partner_id != Some(primary.vendor_id)
        || approved.state != IntakeState::Approved
    {
        return Err(
            "supplier intake approval did not persist the scoped vendor relation".to_string(),
        );
    }

    // A non-outbound account may omit a journal, but an outbound account must
    // have a compatible bank/cash journal in the same organization and company.
    create_partner_bank(
        ctx,
        primary.organization_id,
        CreatePartnerBankParams {
            partner_id: primary.vendor_id,
            acc_number: "PH-1 100-200".to_string(),
            acc_holder_name: Some("Phase 1 Vendor".to_string()),
            bank_id: None,
            currency_id: Some(primary.currency_id),
            company_id: Some(primary.company_id),
            allow_out_payment: false,
            sequence: Some(17),
            journal_id: None,
            metadata: None,
        },
    )?;
    if create_partner_bank(
        ctx,
        primary.organization_id,
        CreatePartnerBankParams {
            partner_id: primary.vendor_id,
            acc_number: "PH-1 no-journal".to_string(),
            acc_holder_name: None,
            bank_id: None,
            currency_id: Some(primary.currency_id),
            company_id: Some(primary.company_id),
            allow_out_payment: true,
            sequence: None,
            journal_id: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("outbound partner bank was created without a payment journal".to_string());
    }
    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&primary.journal_id)
        .ok_or("phase 1 payment journal missing")?;
    ctx.db.account_journal().id().update(AccountJournal {
        type_: JournalType::Bank,
        at_least_one_outbound: true,
        ..journal
    });
    create_partner_bank(
        ctx,
        primary.organization_id,
        CreatePartnerBankParams {
            partner_id: primary.vendor_id,
            acc_number: "PH-1 outbound".to_string(),
            acc_holder_name: None,
            bank_id: None,
            currency_id: Some(primary.currency_id),
            company_id: Some(primary.company_id),
            allow_out_payment: true,
            sequence: None,
            journal_id: Some(primary.journal_id),
            metadata: None,
        },
    )?;
    let outbound_bank = ctx
        .db
        .res_partner_bank()
        .iter()
        .find(|row| row.sanitized_acc_number.as_deref() == Some("PH1outbound"))
        .ok_or("outbound partner bank was not persisted")?;
    if outbound_bank.organization_id != primary.organization_id
        || outbound_bank.company_id != Some(primary.company_id)
        || outbound_bank.partner_id != primary.vendor_id
        || outbound_bank.journal_id != Some(primary.journal_id)
        || !outbound_bank.allow_out_payment
    {
        return Err("outbound partner bank chain was not persisted in scope".to_string());
    }

    // RFQ headers validate company/currency before writes; lines and bids take
    // their organization/company from the persisted RFQ parent.
    if create_purchase_rfq(
        ctx,
        primary.organization_id,
        foreign.company_id,
        rfq_params(primary.product_id, primary.uom_id, primary.currency_id),
    )
    .is_ok()
    {
        return Err("foreign company RFQ was accepted".to_string());
    }
    if create_purchase_rfq(
        ctx,
        primary.organization_id,
        primary.company_id,
        rfq_params(foreign.product_id, foreign.uom_id, primary.currency_id),
    )
    .is_ok()
    {
        return Err("foreign product/UoM RFQ line was accepted".to_string());
    }
    create_purchase_rfq(
        ctx,
        primary.organization_id,
        primary.company_id,
        rfq_params(primary.product_id, primary.uom_id, primary.currency_id),
    )?;
    let rfq = ctx
        .db
        .purchase_rfq()
        .iter()
        .filter(|row| {
            row.organization_id == primary.organization_id
                && row.company_id == primary.company_id
                && row.notes.as_deref() == Some("phase-1-proof")
        })
        .max_by_key(|row| row.id)
        .ok_or("phase 1 RFQ was not persisted")?;
    let line = ctx
        .db
        .purchase_rfq_line()
        .id()
        .find(&rfq.line_ids[0])
        .ok_or("phase 1 RFQ line missing")?;
    if line.organization_id != rfq.organization_id || line.company_id != rfq.company_id {
        return Err("RFQ line did not inherit parent scope".to_string());
    }
    if add_purchase_rfq_bid(
        ctx,
        primary.organization_id,
        primary.company_id,
        rfq.id,
        CreatePurchaseRfqBidParams {
            partner_id: foreign.vendor_id,
            currency_id: primary.currency_id,
            price_unit: 17.0,
            notes: None,
        },
    )
    .is_ok()
    {
        return Err("foreign vendor RFQ bid was accepted".to_string());
    }
    add_purchase_rfq_bid(
        ctx,
        primary.organization_id,
        primary.company_id,
        rfq.id,
        CreatePurchaseRfqBidParams {
            partner_id: primary.vendor_id,
            currency_id: primary.currency_id,
            price_unit: 17.0,
            notes: Some("phase-1-bid".to_string()),
        },
    )?;
    let bid = ctx
        .db
        .purchase_rfq_bid()
        .iter()
        .filter(|row| row.rfq_id == rfq.id && row.notes.as_deref() == Some("phase-1-bid"))
        .max_by_key(|row| row.id)
        .ok_or("phase 1 RFQ bid was not persisted")?;
    if bid.organization_id != rfq.organization_id
        || bid.company_id != rfq.company_id
        || bid.partner_id != primary.vendor_id
        || bid.currency_id != rfq.currency_id
    {
        return Err("RFQ bid did not persist validated parent relations".to_string());
    }

    // A requisition-derived RFQ accepts only the documented approved lifecycle.
    let draft_requisition = ctx.db.purchase_requisition().insert(PurchaseRequisition {
        id: 0,
        organization_id: primary.organization_id,
        origin: Some("phase-1-draft-requisition".to_string()),
        ordering_date: None,
        date_end: None,
        schedule_date: None,
        user_id: ctx.sender(),
        company_id: primary.company_id,
        department_id: None,
        description: None,
        state: RequisitionState::Draft,
        exclusive: "multiple".to_string(),
        account_analytic_id: None,
        picking_type_id: None,
        line_ids: vec![],
        purchase_ids: vec![],
        order_count: 0,
        vendor_id: Some(primary.vendor_id),
        multiple_product: false,
        activity_ids: vec![],
        message_follower_ids: vec![],
        message_ids: vec![],
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some(r#"{"test":"purchasing-phase-1"}"#.to_string()),
    });
    let mut draft_params = rfq_params(primary.product_id, primary.uom_id, primary.currency_id);
    draft_params.requisition_id = Some(draft_requisition.id);
    if create_purchase_rfq(
        ctx,
        primary.organization_id,
        primary.company_id,
        draft_params,
    )
    .is_ok()
    {
        return Err("draft requisition was used to create an RFQ".to_string());
    }

    Ok(())
}
