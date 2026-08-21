# Write-path reducer contract — execution plan

**Status:** Implemented locally; v0.3.0 contracts publish and database migration verification pending — 2026-08-21
**Tracks:** `stdb-query-boundary`, `contract-ir`, `codegen`, `api-gateway`, `runtime-upgrade`
**Role:** executable sequencing for workstream 1 of [stdb-pg-api-contract-consistency-plan.md](./stdb-pg-api-contract-consistency-plan.md)
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [contracts-extraction-execution-plan.md](./contracts-extraction-execution-plan.md) · [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md)

---

## 1. Two findings that reshape the earlier plan

### 1.1 The module schema is a better source than the generated bindings

The consistency plan proposed deriving a reducer manifest by extending `stdb_bindings_parse.rs` to walk 3,021 generated Rust files. That is unnecessary. The module already publishes its own schema:

```bash
spacetime describe --json lumiere-v1-j1uo0 -s maincloud
```

8.7 MB of JSON containing `tables` (458), `reducers` (1,313), `types` (1,250), `typespace`, and `row_level_security`. Each reducer carries its ordered parameter list with names and algebraic types, plus its lifecycle tag:

```jsonc
{ "name": "create_lead",
  "params": { "elements": [
    { "name": { "some": "organization_id" }, "algebraic_type": { "U64": [] } },
    { "name": { "some": "params" },          "algebraic_type": { "Ref": 334 } } ] },
  "lifecycle": { "none": [] } }
```

This is the authority the bindings are themselves generated *from*. Parsing bindings to recover it would be deriving the input from the output — exactly the circularity the contracts-extraction plan set out to avoid. **Phase A consumes `describe --json`.**

Second-order benefit: `check-contracts-drift` currently cannot detect module drift in CI because it needs the `spacetime` CLI to regenerate bindings. The schema endpoint is plain HTTP against a published module, so drift detection becomes available to CI without a CLI install.

### 1.2 The gateway's organization-scope check is inert on more reducers than it covers correctly

`post_call` ([http_app.rs:192](api-server/src/http_app.rs:192)) enforces scope only via `args.first().and_then(|v| v.as_u64())`. Measured against the live schema, of the **1,059** non-lifecycle reducers reachable in `strict` mode:

| Bucket | Count | What the check actually does |
|---|---:|---|
| First param is `organization_id: U64` | 976 | works as intended |
| Zero parameters | 39 | `args.first()` is `None` — **check skipped** |
| First param is `U64` but not `organization_id` | 23 | compares an unrelated id (`company_id`, `role_id`, …) against the session org |
| First param is not `U64` | 21 | `as_u64()` returns `None` — **check skipped** |

The 21 inert cases are the ones that matter most, because `Identity` serializes as a `Product`. Every reducer taking an identity first silently skips the check — including the privilege-granting and credential paths the frontend actually calls:

```
add_org_member            (user_identity: Product, organization_id: U64, …)
add_user_to_organization  (user_identity: Product, organization_id: U64, …)
assign_role               (user_identity: Product, role_id: U64, organization_id: U64, …)
create_password_reset_token, link_workos_user,
store_sso_user_credential, store_user_credential
```

**This is an assurance gap, not an open door.** The reducers enforce their own authorization inside STDB, which is invariant §2.1 working as designed — `assign_role` calls `check_permission(ctx, organization_id, "user_role_assignment", "create")` and verifies the role belongs to that organization; `dev_promote_caller_superuser` and `ensure_dev_admin` call `require_dev_reducers_enabled()`; `apply_global_migrations` requires `is_superuser`. Nothing here is currently exploitable through the gateway.

What is wrong is that the gateway *appears* to provide a uniform org-scope guarantee and provides it for 92% of reachable reducers, with the exceptions selected by an implementation detail of argument encoding rather than by any decision. Defense in depth that silently disengages on identity-taking reducers is worse than no defense in depth, because it is credited in review as if it held.

### 1.3 Corollary: the frontend's reducer contract is untyped end to end

`STDB_BFF_REDUCERS` is `[] as const` and `StdbBffReducerKey = string` ([stdb-http.ts](frontend/packages/stdb/src/commands/stdb-http.ts)), so any string is a valid reducer name at compile time. The consequence is visible in the repo's own contract test:

```ts
void stdbBffPost("confirm_sale_order", [1n, 2n]);   // stdb.contract.ts:7
```

The module has no `confirm_sale_order`. It has `confirm_sales_order`. The contract test type-checks and passes against a reducer that does not exist, and the same name is carried in `track-reducer-coverage.ts`. Nothing in the toolchain can currently notice.

---

## 2. Runtime version decision

The read-boundary question ("should plan resolution move into an STDB procedure?") was blocked on procedures being beta. That is no longer true.

