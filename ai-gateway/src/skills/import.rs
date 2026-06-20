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

#[derive(Debug, Serialize)]
pub struct ImportAnalyzeResponse {
    pub target_entity: String,
    pub mappings: Vec<ColumnMapping>,
    pub unmapped_source_columns: Vec<String>,
    pub unmapped_target_fields: Vec<String>,
    pub warnings: Vec<String>,
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
}

#[derive(Debug, Serialize)]
pub struct ImportPreviewResponse {
    pub target_entity: String,
    pub rows: Vec<Map<String, Value>>,
    pub validation_errors: Vec<ImportPreviewError>,
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
        ]),
        "saleorder" | "sale_order" => Some(&[
            FieldSpec {
                name: "partner_id",
                required: true,
                field_type: FieldType::Integer,
                aliases: &["partnerid", "customerid", "customer"],
                allowed_values: &[],
            },
            FieldSpec {
                name: "client_order_ref",
                required: false,
                field_type: FieldType::String,
                aliases: &["reference", "clientref", "customerreference", "po"],
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

fn analyze_mapping(req: &ImportAnalyzeRequest) -> Result<ImportAnalyzeResponse, String> {
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

    Ok(ImportAnalyzeResponse {
        target_entity: req.target_entity.clone(),
        mappings,
        unmapped_source_columns,
        unmapped_target_fields,
        warnings,
    })
}

fn parse_mapping(mapping: &Map<String, Value>) -> HashMap<String, String> {
    mapping
        .iter()
        .filter_map(|(source, target)| {
            let target = target.as_str()?.trim();
            (!target.is_empty()).then(|| (source.clone(), target.to_string()))
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
            let parsed = trimmed
                .replace(',', "")
                .parse::<f64>()
                .map_err(|_| "value must be a number".to_string())?;
            serde_json::Number::from_f64(parsed)
                .map(Value::Number)
                .ok_or_else(|| "value must be a finite number".to_string())
        }
        FieldType::Integer => trimmed
            .parse::<u64>()
            .map(|n| Value::Number(n.into()))
            .map_err(|_| "value must be an integer id".to_string()),
        FieldType::Bool => match trimmed.to_ascii_lowercase().as_str() {
            "true" | "yes" | "1" | "y" => Ok(Value::Bool(true)),
            "false" | "no" | "0" | "n" => Ok(Value::Bool(false)),
            _ => Err("value must be true or false".to_string()),
        },
    }
}

fn preview_rows(req: &ImportPreviewRequest) -> Result<ImportPreviewResponse, String> {
    let specs = manifest(&req.target_entity)
        .ok_or_else(|| format!("unsupported target_entity: {}", req.target_entity))?;
    let spec_by_name = specs
        .iter()
        .map(|spec| (spec.name, spec))
        .collect::<HashMap<_, _>>();
    let mapping = parse_mapping(&req.mapping);
    let header_index = req
        .headers
        .iter()
        .enumerate()
        .map(|(idx, header)| (header.as_str(), idx))
        .collect::<HashMap<_, _>>();

    let mut validation_errors = Vec::new();
    let mut normalized_rows = Vec::new();
    let max_rows = req.max_rows.unwrap_or(25).clamp(1, MAX_PREVIEW_ROWS);

    for (row_index, row) in req.rows.iter().take(max_rows).enumerate() {
        let mut normalized = Map::new();

        for (source, target) in &mapping {
            let Some(spec) = spec_by_name.get(target.as_str()) else {
                validation_errors.push(ImportPreviewError {
                    row_index,
                    field: target.clone(),
                    message: "target field is not supported for this entity".to_string(),
                    severity: "error".to_string(),
                });
                continue;
            };
            let Some(source_index) = header_index.get(source.as_str()).copied() else {
                validation_errors.push(ImportPreviewError {
                    row_index,
                    field: target.clone(),
                    message: "source column is missing from headers".to_string(),
                    severity: "error".to_string(),
                });
                continue;
            };
            let raw = row
                .get(source_index)
                .map(String::as_str)
                .unwrap_or_default();
            match coerce_value(raw, spec) {
                Ok(value) => {
                    normalized.insert(target.clone(), value);
                }
                Err(message) => validation_errors.push(ImportPreviewError {
                    row_index,
                    field: target.clone(),
                    message,
                    severity: "error".to_string(),
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
        warnings,
    })
}

pub type ImportAnalyzeResult = ImportAnalyzeResponse;
pub type ImportPreviewResult = ImportPreviewResponse;

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
}
