# Code ownership: Luna corrective integration

Date: 2026-09-05. Base: `221f2fe3829f26aa735557b705c9c5a35d7f26d9`.
Branch: `vibe/c2-postgres-projection-ir-v2`.
Coordinator: primary session; bounded Luna contributors; coordinator reviews
actual diffs, integrates exports, and owns the single Cargo/codegen slot.

## Acceptance corrections

The original execution ledger records useful implementation progress but its
ACCEPTED labels are too broad. In particular:

- D10: malformed object/Option IDs and invalid supplied POS IDs needed correction.
- D11: shared helpers existed without the promised production caller adoption.
- D32: order-stability assertions did not pin canonical bytes and final hashes.
- D36: response redaction and typed source-chain preservation are implemented;
  M60 auth extractor adoption is still unfinished. Already-string SQL validation
  errors and non-Error crypto failures retain the string boundary.
- D37: generated realtime callbacks still referenced a deleted helper. The
  test-only outbox simulator is retained under test configuration, not deleted
  as abandoned production logic. Proposal/statutory stub policy needs a user
  decision before changing externally visible behavior.
- D40/D42: remaining feature-oriented module extractions are not complete.
- D90: compile checks do not prove persisted tenant isolation, PostgreSQL
  transaction/reconstruction behavior, or live-browser flows.

The companion M-plan remains the sole API destination map. No alternate
registry, parallel domain types, or generic utility framework is introduced.

## Current ownership

| Owner | Bounded work | Reserved paths |
| --- | --- | --- |
| Luna IDs | ID/time corrections, subscription D/E, commit/reconstruction/projection, platform-control splits | Bounded assignments returned; no active edits |
| Luna accounting | Accounting hooks, auth, report service/render, CRM and document splits | Bounded assignments returned; no active edits |
| Luna realtime | Callback seam, audit, HTTP/query support, independent query body review | Bounded assignments returned; no active edits |
| Coordinator | Actual diff/AST review, source-error and scope fixes, query domains, cold-read foundation, workflow-worker and per-org drain integration | Integrated checkout, validation and documentation |

Agents do not run Cargo concurrently, edit another owner's paths, commit, push,
publish contracts, or mutate a database. Further batches require reassignment.

## Evidence so far

- Restored invalidation-only realtime callback helper; deterministic build fixture
  now includes primary-key and non-primary-key tables and checks callback emission.
- `cargo check --locked --offline -p api-server --all-targets` passed using the
  actual populated pinned-contract bindings as `CONTRACTS_STAGING_DIR`.
  The final all-target check passed without API-server warnings.
  The local `.contracts-staging/bindings` directory was empty; checks against
  that empty directory could omit generated callbacks and were insufficient.
- API library suite after integrated module moves and corrections: **239 passed**.
  The PostgreSQL manifest matrix returns early unless `C3_TEST_PG=1`; the test
  runner's `0 ignored` does not mean that live PostgreSQL coverage executed.
- Shared frontend: **84 tests passed**; query-hooks: **47 tests passed**.
- UI audit/entity adapters: **4 tests passed**. Shared, query-hooks, UI and web
  TypeScript checks all passed on the integrated checkout.
- Standalone `spacetimedb/Cargo.toml --tests` check passed with existing unused/
  test-stub warnings. This compiles reducers/test targets; it does not invoke
  live domain reducers or prove persisted tenant isolation.
- HTTP positive-ID boundary: **3 tests passed**, including rejection of form
  grouping, Option objects, unsafe numbers and fractional/junk strings.
- AI gateway: **147 passed, 1 ignored** at the corrective checkpoint; AI source
  behavior was not changed afterward (golden tests only).
- Query-dispatch audit: **6 tests passed**, including wrong/nested dispatcher,
  stale allowlist, unknown resource and unsupported-pattern failure cases.
- Full codegen unit suite: **93 passed**. The deterministic callback-generation
  build-script test also passed. Codegen retains its pre-existing unused Paths
  field warning; no generated contract release was performed.
- Primary AST inventory found no missing original functions/types/impls in the
  eleven converted API modules. Body differences were reviewed separately:
  source-error preservation, path/visibility adjustments, one-org drain
  extraction and the Unicode XLSX fix are not disguised as exact file moves.
- The special-resource dispatcher retains **47 arms, 71 literal keys and one
  wildcard**. Independent Luna review verified SQL, ordering and scope bodies
  before the subsequent typed-error mapping migration.

## Integrated responsibilities

- M10/M11: HTTP startup/router/CORS, query/command adapters and auth flows.
- M12/M13: report loading and rendering by domain; Chromium transport and HTML
  helpers have separate owners. Existing report test fixtures remain.
- M20/M21: authoritative/company/row support and accounting, purchasing,
  inventory, AI, document-template, access-control, import, form and worklist
  handlers. Remaining dispatcher tail is tracked below.
- M30/M31/M32/M33: cold-read contract/compiler/merge, atomic projection,
  reconstruction coordinator/source/sink/integrity, and projection polling.
  `drain_batch` owns fairness; `drain_organization` owns one cursor's outcome.
- M41: workflow timers, leased outbox, external adapter and test-only simulator.
- M50/M51/M52: CRM route groups, document adapters versus pure PDF/CSV/XLSX
  rendering, and global platform-control storage behind explicit re-exports.
- D41/D42: accounting hook feature modules preserve the package export path;
  subscription wave D/E reducers retain historical public paths and table owners.

## Corrective behavior changes

- Malformed/cyclic Option IDs no longer recurse indefinitely; supplied invalid
  POS IDs are rejected instead of silently becoming defaults.
