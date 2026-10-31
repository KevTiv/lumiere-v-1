//! Runtime proof of the actual configurable-create owners, including failed
//! calls caught inside one test transaction: validation must precede base writes.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{
    company, create_company, organization_settings, CreateCompanyParams, OrganizationSettings,
};
use crate::core::permissions::{role, user_role_assignment, Role, UserRoleAssignment};
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::core::users::{
    find_user_profile_for_organization, user_organization, user_profile, UserOrganization,
    UserProfile,
};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::crm::leads::{create_lead, lead, CreateLeadParams};
use crate::forms::record_creation::record_creation_receipt;
use crate::forms::{
    form_config, publish_form_configuration, record_custom_field_value, set_form_role_config,
    CreateFormFieldParams, CreateRoleConfigParams, FieldType, FieldValidation, FieldWidth,
    PublishFormConfigurationParams,
};
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{create_sale_order, sale_order, CreateSaleOrderParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::DiscountPolicy;

pub(crate) fn configure_form(
    ctx: &ReducerContext,
    org: u64,
    module: &str,
    form: &str,
) -> Result<u64, String> {
    let field = |key: &str, required| CreateFormFieldParams {
        field_id: key.into(),
        name: key.into(),
        label: key.into(),
        field_type: FieldType::Text,
        description: None,
        placeholder: None,
        default_value: None,
        options: vec![],
        validation: FieldValidation {
            required,
            ..FieldValidation::default()
        },
        ai_suggestions: vec![],
        order: 0,
        is_system: true,
        is_enabled: true,
        category: None,
        show_in_list: false,
        width: FieldWidth::Full,
        section_id: None,
        visibility_json: None,
    };
    publish_form_configuration(
        ctx,
        org,
        PublishFormConfigurationParams {
            module_id: module.into(),
            form_id: form.into(),
            name: "Atomic configured create test".into(),
            description: None,
            is_system_default: true,
            fields: vec![
                field("custom:reference", true),
                field("custom:blocked", false),
            ],
            role_configs: vec![],
            expected_updated_at_micros: None,
            replace_missing_fields: false,
        },
    )?;
    ctx.db
        .form_config()
        .form_config_by_organization()
        .filter(&org)
        .find(|config| config.module_id == module && config.form_id == form)
        .map(|config| config.id)
        .ok_or("creation test form missing".into())
}

fn metadata(company: u64, key: &str, custom: serde_json::Value) -> String {
    serde_json::json!({"__lumiere_create_v1":{"company_id":company.to_string(),"operation_key":key}, "custom:reference":custom}).to_string()
}

fn contact_input(fixture: &OrgFixture, metadata: String) -> CreateContactParams {
    CreateContactParams {
        name: "Atomic custom contact".into(),
        type_: "person".into(),
        email: None,
        phone: None,
        mobile: None,
        company_id: Some(fixture.company_id),
        is_customer: true,
        is_vendor: false,
        is_employee: false,
        is_prospect: true,
        is_partner: false,
        customer_rank: 1,
        supplier_rank: 0,
        display_name: None,
        first_name: None,
        last_name: None,
        title: None,
        email_secondary: None,
        fax: None,
        website: None,
        street: None,
        street2: None,
        city: None,
        state_code: None,
        zip: None,
        country_code: None,
        tax_id: None,
        company_registry: None,
        industry: None,
        employees_count: None,
        annual_revenue: None,
        description: None,
        salesperson_id: None,
        assigned_user_id: None,
        parent_id: None,
        user_id: None,
        color: None,
        metadata: Some(metadata),
    }
}

fn exact_saved(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    model: &str,
    key: &str,
) -> Result<u64, String> {
    let id = format!(
        "{}:{}:{model}:{key}",
        fixture.organization_id, fixture.company_id
    );
    let receipt = ctx
        .db
        .record_creation_receipt()
        .id()
        .find(&id)
        .ok_or("exact creation receipt missing")?;
    if receipt.organization_id != fixture.organization_id
        || receipt.company_id != fixture.company_id
        || receipt.model != model
        || receipt.created_by != ctx.sender()
        || !receipt.payload_hash.starts_with("sha256:")
    {
        return Err("creation receipt actor/scope/hash mismatch".into());
    }
    let values: Vec<_> = ctx
        .db
        .record_custom_field_value()
        .iter()
        .filter(|row| {
            row.organization_id == fixture.organization_id
                && row.company_id == fixture.company_id
                && row.model == model
                && row.record_id == receipt.record_id
        })
        .collect();
    if values.len() != 1
        || values[0].field_key != "custom:reference"
        || values[0].value_json != r#""Accepted""#
    {
        return Err("created record did not commit its exact custom value once".into());
    }
    let operation = if model == "contact" {
        "erp.create_contact"
    } else {
        "erp.create_sale_order"
    };
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&fixture.organization_id)
        .filter(|commit| commit.operation_id == operation && commit.correlation_id == id)
        .collect();
    if commits.len() != 1 || commits[0].actor_identity != ctx.sender() {
        return Err(
            "configured create has no unique actor-scoped durable commit (or replay duplicated it)"
                .into(),
        );
    }
    let rows: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_organization()
        .filter(&fixture.organization_id)
        .filter(|row| row.commit_sequence == commits[0].sequence)
        .collect();
    for table in [
        model,
        "record_custom_field_value",
        "record_creation_receipt",
    ] {
        if rows.iter().filter(|row| row.table_name == table).count() != 1 {
            return Err(format!("configured creation commit omitted exact {table}"));
        }
    }
    for row in &rows {
        let value: serde_json::Value = serde_json::from_str(
            row.row_json
                .as_deref()
                .ok_or("creation commit lacks complete row")?,
        )
        .map_err(|error| error.to_string())?;
        if value["organization_id"].as_u64() != Some(fixture.organization_id) {
            return Err("creation commit captured another organization".into());
        }
        if row.table_name == "record_creation_receipt"
            || row.table_name == "record_custom_field_value"
        {
            if value["company_id"].as_u64() != Some(fixture.company_id) {
                return Err("creation commit captured another company's recovery values".into());
            }
        }
    }
    if rows
        .iter()
        .filter(|row| row.table_name == "audit_log")
        .count()
        != 2
    {
        return Err("creation commit omitted canonical business or custom-field audit".into());
    }
    if model == "sale_order"
        && rows
            .iter()
            .filter(|row| row.table_name == "document_sequence")
            .count()
            != 1
    {
        return Err("quotation commit omitted document sequence".into());
    }
    Ok(receipt.record_id)
}

