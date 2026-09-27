# CSV-01 — European grouped-decimal statement amounts

Status: **IMPLEMENTED — verification pending**

Stack base: PR #85 (`codex/csv04-sha256-statement-import-identity`).

## Scope

Canonical CSV-01 closes the statement-parser defect where a European grouped
decimal such as `1.234,56` was silently interpreted as `1.23456`.

This slice supports only clear European grouped-decimal shapes; it does not add
free-form locale guessing.

## Semantics

Recognized European grouped decimals match:

```text
^[+-]?\d{1,3}(?:\.\d{3})+,\d+$
```

Examples:

- `1.234,56` → `1234.56`;
- `1.234.567,89` → `1234567.89`;
- `-1.234,56` → `-1234.56`.

Existing behavior remains certified:

- `12,34` → `12.34`;
- `1,234.56` → `1234.56`;
- CSV-02 grouped US integers remain covered separately.

The tests exercise the full statement-row parser using semicolon-delimited
European rows, so the decimal comma is treated as data rather than a CSV field
separator.

## Changes

- recognize canonical European grouped-decimal input before the existing amount
  fallbacks;
- remove dot grouping separators and convert the decimal comma to a dot;
- add fixtures for single/multiple grouping and negative amounts;
- add regression fixtures for plain decimal-comma and US mixed separators;
- relabel the earlier BOM-only unit cases as `CSV-BOM` so canonical CSV-01 is
  unambiguous;
- promote canonical CSV-01 to covered in the pre-tenant matrix.

## Deliberately excluded

- heuristic locale inference for malformed/ambiguous numeric strings;
- date-format selection;
- statement reducer/approval behavior;
- MONEY-PRECISION / f64 domain-boundary work.

## Acceptance

```bash
cd frontend/web
node --import tsx --test lib/statement-import-csv.test.ts
pnpm typecheck
```

Do not mark CSV-01 accepted until the focused unit proof and typecheck pass on
this branch.
