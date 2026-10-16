//! Runtime proof for trusted profile capture, posting, and append-only versions.

use spacetimedb::{ReducerContext, Table};

use crate::accounting::journal_entries::{account_move, post_account_move, post_invoice};
use crate::core::organization::company;
use crate::crm::contacts::{contact, Contact};
use crate::documents::invoice_profile::{
    capture_invoice_document_metadata, INVOICE_PROFILE_REPORT_TYPE,
};
use crate::documents::templates::{
    create_document_template, document_template, update_document_template,
    CreateDocumentTemplateParams, UpdateDocumentTemplateParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};

use super::helpers::{create_balanced_customer_invoice_on_account, seed_sibling_company};

fn publish(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    values: serde_json::Value,
) -> Result<u64, String> {
    create_document_template(
        ctx,
        organization_id,
        company_id,
        CreateDocumentTemplateParams {
            name: "Invoice profile test".to_string(),
            model: "account_move".to_string(),
            report_type: INVOICE_PROFILE_REPORT_TYPE.to_string(),
            body_html: "Invoice personalization profile".to_string(),
            header_html: None,
            footer_html: None,
            variable_bindings_json: None,
            is_default: true,
            is_active: true,
            metadata: Some(
                serde_json::json!({"invoiceProfile":{"schemaVersion":1,"values":values}})
                    .to_string(),
            ),
        },
    )?;
    ctx.db
        .document_template()
        .document_template_by_org()
        .filter(&organization_id)
        .filter(|row| {
            row.company_id == company_id && row.report_type == INVOICE_PROFILE_REPORT_TYPE
        })
        .map(|row| row.id)
        .max()
        .ok_or_else(|| "published invoice profile missing".to_string())
}

fn document(ctx: &ReducerContext, move_id: u64) -> Result<serde_json::Value, String> {
    let row = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("invoice move missing")?;
    let metadata: serde_json::Value =
        serde_json::from_str(row.metadata.as_deref().ok_or("invoice metadata missing")?)
            .map_err(|error| format!("invalid invoice metadata: {error}"))?;
    Ok(metadata["invoiceDocument"].clone())
}

