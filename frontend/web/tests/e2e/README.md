# ERP E2E Smoke Tests

These Playwright tests exercise the current high-value ERP web flows:

- Seeded email/password sign-in.
- Authenticated shell and sidebar navigation.
- Core module route rendering.
- Minimal create flows for CRM, Helpdesk, Inventory, Sales, and Proposals.
- Guarded workflow/action surfaces.
- Sign-out plus PostHog reset signaling.

## Local Setup

From the repo root, run the full local stack and smoke suite with:

```bash
make e2e-smoke
```

That target starts local SpacetimeDB when needed, publishes the local module **without** wiping existing data by default (so repeat runs are faster and reflect real migration behavior), runs core reducer tests (continues if unavailable), runs **`seed_dev_data`** via `pnpm run e2e-seed-fixture`, then seeds the browser smoke user with `pnpm run seed-test-user`, starts `api-server`, and then installs the Playwright Chromium browser if needed and lets Playwright start Next.js.

To force a clean database and full fixture re-seed (same as old behavior), set:

```bash
E2E_CLEAR_DB=1 make e2e-smoke
```

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
