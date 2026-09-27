# Adversarial business-invariant certification

**Status:** Proposed — implementation plan only  
**Stack:** child of `docs/workflow-integration-program` / PR #38  
**Related:** `docs/plans/erp-workflow-integration-program.md` · `docs/plans/pre-tenant-adversarial-certification.md`  
**Tracks:** `pre-tenant`, `adversarial-testing`, `workflow-integration`, `tenancy`, `idempotency`, `money`, `inventory`, `approval-integrity`, `recovery`, `production-readiness`

---

## 1. Decision

Extend Lumiere's existing pre-tenant adversarial certification with a business-invariant attack program that targets cross-module ERP correctness, not only individual reducer correctness.

The suite must deliberately exercise believable misuse and failure shapes:

- valid inputs submitted in the wrong sequence;
- stale approval and stale UI state;
- simultaneous actors racing contradictory transitions;
- duplicate execution after a committed-but-lost response;
- foreign organization/company/resource references;
- partial completion across multi-step economic workflows;
- over-allocation, over-shipment, over-return, over-billing and duplicate billing;
- historical mutation after posting/closing/finalization;
- approval of content that changed after review;
- duplicate serial, invoice, payment, provider or external references;
- model-generated and offline-generated actions attempting to bypass normal workflow semantics.

The unit of certification is a **business invariant across a workflow**, not a reducer.

Example:

```text
sale order confirmed
    ↓
stock reserved
    ↓
shipment validated
    ↓
invoice created
```

Each reducer may behave correctly in isolation while the combined state becomes impossible. The suite therefore asserts properties across the entire resulting state graph.

The strongest universal rule is:

> A rejected operation must leave zero unauthorized or partial business-state delta.

Tests must assert both the returned failure and the absence of side effects.

---

## 2. Relationship to the existing pre-tenant suite

The existing pre-tenant suite already attacks:

- authority;
- idempotency;
- money;
- communications;
- stale state;
- recovery;
- tenancy;
- latency and offline behavior;
- simultaneous approvals;
- ambiguous committed responses;
- provider callback disorder;
- seeded state-machine transitions.

This plan extends that suite. It does **not** create a parallel testing framework.

Reuse:

- the current known-defect registry/promotion discipline;
- current local SpacetimeDB certification fixtures;
- current seeded-state-machine infrastructure;
- `@pretenant` Playwright fixtures;
- multi-session actor provisioning;
- latency/offline/lost-response injection;
- current payment and messaging helpers;
- capability-gated tests that become active as workflow integration PRs land.

New work should plug into those seams unless a concrete blocker requires a shared helper to be extracted.

---

## 3. Invariant taxonomy

Retain the existing classifications and add explicit business-conservation and approval-integrity classes.

### 3.1 AUTHORITY

Only the current trusted actor, organization, company and current permission set may authorize a state transition.

Rules:

- authorization is checked at execution time;
- permissions captured at page load or earlier workflow steps never authorize a later mutation;
- saved workflow, AI, import or offline artifacts never retain authority;
- server-derived scope is authoritative.

### 3.2 TENANCY

No operation may read, reference, attach or mutate a record outside its authorized organization/company scope.

A test only passes if:

1. the foreign reference is rejected; and
2. no state changes in either tenant.

### 3.3 ATOMICITY

A failed or rejected operation cannot leave a partial business effect.

Examples:

- failed invoice creation creates no half-linked invoice;
- rejected shipment does not decrement one stock row before failing another validation;
- rejected approval does not create child effects before returning an error.

### 3.4 IDEMPOTENCY

Retried business intent must not duplicate economic or operational effects.

Idempotency must cover:

- same request repeated;
- committed response lost and retried;
- late original response after retry;
- same idempotency key with altered payload;
- concurrent duplicate execution.

### 3.5 CONSERVATION

Stock, money, billed quantity, returned quantity, recognized revenue and other conserved business quantities cannot appear/disappear except through an explicit audited transition.

Examples:

```text
inventory before
+ receipts
+ explicit positive adjustments
- deliveries
- consumption
- explicit negative adjustments
= inventory after
```

and:

```text
invoice amount
= reconciled amount
+ residual amount
+ valid unapplied/credit treatment
```

### 3.6 BALANCE

Accounting effects must remain balanced.

At every committed accounting boundary:

```text
sum(debit) == sum(credit)
```

Additional balance constraints apply to payment allocation, reconciliation, depreciation, FX, revenue recognition and intercompany effects.

### 3.7 TEMPORAL INTEGRITY

Finalized historical state cannot be rewritten by a later operation unless a reviewed reversal/amendment mechanism explicitly allows it.

Examples:

- posted invoice lines are immutable;
- closed-period accounting cannot be changed silently;
- manufacturing orders use a defined BOM/routing version rule;
- approved expenses/payroll use a defined input snapshot rule.

