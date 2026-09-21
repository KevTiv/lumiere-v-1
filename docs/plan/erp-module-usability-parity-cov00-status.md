# COV-00 ledger status

**Package:** `COV-00`  
**Status:** `REVIEW`  
**Audited base:** `afa23b702fc4c47623697d2fcb81733f2dd71c14`  
**Primary evidence:** [`erp-cov00-current-module-matrix.md`](./erp-cov00-current-module-matrix.md)  
**Correctness/evidence register:** [`erp-cov00-correctness-evidence-defect-register.md`](./erp-cov00-correctness-evidence-defect-register.md)  
**Closure handoff:** [`erp-cov00-review-handoff.md`](./erp-cov00-review-handoff.md)

The source/module census is complete enough to re-baseline the COV program and assign bounded follow-up work, but not to mark COV-00 accepted.

Acceptance is now blocked on four closure cards:

- `COV-00A`: regenerate/reconcile the current operation census against the accepted application IR, resolve all triage/unowned rows, and add a classification ratchet;
- `COV-00B`: establish the authoritative first-test-org route/navigation exposure manifest and settle Fleet `/map` ownership;
- `COV-00C`: complete the current-tree correctness defect census for false success, heuristic/latest-row effect correlation, ambiguous empty/error reads, degraded form/config submission, analytics truthfulness/completeness and semantic outcome overclaim; assign every finding to a downstream owner/gate;
- `COV-00D`: calibrate primary-lifecycle evidence across `D/A/O/E` (domain invariant / API integration / operator transition / exact effect+recovery), so direct-BFF browser setup and heuristic readback cannot be counted as stronger proof than they provide.

Known current-tree findings that must remain explicit until owned include:

- FormModal can close/toast success when no submit handler performed a save;
- AI action-draft persistence resolves the newest pending draft by reducer/highest id;
- `AllowEmpty` query helpers can collapse denied/unavailable/error into `[]`;
- RuntimeFormModal can fall back to static config and continue submission after runtime-config failure;
- stored-dashboard invalid filters/unknown operators/missing timestamp or measure semantics can broaden or distort results;
- multiple browser lifecycle suites prove principal transitions through BFF helpers rather than the operator UI;
- certification helpers that choose newest/highest ids weaken exact-effect evidence;
- the COV-01 prototype must not call an observed post-read authoritative `Applied` unless the invocation disposition is actually proven.

After COV-00A..D are integrated and reviewed, update the main parity ledger row to `ACCEPTED` with the exact evidence revision. Runtime fixes discovered by COV-00C are not required merely to close the census, but they remain blockers for the affected module's U4/U5 promotion and COV-27 launch admission.
