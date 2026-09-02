# Subscription query IR/codegen plan

**Status:** Proposed — final application-contract IR cleanup for PR #3  
**Track:** `application-contract-ir`, `subscription-codegen`, `stdb-query-compiler`, `frontend-realtime`, `contract-drift`, `subscription-performance`, `access-paths`, `fanout-control`  
**Related:** [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md) · [stdb-index-access-path-optimization-plan.md](./stdb-index-access-path-optimization-plan.md) · [stdb-access-path-post-batch-pickup.md](./stdb-access-path-post-batch-pickup.md)

---

## 1. Objective

Remove handwritten frontend subscription SQL as the final major drift/bug surface in the current application-contract IR work, while making realtime access paths explicitly bounded and performance-aware.

The current frontend subscription registry still hand-defines resource-specific STDB SQL, tenant/company scoping, projections, ordering, and special-case predicates. This has already produced subscription-query bugs and remains one of the last blockers to a fully green test suite.

The performance work discovered while reviewing reducers changes the bar for this track: a subscription is not considered complete merely because the SQL is valid and authorized. Its access shape, expected cardinality, update fanout, projection choice, and compatibility with a declared STDB access path must also be explicit.

The target state is:

```text
STDB schema/domain metadata
        ↓
application-contract IR
        ↓
SubscriptionDescriptor
  scope / predicates / projection
  access-path requirement
  expected cardinality
  fanout / latency class
        ↓
STDB subscription compiler
        ↓
validated subscription SQL
        ↓
access-path + fanout validation
        ↓
generated subscription service / React hook
```

IR owns **subscription semantics and expected access shape**. The STDB transport adapter owns **SQL syntax**. Frontend feature code owns neither.

---

## 2. Problem statement

Today, `frontend/packages/stdb/src/queries/erp-subscriptions.ts` contains a large handwritten mapping between frontend resource keys and STDB subscription SQL.

That creates several failure modes:

- schema/table changes can drift from subscription SQL;
- organization/company scoping can be omitted or expressed incorrectly;
- generated field projections can diverge from subscription projections;
- special STDB SQL limitations leak into frontend code;
- query and subscription paths can return structurally different rows;
- ordering/predicate behavior can diverge between HTTP reads and realtime reads;
- newly generated resources still require manual subscription wiring;
- tests can fail because the generated contract is correct while handwritten realtime SQL is stale;
- a syntactically valid subscription can still scan or observe far more rows than intended;
- a broad organization subscription can create disproportionate update fanout;
- a filtered queue can have correct predicates but no compatible tenant-prefixed access path;
- an existing optimized projection can be bypassed by subscribing to canonical source tables;
- reconnection can recreate many expensive broad subscriptions simultaneously.

The existing IR/codegen work already centralizes query/resource contracts. Subscription semantics should join that boundary instead of remaining a parallel handwritten registry.

---

## 3. Architectural boundary

```text
                     application-contract IR
                              │
                 ┌────────────┴────────────┐
                 │                         │
          QueryDescriptor          SubscriptionDescriptor
                 │                         │
          HTTP/STDB adapter          STDB realtime adapter
                 │                         │
          bounded read query       compiled subscription SQL
                 │                         │
                 └────────────┬────────────┘
                              │
                    shared typed result
                              │
                     @lumiere/contracts
                              │
                   frontend services/hooks
```

The same resource contract must describe what may be observed regardless of transport.

Do not place raw SQL in application IR.

Do not let feature code concatenate subscription SQL.

The shared IR should also describe enough read intent that STDB query and subscription compilation can validate against the same `AccessPathDescriptor` vocabulary used by reducer/query optimization.

---

## 4. Subscription descriptor model

Introduce a structural descriptor similar to:

