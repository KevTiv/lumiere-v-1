//! H6 low_stock pilot — flagged path through the governed loop.
//!
//! The legacy `low_stock` harness path (`harness/low_stock.rs:scan_low_stock`)
//! stays untouched. This pilot proves the same business result can be obtained
//! via the H3→H5 admission stack (generated reads + per-call policy + spend
//! admission) without granting new capabilities. It is behind an explicit
//! allowlist: only `low_stock` v1 and only when the caller already supplies the
//! reviewed `PlannedToolCall`s for the 3 inventory read capabilities. No new
//! production LLM dispatch is added here; the caller supplies the `LlmRequest`
//! and reviewed calls, and the loop runs through `run_recorded_loop`.
//!
//! Flag: the pilot is *code-level* flagged — `is_low_stock_pilot` checks the
//! skill shape, not an env var, so no new runtime flag leaks into operator
//! config. Wider migration (H7) will expand `legacy_fence.rs` skill-by-skill.

use crate::harness::low_stock::{LOW_STOCK_SKILL_KEY, LOW_STOCK_SKILL_VERSION};

/// Pilot skill identity per `ai-harness-luna-execution-plan.md:12` — green,
/// read-only, one-step, company-scoped, fixture-certified.
pub const PILOT_SKILL_KEY: &str = LOW_STOCK_SKILL_KEY;
pub const PILOT_SKILL_VERSION: u32 = LOW_STOCK_SKILL_VERSION;

/// Returns true only for the single flagged pilot skill/version.
pub fn is_low_stock_pilot(skill_key: &str, skill_version: u32) -> bool {
    skill_key.trim() == PILOT_SKILL_KEY && skill_version == PILOT_SKILL_VERSION
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_low_stock_v1_is_pilot() {
        assert!(is_low_stock_pilot("low_stock", 1));
        assert!(is_low_stock_pilot(" low_stock ", 1));
        assert!(!is_low_stock_pilot("low_stock", 2));
        assert!(!is_low_stock_pilot("report_composer", 1));
        assert!(!is_low_stock_pilot("", 1));
    }
}
