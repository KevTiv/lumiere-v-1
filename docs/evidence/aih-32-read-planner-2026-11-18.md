# AIH-32 multilingual read planner (WIP) - 2026-11-18

Status: draft, partial. Nothing here was compiled or run locally (the
lumiere-contracts crate is OOM-killed in this environment); CI is the first compile.

## Done (files added, intentionally NOT yet declared in `harness/mod.rs`, so the build is unchanged)
- `ai-gateway/src/harness/lexicon.rs`: lexicon schema (serde, deny_unknown_fields), NFKC + case-fold
  `Folded` view with offset map, merged per-locale word lists (en always; rw adds en+fr), validation, tests.
- `ai-gateway/src/harness/read_plan.rs`: `ReadPlan` enum (Record, FollowUp, PeriodSummary, FarmPortfolio,
  FarmComparison, SupportRecord, Guide, Semantic, Handoff, Clarify), `PlanFallback` trait +
  `SemanticFallback`, `plan`/`plan_at`, ports of the TS sales/farm/support parsers, `to_json` for fixtures.
- `ai-gateway/Cargo.toml` + `Cargo.lock`: `unicode-normalization = "0.1"` (already in the lockfile).

## Remaining
See the PR "Remaining work" checklist.
