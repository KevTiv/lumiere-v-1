# Owner Reporting and PDF Plan

## Scope

Deliver owner-facing operational reports and PDFs through typed, scoped report
schemas. The default pipeline is:

```txt
scoped query result -> typed report schema -> React/HTML report component
-> PDF renderer -> stored document -> audit log
```

AI can explain or request a report but does not supply raw, untrusted HTML as the
default rendering mechanism.

## Current Codebase References

- `spacetimedb/src/analytics/reports.rs`: report templates, scheduled reports,
  saved reports, and analytics metrics.
- `spacetimedb/src/accounting/financial_statements.rs` and
  `spacetimedb/src/accounting/bank_reconciliation.rs`: existing financial report
  and reconciliation foundations.
- `frontend/web/app/(modules)/reports/reports-client.tsx`, `query-builder.tsx`,
  `pivot-explorer.tsx`, and `vat-report-panel.tsx`; query hooks are in
  `frontend/packages/query-hooks/src/hooks/reports.ts`.
- `api-server/src/routes/documents.rs`: current controlled `printpdf` and XLSX
  renderers (`financial_report_pdf`, `sale_order_pdf`, `account_move_pdf`).
- `spacetimedb/src/documents/documents.rs` and `templates.rs`: documents,
  versions, templates, and mail-template patterns.

## 1. Current Codebase Evidence

Generic report configuration and financial reports exist, as do controlled PDF
and XLSX endpoints. The document renderer currently converts prepared lines into
simple `printpdf` output and does not store an owner report document/version or
provide a typed report catalogue. The reports UI also exposes query/pivot tools;
those are not a safe replacement for SME daily owner reports.

## 2. Proposed Architecture

Create a report catalog with explicit report IDs and TypeScript/Rust-compatible
schemas. Each report service receives only `ReportScope` (`organization_id`,
`company_id`, date range, timezone, user permissions) and returns a typed DTO.
React report components render that DTO for browser preview/HTML, while a
server-side renderer produces the PDF. Persist the schema version, inputs,
source-data watermark, hash, renderer version, and generated `Document` ID.

Initial catalog:

1. Daily Business Summary
2. Cash & Mobile Money Report
3. Unpaid Customer Balances
4. Supplier Payables
5. Low Stock Report
6. Stock Movement Report
7. Sales by Product
8. Purchase Spend Report
9. Payment Fee Summary
10. Monthly Owner Report

## 3. Backend Changes

1. Add a report service layer (for example `api-server/src/reports/`) that calls
   approved repository/query methods rather than exposing generic SQL. Keep
   aggregation logic close to accounting, sales, purchasing, inventory, and
   payment read models; do not put business calculations into UI components.
2. Define stable schemas such as `DailyBusinessSummaryReportV1` and
   `CashMobileMoneyReportV1`, with amounts/currency/date/timezone fields typed,
   sources/caveats explicit, and only masked party identifiers by default.
3. Add an org/company-scoped `GeneratedReport` (or extend `FinancialReport` only
   if its lifecycle matches) with report key, schema version, parameters JSON,
   state, source watermark, document ID, generated-by, and audit correlation ID.
   Reuse `Document`/`DocumentVersion` for content metadata and retention.
4. Add protected routes beneath the existing `api-server` documents/report
   routers for preview, render, and download. The Next app proxies through new
   `frontend/web/app/api/reports/*` routes after session and company validation.
5. Select a production-capable HTML-to-PDF renderer after a short spike. Existing
   `printpdf` can remain for simple transactional documents, but typed report
   templates need pagination, tables, locale-aware currency/date formatting, and
   visual regression fixtures. The server must render from in-process templates,
   not model-provided HTML.
6. Make exports bounded by report-specific filters, max page/row counts, and
   permission. Existing `ReportTemplate` remains for administrative templates;
   it is not an escape hatch around typed owner reports.

## 4. Frontend Changes

1. Add an `Owner reports` tab to `reports-client.tsx` with date/company control,
   small report cards, explicit scope, preview, PDF/XLSX commands, generated-at,
   and source caveats. Keep generic query builder/pivot explorer separately
   permissioned.
2. Add shared report DTO types and param mappers under `frontend/packages/erp-shared`;
   add focused hooks to `hooks/reports.ts` and command/query definitions rather
   than client-side aggregation from full-table subscriptions.
3. Implement report React components in a reusable package or web feature
   directory. Use them for browser preview and a controlled server render entry;
   do not duplicate report formatting in each page.
4. Link report lines to scoped CRM, payment, stock, invoice, purchase, and sales
   detail routes while respecting field access. Add report history and document
   download in the Documents module.

## 5. AI/Harness Changes

`report-composer` selects a catalog key and safe parameters, calls only the
corresponding scoped service, then provides a summary/table/PDF reference. Green
skills may run approved reports and explain totals. An AI-generated report
template starts as a skill/report draft and must be reviewed, fixture-tested,
and promoted before it can join the catalogue. Sensitive exports and scheduled
distribution are red actions requiring approval.

## 6. Permissions and Audit Requirements

- Check report and source-module permissions as the intersection of access, not
  merely `report:read`. Restrict finance reports, payment references, and staff
  identifiers by field policy.
- Record report key/version, inputs, caller, source watermark, output hash,
  rendering outcome, document ID, download/export event, and any AI skill/run.
- Default AI/report output masks phones and payment references; allow targeted
  reveal only with permission and an audit event. Cap report windows and rows.

## 7. E2E Test Requirements

1. Seed a day with sale, purchase, cash/mobile-money payment, fee, and stock
   movement; generate Daily Business Summary and Cash & Mobile Money PDF; assert
   totals, document storage, and audit.
2. Validate AR/AP reports against partial payment allocations and reversal.
3. Validate low-stock, movement, sales-product, and purchase-spend dates/company
   filters; ensure a second company cannot influence or retrieve the output.
4. Exercise monthly owner report pagination and locale formatting using a large
   fixture. Add PDF visual regression and text-extraction assertions.
5. Assert a user without sensitive export permission receives masked/denied
   output and an AI report request cannot widen the date/company scope.

## 8. Risks / Open Questions

- Decide server renderer/runtime deployment constraints before choosing the
  HTML-to-PDF library.
- Define whether owner reports use accounting close, operational timestamps, or
  both; show the cutoff/watermark visibly.
- Confirm report retention, regeneration, and document immutability rules.

## 9. Suggested Implementation Order

1. Approve catalogue definitions, exact calculations, schemas, and cutoffs.
2. Implement scoped aggregators and browser previews for Daily Summary, Cash &
   Mobile Money, AR/AP, and Low Stock.
3. Add typed PDF renderer, generated document records, and audit.
4. Add remaining reports, XLSX exports, report history, and schedules.
5. Connect green AI report skills after the non-AI report contract is proven.

## Milestones and Acceptance Criteria

- Each report has an approved schema, deterministic fixture, scoped source
  query, visible cutoff, stored output, and audit event.
- PDF totals match preview/export fixture totals and no raw AI HTML is rendered.
- The initial owner catalogue supports a distributor's daily close without
  requiring the generic query builder.

## Security and Privacy Considerations

Report endpoints must not accept arbitrary query expressions, table names, or
unbounded data ranges. Store only authorized output, enforce document access on
download, and redact sensitive identifiers before AI composition or broad report
sharing.
