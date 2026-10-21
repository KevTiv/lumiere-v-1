/// Country / locale packs — jurisdiction rules live in organization-owned pack
/// tables, not core schemas.
///
/// Tables:
///   - `CountryPackDefinition` — global catalog (pack_key, version, country_code, region)
///   - `CountryPackTaxRule` — tax rules owned by a pack (not `AccountTax`)
///   - `CompanyCountryPack` — per-company activation + pinned version + config
///
/// Enabling a pack materializes active pack tax rules into company `AccountTax` rows
/// (upsert by exact pack/version/rule metadata) so invoice posting uses live configurable
/// tax — not hard-coded legislation inside reducers.
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::tax_management::{account_tax, AccountTax};
use crate::core::organization::{company, organization, require_company_in_organization};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{TaxAmountType, TaxTypeUse};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = country_pack_definition,
    public,
    index(accessor = country_pack_by_organization, btree(columns = [organization_id])),
    index(
        accessor = country_pack_by_pack_key,
        btree(columns = [organization_id, pack_key])
    )
)]
pub struct CountryPackDefinition {
    #[primary_key]
    pub organization_pack_key: String,
    pub organization_id: u64,
    pub pack_key: String,
    pub country_code: String,
    pub name: String,
    pub region: String,
    /// Immutable policy version selected when a company enables this pack.
    ///
    /// The current catalog has one definition row per `pack_key`; parallel historical
    /// versions require a future primary-key migration. Company pins therefore fail
    /// closed if this value ever stops matching their activated version.
    pub version: String,
    /// Lifecycle gate. Only `accepted` definitions may be enabled.
    #[default("legacy_enabled")]
    pub acceptance_status: String,
    #[default(None::<Timestamp>)]
    pub effective_from: Option<Timestamp>,
    #[default(None::<Timestamp>)]
    pub effective_to: Option<Timestamp>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = country_pack_tax_rule,
    public,
    index(
        accessor = pack_tax_by_pack,
        btree(columns = [organization_id, pack_key])
    ),
    index(accessor = pack_tax_by_organization, btree(columns = [organization_id]))
)]
pub struct CountryPackTaxRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    #[unique]
    pub organization_pack_code_key: String,
    pub pack_key: String,
    /// Exact definition version that owns this rule.
    #[default("1.0.0")]
    pub pack_version: String,
    pub code: String,
    pub name: String,
    pub rate: f64,
    pub tax_use: String,
    #[default(None::<Timestamp>)]
    pub effective_from: Option<Timestamp>,
    #[default(None::<Timestamp>)]
    pub effective_to: Option<Timestamp>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = company_country_pack,
    public,
    index(accessor = company_country_pack_by_org, btree(columns = [organization_id])),
    index(accessor = company_country_pack_by_company, btree(columns = [company_id]))
)]
pub struct CompanyCountryPack {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub pack_key: String,
    /// Version resolved at activation. Runtime lookup never silently upgrades this pin.
    #[default("1.0.0")]
    pub pinned_pack_version: String,
    pub enabled: bool,
    pub configuration: Option<String>,
    pub activated_at: Timestamp,
    pub updated_at: Timestamp,
    pub updated_by: spacetimedb::Identity,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetCompanyCountryPackParams {
    pub pack_key: String,
    pub enabled: bool,
    pub configuration: Option<String>,
}

const ACCEPTANCE_ACCEPTED: &str = "accepted";
const ACCEPTANCE_LEGACY_ENABLED: &str = "legacy_enabled";
const ACCEPTANCE_REVIEW_REQUIRED: &str = "review_required";
const LEGACY_PACK_VERSION: &str = "1.0.0";
const RWANDA_DRAFT_PACK_VERSION: &str = "0.2.0-draft";
const RWANDA_DRAFT_PACK_METADATA: &str = r#"{
  "currency":"RWF",
  "document_search_language":"rw",
  "document_search_analyzer":"standard",
  "document_residency_region":"rw",
  "fiscal_archive_kinds":["ebm_invoice","tax_invoice_pdf","vat_return"],
  "compliance_status":"review_required",
  "vat":{
    "standard_rate":0.18,
    "zero_rate":0.0,
    "registration_annual_turnover_rwf":20000000,
    "registration_quarter_turnover_rwf":5000000,
    "quarterly_filing_max_annual_turnover_rwf":200000000,
    "filing_deadline_days_after_period_end":15
  },
  "electronic_invoicing":{
    "system":"RRA_EBM",
    "required_for_taxable_activity":true,
    "external_certification_required":true,
    "integration_mode":"VSDC"
  },
  "official_sources":[
    {
      "authority":"Rwanda Revenue Authority",
      "title":"Value Added Tax (VAT), 2025",
      "url":"https://www.rra.gov.rw/fileadmin/user_upload/VAT__EN_2025.pdf",
      "accessed_on":"2026-10-15",
      "supports":["vat_rates","registration_thresholds","filing_frequency","filing_deadline"]
    },
    {
      "authority":"Rwanda Revenue Authority",
      "title":"About EBM",
      "url":"https://www.rra.gov.rw/en/about-ebm",
      "accessed_on":"2026-10-15",
      "supports":["ebm_obligation","vsdc_certification"]
    },
    {
      "authority":"Rwanda Revenue Authority",
      "title":"Registration and de-registration",
      "url":"https://www.rra.gov.rw/en/domestic-tax-services/registration-de-registration/default-title",
      "accessed_on":"2026-10-15",
      "supports":["registration_thresholds","ebm_obligation"]
    },
    {
      "authority":"Rwanda Law Reform Commission",
      "title":"Law no. 009/2025 amending the VAT law",
      "url":"https://www.rlrc.gov.rw/news-details/report-on-legal-instruments-published-to-the-web-portal-and-rlrcs-website-as-of-may-2025",
      "accessed_on":"2026-10-15",
      "supports":["current_vat_law_identification"]
    }
  ],
  "professional_confirmation_required":[
    "effective_date_and_transition_rules",
    "zero_rated_and_exempt_supply_mapping",
    "taxpayer_specific_vat_filing_frequency",
    "ebm_vsdc_certification_and_invoice_schema",
    "credit_note_and_cancellation_workflow",
    "withholding_tax_applicability_and_posting",
    "record_retention_period",
    "tin_format_and_validation"
  ]
}"#;

