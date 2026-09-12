# ERP E2E Smoke Tests

These Playwright tests exercise the current high-value ERP web flows:

- Seeded email/password sign-in.
- Authenticated shell and sidebar navigation.
- Core module route rendering.
- Minimal create flows for CRM, Helpdesk, Inventory, Sales, and Proposals.
- Guarded workflow/action surfaces.
- Sign-out plus PostHog reset signaling.
- Accounting module tab coverage and create flows (`accounting-module.spec.ts`).
- Purchasing module shell, key tabs, and seeded PO visibility (`purchasing-module.spec.ts`).
- Inventory module shell, key tabs, and seeded product visibility (`inventory-module.spec.ts`).
- Sales-to-invoice smoke linkage via seeded SO/INV records (`sales-invoice-flow.spec.ts`).
- ERP parity Phases 1–5 mutation coverage (`parity-phase*-mutations.spec.ts`, `@p0` + `@parity-phase-N`; phase 3/5 also `@dev-fixture`).

## Spec files

| File | Coverage |
|------|----------|
| `auth-shell.spec.ts` | Public landing, auth redirect, sign-in, shell navigation, sign-out |
| `module-smoke.spec.ts` | Cross-module minimal creates (CRM, Helpdesk, Inventory, Sales, Proposals) |
| `accounting-module.spec.ts` | All accounting tabs, creates, quick actions, CSV import guard |
| `mvp-lead-to-cash.spec.ts` | Golden-path CRM → payment (steps 3–13, 17; full UI) |
| `mvp-procure-to-pay.spec.ts` | PO create → line → confirm → receive → bill modal → post (@p0) |
| `mvp-ai-action-draft.spec.ts` | AI action draft create → approve/reject (steps 15–16, @p0) |
| `mvp-ai-rag.spec.ts` | ERP Assistant RAG insight (step 14, @p0; skips if gateway unavailable) |
| `purchasing-module.spec.ts` | `/purchasing` shell, dashboard/orders/lines/requisitions/vendors/partner-banks tabs, seeded `PO/2024/0001` |
| `inventory-module.spec.ts` | `/inventory` shell, key stock/product tabs, seeded `Lumiere Dev Laptop` |
| `sales-invoice-flow.spec.ts` | Seeded `SO/2024/0001` on Sales, linked `INV/2024/00001` on Accounting Invoices, sale-order quick action |
| `phase-11-missing-modules-smoke.spec.ts` | Tasks, forensics, trackers, IoT module smokes |
| `auth-lifecycle.spec.ts` | Sign-up, forgot-password, onboarding redirect (@unauthenticated) |
| `crm-opportunity-stage.spec.ts` | CRM opportunity stage change via UI |
| `realtime-smoke.spec.ts` | Query refetch after reducer mutation |
| `parity-phase1-rbac-mutations.spec.ts` | Grant + revoke organization permission via Settings (`@parity-phase-1`) |
| `parity-phase2-forms-mutations.spec.ts` | Add/delete custom field on CRM new-lead form config (`@parity-phase-2`) |
| `parity-phase3-approvals-documents-mutations.spec.ts` | Approval rule → gated PO confirm → reject (`@parity-phase-3`) |
| `parity-phase4-accounting-reports-mutations.spec.ts` | Fiscal setup wizard; pivot report save/delete (`@parity-phase-4`) |
| `parity-phase5-chatter-mutations.spec.ts` | Post note on seeded sale order + mail_message assert (`@parity-phase-5`) |
| `crm-duplicate-merge.spec.ts` | Duplicate contact detection + merge via CRM Duplicates tab (`@phase-4`) |
| `import-rollback.spec.ts` | CRM contact import assistant + rollback import job (`@phase-4`) |
| `manufacturing-mutations.spec.ts` | Work center, BOM, and MO create mutations (`@phase-4`) |
| `expenses-wave-lifecycle.spec.ts` | Expenses capture/ops panels, allocations form, conflict outbox, card statement create (`@expenses` `@p0`) |
| `phase-5-workforce-smoke.spec.ts` | HR/Projects/Expenses/Calendar shell smoke (`@phase-5`) |

## Local Setup

E2E uses a **dedicated local module** (`lumiere-v1-local-e2e` by default), not the maincloud module name in `spacetime.local.json`. Override with `E2E_STDB_MODULE=my-local-db`.

From the repo root, run the full local stack and smoke suite with:

```bash
make e2e-smoke
```

MVP golden-path gates (from repo root):

```bash
# Wave 2 — lead-to-cash (steps 3–13, 17)
E2E_CLEAR_DB=1 make e2e-single

# Wave 3 — procure-to-pay
E2E_CLEAR_DB=1 make e2e-p2p

# AI draft + RAG (steps 14–16)
E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=mvp-ai-action-draft.spec.ts
E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=mvp-ai-rag.spec.ts

# Phase 4 — CRM duplicate merge
E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=crm-duplicate-merge.spec.ts

# Phase 4 — import rollback + manufacturing mutations
E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=import-rollback.spec.ts
E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=manufacturing-mutations.spec.ts

# Both paths on a fresh DB
E2E_CLEAR_DB=1 make e2e-mvp-golden
```

Note: `e2e-mvp-golden` passes `E2E_GREP="creates CRM"` only for `mvp-lead-to-cash.spec.ts`. For other specs, omit grep or set `E2E_GREP=` explicitly.

That target starts local SpacetimeDB when needed, publishes the local module **without** wiping existing data by default, runs core reducer tests (continues if unavailable), runs **`seed_dev_data`** via `pnpm run e2e-seed-fixture`, seeds the browser smoke user, builds/starts `api-server` and production Next.js, and runs Playwright.

