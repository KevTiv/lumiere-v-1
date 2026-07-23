# Unified AI execution and scoped capabilities sub-agent plan

## Outcome and fixed decisions

Every production AI skill executes through one gateway authority and one policy
pipeline. SQL and filesystem access are retained, but the broad `RawSql` and
`Filesystem` capabilities are replaced by typed, scoped capabilities.

The supported boundaries are:

- `ScopedSqlTemplate`: reviewed server SQL with executor-owned scope binds.
- `ScopedSqlQuery`: a later narrow parsed query language over a per-run scoped
  dataset, never caller SQL against the shared SpacetimeDB database.
- `TenantFileRead` and `TenantFileWriteDraft`: opaque tenant object IDs through
  the server object-store boundary, never server paths.
- `DesktopFileRead` and `DesktopFileWriteDraft`: desktop-host-only operations
  using foreground user consent and opaque, revocable local grants.
- Explicit allowlisted network search/fetch capabilities.

Risk and capability are separate dimensions. A read-only scoped SQL operation
can be green. File writes are staged drafts; desktop final writes require local
confirmation. Combining local-file reads with network egress is denied by
default and requires a reviewed combined policy.

## Current evidence

- Legacy execution remains at `ai-gateway/src/routes/skills.rs:138` and
  `ai-gateway/src/orchestrator/run.rs`; harness routes separately construct
  policy engines in files such as `routes/report.rs:62` and
  `routes/inventory.rs:55`.
- `legacy_fence.rs:3` blocks only `report_composer` and `low_stock` and explicitly
  permits `report_analysis`.
- `release_registry.rs:48` supports only four compiled adapters and reconstructs
  part of the manifest instead of loading the complete immutable policy.
- Version records already contain immutable manifest, permissions and resources:
  `spacetimedb/src/ai/skill_registry.rs:66`.
- Policy snapshot support exists and verifies `expected_release_id`, but the
  gateway never calls it: `spacetimedb/src/ai/skill_registry.rs:607`.
- Green and amber policy currently hard-ban SQL/filesystem categories:
  `ai-gateway/src/harness/policy_engine.rs:433`.
- Browser policy preview accepts a caller plan, capability names and candidate
  output. It cannot be execution authority:
  `frontend/web/app/api/ai/policy/evaluate/route.ts:24`.
- Existing analytics demonstrate server-owned SQL with organization/company
  predicates: `ai-gateway/src/tools/analytics.rs:34`.
- No Tauri, Electron or other desktop package exists.
- `api-server/src/document_blobs.rs` is a useful object-store foundation, but
  accepts `company_id` without validating company access, checks only
  organization on download/OCR, and performs blocking filesystem I/O in async
  handlers.

## Trust boundaries

1. Browser/model: untrusted; may request intent but never effective scope,
   capabilities, release, policy, SQL authority or paths.
2. Next BFF: authenticates the session and derives context; it does not grant
   execution capabilities.
3. AI gateway: sole execution and capability-broker authority.
4. SpacetimeDB: release, permission, scope and immutable policy authority.
5. API object-store service: tenant file-byte authority.
6. Desktop webview: untrusted renderer.
7. Desktop host: local file-handle authority; only this process sees OS paths.
8. Model/network providers: explicit data-egress boundary.

## Shared executor contract

```text
authenticate -> resolve exact active release -> parse full manifest
-> verify permission/company/privacy/budget -> create run
-> record immutable policy snapshot -> build plan server-side
-> acquire scoped grants -> execute tools -> privacy/output validation
-> persist evidence/artifacts/result hash -> finalize run
```

No tool step may be written before the policy snapshot. Unknown releases,
adapters, resources, capabilities, fields or tools fail closed.

## Agent operating rules

1. The integration agent owns `main.rs`, shared exports, generated bindings,
   registries, route deletion, and final migration ordering.
2. Capability contracts freeze before broker implementations start.
3. Agents work only in listed files and do not commit independently.
4. Use typed enums/newtypes and contextual `Result` errors. No production
   `unwrap`, no blocking filesystem calls in async handlers, and no locks held
   across awaits.