/// Add fields introduced by the versioned country-envelope schema to canonical rows
/// written before those fields existed. Explicit values are preserved and subsequently
/// validated by the table's typed reconstruction decoder.
pub(crate) fn normalize_country_pack_reconstruction_row_json(
    table_name: &str,
    row_json: &str,
) -> Result<String, String> {
    let mut value: serde_json::Value = serde_json::from_str(row_json)
        .map_err(|error| format!("invalid canonical row JSON for {table_name}: {error}"))?;
    let row = value.as_object_mut().ok_or_else(|| {
        format!("invalid canonical row JSON for {table_name}: expected a JSON object")
    })?;
    let mut insert_default = |field: &str, default: serde_json::Value| {
        if !row.contains_key(field) {
            row.insert(field.to_string(), default);
        }
    };

    match table_name {
        "country_pack_definition" => {
            insert_default(
                "acceptance_status",
                serde_json::Value::String(ACCEPTANCE_LEGACY_ENABLED.to_string()),
            );
            insert_default("effective_from", serde_json::Value::Null);
            insert_default("effective_to", serde_json::Value::Null);
        }
        "country_pack_tax_rule" => {
            insert_default(
                "pack_version",
                serde_json::Value::String(LEGACY_PACK_VERSION.to_string()),
            );
            insert_default("effective_from", serde_json::Value::Null);
            insert_default("effective_to", serde_json::Value::Null);
        }
        "company_country_pack" => insert_default(
            "pinned_pack_version",
            serde_json::Value::String(LEGACY_PACK_VERSION.to_string()),
        ),
        _ => {
            return Err(format!(
                "country-pack reconstruction normalization does not support table '{table_name}'"
            ));
        }
    }

    serde_json::to_string(&value)
        .map_err(|error| format!("serialize normalized canonical row for {table_name}: {error}"))
}

fn timestamp_is_effective(
    at: Timestamp,
    effective_from: Option<Timestamp>,
    effective_to: Option<Timestamp>,
) -> bool {
    let at_micros = at.to_micros_since_unix_epoch();
    let starts_on_or_before = effective_from
        .map(|value| value.to_micros_since_unix_epoch() <= at_micros)
        .unwrap_or(true);
    // `effective_to` is exclusive so adjacent versions cannot both resolve at a boundary.
    let ends_after = effective_to
        .map(|value| value.to_micros_since_unix_epoch() > at_micros)
        .unwrap_or(true);
    starts_on_or_before && ends_after
}

fn definition_is_activatable_at(definition: &CountryPackDefinition, at: Timestamp) -> bool {
    definition.is_active
        && (definition
            .acceptance_status
            .eq_ignore_ascii_case(ACCEPTANCE_ACCEPTED)
            || definition
                .acceptance_status
                .eq_ignore_ascii_case(ACCEPTANCE_LEGACY_ENABLED))
        && timestamp_is_effective(at, definition.effective_from, definition.effective_to)
}

fn definition_matches_pin_at(
    definition: &CountryPackDefinition,
    organization_id: u64,
    pack_key: &str,
    pinned_pack_version: &str,
    at: Timestamp,
) -> bool {
    definition.organization_id == organization_id
        && definition.pack_key == pack_key
        && definition.version == pinned_pack_version
        && definition_is_activatable_at(definition, at)
}

// ── Party validators ─────────────────────────────────────────────────────────
//
// Country packs may declare `company_id_kind` / `company_id_kinds` and
// `address_required` keys in their `metadata` JSON. These validators are
// intentionally permissive: a pack with no such keys configured (or no pack
// enabled at all) never blocks a write — existing tenants keep working.

