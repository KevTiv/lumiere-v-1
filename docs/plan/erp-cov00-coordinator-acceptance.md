# COV-00 coordinator acceptance

**Package:** `COV-00`
**Disposition:** `ACCEPTED`
**Accepted evidence revision:** `4f797db650ae82318ab0f477670d14aee9d5d0cd`
**Acceptance scope:** current-tree audit, ownership, exposure denominator, defect census, and evidence calibration only

## Coordinator decision

COV-00A through COV-00D reconcile on the accepted evidence revision and answer the four coordinator questions without further source archaeology.

### 1. Current operation ownership

Accepted.

- 1,399 canonical contract operations are classified;
- all 914 client-facing operations have an explicit owner and disposition;
- zero client-facing operations are unowned;
- zero accepted rows require review or retain `needs-triage`/`uncategorized` ownership;
- the generator fails closed when a new operation lacks valid ownership or disposition.

Authority: [`../evidence/cov-00a-operation-census.json`](../evidence/cov-00a-operation-census.json) and [`erp-cov00a-operation-census-status.md`](./erp-cov00a-operation-census-status.md).

### 2. First-test-organization exposure

Accepted.

- every current module route maps to exactly one product-surface entry;
- navigation destinations and quick actions reference that shared authority;
- every entry has an owner, classification, minimum evidence, and admission decision;
- COV-owned business/horizontal/admin surfaces remain `review` and fail closed;
- AI, internal, and showcase surfaces remain hidden;
- `/fleet` is the sole canonical Fleet workspace and `/map` remains a hidden geospatial showcase.

Authority: [`cov-first-org-exposure-prototype.md`](./cov-first-org-exposure-prototype.md) and `frontend/packages/ui/src/lib/product-surface-catalog.ts`.

### 3. Correctness-defect ownership

Accepted as a census, not as runtime remediation.

- all 11 discovered correctness/evidence classes have explicit owners, downstream packages, launch impact, closure gates, and source evidence;
- nine classes remain open or partial and continue to block their downstream U4/U5 or launch gates;
- the source ratchet covers ambiguous empty reads, runtime-form fallback, latest/newest effect discovery, direct-BFF operator claims, semantic dispatch, and related classified inventories.

Authority: [`../evidence/cov-00c-correctness-defects.json`](../evidence/cov-00c-correctness-defects.json) and [`erp-cov00c-correctness-census-status.md`](./erp-cov00c-correctness-census-status.md).

### 4. Primary-lifecycle evidence calibration

Accepted.

- all 22 COV-03..24 owners have independent domain, API, operator, and exact-effect/recovery scores;
- every proven or partial claim cites concrete current-tree evidence;
- every incomplete row names missing proof and downstream packages;
- direct-BFF principal transitions cannot qualify as proven operator evidence;
- latest/newest discovery cannot qualify as proven exact-effect evidence;
- no module may claim U4/U5 or enabled/admin-only launch admission while an applicable dimension remains incomplete.

Authority: [`../evidence/cov-00d-lifecycle-evidence.json`](../evidence/cov-00d-lifecycle-evidence.json) and [`erp-cov00d-evidence-calibration-status.md`](./erp-cov00d-evidence-calibration-status.md).

## Acceptance boundary

`COV-00 ACCEPTED` means the current operation, route/exposure, defect, and lifecycle-evidence denominators are explicit and ratcheted. It does not mean:

- any COV-03..24 module is U4 or U5;
- any first-org business surface is admitted;
- the nine open/partial COV-00C defect classes are repaired;
- browser, deployment, seed-pack, accessibility, responsive, or production certification has run;
- the COV-01 typed workflow boundary or COV-02 seed/persona foundation is complete.

The next dependency-ordered package is COV-02 seed/persona inventory and fixture convergence. COV-01 may continue only through its already-owned shared workflow/result boundary and must preserve the accepted operation, exposure, and evidence authorities.

## Validation recorded

- `pnpm --dir frontend/web analyze:coverage:check` — passed; 1,399 operations, 914 client-facing, zero unowned, zero review-required;
- `pnpm --dir frontend/packages/ui test -- product-surface-catalog.test.ts` — passed; 12 files and 55 tests, including all five exposure-census tests;
- `pnpm --dir frontend cov-correctness:check` — passed; 11 classes, nine open/partial;
- `pnpm --dir frontend cov-evidence:check` — passed; all 22 owners reconciled;
- `git diff --check` — passed before acceptance recording.
