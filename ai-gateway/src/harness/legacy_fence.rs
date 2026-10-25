//! Migration policy for the retired model-driven skill orchestrator.
//!
//! `/v1/skills/run` cannot prove that an arbitrary tenant skill is outside
//! harness governance, so it has no execution allowlist. Bundled skills name
//! their replacement endpoint here; custom skills must first receive a
//! governed adapter. Deterministic report and inventory endpoints are separate
//! routes and are not affected by this fence.

pub const GOVERNED_SKILL_REPLACEMENTS: &[(&str, &str)] = &[
    ("report_composer", "/v1/skills/report/compose"),
    ("low_stock", "/v1/skills/inventory/low-stock"),
    ("import_mapping", "/v1/skills/import-mapping"),
    ("insights_scan", "/v1/skills/insights-scan"),
    ("daily_briefing", "/v1/skills/daily-briefing"),
    ("report_analysis", "/v1/skills/report-analysis"),
    ("process_research", "/v1/skills/process-research"),
    ("price_search", "/v1/skills/price-search"),
    ("supplier_discovery", "/v1/skills/supplier-discovery"),
    ("rag_generation", "/v1/rag"),
    ("form_suggestion", "/v1/forms/suggest"),
    ("action_draft_generation", "/v1/actions/draft"),
];

pub fn governed_skill_replacement(skill_key: &str) -> Option<&'static str> {
    let skill_key = skill_key.trim();
    GOVERNED_SKILL_REPLACEMENTS
        .iter()
        .find_map(|(known, route)| (*known == skill_key).then_some(*route))
}

pub fn is_harness_managed_skill(skill_key: &str) -> bool {
    governed_skill_replacement(skill_key).is_some()
}

pub fn ensure_legacy_orchestrator_allowed(skill_key: &str) -> Result<(), String> {
    let skill_key = skill_key.trim();
    if let Some(route) = governed_skill_replacement(skill_key) {
        return Err(format!(
            "skill '{skill_key}' has migrated from legacy /v1/skills/run; use {route}"
        ));
    }
    Err(format!(
        "skill '{skill_key}' cannot run through retired legacy /v1/skills/run; register a governed adapter before execution"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fences_harness_managed_skills() {
        assert!(is_harness_managed_skill("report_composer"));
        assert!(is_harness_managed_skill("low_stock"));
        assert!(is_harness_managed_skill("report_analysis"));
        assert!(is_harness_managed_skill("price_search"));
        assert!(ensure_legacy_orchestrator_allowed("report_analysis").is_err());
        assert!(ensure_legacy_orchestrator_allowed("low_stock").is_err());
        assert!(ensure_legacy_orchestrator_allowed("custom_tenant_skill").is_err());
        assert!(ensure_legacy_orchestrator_allowed(" brand_new_skill ").is_err());
        assert!(ensure_legacy_orchestrator_allowed("").is_err());
    }

    #[test]
    fn every_bundled_migration_has_a_unique_explicit_replacement() {
        let mut skills = std::collections::HashSet::new();
        let mut routes = std::collections::HashSet::new();
        for (skill, route) in GOVERNED_SKILL_REPLACEMENTS {
            assert!(skills.insert(*skill), "duplicate skill migration: {skill}");
            assert!(
                routes.insert(*route),
                "duplicate replacement route: {route}"
            );
            assert!(route.starts_with("/v1/"));
            assert_eq!(governed_skill_replacement(skill), Some(*route));
        }
        assert_eq!(skills.len(), 12);
    }

    #[test]
    fn retirement_error_names_replacement_or_adapter_requirement() {
        let migrated = ensure_legacy_orchestrator_allowed(" low_stock ").unwrap_err();
        assert!(migrated.contains("/v1/skills/inventory/low-stock"));

        let custom = ensure_legacy_orchestrator_allowed("tenant_custom").unwrap_err();
        assert!(custom.contains("register a governed adapter"));
    }
}
