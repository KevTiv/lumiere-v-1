# Build and CI developer workflow

This guide describes the build-orchestration improvements introduced on
`vibe/c2-postgres-projection-ir-v2`. Production validation remains separate from
the fast local edit/test loop. The API modularization plan is a different
workstream: moving Rust modules alone does not create smaller compilation units.

## Daily local loop

For a focused generation and browser-transport check, run `make dx-check`.
Use `make dx-check-rust` or `make dx-check-frontend` to check one lane. These
commands require the Rust/Python toolchains, prepared vendored Rust contracts,
and installed frontend dependencies. They do not fetch a live schema, compile
WASM, or start the application stack. Full application typechecks and browser
acceptance tests remain separate checks.
Generated Turbo task logs are ignored rather than tracked, so running a
typecheck does not leave modified log files in the checkout.

Codegen preserves unchanged output files. Reducer parameter constants use
operation names, so inserting a reducer does not rename subsequent constants.
The Rust and TypeScript SDK wrappers generate and validate temporary snapshots
before syncing changed files and removing stale output. Generation or validation
failures leave the previous SDK snapshot available.

The browser command transport uses a compact operation ID registry generated
from the installed, pinned contracts package. After changing that package pin
and installing dependencies, run:

```sh
make generate-browser-operation-ids
make dx-check-frontend
```

CI checks the registry against the pinned canonical descriptors. Rich operation
metadata remains available through the contracts package for tools that need it.
`pnpm --dir frontend stdb:generate` delegates to `make generate-stdb-ts-sdk`,
including the generator compatibility fixes, and writes to contracts staging.
It does not overwrite the frontend's handwritten contract proxy files or change
the application's installed contracts release.

From the repository root, with frontend dependencies and the pinned contracts
staging available:

```sh
make contracts-staging-from-pinned
make e2e-web-dev
```

This prepares the dedicated local E2E database/API, then runs Next development
mode in the foreground on port 3100. In a second terminal:

```sh
make e2e-single-running E2E_SPEC=auth-shell.spec.ts
make e2e-single-running E2E_SPEC=auth-shell.spec.ts E2E_GREP='sign-in'
make e2e-playwright-only E2E_SUITE=p0
```

These test-only commands require healthy services; they do not build, publish,
seed, or install browsers. Install Chromium once if necessary with
`pnpm --dir frontend/web exec playwright install chromium`. Restart the API via
the setup path after Rust changes. Ctrl-C stops the foreground web command;
the setup-managed API and database remain available. Stop the development web
server before running production-build targets on the same port.

For a production-mode regression test:

```sh
make e2e-single E2E_SPEC=auth-shell.spec.ts
E2E_FORCE_REBUILD=1 make e2e-single E2E_SPEC=auth-shell.spec.ts
E2E_SUITE=p0 make e2e-smoke
```

`E2E_CLEAR_DB=1` is destructive: it wipes the selected local database and
reseeds. It is not a build-performance switch. Serial E2E execution remains
the default because tests can mutate shared ERP fixtures.

## What is reused

- API builds select `cargo build -p api-server --bin api-server --locked`.
  Launch uses the native debug executable, not another `cargo run`. Cargo
  metadata resolves the target directory, including `CARGO_TARGET_DIR`.
- Local fingerprints use file contents, names, tool version, and relevant
  environment inputs. API source/shared crates/raw bindings and manifests are
  separate from frontend source/packages/public assets/lockfiles/dotenv files.
  STDB fingerprints include the in-module tests and fixture tooling.
- A local production frontend build is reusable only when its fingerprint and
  recorded `BUILD_ID` match. A failed build clears its stamp. CI can reuse a
  completed exact-commit archive; otherwise the frontend build reuses only
  compiler intermediates.
- `CONTRACTS_STAGING_DIR` follows the API build script's convention: relative
  paths resolve from `api-server/`. No raw environment values are printed by
  the fingerprint helper. Local stamps are under gitignored `.tmp/e2e/`.
