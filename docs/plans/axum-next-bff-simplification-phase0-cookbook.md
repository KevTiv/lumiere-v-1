# Axum/Next BFF simplification — Phase 0 investigation cookbook

**Status:** Investigation complete; execution cookbook proposed — 2026-08-27
**Branch investigated:** `vibe/subscription-sql-dialect-followup-81a36a`
**Scope:** evidence and runbook only; no architecture-plan update or implementation is included here
**Tracks:** `axum`, `tokio`, `nextjs`, `ssr`, `query-hooks`, `realtime`, `route-ownership`, `typed-bff`
**Related:** [subscription-query-ir-codegen-plan.md](./subscription-query-ir-codegen-plan.md) · [spacetimedb-sql-dialect-subscription-gaps-plan.md](./spacetimedb-sql-dialect-subscription-gaps-plan.md) · [typed-bff-sdk-contract-hardening-execution-plan.md](./typed-bff-sdk-contract-hardening-execution-plan.md) · [stdb-pg-api-contract-consistency-plan.md](./stdb-pg-api-contract-consistency-plan.md)

---

## 1. Purpose

Determine, with current-repository evidence, whether Lumière can simplify its frontend/backend communication by:

1. making Axum/Tokio the unambiguous application BFF;
2. keeping Next.js for SSR, React Server Components, presentation, and UI-only composition;
3. deleting redundant Next-to-Rust forwarding shells;
4. replacing multiple SSR resource requests with one bounded typed Rust operation;
5. preserving existing frontend hooks, cache keys, initial-data behavior, and realtime semantics.

This cookbook is deliberately produced before changing the broader plans. Its job is to make the first execution run reviewable and measurable, and to expose the decisions that still need approval.

## 2. Investigated decision

Use this ownership split for the Phase 0 proof:

```text
Cloudflare / Kong / same-origin routing
│
├── pages, assets, RSC rendering ───────────────→ Next.js
│
├── application API, auth, files, reports ─────→ Axum/Tokio
├── realtime ───────────────────────────────────→ Axum/Tokio
├── workers and durable Postgres ───────────────→ Rust worker services
│
└── presentation-only and selected AI UI routes → Next.js
```

Do **not** transpose the Rust application server into Next.js during Phase 0. That would duplicate STDB scope/codec knowledge, remove the common web/mobile API boundary, and put WebSockets, durable workers, Postgres orchestration, reports, files, and webhooks into a request runtime that does not own their lifecycle.

The simplification target is one application BFF plus one presentation server, not replacing Rust with TypeScript.

## 3. Investigation snapshot

The following counts were collected read-only on the branch named above:

| Surface | Current count | Method |
|---|---:|---|
| Axum `.route(...)` registrations | 89 | `rg -c '\.route\(' api-server/src/http_app.rs api-server/src/routes/*.rs api-server/src/document_blobs.rs` |
| Rust route-bearing files | 25 | same inventory |
| Next `app/api/**/route.ts` files | 63 | `find frontend/web/app/api -name route.ts` |
| Next files using the Rust forwarding helper | 32 | `rg -l 'forwardToApiServerRequired|forwardToApiServerIfEnabled' ...` |
| Pure Rust-forwarding Next files | 29 | manual classification of the 32 files |
| Forwarded handlers with extra Next behavior | 3 | signup analytics, tenant-bootstrap analytics, signout fallback |
| Next files proxying/orchestrating the AI gateway | 24 | `fetchAiGateway` / `proxyAiGateway` inventory |
| Top-level frontend module directories | 30 | `frontend/web/app/(modules)` inventory |
| Module pages | 31 | page inventory |
| SSR-seeded module pages | 22 | `serverFetchQuery*` call inventory |
| Individual SSR resource-list seeds | 137 | resource arrays passed to server query helpers |

The current composition root already makes Rust the application boundary:

- generic resource reads, reducer commands, realtime, and domain routers are mounted in [`api-server/src/http_app.rs`](../../api-server/src/http_app.rs);
- all Rust domain routers are composed in [`api-server/src/routes/mod.rs`](../../api-server/src/routes/mod.rs);
- Server Components call Rust directly through [`frontend/web/lib/server-query.ts`](../../frontend/web/lib/server-query.ts);
- browser generic query/call traffic can use the rewrites in [`frontend/web/next.config.mjs`](../../frontend/web/next.config.mjs);
- browser realtime already connects directly to the Rust WebSocket through [`frontend/web/app/providers.tsx`](../../frontend/web/app/providers.tsx).

