# COV-05g Quantity exception recovery

**Disposition:** `IMPLEMENTED` — bounded operator guidance; acceptance deferred.

The Purchasing line table explains the next step for quantity exceptions and
links the exact purchase order, whose Handoffs tab owns canonical bill/receipt
navigation. Over-billed lines offer **Receive missing goods** only when billed
quantity remains within the ordered quantity, the line is confirmed and its
exact PO is in Purchase state. The action reads the current query row and opens
the existing receipt form with the exact line and missing quantity prefilled.
The operator must confirm physical arrival and provide lot information where
required. Submission uses the existing canonical receipt workflow, permissions,
stock effects and readback; no receipt is dispatched merely by reviewing a line.

Over-order billing, over-receipts and invalid economic data require review.
Billing corrections remain Accounting work; existing Purchasing return actions
remain the receipt correction path. Quantities are read from current fields
using the PO's configured quantity tolerance instead of stale metadata badges.
Missing/non-finite/negative values show Unavailable rather than Matched. Quantity
alignment does not assert bill price, provenance, posting or payment acceptance.

## Evidence

Six recovery tests and ten existing Purchasing gate/form tests passed; the web
TypeScript check and committed diff whitespace check passed. Playwright discovery
found the three procure-to-pay scenarios plus authentication setup; none ran.

The recovery tests cover bounded quantity recovery, forbidden over-order recovery,
inactive/missing/unrelated parents, invalid values, stale metadata and custom
quantity tolerance, and alternate field casing. The existing over-billed browser
scenario now selects the new action, checks prefilled line/quantity and the
physical-arrival notice, recovers through the receipt form, then posts the same
canonical bill after match convergence. Its synthetic over-billing setup remains
a direct test reducer invocation; this is not a new fully operator-created price
variance journey.

Full acceptance remains deferred. Run the focused browser scenario in
`mvp-procure-to-pay.spec.ts` after disposable-stack publish, including the existing
rejected-post Draft-state assertion, match/reload convergence and exact bill
posting. Additional combined-stack checks must cover reader permissions,
concurrent changes and lot-tracked receipts. The receipt reducer remains the
final validator if data changes while the form is open.

## Remaining gap

This closes the bounded quantity-guidance/receipt recovery UI. Bill-line economic
correction and price-variance recovery require the canonical correction contract
and integration with the separate provenance/partial-billing work in PR #178.
No duplicate Accounting mutation, guessed bill-line relationship, tolerance
widening, or new source authority was added. Full three-way-match acceptance is
still open.
