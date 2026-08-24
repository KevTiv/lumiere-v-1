# Frontend opaque record contract migration plan

**Status:** Ratchet foundation established; domain migration continues in the IR/API-SDK continuation PR — 2026-08-22
**Scope:** TypeScript function inputs, outputs, query rows, mutation variables,
form adapters, and external-data boundaries  
**Related:**
[typed-bff-sdk-contract-hardening-execution-plan.md](./typed-bff-sdk-contract-hardening-execution-plan.md) ·
[contracts-extraction-execution-plan.md](./contracts-extraction-execution-plan.md)

## 1. Outcome

Move frontend production code away from function contracts based on
`Record<string, unknown>`, `Record<string, any>`, `object`, and equivalent
opaque aliases. Public functions should expose generated or named domain types
that make accepted inputs, returned values, and failure modes visible to the
compiler, editor, reviewer, and linter.

The migration is incremental and enforced from its first change. Existing debt
may be baselined temporarily, but new opaque contracts must fail CI.

The end state is:

- every named query resource maps to its generated row type;
- every reducer mutation maps to its generated operation input;
- form engines may keep dynamic state internally, but typed adapters separate
  that state from domain mutations;
- external data enters production code as `unknown` and is validated once at
  the boundary;
- arbitrary JSON is represented by explicit recursive JSON types;
- exported production functions contain no opaque record inputs or returns
  outside reviewed boundary modules.

## 2. Current baseline

The first ratchet slice is measured with the TypeScript compiler API on
2026-08-22. It tracks the exact `Record<string, unknown>` type reference in
frontend production TypeScript, per file:

| Context | Occurrences |
|---|---:|
| Tracked production files | 271 |
| Tracked occurrences | 2,144 |
| Reviewed transport/boundary allowlist | 82 |
| Excluded generated/test/dev occurrences | 71 |
| **Repository total for this pattern** | **2,297** |

The checked-in baseline is `frontend/type-debt/opaque-record-baseline.json` and
the policy is `frontend/type-debt/opaque-record-policy.json`. CI runs
`pnpm type-debt:check`, which fails on a new occurrence in a production file
or on an increase to an existing file. It also fails when a file's count drops
or a baseline file disappears until `pnpm type-debt:check -- --write-baseline`
records the reduction, so removed debt cannot silently become future headroom.
New production files start at zero.
The scanner is intentionally narrower than the broader inventory used during
planning; it does not yet cover `Record<string, any>`, `object`, unchecked JSON
assertions, or exported-contract semantics.

The largest package-level concentrations are approximately:

| Surface | Occurrences |
|---|---:|
| `frontend/web` | 1,629 |
| `frontend/packages/query-hooks` | 313 |
| `frontend/packages/ui` | 267 |
| `frontend/packages/erp-shared` | 246 |
| `frontend/packages/stdb` | 83 |

The debt is not uniform. It consists of:

1. domain contracts that should use generated or named types;
2. genuinely dynamic data such as metadata and runtime-configured forms;
3. untrusted JSON and platform values that should remain `unknown` until
   validated.

The plan treats these categories differently rather than applying a blanket
textual replacement.

## 3. Type policy

### 3.1 Domain contracts

Exported domain functions, hooks, component callbacks, and services must use:

- generated reducer input types;
- generated resource row types;
- named command arguments and results;
- named form input types;
- explicit patch types such as `ClearablePatch<T>`;
- discriminated unions for mutually exclusive states and results.

Renaming an opaque record does not make it a domain type. For example,
`type QueryRow = Record<string, unknown>` remains prohibited for production
domain contracts.

### 3.2 Untrusted boundaries

Network responses, parsed JSON, browser messages, storage reads, and plugin or
AI output enter as `unknown`. A boundary parser validates or narrows the value
before domain code receives it. Direct assertions such as
`response.json() as DomainType` are prohibited.

### 3.3 Arbitrary JSON

Serialization and arbitrary metadata use explicit recursive types:

```ts
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
  [key: string]: JsonValue
}
```

Transport-specific variants should be named, for example `StdbWireObject`, so
callers can distinguish domain data from encoded wire data.

### 3.4 Runtime-configured forms

The configurable-form engine may own a named `DynamicFormValues` type
internally. Dynamic values must pass through a typed domain adapter before they
reach a mutation. Static forms should use a generic form component and a named
value type directly.

## 4. Sequenced implementation

### Phase 0 — document policy and ownership

- adopt the type categories and boundary rules in this plan;
- define the small set of reviewed boundary directories;
- assign generated operation and resource types as the source of truth;
- prohibit hand-written copies of generated backend DTOs;
- document how developers request a new generated resource or operation type.

