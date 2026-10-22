//! Validated GrapesJS quotation layouts and an allowlisted ERP data projection.
//!
//! Only the saved project is compiled. The cached `body_html` is never trusted,
//! merge fields are text (not expressions), and the only image is a pinned,
//! company-authorized raster supplied by the managed blob reader.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::invoice::{escape, row_u64};
use crate::error::ApiError;

const MAX_PROJECT_BYTES: usize = 1_000_000;
const MAX_COMPONENTS: usize = 2_000;
const MAX_DEPTH: usize = 32;
const LINE_ITEMS_MARKER: &str = "<!--lumiere-quotation-lines-v1-->";
const LOGO_MARKER: &str = "<!--lumiere-quotation-logo-v1-->";
const NOTES_MARKER: &str = "<!--lumiere-quotation-notes-v1-->";
const TERMS_MARKER: &str = "<!--lumiere-quotation-terms-v1-->";
const TAGS: &[&str] = &[
    "p",
    "h1",
    "h2",
    "h3",
    "strong",
    "b",
    "em",
    "i",
    "s",
    "strike",
    "del",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "hr",
    "br",
    "a",
    "span",
    "div",
    "section",
    "header",
    "footer",
];
const COMPONENT_TYPES: &[&str] = &[
    "", "default", "wrapper", "text", "textnode", "link", "table", "thead", "tbody", "tfoot",
    "row", "cell",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Designer {
    schema_version: u32,
    engine: String,
    kind: String,
    project: Project,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Project {
    #[serde(default)]
    assets: Vec<Value>,
    #[serde(default)]
    styles: Vec<Value>,
    #[serde(default)]
    symbols: Vec<Value>,
    #[serde(default)]
    data_sources: Vec<Value>,
    pages: Vec<Page>,
}

#[derive(Debug, Deserialize)]
struct Page {
    frames: Vec<Frame>,
}

#[derive(Debug, Deserialize)]
struct Frame {
    component: Component,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Component {
    #[serde(default, rename = "type")]
    kind: String,
    tag_name: Option<String>,
    #[serde(default)]
    content: String,
    #[serde(default)]
    components: Vec<Component>,
    #[serde(default)]
    attributes: BTreeMap<String, String>,
    #[serde(default)]
    style: BTreeMap<String, String>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Branding {
    schema_version: u32,
    logo_url: String,
}

/// A company-scoped, active layout, compiled from its authoring source.
pub(crate) struct QuotationTemplate {
    pub id: u64,
    pub name: String,
    pub version: String,
    pub logo_url: Option<String>,
    pub snapshot: Value,
    fragment: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuotationLine {
    pub id: String,
    pub description: String,
    pub display_type: String,
    pub quantity: String,
    pub unit_price: String,
    pub discount: String,
    pub subtotal: String,
}

/// Explicit fields captured in every generated document's immutable provenance.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuotationData {
    pub order_id: String,
    pub organization_id: String,
    pub company_id: String,
    pub partner_id: String,
    pub reference: String,
    pub state: String,
    pub source_write_date: Value,
    pub company_name: String,
    pub company_address: String,
    pub company_tax_id: String,
    pub customer_name: String,
    pub customer_address: String,
    pub customer_email: String,
    pub date: String,
    pub valid_until: String,
    pub currency: String,
    pub subtotal: String,
    pub tax: String,
    pub total: String,
    pub notes: String,
    pub terms: String,
    pub lines: Vec<QuotationLine>,
}

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError::Unprocessable(message.into())
}

pub(crate) fn cell<'a>(row: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let value = keys.iter().find_map(|key| row.get(*key))?;
    if let Some(some) = value.get("some") {
        return Some(some);
    }
    if value.get("none").is_some() || value.is_null() {
        return None;
    }
    Some(value)
}

fn required_cell<'a>(row: &'a Value, keys: &[&str]) -> Result<&'a Value, ApiError> {
    cell(row, keys).ok_or_else(|| invalid(format!("quotation field {} is unavailable", keys[0])))
}

