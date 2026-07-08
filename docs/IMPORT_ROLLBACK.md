# Import rollback

Batch CSV imports that run through SpacetimeDB import reducers record every created row in `import_job_record`. The `rollback_import_job` reducer soft-deletes (or deactivates) those rows and marks the job `rolled_back`.

## When rollback is available

| Job status | Rollback |
|------------|----------|
| `pending` | Blocked — import still running |
| `success` | Allowed |
| `partial` | Allowed — rolls back successfully imported rows |
| `failed` | Blocked — no `import_job_record` rows |
| `rolled_back` | Blocked — already rolled back |

The UI shows **Rollback import** when `canRollbackImportJob(job)` is true (`success` or `partial`).

## Supported entities (rollback behavior)

| `import_job.table_name` | Rollback action |
|-------------------------|-----------------|
| `contact` | Sets `deleted_at` on the contact |
| `product` | Sets `active = false` on the product |
| Other tables | Reducer returns error: rollback not supported |

Extend `rollback_delete_record` in `spacetimedb/src/data_ops/import_tracker.rs` when adding new import types.

## User flow (Import Assistant)

Modules with `ImportAssistantWizard` (CRM, Inventory, Sales, Projects, …):

1. Upload CSV → AI column mapping → preview → **Confirm import**
2. Wizard moves to **Import status** (`done` step)
3. `ImportJobStatusPanel` polls `/api/query/import-jobs` and shows counts
4. User clicks **Rollback import** → BFF `POST /api/call/rollback_import_job`

Recent jobs for the same entity also appear in `ImportJobHistoryPanel`.

## API

```http
POST /api/call/rollback_import_job
Content-Type: application/json

[organization_id, job_id]
```

Requires `delete` permission on the imported table (e.g. `contact`).

## Audit

Successful rollback writes `write_audit_log_v2` with `action: "ROLLBACK"` on `import_job`, including `deleted_count` in metadata.

## E2E

`frontend/web/tests/e2e/import-rollback.spec.ts` — CRM contact import through the assistant (mocked AI mapping), then UI rollback. Run:

```bash
E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=import-rollback.spec.ts
```

## Related code

| Layer | Path |
|-------|------|
| Reducer | `spacetimedb/src/data_ops/import_tracker.rs` |
| Hook | `frontend/packages/query-hooks/src/hooks/import-jobs.ts` |
| UI | `frontend/packages/ui/src/import-assistant/` |
| CRM wiring | `frontend/web/app/(modules)/crm/crm-client.tsx` |