### 3.8 APPROVAL_INTEGRITY

An approval applies to exactly the reviewed intent/version/content.

If meaningful content changes after review, the approval must be invalidated or execution must reject the stale approval.

Examples:

- PO amount changes after manager review;
- expense amount changes after approval screen load;
- message recipients or rendered content change after review;
- beneficiary bank details change after payment approval;
- AI action draft parameters change after approval.

### 3.9 SEPARATION_OF_DUTIES

Sensitive actions must enforce configured maker/checker boundaries.

The same actor must not improperly:

- create and approve payment-sensitive changes;
- create and approve message batches;
- create and approve elevated AI drafts;
- request and approve restricted purchasing/expense/workflow actions.

### 3.10 UNIQUENESS

Identifiers whose business meaning implies uniqueness cannot be reused incorrectly.

Examples:

- vendor invoice reference;
- payment provider reference;
- serial number;
- external callback id;
- reconciliation key;
- idempotency key + payload binding.

### 3.11 RECOVERY

Crash, reconnect, timeout, replay and reconstruction must converge on the same canonical business state as uninterrupted execution.

### 3.12 COMMUNICATION

External/provider communication state is monotonic where required, replay safe, identity-bound and consent-safe.

---

## 4. Universal test contract

Every adversarial test should declare:

```text
ID
Invariant(s)
Workflow
Actors
Initial state
Attack
Expected command result
Expected business state
Forbidden state
Required audit/evidence
Layer
Promotion severity
```

Example:

```text
ID: O2C-05
Invariant: IDEMPOTENCY, CONSERVATION
Workflow: Order-to-Cash
Actors: warehouse_a, warehouse_b
Initial: picking READY, qty=10
Attack: validate same picking concurrently twice
Expected: one valid shipment effect
Forbidden: delivered qty=20 or stock decrement twice
Layer: local STDB + Playwright two-session
Severity: P0 blocker
```

Tests must assert invariants rather than an arbitrary winner when concurrency ordering legitimately permits multiple serializable outcomes.

---

## 5. Generated cross-tenant reference sweeper

This is the highest-leverage generic addition.

### 5.1 Goal

Systematically detect reducers/commands that validate the caller organization but fail to validate that referenced records belong to the same authorized scope.

The suite should discover reference-shaped inputs from canonical contract/schema metadata rather than hand-authoring one test per reducer.

Candidate references include:

```text
organization_id
company_id
contact_id
partner_id
product_id
warehouse_id
location_id
sale_order_id
purchase_order_id
invoice_id
payment_id
picking_id
project_id
employee_id
expense_id
subscription_id
workflow_id
```

### 5.2 Fixture

For each supported operation:

1. provision organization A;
2. provision organization B;
3. create equivalent valid fixture records in both;
4. authenticate an actor in A;
5. produce a fully valid A-scoped input;
6. substitute exactly one reference with the equivalent B-owned id;
7. invoke the operation;
8. assert rejection;
9. snapshot A and B relevant state;
10. assert no business-state delta in either organization.

Pseudo-code:

```ts
for (const operation of scopedOperations) {
  for (const ref of operation.referenceInputs) {
    test(`${operation.name} rejects foreign ${ref.name}`, async () => {
      const before = await snapshotRelevantState([orgA, orgB], operation)

      await expect(
        invoke(operation, {
          ...validOrgAInput(operation),
          [ref.name]: foreignFixture(orgB, ref.resource).id,
        }),
      ).rejects.toThrow()

      const after = await snapshotRelevantState([orgA, orgB], operation)
      expect(after).toEqual(before)
    })
  }
}
```

### 5.3 Company-scope variant

Within one organization:

- create company A and company B;
- test all company-scoped references with foreign-company rows;
- reject unless the operation explicitly supports cross-company behavior;
- cross-company exceptions must be declared metadata, not inferred by the test.

### 5.4 Safety

Do not assume every numeric id is a resource reference. The generator must use typed contract/IR metadata or a reviewed mapping.

Unknown reference semantics fail closed into a review queue rather than silently skipping.

---

## 6. Generic rejected-operation zero-delta assertion

Introduce a reusable helper:

```text
assertRejectedWithoutBusinessDelta
```

Conceptually:

```ts
const before = await snapshotBusinessState(scope)
const result = await invokeExpectFailure(action)
const after = await snapshotBusinessState(scope)

expect(result).toBeRejected()
expect(after).toEqual(before)
```

Snapshot scope should include:

- the direct aggregate;
- child records;
- inventory/accounting side effects;
- approval/workflow rows;
- durable commit/change records where applicable;
- audit/event rows where failure recording is intentionally allowed.

