use super::*;
use serde_json::json;

fn template_row(components: Value) -> Value {
    json!({"id": "12", "organization_id": "7", "company_id": "3", "is_active": true,
        "report_type": "lumiere-document-layout-v1", "name": "Company quotation",
        "body_html": "<script>this separately edited cache must never be used</script>",
        "metadata": json!({"documentDesigner": {"schemaVersion":1,"engine":"grapesjs","kind":"document",
            "project":{"assets":[],"styles":[],"pages":[{"frames":[{"component":{
                "type":"wrapper","components":components
            }}]}]}}}).to_string()})
}

fn order() -> Value {
    json!({"id":9,"organization_id":7,"company_id":3,"partner_id":4,"currency_id":90,
        "reference":"Q/2026/9","state":{"tag":"Draft"},"write_date":{"microsSinceUnixEpoch":"1792531200000000"},
        "order_line":[1,2],"date_order":"2026-10-21","validity_date":"2026-11-21",
        "amount_untaxed":120.25,"amount_tax":24.05,"amount_total":144.30,
        "note":"Thank you — merci!","terms_and_conditions":"Payment within 30 days"})
}

fn line(id: u64) -> Value {
    json!({"id":id,"organization_id":7,"company_id":3,"order_id":9,"name":format!("Service {id}"),
        "sequence":id,"display_type":null,"product_uom_qty":1.5,"price_unit":40.08333333,
        "discount":0,"price_subtotal":60.125})
}

fn company() -> Value {
    json!({"id":3,"organization_id":7,"name":"Étoile & Co","address_street":"12 Canal Street",
        "address_city":"Amsterdam","address_zip":"1234 AB","address_country_code":"NL","tax_id":"NL123"})
}

fn customer() -> Value {
    json!({"id":4,"organization_id":7,"company_id":null,"name":"Buyer <script>alert(1)</script>",
        "street":"Main Street","street2":null,"city":"Kigali","zip":null,"country_code":"RW","email":"buyer@example.test"})
}

fn currency() -> Value {
    json!({"id":90,"organization_id":7,"code":"EUR","decimal_places":2})
}

fn data() -> QuotationData {
    project_quotation(
        &order(),
        &[line(2), line(1)],
        &company(),
        &customer(),
        &currency(),
        7,
        3,
    )
    .unwrap()
}

#[test]
fn authoring_project_is_source_and_fields_are_escaped_once() {
    let row = template_row(json!([
        {"type":"text","tagName":"h1","content":"{{quotation.reference}}"},
        {"type":"text","tagName":"p","content":"<strong>{{customer.name}}</strong>"},
        {"type":"text","tagName":"p","content":"{{quotation.notes}}"},
        {"type":"text","tagName":"p","content":"{{quotation.line_items}}"},
        {"type":"text","tagName":"p","content":"Total: {{quotation.currency}} {{quotation.total}}"}
    ]));
    let template = read_template(&row, 7, 3).unwrap();
    let mut data = data();
    data.notes = "Literal {{customer.email}}".into();
    let html = render_quotation_html(&template, &data, None).unwrap();
    assert!(html.contains("<h1>Q/2026/9</h1>"));
    assert!(html.contains("Buyer &lt;script&gt;alert(1)&lt;/script&gt;"));
    assert!(html.contains("Literal {{customer.email}}"));
    assert!(!html.contains("separately edited cache"));
    assert!(html.contains("EUR 144.30"));
    assert!(html.find("Service 1").unwrap() < html.find("Service 2").unwrap());
    assert!(!html.contains("<p><table"));
    assert!(html.contains("table-header-group"));
    assert!(html.contains("counter(pages)"));
    assert!(html.contains("default-src 'none'"));
}

#[test]
fn active_rte_text_nodes_can_hold_standalone_table_and_logo_fields() {
    let row = template_row(json!([
        {"type":"text","tagName":"p","components":[{"type":"textnode","content":"{{quotation.line_items}}"}]},
        {"type":"text","tagName":"p","components":[{"type":"textnode","content":"{{company.logo}}"}]}
    ]));
    let template = read_template(&row, 7, 3).unwrap();
    let html =
        render_quotation_html(&template, &data(), Some("data:image/png;base64,cG5n")).unwrap();
    assert!(html.contains("<table class=\"quotation-lines\">"));
    assert!(html.contains("<img class=\"quotation-logo\""));
    assert!(!html.contains("{{quotation.line_items}}"));
    assert!(!html.contains("<p><img"));
}

