# Build DX and CI efficiency: execution ledger

Branch: `vibe/c2-postgres-projection-ir-v2`.
Starting revision: `04446b2b1` (contracts v0.3.29).
Date: 2026-09-04.
Owner: primary coordinating session; three Luna subagents supplied bounded
patches, and the coordinator reviewed/corrected/integrated them.

## Scope and invariants

Improve the development loop and remove CI duplicate work without weakening
authorization, fixture checks, production builds, or contract provenance. Do
not publish contracts, change schemas, wipe databases, alter branch protection,
or merge the branch. The user authorized pushing this branch.

The [operating guide](../guides/build-and-ci-dx.md) is the command/reference
document. The [modularization plan](api-server-modularization-coordination-plan.md)
remains separate and unimplemented by this batch.

The [code ownership and deduplication handoff](code-ownership-deduplication-refactor-plan.md)
tracks remaining setup/lifecycle duplication in D50. It does not reclassify this
implemented batch or mark DX2–DX7 complete; preserve their prerequisite gates.

## Ownership and integration

| Work | Initial owner | Coordinator review/integration |
| --- | --- | --- |
| CI workflows and selection | Luna CI agent | Reworked classifier to retain STDB/codegen/shared gates; preserved scheduled/manual runs; hardened job-result checks; split standalone STDB checking |
| Local E2E commands | Luna DX agent | Replaced shell fingerprint pipeline; separated input domains; added BUILD_ID matching, failure invalidation, test-only commands and foreground dev server |
| API build generation/contracts | Luna Rust agent | Restored v2 feature, retained directory-addition watches, reviewed read errors/output compatibility and standalone tests |
| Frontend caching/docs/verification | Coordinator | Web-specific environment/output rules; tested Turbo's resolved graph; reviewed combined diff |
| Independent final review | Luna Rust agent | Read-only review of integrated orchestration/classifier/cache changes; coordinator retains final responsibility |

No subagent committed or pushed. Cargo validation had one coordinator-owned
slot; a check encountering another process's build-directory lock was stopped.

## Implemented batch

- [x] Main E2E runs full once, preserving P0 within full.
- [x] Frontend/shared changes trigger PR E2E; documentation-only changes skip
  heavy jobs through explicit selection and stable final gates.
- [x] Unknown/mixed/build/schema/dependency changes retain full validation.
- [x] Standalone STDB checking runs independently of service checking.
- [x] Playwright listing shares frontend setup; old check name is retained.
- [x] API library CI tests use `--lib`; service binary checks remain.
- [x] Native local API builds select only the API binary and run its executable.
- [x] Fingerprints include manifests, bindings, test sources, assets, dotenv,
  relevant environment and tool versions; outputs are excluded.
- [x] Local Next production reuse matches hash plus BUILD_ID; failed builds
  clear the stamp. CI always builds.
- [x] Foreground Next dev + already-running single-spec loop added.
- [x] CI Next compiler caches exclude runtime fetch data; Turbo web output and
  environment hashing corrected.
- [x] Build generation order/output writes made deterministic; env/directory
  changes remain Cargo inputs.
- [x] Compact contracts default features disabled; API explicitly enables SDK
  bindings; v2 stays enabled. No public type/schema changes.
- [x] PDF diagnostics artifact inputs repaired.

## Verification evidence

- Python CI-selection/fingerprint/mocked helper regressions: 15 tests passed,
  including a run with `CI=true` in the parent environment.
- Turbo dry-run graph passed: outputs, excluded cache/dev outputs, dotenv,
  rewrite/public-env invalidation, unaffected API-client build hash.
- Standalone build-script Rust regression passed: deterministic ordering,
  unchanged mtime, changed output and missing row-type error.
- `rustfmt --check api-server/build.rs`: passed.
- `actionlint` v1.7.7 on modified workflows: passed (ShellCheck disabled;
  shell syntax and expanded Make recipes checked separately).
- `bash -n` on helpers and expanded `make -n` E2E recipes: passed.
- `cargo tree --locked --offline`: stdb-auth resolves v2 without SDK bindings;
  API explicitly resolves bindings. Cargo.lock was not changed.
