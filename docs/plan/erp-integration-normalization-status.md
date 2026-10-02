# ERP integration normalization

**Status:** IMPLEMENTED — source/build normalization; contract and runtime acceptance pending

This is a bounded repair of PR #146, not module certification or permission to
merge the whole ERP stack.

## Base and scope

- Integration base: `f3d5b76863efe66c3e9e183ce9740a03cc047bba`
  (`claude/reconcile-chains`, PR #146).
- Working branch: `fix/normalize-erp-integration`.
- The integration base already contains current `main`
  (`f6a3e91fb2fee6434a498da9522c06f5147967de`).
- No schema, reducer signature, generated binding, dependency pin, or domain
  business-rule change is introduced by this normalization.

## Sibling-fix disposition

| Source | Disposition in the normalized tree |
| --- | --- |
| PR #143 / `0cdfc6aee` | Carried forward as `99f8ef1d2`: fix both aggregate recipes, prevent cached setup from skipping requested certification, and require execution evidence in CI. |
| PR #132 / `f78a4559e` | Reused the four `Promise<void>` expense callback fixes and the inbox caller adaptation. The existing exact-effect resolvers remain authoritative. |
| PR #132 / `000593768` | Registered the expense lifecycle spec in the existing COV-00C operator-bypass inventory. |
| PR #145 / `d034c70af` | Already present semantically: Expenses uses `accountMoveHref` from the shared record-link owner, producing the journal-entry `filter=id:N` URL. No duplicate inline URL patch was applied. |
| PR #124 / `6c862bdb9` | Reused explicit Documents-tab selection for both lock/unlock and version-upload browser proofs. |
| PR #126 / `18c2f3f98` | Adapted the intended targeted fixture admission, rather than copying its broken single-`$` Make expansions. Explicit spec paths survive as separate arguments; live AI remains opt-in. |
| PR #125 / `03499345e` | Intentionally not copied: a branch-A-only `v0.3.74` pin does not establish compatibility with the combined registry/reducers. Matching contract release is the next gate. |

## Integrated source repairs

- Fleet clones only the optional request key before its existing consuming
  validator, preserving the full submitted payload for the existing replay
  comparison. Request-key validation, journal/GL matching, and accounting
  invariants are unchanged. That comparison is not yet payload-exact; see the
  blocking review finding below.
- The dormant Expenses inbox now requires an operating-company prop and passes
  it to approval, rather than constructing a mutation that necessarily rejects
  its missing company. No render site or new operator surface is introduced.
- Reports retains one `CanonicalRecordRef` import.
- Sales and Distributor import the existing application-owned
  `frontend/web/components/order-handoff-links.tsx` by relative path, as other
  application components do. The `@/components/*` alias remains owned by the UI
  package; no component or authority is duplicated or moved.
- COV-00C also inventories the newly combined POS, Helpdesk, Documents, Reports,
  and Approvals specs. Their fixture setup uses direct calls; the inventory does
  not promote them to accepted operator proofs.

## Verification

All results below are local source/build evidence, not live operator acceptance.

| Command / proof | Result |
| --- | --- |
| `CI=1 pnpm --dir frontend install --frozen-lockfile` | PASS; existing lockfile and contract pin retained. |
| `pnpm --dir frontend --filter @lumiere/query-hooks typecheck` | PASS. |
| `pnpm --dir frontend/web typecheck` | PASS; initial combined run timed out, independent rerun passed. |
| `NEXT_TELEMETRY_DISABLED=1 pnpm --dir frontend/web build` | PASS; production Turbopack compilation and all 106 static pages. Next skips type validation, so the separate typecheck above is required. |
| Query-hooks `*effect.test.ts`, `order-to-cash.test.ts`, and shared `record-links.test.ts`, through `node --import tsx --test` | PASS: 80 tests, zero failures or skips. |
| `python3 -m unittest discover -s scripts/tests -p 'test_*.py' -v` | PASS: 31 tests, including Make/Bash targeted-argument and aggregate execution regressions. |
| `python3 scripts/validate-cov00c-correctness-census.py` | PASS after inventorying the combined specs; open/partial defect classes remain open. |
| `python3 scripts/validate-cov00d-evidence-matrix.py` | PASS; partial and absent lifecycle evidence remains classified, not promoted. |
| `pnpm --dir frontend operation-transport:check` | PASS; generated immutable operation endpoints remain required. |
| `pnpm --dir frontend i18n:check` | PASS; no duplicate or missing static keys. |
| Playwright `--list` for COV-18/21/22/24/25 with `--grep-invert @ai-live` | PASS: seven workflow tests plus auth setup are discovered, including the explicit dev-fixture proof. Not browser execution. |
| `cargo check --manifest-path spacetimedb/Cargo.toml --locked --offline` | PASS; pre-existing warnings remain. |
| `cargo check --manifest-path spacetimedb/Cargo.toml --locked --offline --target wasm32-unknown-unknown` | PASS on rerun after the initial cold compile timed out; 13 pre-existing warnings remain. |
| `git diff --check` | PASS. |

## Review finding — Fleet replay acceptance is blocked

The compile fix does not repair an inherited domain gap:
`service_payload_matches_existing` checks the cost/accounting payload, with
vehicle and service type checked by its caller, but omits `serviced_at`,
`odometer_km`, `provider`, and `notes`. Reusing a request key with changed values
for these fields acknowledges the existing record instead of rejecting the
different request.

Before COV-15 exact-replay acceptance, a bounded domain repair must compare all
canonicalized submitted fields (or a persisted canonical request fingerprint)
and prove each mismatched replay is rejected with service/accounting effects
unchanged. This is a business-invariant repair, not a contract-pin or compiler
fix, and has deliberately not been folded into normalization.

## Remaining gates

1. Generate and release contracts from this combined tree, then resolve and
   verify every consumer pin and lockfile against that release. The existing
   `v0.3.73` pin is retained, not certified as matching the combined sources.
2. Run the real Inventory/Analytics certification on the repaired PR #143 head.
   Gate regression tests use stubs; earlier green CI did not execute aggregates.
3. Repair and prove the Fleet replay gap above, then run the bounded domain and
   actual operator proofs on the final pinned head, followed by integrated
   P0/full/pretenant regression.
4. Refresh affected upstream branches and rerun their own evidence before
   landing bottom-up. A downstream green result is not upstream acceptance.
5. Keep module follow-ups and COV-26/27 separate. This normalization does not
   change `IMPLEMENTED — runtime acceptance pending` into `ACCEPTED` or U5.

Nothing has been published or merged from this normalization branch.
