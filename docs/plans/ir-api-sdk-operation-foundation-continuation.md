# IR-owned frontend operation descriptors — continuation PR

**Status:** v0.3.5 descriptor consumption complete; IR v2 producer complete and companion consumer in PR #6 — 2026-08-30
**Depends on:** canonical IR/contracts extraction merge
**Companion release:** `lumiere-contracts` v0.3.5

The application pins the immutable `v0.3.5` tag at companion release commit
`f87f2d57dffddd8d7598dbd69abae249369fdaa1`. The generated descriptor is now
the application-owned named-command surface. The remaining positional
accounting adapter and its duplicate hook have been removed.
**Related:**
[typed-bff-sdk-contract-hardening-execution-plan.md](./typed-bff-sdk-contract-hardening-execution-plan.md) ·
[contracts-extraction-execution-plan.md](./contracts-extraction-execution-plan.md) ·
[Phase 2 P0 release-gate recovery](./phase-2-p0-release-gate-recovery.md)

## 1. Outcome

Make canonical IR own the frontend named-command operation surface. Generate a
compact session-operation descriptor in `lumiere-contracts`, consume it in the
STDB command highway, and delete the duplicate application-owned reducer-name
list and emitter.

This is the smallest independently mergeable step toward the generated SDK and
typed API boundary. It changes contract ownership without changing server
dispatch behavior.

## 1.1 IR v2 continuation

The application extractor now writes a separate
`lumiere-contract-ir-v2.json` beside the release-compatible v1 artifact. V2
adds a contract-operation identity candidate, source target, canonical
input/output references, codec state, idempotency state, resource row
references, source tables, and mutation invalidation links.

This is intentionally a versioned structural boundary rather than a silent v1
shape change. Facts that cannot be derived from the STDB schema are explicit:

- operation idempotency is `unclassified`;
- application semantic kind is `unclassified`;
- operation identity is `locked` by the authored `contract-operation-ids.json` manifest;
- resource query/filter/cursor contracts are `unclassified`;
- resource authorization scope is `unclassified`;
- codecs are `unassigned`;
- a registry table absent from the canonical table schema is `unresolved`.

V1 remains the published consumer input until the companion v2 consumer in
`lumiere-contracts` PR #6 is merged and released. The identity manifest must exactly cover the
canonical operation set and keep IDs unique, so additions and renames require an
explicit contract change. Promotion still requires authored scope and
idempotency policy; generated code must not infer either from table columns or
operation names.

The release handoff keeps this migration reversible: a publisher run writes
generation-specific `ir/PIN-v1.json` and `ir/PIN-v2.json` files, each bound to
its own artifact digest, semantic hash, schema version, and source commit.
`ir/PIN.json` is the active-generation pointer used by the companion generator.
The application drift gate verifies both generation-specific pins when both
artifacts are present. Until the companion v2 consumer is tagged and the
application dependency is intentionally bumped, the active pointer remains v1;
the v2 release promotes it to `PIN-v2.json` atomically with generated outputs.

This active-name lock is not yet a historical anti-reuse ledger. Before the
production hardening gate claims protection against same-name semantic
replacement, evolve the manifest with retired-ID tombstones or canonical
operation-shape fingerprints and an explicit compatibility policy.

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
- adding new positional reducer callers;
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

The P0 recovery milestone must complete before the next continuation slice
builds generated wire codecs and a typed API operation endpoint on this
descriptor highway.
