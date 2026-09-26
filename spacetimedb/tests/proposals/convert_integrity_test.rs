//! R5: proposal → SO convert derives UoM from product; missing product fail-closed.
use spacetimedb::{Identity, ReducerContext, Table};

use crate::core::organization::company;
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::core::reference::{create_uom, uom, CreateUomParams};
use crate::inventory::product::{product, Product};
use crate::proposals::proposals::{
    add_proposal_comment, add_proposal_line_item, approve_proposal, convert_proposal_to_sale_order,
    create_proposal, delete_proposal_section, proposal, proposal_comment, proposal_line_item,
    proposal_section, record_proposal_bid_decision, update_proposal_status,
    upsert_proposal_section, AddProposalLineItemParams, ConvertProposalToSaleOrderParams,
    CreateProposalParams, Proposal, ProposalLineItem, ProposalStatus,
    RecordProposalBidDecisionParams, UpsertProposalSectionParams,
};
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{sale_order, sale_order_line};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::DiscountPolicy;

fn company_currency_id(ctx: &ReducerContext, company_id: u64) -> Result<u64, String> {
    ctx.db
        .company()
        .id()
        .find(&company_id)
        .map(|company| company.currency_id)
        .ok_or_else(|| format!("Company {company_id} not found"))
}

fn create_awarded_proposal(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    title: &str,
) -> Result<u64, String> {
    create_proposal(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateProposalParams {
            title: title.to_string(),
            client_name: "Acme R5".to_string(),
            currency_id: company_currency_id(ctx, fixture.company_id)?,
            value: 1_000.0,
            deadline: None,
            description: None,
            template_id: None,
            partner_id: Some(fixture.partner_id),
            document_folder_id: None,
            metadata: Some(r#"{"test":"r5_convert"}"#.to_string()),
        },
    )?;
    let id = ctx
        .db
        .proposal()
        .iter()
        .find(|p| {
            p.organization_id == fixture.organization_id
                && p.company_id == fixture.company_id
                && p.title == title
        })
        .map(|p| p.id)
        .ok_or_else(|| format!("proposal {title} missing"))?;

    let row = ctx.db.proposal().id().find(&id).ok_or("proposal row")?;
    ctx.db.proposal().id().update(Proposal {
        status: ProposalStatus::Awarded,
        award_approved_at: Some(ctx.timestamp),
        award_approved_by: Some(ctx.sender()),
        ..row
    });
    Ok(id)
}

fn seed_pricelist(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_pricelist(
        ctx,
        fixture.organization_id,
        CreatePricelistParams {
            company_id: None,
            name: name.to_string(),
            currency_id: company_currency_id(ctx, fixture.company_id)?,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    ctx.db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == fixture.organization_id && p.name == name)
        .map(|p| p.id)
        .ok_or_else(|| format!("pricelist {name} missing"))
}

/// R5: missing product on proposal line → Err; no SO with magic uom `1`.
pub fn test_convert_proposal_missing_product_fail_closed(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let ghost_product_id = 9_000_055u64;

    let proposal_id = create_awarded_proposal(ctx, &fixture, "R5 Missing Product")?;
    let pricelist_id = seed_pricelist(ctx, &fixture, "R5 Missing Product PL")?;

    ctx.db.proposal_line_item().insert(ProposalLineItem {
        id: 0,
        organization_id: org_id,
        proposal_id,
        section_id: None,
        product_id: ghost_product_id,
        product_name: format!("Ghost {ghost_product_id}"),
        product_variant_id: None,
        description: None,
        quantity: 1.0,
        price_unit: 10.0,
        subtotal: 10.0,
        discount: 0.0,
        sequence: 10,
        notes: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    let so_before = ctx
        .db
        .sale_order()
        .iter()
        .filter(|o| o.organization_id == org_id && o.proposal_id == Some(proposal_id))
        .count();

    let err = convert_proposal_to_sale_order(
        ctx,
        org_id,
        company_id,
        proposal_id,
        ConvertProposalToSaleOrderParams {
            warehouse_id: fixture.warehouse_id,
            pricelist_id,
        },
    )
    .expect_err("missing product must fail closed");

    if !err.contains("not found") {
        return Err(format!("Expected product not found error, got: {err}"));
    }

    let so_after = ctx
        .db
        .sale_order()
        .iter()
        .filter(|o| o.organization_id == org_id && o.proposal_id == Some(proposal_id))
        .count();
    if so_after != so_before {
        return Err("Ghost SO created despite missing product".into());
    }

    let magic_uom = ctx.db.sale_order_line().iter().any(|l| {
        l.organization_id == org_id && l.product_id == ghost_product_id && l.product_uom == 1
    });
    if magic_uom {
        return Err("Magic product_uom=1 line persisted for missing product".into());
    }

    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
        .ok_or("proposal after fail")?;
    if proposal.sale_order_id.is_some() {
        return Err("proposal.sale_order_id must stay unset on failed convert".into());
    }

    Ok(())
}

/// R5: convert derives UoM from product; never hardcodes uom `1`.
pub fn test_convert_proposal_derives_product_uom(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;
    let product_name = product.name.clone();
    // Force a distinctive UoM so success cannot be confused with magic `1`.
    let category_id = ctx
        .db
        .uom()
        .id()
        .find(&product.uom_id)
        .map(|u| u.category_id)
        .ok_or("product uom missing")?;
    create_uom(
        ctx,
        org_id,
        CreateUomParams {
            category_id,
            name: "R5 Dozen".to_string(),
            symbol: "dz".to_string(),
            factor: 12.0,
            rounding: 0.01,
            times_bigger: 12.0,
            is_reference_unit: false,
            is_active: true,
            metadata: Some(r#"{"test":"r5_distinct_uom"}"#.to_string()),
        },
    )?;
    let expected_uom = ctx
        .db
        .uom()
        .iter()
        .find(|u| u.category_id == category_id && u.name == "R5 Dozen")
        .map(|u| u.id)
        .ok_or("R5 Dozen uom missing")?;
    if expected_uom == 1 {
        return Err("Distinctive UoM unexpectedly has id 1".into());
    }
    ctx.db
        .product()
        .id()
        .update(crate::inventory::product::Product {
            uom_id: expected_uom,
            ..product
        });

    let proposal_id = create_awarded_proposal(ctx, &fixture, "R5 Derive UoM")?;
    let pricelist_id = seed_pricelist(ctx, &fixture, "R5 Derive UoM PL")?;

    add_proposal_line_item(
        ctx,
        org_id,
        company_id,
        proposal_id,
        AddProposalLineItemParams {
            section_id: None,
            product_id: fixture.product_id,
            product_name,
            product_variant_id: None,
            description: None,
            quantity: 3.0,
            price_unit: 20.0,
            discount: 0.0,
            notes: Some("r5-derive".to_string()),
        },
    )?;

    convert_proposal_to_sale_order(
        ctx,
        org_id,
        company_id,
        proposal_id,
        ConvertProposalToSaleOrderParams {
            warehouse_id: fixture.warehouse_id,
            pricelist_id,
        },
    )?;

    let so = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| o.organization_id == org_id && o.proposal_id == Some(proposal_id))
        .ok_or("SO missing after proposal convert")?;

    let line = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&so.id)
        .find(|l| l.product_id == fixture.product_id)
        .ok_or("SO line missing")?;

    if line.product_uom != expected_uom {
        return Err(format!(
            "Expected product_uom={expected_uom} from product, got {}",
            line.product_uom
        ));
    }
    if expected_uom != 1 && line.product_uom == 1 {
        return Err("Magic uom 1 used instead of product.uom_id".into());
    }

    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
        .ok_or("proposal after convert")?;
    if proposal.sale_order_id != Some(so.id) {
        return Err(format!(
            "Expected sale_order_id={:?}, got {:?}",
            Some(so.id),
            proposal.sale_order_id
        ));
    }

    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .iter()
        .filter(|commit| {
            commit.organization_id == org_id
                && commit.operation_id == "erp.convert_proposal_to_sale_order"
                && commit.correlation_id == format!("proposal:{proposal_id}:sale-order:{}", so.id)
        })
        .collect();
    if commits.len() != 1 || commits[0].row_change_count != 3 {
        return Err(format!(
            "proposal conversion commit mismatch: {}",
            commits.len()
        ));
    }
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .iter()
        .filter(|change| {
            change.organization_id == org_id && change.commit_sequence == commits[0].sequence
        })
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    let tables: Vec<_> = changes
        .iter()
        .map(|change| change.table_name.as_str())
        .collect();
    if tables != ["proposal", "sale_order", "sale_order_line"]
        || changes
            .iter()
            .any(|change| change.organization_id != org_id)
    {
        return Err(format!("proposal row order/scope mismatch: {tables:?}"));
    }

    // COV-17: a replayed conversion is rejected and creates no second order.
    let orders_for_proposal = || {
        ctx.db
            .sale_order()
            .iter()
            .filter(|o| o.organization_id == org_id && o.proposal_id == Some(proposal_id))
            .count()
    };
    let replay = convert_proposal_to_sale_order(
        ctx,
        org_id,
        company_id,
        proposal_id,
        ConvertProposalToSaleOrderParams {
            warehouse_id: fixture.warehouse_id,
            pricelist_id,
        },
    );
    match replay {
        Err(message) if message.contains("already converted") => {}
        Err(message) => return Err(format!("unexpected conversion replay rejection: {message}")),
        Ok(()) => return Err("replayed conversion must be rejected".into()),
    }
    if orders_for_proposal() != 1 || proposal_row(ctx, proposal_id)? != proposal {
        return Err("rejected conversion replay changed the proposal or its orders".into());
    }

    Ok(())
}

/// R5: product with uom_id=0 → Err; never invents uom `1`.
pub fn test_convert_proposal_zero_product_uom_fail_closed(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;
    let product_name = product.name.clone();
    ctx.db
        .product()
        .id()
        .update(crate::inventory::product::Product {
            uom_id: 0,
            ..product
        });

    let proposal_id = create_awarded_proposal(ctx, &fixture, "R5 Zero UoM")?;
    let pricelist_id = seed_pricelist(ctx, &fixture, "R5 Zero UoM PL")?;

    add_proposal_line_item(
        ctx,
        org_id,
        company_id,
        proposal_id,
        AddProposalLineItemParams {
            section_id: None,
            product_id: fixture.product_id,
            product_name,
            product_variant_id: None,
            description: None,
            quantity: 1.0,
            price_unit: 15.0,
            discount: 0.0,
            notes: None,
        },
    )?;

    let err = convert_proposal_to_sale_order(
        ctx,
        org_id,
        company_id,
        proposal_id,
        ConvertProposalToSaleOrderParams {
            warehouse_id: fixture.warehouse_id,
            pricelist_id,
        },
    )
    .expect_err("zero product UoM must fail closed");

    if !err.contains("UoM") && !err.to_lowercase().contains("uom") {
        return Err(format!("Expected UoM error, got: {err}"));
    }

    let so_exists = ctx
        .db
        .sale_order()
        .iter()
        .any(|o| o.organization_id == org_id && o.proposal_id == Some(proposal_id));
    if so_exists {
        return Err("Ghost SO created despite zero product UoM".into());
    }

    let magic_uom = ctx.db.sale_order_line().iter().any(|l| {
        l.organization_id == org_id && l.product_id == fixture.product_id && l.product_uom == 1
    });
    if magic_uom {
        return Err("Magic product_uom=1 line persisted".into());
    }

    Ok(())
}

/// PRO-005: an archived product is rejected both when added to a proposal line
/// and (if it slips onto one directly) at conversion time.
pub fn test_convert_proposal_archived_product_fail_closed(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let base_product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("harness product missing")?;
    ctx.db.product().id().update(Product {
        active: false,
        ..base_product
    });

    let proposal_id = create_awarded_proposal(ctx, &fixture, "R5 Archived Product")?;

    let add_err = add_proposal_line_item(
        ctx,
        org_id,
        company_id,
        proposal_id,
        AddProposalLineItemParams {
            section_id: None,
            product_id: fixture.product_id,
            product_name: "Archived Product".to_string(),
            product_variant_id: None,
            description: None,
            quantity: 1.0,
            price_unit: 10.0,
            discount: 0.0,
            notes: None,
        },
    )
    .expect_err("archived product line add must fail closed");
    if !add_err.contains("archived") {
        return Err(format!("Expected archived-product error, got: {add_err}"));
    }
    if ctx
        .db
        .proposal_line_item()
        .line_item_by_proposal()
        .filter(&proposal_id)
        .any(|l| l.product_id == fixture.product_id)
    {
        return Err("rejected archived-product line was persisted".into());
    }

    // Insert the line directly (bypassing add_proposal_line_item) to prove
    // convert_proposal_to_sale_order independently fails closed too.
    ctx.db.proposal_line_item().insert(ProposalLineItem {
        id: 0,
        organization_id: org_id,
        proposal_id,
        section_id: None,
        product_id: fixture.product_id,
        product_name: "Archived Product".to_string(),
        product_variant_id: None,
        description: None,
        quantity: 1.0,
        price_unit: 10.0,
        subtotal: 10.0,
        discount: 0.0,
        sequence: 10,
        notes: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    let pricelist_id = seed_pricelist(ctx, &fixture, "R5 Archived Product PL")?;
    let convert_err = convert_proposal_to_sale_order(
        ctx,
        org_id,
        company_id,
        proposal_id,
        ConvertProposalToSaleOrderParams {
            warehouse_id: fixture.warehouse_id,
            pricelist_id,
        },
    )
    .expect_err("archived product convert must fail closed");
    if !convert_err.contains("archived") {
        return Err(format!(
            "Expected archived-product convert error, got: {convert_err}"
        ));
    }
    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
        .ok_or("proposal after archived-product convert fail")?;
    if proposal.sale_order_id.is_some() {
        return Err("proposal.sale_order_id must stay unset on failed convert".into());
    }

    Ok(())
}

/// PRO-006: a comment on a since-deleted section is rejected without persisting.
pub fn test_add_proposal_comment_orphan_section_rejected(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let proposal_id = create_awarded_proposal(ctx, &fixture, "PRO-006 Proposal")?;

    upsert_proposal_section(
        ctx,
        org_id,
        company_id,
        proposal_id,
        0,
        0,
        UpsertProposalSectionParams {
            title: "PRO-006 Section".to_string(),
            content: "content".to_string(),
            status: "draft".to_string(),
            sequence: 1,
            ai_suggestion: None,
        },
    )?;
    let section_id = ctx
        .db
        .proposal_section()
        .iter()
        .find(|s| s.proposal_id == proposal_id && s.title == "PRO-006 Section")
        .map(|s| s.id)
        .ok_or("section missing after create")?;

    // Baseline: a comment on the live section succeeds.
    add_proposal_comment(
        ctx,
        org_id,
        company_id,
        proposal_id,
        section_id,
        "live comment".to_string(),
        None,
        "Tester".to_string(),
    )?;
    let comment_count_before = ctx.db.proposal_comment().iter().count();

    delete_proposal_section(ctx, org_id, company_id, section_id)?;

    let err = add_proposal_comment(
        ctx,
        org_id,
        company_id,
        proposal_id,
        section_id,
        "orphan comment".to_string(),
        None,
        "Tester".to_string(),
    )
    .expect_err("comment on deleted section must be rejected");
    if !err.contains("not found") {
        return Err(format!("Expected section-not-found error, got: {err}"));
    }
    if ctx.db.proposal_comment().iter().count() != comment_count_before {
        return Err("rejected orphan-section comment was persisted".into());
    }

    Ok(())
}

fn proposal_row(ctx: &ReducerContext, proposal_id: u64) -> Result<Proposal, String> {
    ctx.db
        .proposal()
        .id()
        .find(&proposal_id)
        .ok_or_else(|| format!("proposal {proposal_id} missing"))
}

/// COV-17: award approval is a one-way, second-person step. Self-approval by
/// the author, a replayed approval and a replayed award are all rejected and
/// leave the proposal row unchanged.
pub fn test_award_approval_rejects_self_and_replay(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (fixture.organization_id, fixture.company_id);
    let title = "COV-17 Award";
    create_proposal(
        ctx,
        org,
        company,
        CreateProposalParams {
            title: title.to_string(),
            client_name: "Acme COV-17".to_string(),
            currency_id: company_currency_id(ctx, company)?,
            value: 1_000.0,
            deadline: None,
            description: None,
            template_id: None,
            partner_id: Some(fixture.partner_id),
            document_folder_id: None,
            metadata: Some(r#"{"test":"cov17"}"#.to_string()),
        },
    )?;
    let id = ctx
        .db
        .proposal()
        .iter()
        .find(|p| p.organization_id == org && p.company_id == company && p.title == title)
        .map(|p| p.id)
        .ok_or("COV-17 proposal missing")?;
    update_proposal_status(ctx, org, company, id, "review".to_string())?;
    record_proposal_bid_decision(
        ctx,
        org,
        company,
        id,
        RecordProposalBidDecisionParams {
            decision: "bid".to_string(),
            rationale: "COV-17 bid".to_string(),
        },
    )?;
    update_proposal_status(ctx, org, company, id, "submitted".to_string())?;

    let expect_rejected_unchanged =
        |label: &str, expected: &str, op: &dyn Fn() -> Result<(), String>| {
            let before = proposal_row(ctx, id)?;
            match op() {
                Ok(()) => return Err(format!("{label}: must be rejected")),
                Err(message) if message.contains(expected) => {}
                Err(message) => return Err(format!("{label}: unexpected rejection: {message}")),
            }
            if proposal_row(ctx, id)? != before {
                return Err(format!("{label}: rejected call mutated the proposal"));
            }
            Ok(())
        };

    // The author cannot approve their own proposal.
    expect_rejected_unchanged("self approval", "your own proposal", &|| {
        approve_proposal(ctx, org, company, id)
    })?;

    // Hand authorship to someone else, then approve as a second person.
    let row = proposal_row(ctx, id)?;
    ctx.db.proposal().id().update(Proposal {
        create_uid: Identity::__dummy(),
        ..row
    });
    approve_proposal(ctx, org, company, id)?;
    let approved = proposal_row(ctx, id)?;
    if approved.award_approved_at.is_none() || approved.award_approved_by != Some(ctx.sender()) {
        return Err("approval did not record approver and time".into());
    }
    expect_rejected_unchanged("approval replay", "already approved", &|| {
        approve_proposal(ctx, org, company, id)
    })?;

    update_proposal_status(ctx, org, company, id, "awarded".to_string())?;
    if proposal_row(ctx, id)?.status != ProposalStatus::Awarded {
        return Err("award did not reach Awarded".into());
    }
    expect_rejected_unchanged("award replay", "Invalid status transition", &|| {
        update_proposal_status(ctx, org, company, id, "awarded".to_string())
    })?;
    expect_rejected_unchanged("approve awarded", "Only Submitted", &|| {
        approve_proposal(ctx, org, company, id)
    })?;
    Ok(())
}