pub fn test_invoice_profiles_capture_trusted_identity_and_freeze_at_posting(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let sibling_id = seed_sibling_company(ctx, &fixture)?;
    let original_org_version = publish(
        ctx,
        fixture.organization_id,
        None,
        serde_json::json!({"notice":"Organization notice","terms":"Draft terms"}),
    )?;
    let company_version = publish(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        serde_json::json!({"notice":"","footer":"Company footer"}),
    )?;
    publish(
        ctx,
        fixture.organization_id,
        Some(sibling_id),
        serde_json::json!({"terms":"Wrong sibling"}),
    )?;
    publish(
        ctx,
        foreign.organization_id,
        None,
        serde_json::json!({"terms":"Wrong organization"}),
    )?;
    let move_id = create_balanced_customer_invoice_on_account(
        ctx,
        &fixture,
        75.0,
        fixture.chart_account_ids[chart_keys::AR],
        "profile-account-post",
        false,
    )?;
    let draft = document(ctx, move_id)?;
    let buyer = ctx
        .db
        .contact()
        .id()
        .find(fixture.partner_id)
        .ok_or("fixture buyer missing")?;
    if draft["schemaVersion"] != 2
        || draft["buyer"]["partnerId"] != fixture.partner_id.to_string()
        || draft["buyer"]["name"] != buyer.name
    {
        return Err("draft did not capture exact canonical buyer".to_string());
    }
    for other_partner in [
        foreign.partner_id,
        ctx.db
            .contact()
            .insert(Contact {
                id: 0,
                company_id: Some(sibling_id),
                ..buyer.clone()
            })
            .id,
    ] {
        if capture_invoice_document_metadata(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            Some(other_partner),
            None,
        )
        .is_ok()
        {
            return Err(
                "buyer capture accepted a foreign organization/company contact".to_string(),
            );
        }
    }
    let original_company_scope = buyer.company_id;
    ctx.db.contact().id().update(Contact {
        company_id: None,
        ..buyer.clone()
    });
    capture_invoice_document_metadata(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        Some(buyer.id),
        None,
    )?;
    ctx.db.contact().id().update(Contact {
        deleted_at: Some(ctx.timestamp),
        ..buyer.clone()
    });
    if capture_invoice_document_metadata(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        Some(buyer.id),
        None,
    )
    .is_ok()
    {
        return Err("buyer capture accepted a deleted contact".to_string());
    }
    ctx.db.contact().id().update(Contact {
        merge_target_id: Some(foreign.partner_id),
        ..buyer.clone()
    });
    if capture_invoice_document_metadata(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        Some(buyer.id),
        None,
    )
    .is_ok()
    {
        return Err("buyer capture accepted a merged contact".to_string());
    }
    ctx.db.contact().id().update(Contact {
        name: "Buyer legal name at issue".into(),
        tax_id: Some("BUYER-ISSUE-TIN".into()),
        company_id: original_company_scope,
        ..buyer.clone()
    });
    let company = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("invoice company missing")?;
    if draft["seller"]["name"] != company.name
        || draft["profile"]["terms"] != "Draft terms"
        || draft["profile"]["notice"] != ""
        || draft["profileVersionIds"]["organization"] != original_org_version.to_string()
        || draft["profileVersionIds"]["company"] != company_version.to_string()
    {
        return Err(
            "invoice draft identity, inheritance, or version scope was incorrect".to_string(),
        );
    }
    if capture_invoice_document_metadata(
        ctx,
        foreign.organization_id,
        fixture.company_id,
        None,
        None,
    )
    .is_ok()
    {
        return Err("invoice snapshot accepted a foreign organization/company pair".to_string());
    }
    let update = UpdateDocumentTemplateParams {
        name: None,
        report_type: Some("pdf".to_string()),
        body_html: None,
        header_html: None,
        footer_html: None,
        variable_bindings_json: None,
        is_default: None,
        is_active: Some(false),
        metadata: None,
    };
    if update_document_template(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        company_version,
        update,
    )
    .is_ok()
    {
        return Err("published invoice profile was mutable".to_string());
    }
    let posting_version = publish(
        ctx,
        fixture.organization_id,
        None,
        serde_json::json!({"terms":"Posting terms","notice":"New default notice"}),
    )?;
    post_account_move(ctx, fixture.organization_id, move_id)?;
    let issued = document(ctx, move_id)?;
    if issued["profile"]["terms"] != "Posting terms"
        || issued["profile"]["notice"] != ""
        || issued["profileVersionIds"]["organization"] != posting_version.to_string()
        || issued["buyer"]["name"] != "Buyer legal name at issue"
        || issued["buyer"]["taxId"] != "BUYER-ISSUE-TIN"
    {
        return Err(
            "post_account_move did not capture current trusted profile versions".to_string(),
        );
    }
    let second_id = create_balanced_customer_invoice_on_account(
        ctx,
        &fixture,
        80.0,
        fixture.chart_account_ids[chart_keys::AR],
        "profile-invoice-post",
        false,
    )?;
    publish(
        ctx,
        fixture.organization_id,
        None,
        serde_json::json!({"terms":"Invoice posting terms"}),
    )?;
    let revenue_id = fixture.chart_account_ids[chart_keys::REVENUE];
    post_invoice(
        ctx,
        fixture.organization_id,
        second_id,
        revenue_id,
        revenue_id,
    )?;
    let second_issued = document(ctx, second_id)?;
    if second_issued["profile"]["terms"] != "Invoice posting terms" {
        return Err("post_invoice did not capture current trusted profile versions".to_string());
    }
    publish(
        ctx,
        fixture.organization_id,
        None,
        serde_json::json!({"terms":"Future default"}),
    )?;
    ctx.db.contact().id().update(Contact {
        name: "Later CRM name must not rewrite issued invoices".into(),
        ..buyer
    });
    if post_account_move(ctx, fixture.organization_id, move_id).is_ok()
        || post_invoice(
            ctx,
            fixture.organization_id,
            second_id,
            revenue_id,
            revenue_id,
        )
        .is_ok()
        || document(ctx, move_id)? != issued
        || document(ctx, second_id)? != second_issued
    {
        return Err(
            "later defaults or posting retries changed an issued invoice snapshot".to_string(),
        );
    }
    Ok(())
}
