# COV prototype follow-up sequence

This sequence converts the investigation prototype into an accepted shared seam before broad module migration.

## Gate 0 — close COV-00 denominator

Run in parallel:

```text
COV-00A  current operation census + disposition ratchet
COV-00B  first-org product surface admission catalog/census
```

Do not mass-assign module migrations until both give the coordinator a stable denominator.

## COV-01 reference spine

### COV-01a — transport receipt metadata

Ownership: api-server operation transport + api-client decoder.

Goal:

- preserve today's compatibility `{ ok: true }`;
- return server-owned `operationId` and `correlationId`;
- keep this a dispatch receipt, not a claim that business effect is newly Applied;
- converge expected errors with COH-02 rather than invent a competing global taxonomy.

Do not change domain reducers here.

### COV-01b — CRM opportunity → Sales order semantic hook

Ownership: CRM query/application hook only, plus focused shared helper changes already reviewed.

Target:

```text
Opportunity.id
→ exact SaleOrder.opportunity_id pre-read
→ generated convert operation
→ exact SaleOrder.opportunity_id post-read
→ Applied/AlreadyApplied/Rejected/OutcomeUnknown
→ stable SaleOrder record ref
```

Required:

- zero/one/multiple resolver tests;
- no newest/partner fallback;
- one dispatch max per invocation;
- invalidations limited to `opportunities` and `sale-orders`;
- component receives the semantic result.

### COV-01c — UI result/navigation integration

Ownership: named CRM workflow modal caller only.

- success/replay closes and offers/navigates to resulting Sales order;
- conflict/validation retains values;
- unknown outcome keeps the local form/context and offers reconciliation/refresh;
- analytics event occurs only for a resolved applied/replay outcome, with outcome kind recorded where useful.

No business rule moves into React.

### COV-01d — golden E2E invariant repair

Ownership: focused lead-to-cash helper/spec.

Delete:

- newest-row selection for duplicate `opportunity_id` matches;
- partner-only fallback for missing correlation metadata.

Add:

- exact unique sale-order relation assertion;
- duplicate relation fails;
- operation result/ref leads directly into Sales;
- refresh/reopen preserves canonical state;
- idempotent second action does not create a second sale order.

### COV-01e — shared UI outcome adapter

Only after the reference action is accepted, extract the minimal reusable rendering/recovery adapter needed by forms/actions. Keep domain-specific labels and navigation in module callers.

This should converge with COH-02/COH-10 and UX-03/UX-07 rather than create another error system.

## Promotion gate for broad COV work

The reference spine is accepted only when:

```text
operator UI
→ typed generated operation
→ trusted/current-authorized server dispatch
→ canonical STDB transition
→ exact result readback
→ typed semantic outcome
→ direct resulting record navigation
```

is proven end-to-end with no heuristic result discovery.

## First adoption batch

After the spine is accepted, choose actions with strong existing domain identity and tests rather than migrating entire modules at once:

```text
Lane A  Sales order → fulfillment/invoice links
Lane B  Purchase order → receipt/vendor bill
Lane C  Accounting payment/reversal outcome + reconciliation ref
Lane D  Expense sheet submit/approve/post/reimburse
Lane E  Proposal approval/handoff or approved horizontal workflow action
```

One action per worker. Coordinator owns shared helpers/outcome changes.

## Second adoption batch

Once patterns survive the first batch:

- inventory transfer/picking transitions;
- manufacturing order completion;
- HR leave/payroll transitions;
- project timesheet validation/billing;
- subscription billing/amend/cancel;
- POS session/payment/close;
- Helpdesk lifecycle;
- IoT alert acknowledge/action;
- Documents/Reports/Approvals horizontal outcomes.

## Do not batch by file/module breadth

Bad assignment:

> “Make Inventory U5.”

Good assignments:

> “COV-06b: picking confirm→assign→validate, canonical picking/result links, stale/duplicate behavior, browser proof. Do not touch cycle counts/lots/replenishment.”

The parent COV row closes only after all bounded slices integrate and certification runs.
