# COV-00 ledger status

**Package:** `COV-00`  
**Status:** `REVIEW`  
**Audited base:** `afa23b702fc4c47623697d2fcb81733f2dd71c14`  
**Primary evidence:** [`erp-cov00-current-module-matrix.md`](./erp-cov00-current-module-matrix.md)  
**Closure handoff:** [`erp-cov00-review-handoff.md`](./erp-cov00-review-handoff.md)

The source/module census is complete enough to re-baseline the COV program and assign bounded follow-up work, but not to mark COV-00 accepted.

Acceptance remains blocked on:

- `COV-00A`: regenerate/reconcile the current operation census against the accepted application IR, resolve all triage/unowned rows, and add a classification ratchet;
- `COV-00B`: establish the authoritative first-test-org route/navigation exposure manifest and settle Fleet `/map` ownership.

After those two audit-only cards are integrated and reviewed, update the main parity ledger row to `ACCEPTED` with the exact evidence revision. No module feature implementation is required merely to change this audit status.
