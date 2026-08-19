# Private generated ERP contracts repository

**Status:** Proposed — architecture plan only  
**Tracks:** `codegen`, `contracts`, `github-packages`, `rust`, `typescript`, `reviewability`  
**Related:** [offline-changeset-sync.md](./offline-changeset-sync.md) · [sliding-window-cold-tier.md](./sliding-window-cold-tier.md)

> **Investigation constraint:** this plan must move **only generated codegen output consumed by the ERP**. It must **not** move business logic, reducer logic, authorization logic, schema/codegen implementation, generator source, handwritten adapters, runtime orchestration, or domain rules out of `lumiere-v-1`.

---

## 1. Decision

Create a private GitHub repository, tentatively `KevTiv/lumiere-contracts`, whose sole purpose is to store, version, validate, and distribute generated ERP contract artifacts produced by `lumiere-codegen` and SpacetimeDB generation.

`lumiere-v-1` remains the source repository for:

- SpacetimeDB domain tables and reducers;
- business rules and validation;
- authorization and policy code;
- `lumiere-codegen` source and schema-IR construction;
- handwritten application/runtime adapters;
- API, sync, approval and reducer orchestration.

`lumiere-contracts` receives only generated outputs that consumers need in order to compile or interact with the ERP contract surface.

```text
lumiere-v-1
  owns source of truth + generators
        │
        ▼
  lumiere-codegen / spacetime generate
        │
        ▼
 generated staging output
        │
        ▼
private GitHub repo: lumiere-contracts
        │
        ├── Rust generated contracts
        ├── TypeScript generated contracts
        ├── generated Drizzle schema
        ├── generated sync/reducer manifests
        └── generated SQL/schema artifacts where required by consumers
```

The goal is to remove generated type noise from normal application pull requests while keeping all domain and generator ownership in the main repository.

---

## 2. Scope rule

Before moving any file, classify it into exactly one category.

| Category | Move to `lumiere-contracts`? | Rule |
|---|---:|---|
| Generated DTO/resource types | Yes | Pure generated contract output |
| Generated reducer argument/result types | Yes | Pure generated contract output |
| Generated table bindings used only as type/schema contracts | Yes | If no business/runtime behavior is embedded |
| Generated Drizzle table/schema definitions | Yes | Consumer-facing generated client contract |
| Generated resource/reducer/sync manifests | Yes | If derived and consumed as contracts |
| Generated Postgres/SQLite DDL artifacts | Investigate | Move only if consumed as released contract artifacts rather than build intermediates |
| SpacetimeDB reducers | **No** | Business logic remains in `lumiere-v-1` |
| Domain validation/invariants | **No** | Business logic remains in `lumiere-v-1` |
| `lumiere-codegen/src/**` | **No** | Generator implementation remains in `lumiere-v-1` |
| Schema IR construction/parsing | **No** | Generator architecture remains in `lumiere-v-1` |
| Authorization / policy / approval code | **No** | Runtime/business responsibility |
| Sync engine logic | **No** | Runtime orchestration, not a generated contract |
| Handwritten adapters around generated SDKs | **No** | Runtime integration responsibility |
| Generated SDK runtime code with transport behavior | Investigate | Keep local unless it can be proven to be contract-only |

### 2.1 Hard guardrail

The extraction must never turn `lumiere-contracts` into a second application or source-of-truth repository.

A file belongs in `lumiere-contracts` only when all of the following are true:

1. it is generated deterministically;
2. it can be regenerated from source that remains in `lumiere-v-1`;
3. consumers require it for typing, schemas, serialization, generated DB access, or protocol compatibility;
4. it contains no authoritative business decision logic;
5. deleting the contracts repo would not remove the ability to regenerate the artifact from `lumiere-v-1`.

---

## 3. Target repository shape