```ts
export interface GeneratedSubscriptionDescriptor {
  resource: QueryResourceKey
  source: GeneratedReadSource
  projection: GeneratedProjectionPolicy
  scope: GeneratedSubscriptionScope
  predicates: readonly GeneratedSubscriptionPredicate[]
  orderBy: readonly GeneratedSubscriptionOrder[]
  fieldPolicy?: FieldPolicyKey
  capability?: CapabilityKey
  realtime: boolean

  accessPath?: AccessPathKey
  expectedCardinality: "one" | "few" | "bounded-page" | "bounded-set" | "broad"
  latencyClass: "interactive" | "background" | "presence"
  updateFanout: "low" | "medium" | "high"
  sourceClass: "canonical-table" | "hot-projection"
  reconnectClass?: "eager" | "staggered" | "on-demand"
}

export type GeneratedSubscriptionScope =
  | { kind: "global" }
  | { kind: "organization" }
  | { kind: "company" }
  | { kind: "identity" }
  | { kind: "organization+identity" }
  | { kind: "organization+company" }
```

The descriptor may reference generated schema/type/access-path metadata, but should not contain STDB-specific SQL fragments.

`broad` is an explicit exception class. It must never be inferred simply because no narrower access path was declared.

---

## 5. Generated scope semantics

Scope must be explicit and fail closed.

Representative mappings:

```text
organization-scoped table
→ organization_id = runtime.organizationId

company-scoped table
→ company_id constrained to runtime.companyIds

identity-scoped resource
→ identity constrained to server/runtime-derived identity

field-sensitive resource
→ projection compiled through generated field-policy metadata
```

Important rule:

> A realtime resource without an explicit valid scope is a generation error unless it is explicitly declared safe/global.

Frontend code must not decide whether a resource is organization-, company-, or identity-scoped.

For tenant-owned interactive subscriptions, organization scope should normally be the leading access-path prefix. Exceptions require an explicit documented reason.

---

## 6. STDB subscription compiler

Generate or implement one deterministic compiler:

```ts
compileSubscription(
  descriptor: GeneratedSubscriptionDescriptor,
  context: SubscriptionQueryContext,
): string
```

Responsibilities:

- resolve generated table/read-model names;
- resolve generated column projection;
- inject organization/company/identity scope;
- apply allowed generated predicates;
- apply deterministic ordering;
- apply field-access projection when required;
- escape/encode runtime literals safely;
- enforce STDB subscription-query limitations;
- reject incomplete runtime context instead of widening scope;
- validate predicate/order shape against the declared access path;
- reject interactive subscriptions whose declared cardinality/fanout class cannot be satisfied by the compiled shape.

The compiler is transport infrastructure. It must not contain domain business logic.

---

## 7. Handle STDB SQL limitations centrally

Current subscription code carries STDB-specific workarounds such as requiring resolved `companyIds` for resources where subscription SQL cannot use the desired nested/subquery form.

Move those constraints behind the compiler.

Example:

```text
Generated scope: company
        ↓
compiler receives organizationId
        ↓
placement/query layer resolves allowed companyIds
        ↓
compiler emits bounded company predicate
```

If required context is unavailable:

```text
missing companyIds
→ subscription construction fails closed
→ no unscoped fallback query
```

This removes STDB SQL-engine knowledge from frontend feature code.

---

## 8. Query/subscription parity

Every realtime-capable generated resource should have a parity contract between ordinary reads and subscriptions.

Parity includes:

- source/read model;
- result type;
- organization/company/identity scope;
- field projection;
- default predicates;
- stable ordering when required;
- nullable/serialized representation;
- compatible access-path requirement where both transports are interactive;
- compatible expected cardinality.

Generated validation should be able to prove:

```text
query(resource, context)
subscription(resource, context)

→ same visible row shape
→ same authorization/scope boundary
→ compatible physical access intent
```

Transport-specific limitations may alter execution strategy but not the observable contract.

---

## 9. Generated artifacts

Extend `@lumiere/contracts` with a dedicated realtime surface:

```text
@lumiere/contracts
  ├── generated/query-registry
  ├── query
  └── realtime
      ├── subscription-descriptors
      ├── subscription-resource-registry
      ├── subscription-result-types
      ├── subscription-performance-manifest
      └── react-query / realtime adapters
```

Normal frontend features should consume generated APIs such as:

```ts
useSubscription("sale-orders", context)
```

