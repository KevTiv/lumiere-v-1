# COV canonical operation/outcome prototype

**Status:** PROTOTYPE — implementation guidance, not yet production authority  
**Parent:** COV-00 current-state census / PR #49  
**Reference workflow:** CRM opportunity → Sales order  
**Goal:** establish one high-quality mutation/effect/readback path that module agents can copy without inventing local semantics.

## 1. Why this prototype exists

COV-00 found that Lumière already has broad reducer, generated command, query and frontend coverage. The quality gap is not primarily missing CRUD. It is the seam between a user action and a trustworthy product outcome.

The current common path is:

```text
UI action
  ↓
React Query mutation
  ↓
stdbBffCommandPost(generated operation input)
  ↓
POST /api/operations/:operation
  ↓
TrustedOperationContext + org/company scope
  ↓
STDB reducer
  ↓
{ "ok": true }
  ↓
void mutation result + query invalidation
  ↓
caller/test tries to rediscover what happened
```

The server side already has the correct authority boundary: authenticated session, generated operation contract, server-derived organization, company-scope validation and trusted reducer dispatch. The missing product contract is **effect certainty**.

`{ "ok": true }` means the operation transport completed. It does not prove whether the reducer:

- newly applied the effect;
- recognized an idempotent replay and performed no new effect;
- committed but the observable read model has not converged yet;
- produced the intended resulting record;
- produced exactly one resulting record.

New COV work must not translate transport success directly into a green toast or `Applied` result.

## 2. Reference workflow choice

`convert_opportunity_to_sale_order` is a useful reference because it is:

- operator-reachable in the CRM UI;
- generated through the canonical operation transport;
- cross-module (CRM → Sales);
- already covered by the lead-to-cash E2E;
- idempotent in the domain: the reducer checks for an existing sale order with the same `opportunity_id` and treats retry as a no-op;
- naturally correlated by a stable business key: `sale_order.opportunity_id`.

The canonical result is therefore not “the newest sale order” and not “a sale order for the same partner.” It is:

```text
exactly one SaleOrder where sale_order.opportunity_id == source Opportunity.id
```

Zero rows after a bounded readback window is uncertain outcome. More than one row is an invariant failure.

## 3. Target path

```text
UI intent
  ↓
module application hook
  ↓
exact pre-effect read by stable business key
  ├── found exactly one → AlreadyApplied(recordRef)
  ├── found >1          → hard invariant failure
  └── found none
         ↓
  generated typed operation input
         ↓
  /api/operations/:operation
         ↓
  trusted context + current authorization + company scope
         ↓
  reducer dispatch
         ↓
  transport receipt (accepted only)
         ↓
  exact canonical readback by the same business key
         ├── exactly one → Applied(recordRef)
         ├── none        → OutcomeUnknown(reconciliation ref)
         └── >1          → hard invariant failure
```

The returned record reference becomes the navigation/readback contract for the UI and tests.

## 4. Prototype types

The executable prototype lives in:

```text
frontend/packages/api-client/src/operation-outcome.ts
frontend/packages/query-hooks/src/hooks/operation-effect.ts
```

### Transport receipt

```ts
type OperationDispatchReceipt = {
  kind: "accepted"
  operationId?: string
  correlationId?: string
}
```

`accepted` is deliberately not called `applied`.

### Product effect outcome

```ts
type OperationEffectOutcome =
  | { kind: "applied"; ref: CanonicalRecordRef; receipt: OperationDispatchReceipt }
  | { kind: "already-applied"; ref: CanonicalRecordRef }
  | { kind: "rejected"; error: OperationRequestError }
  | {
      kind: "outcome-unknown"
      reason: "dispatch-unknown" | "readback-missing" | "readback-failed"
      correlationId?: string
    }
```

This is intentionally smaller than a repository-wide error model. Domain/application services can enrich their own outcomes while preserving these transport/effect semantics.

## 5. Error semantics

The prototype converts HTTP status into stable recovery intent rather than requiring components to parse error strings.

| HTTP class | Code | UI / caller recovery |
| --- | --- | --- |
| 401 | `unauthorized` | sign-in/session recovery; do not retry mutation |
| 403 | `forbidden` | explain denied action; no retry |
| 400/422 | `invalid_input` | retain form values and show diagnostics |
| 404 | `not_found` | refresh canonical state / target may be stale |
| 409 | `conflict` | refresh/compare; never silently overwrite |
| 410 | `gone` | target intentionally unavailable |
| 429 | `rate_limited` | retry later, explicitly |
| 503 | `dependency_unavailable` | reconcile before any resend |
| 5xx | `internal` | reconcile before any consequential resend |

A dependency/server failure after dispatch begins is treated conservatively. The application must not assume no effect occurred merely because the HTTP request failed.

