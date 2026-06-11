//! AI-assisted ERP form suggestions and cheap read-only validation.
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

const CLAUDE_API_URL: &str = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL: &str = "claude-sonnet-4-6";
const FORM_SUGGEST_MAX_TOKENS: u32 = 2048;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FormOption {
    pub value: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct FormValidation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_length: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "minLength")]
    pub min_length_camel: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "maxLength")]
    pub max_length_camel: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FormField {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<FormOption>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validation: Option<FormValidation>,
}

#[derive(Debug, Deserialize)]
pub struct FormSuggestRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub form_id: String,
    pub entity_type: String,
    pub fields: Vec<FormField>,
    pub raw_text: Option<String>,
    pub document_job_id: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct FormValidateRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub form_id: String,
    pub entity_type: String,
    pub fields: Vec<FormField>,
    #[serde(default)]
    pub values: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormSuggestionSource {
    #[serde(rename = "type")]
    pub source_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationNote {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FormSuggestResponse {
    pub suggestions: Map<String, Value>,
    pub validation_notes: Vec<ValidationNote>,
    pub sources: Vec<FormSuggestionSource>,
}

#[derive(Debug, Serialize)]
pub struct FormValidateResponse {
    pub field_errors: Map<String, Value>,
    pub validation_notes: Vec<ValidationNote>,
}

fn non_empty(value: &str) -> bool {
    !value.trim().is_empty()
}

fn is_empty_value(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(Value::Array(values)) => values.is_empty(),
        _ => false,
    }
}

fn min_length(validation: Option<&FormValidation>) -> Option<usize> {
    validation.and_then(|v| v.min_length.or(v.min_length_camel))
}

fn max_length(validation: Option<&FormValidation>) -> Option<usize> {
    validation.and_then(|v| v.max_length.or(v.max_length_camel))
}

fn option_values(field: &FormField) -> Vec<&str> {
    field
        .options
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|option| option.disabled != Some(true))
        .map(|option| option.value.as_str())
        .collect()
}

fn validate_value(field: &FormField, value: Option<&Value>) -> Option<String> {
    if field.required && is_empty_value(value) {
        return Some("This field is required".to_string());
    }

    let Some(value) = value else {
        return None;
    };
    if value.is_null() {
        return None;
    }

    match field.field_type.as_str() {
        "select" | "radio" => {
            let allowed = option_values(field);
            if allowed.is_empty() {
                return None;
            }
            let selected = value.as_str().unwrap_or_default();
            if !selected.is_empty() && !allowed.iter().any(|allowed| allowed == &selected) {
                return Some("Value is not one of the allowed options".to_string());
            }
        }
        "checkbox" | "switch" => {
            if !value.is_boolean() {
                return Some("Value must be true or false".to_string());
            }
        }
        "number" => {
            let number = value.as_f64();
            let Some(number) = number else {
                return Some("Value must be a number".to_string());
            };
            if let Some(min) = field.validation.as_ref().and_then(|v| v.min) {
                if number < min {
                    return Some(format!("Value must be at least {}", min));
                }
            }
            if let Some(max) = field.validation.as_ref().and_then(|v| v.max) {
                if number > max {
                    return Some(format!("Value must be at most {}", max));
                }
            }
        }
        _ => {
            if let Some(text) = value.as_str() {
                if let Some(min) = min_length(field.validation.as_ref()) {
                    if text.chars().count() < min {
                        return Some(format!("Value must be at least {} characters", min));
                    }
                }
                if let Some(max) = max_length(field.validation.as_ref()) {
                    if text.chars().count() > max {
                        return Some(format!("Value must be at most {} characters", max));
                    }
                }
            }
        }
    }

    None
}

fn validate_values(fields: &[FormField], values: &Map<String, Value>) -> Map<String, Value> {
    let mut errors = Map::new();
    for field in fields {
        if let Some(error) = validate_value(field, values.get(&field.name)) {
            errors.insert(field.name.clone(), Value::String(error));
        }
    }
    errors
}

