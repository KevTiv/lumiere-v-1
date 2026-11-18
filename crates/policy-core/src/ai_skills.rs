//! Repository-owned AI skills and the namespace used by member restrictions.

pub const BUILTIN_SKILL_KEYS: &[&str] = &[
    "action_draft_generation",
    "bank_reconciliation_review",
    "create_sale_order_draft",
    "credit_hold_summary",
    "daily_briefing",
    "delivery_run_summary",
    "expense_evidence_review",
    "finance_report_review",
    "finance_variance_review",
    "form_suggestion",
    "import_mapping",
    "insights_scan",
    "low_stock",
    "period_close_review",
    "price_search",
    "process_research",
    "rag_generation",
    "report_analysis",
    "report_composer",
    "supplier_discovery",
];

pub const USER_SKILL_PERMISSION_PREFIX: &str = "ai_skill.";

pub fn is_builtin_skill(key: &str) -> bool {
    BUILTIN_SKILL_KEYS.binary_search(&key).is_ok()
}

/// Only organization-authored skills enter the version/test/publish lifecycle.
/// A tenant catalog copy of a built-in key remains application-owned.
pub fn is_user_created_skill(
    key: &str,
    is_system: bool,
    skill_organization_id: u64,
    organization_id: u64,
) -> bool {
    organization_id > 0
        && skill_organization_id == organization_id
        && !is_system
        && !is_builtin_skill(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_keys_are_exact_and_sorted() {
        assert!(BUILTIN_SKILL_KEYS.windows(2).all(|keys| keys[0] < keys[1]));
        assert!(is_builtin_skill("rag_generation"));
        assert!(!is_builtin_skill("rag_generation "));
        assert!(!is_builtin_skill("embedding_query"));
        assert!(!is_builtin_skill("tenant_skill"));
    }

    #[test]
    fn only_user_created_skills_need_publication() {
        assert!(is_user_created_skill("tenant_stock_review", false, 7, 7));
        for key in BUILTIN_SKILL_KEYS {
            assert!(!is_user_created_skill(key, false, 7, 7), "{key}");
            assert!(!is_user_created_skill(key, true, 0, 7), "{key}");
        }
        assert!(!is_user_created_skill("tenant_stock_review", true, 7, 7));
        assert!(!is_user_created_skill("tenant_stock_review", false, 8, 7));
        assert!(!is_user_created_skill("tenant_stock_review", false, 0, 0));
    }
}