pub fn contact_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let config_id = configure_form(ctx, org, "crm", "new-contact")?;
    let count = || ctx.db.contact().contact_by_org().filter(&org).count();
    let before = count();
    let params = contact_input(
        &fixture,
        metadata(
            fixture.company_id,
            "contact-success",
            serde_json::json!("Accepted"),
        ),
    );
    create_contact(ctx, org, params.clone())?;
    let record_id = exact_saved(ctx, &fixture, "contact", "contact-success")?;
    create_contact(ctx, org, params.clone())?;
    if count() != before + 1
        || exact_saved(ctx, &fixture, "contact", "contact-success")? != record_id
    {
        return Err("contact replay duplicated or changed identity".into());
    }
    let mut changed = params.clone();
    changed.name = "Changed request".into();
    if create_contact(ctx, org, changed).is_ok() {
        return Err("changed contact payload reused a creation key".into());
    }
    for (key, custom) in [
        ("wrong-type", serde_json::json!(123)),
        ("empty-required", serde_json::json!("")),
        ("null-required", serde_json::Value::Null),
    ] {
        let invalid = contact_input(&fixture, metadata(fixture.company_id, key, custom));
        if create_contact(ctx, org, invalid).is_ok() || count() != before + 1 {
            return Err(format!("invalid custom contact {key} left a base row"));
        }
    }
    let mut missing = contact_input(
        &fixture,
        metadata(
            fixture.company_id,
            "missing-required",
            serde_json::json!("Accepted"),
        ),
    );
    missing.metadata = Some(serde_json::json!({"__lumiere_create_v1":{"company_id":fixture.company_id.to_string(),"operation_key":"missing-required"}}).to_string());
    if create_contact(ctx, org, missing).is_ok() || count() != before + 1 {
        return Err("missing required custom field left a contact row".into());
    }
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == org && row.is_active)
        .ok_or("test member missing")?;
    set_form_role_config(
        ctx,
        org,
        config_id,
        CreateRoleConfigParams {
            role_id: membership.role_id.to_string(),
            enabled_fields: vec!["custom:reference".into()],
            required_fields: vec!["custom:reference".into()],
            default_prompts: vec![],
        },
    )?;
    let mut blocked = contact_input(
        &fixture,
        metadata(
            fixture.company_id,
            "disabled-field",
            serde_json::json!("Accepted"),
        ),
    );
    let mut fields: serde_json::Value =
        serde_json::from_str(blocked.metadata.as_deref().ok_or("missing metadata")?)
            .map_err(|error| error.to_string())?;
    fields["custom:blocked"] = serde_json::json!("Cannot write this field");
    blocked.metadata = Some(fields.to_string());
    if create_contact(ctx, org, blocked).is_ok() || count() != before + 1 {
        return Err("role-disabled custom field created a partial contact".into());
    }
    company_boundary(ctx, &fixture, params)?;
    Ok(())
}