5. Feature flags control rollout only; they never grant authority absent from an
   immutable released manifest.

## Wave 0 - Stop bypasses and freeze contracts

### Agent E0 - Production legacy shutdown

**Owns:** `ai-gateway/src/harness/legacy_fence.rs`, legacy checks in
`ai-gateway/src/routes/skills.rs`, and legacy configuration in
`ai-gateway/src/config.rs`.

Replace the two-skill blocklist with production deny-by-default. Permit legacy
only through an explicit development allowlist that production startup rejects.
Classify every `main.rs` route as governed skill, governed platform service or
administrative service.

**Gate E0:** every bundled skill is denied through `/v1/skills/run` in
production; development legacy configuration cannot start in production.

### Agent E1 - Manifest v2 and typed capabilities

**Owns:**

- `spacetimedb/src/ai/skill_registry.rs` manifest validation only
- `ai-gateway/src/harness/manifest.rs`
- `ai-gateway/src/harness/policy_engine.rs`
- `frontend/packages/erp-shared/src/ai-policy-schemas.ts`

Define canonical capability specs for SQL templates/query plans, tenant object
IDs and modes, desktop modes/user-presence/expiry, network domains/providers,
privacy, rows, bytes, time and output schemas. Reject `RawSql`, generic
`Filesystem`, unknown fields and unsorted/noncanonical manifests.

**Gate E1:** risk no longer bans safe scoped reads; broad/raw declarations and
unknown configuration fail closed; canonical manifests are immutable.

## Wave 1 - One release and execution authority

### Agent E2 - Exact release resolver and snapshots

**Depends on:** E1.

**Owns:**

- `ai-gateway/src/harness/release_registry.rs`
- snapshot client logic under `ai-gateway/src/harness/`
- only required loader changes in
  `ai-gateway/src/orchestrator/skill_loader.rs`

Return a `ResolvedRelease` containing release/version IDs, source hash, complete
parsed manifest, effective company configuration and executor-build hash. Stop
reconstructing authority from compiled defaults. Create the run and record its
snapshot with the expected release before tool execution.

**Gate E2:** zero/multiple/stale releases deny; no tool evidence can predate the
snapshot; completed runs have exactly one snapshot; rollback changes new runs
without rewriting old evidence.

### Agent E3 - Canonical executor

**Depends on:** E2.

**Owns:**

- new `ai-gateway/src/harness/executor.rs`
- new `ai-gateway/src/harness/capability_broker.rs`
- executor-facing refactors in report, inventory, distributor and action-draft
  routes

Implement the shared pipeline and server-side plan construction. Keep policy
evaluation preview separate: caller-provided preview plans/results can never
authorize execution. Propagate cancellation and deadlines to all tool calls.

**Gate E3:** existing governed routes have parity through one executor;
cross-company, stale release and model-requested capability escalation deny.

## Wave 2 - Capability brokers in parallel

### Agent SQL - Governed tenant SQL

**Depends on:** E3.

**Owns:**

- `ai-gateway/src/tools/analytics.rs`
- new `ai-gateway/src/tools/scoped_sql.rs`
- SQL registrations in `ai-gateway/src/tools/registry.rs`
- SQL resource/template assets

For v0.1, SQL is immutable reviewed templates referenced by IDs and typed bound
parameters. Organization/company values come only from executor context.
Templates declare allowed resources, columns, functions, rows, bytes, timeout
and output schema. Validate returned rows independently before privacy filtering.

If user/model-authored SELECT is later required, parse a deliberately narrow
dialect and execute only over a per-run tenant projection assembled from scoped
resources. Never forward it to the shared SpacetimeDB SQL endpoint. Deny DDL,
DML, catalogs, external functions, export, multiple statements and unknown
functions. The DuckDB runtime remains removed.

**Gate SQL:** unions/subqueries cannot expose other tenants; scope binds are
executor-owned; writes/export/oversize/timeout deny and audit; template hash
matches the active release.