fn coerce_suggestion_value(field: &FormField, value: Value) -> Option<Value> {
    match field.field_type.as_str() {
        "checkbox" | "switch" => value.as_bool().map(Value::Bool),
        "number" => value
            .as_f64()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number),
        "select" | "radio" => {
            let text = value.as_str()?.trim();
            let allowed = option_values(field);
            if allowed.is_empty() || allowed.iter().any(|allowed| allowed == &text) {
                Some(Value::String(text.to_string()))
            } else {
                None
            }
        }
        _ => match value {
            Value::String(s) => Some(Value::String(s)),
            Value::Number(n) => Some(Value::String(n.to_string())),
            Value::Bool(b) => Some(Value::String(b.to_string())),
            _ => None,
        },
    }
}

fn clean_json_response(text: &str) -> &str {
    text.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
}

fn build_suggestion_prompt(req: &FormSuggestRequest) -> String {
    let schema = serde_json::to_string_pretty(&req.fields).unwrap_or_else(|_| "[]".to_string());
    let raw_text = req.raw_text.as_deref().unwrap_or("");
    let document_context = req
        .document_job_id
        .as_ref()
        .map(|id| format!("Document job id: {id}\n"))
        .unwrap_or_default();

    format!(
        "ERP form: {form_id}\nEntity type: {entity_type}\nOrganization id: {org_id}\nCompany id: {company_id}\n\nAllowed field schema:\n{schema}\n\n{document_context}User/source text:\n{raw_text}\n\nReturn ONLY valid JSON matching this shape:\n{{\"suggestions\":{{\"field_name\":{{\"value\":<schema-compatible value>,\"confidence\":0.0,\"note\":\"short reason\",\"sources\":[{{\"type\":\"text\",\"label\":\"source text\",\"value\":\"short quote\",\"field\":\"field_name\"}}]}}}},\"validation_notes\":[{{\"field\":\"field_name\",\"message\":\"note\",\"severity\":\"info\"}}],\"sources\":[{{\"type\":\"text\",\"label\":\"source text\",\"value\":\"short quote\"}}]}}\nOnly include fields from the allowed schema. Use option values, not option labels, for select and radio fields. Do not invent required identifiers.",
        form_id = req.form_id,
        entity_type = req.entity_type,
        org_id = req.org_id,
        company_id = req.company_id,
        schema = schema,
        document_context = document_context,
        raw_text = raw_text,
    )
}

fn sanitize_suggestions(fields: &[FormField], raw: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(raw_suggestions) = raw.get("suggestions").and_then(Value::as_object) else {
        return out;
    };

    for field in fields {
        let Some(suggestion) = raw_suggestions.get(&field.name).and_then(Value::as_object) else {
            continue;
        };
        let Some(value) = suggestion
            .get("value")
            .cloned()
            .and_then(|value| coerce_suggestion_value(field, value))
        else {
            continue;
        };

        let confidence = suggestion
            .get("confidence")
            .and_then(Value::as_f64)
            .unwrap_or(0.5)
            .clamp(0.0, 1.0) as f32;
        let note = suggestion
            .get("note")
            .and_then(Value::as_str)
            .map(str::to_string);
        let sources = suggestion
            .get("sources")
            .cloned()
            .unwrap_or(Value::Array(vec![]));

        out.insert(
            field.name.clone(),
            json!({
                "value": value,
                "confidence": confidence,
                "note": note,
                "sources": sources,
            }),
        );
    }

    out
}