/// Enabled pack keys for a company, scoped to the organization.
pub(crate) fn company_enabled_pack_keys(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Vec<String> {
    ctx.db
        .company_country_pack()
        .company_country_pack_by_company()
        .filter(&company_id)
        .filter(|p| p.organization_id == organization_id && p.enabled)
        .filter(|p| {
            resolve_company_pack_definition_at(
                ctx,
                organization_id,
                company_id,
                &p.pack_key,
                ctx.timestamp,
            )
            .is_some()
        })
        .map(|p| p.pack_key.clone())
        .collect()
}

/// Strictly resolve the exact, accepted definition version pinned by a company's enabled
/// pack for a transaction timestamp.
///
/// Transaction paths should use this `Result` form and surface resolution failures. They
/// must not fall back to the latest definition because doing so would reinterpret history.
pub(crate) fn require_company_pack_definition_at(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    pack_key: &str,
    at: Timestamp,
) -> Result<CountryPackDefinition, String> {
    let activation = ctx
        .db
        .company_country_pack()
        .company_country_pack_by_company()
        .filter(&company_id)
        .find(|row| {
            row.organization_id == organization_id && row.enabled && row.pack_key == pack_key
        })
        .ok_or_else(|| format!("Country pack '{pack_key}' is not enabled for the company"))?;

    let definition = ctx
        .db
        .country_pack_definition()
        .iter()
        .find(|definition| {
            definition.organization_id == organization_id && definition.pack_key == pack_key
        })
        .ok_or_else(|| format!("Country pack '{pack_key}' definition is missing"))?;

    if definition.version != activation.pinned_pack_version {
        return Err(format!(
            "Country pack '{pack_key}' pin mismatch: company is pinned to {}, catalog is {}",
            activation.pinned_pack_version, definition.version
        ));
    }
    if !definition_matches_pin_at(
        &definition,
        organization_id,
        pack_key,
        &activation.pinned_pack_version,
        at,
    ) {
        return Err(format!(
            "Country pack '{pack_key}' version {} is not accepted and effective at the transaction date",
            definition.version
        ));
    }
    Ok(definition)
}

/// Compatibility resolver for existing permissive validators. A missing, stale, or
/// ineffective pin is skipped by those validators; strict transaction paths must call
/// [`require_company_pack_definition_at`] instead.
pub(crate) fn resolve_company_pack_definition_at(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    pack_key: &str,
    at: Timestamp,
) -> Option<CountryPackDefinition> {
    require_company_pack_definition_at(ctx, organization_id, company_id, pack_key, at).ok()
}

fn enabled_pack_definitions(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Vec<CountryPackDefinition> {
    company_enabled_pack_keys(ctx, organization_id, company_id)
        .into_iter()
        .filter_map(|key| {
            resolve_company_pack_definition_at(
                ctx,
                organization_id,
                company_id,
                &key,
                ctx.timestamp,
            )
        })
        .collect()
}

fn pack_metadata_json(definition: &CountryPackDefinition) -> Option<serde_json::Value> {
    let meta = definition.metadata.as_ref()?;
    serde_json::from_str(meta).ok()
}

/// Reads `company_id_kind` (single string) or `company_id_kinds` (array) from pack metadata.
fn pack_company_id_kinds(definition: &CountryPackDefinition) -> Vec<String> {
    let Some(value) = pack_metadata_json(definition) else {
        return Vec::new();
    };
    if let Some(kind) = value.get("company_id_kind").and_then(|v| v.as_str()) {
        return vec![kind.to_string()];
    }
    value
        .get("company_id_kinds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Expense evidence rules derived from enabled country packs.
#[derive(Clone, Debug, Default)]
pub struct PackExpenseEvidenceRules {
    /// When true, Standard lines require non-empty `attachment_ids` / `has_receipt`.
    pub require_receipt: bool,
    /// When true, Standard lines require at least one tax id for recovery evidence.
    pub require_tax_ids: bool,
    /// When true (AU), entertainment/FBT product metadata triggers a policy hold.
    pub fbt_entertainment: bool,
}

/// Aggregate pack metadata flags `expense_require_receipt` / `expense_require_tax_ids`
/// / `expense_fbt_entertainment`.
/// No enabled pack (or packs without these keys) → permissive defaults.
pub(crate) fn pack_expense_evidence_rules(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> PackExpenseEvidenceRules {
    let mut rules = PackExpenseEvidenceRules::default();
    for def in enabled_pack_definitions(ctx, organization_id, company_id) {
        let Some(value) = pack_metadata_json(&def) else {
            continue;
        };
        if value
            .get("expense_require_receipt")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            rules.require_receipt = true;
        }
        if value
            .get("expense_require_tax_ids")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            rules.require_tax_ids = true;
        }
        if value
            .get("expense_fbt_entertainment")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            rules.fbt_entertainment = true;
        }
    }
    rules
}

/// Reads `address_required` (array of field names) from pack metadata.
fn pack_address_required_fields(definition: &CountryPackDefinition) -> Vec<String> {
    let Some(value) = pack_metadata_json(definition) else {
        return Vec::new();
    };
    value
        .get("address_required")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Validate a stripped identifier against a known jurisdiction "kind". Unknown kinds
/// are skipped (no strict validation) so unrecognized pack configuration never blocks writes.
fn validate_identifier_kind(kind: &str, raw: &str) -> Result<(), String> {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    let alnum: String = raw.chars().filter(|c| c.is_ascii_alphanumeric()).collect();

    match kind.trim().to_uppercase().as_str() {
        "ABN" | "AU" => {
            if digits.len() != 11 {
                return Err(format!(
                    "Invalid ABN: expected 11 digits, got {}",
                    digits.len()
                ));
            }
        }
        "NZBN" => {
            if digits.len() != 13 {
                return Err(format!(
                    "Invalid NZBN: expected 13 digits, got {}",
                    digits.len()
                ));
            }
        }
        "CNPJ" => {
            if digits.len() != 14 {
                return Err(format!(
                    "Invalid CNPJ: expected 14 digits, got {}",
                    digits.len()
                ));
            }
        }
        "CPF" => {
            if digits.len() != 11 {
                return Err(format!(
                    "Invalid CPF: expected 11 digits, got {}",
                    digits.len()
                ));
            }
        }
        "UEN" => {
            if alnum.len() < 9 || alnum.len() > 10 {
                return Err(format!(
                    "Invalid UEN: expected 9-10 alphanumeric characters, got {}",
                    alnum.len()
                ));
            }
        }
        "NPWP" => {
            if digits.len() < 15 {
                return Err(format!(
                    "Invalid NPWP: expected at least 15 digits, got {}",
                    digits.len()
                ));
            }
        }
        _ => {
            // Unknown kind — don't break tenants on unrecognized pack configuration.
        }
    }

    Ok(())
}

/// Validate a company/contact tax identifier against every jurisdiction "kind" declared by
/// packs enabled on `company_id`. `None`/empty `tax_id` always passes (nothing to validate).
pub(crate) fn validate_company_identifier_for_packs(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    tax_id: &Option<String>,
) -> Result<(), String> {
    let Some(raw) = tax_id else {
        return Ok(());
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    for definition in enabled_pack_definitions(ctx, organization_id, company_id) {
        for kind in pack_company_id_kinds(&definition) {
            validate_identifier_kind(&kind, trimmed)?;
        }
    }

    Ok(())
}

/// Validate address completeness against `address_required` fields declared by packs
/// enabled on `company_id`. Packs without an `address_required` key never block writes.
pub(crate) fn validate_address_for_packs(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    country_code: &Option<String>,
    city: &Option<String>,
    zip: &Option<String>,
    state_code: &Option<String>,
) -> Result<(), String> {
    let is_present = |field: &Option<String>| field.as_ref().is_some_and(|v| !v.trim().is_empty());

    for definition in enabled_pack_definitions(ctx, organization_id, company_id) {
        for field in pack_address_required_fields(&definition) {
            let present = match field.as_str() {
                "city" => is_present(city),
                "zip" | "postal_code" => is_present(zip),
                "state_code" | "state" => is_present(state_code),
                "country_code" | "country" => is_present(country_code),
                _ => true,
            };
            if !present {
                return Err(format!(
                    "Country pack '{}' requires address field '{}'",
                    definition.pack_key, field
                ));
            }
        }
    }

    Ok(())
}

// ── Seed helpers ─────────────────────────────────────────────────────────────

pub(crate) fn seed_country_pack_catalog(ctx: &ReducerContext) {
    let organization_ids: Vec<u64> = ctx.db.organization().iter().map(|org| org.id).collect();
    for organization_id in organization_ids {
        seed_country_pack_catalog_for_organization(ctx, organization_id);
    }
}

pub(crate) fn seed_country_pack_catalog_for_organization(
    ctx: &ReducerContext,
    organization_id: u64,
) {
    let packs = [
        (
            "au",
            "AU",
            "Australia GST",
            "oceania",
            "1.0.0",
            r#"{"fiscal_year_start_month":7,"bas_reporting":true,"company_id_kind":"ABN","hr_statutory_id_kinds":["TFN"],"expense_require_receipt":true,"expense_require_tax_ids":true,"expense_fbt_entertainment":true,"document_search_language":"en","document_search_analyzer":"english","document_residency_region":"au","fiscal_archive_kinds":["tax_invoice_pdf"]}"#,
        ),
        (
            "nz",
            "NZ",
            "New Zealand GST",
            "oceania",
            "1.0.0",
            r#"{"fiscal_year_start_month":4,"gst_rate":0.15,"company_id_kind":"NZBN","hr_statutory_id_kinds":["IRD"],"expense_require_receipt":true,"document_search_language":"en","document_search_analyzer":"english","document_residency_region":"nz","fiscal_archive_kinds":["tax_invoice_pdf"]}"#,
        ),
        (
            "za",
            "ZA",
            "South Africa VAT",
            "southern_africa",
            "1.0.0",
            r#"{"vat_rate":0.15,"currency":"ZAR","hr_statutory_id_kinds":["SA_ID","SARS_TAX"],"expense_require_receipt":true,"document_search_language":"en","document_search_analyzer":"english","document_residency_region":"za","fiscal_archive_kinds":["tax_invoice_pdf"]}"#,
        ),
        (
            "sg",
            "SG",
            "Singapore GST",
            "maritime_se_asia",
            "1.0.0",
            r#"{"gst_rate":0.09,"iras":true,"company_id_kind":"UEN","hr_statutory_id_kinds":["NRIC","FIN"],"expense_require_receipt":true,"document_search_language":"en","document_search_analyzer":"english","document_residency_region":"sg","fiscal_archive_kinds":["tax_invoice_pdf"]}"#,
        ),
    ];

    for (pack_key, country_code, name, region, version, metadata) in packs {
        let key = pack_key.to_string();
        let organization_pack_key = format!("{organization_id}:{key}");
        if ctx
            .db
            .country_pack_definition()
            .organization_pack_key()
            .find(&organization_pack_key)
            .is_some()
        {
            // Published definitions are immutable. Catalog changes require a new version;
            // this single-row schema deliberately refuses to rewrite an existing version.
            continue;
        }
        ctx.db
            .country_pack_definition()
            .insert(CountryPackDefinition {
                organization_pack_key,
                organization_id,
                pack_key: key,
                country_code: country_code.to_string(),
                name: name.to_string(),
                region: region.to_string(),
                version: version.to_string(),
                acceptance_status: ACCEPTANCE_LEGACY_ENABLED.to_string(),
                effective_from: None,
                effective_to: None,
                is_active: true,
                metadata: Some(metadata.to_string()),
            });
    }

    let tax_rules = [
        ("au", "GST-AU", "GST 10%", 0.10, "sale"),
        ("nz", "GST-NZ", "GST 15%", 0.15, "sale"),
        ("za", "VAT-ZA", "VAT 15%", 0.15, "sale"),
        // WHT seeds: consumed on AP OutBound payment post as AccountMove.metadata.wht
        // (see accounting/payments.rs::wht_metadata_for_vendor_payment) — not a full WHT engine.
        ("za", "WHT-ZA", "Withholding 20%", 0.20, "withholding"),
        ("sg", "GST-SG", "GST 9%", 0.09, "sale"),
        ("br", "ICMS-BR", "ICMS 18%", 0.18, "sale"),
        (
            "br",
            "IRRF-BR",
            "IRRF withholding 1.5%",
            0.015,
            "withholding",
        ),
        ("my", "SST-MY", "SST 6%", 0.06, "sale"),
        ("id", "PPN-ID", "PPN 11%", 0.11, "sale"),
        ("th", "VAT-TH", "VAT 7%", 0.07, "sale"),
        ("ph", "VAT-PH", "VAT 12%", 0.12, "sale"),
        ("ar", "IVA-AR", "IVA 21%", 0.21, "sale"),
        ("cl", "IVA-CL", "IVA 19%", 0.19, "sale"),
    ];

    // Southern Cone + Maritime SEA pack definitions (beyond AU/NZ/ZA/SG).
    let extra_packs = [
        (
            "br",
            "BR",
            "Brazil taxes",
            "southern_cone",
            "1.0.0",
            r#"{"nfe_adapter":true,"currency":"BRL","inflation_mode":"optional","company_id_kind":"CNPJ","hr_statutory_id_kinds":["CPF","PIS"],"expense_require_receipt":true,"expense_require_tax_ids":true,"document_search_language":"pt-BR","document_search_analyzer":"portuguese","document_residency_region":"br","fiscal_archive_kinds":["nfe_xml","nfe_pdf","danfe_pdf"]}"#,
        ),
        (
            "ar",
            "AR",
            "Argentina IVA",
            "southern_cone",
            "1.0.0",
            r#"{"currency":"ARS","inflation_mode":"optional","expense_require_receipt":true,"expense_require_tax_ids":true,"document_search_language":"es","document_search_analyzer":"spanish","document_residency_region":"ar","fiscal_archive_kinds":["tax_invoice_pdf"]}"#,
        ),
        (
            "cl",
            "CL",
            "Chile IVA",
            "southern_cone",
            "1.0.0",
            r#"{"currency":"CLP","expense_require_receipt":true,"expense_require_tax_ids":true,"document_search_language":"es","document_search_analyzer":"spanish","document_residency_region":"cl","fiscal_archive_kinds":["tax_invoice_pdf"]}"#,
        ),
        (
            "my",
            "MY",
            "Malaysia SST",
            "maritime_se_asia",
            "1.0.0",
            r#"{"currency":"MYR","e_invoice":"peppol","expense_require_receipt":true,"document_search_language":"ms","document_search_analyzer":"standard","document_residency_region":"my","fiscal_archive_kinds":["myinvois_xml","tax_invoice_pdf"]}"#,
        ),
        (
            "id",
            "ID",
            "Indonesia PPN",
            "maritime_se_asia",
            "1.0.0",
            r#"{"currency":"IDR","e_invoice":"coretax","expense_require_receipt":true,"expense_require_tax_ids":true,"document_search_language":"id","document_search_analyzer":"standard","document_residency_region":"id","fiscal_archive_kinds":["efaktur_pdf","efaktur_xml"]}"#,
        ),
        (
            "th",
            "TH",
            "Thailand VAT",
            "maritime_se_asia",
            "1.0.0",
            r#"{"currency":"THB","expense_require_receipt":true,"document_search_language":"th","document_search_analyzer":"standard","document_residency_region":"th","fiscal_archive_kinds":["tax_invoice_pdf"]}"#,
        ),
        (
            "ph",
            "PH",
            "Philippines VAT",
            "maritime_se_asia",
            "1.0.0",
            r#"{"currency":"PHP","expense_require_receipt":true,"expense_require_tax_ids":true,"document_search_language":"en","document_search_analyzer":"english","document_residency_region":"ph","fiscal_archive_kinds":["tax_invoice_pdf"]}"#,
        ),
    ];

    for (pack_key, country_code, name, region, version, metadata) in extra_packs {
        let key = pack_key.to_string();
        let organization_pack_key = format!("{organization_id}:{key}");
        if ctx
            .db
            .country_pack_definition()
            .organization_pack_key()
            .find(&organization_pack_key)
            .is_some()
        {
            // See the immutability note above: never mutate a published version in place.
            continue;
        }
        ctx.db
            .country_pack_definition()
            .insert(CountryPackDefinition {
                organization_pack_key,
                organization_id,
                pack_key: key,
                country_code: country_code.to_string(),
                name: name.to_string(),
                region: region.to_string(),
                version: version.to_string(),
                acceptance_status: ACCEPTANCE_LEGACY_ENABLED.to_string(),
                effective_from: None,
                effective_to: None,
                is_active: true,
                metadata: Some(metadata.to_string()),
            });
    }

    // Rwanda is intentionally present as a discoverable, evidence-backed draft. The
    // official-source facts are machine readable, while the listed implementation
    // decisions remain review gated. Neither the pack nor its staged tax rules can be
    // materialized until the definition is independently accepted and activated.
    let rw_pack_key = "rw";
    let rw_organization_pack_key = format!("{organization_id}:{rw_pack_key}");
    if ctx
        .db
        .country_pack_definition()
        .organization_pack_key()
        .find(&rw_organization_pack_key)
        .is_none()
    {
        ctx.db
            .country_pack_definition()
            .insert(CountryPackDefinition {
                organization_pack_key: rw_organization_pack_key,
                organization_id,
                pack_key: rw_pack_key.to_string(),
                country_code: "RW".to_string(),
                name: "Rwanda accounting (review required)".to_string(),
                region: "east_africa".to_string(),
                version: RWANDA_DRAFT_PACK_VERSION.to_string(),
                acceptance_status: ACCEPTANCE_REVIEW_REQUIRED.to_string(),
                effective_from: None,
                effective_to: None,
                is_active: false,
                metadata: Some(RWANDA_DRAFT_PACK_METADATA.to_string()),
            });
    }

    let rw_tax_rules = [
        (
            "VAT-RW-18-S",
            "Rwanda VAT 18% (sales)",
            0.18,
            "sale",
            "standard_rate",
        ),
        (
            "VAT-RW-18-P",
            "Rwanda VAT 18% (purchases)",
            0.18,
            "purchase",
            "standard_rate",
        ),
        (
            "VAT-RW-0-S",
            "Rwanda VAT 0% (sales; classification required)",
            0.0,
            "sale",
            "zero_rate",
        ),
        (
            "VAT-RW-0-P",
            "Rwanda VAT 0% (purchases; classification required)",
            0.0,
            "purchase",
            "zero_rate",
        ),
    ];
    for (code, name, rate, tax_use, category) in rw_tax_rules {
        let organization_pack_code_key = format!("{organization_id}:{rw_pack_key}:{code}");
        if ctx
            .db
            .country_pack_tax_rule()
            .organization_pack_code_key()
            .find(&organization_pack_code_key)
            .is_some()
        {
            continue;
        }
        ctx.db.country_pack_tax_rule().insert(CountryPackTaxRule {
            id: 0,
            organization_id,
            organization_pack_code_key,
            pack_key: rw_pack_key.to_string(),
            pack_version: RWANDA_DRAFT_PACK_VERSION.to_string(),
            code: code.to_string(),
            name: name.to_string(),
            rate,
            tax_use: tax_use.to_string(),
            effective_from: None,
            effective_to: None,
            is_active: true,
            metadata: Some(
                serde_json::json!({
                    "source": "country_pack_draft",
                    "pack": rw_pack_key,
                    "pack_version": RWANDA_DRAFT_PACK_VERSION,
                    "vat_category": category,
                    "classification_required": category == "zero_rate",
                    "compliance_status": ACCEPTANCE_REVIEW_REQUIRED,
                    "source_url": "https://www.rra.gov.rw/fileadmin/user_upload/VAT__EN_2025.pdf",
                    "source_accessed_on": "2026-10-15"
                })
                .to_string(),
            ),
        });
    }

    for (pack_key, code, name, rate, tax_use) in tax_rules {
        let exists = ctx.db.country_pack_tax_rule().iter().any(|r| {
            r.organization_id == organization_id && r.pack_key == pack_key && r.code == code
        });
        if exists {
            continue;
        }
        ctx.db.country_pack_tax_rule().insert(CountryPackTaxRule {
            id: 0,
            organization_id,
            organization_pack_code_key: format!("{organization_id}:{pack_key}:{code}"),
            pack_key: pack_key.to_string(),
            pack_version: LEGACY_PACK_VERSION.to_string(),
            code: code.to_string(),
            name: name.to_string(),
            rate,
            tax_use: tax_use.to_string(),
            effective_from: None,
            effective_to: None,
            is_active: true,
            metadata: Some(format!(r#"{{"pack":"{pack_key}"}}"#)),
        });
    }
}

fn parse_pack_tax_use(raw: &str) -> TaxTypeUse {
    match raw.trim().to_lowercase().as_str() {
        "purchase" => TaxTypeUse::Purchase,
        "withholding" | "wht" => TaxTypeUse::Withholding,
        "none" => TaxTypeUse::None,
        _ => TaxTypeUse::Sale,
    }
}

fn metadata_string<'a>(value: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(serde_json::Value::as_str)
}

fn account_tax_pack_identity(
    metadata: &Option<String>,
) -> Option<(String, Option<String>, String)> {
    let value: serde_json::Value = serde_json::from_str(metadata.as_ref()?).ok()?;
    let pack = metadata_string(&value, "pack")?.to_string();
    let version = metadata_string(&value, "pack_version").map(str::to_string);
    let code = metadata_string(&value, "pack_tax_code")?.to_string();
    Some((pack, version, code))
}

fn account_tax_matches_pack_rule(
    metadata: &Option<String>,
    pack_key: &str,
    pack_version: &str,
    code: &str,
) -> bool {
    let Some((stored_pack, stored_version, stored_code)) = account_tax_pack_identity(metadata)
    else {
        return false;
    };

    stored_pack == pack_key
        && stored_code == code
        // A legacy exact pack+code marker may be adopted once, then is rewritten below
        // with the explicit version. This is intentionally not a substring match.
        && stored_version
            .as_deref()
            .map(|version| version == pack_version)
            .unwrap_or(pack_version == LEGACY_PACK_VERSION)
}

fn account_tax_belongs_to_pack_version(
    metadata: &Option<String>,
    pack_key: &str,
    pack_version: &str,
) -> bool {
    let Some((stored_pack, stored_version, _)) = account_tax_pack_identity(metadata) else {
        return false;
    };
    stored_pack == pack_key
        && stored_version
            .as_deref()
            .map(|version| version == pack_version)
            .unwrap_or(pack_version == LEGACY_PACK_VERSION)
}

fn pack_tax_metadata(pack_key: &str, pack_version: &str, code: &str) -> String {
    serde_json::json!({
        "source": "country_pack",
        "pack": pack_key,
        "pack_version": pack_version,
        "pack_tax_code": code,
    })
    .to_string()
}

/// Upsert pack tax rules into company `AccountTax` rows using an exact structured
/// pack/version/rule identity. Rules outside their effective interval are ignored.
fn materialize_pack_taxes_for_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    pack_key: &str,
    pack_version: &str,
    country_code: &str,
    enabled: bool,
    at: Timestamp,
) {
    // Reset the exact materialized set first so disabled, expired, or removed rules do
    // not remain selectable. The subsequent loop re-enables only currently effective rules.
    let existing_pack_taxes: Vec<_> = ctx
        .db
        .account_tax()
        .tax_by_company()
        .filter(&company_id)
        .filter(|tax| {
            tax.organization_id == organization_id
                && account_tax_belongs_to_pack_version(&tax.metadata, pack_key, pack_version)
        })
        .collect();
    for tax in existing_pack_taxes {
        if tax.active {
            ctx.db.account_tax().id().update(AccountTax {
                active: false,
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                ..tax
            });
        }
    }

    if !enabled {
        return;
    }

    let rules: Vec<_> = ctx
        .db
        .country_pack_tax_rule()
        .pack_tax_by_pack()
        .filter((&organization_id, &pack_key.to_string()))
        .filter(|r| {
            r.is_active
                && r.pack_version == pack_version
                && timestamp_is_effective(at, r.effective_from, r.effective_to)
        })
        .collect();

    for rule in rules {
        let existing = ctx
            .db
            .account_tax()
            .tax_by_company()
            .filter(&company_id)
            .find(|t| {
                t.organization_id == organization_id
                    && account_tax_matches_pack_rule(
                        &t.metadata,
                        pack_key,
                        pack_version,
                        &rule.code,
                    )
            });

        let metadata = Some(pack_tax_metadata(pack_key, pack_version, &rule.code));
        // Pack rates are fractional (0.10); AccountTax.amount is percent points (10.0).
        let amount_percent = rule.rate * 100.0;

        if let Some(tax) = existing {
            ctx.db.account_tax().id().update(AccountTax {
                name: rule.name.clone(),
                amount: amount_percent,
                active: true,
                type_tax_use: parse_pack_tax_use(&rule.tax_use),
                country_code: Some(country_code.to_string()),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                metadata,
                ..tax
            });
        } else {
            ctx.db.account_tax().insert(AccountTax {
                id: 0,
                organization_id,
                name: rule.name.clone(),
                description: Some(format!("Country pack {pack_key}")),
                type_tax_use: parse_pack_tax_use(&rule.tax_use),
                amount_type: TaxAmountType::Percent,
                amount: amount_percent,
                active: true,
                price_include: false,
                include_base_amount: false,
                is_base_affected: false,
                sequence: 10,
                company_id,
                tax_group_id: None,
                country_id: None,
                country_code: Some(country_code.to_string()),
                tags: vec![],
                has_negative_factor: false,
                invoice_repartition_line_ids: vec![],
                refund_repartition_line_ids: vec![],
                create_uid: Some(ctx.sender()),
                create_date: Some(ctx.timestamp),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                metadata,
            });
        }
    }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Enable or disable a locale pack for a company. Pack tax rules remain in pack tables.
#[spacetimedb::reducer]
pub fn set_company_country_pack(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SetCompanyCountryPackParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "company", "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    let pack_key = params.pack_key.trim().to_lowercase();
    if pack_key.is_empty() {
        return Err("pack_key cannot be empty".to_string());
    }

    let definition = ctx
        .db
        .country_pack_definition()
        .iter()
        .find(|definition| {
            definition.organization_id == organization_id && definition.pack_key == pack_key
        })
        .ok_or("Unknown country pack")?;

    if params.enabled && !definition_is_activatable_at(&definition, ctx.timestamp) {
        return Err(format!(
            "Country pack is not eligible for activation (status: {}, version: {})",
            definition.acceptance_status, definition.version
        ));
    }

    let company_row = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    let existing = ctx
        .db
        .company_country_pack()
        .company_country_pack_by_company()
        .filter(&company_id)
        .find(|row| row.pack_key == pack_key);

    if params.enabled {
        if let Some(row) = existing.as_ref() {
            if row.pinned_pack_version != definition.version {
                return Err(format!(
                    "Country pack version pin mismatch: company is pinned to {}, catalog is {}",
                    row.pinned_pack_version, definition.version
                ));
            }
        }
    }

    let pinned_pack_version = existing
        .as_ref()
        .map(|row| row.pinned_pack_version.clone())
        .unwrap_or_else(|| definition.version.clone());

    let record_id = if let Some(row) = existing {
        let id = row.id;
        ctx.db
            .company_country_pack()
            .id()
            .update(CompanyCountryPack {
                enabled: params.enabled,
                configuration: params.configuration.clone(),
                updated_at: ctx.timestamp,
                updated_by: ctx.sender(),
                ..row
            });
        id
    } else {
        let inserted = ctx.db.company_country_pack().insert(CompanyCountryPack {
            id: 0,
            organization_id,
            company_id,
            pack_key: pack_key.clone(),
            pinned_pack_version: pinned_pack_version.clone(),
            enabled: params.enabled,
            configuration: params.configuration.clone(),
            activated_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            updated_by: ctx.sender(),
        });
        inserted.id
    };

    materialize_pack_taxes_for_company(
        ctx,
        organization_id,
        company_id,
        &pack_key,
        &pinned_pack_version,
        &definition.country_code,
        params.enabled,
        ctx.timestamp,
    );

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "company_country_pack",
            record_id,
            action: if params.enabled {
                "SET_ACTIVE"
            } else {
                "SET_INACTIVE"
            },
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "pack_key": pack_key,
                    "pinned_pack_version": pinned_pack_version,
                    "enabled": params.enabled,
                    "acceptance_status": definition.acceptance_status,
                    "country_code": definition.country_code,
                    "company_country_code": company_row.address_country_code,
                    "taxes_materialized": true,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "pack_key".to_string(),
                "pinned_pack_version".to_string(),
                "enabled".to_string(),
            ],
            metadata: params.configuration.clone(),
        },
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timestamp(micros: i64) -> Timestamp {
        Timestamp::from_micros_since_unix_epoch(micros)
    }

    fn definition(status: &str, active: bool) -> CountryPackDefinition {
        CountryPackDefinition {
            organization_pack_key: "7:test".to_string(),
            organization_id: 7,
            pack_key: "test".to_string(),
            country_code: "TT".to_string(),
            name: "Test pack".to_string(),
            region: "test".to_string(),
            version: "2.0.0".to_string(),
            acceptance_status: status.to_string(),
            effective_from: Some(timestamp(100)),
            effective_to: Some(timestamp(200)),
            is_active: active,
            metadata: None,
        }
    }

    #[test]
    fn effective_interval_is_half_open_and_bounded() {
        assert!(timestamp_is_effective(
            timestamp(100),
            Some(timestamp(100)),
            Some(timestamp(200))
        ));
        assert!(timestamp_is_effective(
            timestamp(199),
            Some(timestamp(100)),
            Some(timestamp(200))
        ));
        assert!(!timestamp_is_effective(
            timestamp(200),
            Some(timestamp(100)),
            Some(timestamp(200))
        ));
        assert!(!timestamp_is_effective(
            timestamp(99),
            Some(timestamp(100)),
            Some(timestamp(200))
        ));
        assert!(!timestamp_is_effective(
            timestamp(200),
            Some(timestamp(100)),
            Some(timestamp(200))
        ));
    }

    #[test]
    fn activation_requires_accepted_active_effective_definition() {
        assert!(definition_is_activatable_at(
            &definition(ACCEPTANCE_ACCEPTED, true),
            timestamp(150)
        ));
        assert!(definition_is_activatable_at(
            &definition(ACCEPTANCE_LEGACY_ENABLED, true),
            timestamp(150)
        ));
        assert!(!definition_is_activatable_at(
            &definition(ACCEPTANCE_REVIEW_REQUIRED, true),
            timestamp(150)
        ));
        assert!(!definition_is_activatable_at(
            &definition(ACCEPTANCE_ACCEPTED, false),
            timestamp(150)
        ));
        assert!(!definition_is_activatable_at(
            &definition(ACCEPTANCE_ACCEPTED, true),
            timestamp(201)
        ));
    }

    #[test]
    fn pinned_definition_match_fails_closed_on_version_or_scope_mismatch() {
        let definition = definition(ACCEPTANCE_ACCEPTED, true);
        assert!(definition_matches_pin_at(
            &definition,
            7,
            "test",
            "2.0.0",
            timestamp(150)
        ));
        assert!(!definition_matches_pin_at(
            &definition,
            7,
            "test",
            "2.0.1",
            timestamp(150)
        ));
        assert!(!definition_matches_pin_at(
            &definition,
            8,
            "test",
            "2.0.0",
            timestamp(150)
        ));
    }

    #[test]
    fn tax_materialization_identity_uses_exact_structured_values() {
        let exact = Some(pack_tax_metadata("rw", "2.0.0", "VAT-RW"));
        assert!(account_tax_matches_pack_rule(
            &exact, "rw", "2.0.0", "VAT-RW"
        ));
        assert!(!account_tax_matches_pack_rule(
            &exact, "rw", "2.0.1", "VAT-RW"
        ));
        assert!(!account_tax_matches_pack_rule(
            &exact,
            "rw",
            "2.0.0",
            "VAT-RW-EXTRA"
        ));

        let substring_only =
            Some(r#"{"note":"\"pack\":\"rw\",\"pack_tax_code\":\"VAT-RW\""}"#.to_string());
        assert!(!account_tax_matches_pack_rule(
            &substring_only,
            "rw",
            "2.0.0",
            "VAT-RW"
        ));
    }

    #[test]
    fn legacy_tax_identity_is_only_adopted_by_legacy_version() {
        let legacy = Some(r#"{"pack":"au","pack_tax_code":"GST-AU"}"#.to_string());
        assert!(account_tax_matches_pack_rule(
            &legacy,
            "au",
            LEGACY_PACK_VERSION,
            "GST-AU"
        ));
        assert!(!account_tax_matches_pack_rule(
            &legacy, "au", "2.0.0", "GST-AU"
        ));
    }

    #[test]
    fn reconstruction_normalizes_pre_envelope_definition_rows_without_claiming_acceptance() {
        let normalized = normalize_country_pack_reconstruction_row_json(
            "country_pack_definition",
            r#"{"organization_pack_key":"7:au","version":"1.0.0"}"#,
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&normalized).unwrap();
        assert_eq!(
            value["acceptance_status"],
            serde_json::Value::String(ACCEPTANCE_LEGACY_ENABLED.to_string())
        );
        assert!(value["effective_from"].is_null());
        assert!(value["effective_to"].is_null());
    }

    #[test]
    fn reconstruction_normalizes_legacy_tax_and_company_version_pins() {
        let tax = normalize_country_pack_reconstruction_row_json(
            "country_pack_tax_rule",
            r#"{"id":4,"pack_key":"au"}"#,
        )
        .unwrap();
        let tax: serde_json::Value = serde_json::from_str(&tax).unwrap();
        assert_eq!(tax["pack_version"], LEGACY_PACK_VERSION);
        assert!(tax["effective_from"].is_null());
        assert!(tax["effective_to"].is_null());

        let company = normalize_country_pack_reconstruction_row_json(
            "company_country_pack",
            r#"{"id":9,"pack_key":"au"}"#,
        )
        .unwrap();
        let company: serde_json::Value = serde_json::from_str(&company).unwrap();
        assert_eq!(company["pinned_pack_version"], LEGACY_PACK_VERSION);
    }

    #[test]
    fn reconstruction_preserves_explicit_country_envelope_values() {
        let normalized = normalize_country_pack_reconstruction_row_json(
            "country_pack_definition",
            r#"{"acceptance_status":"review_required","effective_from":123,"effective_to":456}"#,
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&normalized).unwrap();
        assert_eq!(value["acceptance_status"], ACCEPTANCE_REVIEW_REQUIRED);
        assert_eq!(value["effective_from"], 123);
        assert_eq!(value["effective_to"], 456);
        assert!(
            normalize_country_pack_reconstruction_row_json("country_pack_definition", "[]")
                .is_err()
        );
    }

    #[test]
    fn rwanda_draft_records_sources_and_unresolved_legal_decisions() {
        let metadata: serde_json::Value = serde_json::from_str(RWANDA_DRAFT_PACK_METADATA).unwrap();

        assert_eq!(metadata["currency"], "RWF");
        assert_eq!(metadata["vat"]["standard_rate"], 0.18);
        assert_eq!(
            metadata["vat"]["registration_annual_turnover_rwf"],
            20_000_000
        );
        assert_eq!(
            metadata["electronic_invoicing"]["external_certification_required"],
            true
        );
        assert!(metadata["official_sources"]
            .as_array()
            .is_some_and(|sources| sources.len() == 4));
        assert!(metadata["professional_confirmation_required"]
            .as_array()
            .is_some_and(|requirements| requirements.len() == 8));
    }
}
