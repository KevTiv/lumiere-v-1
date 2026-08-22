# IR-driven API and SDK operation foundation — continuation PR

**Status:** Draft implementation scaffold — 2026-08-23  
**Depends on:** completion of the canonical IR/contracts extraction PR  
**First vertical slice:** `create_account_account`  
**Related:**
[typed-bff-sdk-contract-hardening-execution-plan.md](./typed-bff-sdk-contract-hardening-execution-plan.md) ·
[contracts-extraction-execution-plan.md](./contracts-extraction-execution-plan.md) ·
[frontend-opaque-record-contract-migration-plan.md](./frontend-opaque-record-contract-migration-plan.md)

## 1. Outcome

Make one normal business mutation travel through generated operation metadata
from canonical IR to the TypeScript caller and Rust API boundary. This PR is
the foundation for making IR central to future monorepo implementation; it is
not a broad domain migration.

The completed slice must look like:

```text
generated TypeScript operation input
  -> generated TypeScript wire codec
  -> typed api-server operation endpoint
  -> generated Rust operation descriptor/decoder
  -> typed ReducerCall
  -> create_account_account
```

The application and contracts repositories must not independently encode the
operation name, argument order, tenant-source rules, invalidation list, or
input shape.

## 2. Current handoff

The canonical IR already publishes the useful source facts for
`create_account_account`:

- session exposure;
- `organization_id` from authenticated server context;
- `CreateAccountAccountParams` as the client input;
- ordered wire arguments;
- `account-accounts` invalidation;
- canonical algebraic type references.

The contracts package already generates `OperationInputMap`, query registry,
invalidation metadata, and application/resource manifests from the pinned IR.
The missing foundation is a single generated operation descriptor consumed by
both transports, plus matching codecs and a typed API route.

## 3. In scope

### 3.1 Complete the operation descriptor contract

Add only metadata that a target cannot safely infer:

- stable operation ID and reducer target;
- operation kind;
- input and output type references;
- exposure;
- client-input, server-context, and ordered wire-argument provenance;
- tenant validation requirements;
- invalidated resources;
- idempotency requirement;
- versioned codec ID.

Update the IR verifier so a session-exposed operation fails generation when
its argument provenance, referenced type, invalidation, or scope source is
missing or inconsistent. Do not inspect generated bindings or Rust source in
downstream generators.

### 3.2 Generate compact cross-language targets in `lumiere-contracts`

Extend `scripts/generate-from-ir.py` to emit table-driven targets:

- `packages/contracts/src/generated/operations.ts`;
- `packages/contracts/src/generated/wire-codecs.ts`;
- `crates/lumiere-contracts/src/generated/operations.rs`;
- `crates/lumiere-contracts/src/generated/wire_codecs.rs`.

Export them through the existing TypeScript package and Rust crate entry
points. Generation must work from the pinned IR in the existing
network-disabled, source-independent contracts CI job.

The generated files must stay compact. Do not introduce a new file per
operation.

### 3.3 Add shared golden wire fixtures

Generate or check in one language-neutral fixture corpus covering the first
slice:

- a valid `CreateAccountAccountParams` payload;
- authenticated `organization_id` insertion at the declared wire position;
- camelCase client input to canonical snake_case/SATS wire encoding;
- `u64` values represented without JavaScript precision loss;
- missing required input;
- client attempts to supply `organization_id`;
- unknown fields and malformed option values.

Run the same fixtures through the TypeScript encoder and Rust decoder. A fixture
must not have separate expected values per language.

### 3.4 Make api-server the typed normal-operation boundary

Add a typed normal-operation route backed by the generated Rust descriptor and
decoder. For the first slice it must:

- accept the generated named input envelope;
- obtain organization scope only from the authenticated session;
- reject client-supplied server-context fields;
- validate any selected-company scope when an operation declares it;
- dispatch only a generated, typed `ReducerCall`;
- emit structured errors containing operation, stable code, HTTP status, and a
  safe message;
- record operation ID and outcome in existing request observability.

Keep the raw reducer-array route temporarily as an explicitly named
compatibility/admin boundary. Do not add new business callers to it.

### 3.5 Add the first generated business SDK method

Expose a small domain-oriented TypeScript surface:

```ts
await sdk.forCompany(selectedCompanyId).accounting.accounts.create(input)
```

For `create_account_account`, the selected company binding may be unused if the
canonical descriptor does not declare company scope. The SDK must not invent
business defaults, permissions, form coercion, or tenant selection.

Migrate `useCreateAccountAccount` and its accounting caller to the generated
SDK method. In the same change, delete the now-unused handwritten operation
name, positional assembly, and reducer-specific serializer metadata for this
one operation.

## 4. Explicit non-goals

- migrating a second domain or all accounting mutations;
- deleting the compatibility/admin reducer route;
- generating UI forms or React components;
- moving authorization or business rules into generated code;
- inventing company, UOM, tax, journal, warehouse, or other business defaults;
- replacing one large handwritten registry with a generated file-per-reducer
  tree;
- broad strict-TypeScript or opaque-record cleanup unrelated to the first
  operation slice.

## 5. PR sequencing

1. **Contracts companion PR:** verifier, compact Rust/TypeScript descriptors,
   codecs, golden fixtures, exports, and source-independent generation tests.
2. **Immutable contracts release:** merge, tag, and publish one coherent
   contracts version.
3. **This application PR:** atomically pin the Rust and TypeScript release,
   add the typed api-server route, add the SDK facade, migrate
   `create_account_account`, and remove its duplicate handwritten metadata.
4. **Follow-up domain PRs:** migrate operations in visible domain batches only
   after the first slice proves the boundary.

The application PR must never point at an unmerged contracts branch.

## 6. Required verification

Contracts companion PR:

- canonical IR validation and semantic hash verification;
- deterministic regeneration with a clean diff;
- network-disabled `generate-from-ir` CI;
- TypeScript typecheck and Rust tests;
- shared TypeScript/Rust golden fixture parity;
- negative tests for missing provenance, unknown refs, bad wire positions, and
  client-owned server context.

Application PR:

- `cargo test` for the generated API decoder/dispatch boundary;
- frontend package and web typechecks;
- compile-time negative tests for missing, misspelled, and server-owned input
  fields;
- focused hook/API integration test;
- focused E2E proving account creation persists through the new route;
- contracts drift/reproducibility checks;
- opaque-record ratchet with no increase;
- no new direct reducer-array business call site.

## 7. Definition of done

- `create_account_account` is invoked through the generated SDK and typed API
  operation route;
- TypeScript encoding and Rust decoding pass the same golden fixtures;
- `organization_id` cannot be supplied by the client and is inserted from the
  authenticated session;
- the API dispatches a typed `ReducerCall`, not an arbitrary reducer name and
  JSON array;
- operation name, input type, wire order, exposure, scope provenance, codec,
  and invalidation originate from canonical IR;
- duplicate handwritten metadata for the migrated operation is deleted;
- both repositories build from one immutable contracts release;
- all required CI and the focused persisted-data E2E are green.

Only after this gate should IR-backed implementation expand to the remaining
accounting mutations, typed reads, and other domains.
