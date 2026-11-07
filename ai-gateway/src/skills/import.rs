//! Deterministic CSV import analysis and preview helpers used by the import_mapping skill.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const MAX_ANALYZE_HEADERS: usize = 200;
const MAX_SAMPLE_ROWS: usize = 50;
const MAX_PREVIEW_ROWS: usize = 100;

#[derive(Debug, Deserialize)]
pub struct ImportAnalyzeRequest {
    pub target_entity: String,
    pub headers: Vec<String>,
    #[serde(default)]
    pub sample_rows: Vec<Vec<String>>,
    #[serde(default)]
    pub prior_mappings: Map<String, Value>,
    #[serde(default)]
    pub bundle_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMapping {
    pub source_column: String,
    pub target_field: String,
    pub confidence: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transform: Option<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataMappingSuggestion {
    pub source_column: String,
    pub metadata_key: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsvStructureSummary {
    pub column_count: usize,
    pub sample_row_count: usize,
    pub duplicate_headers: Vec<String>,
    pub empty_columns: Vec<String>,
    pub delimiter_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsvSafetyFinding {
    pub location: String,
    pub kind: String,
    pub message: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsvSafetyReport {
    pub findings: Vec<CsvSafetyFinding>,
    pub blocked_cell_count: usize,
    /// Compatibility shorthand for eligibility of the supplied input only.
    pub is_safe_for_ai: bool,
    pub inspection: lumiere_file_inspection::InspectionReport,
}

#[derive(Debug, Serialize)]
pub struct ImportBundleHint {
    pub key: String,
    pub line_entity: String,
    pub line_mappings: Vec<ColumnMapping>,
    pub line_unmapped_target_fields: Vec<String>,
    pub suggested_parent_link_source: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ImportAnalyzeResponse {
    pub target_entity: String,
    pub mappings: Vec<ColumnMapping>,
    pub unmapped_source_columns: Vec<String>,
    pub unmapped_target_fields: Vec<String>,
    pub metadata_suggestions: Vec<MetadataMappingSuggestion>,
    pub structure: CsvStructureSummary,
    pub safety: CsvSafetyReport,
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle: Option<ImportBundleHint>,
}

#[derive(Debug, Deserialize)]
pub struct ImportPreviewRequest {
    pub target_entity: String,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub mapping: Map<String, Value>,
    pub max_rows: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct ImportPreviewError {
    pub row_index: usize,
    pub field: String,
    pub message: String,
    pub severity: String,
    pub requires_correction: bool,
}

#[derive(Debug, Serialize)]
pub struct ImportPreviewResponse {
    pub target_entity: String,
    pub rows: Vec<Map<String, Value>>,
    pub validation_errors: Vec<ImportPreviewError>,
    pub safety: CsvSafetyReport,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct FieldSpec {
    name: &'static str,
    required: bool,
    field_type: FieldType,
    aliases: &'static [&'static str],
    allowed_values: &'static [&'static str],
}

#[derive(Debug, Clone, Copy)]
enum FieldType {
    String,
    Number,
    Integer,
    Identifier,
    Bool,
}

fn manifest(target_entity: &str) -> Option<&'static [FieldSpec]> {
    match normalize_name(target_entity).as_str() {
        "contact" | "partner" | "respartner" => Some(&[
            FieldSpec {
                name: "name",
                required: true,
                field_type: FieldType::String,
                aliases: &["name", "customer", "vendor", "company", "contactname"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "type_",
                required: false,
                field_type: FieldType::String,
                aliases: &["type", "contacttype", "companytype"],
                allowed_values: &["contact", "company"],
            },
            FieldSpec {
                name: "email",
                required: false,
                field_type: FieldType::String,
                aliases: &["email", "emailaddress", "mail"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "phone",
                required: false,
                field_type: FieldType::String,
                aliases: &["phone", "telephone", "mobile"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "first_name",
                required: false,
                field_type: FieldType::String,
                aliases: &["firstname", "givenname"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "last_name",
                required: false,
                field_type: FieldType::String,
                aliases: &["lastname", "surname", "familyname"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "city",
                required: false,
                field_type: FieldType::String,
                aliases: &["city", "town"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "country_code",
                required: false,
                field_type: FieldType::String,
                aliases: &["country", "countrycode", "countryiso"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "is_customer",
                required: false,
                field_type: FieldType::Bool,
                aliases: &["iscustomer", "customer"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "is_vendor",
                required: false,
                field_type: FieldType::Bool,
                aliases: &["isvendor", "vendor", "supplier"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "metadata",
                required: false,
                field_type: FieldType::String,
                aliases: &["metadata", "extra", "customfields", "attributes"],
                allowed_values: &[],
            },
        ]),
        "lead" => Some(&[
            FieldSpec {
                name: "name",
                required: true,
                field_type: FieldType::String,
                aliases: &["name", "lead", "leadname", "title"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "email",
                required: false,
                field_type: FieldType::String,
                aliases: &["email", "emailaddress"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "phone",
                required: false,
                field_type: FieldType::String,
                aliases: &["phone", "mobile"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "company_name",
                required: false,
                field_type: FieldType::String,
                aliases: &["company", "companyname", "organization"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "metadata",
                required: false,
                field_type: FieldType::String,
                aliases: &["metadata", "extra", "notes"],
                allowed_values: &[],
            },
        ]),
        "opportunity" => Some(&[
            FieldSpec {
                name: "name",
                required: true,
                field_type: FieldType::String,
                aliases: &["name", "opportunity", "deal", "dealname"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "partner_id",
                required: false,
                field_type: FieldType::Identifier,
                aliases: &["partnerid", "customerid", "contactid"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "expected_revenue",
                required: false,
                field_type: FieldType::Number,
                aliases: &["revenue", "amount", "value", "dealvalue"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "metadata",
                required: false,
                field_type: FieldType::String,
                aliases: &["metadata", "extra", "notes"],
                allowed_values: &[],
            },
        ]),
        "product" | "productproduct" | "producttemplate" => Some(&[
            FieldSpec {
                name: "name",
                required: true,
                field_type: FieldType::String,
                aliases: &["name", "product", "productname", "description"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "default_code",
                required: false,
                field_type: FieldType::String,
                aliases: &["sku", "code", "defaultcode", "internalreference"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "list_price",
                required: false,
                field_type: FieldType::Number,
                aliases: &["price", "salesprice", "listprice"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "active",
                required: false,
                field_type: FieldType::Bool,
                aliases: &["active", "enabled"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "metadata",
                required: false,
                field_type: FieldType::String,
                aliases: &["metadata", "extra", "customfields"],
                allowed_values: &[],
            },
        ]),
        "saleorder" | "sale_order" => Some(&[
            FieldSpec {
                name: "partner_id",
                required: true,
                field_type: FieldType::Identifier,
                aliases: &["partnerid", "customerid", "customer"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "client_order_ref",
                required: false,
                field_type: FieldType::String,
                aliases: &[
                    "reference",
                    "clientref",
                    "customerreference",
                    "po",
                    "orderref",
                ],
                allowed_values: &[],
            },
            FieldSpec {
                name: "amount_total",
                required: false,
                field_type: FieldType::Number,
                aliases: &["total", "amount", "ordertotal"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "state",
                required: false,
                field_type: FieldType::String,
                aliases: &["state", "status"],
                allowed_values: &["draft", "sent", "sale", "done", "cancel"],
            },
        ]),
        "saleorderline" | "sale_order_line" => Some(&[
            FieldSpec {
                name: "product_id",
                required: true,
                field_type: FieldType::Identifier,
                aliases: &["productid", "product", "sku", "itemid", "item"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "product_uom_qty",
                required: false,
                field_type: FieldType::Number,
                aliases: &["qty", "quantity", "productqty", "product_uom_qty"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "price_unit",
                required: false,
                field_type: FieldType::Number,
                aliases: &["price", "unitprice", "priceunit"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "discount",
                required: false,
                field_type: FieldType::Number,
                aliases: &["discount", "discountpercent"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "name",
                required: false,
                field_type: FieldType::String,
                aliases: &["name", "description", "lineitem", "productname"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "sequence",
                required: false,
                field_type: FieldType::Integer,
                aliases: &["sequence", "line", "lineno", "line_number"],
                allowed_values: &[],
            },
        ]),
        "projecttask" | "project_task" | "task" => Some(&[
            FieldSpec {
                name: "name",
                required: true,
                field_type: FieldType::String,
                aliases: &["name", "task", "title", "summary"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "priority",
                required: false,
                field_type: FieldType::String,
                aliases: &["priority"],
                allowed_values: &["0", "1", "2", "3"],
            },
            FieldSpec {
                name: "planned_hours",
                required: false,
                field_type: FieldType::Number,
                aliases: &["plannedhours", "hours", "estimate"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "metadata",
                required: false,
                field_type: FieldType::String,
                aliases: &["metadata", "extra"],
                allowed_values: &[],
            },
        ]),
        _ => None,
    }
}

fn normalize_name(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn mapping_from_prior<'a>(
    header: &str,
    specs: &'a [FieldSpec],
    prior_mappings: &Map<String, Value>,
) -> Option<(&'a FieldSpec, f32)> {
    let prior = prior_mappings.get(header)?.as_str()?;
    let spec = specs.iter().find(|spec| spec.name == prior)?;
    Some((spec, 0.95))
}

fn infer_mapping_for_header<'a>(
    header: &str,
    specs: &'a [FieldSpec],
) -> Option<(&'a FieldSpec, f32)> {
    let normalized = normalize_name(header);
    for spec in specs {
        if normalize_name(spec.name) == normalized {
            return Some((spec, 0.92));
        }
        if spec.aliases.iter().any(|alias| *alias == normalized) {
            return Some((spec, 0.82));
        }
    }
    None
}

fn summarize_structure(headers: &[String], sample_rows: &[Vec<String>]) -> CsvStructureSummary {
    let mut seen = HashSet::new();
    let mut duplicate_headers = Vec::new();
    for header in headers {
        let key = header.trim().to_ascii_lowercase();
        if key.is_empty() {
            continue;
        }
        if !seen.insert(key.clone())
            && !duplicate_headers
                .iter()
                .any(|h: &String| h.eq_ignore_ascii_case(header))
        {
            duplicate_headers.push(header.clone());
        }
    }

    let empty_columns = headers
        .iter()
        .enumerate()
        .filter(|(idx, header)| {
            !header.trim().is_empty()
                && sample_rows
                    .iter()
                    .all(|row| row.get(*idx).is_none_or(|value| value.trim().is_empty()))
        })
        .map(|(_, header)| header.clone())
        .collect();

    CsvStructureSummary {
        column_count: headers.len(),
        sample_row_count: sample_rows.len(),
        duplicate_headers,
        empty_columns,
        delimiter_hint: "comma".to_string(),
    }
}

fn metadata_key_from_header(header: &str) -> String {
    normalize_name(header)
}

fn metadata_suggestions(unmapped_source_columns: &[String]) -> Vec<MetadataMappingSuggestion> {
    unmapped_source_columns
        .iter()
        .map(|column| MetadataMappingSuggestion {
            source_column: column.clone(),
            metadata_key: metadata_key_from_header(column),
            reason: "No canonical ERP field matched; store under ImportJob/row metadata JSON."
                .to_string(),
        })
        .collect()
}

/// Inspect every supplied row. A supplied sample does not certify an unseen file.
pub fn scan_csv_content(
    headers: &[String],
    rows: &[Vec<String>],
) -> Result<CsvSafetyReport, String> {
    let inspection = lumiere_file_inspection::inspect_matrix(headers, rows)
        .map_err(|error| error.to_string())?;
    let findings = inspection
        .findings
        .iter()
        .map(|finding| CsvSafetyFinding {
            location: finding.location.clone(),
            kind: match finding.kind {
                lumiere_file_inspection::FindingKind::FormulaInjection => "formula_injection",
                lumiere_file_inspection::FindingKind::PromptInjection => "prompt_injection",
            }
            .into(),
            message: finding.message.clone(),
            severity: "error".into(),
        })
        .collect();
    Ok(CsvSafetyReport {
        findings,
        blocked_cell_count: inspection.blocked_cell_count,
        is_safe_for_ai: inspection.ai_allowed,
        inspection,
    })
}

fn validate_mapping_values(mapping: &Map<String, Value>) -> Result<(), String> {
    if mapping.len() > lumiere_file_inspection::MAX_COLUMNS {
        return Err("mapping exceeds 200 columns".into());
    }
    for (source, target) in mapping {
        let Some(target) = target.as_str() else {
            return Err("mapping targets must be strings".into());
        };
        if source.chars().count() > lumiere_file_inspection::MAX_CELL_CHARS || target.len() > 200 {
            return Err("mapping entry exceeds its size limit".into());
        }
    }
    Ok(())
}

fn validate_entity_name(entity: &str) -> Result<(), String> {
    if entity.is_empty() || entity.len() > 100 {
        return Err("target_entity must contain 1 to 100 bytes".into());
    }
    Ok(())
}

fn analyze_mapping(req: &ImportAnalyzeRequest) -> Result<ImportAnalyzeResponse, String> {
    validate_entity_name(&req.target_entity)?;
    if req.bundle_key.as_ref().is_some_and(|key| key.len() > 100) {
        return Err("bundle_key exceeds 100 bytes".into());
    }
    let safety = scan_csv_content(&req.headers, &req.sample_rows)?;
    validate_mapping_values(&req.prior_mappings)?;
    let specs = manifest(&req.target_entity)
        .ok_or_else(|| format!("unsupported target_entity: {}", req.target_entity))?;

    let mut mappings = Vec::new();
    let mut mapped_targets = HashSet::new();
    let mut unmapped_source_columns = Vec::new();

    for header in req.headers.iter().take(MAX_ANALYZE_HEADERS) {
        let inferred = mapping_from_prior(header, specs, &req.prior_mappings)
            .or_else(|| infer_mapping_for_header(header, specs));

        if let Some((spec, confidence)) = inferred {
            if mapped_targets.insert(spec.name) {
                mappings.push(ColumnMapping {
                    source_column: header.clone(),
                    target_field: spec.name.to_string(),
                    confidence,
                    transform: Some(match spec.field_type {
                        FieldType::String => "trim".to_string(),
                        FieldType::Number => "trim_parse_number".to_string(),
                        FieldType::Integer => "trim_parse_integer".to_string(),
                        FieldType::Identifier => "trim_parse_id".to_string(),
                        FieldType::Bool => "trim_parse_bool".to_string(),
                    }),
                    required: spec.required,
                });
            } else {
                unmapped_source_columns.push(header.clone());
            }
        } else {
            unmapped_source_columns.push(header.clone());
        }
    }

    let unmapped_target_fields = specs
        .iter()
        .filter(|spec| !mapped_targets.contains(spec.name))
        .map(|spec| spec.name.to_string())
        .collect::<Vec<_>>();

    let mut warnings = Vec::new();
    if req.headers.len() > MAX_ANALYZE_HEADERS {
        warnings.push(format!(
            "only the first {MAX_ANALYZE_HEADERS} headers were analyzed"
        ));
    }
    if req.sample_rows.len() > MAX_SAMPLE_ROWS {
        warnings.push(format!(
            "only the first {MAX_SAMPLE_ROWS} sample rows are considered by the MVP analyzer"
        ));
    }
    let short_rows = req
        .sample_rows
        .iter()
        .filter(|row| row.len() < req.headers.len())
        .count();
    if short_rows > 0 {
        warnings.push(format!(
            "{short_rows} supplied row(s) contain fewer fields than the header"
        ));
    }

    let sample_rows = req
        .sample_rows
        .iter()
        .take(MAX_SAMPLE_ROWS)
        .cloned()
        .collect::<Vec<_>>();
    if !safety.is_safe_for_ai {
        warnings.push(format!(
            "{} cell(s) blocked due to CSV injection or prompt-injection patterns",
            safety.blocked_cell_count
        ));
    }

    let metadata_suggestions = metadata_suggestions(&unmapped_source_columns);

    let bundle = detect_import_bundle(
        &req.target_entity,
        req.bundle_key.as_deref(),
        &req.headers,
        &mappings,
        &unmapped_source_columns,
    );

    Ok(ImportAnalyzeResponse {
        target_entity: req.target_entity.clone(),
        mappings,
        unmapped_source_columns,
        unmapped_target_fields,
        metadata_suggestions,
        structure: summarize_structure(&req.headers, &sample_rows),
        safety,
        warnings,
        bundle,
    })
}

fn detect_import_bundle(
    target_entity: &str,
    bundle_key: Option<&str>,
    headers: &[String],
    parent_mappings: &[ColumnMapping],
    unmapped_source_columns: &[String],
) -> Option<ImportBundleHint> {
    let normalized = normalize_name(target_entity);
    if normalized != "saleorder" && bundle_key != Some("sale_order_bundle") {
        return None;
    }

    let line_specs = manifest("sale_order_line")?;
    let mut line_mappings = Vec::new();
    let mut mapped_line_targets = HashSet::new();

    let candidate_headers: Vec<&String> = if unmapped_source_columns.is_empty() {
        headers.iter().collect()
    } else {
        unmapped_source_columns.iter().collect()
    };

    for header in candidate_headers {
        if let Some((spec, confidence)) = infer_mapping_for_header(header, line_specs) {
            if mapped_line_targets.insert(spec.name) {
                line_mappings.push(ColumnMapping {
                    source_column: (*header).clone(),
                    target_field: spec.name.to_string(),
                    confidence,
                    transform: Some(match spec.field_type {
                        FieldType::String => "trim".to_string(),
                        FieldType::Number => "trim_parse_number".to_string(),
                        FieldType::Integer => "trim_parse_integer".to_string(),
                        FieldType::Identifier => "trim_parse_id".to_string(),
                        FieldType::Bool => "trim_parse_bool".to_string(),
                    }),
                    required: spec.required,
                });
            }
        }
    }

    let has_line_signal = line_mappings.iter().any(|mapping| {
        mapping.target_field == "product_id" || mapping.target_field == "product_uom_qty"
    });
    if !has_line_signal && bundle_key != Some("sale_order_bundle") {
        return None;
    }

    let line_unmapped_target_fields = line_specs
        .iter()
        .filter(|spec| spec.name != "order_id" && !mapped_line_targets.contains(spec.name))
        .map(|spec| spec.name.to_string())
        .collect::<Vec<_>>();

    let suggested_parent_link_source = parent_mappings
        .iter()
        .find(|mapping| mapping.target_field == "client_order_ref")
        .map(|mapping| mapping.source_column.clone())
        .or_else(|| {
            headers
                .iter()
                .find(|header| {
                    let normalized_header = normalize_name(header);
                    [
                        "clientorderref",
                        "reference",
                        "orderref",
                        "ordernumber",
                        "po",
                    ]
                    .iter()
                    .any(|alias| normalized_header == *alias)
                })
                .cloned()
        });

    Some(ImportBundleHint {
        key: "sale_order_bundle".to_string(),
        line_entity: "sale_order_line".to_string(),
        line_mappings,
        line_unmapped_target_fields,
        suggested_parent_link_source,
    })
}

fn parse_mapping(mapping: &Map<String, Value>) -> HashMap<String, String> {
    mapping
        .iter()
        .filter_map(|(source, target)| {
            let target = target.as_str()?.trim();
            (!target.is_empty() && target != "__skip__")
                .then(|| (source.clone(), target.to_string()))
        })
        .collect()
}

fn coerce_value(raw: &str, spec: &FieldSpec) -> Result<Value, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Value::Null);
    }

    match spec.field_type {
        FieldType::String => {
            if !spec.allowed_values.is_empty()
                && !spec
                    .allowed_values
                    .iter()
                    .any(|allowed| *allowed == trimmed)
            {
                return Err(format!(
                    "value must be one of: {}",
                    spec.allowed_values.join(", ")
                ));
            }
            Ok(Value::String(trimmed.to_string()))
        }
        FieldType::Number => {
            let parsed = trimmed.parse::<f64>().map_err(|_| {
                "use a decimal point and omit digit grouping, for example 1234.56".to_string()
            })?;
            serde_json::Number::from_f64(parsed)
                .map(Value::Number)
                .ok_or_else(|| "value must be a finite number".to_string())
        }
        FieldType::Integer => trimmed
            .parse::<u32>()
            .map(|n| Value::Number(n.into()))
            .map_err(|_| "value must be a whole number between 0 and 4294967295".to_string()),
        FieldType::Identifier => {
            if trimmed.bytes().all(|byte| byte.is_ascii_digit())
                && trimmed.parse::<u64>().is_ok_and(|value| value > 0)
            {
                // Preserve the exact identifier, even above the browser's safe integer range.
                Ok(Value::String(trimmed.to_string()))
            } else {
                Err("value must be a positive ERP record ID in decimal digits".to_string())
            }
        }
        FieldType::Bool => match trimmed.to_ascii_lowercase().as_str() {
            "true" | "yes" | "1" => Ok(Value::Bool(true)),
            "false" | "no" | "0" => Ok(Value::Bool(false)),
            _ => Err("use true, false, yes, no, 1, or 0".to_string()),
        },
    }
}

fn preview_rows(req: &ImportPreviewRequest) -> Result<ImportPreviewResponse, String> {
    validate_entity_name(&req.target_entity)?;
    let safety = scan_csv_content(&req.headers, &req.rows)?;
    validate_mapping_values(&req.mapping)?;
    let specs = manifest(&req.target_entity)
        .ok_or_else(|| format!("unsupported target_entity: {}", req.target_entity))?;
    let spec_by_name = specs
        .iter()
        .map(|spec| (spec.name, spec))
        .collect::<HashMap<_, _>>();
    let mapping = parse_mapping(&req.mapping);
    let mut header_index = HashMap::new();
    let mut duplicate_headers = HashSet::new();
    for (index, header) in req.headers.iter().enumerate() {
        if header_index.insert(header.as_str(), index).is_some() {
            duplicate_headers.insert(header.as_str());
        }
    }
    let mut mapped_targets = HashSet::new();
    let duplicate_targets = mapping
        .values()
        .filter(|target| !mapped_targets.insert(target.as_str()))
        .collect::<HashSet<_>>();

    let mut validation_errors = Vec::new();
    let mut normalized_rows = Vec::new();
    let max_rows = req.max_rows.unwrap_or(25).clamp(1, MAX_PREVIEW_ROWS);

    for (row_index, row) in req.rows.iter().take(max_rows).enumerate() {
        let mut normalized = Map::new();

        for (source, target) in &mapping {
            if duplicate_headers.contains(source.as_str()) || duplicate_targets.contains(target) {
                validation_errors.push(ImportPreviewError {
                    row_index,
                    field: target.clone(),
                    message: "each mapped column and target field must identify a single value"
                        .to_string(),
                    severity: "error".to_string(),
                    requires_correction: true,
                });
                continue;
            }
            let Some(spec) = spec_by_name.get(target.as_str()) else {
                validation_errors.push(ImportPreviewError {
                    row_index,
                    field: target.clone(),
                    message: "target field is not supported for this entity".to_string(),
                    severity: "error".to_string(),
                    requires_correction: false,
                });
                continue;
            };
            let Some(source_index) = header_index.get(source.as_str()).copied() else {
                validation_errors.push(ImportPreviewError {
                    row_index,
                    field: target.clone(),
                    message: "source column is missing from headers".to_string(),
                    severity: "error".to_string(),
                    requires_correction: true,
                });
                continue;
            };
            let Some(raw) = row.get(source_index) else {
                continue;
            };
            match coerce_value(raw, spec) {
                Ok(value) => {
                    normalized.insert(target.clone(), value);
                }
                Err(message) => validation_errors.push(ImportPreviewError {
                    row_index,
                    field: target.clone(),
                    message,
                    severity: "error".to_string(),
                    requires_correction: matches!(
                        spec.field_type,
                        FieldType::Number
                            | FieldType::Integer
                            | FieldType::Identifier
                            | FieldType::Bool
                    ),
                }),
            }
        }

        for spec in specs.iter().filter(|spec| spec.required) {
            if normalized
                .get(spec.name)
                .is_none_or(|value| value.is_null() || value.as_str().is_some_and(str::is_empty))
            {
                validation_errors.push(ImportPreviewError {
                    row_index,
                    field: spec.name.to_string(),
                    message: "required field is missing".to_string(),
                    severity: "error".to_string(),
                    requires_correction: false,
                });
            }
        }

        normalized_rows.push(normalized);
    }

    let warnings = if req.rows.len() > max_rows {
        vec![format!("preview limited to {max_rows} rows")]
    } else {
        Vec::new()
    };

    Ok(ImportPreviewResponse {
        target_entity: req.target_entity.clone(),
        rows: normalized_rows,
        validation_errors,
        safety,
        warnings,
    })
}

pub fn analyze_import_mapping(req: ImportAnalyzeRequest) -> Result<ImportAnalyzeResponse, String> {
    analyze_mapping(&req)
}

pub fn preview_import_mapping(req: ImportPreviewRequest) -> Result<ImportPreviewResponse, String> {
    preview_rows(&req)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn analyze_maps_common_product_headers() {
        let req = ImportAnalyzeRequest {
            target_entity: "product".to_string(),
            headers: vec![
                "Product Name".to_string(),
                "SKU".to_string(),
                "Sales Price".to_string(),
            ],
            sample_rows: Vec::new(),
            prior_mappings: Map::new(),
            bundle_key: None,
        };

        let response = analyze_mapping(&req).expect("analysis");
        let targets = response
            .mappings
            .iter()
            .map(|mapping| mapping.target_field.as_str())
            .collect::<Vec<_>>();
        assert!(targets.contains(&"name"));
        assert!(targets.contains(&"default_code"));
        assert!(targets.contains(&"list_price"));
    }

    #[test]
    fn preview_reports_required_and_type_errors() {
        let req = ImportPreviewRequest {
            target_entity: "product".to_string(),
            headers: vec!["Product Name".to_string(), "Sales Price".to_string()],
            rows: vec![vec!["".to_string(), "not-a-number".to_string()]],
            mapping: Map::from_iter([
                ("Product Name".to_string(), json!("name")),
                ("Sales Price".to_string(), json!("list_price")),
            ]),
            max_rows: None,
        };

        let response = preview_rows(&req).expect("preview");
        assert_eq!(response.rows.len(), 1);
        assert_eq!(response.validation_errors.len(), 2);
    }

    #[test]
    fn scan_csv_content_flags_formula_injection() {
        let headers = vec!["Name".to_string()];
        let rows = vec![vec!["=cmd|'/c calc'!A0".to_string()]];
        let report = scan_csv_content(&headers, &rows).expect("bounded matrix");
        assert!(!report.is_safe_for_ai);
        assert!(report.blocked_cell_count >= 1);
    }

    #[test]
    fn preview_preserves_numeric_ambiguity_and_duplicate_columns() {
        let response = preview_rows(&ImportPreviewRequest {
            target_entity: "product".into(),
            headers: vec!["Name".into(), "Name".into(), "Price".into()],
            rows: vec![vec!["Acme".into(), "Beta".into(), "1,25".into()]],
            mapping: Map::from_iter([
                ("Name".into(), json!("name")),
                ("Price".into(), json!("list_price")),
            ]),
            max_rows: None,
        })
        .unwrap();
        assert!(response.rows[0].is_empty());
        assert!(response
            .validation_errors
            .iter()
            .any(|error| { error.field == "list_price" && error.requires_correction }));
        assert!(response
            .validation_errors
            .iter()
            .any(|error| { error.field == "name" && error.requires_correction }));
    }

    #[test]
    fn preview_preserves_exact_record_ids_and_distinguishes_blank_from_missing() {
        let response = preview_rows(&ImportPreviewRequest {
            target_entity: "sale_order".into(),
            headers: ["Partner", "Extra A", "Extra B", "Total"]
                .map(str::to_owned)
                .to_vec(),
            rows: vec![
                ["0009007199254740993", "", ""].map(str::to_owned).to_vec(),
                ["7", "", "", ""].map(str::to_owned).to_vec(),
                ["0", "", "", "0"].map(str::to_owned).to_vec(),
            ],
            mapping: Map::from_iter([
                ("Partner".into(), json!("partner_id")),
                ("Extra A".into(), json!("__skip__")),
                ("Extra B".into(), json!("__skip__")),
                ("Total".into(), json!("amount_total")),
            ]),
            max_rows: None,
        })
        .unwrap();
        assert_eq!(response.rows[0]["partner_id"], json!("0009007199254740993"));
        assert!(!response.rows[0].contains_key("amount_total"));
        assert!(response.rows[1]["amount_total"].is_null());
        assert_eq!(response.rows[2]["amount_total"], json!(0.0));
        assert!(response
            .validation_errors
            .iter()
            .all(|error| error.row_index == 2));
        assert!(response
            .validation_errors
            .iter()
            .any(|error| error.requires_correction));
    }
}
