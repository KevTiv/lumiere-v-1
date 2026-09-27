# CSV-01 — bank-statement UTF-8 BOM parsing

Status: **IMPLEMENTED — runtime proof pending**

Stack base: PR #81 (`codex/pay11b-statement-import-replay-conflict`).

## Scope

CSV-01 certifies UTF-8 BOM handling for the browser-side bank-statement CSV
parser.

The parser previously stripped a leading BOM correctly, but the implementation
was private to `payment-operations-panel.tsx` and had no executable proof.
The raw CSV was also hashed before BOM normalization, so semantically identical
files with and without a BOM produced different import idempotency keys.

## Changes

- extract statement CSV parsing into `frontend/web/lib/statement-import-csv.ts`;
- preserve the existing header, date, amount, reference and description parsing
  behavior;
- strip a leading UTF-8 BOM before parsing;
- strip the same BOM before statement-import idempotency hashing;
- wire the accounting payment operations panel to the extracted helpers;
- add CSV-01 unit tests proving BOM and non-BOM inputs produce identical parsed
  rows and identical import keys;
- add the focused parser test to the web unit-test command;
- split CSV-01 from the still-open CSV-02..04 certification row.

## Deliberately excluded

- delimiter detection changes;
- localized/thousands decimal semantics;
- malformed/ambiguous numeric policy;
- reducer or statement-approval changes.

## Acceptance

```bash
cd frontend/web
node --import tsx --test lib/statement-import-csv.test.ts
pnpm typecheck
```

Do not mark CSV-01 accepted until the focused unit proof and typecheck pass on
this branch.
