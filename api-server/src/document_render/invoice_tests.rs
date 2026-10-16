use super::*;
use serde_json::json;

fn saved_snapshot() -> Value {
    json!({
        "schemaVersion": 1,
        "profileVersionIds": { "organization": "8", "company": "19" },
        "seller": { "name": "Étoile & Co", "address": ["12 Canal Street", "Amsterdam"], "taxId": "NL123", "registrationNumber": "REG42", "email": "", "phone": "", "website": "" },
        "profile": { "logoUrl": "", "accent": "teal", "email": "accounts@example.test", "phone": "+31 123", "website": "example.test", "notice": "Original notice", "terms": "Original terms", "paymentInstructions": "Bank transfer, reference INV/42", "footer": "Original footer" },
        "notes": "Thank you — merci!"
    })
}

fn invoice() -> Value {
    json!({
        "id": "42", "organizationId": "7", "companyId": "3", "currencyId": "90",
        "moveType": "OutInvoice", "state": "Posted", "name": "INV/42", "partnerId": "4",
        "invoicePartnerDisplayName": "Customer & Sons", "invoiceDate": {"microsSinceUnixEpoch": "1792108800000000"},
        "invoiceDateDue": "2026-11-15", "amountUntaxed": 99.99, "amountTax": 21.0, "amountTotal": 120.99, "amountResidual": 60.5,
        "metadata": json!({"invoiceDocument": saved_snapshot()}).to_string(),
    })
}

fn commercial_line(id: u64) -> Value {
    json!({"id": id, "moveId": 42, "companyId": 3, "sequence": id, "name": format!("Service {id}"), "excludeFromInvoiceTab": false, "taxLineId": null, "displayType": null, "quantity": 3, "priceUnit": 0.3333, "priceSubtotal": 0.99, "discount": 0})
}

fn project(mv: &Value, lines: &[Value]) -> InvoiceDocument {
    project_invoice(
        mv,
        lines,
        document_snapshot(mv).expect("snapshot"),
        None,
        Some(&json!({"id":90,"code":"EUR","decimal_places":2})),
    )
    .expect("project invoice")
}

#[test]
fn saved_identity_and_profile_are_not_replaced_with_live_company_settings() {
    let mv = invoice();
    let company = json!({"id":3,"name":"New company name","metadata":{"logoUrl":"https://tracker.invalid/new.png","notice":"New notice"}});
    let document = project_invoice(
        &mv,
        &[],
        document_snapshot(&mv).expect("snapshot"),
        Some(&company),
        None,
    )
    .expect("document");
    assert_eq!(document.seller.name, "Étoile & Co");
    assert_eq!(document.profile.notice, "Original notice");
    assert_eq!(document.profile.logo_url, "");
    assert!(!render_invoice_html(&document, None).contains("New company name"));
}

#[test]
fn legacy_identity_uses_only_exact_canonical_company_and_preserves_notes() {
    let mut mv = invoice();
    mv["metadata"] = json!({"notes":"Legacy customer note","invoiceContent":{"notice":"Do not infer an issued profile"}});
    let company = json!({"id":3,"name":"Canonical seller","taxId":"TAX","addressStreet":"Canal 10","metadata":{"invoiceBranding":{"notice":"Live default must not appear"}}});
    let document = project_invoice(&mv, &[], None, Some(&company), None).expect("legacy");
    assert!(document.legacy);
    assert_eq!(document.seller.name, "Canonical seller");
    assert_eq!(document.notes, "Legacy customer note");
    assert!(document.profile.notice.is_empty());
    let html = render_invoice_html(&document, None);
    assert!(!html.contains("Live default must not appear"));
    assert!(!html.contains("Do not infer an issued profile"));
    let wrong = project_invoice(
        &mv,
        &[],
        None,
        Some(&json!({"id":30,"name":"Wrong seller"})),
        None,
    )
    .expect("legacy");
    assert_eq!(wrong.seller.name, "Company #3");
}

#[test]
fn malformed_or_unsupported_snapshots_fail_instead_of_using_current_branding() {
    for raw in [
        Value::Null,
        json!({}),
        json!({"schemaVersion":2}),
        json!("bad"),
    ] {
        let mut mv = invoice();
        mv["metadata"] = json!({"invoiceDocument": raw});
        assert!(document_snapshot(&mv).is_err());
    }
    let mut snapshot = saved_snapshot();
    snapshot["profile"]["accent"] = json!("url(https://tracker.invalid)");
    let mut mv = invoice();
    mv["metadata"] = json!({"invoiceDocument":snapshot});
    assert!(document_snapshot(&mv).is_err());
    mv["metadata"] = json!("{\"invoiceDocument\":{corrupt json");
    assert!(document_snapshot(&mv).is_err());
}