Audit/error telemetry may change when the business aggregate does not. Helpers must distinguish allowed operational evidence from forbidden business effects.

---

## 7. Committed-but-response-lost fault matrix

Every economically meaningful mutation must eventually pass three transport outcomes:

### F1 — request never reaches authority

Expected:

- no effect;
- safe retry executes exactly once.

### F2 — authority commits but response is lost

Expected:

- retry does not duplicate the committed effect;
- caller can recover the committed result or an unambiguous equivalent state.

### F3 — retry succeeds and original response arrives late

Expected:

- late response cannot regress current UI/canonical state;
- one economic effect;
- one canonical final state.

Priority operations include:

- sales confirmation;
- stock validation;
- invoice creation/posting;
- payment posting/reversal;
- PO confirmation/receipt;
- vendor bill creation;
- expense posting/reimbursement;
- payroll posting/export intent;
- subscription invoice generation;
- workflow approval;
- AI approved action execution;
- offline ChangeSet application.

---

## 8. Deterministic race harness

Timing sleeps are not sufficient for concurrency certification.

Build/reuse a barrier fixture:

```text
actor A        actor B
prepare        prepare
   \             /
      barrier
         ↓
   release both
```

Both clients should be as close as practical to the authoritative mutation boundary before release.

Assertions must permit valid transaction ordering but forbid contradictory terminal state.

Example:

```text
confirm order  || cancel order
```

Valid:

- confirm wins, cancel rejects;
- cancel wins, confirm rejects.

Forbidden:

```text
order=Cancelled
AND active fulfillment created
AND no explicit corrective transition explains it
```

---

## 9. Model-based state-machine testing

Expand current seeded state-machine tests across core ERP aggregates.

### 9.1 Target aggregates

First wave:

- sale order;
- purchase order;
- stock picking;
- invoice/account move;
- payment transaction.

Second wave:

- manufacturing order;
- expense sheet;
- leave request;
- subscription;
- workflow instance;
- AI action draft.

### 9.2 Generator

Given a known state and action set:

1. randomly choose actions using a deterministic seed;
2. include valid and invalid transitions;
3. execute against real reducers/API where practical;
4. maintain a small reference model of allowable states/invariants;
5. assert the canonical state never leaves the legal model;
6. assert illegal actions produce zero business delta.

Every failure reports:

```text
seed
step
state before
action
arguments
state after
invariant violated
```

### 9.3 State model is not business logic duplication

The test model should encode only reviewed state-transition invariants needed for certification, not reimplement calculation/business logic.

For example, it may know `Cancelled -> Confirm` is invalid without reproducing pricing/tax algorithms.

---

# 10. Order-to-Cash adversarial matrix

Order-to-Cash is the golden workflow and should receive the first complete vertical adversarial certification.

## O2C-01 — duplicate opportunity conversion

**Attack:** two actors convert the same opportunity to a sales order concurrently.

**Assert:**

- exactly one canonical conversion relationship unless explicit multi-order behavior is intended;
- no duplicate customer creation;
- no duplicate order side effects.

## O2C-02 — stale quotation approval

**Attack:** approver opens quotation; another actor changes lines, discounts, customer, currency or total; first actor approves stale content.

**Assert:** stale approval rejects or prior approval version is invalidated.

## O2C-03 — permission revocation mid-flow

**Attack:** actor loads actionable quotation, permission is revoked, actor submits confirm.

**Assert:** current server permission rejects; no fulfillment is created.

## O2C-04 — confirm vs cancel race

**Attack:** simultaneous confirm and cancel.

**Assert:** one serializable result; never cancelled order with unexplained active downstream effects.

## O2C-05 — duplicate picking validation

**Attack:** two clients validate the same picking.

**Assert:** stock decrements once; shipment records once; retry outcome is safe.

## O2C-06 — over-shipment

**Attack:** ship quantity greater than allowed ordered/remaining quantity.

**Assert:** reject unless explicit reviewed over-delivery policy permits it.

## O2C-07 — duplicate invoice creation

**Attack:** simultaneous or retried `create_invoice_from_sale_order` after ambiguous response.

**Assert:** no accidental double customer billing.

## O2C-08 — invoice creation after cancellation

**Attack:** cancel order and invoice from a stale session.

**Assert:** stale invoice creation rejected or explicitly governed by a reviewed exception.

## O2C-09 — over-return

**Attack:** delivered quantity 6; attempt return 7.

**Assert:** rejected; return totals cannot exceed eligible delivered quantity net of prior returns.

## O2C-10 — duplicate return/credit

**Attack:** committed return/credit response lost, action retried.

**Assert:** one inventory return and one economic credit.

## O2C-11 — duplicate exchange

**Attack:** exchange order generation retried or concurrently executed.

