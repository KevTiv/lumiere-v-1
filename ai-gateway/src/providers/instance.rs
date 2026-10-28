//! Provider driver vs provider instance (H5d).
//!
//! A [`ProviderDriver`] names protocol behaviour implemented in `llm.rs`. A
//! [`ProviderInstance`] is an organization/account-specific, server-owned
//! configuration of one driver. Instances never share mutable state: each owns
//! its credential reference, endpoint, model allow-list and capability
//! manifest. Selection applies organization, region/data-residency and driver
//! policy before cost ordering, records the audit fields budget admission
//! needs, and fallback may never cross an organization, region, policy or
//! shared-budget boundary (it denies instead of degrading).
//!
//! Persistence of [`SelectionRecord`] is intentionally not implemented here:
//! it needs a SpacetimeDB table, which is a follow-up. The type is serializable
//! so the durable projection can store it unchanged.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::llm::normalize_provider;
use crate::config::Config;

/// Protocol families the gateway can actually dispatch. `OpenAiCompatible` is
/// the OpenAI-shaped Kong gateway path in `llm.rs`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderDriver {
    Mistral,
    Gemini,
    OpenAiCompatible,
    Ollama,
}

impl ProviderDriver {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mistral => "mistral",
            Self::Gemini => "gemini",
            Self::OpenAiCompatible => "openai_compatible",
            Self::Ollama => "ollama",
        }
    }

    pub fn from_provider_name(raw: &str) -> Option<Self> {
        match normalize_provider(raw).as_str() {
            "mistral" => Some(Self::Mistral),
            "gemini" => Some(Self::Gemini),
            "ollama" => Some(Self::Ollama),
            "openai_compatible" | "openai-compatible" | "kong" => Some(Self::OpenAiCompatible),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderCapability {
    ToolCalling,
    StructuredOutput,
    ParallelRequests,
    Thinking,
}

/// What a given instance can actually do per model. `"*"` is a wildcard model
/// entry. The manifest is the only source of capability truth: a missing entry
/// means unsupported.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityManifest {
    /// Monotonic revision; an authoritative update with a lower or equal
    /// revision is rejected so stale data cannot re-grant a removed capability.
    pub revision: u64,
    pub models: BTreeMap<String, BTreeSet<ProviderCapability>>,
}

impl CapabilityManifest {
    pub fn supports(&self, model: &str, capability: ProviderCapability) -> bool {
        self.models
            .get(model)
            .or_else(|| self.models.get("*"))
            .is_some_and(|caps| caps.contains(&capability))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AllowedModels {
    Any,
    Only(BTreeSet<String>),
}

impl AllowedModels {
    fn allows(&self, model: &str) -> bool {
        match self {
            Self::Any => true,
            Self::Only(models) => models.contains(model),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstanceStatus {
    Active,
    Draining,
    Disabled,
}

/// Immutable price point used for budget admission. Selection records the
/// reference so spend can be tied to the exact snapshot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PricingSnapshot {
    pub reference: String,
    pub input_per_1k_microunits: u64,
    pub output_per_1k_microunits: u64,
}

#[derive(Clone, Debug)]
pub struct ProviderInstance {
    pub id: String,
    /// `None` is a platform-default instance (env configuration) usable by any
    /// organization; `Some` is exclusive to that organization.
    pub organization_id: Option<u64>,
    pub driver: ProviderDriver,
    /// Reference to a server-side secret (for example `env:MISTRAL_API_KEY`).
    /// Never the secret itself, never exposed through [`ProviderInstanceSummary`].
    pub credential_ref: Option<String>,
    pub endpoint: Option<String>,
    pub region: Option<String>,
    pub allowed_models: AllowedModels,
    pub capability_manifest: CapabilityManifest,
    pub pricing_snapshot_ref: Option<String>,
    pub status: InstanceStatus,
    /// Shared-budget identity; fallback never moves between different scopes.
    pub budget_scope: Option<String>,
}

/// Client-safe view: no credential reference or endpoint.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ProviderInstanceSummary {
    pub id: String,
    pub driver: ProviderDriver,
    pub region: Option<String>,
    pub status: InstanceStatus,
    pub capability_manifest: CapabilityManifest,
}

impl ProviderInstance {
    pub fn summary(&self) -> ProviderInstanceSummary {
        ProviderInstanceSummary {
            id: self.id.clone(),
            driver: self.driver,
            region: self.region.clone(),
            status: self.status,
            capability_manifest: self.capability_manifest.clone(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct SelectionRequest {
    pub organization_id: u64,
    pub model: String,
    pub required: BTreeSet<ProviderCapability>,
    /// Data-residency policy. `Some` requires an instance with a known region
    /// inside the set.
    pub allowed_regions: Option<BTreeSet<String>>,
    /// Organization driver policy.
    pub allowed_drivers: Option<BTreeSet<ProviderDriver>>,
    /// When set the instance must carry exactly this budget scope.
    pub budget_scope: Option<String>,
    pub preferred_instance: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionReason {
    Preferred,
    OnlyEligible,
    CostOrdered,
    Fallback,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExclusionCause {
    Organization,
    Region,
    DriverPolicy,
    BudgetScope,
    Status,
    Model,
    Capability,
    /// Fallback candidate differs from the primary on a hard boundary.
    FallbackOrganizationBoundary,
    FallbackRegionBoundary,
    FallbackBudgetBoundary,
    AlreadyFailed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Exclusion {
    pub instance_id: String,
    pub cause: ExclusionCause,
}

/// Audit record of one selection, including the pricing snapshot used for
/// budget admission.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SelectionRecord {
    pub driver: ProviderDriver,
    pub instance_id: String,
    pub instance_organization_id: Option<u64>,
    pub organization_id: u64,
    pub model: String,
    pub region: Option<String>,
    pub budget_scope: Option<String>,
    pub reason: SelectionReason,
    /// Human-readable region/organization policy applied before cost ordering.
    pub policy_reason: String,
    pub pricing_snapshot_ref: Option<String>,
    pub capability_revision: u64,
    pub fallback_of: Option<String>,
    pub excluded: Vec<Exclusion>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SelectionError {
    #[error("no eligible provider instance")]
    NoEligibleInstance { excluded: Vec<Exclusion> },
    #[error("preferred provider instance '{instance_id}' is not eligible")]
    PreferredIneligible {
        instance_id: String,
        cause: ExclusionCause,
    },
    #[error("fallback denied: no instance stays inside the organization, region, policy and budget boundary")]
    FallbackDenied { excluded: Vec<Exclusion> },
    #[error("unknown provider instance '{0}'")]
    UnknownInstance(String),
    #[error("provider instance id '{0}' is already registered")]
    DuplicateInstance(String),
    #[error("capability manifest revision {offered} is not newer than {current}")]
    StaleManifest { offered: u64, current: u64 },
}

#[derive(Clone, Debug, Default)]
pub struct ProviderRegistry {
    instances: BTreeMap<String, ProviderInstance>,
    pricing: BTreeMap<String, PricingSnapshot>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// One default platform instance per configured driver, preserving the
    /// existing environment configuration.
    pub fn from_config(config: &Config) -> Self {
        let mut registry = Self::new();
        let tools = |extra: Option<ProviderCapability>| {
            let mut caps = BTreeSet::from([
                ProviderCapability::ToolCalling,
                ProviderCapability::StructuredOutput,
                ProviderCapability::ParallelRequests,
            ]);
            caps.extend(extra);
            caps
        };
        let configured =
            |value: &Option<String>| value.as_deref().is_some_and(|v| !v.trim().is_empty());
        let default_instance =
            |id: &str,
             driver: ProviderDriver,
             credential_ref: Option<&str>,
             endpoint: Option<String>,
             models: BTreeMap<String, BTreeSet<ProviderCapability>>| {
                ProviderInstance {
                    id: id.to_string(),
                    organization_id: None,
                    driver,
                    credential_ref: credential_ref.map(str::to_string),
                    endpoint,
                    region: None,
                    allowed_models: AllowedModels::Any,
                    capability_manifest: CapabilityManifest {
                        revision: 1,
                        models,
                    },
                    pricing_snapshot_ref: None,
                    status: InstanceStatus::Active,
                    budget_scope: None,
                }
            };

        if configured(&config.mistral_api_key) {
            let mut models = BTreeMap::from([("*".to_string(), tools(None))]);
            for model in &config.mistral_reasoning_models {
                models.insert(model.clone(), tools(Some(ProviderCapability::Thinking)));
            }
            registry.insert_unchecked(default_instance(
                "default-mistral",
                ProviderDriver::Mistral,
                Some("env:MISTRAL_API_KEY"),
                None,
                models,
            ));
        }
        if configured(&config.google_api_key) {
            registry.insert_unchecked(default_instance(
                "default-gemini",
                ProviderDriver::Gemini,
                Some("env:GOOGLE_API_KEY"),
                None,
                BTreeMap::from([("*".to_string(), tools(None))]),
            ));
        }
        if configured(&config.kong_llm_url) {
            registry.insert_unchecked(default_instance(
                "default-openai-compatible",
                ProviderDriver::OpenAiCompatible,
                Some("env:KONG_LLM_SERVICE_TOKEN"),
                config.kong_llm_url.clone(),
                BTreeMap::from([("*".to_string(), tools(None))]),
            ));
        }
        // llm.rs dispatches Ollama without credentials, so it is always present.
        let ollama_caps = if config.ollama_supports_tool_calling {
            tools(None)
        } else {
            BTreeSet::new()
        };
        registry.insert_unchecked(default_instance(
            "default-ollama",
            ProviderDriver::Ollama,
            None,
            Some(config.ollama_url.clone()),
            BTreeMap::from([("*".to_string(), ollama_caps)]),
        ));
        registry
    }

    fn insert_unchecked(&mut self, instance: ProviderInstance) {
        self.instances.insert(instance.id.clone(), instance);
    }

    pub fn register(&mut self, instance: ProviderInstance) -> Result<(), SelectionError> {
        if self.instances.contains_key(&instance.id) {
            return Err(SelectionError::DuplicateInstance(instance.id));
        }
        self.insert_unchecked(instance);
        Ok(())
    }

    pub fn register_pricing(&mut self, snapshot: PricingSnapshot) {
        self.pricing.insert(snapshot.reference.clone(), snapshot);
    }

    pub fn get(&self, id: &str) -> Option<&ProviderInstance> {
        self.instances.get(id)
    }

    pub fn instances(&self) -> impl Iterator<Item = &ProviderInstance> {
        self.instances.values()
    }

    pub fn drivers(&self) -> BTreeSet<ProviderDriver> {
        self.instances.values().map(|i| i.driver).collect()
    }

    /// Replace one instance's manifest with authoritative data. Removed
    /// capabilities are gone, not merged; stale revisions are rejected.
    pub fn apply_authoritative_manifest(
        &mut self,
        instance_id: &str,
        manifest: CapabilityManifest,
    ) -> Result<(), SelectionError> {
        let instance = self
            .instances
            .get_mut(instance_id)
            .ok_or_else(|| SelectionError::UnknownInstance(instance_id.to_string()))?;
        if manifest.revision <= instance.capability_manifest.revision {
            return Err(SelectionError::StaleManifest {
                offered: manifest.revision,
                current: instance.capability_manifest.revision,
            });
        }
        instance.capability_manifest = manifest;
        Ok(())
    }

    /// True only when the instance's current manifest grants the capability.
    pub fn capability_available(
        &self,
        instance_id: &str,
        model: &str,
        capability: ProviderCapability,
    ) -> bool {
        self.instances
            .get(instance_id)
            .is_some_and(|i| i.capability_manifest.supports(model, capability))
    }

    fn cost_rank(&self, instance: &ProviderInstance) -> u64 {
        instance
            .pricing_snapshot_ref
            .as_ref()
            .and_then(|r| self.pricing.get(r))
            .map(|p| {
                p.input_per_1k_microunits
                    .saturating_add(p.output_per_1k_microunits)
            })
            .unwrap_or(u64::MAX)
    }

    fn policy_cause(
        instance: &ProviderInstance,
        request: &SelectionRequest,
    ) -> Option<ExclusionCause> {
        if instance
            .organization_id
            .is_some_and(|org| org != request.organization_id)
        {
            return Some(ExclusionCause::Organization);
        }
        if let Some(regions) = &request.allowed_regions {
            if !instance
                .region
                .as_ref()
                .is_some_and(|r| regions.contains(r))
            {
                return Some(ExclusionCause::Region);
            }
        }
        if let Some(drivers) = &request.allowed_drivers {
            if !drivers.contains(&instance.driver) {
                return Some(ExclusionCause::DriverPolicy);
            }
        }
        if let Some(scope) = &request.budget_scope {
            if instance.budget_scope.as_ref() != Some(scope) {
                return Some(ExclusionCause::BudgetScope);
            }
        }
        None
    }

    fn eligibility_cause(
        instance: &ProviderInstance,
        request: &SelectionRequest,
    ) -> Option<ExclusionCause> {
        Self::policy_cause(instance, request).or_else(|| {
            if instance.status != InstanceStatus::Active {
                Some(ExclusionCause::Status)
            } else if !instance.allowed_models.allows(&request.model) {
                Some(ExclusionCause::Model)
            } else if !request
                .required
                .iter()
                .all(|cap| instance.capability_manifest.supports(&request.model, *cap))
            {
                Some(ExclusionCause::Capability)
            } else {
                None
            }
        })
    }

    fn policy_reason(request: &SelectionRequest) -> String {
        let regions = request
            .allowed_regions
            .as_ref()
            .map(|r| r.iter().cloned().collect::<Vec<_>>().join(","))
            .unwrap_or_else(|| "any".into());
        let drivers = request
            .allowed_drivers
            .as_ref()
            .map(|d| d.iter().map(|d| d.as_str()).collect::<Vec<_>>().join(","))
            .unwrap_or_else(|| "any".into());
        format!(
            "org={} regions={regions} drivers={drivers} applied_before_cost",
            request.organization_id
        )
    }

    fn record(
        &self,
        instance: &ProviderInstance,
        request: &SelectionRequest,
        reason: SelectionReason,
        fallback_of: Option<String>,
        excluded: Vec<Exclusion>,
    ) -> SelectionRecord {
        SelectionRecord {
            driver: instance.driver,
            instance_id: instance.id.clone(),
            instance_organization_id: instance.organization_id,
            organization_id: request.organization_id,
            model: request.model.clone(),
            region: instance.region.clone(),
            budget_scope: instance.budget_scope.clone(),
            reason,
            policy_reason: Self::policy_reason(request),
            pricing_snapshot_ref: instance.pricing_snapshot_ref.clone(),
            capability_revision: instance.capability_manifest.revision,
            fallback_of,
            excluded,
        }
    }

    /// Organization, region and driver policy filter first; cost only orders
    /// what policy left.
    pub fn select(&self, request: &SelectionRequest) -> Result<SelectionRecord, SelectionError> {
        let mut excluded = Vec::new();
        let mut eligible = Vec::new();
        for instance in self.instances.values() {
            match Self::eligibility_cause(instance, request) {
                Some(cause) => excluded.push(Exclusion {
                    instance_id: instance.id.clone(),
                    cause,
                }),
                None => eligible.push(instance),
            }
        }
        if let Some(preferred) = &request.preferred_instance {
            return match eligible.iter().find(|i| &i.id == preferred) {
                Some(instance) => Ok(self.record(
                    instance,
                    request,
                    SelectionReason::Preferred,
                    None,
                    excluded,
                )),
                None => {
                    let cause = excluded
                        .iter()
                        .find(|e| &e.instance_id == preferred)
                        .map(|e| e.cause)
                        .unwrap_or(ExclusionCause::Organization);
                    Err(SelectionError::PreferredIneligible {
                        instance_id: preferred.clone(),
                        cause,
                    })
                }
            };
        }
        let only = eligible.len() == 1;
        eligible.sort_by_key(|i| (self.cost_rank(i), i.id.clone()));
        match eligible.first() {
            Some(instance) => {
                let reason = if only {
                    SelectionReason::OnlyEligible
                } else {
                    SelectionReason::CostOrdered
                };
                Ok(self.record(instance, request, reason, None, excluded))
            }
            None => Err(SelectionError::NoEligibleInstance { excluded }),
        }
    }

    /// Choose a replacement for `primary`. The replacement must satisfy the
    /// same request policy and keep the primary's organization, region and
    /// budget scope. Otherwise the fallback is denied.
    pub fn select_fallback(
        &self,
        primary: &SelectionRecord,
        request: &SelectionRequest,
        failed: &BTreeSet<String>,
    ) -> Result<SelectionRecord, SelectionError> {
        let source = self
            .instances
            .get(&primary.instance_id)
            .ok_or_else(|| SelectionError::UnknownInstance(primary.instance_id.clone()))?;
        let mut excluded = Vec::new();
        let mut eligible = Vec::new();
        for instance in self.instances.values() {
            let cause = if instance.id == source.id || failed.contains(&instance.id) {
                Some(ExclusionCause::AlreadyFailed)
            } else if instance.organization_id != source.organization_id {
                Some(ExclusionCause::FallbackOrganizationBoundary)
            } else if instance.region != source.region {
                Some(ExclusionCause::FallbackRegionBoundary)
            } else if instance.budget_scope != source.budget_scope {
                Some(ExclusionCause::FallbackBudgetBoundary)
            } else {
                Self::eligibility_cause(instance, request)
            };
            match cause {
                Some(cause) => excluded.push(Exclusion {
                    instance_id: instance.id.clone(),
                    cause,
                }),
                None => eligible.push(instance),
            }
        }
        eligible.sort_by_key(|i| (self.cost_rank(i), i.id.clone()));
        match eligible.first() {
            Some(instance) => Ok(self.record(
                instance,
                request,
                SelectionReason::Fallback,
                Some(source.id.clone()),
                excluded,
            )),
            None => Err(SelectionError::FallbackDenied { excluded }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps(list: &[ProviderCapability]) -> BTreeSet<ProviderCapability> {
        list.iter().copied().collect()
    }

    fn instance(
        id: &str,
        driver: ProviderDriver,
        org: Option<u64>,
        region: &str,
    ) -> ProviderInstance {
        ProviderInstance {
            id: id.into(),
            organization_id: org,
            driver,
            credential_ref: Some(format!("secret:{id}")),
            endpoint: None,
            region: Some(region.into()),
            allowed_models: AllowedModels::Any,
            capability_manifest: CapabilityManifest {
                revision: 1,
                models: BTreeMap::from([("*".into(), caps(&[ProviderCapability::ToolCalling]))]),
            },
            pricing_snapshot_ref: Some(format!("price-{id}")),
            status: InstanceStatus::Active,
            budget_scope: Some("budget-a".into()),
        }
    }

    fn price(id: &str, per_1k: u64) -> PricingSnapshot {
        PricingSnapshot {
            reference: format!("price-{id}"),
            input_per_1k_microunits: per_1k,
            output_per_1k_microunits: per_1k,
        }
    }

    fn request(org: u64) -> SelectionRequest {
        SelectionRequest {
            organization_id: org,
            model: "m".into(),
            required: caps(&[ProviderCapability::ToolCalling]),
            ..Default::default()
        }
    }

    // Fixture 4: two same-driver instances share no mutable state.
    #[test]
    fn same_driver_instances_are_isolated() {
        let mut registry = ProviderRegistry::new();
        registry
            .register(instance("gem-a", ProviderDriver::Gemini, Some(1), "eu"))
            .unwrap();
        let mut b = instance("gem-b", ProviderDriver::Gemini, Some(2), "us");
        b.credential_ref = Some("secret:other-account".into());
        registry.register(b).unwrap();
        assert!(registry
            .register(instance("gem-a", ProviderDriver::Gemini, Some(9), "eu"))
            .is_err());

        registry
            .apply_authoritative_manifest(
                "gem-a",
                CapabilityManifest {
                    revision: 2,
                    models: BTreeMap::new(),
                },
            )
            .unwrap();

        assert!(!registry.capability_available("gem-a", "m", ProviderCapability::ToolCalling));
        assert!(registry.capability_available("gem-b", "m", ProviderCapability::ToolCalling));
        assert_eq!(
            registry.get("gem-a").unwrap().capability_manifest.revision,
            2
        );
        assert_eq!(
            registry.get("gem-b").unwrap().capability_manifest.revision,
            1
        );
        assert_ne!(
            registry.get("gem-a").unwrap().credential_ref,
            registry.get("gem-b").unwrap().credential_ref
        );
        // Client-safe summary never carries credentials.
        let json = serde_json::to_string(&registry.get("gem-b").unwrap().summary()).unwrap();
        assert!(!json.contains("secret:"));
    }

    // Fixture 5: authoritative removal clears and denies; stale data cannot re-grant.
    #[test]
    fn authoritative_capability_removal_denies_and_stale_cannot_regrant() {
        let mut registry = ProviderRegistry::new();
        registry
            .register(instance("m1", ProviderDriver::Mistral, None, "eu"))
            .unwrap();
        assert!(registry.select(&request(1)).is_ok());

        registry
            .apply_authoritative_manifest(
                "m1",
                CapabilityManifest {
                    revision: 5,
                    models: BTreeMap::from([("*".into(), BTreeSet::new())]),
                },
            )
            .unwrap();
        assert!(!registry.capability_available("m1", "m", ProviderCapability::ToolCalling));
        assert!(matches!(
            registry.select(&request(1)),
            Err(SelectionError::NoEligibleInstance { .. })
        ));

        let stale = CapabilityManifest {
            revision: 4,
            models: BTreeMap::from([("*".into(), caps(&[ProviderCapability::ToolCalling]))]),
        };
        assert!(matches!(
            registry.apply_authoritative_manifest("m1", stale),
            Err(SelectionError::StaleManifest { .. })
        ));
        assert!(!registry.capability_available("m1", "m", ProviderCapability::ToolCalling));
    }

    #[test]
    fn selection_records_audit_fields() {
        let mut registry = ProviderRegistry::new();
        registry
            .register(instance("m1", ProviderDriver::Mistral, Some(7), "eu-west"))
            .unwrap();
        registry.register_pricing(price("m1", 40));
        let mut req = request(7);
        req.allowed_regions = Some(BTreeSet::from(["eu-west".to_string()]));
        let record = registry.select(&req).unwrap();
        assert_eq!(record.driver, ProviderDriver::Mistral);
        assert_eq!(record.instance_id, "m1");
        assert_eq!(record.model, "m");
        assert_eq!(record.region.as_deref(), Some("eu-west"));
        assert_eq!(record.pricing_snapshot_ref.as_deref(), Some("price-m1"));
        assert_eq!(record.reason, SelectionReason::OnlyEligible);
        assert!(record.policy_reason.contains("regions=eu-west"));
        assert_eq!(record.capability_revision, 1);
    }

    #[test]
    fn region_policy_beats_cost() {
        let mut registry = ProviderRegistry::new();
        registry
            .register(instance("cheap-us", ProviderDriver::Gemini, None, "us"))
            .unwrap();
        registry
            .register(instance("pricey-eu", ProviderDriver::Mistral, None, "eu"))
            .unwrap();
        registry.register_pricing(price("cheap-us", 1));
        registry.register_pricing(price("pricey-eu", 900));

        let unconstrained = registry.select(&request(1)).unwrap();
        assert_eq!(unconstrained.instance_id, "cheap-us");
        assert_eq!(unconstrained.reason, SelectionReason::CostOrdered);

        let mut eu_only = request(1);
        eu_only.allowed_regions = Some(BTreeSet::from(["eu".to_string()]));
        let record = registry.select(&eu_only).unwrap();
        assert_eq!(record.instance_id, "pricey-eu");
        assert!(record.excluded.contains(&Exclusion {
            instance_id: "cheap-us".into(),
            cause: ExclusionCause::Region
        }));

        // Unknown region is not residency-compliant.
        let mut no_region = instance("no-region", ProviderDriver::Ollama, None, "x");
        no_region.region = None;
        registry.register(no_region).unwrap();
        registry.register_pricing(price("no-region", 0));
        assert_eq!(registry.select(&eu_only).unwrap().instance_id, "pricey-eu");
    }

    #[test]
    fn organization_instances_are_not_selectable_by_other_organizations() {
        let mut registry = ProviderRegistry::new();
        registry
            .register(instance("org1", ProviderDriver::Mistral, Some(1), "eu"))
            .unwrap();
        assert!(registry.select(&request(1)).is_ok());
        assert!(matches!(
            registry.select(&request(2)),
            Err(SelectionError::NoEligibleInstance { .. })
        ));
    }

    // Fixture 15: fallback denies across org / region / budget / policy boundaries.
    #[test]
    fn fallback_never_crosses_boundaries() {
        let mut registry = ProviderRegistry::new();
        registry
            .register(instance("primary", ProviderDriver::Mistral, Some(1), "eu"))
            .unwrap();
        registry
            .register(instance("other-org", ProviderDriver::Gemini, Some(2), "eu"))
            .unwrap();
        registry
            .register(instance("platform", ProviderDriver::Gemini, None, "eu"))
            .unwrap();
        registry
            .register(instance(
                "other-region",
                ProviderDriver::Gemini,
                Some(1),
                "us",
            ))
            .unwrap();
        let mut other_budget = instance("other-budget", ProviderDriver::Gemini, Some(1), "eu");
        other_budget.budget_scope = Some("budget-b".into());
        registry.register(other_budget).unwrap();
        for id in ["other-org", "platform", "other-region", "other-budget"] {
            registry.register_pricing(price(id, 1));
        }

        let mut req = request(1);
        req.preferred_instance = Some("primary".into());
        let primary = registry.select(&req).unwrap();
        assert_eq!(primary.instance_id, "primary");

        let denied = registry
            .select_fallback(&primary, &req, &BTreeSet::new())
            .unwrap_err();
        let SelectionError::FallbackDenied { excluded } = denied else {
            panic!("expected denial");
        };
        let cause = |id: &str| excluded.iter().find(|e| e.instance_id == id).unwrap().cause;
        assert_eq!(
            cause("other-org"),
            ExclusionCause::FallbackOrganizationBoundary
        );
        assert_eq!(
            cause("platform"),
            ExclusionCause::FallbackOrganizationBoundary
        );
        assert_eq!(
            cause("other-region"),
            ExclusionCause::FallbackRegionBoundary
        );
        assert_eq!(
            cause("other-budget"),
            ExclusionCause::FallbackBudgetBoundary
        );

        // A same-boundary peer is allowed and recorded as a fallback.
        registry
            .register(instance("peer", ProviderDriver::Gemini, Some(1), "eu"))
            .unwrap();
        let fallback = registry
            .select_fallback(&primary, &req, &BTreeSet::new())
            .unwrap();
        assert_eq!(fallback.instance_id, "peer");
        assert_eq!(fallback.reason, SelectionReason::Fallback);
        assert_eq!(fallback.fallback_of.as_deref(), Some("primary"));

        // Driver policy applies to fallback too.
        let mut mistral_only = req.clone();
        mistral_only.allowed_drivers = Some(BTreeSet::from([ProviderDriver::Mistral]));
        assert!(matches!(
            registry.select_fallback(&primary, &mistral_only, &BTreeSet::new()),
            Err(SelectionError::FallbackDenied { .. })
        ));
    }

    #[test]
    fn default_instances_follow_existing_configuration() {
        let mut config = test_config();
        let registry = ProviderRegistry::from_config(&config);
        assert_eq!(registry.drivers(), BTreeSet::from([ProviderDriver::Ollama]));
        assert!(!registry.capability_available(
            "default-ollama",
            "x",
            ProviderCapability::ToolCalling
        ));

        config.mistral_api_key = Some("k".into());
        config.google_api_key = Some("g".into());
        config.kong_llm_url = Some("http://kong".into());
        config.ollama_supports_tool_calling = true;
        let registry = ProviderRegistry::from_config(&config);
        assert_eq!(registry.instances().count(), 4);
        assert!(registry.capability_available(
            "default-ollama",
            "x",
            ProviderCapability::ToolCalling
        ));
        assert_eq!(
            registry
                .get("default-mistral")
                .unwrap()
                .credential_ref
                .as_deref(),
            Some("env:MISTRAL_API_KEY")
        );
        assert!(registry.select(&request(5)).is_ok());
    }

    #[test]
    fn driver_names_normalize() {
        assert_eq!(
            ProviderDriver::from_provider_name("Google"),
            Some(ProviderDriver::Gemini)
        );
        assert_eq!(
            ProviderDriver::from_provider_name("kong"),
            Some(ProviderDriver::OpenAiCompatible)
        );
        assert_eq!(ProviderDriver::from_provider_name("nope"), None);
    }

    fn test_config() -> Config {
        crate::providers::readiness_tests::test_config()
    }
}