fn company_boundary(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    mut params: CreateContactParams,
) -> Result<(), String> {
    let org = fixture.organization_id;
    create_company(
        ctx,
        org,
        CreateCompanyParams {
            name: "Configured create branch".into(),
            code: format!("CC{}", fixture.company_id),
            currency_id: fixture.currency_id,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: None,
        },
    )?;
    let branch = ctx
        .db
        .company()
        .company_by_org()
        .filter(&org)
        .find(|row| row.id != fixture.company_id)
        .ok_or("creation branch missing")?
        .id;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == org && row.is_active)
        .ok_or("creation member missing")?;
    let original_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("creation role missing")?;
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), org)
        .ok_or("creation profile missing")?;
    let was_superuser = profile.is_superuser;
    ctx.db.user_organization().id().update(UserOrganization {
        company_id: Some(fixture.company_id),
        ..membership.clone()
    });
    ctx.db.role().id().update(Role {
        permissions: vec!["contact:create".into(), "contact:read".into()],
        ..original_role.clone()
    });
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    let before = ctx.db.contact().contact_by_org().filter(&org).count();
    params.company_id = Some(branch);
    params.metadata = Some(metadata(
        branch,
        "denied-company",
        serde_json::json!("Accepted"),
    ));
    if create_contact(ctx, org, params).is_ok()
        || ctx.db.contact().contact_by_org().filter(&org).count() != before
    {
        return Err("ordinary creator wrote another company's custom contact".into());
    }
    ctx.db.user_organization().id().update(membership);
    ctx.db.role().id().update(original_role);
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), org)
        .ok_or("creation profile disappeared")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: was_superuser,
        ..profile
    });
    Ok(())
}