### Fast path by default

`e2e-smoke-setup` and `e2e-single-test` use content fingerprints from `scripts/build-fingerprint.py`. Inputs include source, manifests/lockfiles, API build scripts/raw bindings, STDB inline test sources, fixture tools, tool versions, and relevant environment settings. Successful-run stamps live under `.tmp/e2e/`. If inputs and service configuration match:

- `spacetime publish`, the full `run_all_core_tests` + domain reducer loop, and `seed_dev_data`/`seed-test-user` are skipped — the existing local DB is reused as-is.
- The API build/restart is skipped. When needed, only `cargo build -p api-server --bin api-server --locked` runs, followed by the built executable.

Local production Next builds are reused only when both the frontend fingerprint and recorded `.next/BUILD_ID` match. Frontend source/packages/public assets, lockfiles, dotenv files, and relevant build environment invalidate reuse. CI always executes the production build; there is no CI success stamp shortcut.

For the fastest edit/test loop, keep Next development mode running:

```bash
# Terminal 1: prepare API/STDB, then keep Next dev on :3100
make e2e-web-dev
# Terminal 2: no build, publish, seed, or browser installation
make e2e-single-running E2E_SPEC=auth-shell.spec.ts
make e2e-playwright-only E2E_SUITE=p0
```

Install Chromium once beforehand if needed. Ctrl-C stops the foreground web command; setup's API/STDB remain. Stop the dev server before production-mode tests use the same port. See the [build and CI guide](../../../../docs/guides/build-and-ci-dx.md) for cache boundaries and CI selection.

Any of the following forces the full heavy path:

- Touching `spacetimedb/src/**` (any `.rs` file) → forces republish + reducer tests + reseed.
- Touching `api-server/src/**` or `crates/**` (any `.rs` file) → forces `cargo build` + api-server restart.
- `E2E_CLEAR_DB=1` → always wipes + republishes + reseeds (existing behavior).
- `E2E_FORCE_REBUILD=1` → forces STDB, API and frontend heavy paths regardless of hash, without wiping data.

To force a clean database and full fixture re-seed (same as old behavior), set:

```bash
E2E_CLEAR_DB=1 make e2e-smoke
# P0 only (includes both MVP golden specs; excludes @dev-fixture):
E2E_CLEAR_DB=1 E2E_SUITE=p0 make e2e-smoke

# CI profile — fail if ai-gateway is down:
E2E_REQUIRE_AI=1 E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=mvp-ai-rag.spec.ts
```

Smoke Playwright runs use `E2E_WORKERS=1` by default (serial) so tests share one api-server reliably.

The seeded login is:

```text
test@email.com
Password123$
```

If you already have the stack running and only want to re-run Playwright:

```bash
make e2e-playwright-only
```

Use the UI runner when debugging:

```bash
pnpm --dir frontend/web run test:e2e:ui
```

Parity phase specs (single file or by phase tag):

```bash
# All parity mutation specs
E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=parity-phase1-rbac-mutations.spec.ts E2E_GREP=
E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=parity-phase5-chatter-mutations.spec.ts E2E_GREP=

# Full suite filtered by phase tag
pnpm --dir frontend/web exec playwright test --grep @parity-phase-3
```

## Notes

- Tests create records with a `smoke-` prefix and unique suffixes.
- The suite assumes email/password auth is enabled; WorkOS-only local envs should unset `NEXT_PUBLIC_WORKOS_REDIRECT_URI` for this smoke path.
- PostHog is optional. The sign-out test listens for the `lumiere:posthog-reset` event, which `phReset()` dispatches in the browser whenever sign-out runs (independent of whether `NEXT_PUBLIC_POSTHOG_TOKEN` is set).

### Seed data requirements

`make e2e-smoke` runs `seed_dev_data` before Playwright. Several specs assert **read-only** fixture rows (no multi-step create flows):

| Spec | Seeded records assumed |
|------|------------------------|
| `purchasing-module.spec.ts` | Purchase order `PO/2024/0001` |
| `inventory-module.spec.ts` | Product `Lumiere Dev Laptop` |
| `sales-invoice-flow.spec.ts` | Sale order `SO/2024/0001`, customer invoice `INV/2024/00001` (origin `SO/2024/0001`, partner Acme Corporation) |
| `parity-phase3-approvals-documents-mutations.spec.ts` | Vendor partner `Globex Corp`, product `Lumiere Dev Laptop` |
| `parity-phase5-chatter-mutations.spec.ts` | Sale order `SO/2024/0001` (same as sales-invoice-flow) |

If the database was published without `seed_dev_data`, use `E2E_CLEAR_DB=1 make e2e-smoke` to republish and re-seed. The sales-invoice spec does **not** create invoices end-to-end; it verifies the seeded sales → accounting linkage only.

### Troubleshooting: 403 on `reset database` / `update database`

Local SpacetimeDB databases are owned by the identity that created them. If `make e2e-smoke` fails with **403 Forbidden** on `lumiere-v1-j1uo0`, your CLI identity does not own that local database (often after `spacetime login` to maincloud or a wiped `cli.toml`).

**Fix (recommended):** use the default E2E module (already separate from cloud):

```bash
E2E_CLEAR_DB=1 make e2e-smoke
```

**Nuclear option** (deletes **all** local SpacetimeDB data, including orphaned modules):

```bash
make e2e-wipe-local-stdb
E2E_FORCE_LOCAL_LOGIN=1 E2E_CLEAR_DB=1 make e2e-smoke
```
