# COV-08 through COV-27 stacked acceptance plan

Each remaining track is split into bounded PRs. Every PR must carry its own
status page with the contract disposition, D/A/O/E proof, stale/retry and denial
effect preservation, and an explicit accepted or pending statement. A track is
not promoted to U5 merely because one bounded slice is accepted.

## Required PR completion card

1. **Boundary:** one named operator transition and its canonical effect.
2. **Contract:** generated diff committed and released when shapes change; an
   empty generated diff recorded when existing contracts are sufficient.
3. **D:** persisted domain invariant, including money/balance rules where
   applicable.
4. **A:** authenticated generated operation proof with tenant/company scope.
5. **O:** visible operator transition through the product surface.
6. **E:** exact stable-key readback; ambiguity fails closed.
7. **Adversarial:** stale/retry and read-only denial preserve the effect set.
8. **Statement:** `ACCEPTED` only with same-head runtime evidence; otherwise
   `IMPLEMENTED — runtime acceptance pending`, with the missing artifact named.

## Ordered bounded targets

| Track | First bounded PR target | Contract and proof obligation |
| --- | --- | --- |
| COV-08 Finance | 08a invoice/payment reconcile; then bank rec, close/statements, assets, certification | Balance, money, closed-period, replay and company scope. |
| COV-09 HR / Payroll | employee contract to leave/time/pay transition | Sensitive scope, stale approval and separation of duties. |
| COV-10 Projects | approved timesheet or milestone to canonical billing/cost handoff | Exact project/task/time relation and downstream accounting identity. |
| COV-11 Expenses | receipt-backed expense submit, approve, post and reimburse | Attachment identity, self-approval denial and duplicate reimbursement prevention. |
| COV-12 Subscriptions | one recurring invoice run | Scheduler/retry cannot double bill; exact subscription-to-invoice link. |
| COV-13 POS | one session order, payment and close | Duplicate submission protection plus stock/accounting convergence. |
| COV-14 Helpdesk | assign, resolve, close and reopen one ticket | Role visibility, stale state denial and linked activity history. |
| COV-15 Fleet | vehicle/driver service-cost lifecycle | Canonical employee/finance links and cross-company denial. |
| COV-16 IoT | device association, alert and acknowledge | Owned-device scope, stale alert denial and explicit telemetry degradation. |
| COV-17 Proposals | versioned review to canonical conversion | Exact source document, reviewer authorization and stale version rejection. |
| COV-18 Documents | upload, version, attach and archive one document | Blob/version identity, record linkage, access and retention behavior. |
| COV-19 Calendar / Comms | record-linked activity or message lifecycle | Recipient identity, consent, provider status and canonical backlink. |
| COV-20 Reports | configure, execute, drill and export one report | Deterministic totals, scope, malformed inputs and export provenance. |
| COV-21 Approvals | one evidence-backed approval decision | Authorization, separation of duties, stale decision and audit identity. |
| COV-22 Imports / Forms | validate, preview and idempotently commit one import | Hash/idempotency, locale/date semantics, malformed-input bounds and generated contracts. |
| COV-23 Org / Settings / Auth | membership/role change and session recovery | Privilege escalation, revocation and company-switch proof. |
| COV-24 Distributor | order through delivery/collection exception workspace | Canonical CRM/Sales/Inventory/Finance records without shadow state. |
| COV-25 Cross-module | close one missing downstream record link per PR | Direct navigation and shared document/activity/audit context. |
| COV-26 UX / Accessibility | one module quality pass per PR | Loading, empty, error, denied, keyboard, focus, viewport and reconnect evidence. |
| COV-27 Certification | seeded all-module launch manifest and ratchets | Every exposed module U5, no unclassified operation or visible stub, required suites green. |

## Stack rule

Each draft PR is based on the preceding bounded branch. Its status page names
that base and reports evidence only for its own head. A downstream green run
does not rewrite an upstream status unless the upstream branch receives the
same fix and reruns its required proof.
