use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    low_stock,
    manifest::{ReviewMetadata, ReviewStatus, SkillManifest},
    report_composer,
};

pub type ContractValidator = fn(&Value) -> Result<(), String>;

#[derive(Clone, Debug)]
pub struct NamedResourceContract {
    pub name: String,
    pub review: ReviewMetadata,
    pub output_type: String,
    pub rows_field: String,
    pub validate_input: ContractValidator,
    pub validate_output: ContractValidator,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DataScope {
    pub organization_id: u64,
    pub company_id: u64,
    pub named_resource: String,
    pub output_type: String,
    pub rows_field: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ScopeError {
    NoNamedResource,
    ResourceNotAllowed(String),
    ResourceUnknown(String),
    ResourceNotPromoted(String),
    OutputContractMismatch(String),
}

impl ScopeError {
    pub fn message(&self) -> String {
        match self {
            Self::NoNamedResource => "at least one named read resource is required".to_string(),
            Self::ResourceNotAllowed(resource) => {
                format!("named resource '{resource}' is not allowed by the skill manifest")
            }
            Self::ResourceUnknown(resource) => {
                format!("named resource '{resource}' has no reviewed contract")
            }
            Self::ResourceNotPromoted(resource) => {
                format!("named resource '{resource}' is not promoted")
            }
            Self::OutputContractMismatch(resource) => format!(
                "named resource '{resource}' output contract does not match the skill manifest"
            ),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ResourceRegistry {
    contracts: BTreeMap<String, NamedResourceContract>,
}

impl ResourceRegistry {
    pub fn built_in() -> Self {
        let mut registry = Self::default();
        registry.insert(low_stock::resource_contract());
        registry.insert(report_composer::resource_contract());
        registry
    }

    pub fn insert(&mut self, contract: NamedResourceContract) {
        self.contracts.insert(contract.name.clone(), contract);
    }

    pub fn get(&self, name: &str) -> Option<&NamedResourceContract> {
        self.contracts.get(name)
    }
}

#[derive(Clone, Debug)]
pub struct DataScopeResolver {
    resources: ResourceRegistry,
}

impl DataScopeResolver {
    pub fn new(resources: ResourceRegistry) -> Self {
        Self { resources }
    }

    pub fn resources(&self) -> &ResourceRegistry {
        &self.resources
    }

    pub fn resolve(
        &self,
        manifest: &SkillManifest,
        organization_id: u64,
        company_id: u64,
        requested_resources: &[String],
    ) -> Result<Vec<DataScope>, ScopeError> {
        if requested_resources.is_empty() {
            return Err(ScopeError::NoNamedResource);
        }

        let allowed: BTreeSet<&str> = manifest
            .named_resources
            .iter()
            .map(String::as_str)
            .collect();
        let mut seen = BTreeSet::new();
        let mut scopes = Vec::new();

        for resource in requested_resources {
            if !allowed.contains(resource.as_str()) {
                return Err(ScopeError::ResourceNotAllowed(resource.clone()));
            }
            let contract = self
                .resources
                .get(resource)
                .ok_or_else(|| ScopeError::ResourceUnknown(resource.clone()))?;
            if contract.review.status != ReviewStatus::Promoted {
                return Err(ScopeError::ResourceNotPromoted(resource.clone()));
            }
            if contract.output_type != manifest.output_type {
                return Err(ScopeError::OutputContractMismatch(resource.clone()));
            }
            if seen.insert(resource.as_str()) {
                scopes.push(DataScope {
                    organization_id,
                    company_id,
                    named_resource: resource.clone(),
                    output_type: contract.output_type.clone(),
                    rows_field: contract.rows_field.clone(),
                });
            }
        }

        Ok(scopes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_only_promoted_manifest_resources() {
        let manifest = low_stock::manifest();
        let resolver = DataScopeResolver::new(ResourceRegistry::built_in());
        let scopes = resolver
            .resolve(
                &manifest,
                1,
                2,
                &[low_stock::LOW_STOCK_RESOURCE.to_string()],
            )
            .unwrap();
        assert_eq!(scopes.len(), 1);
        assert_eq!(scopes[0].company_id, 2);
    }

    #[test]
    fn rejects_resource_not_named_by_manifest() {
        let manifest = low_stock::manifest();
        let resolver = DataScopeResolver::new(ResourceRegistry::built_in());
        assert_eq!(
            resolver.resolve(&manifest, 1, 2, &["inventory.all".to_string()]),
            Err(ScopeError::ResourceNotAllowed("inventory.all".to_string()))
        );
    }
}
