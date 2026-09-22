# COV-00D lifecycle evidence calibration

**Package:** `COV-00D`
**Disposition:** integrated acceptance candidate
**Audited base:** `ed4987d3d99a89c2a3f2a7cddc8ca212548b1831`
**Machine evidence:** [`../evidence/cov-00d-lifecycle-evidence.json`](../evidence/cov-00d-lifecycle-evidence.json)
**Ratchet:** [`../../scripts/validate-cov00d-evidence-matrix.py`](../../scripts/validate-cov00d-evidence-matrix.py)

## Result

Every intended COV-03..24 lifecycle owner now has an independent `D/A/O/E` score, concrete source evidence, missing proof, a downstream owner, and a launch-admission value reconciled with the product surface catalog.

The accepted vocabulary is:

- `D`: domain invariant;
- `A`: authenticated API/generated-operation integration;
- `O`: actual operator/UI transition;
- `E`: exact effect identity plus replay/lost-response recovery.

The matrix does not infer operator proof from route rendering, action presence, direct BFF/reducer transitions, or fixture APIs. It also rejects `latest`/`newest` result discovery as proven exact-effect evidence.

## Calibrated matrix

| Owner | Surface | Current floor | D | A | O | E | First-org admission |
| --- | --- | --- | --- | --- | --- | --- | --- |
| COV-03 | CRM | U3 | proven | proven | proven | partial | review |
| COV-04 | Sales | U3 | proven | partial | partial | partial | review |
| COV-05 | Purchasing | U3 | proven | partial | partial | partial | review |
| COV-06 | Inventory / WMS | U2 | proven | partial | partial | absent | review |
| COV-07 | Manufacturing / Quality | U2 | partial | partial | absent | absent | review |
| COV-08 | Accounting / Finance / Assets | U3 | proven | partial | partial | partial | review |
| COV-09 | HR / Payroll | U2 | proven | partial | partial | partial | review |
| COV-10 | Projects / Tasks | U2 | proven | partial | partial | partial | review |
| COV-11 | Expenses | U2 | proven | partial | partial | partial | review |
| COV-12 | Subscriptions | U2 | proven | partial | partial | absent | review |
| COV-13 | POS | U2 | proven | partial | partial | absent | review |
| COV-14 | Helpdesk | U2 | partial | partial | partial | absent | review |
| COV-15 | Fleet | U1 | proven | partial | partial | partial | review |
| COV-16 | IoT | U2 | partial | partial | partial | partial | review |
| COV-17 | Proposals | U3 | proven | partial | partial | partial | review |
| COV-18 | Documents / Knowledge | U2 | partial | partial | partial | partial | review |
| COV-19 | Calendar + Messages / Communications | U2 | proven | partial | partial | partial | review |
| COV-20 | Reports / Analytics | U3 | partial | partial | partial | absent | review |
| COV-21 | Approvals / Workflow automation | U2 | proven | partial | partial | partial | review |
| COV-22 | Imports / Data Ops + Forms / Templates | U2 | proven | partial | partial | partial | review |
| COV-23 | Organization / Company / Settings / Auth | U3 | proven | proven | partial | partial | review |
| COV-24 | Distributor workspace | U2 | partial | partial | partial | absent | review |

Dimension totals:

- `D`: 16 proven, 6 partial;
- `A`: 2 proven, 20 partial;
- `O`: 1 proven, 20 partial, 1 absent;
- `E`: 15 partial, 7 absent.

## Promotion and launch ratchet

The validator fails when:

- any COV-03..24 owner or catalog surface is omitted or duplicated;
- a cited evidence path is missing or an evidence claim is empty;
- a direct-BFF principal transition is labeled proven operator evidence;
- a latest/newest helper is labeled proven exact-effect evidence;
- a U4/U5 floor or `enabled`/`admin-only` admission has any applicable dimension below proven;
- the matrix admission disagrees with `product-surface-catalog.ts`.

All current catalog entries remain `review`, consistent with the incomplete applicable evidence. COV-27 can consume this matrix as its module-admission input; it must not promote an exposed surface while a required dimension remains partial or absent.

## Evidence limits

This slice is source and evidence calibration. It does not repair the runtime defects owned by COV-01/UX/module/GOV packages, execute browser tests, or promote any module to U4/U5. Strong domain and API evidence is retained even where operator or recovery evidence is incomplete.

## COV-00 disposition

COV-00A through COV-00D are now integrated acceptance candidates. COV-00 remains `REVIEW` until the coordinator reviews the four artifacts together and records the accepted evidence revision in the program ledger.
