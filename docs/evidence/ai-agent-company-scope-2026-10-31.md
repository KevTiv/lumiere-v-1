# AI agent company scope repair

Task / base SHA: A1 source repair, base `1b842603d950c6c94bb91c845c4cfbe5f8c5e1ec`.

Files changed: canonical AI-agent query registry, field-policy regression, shared
agent selector and its tests, Report analysis and Finance review consumers, web
unit-test registration, this evidence note.

Before path: both forms call `useAiAgents` -> `/api/query/ai-agents` -> HTTP SQL
column authorization. The default registry omitted `company_id`. Both selectors
used a nullish check, so missing scope appeared organization-wide.

After path: the canonical projection includes company scope. Existing HTTP field
policy preserves scope in restricted reads. Both forms use the same strict
selector. Missing/undefined, malformed or foreign scope is unavailable. Explicit
null retains organization-wide discovery under the existing organization checks.
The gateway remains the execution authority for the current skill/agent binding.

Canonical owners reused: `resource_registry.json`, `resolve_http_sql_columns`,
`useAiAgents` and existing governed skill routes. No new mutation path was added.

Effect identity + cardinality: read-only discovery by exact agent ID,
organization ID and company binding. No record was created or changed by testing.

Resulting record ref: none; source-only change.

Typed outcomes/errors: unavailable agents are excluded before submission. Current
server rejection remains authoritative. No error-message parsing was introduced.

Tests run (command + result):

- `node --import <existing tsx loader> --test agent-company-scope.test.ts finance-review-model.test.ts`: seven passed.
- `tsc --noEmit --strict --target es2020 --skipLibCheck agent-company-scope.ts`: passed.
- Exact current `stdb-auth/src/lib.rs` compiled with `rustc --test` against matching cached dependency fingerprints; current dependency-free policy-core source rebuilt directly. `/private/tmp/lumiere-ai-scope-auth-tests`: all 91 passed, including default/selective AI binding and existing authorization tests. An initial arbitrary cached-dependency selection was incompatible; the coherent fingerprint build replaced it.
- `git diff --check`: passed.

Operator proof: none for the new source. No live deployment, paid provider call,
UI mutation or second actor was used. Current-head hosted checks, full web type
checking and deployed operator acceptance remain required.

Compatibility/debt retired: the two forms no longer treat omitted company scope
as organization-wide. Existing positive IDs remain supported as JSON number,
string or native bigint without numeric precision loss.

Remaining blocker/deferral: the coordinator must run supported code generation
for the canonical registry and integrate its shared outputs. The frontend registry
proxy re-exports the immutable contracts package; it was not edited manually.
No native schema or reducer signature changes in this packet. Do not describe
this source fix as deployed or as full tenant skill readiness.

Contract release required: no new native schema/reducer contract; coordinator
must determine the generated registry/staging publication requirements through
the existing codegen/release lane. No contract was published here.

Next bounded task: integrate the registry with shared generated artifacts,
verify the exact candidate, then test matching, missing and foreign-company
agent discovery through the signed-in deployed UI.
