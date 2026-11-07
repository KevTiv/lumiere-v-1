//! Authored reducer regressions for exact purchase-order creation identity.

use super::gap_fixes_test::seed_vendor_po;
use crate::forms::{
    add_form_field, create_form_configuration, form_config, CreateFormConfigParams,
    CreateFormFieldParams, FieldType, FieldValidation, FieldWidth,
};
use crate::purchasing::order_creation_operations::{
    create_purchase_order_once, purchase_order_creation_operation, CreatePurchaseOrderOnceParams,
};
use crate::purchasing::purchase_orders::purchase_order;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use spacetimedb::{ReducerContext, Table};

fn keyed_params(key: &str, partner_id: u64, currency_id: u64) -> CreatePurchaseOrderOnceParams {
    CreatePurchaseOrderOnceParams {
        operation_key: key.to_string(),
        partner_id,
        currency_id,
        origin: Some(format!("keyed:{key}")),
        partner_ref: Some(format!("keyed:{key}")),
        notes: Some("exact creation identity".to_string()),
        date_planned: None,
        payment_term_id: None,
        fiscal_position_id: None,
        incoterm_id: None,
        incoterm_location: None,
        is_quantity_copy: None,
        metadata: Some(r#"{"custom:buyer_note":"preserve exact owner"}"#.to_string()),
    }
}

pub fn test_exact_purchase_order_creation_identity(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (organization_id, seed_order_id) = seed_vendor_po(ctx, &fixture, "CREATE-IDENTITY")?;
    let seed_order = ctx
        .db
        .purchase_order()
        .id()
        .find(&seed_order_id)
        .ok_or("seed order")?;
    // The request carries a custom buyer note, so create its authorized form
    // definition before testing creation-key ownership and conflicting replays.
    create_form_configuration(
        ctx,
        organization_id,
        CreateFormConfigParams {
            module_id: "purchasing".into(),
            form_id: "new-purchase-order".into(),
            name: "Purchase creation identity".into(),
            description: None,
            is_system_default: false,
        },
    )?;
    let configuration = ctx
        .db
        .form_config()
        .iter()
        .find(|config| {
            config.organization_id == organization_id
                && config.module_id == "purchasing"
                && config.form_id == "new-purchase-order"
        })
        .ok_or("purchase creation form configuration missing")?;
    add_form_field(
        ctx,
        organization_id,
        configuration.id,
        CreateFormFieldParams {
            field_id: "custom:buyer_note".into(),
            name: "buyer_note".into(),
            label: "Buyer note".into(),
            field_type: FieldType::Text,
            description: None,
            placeholder: None,
            default_value: None,
            options: vec![],
            validation: FieldValidation::default(),
            ai_suggestions: vec![],
            order: 1,
            is_system: false,
            is_enabled: true,
            category: None,
            show_in_list: false,
            width: FieldWidth::Full,
            section_id: None,
            visibility_json: None,
        },
    )?;
    let create =
        |params| create_purchase_order_once(ctx, organization_id, fixture.company_id, params);

    let first = keyed_params(
        "purchase_create_first",
        seed_order.partner_id,
        seed_order.currency_id,
    );
    create(first.clone())?;
    create(first.clone())?;

    let first_relation = ctx
        .db
        .purchase_order_creation_operation()
        .id()
        .find(&format!(
            "{organization_id}:{}:purchase_create_first",
            fixture.company_id
        ))
        .ok_or("first creation relation")?;
    let first_order = ctx
        .db
        .purchase_order()
        .id()
        .find(&first_relation.purchase_order_id)
        .ok_or("first exact order")?;
    if first_order.organization_id != organization_id
        || first_order.company_id != fixture.company_id
        || first_order.partner_id != seed_order.partner_id
        || first_relation.created_by != ctx.sender()
    {
        return Err("first creation relation escaped its actor or company scope".into());
    }

    let keyed_order_count = || {
        ctx.db
            .purchase_order()
            .iter()
            .filter(|order| {
                order.organization_id == organization_id
                    && order.company_id == fixture.company_id
                    && order.partner_id == seed_order.partner_id
                    && order
                        .origin
                        .as_deref()
                        .is_some_and(|origin| origin.starts_with("keyed:"))
            })
            .count()
    };
    if keyed_order_count() != 1 {
        return Err("same-key replay created more than one purchase order".into());
    }

    let mut conflicting = first.clone();
    conflicting.metadata = Some(r#"{"custom:buyer_note":"different owner"}"#.to_string());
    if create(conflicting).is_ok() || keyed_order_count() != 1 {
        return Err("conflicting creation-key reuse changed canonical orders".into());
    }

    let second = keyed_params(
        "purchase_create_second",
        seed_order.partner_id,
        seed_order.currency_id,
    );
    create(second)?;
    let second_relation = ctx
        .db
        .purchase_order_creation_operation()
        .id()
        .find(&format!(
            "{organization_id}:{}:purchase_create_second",
            fixture.company_id
        ))
        .ok_or("second creation relation")?;
    if first_relation.purchase_order_id == second_relation.purchase_order_id
        || keyed_order_count() != 2
    {
        return Err(
            "distinct same-supplier creation keys did not own distinct exact orders".into(),
        );
    }

    let invalid_company = fixture.company_id.saturating_add(u64::MAX / 2);
    if create_purchase_order_once(ctx, organization_id, invalid_company, first).is_ok() {
        return Err("creation accepted a company outside current actor scope".into());
    }
    Ok(())
}