## 4. Branch safety boundary

The investigated branch has active, uncommitted subscription-dialect work in or around:

- `api-server/src/query_exec.rs`;
- `crates/stdb-auth/src/erp_subscriptions.rs`;
- `crates/stdb-auth/src/lib.rs`;
- `frontend/packages/stdb/src/queries/erp-subscriptions.ts` and its test;
- generated reducer/contract package pins.

Phase 0 implementation must not mix subscription SQL corrections with route deletion, bootstrap semantics, or realtime queue/lifecycle changes in one commit. In particular:

1. do not regenerate or rewrite the active subscription artifacts as part of the cookbook run;
2. isolate any later `query_exec.rs` overlap and rebase after the dialect work is stable;
3. preserve the current realtime JSON frame shapes and subscription SQL during lifecycle hardening;
4. run the current branch's focused subscription verification before and after rebasing a Phase 0 implementation.

## 5. Current communication paths

### 5.1 SSR reads

```text
Next Server Component
  → serverFetchQueryListsAllowEmpty
  → Promise.all(one HTTP request per resource)
  → Axum GET /v1/query/:resource
  → session/scope resolution per request
  → STDB query
```

`Promise.all` makes the requests concurrent but does not make them one BFF operation. Each resource still crosses HTTP and resolves the server session independently.

### 5.2 Client reads

```text
domain React Query hook
  → useSubscriptionAwareQuery / useStdbQuery
  → GET /api/query/:resource
  → same-origin rewrite or production ingress
  → Axum GET /v1/query/:resource
```

### 5.3 Client commands

```text
domain mutation hook
  → stdbBffCommandPost(reducer, named input)
  → POST /api/call/:reducer
  → Axum contract/exposure/scope validation
  → STDB reducer
```

Module components do not directly call `/api/call/*`; mutations are already concentrated in shared query-hook modules. This is a strong preservation boundary.

### 5.4 Realtime

```text
browser
  → Axum /v1/realtime/ws
  → authenticated/scoped Rust subscription bridge
  → STDB subscription
  → resource invalidation frames
  → invalidate both React Query key families
```

Next is already absent from the realtime data path.

## 6. Frontend module and hook cookbook

Phase 0 must keep exported hook signatures, mutation inputs, result shapes, resource names, query keys, and initial-data behavior unchanged. The table identifies the existing surface and how it should be treated.

