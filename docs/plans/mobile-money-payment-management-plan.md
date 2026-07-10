# Mobile-Money Payment Management Plan

## Scope

Create a first-class operational payment module for cash, bank, and mobile
money. It must extend accounting's existing `AccountPayment` and bank
reconciliation flows, not create a second AR/AP or general-ledger system.

## Current Codebase References

- `spacetimedb/src/accounting/payments.rs`: `AccountPayment`,
  `create_payment`, `post_payment`, `cancel_payment`, and
  `register_payment_on_invoice`.
- `spacetimedb/src/accounting/journal_entries.rs`: invoice/bill `AccountMove`
  and residual/payment state foundations.
- `spacetimedb/src/accounting/bank_reconciliation.rs`: statement, statement
  line, `reconcile_account_bank_statement_line`,
  `unreconciled_account_bank_statement_line`, and match rules.
- `frontend/packages/query-hooks/src/hooks/accounting.ts`: `useAccountPayments`
  plus payment mutations; `frontend/web/app/(modules)/accounting/accounting-client.tsx`
  is the existing module UI.
- `spacetimedb/src/crm/contacts.rs` and `crm/duplicate.rs`: customer/vendor
  party data and name/phone duplicate handling.
- `spacetimedb/tests/accounting/payments_test.rs` and
  `frontend/web/tests/e2e/accounting-mutations.spec.ts`: current payment test
  starting points.

## 1. Current Codebase Evidence

`AccountPayment` records direction, partner, total amount, journal, one free
reference, and lists of reconciled invoice/bill IDs. Posting creates an
`AccountMove`; cancellation marks the payment reversed. This is a workable
accounting owner, but the list-of-IDs design cannot represent per-document
allocation amounts, fees, provider evidence, duplicate reference state, or an
immutable reversal/correction relationship. Bank statement reconciliation is a
related integration point, not a mobile-money account model.

## 2. Proposed Architecture

Use a payments submodule beneath accounting with these distinctions:

```txt
PaymentProvider -> payment method classification and reference validation
PaymentAccount  -> company-owned cash drawer, bank, or provider wallet; maps to AccountJournal
PaymentTransaction -> operational transaction and provider evidence; one-to-one with AccountPayment after posting
PaymentReconciliation -> immutable allocation from a posted transaction to an invoice/bill/residual
PaymentFee -> fee components and their expense/tax treatment
PaymentReversal -> correction relationship to the original posted transaction
PaymentStatementImport -> batch/staging/audit metadata; imported lines reuse AccountBankStatementLine
```

`AccountPayment` and its generated `AccountMove` remain the accounting posting
record. `PaymentTransaction` is the operational envelope and references
`account_payment_id` once posted. Reconciliation rows become the allocation
source of truth; legacy invoice/bill ID arrays remain compatibility projections
until all readers migrate. `PaymentAccount.account_journal_id` ensures every
cash, bank, or wallet balance follows the existing journal/ledger path.

## 3. Backend Changes

1. Add `accounting/payment_management.rs`, export it from
   `spacetimedb/src/accounting/mod.rs`, and register typed tables/reducers.
   Every table needs `organization_id`, `company_id`, timestamps, actor fields,
   organization/company indexes, and immutable references after posting.
2. Define `PaymentProviderCode` as an enum: `Mtn`, `Orange`, `Airtel`, `Mpesa`,
   `Moov`, `Wave`, `Cash`, `Bank`, `Other`. Store provider configuration at the
   org level and account settings at company level. `Other` requires a label.
3. Define `PaymentAccount` with provider, display name, normalized account/phone
   reference, currency, account journal, optional clearing/fee accounts, active
   state, masked display value, and provider metadata. Enforce one primary
   account only when the product requires it; do not make wallet identity a
   secret.
4. Define `PaymentTransaction` with direction, party, provider/account,
   external reference, amount, currency, occurred-at, status
   (`draft|posted|reversed|voided`), `account_payment_id`, source entity,
   payment evidence document IDs, and a normalized reference fingerprint.
   Add a uniqueness guard scoped to `company_id + payment_account_id +
   normalized_reference` for nonempty external references. Return an actionable
   duplicate conflict with the existing transaction ID; do not silently merge.
5. Define `PaymentFee` as one or more immutable components with payer
   (`company|customer|supplier`), amount, fee account, tax behavior, and
   provider reference. Payment posting validates `gross = settled + fees` under
   the agreed policy and creates balanced accounting lines via the existing
   posting builder.
6. Replace/augment `register_payment_on_invoice` with allocation reducers:
   create/revise draft allocation, validate party/currency/company, then post
   allocations atomically with the payment. `PaymentReconciliation` records
   applied amount, write-off policy, residual before/after, and linked account
   move line. Support many invoices/bills, many payments, and partial amounts.
7. Reversal must create `PaymentReversal` and a compensating `AccountPayment`/
   `AccountMove`, reverse allocations with references, and preserve the original
   transaction. Do not use the current state flip alone for posted mobile-money
   corrections. Permit draft void separately.