or generated domain-specific wrappers:

```ts
useSaleOrdersSubscription(context)
```

Feature modules should not import or construct SQL.

---

## 10. Migration of `erp-subscriptions.ts`

Treat `frontend/packages/stdb/src/queries/erp-subscriptions.ts` as the primary migration proof.

The current registry contains hundreds of resources spanning accounting, sales, projects, HR, inventory, purchasing, MRP, documents, subscriptions, expenses, IoT, auth, and derived operational queues. That breadth means the migration must be a census, not a sampled rewrite.

Target sequence:

```text
handwritten resource registry
        ↓
classify each resource by generated descriptor
        ↓
classify access path + cardinality + fanout
        ↓
move projection/scope/predicate/order metadata into IR
        ↓
generate descriptors
        ↓
compile through shared STDB adapter
        ↓
validate against STDB access-path inventory
        ↓
remove handwritten SQL branches
        ↓
retain only a thin compatibility facade if needed
        ↓
delete facade after consumers migrate
```

Do not perform a mechanical string migration where SQL templates simply move into generated files. The IR must become structural.

---

## 11. Special resource classes

During migration, classify resources explicitly.

### A. Standard organization-scoped

Most ERP resources should be derivable from generated ownership metadata.

### B. Company-scoped

Require resolved allowed company IDs and fail closed when unavailable.

### C. Identity-scoped

Examples such as user-specific or manager/direct-report resources require explicit actor-derived runtime context.

### D. Field-policy-sensitive

Projection must reuse the same generated field-access metadata as HTTP/query reads.

### E. Private/BFF-only

Resources not safely subscribable directly must be represented as:

```text
realtime: false
transport: bff-only
```

They must not gain a direct subscription merely because a table exists.

### F. Derived/filter views

Resources such as `*-to-approve`, `*-pending`, `*-past-due`, or other queue/view semantics need explicit bounded predicates represented structurally in IR.

### G. Presence/high-churn

Presence/collaboration resources require a dedicated high-write/high-fanout classification. Prefer resource/record/user-scoped identities and short bounded working sets; do not treat them like broad organization tables.

### H. Projection-backed operational summaries

If reducer performance work establishes a maintained hot projection for a UI surface, the subscription descriptor should prefer that projection rather than resubscribing to all canonical source rows and recomputing client-side.

---

## 12. Codegen validation

Add generation-time failures for:

- realtime resource missing a subscription descriptor;
- subscribable tenant-owned resource missing scope metadata;
- unknown table/read-model reference;
- unknown projection field;
- query/subscription result-shape drift;
- query/subscription tenant-scope drift;
- company-scoped subscription without a declared company-context requirement;
- identity-scoped subscription without identity context;
- field-sensitive resource bypassing field-policy projection;
- raw SQL embedded in generated application IR metadata;
- handwritten resource added to the frontend compatibility registry without an IR entry;
- direct-subscription exposure for a BFF/private resource;
- interactive subscription without expected cardinality;
- interactive tenant subscription without a compatible tenant-prefixed `AccessPathDescriptor` unless explicitly exempted;
- predicates/order incompatible with the declared access path's left-prefix/range semantics;
- `broad` cardinality without an explicit reason and benchmark/load-test owner;
- high-fanout canonical-table subscription where an approved hot projection is the declared resource contract;
- presence subscription without bounded resource/record/session identity;
- reconnect class missing for high-fanout subscriptions.

Generated behavior should fail closed rather than emit broad SQL.

---

## 13. Drift enforcement

Add CI checks so subscription behavior cannot silently drift after this migration.

Suggested checks:

```bash
# no new handwritten ERP subscription SQL
rg 'SELECT .* FROM' frontend/packages/stdb/src/queries/erp-subscriptions.ts

# generated contract is current
pnpm generate:contracts
pnpm migrate:contracts:check

# generated outputs unchanged
# repository-specific generated drift check
```

Prefer AST/codegen ownership checks over regex alone once the generation pipeline exposes the required metadata.

Also fail CI if a new realtime resource appears without census classification, access-path classification, expected cardinality, source class, and fanout/reconnect policy.

