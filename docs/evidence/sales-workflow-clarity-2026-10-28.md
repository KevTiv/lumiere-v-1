# Sales workflow clarity

Date: 2026-10-28. The branch changes the Sales UI and quotation create readback. It does not deploy the alpha or change economic transitions.

## Behavior

- Sales opens Quotations & orders. Both list creation and the dashboard action say New quotation; the form continues to save a draft header with the existing required customer, price list and warehouse choices.
- Each create carries a random receipt in ordinary order metadata. After an acknowledged save, an exact receipt match within the organization and company opens that quotation's product-entry tab. Names, references, list order and newest-row inference are not used. Missing, duplicate or unreadable matches leave a saved notice and the order list; they do not repeat creation. Existing metadata is preserved. This receipt is a navigation correlation, not a server idempotency key.
- The order page recommends adding products, sending, recording acceptance, confirmation, approval review, delivery or invoicing according to the current record. Other valid workflow actions remain available. Confirmation gets a review dialog, and workflow failures remain visible beside the recommendation. Canonical workflow commands and server eligibility checks remain authoritative.
- The overview contains the existing editable product grid, canonical totals in the order currency, and delivery/invoice/payment links alongside order details. Missing amounts/currencies and unavailable reads are identified rather than displayed as zero or as an empty order. Locked quotations cannot edit lines.
- Needs attention labels the existing operational queues. Queue read failures and permission denials have explicit states; denied queues are omitted from the available queue buttons unless currently selected. Specialist tools remain available in an expandable section below the daily queues.

## Visual evidence

[Before](sales-workflow-clarity-2026-10-28/before.png), [after](sales-workflow-clarity-2026-10-28/after.png), and a self-contained [comparison](sales-workflow-clarity-2026-10-28/comparison.html) render production presentation components with synthetic data. The baseline reproduces the previous overview composition; it is not a capture of the deployed alpha. Fixture callbacks update local state, not persisted ERP records.

The grouping of order status, items, payment and customer details uses the structure shown in [Uvodo](https://mobbin.com/screens/fe8a0809-20d7-4e46-ac24-d052bf918910) as an example. [Selfridges](https://mobbin.com/screens/b8be453c-f842-4306-981d-fbccf00e27a5) supplies a second example of grouping order status, total, delivery details and items. The retail reference supplies structure only. Quotation wording, recommendation rules and placement are implementation judgments based on this repository's workflows. The existing components, theme and tokens supply appearance.

## Local validation

- Web TypeScript check with a larger Node heap: passed. The initial default-heap invocation exhausted memory; the completed larger-heap check supersedes that attempt.
- Query-hooks TypeScript check: passed.
- Seven focused web test files passed: next-step guidance, order status, line gates, returns, KPIs, commission plans and workspace navigation.
- Create receipt/command tests and existing sales lifecycle command tests passed. They cover exact scope and large IDs, unrelated newer drafts, ambiguous receipts, preserved metadata, rejected creation and failed readback without a repeated write.
- All seven Playwright checks passed using Chromium: the guided quotation sequence, empty quotation product entry, visible blockers, unavailable lines, and viewport containment at 390, 768 and 1440 pixels.
- Locale duplicate-key and static-key checks, opaque-record ratchet, browser operation transport check and `git diff --check` passed. The opaque-record baseline records the removal of one cast.

Reproduce the browser checks with `pnpm --dir frontend/web test:e2e:sales-workflow`. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using an existing Chromium binary. Setting `SALES_WORKFLOW_REVIEW_DIR` also captures the before/after panes during the desktop check. The PR adds this browser suite to the existing frontend CI job.

The authenticated draft-create helper now asserts navigation to the exact saved quotation and its guidance. That live-stack assertion, stock/credit/approval consequences, operator task testing and deployed alpha smoke checks have not been executed in this environment. No claim of persisted end-to-end acceptance or measured utilization improvement is made.