8. Provide scoped read-model reducers/services for customer balance, supplier
   balance, account daily opening/movement/closing balance, fee summary,
   unreconciled transaction queue, and provider-reference duplicate scan.
9. Add statement-import metadata and staging tables later. Parse CSV/SMS exports
   to a safe staging schema, use idempotency fingerprints, then create existing
   `AccountBankStatement`/line records. Auto-match remains suggestions only;
   it must call the normal reconciliation reducer after approval.

## 4. Frontend Changes

1. Add an Accounting `Payments` workspace/tab before creating a separate top
   navigation module. Reuse `accounting-client.tsx`,
   `accounting-entity-configs.ts`, `accounting-form-configs.ts`, and
   `hooks/accounting.ts`; split into a dedicated component only when the module
   becomes too large.
2. Add shared typed param mappers in `frontend/packages/erp-shared/src` and BFF
   command definitions in `frontend/packages/stdb/src/commands/accounting-http.ts`.
   Query hooks should follow the existing `useAccountPayments` cache keys and
   subscription invalidation pattern.
3. Create forms for provider/account setup, incoming/outgoing transaction,
   allocation, reversal/correction, and statement-import preview. Phone/account
   fields use normalized display with masked defaults and permission-aware reveal.
4. Provide payment lists filtered by status/provider/account/party/date, an
   allocation drawer with invoice/bill residuals, duplicate-reference warning,
   receipt preview, and a day-close report. Sales invoice, purchase bill, and
   CRM contact views should launch prefilled payment/allocation flows, not own
   separate forms.
5. Extend contact detail pages with computed `Customer balance` and `Supplier
   balance` tabs plus payment timeline entries. Add `whatsapp_phone` and
   mobile-money account references through the phone-first contact model, not
   through payment account configuration.

## 5. AI/Harness Changes

Green skills may report daily wallet balances and flag duplicate references using
masked, scoped results. Amber may draft an allocation suggestion. Registering or
reversing a payment and bulk reconciliation are red: the AI produces only an
`AiActionDraft` with exact allocations, fee lines, and correction plan. It must
not invent provider references or post directly.

## 6. Permissions and Audit Requirements

- `payment_account`: create/write/archive; `payment_transaction`: create/post/
  reverse/view-reference; `payment_reconciliation`: create/approve; statement
  import and sensitive exports each need distinct permissions.
- Use field-level policies for phone, wallet/account references, evidence, and
  fee details. AI/report outputs show masked values by default.
- Audit provider/account edits, duplicate overrides, transaction creation/post,
  allocations, reversal links/reasons, statement import, manual match, and all
  exports. Capture source document/import/AI draft IDs and actor/approver.
- Enforce company ownership in reducers and the existing BFF
  `validateCompanyScope` pattern. Check open fiscal periods before a post or
  correction.

## 7. E2E Test Requirements

1. Configure MTN wallet and cash account; record an incoming customer payment
   with external reference and partial allocation across two invoices.
2. Reject duplicate provider reference within the same wallet/company while
   allowing an intentionally distinct provider/account scope.
3. Record outgoing supplier payment with fee; assert the posted account move,
   allocation residual, supplier balance, and daily report are correct.
4. Reverse a posted transaction; assert compensating entry, restored residual,
   immutable original, audit trail, and distinct approver requirement.
5. Import a statement CSV into staging; preview/reject malformed rows; approve
   manual match; verify idempotency on retry. Add SMS export fixtures only after
   a representative provider format is approved.
6. Assert a user from another company cannot view/create/reconcile transactions
   and an AI red-action draft cannot post without approval.

## 8. Risks / Open Questions

- Exact provider reference formats and fees vary by country; validation should
  be configurable, not hard-coded to a single provider format.
- Decide whether fees reduce received cash, are charged separately, or are
  absorbed. The accounting policy is required before reducer design.
- Confirm multicurrency/FX and offline cash-drawer needs for the first market.
- Existing `cancel_payment` semantics must be migrated without changing prior
  posted records unexpectedly.

## 9. Suggested Implementation Order

1. Approve accounting/allocation and provider data contracts.
2. Build `PaymentProvider`/`PaymentAccount`, typed commands/hooks/forms, and
   manual transaction draft flow.
3. Add postings, allocation rows, balances, fees, duplicate guard, and E2Es.
4. Add correction/reversal and approvals; migrate legacy cancellation UI.
5. Add daily report and contact timeline drilldowns.
6. Add statement staging/import, then approved matching suggestions.

## Milestones and Acceptance Criteria

- A posted transaction is uniquely traceable to provider evidence, account,
  journal entry, allocations, and audit record.
- Partial payments and fees reconcile without mutating invoice/bill history.
- A reversal is compensating and auditable, never a destructive overwrite.
- Manual cash/mobile-money operation works before any provider API integration.

## Security and Privacy Considerations

Never store provider access credentials in these tables; only secret references
may be persisted. Normalize and hash/index references carefully while retaining a
masked display field. Limit imported statements, operational exports, and AI
outputs by company, date range, permission, and field masking.