#[test]
fn commercial_projection_excludes_tax_counterpart_and_other_company_or_move_lines() {
    let first = commercial_line(1);
    let mut tax = commercial_line(2);
    tax["taxLineId"] = json!(5);
    let mut counterpart = commercial_line(3);
    counterpart["excludeFromInvoiceTab"] = json!(true);
    let mut section = commercial_line(4);
    section["displayType"] = json!("line_section");
    let mut other_company = commercial_line(5);
    other_company["companyId"] = json!(30);
    let mut other_move = commercial_line(6);
    other_move["moveId"] = json!(420);
    let document = project(
        &invoice(),
        &[first, tax, counterpart, section, other_company, other_move],
    );
    assert_eq!(document.lines.len(), 1);
    assert_eq!(document.lines[0].subtotal, Some(0.99));
    // Do not recalculate 3 × 0.3333 into a different canonical subtotal.
    assert_ne!(document.lines[0].subtotal, Some(0.9999));
    assert_eq!(document.tax, Some(21.0));
}

#[test]
fn currency_uses_exact_catalog_identity_and_precision_without_id_conventions() {
    let document = project(&invoice(), &[]);
    assert_eq!(document.currency, "EUR");
    assert!(render_invoice_html(&document, None).contains("EUR 120.99"));
    let mv = invoice();
    let wrong = project_invoice(
        &mv,
        &[],
        document_snapshot(&mv).expect("snapshot"),
        None,
        Some(&json!({"id":1,"code":"USD"})),
    )
    .expect("wrong catalog row");
    assert_eq!(wrong.currency, "Currency #90");
    let jpy = project_invoice(
        &mv,
        &[],
        document_snapshot(&mv).expect("snapshot"),
        None,
        Some(&json!({"id":90,"code":"JPY","decimalPlaces":0})),
    )
    .expect("JPY");
    assert!(render_invoice_html(&jpy, None).contains("JPY 121"));
}

#[test]
fn missing_amounts_are_explicitly_unavailable_instead_of_fabricated_zero() {
    let mut mv = invoice();
    mv.as_object_mut().expect("object").remove("amountTotal");
    mv["amountTax"] = Value::Null;
    let document = project(&mv, &[]);
    assert_eq!(document.total, None);
    assert_eq!(document.tax, None);
    assert_eq!(money(document.total, &document), "Not available");
}

#[test]
fn notes_and_document_text_are_escaped_and_no_remote_asset_is_rendered() {
    let mut document = project(&invoice(), &[]);
    document.notes = "<script>window.evil()</script>\nRésumé & thanks".into();
    let html = render_invoice_html(&document, Some("https://tracker.invalid/logo.svg"));
    assert!(html.contains("&lt;script&gt;window.evil()&lt;/script&gt;"));
    assert!(html.contains("Résumé &amp; thanks"));
    assert!(!html.contains("<script>"));
    assert!(!html.contains("tracker.invalid"));
    assert!(html.contains("default-src 'none'; img-src data:"));
    let logo = render_invoice_html(&document, Some("data:image/png;base64,iVBORw0KGgo="));
    assert!(logo.contains("alt=\"Company logo\" src=\"data:image/png;base64,"));
}

