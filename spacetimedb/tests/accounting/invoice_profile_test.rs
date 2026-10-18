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
    test_reviewed_invoice_mail_claim_lifecycle(ctx)?;
    Ok(())
}

/// Runs through the existing post-invoice test reducer: real queue/claim/receipt rows,
/// no external delivery. A failed or uncertain claim is intentionally not retryable.
fn test_reviewed_invoice_mail_claim_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    use crate::core::messaging::{mail_message, mark_mail_message_delivered};
    use crate::documents::templates::{
        claim_reviewed_mail_delivery, create_mail_template, mail_template,
        queue_mail_from_template, CreateMailTemplateParams, QueueMailFromTemplateParams,
    };
    use serde_json::json;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let ar = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("mail test AR missing")?;
    let move_id = create_balanced_customer_invoice_on_account(
        ctx,
        &fixture,
        120.0,
        ar,
        "invoice-mail-claim",
        true,
    )?;
    let record = ctx
        .db
        .account_move()
        .id()
        .find(move_id)
        .ok_or("mail test invoice missing")?;
    create_mail_template(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateMailTemplateParams {
            name: "Reviewed invoice mail test".into(),
            model: "account_move".into(),
            subject: "Original subject".into(),
            body_html: "Original template body".into(),
            document_template_id: None,
            attach_document: true,
            is_default: true,
            is_active: true,
            metadata: None,
        },
    )?;
    let template_id = ctx
        .db
        .mail_template()
        .mail_template_by_org()
        .filter(fixture.organization_id)
        .map(|row| row.id)
        .max()
        .ok_or("mail test template missing")?;
    let revision = json!([
        format!("{:?}", record.state),
        format!("{:?}", record.move_type),
        record.amount_total,
        record.currency_id.to_string(),
        record.name,
        record
            .invoice_partner_display_name
            .as_deref()
            .unwrap_or_default(),
        record.metadata
    ]);
    let review_id = format!("review-mail-{move_id}");
    let context = json!({"invoiceReview": {"schemaVersion":2,"reviewId":review_id,
        "organizationId":fixture.organization_id.to_string(), "companyId":fixture.company_id.to_string(),
        "moveId":move_id.to_string(),"templateId":template_id.to_string(),"reference":record.name,
        "pdfFilename":format!("account-move-{move_id}.pdf"),"pdfAttached":true,
        "expectedSubject":"Original subject","expectedBodyHtml":"Original template body","expectedAttachDocument":true,
        "subject":"Reviewed one-off reminder","bodyText":"Please pay this invoice. <script>inert literal text</script>",
        "recordRevision":revision.to_string()}});
    let params = |context: &serde_json::Value| QueueMailFromTemplateParams {
        template_id,
        model: "account_move".into(),
        res_id: move_id,
        recipient_email: "alpha@example.test".into(),
        context_json: Some(context.to_string()),
    };
    let mut stale = context.clone();
    stale["invoiceReview"]["recordRevision"] = json!("[]");
    if queue_mail_from_template(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        params(&stale),
    )
    .is_ok()
    {
        return Err("stale reviewed invoice mail was queued".into());
    }
    queue_mail_from_template(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        params(&context),
    )?;
    queue_mail_from_template(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        params(&context),
    )?;
    let messages: Vec<_> = ctx
        .db
        .mail_message()
        .mail_message_by_org()
        .filter(fixture.organization_id)
        .filter(|row| row.model == "account_move" && row.res_id == move_id)
        .collect();
    if messages.len() != 1
        || messages[0].body != "Please pay this invoice. <script>inert literal text</script>"
    {
        return Err("review token replay duplicated or changed the reviewed message".into());
    }
    let message_id = messages[0].id;
    let digest = "a".repeat(64);
    if mark_mail_message_delivered(ctx, fixture.organization_id, message_id, None).is_ok()
        || claim_reviewed_mail_delivery(
            ctx,
            foreign.organization_id,
            foreign.company_id,
            message_id,
            review_id.clone(),
            digest.clone(),
        )
        .is_ok()
        || claim_reviewed_mail_delivery(
            ctx,
            fixture.organization_id,
            foreign.company_id,
            message_id,
            review_id.clone(),
            digest.clone(),
        )
        .is_ok()
        || claim_reviewed_mail_delivery(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            message_id,
            "wrong-review".into(),
            digest.clone(),
        )
        .is_ok()
    {
        return Err("unclaimed, foreign or substituted reviewed mail dispatch was admitted".into());
    }
    // A row can change between queue and provider preparation; the claim checks it atomically.
    ctx.db
        .account_move()
        .id()
        .update(crate::accounting::journal_entries::AccountMove {
            name: "Changed since queue".into(),
            ..record.clone()
        });
    if claim_reviewed_mail_delivery(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        message_id,
        review_id.clone(),
        digest.clone(),
    )
    .is_ok()
    {
        return Err("stale invoice was accepted for reviewed dispatch".into());
    }
    ctx.db.account_move().id().update(record);
    claim_reviewed_mail_delivery(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        message_id,
        review_id.clone(),
        digest.clone(),
    )?;
    if claim_reviewed_mail_delivery(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        message_id,
        review_id.clone(),
        digest.clone(),
    )
    .is_ok()
    {
        return Err("claimed reviewed email permitted a second provider dispatch".into());
    }
    let metadata: serde_json::Value = serde_json::from_str(
        ctx.db
            .mail_message()
            .id()
            .find(message_id)
            .ok_or("claimed mail missing")?
            .metadata
            .as_deref()
            .ok_or("claim metadata missing")?,
    )
    .map_err(|error| error.to_string())?;
    if metadata["delivery"] != "dispatching" || metadata["dispatch_request_digest"] != digest {
        return Err("claim did not persist its uncertain-delivery evidence".into());
    }
    let receipt =
        json!({"dispatch_review_id":review_id,"dispatch_request_digest":digest}).to_string();
    let bad_receipt =
        json!({"dispatch_review_id":review_id,"dispatch_request_digest":"b".repeat(64)})
            .to_string();
    if mark_mail_message_delivered(ctx, fixture.organization_id, message_id, Some(bad_receipt))
        .is_ok()
    {
        return Err("substituted provider receipt marked the reviewed message sent".into());
    }
    if mark_mail_message_delivered(
        ctx,
        fixture.organization_id,
        message_id,
        Some(receipt.clone()),
    )
    .is_ok()
    {
        return Err("ordinary direct SDK caller forged provider acceptance after claiming".into());
    }
    // Bind the test actor as the service principal to exercise the trusted branch;
    // production bindings use a distinct administrator through the platform registration reducer.
    use crate::core::cold_tier_identity::{
        cold_tier_service_identity, ColdTierServiceIdentity, REVIEWED_MAIL_DISPATCHER_SERVICE,
    };
    ctx.db
        .cold_tier_service_identity()
        .insert(ColdTierServiceIdentity {
            platform_id: format!("test-mail-service-{}", fixture.organization_id),
            organization_id: fixture.organization_id,
            service_name: REVIEWED_MAIL_DISPATCHER_SERVICE.into(),
            identity: ctx.sender(),
            is_active: true,
            registered_by: ctx.sender(),
            registered_at: ctx.timestamp,
            retired_at: None,
        });
    mark_mail_message_delivered(ctx, fixture.organization_id, message_id, Some(receipt))?;
    let sent: serde_json::Value = serde_json::from_str(
        ctx.db
            .mail_message()
            .id()
            .find(message_id)
            .ok_or("sent mail missing")?
            .metadata
            .as_deref()
            .ok_or("sent metadata missing")?,
    )
    .map_err(|error| error.to_string())?;
    if sent["delivery"] != "sent"
        || sent["context_json"] != context.to_string()
        || sent["subject"] != "Reviewed one-off reminder"
    {
        return Err("delivery marking lost original reviewed invoice message evidence".into());
    }
    let mut reminder = context.clone();
    let reminder_id = format!("reminder-{move_id}");
    reminder["invoiceReview"]["reviewId"] = json!(reminder_id);
    reminder["invoiceReview"]["purpose"] = json!("reminder");
    let record = ctx
        .db
        .account_move()
        .id()
        .find(move_id)
        .ok_or("reminder invoice missing")?;
    ctx.db
        .account_move()
        .id()
        .update(crate::accounting::journal_entries::AccountMove {
            invoice_date_due: Some(ctx.timestamp),
            ..record.clone()
        });
    if queue_mail_from_template(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        params(&reminder),
    )
    .is_ok()
    {
        return Err("invoice due today was accepted as an overdue reminder".into());
    }
    let overdue = crate::accounting::journal_entries::AccountMove {
        invoice_date_due: Some(spacetimedb::Timestamp::from_micros_since_unix_epoch(
            ctx.timestamp.to_micros_since_unix_epoch() - 86_400_000_000,
        )),
        ..record
    };
    ctx.db.account_move().id().update(overdue.clone());
    queue_mail_from_template(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        params(&reminder),
    )?;
    let reminder_message_id = ctx
        .db
        .mail_message()
        .mail_message_by_org()
        .filter(fixture.organization_id)
        .filter(|row| row.model == "account_move" && row.res_id == move_id)
        .map(|row| row.id)
        .max()
        .ok_or("reminder mail missing")?;
    ctx.db
        .account_move()
        .id()
        .update(crate::accounting::journal_entries::AccountMove {
            amount_residual: 0.0,
            ..overdue.clone()
        });
    if claim_reviewed_mail_delivery(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        reminder_message_id,
        reminder_id.clone(),
        digest.clone(),
    )
    .is_ok()
    {
        return Err("a paid invoice reminder was admitted for provider dispatch".into());
    }
    ctx.db.account_move().id().update(overdue);
    claim_reviewed_mail_delivery(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        reminder_message_id,
        reminder_id,
        digest,
    )?;
    Ok(())
}