pub fn quotation_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    configure_form(ctx, org, "sales", "new-sale-order")?;
    create_pricelist(
        ctx,
        org,
        CreatePricelistParams {
            company_id: Some(fixture.company_id),
            name: "Atomic creation price list".into(),
            currency_id: fixture.currency_id,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|row| row.organization_id == org)
        .ok_or("creation price list missing")?
        .id;
    let params = CreateSaleOrderParams {
        company_id: Some(fixture.company_id),
        partner_id: fixture.partner_id,
        partner_invoice_id: fixture.partner_id,
        partner_shipping_id: fixture.partner_id,
        pricelist_id: pricelist,
        currency_id: fixture.currency_id,
        warehouse_id: fixture.warehouse_id,
        order_lines: vec![],
        origin: None,
        client_order_ref: Some("Atomic quotation".into()),
        payment_term_id: None,
        fiscal_position_id: None,
        team_id: None,
        opportunity_id: None,
        proposal_id: None,
        note: None,
        terms_and_conditions: None,
        validity_days: None,
        shipping_policy: None,
        picking_policy: None,
        campaign_id: None,
        medium_id: None,
        source_id: None,
        commitment_date: None,
        expected_date: None,
        incoterm_id: None,
        incoterm: None,
        incoterm_location: None,
        carrier_id: None,
        customer_lead: None,
        analytic_account_id: None,
        user_id: None,
        is_printed: None,
        is_locked: None,
        is_dropship: None,
        invoice_policy: None,
        message_follower_ids: None,
        message_partner_ids: None,
        message_channel_ids: None,
        activity_ids: None,
        metadata: Some(metadata(
            fixture.company_id,
            "quotation-success",
            serde_json::json!("Accepted"),
        )),
    };
    let count = || ctx.db.sale_order().sale_order_by_org().filter(&org).count();
    let before = count();
    create_sale_order(ctx, org, params.clone())?;
    let id = exact_saved(ctx, &fixture, "sale_order", "quotation-success")?;
    create_sale_order(ctx, org, params.clone())?;
    if count() != before + 1 || exact_saved(ctx, &fixture, "sale_order", "quotation-success")? != id
    {
        return Err("quotation replay duplicated or changed identity".into());
    }
    let mut changed = params.clone();
    changed.note = Some("Different payload".into());
    if create_sale_order(ctx, org, changed).is_ok() || count() != before + 1 {
        return Err("changed quotation request reused its key".into());
    }
    let mut invalid = params;
    invalid.metadata = Some(metadata(
        fixture.company_id,
        "quotation-invalid",
        serde_json::json!(false),
    ));
    if create_sale_order(ctx, org, invalid).is_ok() || count() != before + 1 {
        return Err("invalid custom quotation left a base order".into());
    }
    Ok(())
}

pub fn purchase_order_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    use crate::purchasing::order_creation_operations::{
        create_purchase_order_once, purchase_order_creation_operation,
        CreatePurchaseOrderOnceParams,
    };
    use crate::purchasing::purchase_orders::purchase_order;
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let mut vendor = contact_input(&fixture, "{}".into());
    vendor.is_vendor = true;
    create_contact(ctx, org, vendor)?;
    let vendor_id = ctx
        .db
        .contact()
        .contact_by_org()
        .filter(&org)
        .find(|row| row.name == "Atomic custom contact")
        .ok_or("custom PO vendor missing")?
        .id;
    configure_form(ctx, org, "purchasing", "new-purchase-order")?;
    let params = CreatePurchaseOrderOnceParams {
        operation_key: "configured-po".into(),
        partner_id: vendor_id,
        currency_id: fixture.currency_id,
        origin: None,
        partner_ref: None,
        notes: None,
        date_planned: None,
        payment_term_id: None,
        fiscal_position_id: None,
        incoterm_id: None,
        incoterm_location: None,
        is_quantity_copy: None,
        metadata: Some(r#"{"custom:reference":"Accepted"}"#.into()),
    };
    let before = ctx
        .db
        .purchase_order()
        .iter()
        .filter(|row| row.organization_id == org)
        .count();
    create_purchase_order_once(ctx, org, fixture.company_id, params.clone())?;
    let id = format!("{org}:{}:configured-po", fixture.company_id);
    let receipt = ctx
        .db
        .purchase_order_creation_operation()
        .id()
        .find(&id)
        .ok_or("configured PO receipt missing")?;
    let record_id = receipt.purchase_order_id;
    create_purchase_order_once(ctx, org, fixture.company_id, params.clone())?;
    let values: Vec<_> = ctx
        .db
        .record_custom_field_value()
        .iter()
        .filter(|row| {
            row.organization_id == org
                && row.company_id == fixture.company_id
                && row.model == "purchase_order"
                && row.record_id == record_id
        })
        .collect();
    if ctx
        .db
        .purchase_order()
        .iter()
        .filter(|row| row.organization_id == org)
        .count()
        != before + 1
        || values.len() != 1
        || values[0].value_json != r#""Accepted""#
    {
        return Err("configured PO replay lost or duplicated base/custom rows".into());
    }
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&org)
        .filter(|commit| {
            commit.operation_id == "erp.create_purchase_order_once" && commit.correlation_id == id
        })
        .collect();
    if commits.len() != 1 {
        return Err("PO creation replay duplicated durable source commit".into());
    }
    let rows: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_organization()
        .filter(&org)
        .filter(|row| row.commit_sequence == commits[0].sequence)
        .collect();
    for table in [
        "purchase_order",
        "record_custom_field_value",
        "purchase_order_creation_operation",
        "document_sequence",
    ] {
        if rows.iter().filter(|row| row.table_name == table).count() != 1 {
            return Err(format!("PO source commit missing {table}"));
        }
    }
    let mut invalid = params.clone();
    invalid.operation_key = "invalid-configured-po".into();
    invalid.metadata = Some(r#"{"custom:reference":false}"#.into());
    if create_purchase_order_once(ctx, org, fixture.company_id, invalid).is_ok()
        || ctx
            .db
            .purchase_order()
            .iter()
            .filter(|row| row.organization_id == org)
            .count()
            != before + 1
    {
        return Err("invalid configured PO created a partial base order".into());
    }
    let mut changed = params;
    changed.notes = Some("Changed request".into());
    if create_purchase_order_once(ctx, org, fixture.company_id, changed).is_ok() {
        return Err("PO creation key accepted changed payload".into());
    }
    Ok(())
}

