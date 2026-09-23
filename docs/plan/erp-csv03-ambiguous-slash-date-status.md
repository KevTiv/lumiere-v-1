# CSV-03 — ambiguous slash-date handling

Status: **IMPLEMENTED — verification pending**

Stack base: PR #83 (`codex/csv02-us-thousands-amount-parser`).

## Scope

CSV-03 closes the statement-parser defect where numeric slash dates were
implicitly interpreted using DD/MM semantics, silently mis-dating MM/DD exports.

The adversarial import invariant requires an explicit format/locale contract;
the current statement upload form has no such selector. The safe bounded
behavior is therefore to reject numeric slash dates rather than guess.

## Semantics

- `02/03/2026` → no parsed date;
- `03/02/2026` → no parsed date;
- `13/02/2026` → no parsed date even though DD/MM looks inferable;
- `2/13/2026` → no parsed date even though MM/DD looks inferable;
- ISO `2026-02-13` remains accepted.

A missing parsed date is preserved into the existing staging contract, where the
row is surfaced for review instead of silently changing its accounting date.

## Changes

- reject `D/M/YYYY`, `DD/MM/YYYY`, `M/D/YYYY` and `MM/DD/YYYY` numeric
  slash-date shapes before JavaScript locale-sensitive date parsing;
- add focused parser fixtures for ambiguous, otherwise-inferable and non-padded
  slash dates;
- add an ISO regression fixture;
- promote canonical CSV-03 to covered in the pre-tenant certification matrix;
- leave CSV-01 and CSV-04 explicit as remaining parser findings.

## Deliberately excluded

- adding a date-format/locale selector to the import UI;
- mixed European numeric separators (CSV-01);
- statement import key collision hardening (CSV-04);
- reducer or approval behavior.

## Acceptance

```bash
cd frontend/web
node --import tsx --test lib/statement-import-csv.test.ts
pnpm typecheck
```

Do not mark CSV-03 accepted until the focused unit proof and typecheck pass on
this branch.
