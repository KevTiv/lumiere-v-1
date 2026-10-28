# Accounting UI browser fixture

This isolated Next app renders the production application shell, Accounting workspace navigation, accountant overview, invoice composer, and document review components. Its `/style-templates` route also renders a real configured ModuleView and EntityTable, static ModularForm and FormModal, and persisted ComposedCollectionDetailHost. The styles come from the production web stylesheet. Its labeled synthetic records stay in React props; no ERP backend, credentials, migrations, or production authentication bypass are used.

The `/personalization` route renders the actual invoice personalization settings editor, composer, document renderer and snapshot readers. Explicit in-memory publication callbacks model success, rejection and unconfirmed-result reconciliation; they are not backend acceptance tests. An exact managed-shaped, checksum-pinned logo path serves a constant synthetic PNG from this isolated app. The personalization tests permit that one asset request and reject every other `/api/` request. Controlled synthetic issued snapshots demonstrate that later defaults do not alter a captured document, without claiming a real invoice was posted.

Run from `frontend/web`:

```sh
node node_modules/@playwright/test/cli.js test --config playwright.accounting-ui.config.ts
```

The equivalent package script is `pnpm test:e2e:accounting-ui`. Run
`pnpm test:accounting-ui:models` for the companion overview, invoice-record,
navigation and existing invoice-action/status model checks.

If a Playwright-managed Chromium is unavailable, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium executable. The checks cover 320px, 390px, 768px, and 1440px layouts, with coarse touch pointers below 1024px. Coverage includes drawer focus/navigation, persisted preferences, grouped views/configuration, exact queue targets, currency and permission boundaries, draft preview, synthetic action callbacks, semantic theme propagation, dark/Ocean palettes, keyboard selection, form footer access, 44px touch controls, and internal table scrolling. Screenshots are saved beneath `test-results`.

These checks prove browser rendering and local interactions. They do not prove authentication, actual posting, reconciliation, canonical backend readback, or first-organization admission. The authenticated accounting end-to-end specs remain responsible for those behaviors.

The `/navigation` route exercises the production ModuleView with curated
Accounting, Sales, CRM, Purchasing, Reports and Expenses navigation metadata,
plus an uncurated module and local-shell workspace tabs. Synthetic content proves
group selection, canonical links, Back/Forward/reload, keyboard interaction,
extension-tab reachability, shared appearance, wrapping and touch targets. It
does not prove that every corresponding backend collection is available.

For the focused navigation and shared-template regression checks, run
`node node_modules/@playwright/test/cli.js test --config playwright.workspace-navigation.config.ts`.

The `/reports-workspace` route renders the production report catalog, result
summary and generation form with synthetic scoped records. Session storage
models reopening after reload; it does not establish an ERP saved effect.
Run `pnpm test:e2e:reports-ui` for the focused generation, rejection recovery,
reopening, source-state, locked-period catalog and reader checks at mobile and
desktop widths. `?before=1` is a labelled snapshot of the prior overview
composition for visual comparison, not a capture of the deployed Alpha.
