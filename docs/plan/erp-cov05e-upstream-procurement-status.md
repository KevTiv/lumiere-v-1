# COV-05e Upstream procurement

**Disposition:** `IMPLEMENTED` — runtime acceptance pending
**Operator proof:** `frontend/web/tests/e2e/cov05e-upstream-procurement.spec.ts`

## Bounded path

Purchasing requester submits a supplier intake. A different authenticated
approver selects an existing vendor and approves the request. The requester
creates a line-bearing requisition for that vendor and submits it. The
independent approver approves the requisition. Purchasing then either converts
it directly to a PO or creates a linked RFQ, adds a vendor bid and awards it to
produce a PO. The browser checks the exact producer-owned PO relation, related
vendor, product, UoM and quantity, navigation and reload persistence.

## Changes

- Supplier approval collects a scoped vendor choice instead of dispatching an
  empty `partner_id` from an unlinked intake.
- Approval readback checks the selected vendor relation as well as state.
- Supplier submitters and requisition requesters/creators cannot approve their
  own requests, including callers with approval permission.
- Empty requisitions cannot be submitted. Approval audit records say
  `Approved`, matching the persisted state.
- RFQ requisition selectors show approved requests. Bid creation can select
  an open RFQ before it has any bids; award selectors require submitted bids.
- Governed supplier-intake and requisition create forms are provisioned through
  the existing organization form seed, preserving existing configurations.

## Evidence and limits

The browser spec contains two complete UI paths with separate requester,
approver and reader sessions. It checks requester self-approval rejection,
stale approval rejection, reader denial, canonical PO links and line readback.
Positive business transitions use the UI; direct HTTP requests are used only
for replay/authorization assertions and canonical reads.

The in-module Purchasing tests add self-approval/no-effect and stale-approval
checks. Their single-context harness seeds a distinct requester identity for
positive approval; this does not replace the two-session browser proof.

Local workflow unit tests, web typecheck and native module compile checks are
run separately from runtime acceptance. The Docker socket is inaccessible in
this workspace, so neither the in-module reducer tests nor the two new browser
paths have executed against a disposable ERP stack. Do not mark this package
`ACCEPTED` from compile checks or Playwright discovery.

This links intake to an existing vendor; it does not certify new vendor master
creation, approval delegation/workflow-engine policy, incoming receipt/billing
exceptions, or full Purchasing U5 admission. RFQ line entry remains explicit;
automatic copying of all approved requisition lines is outside this slice.

## Runtime gate

```sh
make e2e-docker E2E_SPEC_FILES="cov05e-upstream-procurement.spec.ts cov05d-rfq-award.spec.ts cov05-purchase-order-confirmation.spec.ts"
```

Use a disposable stack and publish this module before running the gate. For an
existing test organization, run `seed_organization_form_configs` through the
authorized seed path to provision the two newly governed forms.
