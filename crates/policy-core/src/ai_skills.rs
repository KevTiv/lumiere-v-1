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
}