## 6. Canonical readback rules

Every consequential or cross-module COV action must define an effect identity before implementation.

Good identities:

```text
opportunity → sale order     sale_order.opportunity_id
sale order → invoice         account_move.source sale_order id / released stable relation
purchase order → vendor bill released PO relation
return request → credit note immutable return/invoice relation
expense sheet → reimbursement immutable sheet/payment relation
subscription billing run    run/idempotency key → generated invoices
```

Bad identities:

```text
ORDER BY id DESC
"newest row"
latest row for same organization
same customer/partner only
same amount/date/name
sleep(500) then use the first row
random client UUID with no persisted server mapping
```

If the necessary stable relationship is missing from the canonical query/IR, stop the module task and create a producer → release → consumer contract dependency. Do not add a local heuristic.

## 7. Existing golden-path defect discovered by this investigation

The current E2E helper for opportunity → sale order:

1. filters sale orders by `opportunity_id`;
2. if multiple rows match, sorts by ID and chooses the newest;
3. if the projection lacks `opportunity_id`, falls back to matching the opportunity's partner.

Both fallback behaviors weaken the invariant and can hide duplicate-effect defects. The follow-up should replace this helper with exact unique correlation and make missing `opportunity_id` a contract/test fixture failure.

Tests should prove the same invariant as production, not compensate for missing product identity.

## 8. Server refinement path

Do this incrementally; do not redesign the entire API server inside COV-01.

### Stage A — compatible transport metadata

Keep the existing body shape compatible while adding server-owned metadata:

```json
{
  "ok": true,
  "operationId": "erp.convert_opportunity_to_sale_order",
  "correlationId": "..."
}
```

The client prototype already accepts today's `{ "ok": true }` and preserves these fields when they appear.

### Stage B — structured expected errors

Converge COH-02/API transport onto a stable envelope with a machine code, correlation ID and retry/recovery semantics. Do not create a giant domain error enum.

### Stage C — effect-aware application services where justified

For high-value transitions, a server application service may perform the authoritative post-read and return a stable record reference. That service must use the same generated operation/current authorization path; it must not become a second mutation authority.

Do not teach the generic reducer dispatcher that every reducer has identical result semantics.

## 9. React Query hook rule

New cross-module/lifecycle hooks should return a semantic result rather than `void`:

```ts
const result = await convertOpportunity.mutateAsync(input)

switch (result.kind) {
  case "applied":
  case "already-applied":
    router.push(result.ref.href)
    break
  case "rejected":
    // map typed diagnostics/recovery
    break
  case "outcome-unknown":
    // retain local state; show reconciliation reference; never resend automatically
    break
}
```

The component owns presentation and navigation. It does not infer whether the mutation happened.

## 10. Query invalidation rule

Invalidation is cache maintenance, not effect identity.

Each hook records the exact affected resources from generated/reviewed command metadata. Avoid repository-wide `invalidateQueries()` calls. A resulting record ref should come from canonical readback, not from whichever query happens to refresh first.

## 11. UI behavior contract

For lifecycle actions:

- submit stays pending until the semantic outcome is known or enters an explicit waiting/unknown state;
- `Applied`/`AlreadyApplied` may close the form and navigate to canonical readback;
- validation/forbidden/conflict retain user-entered values;
- `OutcomeUnknown` must not show “Saved”/“Completed” and must not automatically resend;
- a user may explicitly reconcile/refresh and only retry when the operation's idempotency/effect semantics allow it;
- direct downstream links use stable record refs rather than “go find it in Sales.”

## 12. Test pyramid for a converted action

A converted COV action needs all applicable layers:

1. **domain invariant** — reducer business rules, idempotent retry, zero partial delta on reject;
2. **transport unit** — HTTP status → typed error/recovery intent;
3. **effect resolver unit** — zero/one/multiple result behavior;
4. **hook integration** — generated input, one dispatch, exact readback, correct invalidations;
5. **Playwright operator path** — actual UI action → canonical result → direct linked navigation;
6. **adversarial** — stale state, permission revocation, duplicate submission, committed-response-lost where applicable.

A direct BFF/reducer call inside Playwright can prove backend behavior, but it does not certify a primary operator lifecycle as U5.

## 13. Promotion rule

This prototype should become the COV-01 reference only after coordinator review verifies:

- no parallel operation transport was introduced;
- generated operation contracts remain the mutation boundary;
- server-derived org/company/current authorization remain authoritative;
- exact result identity exists;
- duplicate exact effects fail loudly;
- ambiguous dispatch never triggers blind retry;
- typed result reaches the UI;
- the representative operator E2E no longer performs heuristic result discovery.

Until then, it is a reference implementation branch, not permission for module agents to mass-migrate hooks.
