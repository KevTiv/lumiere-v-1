# COV-00 ledger status

**Package:** `COV-00`  
**Status:** `ACCEPTED`
**Accepted evidence revision:** `4f797db650ae82318ab0f477670d14aee9d5d0cd`
**Primary evidence:** [`erp-cov00-current-module-matrix.md`](./erp-cov00-current-module-matrix.md)  
**Correctness/evidence register:** [`erp-cov00-correctness-evidence-defect-register.md`](./erp-cov00-correctness-evidence-defect-register.md)  
**COV-00C machine census:** [`../evidence/cov-00c-correctness-defects.json`](../evidence/cov-00c-correctness-defects.json)
**COV-00D evidence matrix:** [`../evidence/cov-00d-lifecycle-evidence.json`](../evidence/cov-00d-lifecycle-evidence.json)
**Closure handoff:** [`erp-cov00-review-handoff.md`](./erp-cov00-review-handoff.md)
**Coordinator acceptance:** [`erp-cov00-coordinator-acceptance.md`](./erp-cov00-coordinator-acceptance.md)

The source/module census plus COV-00A/B/C/D were reconciled on the accepted evidence revision. COV-00 is accepted as an audit/classification package; this does not close its downstream runtime findings or certify any module for U4/U5 or first-org admission.

Closure-card disposition:

- `COV-00A`: accepted with zero unowned/review-required client-facing operations and a source ratchet;
- `COV-00B`: accepted with one first-org route/navigation authority and explicit Fleet ownership;
- `COV-00C`: accepted as an 11-class owned defect census with narrow source ratchets; open runtime rows remain downstream launch blockers;
- `COV-00D`: accepted with all 22 COV-03..24 owners scored independently across `D/A/O/E`, direct-BFF/latest-helper overclaims rejected, and promotion/admission tied to complete applicable evidence.

Current runtime disposition after ownership classification:

- FormModal missing-handler false success is repaired and guarded;
- AI action-draft persistence resolves the newest pending draft by reducer/highest id;
- `AllowEmpty` query helpers can collapse denied/unavailable/error into `[]`;
- RuntimeFormModal can fall back to static config and continue submission after runtime-config failure;
- stored-dashboard invalid filters/unknown operators/missing timestamp or measure semantics can broaden or distort results;
- multiple browser lifecycle suites prove principal transitions through BFF helpers rather than the operator UI;
- certification helpers that choose newest/highest ids weaken exact-effect evidence;
- the COV-01 reference vocabulary now calls exact post-read `converged`, not authoritative `Applied`; broader action migration remains open.

The main parity ledger records `ACCEPTED` at the exact evidence revision. Runtime fixes discovered by COV-00C were not required merely to close the census, but they remain blockers for the affected module's U4/U5 promotion and COV-27 launch admission.
