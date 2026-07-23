# AI certification integrity sub-agent plan

## Outcome and fixed decisions

Certification results must be produced by the server-owned harness. The browser
may request and inspect a certification run, but it cannot submit output,
pass/fail state, hashes, policy evidence, or capability grants.

Certification and production execution share one executor. Certification runs
an exact immutable candidate version; production runs an exact active release.
Tenant-scoped SQL and filesystem capabilities remain available through the
governed brokers defined in
[`ai-unified-execution-capabilities-subagent-plan.md`](./ai-unified-execution-capabilities-subagent-plan.md).
Certification uses immutable tenant snapshots and virtual file fixtures, not a
user's live desktop directory.

## Current evidence

- `RecordAiSkillTestRunParams` accepts caller-provided `actual_output_json` and
  `record_ai_skill_test_run` turns a matching value into `Passed`:
  `spacetimedb/src/ai/skill_registry.rs:273,478`.
- The UI copies `expectedOutputJson` into `actualOutputJson`:
  `frontend/web/app/(modules)/ai-skills/skill-registry-panel.tsx:265`.
- The browser calls the generic reducer BFF and the public allowlist does not
  block the reducer:
  `frontend/packages/query-hooks/src/hooks/ai-skill-registry.ts:213` and
  `api-server/src/reducer_allowlist.rs:49`.
- Promotion trusts the latest matching passed row without executor, runtime,
  manifest, fixture, or environment provenance:
  `spacetimedb/src/ai/skill_registry.rs:381,823`.
- `AiSkillTestRun` stores output and a non-cryptographic fingerprint but no
  certification request, harness run, policy snapshot, or runtime profile:
  `spacetimedb/src/ai/skill_registry.rs:174,898`.
- The UI accepts any historical pass and treats zero fixtures as ready, while
  the backend correctly rejects zero fixtures:
  `frontend/packages/query-hooks/src/hooks/ai-skill-registry.ts:160` and
  `frontend/web/app/(modules)/ai-skills/skill-registry-panel.tsx:160`.
- No gateway certification runner exists. Development seeds directly insert
  passing runs and active releases: `ai-gateway/src/main.rs:137` and
  `spacetimedb/src/seed.rs:7324,7413`.

## Target contract

```text
admin -> request certification(version, fixture, company, idempotency key)
      -> queued request
gateway certification identity -> claim request
      -> load immutable candidate + fixture + runtime profile
      -> execute through the canonical policy/capability harness
      -> evaluate typed assertions after execution
      -> record immutable evidence through executor-only reducer
promotion -> revalidate current fixture/version/runtime/environment hashes
```

Add these records in `spacetimedb/src/ai/skill_registry.rs`:

- `AiSkillCertificationRequest`: organization/company/version/fixture,
  idempotency and correlation keys, state, requester, claimant, attempts, and
  timestamps.
- Certification evidence replacing or extending `AiSkillTestRun`: request and
  harness-run IDs; version, source, manifest, fixture, environment, policy, and
  executor SHA-256 hashes; output hash and protected artifact reference; typed
  assertion result; effective capability evidence; bounded failure summary;
  executor identity and completion time.
- Active certification runtime profile: policy ABI, executor build and adapter
  profile whose hash promotion requires.
- Typed fixture assertion contract. Exact canonical JSON remains valid only for
  deterministic outputs.

Detailed outputs and logs belong in retention-controlled artifacts. Public
registry queries return bounded status/diff data, not unrestricted tenant data.

## Agent operating rules

1. The integration agent owns shared exports, generated bindings, reducer/query
   registries, allowlists, and final code generation.
2. Sub-agents do not edit files outside their ownership without requesting a
   handoff.
3. `complete` and `fail` reducers require a dedicated rotating certification
   service identity, not a browser token or general module-owner token.
4. Use typed Rust states and `Result` errors. Do not introduce production
   `unwrap`, stringly typed capability decisions, or locks held across awaits.
5. Each task reports changed files, public contracts, tests run, and remaining
   assumptions. Agents do not commit independently in the shared worktree.

## Wave 0 - Immediate containment

### Agent C0 - Remove self-attestation

**Owns:**

- `frontend/web/app/(modules)/ai-skills/skill-registry-panel.tsx`
- `frontend/packages/query-hooks/src/hooks/ai-skill-registry.ts`
- `frontend/packages/stdb/src/commands/ai-skills-http.ts`
- `frontend/web/lib/ai-skills-ui-reducers.ts`
- `api-server/src/reducer_allowlist.rs`
- only the legacy reducer containment block in
  `spacetimedb/src/ai/skill_registry.rs`