---

## 14. Test strategy

This track is explicitly tied to completing the remaining green-test work.

### Unit tests

Test compiler behavior for:

- organization scope;
- company scope;
- missing company context;
- identity scope;
- organization + identity scope;
- field-policy projection;
- predicates;
- ordering;
- literal escaping;
- `realtime: false` resources;
- access-path compatibility;
- invalid left-prefix/range shapes;
- cardinality/fanout validation;
- projection-backed sources;
- high-fanout reconnect behavior metadata.

### Contract tests

For each representative resource class:

```text
Generated QueryDescriptor
vs
Generated SubscriptionDescriptor
```

Assert compatible source, result shape, projection, scope, expected cardinality, and access-path intent.

### Regression tests

Capture every currently failing subscription query caused by handwritten SQL before deleting the old branch. Each bug becomes a permanent regression fixture.

### Integration tests

Run actual STDB subscription setup against representative resources and verify the subscription is accepted and emits expected typed rows.

### Load/fanout tests

For representative subscription classes, measure:

- setup latency;
- reconnect setup latency;
- update propagation latency;
- rows in initial result;
- rows affected per representative mutation;
- CPU/memory cost where observable;
- behavior under 100 / 500 / 1,000 concurrent subscribing clients;
- reconnect storm behavior for eager vs staggered/on-demand subscriptions.

### Frontend tests

Verify realtime consumers update through generated subscription APIs without direct resource SQL knowledge.

---

## 15. Representative proof cases

Use a deliberately mixed set rather than only easy organization-owned tables.

### Proof A — standard organization scope

```text
sale-orders
```

Generated descriptor and HTTP query must expose the same scoped result shape and map to a declared organization-led access path.

### Proof B — company scope

```text
fixed-assets / intercompany resources
```

Compiler requires allowed company IDs and never falls back to an unscoped query.

### Proof C — identity scope

```text
my-employee / direct-reports / user roles
```

Identity context is runtime-derived and represented explicitly in the descriptor contract.

### Proof D — field-policy resource

Use an HR/PII-sensitive resource and verify subscription projection cannot expose fields hidden by the ordinary read path.

### Proof E — filtered operational queue

```text
sale-orders-to-approve
subscription-past-due
payslips-to-export
```

Predicate semantics are generated structurally, stay in parity with ordinary query behavior, and have a compatible tenant/status/time access path where needed.

### Proof F — BFF/private resource

A private CRM resource must remain non-direct-subscribable and fail generation/runtime attempts to compile direct STDB SQL.

### Proof G — high-volume inventory

```text
stock-quants
stock-moves
inventory-exceptions
```

Verify the chosen subscriptions match the access-path/projection decisions from the STDB performance plan rather than exposing broad inventory tables by convenience.

### Proof H — presence/high-churn

Use proposal/document/opportunity presence and prove subscriptions are record/session scoped, bounded, and reconnect-safe.

---

## 16. Phases

### Phase SQ-0 — exhaustive subscription census + failure capture

- [x] enumerate every `SUBSCRIPTION_RESOURCE_KEYS` entry;
- [x] classify standard/company/identity/field-policy/private/derived/presence/projection-backed resources;
- [ ] capture current failing subscription queries as regression fixtures;
- [ ] identify SQL branches duplicated from generated query metadata;
- [ ] document any STDB syntax/feature limitations currently handled manually;
- [x] map each realtime resource to its source table/read model;
- [ ] map each realtime resource to concrete frontend consumers/routes;
- [x] declare expected cardinality, latency class, update fanout, source class, and reconnect class;
- [ ] map each interactive subscription to a declared STDB access path or explicit exception;
- [ ] identify broad subscriptions whose actual consumer needs only a filtered queue, record set, or summary projection.