#[test]
fn only_explicit_fields_are_bound_and_line_items_cannot_be_embedded_in_prose() {
    for content in [
        "{{unknown.secret}}",
        "{{customer.name",
        "Hello {{quotation.line_items}}",
        "{{system('rm')}}",
    ] {
        let template = read_template(
            &template_row(json!([{"type":"text","tagName":"p","content":content}])),
            7,
            3,
        )
        .unwrap();
        assert!(
            render_quotation_html(&template, &data(), None).is_err(),
            "{content}"
        );
    }
}

#[test]
fn standalone_notes_and_terms_keep_tiptap_markdown_with_html_as_text() {
    let template = read_template(
        &template_row(json!([
            {"type":"text","tagName":"p","content":"{{quotation.notes}}"},
            {"type":"text","tagName":"p","content":"{{quotation.terms}}"}
        ])),
        7,
        3,
    )
    .unwrap();
    let mut data = data();
    data.notes = "## Deliverables\n\n- **Design**\n- Build\n\nLiteral {{customer.name}}\n\n<script>alert(1)</script>".into();
    data.terms = "| Term | Value |\n| --- | --- |\n| Payment | 30 days |".into();
    let html = render_quotation_html(&template, &data, None).unwrap();
    assert!(html.contains("<h2>Deliverables</h2>"));
    assert!(html.contains("<strong>Design</strong>"));
    assert!(html.contains("Literal {{customer.name}}"));
    assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert!(!html.contains("<script>"));
    assert!(html.contains("<th>Term</th>"));
    assert!(!html.contains("<p><h2>"));
}

#[test]
fn parser_removes_executable_html_and_unbounded_css_without_losing_supported_formatting() {
    let row = template_row(json!([
        {"type":"text","tagName":"p","content":"<b>Hello</b><script>alert(1)</script><img src='https://remote.invalid/x'><svg><a onload='x'>bad</a></svg><span style='color:#123456;background-image:URL(https://remote.invalid);position:fixed'>Safe</span>",
         "style":{"color":"#0f766e","background-image":"url(https://remote.invalid)","position":"fixed"},
         "attributes":{"onclick":"alert(1)","src":"https://remote.invalid"}}
    ]));
    let html = render_quotation_html(&read_template(&row, 7, 3).unwrap(), &data(), None).unwrap();
    assert!(html.contains("<b>Hello</b>"));
    assert!(html.contains("color:#123456"));
    assert!(html.contains("color:#0f766e"));
    for blocked in [
        "<script",
        "<svg",
        "onload",
        "onclick",
        "https://remote.invalid",
        "position:fixed",
    ] {
        assert!(!html.contains(blocked), "{blocked}");
    }
}

#[test]
fn template_scope_version_and_project_behaviors_fail_closed() {
    let original = template_row(json!([]));
    for (key, value) in [
        ("organization_id", json!(8)),
        ("company_id", json!(4)),
        ("is_active", json!(false)),
        ("report_type", json!("lumiere-rich-text-template-v1")),
    ] {
        let mut row = original.clone();
        row[key] = value;
        assert!(read_template(&row, 7, 3).is_err());
    }
    for change in ["version", "script", "asset", "pages", "type", "deep"] {
        let mut metadata: Value =
            serde_json::from_str(original["metadata"].as_str().unwrap()).unwrap();
        let designer = &mut metadata["documentDesigner"];
        match change {
            "version" => designer["schemaVersion"] = json!(2),
            "script" => {
                designer["project"]["pages"][0]["frames"][0]["component"]["script"] =
                    json!("alert(1)")
            }
            "asset" => designer["project"]["assets"] = json!(["https://remote.invalid"]),
            "pages" => designer["project"]["pages"] = json!([]),
            "type" => {
                designer["project"]["pages"][0]["frames"][0]["component"]["components"] =
                    json!([{"type":"custom-widget"}])
            }
            _ => {
                let mut child = json!({"type":"text","content":"deep"});
                for _ in 0..34 {
                    child = json!({"type":"default","components":[child]});
                }
                designer["project"]["pages"][0]["frames"][0]["component"]["components"] =
                    json!([child]);
            }
        }
        let mut row = original.clone();
        row["metadata"] = json!(metadata.to_string());
        assert!(read_template(&row, 7, 3).is_err(), "{change}");
    }
    let mut global = original.clone();
    global["company_id"] = Value::Null;
    assert!(read_template(&global, 7, 3).is_ok());
    global.as_object_mut().unwrap().remove("company_id");
    assert!(read_template(&global, 7, 3).is_err());
}

