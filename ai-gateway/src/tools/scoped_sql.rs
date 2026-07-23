//! Reviewed SQL-template semantics over an immutable certification dataset.
//!
//! No SQL string is sent to SpacetimeDB. Certification templates operate only
//! on the pinned in-memory projection supplied by the fixture environment.

use serde_json::Value;
use thiserror::Error;

use crate::harness::{
    certification_fixtures::{
        CapabilityEvidence, ImmutableCertificationDataset, MAX_CERTIFICATION_OUTPUT_BYTES,
    },
    low_stock::{self, LowStockInput, LOW_STOCK_RESOURCE},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReviewedSqlTemplate {
    InventoryLowStockV1,
}

impl ReviewedSqlTemplate {
    pub fn id(self) -> &'static str {
        match self {
            Self::InventoryLowStockV1 => "inventory.low_stock.v1",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ScopedSqlResult {
    pub output: Value,
    pub evidence: CapabilityEvidence,
}

#[derive(Clone, Debug, Error, PartialEq)]
pub enum ScopedSqlError {
    #[error("raw SQL is unavailable; use a reviewed template")]
    RawSqlDenied,
    #[error("dataset resource is invalid: {0}")]
    InvalidResource(String),
    #[error("dataset row does not match the claimed tenant scope")]
    RowScopeMismatch,
    #[error("SQL template row limit exceeded")]
    RowLimitExceeded,
    #[error("SQL template output byte limit exceeded")]
    OutputTooLarge,
}

pub fn reject_raw_sql(_sql: &str) -> Result<(), ScopedSqlError> {
    Err(ScopedSqlError::RawSqlDenied)
}

pub fn execute_low_stock(
    dataset: &ImmutableCertificationDataset,
    input: &LowStockInput,
    max_rows: usize,
) -> Result<ScopedSqlResult, ScopedSqlError> {
    let resource = dataset
        .resource(LOW_STOCK_RESOURCE)
        .map_err(|error| ScopedSqlError::InvalidResource(error.to_string()))?;
    if resource.scope() != dataset.scope() {
        return Err(ScopedSqlError::RowScopeMismatch);
    }
    let data = resource
        .value()
        .as_object()
        .ok_or_else(|| ScopedSqlError::InvalidResource("data must be an object".to_string()))?;
    let products = data
        .get("products")
        .and_then(Value::as_array)
        .ok_or_else(|| ScopedSqlError::InvalidResource("products must be an array".to_string()))?;
    let quants = data
        .get("stockQuants")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ScopedSqlError::InvalidResource("stockQuants must be an array".to_string())
        })?;

    let scope = dataset.scope();
    for row in quants {
        validate_row_scope(row, scope.organization_id, scope.company_id)?;
    }
    for row in products {
        validate_row_scope(row, scope.organization_id, scope.company_id)?;
    }

    let input_value = serde_json::to_value(input)
        .map_err(|error| ScopedSqlError::InvalidResource(error.to_string()))?;
    let evaluated = low_stock::evaluate_low_stock_rows(
        products,
        quants,
        scope.organization_id,
        scope.company_id,
        input,
        max_rows,
    )
    .map_err(|error| {
        if error == "low-stock row limit exceeded" {
            ScopedSqlError::RowLimitExceeded
        } else {
            ScopedSqlError::InvalidResource(error)
        }
    })?;
    let output = serde_json::to_value(evaluated)
        .map_err(|error| ScopedSqlError::InvalidResource(error.to_string()))?;
    let encoded = serde_json::to_vec(&output)
        .map_err(|error| ScopedSqlError::InvalidResource(error.to_string()))?;
    if encoded.len() > MAX_CERTIFICATION_OUTPUT_BYTES {
        return Err(ScopedSqlError::OutputTooLarge);
    }
    let evidence = CapabilityEvidence::new(
        "scoped_sql_template",
        scope,
        ReviewedSqlTemplate::InventoryLowStockV1.id(),
        dataset.environment_fingerprint(),
        &input_value,
        &output,
    );
    Ok(ScopedSqlResult { output, evidence })
}

fn validate_row_scope(
    row: &Value,
    organization_id: u64,
    company_id: u64,
) -> Result<(), ScopedSqlError> {
    if row_u64(row, "organizationId", "organization_id") != Some(organization_id)
        || row_u64(row, "companyId", "company_id") != Some(company_id)
    {
        return Err(ScopedSqlError::RowScopeMismatch);
    }
    Ok(())
}

fn row_u64(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::{
        certification_fixtures::CertificationTenantScope,
        release_registry::CandidateCertificationEnvironment,
    };

    fn dataset(value: Value) -> ImmutableCertificationDataset {
        ImmutableCertificationDataset::parse(
            CertificationTenantScope::new(7, 9).expect("scope"),
            &[LOW_STOCK_RESOURCE.to_string()],
            &CandidateCertificationEnvironment {
                id: 1,
                organization_id: 7,
                skill_id: 2,
                fixture_id: 3,
                dataset: value,
                virtual_files: serde_json::json!({}),
                environment_fingerprint: format!("sha256:{}", "a".repeat(64)),
            },
        )
        .expect("dataset")
    }

    fn valid_resource() -> Value {
        serde_json::json!({
            (LOW_STOCK_RESOURCE): {
                "organizationId": 7,
                "companyId": 9,
                "data": {
                    "products": [{
                        "organizationId": 7,
                        "companyId": 9,
                        "id": 20,
                        "defaultCode": "W-20",
                        "name": "Widget",
                        "reorderingMinQty": 5.0
                    }],
                    "stockQuants": [{
                        "organizationId": 7,
                        "companyId": 9,
                        "productId": 20,
                        "locationId": 4,
                        "quantity": 2.0
                    }]
                }
            }
        })
    }

    #[test]
    fn reviewed_template_succeeds_and_records_evidence() {
        let result = execute_low_stock(
            &dataset(valid_resource()),
            &LowStockInput {
                threshold: 3.0,
                location_id: Some(4),
            },
            100,
        )
        .expect("reviewed fixture should execute");

        assert_eq!(result.output["items"][0]["product_id"], 20);
        assert_eq!(result.evidence.company_id, 9);
        assert!(result.evidence.evidence_hash.starts_with("sha256:"));
    }

    #[test]
    fn write_and_raw_sql_are_always_denied() {
        assert_eq!(
            reject_raw_sql("UPDATE product SET name = 'owned'"),
            Err(ScopedSqlError::RawSqlDenied)
        );
        assert_eq!(
            reject_raw_sql("SELECT * FROM product"),
            Err(ScopedSqlError::RawSqlDenied)
        );
    }

    #[test]
    fn cross_tenant_rows_are_denied() {
        let mut resource = valid_resource();
        resource[LOW_STOCK_RESOURCE]["data"]["stockQuants"][0]["companyId"] = Value::from(10);

        assert_eq!(
            execute_low_stock(
                &dataset(resource),
                &LowStockInput {
                    threshold: 3.0,
                    location_id: None,
                },
                100,
            ),
            Err(ScopedSqlError::RowScopeMismatch)
        );
    }

    #[test]
    fn row_limit_is_fail_closed() {
        let mut resource = valid_resource();
        let product = resource[LOW_STOCK_RESOURCE]["data"]["products"][0].clone();
        let quant = resource[LOW_STOCK_RESOURCE]["data"]["stockQuants"][0].clone();
        resource[LOW_STOCK_RESOURCE]["data"]["products"]
            .as_array_mut()
            .expect("products")
            .push({
                let mut second = product;
                second["id"] = Value::from(21);
                second
            });
        resource[LOW_STOCK_RESOURCE]["data"]["stockQuants"]
            .as_array_mut()
            .expect("quants")
            .push({
                let mut second = quant;
                second["productId"] = Value::from(21);
                second
            });

        assert_eq!(
            execute_low_stock(
                &dataset(resource),
                &LowStockInput {
                    threshold: 5.0,
                    location_id: None,
                },
                1,
            ),
            Err(ScopedSqlError::RowLimitExceeded)
        );
    }
}
