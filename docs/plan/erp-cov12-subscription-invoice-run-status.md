# COV-12 — One recurring invoice run

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** Subscriptions  
**Plan target:** one recurring invoice run  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /subscriptions

Existing operations (already reachable from the frontend command layer):

- `generate_subscription_invoice` — hook: `frontend/packages/query-hooks/src/hooks/subscriptions.ts`
- `pay_subscription_invoice` — hook: `frontend/packages/query-hooks/src/hooks/subscriptions.ts`

Canonical resources: subscriptions, account-moves

## Effect contract

Generated invoice resolves through a stable subscription→invoice relation keyed by (subscription id, billing period); replay/scheduler retry must not double-bill.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Contract release possibly required.** the run itself resolves through `subscription-billing-runs.billing_run_key` (no release); proving the exact invoice move needs the run/subscription→move relation (`invoice_ids` is not on the `subscriptions` projection, `invoice_origin` is not on `account-moves`)

Contract releases cannot be cut from CI or from the authoring session; stop at IMPLEMENTED with the registry diff prepared and hand off `make publish-contracts VERSION=x.y.z` to a maintainer with `lumiere-contracts` access.

## Prerequisites / decisions

Scheduler replay proof needs the recurring job id exposed or a native test.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov12-subscription-invoice-run.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