**Assert:** one intended replacement order.

## O2C-12 — payment vs invoice cancellation race

**Attack:** payment/reconciliation executes while another actor cancels/reverses invoice.

**Assert:** no impossible paid-and-cancelled state; explicit reversal/unapplied-credit semantics required.

## O2C-13 — customer substitution

**Attack:** change partner/customer after quotation approval or after fulfillment starts.

**Assert:** either forbidden or all approval/credit/tax semantics re-evaluated according to reviewed business rule.

## O2C-14 — price/tax mutation after confirmation

**Attack:** stale edit path mutates confirmed order price/tax fields.

**Assert:** immutable or amendment path only.

## O2C-15 — foreign-resource injection

Substitute foreign organization/company ids for customer, product, warehouse, picking, invoice and payment references.

**Assert:** reject + zero business delta.

---

# 11. Procure-to-Pay adversarial matrix

## P2P-01 — beneficiary mutation after approval

**Attack:** purchase/payment is approved, vendor bank/beneficiary details change before payment execution.

**Assert:** approval cannot silently authorize changed beneficiary details; re-approval or explicit trusted rule required.

## P2P-02 — PO mutation after approval

Change quantity, price, currency, supplier, tax or destination after approval.

**Assert:** approval invalidates or mutation is forbidden.

## P2P-03 — supplier hold after PO confirmation

Supplier is placed on hold before receipt/payment.

**Assert:** configured downstream sensitive actions re-evaluate current supplier state.

## P2P-04 — PO cancel vs receipt race

**Assert:** either cancellation or receipt wins coherently; no cancelled PO with unexplained receipt/stock effect.

## P2P-05 — over-receipt

Attempt to receive beyond ordered/reviewed tolerance.

## P2P-06 — duplicate receipt

Lost response and retry must not double stock.

## P2P-07 — over-billing

Vendor bill quantity/amount exceeds valid received/ordered business rule.

## P2P-08 — duplicate vendor invoice reference

Same supplier + business reference reused.

**Assert:** reviewed uniqueness scope enforced.

## P2P-09 — duplicate bill creation from PO

Concurrent or retried bill creation.

## P2P-10 — same receipt billed twice through different entry paths

One via PO action and one via manual/alternate bill linkage.

**Assert:** matching logic catches duplicate economic claim.

## P2P-11 — landed cost duplicate post/apply

One landed-cost document cannot allocate/post its economic effect twice.

## P2P-12 — over-return

Purchase return exceeds valid received net quantity.

## P2P-13 — excessive vendor credit

Credit exceeds eligible billed/returned amount without reviewed manual-credit semantics.

## P2P-14 — stale RFQ award

Bid changes/withdraws after reviewer loads award decision.

## P2P-15 — foreign-resource injection

Supplier, PO, product, warehouse, bill, account and bank references from foreign scope.

---

# 12. Inventory adversarial matrix

Inventory requires explicit conservation assertions.

Define a scoped stock conservation helper for each relevant product/location/lot/serial aggregate:

```text
starting canonical stock
+ accepted receipts
+ positive explicit adjustments
- accepted deliveries
- accepted consumption
- negative explicit adjustments
= ending canonical stock
```

Transfers move quantity between locations and must preserve organization-level quantity.

## INV-01 — final-unit double reservation

Two orders reserve the last available unit concurrently.

**Assert:** reserved total never exceeds available/reservable quantity.

## INV-02 — serial double reservation

Same serial reserved for two incompatible demands.

## INV-03 — serial double use

Same uniquely tracked serial consumed/delivered twice.

## INV-04 — pick more than reserved

## INV-05 — pack cancelled/unavailable movement

## INV-06 — validate picking after source order cancellation

## INV-07 — cycle count vs outgoing shipment race

Count closes while stock leaves concurrently.

**Assert:** no silent quantity loss/double adjustment; conflict/revision policy explicit.

## INV-08 — inventory adjustment replay

Same adjustment posts twice after lost response.

## INV-09 — replenishment concurrency

Two executions see same shortage and create duplicated procurement/manufacturing demand.

## INV-10 — expired lot after reservation

Lot is valid at reservation but expired/quarantined before shipment.

**Assert:** shipment validation rechecks required current constraints.

## INV-11 — quality failure after reservation

Stock fails QC between reserve and delivery.

## INV-12 — backdated movement into closed inventory period

## INV-13 — invalid warehouse/location company mix

## INV-14 — transfer conservation

Internal transfer cannot change organization-level quantity.

## INV-15 — foreign-resource injection

Product, warehouse, location, lot, serial, picking, move and quality references.

---

# 13. Accounting adversarial matrix

Every test that produces accounting entries asserts balance after commit.

## ACC-01 — duplicate journal post

## ACC-02 — edit vs post race

