# Typed BFF SDK and contract hardening — execution plan

**Status:** Phase 5 complete; Phase 6 in progress through the projection-aware
company and accounting read slices — 2026-08-31
**First Phase 6 pickup:** `frontend/packages/query-hooks/src/hooks/organization-company.ts`
**Tracks:** canonical IR, contracts extraction, write-path hardening, typed reads,
generated codecs, generated SDK, frontend type debt

**Completed foundation:**
[ir-api-sdk-operation-foundation-continuation.md](./ir-api-sdk-operation-foundation-continuation.md)
records the first IR-to-SDK/API vertical slice and its cross-repository release
gates. Phase 6 now continues with contracts-owned resource codecs and classified
query/scope metadata.

### Phase 5 completion evidence

- 809 production query-hook mutations across 35 files use generated named input
  types and immutable-ID `/api/operations/:operation` requests;
- normal production browser code has zero positional `unknown[]` mutation
  calls, zero `/api/call` calls, and zero `withCompany=true` calls;
- the ambiguous `/v1/call/:reducer` alias and automatic default-company
  insertion are removed;
- positional calls remain only on the explicitly named
  `/v1/compat/reducer/:reducer` boundary for excluded dev/E2E tooling;
- `@lumiere/stdb` owns the handwritten domain façade and typed operation
  transport; `lumiere-contracts` supplies immutable IDs, input types, and
  codecs without generating business API structure;
- the browser-operation transport check is required by CI and also rejects
  restoration of the retired API and Next.js aliases.

## 1. Outcome

Make canonical IR the only source for operation names, input/output types, scope,
exposure, invalidation, resource row types, and wire encoding. Generate compact
Rust and TypeScript targets in `lumiere-contracts`, then make `api-server` the
typed BFF boundary.

The end-state request flow is:

```text
typed business SDK
  -> generated operation request + TypeScript codec
  -> api-server generated Rust decoder/validator
  -> typed ReducerCall
  -> SpacetimeDB reducer
```

Normal browser business code does not construct reducer arrays, choose reducer
names dynamically, or normalize SATS values by handwritten reducer registries.
Business rules remain in reducers. Generated code owns only types, codecs,
scope provenance, operation metadata, validation, and transport mechanics.

## 2. Scope and tenant invariants

These are generation invariants, not conventions:

- `organization_id` is injected from the authenticated api-server session and
  is rejected when supplied by a client;
- `company_id` is a client-selected legal-entity scope and is validated as
  belonging to the authenticated organization;
- mutation code must never discover or inject the first/default company on the
  server;
- a frontend SDK may avoid repeating `companyId` by being explicitly bound to
  the user's selected company, for example
  `sdk.forCompany(selectedCompanyId).workflows.create(input)`;
- customer, contact, partner, order, and other record IDs are ordinary domain
  inputs, not tenant identifiers;
- exposure and authorization remain independent: generated exposure controls
  reachability, while reducers continue to enforce permissions and business
  invariants.

## 3. Current baseline

Measured on this branch on 2026-08-21:

| Surface | Current state |
|---|---:|
| Domain `*-http.ts` command files | 32 |
| `Record<string, unknown>` tracked by the AST ratchet | 2,144 across 271 files |
| Explicit transport/boundary allowlist | 82 |
| Excluded generated/test/dev occurrences | 71 |
| Direct positional BFF sites | 3 |
| Broad hidden positional adapter | accounting, about 23 hook wrappers |

The direct residuals are:

- the generic `useAccountingCallMutation` adapter;
- `validate_stock_picking` / `validate_stock_picking_backorder`, which stay
  denied until explicit organization checks are added;
- `execute_replenishment_rule`, which requires a caller-owned UUID retained
  across retries as its idempotency key.

The current `OperationInputMap` proves that generated named inputs work, but it
is not yet the complete BFF contract: output, codec, resource, invalidation,
and structured scope metadata are not all available through one generated
operation descriptor.

## 4. Canonical operation and resource model

Extend canonical IR with a target-neutral descriptor equivalent to:

```ts
interface Operations {
  create_workflow: {
    kind: "mutation"
    input: CreateWorkflowInput
    output: void
    exposure: "session"
    scope: {
      organization: { source: "server_session" }
      company: { source: "client_selection"; path: "companyId" }
    }
    invalidates: readonly ["workflows", "workflow-versions"]
    codec: "create_workflow@1"
  }
}
```

Resources use the same type graph:

```ts
interface Resources {
  contacts: {
    query: ContactListQuery
    row: Contact
    scope: "organization+optional-company"
  }
}
```

IR stores references into the canonical type graph rather than copying type
definitions into operation/resource metadata.

## 5. Sequenced implementation

### Phase 0 — stabilize and republish the current contract delta

- normalize accidental full-file formatting churn before review;
- publish the six reviewed proposal exposure changes and regenerated IR to
  `lumiere-contracts`;
- atomically update the Rust and TypeScript contract pins;
- verify generated output is reproducible from the published IR digest.

**Exit:** both repositories are clean at one immutable contract revision.

### Phase 1 — complete operation/resource IR

Primary application generator files:

- `lumiere-codegen/src/contract_ir.rs`;
- `lumiere-codegen/src/reducer_contract.rs`;
- `lumiere-codegen/src/frontend_registry/stdb_invalidation_emit.rs`.

Add or verify, per operation:

- stable operation ID and reducer target;
- input and output type references;
- `client_input`, `server_context`, and ordered `wire_arguments`;
- nested scope paths and nullability;
- exposure, invalidated resources, idempotency requirements, and codec ID;
- operation kind (`mutation`, `query`, `procedure`, or low-level escape hatch).

Add or verify, per resource:

- row type reference;
- query/filter/cursor input type reference;
- scope metadata and source operation/table references.

**Exit:** no target generator needs to inspect Rust source, generated bindings,
or a handwritten reducer parameter registry.

### Phase 2 — generate compact targets in `lumiere-contracts`

Extend `lumiere-contracts/scripts/generate-from-ir.py` to emit:

TypeScript:

- `packages/contracts/src/generated/operations.ts`;
- `packages/contracts/src/generated/resources.ts`;
- `packages/contracts/src/generated/wire-codecs.ts`.

Rust:

- `crates/lumiere-contracts/src/generated/operations.rs`;
- `crates/lumiere-contracts/src/generated/resources.rs`;
- `crates/lumiere-contracts/src/generated/wire_codecs.rs`.

Keep generated modules domain-partitioned or table-driven. Do not return to one
file per reducer unless a measured compiler/tooling constraint requires it.

**Exit:** both packages build solely from the pinned IR in a network-disabled
checkout with no `lumiere-v-1` source tree.

### Phase 3 — cross-language wire codecs and golden fixtures

Generate matching TypeScript encoders and Rust decoders for:

- `u64` without JavaScript precision loss;
- timestamps and identities;
- SATS option and enum representations;
- arrays and nested structs;
- nullable/optional fields and alias rejection;
- unknown-field, duplicate-alias, overflow, and malformed-tag errors.

Generate shared JSON fixtures containing valid inputs, canonical wire values,
and expected failures. Run every fixture against both implementations.

**Exit:** the same fixture corpus proves TypeScript encoding and Rust decoding
agree for every reachable operation type.

### Phase 4 — make api-server the typed operation boundary

- add an operation endpoint backed by generated Rust operation metadata/DTOs;
- validate exposure, session organization, selected-company membership,
  idempotency, and wire shape before constructing `ReducerCall`;
- dispatch only through typed `ReducerCall`;
- retain raw reducer arrays temporarily under an explicitly named compatibility
  or admin endpoint with separate exposure and observability;
- reject arrays on normal business-operation routes after migration reaches
  zero.

**Exit:** api-server normal business routes cannot dispatch an arbitrary reducer
name or an arbitrary JSON array.

### Phase 5 — build the application TypeScript SDK and migrate writes

The public shape is domain-oriented:

```ts
const accounting = sdk.forCompany(selectedCompanyId).accounting
await accounting.accounts.create(input)
```

The application-owned SDK consumes generated operation IDs, input types, and
wire codecs, but keeps domain grouping, method names, defaults, workflow
decisions, and form behavior in normal TypeScript. Auth/session and
selected-company providers bind transport context; operation modules encode
and send generated requests. The contracts generator must not emit the authored
business façade.