fn parse_validation_notes(raw: &Value) -> Vec<ValidationNote> {
    raw.get("validation_notes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|note| {
            let message = note.get("message")?.as_str()?.trim();
            if message.is_empty() {
                return None;
            }
            Some(ValidationNote {
                field: note
                    .get("field")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                message: message.to_string(),
                severity: note
                    .get("severity")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect()
}

fn parse_sources(raw: &Value) -> Vec<FormSuggestionSource> {
    raw.get("sources")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|source| {
            let source_type = source.get("type")?.as_str()?.trim();
            if source_type.is_empty() {
                return None;
            }
            Some(FormSuggestionSource {
                source_type: source_type.to_string(),
                label: source
                    .get("label")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                value: source
                    .get("value")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                field: source
                    .get("field")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect()
}

pub async fn post_suggest(
    State(state): State<AppState>,
    Json(req): Json<FormSuggestRequest>,
) -> AppResult<Json<FormSuggestResponse>> {
    if req.company_id == 0 || req.org_id == 0 {
        return Err(AppError::BadRequest(
            "org_id and company_id are required".into(),
        ));
    }
    if !non_empty(&req.form_id) || !non_empty(&req.entity_type) {
        return Err(AppError::BadRequest(
            "form_id and entity_type are required".into(),
        ));
    }
    if req.fields.is_empty() {
        return Err(AppError::BadRequest("fields must not be empty".into()));
    }
    if req.raw_text.as_deref().unwrap_or("").trim().is_empty() && req.document_job_id.is_none() {
        return Err(AppError::BadRequest(
            "raw_text or document_job_id is required".into(),
        ));
    }

    let prompt = build_suggestion_prompt(&req);
    let payload = json!({
        "model": CLAUDE_MODEL,
        "max_tokens": FORM_SUGGEST_MAX_TOKENS,
        "system": "You suggest ERP form values from user-provided text. You must return schema-constrained JSON only. Never include fields outside the supplied schema. Suggestions are advisory and must not submit or mutate data.",
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ]
    });

    let response = state
        .http
        .post(CLAUDE_API_URL)
        .header("x-api-key", state.config.anthropic_api_key.as_str())
        .header("anthropic-version", "2023-06-01")
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Claude API request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "Claude API error {}: {}",
            status, body
        )));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse Claude response: {}", e)))?;
    let text = body["content"][0]["text"].as_str().unwrap_or("{}");
    let model_json: Value = serde_json::from_str(clean_json_response(text))
        .map_err(|e| AppError::Internal(format!("Failed to parse form suggestion JSON: {}", e)))?;

    let suggestions = sanitize_suggestions(&req.fields, &model_json);
    let validation_notes = parse_validation_notes(&model_json);
    let mut sources = parse_sources(&model_json);
    if sources.is_empty()
        && req
            .raw_text
            .as_deref()
            .is_some_and(|text| !text.trim().is_empty())
    {
        sources.push(FormSuggestionSource {
            source_type: "text".to_string(),
            label: Some("Prompt text".to_string()),
            value: None,
            field: None,
        });
    }

    Ok(Json(FormSuggestResponse {
        suggestions,
        validation_notes,
        sources,
    }))
}

pub async fn post_validate(
    Json(req): Json<FormValidateRequest>,
) -> AppResult<Json<FormValidateResponse>> {
    if req.company_id == 0 || req.org_id == 0 {
        return Err(AppError::BadRequest(
            "org_id and company_id are required".into(),
        ));
    }
    if !non_empty(&req.form_id) || !non_empty(&req.entity_type) {
        return Err(AppError::BadRequest(
            "form_id and entity_type are required".into(),
        ));
    }
    if req.fields.is_empty() {
        return Err(AppError::BadRequest("fields must not be empty".into()));
    }

    let field_errors = validate_values(&req.fields, &req.values);
    let validation_notes = if field_errors.is_empty() {
        vec![]
    } else {
        vec![ValidationNote {
            field: None,
            message: "Some fields need review before submission".to_string(),
            severity: Some("warning".to_string()),
        }]
    };

    Ok(Json(FormValidateResponse {
        field_errors,
        validation_notes,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_values_rejects_unknown_select_option() {
        let fields = vec![FormField {
            name: "status".to_string(),
            label: None,
            field_type: "select".to_string(),
            required: true,
            options: Some(vec![FormOption {
                value: "draft".to_string(),
                label: "Draft".to_string(),
                disabled: None,
            }]),
            validation: None,
        }];
        let values = Map::from_iter([("status".to_string(), Value::String("done".to_string()))]);

        let errors = validate_values(&fields, &values);

        assert_eq!(
            errors.get("status").and_then(Value::as_str),
            Some("Value is not one of the allowed options")
        );
    }

    #[test]
    fn sanitize_suggestions_omits_fields_not_in_schema() {
        let fields = vec![FormField {
            name: "name".to_string(),
            label: None,
            field_type: "text".to_string(),
            required: false,
            options: None,
            validation: None,
        }];
        let raw = json!({
            "suggestions": {
                "name": { "value": "Alice", "confidence": 0.9 },
                "admin": { "value": true, "confidence": 1.0 }
            }
        });

        let suggestions = sanitize_suggestions(&fields, &raw);

        assert!(suggestions.contains_key("name"));
        assert!(!suggestions.contains_key("admin"));
    }
}
