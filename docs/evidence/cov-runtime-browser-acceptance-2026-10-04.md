# COV browser acceptance — 2026-10-04

**Browser lane: PASS. Overall runtime acceptance: REVIEW.**

The fresh isolated run passed **51 tests, zero failures, zero skips, zero flaky
tests**, in 9.1 minutes with one worker. This closes the original 43-test browser
failure set, but does not certify every outstanding COV25 link or the full stack.

## Exact scope

| Scope | Passed |
| --- | ---: |
| Original requested COV05–10 and COV13–25 workflows | 43 |
| New COV06n, COV07f and COV07g operator specs | 3 |
| New COV25 purchase, proposal and subscription specs | 3 |
| Legacy proposals lifecycle | 1 |
| Authentication setup | 1 |
| **Total** | **51** |

The original accounting invoice/payment workflow is
`accounting-post-reconcile.spec.ts`; its filename has no `cov` prefix. Counting
only such prefixes yields 42 original tests, not the complete 43.

The subscription spec proves billing-run invoice navigation and an explicit
missing-payment-relation state. Passing that test does **not** accept payment
navigation.

## Source and runtime identity

The work is an uncommitted repair on base
`77e3e495af2265be07d36854f7c9740dab435056`. No new immutable Git head is claimed.
The snapshot hashes are also recorded in the adjacent JSON:

- Source SHA-256: `bdd8eaaee14e82d455a83932d32bad62d33caaf67e310f916b00c3e39f5e9b51`
- WASM SHA-256: `8b620cd6fc97157b5099146c8c86d2bb1e25d1a09fc32506f3233d1630e3835a`
- API binary SHA-256: `12d5a3024121b9528e56444d8f6b1745f7fecaeadaade3fdfd69474fbad98259`
- Next build ID: `01V5aWrRMJ__KSnmUW07j`
- Contracts: `v0.3.81`
- STDB: `http://127.0.0.1:3917`, module
  `lumiere-cov-acceptance-final-20261004`
- PostgreSQL: `lumiere_cov_acceptance_final_20261004`
- API/web acceptance ports: `48182` / `43100`
- Playwright start: `2026-10-04T11:15:07.907Z`

The source digest is SHA-256 over a sorted JSON map of path → file SHA-256 for
Git-known and nonignored source files under `api-server`, `crates`, `frontend`,
`spacetimedb`, and `lumiere-codegen`. Secrets and generated build/cache files are
excluded. The complete map is local in
`.tmp/cov-acceptance/final-source-fingerprint.json`.

## Authority-preserving repairs verified

- Explicit browser/bearer actors remain intact. Interactive Next session
  resolution obtains verified identity, membership and field access together
  from the API; it no longer falls back to privileged membership queries.
- Current domain permission precedes identified validation/replay paths.
  Reader-denial assertions preserve canonical effects and return `403`;
  authorized state/SoD failures retain `422`.
- Four governed workflow forms are provisioned by the existing atomic owner:
  sale/purchase lines, sale-order invoice, and purchase-order vendor bill.
  Together with the journal default, bootstrap verifies 5 configurations,
  41 fields and 5 journal roles.
- HR, Projects and Proposals exercise distinct persisted actors, self-action
  rejection and unchanged denied effects.
- Optional denied Overview/contact/IoT reads no longer crash otherwise
  authorized primary workflows or become misleading zero data.
- Scheduler readback uses a narrowly classified, permission-checked,
  org/company-bound owner read. The scheduled table remains private.
- Scheduler controls are attached to the actual Replenishment tab, not Products.
- Scrap takes an exact positive location ID and leaves designation/scope
  validation with the reducer, rather than filtering on an omitted projection.
- Byproduct inputs finalize absent metadata, and finish readback handles a
  complete declared output set with exactly one primary output and legitimate
  byproducts. Missing/duplicate/unowned output invariants remain fail-closed.
- COV25 uses canonical exact-ID URLs, including refresh/back proof. Fixtures
  no longer assume a newly created order is on the first table page.