One actor edits draft lines while another posts.

**Assert:** posted entry represents one coherent version.

## ACC-03 — mutation of posted journal/invoice

Direct or stale edit attempts must fail unless an explicit reversal/amendment path exists.

## ACC-04 — duplicate payment allocation

## ACC-05 — reversal replay

## ACC-06 — reversal vs reconciliation race

## ACC-07 — post to closed period

## ACC-08 — period close vs posting race

The close transaction and concurrent posting must serialize without allowing unreviewed entries into a closed period.

## ACC-09 — same payment reference, different amount

Conflict must not be silently treated as idempotent replay.

## ACC-10 — idempotency key payload mutation

Any stable request key replayed with different economic payload must fail loudly.

## ACC-11 — large-value precision

Exercise values around representation boundaries and many-small-line accumulations.

## ACC-12 — FX snapshot mutation

Changing currency rates after posting must not rewrite posted economics.

## ACC-13 — tax mutation after posting

## ACC-14 — depreciation duplicate recognition

## ACC-15 — asset disposal vs depreciation race

## ACC-16 — duplicate amortization recognition

## ACC-17 — intercompany double processing

## ACC-18 — consolidation repeatability

Re-running a reviewed consolidation step cannot duplicate eliminations/results.

## ACC-19 — bank import conflicting replay

Extend existing statement tests across alternate locale/date formats and payload mutation.

## ACC-20 — foreign-resource injection

Account, journal, partner, invoice, payment, statement, company and asset references.

---

# 14. Manufacturing adversarial matrix

## MFG-01 — BOM version mutation after MO confirmation

Define and enforce whether an MO snapshots BOM/routing inputs or intentionally follows latest version.

## MFG-02 — consume more material than available/reserved

## MFG-03 — same material serial consumed twice

## MFG-04 — duplicate finished serial

## MFG-05 — overproduction

Produce beyond MO quantity/tolerance without explicit policy.

## MFG-06 — finish with failed required QC

## MFG-07 — finish vs cancel race

## MFG-08 — workcenter blocked during active work order

Expected behavior must be explicit: allow active completion, pause, or prevent future start.

## MFG-09 — complete work order twice

## MFG-10 — finish MO with incomplete required operations

## MFG-11 — routing changes after start

## MFG-12 — foreign-resource injection

Product, BOM, workcenter, location, lot/serial and quality references.

---

# 15. Projects / PSA adversarial matrix

## PSA-01 — same timesheet billed twice

## PSA-02 — same milestone billed twice

## PSA-03 — timesheet edited after approval

Approval must be invalidated or edit forbidden.

## PSA-04 — project close with active timer

## PSA-05 — rejected timesheet included in billing

## PSA-06 — expense double rebill

Project expense cannot be both independently billed and project-rebilled unintentionally.

## PSA-07 — rate-card mutation after work performed

Historical billing basis must be explicit/snapshotted.

## PSA-08 — stale change-order approval

## PSA-09 — revenue recognized twice

## PSA-10 — cross-company resource allocation

Reject unless explicitly supported.

---

# 16. Expenses adversarial matrix

## EXP-01 — stale amount approval

Employee submits 100; approver opens; employee changes to 1000; approver submits old approval.

**Assert:** stale approval rejected or prior approval invalidated.

## EXP-02 — self approval

## EXP-03 — duplicate receipt claim

Same receipt/evidence claimed in incompatible expense records.

## EXP-04 — corporate-card line matched twice

## EXP-05 — reimbursement twice

## EXP-06 — reimbursement after refusal/cancellation

## EXP-07 — advance applied twice

## EXP-08 — mileage/per-diem rate mutation after approval

## EXP-09 — approved expense edit before accounting post

## EXP-10 — stale policy exception approval

## EXP-11 — foreign project/employee/account reference

---

# 17. HR and Payroll adversarial matrix

## HR-01 — overlapping leave

Conflicting approved leave intervals must follow explicit policy.

## HR-02 — leave approval after employment ended

## HR-03 — self approval

## HR-04 — employee archived during payroll

## PAYROLL-01 — duplicate payslip for employee/period

## PAYROLL-02 — salary mutation after calculation

Define snapshot/recalculation requirement.

## PAYROLL-03 — contract termination with queued future payroll

## PAYROLL-04 — retroactive mutation of posted payroll inputs

Must not silently rewrite posted economics.

## PAYROLL-05 — payroll export retry

No duplicate external payout intent.

## HR-05 — impossible attendance overlap

## HR-06 — foreign employee/department/company references

---

# 18. Subscription adversarial matrix

Define conservation from usage/contract through invoicing and recognized revenue.

## SUB-01 — duplicate usage event

## SUB-02 — same usage id with changed quantity

