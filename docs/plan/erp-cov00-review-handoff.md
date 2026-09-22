# COV-00 review handoff

**State:** REVIEW  
**Evidence:** [`erp-cov00-current-module-matrix.md`](./erp-cov00-current-module-matrix.md)  
**Correctness/evidence register:** [`erp-cov00-correctness-evidence-defect-register.md`](./erp-cov00-correctness-evidence-defect-register.md)  
**COV-00C machine census:** [`../evidence/cov-00c-correctness-defects.json`](../evidence/cov-00c-correctness-defects.json)
**COV-00D evidence matrix:** [`../evidence/cov-00d-lifecycle-evidence.json`](../evidence/cov-00d-lifecycle-evidence.json)
**Audited base:** `afa23b702fc4c47623697d2fcb81733f2dd71c14`

This handoff exists because COV-00 must not be marked ACCEPTED while the operation census, first-test-org exposure denominator, correctness-defect ownership, and evidence-claim calibration remain incomplete.

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

### COV-00C — correctness defect census and ownership

Owner: audit/classification; runtime fixes remain with COV-01/UX/module/GOV owners.

**Current disposition:** acceptance candidate. The 11-class manifest owns every current defect class and ratchets the `AllowEmpty`, runtime-form, latest-helper, direct-BFF evidence, and semantic-dispatch inventories. Open runtime rows remain blocking at their downstream gates.

Use `erp-cov00-correctness-evidence-defect-register.md` as the initial source register and expand it from current-tree evidence.

Required work:

- enumerate false-success paths where UI can close/toast without an admitted effect;
- enumerate consequential effect-correlation paths that use newest/latest/heuristic identity;
- enumerate critical query/read paths that collapse denied/unavailable/error into a legitimate empty dataset;
- enumerate runtime-form/config fallbacks that permit submission after a dependency/config failure;
- enumerate admitted analytics/report paths that broaden invalid filters, coerce missing values, hide source failure, or otherwise produce plausible but misleading output;
- classify every defect by owner, affected T0 surface, severity/launch impact and downstream repair package;
- explicitly review the COV-01 prototype vocabulary so exact post-read after an ambiguous dispatch is not called authoritative `Applied` unless the server/domain proves the disposition;
- define narrow ratchets tied to owned metadata/evidence rather than brittle repository-wide grep rules.

COV-00C closes when every discovered current-tree defect in these classes is owned and no exposed T0 surface can evade its repair gate by being described only as “covered by tests.”

### COV-00D — evidence claim calibration

Owner: audit/test metadata/evidence matrix.

**Current disposition:** acceptance candidate. All COV-03..24 owners have a machine-checked `D/A/O/E` row with concrete evidence, missing proof, downstream packages, and launch admission reconciled to the product surface catalog. See [`erp-cov00d-evidence-calibration-status.md`](./erp-cov00d-evidence-calibration-status.md).

Every intended T0 module primary lifecycle must be scored across four independent dimensions:

```text
D = domain invariant
A = authenticated API/generated-operation integration
O = actual operator/UI transition
E = exact effect identity + replay/lost-response recovery
```

Each dimension is `proven`, `partial`, `absent`, or `not-applicable` with concrete evidence.

Required work:

- classify browser lifecycle specs that use `callReducerBff`, owner helpers, or fixture APIs for principal transitions;
- distinguish fixture/setup BFF use from the exact user action being claimed as operator proof;
- downgrade/rename inflated P0/U-level evidence where the browser only renders after backend transitions;
- mark latest/highest-id result helpers as partial/invalid `E` evidence for 0..1 effects;
- ensure strong domain/API tests remain reusable evidence rather than being discarded;
- attach missing operator/effect proof directly to COV-03..24 module packages;
- make COV-27 reject an exposed module whose applicable D/A/O/E evidence is incomplete.

Known examples that must appear in the calibrated matrix include CRM→Sales, HR/payroll, Projects, IoT and Proposals.

## Coordinator acceptance

COV-00 can move from REVIEW to ACCEPTED when COV-00A through COV-00D are integrated and the coordinator can answer these questions without source archaeology:

1. Is every current operation intentionally owned and exposed/not exposed?
2. Is every first-test-org route intentionally admitted and tied to a COV/admin gate?
3. Are all discovered correctness/effect/read-state/reporting defects explicitly owned and launch-gated?
4. Does every intended T0 primary lifecycle state what is proven at domain, API, operator and exact-effect/recovery layers?

COV-00 itself remains primarily audit/classification work. Runtime repairs discovered by COV-00C must be implemented by their owning COV-01/UX/module/GOV packages before the affected surface can reach U4/U5 or enter the final launch manifest.