Migrate one domain at a time. A migrated domain must delete its positional
adapter and unused `*-http.ts` transport function in the same change.

Domain convenience methods are curated application API, not a requirement to
create a one-line wrapper for every operation. Hooks without a domain method
use the typed `stdbBffCommandPost` operation highway directly; this is still a
named, immutable-ID request and never a positional compatibility call.

**Exit (achieved):** no normal mutation hook accepts `unknown[]`, no production
browser call uses a compatibility reducer route, and no caller requests an
implicitly selected company.

### Phase 6 — generate typed reads

- generate query input and row/result types from resource IR;
- expose domain methods such as
  `sdk.crm.contacts.list(query): Promise<Contact[]>`;
- decode boundary JSON from `unknown` into generated resource DTOs;
- preserve pagination/cursor and field-policy metadata without returning
  `Record<string, unknown>[]`.

**Exit:** migrated domains have typed mutation inputs and typed query results.

#### Phase 6 progress evidence

- `@lumiere/api-client` has a strict opt-in decoder for normal
  `{ data: [...] }` responses; malformed envelopes and accidental paginated
  responses fail rather than becoming an empty list;
- `@lumiere/stdb` owns a projection-aware `CompanyQueryRow` decoder: registry
  mandatory fields are required, policy-controlled fields may be omitted,
  unknown fields and lossy IDs are rejected, and IDs/timestamps normalize to
  generated runtime types;
- `sdk.organization.companies.list()` is the first typed read domain method and
  `useCompanies` no longer asserts an unknown HTTP body as `Company[]`;
- contracts releases through v0.3.21 generate projection-aware codecs for
  `companies`, `account-accounts`, `account-journals`, `account-taxes`, and
  `account-move-lines` and `account-moves` directly from the canonical
  resource/type graph;
- the accounting SDK and hooks bind the selected company on all five migrated
  accounting reads, decode the HTTP body from `unknown`, preserve mandatory-only
  projections, and reject unknown fields, lossy IDs, malformed enums, and
  malformed timestamps;
- `account-move-lines` browser consumers now use the projected row type directly
  and no longer fall back to snake-case/full-table assertions;
- the primary accounting and sales `account-moves` consumers now accept the
  projected row type directly; organization-wide SSR seeds were removed because
  they could not safely seed the selected-company cache, and timestamp consumers
  now handle the generated timestamp object rather than coercing it with
  `Number(...)`;
- accounting and subscription mutations that change move lines invalidate the
  typed HTTP cache through the shared resource invalidation path;
- the pilot deliberately excludes `pos-orders`, whose cursor envelope and read
  authorization need a separate contract and scope repair.

This is Phase 6 progress, not the phase exit. Most resource query and scope
descriptors remain unclassified, so typed codecs continue to ship behind an
explicit reviewed resource allowlist. `account-account-types` is intentionally
deferred until its shared-plus-optional-company visibility is explicit; that
scope contract is the next accounting boundary to repair before its typed-read
migration.

### Phase 7 — delete redundant layers

Delete only after consumer counts reach zero:

- the 32 handwritten domain `*-http.ts` transport helpers;
- `REDUCER_PARAM_STRUCTS`, flat option-index maps, and reducer-specific logic
  from `frontend/packages/stdb/src/stdb-params-json.ts`;
- the local generated proxy files replaced by package exports;
- generic `unknown[]` mutation paths, except one explicitly named low-level or
  admin escape hatch;
- copied/generated targets still produced by the transitional publisher.

Audit api-server imports before removing the 3,021 Rust SDK binding files. If
api-server only needs generated DTOs plus dynamic query/reducer transport,
replace the binding dependency with compact operation/resource targets and
delete the bindings from its dependency graph.

**Exit:** generation reduces application repository volume rather than moving
the same file-per-reducer surface between directories.

### Phase 8 — ratchet `Record<string, unknown>` to boundary-only use

The current PR establishes the first enforcement slice for this phase:

- `frontend/scripts/check-opaque-record-ratchet.mjs` uses the TypeScript
  compiler API rather than a textual search;
