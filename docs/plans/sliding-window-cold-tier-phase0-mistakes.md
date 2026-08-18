# Phase 0 review retro: what went wrong in commit `856ab5e2b`

**Context:** commit `856ab5e2b` ("feat: complete cold-tier Phase 0 safety foundation",
authored by Mistral Vibe) marked all nine Phase 0 checklist items in
[sliding-window-cold-tier.md](./sliding-window-cold-tier.md) as done, with a commit
message citing passing tests, `make check-codegen` exit 0, and clean `cargo fmt`. A
follow-up review (8 finder passes + hand verification) found eight real defects
inside code the checklist had already marked complete. This doc records what the
verification step missed and why, so the same gaps don't repeat in Phase 1+.

All eight findings below were fixed in a follow-up commit on this branch.

## What was claimed vs. what was true

| Checklist claim | What was actually true |
|---|---|
| "Global cursor/ordering contract" — done | `PageSpec.cursor` was defined but never read by `compile_sql`; keyset pagination did not apply the cursor at all. |
| Cursor encoding is "lossless" (commit message, module doc comment) | `json_to_scalar` guessed U64 vs Text from JSON shape; a `Text` value that looked numeric (`"007"`) silently decoded as `U64(7)`, losing the original value. |
| `ResourceReadPlan` + STDB/PG compilers — done | `ReadPredicate::In` with an empty list compiled to `column IN ()`, invalid SQL. Multi-key cursors with mixed ASC/DESC silently used the wrong comparison operator instead of erroring. `QuotingStyle`'s own doc comments claimed identifier quoting; the implementation emitted zero quote characters. |
| Exit gate: "no archive-capable code relies on ... silent type coercion" | `parse_type_str` treated *any* unrecognized type name as `GeneratedType::Struct` (JSONB) with no error — a scan gap or typo would silently produce wrong DDL/codecs. This wasn't hypothetical: rerunning codegen after tightening this immediately failed on a real type, `__sdk::ScheduleAt`, that had been silently mis-typed as `Struct` all along. |
| "Add generated archive/hydration manifests" — done, schema-IR extraction — done | Secondary `#[unique]` constraints (beyond the primary key) were dropped: index extraction only recognized the *first* `add_unique_constraint::<...>` call per table and hardcoded every other index to `unique: false`. The real bindings directory already had 15 such secondary unique columns across existing tables — this wasn't a "future table" risk, it was live data loss in the schema IR at commit time. |
| "Extend `make check-codegen`" — done | True for the artifacts it tracks, but the checklist item "Generate Rust client bindings ... as part of the canonical codegen flow" implied end-to-end CI coverage. In fact `check-codegen` only diffs derived artifacts against the *already-committed* bindings; it never re-runs `generate-stdb-rust-sdk` against the live SpacetimeDB module, so schema drift between the deployed module and the committed bindings is invisible to CI. |

## Why the original verification didn't catch these

1. **Tests were written by the same pass that wrote the code, against the same
   assumptions.** Every cold_tier and codegen unit test passed — because they only
   exercised the happy path each function's author had in mind (single-key
   same-direction cursors, known types, columns with no special characters, PK-only
   unique constraints). None of the tests tried an adversarial or edge input:
   an empty `IN` list, a `Text` value shaped like a number, a mixed-direction order,
   an unrecognized type name, a second `#[unique]` column. Passing tests were treated
   as evidence of correctness rather than evidence of coverage.

2. **"Compiles + tests green + fmt clean" was conflated with "logic correct."**
   The commit message's verification section lists exactly those three signals.
   None of the eight defects would show up in any of them — they're all either
   silent-wrong-output bugs (no panic, no test failure) or a documentation/contract
   mismatch (`QuotingStyle` claims quoting it doesn't do; a checklist item claims CI
   coverage it doesn't have).

3. **Dead code was checked off as if it were integrated code.** `api-server/src/cold_tier/`
   has zero callers anywhere in the codebase — confirmed by grep before and after
   the fix. Marking "`ResourceReadPlan` and STDB/PG compilers" complete without any
   caller means the only thing that exercised this code was its own unit tests,
   which — see point 1 — only covered the paths their own author anticipated.
   A module with no real caller gets none of the incidental scrutiny that comes from
   another part of the codebase actually depending on its output.

4. **"Generalized infrastructure" was assumed generalized without testing it against
   more than the one shape it needs today.** `audit_log` — the only Phase 1 target —
   has a single-key `id DESC` order, no `IN` predicates, and one PK-only unique
   constraint. Every one of the eight bugs is invisible on that exact shape and
   only surfaces on a shape a *different* table would need (multi-key order, a
   secondary unique index, an `IN` predicate, a type outside the primitive set).
   Code that only works for the single case it was tested against, while being
   documented and checked off as a general-purpose contract for "future mutable
   resources," is a scope mismatch between what was claimed and what was verified.

5. **The plan's own exit gate wasn't used as a checklist during self-review.**
   Phase 0's stated exit gate — "no archive-capable code relies on ... silent type
   coercion" — directly names the defect found in `parse_type_str`. The gate was
   restated as satisfied in the same commit that violated it; nothing in the
   verification process appears to have re-checked the diff against the gate's own
   wording line by line.

## Takeaways for Phase 1 and beyond

- Treat "tests pass" as necessary, not sufficient — for new parsing/compilation
  logic, write at least one adversarial test per function *before* marking a
  checklist item done: an empty collection, a boundary/edge-case input, a value
  that could be confused with another type, a second occurrence of something the
  code assumed was singular.
- Before checking off an exit gate, re-read its exact wording against the diff,
  not against a summary of the diff.
- Code with no caller yet should be flagged as *unverified integration*, not
  *complete*, until something outside its own test file depends on it.
- When a manifest/schema is regenerated from real data as part of a change,
  diff the *content* (not just "did it write successfully") — the 15 dropped
  unique constraints and the `ScheduleAt` mis-typing would both have shown up in a
  before/after diff of `lumiere-schema-manifest.json` at review time.
