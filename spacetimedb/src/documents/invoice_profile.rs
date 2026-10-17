//! Immutable invoice-profile publications and server-owned document snapshots.
//!
//! These JSON envelopes reuse document-template versions and move metadata; they
//! deliberately introduce no table, reducer, or financial contract fields.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Map, Value};
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, require_company_in_organization};
use crate::documents::templates::document_template;

pub(crate) const INVOICE_PROFILE_REPORT_TYPE: &str = "lumiere-invoice-profile-v1";
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
const CONTENT_FIELDS: [(&str, usize); 4] = [
    ("notice", 2000),
    ("terms", 8000),
    ("paymentInstructions", 4000),
    ("footer", 2000),
];

fn bounded_text(field: &str, value: &str, limit: usize) -> Result<(), String> {
    if value.len() > limit {
        return Err(format!("invoice {field} exceeds {limit} UTF-8 bytes"));
    }
    if value
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(format!(
            "invoice {field} contains unsupported control characters"
        ));
    }
    Ok(())
}

/// Validate only the managed object reference. The blob-serving boundary owns
/// completed-upload ownership, MIME, image dimensions, and raster-byte checks.
pub(crate) fn validate_invoice_logo_url(value: &str, organization_id: u64) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }
    bounded_text("logoUrl", value, 1024)?;
    let invalid = || "invoice logo must reference a managed blob in this organization".to_string();
    let (path, checksum) = value.split_once("?sha256=").ok_or_else(invalid)?;
    if checksum.len() != 64
        || !checksum
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid());
    }
    let path = path
        .strip_prefix("/api/documents/blobs/object/")
        .ok_or_else(invalid)?;
    let mut parts = path.split('/');
    let org = parts.next().ok_or_else(invalid)?;
    let residency = parts.next().ok_or_else(invalid)?;
    let object = parts.next().ok_or_else(invalid)?;
    if organization_id == 0
        || org != organization_id.to_string()
        || parts.next().is_some()
        || residency.is_empty()
        || residency.len() > 32
        || !residency
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        || object.len() != 32
        || !object.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(invalid());
    }
    Ok(())
}

fn versioned_object<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>, String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{label} must be an object"))?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(format!("{label} schemaVersion must be 1"));
    }
    Ok(object)
}

fn string_values(
    object: &Map<String, Value>,
    fields: &[(&str, usize)],
    label: &str,
) -> Result<BTreeMap<String, String>, String> {
    let mut values = BTreeMap::new();
    for (key, value) in object {
        let limit = fields
            .iter()
            .find_map(|(field, limit)| (*field == key).then_some(*limit))
            .ok_or_else(|| format!("unsupported {label} field {key}"))?;
        let text = value
            .as_str()
            .ok_or_else(|| format!("{label}.{key} must be a string; omit it to inherit"))?;
        bounded_text(key, text, limit)?;
        values.insert(key.clone(), text.to_string());
    }
    Ok(values)
}

/// Reserved profile publications fail closed on malformed, unknown, or oversized
/// fields. Missing values inherit; an explicitly empty string clears a value.
pub(crate) fn validate_invoice_profile_metadata(
    organization_id: u64,
    metadata: Option<&str>,
) -> Result<BTreeMap<String, String>, String> {
    let raw = metadata.ok_or("invoice profile metadata is required")?;
    if raw.len() > 65_536 {
        return Err("invoice profile metadata exceeds 65536 UTF-8 bytes".to_string());
    }
    let metadata: Value = serde_json::from_str(raw)
        .map_err(|_| "invoice profile metadata must be valid JSON".to_string())?;
    let envelope = metadata
        .as_object()
        .and_then(|object| object.get("invoiceProfile"))
        .ok_or("invoiceProfile metadata is required")?;
    let object = versioned_object(envelope, "invoiceProfile")?;
    if object.len() != 2 || !object.contains_key("values") {
        return Err("invoiceProfile must contain only schemaVersion and values".to_string());
    }
    let values = object["values"]
        .as_object()
        .ok_or("invoiceProfile.values must be an object")?;
    let values = string_values(values, &PROFILE_FIELDS, "invoiceProfile.values")?;
    if let Some(accent) = values.get("accent") {
        if !["", "teal", "blue", "slate", "violet"].contains(&accent.as_str()) {
            return Err("invoice accent must be teal, blue, slate, violet, or empty".to_string());
        }
    }
    if let Some(logo) = values.get("logoUrl") {
        validate_invoice_logo_url(logo, organization_id)?;
    }
    Ok(values)
}