#[test]
fn overflow_and_multipage_fixture_retains_all_lines_and_full_notice_terms_footer() {
    let lines = (1..=200).map(commercial_line).collect::<Vec<_>>();
    let mut document = project(&invoice(), &lines);
    document.profile.notice = format!(
        "NOTICE_START\n{}\n{}\nNOTICE_END",
        "A notice line that must stay readable.\n".repeat(90),
        "UNBROKEN_NOTICE".repeat(100),
    );
    document.profile.terms = format!("TERMS_START\n{}\nTERMS_END", "TERMS_CONTENT ".repeat(600));
    document.profile.footer = format!(
        "FOOTER_START\n{}\nFOOTER_END",
        "Footer content must not be cropped.\n".repeat(90)
    );
    document.notes = "UTF8 NOTE Étoile — café & tea\nNOTE_END".into();
    let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=";
    let html = render_invoice_html(&document, Some(png));
    for expected in [
        "Service 1</td>",
        "Service 200</td>",
        "NOTICE_START",
        "NOTICE_END",
        "TERMS_START",
        "TERMS_END",
        "FOOTER_START",
        "FOOTER_END",
        "NOTE_END",
    ] {
        assert!(html.contains(expected), "missing {expected}");
    }
    assert!(html.contains("overflow-wrap:anywhere"));
    assert!(html.contains("display:table-header-group"));
    assert!(!html.contains("overflow:hidden"));
    assert!(!html.contains("max-height:") || html.contains(".logo"));
    if let Some(path) = std::env::var_os("LUMIERE_INVOICE_HTML_TEST_ARTIFACT") {
        std::fs::write(path, html).expect("write requested HTML test artifact");
    }
}

#[test]
fn customer_identity_is_persisted_on_invoice_and_dates_decode_as_utc_calendar_dates() {
    let mv = invoice();
    let document = project_invoice(
        &mv,
        &[],
        document_snapshot(&mv).expect("snapshot"),
        None,
        None,
    )
    .expect("projection");
    assert_eq!(document.customer.name, "Customer & Sons");
    assert!(document.customer.address.is_empty());
    assert_eq!(document.date, "2026-10-16");
    assert_eq!(document.due_date, "2026-11-15");
}

#[test]
fn incoming_bills_are_internal_company_records_without_outgoing_seller_branding() {
    let mut mv = invoice();
    mv["moveType"] = json!("InInvoice");
    assert!(document_snapshot(&mv)
        .expect("incoming has no seller snapshot")
        .is_none());
    let document = project_invoice(
        &mv,
        &[],
        None,
        Some(&json!({"id":3,"name":"Our company"})),
        None,
    )
    .expect("incoming");
    assert!(document.internal_record);
    assert!(!document.legacy);
    assert!(document.profile.logo_url.is_empty());
    assert!(document.profile.notice.is_empty());
    let html = render_invoice_html(&document, None);
    assert!(html.contains("Internal accounting record · Company"));
    assert!(html.contains("<h2>Vendor</h2>"));
    assert!(!html.contains("Étoile &amp; Co"));
}

#[test]
fn historical_raw_order_notes_remain_printable_without_becoming_a_profile() {
    let mut mv = invoice();
    mv["metadata"] = json!("Thanks for your business <script>never execute</script>");
    assert!(document_snapshot(&mv).expect("legacy text").is_none());
    let document = project_invoice(&mv, &[], None, None, None).expect("legacy invoice");
    let html = render_invoice_html(&document, None);
    assert!(html.contains("Thanks for your business &lt;script&gt;never execute&lt;/script&gt;"));
    assert!(document.profile.notice.is_empty());
}

fn draft_company() -> Value {
    json!({"id":3,"organizationId":7,"name":"Current legal seller","addressStreet":"Canal 12","addressCity":"Amsterdam","addressZip":"1000","addressCountryCode":"NL","taxId":null,"companyRegistry":null})
}

fn published_profile(id: u64, company_id: Option<u64>, values: Value) -> Value {
    json!({"id":id,"organizationId":7,"companyId":company_id,"name":format!("Profile {id}"),"model":"account_move","reportType":"lumiere-invoice-profile-v1","isActive":true,"isDefault":true,"metadata":json!({"invoiceProfile":{"schemaVersion":1,"values":values}}).to_string()})
}

