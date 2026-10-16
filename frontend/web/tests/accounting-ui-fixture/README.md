# Accounting UI browser fixture

This isolated Next app renders the production application shell, Accounting workspace navigation, accountant overview, invoice composer, and document review components. The styles come from the production web stylesheet. Its labeled synthetic records stay in React props; no ERP backend, credentials, migrations, or production authentication bypass are used.

Run from `frontend/web`:

```sh
node node_modules/@playwright/test/cli.js test --config playwright.accounting-ui.config.ts
```

The equivalent package script is `pnpm test:e2e:accounting-ui`. Run
`pnpm test:accounting-ui:models` for the companion overview, invoice-record,
navigation and existing invoice-action/status model checks.

If a Playwright-managed Chromium is unavailable, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium executable. The checks cover 1440px and 390px layouts, drawer focus/navigation, persisted preferences, grouped views/configuration, exact queue targets, currency and permission boundaries, draft preview, and synthetic action callbacks. Screenshots are saved beneath `test-results`.

These checks prove browser rendering and local interactions. They do not prove authentication, actual posting, reconciliation, canonical backend readback, or first-organization admission. The authenticated accounting end-to-end specs remain responsible for those behaviors.
