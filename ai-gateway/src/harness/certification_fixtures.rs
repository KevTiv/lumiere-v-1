//! Immutable certification environment adapters.
//!
//! Certification environments are synthetic, public fixture data persisted by
//! SpacetimeDB and pinned to a claimed request. This module converts the pinned
//! JSON into scope-bound, in-memory brokers. It never opens a host filesystem
//! path or queries live tenant state.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

use super::release_registry::CandidateCertificationEnvironment;

#[path = "../tools/scoped_sql.rs"]
pub mod scoped_sql;
#[path = "../tools/tenant_files.rs"]
pub mod tenant_files;

pub const MAX_CERTIFICATION_OUTPUT_BYTES: usize = 256_000;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificationTenantScope {
    pub organization_id: u64,
    pub company_id: u64,
}

impl CertificationTenantScope {
    pub fn new(organization_id: u64, company_id: u64) -> Result<Self, FixtureEnvironmentError> {
        if organization_id == 0 {
            return Err(FixtureEnvironmentError::OrganizationRequired);
        }
        if company_id == 0 {
            return Err(FixtureEnvironmentError::CompanyRequired);
        }
        Ok(Self {
            organization_id,
            company_id,
        })
    }
}

#[derive(Clone, Debug)]
pub struct ScopedDatasetResource {
    scope: CertificationTenantScope,
    value: Value,
}

impl ScopedDatasetResource {
    pub fn scope(&self) -> CertificationTenantScope {
        self.scope
    }

    pub fn value(&self) -> &Value {
        &self.value
    }
}

#[derive(Clone, Debug)]
pub struct ImmutableCertificationDataset {
    scope: CertificationTenantScope,
    resources: BTreeMap<String, ScopedDatasetResource>,
    environment_fingerprint: String,
}

impl ImmutableCertificationDataset {
    pub fn parse(
        scope: CertificationTenantScope,
        declared_resources: &[String],
        environment: &CandidateCertificationEnvironment,
    ) -> Result<Self, FixtureEnvironmentError> {
        let declared = declared_resources
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let entries = environment
            .dataset
            .as_object()
            .ok_or(FixtureEnvironmentError::DatasetMustBeObject)?;
        let mut resources = BTreeMap::new();

        for (name, value) in entries {
            if !declared.contains(name.as_str()) {
                return Err(FixtureEnvironmentError::UndeclaredResource(name.clone()));
            }
            let object = value
                .as_object()
                .ok_or_else(|| FixtureEnvironmentError::ResourceMustBeObject(name.clone()))?;
            let resource_scope = CertificationTenantScope {
                organization_id: required_u64(object.get("organizationId"))
                    .ok_or_else(|| FixtureEnvironmentError::ResourceScopeMissing(name.clone()))?,
                company_id: required_u64(object.get("companyId"))
                    .ok_or_else(|| FixtureEnvironmentError::ResourceScopeMissing(name.clone()))?,
            };
            if resource_scope != scope {
                return Err(FixtureEnvironmentError::ResourceScopeMismatch(name.clone()));
            }
            let resource_value = object
                .get("data")
                .cloned()
                .ok_or_else(|| FixtureEnvironmentError::ResourceDataMissing(name.clone()))?;
            resources.insert(
                name.clone(),
                ScopedDatasetResource {
                    scope: resource_scope,
                    value: resource_value,
                },
            );
        }

        Ok(Self {
            scope,
            resources,
            environment_fingerprint: environment.environment_fingerprint.clone(),
        })
    }

    pub fn scope(&self) -> CertificationTenantScope {
        self.scope
    }

    pub fn resource(&self, name: &str) -> Result<&ScopedDatasetResource, FixtureEnvironmentError> {
        self.resources
            .get(name)
            .ok_or_else(|| FixtureEnvironmentError::ResourceMissing(name.to_string()))
    }