#[test]
fn draft_review_resolves_latest_org_company_and_document_overrides_with_explicit_clears() {
    let mut mv = invoice();
    mv["state"] = json!("Draft");
    mv["metadata"] = json!({"notes":"Customer-specific notes","invoiceContent":{"schemaVersion":1,"terms":"","paymentInstructions":"Use reference42"},"invoiceDocument":saved_snapshot()});
    let templates = [
        published_profile(1, None, json!({"notice":"Outdated"})),
        published_profile(
            8,
            None,
            json!({"notice":"Approved notice","terms":"Inherited terms","email":"org@example.test"}),
        ),
        published_profile(9, Some(3), json!({"footer":"Company footer","email":""})),
    ];
    let snapshot = draft_invoice_snapshot(&mv, 7, Some(&draft_company()), &templates)
        .expect("draft")
        .expect("profile");
    assert_eq!(snapshot.profile.notice, "Approved notice");
    assert_eq!(snapshot.profile.terms, "");
    assert_eq!(snapshot.profile.footer, "Company footer");
    assert_eq!(snapshot.profile.email, "");
    assert_eq!(snapshot.profile.payment_instructions, "Use reference42");
    assert_eq!(snapshot.notes, "Customer-specific notes");
    assert_eq!(snapshot.seller.name, "Current legal seller");
    assert_eq!(
        snapshot.seller.address,
        ["Canal 12", "Amsterdam", "1000", "NL"]
    );
    assert_eq!(
        snapshot.profile_version_ids.organization.as_deref(),
        Some("8")
    );
    assert_eq!(snapshot.profile_version_ids.company.as_deref(), Some("9"));
    if let Some(path) = std::env::var_os("LUMIERE_INVOICE_DRAFT_HTML_TEST_ARTIFACT") {
        let document = project_invoice(
            &mv,
            &[commercial_line(1)],
            Some(snapshot),
            None,
            Some(&json!({"id":90,"code":"EUR","decimalPlaces":2})),
        )
        .expect("draft projection");
        std::fs::write(path, render_invoice_html(&document, None))
            .expect("write requested draft HTML artifact");
    }
}

#[test]
fn draft_ignores_foreign_and_inactive_publications_but_malformed_selected_latest_fails() {
    let mut mv = invoice();
    mv["state"] = json!("Draft");
    let current = published_profile(8, None, json!({"notice":"Current"}));
    let mut foreign_org = published_profile(100, None, json!({}));
    foreign_org["organizationId"] = json!(70);
    foreign_org["metadata"] = json!("malformed foreign metadata");
    let mut foreign_company = published_profile(101, Some(30), json!({}));
    foreign_company["metadata"] = json!("malformed foreign metadata");
    let mut inactive = published_profile(102, None, json!({}));
    inactive["isActive"] = json!(false);
    inactive["metadata"] = json!("malformed inactive metadata");
    let snapshot = draft_invoice_snapshot(
        &mv,
        7,
        Some(&draft_company()),
        &[current.clone(), foreign_org, foreign_company, inactive],
    )
    .expect("draft")
    .expect("profile");
    assert_eq!(snapshot.profile.notice, "Current");
    let mut malformed_latest = published_profile(103, None, json!({}));
    malformed_latest["metadata"] = json!("malformed selected metadata");
    assert!(
        draft_invoice_snapshot(&mv, 7, Some(&draft_company()), &[current, malformed_latest])
            .is_err()
    );
}

#[test]
fn draft_profile_and_seller_redaction_never_masquerade_as_missing_defaults() {
    let mut mv = invoice();
    mv["state"] = json!("Draft");
    assert!(draft_invoice_snapshot(&mv, 7, None, &[]).is_err());
    let mut company = draft_company();
    company.as_object_mut().expect("company").remove("taxId");
    assert!(draft_invoice_snapshot(&mv, 7, Some(&company), &[]).is_err());
    let mut row = published_profile(8, None, json!({}));
    row.as_object_mut().expect("profile").remove("companyId");
    assert!(draft_invoice_snapshot(&mv, 7, Some(&draft_company()), &[row]).is_err());
    for values in [
        json!({"terms":"x".repeat(8001)}),
        json!({"notice":"bad\u{0000}control"}),
        json!({"logoUrl":"https://tracker.invalid/logo.png"}),
        json!({"bodyHtml":"<script>bad</script>"}),
    ] {
        assert!(draft_invoice_snapshot(
            &mv,
            7,
            Some(&draft_company()),
            &[published_profile(8, None, values)]
        )
        .is_err());
    }
}

#[test]
fn issued_documents_bypass_current_profiles_and_canonical_company_reads() {
    let mv = invoice();
    let snapshot = draft_invoice_snapshot(
        &mv,
        7,
        None,
        &[json!({"malformed":"unreadable current data"})],
    )
    .expect("issued snapshot")
    .expect("snapshot");
    assert_eq!(snapshot.seller.name, "Étoile & Co");
    assert_eq!(snapshot.profile.notice, "Original notice");
    let mut incoming = mv.clone();
    incoming["state"] = json!("Draft");
    incoming["moveType"] = json!("InInvoice");
    assert!(draft_invoice_snapshot(&incoming, 7, None, &[json!({})])
        .expect("vendor internal record")
        .is_none());
}
