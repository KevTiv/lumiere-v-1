# STDB / PG / API call-path consistency plan

**Status:** Proposed — 2026-08-21
**Tracks:** `stdb-query-boundary`, `contract-ir`, `codegen`, `durable-postgres`, `api-gateway`
**Role:** the concrete, currently-executable slice of [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) §11 Phase 1, unblocked by the contracts extraction landing on this branch
**Related:** [contracts-extraction-execution-plan.md](./contracts-extraction-execution-plan.md) · [private-generated-contracts-repo.md](./private-generated-contracts-repo.md) · [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [sliding-window-cold-tier-phase0-mistakes.md](./sliding-window-cold-tier-phase0-mistakes.md)

---

## 1. Why now

`lumiere-contracts` v0.2.1 is pinned and consumed by both `api-server` and `crates/stdb-auth`. Generated bindings and the six manifests are now a *versioned dependency* rather than 3,000 in-tree files, and `make check-contracts-drift` catches divergence between the live module and the pinned tag.

That changes what is cheap. Before extraction, adding a generated artifact meant adding thousands of reviewed files to every PR. Now a new manifest is one JSON file in a released tag. The call-path inconsistencies below have all been "known but expensive"; the expense is gone.

This plan does **not** build the application-contract IR. It makes the existing STDB/PG/API call paths converge on single seams *shaped like* that IR, so Phase 1 of the cold-tier plan becomes a generation step rather than a rewrite.

---

## 2. Measured current state

Counted on this branch (`vibe/sliding-window-cold-tier`), against pinned contracts `0.2.1`:

| Surface | Count | Where |
|---|---:|---|
| Reducers in the module | 1,312 | `lumiere-contracts` bindings, `*_reducer.rs` |
| Reducers reachable by name through `POST /v1/call/:reducer` | all 1,312 minus deny patterns | [http_app.rs:153](api-server/src/http_app.rs:153), [reducer_allowlist.rs](api-server/src/reducer_allowlist.rs) |
| `call_reducer` call sites in `api-server` | 73 across 23 files | routes + 6 workers + 2 drainers |
| Reducers with a declared cache-invalidation mapping | 70 | [reducer-stdb-invalidation.json](lumiere-codegen/reducer-stdb-invalidation.json) |
| Read resources in the hand-authored registry | 336 | [resource_registry.json](crates/stdb-auth/assets/resource_registry.json) |
| Read resources compiled through `ResourceReadPlan` | 1 (`pos_order`) | [pos_order_read.rs](api-server/src/cold_tier/pos_order_read.rs) |
| Hand-written read SQL builder | 2,149 lines | [query_exec.rs](api-server/src/query_exec.rs) |
| STDB→PG drainers | 2 (`audit_log`, `pos_order`) | `cold_tier/*_drainer.rs`, 919 lines |
| Archive candidates declared | 2 | `manifests/archive-manifest.json` |
| Hydration policies declared | 0 | `manifests/hydration-manifest.json` |
| Tables in the schema manifest | 458 | `manifests/lumiere-schema-manifest.json` |
| Reducers in the schema manifest | **0** | there is no reducer section |

The last row is the root cause of most of what follows: the generated schema IR describes *state* exhaustively and describes *commands* not at all. Every command-side decision — is this reducer callable, what are its arguments, which argument carries organization scope, what does it invalidate — is therefore hand-maintained, partial, or inferred at runtime.

---

## 3. The four inconsistencies

### 3.1 Write path is stringly typed and org-scope is inferred

`StdbClient::call_reducer(&str, Value)` ([lib.rs:114](crates/stdb-client/src/lib.rs:114)) posts a positional JSON array. Nothing checks the name against the module, the arity, or the argument types; a renamed or reordered reducer parameter fails at runtime, in production, as an opaque STDB 400.

The generic endpoint is worse than the 73 in-tree call sites, because it is caller-driven:

```rust
} else if let Some(requested_org) = args.first().and_then(|v| v.as_u64()) {
    if requested_org != org_id {
        return Err(ApiError::Forbidden("organization scope mismatch for reducer call".into()));
    }
}
```
— [http_app.rs:192](api-server/src/http_app.rs:192)

Organization scoping is enforced **only** when `args[0]` happens to parse as a `u64`. A reducer whose first parameter is a string, an enum, a params struct, or absent silently skips the check entirely. This is not a hypothetical shape: reducers in the bindings take `organization_id` first *by convention*, and convention is what is being enforced here. The correct check requires knowing each reducer's parameter list — which is exactly what is not generated.

`blocked_reducer_reason` is a hand-written deny-pattern list, so the default posture for a newly added reducer is *exposed*.

### 3.2 Read path has two compilers, and the new one has one caller

- `execute_resource_query` ([query_exec.rs:611](api-server/src/query_exec.rs:611)) serves 336 registry resources by way of long `matches!` ladders over resource-name string literals, emitting STDB SQL directly. It has no cursor contract, no cold-tier awareness, and no shared predicate/ordering vocabulary.
- `ResourceReadPlan` + `compile_stdb_sql` / `compile_pg_sql` ([cold_tier/mod.rs:42](api-server/src/cold_tier/mod.rs:42)) is the typed, keyset-paginated, hot∪cold design — reached by exactly one resource. `audit_read.rs` predates it and stays hand-rolled by explicit choice.

Two compilers means every cold-tier promotion is a rewrite rather than a manifest entry, and the `sliding-window-cold-tier-phase0-mistakes.md` retro applies directly: the typed path's correctness is still carried almost entirely by its own unit tests.

### 3.3 Projection is per-table hand-written code

`audit_drainer.rs` (649) and `pos_order_drainer.rs` (270) implement the same shape — read hot tail, encode via codec manifest, upsert into PG, call a finalize reducer, advance a watermark — twice, divergently. `archive-manifest.json` already carries everything a generic drainer needs per candidate (`cold_table`, `finalize_reducer`, `mode`, `order_by`, `primary_key`, `scope_columns`, `pg_ddl_file`). With 2 candidates the duplication is cheap; it is the third that must not be written by hand.

### 3.4 Cache invalidation is 5% covered and fails open

70 of 1,312 reducers have an invalidation mapping. `stdbInvalidationFor(reducer)` returns an empty list for the other 1,242, so a successful mutation through `POST /api/call/:reducer` leaves the client's TanStack cache stale with no signal. Nothing detects that a new reducer arrived without a mapping.

---

## 4. Target seams

One generated artifact unblocks three of the four.

### 4.1 Reducer contract manifest (new codegen output)

Extend `lumiere-codegen/src/cold_tier/stdb_bindings_parse.rs` — which already walks the same bindings directory to build the schema IR — to emit `reducer-manifest.json` alongside the existing six:

```jsonc
{
  "version": 1,
  "reducers": [
    {
      "name": "accept_sale_order_quotation",
      "params": [
        { "name": "organization_id", "type": "U64", "scope": "organization" },
        { "name": "order_id",        "type": "U64" },
        { "name": "params",          "type": "Struct", "type_name": "AcceptSaleOrderQuotationParams" }
      ],
      "lifecycle": false,
      "exposure": "denied"      // "denied" | "session" | "internal"
    }
  ]
}
```

`params` comes from the generated `*Args` struct, which is mechanical and already parsed for tables. `scope` is derived structurally (parameter named `organization_id` / `company_id` with an integer type), never guessed at runtime. `exposure` is the one hand-authored field, defaulting to `denied`, held in a small input file next to `reducer-stdb-invalidation.json` — so **new reducers are closed by default** and opening one is a reviewed diff.

This artifact stays structural. It carries no Casbin roles, no business validation, no risk/confirmation metadata — those belong to the capability IR in [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md), which can consume this manifest later rather than re-deriving it.

### 4.2 `ReducerCall` in `stdb-client`

`call_reducer(&str, Value)` becomes private; callers construct a checked call:

```rust
let call = ReducerCall::new("create_lead")?          // name checked against the manifest
    .arg("organization_id", org_id)?                  // arity + name + scalar kind checked
    .arg("params", &params)?;
client.call(call).await?;
```

The manifest is compiled in from `lumiere_contracts::manifests::REDUCER_MANIFEST`, so a reducer rename fails the *build* of every call site, not the request. `post_call` resolves the scope parameter from the manifest instead of probing `args[0]`, and rejects any reducer whose `exposure` is not `session` — replacing the deny-pattern allowlist outright.

### 4.3 One read compiler

`execute_resource_query` produces a `ResourceReadPlan` rather than SQL. The registry becomes plan input (predicates, ordering, projection, scope columns) instead of a `matches!` ladder. Hot-only resources compile through `compile_stdb_sql` with no cold branch; promoting a resource to the cold tier becomes an `archive-manifest.json` entry plus a drainer registration, with no change to the read handler.

### 4.4 One drainer

A single `cold_tier::drainer` parameterized by an `ArchiveCandidate`, with `audit_log` and `pos_order` as its two registrations. Mode-specific behavior (`append_only` vs. the mutable case) lives in one `match`, not one file per table.

---

## 5. Invariants this plan must not break

Inherited from [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) §2, restated where this work could violate them:

1. No business rule moves into `api-server`, the manifests, or the generated crate. The reducer manifest describes *shape*, never *permission* — Casbin remains the sole authority (§2.6, §2.14).
2. Organization scope resolution remains server-derived. The manifest makes the scope parameter *knowable*; it never lets a caller name it (§2.20).
3. `exposure` defaults to `denied`. A generation step must never widen the reachable surface (§2.5).
4. No new hand-written read or projection path is added while the generic one is being built — otherwise this plan reproduces the problem it closes.
5. Generated artifacts stay generated-output-only; the `exposure` and invalidation input files live in `lumiere-v-1`, not in `lumiere-contracts` (contracts-extraction §2).
6. Every phase below ships with a caller. Per the Phase 0 retro, code with zero callers is not "done" — `cold_tier/` was checked off in that state and carried eight defects.

---

## 6. Phases

### Phase A — reducer contract manifest

- [ ] extract reducer name + ordered params + types in `stdb_bindings_parse.rs`, reusing the existing type parser (which now errors on unknown types rather than defaulting to `Struct`);
- [ ] derive `scope` structurally; fail generation on a reducer with two organization-scope candidates;
- [ ] add `reducer-exposure.json` (hand-authored, `denied` default) next to `reducer-stdb-invalidation.json`;
- [ ] emit `manifests/reducer-manifest.json`; add it to `publish-contracts.sh`, `check-codegen`, and `check-contracts-drift`;
- [ ] expose it as `lumiere_contracts::manifests::REDUCER_MANIFEST`;
- [ ] publish `lumiere-contracts` v0.3.0 and bump the pin.

**Exit gate:** the manifest lists all 1,312 reducers, every entry's param list matches its generated `*Args` struct field-for-field (asserted by a test that re-parses the bindings independently), and drift CI fails if a reducer is added without regenerating.

### Phase B — typed write path

- [ ] add `ReducerCall` to `stdb-client`, validated against the compiled-in manifest;
- [ ] rewrite `post_call` to resolve exposure and scope from the manifest; delete `blocked_reducer_reason`'s pattern list;
- [ ] port all 73 call sites; make `call_reducer` private;
- [ ] populate `reducer-exposure.json` for exactly the reducers the frontend calls today — enumerated from the frontend, not assumed;
- [ ] add a CI lint rejecting reducer names as string literals outside the generated manifest.

**Exit gate:** no path reaches STDB with an unvalidated reducer name or arity; a reducer whose first parameter is not an organization id is either scope-checked correctly or rejected, proven by a test using a real such reducer from the module.

### Phase C — one read compiler

- [ ] give `ResourceReadPlan` the predicate/projection vocabulary `execute_resource_query` needs (verified against the registry, not sampled);
- [ ] port the registry to plan construction, domain by domain, starting with the domain the pos_order work already touched;
- [ ] keep `audit_read.rs` as-is until its bounded top-500 contract is intentionally replaced;
- [ ] adversarial tests first, per the Phase 0 retro: empty `IN`, numeric-looking `Text`, mixed-direction multi-key cursors, quoted identifiers, unknown types;
- [ ] delete the `matches!` ladders as each domain lands.

**Exit gate:** every one of the 336 resources compiles through `ResourceReadPlan`; `query_exec.rs` contains no SQL string construction.

### Phase D — manifest-driven projection

- [ ] extract the shared drainer loop; register `audit_log` and `pos_order` through it;
- [ ] prove equivalence against the current drainers on real data before deleting them;
- [ ] add a third candidate end-to-end as the actual test of genericity.

### Phase E — invalidation completeness

- [ ] make `reducer-stdb-invalidation.json` total: every non-lifecycle reducer maps to resources or to an explicit `[]` with a reason;
- [ ] fail codegen on an unmapped reducer;
- [ ] cross-check that every mapped resource name exists in the registry: the 46 distinct resources currently referenced all do, but nothing enforces it — `stdb_invalidation_emit.rs` never reads the registry.

---

## 7. Required tests

1. reducer manifest params match the generated `*Args` structs for all 1,312 reducers;
2. a reducer absent from `reducer-exposure.json` is rejected by `post_call` in every mode, including local dev;
3. scope enforcement holds for a reducer whose first parameter is not a `u64`;
4. `ReducerCall` rejects wrong arity, unknown parameter names, and mismatched scalar kinds at compile time where possible and at construction otherwise;
5. org A cannot invoke a reducer scoped to org B through the generic endpoint;
6. every registry resource produces a valid `ResourceReadPlan` and compiles under both compilers;
7. plan compilation is adversarially tested (empty `IN`, mixed-direction cursors, identifier quoting, numeric-looking text keys);
8. the generic drainer reproduces both existing drainers' output byte-for-byte on a fixture;
9. codegen fails on an unmapped reducer and on an invalidation entry naming an unknown resource;
10. drift CI fails when the module gains a reducer and contracts are not republished.

---

## 8. Acceptance

- the schema manifest describes commands as completely as it describes state;
- no reducer is reachable from outside without a reviewed `exposure` entry;
- organization scope is resolved from generated metadata, never inferred from argument position;
- one read compiler, one drainer, one write seam;
- `query_exec.rs` and the two drainers are materially smaller or gone;
- the capability IR in `agent-ir-codegen-extension-plan.md` can be built by *annotating* these manifests rather than re-deriving them from bindings.

---

## 9. Out of scope

- the application-contract IR, generated hooks/services, and the private npm package (Phase 1 of the cold-tier plan proper);
- capability/risk/confirmation/traffic metadata and the harness tool registry;
- analysis shaping;
- organization placement/lifecycle (Phase 0 of the cold-tier plan);
- moving the `exposure` or invalidation inputs into `lumiere-contracts`;
- any new cold-tier candidate beyond the one Phase D uses as its genericity proof.