    pub fn environment_fingerprint(&self) -> &str {
        &self.environment_fingerprint
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityEvidence {
    pub capability: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub resource: String,
    pub environment_fingerprint: String,
    pub input_hash: String,
    pub output_hash: String,
    pub evidence_hash: String,
}

impl CapabilityEvidence {
    pub fn new(
        capability: &str,
        scope: CertificationTenantScope,
        resource: &str,
        environment_fingerprint: &str,
        input: &Value,
        output: &Value,
    ) -> Self {
        let input_hash = hash_value(input);
        let output_hash = hash_value(output);
        let evidence_hash = hash_value(&serde_json::json!({
            "capability": capability,
            "company_id": scope.company_id,
            "environment_fingerprint": environment_fingerprint,
            "input_hash": input_hash,
            "organization_id": scope.organization_id,
            "output_hash": output_hash,
            "resource": resource,
        }));
        Self {
            capability: capability.to_string(),
            organization_id: scope.organization_id,
            company_id: scope.company_id,
            resource: resource.to_string(),
            environment_fingerprint: environment_fingerprint.to_string(),
            input_hash,
            output_hash,
            evidence_hash,
        }
    }
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum FixtureEnvironmentError {
    #[error("organization scope must be greater than zero")]
    OrganizationRequired,
    #[error("company scope must be greater than zero")]
    CompanyRequired,
    #[error("certification dataset must be an object")]
    DatasetMustBeObject,
    #[error("dataset resource '{0}' is not declared by the candidate")]
    UndeclaredResource(String),
    #[error("dataset resource '{0}' must be an object")]
    ResourceMustBeObject(String),
    #[error("dataset resource '{0}' is missing organizationId or companyId")]
    ResourceScopeMissing(String),
    #[error("dataset resource '{0}' does not match the claimed tenant scope")]
    ResourceScopeMismatch(String),
    #[error("dataset resource '{0}' is missing data")]
    ResourceDataMissing(String),
    #[error("dataset resource '{0}' is missing")]
    ResourceMissing(String),
}

fn required_u64(value: Option<&Value>) -> Option<u64> {
    value.and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

pub fn hash_value(value: &Value) -> String {
    let canonical = crate::wire_decode::canonicalize(value);
    let encoded = serde_json::to_vec(&canonical).unwrap_or_else(|_| b"null".to_vec());
    let mut hasher = Sha256::new();
    hasher.update(encoded);
    format!("sha256:{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment(dataset: Value) -> CandidateCertificationEnvironment {
        CandidateCertificationEnvironment {
            id: 10,
            organization_id: 7,
            skill_id: 11,
            fixture_id: 5,
            dataset,
            virtual_files: serde_json::json!({}),
            environment_fingerprint: format!("sha256:{}", "a".repeat(64)),
        }
    }

    #[test]
    fn accepts_declared_scope_bound_resource() {
        let scope = CertificationTenantScope::new(7, 9).expect("valid scope");
        let dataset = ImmutableCertificationDataset::parse(
            scope,
            &["inventory.low_stock.v1".to_string()],
            &environment(serde_json::json!({
                "inventory.low_stock.v1": {
                    "organizationId": 7,
                    "companyId": 9,
                    "data": {"products": [], "stockQuants": []}
                }
            })),
        )
        .expect("declared resource should parse");

        assert_eq!(
            dataset
                .resource("inventory.low_stock.v1")
                .expect("resource")
                .scope(),
            scope
        );
    }

    #[test]
    fn rejects_cross_tenant_and_undeclared_resources() {
        let scope = CertificationTenantScope::new(7, 9).expect("valid scope");
        let cross_tenant = environment(serde_json::json!({
            "inventory.low_stock.v1": {
                "organizationId": 7,
                "companyId": 10,
                "data": {}
            }
        }));
        assert_eq!(
            ImmutableCertificationDataset::parse(
                scope,
                &["inventory.low_stock.v1".to_string()],
                &cross_tenant,
            )
            .expect_err("cross-company resource must fail"),
            FixtureEnvironmentError::ResourceScopeMismatch("inventory.low_stock.v1".to_string())
        );

        let undeclared = environment(serde_json::json!({
            "inventory.all": {
                "organizationId": 7,
                "companyId": 9,
                "data": {}
            }
        }));
        assert_eq!(
            ImmutableCertificationDataset::parse(
                scope,
                &["inventory.low_stock.v1".to_string()],
                &undeclared,
            )
            .expect_err("undeclared resource must fail"),
            FixtureEnvironmentError::UndeclaredResource("inventory.all".to_string())
        );
    }
}