Operator transitions remain UI-driven. Exact-ID owner SQL is supplemental test
evidence for omitted actor/parent-array/cost fields and fixture-only UUID
correlation, not a substitute for production read authority or UI transitions.

## Verification and execution

Centralized checks used the existing workspace/build directories; workers made
source-only follow-up repairs without build caches.

- API session regression lane: 7 passed.
- Private replenishment query lane: 6 passed.
- Native domain unit suite: 147 passed.
- Frontend unit suite and explicit Overview state tests passed; the Overview
  test is now included in the standard unit command.
- Cross-record/order-to-cash/partial-effect and finish-resolver tests passed.
- Full frontend typecheck and production web build passed.
- Complete `make check-codegen-pinned` passed.
- Live core, inventory, analytics, HR, Projects and Proposals domain lanes passed.
- Fresh bootstrap commit reducer passed after correcting the expected graph
  counts. Repeating bootstrap in an already initialized tenant is intentionally
  rejected, so that proof used a separate fresh module.

Final Playwright invocation used the exact spec list in
`.tmp/cov-acceptance/full-spec-files.json`, covering COV05–10 and COV13–25 plus
`accounting-post-reconcile.spec.ts` and `proposals-lifecycle.spec.ts`:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:43100 E2E_WORKERS=1 \
  pnpm exec playwright test --workers=1 --reporter=list,json \
  <exact-spec-list>
```

Local full report: `.tmp/cov-acceptance/fresh-acceptance.json`.
Artifacts: `.tmp/cov-acceptance/playwright/fresh-acceptance`.
Raw traces/auth state remain local and are not a public sharing artifact.

Exploratory runs retained their data and evidence. Reusing those datasets
exposed pagination and fixed-key fixture assumptions; the final run used a
fresh module and fresh PostgreSQL database, without resetting existing data.

Temporary acceptance API, web and projection-worker processes were stopped after
diagnosis. Existing services were untouched; datasets, quarantine and evidence
were retained. No isolated worker build caches were created for these repairs.

## Runtime readiness blocker

The fresh API initially passed readiness with contract `0.3.81` and migration
version 10. After the passing browser suite, `/ready` returned `503`:

- STDB, PostgreSQL, contract/migration and release compatibility: healthy.
- Projection lag: unhealthy for organization 1.
- Projection worker: blocked at commit sequence 11, `incompatible_commit`.

Read-only diagnosis found `mrp_bom upsert must contain exactly the generated full
row`. The actual private STDB row-change image has 28 keys including `type_`;
the pinned projection codec has 28 columns including `type`. Their key sets
differ by exactly that name. PostgreSQL held durable sequence 10, head sequence
28 and an 18-commit backlog at observation. This is a verified producer/codec
naming mismatch, not an inferred field or a reason to weaken full-row validation.

This is a real persistence/readiness failure. No lag budget, quarantine,
watermark or failure was cleared or weakened to make the browser run green.
The passing UI/STDB assertions do not replace durable projection convergence.
Overall runtime/T0 acceptance therefore remains **REVIEW**.

## Remaining contract and evidence limits

1. `account-payments` omits `reconciled_invoice_ids` in the actual operator
   projection. Subscription invoices remain navigable while payment links fail
   closed with an explicit notice. A governed projection/release is required.
2. Helpdesk lacks a canonical related-record model/ID relation.
3. Historical subscription invoices outside billing runs and pending/
   unreconciled payments remain outside the bounded link proof.
4. Scheduler timed firing/rescheduling and resulting job/scrap/byproduct record
   navigation, responsive/accessibility and full U5 certification are not claimed.
5. This proves one clean, one-worker browser lane; general parallel/repeated
   same-dataset reliability is not implied.

## Next bounded task

Align canonical persisted-row naming with the generated projection codec
(`mrp_bom.type_` versus `type`), add cross-layer regression evidence, and recover
the sequence-11 projection through the normal replay path before runtime
promotion. Do not introduce an ad hoc key rename or clear the failure. Then take the
subscription payment projection and Helpdesk relation release lanes separately;
do not infer those links from partner, date, amount, or newest-row heuristics.