- `frontend/type-debt/opaque-record-policy.json` documents production roots,
  generated/test/dev exclusions, and the reviewed transport/boundary allowlist;
- `frontend/type-debt/opaque-record-baseline.json` records the current
  per-file debt; `pnpm type-debt:check` fails on new or increased counts,
  stale reductions, and deleted baseline files, and is required by CI. Use
  `pnpm type-debt:check -- --write-baseline` after an intentional migration.

This establishes regression protection only. It does not validate network
responses, generate codecs, or provide the business SDK. Those are immediate
IR-driven API/SDK continuation work and must land before broad new IR-backed
domain implementation.

Extend the AST-based check using the existing TypeScript compiler API:

- the checked-in ratchet command and policy above;
- later extend the same scanner to exported-contract semantics and the other
  opaque forms (`Record<string, any>`, `object`, and unchecked assertions).

Initial CI behavior:

- record the current per-file baseline;
- fail on any new occurrence or increased per-file count;
- give new files a zero baseline;
- permit a small explicit allowlist for JSON parsing, transport interop, and
  genuinely arbitrary metadata;
- require boundary JSON to enter as `unknown` and pass a generated decoder;
- use explicit recursive `JsonValue` / `JsonObject` types for arbitrary JSON.

Burn down by domain. Once a domain reaches zero, remove its baseline entries so
the prohibition becomes permanent for hooks, UI props, form parameters, query
results, reducer inputs, and domain services.

**Current exit:** new production debt cannot be introduced silently and
existing debt cannot increase per file. **Final exit:** only the reviewed
parsing/interop allowlist may contain the type after domain migration and
runtime validation are complete.

## 6. First implementation slice

Start in `frontend/packages/query-hooks/src/hooks/accounting.ts`.

1. Make `useAccountingCallMutation` generic over the generated operation key.
2. Replace `unknown[]` with `StdbBffCommandInput<K>`.
3. Replace `accountingBffPost(reducer, args)` with
   `stdbBffCommandPost(reducer, input)`.
4. Migrate `create_account_account` first:
   - hook: `useCreateAccountAccount`;
   - generated input: `{ params: CreateAccountAccountParams }`;
   - caller: `frontend/web/app/(modules)/accounting/accounting-client.tsx`;
   - remove `organizationId` from the request payload;
   - place the explicitly selected company in `params.companyId`;
   - decode/encode through the generated codec rather than reducer-specific
     branches in `stdb-params-json.ts`.
5. Continue through the remaining wrappers until the accounting adapter has
   zero positional consumers.
6. Delete `accountingBffPost` and its `withCompany` behavior when `rg` confirms
   zero executable consumers.

This slice is deliberately first because it validates the operation-map API,
generic hook inference, selected-company provenance, and deletion mechanics
without waiting for the complete generated SDK.

## 7. PR sequence and gates

1. **Accounting positional adapter removal** — first reducer plus remaining
   wrappers; no new generator architecture.
2. **IR operation/resource descriptor completion** — schema and invariants.
3. **Contracts-owned TS/Rust codec emitters + golden fixtures.**
4. **Typed api-server operation endpoint + compatibility metrics.**
5. **Generated business SDK pilot** — accounting or CRM, followed by domain
   migration/deletion PRs.
6. **Typed resource reads.**
7. **`Record<string, unknown>` AST baseline and domain burn-down.**
8. **Rust SDK binding dependency audit and deletion.**

Every PR must pass:

- deterministic generation and IR checksum verification;
- Rust and TypeScript typechecks;
- cross-language golden codec fixtures;
- org-A/company-B negative tenant tests;
- unknown-field, alias-duplication, optional/enum/u64/timestamp codec tests;
- generated-output and forbidden-pattern drift checks;
- a measured consumer/deletion count in the PR description.

## 8. Non-goals

- moving business rules or authorization decisions into generated SDK code;
- making company scope server-defaulted for mutations;
- exposing denied reducers merely to make frontend compilation pass;
- replacing `Record<string, unknown>` with `any` or unchecked casts;
- deleting Rust bindings before import/dependency evidence proves they are
  unnecessary.