Remove “Record pass,” its mutation, and all browser serialization of actual
output. Permanently reject or remove `record_ai_skill_test_run`. Fix zero-fixture
and historical-pass UI readiness.

**Gate C0:** direct browser/API calls cannot create a test run; promotion stays
denied; no UI request contains output or pass state.

## Wave 1 - Persistence and execution foundations

### Agent C1 - Certification state and provenance

**Owns:**

- `spacetimedb/src/ai/skill_registry.rs`
- certification tests near the module
- `spacetimedb/src/seed.rs` certification rows only

Implement request/claim/complete/fail reducers, immutable evidence and runtime
profiles. Compute SHA-256 server-side. Completion reloads and validates the
request, candidate, fixture and active runtime profile. Development-manufactured
passes must be marked non-production and cannot satisfy production promotion.

**Gate C1:** admins can request but cannot claim/complete; stale, duplicate,
wrong-scope, wrong-version, changed-fixture and obsolete-runtime completion all
fail without partial evidence.

### Agent C2 - Candidate-version certification runner

**Depends on:** frozen C1 reducer signatures and the point-4 executor contract.

**Owns:**

- new `ai-gateway/src/harness/certification.rs`
- certification additions in `ai-gateway/src/harness/release_registry.rs`
- `ai-gateway/src/harness/mod.rs`
- certification route/worker wiring in `ai-gateway/src/main.rs`
- certification configuration in `ai-gateway/src/config.rs`

Load the immutable candidate by ID, execute through the same executor as
production, and evaluate expected assertions only after execution. Add bounded
timeouts, cancellation and terminal infrastructure errors. Candidate
certification cannot mutate ERP state.

**Gate C2:** matching deterministic output passes; mismatch, timeout, policy
denial and adapter error never pass; production mode still requires an active
release.

### Agent C3 - Certification datasets and virtual files

**Depends on:** point-4 capability contracts.

**Owns:** certification adapters in:

- `ai-gateway/src/harness/data_scope_resolver.rs`
- `ai-gateway/src/tools/scoped_sql.rs`
- `ai-gateway/src/tools/tenant_files.rs`
- new certification fixture support under `ai-gateway/src/harness/`

Use immutable, scope-bound datasets for SQL fixtures and virtual filesystem
roots for file fixtures. Record capability evidence hashes. Do not access live
desktop grants during certification.

**Gate C3:** cross-tenant rows, write SQL, undeclared resources, absolute paths,
traversal, symlink escape and oversized output deny; declared virtual fixtures
succeed.

## Wave 2 - Protected API and UI

### Agent C4 - Request/status BFF

**Owns:**

- new `frontend/web/app/api/ai/skills/certifications/route.ts`
- new certification status route
- `frontend/web/app/api/ai/_lib/route-helpers.ts`
- protected certification query surface in `api-server`

POST accepts only version, fixture, company and idempotency key. Derive actor,
organization and effective company server-side. Reject unknown fields instead
of ignoring them. Return sanitized status, bounded diffs and correlation IDs.

**Gate C4:** cross-scope calls return 403; `actualOutputJson` is rejected; an
idempotent retry returns the original request.

### Agent C5 - Registry experience

**Owns:**

- `frontend/web/app/(modules)/ai-skills/skill-registry-panel.tsx`
- `frontend/packages/query-hooks/src/hooks/ai-skill-registry.ts`

Add “Run certification,” queued/running/pass/fail/error states, bounded evidence
and polling only for non-terminal jobs. Promotion readiness must come from the
authoritative server calculation.

**Gate C5:** the UI cannot construct a result; concurrent fixture jobs render
independently; promotion enables only for current authoritative evidence.

## Wave 3 - Integration and release proof

### Integration agent - Bindings and security suite

Regenerate TypeScript and Rust bindings once. Update generated SQL-column maps,
reducer names, query registries and coverage reports. Add reducer, gateway,
route and Playwright coverage for:

- copied expected output and direct legacy reducer denial;
- user/admin claim and completion denial;
- unclaimed, mismatched and replayed service completion;
- later failure superseding an older pass;
- SQL scope/write and filesystem escape denial with audit;
- exact successful execution enabling independent promotion;
- fixture, version, environment and runtime changes invalidating evidence.

## Definition of done

- Only the dedicated executor can produce passing evidence.
- Every promoted version has evidence bound to the exact immutable candidate,
  fixture, environment, policy and runtime hashes.
- Certification and production share one executor and capability brokers.
- Scoped SQL and virtual tenant files are auditable; unrestricted raw SQL,
  process filesystem access and desktop-returned self-certification remain
  impossible.
- All code generation, Rust, frontend, route and E2E integrity gates pass.