```text
lumiere-contracts/
├── README.md
├── CONTRACT_VERSION
├── packages/
│   └── contracts/
│       ├── package.json
│       └── src/
│           ├── resources/
│           ├── reducers/
│           ├── drizzle/
│           ├── sync/
│           └── index.ts
├── crates/
│   └── lumiere-contracts/
│       ├── Cargo.toml
│       └── src/
│           ├── resources/
│           ├── reducers/
│           ├── sync/
│           └── lib.rs
├── manifests/
│   ├── schema.json
│   ├── resources.json
│   ├── reducers.json
│   ├── sync.json
│   └── compatibility.json
└── sql/
    ├── postgres/
    └── sqlite/
```

This repository should contain as little handwritten code as possible. Handwritten files are limited to package metadata, CI/release configuration, documentation, and thin package/crate export files where generation does not produce them.

---

## 4. Distribution model

### 4.1 TypeScript

Publish the generated TypeScript package privately through GitHub Packages:

```text
@lumiere/contracts
```

Prefer subpath exports rather than many packages:

```ts
import type { SaleOrder } from "@lumiere/contracts/sales";
import type { ConfirmSaleOrderArgs } from "@lumiere/contracts/reducers";
import { saleOrder } from "@lumiere/contracts/drizzle";
import type { PullBatch } from "@lumiere/contracts/sync";
```

`lumiere-v-1` should consume an explicit released version rather than generated source directories.

### 4.2 Rust

Keep the generated Rust contract crate in the same private GitHub repository and consume it as a pinned private Git dependency:

```toml
lumiere-contracts = {
  git = "ssh://git@github.com/KevTiv/lumiere-contracts.git",
  tag = "v0.1.0"
}
```

Do not depend on the default branch. Release tags or immutable commit SHAs are required.

### 4.3 One release boundary

A single Git tag must identify one coherent generated contract release across TS, Rust, manifests, and generated schema artifacts.

Keep these version concepts distinct:

- **contract package version** — semver release of `lumiere-contracts`;
- **schema version** — local/canonical schema compatibility;
- **sync protocol version** — wire protocol compatibility.

---

## 5. Generation and release flow

The generator remains in `lumiere-v-1`.

Target flow:

```text
lumiere-v-1 source changes
        ↓
run existing generation + lumiere-codegen
        ↓
emit all distributable contracts into neutral staging directory
        ↓
validate generated output
        ↓
update private lumiere-contracts repository
        ↓
contract-only PR
        ↓
merge + tag
        ↓
GitHub Packages publish (@lumiere/contracts)
        ↓
dependency bump PR in lumiere-v-1
```

The main application PR should therefore review handwritten logic plus a small dependency-version change rather than thousands of regenerated type files.

---

## 6. Required investigation before extraction

Phase 0 must inventory the current generated trees and determine which files are true contracts versus runtime/generated implementation.

### 6.1 Rust generated SDK bindings

Investigate `api-server/src/stdb_sdk_bindings/**` and classify:

- pure table/resource type definitions;
- reducer argument/result types;
- generated runtime client glue;
- transport/subscription/runtime behavior;
- generated modules required only because of SpacetimeDB SDK layout.

Move only the contract-safe subset unless the entire generated module can be proven to contain no application/runtime behavior.

### 6.2 Frontend generated bindings

Investigate `frontend/packages/stdb/src/module_bindings/**` and any `generated/**` trees to classify:

- pure TypeScript types;
- reducer argument contracts;
- table schemas;
- runtime SpacetimeDB client code;
- live subscription/cache integration.

Only generated contract output moves. Existing handwritten live/cache adapters stay in the main repo.

### 6.3 Codegen artifacts

Investigate outputs from `lumiere-codegen` and determine which are:

- distributable contracts;
- CI-only audit artifacts;
- generator intermediates;
- main-repo runtime configuration.

Do not relocate `lumiere-codegen` implementation or its business-facing configuration solely to make the contracts repository self-generating.

### 6.4 Drizzle/offline contracts

As the Drizzle + SQLite plan is implemented, generate Drizzle tables, local resource codecs, sync wire types, and compatibility manifests into the contract release rather than directly into application source trees.

The sync engine implementation itself remains in `lumiere-v-1`.

---

## 7. Consumer migration

### Phase 1 — inventory and contract boundary