The checked-in [`subscription-census.json`](../../crates/stdb-auth/assets/subscription-census.json)
is the SQ-0 census foundation and contains one entry for each of the 273 TypeScript
`SUBSCRIPTION_RESOURCE_KEYS`. Consumer evidence is explicitly marked observed or
pending; route-level consumer mapping, access-path mapping, and live failure capture
remain open work.
`node scripts/validate-subscription-census.mjs` validates deterministic key/order
parity, required classification fields, fail-closed delivery/access metadata, and
the live-subscription API regression boundary. The Rust resource lists are recorded
as compatibility metadata rather than treated as authoritative: they currently omit
111 frontend keys and contain four Rust-only full-client/list keys. Each entry marks
live `subscriptionBuilder().subscribe(...)` acceptance as pending; `spacetime sql`
string validation is explicitly not considered equivalent.

**SQ-0 exit gate:**

```text
SUBSCRIPTION_RESOURCE_KEYS count
=
subscription census count
=
classified descriptor count

unclassified = 0
```

A resource may be classified `realtime: false`; it still must appear in the census if it exists in the compatibility registry.

### Phase SQ-1 — IR model

- [ ] add `GeneratedSubscriptionDescriptor`;
- [ ] add structural scope metadata;
- [ ] add generated predicate/order/projection metadata;
- [ ] add realtime eligibility/private transport metadata;
- [ ] add `accessPath`, `expectedCardinality`, `latencyClass`, `updateFanout`, `sourceClass`, and `reconnectClass`;
- [ ] reuse the shared `AccessPathDescriptor` vocabulary rather than inventing subscription-only physical metadata;
- [ ] include subscription contract fields in drift/version checks;
- [ ] fail generation for unsafe/incomplete descriptors.

### Phase SQ-2 — compiler + physical-access validation

- [ ] implement one STDB subscription compiler;
- [ ] centralize organization/company/identity context injection;
- [ ] centralize generated field projections;
- [ ] centralize STDB SQL limitations/workarounds;
- [ ] validate scope/predicate/order against the declared access path;
- [ ] add compiler unit tests and fail-closed cases;
- [ ] add warnings/errors for broad/high-fanout interactive subscriptions;
- [ ] validate projection-backed descriptors target their intended projection source.

### Phase SQ-3 — migration

- [ ] migrate standard organization-scoped resources first;
- [ ] migrate company-scoped resources;
- [ ] migrate identity and field-policy-sensitive resources;
- [ ] migrate derived/filter resources;
- [ ] migrate presence/high-churn resources with bounded identities;
- [ ] adopt approved hot projections where the STDB access-path work establishes them;
- [ ] mark private/BFF-only resources explicitly non-subscribable;
- [ ] reduce `erp-subscriptions.ts` to a generated/compatibility facade;
- [ ] remove the facade when consumers no longer require it.

### Phase SQ-4 — generated frontend surface + reconnect policy

- [ ] emit generated subscription registry/services;
- [ ] generate typed frontend hooks/adapters;
- [ ] remove feature-local SQL construction and duplicate subscription wrappers;
- [ ] ensure offline/reconnect consumers use the same operation/resource contract where applicable;
- [ ] centralize eager/staggered/on-demand reconnect policy;
- [ ] prevent reconnect storms from eagerly rebuilding every expensive subscription at once;
- [ ] allow route/visibility-driven subscriptions to remain on-demand when there is no reason to keep them globally active.

### Phase SQ-5 — load/fanout proof

- [ ] benchmark representative organization/company/identity/filtered/presence/projection subscription classes;
- [ ] run 100 / 500 / 1,000-client subscription setup/reconnect fixtures;
- [ ] measure update fanout for representative mutations;
- [ ] verify high-cardinality resources remain bounded by access path or projection decisions;
- [ ] verify subscription setup/update latency stays stable as unrelated organization history grows;
- [ ] record any intentional broad subscriptions with measured justification.

### Phase SQ-6 — final green + census gate

- [ ] all captured subscription regressions pass;
- [ ] STDB subscription integration tests pass;
- [ ] query/subscription contract parity tests pass;
- [ ] access-path compatibility validation passes;
- [ ] load/fanout proof passes for representative classes;
- [ ] frontend typecheck passes;
- [ ] frontend unit/integration tests pass;
- [ ] Playwright/E2E suite passes;
- [ ] repository Rust/STDB tests pass;
- [ ] contract/codegen drift checks pass;
- [ ] no unsupported handwritten subscription SQL remains;
- [ ] subscription census remains total with `unclassified = 0`.