| Module | Current SSR seed | Hook families that must remain compatible | Phase 0 disposition |
|---|---|---|---|
| Accounting | 8 resources | `accounting`, plus CRM, Sales, Reports, Documents | Inventory only; later typed bootstrap after CRM proof |
| AI action drafts | none | `ai-action-drafts` | No change |
| AI harness | companies | `ai-harness`, `ai-low-stock`, `ai-report-composer`, `owner-reports` | Keep Next/AI orchestration separate from core BFF proof |
| AI skills | none | `ai-skills`, `ai-skill-registry` | No route deletion without separate AI review |
| Approvals | none | `approvals` | No change |
| Calendar | calendar events | `calendar`, CRM activities | Good later one-resource conversion; not first pilot |
| CRM | leads, opportunities, contacts | `crm`, plus Accounting, Auth, Inventory, Messages, Sales | **First typed-bootstrap pilot** |
| Distributor | none | Accounting, Inventory, Organization/Company, Sales | No change |
| Documents | 8 resources | `documents`, `templates`, `ai-agents` | Keep file/blob/report behavior Rust-owned; later bootstrap |
| Expenses | expenses, sheets, pricelists, employees | Expenses, Approvals, HR, Sales, Accounting | Later cross-domain bootstrap |
| Forensics | none | no shared query-hook import | No change |
| Helpdesk | tickets, teams, stages, SLAs | `helpdesk`, Inventory users | Good second bounded bootstrap candidate |
| HR | employees, departments, leave, contracts, payslips, pricelists | `hr`, Sales | Later; sensitive scope and partial data require dedicated review |
| Inventory | 15 resources | Inventory, CRM, Documents, Sales | Later; too broad for first proof |
| IoT | 7 resources | IoT, Inventory | Later; retain streaming/edge separation |
| Manufacturing | 11 resources | Manufacturing, Inventory, IoT | Later; cross-domain and operationally broad |
| Map | none | `map`, `fleet` | No change |
| Messages | messages, followers | Messages, CRM, Accounting | Good later small bootstrap candidate |
| Overview | 8 cross-domain resources | Accounting, CRM, Inventory, Projects, Purchasing, Sales, Messages | Migrate last; it is an aggregation benchmark, not a first proof |
| POS | products, terminals, configs, sessions | POS, Inventory, Sales | Defer until POS UOM/tax/config boundaries are explicit |
| Projects | projects, tasks, timesheets, pricelists, contacts | Projects, Accounting, CRM, Expenses, Inventory, Sales | Later cross-domain bootstrap |
| Proposals | proposals | Proposals, Inventory, Settings | Good later one-resource conversion |
| Purchasing | 9 resources | Purchasing, Accounting, Approvals, CRM, HR, Inventory, Sales | Later; broad company scope |
| Reports | 8 resources | Reports, Owner Reports, Accounting, Settings | Use one route as direct-routing proof; defer page bootstrap |
| Sales | 17 resources | Sales, Accounting, Approvals, CRM, Documents, Inventory | Later; largest business surface |
| Settings | none | Auth, Organization/Company | No change |
| Subscriptions | 10 resources | Subscriptions, Accounting, Inventory, Sales | Later; billing/durable semantics |
| Tasks | projects, tasks | Projects | Good later small bootstrap candidate |
| Trackers | none | no shared query-hook import | No change |
| Workflows | workflows, versions, instances | Workflows | Preserve HTTP freshness; no native module subscription today |

Representative SSR resource declarations are in:

- [`frontend/web/app/(modules)/crm/page.tsx`](../../frontend/web/app/(modules)/crm/page.tsx);
- [`frontend/web/app/(modules)/accounting/page.tsx`](../../frontend/web/app/(modules)/accounting/page.tsx);
- [`frontend/web/app/(modules)/inventory/page.tsx`](../../frontend/web/app/(modules)/inventory/page.tsx);
- [`frontend/web/app/(modules)/sales/page.tsx`](../../frontend/web/app/(modules)/sales/page.tsx).

## 7. Compatibility contract

### 7.1 Public hooks

For the CRM pilot, these existing signatures remain unchanged:

```text
useLeads(organizationId, initialData?)
useOpportunities(organizationId, initialData?)
useContacts(organizationId, initialData?)
```

The page continues passing the same `initialLeads`, `initialOpportunities`, and `initialContacts` props into the current client component. The transport beneath those props may change; consumers do not.

### 7.2 Query keys

Both current key families must survive Phase 0:

```text
domain key:  [resource, organizationIdString]
generic key: ["stdb", resource, organizationIdString, optional company scope]
```

The realtime bridge invalidates both families, including special aliases. Deleting or renaming one family before all hooks migrate can leave screens stale without a type error.

### 7.3 Initial-data retry behavior

`coalesceQueryInitialData` intentionally changes an empty SSR seed into `undefined`, allowing the client query to retry rather than treating `[]` as authoritative for its stale window.

The pilot must preserve this behavior. A typed empty array must not accidentally suppress the first client refetch when the SSR source was unavailable.

### 7.4 Company scope

Current SSR generic reads do not necessarily pass the active `companyId`, while browser generic hooks can add it. The bootstrap must reproduce the exact current SSR visibility contract. It may not silently narrow or widen data based on the active browser company.

## 8. Rust module ownership

