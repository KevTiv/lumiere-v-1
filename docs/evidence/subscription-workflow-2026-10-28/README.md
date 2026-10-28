# Subscription workflow UI validation

This change is based on `a38badfc` and improves the subscription module's existing workflows. The screenshots use synthetic read projections rendered by production components, not the deployed alpha or live financial records.

## Behavior

- Overview queues link to drafts, billing exceptions, overdue collections and paused subscriptions for the selected organization and company. Unavailable reads show their status instead of zero. Existing currency-scoped charts remain; the old unsupported dollar aggregate tiles are removed.
- Creation follows Sales order, Plan, Billing schedule, Review & create. Only confirmed orders and active company plans are offered. The summary identifies the order, customer when readable, order currency/total and schedule. Plan defaults populate the schedule. Setup links preserve the open creation flow; Back and rejected submissions preserve values.
- A subscription has one recommended header action based on verified contract lines, linked invoice balances and its billing date. Other operations remain under Manage subscription; usage and collection tools are grouped there. All 17 module destinations retain their canonical routes through the three main workspaces and Advanced tools.
- Every lifecycle/billing operation opens a review form and awaits its mutation. Rejection leaves the dialog and entries available; pending actions cannot close the dialog. Invoice, payment, amendment, renewal, pause and cancellation previews describe their actual effects. Exact tax/usage/proration results remain calculated by the existing server operations.
- Record payment applies money already received. Request payment creates a request with a stable key for retries within that dialog and does not claim receipt. Both use linked invoices instead of a manually entered invoice ID. Payment is bounded by the current outstanding amount. Already posted invoices no longer require inventory-posting accounts.
- Cancel initially leaves credit creation unchecked and requires a linked posted invoice when a credit is requested. Close explicitly creates no credit. Both explain immediate contract closure and access revocation.

The existing reducer contracts, financial rules and backend permission checks are unchanged. The UI additionally checks operation permissions and record scope before dispatch. Journal defaults come only from the selected plan's active sales journal; accounting mappings are not guessed.

## Verification

| Check | Result |
| --- | --- |
| Subscription workflow, action, status, plan, payment-intent, chart and creation-parameter tests | 38 passed, no skips |
| Production-component browser tests at 1440×900 and 390×600 | 8 passed |
| Web TypeScript | Passed separately from Next, whose existing config skips type validation |
| Changed subscription/config/fixture lint | Passed |
| English duplicate-key and static translation-key checks | Passed |
| Shared Select and browser operation-transport guards | Passed |
| Opaque-record ratchet | 2,299 occurrences, down from 2,310; allowlist unchanged |
| Canonical Next production build | Passed; 113 generated pages |

Browser cases exercise company-scoped queues, denied collections, preserved advanced links, all creation steps and Back, one rejected create request, missing-plan recovery controls, a single recommended payment action, invoice balance preview, and retained payment fields after rejection. The API provider is installed in the fixture. HTTP writes are intercepted and rejected; payment preflight reads return the synthetic invoice so the actual dispatch path is exercised.

Focused test commands, from `frontend/web`:

```sh
node --import tsx --test --test-isolation=none 'app/(modules)/subscriptions/subscription-workflow.test.ts' 'app/(modules)/subscriptions/subscription-actions.test.ts' 'app/(modules)/subscriptions/subscription-status.test.ts' 'app/(modules)/subscriptions/subscription-plan-actions.test.ts' 'app/(modules)/subscriptions/subscription-plan-edit.test.ts' 'app/(modules)/subscriptions/subscription-payment-intent.test.ts' 'app/(modules)/subscriptions/subscription-dashboard-charts.test.ts' lib/subscriptions-create-params.test.ts
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node node_modules/@playwright/test/cli.js test --config playwright.subscriptions-ui.config.ts
NODE_OPTIONS=--max-old-space-size=6144 node node_modules/typescript/bin/tsc --noEmit
NODE_OPTIONS=--max-old-space-size=6144 node node_modules/next/dist/bin/next build
```

The unit test is also included in `test:unit`; the browser suite is available through `test:e2e:subscriptions-ui`. The explicit no-isolation unit invocation runs the named tests in this Node 24 environment.

## Visual evidence

- [Overview comparison](comparison.png), with a [standalone HTML comparison](comparison.html).
- [Before](overview-before.png) and [after](overview-after.png), captured with the same synthetic records and viewport. The baseline was rendered from a separate checkout of `a38badfc` with its original translations.
- [Creation on desktop after rejection](creation-desktop.png), [creation on mobile after rejection](creation-mobile.png), and [payment on mobile after rejection](payment-mobile.png).

The overview captures omit the fixture controls and development overlay. The bounds JSON files record browser measurements for the comparison's navigation and queue outlines. The comparison covers the overview; the creation and payment captures show the other workflows separately.

Reference examples inspected through the Mobbin redesign skill: [Square's grouped plan form](https://mobbin.com/screens/11a8090c-5eb8-49a8-b27a-0213edb876ca) and [Quo's billing summary beside confirmation](https://mobbin.com/screens/f5ead7a1-01d9-41d2-8761-9940922cc428). They inform grouping and review placement. Lumiere's existing components and theme are retained. The overview queues and their wording implement the requested workflow, rather than a claim about those references.

## Limits

No deployment or authenticated financial write was performed. These tests establish UI behavior and rejected-request retention, not end-to-end financial posting or recovery from an ambiguous committed write. A renewal-review link is provided, rather than an invented count of expiring contracts: the current subscription read projection does not include a contract end date. Exact renewal/proration outcomes remain visible through the existing saved records.