- Full Cargo check: not completed locally; stopped at another build's target
  lock. Full production builds, live reducer/PG tests and browser E2E are not
  claimed as locally verified by this batch.
- Whitespace validation and final push verification are coordinator gates.

The guide records one main-run timing baseline, not an achieved speedup. Compare
subsequent relevant branch/main runs before claiming performance improvements.

## Remaining dependency-ordered work

| ID | Work | Prerequisite proof |
| --- | --- | --- |
| DX2 | Build-once artifacts shared by E2E shards | Separate build/fixtures; SHA/target/toolchain/features/environment provenance; compatible runners; no secrets in artifacts |
| DX3 | E2E parallel workers/shards | Persisted fixture isolation; per-shard DB/auth; compare runner minutes/critical path; retain coverage |
| DX4 | Realtime/SDK leaf-crate boundary | Dependency/caller inventory; same HTTP/WS behavior; workers actually stop resolving SDK |
| DX5 | Production/dev WASM separation | Exact production IR/WASM provenance; dev fixtures remain valid; schema/type compatibility |
| DX6 | Profile/linker/sccache/runner tuning | Uncontended cold/warm/incremental timings; debugger usability/runtime behavior; cache transfer and runner cost |
| DX7 | Consolidate semantic-index frontend checks | Equivalent coverage for every existing trigger; no lost independent gates |
| OPS1 | Stable required gate checks | Repository administrator updates branch protection; not performed here |

These items are not complete. Do not infer artifact sharing, measured speedups,
full-suite success, or a finished god-file refactor from this batch.

## 28 October 2026: dependency-cache correctness wave

This follow-up addresses a measured cache-completeness problem within DX6.
It does not complete the remaining profile, linker, compiler-cache or runner
capacity work, and does not claim a measured speedup.

- Split native root-workspace and standalone WASM dependency snapshots into
  new namespaces; retain compiler, runner-image, flags and dependency keys.
- Align native Rust CI with the E2E builder on Ubuntu 24.04.
- Restore E2E dependency snapshots only when the corresponding executable cache
  misses and compilation will run; publish only after a successful owning job.
- Keep the existing immediate saves of validated API binaries and WASM modules.
- Add workflow regressions for executable hits, failure/cancellation policy,
  target isolation, platform sharing and the early executable-save boundary.
- Extend the read-only measurement report to compare actual native compilation
  with exact/fallback/missed dependency-cache lookups.

The audit examined 33 completed CI/E2E jobs from the afternoon of 28 October.
Ten of eleven successful API compilation steps rebuilt the same 398 third-party
crate/version pairs, including eight exact dependency-cache hits. The original
cache was published at 12:01 Amsterdam time by a main job cancelled during WASM
compilation, before native API compilation ran. The
[cache-seeding job](https://github.com/KevTiv/lumiere-v-1/actions/runs/40676386750/job/122775877515)
and [later exact-hit API build](https://github.com/KevTiv/lumiere-v-1/actions/runs/40696260551/job/122844585238)
provide the baseline evidence.

Acceptance requires the focused regression suite and workflow validation, then
hosted observations of a cold snapshot and a matching-environment warm build.
Application-only edits must still rebuild and validate application binaries;
compiler, target, profile, features or dependency changes retain Cargo's
normal invalidation. Cache inventory alone does not establish eviction.

Local verification: all 183 script regressions passed, including 17 measurement
tests and five workflow-cache policy tests. Actionlint 1.7.12 passed for both
changed workflows (ShellCheck disabled). Replaying filtered real build logs
reproduced 398 third-party compilations after an incomplete exact hit and zero
after a usable hit. Independent review found no remaining actionable issues.
Hosted cache publication and cold/warm timings remain pending.

## Next coordinator session

Inspect HEAD/worktree/CI first. Delegate disjoint files; reserve shared wiring,
manifests and ledger for the coordinator unless explicitly transferred. Agents
return actual diffs/tests and never push. The coordinator reviews, integrates,
validates and records measured outcomes. Do not run competing Cargo processes
or change fixture/schema compatibility merely to obtain faster timings.
