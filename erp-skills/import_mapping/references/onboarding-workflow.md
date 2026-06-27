# CSV onboarding workflow

## Pointing at files in a folder

When the user gives a folder or file path:

1. List or read CSV files in that path (workspace-local only).
2. Prefer one entity per file; if multiple files exist, ask which maps to which `target_entity`.
3. Parse the header row and up to 50 sample rows.
4. Run the safety scan before analysis (formula and prompt-injection patterns).
5. Call analyze with `target_entity`, `headers`, and `sample_rows` (or `csv_text`).

## Analyze → map → preview → import

| Step | Action | Output |
|------|--------|--------|
| Analyze | Match headers to ERP fields | mappings, unmapped columns, metadata suggestions |
| Review | User edits mapping | updated mapping object |
| Preview | Apply mapping to sample rows | normalized rows, validation errors |
| Import | Client calls `import_*_csv` reducer | `ImportJob` + row errors |

## Metadata for impromptu columns

Most Lumiere import reducers accept a `metadata` column (JSON string). For unmapped source columns:

- Suggest storing them under `metadata.extra.<normalized_header>`.
- Merge multiple impromptu columns into one JSON object per row at preview time.
- Record the final mapping in import job metadata for repeat imports:

```json
{
  "ai_assisted": true,
  "column_mapping": { "Legacy SKU": "default_code", "Region": "metadata.extra.region" },
  "source_path": "imports/2026/contacts.csv"
}
```

## Supported MVP entities (gateway analyzer)

`contact`, `lead`, `opportunity`, `product`, `sale_order`, `project_task`

For other tables, inspect the matching `import_*_csv` reducer under `spacetimedb/src/data_ops/` and mirror its `col(...)` headers before proposing mappings.