| Release | Date | Relevance |
|---|---|---|
| 2.0.1 | — | **current pin**; procedures gated behind `features = ["unstable"]` |
| 2.4.0 | 2026-06-03 | regression: `ctx.sender` / `ctx.connection_id` always empty inside procedures |
| **2.5.0** | 2026-06-11 | **procedures graduate to stable** — ungated from `unstable` (PR #5164), along with `ProcedureContext`, `with_tx`/`try_with_tx`, scheduled procedures, and the outgoing HTTP client `ctx.http` |
| 2.6.1 | 2026-07-01 | fixes the 2.4 identity regression; TS `Option<T>` codegen becomes truly optional keys (**breaking for TS consumers**) |
| 2.7.1 | 2026-07-30 | V10 schema serialization retains column defaults — fixes schema diff, `extract-schema`, and codegen |
| 2.8.2 | 2026-08-18 | latest; fixes table-accessor rename auto-migration |

`ctx.http` graduating alongside procedures matters as much as procedures themselves: it is the sanctioned way for the module to reach the durable gateway, which is what §5 of the cold-tier plan describes.

**Recommendation: bump to 2.8.2.** Not to adopt procedures immediately, but to stop making the read-boundary decision under a constraint that expired two months ago. Views and RLS (`client_visibility_filter`) remain gated behind `unstable`, so the plan's "views own active read models" language stays future work either way.

**Upgrade cost, measured:** the module compiles clean against 2.8.2 — `cargo check --target wasm32-unknown-unknown` exits 0 with 7 pre-existing warnings and **zero errors**, unmodified (§6). Rust-module breaking changes across 2.1→2.8 are absent from the release notes; the listed breakages are TypeScript (`Option<T>` keys, 2.6.1) and Svelte (2.7.0, not used here). The TS one lands on the frontend and on the extracted TS bindings in `lumiere-contracts`, so a bump forces a contracts republish regardless.

What that check does **not** cover, and what Step 7 must therefore actually test: publishing 458 tables against a 2.8.2 server exercises auto-migration, not just compilation. 2.2.0 changed primary-key migration behavior, 2.6.0 and 2.5.0 widened event-table automigrations, 2.7.0 made adding `#[unique]`/`#[primary_key]` non-breaking when data permits, and 2.8.2 fixed accessor-name migration. A clean `cargo check` says the source is compatible; only a publish against a 2.8.2 server says the *schema transition* is.

---

## 3. Work steps

Sequenced smallest-blast-radius first. Each step is a PR that ships with a caller, per §5.6 of the consistency plan.

### Step 1 — schema snapshot as a build input

- [x] add `make schema-snapshot` writing `describe --json` to `.contracts-staging/module-schema.json`;
- [x] add a CI-safe HTTP fallback that fetches the same schema from the published module without the CLI;
- [x] commit nothing — this is staging input, like the bindings.

**Exit:** the schema is obtainable in CI and locally by one command, and matches the pinned bindings' reducer set.

### Step 2 — emit `reducer-manifest.json`

- [x] new `lumiere-codegen` emitter reading the schema snapshot;
- [x] per reducer: name, ordered params (name + resolved type + `Ref` target name), lifecycle, and a structurally derived `scope` marking the `organization_id` / `company_id` parameter **wherever it sits in the list**, not only first;
- [x] fail generation when a reducer has two organization-scope candidates or an `organization_id` of non-integer type;
- [x] add to `publish-contracts.sh`, `check-codegen`, `check-contracts-drift`;
- [x] expose as `lumiere_contracts::manifests::REDUCER_MANIFEST` when published (the publisher emits constants for every staged manifest);
- [ ] publish `lumiere-contracts` v0.3.0; bump the pin.

**Exit:** all 1,313 reducers present; a test asserts every manifest param list matches the corresponding generated `*Args` struct field-for-field, so the two derivations of the same truth cannot silently diverge.

### Step 3 — `reducer-exposure.json`

- [x] hand-authored, `denied` by default, one entry per exposed reducer with a reason;
- [x] seed it from enumerated frontend BFF call sites. The implementation found 852 distinct reducer call sites across generic and domain-specific BFF helpers; the earlier count of 21 covered only the generic helper names;
- [x] codegen fails on an entry naming a reducer the schema does not have (this alone catches `confirm_sale_order`);
- [x] `exposure` becomes a field on the manifest entries.

**Exit:** the reachable surface is an enumerated list under review, not `1,310 minus regex`.

### Step 4 — manifest-driven `post_call`

- [x] resolve exposure from the manifest; reject anything not `session`-exposed, in **all** modes including dev, so dev and prod stop disagreeing about what is callable;
- [x] resolve the scope parameter by manifest position and compare *that* argument against the session org — covering the 39 + 23 + 21 cases uniformly;
- [x] a reducer with no organization-scope parameter must be explicitly marked `unscoped` with a reason in the exposure file, or it is rejected;
- [x] validate arity and scalar kinds against the manifest before dispatch;
- [x] delete `blocked_reducer_reason` and its deny patterns.

**Exit:** no reducer reaches STDB through the generic endpoint without a manifest-checked name, arity, and scope decision. Proven with a test using `assign_role` — identity-first, org third — as the fixture.

### Step 5 — typed `ReducerCall` in `stdb-client`

- [x] `ReducerCall` builder validating against the compiled-in manifest at construction;
- [x] port the in-tree call sites (101 calls across 36 files at implementation time);
- [x] make the raw `call_reducer(&str, Value)` path private;
- [x] CI lint rejecting reducer-name string literals outside the manifest.

**Exit:** a reducer rename fails `cargo check`, not a production request.

### Step 6 — frontend contract narrowing

- [x] generate `StdbBffReducerKey` as a union from the exposure list instead of `string`;
- [x] populate `STDB_BFF_REDUCERS` from the manifest;
- [x] fix `confirm_sale_order` → `confirm_sales_order` and re-point the coverage tracker (plus four other stale reducer spellings discovered by schema validation);
- [ ] this ships with the 2.6.1 `Option<T>` codegen change if the version bump lands first — sequence them together to avoid two frontend type migrations.

**Exit:** an unknown reducer name is a TypeScript error.

### Step 7 (optional, gated on §2) — version bump

- [x] bump the module `spacetimedb` dependency to 2.8.2 and regenerate the staged Rust and TypeScript contracts with the 2.8.2 CLI;
- [ ] publish the module, publish `lumiere-contracts` v0.3.0, and atomically move the Rust/TypeScript client pins;
- [ ] absorb the TS `Option<T>` breaking change;
- [ ] verify the 2.8.2 accessor-rename migration fix does not alter existing accessors;
- [x] no procedures adopted in this step — the bump only removes the constraint on the read-boundary decision.

---

## 4. Tests

1. manifest params match the generated `*Args` structs for all 1,313 reducers;
2. a reducer absent from `reducer-exposure.json` is rejected in every mode, dev included;
3. scope is enforced for an identity-first reducer (`assign_role`), a zero-arg reducer, and a `U64`-first-but-not-org reducer;
4. a reducer with no org parameter is rejected unless explicitly marked `unscoped`;
5. org A cannot invoke a reducer scoped to org B through the generic endpoint;
6. wrong arity and wrong scalar kind are rejected before dispatch;
7. codegen fails on an exposure entry naming a nonexistent reducer;
8. drift CI fails when the module gains a reducer and contracts are not republished;
9. the frontend contract test fails to compile on an unknown reducer name.

---

## 5. Not in this workstream

- read-path unification and the `ResourceReadPlan` collapse (workstream 2);
- adopting procedures, and moving plan resolution into STDB;
- capability/risk/confirmation metadata and the harness tool registry;
- organization placement/lifecycle;
- renaming `cold_tier` / the plan docs to durable-projection vocabulary.

---

## 6. Verification log

**2.8.2 compile check — passed.** Module source copied unmodified to a scratch tree, `spacetimedb` bumped `2.0.1` → `2.8.2`, `crates/stdb-auth/assets/` staged at the relative path the module's `include_str!` expects (`permissions.rs` compiles the resource registry into the module — worth noting on its own: the registry is STDB-owned, not gateway-owned).

```
$ cargo check --target wasm32-unknown-unknown --message-format short
warning: `lumiere_v1` (lib) generated 7 warnings
    Finished `dev` profile in 19.99s
EXIT=0
```

Lockfile resolved `spacetimedb 2.8.2`; re-checked from a touched `lib.rs` to defeat caching. Zero errors, zero source changes. The 7 warnings (unused import in `psa_advanced.rs:35`, six `unused_mut` in `subscription_wave_e.rs`) are pre-existing on 2.0.1.

**Schema-snapshot feasibility — confirmed.** `spacetime describe --json lumiere-v1-j1uo0 -s maincloud` returns 8.7 MB covering 458 tables, 1,313 reducers, 1,250 types. All measurements in §1.2 are computed from that snapshot.

**Implementation verification — passed locally.** The CI-safe HTTP snapshot returned 458 tables, 1,313 reducers, and 1,250 types. Reducer codegen emitted 852 `session`-exposed and 461 denied entries, and cross-checked every non-lifecycle reducer against its generated Rust `Args` fields. `cargo check --workspace`, the focused `stdb-client` and `api-server::http_app` tests, all reducer-codegen tests, the reducer-literal lint, `cargo check --tests` for the 2.8.2 module, and targeted `@lumiere/stdb` / `@lumiere/query-hooks` typechecks passed. The full web typecheck remains red on pre-existing generated-contract nullability/object-shape errors; publishing the 2.8.2-generated v0.3.0 contracts is intentionally kept atomic with the TypeScript runtime-pin migration rather than mixing v0.2.1 bindings with the 2.8 runtime.