Must be a conflict, not idempotent success.

## SUB-03 — late usage after billing close

Explicit adjustment/next-period rule required.

## SUB-04 — cancel vs renew race

## SUB-05 — pause vs invoice race

## SUB-06 — plan price mutation mid-period

Billing basis/version rule must be explicit.

## SUB-07 — recurring invoice duplicate generation

## SUB-08 — out-of-order payment failure/success callback

## SUB-09 — entitlement survives invalid cancellation state

## SUB-10 — deferred revenue recognized twice

## SUB-11 — recognized revenue exceeds valid economic basis

## SUB-12 — foreign plan/customer/company references

---

# 19. Workflow and approval-engine adversarial matrix

## WF-01 — duplicate human-task decision

## WF-02 — simultaneous approvals

## WF-03 — permission revoked after claim

## WF-04 — delegation after task claim

## WF-05 — definition version changes while instance runs

Running instances must obey reviewed versioning semantics.

## WF-06 — duplicate signal

## WF-07 — timer fires twice

## WF-08 — timer vs manual signal race

## WF-09 — migration partial failure

Must remain resumable/rollback-safe according to migration contract.

## WF-10 — approval target changes after task creation

Approval applies to exact reviewed target/version.

## WF-11 — cross-tenant workflow target

## WF-12 — maker/checker bypass through delegation

---

# 20. Documents / compliance adversarial matrix

## DOC-01 — document changes after signature request

Signature must bind a specific immutable version/hash.

## DOC-02 — signed version replacement

## DOC-03 — legal-hold purge

Must be impossible.

## DOC-04 — retention purge vs legal-hold race

## DOC-05 — restore after permission revocation

## DOC-06 — external-drive overwrite conflict

## DOC-07 — attachment switched after approval

Sensitive approval must bind the evidence/version where relevant.

## DOC-08 — cross-tenant attachment

---

# 21. Communications adversarial extension

Keep the existing communications cases and add workflow-level attacks.

## COMM-X1 — recipient set changes after approval

## COMM-X2 — rendered content changes after approval

## COMM-X3 — template changes after approval

## COMM-X4 — phone/identity ownership changes after approval

## COMM-X5 — consent revoked during dispatch window

Review current desired boundary: approval-time only, dispatch-time recheck, or both. The implementation must match the reviewed rule.

## COMM-X6 — duplicate outbound dispatch after timeout

## COMM-X7 — provider callback references foreign intent

## COMM-X8 — provider status regression after terminal state

---

# 22. AI harness adversarial extension

AI must use the same certified ERP actions and cannot become a bypass path.

## AI-01 — model injects organization/company scope

Reject/ignore model-supplied trusted scope according to contract.

## AI-02 — stale action draft approval

Referenced ERP state changes between draft and approval.

## AI-03 — action parameters change after approval

## AI-04 — permission revoked mid-run

## AI-05 — capability removed mid-run

## AI-06 — provider timeout after tool-side commit

No automatic unsafe redispatch.

## AI-07 — duplicate tool call ids / semantic duplicate calls

## AI-08 — untrusted ERP text requests privileged tool use

Content never grants authority.

## AI-09 — final answer asserts action that did not commit

Answer gate must not claim success without durable evidence.

## AI-10 — generated capability foreign-reference attack

The generic tenancy sweeper should eventually exercise agent-exposed inputs too.

---

# 23. Offline ChangeSet adversarial extension

These tests activate only after the offline integration exists.

## OFF-01 — permission revoked while offline

Queued action fails current-policy validation on reconnect.

## OFF-02 — base revision stale

Must surface review/conflict; no blind overwrite.

## OFF-03 — duplicate ChangeSet upload

## OFF-04 — partial batch application

Define atomic grouping policy; never silently mark unapplied actions complete.

## OFF-05 — local foreign-resource injection

Server rejects regardless of local projection contents.

## OFF-06 — reconnect after canonical deletion/archive

## OFF-07 — same intent online and offline concurrently

## OFF-08 — stale approval captured offline

Offline state never preserves authority.

---

# 24. Import/data-ops adversarial extension

Imports are a common way malformed state enters ERPs.

## IMP-01 — duplicate import retry

## IMP-02 — same import idempotency key, altered file

## IMP-03 — cross-tenant identifiers in import rows

## IMP-04 — partial row failure

Explicit atomic/batch semantics required.

## IMP-05 — locale number ambiguity

Test at minimum:

```text
1.234,56
1,234.56
1,234
1.234
```

under the selected locale/import contract.

## IMP-06 — date ambiguity

Explicit format/locale required; no silent DD/MM vs MM/DD reinterpretation.

## IMP-07 — duplicate business keys inside one file

## IMP-08 — rollback after downstream effects

