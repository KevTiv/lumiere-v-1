//! Snapshot-backed invoice projection and escaped, paginated HTML for the internal PDF renderer.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;

use crate::error::ApiError;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct InvoiceSnapshot {
    schema_version: u32,
    pub profile_version_ids: ProfileVersionIds,
    pub seller: Seller,
    pub profile: Profile,
    pub notes: String,
    #[serde(default)]
    pub buyer: Option<Buyer>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Buyer {
    pub partner_id: String,
    pub name: String,
    pub address: Vec<String>,
    pub tax_id: String,
    pub registration_number: String,
    pub email: String,
    pub phone: String,
}

fn validate_buyer(buyer: &Buyer, partner_id: Option<u64>) -> Result<(), ApiError> {
    if buyer.partner_id.parse::<u64>().ok().filter(|id| *id > 0) != partner_id
        || partner_id.is_none()
        || partner_id.map(|id| id.to_string()).as_deref() != Some(buyer.partner_id.as_str())
        || buyer.name.trim().is_empty()
    {
        return Err(ApiError::Conflict(
            "invoice buyer identity is malformed".into(),
        ));
    }
    for (key, value, limit) in [
        ("buyer name", &buyer.name, 1024),
        ("buyer tax ID", &buyer.tax_id, 256),
        ("buyer registration", &buyer.registration_number, 256),
        ("buyer email", &buyer.email, 254),
        ("buyer phone", &buyer.phone, 64),
    ] {
        bounded_text(value, key, limit)?;
    }
    if buyer.address.len() > 12 {
        return Err(ApiError::Conflict(
            "invoice buyer address is oversized".into(),
        ));
    }
    for line in &buyer.address {
        bounded_text(line, "buyer address", 2048)?;
    }
    Ok(())
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProfileVersionIds {
    pub organization: Option<String>,
    pub company: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Seller {
    pub name: String,
    pub address: Vec<String>,
    pub tax_id: String,
    pub registration_number: String,
    pub email: String,
    pub phone: String,
    pub website: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Profile {
    pub logo_url: String,
    pub accent: String,
    pub email: String,
    pub phone: String,
    pub website: String,
    pub notice: String,
    pub terms: String,
    pub payment_instructions: String,
    pub footer: String,
}

#[derive(Debug)]
pub(crate) struct InvoiceLine {
    pub description: String,
    pub quantity: Option<f64>,
    pub unit_price: Option<f64>,
    pub discount: Option<f64>,
    pub subtotal: Option<f64>,
}

#[derive(Debug)]
pub(crate) struct InvoiceDocument {
    pub title: &'static str,
    pub reference: String,
    pub customer: Seller,
    pub buyer_available: bool,
    pub seller: Seller,
    pub profile: Profile,
    pub notes: String,
    pub currency: String,
    pub decimal_places: usize,
    pub date: String,
    pub due_date: String,
    pub payment_reference: String,
    pub external_reference: String,
    pub state: String,
    pub lines: Vec<InvoiceLine>,
    pub subtotal: Option<f64>,
    pub tax: Option<f64>,
    pub total: Option<f64>,
    pub residual: Option<f64>,
    pub legacy: bool,
    pub internal_record: bool,
}

const PROFILE_FIELDS: [(&str, usize); 9] = [
    ("logoUrl", 1024),
    ("accent", 16),
    ("email", 254),
    ("phone", 64),
    ("website", 512),
    ("notice", 2000),
    ("terms", 8000),
    ("paymentInstructions", 4000),
    ("footer", 2000),
];
const CONTENT_FIELDS: [&str; 4] = ["notice", "terms", "paymentInstructions", "footer"];

pub(crate) fn needs_draft_profile(mv: &Value) -> bool {
    tag(mv, &["state"]).eq_ignore_ascii_case("draft")
        && matches!(
            tag(mv, &["moveType", "move_type"])
                .to_ascii_lowercase()
                .as_str(),
            "outinvoice" | "outrefund"
        )
}

fn bounded_text(value: &str, key: &str, limit: usize) -> Result<(), ApiError> {
    if value.len() > limit
        || value
            .chars()
            .any(|value| value.is_control() && !matches!(value, '\n' | '\r' | '\t'))
    {
        return Err(ApiError::Conflict(format!(
            "invoice {key} is oversized or contains unsupported control characters"
        )));
    }
    Ok(())
}

fn validate_logo_reference(value: &str, organization_id: u64) -> Result<(), ApiError> {
    if value.is_empty() {
        return Ok(());
    }
    let invalid = || {
        ApiError::Conflict(
            "invoice logo must have a pinned managed blob reference from this organization".into(),
        )
    };
    let (path, hash) = value.split_once("?sha256=").ok_or_else(invalid)?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(invalid());
    }
    let path = path
        .strip_prefix("/api/documents/blobs/object/")
        .ok_or_else(invalid)?;
    let parts = path.split('/').collect::<Vec<_>>();
    if parts.len() != 3
        || parts[0] != organization_id.to_string()
        || parts[1].is_empty()
        || parts[1].len() > 32
        || !parts[1]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        || parts[2].len() != 32
        || !parts[2].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(invalid());
    }
    Ok(())
}

fn overlay_profile_values(
    target: &mut serde_json::Map<String, Value>,
    values: &serde_json::Map<String, Value>,
    organization_id: u64,
    content_only: bool,
) -> Result<(), ApiError> {
    for (key, value) in values {
        let limit = PROFILE_FIELDS
            .iter()
            .find_map(|(field, limit)| (*field == key).then_some(*limit))
            .filter(|_| !content_only || CONTENT_FIELDS.contains(&key.as_str()))
            .ok_or_else(|| {
                ApiError::Conflict(format!("unsupported invoice profile field {key}"))
            })?;
        let value = value
            .as_str()
            .ok_or_else(|| ApiError::Conflict(format!("invoice {key} must be plain text")))?;
        bounded_text(value, key, limit)?;
        if key == "accent" && !matches!(value, "" | "teal" | "blue" | "slate" | "violet") {
            return Err(ApiError::Conflict("unsupported invoice accent".into()));
        }
        if key == "logoUrl" {
            validate_logo_reference(value, organization_id)?;
        }
        target.insert(key.clone(), Value::String(value.to_string()));
    }
    Ok(())
}

/// Draft review follows the latest approved organization/company publications.
/// Issued documents bypass this resolver and use only the stored snapshot.
pub(crate) fn draft_invoice_snapshot(
    mv: &Value,
    organization_id: u64,
    company: Option<&Value>,
    templates: &[Value],
) -> Result<Option<InvoiceSnapshot>, ApiError> {
    if !needs_draft_profile(mv) {
        return document_snapshot(mv);
    }
    // Buyer authority is the trusted draft capture, never a mutable/denied CRM lookup.
    // Issuance refreshes it from the exact canonical contact in the same transaction.
    let captured_buyer = document_snapshot(mv)?.and_then(|snapshot| snapshot.buyer);
    let company_id = row_u64(mv, &["companyId", "company_id"])
        .ok_or_else(|| ApiError::Conflict("draft invoice company is unavailable".into()))?;
    let company = company
        .filter(|row| {
            row_u64(row, &["id"]) == Some(company_id)
                && row_u64(row, &["organizationId", "organization_id"]) == Some(organization_id)
        })
        .ok_or_else(|| ApiError::Conflict("draft invoice seller identity is unavailable".into()))?;
    if text(company, &["name"]).trim().is_empty() {
        return Err(ApiError::Conflict(
            "draft invoice seller name is unavailable".into(),
        ));
    }
    for keys in [
        ["addressStreet", "address_street"],
        ["addressCity", "address_city"],
        ["addressZip", "address_zip"],
        ["addressCountryCode", "address_country_code"],
        ["taxId", "tax_id"],
        ["companyRegistry", "company_registry"],
    ] {
        if !keys.iter().any(|key| company.get(*key).is_some()) {
            return Err(ApiError::Conflict(
                "draft invoice seller fields are unavailable".into(),
            ));
        }
    }
    let mut selected: [Option<&Value>; 2] = [None, None];
    for row in templates {
        let row_org = row_u64(row, &["organizationId", "organization_id"])
            .filter(|id| *id > 0)
            .ok_or_else(|| ApiError::Conflict("invoice profile scope is unavailable".into()))?;
        if cell(row, &["model"]).and_then(Value::as_str).is_none()
            || cell(row, &["reportType", "report_type"])
                .and_then(Value::as_str)
                .is_none()
            || !["companyId", "company_id"]
                .iter()
                .any(|key| row.get(*key).is_some())
        {
            return Err(ApiError::Conflict(
                "invoice profile scope or classification is unavailable".into(),
            ));
        }
        let row_company = match cell(row, &["companyId", "company_id"]) {
            None | Some(Value::Null) => None,
            Some(_) => Some(
                row_u64(row, &["companyId", "company_id"])
                    .filter(|id| *id > 0)
                    .ok_or_else(|| {
                        ApiError::Conflict("invoice profile company scope is unavailable".into())
                    })?,
            ),
        };
        if row_org != organization_id
            || text(row, &["model"]) != "account_move"
            || text(row, &["reportType", "report_type"]) != "lumiere-invoice-profile-v1"
        {
            continue;
        }
        let scope = match row_company {
            None => 0,
            Some(id) if id == company_id => 1,
            _ => continue,
        };
        let active = cell(row, &["isActive", "is_active"]).and_then(Value::as_bool);
        let default = cell(row, &["isDefault", "is_default"]).and_then(Value::as_bool);
        if active == Some(false) || default == Some(false) {
            continue;
        }
        let id = row_u64(row, &["id"]).filter(|id| *id > 0).ok_or_else(|| {
            ApiError::Conflict("invoice profile version id is unavailable".into())
        })?;
        if active != Some(true)
            || default != Some(true)
            || cell(row, &["name"]).and_then(Value::as_str).is_none()
        {
            return Err(ApiError::Conflict(
                "invoice profile version is incomplete".into(),
            ));
        }
        if selected[scope]
            .is_none_or(|current| row_u64(current, &["id"]).is_some_and(|current| current < id))
        {
            selected[scope] = Some(row);
        }
    }
    let mut values = PROFILE_FIELDS
        .into_iter()
        .map(|(key, _)| (key.to_string(), Value::String(String::new())))
        .collect::<serde_json::Map<_, _>>();
    values.insert("accent".into(), Value::String("teal".into()));
    for row in selected.iter().flatten() {
        let raw = text(row, &["metadata"]);
        if raw.len() > 65_536 {
            return Err(ApiError::Conflict(
                "invoice profile metadata is oversized".into(),
            ));
        }
        let metadata: Value = serde_json::from_str(&raw)
            .map_err(|_| ApiError::Conflict("invoice profile metadata is malformed".into()))?;
        let profile = metadata
            .get("invoiceProfile")
            .and_then(Value::as_object)
            .filter(|profile| {
                profile.len() == 2
                    && profile.get("schemaVersion").and_then(Value::as_u64) == Some(1)
            })
            .ok_or_else(|| {
                ApiError::Conflict("invoice profile schema is malformed or unsupported".into())
            })?;
        let profile = profile
            .get("values")
            .and_then(Value::as_object)
            .ok_or_else(|| ApiError::Conflict("invoice profile values are unavailable".into()))?;
        overlay_profile_values(&mut values, profile, organization_id, false)?;
    }
    let metadata = metadata(mv)?;
    if let Some(content) = metadata.get("invoiceContent") {
        let content = content
            .as_object()
            .filter(|value| value.get("schemaVersion").and_then(Value::as_u64) == Some(1))
            .ok_or_else(|| {
                ApiError::Conflict("invoice content schema is malformed or unsupported".into())
            })?;
        let content = content
            .iter()
            .filter(|(key, _)| key.as_str() != "schemaVersion")
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        overlay_profile_values(&mut values, &content, organization_id, true)?;
    }
    let notes = match metadata
        .get("notes")
        .or_else(|| metadata.get("legacyMetadata"))
    {
        None => String::new(),
        Some(Value::String(notes)) => notes.clone(),
        Some(_) => {
            return Err(ApiError::Conflict(
                "invoice notes must be plain text".into(),
            ))
        }
    };
    bounded_text(&notes, "notes", 8000)?;
    let profile: Profile = serde_json::from_value(Value::Object(values))
        .map_err(|_| ApiError::Conflict("resolved invoice profile is incomplete".into()))?;
    let mut seller = legacy_seller(Some(company), company_id);
    seller.address = [
        ["addressStreet", "address_street"],
        ["addressCity", "address_city"],
        ["addressZip", "address_zip"],
        ["addressCountryCode", "address_country_code"],
    ]
    .into_iter()
    .map(|keys| text(company, &keys))
    .filter(|value| !value.trim().is_empty())
    .collect();
    seller.email = profile.email.clone();
    seller.phone = profile.phone.clone();
    seller.website = profile.website.clone();
    Ok(Some(InvoiceSnapshot {
        schema_version: if captured_buyer.is_some() { 2 } else { 1 },
        profile_version_ids: ProfileVersionIds {
            organization: selected[0]
                .and_then(|row| row_u64(row, &["id"]))
                .map(|id| id.to_string()),
            company: selected[1]
                .and_then(|row| row_u64(row, &["id"]))
                .map(|id| id.to_string()),
        },
        seller,
        profile,
        notes,
        buyer: captured_buyer,
    }))
}

/// A present, malformed snapshot must never be silently replaced with today's settings.
pub(crate) fn document_snapshot(mv: &Value) -> Result<Option<InvoiceSnapshot>, ApiError> {
    if !matches!(
        tag(mv, &["moveType", "move_type"])
            .to_ascii_lowercase()
            .as_str(),
        "outinvoice" | "outrefund"
    ) {
        return Ok(None);
    }
    let metadata = metadata(mv)?;
    let Some(raw) = metadata.get("invoiceDocument") else {
        return Ok(None);
    };
    if raw
        .get("profileVersionIds")
        .and_then(Value::as_object)
        .is_none_or(|ids| {
            ids.len() != 2 || !ids.contains_key("organization") || !ids.contains_key("company")
        })
    {
        return Err(ApiError::Conflict(
            "invoice document profile provenance is malformed".into(),
        ));
    }
    let snapshot: InvoiceSnapshot = serde_json::from_value(raw.clone())
        .map_err(|_| ApiError::Conflict("invoice document snapshot is malformed".into()))?;
    if !matches!(snapshot.schema_version, 1 | 2)
        || !matches!(
            snapshot.profile.accent.as_str(),
            "" | "teal" | "blue" | "slate" | "violet"
        )
    {
        return Err(ApiError::Conflict(
            "invoice document snapshot version or accent is unsupported".into(),
        ));
    }
    match (snapshot.schema_version, &snapshot.buyer) {
        (1, None) if raw.get("buyer").is_none() => {}
        (2, Some(buyer)) => validate_buyer(buyer, row_u64(mv, &["partnerId", "partner_id"]))?,
        _ => {
            return Err(ApiError::Conflict(
                "invoice buyer snapshot is malformed".into(),
            ))
        }
    }
    if [
        &snapshot.profile_version_ids.organization,
        &snapshot.profile_version_ids.company,
    ]
    .into_iter()
    .flatten()
    .any(|id| id.parse::<u64>().ok().is_none_or(|id| id == 0))
    {
        return Err(ApiError::Conflict(
            "invoice document profile provenance is malformed".into(),
        ));
    }
    for ((key, limit), value) in PROFILE_FIELDS.into_iter().zip([
        &snapshot.profile.logo_url,
        &snapshot.profile.accent,
        &snapshot.profile.email,
        &snapshot.profile.phone,
        &snapshot.profile.website,
        &snapshot.profile.notice,
        &snapshot.profile.terms,
        &snapshot.profile.payment_instructions,
        &snapshot.profile.footer,
    ]) {
        bounded_text(value, key, limit)?;
    }
    if !snapshot.profile.logo_url.is_empty() {
        let organization_id = row_u64(mv, &["organizationId", "organization_id"])
            .ok_or_else(|| ApiError::Conflict("invoice logo organization is unavailable".into()))?;
        validate_logo_reference(&snapshot.profile.logo_url, organization_id)?;
    }
    bounded_text(&snapshot.notes, "notes", 8000)?;
    for (key, value, limit) in [
        ("seller name", &snapshot.seller.name, 1024),
        ("seller tax ID", &snapshot.seller.tax_id, 256),
        (
            "seller registration",
            &snapshot.seller.registration_number,
            256,
        ),
        ("seller email", &snapshot.seller.email, 254),
        ("seller phone", &snapshot.seller.phone, 64),
        ("seller website", &snapshot.seller.website, 512),
    ] {
        bounded_text(value, key, limit)?;
    }
    if snapshot.seller.address.len() > 12 {
        return Err(ApiError::Conflict(
            "invoice seller address is oversized".into(),
        ));
    }
    for line in &snapshot.seller.address {
        bounded_text(line, "seller address", 2048)?;
    }
    Ok(Some(snapshot))
}

fn metadata(mv: &Value) -> Result<Value, ApiError> {
    match cell(mv, &["metadata"]) {
        None | Some(Value::Null) => Ok(Value::Object(Default::default())),
        Some(Value::String(raw)) if raw.trim().is_empty() => Ok(Value::Object(Default::default())),
        Some(Value::String(raw)) => match serde_json::from_str::<Value>(raw) {
            Ok(Value::Object(object)) => Ok(Value::Object(object)),
            Err(_) if raw.contains("\"invoiceDocument\"") || raw.contains("\"invoiceContent\"") => {
                Err(ApiError::Conflict("invoice metadata is malformed".into()))
            }
            // Historical sales/PO invoice creation stored raw order notes here.
            // Preserve that legacy text without interpreting it as a saved profile.
            _ => Ok(serde_json::json!({"legacyMetadata": raw})),
        },
        Some(Value::Object(value)) => Ok(Value::Object(value.clone())),
        _ => Err(ApiError::Conflict("invoice metadata is malformed".into())),
    }
}

pub(crate) fn row_u64(row: &Value, keys: &[&str]) -> Option<u64> {
    let value = cell(row, keys)?;
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

fn cell<'a>(row: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let value = keys.iter().find_map(|key| row.get(*key))?;
    if let Some(some) = value.get("some") {
        return Some(some);
    }
    if value.get("none").is_some() {
        return None;
    }
    Some(value)
}

fn text(row: &Value, keys: &[&str]) -> String {
    cell(row, keys)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn number(row: &Value, keys: &[&str]) -> Option<f64> {
    let value = cell(row, keys)?;
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse::<f64>().ok())
        .filter(|number| number.is_finite())
}

fn tag(row: &Value, keys: &[&str]) -> String {
    let Some(value) = cell(row, keys) else {
        return String::new();
    };
    value
        .as_str()
        .or_else(|| value.get("tag")?.as_str())
        .map(str::to_string)
        .or_else(|| {
            value
                .as_object()
                .filter(|value| value.len() == 1)?
                .keys()
                .next()
                .cloned()
        })
        .unwrap_or_default()
}

fn date(row: &Value, keys: &[&str]) -> String {
    let Some(value) = cell(row, keys) else {
        return "Not available".into();
    };
    if let Some(raw) = value.as_str() {
        if let Ok(parsed) = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
            return parsed.to_string();
        }
        if let Ok(parsed) = DateTime::parse_from_rfc3339(raw) {
            return parsed.date_naive().to_string();
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
        .map(|date| date.date_naive().to_string())
        .unwrap_or_else(|| "Not available".into())
}

fn legacy_seller(company: Option<&Value>, company_id: u64) -> Seller {
    let Some(company) = company.filter(|company| row_u64(company, &["id"]) == Some(company_id))
    else {
        return Seller {
            name: format!("Company #{company_id}"),
            ..Seller::default()
        };
    };
    Seller {
        name: text(company, &["name"]),
        address: [
            text(company, &["addressStreet", "address_street"]),
            [
                text(company, &["addressZip", "address_zip"]),
                text(company, &["addressCity", "address_city"]),
            ]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
            text(company, &["addressCountryCode", "address_country_code"]),
        ]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect(),
        tax_id: text(company, &["taxId", "tax_id"]),
        registration_number: text(company, &["companyRegistry", "company_registry"]),
        ..Seller::default()
    }
}

/// All amounts come from canonical readable fields. Missing/denied values remain absent.
pub(crate) fn project_invoice(
    mv: &Value,
    lines: &[Value],
    snapshot: Option<InvoiceSnapshot>,
    company: Option<&Value>,
    currency: Option<&Value>,
) -> Result<InvoiceDocument, ApiError> {
    let move_id = row_u64(mv, &["id"])
        .ok_or_else(|| ApiError::Conflict("invoice id is unavailable".into()))?;
    let company_id = row_u64(mv, &["companyId", "company_id"])
        .ok_or_else(|| ApiError::Conflict("invoice company is unavailable".into()))?;
    let currency_id = row_u64(mv, &["currencyId", "currency_id"]);
    let canonical_currency =
        currency.filter(|row| row_u64(row, &["id"]) == currency_id && currency_id.is_some());
    let currency_code = canonical_currency
        .map(|row| text(row, &["code"]))
        .filter(|code| code.len() == 3 && code.bytes().all(|byte| byte.is_ascii_uppercase()));
    let currency_label = currency_code.unwrap_or_else(|| {
        currency_id
            .map(|id| format!("Currency #{id}"))
            .unwrap_or_else(|| "Currency not available".into())
    });
    let decimal_places = canonical_currency
        .and_then(|row| row_u64(row, &["decimalPlaces", "decimal_places"]))
        .filter(|places| *places <= 6)
        .unwrap_or(2) as usize;
    let move_type = tag(mv, &["moveType", "move_type"]);
    let internal_record = !matches!(
        move_type.to_ascii_lowercase().as_str(),
        "outinvoice" | "outrefund"
    );
    let snapshot = if internal_record { None } else { snapshot };
    let legacy = snapshot.is_none() && !internal_record;
    let (seller, profile, notes, captured_buyer) = match snapshot {
        Some(snapshot) => (
            snapshot.seller,
            snapshot.profile,
            snapshot.notes,
            snapshot.buyer,
        ),
        None => (
            legacy_seller(company, company_id),
            Profile::default(),
            text(&metadata(mv)?, &["notes", "legacyMetadata"]),
            None,
        ),
    };
    let partner_id = row_u64(mv, &["partnerId", "partner_id"]);
    let customer_name = text(
        mv,
        &["invoicePartnerDisplayName", "invoice_partner_display_name"],
    );
    let buyer_available = captured_buyer.is_some();
    let customer = captured_buyer
        .map(|buyer| Seller {
            name: buyer.name,
            address: buyer.address,
            tax_id: buyer.tax_id,
            registration_number: buyer.registration_number,
            email: buyer.email,
            phone: buyer.phone,
            website: String::new(),
        })
        .unwrap_or_else(|| Seller {
            name: if customer_name.is_empty() {
                partner_id
                    .map(|id| format!("Partner #{id}"))
                    .unwrap_or_else(|| "Partner details not available".into())
            } else {
                customer_name
            },
            // V1/legacy customer legal details are unavailable; never resolve live CRM.
            ..Seller::default()
        });
    let mut commercial_lines: Vec<&Value> = lines
        .iter()
        .filter(|row| row_u64(row, &["moveId", "move_id"]) == Some(move_id))
        .filter(|row| row_u64(row, &["companyId", "company_id"]) == Some(company_id))
        .filter(|row| {
            cell(row, &["excludeFromInvoiceTab", "exclude_from_invoice_tab"])
                .and_then(Value::as_bool)
                == Some(false)
        })
        .filter(|row| cell(row, &["taxLineId", "tax_line_id"]).is_none_or(Value::is_null))
        .filter(|row| text(row, &["displayType", "display_type"]).is_empty())
        .collect();
    commercial_lines.sort_by_key(|row| {
        (
            row_u64(row, &["sequence"]).unwrap_or(0),
            row_u64(row, &["id"]).unwrap_or(0),
        )
    });
    Ok(InvoiceDocument {
        title: match move_type.to_ascii_lowercase().as_str() {
            "ininvoice" => "Vendor bill",
            "outrefund" => "Credit note",
            "inrefund" => "Vendor credit",
            "outinvoice" => "Customer invoice",
            _ => "Journal entry",
        },
        reference: text(mv, &["name"]),
        seller,
        customer,
        buyer_available,
        profile,
        notes,
        currency: currency_label,
        decimal_places,
        date: date(mv, &["invoiceDate", "invoice_date", "date"]),
        due_date: date(mv, &["invoiceDateDue", "invoice_date_due"]),
        payment_reference: text(mv, &["paymentReference", "payment_reference"]),
        external_reference: text(mv, &["ref", "ref_"]),
        state: tag(mv, &["state"]),
        lines: commercial_lines
            .into_iter()
            .map(|row| InvoiceLine {
                description: text(row, &["name"]),
                quantity: number(row, &["quantity"]),
                unit_price: number(row, &["priceUnit", "price_unit"]),
                discount: number(row, &["discount"]),
                subtotal: number(row, &["priceSubtotal", "price_subtotal"]),
            })
            .collect(),
        subtotal: number(mv, &["amountUntaxed", "amount_untaxed"]),
        tax: number(mv, &["amountTax", "amount_tax"]),
        total: number(mv, &["amountTotal", "amount_total"]),
        residual: number(mv, &["amountResidual", "amount_residual"]),
        legacy,
        internal_record,
    })
}

pub(crate) fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn money(amount: Option<f64>, document: &InvoiceDocument) -> String {
    amount
        .map(|amount| {
            format!(
                "{} {:.*}",
                document.currency, document.decimal_places, amount
            )
        })
        .unwrap_or_else(|| "Not available".into())
}

fn identity(seller: &Seller, profile: Option<&Profile>) -> String {
    let mut parts: Vec<String> = seller.address.iter().map(|line| escape(line)).collect();
    for (label, value) in [
        ("Tax ID", &seller.tax_id),
        ("Registration", &seller.registration_number),
    ] {
        if !value.is_empty() {
            parts.push(format!("{label}: {}", escape(value)));
        }
    }
    let contacts = profile
        .map(|profile| [&profile.email, &profile.phone, &profile.website])
        .unwrap_or([&seller.email, &seller.phone, &seller.website]);
    parts.extend(
        contacts
            .into_iter()
            .filter(|part| !part.is_empty())
            .map(|part| escape(part)),
    );
    format!(
        "<strong>{}</strong><div class=\"identity-lines\">{}</div>",
        escape(&seller.name),
        parts.join("<br>")
    )
}

fn text_section(title: &str, value: &str) -> String {
    if value.is_empty() {
        String::new()
    } else {
        format!(
            "<section class=\"copy\"><h2>{}</h2><div class=\"preserve\">{}</div></section>",
            escape(title),
            escape(value)
        )
    }
}

/// `logo_data_uri` is exclusively produced by the verified managed-blob reader.
/// All user text is escaped and CSP prevents network assets or executable content.
pub(crate) fn render_invoice_html(
    document: &InvoiceDocument,
    logo_data_uri: Option<&str>,
) -> String {
    let accent = match document.profile.accent.as_str() {
        "teal" => "#0f766e",
        "blue" => "#1d4ed8",
        "violet" => "#6d28d9",
        _ => "#334155",
    };
    let logo = logo_data_uri
        .filter(|uri| {
            uri.starts_with("data:image/png;base64,") || uri.starts_with("data:image/jpeg;base64,")
        })
        .map(|uri| {
            format!(
                "<img class=\"logo\" alt=\"Company logo\" src=\"{}\">",
                escape(uri)
            )
        })
        .unwrap_or_default();
    let mut rows = String::new();
    for line in &document.lines {
        let quantity = line
            .quantity
            .map(|quantity| quantity.to_string())
            .unwrap_or_else(|| "Not available".into());
        let discount = line
            .discount
            .filter(|discount| *discount != 0.0)
            .map(|discount| format!("<div class=\"muted\">{}% discount</div>", discount))
            .unwrap_or_default();
        rows.push_str(&format!("<tr><td class=\"description\">{}{discount}</td><td class=\"number\">{}</td><td class=\"number\">{}</td><td class=\"number\">{}</td></tr>", escape(&line.description), escape(&quantity), escape(&money(line.unit_price, document)), escape(&money(line.subtotal, document))));
    }
    if rows.is_empty() {
        rows.push_str("<tr><td colspan=\"4\" class=\"muted\">Commercial line details are not available.</td></tr>");
    }
    let totals = [
        ("Subtotal", document.subtotal),
        ("Tax", document.tax),
        ("Total", document.total),
        ("Amount due", document.residual),
    ]
    .into_iter()
    .map(|(label, amount)| {
        format!(
            "<tr><th>{label}</th><td>{}</td></tr>",
            escape(&money(amount, document))
        )
    })
    .collect::<String>();
    let reference = if document.reference.is_empty() {
        "Reference pending"
    } else {
        &document.reference
    };
    let legacy = if document.legacy {
        "<p class=\"muted legacy\">Legacy document: no saved presentation profile. Company identity is shown without current branding.</p>"
    } else {
        ""
    };
    let record_label = if document.internal_record {
        "<p class=\"muted\">Internal accounting record · Company</p>"
    } else {
        ""
    };
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>{reference}</title><style>
@page {{ size:A4; margin:16mm 12mm; }}
* {{ box-sizing:border-box; }} body {{ margin:0; font:11px/1.5 Arial,"Noto Sans",sans-serif; color:#17212f; overflow-wrap:anywhere; }}
h1 {{ margin:0; font-size:27px; line-height:1.2; color:{accent}; }} h2 {{ font-size:11px; margin:0 0 7px; text-transform:uppercase; letter-spacing:.08em; color:{accent}; }}
.header {{ display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding-bottom:20px; border-bottom:3px solid {accent}; }}
.logo {{ display:block; max-width:145px; max-height:70px; object-fit:contain; margin-bottom:12px; }} .document-meta {{ text-align:right; min-width:150px; }}
.muted {{ color:#64748b; }} .identity-lines {{ margin-top:5px; color:#475569; }} .parties {{ display:grid; grid-template-columns:1fr 1fr; gap:30px; margin:22px 0; }}
.meta {{ width:100%; border-collapse:collapse; margin:18px 0; table-layout:fixed; }} .meta td {{ vertical-align:top; padding:0 10px 5px 0; }}
.items {{ width:100%; border-collapse:collapse; table-layout:fixed; }} .items th {{ text-align:left; background:#f1f5f9; font-size:10px; color:#475569; }}
.items th,.items td {{ padding:10px 8px; border-bottom:1px solid #e2e8f0; vertical-align:top; }} .items th:first-child {{ width:44%; }} .items th:nth-child(2) {{ width:10%; }}
thead {{ display:table-header-group; }} .items tr {{ break-inside:avoid; }} .number {{ text-align:right!important; font-variant-numeric:tabular-nums; }}
.totals {{ width:55%; margin:20px 0 24px auto; border-collapse:collapse; break-inside:avoid; }} .totals th {{ text-align:left; font-weight:400; }} .totals td {{ text-align:right; font-variant-numeric:tabular-nums; }}
.totals th,.totals td {{ padding:7px 5px; }} .totals tr:nth-child(3) {{ border-top:2px solid {accent}; font-size:14px; font-weight:700; }}
.copy {{ margin:20px 0; }} .copy h2 {{ break-after:avoid; }} .preserve {{ white-space:pre-wrap; overflow-wrap:anywhere; orphans:3; widows:3; }}
.footer {{ border-top:1px solid #cbd5e1; padding-top:12px; margin-top:26px; }} .legacy {{ margin-top:20px; font-size:10px; }}
</style></head><body><header class="header"><div>{record_label}{logo}{seller}</div><div class="document-meta"><h1>{title}</h1><p><strong>{reference}</strong><br>{state}</p><p>{currency}</p></div></header>
{notice}<div class="parties"><section><h2>{partner_label}</h2>{customer}</section><section><h2>Document details</h2><div>Issue date: {date}<br>Due date: {due_date}<br>Reference: {external_reference}<br>Payment reference: {payment_reference}</div></section></div>
<table class="items"><thead><tr><th>Description</th><th class="number">Qty</th><th class="number">Unit price</th><th class="number">Amount</th></tr></thead><tbody>{rows}</tbody></table>
<table class="totals"><tbody>{totals}</tbody></table>{notes}{payment}{terms}<footer class="footer preserve">{footer}</footer>{legacy}</body></html>"#,
        reference = escape(reference),
        seller = identity(&document.seller, Some(&document.profile)),
        title = document.title,
        state = escape(&document.state),
        currency = escape(&document.currency),
        partner_label = if document.title == "Vendor bill" || document.title == "Vendor credit" {
            "Vendor"
        } else {
            "Bill to"
        },
        customer = format!(
            "{}{}",
            identity(&document.customer, None),
            if !document.internal_record && !document.buyer_available {
                "<p class=\"muted\">Billing address and tax identity were not captured for this document.</p>"
            } else if !document.internal_record && document.state.eq_ignore_ascii_case("draft") {
                "<p class=\"muted\">Billing details were captured when this draft was created; they will be refreshed from the linked contact when issued.</p>"
            } else {
                ""
            }
        ),
        date = escape(&document.date),
        due_date = escape(&document.due_date),
        external_reference = escape(&document.external_reference),
        payment_reference = escape(&document.payment_reference),
        notice = text_section("Notice", &document.profile.notice),
        notes = text_section("Notes", &document.notes),
        payment = text_section(
            "Payment instructions",
            &document.profile.payment_instructions
        ),
        terms = text_section("Terms", &document.profile.terms),
        footer = escape(&document.profile.footer),
    )
}

#[cfg(test)]
#[path = "invoice_tests.rs"]
mod tests;