fn text(row: &Value, keys: &[&str]) -> Result<String, ApiError> {
    if !keys.iter().any(|key| row.get(*key).is_some()) {
        return Err(invalid(format!(
            "quotation field {} is unavailable",
            keys[0]
        )));
    }
    let value = match cell(row, keys) {
        None => String::new(),
        Some(Value::String(value)) => value.clone(),
        Some(_) => return Err(invalid(format!("quotation field {} is not text", keys[0]))),
    };
    if value.len() > 32_000
        || value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(invalid(format!(
            "quotation field {} is oversized or malformed",
            keys[0]
        )));
    }
    Ok(value)
}

fn number(row: &Value, keys: &[&str]) -> Result<f64, ApiError> {
    let value = required_cell(row, keys)?;
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|value| value.is_finite())
        .ok_or_else(|| invalid(format!("quotation amount {} is unavailable", keys[0])))
}

fn date(row: &Value, keys: &[&str], optional: bool) -> Result<String, ApiError> {
    if !keys.iter().any(|key| row.get(*key).is_some()) {
        return Err(invalid(format!(
            "quotation field {} is unavailable",
            keys[0]
        )));
    }
    let Some(value) = cell(row, keys) else {
        return if optional {
            Ok(String::new())
        } else {
            Err(invalid("quotation date is unavailable"))
        };
    };
    if let Some(value) = value.as_str() {
        if let Ok(date) = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d") {
            return Ok(date.to_string());
        }
        if let Ok(date) = DateTime::parse_from_rfc3339(value) {
            return Ok(date.date_naive().to_string());
        }
    }
    let micros = [
        "microsSinceUnixEpoch",
        "micros_since_unix_epoch",
        "__timestamp_micros_since_unix_epoch__",
    ]
    .iter()
    .find_map(|key| value.get(*key))
    .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()));
    micros
        .and_then(DateTime::<Utc>::from_timestamp_micros)
        .map(|value| value.date_naive().to_string())
        .ok_or_else(|| invalid("quotation date is malformed"))
}

pub(crate) fn exact_company(row: &Value, org: u64, company: u64) -> bool {
    row_u64(row, &["organizationId", "organization_id"]) == Some(org)
        && row_u64(row, &["companyId", "company_id"]) == Some(company)
}

pub(crate) fn company_or_global(row: &Value, org: u64, company: u64) -> bool {
    if row_u64(row, &["organizationId", "organization_id"]) != Some(org) {
        return false;
    }
    let present = ["companyId", "company_id"]
        .iter()
        .any(|key| row.get(*key).is_some());
    present
        && (cell(row, &["companyId", "company_id"]).is_none()
            || row_u64(row, &["companyId", "company_id"]) == Some(company))
}

