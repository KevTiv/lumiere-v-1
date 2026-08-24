# Subscription query IR/codegen plan

**Status:** Proposed — final application-contract IR cleanup for PR #3  
**Track:** `application-contract-ir`, `subscription-codegen`, `stdb-query-compiler`, `frontend-realtime`, `contract-drift`  
**Related:** [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md)

---

## 1. Objective

Remove handwritten frontend subscription SQL as the final major drift/bug surface in the current application-contract IR work.

The current frontend subscription registry still hand-defines resource-specific STDB SQL, tenant/company scoping, projections, ordering, and special-case predicates. This has already produced subscription-query bugs and remains one of the last blockers to a fully green test suite.

The target state is:

```text
STDB schema/domain metadata
        ↓
application-contract IR
        ↓
SubscriptionDescriptor
        ↓
STDB subscription compiler
        ↓
validated subscription SQL
        ↓
generated subscription service / React hook
```

IR owns **subscription semantics**. The STDB transport adapter owns **SQL syntax**. Frontend feature code owns neither.

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
- tests can fail because the generated contract is correct while handwritten realtime SQL is stale.

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
}

export type GeneratedSubscriptionScope =
  | { kind: "global" }
  | { kind: "organization" }
  | { kind: "company" }
  | { kind: "identity" }
  | { kind: "organization+identity" }
  | { kind: "organization+company" }
```

The descriptor may reference generated schema/type metadata, but should not contain STDB-specific SQL fragments.

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
- reject incomplete runtime context instead of widening scope.

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
- nullable/serialized representation.

Generated validation should be able to prove:

```text
query(resource, context)
subscription(resource, context)

→ same visible row shape
→ same authorization/scope boundary
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

Target sequence:

```text
handwritten resource registry
        ↓
classify each resource by generated descriptor
        ↓
move projection/scope/predicate/order metadata into IR
        ↓
generate descriptors
        ↓
compile through shared STDB adapter
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
- direct-subscription exposure for a BFF/private resource.

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
- `realtime: false` resources.

### Contract tests

For each representative resource class:

```text
Generated QueryDescriptor
vs
Generated SubscriptionDescriptor
```

Assert compatible source, result shape, projection, and scope.

### Regression tests

Capture every currently failing subscription query caused by handwritten SQL before deleting the old branch. Each bug becomes a permanent regression fixture.

### Integration tests

Run actual STDB subscription setup against representative resources and verify the subscription is accepted and emits expected typed rows.

### Frontend tests

Verify realtime consumers update through generated subscription APIs without direct resource SQL knowledge.

---

## 15. Representative proof cases

Use a deliberately mixed set rather than only easy organization-owned tables.

### Proof A — standard organization scope

```text
sale-orders
```

Generated descriptor and HTTP query must expose the same scoped result shape.

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

Predicate semantics are generated structurally and stay in parity with ordinary query behavior.

### Proof F — BFF/private resource

A private CRM resource must remain non-direct-subscribable and fail generation/runtime attempts to compile direct STDB SQL.

---

## 16. Phases

### Phase SQ-0 — inventory + failure capture

- [ ] enumerate every `SUBSCRIPTION_RESOURCE_KEYS` entry;
- [ ] classify standard/company/identity/field-policy/private/derived resources;
- [ ] capture current failing subscription queries as regression fixtures;
- [ ] identify SQL branches duplicated from generated query metadata;
- [ ] document any STDB syntax/feature limitations currently handled manually.

### Phase SQ-1 — IR model

- [ ] add `GeneratedSubscriptionDescriptor`;
- [ ] add structural scope metadata;
- [ ] add generated predicate/order/projection metadata;
- [ ] add realtime eligibility/private transport metadata;
- [ ] include subscription contract fields in drift/version checks;
- [ ] fail generation for unsafe/incomplete descriptors.

### Phase SQ-2 — compiler

- [ ] implement one STDB subscription compiler;
- [ ] centralize organization/company/identity context injection;
- [ ] centralize generated field projections;
- [ ] centralize STDB SQL limitations/workarounds;
- [ ] add compiler unit tests and fail-closed cases.

### Phase SQ-3 — migration

- [ ] migrate standard organization-scoped resources first;
- [ ] migrate company-scoped resources;
- [ ] migrate identity and field-policy-sensitive resources;
- [ ] migrate derived/filter resources;
- [ ] mark private/BFF-only resources explicitly non-subscribable;
- [ ] reduce `erp-subscriptions.ts` to a generated/compatibility facade;
- [ ] remove the facade when consumers no longer require it.

### Phase SQ-4 — generated frontend surface

- [ ] emit generated subscription registry/services;
- [ ] generate typed frontend hooks/adapters;
- [ ] remove feature-local SQL construction and duplicate subscription wrappers;
- [ ] ensure offline/reconnect consumers use the same operation/resource contract where applicable.

### Phase SQ-5 — final green gate

- [ ] all captured subscription regressions pass;
- [ ] STDB subscription integration tests pass;
- [ ] query/subscription contract parity tests pass;
- [ ] frontend typecheck passes;
- [ ] frontend unit/integration tests pass;
- [ ] Playwright/E2E suite passes;
- [ ] repository Rust/STDB tests pass;
- [ ] contract/codegen drift checks pass;
- [ ] no unsupported handwritten subscription SQL remains.

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
9. the remaining subscription-related failures are resolved and the targeted full test suite is green.

---

## 18. Non-goals

- making arbitrary SQL model- or frontend-accessible;
- encoding STDB SQL strings directly in application IR;
- replacing STDB as application query/realtime authority;
- moving business logic into query/subscription descriptors;
- broadening private tables for convenience;
- inventing a second authorization model for realtime reads;
- requiring every HTTP query to become realtime-capable;
- introducing a generic unrestricted query DSL.

---

## 19. Architectural decision

Adopt the following rule for Lumiere V1:

> **Application-contract IR owns what may be subscribed to; the STDB realtime adapter owns how that contract is compiled into subscription SQL.**

This closes the remaining gap where generated query contracts and handwritten realtime queries can disagree, and makes subscription correctness part of the same contract/codegen boundary already being established throughout PR #3.