- Malformed company scope is not treated as shared scope; negative workflow
  company IDs no longer wrap into unsigned IDs. Missing/null remains distinct.
- UI audit/entity helper adoption preserves source-specific Date/microsecond
  semantics, including integer division before floating conversion.
- Migrated HTTP internal errors retain typed sources while status/body/Display stay
  redacted; credential-safe context remains mandatory.
- The generated realtime invalidation callback seam is restored.
- Long Unicode pivot sheet names are truncated by characters, not UTF-8 bytes;
  invalid worksheet names still return an error. Two regression tests added.

## Follow-up Luna integration (2026-09-05)

- M21: HR reads/auditing, registry SQL construction, CRM filtering and messaging
  now have named owners. Literal dispatch and post-fetch orchestration remain.
- M40: candidate/company scope, human-task projections, definitions and runtime
  projections extracted. AST review found no missing original functions/types;
  differences are the documented error-source and malformed-company corrections.
- M42: subscription planning, SDK bridge and socket orchestration extracted.
  Original detached-thread lifecycle is preserved, not newly repaired.
- M60: `OrgSession` and four selected GET callers integrated; bearer/cookie
  resolution and company validation remain with existing owners. Unit tests cover
  middleware rejection, anonymous/missing-org rejection and session preservation.
- PG-dependent audit/POS reads now fail with redacted 503 instead of successful
  incomplete hot-only data. Readiness performs a bounded PG probe; pool waiting
  is bounded too. Tests cover probe failure/timeout and redacted dependency errors.
- CI reducer selector corrected to `commands::tests`; required Cargo gates reject
  zero matches. Four structural ownership tests and two selector tests pass.
  The ownership guard prevents retired flat owners from returning and requires
  the selected module files; it is not a semantic duplication detector.
- Final API library run after the readiness follow-up: **251 passed**, without
  compiler warnings. Required selector wrapper selected and passed **13 commands
  tests**. These replace the
  earlier 239-test checkpoint for this checkout. The opt-in PG matrix was not
  enabled: this is not live database evidence.
- Final API all-target check passed without warnings using populated pinned
  contract bindings. `git diff --check` passed. No commit or push performed.
- AI readiness follow-up: api-server now has explicit `AI_GATEWAY_REQUIRED`
  policy (production default true, development default false), calls the gateway
  readiness endpoint with a two-second request timeout, and fails on transport,
  timeout or non-success responses. The AI gateway separates static liveness
  from a three-second, read-only readiness probe of SpacetimeDB and the primary
  Qdrant collection. Provider readiness validates selected configuration and
  uses non-generative Ollama metadata plus an optional exact operator-configured
  Kong readiness URL; it issues no completion, embedding, vision, parsing, or
  search request. Mistral/Gemini/Unstructured/Tavily reachability remains
  runtime-observed because a portable non-billable
  probe is not established. Compose development explicitly requires AI because
  it includes the service; standalone development remains optional by default.
  API dependency checks run concurrently, and each network boundary is bounded;
  a stalled SpacetimeDB request can no longer hang readiness indefinitely.
  AI gateway tests: **154 passed, 1 ignored** (the ignored test requires live
  Qdrant). The web diagnostics route now uses gateway readiness, and the web
  typecheck passes.
- Chromium now separates static liveness from readiness that launches/reuses the
  browser, verifies its connection and version, and returns a redacted 503 on a
  bounded failure. Its deterministic readiness suite passes **3 tests**. The PDF
  structural gate waits for browser readiness instead of racing container startup.
- `scripts/check-compose-readiness.mjs` gives operators and CI a Node-only,
  bounded, parallel fail-closed probe for API, AI, Chromium, and repeatable worker
  endpoints. Its deterministic parser/HTTP/transport/timeout tests pass. CI runs
  those tests, the full AI gateway binary suite, and the Chromium helper suite.
- The shared integration-worker boundary no longer reports ready from configured
  organization IDs alone. It starts unready and becomes ready only after a
  successful reducer batch; its focused regression test passes.

## Remaining implementation — not accepted by this batch

1. Wider session extractor adoption is separate from the selected-caller M60
   deliverable. Preserve rejection ordering, especially on body-bearing routes.
2. Realtime cancellation/cleanup is not changed by module extraction; verify
   lifecycle behavior with a real SDK/socket before altering it.
3. AI transport/readiness handling is implemented in the follow-up above.
   Cloud-provider, parser and search reachability stays observable-only until
   explicit non-generative, non-billable provider contracts exist.
4. D12/D13/D20–D25/D30/D34/D60: missing cross-universe, malformed-input,
   persisted domain/lifecycle, route preparation and navigation evidence.
   The narrow structural ratchet is implemented, not full semantic acceptance.
5. D37: user decision on proposal-analysis and statutory mock-success policy.
   No production policy change has been inferred from a cleanup request.
6. D90/M90: service-backed tenant/persistence/reconstruction and browser gates.
   No live reducer test invocation, full browser run or CI performance benchmark
   has been claimed. The separate DX execution ledger retains its own follow-ups.

Final checkout: integrated local changes, **not committed or pushed**. The
coordinator ran `git diff --check` and formatted changed Rust files only. Further
work must continue from this checkout; do not reset it to the baseline commit.

## Outstanding release evidence

No contract publication, branch push, production schema change, or destructive
test reset is authorized here. Service-backed tests must be identified as run,
skipped, or blocked; a disabled database test is not a passing integration gate.
Remaining product-policy choices and environmental blockers must be reported,
not replaced by mock-success acceptance.