/// Compile a saved layout without executing HTML, CSS, scripts, or arbitrary expressions.
pub(crate) fn read_template(
    row: &Value,
    org: u64,
    company: u64,
) -> Result<QuotationTemplate, ApiError> {
    if !company_or_global(row, org, company)
        || cell(row, &["isActive", "is_active"]).and_then(Value::as_bool) != Some(true)
        || cell(row, &["reportType", "report_type"]).and_then(Value::as_str)
            != Some("lumiere-document-layout-v1")
    {
        return Err(invalid(
            "an active document layout from this company is required",
        ));
    }
    let raw = required_cell(row, &["metadata"])?
        .as_str()
        .filter(|value| value.len() <= MAX_PROJECT_BYTES)
        .ok_or_else(|| invalid("template metadata is unavailable or oversized"))?;
    let metadata: Value =
        serde_json::from_str(raw).map_err(|_| invalid("template metadata is malformed"))?;
    let designer: Designer = serde_json::from_value(
        metadata
            .get("documentDesigner")
            .cloned()
            .unwrap_or(Value::Null),
    )
    .map_err(|_| invalid("template project is malformed or unsupported"))?;
    if designer.schema_version != 1
        || designer.engine != "grapesjs"
        || designer.kind != "document"
        || !designer.project.assets.is_empty()
        || !designer.project.styles.is_empty()
        || !designer.project.symbols.is_empty()
        || !designer.project.data_sources.is_empty()
        || designer.project.pages.len() != 1
        || designer.project.pages[0].frames.len() != 1
        || designer.project.pages[0].frames[0].component.kind != "wrapper"
    {
        return Err(invalid(
            "template must use one supported document canvas without external assets or scripts",
        ));
    }
    let mut count = 0;
    let fragment = compile_component(
        &designer.project.pages[0].frames[0].component,
        0,
        &mut count,
    )?;
    let logo_url = match metadata.get("documentBranding") {
        None => None,
        Some(value) => {
            let branding: Branding = serde_json::from_value(value.clone())
                .map_err(|_| invalid("document branding is malformed"))?;
            if branding.schema_version != 1 || branding.logo_url.len() > 1024 {
                return Err(invalid("document branding version is unsupported"));
            }
            (!branding.logo_url.is_empty()).then_some(branding.logo_url)
        }
    };
    Ok(QuotationTemplate {
        id: row_u64(row, &["id"])
            .filter(|id| *id > 0)
            .ok_or_else(|| invalid("template id is unavailable"))?,
        name: text(row, &["name"])?,
        version: hex::encode(Sha256::digest(raw.as_bytes())),
        logo_url,
        snapshot: serde_json::json!({
            "documentDesigner": metadata["documentDesigner"],
            "documentBranding": metadata.get("documentBranding"),
        }),
        fragment,
    })
}

fn compile_component(
    node: &Component,
    depth: usize,
    count: &mut usize,
) -> Result<String, ApiError> {
    *count += 1;
    if *count > MAX_COMPONENTS
        || depth > MAX_DEPTH
        || !COMPONENT_TYPES.contains(&node.kind.as_str())
        || node
            .extra
            .keys()
            .any(|key| matches!(key.as_str(), "script" | "script-export" | "script-props"))
    {
        return Err(invalid(
            "template contains unsupported or excessive components",
        ));
    }
    if node.kind == "textnode" {
        if !node.components.is_empty() {
            return Err(invalid("text nodes cannot contain components"));
        }
        return Ok(escape(&node.content));
    }
    let default_tag = match node.kind.as_str() {
        "link" => "a",
        "table" => "table",
        "thead" => "thead",
        "tbody" => "tbody",
        "tfoot" => "tfoot",
        "row" => "tr",
        "cell" => "td",
        _ => "div",
    };
    let tag = node.tag_name.as_deref().unwrap_or(default_tag);
    if !TAGS.contains(&tag) || (node.kind == "wrapper" && depth != 0) {
        return Err(invalid(
            "template contains an unsupported tag or nested wrapper",
        ));
    }
    let mut children = sanitize_fragment(&node.content);
    for child in &node.components {
        children.push_str(&compile_component(child, depth + 1, count)?);
    }
    if matches!(tag, "p" | "div" | "section" | "span") {
        match children.trim() {
            "{{quotation.line_items}}" | LINE_ITEMS_MARKER => return Ok(LINE_ITEMS_MARKER.into()),
            "{{company.logo}}" | LOGO_MARKER => return Ok(LOGO_MARKER.into()),
            "{{quotation.notes}}" | NOTES_MARKER => return Ok(NOTES_MARKER.into()),
            "{{quotation.terms}}" | TERMS_MARKER => return Ok(TERMS_MARKER.into()),
            _ => {}
        }
    }
    let mut attributes = String::new();
    for (key, value) in &node.attributes {
        let allowed = match key.as_str() {
            "title" => value.len() <= 500,
            "colspan" | "rowspan" => value
                .parse::<u8>()
                .is_ok_and(|number| (1..=99).contains(&number)),
            "start" => value.len() <= 6 && value.bytes().all(|byte| byte.is_ascii_digit()),
            "href" => tag == "a" && safe_href(value),
            _ => false,
        };
        if allowed {
            attributes.push_str(&format!(" {key}=\"{}\"", escape(value)));
        }
    }
    let style = node
        .style
        .iter()
        .filter(|(key, value)| safe_style(key, value))
        .map(|(key, value)| format!("{key}:{}", value.trim()))
        .collect::<Vec<_>>()
        .join(";");
    if !style.is_empty() {
        attributes.push_str(&format!(" style=\"{}\"", escape(&style)));
    }
    if node.kind == "wrapper" {
        attributes.push_str(" class=\"quotation-canvas\"");
    }
    if matches!(tag, "br" | "hr") {
        return Ok(format!("<{tag}{attributes}>"));
    }
    Ok(format!("<{tag}{attributes}>{children}</{tag}>"))
}

