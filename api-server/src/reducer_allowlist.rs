//! Production guard for generic `POST /v1/call/{reducer}`.
//!
//! In `strict` mode, reducers matching deny patterns are blocked before reaching SpacetimeDB.

use stdb_config::runtime_is_production;

/// Allowlist enforcement mode (env `LUMIERE_REDUCER_ALLOWLIST`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReducerAllowlistMode {
    /// No gateway-side filtering (local dev default).
    Off,
    /// Block known-dangerous reducers (production default).
    Strict,
}

impl ReducerAllowlistMode {
    pub fn from_env() -> Self {
        match std::env::var("LUMIERE_REDUCER_ALLOWLIST")
            .ok()
            .map(|s| s.trim().to_ascii_lowercase())
        {
            Some(ref s) if s == "off" || s == "false" || s == "0" => Self::Off,
            Some(ref s) if s == "strict" || s == "true" || s == "1" => Self::Strict,
            None if runtime_is_production() => Self::Strict,
            _ => Self::Off,
        }
    }
}

/// Returns `Some(reason)` when the reducer must not be invoked through the public call endpoint.
pub fn blocked_reducer_reason(reducer: &str, mode: ReducerAllowlistMode) -> Option<&'static str> {
    if mode == ReducerAllowlistMode::Off {
        return None;
    }

    let name = reducer.trim();
    if name.is_empty() {
        return Some("reducer name is required");
    }

    if name.starts_with("run_all_") && name.ends_with("_tests") {
        return Some("domain test reducers are not callable via the public API");
    }

    if name.starts_with("run_") && name.ends_with("_test") {
        return Some("domain test reducers are not callable via the public API");
    }

    match name {
        "bootstrap_new_tenant" | "seed_dev_data" | "backfill_external_ids" => {
            Some("bootstrap and seed reducers are not callable via the public API")
        }
        "delete_organization" | "purge_organization_data" => {
            Some("destructive organization reducers are not callable via the public API")
        }
        "finalize_audit_log_archive" => {
            Some("cold-tier finalize reducers require the trusted drainer's server identity")
        }
        "record_ai_skill_test_run"
        | "claim_ai_skill_certification"
        | "complete_ai_skill_certification"
        | "fail_ai_skill_certification"
        | "register_ai_skill_certification_runtime_profile" => {
            Some("AI skill test results require the trusted certification executor")
        }
        _ if name.starts_with("import_") && name.ends_with("_csv") => {
            Some("bulk CSV import reducers require dedicated endpoints")
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_blocks_test_and_bootstrap_reducers() {
        assert!(
            blocked_reducer_reason("run_all_domain_tests", ReducerAllowlistMode::Strict).is_some()
        );
        assert!(
            blocked_reducer_reason("bootstrap_new_tenant", ReducerAllowlistMode::Strict).is_some()
        );
        assert!(blocked_reducer_reason("create_lead", ReducerAllowlistMode::Strict).is_none());
    }

    #[test]
    fn off_allows_everything() {
        assert!(
            blocked_reducer_reason("run_all_domain_tests", ReducerAllowlistMode::Off).is_none()
        );
    }

    #[test]
    fn strict_blocks_individual_test_reducers() {
        assert!(blocked_reducer_reason(
            "run_inventory_receipt_quant_test",
            ReducerAllowlistMode::Strict
        )
        .is_some());
        assert!(
            blocked_reducer_reason("run_helpdesk_ticket_test", ReducerAllowlistMode::Strict)
                .is_some()
        );
    }

    #[test]
    fn strict_blocks_csv_import_reducers() {
        assert!(
            blocked_reducer_reason("import_contact_csv", ReducerAllowlistMode::Strict).is_some()
        );
    }

    #[test]
    fn strict_blocks_caller_recorded_ai_skill_test_results() {
        for reducer in [
            "record_ai_skill_test_run",
            "claim_ai_skill_certification",
            "complete_ai_skill_certification",
            "fail_ai_skill_certification",
            "register_ai_skill_certification_runtime_profile",
        ] {
            assert_eq!(
                blocked_reducer_reason(reducer, ReducerAllowlistMode::Strict),
                Some("AI skill test results require the trusted certification executor"),
                "{reducer} should not be callable through the public API",
            );
        }
    }

    #[test]
    fn strict_blocks_audit_cold_tier_finalize() {
        assert!(
            blocked_reducer_reason("finalize_audit_log_archive", ReducerAllowlistMode::Strict)
                .is_some(),
            "finalize_audit_log_archive has no auth check of its own — it trusts the caller's \
             checksum, so it must not be reachable through the public API (only the drainer's \
             server-token client calls it directly against SpacetimeDB, bypassing this gateway)"
        );
    }

    #[test]
    fn strict_blocks_empty_reducer_name() {
        assert!(blocked_reducer_reason("   ", ReducerAllowlistMode::Strict).is_some());
    }

    #[test]
    fn strict_allows_user_update_delete_reducers() {
        for reducer in [
            "update_contact",
            "delete_contact",
            "delete_lead",
            "update_ticket",
            "update_opportunity",
            "delete_product_category",
            "update_sale_order",
            "update_payment_term",
            "delete_payment_term",
        ] {
            assert!(
                blocked_reducer_reason(reducer, ReducerAllowlistMode::Strict).is_none(),
                "{reducer} should not be blocked in strict mode"
            );
        }

        assert!(
            blocked_reducer_reason("delete_organization", ReducerAllowlistMode::Strict).is_some()
        );
        assert!(blocked_reducer_reason(
            "run_crm_contact_update_delete_test",
            ReducerAllowlistMode::Strict
        )
        .is_some());
        assert!(blocked_reducer_reason(
            "run_inventory_product_update_test",
            ReducerAllowlistMode::Strict
        )
        .is_some());
        assert!(blocked_reducer_reason(
            "run_sales_order_update_test",
            ReducerAllowlistMode::Strict
        )
        .is_some());
        assert!(blocked_reducer_reason(
            "run_accounting_payment_term_update_test",
            ReducerAllowlistMode::Strict
        )
        .is_some());
    }
}