/// Published profiles are append-only, including their type and activation flags.
pub(crate) fn ensure_invoice_profile_update_allowed(
    existing_report_type: &str,
    requested_report_type: Option<&str>,
) -> Result<(), String> {
    if existing_report_type == INVOICE_PROFILE_REPORT_TYPE
        || requested_report_type == Some(INVOICE_PROFILE_REPORT_TYPE)
    {
        return Err("invoice profile versions are immutable; publish a new version".to_string());
    }
    Ok(())
}

#[derive(Clone, Debug)]
struct ProfileVersion {
    id: u64,
    organization_id: u64,
    company_id: Option<u64>,
    model: String,
    report_type: String,
    is_default: bool,
    is_active: bool,
    metadata: Option<String>,
}

fn selected_versions(
    versions: impl IntoIterator<Item = ProfileVersion>,
    organization_id: u64,
    company_id: u64,
) -> [Option<ProfileVersion>; 2] {
    let mut selected: [Option<ProfileVersion>; 2] = [None, None];
    for version in versions {
        if version.id == 0
            || version.organization_id != organization_id
            || version.model != "account_move"
            || version.report_type != INVOICE_PROFILE_REPORT_TYPE
            || !version.is_default
            || !version.is_active
        {
            continue;
        }
        let scope = match version.company_id {
            None => 0,
            Some(id) if id == company_id => 1,
            Some(_) => continue,
        };
        if selected[scope]
            .as_ref()
            .map_or(true, |current| current.id < version.id)
        {
            selected[scope] = Some(version);
        }
    }
    selected
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Seller {
    name: String,
    address: Vec<String>,
    tax_id: String,
    registration_number: String,
    email: String,
    phone: String,
    website: String,
}

fn metadata_object(raw: Option<&str>) -> Result<Map<String, Value>, String> {
    let Some(raw) = raw.filter(|raw| !raw.trim().is_empty()) else {
        return Ok(Map::new());
    };
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(object)) => Ok(object),
        Err(_) => {
            let trimmed = raw.trim_start();
            if matches!(trimmed.chars().next(), Some('{' | '[' | '"'))
                || raw.contains("\"invoiceContent\"")
                || raw.contains("\"invoiceDocument\"")
                || raw.contains("\"invoiceProfile\"")
            {
                return Err("invoice document metadata must be valid JSON".to_string());
            }
            bounded_text("notes", raw, 8000)?;
            Ok(Map::from_iter([
                ("legacyMetadata".to_string(), Value::String(raw.to_string())),
                ("notes".to_string(), Value::String(raw.to_string())),
            ]))
        }
        _ => Ok(Map::from_iter([(
            "legacyMetadata".to_string(),
            Value::String(raw.to_string()),
        )])),
    }
}

/// Non-customer documents must not acquire our legal entity's seller branding,
/// including a caller-supplied reserved snapshot. Keep their other metadata intact.
pub(crate) fn without_invoice_document_metadata(raw: Option<&str>) -> Option<String> {
    raw.map(|raw| match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(mut object)) => {
            object.remove("invoiceDocument");
            Value::Object(object).to_string()
        }
        _ => raw.to_string(),
    })
}

fn build_document_metadata(
    raw: Option<&str>,
    organization_id: u64,
    mut seller: Seller,
    mut profile: BTreeMap<String, String>,
    versions: [Option<ProfileVersion>; 2],
) -> Result<String, String> {
    bounded_text("seller.name", &seller.name, 1024)?;
    if seller.address.len() > 12 {
        return Err("invoice seller address exceeds 12 lines".to_string());
    }
    for line in &seller.address {
        bounded_text("seller.address", line, 2048)?;
    }
    bounded_text("seller.taxId", &seller.tax_id, 256)?;
    bounded_text(
        "seller.registrationNumber",
        &seller.registration_number,
        256,
    )?;
    for version in versions.iter().flatten() {
        profile.extend(validate_invoice_profile_metadata(
            organization_id,
            version.metadata.as_deref(),
        )?);
    }
    let mut metadata = metadata_object(raw)?;
    if let Some(content) = metadata.get("invoiceContent") {
        let object = versioned_object(content, "invoiceContent")?;
        let content = object
            .iter()
            .filter(|(key, _)| key.as_str() != "schemaVersion")
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        profile.extend(string_values(&content, &CONTENT_FIELDS, "invoiceContent")?);
    }
    for (field, limit) in PROFILE_FIELDS {
        let value = profile.entry(field.to_string()).or_default();
        bounded_text(field, value, limit)?;
    }
    validate_invoice_logo_url(&profile["logoUrl"], organization_id)?;
    seller.email = profile["email"].clone();
    seller.phone = profile["phone"].clone();
    seller.website = profile["website"].clone();
    let notes = match metadata.get("notes") {
        Some(Value::String(notes)) => notes.clone(),
        Some(_) => return Err("invoice notes must be a string".to_string()),
        None => String::new(),
    };
    bounded_text("notes", &notes, 8000)?;
    // The entire reserved snapshot is replaced, never merged with client input.
    metadata.insert(
        "invoiceDocument".to_string(),
        serde_json::json!({
            "schemaVersion": 1,
            "profileVersionIds": {
                "organization": versions[0].as_ref().map(|version| version.id.to_string()),
                "company": versions[1].as_ref().map(|version| version.id.to_string()),
            },
            "seller": seller,
            "profile": profile,
            "notes": notes,
        }),
    );
    Ok(Value::Object(metadata).to_string())
}