---

## 17. Exit criteria

This track is complete only when:

1. application IR is the source of truth for subscribable resource semantics;
2. STDB-specific subscription SQL is produced by one compiler/adapter boundary;
3. frontend feature code contains no resource-specific subscription SQL;
4. query and subscription paths share the same scope and result contracts;
5. private/BFF-only resources cannot accidentally gain direct realtime exposure;
6. company/identity/field-policy resources fail closed when required context is missing;
7. current handwritten-subscription bugs have permanent regression coverage;
8. `erp-subscriptions.ts` is generated/thin compatibility code or removed;
9. every realtime resource is included in the subscription census;
10. interactive subscriptions declare expected cardinality and compatible access paths;
11. broad/high-fanout subscriptions are explicit, benchmarked exceptions rather than accidental defaults;
12. approved hot projections are used where subscribing directly to source tables would recreate expensive aggregation/fanout;
13. reconnect policy prevents avoidable subscription storms;
14. subscription setup/update latency remains acceptably stable as unrelated tenant history grows;
15. the targeted full test suite is green.

---

## 18. Non-goals

- making arbitrary SQL model- or frontend-accessible;
- encoding STDB SQL strings directly in application IR;
- replacing STDB as application query/realtime authority;
- moving business logic into query/subscription descriptors;
- broadening private tables for convenience;
- inventing a second authorization model for realtime reads;
- requiring every HTTP query to become realtime-capable;
- introducing a generic unrestricted query DSL;
- creating projections merely to satisfy codegen without benchmark evidence;
- keeping every application resource permanently subscribed for convenience.

---

## 19. Architectural decision

Adopt the following rule for Lumiere V1:

> **Application-contract IR owns what may be subscribed to and the expected access/fanout shape; the STDB realtime adapter owns how that contract is compiled into subscription SQL.**

This closes the gap where generated query contracts and handwritten realtime queries can disagree, while also preventing a second class of drift: logically correct subscriptions whose physical access or update fanout becomes increasingly expensive as tenant data grows.

---

## 20. Shared STDB performance philosophy

Subscription performance must use the same vocabulary as reducer/query optimization:

```text
operation/query/subscription intent
        ↓
shared access-path metadata
        ↓
STDB indexes / generated accessors / subscription SQL
        ↓
static validation + runtime/load evidence
```

The common rule is:

> **Every interactive STDB path should be bounded by a declared access path or explicitly classified as an intentional broad operation.**

For subscriptions, "bounded" applies to both initial result shape and incremental update fanout.

This means a subscription can fail architectural review even when its SQL is syntactically valid if it:

- observes an organization-wide table when the UI needs a small queue;
- cannot use the tenant/status/time access path established for the corresponding query;
- subscribes to canonical rows when a measured projection is the intended realtime read model;
- creates large reconnect cost without an explicit reconnect policy;
- has high update fanout unrelated to the visible route/resource.

---

## 21. Subscription census artifact

SQ-0 should produce a machine-readable or generated-reviewable census with at least:

```text
resource key
frontend consumer(s)
source table/read model
scope kind
predicates
ordering
projection/field policy
realtime eligibility
expected cardinality
access path
source class
update fanout
latency class
reconnect class
private/BFF reason if disabled
intentional broad reason if applicable
```

This becomes the subscription equivalent of the reducer census. Once migration is complete, CI should fail when a newly introduced realtime resource lacks a census/IR entry.

---

## 22. Runtime observability targets

Where STDB/client instrumentation permits, attach stable subscription resource/access-path keys to metrics for:

```text
subscription setup duration
initial row count
active subscriber count
reconnect count
update events/sec
rows changed per update
subscription update latency
compiler/access-path key
resource/source-class key
```

The goal is not to encode fixed capacity limits into IR. The goal is to make it possible to tell whether a supposedly bounded subscription is actually behaving as designed in production.