fn lead_input(company: u64, key: &str) -> CreateLeadParams {
    CreateLeadParams {
        name: format!("Selected company lead {key}"),
        priority: "normal".into(),
        state: "new".into(),
        expected_revenue: 0.0,
        probability: 0.0,
        tag_ids: vec![],
        email: None,
        phone: None,
        mobile: None,
        company_name: None,
        contact_name: None,
        title: None,
        street: None,
        city: None,
        zip: None,
        country_code: None,
        website: None,
        industry: None,
        source_id: None,
        campaign_id: None,
        medium_id: None,
        referred_by: None,
        description: None,
        user_id: None,
        stage_id: None,
        team_id: None,
        partner_id: None,
        date_deadline: None,
        metadata: Some(metadata(company, key, serde_json::json!("Accepted"))),
    }
}

pub fn selected_company_lead_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    // Legacy callers have no selected-company protocol and retain the default.
    let mut legacy = lead_input(fixture.company_id, "legacy-default");
    legacy.metadata = None;
    create_lead(ctx, org, legacy)?;
    configure_form(ctx, org, "crm", "new-lead")?;
    create_company(
        ctx,
        org,
        CreateCompanyParams {
            name: "Selected lead branch".into(),
            code: format!("LB{}", fixture.company_id),
            currency_id: fixture.currency_id,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: None,
        },
    )?;
    let branch = ctx
        .db
        .company()
        .company_by_org()
        .filter(&org)
        .find(|row| row.id != fixture.company_id)
        .ok_or("lead branch missing")?
        .id;
    // Admit this isolated fixture to the existing CRM multi-company capability;
    // the assertions below must exercise membership policy, not the rollout guard.
    match ctx.db.organization_settings().organization_id().find(&org) {
        Some(settings) => {
            let mut flags = settings.feature_flags.clone();
            if !flags
                .iter()
                .any(|flag| flag == crate::crm::CRM_MULTI_COMPANY_FLAG)
            {
                flags.push(crate::crm::CRM_MULTI_COMPANY_FLAG.into());
            }
            ctx.db
                .organization_settings()
                .organization_id()
                .update(OrganizationSettings {
                    feature_flags: flags,
                    ..settings
                });
        }
        None => {
            ctx.db.organization_settings().insert(OrganizationSettings {
                organization_id: org,
                module_config: None,
                feature_flags: vec![crate::crm::CRM_MULTI_COMPANY_FLAG.into()],
                integration_keys: None,
                updated_at: ctx.timestamp,
                metadata: Some(r#"{"harness":"selected-company-lead"}"#.into()),
            });
        }
    }
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == org && row.is_active)
        .ok_or("lead member missing")?;
    let original_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("lead role missing")?;
    let profile =
        find_user_profile_for_organization(ctx, ctx.sender(), org).ok_or("lead profile missing")?;
    let was_superuser = profile.is_superuser;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    ctx.db.user_organization().id().update(UserOrganization {
        company_id: Some(fixture.company_id),
        ..membership.clone()
    });
    // An exact live global role grants the same explicit company switch as API.
    ctx.db.role().id().update(Role {
        permissions: vec!["*:*".into()],
        ..original_role.clone()
    });
    let selected = lead_input(branch, "admin-selected-branch");
    create_lead(ctx, org, selected.clone())?;
    create_lead(ctx, org, selected)?;
    let receipt_id = format!("{org}:{branch}:crm_lead:admin-selected-branch");
    let receipt = ctx
        .db
        .record_creation_receipt()
        .id()
        .find(&receipt_id)
        .ok_or("selected branch lead receipt missing")?;
    if receipt.company_id != branch
        || receipt.created_by != ctx.sender()
        || ctx.db.lead().id().find(&receipt.record_id).is_none()
    {
        return Err("selected branch lead was retargeted or its identity was lost".into());
    }
    let values: Vec<_> = ctx
        .db
        .record_custom_field_value()
        .iter()
        .filter(|row| {
            row.organization_id == org
                && row.model == "crm_lead"
                && row.record_id == receipt.record_id
        })
        .collect();
    if values.len() != 1
        || values[0].company_id != branch
        || values[0].value_json != r#""Accepted""#
    {
        return Err("selected branch lead custom fields were retargeted to default company".into());
    }
    let count = || ctx.db.lead().lead_by_org().filter(&org).count();
    let before_denied = count();
    // A resource wildcard grants this operation, never all-company authority.
    ctx.db.role().id().update(Role {
        permissions: vec!["lead:*".into()],
        ..original_role.clone()
    });
    if create_lead(ctx, org, lead_input(branch, "ordinary-bound-denied")).is_ok()
        || count() != before_denied
    {
        return Err("ordinary bound member created a branch lead".into());
    }
    ctx.db.user_organization().id().update(UserOrganization {
        company_id: None,
        ..membership.clone()
    });
    create_lead(
        ctx,
        org,
        lead_input(fixture.company_id, "ordinary-default-allowed"),
    )?;
    let after_default = count();
    if create_lead(ctx, org, lead_input(branch, "ordinary-unbound-denied")).is_ok()
        || count() != after_default
    {
        return Err("unbound ordinary member bypassed default company".into());
    }
    let global = ctx.db.role().insert(Role {
        id: 0,
        name: "Selected lead additive administrator".into(),
        permissions: vec!["*:*".into()],
        is_system: false,
        ..original_role.clone()
    });
    let assignment = ctx.db.user_role_assignment().insert(UserRoleAssignment {
        id: 0,
        user_identity: ctx.sender(),
        organization_id: org,
        role_id: global.id,
        assigned_by: ctx.sender(),
        assigned_at: ctx.timestamp,
        expires_at: Some(ctx.timestamp),
        is_active: true,
        metadata: None,
    });
    if create_lead(ctx, org, lead_input(branch, "expired-global-denied")).is_ok()
        || count() != after_default
    {
        return Err("expired additive role granted another company".into());
    }
    ctx.db
        .user_role_assignment()
        .id()
        .update(UserRoleAssignment {
            expires_at: None,
            ..assignment.clone()
        });
    create_lead(ctx, org, lead_input(branch, "live-additive-allowed"))?;
    let after_additive = count();
    ctx.db.role().id().update(Role {
        is_active: false,
        ..global.clone()
    });
    if create_lead(ctx, org, lead_input(branch, "inactive-global-denied")).is_ok()
        || count() != after_additive
    {
        return Err("inactive additive role granted another company".into());
    }
    let duplicate = ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        ..membership.clone()
    });
    if create_lead(
        ctx,
        org,
        lead_input(fixture.company_id, "ambiguous-member-denied"),
    )
    .is_ok()
        || count() != after_additive
    {
        return Err("ambiguous membership granted lead creation".into());
    }
    ctx.db.user_organization().id().delete(&duplicate.id);
    ctx.db.user_role_assignment().id().delete(&assignment.id);
    ctx.db.role().id().delete(&global.id);
    ctx.db.user_organization().id().update(membership);
    ctx.db.role().id().update(original_role);
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), org)
        .ok_or("lead profile disappeared")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: was_superuser,
        ..profile
    });
    Ok(())
}