### Agent TF - Tenant server files

**Depends on:** E3.

**Owns:**

- `api-server/src/document_blobs.rs`
- object-store configuration/trait files if extracted
- new `ai-gateway/src/tools/tenant_files.rs`

Validate organization, permitted company and resource permission on presign,
upload, complete, download and OCR. Include company scope in metadata/keying.
The gateway passes object/document IDs, never OS paths. Enforce MIME,
classification, checksum, size and privacy rules. Writes create staged objects;
registration/replacement remains a typed approved action. Use `tokio::fs` or
bounded `spawn_blocking`, protect the configured root from symlink/path escape,
and preserve a replaceable S3/R2 backend boundary.

**Gate TF:** same-organization cross-company reads fail; traversal, symlink,
incomplete/stale object, checksum, MIME and size attacks fail; model paths are
never accepted.

### Agent DF - Desktop local-directory broker

**Depends on:** E1 and the frozen executor resume protocol. This is a new
deliverable because no desktop package exists.

**Owns:**

- new `frontend/desktop/`
- new `frontend/desktop/src-tauri/`
- new `frontend/packages/desktop-bridge/`

Use a Rust/Tauri host process for native pickers and local I/O. The webview gets
opaque grant IDs and display labels, not absolute paths. Grants bind user,
organization, company, device, directory handle, modes and expiry. The host
canonicalizes roots/relative paths and rejects traversal, symlinks, device files
and out-of-root resolution.

Local reads suspend the gateway run with a nonce-bound request, require
foreground approval, hash bounded content, and either upload an ephemeral tenant
artifact or resume with a signed bounded result. Local writes download a staged
artifact, show target/content preview, require local confirmation, write via a
temporary sibling plus atomic rename, and return a signed receipt. Store paths
and grant secrets only in the host/keychain. Plain web builds expose no desktop
file capability.

**Gate DF:** renderer arbitrary-path calls, stale/revoked/wrong-device grants,
nonce replay, background picker/read/write, traversal and symlink attacks fail;
cancelled writes leave targets unchanged; browser builds have no local path.

## Wave 3 - Skill and route migration

### Agent M1 - Analytics and existing harness adapters

Migrate `report_analysis` and `process_research` to reviewed SQL templates, then
move `report_composer`, `low_stock` and distributor controls through the common
executor.

### Agent M2 - Remaining bundled skills

Migrate `daily_briefing`, `insights_scan` and `import_mapping`; then migrate
`price_search` and `supplier_discovery` with reviewed network policies.

### Integration agent - Platform route classification

Classify RAG, forms, import and context as released skills or governed platform
services. Update BFF routes, hooks, bundled manifests, seeds and fixtures. No
route may become an alternate model/tool authority.

## Wave 4 - Security and rollout

Mandatory integration/E2E cases:

- every production skill requires exactly one active release;
- every completed run has the matching immutable snapshot;
- SQL tenant isolation and prohibited statements;
- tenant-file company isolation and server-path denial;
- desktop consent, suspend/resume, signed receipt and cancellation;
- local-file plus network exfiltration denial;
- legacy production endpoint unavailable;
- promote, execute, inspect audit and roll back while preserving history.

Roll out manifest parsing/snapshots first, disable production legacy second,
enable SQL templates for two analytics skills, then tenant-file reads/staged
writes. Pilot desktop reads behind an explicit tenant setting; enable desktop
writes only after consent, atomicity and recovery tests pass.

## Definition of done

- One executor governs every production AI skill.
- SQL is scope-safe and useful without caller text reaching the shared database.
- Tenant files use company-scoped object IDs, not server paths.
- Local files exist only in desktop builds under explicit, revocable OS/user
  grants.
- Browser/model input cannot widen company, capability, path or network scope.
- Every run records exact release, complete policy, grants, scope, tool evidence
  and result hashes.
- Cross-tenant SQL/file, path escape, local exfiltration and legacy-bypass suites
  fail closed.
