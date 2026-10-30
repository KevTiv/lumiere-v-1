# Alpha capability completion

Started 2026-10-30 from main `fbb9a6b56b9a93bce4cd105b85f9099b6dff87a0`.
The user authorized implementation with subagents. This register tracks code,
checks, and acceptance separately. Previous production success at `51dc5486`
does not certify these new changes or the later main revision.

## Ownership and scope

| Packet | Owner | Implementation scope | Initial state |
| --- | --- | --- | --- |
| H1 | accounting_completion | Correct invoice defaults, eligibility and provenance; preserve explicit stale choices; existing trusted-history coverage | Implementing |
| H2 | creation_completion | Atomic native custom fields for CRM, quotation, purchase order and Accounting creation; scoped durable creation receipts and uncertain-save recovery | Implementing |
| H3 | expenses_completion | Authorized saved allocation readback and retained edits; validated employee/currency inputs | Implementing |
| H4 | billing_completion | Exact closure/renewal evidence; idempotent renewal and readback through existing amendment owner | Implementing |
| H5a | documents_completion | Authoritative retention preview; recipient exclusions and actual provider delivery receipts | Implementing |
| H5b | assistant_completion | Existing independent-review guide adapter, source freshness and bounded contextual error help | Implementing |
| Integration | coordinator | Shared projections, registries/codegen, contract release, translations, test registration, independent review and PR evidence | Implementing |

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
