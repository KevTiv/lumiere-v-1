use std::collections::BTreeSet;

use serde_json::{Map, Value};

use super::{audit::PrivacyReport, manifest::MergedPrivacyPolicy};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PrivacyError {
    InvalidOutput(String),
    CrossCompanyRow {
        row_index: usize,
        expected_company_id: u64,
        actual_company_id: u64,
    },
}

impl PrivacyError {
    pub fn message(&self) -> String {
        match self {
            Self::InvalidOutput(message) => message.clone(),
            Self::CrossCompanyRow {
                row_index,
                expected_company_id,
                actual_company_id,
            } => format!(
                "row {row_index} belongs to company {actual_company_id}, expected company {expected_company_id}"
            ),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct PrivacyGuard;

impl PrivacyGuard {
    pub fn protect_output(
        &self,
        output: &Value,
        rows_field: &str,
        expected_company_id: u64,
        policy: &MergedPrivacyPolicy,
    ) -> Result<(Value, PrivacyReport), PrivacyError> {
        let object = output.as_object().ok_or_else(|| {
            PrivacyError::InvalidOutput("policy-controlled output must be an object".to_string())
        })?;
        let rows = object
            .get(rows_field)
            .and_then(Value::as_array)
            .ok_or_else(|| {
                PrivacyError::InvalidOutput(format!(
                    "policy-controlled output must contain an array field '{rows_field}'"
                ))
            })?;

        let allowed: BTreeSet<String> = policy
            .allowed_fields
            .iter()
            .map(|field| normalized_field(field))
            .collect();
        let explicitly_masked: BTreeSet<String> = policy
            .masked_fields
            .iter()
            .map(|field| normalized_field(field))
            .collect();
        let mut masked = BTreeSet::new();
        let mut suppressed = BTreeSet::new();
        let mut protected_rows = Vec::with_capacity(rows.len());

        for (row_index, row) in rows.iter().enumerate() {
            let row = row.as_object().ok_or_else(|| {
                PrivacyError::InvalidOutput(format!("row {row_index} must be an object"))
            })?;

            for actual_company_id in company_ids(row) {
                if actual_company_id != expected_company_id {
                    return Err(PrivacyError::CrossCompanyRow {
                        row_index,
                        expected_company_id,
                        actual_company_id,
                    });
                }
            }

            let mut protected = Map::new();
            for (field, value) in row {
                let normalized = normalized_field(field);
                if policy.suppress_secrets && is_secret_field(&normalized) {
                    suppressed.insert(field.clone());
                    continue;
                }
                if !allowed.contains(&normalized) {
                    suppressed.insert(field.clone());
                    continue;
                }

                let should_mask = explicitly_masked.contains(&normalized)
                    || (policy.mask_phone_fields && is_phone_field(&normalized))
                    || (policy.mask_payment_references && is_payment_reference_field(&normalized));
                if should_mask && !value.is_null() {
                    protected.insert(field.clone(), mask_value(value));
                    masked.insert(field.clone());
                } else {
                    protected.insert(field.clone(), value.clone());
                }
            }
            protected_rows.push(Value::Object(protected));
        }

        let mut protected_output = Map::new();
        protected_output.insert(rows_field.to_string(), Value::Array(protected_rows));
        Ok((
            Value::Object(protected_output),
            PrivacyReport {
                rows_processed: rows.len() as u32,
                masked_fields: masked.into_iter().collect(),
                suppressed_fields: suppressed.into_iter().collect(),
            },
        ))
    }
}

fn company_ids(row: &Map<String, Value>) -> impl Iterator<Item = u64> + '_ {
    row.iter()
        .filter(|(field, _)| normalized_field(field) == "companyid")
        .filter_map(|(_, value)| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        })
}

fn normalized_field(field: &str) -> String {
    field
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_secret_field(field: &str) -> bool {
    [
        "secret",
        "password",
        "passwd",
        "token",
        "apikey",
        "authorization",
        "cookie",
        "credential",
        "privatekey",
    ]
    .iter()
    .any(|sensitive| field.contains(sensitive))
}

fn is_phone_field(field: &str) -> bool {
    field.contains("phone") || field.contains("mobile")
}

fn is_payment_reference_field(field: &str) -> bool {
    field.contains("payment")
        || field.contains("cardnumber")
        || field.contains("accountnumber")
        || field.contains("bankaccount")
        || field.contains("iban")
}

fn mask_value(value: &Value) -> Value {
    let raw = match value {
        Value::String(value) => value.clone(),
        other => other.to_string(),
    };
    let tail: String = raw
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if tail.is_empty() {
        Value::String("[MASKED]".to_string())
    } else {
        Value::String(format!("[MASKED]…{tail}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> MergedPrivacyPolicy {
        MergedPrivacyPolicy {
            allowed_fields: vec![
                "company_id".to_string(),
                "name".to_string(),
                "customer_phone".to_string(),
                "payment_reference".to_string(),
                "api_token".to_string(),
            ],
            masked_fields: vec![],
            mask_phone_fields: true,
            mask_payment_references: true,
            suppress_secrets: true,
        }
    }

    #[test]
    fn allowlists_masks_and_suppresses_fields() {
        let (output, report) = PrivacyGuard
            .protect_output(
                &serde_json::json!({
                    "items": [{
                        "company_id": 7,
                        "name": "Widget",
                        "customer_phone": "+1-555-123-4567",
                        "payment_reference": "pay_12345678",
                        "api_token": "never-return-this",
                        "internal_note": "not allowlisted"
                    }],
                    "debug": "drop top-level extras"
                }),
                "items",
                7,
                &policy(),
            )
            .unwrap();

        let row = &output["items"][0];
        assert_eq!(row["name"], "Widget");
        assert_eq!(row["customer_phone"], "[MASKED]…4567");
        assert_eq!(row["payment_reference"], "[MASKED]…5678");
        assert!(row.get("api_token").is_none());
        assert!(row.get("internal_note").is_none());
        assert!(output.get("debug").is_none());
        assert_eq!(report.rows_processed, 1);
        assert!(report.masked_fields.contains(&"customer_phone".to_string()));
        assert!(report.suppressed_fields.contains(&"api_token".to_string()));
    }

    #[test]
    fn rejects_the_entire_output_on_cross_company_row() {
        for company_id in [serde_json::json!(8), serde_json::json!("8")] {
            let error = PrivacyGuard
                .protect_output(
                    &serde_json::json!({"items": [{"company_id": company_id, "name": "Other"}]}),
                    "items",
                    7,
                    &policy(),
                )
                .unwrap_err();
            assert!(matches!(error, PrivacyError::CrossCompanyRow { .. }));
        }
    }

    #[test]
    fn masks_org_explicitly_masked_fields() {
        let (output, report) = PrivacyGuard
            .protect_output(
                &serde_json::json!({
                    "items": [{
                        "company_id": 7,
                        "name": "Widget",
                        "customer_phone": "+1-555-123-4567",
                        "payment_reference": "pay_12345678",
                    }]
                }),
                "items",
                7,
                &MergedPrivacyPolicy {
                    allowed_fields: vec![
                        "company_id".to_string(),
                        "name".to_string(),
                        "customer_phone".to_string(),
                        "payment_reference".to_string(),
                    ],
                    masked_fields: vec!["customer_phone".to_string()],
                    mask_phone_fields: false,
                    mask_payment_references: false,
                    suppress_secrets: true,
                },
            )
            .unwrap();

        let row = &output["items"][0];
        assert_eq!(row["customer_phone"], "[MASKED]…4567");
        assert_eq!(row["payment_reference"], "pay_12345678");
        assert!(report.masked_fields.contains(&"customer_phone".to_string()));
    }
}