- Turbo caches the web package's `.next` production artifacts, excluding
  compiler cache and development output. Public variables, rewrite/config
  variables, and dotenv files affect the web task hash. Direct `next build`
  does not use Turbo's task cache.

These are native local debug helpers, not cross-compilation or release runners.
Avoid running competing Cargo jobs in the same checkout. A filtered Rust test
still compiles its library; use `--lib` where appropriate to avoid extra test
targets, not as a promise of per-module compilation.

## Reusable CI setup actions

Three composite actions under `.github/actions/` consolidate setup that was
previously inlined in every workflow job:

| Action | Purpose | Replaces |
| --- | --- | --- |
| `setup-contracts-ssh` | Read-only SSH key + known_hosts for the private lumiere-contracts git dependency | 8 identical 11-line inline blocks across all workflows |
| `setup-frontend` | Pinned pnpm 10.31.0 + Node 22 with lockfile-based cache | 5 identical pnpm/Node setup blocks |
| `setup-spacetime-cli` | Cache + install + PATH for the pinned SpacetimeDB CLI | 2 identical cache/install/PATH blocks (ci.yml, e2e-smoke.yml) |

Each workflow passes its own `secrets.LUMIERE_CONTRACTS_DEPLOY_KEY` and
`SPACETIME_CLI_VERSION` as inputs. Permissions, event selection, job
dependencies, and required-gate logic remain at the workflow level. The
composite actions contain only setup steps — no build, test, or deployment.

## CI selection and gates

`scripts/ci-change-scope.py` reads a complete Git merge-base diff. Renames retain
both paths; an empty/unknown/invalid range runs all validation. Tests for the
classifier always run before heavy jobs.

| Change | Main CI work | E2E |
| --- | --- | --- |
| Documentation only (`docs/*.md`/`.adoc`, README/CHANGELOG) | Classifier and gates | Deliberate skip |
| Frontend-only source plus optional docs | Frontend checks, Playwright test listing | P0 on PR; full on main |
| Service Rust source plus optional docs | Service checks/codegen audits/selected tests | P0 on PR; full on main |
| STDB, shared crates, contracts, codegen, manifests, lockfiles, workflows, scripts, unknown or mixed application changes | Full validation | P0 on PR; full on main |
| Scheduled/manual E2E | Separate workflows retain their triggers | Full schedule; manual suite choice |

The standalone SpacetimeDB check runs independently of service compilation.
API library tests do not build every worker test harness. Playwright test
listing shares the frontend dependency installation; the historical
`Playwright (compile smoke)` name remains as a lightweight compatibility gate.

Main runs full E2E once, not overlapping P0 and full jobs. The full suite still
includes P0. PR E2E now considers frontend/shared changes previously excluded
by workflow path filters. Next compiler intermediates are cached separately
from completed build artifacts. Existing Rust, pnpm, browser, and renderer
caches remain; no untrusted cross-run application artifacts are introduced.

**Branch protection requires an administrator action:** prefer the stable
`CI gate` and `E2E gate` checks instead of only a dynamic matrix check. Both
require exact success for selected jobs and exact skipped status for unselected
jobs, rejecting failures, cancellations, and missing outputs. This change does
not edit GitHub branch protection or remove any existing requirement.

## Focused validation

```sh
make e2e-dx-test
node scripts/test-frontend-build-cache.mjs
rustfmt --check api-server/build.rs
bash scripts/test-build-rs-generation.sh
```

The build-generation test uses an already compiled `serde_json` dependency in
`target/debug/deps` and compiles only the small build script. On a fresh checkout,
run the regular dependency/codegen tests first; CI does this automatically.
It does not replace a full API compiler check.

## E2E build reuse and cache correctness

The E2E builder produces one exact-commit archive for all isolated shards. Its
whole-build cache remains keyed by `github.sha`; shards verify that commit and
the packaged file checksums before starting services.

The October 2026 follow-up adds reuse below that archive boundary:

- The compiled development-reducer WASM module has a separate exact cache key.
  `scripts/build-fingerprint.py stdb-wasm` hashes module sources and fixtures,
  local crates, embedded policy data, Cargo manifests and configuration, the
  workflow recipe, compiler/CLI/optimizer versions, and relevant build flags.
  Frontend, browser-test, and API edits alone do not invalidate that module.
  Both restored and newly built modules pass `wasm-tools validate`; there are
  no fallback restore keys. The release profile is unchanged.
- The native `api-server` and `storage-migrate` executables have a separate
  exact-input cache. `scripts/build-fingerprint.py api-ci` includes the actual
  local Cargo packages, verified contracts and staging, embedded policy and
  migration files, build configuration and recipe, compiler/linker versions,
  and hosted runner image identity. Frontend and browser-test edits alone do
  not invalidate these executables. Both binaries must match an inert JSON
  manifest's fingerprint and checksums and pass native ELF/executable checks
  before a restored bundle replaces either output. The helper never invokes
  the server or migration executable for validation. This CI cache deliberately
  requires the existing native `target/debug` layout.
  On a miss, the workflow removes the two old executables, builds both, verifies
  that the input fingerprint is still unchanged, and stages the complete
  bundle before saving it. Successful API builds are saved before the frontend
  build, even when a later step fails. The final shared archive still contains
  the current commit's identity and full file checksums.
- Verified contracts are prepared before Rust cache metadata is collected.
  Repeated vendor preparation and `make contracts-staging-from-pinned` preserve
  unchanged contents and modification times while repairing changed, missing,
  or stale files. Archive provenance and IR validations still run each time.
- The builder verifies its archive in a temporary directory with
  `scripts/e2e-ci-artifact.sh verify-archive`. This preserves `.next/cache` for
  the existing post-job cache save. GitHub Actions also explicitly enables
  production filesystem caching in the pinned Next 16.1 release, which writes
  `.next/cache/turbopack`. The frontend build helper rejects missing or empty
  compiler-cache output before recording a successful build. Shards still
  install the archive normally and do not require compiler caches.
- A new PR commit or branch push cancels the entire superseded E2E run,
  including older shards. Explicit manual runs have independent concurrency
  groups. Suite selection, worker counts, and required gates are unchanged.

The form-configuration helper also waits for the actual
`publish_form_configuration` response and canonical configuration readback.
Publication/query failures surface directly instead of becoming swallowed
timeouts and refresh loops.

