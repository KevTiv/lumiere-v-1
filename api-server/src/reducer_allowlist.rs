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

    match name {
        "bootstrap_new_tenant" | "seed_dev_data" | "backfill_external_ids" => {
            Some("bootstrap and seed reducers are not callable via the public API")
        }
        "delete_organization" | "purge_organization_data" => {
            Some("destructive organization reducers are not callable via the public API")
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
        assert!(blocked_reducer_reason(
            "run_all_domain_tests",
            ReducerAllowlistMode::Strict
        )
        .is_some());
        assert!(blocked_reducer_reason(
            "bootstrap_new_tenant",
            ReducerAllowlistMode::Strict
        )
        .is_some());
        assert!(blocked_reducer_reason("create_lead", ReducerAllowlistMode::Strict).is_none());
    }

    #[test]
    fn off_allows_everything() {
        assert!(blocked_reducer_reason(
            "run_all_domain_tests",
            ReducerAllowlistMode::Off
        )
        .is_none());
    }
}
