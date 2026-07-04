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

## Local Setup

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
E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=mvp-ai-action-draft.spec.ts E2E_GREP=
E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=mvp-ai-rag.spec.ts E2E_GREP=

# Both paths on a fresh DB
E2E_CLEAR_DB=1 make e2e-mvp-golden
```

Note: `e2e-single` defaults to `E2E_GREP=creates CRM`. For other specs use `make e2e-p2p` or set `E2E_GREP=` explicitly.

That target starts local SpacetimeDB when needed, publishes the local module **without** wiping existing data by default (so repeat runs are faster and reflect real migration behavior), runs core reducer tests (continues if unavailable), runs **`seed_dev_data`** via `pnpm run e2e-seed-fixture`, then seeds the browser smoke user with `pnpm run seed-test-user`, starts `api-server`, and then installs the Playwright Chromium browser if needed and lets Playwright start Next.js.

To force a clean database and full fixture re-seed (same as old behavior), set:

```bash
E2E_CLEAR_DB=1 make e2e-smoke
# P0 only (includes both MVP golden specs):
E2E_CLEAR_DB=1 E2E_SUITE=p0 make e2e-smoke
```

Smoke Playwright runs use `E2E_WORKERS=1` by default (serial) so tests share one api-server reliably.

The seeded login is:

```text
test@email.com
Password123$
```

If you already have the stack running and only want to re-run Playwright:

```bash
pnpm --dir frontend/web run test:e2e
```

Use the UI runner when debugging:

```bash
pnpm --dir frontend/web run test:e2e:ui
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

If the database was published without `seed_dev_data`, use `E2E_CLEAR_DB=1 make e2e-smoke` to republish and re-seed. The sales-invoice spec does **not** create invoices end-to-end; it verifies the seeded sales → accounting linkage only.
