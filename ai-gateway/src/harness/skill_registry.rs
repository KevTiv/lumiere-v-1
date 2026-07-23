use std::collections::BTreeMap;

use super::{
    daily_briefing, distributor_controls, governed_llm_skills, import_mapping, insights_scan,
    low_stock,
    manifest::{SkillManifest, SkillVersionRef},
    red_action_drafts, report_composer,
};

#[derive(Clone, Debug, Default)]
pub struct SkillRegistry {
    manifests: BTreeMap<SkillVersionRef, SkillManifest>,
}

impl SkillRegistry {
    pub fn built_in() -> Self {
        let mut registry = Self::default();
        registry.insert(distributor_controls::credit_hold_manifest());
        registry.insert(distributor_controls::delivery_run_manifest());
        registry.insert(low_stock::manifest());
        registry.insert(report_composer::manifest());
        registry.insert(import_mapping::manifest());
        registry.insert(insights_scan::manifest());
        registry.insert(daily_briefing::manifest());
        registry.insert(governed_llm_skills::report_analysis_manifest());
        registry.insert(governed_llm_skills::process_research_manifest());
        registry.insert(governed_llm_skills::price_search_manifest());
        registry.insert(governed_llm_skills::supplier_discovery_manifest());
        registry.insert(red_action_drafts::create_sale_order_draft_manifest());
        registry
    }

    pub fn insert(&mut self, manifest: SkillManifest) {
        self.manifests.insert(manifest.skill.clone(), manifest);
    }

    pub fn exact(manifest: SkillManifest) -> Self {
        let mut registry = Self::default();
        registry.insert(manifest);
        registry
    }

    pub fn get(&self, skill: &SkillVersionRef) -> Option<&SkillManifest> {
        self.manifests.get(skill)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_requires_an_exact_reviewed_version() {
        let registry = SkillRegistry::built_in();
        assert!(registry
            .get(&SkillVersionRef::new(
                low_stock::LOW_STOCK_SKILL_KEY,
                low_stock::LOW_STOCK_SKILL_VERSION
            ))
            .is_some());
        assert!(registry
            .get(&SkillVersionRef::new(low_stock::LOW_STOCK_SKILL_KEY, 2))
            .is_none());
    }
}
