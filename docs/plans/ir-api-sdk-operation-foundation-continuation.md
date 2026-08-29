# IR-owned frontend operation descriptors — continuation PR

**Status:** Phase 1 implementation in progress — 2026-08-29
**Depends on:** canonical IR/contracts extraction merge
**Companion release:** `lumiere-contracts` v0.3.4

The application currently pins the immutable v0.3.4 release-candidate commit
`e013dd2ce3be101863acc696a1e87b2486fa95bb`. Replace that SHA with the
`v0.3.4` tag only after the companion branch passes verification and is
published. v0.3.3 is not a usable base: its checked-in IR pin and generated
package contents are inconsistent.
**Related:**
[typed-bff-sdk-contract-hardening-execution-plan.md](./typed-bff-sdk-contract-hardening-execution-plan.md) ·
[contracts-extraction-execution-plan.md](./contracts-extraction-execution-plan.md)

## 1. Outcome

Make canonical IR own the frontend named-command operation surface. Generate a
compact session-operation descriptor in `lumiere-contracts`, consume it in the
STDB command highway, and delete the duplicate application-owned reducer-name
list and emitter.

This is the smallest independently mergeable step toward the generated SDK and
typed API boundary. It changes contract ownership without changing server
dispatch behavior or migrating legacy positional callers.

## 2. Current duplication

The pinned canonical IR already owns, for every operation:

- exposure;
- parameter name, position, kind, and canonical type reference;
- client-input positions;
- server-context source and validations;
- ordered wire arguments;
- scope and lifecycle;
- invalidated resources.

`lumiere-contracts/scripts/generate-from-ir.py` currently uses that metadata to
generate `OperationInputMap` and JSON manifests. The application generator
independently emits
`frontend/packages/stdb/src/commands/generated-stdb-bff-reducers.ts` from the
same exposure data. The duplicate list is about 900 lines and makes the
application repository a second authority for which named commands exist.

## 3. Contracts companion PR

Extend `lumiere-contracts/scripts/generate-from-ir.py` to emit one table-driven
target:

```text
packages/contracts/src/generated/operation-descriptors.ts
```

It must export:

- a readonly descriptor map containing only session-exposed operations;
- `SESSION_OPERATION_NAMES`;
- `SessionOperationName`;
- per-operation client fields with name, parameter position, kind, and type
  reference;
- server-context fields and validations;
- ordered wire-argument source and position;
- invalidated resources.

Add the target to package exports, generated barrels, build output, package
verification, and source-independent generation checks. Release the result as
one immutable `lumiere-contracts` version.

### Contracts tests

Generator fixtures must prove:

- session operations are present and denied operations are absent;
- descriptor keys exactly equal the IR session-exposure set;
- server-owned `organization_id` is absent from client input;
- client-owned `company_id` remains when declared by IR;
- wire positions are complete, unique, and ordered;
- invalid type references, duplicate positions, and missing provenance fail
  generation;
- regeneration is deterministic and clean.

Required commands include the existing contracts generator check, unit tests,
TypeScript typecheck/build, and package-content verification.

## 4. Application consumption

After the contracts release is tagged:

1. Atomically update Rust and TypeScript contract pins and both lockfiles.
2. Make `frontend/packages/stdb/src/commands/stdb-http.ts` derive its public
   reducer key/name surface from the generated descriptor package export.
3. Keep `OperationInputMap` as the generated input-type highway.
4. Delete
   `frontend/packages/stdb/src/commands/generated-stdb-bff-reducers.ts`.
5. Remove that file's emitter and path ownership from:
   - `lumiere-codegen/src/reducer_contract.rs`;
   - `lumiere-codegen/src/paths.rs`;
   - the relevant Makefile generation/drift targets.
6. Add a focused `stdb-http` contract test proving an allowed session operation
   compiles and a denied operation is unavailable.

Existing named command call sites must compile unchanged. Do not add a fallback
copy of the reducer names in application code.

## 5. Explicit non-goals

- changing api-server dispatch behavior;
- deleting or weakening the generated Rust `reducer_call!` allowlist;
- generating wire codecs or the public domain SDK in this slice;
- migrating legacy positional reducer callers;
- broad domain or opaque-record cleanup;
- generating one file per operation;
- inventing business defaults or moving authorization into generated code.

The generated Rust operation table is deliberately deferred. Removing it safely
requires a lightweight Rust descriptor crate or feature so API, AI, and IoT
consumers do not pull the full STDB binding surface merely to preserve
compile-time reducer validation.

## 6. Application verification

- `make codegen` produces no application-owned reducer-name list;
- frontend STDB unit tests and typecheck pass;
- query-hooks typecheck passes;
- every existing named command call site compiles;
- contracts staging and drift checks pass from the immutable release;
- the opaque-record ratchet does not increase;
- no direct reducer-array business call site is introduced.

## 7. Definition of done

- canonical IR is the sole source of the frontend session-operation set;
- descriptor keys exactly match all and only session-exposed IR operations;
- client/server ownership and wire positions remain visible in the generated
  descriptor;
- `stdb-http.ts` consumes the contracts package export;
- the duplicate generated reducer-name file and its app-side emitter are gone;
- both repositories build from one immutable contracts release;
- all contracts and application verification gates are green.

The next continuation slice may build generated wire codecs and a typed API
operation endpoint on this descriptor highway.