| Rust area | Responsibilities | Next treatment |
|---|---|---|
| `http_app.rs` | generic reads/commands, session scope, realtime composition | Direct same-origin routing; never duplicate in Next |
| `routes/auth.rs` | signin/signup/signout, secure STDB cookies, password/invite flows | Keep Rust authority; retain explicit Next analytics/fallback adapters where required |
| `routes/crm.rs` | typed CRM domain routes | Reuse for bootstrap ownership; no duplicate Next CRM backend |
| `routes/accounting.rs` | accounts, payments, reconciliation | Keep Rust |
| `routes/reports.rs` + `reports/*` | typed aggregation, artifacts, schedules, Chromium worker | Keep Rust; use catalog as routing proof |
| `routes/documents.rs` + `document_blobs.rs` | files, checksum, limits, ownership, exports | Keep Rust |
| `routes/import.rs` | bounded imports and reducer dispatch | Keep Rust |
| `routes/stdb.rs` | authenticated STDB proxy and subscription descriptors | Keep Rust; protected by current branch work |
| `routes/whatsapp_webhooks.rs` | HMAC verification and STDB forwarding | Keep Rust |
| `cold_tier/*` | durable Postgres reads/drainers/ledger | Keep Rust worker boundary |
| integration/workflow/report workers | polling, leases, retries, external I/O | Keep separate Rust binaries; never put in Next request lifecycle |

## 9. Next route-handler classification

### 9.1 Pure forwarding candidates

Twenty-nine Next route files only forward to Rust. They are deletion candidates **after** local rewrites and production ingress route the same public paths to Axum and compatibility tests prove headers, bodies, status, streaming, and cookies survive.

Candidate families include:

- bank-statement imports;
- AI skill certifications;
- most auth endpoints;
- bootstrap currencies;
- document blobs and exports;
- imports;
- queued mail dispatch;
- reports/history/schedules/preview/PDF;
- vertical packs.

Current generic rewrites cover only `/api/query/*` and `/api/call/*`; they are insufficient for deleting the domain wrappers.

### 9.2 Forwarded routes with retained Next behavior

Do not mechanically delete:

1. signup, which records server-side analytics after forwarding;
2. tenant bootstrap, which records bootstrap analytics;
3. signout, which retains WorkOS and local-cookie fallback behavior.

These must either remain small presentation adapters or have their extra behavior moved deliberately to an event/analytics boundary.

### 9.3 AI and Next-local routes

AI gateway routes perform authentication, company validation, sanitization, privacy policy, streaming, and payload transposition. They are not part of the core BFF proxy-deletion run. Health/dev routes are also separate.

## 10. Phase 0 execution recipe

Execute the following in order. Each numbered item should be independently reviewable and reversible.

### P0.0 — freeze and baseline

- [ ] Rebase or sequence after the active subscription-dialect changes are stable.
- [ ] Record `git status --short`; do not overwrite unrelated work.
- [ ] Record the 63/32/29 route-handler baseline and regenerate the ownership inventory in CI or a checked script.
- [ ] Add compile-time contract coverage for the three CRM hook signatures and their result types.
- [ ] Snapshot both query-key families for `leads`, `opportunities`, and `contacts`.
- [ ] Record current CRM SSR request count: three Rust HTTP requests.
- [ ] Record current partial-failure behavior and empty-seed retry behavior.
- [ ] Record current realtime active connection, process-thread, and RSS behavior across connect/disconnect cycles before changing it.

**Gate:** evidence is committed before behavior changes; current subscription tests remain green.

### P0.1 — direct-routing proof

Use one pure forwarding route, preferably `GET /api/reports/catalog`, as the proof.

- [ ] Add explicit local rewrite and production ingress ownership for the selected path.
- [ ] Keep the public `/api/reports/catalog` URL unchanged.
- [ ] Verify authorization/cookie/header propagation through direct routing.
- [ ] Compare body, status, content type, cache headers, and error shape with the current Next wrapper.
- [ ] Delete only the selected pure forwarding `route.ts` after parity passes.
- [ ] Do not touch signup, tenant bootstrap, signout, AI routes, uploads, or streaming downloads in this proof.

**Gate:** one Next forwarding file is gone, no caller changes, and direct same-origin Axum routing is proven in local and production-like topology.

### P0.2 — typed CRM bootstrap

Add one curated operation such as:

```text
GET /v1/crm/page-bootstrap
```

Conceptual response:

```json
{
  "leads": { "available": true, "rows": [] },
  "opportunities": { "available": true, "rows": [] },
  "contacts": { "available": false, "rows": [] }
}
```

Requirements:

- [ ] Resolve and validate the session and organization once.
- [ ] Reproduce the current SSR company-scope behavior exactly.
- [ ] Execute exactly the three fixed reads concurrently.
- [ ] Use `tokio::join!` with separate results, or an equivalent typed section result, to preserve partial availability. Do not accidentally replace current semantics with fail-fast all-or-nothing `try_join!`.
- [ ] Log/trace section failures without leaking sensitive details.
- [ ] Do not accept arbitrary resource names, SQL, organization, or durable-store selection.
- [ ] Change only the CRM Server Component fetch.
- [ ] Continue passing the same three initial props to `CrmClient`.
- [ ] Leave `useLeads`, `useOpportunities`, `useContacts`, mutations, fallback queries, resource names, and both query-key families unchanged.
- [ ] Preserve the empty-seed client retry behavior.
- [ ] Do not include stages, lines, tags, segments, products, warehouses, users, inbox panels, or other secondary client-demanded datasets.

**Gate:** CRM SSR performs one Rust HTTP request instead of three; hook consumers and realtime invalidation remain unchanged.

### P0.3 — remove remaining module-level query escapes in CRM

After bootstrap parity, CRM still has three direct resource refresh paths in its module client.

- [ ] Replace those direct `fetchQueryList` calls with the existing query client's refetch/invalidation mechanism.
- [ ] Prove the same visible refresh timing.
- [ ] Do not change mutation inputs or generic HTTP fallback yet.

**Gate:** CRM module components use shared hooks/query-client behavior rather than constructing transport requests.

### P0.4 — realtime lifecycle ownership

The current Rust bridge creates an unbounded channel, an OS thread, a nested current-thread Tokio runtime, and an STDB connection per browser socket. Socket exit does not visibly own a cancellation/disconnect/join path.

Mandatory lifecycle work:

- [ ] Introduce an owned per-socket bridge handle.
- [ ] On browser close/error, signal cancellation and call `DbConnection::disconnect`.
- [ ] Ensure the SDK driver/thread terminates and is joined or otherwise supervised.
- [ ] Preserve `subscribed`, `change`, and `error` JSON frames.
- [ ] Preserve current subscription SQL and resource validation on this branch.
- [ ] Add active WebSocket and active STDB bridge-driver gauges plus disconnect-reason counters.

**Gate:** after repeated connect/disconnect cycles, active socket/driver gauges, thread count, and RSS return to baseline.

### P0.5 — bounded/coalesced realtime invalidation

Do not naively replace the unbounded sender with blocking sends on the STDB driver callback; that can stall subscription processing.

- [ ] Separate control frames from invalidation events.
- [ ] Use a bounded queue and nonblocking `try_send` from callbacks.
- [ ] Coalesce invalidations by resource/table because frames are wake-ups, not authoritative row payloads.
- [ ] Define overflow semantics: mark resources dirty and send one wake-up, or disconnect with a retryable signal that forces refetch.
- [ ] Never drop authentication, subscribed, or error/control frames silently.
- [ ] Add queued, coalesced, dropped, and overflow metrics.

**Gate:** a slow-client burst cannot exceed configured memory, and a final refetch converges to authoritative state.

### P0.6 — Tokio request-path hygiene before load testing

- [ ] Move synchronous blob/report filesystem work to `tokio::fs` where appropriate.
- [ ] Move CPU-heavy PDF/XLSX generation to `spawn_blocking` or a dedicated worker.
- [ ] Keep existing file size, checksum, organization ownership, and artifact validation.
- [ ] Add explicit outbound timeouts for renderer/external requests.
- [ ] Document graceful shutdown and task supervision for standalone worker binaries; do not merge workers into the web API or Next.

**Gate:** maximum allowed file/report work does not materially starve `/health` or lightweight query latency.

## 11. Module rollout after the pilot

Do not mechanically generate one bootstrap for every page. Promote modules based on measured SSR request count, stable scope semantics, and actual latency.

Suggested order:

1. CRM proof;
2. Calendar, Proposals, Tasks, Messages, Helpdesk;
3. Accounting, Reports, Expenses, HR, Projects;
4. Purchasing, Subscriptions, Documents;
5. Inventory, Manufacturing, IoT;
6. Sales;
7. Overview last as the cross-domain aggregation benchmark;
8. POS only after unresolved business defaults are explicit.

