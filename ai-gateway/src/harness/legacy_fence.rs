//! Denies model-driven execution through the legacy orchestrator.
//!
//! The old route has no trustworthy way to prove that an arbitrary tenant
//! skill is outside harness governance. It is therefore deny-by-default. An
//! eventual exception must be an explicitly reviewed deterministic adapter;
//! generated prose and tool-calling skills must use the governed route.

pub const HARNESS_MANAGED_SKILL_KEYS: &[&str] = &[
    "report_composer",
    "low_stock",
    "import_mapping",
    "insights_scan",
    "daily_briefing",
    "report_analysis",
    "process_research",
    "price_search",
    "supplier_discovery",
];

/// Explicit exceptions for deterministic, non-model legacy adapters.
///
/// Kept empty until an adapter is reviewed end-to-end. The allowlist makes a
/// future exception deliberate; unknown or tenant-defined skills never gain
/// legacy execution authority merely by choosing a new key.
pub const LEGACY_DETERMINISTIC_SKILL_KEYS: &[&str] = &[];

pub fn is_harness_managed_skill(skill_key: &str) -> bool {
    HARNESS_MANAGED_SKILL_KEYS.contains(&skill_key.trim())
}

pub fn ensure_legacy_orchestrator_allowed(skill_key: &str) -> Result<(), String> {
    let skill_key = skill_key.trim();
    if LEGACY_DETERMINISTIC_SKILL_KEYS.contains(&skill_key) {
        return Ok(());
    }
    Err(format!(
        "skill '{skill_key}' cannot run through legacy /v1/skills/run; use the governed harness route"
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
        assert!(LEGACY_DETERMINISTIC_SKILL_KEYS.is_empty());
    }
}