fn safe_href(value: &str) -> bool {
    !value.chars().any(|c| c.is_control() || c.is_whitespace())
        && ["https://", "http://", "mailto:", "tel:", "#"]
            .iter()
            .any(|prefix| value.to_ascii_lowercase().starts_with(prefix))
}

fn css_length(value: &str) -> bool {
    if value == "0" {
        return true;
    }
    ["px", "pt", "em", "rem", "%", "mm", "cm"]
        .iter()
        .any(|suffix| {
            value.strip_suffix(suffix).is_some_and(|number| {
                !number.is_empty()
                    && number.len() <= 7
                    && number
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || byte == b'.')
                    && number
                        .parse::<f64>()
                        .is_ok_and(|number| (0.0..=9999.99).contains(&number))
            })
        })
}

fn css_color(value: &str) -> bool {
    if let Some(hex) = value.strip_prefix('#') {
        return [3, 4, 6, 8].contains(&hex.len())
            && hex.bytes().all(|byte| byte.is_ascii_hexdigit());
    }
    [
        "transparent",
        "black",
        "white",
        "gray",
        "grey",
        "red",
        "green",
        "blue",
        "navy",
        "inherit",
    ]
    .contains(&value)
}

fn safe_style(property: &str, raw: &str) -> bool {
    let value = raw.trim();
    if value.len() > 120 || value.contains(['(', ')', '\\', '<', '>', '@', ';', '"', '\'']) {
        return false;
    }
    match property {
        "color" | "background-color" | "border-color" => css_color(value),
        "width" | "min-width" | "max-width" | "height" | "min-height" | "max-height"
        | "border-width" | "border-spacing" => value == "auto" || css_length(value),
        "font-size" => css_length(value),
        "padding" | "padding-top" | "padding-right" | "padding-bottom" | "padding-left"
        | "margin" | "margin-top" | "margin-right" | "margin-bottom" | "margin-left" => {
            let parts = value.split_whitespace().collect::<Vec<_>>();
            !parts.is_empty()
                && parts.len() <= 4
                && parts.iter().all(|part| {
                    css_length(part) || (property.starts_with("margin") && *part == "auto")
                })
        }
        "border" | "border-top" | "border-right" | "border-bottom" | "border-left" => {
            if matches!(value, "0" | "none") {
                return true;
            }
            let parts = value.split_whitespace().collect::<Vec<_>>();
            parts.len() == 3
                && css_length(parts[0])
                && ["solid", "dashed", "dotted"].contains(&parts[1])
                && css_color(parts[2])
        }
        "font-family" => [
            "Arial",
            "Georgia",
            "Verdana",
            "Times New Roman",
            "sans-serif",
            "serif",
            "monospace",
            "Arial, sans-serif",
            "Georgia, serif",
            "Verdana, sans-serif",
            "Times New Roman, serif",
        ]
        .contains(&value),
        "font-weight" => [
            "normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900",
        ]
        .contains(&value),
        "line-height" => {
            value == "normal"
                || css_length(value)
                || value
                    .parse::<f64>()
                    .is_ok_and(|number| (0.0..=3.0).contains(&number))
        }
        "text-align" => ["left", "center", "right", "justify"].contains(&value),
        "vertical-align" => ["top", "middle", "bottom", "baseline"].contains(&value),
        "border-collapse" => ["collapse", "separate"].contains(&value),
        "border-style" => ["none", "solid", "dashed", "dotted"].contains(&value),
        "display" => [
            "block",
            "inline",
            "inline-block",
            "table",
            "table-row",
            "table-cell",
        ]
        .contains(&value),
        _ => false,
    }
}

