# CSV-02 — US thousands separator parsing

Status: **IMPLEMENTED — verification pending**

Stack base: PR #82 (`codex/csv01-statement-bom-parser-cert`).

## Scope

CSV-02 closes the canonical statement-parser defect where
`parseStatementAmount("1,234")` was interpreted as `1.234`.

The parser now recognizes canonical comma-grouped integers before applying the
existing decimal-comma fallback.

## Semantics

- `"1,234"` → `1234`;
- `"1,234,567"` → `1234567`;
- signed grouped integers use the same rule;
- `12,34` remains `12.34` under the existing decimal-comma behavior;
- mixed European separators such as `1.234,56` remain out of scope for this slice.

Quoted values are certified through the full statement-row parser so comma
grouping cannot be confused with the CSV field delimiter.

## Changes

- recognize `^[+-]?\\d{1,3}(?:,\\d{3})+$` as US grouped integer input;
- strip grouping commas before numeric conversion;
- add focused unit fixtures for one and multiple thousands groups;
- add a regression fixture proving ordinary decimal-comma parsing is unchanged;
- promote canonical CSV-02 to covered in the pre-tenant certification matrix.

## Deliberately excluded

- European mixed thousands/decimal separators (canonical CSV-01);
- ambiguous slash-date policy (CSV-03);
- 32-bit import-key collision hardening (CSV-04);
- statement reducer/approval behavior.

## Acceptance

```bash
cd frontend/web
node --import tsx --test lib/statement-import-csv.test.ts
pnpm typecheck
```

Do not mark CSV-02 accepted until the focused unit proof and typecheck pass on
this branch.
