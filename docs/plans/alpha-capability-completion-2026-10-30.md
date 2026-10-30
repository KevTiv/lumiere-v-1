# Alpha capability completion

Started 2026-10-30 from main `fbb9a6b56b9a93bce4cd105b85f9099b6dff87a0`.
The user authorized implementation with subagents. This register tracks code,
checks, and acceptance separately. Previous production success at `51dc5486`
does not certify these new changes or the later main revision.

## Ownership and scope

| Packet | Owner | Implementation scope | Current state |
| --- | --- | --- | --- |
| H1 | accounting_completion | Correct invoice defaults, eligibility and provenance; preserve explicit stale choices; existing trusted-history coverage | Implemented; integrated checks pending |
| H2 | creation_completion | Atomic native custom fields for CRM, quotation, purchase order and Accounting creation; scoped durable creation receipts and uncertain-save recovery | Implemented; integrated checks pending |
| H3 | expenses_completion | Authorized saved allocation readback and retained edits; validated employee/currency inputs | Implemented; integrated checks pending |
| H4 | billing_completion | Exact closure/renewal evidence; idempotent renewal and readback through existing amendment owner | Implemented; integrated checks pending |
| H5a | documents_completion | Authoritative retention preview; recipient exclusions and actual provider delivery receipts | Implemented; integrated checks pending |
| H5b | assistant_completion | Existing independent-review guide adapter, source freshness and bounded contextual error help | Implemented; integrated checks pending |
| Integration | coordinator | Shared projections, registries/codegen, contract release, translations, test registration, independent review and PR evidence | Implemented; integrated checks pending |

Each owner uses a separate worktree. Shared generated artifacts and immutable
contract versions are integrated once by the coordinator. Domain code remains
with its canonical transaction, authorization, evidence and receipt owner.

## Reconciled dependencies

- Open PR #328 owns general-journal import readiness. This work does not replace it.
- Open #325/#326 own legacy skill discovery and form-proposal decoding.
- Open #312/#313 own wider translation coverage; new keys here remain localized.
- Open #251 owns WhatsApp provider changes; this packet only reads existing evidence.
- Main already contains #318–#323 and #327. Their accepted work is preserved.
- H2 also covers an additional Accounting create-then-patch custom-field path
  found during implementation. The initial handoff only named commercial paths.

## Acceptance boundaries

Known unsupported capabilities remain explicit: no contractual subscription end
date is stored by the current native model; a next-invoice date is not an end
date. A new term policy is outside this packet. Notebook account sync/execution
and optional integration activation remain deferred.

No real purge, provider send/charge, or production financial write is authorized
by a local test. Use isolated fixtures and actual service evidence for economic
effects. Independent accountant/device acceptance remains outstanding until a
human reviewer completes it against the served candidate.

## Completion evidence

Record each integrated commit, tests, contract version, PR and unresolved case
here before describing the packet as complete. An implementation or synthetic
test pass is not deployment, production financial acceptance or human review.


## Integration checkpoint

Current main through `5956b38b` (including #328 journal import readiness) is
integrated. Independent owners reviewed each other's native transaction,
permission, receipt and stale-context boundaries. Production is unchanged.

The wave includes Accounting atomic custom fields, saved allocation CAS,
creation/renewal recovery, reviewed purge, canonical exclusion/provider evidence,
source-authorized guide review, and scoped Purchasing discrepancy/currency views.
Native fixture currencies now use actual organization-owned currency identities;
no FX rule or financial assertion was relaxed to accommodate sentinel IDs.

A private `record_creation_receipt` is the single new durable table. The strict
census remains exact: 524 tables, all organization owned, with five existing
persistence protocol relations. Migration 30 is pending generation; released
migration 29 and prior checksums remain unchanged. The established release
workflow allocates and pins the next immutable contract version.

The preliminary local module passed configured creation, Accounting,
Documents, Messaging and guide lifecycle runtime calls. Expense and subscription
runtime tests exposed fixture currency sentinels; fixes require a fresh final
module and rerun. These preliminary results are not final-source acceptance.
Initial simultaneous local native/WASM builds exceeded memory; a serialized
unoptimized schema build succeeded. Hosted canonical builds remain required.

Known limits: Lead records retain their existing organization-shared schema,
while operating-company admission, custom values and recovery receipts are exact.
Trusted history covers explicit journal-line updates/additions; deletions,
automatic lines and broader economic correction/history families remain excluded.
Contractual subscription end dates, a trusted product/workflow guide compatibility
registry, Notebook account sync/execution and optional provider activation remain
outside this wave. English-alpha behavior is the target; new common recovery keys
use explicit English fallback in partial locale packs where translations are not
supplied. Independent accountant/device and served-release acceptance remain open.
