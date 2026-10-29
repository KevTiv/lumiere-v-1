# Productivity UI fixture evidence

The images in this directory show production FileBrowser, CalendarView and MessageConversationWorkspace components with explicitly synthetic scoped records and callbacks. They are not screenshots of a deployed alpha tenant. The fixture performs no ERP business operations and does not establish authentication, backend authorization or durable posting.

Source application base: `eeb44cf50474697da2a19f28841a74e13df6cf2c`. Contracts dependency: `0.3.157`. The implementation under review is the working branch diff on that base.

The preview route is `frontend/web/tests/accounting-ui-fixture/app/productivity/page.tsx`; the grouped navigation check reuses `/navigation` with the production workspace-navigation metadata. The fixtures label their synthetic boundary on screen.

The browser suite is `frontend/web/tests/productivity-workspace-ui.spec.ts`, configured by `frontend/web/playwright.productivity-ui.config.ts`. Run from `frontend/web`:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm test:e2e:productivity-ui
```

Coverage at 390px and 1440px includes folder/search/layout preservation through record selection, Back and reload; per-file unconfirmed upload feedback; date-grouped agenda, multi-day/all-day/cancelled events and exact event links; keyboard activation without nested buttons; source-safe conversation grouping; draft retention after a rejected reply; read-only reconciliation after an uncertain reply; context remount; and grouped navigation/direct tab URLs with Back, Forward and reload.

The calendar New event interaction in this fixture verifies the real toolbar callback only. The fixture document detail is a labelled synthetic destination. Neither proves actual event creation or document registration. Message success/rejection/check-outcome callbacks model the UI states; canonical message transport and readback need their separate model/backend coverage.

The final application/CI checks and any live-environment acceptance are recorded in the PR. Prior-source screenshots were not captured before concurrent implementation began; none of these images is labelled as a before image.

The final captures were taken with Node `22.23.3`, Chromium `/usr/bin/chromium` and browser timezone `Europe/Amsterdam`. Capture-time `pageerror` and `console.error` collections were empty. Calendar and Messages now defer local clock formatting until browser hydration; the initial server-rendered output is deterministic. Earlier development captures were replaced after this issue was corrected.

Validation result: the guarded Node 22 browser pass completed eight non-file scenarios successfully. Its two file scenarios ran the pre-fix test sequence and reached the upload input before post-reload hydration. The tests now explicitly await hydration after reload; both corrected file scenarios passed in the focused rerun (13.4 seconds), including console-error and page-error assertions. All ten distinct scenarios therefore have passing coverage. This is recorded as eight successful cases plus a focused correction, rather than an uninterrupted ten-test pass.

## Integrated local checks

- Web and shared UI TypeScript checks passed using Node 22 with a 6 GiB heap.
- Full shared UI run: 185 files / 1,283 tests passed. After the final refinements, all 24 focused file-browser/calendar/date/scoped-query tests passed.
- Full query-hook run: 97 test files passed. The changed realtime-invalidation and message-readback test files also passed after the final edits.
- All 11 productivity model test files passed, covering navigation, source identity, dates, exact document return context and message threads.
- Changed-file lint passed with no errors. Three unused-variable warnings already present on main remain in Documents and the sales approval test.
- Translation keys/duplicate keys, shared Select controls, immutable operation transport, opaque-record ratchet (unchanged at 2,298), vendored contracts pin 0.3.157 and whitespace checks passed.

The exact branch's GitHub CI is a separate check. Authenticated ERP journeys and release admission against the intended alpha environment have not been executed by these fixtures.