The first PR run's [E2E builder](https://github.com/KevTiv/lumiere-v-1/actions/runs/39259934323/job/118084757463)
took 16m24s. The [subsequent builder](https://github.com/KevTiv/lumiere-v-1/actions/runs/39273733081/job/118132599785)
took 7m08s after restoring the compiled WASM module, validating it, and skipping
module compilation. That builder also successfully saved the Next compiler
cache. It still spent 3m21s compiling API binaries, which motivates the separate
API cache. The API cache's first fill and later hit need separate CI measurements;
editing the workflow or fingerprint recipe also invalidates the WASM key once.
These are builder timings, not end-to-end browser-suite timings.

### Native and WASM dependency snapshots

The 28 October audit found eight completed API builds that restored an exact
dependency cache but still compiled the same 398 third-party crates. A
[cancelled main build](https://github.com/KevTiv/lumiere-v-1/actions/runs/40676386750/job/122775877515)
had published that cache before reaching native compilation. Later exact hits
left the incomplete snapshot unchanged. CI also used Ubuntu 26 through
`ubuntu-latest`, while E2E used Ubuntu 24, so their dependency keys differed.

Native Rust CI and the E2E builder now both use `ubuntu-24.04` and the
`workspace-native-dev-deps-v2` namespace. The root Cargo workspace is cached
separately from the standalone module's `workspace-wasm-deps-v2` cache. Compiler,
runner image, flags, Cargo configuration and dependency hashes remain cache
inputs; Cargo still checks feature and profile compatibility.

E2E restores each dependency snapshot only after the corresponding executable
cache misses and its compilation will run. Dependency snapshots are published
only when the owning job succeeds. A cancelled or failed build cannot reserve
a new exact dependency entry. Verified API executables and WASM modules are
still saved immediately after validation, before a later frontend failure.
No existing cache entries need to be deleted: the new namespaces exclude the
old mixed snapshots.

Run `python3 -B -m unittest discover -s scripts/tests` for the workflow and
measurement regressions. The **Measure CI builds** report distinguishes exact,
fallback and missed dependency lookups, and separately counts native API
third-party and local crate compilations. An exact hit with third-party
recompilation is a diagnostic; legitimate feature/profile differences can also
require compilation. Raw logs and environment values are not retained.
Missing timestamped Cargo evidence is reported as unobserved rather than zero.

The first build with the new namespaces and workflow fingerprint can be cold.
Compare a successful cold build with a later application-only change, checking
dependency reuse and cache transfer time separately from application linking,
frontend compilation and runner queue time. Hosted cold/warm measurements are
still required before claiming a speedup.

A local production-cache check on October 19 used the real frontend build helper
with `CI=true`, `GITHUB_ACTIONS=true`, Node 22.23.3, pnpm 10.31.0, Next 16.1.6,
and four available CPU cores. Two consecutive successful builds took 64.44s
cold and 10.09s warm; Next reported compilation phases of 48s and 2.6s. The
compiler cache occupied approximately 680 MiB. These timings exclude GitHub
cache transfer and artifact packaging, so measure the full CI job separately.

Focused regression checks:

```sh
python3 -B -m unittest discover -s scripts/tests
bash scripts/tests/rust-runtime-image-contract.test.sh
cd frontend/web
node --import tsx --test tests/e2e/operation-response.test.ts
```

The production Rust Docker builder now copies only the required contract
preparation helpers, rather than the entire scripts directory and Makefile.
The dispatcher is copied directly into the final runtime stage. Unrelated CI
script edits therefore do not invalidate the expensive release compilation
layer. The first build with the changed Docker recipe may still compile; real
Rust source changes still invalidate the combined dependency/application layer.
The existing runtime-image contract gate checks these input boundaries.

Production Docker dependency layers, E2E shard balance, and API cache transfer
cost still need separate measurements. Full service startup and authenticated
browser execution remain CI checks.

## Earlier measurement and remaining work

Baseline: main [CI run 33911593756](https://github.com/KevTiv/lumiere-v-1/actions/runs/33911593756),
commit `4c5ea33b05d9f423334917949f284fdc117fb028`, September 4, 2026:

| Job | Elapsed |
| --- | ---: |
| Rust | 10m30s |
| Contracts drift | 5m51s |
| Frontend | 4m36s |
| Separate Playwright listing | 38s |
| PDF regression | 1m38s |

This is one observation from another main revision, not a controlled benchmark.
The Rust job included 1m41s STDB checking and 4m33s API test compilation/execution.
Collect comparable warm/cold run timings, queue time, cache transfer time, and
total runner minutes before claiming a percentage improvement.

The September changes left the following work. Shared E2E build artifacts are
now implemented as described above; the other items still need separate work:

1. Keep application artifacts shared by isolated E2E shards, with exact-commit
   verification and fixture creation separated from compilation.
2. Higher E2E worker counts: require persisted fixture-isolation tests first.
3. Realtime/SDK crate extraction: compact contracts are now selected explicitly,
   but the API library still requires full bindings. Workspace feature
   unification still applies when building the API alongside other consumers.
4. Production/test WASM feature separation: requires exact schema/IR/artifact
   provenance and reducer compatibility verification; no schema changes here.
5. Debug/LTO/linker tuning, sccache, larger runners, or broad shared target
   caches: measure separately; no global profile/toolchain change here.
6. Consolidating semantic-index frontend checks: preserve its independent
   trigger/branch coverage until a shared gate guarantees equivalent checks.

Use the [execution ledger](../plan/build-dx-ci-execution-plan.md) for ownership,
review results, and remaining prerequisites.