#[test]
fn absent_money_or_line_items_is_an_error_never_an_invented_zero() {
    let mut order = order();
    order.as_object_mut().unwrap().remove("amount_total");
    assert!(project_quotation(
        &order,
        &[line(1), line(2)],
        &company(),
        &customer(),
        &currency(),
        7,
        3
    )
    .is_err());
    assert!(project_quotation(
        &super::tests::order(),
        &[line(1)],
        &company(),
        &customer(),
        &currency(),
        7,
        3
    )
    .is_err());
    let mut line2 = line(2);
    line2["company_id"] = json!(4);
    assert!(project_quotation(
        &super::tests::order(),
        &[line(1), line2],
        &company(),
        &customer(),
        &currency(),
        7,
        3
    )
    .is_err());
    let mut unsequenced = line(2);
    unsequenced.as_object_mut().unwrap().remove("sequence");
    assert!(project_quotation(
        &super::tests::order(),
        &[line(1), unsequenced],
        &company(),
        &customer(),
        &currency(),
        7,
        3
    )
    .is_err());
    let mut denied = customer();
    denied.as_object_mut().unwrap().remove("email");
    assert!(project_quotation(
        &super::tests::order(),
        &[line(1), line(2)],
        &company(),
        &denied,
        &currency(),
        7,
        3
    )
    .is_err());
}

#[test]
fn accepted_cancelled_or_foreign_quotations_do_not_generate_new_live_output() {
    for state in ["Sale", "Done", "Cancel"] {
        let mut row = order();
        row["state"] = json!(state);
        assert!(project_quotation(
            &row,
            &[line(1), line(2)],
            &company(),
            &customer(),
            &currency(),
            7,
            3
        )
        .is_err());
    }
    let mut foreign = customer();
    foreign["company_id"] = json!(4);
    assert!(project_quotation(
        &order(),
        &[line(1), line(2)],
        &company(),
        &foreign,
        &currency(),
        7,
        3
    )
    .is_err());
}

#[test]
fn revision_captures_template_and_source_changes_and_css_footer_escapes_closing_tags() {
    let template = read_template(
        &template_row(json!([{"type":"text","tagName":"p","content":"{{quotation.total}}"}])),
        7,
        3,
    )
    .unwrap();
    let mut data = data();
    let html = render_quotation_html(&template, &data, None).unwrap();
    let original = quotation_revision(&template, &data, &html).unwrap();
    data.total = "200.00".into();
    let revised = render_quotation_html(&template, &data, None).unwrap();
    assert_ne!(
        original,
        quotation_revision(&template, &data, &revised).unwrap()
    );
    data.company_name = "Seller </style><script>bad</script>".into();
    let html = render_quotation_html(&template, &data, None).unwrap();
    assert!(!html.contains("</style><script>"));
    assert!(html.contains("\\3c /style>"));
}

#[test]
fn long_quotation_fixture_retains_all_rows_for_chromium_pagination_acceptance() {
    let mut order = order();
    order["order_line"] = json!((1..=120).collect::<Vec<_>>());
    let rows = (1..=120).map(line).collect::<Vec<_>>();
    let data =
        project_quotation(&order, &rows, &company(), &customer(), &currency(), 7, 3).unwrap();
    let template=read_template(&template_row(json!([
        {"type":"text","tagName":"h1","content":"{{quotation.reference}}"},
        {"type":"text","tagName":"p","content":"{{quotation.line_items}}"},
        {"type":"text","tagName":"p","content":"TOTAL {{quotation.currency}} {{quotation.total}}"}
    ])),7,3).unwrap();
    let html = render_quotation_html(&template, &data, None).unwrap();
    assert_eq!(html.matches("<td>Service ").count(), 120);
    assert!(html.contains("Service 120"));
    // Optional artifact for the repository's existing Chromium structural check.
    if let Ok(path) = std::env::var("LUMIERE_QUOTATION_HTML_FIXTURE") {
        std::fs::write(path, html).unwrap();
    }
}
