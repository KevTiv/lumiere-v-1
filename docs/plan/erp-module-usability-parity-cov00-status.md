# COV-00 ledger status

**Package:** `COV-00`  
**Status:** `REVIEW`  
**Audited base:** `afa23b702fc4c47623697d2fcb81733f2dd71c14`  
**Primary evidence:** [`erp-cov00-current-module-matrix.md`](./erp-cov00-current-module-matrix.md)  
**Correctness/evidence register:** [`erp-cov00-correctness-evidence-defect-register.md`](./erp-cov00-correctness-evidence-defect-register.md)  
**COV-00C machine census:** [`../evidence/cov-00c-correctness-defects.json`](../evidence/cov-00c-correctness-defects.json)
**Closure handoff:** [`erp-cov00-review-handoff.md`](./erp-cov00-review-handoff.md)

The source/module census plus COV-00A/B/C acceptance candidates are integrated, but COV-00 cannot be marked accepted until COV-00D and coordinator review are complete.

Closure-card disposition:

- `COV-00A`: integrated acceptance candidate with zero unowned/review-required client-facing operations and a source ratchet;
- `COV-00B`: integrated acceptance candidate with one first-org route/navigation authority and explicit Fleet ownership;
- `COV-00C`: integrated acceptance candidate with an 11-class owned defect manifest and narrow source ratchets; open runtime rows remain downstream launch blockers;
- `COV-00D`: calibrate primary-lifecycle evidence across `D/A/O/E` (domain invariant / API integration / operator transition / exact effect+recovery), so direct-BFF browser setup and heuristic readback cannot be counted as stronger proof than they provide.

Current runtime disposition after ownership classification:

- FormModal missing-handler false success is repaired and guarded;
- AI action-draft persistence resolves the newest pending draft by reducer/highest id;
- `AllowEmpty` query helpers can collapse denied/unavailable/error into `[]`;
- RuntimeFormModal can fall back to static config and continue submission after runtime-config failure;
- stored-dashboard invalid filters/unknown operators/missing timestamp or measure semantics can broaden or distort results;
- multiple browser lifecycle suites prove principal transitions through BFF helpers rather than the operator UI;
- certification helpers that choose newest/highest ids weaken exact-effect evidence;
- the COV-01 reference vocabulary now calls exact post-read `converged`, not authoritative `Applied`; broader action migration remains open.

After COV-00A..D are integrated and reviewed, update the main parity ledger row to `ACCEPTED` with the exact evidence revision. Runtime fixes discovered by COV-00C are not required merely to close the census, but they remain blockers for the affected module's U4/U5 promotion and COV-27 launch admission.
