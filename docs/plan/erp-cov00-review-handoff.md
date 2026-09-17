# COV-00 review handoff

**State:** REVIEW  
**Evidence:** [`erp-cov00-current-module-matrix.md`](./erp-cov00-current-module-matrix.md)  
**Audited base:** `afa23b702fc4c47623697d2fcb81733f2dd71c14`

This handoff exists because COV-00 must not be marked ACCEPTED while the operation census and first-test-org exposure denominator remain incomplete.

## Closure cards

### COV-00A — current operation census

Owner: audit/codegen metadata only.

- regenerate reducer/operation coverage from the accepted current contracts/main revision;
- reconcile reducer rows with the full application-IR operation set;
- classify every user-facing/admin/import operation as `primary-workflow`, `secondary-advanced`, `horizontal`, `internal-support`, `future-disabled`, or `obsolete/duplicate`;
- assign each to a COV/admin/AI/internal owner;
- remove `needs-triage` and `uncategorized` ownership from the accepted census;
- add a CI/source ratchet preventing new unclassified user-facing operations.

Do not create UI merely to make a command look reachable.

### COV-00B — first-org exposure manifest

Owner: product/navigation/config audit only.

- enumerate sidebar, command-palette and direct route exposure;
- classify each route as T0 business, T0 horizontal, administrative, AI, internal/developer, or retired/duplicate;
- record role/capability requirements and hidden reasons;
- ensure AI/forensics/presentation-preview/trackers are not accidentally included in the T0 denominator;
- decide whether `/map` is the canonical Fleet workspace or whether Fleet receives its own route;
- provide one machine-checkable/readable launch denominator for COV-27.

## Coordinator acceptance

COV-00 can move from REVIEW to ACCEPTED when COV-00A and COV-00B are integrated and the coordinator can answer both questions without source archaeology:

1. Is every current operation intentionally owned and exposed/not exposed?
2. Is every first-test-org route intentionally admitted and tied to a COV/admin gate?

No runtime feature work is required to close these two cards unless the audit discovers accidental exposure that must be contained.