For every module:

- preserve public hooks and keys;
- use a fixed typed operation, never arbitrary resource batching;
- resolve scope once;
- encode partial versus required sections explicitly;
- measure request reduction and latency;
- remove direct component-level query calls;
- delete only proven redundant Next wrappers.

## 12. Verification cookbook

### 12.1 Static inventory

```bash
git status --short
git branch --show-current
rg -n 'serverFetchQuery' 'frontend/web/app/(modules)' --glob 'page.tsx'
rg -n '/api/(query|call)' 'frontend/web/app/(modules)' --glob '*.ts' --glob '*.tsx'
rg -n 'queryKey:' frontend/packages/query-hooks/src/hooks frontend/packages/query-hooks/src/subscription-query.ts
find frontend/web/app/api -name route.ts | sort
rg -l 'forwardToApiServerRequired|forwardToApiServerIfEnabled' frontend/web/app/api --glob route.ts
```

### 12.2 Rust and frontend checks

```bash
cargo fmt --all -- --check
cargo check -p api-server --all-targets
cargo test -p api-server
pnpm --dir frontend --filter @lumiere/query-hooks typecheck
pnpm --dir frontend --filter @lumiere/query-hooks test
pnpm --dir frontend --filter ./web typecheck
pnpm --dir frontend --filter ./web test:unit
```

Clippy may be added once the existing branch is known clean under the selected warning policy; do not describe unrelated pre-existing warnings as Phase 0 regressions.

### 12.3 Focused live checks

Reuse the existing local E2E stack when its source hashes are current:

```bash
make e2e-single E2E_SPEC=crm-read-isolation.spec.ts E2E_GREP=
make e2e-single-test E2E_SPEC=realtime-smoke.spec.ts E2E_GREP=
make e2e-single-test E2E_SPEC=subscription-smoke.spec.ts E2E_GREP=
```

Use `E2E_FORCE_REBUILD=1` only when the hash-gated API/STDB state is untrusted. Use a clean-data run before claiming full-suite status.

### 12.4 Required new deterministic tests

1. CRM bootstrap authenticates once and rejects client-supplied org/company authority.
2. Each CRM section returns the documented available/unavailable result independently.
3. Existing hook initial-data props and both query-key families remain identical.
4. Direct routing preserves cookies, auth headers, response headers, body, and errors.
5. Realtime cross-org/company/resource requests remain rejected.
6. Socket cancellation terminates the STDB driver.
7. Queue capacity, coalescing, overflow, and control-frame priority are deterministic.

## 13. Measurable exit criteria

Phase 0 is complete only when all of the following are demonstrated:

1. CRM SSR Rust requests fall from three to one.
2. One session resolution and one organization/company scope resolution occur per bootstrap request.
3. CRM hook signatures, result shapes, query keys, mutations, and realtime resource names do not change.
4. Partial CRM source failures have documented deterministic behavior and still allow the appropriate client retry.
5. At least one pure Next forwarding route is deleted after direct-routing parity.
6. No worker, drainer, Postgres, report, file, webhook, or realtime lifecycle moves into Next.
7. Realtime active-socket and bridge-driver gauges return to zero after 100–1,000 connect/disconnect cycles.
8. Slow-client invalidation bursts remain within the configured queue bound and converge after refetch.
9. Existing focused Rust, hook, web-unit, CRM, realtime, and subscription checks pass.
10. The active subscription-dialect branch changes remain intact and independently reviewable.

## 14. Decisions required before updating the broader plan

After the cookbook run, use evidence to decide:

1. whether typed bootstrap operations materially improve SSR latency and code volume;
2. whether direct ingress routing should expand to all 29 pure proxy handlers;
3. where signup/bootstrap analytics and signout fallback should live;
4. whether the Rust-first operation/type exporter should be a minimal in-house Axum seam or a library such as Specta/rspc;
5. whether WebSocket invalidations remain preferable to a future SSE adapter;
6. which module is the second bootstrap candidate;
7. which compatibility layers can be moved from a ratchet to a zero-tolerance lint.

Only then update the long-term BFF/contracts plan. Phase 0 should produce proof, not commit the repository to a framework before the route, hook, failure, and runtime behavior are measured.