Rollback capability must not claim reversibility where economic downstream effects require explicit reversal.

---

## 25. Business-conservation helpers

Build shared assertion helpers rather than repeating domain arithmetic in Playwright.

Candidate helpers:

```text
assertStockConserved
assertTransferConserved
assertAccountingBalanced
assertInvoicePaymentConserved
assertReceivedBilledConserved
assertDeliveredReturnedConserved
assertUsageRevenueConserved
assertNoDuplicateExternalReference
assertApprovalBindsRevision
```

These helpers should query authoritative/canonical data and return concise diagnostic differences.

Example diagnostic:

```text
INV-07 conservation failed
product=42
location=3
before=10
receipts=0
deliveries=3
adjustments=-1
after=7
expected=6
delta=+1
seed=918331 step=12
```

---

## 26. Test layers

### 26.1 Native pure tests

Use for:

- arithmetic/precision models;
- state-model generation;
- transition tables;
- invariant helper logic;
- payload/reference classification.

### 26.2 In-module/local STDB tests

Use for:

- transaction atomicity;
- concurrency where supported;
- conservation;
- tenant/resource ownership;
- domain state machines;
- exact reducer behavior.

### 26.3 API integration tests

Use for:

- trusted actor/org derivation;
- route admission;
- generated command contract behavior;
- idempotency/retry mapping;
- HTTP lost-response semantics where practical.

### 26.4 Playwright multi-session

Use for:

- stale screen behavior;
- multi-user races;
- approval integrity;
- revoked permission after UI load;
- cross-module workflow navigation;
- latency/offline/reconnect;
- duplicate clicks;
- user-visible recovery.

### 26.5 Reconstruction/replay

For workflows touching durable business state:

- create adversarial scenario;
- converge PG projection;
- reconstruct fresh STDB;
- assert the same final business invariants.

---

## 27. Known-defect handling

Retain the existing strict rule:

- test asserts the correct desired invariant;
- known failure is explicitly registered;
- known failure unexpectedly passing fails until removed from registry;
- fixture/setup failures are never swallowed;
- no unconditional skips;
- capability-gated tests name the exact missing prerequisite.

Each known defect should carry:

```text
id
first_seen
workflow
invariant
severity
owner/follow-up issue or PR
expected remediation boundary
```

Do not downgrade a P0 invariant failure merely to keep CI green.

---

## 28. Severity model

### P0 — production blocker

Examples:

- cross-tenant mutation/read;
- duplicate money/stock effect;
- unbalanced ledger;
- stale approval authorizes changed economic intent;
- unauthorized execution after permission revocation;
- legal-hold destruction;
- unrecoverable canonical/durable divergence.

### P1 — pilot blocker unless explicitly scoped out

Examples:

- missing idempotent response recovery while effect remains single;
- workflow dead-end requiring admin repair;
- incorrect close/reopen sequencing;
- user-visible stale state that cannot corrupt canonical state but creates high operational risk.

### P2 — production hardening

Examples:

- diagnostic/audit insufficiency;
- non-destructive confusing error semantics;
- low-risk operational ergonomics.

---

## 29. Initial implementation wave

Implement in this order.

### ADV-00 — shared invariant harness

Deliver:

- invariant taxonomy constants/types;
- zero-business-delta snapshot helper;
- deterministic barrier/race helper;
- lost-response fault fixture;
- conservation diagnostics conventions;
- shared case metadata/known-defect integration.

### ADV-01 — generated tenant/reference sweeper foundation

Start with a reviewed set of high-risk operations across CRM/Sales/Inventory/Purchasing/Accounting.

Do not block on perfect automatic reference discovery. A generated+reviewed manifest is acceptable as the first slice.

### ADV-02 — Order-to-Cash vertical certification

Minimum P0 cases:

- O2C-02 stale quotation approval;
- O2C-04 confirm/cancel race;
- O2C-05 duplicate picking validation;
- O2C-06 over-shipment;
- O2C-07 duplicate invoice;
- O2C-09 duplicate credit;
- O2C-12 payment/cancel race;
- O2C-15 foreign references.

### ADV-03 — Procure-to-Pay vertical certification

Minimum P0 cases:

- P2P-01 beneficiary mutation;
- P2P-02 PO mutation after approval;
- P2P-04 cancel/receipt race;
- P2P-06 duplicate receipt;
- P2P-08 duplicate vendor invoice reference;
- P2P-09 duplicate bill;
- P2P-10 receipt billed twice;
- P2P-15 foreign references.

### ADV-04 — Inventory conservation and serial concurrency

### ADV-05 — Accounting period-close/post and payment/reversal races

### ADV-06 — generic stale-approval framework

Apply to purchasing, expenses, workflow tasks, messages and AI drafts.

### ADV-07 — generic fault-injection retry matrix