- Produce a machine-readable inventory of all current generated files.
- Mark every generated artifact as `contract`, `runtime-generated`, `intermediate`, or `main-repo-only`.
- Fail the investigation if business logic or generator logic would need to move to make the extraction work.
- Define a stable staging directory for distributable generated artifacts.

### Phase 2 — private repository bootstrap

- Create private `KevTiv/lumiere-contracts`.
- Add private GitHub Actions validation.
- Add Rust crate and TS package shells.
- Add GitHub Packages npm publishing configuration.
- Keep repository visibility private.

### Phase 3 — TypeScript extraction

- Generate ERP resource/reducer types into the staging contract package.
- Publish `@lumiere/contracts` privately.
- Replace main-repo imports from generated TS trees with package imports.
- Verify web/mobile builds without checked-in duplicate generated contracts.

### Phase 4 — Rust extraction

- Generate contract-safe Rust types into `crates/lumiere-contracts` in the private repo.
- Consume by pinned Git tag/SHA.
- Replace direct imports of contract-only generated SDK files where technically possible.
- Retain unavoidable SDK runtime glue locally behind adapters if SpacetimeDB requires it.

### Phase 5 — Drizzle/schema artifacts

- Emit generated Drizzle schema and sync contracts into `@lumiere/contracts`.
- Emit SQLite/Postgres schema artifacts only where they are genuine released compatibility artifacts.
- Keep migration execution logic and DB orchestration in `lumiere-v-1`.

### Phase 6 — review-noise cleanup

- Remove extracted generated files from `lumiere-v-1`.
- Add CI guards preventing contract outputs from being checked back into application source trees.
- Keep only documented exceptions for runtime-generated glue that cannot safely move.

---

## 8. CI and release guarantees

### `lumiere-v-1`

CI should verify:

- generator output is deterministic;
- the staged contract output matches the expected contract version or release workflow;
- no forbidden generated contract directories are committed locally after extraction;
- Rust and TS consumers compile against the selected contract release;
- schema/sync compatibility metadata is valid.

### `lumiere-contracts`

CI should verify:

- `cargo check` for the generated Rust crate;
- TypeScript build/typecheck for `@lumiere/contracts`;
- generated manifests parse and cross-reference correctly;
- generated Drizzle schemas compile;
- package/crate version and compatibility metadata agree;
- release tags are immutable.

---

## 9. Review model

Generated contract changes should be reviewed in the contracts repository independently from application behavior changes.

Example:

```text
lumiere-contracts PR
  generated contract diff only
        ↓
release v0.8.0
        ↓
lumiere-v-1 PR
  @lumiere/contracts 0.7.2 → 0.8.0
  Rust git tag v0.7.2 → v0.8.0
  handwritten ERP implementation
```

This keeps normal ERP PRs focused on behavior rather than generated file churn while preserving a reviewable audit trail for contract changes.

---

## 10. Acceptance criteria

This plan is complete only when:

1. `lumiere-v-1` remains the sole home of business logic and generator implementation.
2. `lumiere-contracts` contains only generated ERP contract outputs plus minimal packaging/release scaffolding.
3. TypeScript consumers use a private `@lumiere/contracts` package published from GitHub.
4. Rust consumers use the private GitHub contracts repository through pinned tag/SHA dependencies.
5. generated Drizzle/resource/reducer/sync types can be consumed without checking their generated source into normal ERP application directories.
6. generated contract changes are reviewed in dedicated contract PRs.
7. normal ERP PRs no longer contain large generated type churn except documented runtime-glue exceptions.
8. removing the contracts repository never removes the source required to regenerate it from `lumiere-v-1`.

---

## 11. Explicit non-goals

- Moving SpacetimeDB reducer implementations.
- Moving domain/business validation.
- Moving authorization, field policy, approval policy, or organization/company scoping logic.
- Moving `lumiere-codegen` source code or schema-IR implementation.
- Making `lumiere-contracts` an authoritative schema-authoring repository.
- Implementing a new Cargo registry service.
- Moving application sync-engine logic into the contracts repository.
- Hiding generated changes from review; generated changes move to a dedicated review surface instead.