**Exit:** reviewers have one policy for deciding whether an opaque type is
domain debt, an untrusted boundary, or legitimate arbitrary JSON.

### Phase 1 — establish repository-wide lint enforcement

The current PR establishes the AST inventory and per-file ratchet portion of
this phase. It does not claim that the complete ESLint/type-aware policy is
implemented.

- add a shared frontend ESLint flat configuration;
- add `lint` scripts to `api-client`, `erp-shared`, `query-hooks`, `stdb`,
  `ui`, `web`, and the frontend workspace root;
- run lint through Turbo and CI;
- configure type-aware linting with TypeScript project services;
- enable `@typescript-eslint/no-restricted-types` for opaque records and
  `object` in production domain code;
- enable `no-explicit-any`, `explicit-module-boundary-types`, and the
  type-aware `no-unsafe-*` rules;
- capture existing violations with ESLint 9 bulk suppressions;
- add an AST inventory command that reports violations by package, file, and
  syntax context;
- require new files to have a zero baseline and fail when a per-file baseline
  increases.

Initial restricted-type policy:

```js
"@typescript-eslint/no-restricted-types": [
  "error",
  {
    types: {
      "Record<string,unknown>":
        "Use a domain type, JsonObject, or validated boundary type.",
      "Record<string,any>": "Use a concrete domain type.",
      "Record<String,unknown>":
        "Use primitive string and a concrete domain type.",
      "object": "Use unknown at a boundary or a concrete object type."
    }
  }
]
```

**Current exit:** the exact `Record<string, unknown>` pattern has a checked-in
per-file baseline, explicit generated/test/dev and boundary policy, a root
command, and CI enforcement. Full shared ESLint configuration, type-aware
unsafe rules, and the broader opaque-contract rule remain continuation work.

### Phase 2 — type the query pipeline

Extend contract generation to emit a compile-time resource map:

```ts
export interface QueryRowMap {
  "account-accounts": AccountAccount
  "account-journals": AccountJournal
  "products": Product
}

export type QueryResourceKey = keyof QueryRowMap
export type QueryRowFor<K extends QueryResourceKey> = QueryRowMap[K]
```

Then:

- make `useStdbQuery` generic over `QueryResourceKey`;
- type `initialData`, query results, and cache reads as `QueryRowFor<K>[]`;
- apply the same mapping to `fetchQueryList` and
  `useSubscriptionAwareQuery`;
- carry the row type through subscription cache projection and hydration;
- replace loose read-model aliases with generated row types;
- provide a separately named dynamic query API returning `JsonObject[]` for
  database explorers and other reviewed development tooling;
- migrate accounting and inventory first;
- migrate `frontend/web/lib/form-lookup.ts` to concrete row inputs and a shared
  named `SelectOption` output.

**Exit:** literal resource names infer their row type, invalid resource names
fail compilation, and production query hooks no longer expose opaque row
arrays.

### Phase 3 — type the command pipeline

- replace the broad object branch in `WireField<T>` with a recursive,
  key-preserving wire transformation;
- represent SATS options only where the generated contract declares them;
- make the command gateway accept generated `OperationInputMap[K]` values;
- move `stdbParamsToJson` calls inside the transport layer where practical;
- give every mutation hook a generated params type or named command argument;
- remove `Record<string, unknown>` mutation variables from domain hooks;
- add compile-time negative tests using `@ts-expect-error` for missing,
  misspelled, and unsupported fields;
- migrate accounting budgets first, followed by inventory, auth,
  organization-company, and POS.

The wire serializer may return `JsonObject` or `StdbWireObject`, because that is
a serialization boundary. Its encoded output must not escape back into domain
logic.

**Exit:** mutation autocomplete exposes accepted fields, invalid fields fail
compilation, and query-hook mutation contracts no longer use opaque records.

### Phase 4 — type forms and conversion functions

- make reusable static form components generic over their submitted values;
- introduce a named input type or runtime schema for every domain form adapter;
- keep `DynamicFormValues` confined to runtime form infrastructure;
- require a typed adapter between dynamic forms and domain mutations;
- make every adapter return a generated reducer type or explicit patch type;
- replace loose update results with types such as
  `ClearablePatch<UpdateBudgetPostParams>`;
- add validation and coercion tests for required fields, identifiers, dates,
  enums, null-clearing, and omitted fields;
- migrate one domain at a time in this order:
  1. accounting;
  2. inventory;
  3. sales and purchasing;
  4. CRM;
  5. HR and expenses;
  6. projects, documents, and subscriptions;
  7. remaining modules.

**Exit per domain:** no exported form adapter consumes or returns an opaque
record, every output satisfies its generated reducer contract, and conversion
behavior is tested.

### Phase 5 — harden runtime boundaries

