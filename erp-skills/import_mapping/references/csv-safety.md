# CSV safety (client and gateway)

Block or neutralize CSV content before AI analysis or import preview.

## Formula injection

Cells starting with `=`, `+`, `-`, `@`, tab, carriage return, or `|` can execute as spreadsheet formulas when opened in Excel/Sheets.

**Policy:** reject these cells for AI import analysis; optionally prefix with `'` when exporting back to CSV for download.

## Prompt injection

Cells containing instruction-like phrases (e.g. `ignore previous instructions`, `system:`, `assistant:`) must not reach the LLM as raw CSV context.

**Policy:** reject at the BFF (`/api/ai/import/*`, `/api/ai/skills/run` with `import_mapping`) and at gateway `/v1/import/*`.

## Size limits

- Max CSV text: 512 KB
- Max cell length for AI path: 4000 characters
- Max headers analyzed: 200
- Max sample rows: 50 (analyze) / 100 (preview)

## Client implementation

Use `@lumiere/erp-shared/csv-import-safety`:

- `parseCsvText(text)` — parse headers and rows
- `scanCsvMatrix(headers, rows)` — report findings
- `assertCsvSafeForAi(headers, rows)` — throw if blocked cells exist
- `neutralizeCsvCell(value)` — prefix formula cells for safe export

Always run safety checks in the browser before posting CSV content to AI routes.