fn sanitize_fragment(html: &str) -> String {
    let attributes = HashMap::from([
        ("a", HashSet::from(["href", "title"])),
        ("td", HashSet::from(["colspan", "rowspan"])),
        ("th", HashSet::from(["colspan", "rowspan"])),
        ("ol", HashSet::from(["start"])),
    ]);
    ammonia::Builder::default()
        .tags(TAGS.iter().copied().collect())
        .tag_attributes(attributes)
        .generic_attributes(HashSet::from(["style"]))
        .url_schemes(HashSet::from(["http", "https", "mailto", "tel"]))
        .url_relative(ammonia::UrlRelative::Deny)
        .attribute_filter(|_, attribute, value| {
            if attribute != "style" {
                return Some(value.into());
            }
            let cleaned = value
                .split(';')
                .filter_map(|declaration| {
                    let (property, value) = declaration.split_once(':')?;
                    safe_style(property.trim(), value.trim())
                        .then(|| format!("{}:{}", property.trim(), value.trim()))
                })
                .collect::<Vec<_>>()
                .join(";");
            (!cleaned.is_empty()).then(|| cleaned.into())
        })
        .clean(html)
        .to_string()
}

/// Read only the fields the caller was authorized to query; missing amounts fail closed.
#[allow(clippy::too_many_arguments)]
pub(crate) fn project_quotation(
    order: &Value,
    lines: &[Value],
    company: &Value,
    customer: &Value,
    currency: &Value,
    org: u64,
    company_id: u64,
) -> Result<QuotationData, ApiError> {
    if !exact_company(order, org, company_id)
        || row_u64(company, &["organizationId", "organization_id"]) != Some(org)
        || row_u64(company, &["id"]) != Some(company_id)
        || !company_or_global(customer, org, company_id)
        || row_u64(customer, &["id"]) != row_u64(order, &["partnerId", "partner_id"])
        || row_u64(currency, &["organizationId", "organization_id"]) != Some(org)
        || row_u64(currency, &["id"]) != row_u64(order, &["currencyId", "currency_id"])
    {
        return Err(invalid(
            "quotation source scope does not match the authorized company",
        ));
    }
    let order_id = row_u64(order, &["id"])
        .filter(|id| *id > 0)
        .ok_or_else(|| invalid("quotation id is unavailable"))?;
    let state = required_cell(order, &["state"])?;
    let state = state
        .as_str()
        .or_else(|| state.get("tag")?.as_str())
        .map(str::to_string)
        .or_else(|| {
            state
                .as_object()
                .filter(|value| value.len() == 1)?
                .keys()
                .next()
                .cloned()
        })
        .ok_or_else(|| invalid("quotation state is unavailable"))?;
    if !["draft", "sent", "toapprove", "to_approve"].contains(&state.to_ascii_lowercase().as_str())
    {
        return Err(invalid(
            "only an open quotation can generate a new quotation document",
        ));
    }
    let order_lines = required_cell(order, &["orderLine", "order_line"])?
        .as_array()
        .ok_or_else(|| invalid("quotation line references are unavailable"))?;
    let expected_ids = order_lines
        .iter()
        .map(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str()?.parse().ok())
                .filter(|id| *id > 0)
                .ok_or_else(|| invalid("quotation line reference is malformed"))
        })
        .collect::<Result<HashSet<_>, _>>()?;
    if expected_ids.len() != order_lines.len() {
        return Err(invalid("quotation contains duplicate line references"));
    }
    if expected_ids.len() > 1_000 {
        return Err(invalid("quotation exceeds the 1000 line limit"));
    }
    let mut selected = lines
        .iter()
        .filter(|line| row_u64(line, &["orderId", "order_id"]) == Some(order_id))
        .collect::<Vec<_>>();
    let actual_ids = selected
        .iter()
        .filter_map(|line| row_u64(line, &["id"]))
        .collect::<HashSet<_>>();
    if actual_ids != expected_ids
        || actual_ids.len() != selected.len()
        || selected
            .iter()
            .any(|line| !exact_company(line, org, company_id))
    {
        return Err(invalid(
            "quotation line items are incomplete or outside the authorized company",
        ));
    }
    if selected
        .iter()
        .any(|line| row_u64(line, &["sequence"]).is_none())
    {
        return Err(invalid("quotation line sequence is unavailable"));
    }
    selected.sort_by_key(|line| {
        (
            row_u64(line, &["sequence"]).unwrap_or(0),
            row_u64(line, &["id"]).unwrap_or(0),
        )
    });
    let decimals = row_u64(currency, &["decimalPlaces", "decimal_places"])
        .filter(|value| *value <= 6)
        .ok_or_else(|| invalid("currency decimal places are unavailable"))?
        as usize;
    let code = text(currency, &["code"])?;
    if code.len() != 3 || !code.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return Err(invalid("currency code is malformed"));
    }
    let money = |value: f64| format!("{value:.decimals$}");
    let lines = selected
        .into_iter()
        .map(|line| {
            let display_type = text(line, &["displayType", "display_type"])?;
            if !["", "line_section", "line_note"].contains(&display_type.as_str()) {
                return Err(invalid("quotation line kind is unsupported"));
            }
            let financial = display_type.is_empty();
            Ok(QuotationLine {
                id: row_u64(line, &["id"])
                    .ok_or_else(|| invalid("line id unavailable"))?
                    .to_string(),
                description: text(line, &["name"])?,
                display_type,
                quantity: if financial {
                    number(line, &["productUomQty", "product_uom_qty"])?.to_string()
                } else {
                    String::new()
                },
                unit_price: if financial {
                    money(number(line, &["priceUnit", "price_unit"])?)
                } else {
                    String::new()
                },
                discount: if financial {
                    format!("{}%", number(line, &["discount"])?)
                } else {
                    String::new()
                },
                subtotal: if financial {
                    money(number(line, &["priceSubtotal", "price_subtotal"])?)
                } else {
                    String::new()
                },
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let address = |row: &Value, keys: &[&[&str]]| -> Result<String, ApiError> {
        Ok(keys
            .iter()
            .map(|keys| text(row, keys))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"))
    };
    let reference = ["reference", "origin", "clientOrderRef", "client_order_ref"]
        .into_iter()
        .find_map(|key| {
            cell(order, &[key])
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
        })
        .map(str::to_string)
        .unwrap_or_else(|| format!("Quotation {order_id}"));
    let company_name = text(company, &["name"])?;
    let customer_name = text(customer, &["name"])?;
    if company_name.trim().is_empty() || customer_name.trim().is_empty() {
        return Err(invalid("quotation seller and customer names are required"));
    }
    Ok(QuotationData {
        order_id: order_id.to_string(),
        organization_id: org.to_string(),
        company_id: company_id.to_string(),
        partner_id: row_u64(customer, &["id"])
            .ok_or_else(|| invalid("customer id unavailable"))?
            .to_string(),
        reference,
        state,
        source_write_date: required_cell(order, &["writeDate", "write_date"])?.clone(),
        company_name,
        company_address: address(
            company,
            &[
                &["addressStreet", "address_street"],
                &["addressCity", "address_city"],
                &["addressZip", "address_zip"],
                &["addressCountryCode", "address_country_code"],
            ],
        )?,
        company_tax_id: text(company, &["taxId", "tax_id"])?,
        customer_name,
        customer_address: address(
            customer,
            &[
                &["street"],
                &["street2", "street_2"],
                &["city"],
                &["zip"],
                &["countryCode", "country_code"],
            ],
        )?,
        customer_email: text(customer, &["email"])?,
        date: date(order, &["dateOrder", "date_order"], false)?,
        valid_until: date(order, &["validityDate", "validity_date"], true)?,
        currency: code,
        subtotal: money(number(order, &["amountUntaxed", "amount_untaxed"])?),
        tax: money(number(order, &["amountTax", "amount_tax"])?),
        total: money(number(order, &["amountTotal", "amount_total"])?),
        notes: text(order, &["note"])?,
        terms: text(order, &["termsAndConditions", "terms_and_conditions"])?,
        lines,
    })
}

impl QuotationData {
    fn field(&self, token: &str) -> Option<&str> {
        Some(match token {
            "company.name" => &self.company_name,
            "company.address" => &self.company_address,
            "company.tax_id" => &self.company_tax_id,
            "customer.name" => &self.customer_name,
            "customer.address" => &self.customer_address,
            "customer.email" => &self.customer_email,
            "quotation.reference" => &self.reference,
            "quotation.date" => &self.date,
            "quotation.valid_until" => &self.valid_until,
            "quotation.currency" => &self.currency,
            "quotation.subtotal" => &self.subtotal,
            "quotation.tax" => &self.tax,
            "quotation.total" => &self.total,
            "quotation.notes" => &self.notes,
            "quotation.terms" => &self.terms,
            _ => return None,
        })
    }
}

fn bind_fields(fragment: &str, data: &QuotationData) -> Result<String, ApiError> {
    let mut remaining = fragment;
    let mut output = String::with_capacity(fragment.len());
    while let Some(start) = remaining.find("{{") {
        output.push_str(&remaining[..start]);
        let after = &remaining[start + 2..];
        let end = after
            .find("}}")
            .ok_or_else(|| invalid("quotation field is missing closing braces"))?;
        let token = after[..end].trim();
        let value = data.field(token).ok_or_else(|| invalid(format!("unsupported quotation field {{{{{token}}}}}; line items and logo must occupy their own paragraph")))?;
        output.push_str(&escape(value));
        remaining = &after[end + 2..];
    }
    output.push_str(remaining);
    Ok(output)
}

fn render_lines(data: &QuotationData) -> String {
    let rows = data.lines.iter().map(|line| {
        if !line.display_type.is_empty() {
            return format!("<tr class=\"{}\"><td colspan=\"5\">{}</td></tr>", line.display_type, escape(&line.description));
        }
        format!("<tr><td>{}</td><td class=\"number\">{}</td><td class=\"number\">{}</td><td class=\"number\">{}</td><td class=\"number\">{}</td></tr>",
            escape(&line.description), escape(&line.quantity), escape(&line.unit_price), escape(&line.discount), escape(&line.subtotal))
    }).collect::<String>();
    format!("<table class=\"quotation-lines\"><thead><tr><th>Description</th><th>Quantity</th><th>Unit price ({})</th><th>Discount</th><th>Subtotal ({})</th></tr></thead><tbody>{rows}</tbody></table>", escape(&data.currency), escape(&data.currency))
}

fn render_markdown(value: &str) -> String {
    let options =
        pulldown_cmark::Options::ENABLE_TABLES | pulldown_cmark::Options::ENABLE_STRIKETHROUGH;
    // Raw HTML in a text field stays visible text. It never becomes a second
    // route for loading images, styles or script into a document template.
    let parser = pulldown_cmark::Parser::new_ext(value, options).map(|event| match event {
        pulldown_cmark::Event::Html(value) | pulldown_cmark::Event::InlineHtml(value) => {
            pulldown_cmark::Event::Text(value)
        }
        other => other,
    });
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, parser);
    sanitize_fragment(&html)
}

/// Produce a self-contained preview/print document, including print-only pagination rules.
pub(crate) fn render_quotation_html(
    template: &QuotationTemplate,
    data: &QuotationData,
    logo_uri: Option<&str>,
) -> Result<String, ApiError> {
    let fragment = bind_fields(&template.fragment, data)?;
    let logo = logo_uri
        .map(|uri| {
            format!(
                "<img class=\"quotation-logo\" alt=\"{}\" src=\"{}\">",
                escape(&data.company_name),
                escape(uri)
            )
        })
        .unwrap_or_default();
    let fragment = fragment
        .replace(LINE_ITEMS_MARKER, &render_lines(data))
        .replace(LOGO_MARKER, &logo)
        .replace(NOTES_MARKER, &render_markdown(&data.notes))
        .replace(TERMS_MARKER, &render_markdown(&data.terms));
    let footer = format!("{} · {}", data.company_name, data.reference);
    Ok(format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'"><title>{}</title><style>
@page {{ size:A4; margin:16mm 12mm 18mm; @bottom-left {{ content:"{}"; font:9px Arial,sans-serif; color:#64748b; }} @bottom-right {{ content:"Page " counter(page) " of " counter(pages); font:9px Arial,sans-serif; color:#64748b; }} }}
*{{box-sizing:border-box}}body{{margin:0;color:#1f2937;background:#fff;font:14px/1.6 Arial,sans-serif;overflow-wrap:anywhere}}.quotation-canvas{{padding:24px;max-width:100%}}p{{margin:.5em 0;white-space:pre-wrap}}h1,h2,h3{{line-height:1.3;break-after:avoid}}table{{width:100%;border-collapse:collapse;table-layout:fixed}}th,td{{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}}th{{background:#f3f4f6}}thead{{display:table-header-group}}tfoot{{display:table-footer-group}}tr{{break-inside:avoid;page-break-inside:avoid}}.number{{text-align:right;font-variant-numeric:tabular-nums}}.quotation-lines th:first-child{{width:44%}}.line_section{{font-weight:bold;background:#f8fafc}}.line_note{{font-style:italic}}.quotation-logo{{display:block;max-width:200px;max-height:100px;object-fit:contain;margin-bottom:16px}}blockquote{{border-left:3px solid #d1d5db;margin-left:0;padding-left:16px}}hr{{border:0;border-top:1px solid #d1d5db;margin:16px 0}}pre{{white-space:pre-wrap}}img,table{{max-width:100%}}@media print{{body{{print-color-adjust:exact;-webkit-print-color-adjust:exact}}.quotation-canvas{{height:auto!important;min-height:0!important}}}}
</style></head><body>{fragment}</body></html>"#,
        escape(&data.reference),
        escape_css_string(&footer)
    ))
}

fn escape_css_string(value: &str) -> String {
    value
        .chars()
        .flat_map(|c| match c {
            '\\' => "\\\\".chars().collect::<Vec<_>>(),
            '"' => "\\\"".chars().collect(),
            '<' => "\\3c ".chars().collect(),
            '\n' | '\r' => " ".chars().collect(),
            _ => vec![c],
        })
        .collect()
}

pub(crate) fn quotation_revision(
    template: &QuotationTemplate,
    data: &QuotationData,
    html: &str,
) -> Result<String, ApiError> {
    let bytes = serde_json::to_vec(&(
        "quotation-renderer-v1",
        template.id.to_string(),
        &template.name,
        &template.version,
        data,
        html,
    ))
    .map_err(ApiError::internal)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

#[cfg(test)]
#[path = "quotation_tests.rs"]
mod tests;