### ADV-08 — model-based state machines for SaleOrder, PurchaseOrder, Picking, AccountMove and Payment

---

## 30. Relationship to workflow integration stack

Adversarial tests should activate as the workflow integration PRs make capabilities reachable.

Suggested dependency shape:

```text
PR #38 / INT-PLAN
        │
        ├── adversarial plan (this document)
        │
        └── INT-00 workflow primitives
                 │
                 ├── INT-01..INT-08 Order-to-Cash
                 │        └── ADV-02 O2C certification
                 │
                 └── INT-10..INT-18 Procure-to-Pay
                          └── ADV-03 P2P certification
```

ADV-00/ADV-01 can begin before workflow UI integration completes because they target backend/contract invariants.

Vertical Playwright certification should stack after the corresponding workflow is user-reachable.

---

## 31. CI strategy

Keep layers explicit.

### Blocking on every PR

- pure invariant helper tests;
- native/domain tests touched by the change;
- generated tenancy/reference contract verification when relevant;
- deterministic small-seed state machine set.

### Required before vertical workflow promotion

- full local STDB vertical invariant suite;
- focused Playwright workflow adversarial suite;
- committed-response-lost retry cases;
- two-session permission/approval races;
- reconstruction/replay check for durable workflows.

### Nightly / scheduled

- broader deterministic seed corpus;
- higher concurrency counts;
- larger monetary/value boundary matrices;
- full cross-tenant reference sweep;
- responsive/mobile/offline variants;
- long-running workflow/timer cases.

Any nightly P0 violation blocks promotion/release even if the test is not executed on every commit.

---

## 32. Promotion gates

### Gate A — Order-to-Cash certified

Required:

- no unresolved P0 O2C invariant failures;
- quantity conservation passes;
- duplicate invoice/payment/return effects impossible;
- stale permission and stale approval cases pass;
- cross-tenant reference sweep passes for the O2C operation set;
- committed-response-lost retries converge;
- Playwright two-session vertical certification passes.

### Gate B — Procure-to-Pay certified

Required:

- no unresolved P0 P2P failures;
- supplier/payment beneficiary approval integrity proven;
- receipt/bill quantity conservation passes;
- duplicate receipt/bill/payment effects impossible;
- cross-tenant reference sweep passes;
- Playwright vertical certification passes.

### Gate C — core ERP pilot certified

Requires Gate A + Gate B plus:

- Inventory conservation core;
- Accounting balance/close core;
- adversarial reconstruction/recovery;
- all pre-tenant P0 tenancy/idempotency/money defects closed for pilot scope.

### Gate D — AI exposure

An agent capability may mutate a workflow only after the underlying human workflow passes its production invariant gate.

### Gate E — offline exposure

An offline ChangeSet operation may be enabled only after the same canonical online workflow is certified for idempotency, stale-state behavior and permission re-evaluation.

---

## 33. Non-goals

This program does not:

- attempt exhaustive mathematical verification of all ERP logic;
- replace real-tenant pilots;
- encode duplicate frontend business engines;
- require every backend operation to become user-facing;
- assume every race has one predetermined winner;
- hide known defects behind flaky timing retries;
- use fuzzing as a substitute for reviewed invariants;
- make AI/offline semantics special cases.

---

## 34. Definition of done for an adversarial case

A test case is complete only when:

- [ ] invariant is named;
- [ ] initial state is deterministic;
- [ ] actors/scopes are explicit;
- [ ] attack is reproducible;
- [ ] success/failure semantics are explicit;
- [ ] forbidden resulting state is asserted;
- [ ] relevant business side effects are checked;
- [ ] rejected-operation zero-delta is checked when applicable;
- [ ] audit/evidence expectations are checked where relevant;
- [ ] seed/step diagnostics exist for generated cases;
- [ ] known-defect registration is explicit if currently failing;
- [ ] test automatically becomes promotion-blocking when defect is fixed;
- [ ] no timing-only sleeps are required for correctness;
- [ ] tenant/company variants exist where scope applies;
- [ ] reconstruction/recovery variant exists for durable P0 workflows where required.

---

## 35. Immediate next action

After this plan is accepted, implement `ADV-00` as the first code PR:

1. shared invariant-case metadata;
2. business snapshot + zero-delta assertion;
3. deterministic concurrency barrier;
4. committed-response-lost fault fixture;
5. conservation diagnostic result type;
6. known-defect integration;
7. a small proof set using one Sales, one Inventory, one Accounting and one Purchasing operation.

Then implement `ADV-01` tenancy/reference sweeping before expanding vertical O2C/P2P tests.

The objective is to turn failures such as the previously discovered cross-tenant messaging bug from isolated regressions into **classes of impossible-to-promote defects** across the ERP.
