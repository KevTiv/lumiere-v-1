//! Blocks legacy orchestrator execution for harness-managed skills.

pub const HARNESS_MANAGED_SKILL_KEYS: &[&str] = &["report_composer", "low_stock"];

pub fn is_harness_managed_skill(skill_key: &str) -> bool {
    HARNESS_MANAGED_SKILL_KEYS
        .iter()
        .any(|key| *key == skill_key.trim())
}

pub fn ensure_legacy_orchestrator_allowed(skill_key: &str) -> Result<(), String> {
    if is_harness_managed_skill(skill_key) {
        return Err(format!(
            "skill '{skill_key}' must run through the harness route, not legacy /v1/skills/run"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fences_harness_managed_skills() {
        assert!(is_harness_managed_skill("report_composer"));
        assert!(is_harness_managed_skill("low_stock"));
        assert!(!is_harness_managed_skill("report_analysis"));
        assert!(ensure_legacy_orchestrator_allowed("report_analysis").is_ok());
        assert!(ensure_legacy_orchestrator_allowed("low_stock").is_err());
    }
}
