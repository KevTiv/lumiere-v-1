# Pass 11: search, navigation guards and backend actions

This follow-up started from `claude/ui-polish-pass-1` at `31bfb557` and integrates
`claude/pass9-backend` at `ef01ac72`.

## Implemented

- The command palette searches 14 record models with module admission/RBAC gates.
  Queries start while the palette is open with at least two characters. Search
  covers loaded rows rather than an exhaustive server-side index. Failed reads
  show an error and suppress stale results and partner labels.
- Shared confirmation dialogs settle replaced requests and cancel outstanding
  requests on unmount, with translated accessible titles.
- A persistent root provider guards Next router push, replace and refresh,
  ordinary links, browser/imperative back and forward, and document unload.
  Multiple dirty editors share one prompt. Cancel keeps the editor and history
  position; discard resumes the requested navigation. In-page anchors, downloads
  and modified/new-tab clicks preserve their normal behavior.
- FormModal and inline cell/number editors register drafts and pending saves.
  Navigation and form dismissal stay blocked while a save runs; failed form saves
  retain the draft and missing submit bindings cannot report success.
- Draft transfers expose origin/note edits; assigned transfers expose confirmed
  reservation release. Draft manufacturing orders expose quantity edits. Fleet
  records expose name, type, plate, driver, odometer and fuel edits, including
  explicit clearing of optional fields. Actions require write access and an
  operating company and use generated operations plus exact fresh readbacks.
- Cancelled accounting documents can reset to draft only if never posted. The
  backend rejects previously posted documents because cancellation does not
  reverse all posting side effects. The UI mirrors that gate and write access.
- Scheduled activities now attach to sales orders, purchase orders, invoices,
  employees and transfers through the backend's typed target enum. Unsupported
  record models cannot create unattached activities.
- Transfer command exposure and invalidation declarations are reviewed producer
  inputs; contracts v0.3.85 were published and pinned through the repository
  workflow, including its regeneration drift check.

## Validation (2026-10-07)

- Full UI Vitest suite: 304 tests passed; final guard regression run: 11 tests passed.
- Real Next.js/Chromium navigation fixture: 7 tests passed, covering push/replace,
  Next Link, browser back/forward, router back across pages, pending saves and
  inline-edit unload protection. Run with `pnpm --dir frontend/web test:e2e:navigation`.
- UI, web and query-hooks TypeScript checks passed against contracts v0.3.85.
- Web unit suite: 50 test files passed. Pass 9 payload/readback tests and existing
  canonical operation-effect tests passed.
- Rust `cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests` passed.
  The contracts workflow compiled and published the backend module to its local
  SpacetimeDB instance before generating the release.
- i18n duplicate/static-key checks and production operation transport check passed.
- The opaque-record ratchet remains identical to the unchanged base: 2,226
  occurrences against the 2,071 baseline. This work does not increase it.

## Remaining acceptance work

- Full seeded ERP browser/runtime acceptance and native reducer execution have
  not been run; the isolated navigation browser fixture covers the actual Next
  router but does not exercise authenticated business workflows.
- Archive/duplicate commands and child-line copy semantics remain separate work.
- The provider integrates with the pinned Next 16 App Router context. Run the
  navigation browser suite when upgrading Next or changing router providers.