/// Capture trusted company identity and the currently published profile versions.
/// Call only for a new draft or while transitioning Draft -> Posted. Receipt
/// replays return before this function and already-issued records never re-resolve.
pub(crate) fn capture_invoice_document_metadata(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    metadata: Option<&str>,
) -> Result<String, String> {
    require_company_in_organization(ctx, organization_id, company_id)?;
    let company = ctx
        .db
        .company()
        .id()
        .find(company_id)
        .ok_or("invoice company not found")?;
    let seller = Seller {
        name: company.name,
        address: [
            company.address_street,
            company.address_city,
            company.address_zip,
            company.address_country_code,
        ]
        .into_iter()
        .flatten()
        .filter(|line| !line.trim().is_empty())
        .collect(),
        tax_id: company.tax_id.unwrap_or_default(),
        registration_number: company.company_registry.unwrap_or_default(),
        email: String::new(),
        phone: String::new(),
        website: String::new(),
    };
    let mut profile =
        BTreeMap::from_iter(PROFILE_FIELDS.map(|(field, _)| (field.to_string(), String::new())));
    profile.insert("accent".to_string(), "teal".to_string());
    let versions = selected_versions(
        ctx.db
            .document_template()
            .document_template_by_org()
            .filter(organization_id)
            .map(|row| ProfileVersion {
                id: row.id,
                organization_id: row.organization_id,
                company_id: row.company_id,
                model: row.model,
                report_type: row.report_type,
                is_default: row.is_default,
                is_active: row.is_active,
                metadata: row.metadata,
            }),
        organization_id,
        company_id,
    );
    build_document_metadata(metadata, organization_id, seller, profile, versions)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(
        id: u64,
        organization_id: u64,
        company_id: Option<u64>,
        values: Value,
    ) -> ProfileVersion {
        ProfileVersion {
            id,
            organization_id,
            company_id,
            model: "account_move".to_string(),
            report_type: INVOICE_PROFILE_REPORT_TYPE.to_string(),
            is_active: true,
            is_default: true,
            metadata: Some(
                serde_json::json!({"invoiceProfile":{"schemaVersion":1,"values":values}})
                    .to_string(),
            ),
        }
    }
    fn seller() -> Seller {
        Seller {
            name: "Trusted Seller".into(),
            address: vec!["Kigali".into()],
            tax_id: "TIN123".into(),
            registration_number: "REG123".into(),
            email: String::new(),
            phone: String::new(),
            website: String::new(),
        }
    }
    fn snapshot(raw: Option<&str>, versions: [Option<ProfileVersion>; 2]) -> Value {
        let base = BTreeMap::from([
            ("accent".into(), "teal".into()),
            ("email".into(), "organization@example.com".into()),
        ]);
        serde_json::from_str(
            &build_document_metadata(raw, 42, seller(), base, versions).expect("valid snapshot"),
        )
        .expect("snapshot JSON")
    }

    #[test]
    fn profiles_are_isolated_and_latest_id_per_scope_is_deterministic() {
        let rows = vec![
            version(9, 42, None, serde_json::json!({})),
            version(100, 43, None, serde_json::json!({})),
            version(10, 42, Some(8), serde_json::json!({})),
            version(7, 42, Some(7), serde_json::json!({})),
            version(8, 42, None, serde_json::json!({})),
            version(11, 42, Some(7), serde_json::json!({})),
        ];
        let selected = selected_versions(rows.clone(), 42, 7);
        assert_eq!(selected[0].as_ref().map(|row| row.id), Some(9));
        assert_eq!(selected[1].as_ref().map(|row| row.id), Some(11));
        let reversed = selected_versions(rows.into_iter().rev(), 42, 7);
        assert_eq!(reversed[0].as_ref().map(|row| row.id), Some(9));
        assert_eq!(reversed[1].as_ref().map(|row| row.id), Some(11));
    }

    #[test]
    fn company_values_inherit_missing_fields_and_clear_explicit_empty_strings() {
        let result = snapshot(
            None,
            [
                Some(version(
                    1,
                    42,
                    None,
                    serde_json::json!({"notice":"Org notice","terms":"Org terms","accent":"blue"}),
                )),
                Some(version(
                    2,
                    42,
                    Some(7),
                    serde_json::json!({"notice":"","footer":"Company footer","accent":""}),
                )),
            ],
        );
        assert_eq!(result["invoiceDocument"]["profile"]["notice"], "");
        assert_eq!(result["invoiceDocument"]["profile"]["terms"], "Org terms");
        assert_eq!(
            result["invoiceDocument"]["profile"]["footer"],
            "Company footer"
        );
        assert_eq!(result["invoiceDocument"]["profile"]["accent"], "");
        assert_eq!(
            result["invoiceDocument"]["profileVersionIds"]["company"],
            "2"
        );
    }

    #[test]
    fn malformed_oversized_and_unknown_profile_fields_are_rejected() {
        for values in [
            serde_json::json!({"terms":"x".repeat(8001)}),
            serde_json::json!({"email":null}),
            serde_json::json!({"accent":"red"}),
            serde_json::json!({"sellerName":"Fake"}),
            serde_json::json!({"phone":"bad\u{0}"}),
        ] {
            let row = version(1, 42, None, values);
            assert!(validate_invoice_profile_metadata(42, row.metadata.as_deref()).is_err());
        }
        for raw in [
            "broken",
            r#"{"invoiceProfile":{"schemaVersion":2,"values":{}}}"#,
            r#"{"invoiceProfile":{"schemaVersion":1,"values":{},"extra":true}}"#,
        ] {
            assert!(validate_invoice_profile_metadata(42, Some(raw)).is_err());
        }
    }

    #[test]
    fn logo_paths_reject_foreign_remote_svg_data_and_noncanonical_object_references() {
        let object = "0123456789abcdef0123456789abcdef";
        let digest = "a".repeat(64);
        assert!(validate_invoice_logo_url(
            &format!("/api/documents/blobs/object/42/au/{object}?sha256={digest}"),
            42
        )
        .is_ok());
        assert!(validate_invoice_logo_url("", 42).is_ok());
        for path in [
            format!("/api/documents/blobs/object/42/au/{object}"),
            format!(
                "/api/documents/blobs/object/42/au/{object}?sha256={}",
                "A".repeat(64)
            ),
            format!("/api/documents/blobs/object/42/au/{object}?sha256=abc"),
            format!("/api/documents/blobs/object/43/au/{object}?sha256={digest}"),
            format!("/api/documents/blobs/object/43/au/{object}"),
            format!("/api/documents/blobs/object/042/au/{object}"),
            format!("/api/documents/blobs/object/42/../{object}"),
            format!("/api/documents/blobs/object/42/au/{object}?x=1"),
            "/api/documents/blobs/object/42/au/logo.svg".into(),
            "https://example.com/logo.png".into(),
            "data:image/png;base64,AA==".into(),
        ] {
            assert!(
                validate_invoice_logo_url(&path, 42).is_err(),
                "accepted {path}"
            );
        }
    }

    #[test]
    fn server_snapshot_overwrites_forgery_and_preserves_custom_metadata_notes_and_explicit_content()
    {
        let raw = r#"{"custom":{"unchanged":true},"notes":"Operator notes","invoiceDocument":{"seller":{"name":"Forged"}},"invoiceContent":{"schemaVersion":1,"terms":"","paymentInstructions":"Customer-specific"}}"#;
        let result = snapshot(
            Some(raw),
            [
                Some(version(
                    3,
                    42,
                    None,
                    serde_json::json!({"terms":"Default terms"}),
                )),
                None,
            ],
        );
        assert_eq!(
            result["invoiceDocument"]["seller"]["name"],
            "Trusted Seller"
        );
        assert_eq!(result["invoiceDocument"]["notes"], "Operator notes");
        assert_eq!(result["invoiceDocument"]["profile"]["terms"], "");
        assert_eq!(
            result["invoiceDocument"]["profile"]["paymentInstructions"],
            "Customer-specific"
        );
        assert_eq!(result["custom"]["unchanged"], true);
        assert_eq!(result["notes"], "Operator notes");
        assert_eq!(
            result["invoiceContent"]["paymentInstructions"],
            "Customer-specific"
        );
    }

    #[test]
    fn content_and_notes_fail_explicitly_instead_of_silently_dropping_bad_input() {
        let base = BTreeMap::new();
        for raw in [
            r#"{"invoiceContent":{"schemaVersion":2}}"#,
            r#"{"invoiceContent":{"schemaVersion":1,"terms":null}}"#,
            r#"{"invoiceContent":{"schemaVersion":1,"seller":"Forged"}}"#,
            r#"{"invoiceContent":false}"#,
            r#"{"notes":12}"#,
            r#"{"invoiceContent":broken"#,
        ] {
            assert!(
                build_document_metadata(Some(raw), 42, seller(), base.clone(), [None, None])
                    .is_err()
            );
        }
    }

    #[test]
    fn opaque_legacy_metadata_survives_and_identical_snapshot_inputs_are_stable() {
        let first = snapshot(Some("legacy opaque note"), [None, None]);
        let replay = snapshot(Some(&first.to_string()), [None, None]);
        assert_eq!(first, replay);
        assert_eq!(first["legacyMetadata"], "legacy opaque note");
        assert_eq!(first["invoiceDocument"]["notes"], "legacy opaque note");
    }

    #[test]
    fn stored_snapshot_is_independent_of_later_defaults_and_publications_cannot_be_edited() {
        let first = snapshot(
            None,
            [
                Some(version(
                    1,
                    42,
                    None,
                    serde_json::json!({"notice":"Issued notice"}),
                )),
                None,
            ],
        );
        let later = snapshot(
            None,
            [
                Some(version(
                    2,
                    42,
                    None,
                    serde_json::json!({"notice":"New default"}),
                )),
                None,
            ],
        );
        assert_eq!(
            first["invoiceDocument"]["profile"]["notice"],
            "Issued notice"
        );
        assert_eq!(later["invoiceDocument"]["profile"]["notice"], "New default");
        assert!(ensure_invoice_profile_update_allowed(INVOICE_PROFILE_REPORT_TYPE, None).is_err());
        assert!(
            ensure_invoice_profile_update_allowed("pdf", Some(INVOICE_PROFILE_REPORT_TYPE))
                .is_err()
        );
        assert!(ensure_invoice_profile_update_allowed("pdf", Some("html")).is_ok());
    }

    #[test]
    fn unsupported_document_roles_strip_reserved_snapshot_and_preserve_other_metadata() {
        let raw = r#"{"notes":"Vendor notes","custom":true,"invoiceDocument":{"seller":{"name":"Forged"}}}"#;
        let result: Value = serde_json::from_str(
            &without_invoice_document_metadata(Some(raw)).expect("metadata preserved"),
        )
        .expect("JSON");
        assert!(result.get("invoiceDocument").is_none());
        assert_eq!(result["notes"], "Vendor notes");
        assert_eq!(result["custom"], true);
        assert_eq!(without_invoice_document_metadata(None), None);
        assert_eq!(
            without_invoice_document_metadata(Some("legacy note")).as_deref(),
            Some("legacy note")
        );
    }

    #[test]
    fn utf8_limits_are_byte_limits_and_inactive_or_nonprofile_templates_do_not_win() {
        let at_limit = version(1, 42, None, serde_json::json!({"notice":"é".repeat(1000)}));
        assert!(validate_invoice_profile_metadata(42, at_limit.metadata.as_deref()).is_ok());
        let too_long = version(2, 42, None, serde_json::json!({"notice":"é".repeat(1001)}));
        assert!(validate_invoice_profile_metadata(42, too_long.metadata.as_deref()).is_err());
        let mut inactive = at_limit.clone();
        inactive.id = 100;
        inactive.is_active = false;
        let mut generic = at_limit.clone();
        generic.id = 200;
        generic.report_type = "pdf".into();
        let mut wrong_model = at_limit.clone();
        wrong_model.id = 300;
        wrong_model.model = "sale_order".into();
        let selected = selected_versions([at_limit, inactive, generic, wrong_model], 42, 7);
        assert_eq!(selected[0].as_ref().map(|row| row.id), Some(1));
    }
}
