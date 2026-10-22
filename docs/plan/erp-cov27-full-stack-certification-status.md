# COV-27 — Seeded all-module launch manifest and ratchets

**Status:** CERTIFICATION BLOCKED — deterministic launch ratchet implemented
**Module/surface:** Certification  
**Plan target:** launch manifest  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: all T0 modules

Existing operations (already reachable from the frontend command layer):

- none (composition/system-wide track)

Canonical resources: n/a

## Effect contract

All-module seeded golden paths + adversarial suite green; no unclassified enabled operation; no visible stub.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** none (aggregates earlier releases)

## System-wide launch-manifest ratchet (2026-10-13)

The existing workforce manifest has been promoted in place to the single COV-27
machine-readable authority at
`docs/evidence/cov27-workforce-launch-manifest.json`; no parallel manifest was
created. It now contains exactly the COV-03 through COV-24 module denominator
from COV-00D and is validated by
`scripts/validate-cov27-launch-manifest.py` against:

- COV-00D module identity, surface ownership, D/A/O/E, and U-level;
- the COV-00B product-surface catalog and first-org exposure state;
- the COV-00A operation census, including every reachable UI operation; and
- checked-in module source markers for visible stub paths.

The ratchet fails closed for a missing/duplicate target, a route absent from the
catalog or source tree, an enabled operation without ownership/disposition, an
unclassified or stale visible-stub marker, an exposed module not admitted by the
manifest, or an `admitted` module without authoritative U5 D/A/O/E evidence. A
`runtime-pending` gate is also rejected while COV-00D remains below U5, avoiding
the false promotion of an evidence-incomplete module.

No module is currently admitted: 21 are classified `evidence-incomplete`, and
HR/Payroll is `blocked-by-visible-stubs` for the exact visible unavailable STP action.
All catalog entries remain REVIEW/fail-closed. This is an honest certification
asset, not a U5 claim or an exposure change.

## Earlier workforce slice (superseded by the system-wide manifest)

**State:** IMPLEMENTED LOCALLY / RUNTIME PENDING. The scoped machine-readable
manifest is `docs/evidence/cov27-workforce-launch-manifest.json`. It binds the
HR/Payroll, Projects/Tasks, and Expenses operator lifecycle specs to their COV-26
quality matrix and names each canonical commercial/accounting effect. Local web
typecheck, 13 shared query-state/UI tests, and Playwright discovery passed. No
generated contract file changed.

That earlier slice recorded local implementation progress for Projects/Tasks and
Expenses. It did not provide authoritative U5 evidence. HR's placeholder
submission was subsequently removed, but the fail-closed STP action remains
visible as unavailable and is therefore still explicitly blocked by the
system-wide no-visible-stub ratchet. The action now dispatches no intent. Native
processing no longer synthesizes a provider result: an unconfigured attempt
persists `failed`, while `sent` or `applied` requires a non-empty canonical
provider reference. A focused native test covers unavailable, rejected
reference-free success, unchanged failure state, and exact provider-result
recovery; execution remains pending because this workspace has no Rust
toolchain. The earlier slice did not, and the current manifest does not, promote
COV-27 or any module to U5.

## Prerequisites / decisions

COV-02..26, BASE-05.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `n/a` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