- treat `response.json()` as `unknown` throughout API and hook packages;
- introduce shared typed response-envelope and error parsers;
- generate row and operation validators from canonical contract IR where
  practical instead of maintaining hand-written duplicate schemas;
- return structured errors containing operation or resource, HTTP status,
  stable code when available, and a safe message;
- isolate unavoidable assertions inside reviewed parser or interop modules;
- replace metadata catch-alls with `JsonObject` or a narrower named metadata
  contract.

**Exit:** domain types are not created by unchecked response assertions, and a
validation failure identifies the affected resource or operation.

### Phase 6 — remove the baseline and tighten TypeScript

- remove bulk suppressions as each file or domain reaches zero;
- add a type-aware local ESLint rule named `no-opaque-function-contract`;
- resolve aliases before checking exported parameter and return types;
- reject arbitrary string index signatures, arrays of opaque records,
  `object`, `unknown`, and `any` in exported production contracts;
- allow only named and reviewed boundary types or modules;
- progressively enable `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, and `useUnknownInCatchVariables`;
- publish CI metrics for opaque parameters, opaque returns, unsafe assertions,
  suppressions, typed resources, and typed reducer hooks.

**Exit:** the reviewed boundary allowlist is the only remaining location for
opaque or arbitrary JSON shapes.

## 5. First implementation slice

Use accounting budgets as the vertical slice because the current code contains
typed neighboring mutations and a remaining opaque mutation contract.

1. Add the shared lint rule and baseline.
2. Generate row mappings for `budgets`, `budget-lines`, and `budget-posts`.
3. Type their `useStdbQuery` calls and `initialData`.
4. Change `useCreateCrossoveredBudget` to accept
   `CreateCrossoveredBudgetParams`.
5. Change update form adapters to return the generated update type or
   `ClearablePatch<T>`.
6. Type the relevant lookup helpers and UI submit callbacks.
7. Add positive and negative compile-time contract tests.
8. Remove suppressions for the migrated functions.

This slice proves the query map, command input, form adapter, and lint ratchet
before the approach is repeated across domains.

## 6. PR sequence

1. **Lint foundation and baseline (this PR)** — AST inventory, checked-in
   per-file baseline/policy, root command, and CI ratchet. This does not add
   runtime response validation or a generated SDK.
2. **Generated query row map** — resource-to-row contract generation and type
   tests.
3. **Generic query APIs** — query hook, fetch, hydration, and cache typing.
4. **Accounting/inventory query migration** — including lookup helpers.
5. **Typed command wire transformation** — preserve nested keys and SATS
   option provenance.
6. **Accounting command and adapter migration** — first complete vertical
   slice.
7. **Inventory/auth/organization command migration.**
8. **Generic static forms plus typed dynamic-form boundary.**
9. **Domain form-adapter batches.**
10. **IR-driven API/SDK foundation** — generated operation/resource descriptors,
   codecs, typed api-server endpoint, and a first domain SDK slice.
11. **Runtime response validation and structured errors.**
12. **Final suppression removal and compiler strictness.**

Each PR must be independently reviewable and must reduce or preserve the debt
baseline. Do not combine unrelated UI behavior changes with contract migration.

## 7. Verification gates

Every migration PR must pass:

- TypeScript typecheck for every affected package;
- repository lint with no new bulk suppressions;
- AST debt check with no increased per-file counts;
- relevant unit and integration tests;
- generated-contract drift and reproducibility checks when codegen changes;
- compile-time negative tests for typed queries or commands;
- a before/after count of opaque signatures in the PR description.

Domain completion additionally requires:

- zero opaque query rows in its public hooks;
- zero opaque mutation variables;
- zero opaque form-adapter returns;
- no direct external JSON assertion to a domain type;
- removal of that domain's lint suppressions.

## 8. Definition of done

- exported production function contracts contain no opaque records outside
  approved boundary modules;
- application contracts contain no `any`;
- every named query resource maps to a generated row type;
- every reachable reducer hook maps to a generated operation input;
- every dynamic form crosses a typed and tested adapter before mutation;
- external values enter as `unknown` and are validated;
- arbitrary JSON uses explicit `JsonValue` / `JsonObject` types;
- the lint and AST ratchets prevent regression;
- all temporary bulk suppressions have been removed or reduced to reviewed,
  documented boundary exceptions.

## 9. Non-goals

- replacing opaque records with `any`, unchecked casts, or aliases that hide
  the same index signature;
- hand-writing copies of generated reducer or resource DTOs;
- banning arbitrary JSON inside serializers, metadata containers, dev database
  explorers, or runtime form engines when it is genuinely required;
- moving business rules, authorization, defaults, or workflow decisions into
  generated transport code;
- completing the migration as one large, unreviewable change.
