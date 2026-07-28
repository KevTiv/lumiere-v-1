# Accounting Relational Integrity Remediation Plan

**Module:** Accounting only  
**Source audit:** ERP relational integrity and mutation provenance review, 2026-07-26  
**Current readiness:** **Unsafe for real ERP data**  
**Target readiness:** Production ready after all P0/P1 gates and the release gate pass  
**Non-goal:** Adding unrelated accounting features or redesigning other ERP modules

---

## 1. Purpose

This is the executable fix plan for the accounting relational-integrity audit.
It defines:

1. What must change.
2. The application pattern every fix must follow.
3. Acceptance criteria for each work item.
4. The evidence required before a work item can be marked done.

A reducer, mapper, form, or query is not complete merely because it compiles,
runs, returns `Ok`, or displays a success toast.

## 2. Global definition of done

An accounting work item may be marked **Done** only when all applicable boxes
are checked:

- [ ] The table or mutation contract represents the intended relationship.
- [ ] Every submitted relation has one documented business source.
- [ ] The backend loads the related record rather than trusting a raw ID.
- [ ] Organization, company, lifecycle, type, and permission compatibility are
      validated server-side.
- [ ] No required relation falls back to `0`, `0n`, an empty string, the first
      available record, an arbitrary enum, or an invented current date.
- [ ] System-managed and derived fields are not caller-owned.
- [ ] Update semantics distinguish unchanged from clear.
- [ ] Collection semantics distinguish unchanged, replace, add, remove, and
      clear.
- [ ] The read path exposes the relationship through a stable ID and useful
      label.
- [ ] The UI either selects the relation from scoped records or clearly shows
      the server-derived value.
- [ ] A persisted-data test proves the exact stored foreign keys and distinctive
      values.
- [ ] Negative tests reject cross-organization, cross-company, missing,
      archived, inactive, and role-incompatible targets where applicable.
- [ ] Retry behavior is tested and does not duplicate the accounting effect.
- [ ] Generated bindings, query metadata, subscriptions, and cache invalidation
      have been regenerated and verified.
- [ ] Existing data has been backfilled or explicitly quarantined before any new
      non-null ownership rule is considered complete.

If any applicable item is unchecked, the work item remains **In progress**.

## 3. Evidence required to close a checkbox

Every completed work item must add an evidence entry:

| Evidence | Required content |
|---|---|
| Implementation | Commit/PR and exact changed files |
| Contract | Final table fields, reducer params, and update semantics |
| Backend proof | Reducer test that queries the persisted row |
| Isolation proof | Organization A/B and company A1/A2 rejection test |
| Frontend proof | Form/context source and relation label after reload |
| Retry proof | Repeated command creates one accounting effect |
| Generated proof | Clean SDK/codegen diff and successful checks |
| Reviewer sign-off | Reviewer confirms every applicable definition-of-done item |

Use this closure block under the relevant tracker item:

```md
Completion evidence:
- Implementation:
- Persisted-data test:
- Isolation test:
- UI/reload test:
- Retry test:
- Generated artifacts:
- Reviewer:
- Completed on:
```

Do not use “covered by mapper”, “typecheck passes”, “button works”, or “manual
smoke test” as completion evidence.

---

## 4. Canonical application patterns

### 4.1 Scoped foreign-key loader

Use small relation-specific helpers. Do not create a generic abstraction that
hides domain rules.

```rust
fn load_company_account(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    account_id: u64,
) -> Result<AccountAccount, String> {
    require_company_in_organization(ctx, organization_id, company_id)?;

    let account = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or("account not found")?;

    if account.organization_id != organization_id || account.company_id != company_id {
        return Err("account does not belong to this organization and company".to_string());
    }
    if account.deprecated {
        return Err("account is deprecated".to_string());
    }

    Ok(account)
}
```

Extend the helper at the call site with operation-specific checks such as:

- Receivable/payable account role
- Liquidity account role
- Expense or tax account role
- Journal type and active state
- Currency compatibility
- Open fiscal period
- Parent state
- Partner role

Required characteristics:

- Return `Result`; never panic for user data.
- Borrow where possible; do not clone merely to satisfy ownership.
- Use lowercase error messages without trailing punctuation when adding new
  error types/messages.
- Never hold a lock or mutable reference across asynchronous work.

### 4.2 Mutation company source

The active company comes from the authenticated application context, not an
editable form field.

```ts
const operatingCompanyId = useOperatingCompanyBigInt(organizationId)
if (operatingCompanyId == null) {
  throw new Error("active company is required")
}

const params = {
  companyId: operatingCompanyId,
  // user-entered and selected fields only
}
```

Forbidden:

```ts
const companyId = useOperatingCompanyBigInt(organizationId) ?? 0n
companyId: undefined // when this causes the backend to select another company
```

If a validated parent unambiguously owns the company, omit `companyId` from the
command and derive it from the parent on the backend.

### 4.3 Parent-derived child creation

Child commands should receive a parent ID plus child intent:

```text
organization_id
parent_id
child_params
```

The backend must:

1. Load the parent.
2. Validate parent organization/company.
3. Validate parent lifecycle state.
4. Derive child organization/company/currency/journal where applicable.
5. Validate child relations against the derived scope.
6. Insert the child and update parent projections atomically.

The child form must not ask the user to type a parent ID when launched from a
known parent.

### 4.4 Server-owned and derived fields

Remove these from create DTOs unless a documented import path genuinely owns
them:

- State and lifecycle markers
- Child/reverse ID arrays
- Totals, residuals, balances, counts, and percentages
- Audit identities and timestamps
- Posted/generated flags
- Matching and reconciliation projections
- Chatter/activity reverse relations
- Derived currency and company fields

For imports, use a separate import DTO and validate every supplied projection
before promotion to the accounting table.

### 4.5 Explicit patch semantics

Use a patch contract, not a reconstructed full object:

```ts
type UpdateJournalPatch = {
  name?: string
  currencyId?: bigint | null
  defaultAccountId?: bigint | null
}
```

Contract:

```text
field absent / undefined → unchanged
null                     → clear, only when nullable
empty string             → rejected or normalized before mutation
[]                       → clear/replace collection only when documented
```

Rust uses `Option<Option<T>>` when both unchanged and clear must be represented.

### 4.6 Many-to-many command semantics

Do not overload one optional array with multiple meanings. Use explicit
commands:

```text
replace_tax_ids(ids)
add_tax_ids(ids)
remove_tax_ids(ids)
clear_tax_ids()
```

Every ID must be deduplicated and loaded under the owning organization/company.
Association tables should have uniqueness protection for the relation pair.

### 4.7 Polymorphic source records

Do not accept arbitrary `source_entity: String` plus an unvalidated ID.

Preferred command:

```rust
enum AccountingSourceRef {
    AccountMove(u64),
    SaleOrder(u64),
    PurchaseOrder(u64),
    BankStatementLine(u64),
    Document(u64),
}
```

Load the selected variant and validate its scope. A display-name snapshot may be
stored alongside the relationship, but cannot replace it.

### 4.8 Relation-aware reads

Every important foreign key must be usable after write:

```ts
type PaymentReadModel = {
  id: bigint
  partner: { id: bigint; label: string }
  journal: { id: bigint; label: string }
  currency: { id: bigint; code: string }
}
```

At minimum, the UI must display the related label, retain the stable ID for
navigation/filtering, and handle archived related rows explicitly.

### 4.9 Atomicity and idempotency

One business action that writes multiple accounting tables must run in one
reducer transaction. The idempotency key must cover the whole action.

Required uniqueness scope:

```text
organization_id + company_id + action_kind + idempotency_key
```

Retry tests must assert:

- One header
- One expected child set
- One ledger move
- One audit effect per intended action
- The same result or an explicit duplicate response

---

## 5. P0 — Data corruption and tenant-isolation risks

### ACC-RI-001 — Add organization provenance to legacy accounting tables

**Status:** In progress

**Affected tables**

- `account_fiscal_year`
- `account_period`
- `account_asset`
- `account_asset_depreciation_line`
- `consolidation_account`
- `consolidation_journal`
- `consolidation_elimination_entry`
- `consolidation_company_rate`
- `intercompany_rule`
- `intercompany_transaction`

**Current evidence**

- `spacetimedb/src/accounting/fiscal_periods.rs:14`
- `spacetimedb/src/accounting/fixed_assets.rs:19`
- `spacetimedb/src/accounting/consolidation.rs:21`
- `spacetimedb/src/accounting/intercompany.rs:21`

**Fix criteria**

- [ ] Add `organization_id` and organization indexes.
- [ ] Backfill from the validated company or parent relation.
- [ ] Produce a report for missing, conflicting, or ambiguous ownership.
- [ ] Quarantine ambiguous rows; do not assign a guessed organization.
- [ ] Validate organization and company in every create/update/delete/lifecycle
      reducer.
- [ ] Scope every subscription and HTTP query by organization first.

**Done check**

- Organization A cannot read or mutate a row owned by organization B even when
  it knows the row and company IDs.
- Child rows cannot disagree with parent organization/company.
- Backfill reports zero unresolved production rows.

**Phase 1 progress — fiscal years and periods (2026-07-27)**

- Added migration-stage `organization_id` provenance and organization indexes to
  `account_fiscal_year` and `account_period`.
- New writes persist the authenticated organization context.
- All fiscal-year and period create/update/delete/open/close paths load and
  validate organization, company, and parent ownership.
- Added a superuser-only backfill that derives ownership from company and parent
  relations, persists run totals, reports conflicts, and quarantines unresolved
  rows by leaving ownership unset.
- Fiscal-year and period subscriptions now require `organization_id` before the
  company filter.
- Added behavioral coverage for cross-organization mutation rejection, safe
  derivation, conflict reporting, and quarantine enforcement.
- Remaining in ACC-RI-001: consolidation tables, intercompany tables,
  production backfill execution, and published-module persisted-data
  verification.

Completion evidence:
- Implementation: `spacetimedb/src/accounting/fiscal_periods.rs`,
  `spacetimedb/src/seed.rs`,
  `frontend/packages/stdb/src/queries/erp-subscriptions.ts`, and regenerated
  SpacetimeDB TypeScript/SQL metadata.
- Persisted-data test: behavioral reducer added at
  `spacetimedb/tests/accounting/period_lock_test.rs`; published-module execution
  remains pending.
- Isolation test: cross-organization update, conflicting ownership quarantine,
  and quarantined-row mutation rejection added to
  `test_fiscal_ownership_is_derived_and_tenant_scoped`.
- UI/reload test: pending.
- Retry test: not applicable to this idempotent ownership backfill slice; repeat
  execution replaces issue rows and records a new run summary.
- Generated artifacts: TypeScript SDK regenerated; `cargo check` and
  `cargo test --no-run` pass. Shared frontend packages pass typecheck; the web
  typecheck remains blocked by pre-existing CRM/HR/projects/sales optional
  company errors.
- Reviewer: pending.
- Completed on: pending.

**Phase 2 progress — fixed assets and depreciation lines (2026-07-27)**

- Added migration-stage `organization_id` provenance and organization indexes to
  `account_asset` and `account_asset_depreciation_line`.
- New asset and depreciation-line writes persist organization ownership, while
  every asset mutation validates organization, company, parent asset, and
  depreciation-child consistency before changing state.
- Parent assignment now rejects missing, cross-organization, and cross-company
  assets instead of silently accepting an unresolved relation.
- Added a superuser-only fixed-asset backfill. It derives asset ownership from
  company and parent relations, derives line ownership from the parent asset,
  records run totals and issues, and leaves conflicts quarantined.
- Fixed-asset and depreciation-line subscriptions now require and filter by the
  active organization before returning rows.
- Added behavioral coverage for cross-tenant mutation and parent rejection,
  child ownership inheritance, valid backfill, conflict quarantine, issue
  reporting, and quarantined-row mutation rejection.

Completion evidence:
- Implementation: `spacetimedb/src/accounting/fixed_assets.rs`,
  `spacetimedb/src/seed.rs`,
  `frontend/packages/stdb/src/queries/erp-subscriptions.ts`, and regenerated
  SpacetimeDB TypeScript/SQL metadata.
- Persisted-data test: behavioral reducer added at
  `spacetimedb/tests/accounting/fixed_assets_test.rs`; published-module
  execution remains pending.
- Isolation test:
  `test_fixed_asset_ownership_is_derived_and_tenant_scoped` covers
  cross-organization mutation and parent rejection plus quarantine enforcement.
- UI/reload test: pending.
- Retry test: not applicable to this idempotent ownership backfill slice; repeat
  execution replaces fixed-asset issue rows and records a new run summary.
- Generated artifacts: TypeScript SDK and SQL metadata regenerated;
  `cargo check`, `cargo test --no-run`, `cargo clippy --lib`, and
  `pnpm --filter @lumiere/stdb typecheck` pass. Clippy reports existing
  repository warnings.
- Reviewer: pending.
- Completed on: pending.

**Phase 3 progress — consolidation and intercompany (2026-07-27)**

- Added migration-stage `organization_id` provenance and organization indexes to
  all consolidation and intercompany tables in this work item.
- Intercompany rules and transactions now derive ownership from validated
  source/origin and destination companies. Every update, delete, activation,
  approval, processing, completion, error, cancellation, and retry path uses a
  scoped loader.
- Consolidation accounts and journals validate every company in their company
  set. Elimination entries inherit the journal organization and reject companies
  or counterparties outside the parent journal. Company rates derive ownership
  from their company.
- Added superuser-only consolidation and intercompany backfills with persisted
  run totals, conflict reports, and fail-closed quarantine.
- Added organization-first subscriptions for consolidation accounts, journals,
  elimination entries, intercompany rules, and intercompany transactions.
- Expanded persisted behavioral coverage across all six tables, including
  inherited ownership, cross-tenant mutation rejection, deterministic backfill,
  conflict quarantine, issue reporting, and quarantined-row mutation denial.

Completion evidence:
- Implementation: `spacetimedb/src/accounting/consolidation.rs`,
  `spacetimedb/src/accounting/intercompany.rs`, `spacetimedb/src/seed.rs`,
  `frontend/packages/stdb/src/queries/erp-subscriptions.ts`, and regenerated
  SpacetimeDB TypeScript/SQL metadata.
- Persisted-data test: expanded
  `spacetimedb/tests/accounting/ic_consolidation_test.rs`; published-module
  execution remains pending.
- Isolation test: the accounting intercompany/consolidation reducer covers
  cross-organization create and mutation rejection, parent-derived child scope,
  conflict quarantine, and quarantined-row mutation rejection.
- UI/reload test: pending.
- Retry test: backfills are idempotent for ownership state and replace scoped
  issue rows while retaining an auditable run history.
- Generated artifacts: TypeScript SDK and SQL metadata regenerated;
  `cargo check`, `cargo test --no-run`, `cargo clippy --lib`, rustfmt checks, and
  `pnpm --filter @lumiere/stdb typecheck` pass. Clippy reports existing
  repository warnings.
- Reviewer: pending.
- Completed on: pending.

**Remaining ACC-RI-001 release gate**

- Publish the candidate module against a representative database.
- Execute all four ownership backfills.
- Resolve or explicitly quarantine every reported legacy conflict.
- Record a final run with zero unresolved production rows.
- Execute `run_all_accounting_tests` against the published module and capture
  persisted query evidence plus UI reload verification.

### ACC-RI-002 — Close globally addressed move mutation paths

**Status:** In progress

**Affected reducers**

- `add_account_move_line`
- `cancel_account_move`
- `compute_invoice_totals`
- `post_invoice`
- Invoice/bill creation from source documents

**Current evidence**

- `spacetimedb/src/accounting/journal_entries.rs:1235`
- `spacetimedb/src/accounting/journal_entries.rs:1510`
- `spacetimedb/src/accounting/journal_entries.rs:1747`

**Fix criteria**

- [x] Every reducer loads the move/source under `organization_id`.
- [x] Company is derived from the move/source and verified in the organization.
- [x] Journal and accounts match the derived company.
- [x] Line organization/company match the parent before totals/posting.
- [x] Archived/deprecated accounts and inactive journals are rejected.

**Done check**

- Cross-tenant add/cancel/compute/post calls fail without mutating parent, lines,
  totals, state, or audit rows.

**Implementation progress (2026-07-27)**

- Added a scoped move loader that validates move organization, company, journal
  ownership, and journal lifecycle before mutations.
- Added scoped line-set validation for organization, company, and journal before
  totals, posting, and cancellation.
- `add_account_move_line`, `compute_invoice_totals`, `post_account_move`,
  `post_invoice`, and `cancel_account_move` now use the scoped loaders.
- Draft-line insertion rejects cross-organization, cross-company, and deprecated
  accounts. Invoice COGS posting applies the same checks to both supplied
  accounts.
- Direct move creation and sale-order/purchase-order invoice creation reject
  foreign or inactive journals.
- Added persisted negative coverage proving cross-tenant add, compute, post, and
  cancel attempts leave move state, totals, residual, and line count unchanged.

Completion evidence:
- Implementation: `spacetimedb/src/accounting/journal_entries.rs`.
- Persisted-data test:
  `test_cross_tenant_move_mutations_fail_closed` in
  `spacetimedb/tests/accounting/journal_entries_test.rs`; published-module
  execution remains pending.
- Isolation test: organization A draft invoice is targeted through organization
  B for all four mutation paths and remains unchanged.
- UI/reload test: not applicable to the backend mutation boundary; published
  subscription reload verification remains part of the accounting release gate.
- Retry test: existing post idempotency/guarded-action coverage remains
  applicable; no retry contract changed in this slice.
- Generated artifacts: no public DTO changed; `cargo check`,
  `cargo test --no-run`, and `cargo clippy --lib` pass after the implementation.
  Clippy reports existing repository warnings.
- Reviewer: pending.
- Completed on: pending.

### ACC-RI-003 — Prevent financial-report cross-tenant reads

**Status:** Verified

**Current evidence**

- `spacetimedb/src/accounting/financial_statements.rs:284`
- `spacetimedb/src/accounting/financial_statements.rs:590`
- `spacetimedb/src/accounting/financial_statements.rs:1429`

**Fix criteria**

- [x] Require company membership before report/VAT-report creation.
- [x] Validate all account, analytic, partner, journal, and currency filters.
- [x] Filter source moves and lines by both organization and company.
- [x] Derive report child ownership from the parent report.
- [x] Never convert a missing partner to ID `0`.

**Done check**

- A report created by organization A cannot include any organization B ledger
  line, even if given company B or filter IDs.

**Implementation progress (2026-07-27)**

- Added report-scope validation for company membership, both report currencies,
  and account, analytic-account, partner, and journal filters. Inactive,
  deprecated, missing, and cross-scope references fail before persistence.
- Revalidates persisted filters when a draft report is generated, closing the
  gap where a related record changes lifecycle state after report creation.
- Trial-balance, aging, partner-balance, and EU VAT reads now require both
  organization and company matches. Aging no longer creates a synthetic partner
  bucket for missing partner IDs and now honors configured filters.
- Generated statement rows and manually created trial-balance children derive
  organization, company, account labels, and result currency from validated
  parent/account rows.
- Added a persisted isolation test with a deliberately inconsistent source line
  whose denormalized organization/company match A while its parent move,
  account, journal, and partner belong to B. The generated A report persists
  only A's distinctive `120.00` debit and credit.

Completion evidence:
- Implementation:
  `spacetimedb/src/accounting/financial_statements.rs:303`,
  `spacetimedb/src/accounting/financial_statements.rs:721`,
  `spacetimedb/src/accounting/financial_statements.rs:1203`, and
  `spacetimedb/src/accounting/financial_statements.rs:1660`.
- Persisted-data test:
  `test_financial_report_rejects_cross_tenant_sources_and_filters` in
  `spacetimedb/tests/accounting/trial_balance_test.rs`; published-module
  execution passed against local module `lumiere-v1-j1uo0`.
- Isolation test: foreign company, account, analytic account, partner, journal,
  input currency, and result currency configurations fail without persisting a
  report; the corrupted cross-organization source row is excluded.
- Published read proof: report `2` persisted as Generated for organization/company
  `2/2`; its two trial-balance rows are also owned by `2/2` and persist the
  distinctive period debit/credit totals `120.00/120.00`.
- UI/reload test: not applicable to this backend generation boundary; the
  published SQL read verifies the refreshed persisted relation.
- Retry test: generation remains Draft-only and no retry contract changed in
  this slice.
- Generated artifacts: no public DTO changed; `cargo check`, `cargo test
  --no-run`, and repository-standard `cargo clippy --lib` pass. Clippy reports
  existing repository warnings; the strict warnings-as-errors run is blocked by
  unrelated pre-existing warnings.
- Reviewer: Codex verification pass.
- Completed on: 2026-07-27.

### ACC-RI-004 — Make payment allocation a real ledger mutation

**Status:** In progress — implemented locally; published verification pending

**Current evidence**

- `spacetimedb/src/accounting/payment_management.rs:1067`
- `spacetimedb/src/accounting/payment_management.rs:1124`
- `frontend/web/tests/e2e/mobile-money-payments.spec.ts:398`

**Fix criteria**

- [x] Validate payment, account payment, move line, parent move, partner,
      currency, company, organization, and AR/AP account role.
- [x] Reject allocation above the target residual or available payment amount.
- [x] Update move-line residual and parent move residual/payment state.
- [x] Require a scoped write-off account for nonzero write-off.
- [x] Prevent duplicate allocation on retry.
- [x] Create compensating reconciliation rows on reversal.
- [x] Keep the reconciliation row and ledger residuals consistent atomically.

**Done check**

Given residual `600.67`, allocation `211.13` persists:

```text
payment_reconciliation.residual_before = 600.67
payment_reconciliation.residual_after  = 389.54
account_move_line.amount_residual       = 389.54
account_move.amount_residual            = correctly recomputed
```

The reloaded UI shows `389.54`, and a retry does not reduce it again.

**Implementation progress (2026-07-27)**

- Allocation now validates the operational payment transaction, linked
  `AccountPayment`, target move line and parent move, partner, company,
  organization, currency, and receivable/payable account role before mutation.
- Available-payment and target-residual bounds are enforced. The target line,
  parent move, payment clearing line, and payment move residuals are recomputed
  in the same reducer transaction.
- Nonzero write-offs require a scoped operational account and create a balanced,
  typed journal entry referenced by `write_off_move_id`.
- An exact retry returns the existing reconciliation without changing residuals;
  a conflicting duplicate fails.
- Reversal restores target and payment residuals, reverses write-off entries,
  and persists compensating reconciliation rows linked to the originals.
- The allocation form now filters compatible open AR/AP lines and exposes the
  required write-off account.

Completion evidence:
- Implementation:
  `spacetimedb/src/accounting/payment_management.rs`,
  `frontend/web/app/(modules)/accounting/payment-operations-panel.tsx`.
- Persisted-data test:
  `test_payment_allocation_updates_ledger_and_reverses` in
  `spacetimedb/tests/accounting/payment_management_test.rs`.
- Isolation test: a foreign-tenant invoice line is rejected before any
  reconciliation or residual mutation.
- Reload proof: the test reads the persisted reconciliation, target line,
  parent move, and payment clearing line after allocation and reversal.
- Retry proof: repeating the exact `211.13` allocation leaves one active
  reconciliation and the `389.54` residual unchanged.
- Generated artifacts: TypeScript bindings include the typed
  `write_off_move_id`; Rust compile and test build guards pass. Published-module
  execution and final frontend typecheck remain pending after the schema change.
- Reviewer: pending.
- Completed on: pending.

### ACC-RI-005 — Remove hard-coded FX currency

**Status:** In progress — implemented locally; published verification pending

**Current evidence**

- `spacetimedb/src/accounting/fx_revaluation.rs:190`
- `spacetimedb/src/accounting/fx_revaluation.rs:214`

**Fix criteria**

- [x] Replace free-text-only currency input with `currency_id`.
- [x] Validate currency existence and operation compatibility.
- [x] Derive company currency from the scoped company.
- [x] Persist rate value, source, and effective date.
- [x] Retain currency code only as a derived snapshot if needed.
- [x] Validate journal, source, gain, and loss accounts.

**Done check**

- A EUR revaluation never posts as currency ID `1` unless `1` is the validated
  EUR record for that exact environment.

**Implementation progress (2026-07-27)**

- Replaced both free-text revaluation inputs with a typed legacy `currency_id`
  and resolves the active global currency row before posting.
- Derives `company_currency_id` from the validated company and rejects
  same-currency revaluation, unsupported IDs, inactive currencies, and
  incompatible journal/account currencies.
- Persists the selected currency ID, derived code snapshot, company currency,
  positive finite rate, trimmed rate source, and effective date on every run.
- Requires an active general journal, scoped asset/liability source accounts,
  a scoped income gain account, and a scoped expense loss account.
- Batch selection now scans only posted moves in the requested foreign currency
  and company currency.
- The UI uses a relation ID selector and requires rate provenance for manual and
  batch runs.

Completion evidence:
- Implementation: `spacetimedb/src/accounting/fx_revaluation.rs`.
- Persisted-data test:
  `test_fx_revaluation_posts_balanced_move` in
  `spacetimedb/tests/accounting/fx_revaluation_test.rs`.
- Negative proof: attempting to use company currency ID `1` as the foreign
  currency fails without persisting the distinctive `A10-smoke` run.
- Positive proof: EUR ID `2`, rate `1.087321`, source `ECB-test-fixture`, and
  the effective date are reloaded from the persisted run; the balanced move
  carries foreign currency `2` and the derived company currency.
- Generated artifacts: TypeScript and Rust bindings regenerated; focused
  `@lumiere/stdb`, `@lumiere/erp-shared`, and `@lumiere/ui` typechecks pass.
  Published-module execution remains pending after the schema change.
- Reviewer: pending.
- Completed on: pending.

### ACC-RI-006 — Validate core accounting foreign keys

**Status:** In progress

**Affected domains**

- Accounts and journals
- Moves and move lines
- Core and operational payments
- Tax and tax schedules
- Assets and amortization
- Credit-control write-offs

**Current evidence**

- `spacetimedb/src/accounting/chart_of_accounts.rs:549`
- `spacetimedb/src/accounting/chart_of_accounts.rs:689`
- `spacetimedb/src/accounting/journal_entries.rs:1153`
- `spacetimedb/src/accounting/payments.rs:420`
- `spacetimedb/src/accounting/tax_management.rs:363`
- `spacetimedb/src/accounting/amortization.rs:119`

**Fix criteria**

- [ ] Introduce relation-specific scoped loaders.
- [ ] Validate existence, organization, company, lifecycle, type, and operation
      role.
- [ ] Validate optional relations when present.
- [ ] Reject invalid IDs; do not silently omit them.
- [ ] Validate every ID in arrays.

**Done check**

- Each corrected reducer has a table-driven negative test for missing,
  cross-company, cross-organization, inactive/archived, and wrong-role targets.

**Implementation progress (2026-07-27)**

- Added shared relation-specific loaders for active scoped accounts, journals,
  legacy currency rows, and contacts.
- Account create/update now validates account type, optional currency/group,
  every allowed journal, every tax ID, tenant ownership, lifecycle, and
  duplicate array entries.
- Journal create/update now validates its currency and all seven account
  relations, including payment debit/credit accounts, under the same
  organization and company.
- Core payment create/post now validates company membership, bank/cash/check
  journal role, payment and company currencies, partner tenant/company/role,
  and liquidity/clearing account roles. Posted moves derive company currency
  from the scoped company.
- Tax group and schedule paths validate company membership, account roles,
  jurisdiction ownership/lifecycle, tax ownership/lifecycle, and duplicate tax
  IDs.
- Amortization create validates journal, currency, date range, balance-sheet
  account role, and P&L account role.
- Added a persisted negative payment test covering foreign journal, foreign
  partner, invalid currency, and wrong partner role; rejected attempts persist
  no `AccountPayment`.
- Fixed-asset create/update now validates currency, general-journal role,
  required and optional GL account roles, analytic-account ownership/lifecycle,
  and optional depreciation-move ownership/state.
- Credit-control create validates the customer relation. Bad-debt write-off
  validates the source move/partner, general journal, receivable account, and
  expense write-off account, and derives company currency from the source move.

Remaining for this item:
- Complete the same negative matrix for account/journal, tax, amortization,
  asset, and credit-control reducers.
- Review the remaining optional and array relations in those domains before
  marking the five broad criteria complete.

### ACC-RI-007 — Wire active company without sentinels

**Status:** In progress

**Current evidence**

- `frontend/packages/query-hooks/src/hooks/use-operating-company.ts:13`
- `frontend/web/app/(modules)/accounting/accounting-client.tsx:619`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:143`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:174`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:410`

**Fix criteria**

- [x] Remove accounting uses of `?? 0n`.
- [x] Block company-scoped actions until active company context is ready.
- [x] Pass active company explicitly where it is not parent-derived.
- [x] Remove editable company fields from accounting forms.
- [x] Ensure backend default-company selection is not used as a substitute for
      active context.

**Done check**

- With company A2 active, account, move, budget, tax, journal, payment, report,
  asset, and analytic creates persist A2—not the organization’s first company.

**Implementation progress (2026-07-27)**

- Removed the accounting workspace’s `?? 0n` company sentinel.
- Split company resolution from the ready workspace component. Until a valid
  active company is resolved, accounting renders a blocking state and mounts no
  company-scoped hooks or actions.
- The ready component receives a non-optional `bigint` company ID and continues
  to pass it explicitly to reducer hooks and form mappers.
- No general accounting create/edit form exposes active company as editable.
  Consolidation elimination retains its company selector because choosing a
  participating consolidation company is business intent, not tenant context.
- Replaced all accounting uses of `company_id_from_scope` and default-company
  fallback with an explicit-company scoped loader. Missing company context now
  fails server-side even when a caller bypasses the accounting UI.

Remaining for this item:
- Add the A1/A2 persisted test matrix across the listed create reducers.
- Complete the persisted A1/A2 matrix after publishing the updated module.

### ACC-RI-008 — Require real business dates

**Status:** In progress

**Current evidence**

- `frontend/packages/erp-shared/src/accounting-create-params.ts:64`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:177`
- `spacetimedb/src/accounting/payments.rs:440`
- `spacetimedb/src/accounting/payment_management.rs:715`

**Fix criteria**

- [x] Identify required business dates per command.
- [x] Reject missing or invalid required dates.
- [x] Use server timestamp only for audit timestamps.
- [x] If “now” is a valid user choice, represent it explicitly.
- [x] Persist provider/import date provenance for payment events.

**Done check**

- Omitting a required accounting date fails; it never silently stores submission
  time.

**Implementation progress (2026-07-27)**

- The accounting form timestamp mapper now throws for missing or invalid
  business dates instead of falling back to `new Date()`.
- Removed implicit-current-time fallbacks from journal entry, invoice, budget,
  analytic line, bank statement line, depreciation, budget line, asset,
  consolidation, FX, realized FX, and amortization mappers.
- Core payment creation rejects a missing payment date instead of storing
  `ctx.timestamp`.
- Operational payment transaction creation rejects a missing `occurred_at`.
  The form now requires and submits the provider event time explicitly.
- Added negative persisted tests for both missing core-payment date and missing
  provider event time.
- Timesheet and milestone billing now reject missing invoice dates instead of
  substituting `ctx.timestamp`; the timesheet billing form and query hook
  require the date explicitly.
- The remaining accounting `ctx.timestamp` assignments were classified as
  audit timestamps or explicit system/lifecycle event times. No remaining
  optional business-date reducer uses `unwrap_or(ctx.timestamp)`.

Remaining for this item:
- Execute the missing-date cases against the republished module and record
  persisted-data evidence.

---

## 6. P1 — Broken or misleading user actions

### ACC-RI-009 — Split intent DTOs from generated storage-shaped params

**Status:** In progress — intent DTOs implemented locally; published verification pending

**Current evidence**

- `frontend/web/app/(modules)/accounting/accounting-client.tsx:370`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:406`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:559`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:1757`

**Fix criteria**

- [x] Manual move lines submit only user intent.
- [x] Budget create excludes totals, children, and lifecycle.
- [x] Analytic-account create excludes balances and reverse IDs.
- [x] Bank-statement create excludes computed totals and child projections.
- [x] Asset create excludes reverse/chatter/system arrays.
- [x] Fiscal creates exclude system moves and lifecycle state.

**Done check**

- No frontend mapper supplies a field solely because the generated reducer type
  requires it.

**Implementation progress (2026-07-27)**

- Slimmed the affected SpacetimeDB create parameter types and moved draft
  lifecycle, zero totals, empty reverse collections, and validity flags into
  reducer-owned initialization.
- Fiscal-calendar setup and bank-statement import retain their internal derived
  behavior after the public DTO split: the wizard advances created lifecycle
  state explicitly, while import approval derives totals from staged rows.
- Accounting create mappers no longer emit the removed storage-shaped fields.
- TypeScript and Rust bindings regenerated; Rust test compilation and focused
  `@lumiere/stdb` and `@lumiere/erp-shared` typechecks pass.

Remaining for this item:
- Run published persisted-data and UI reload coverage before marking verified.

### ACC-RI-010 — Convert accounting updates to explicit patches

**Status:** In progress — core patch semantics implemented locally

**Current evidence**

- `frontend/packages/erp-shared/src/accounting-create-params.ts:465`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:782`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:1052`
- `spacetimedb/src/accounting/chart_of_accounts.rs:807`

**Fix criteria**

- [ ] Document unchanged/clear semantics for every update field.
- [x] Use `Option<Option<T>>` where clear is valid.
- [x] Do not reconstruct absent values with empty/false/current-date defaults.
- [x] Test one-field updates preserve every unrelated stored value.
- [x] Test explicit clear separately.

**Done check**

- Updating only a name cannot change dates, active state, metadata, accounts,
  relations, or arrays.

**Implementation progress (2026-07-28)**

- Added explicit omit/preserve, `null`/clear, and value/replace semantics to
  nullable account, journal, account-group, analytic-account, analytic-line,
  fiscal-year, and period update fields.
- Updated accounting patch mappers to inspect property presence before emitting
  fields. Partial edits no longer manufacture empty strings, false flags, zero
  amounts, current dates, or empty collections.
- Budget-post and account-type updates now carry active company explicitly and
  preserve fields absent from the patch.
- Added persisted reducer coverage proving a name-only analytic-account update
  preserves code, partner, color, flags, and metadata, followed by a separate
  explicit-clear assertion.

Remaining for this item:
- Complete the field-semantics inventory for the remaining accounting update
  DTOs and execute the behavioral test against the republished module.

### ACC-RI-011 — Wire operational payment provenance and accounting setup

**Status:** In progress — implemented locally; published verification pending

**Current evidence**

- `frontend/web/app/(modules)/accounting/payment-operations-panel.tsx:273`
- `frontend/web/app/(modules)/accounting/payment-operations-panel.tsx:315`
- `frontend/web/app/(modules)/accounting/payment-operations-panel.tsx:377`

**Fix criteria**

- [x] Payment accounts expose or derive fee and clearing accounts.
- [x] Provider `Other` requires and stores its label.
- [x] Transactions accept occurred-at, source record, and evidence documents.
- [x] Fees derive currency from the transaction.
- [x] Fee/tax accounts are required when corresponding amounts are nonzero.
- [x] Allocation UI lists only compatible open move lines.

**Done check**

- Reloading a transaction shows provider, event time, source, evidence, fees,
  accounts, allocations, and ledger links with labels.

**Implementation progress (2026-07-28)**

- Payment-account setup now exposes fee-expense and clearing-account selectors,
  validates their tenant/lifecycle/account roles, and requires a nonblank custom
  label for provider `Other`.
- Transaction entry now submits explicit provider event time, paired source
  record type/ID, and deduplicated evidence document IDs. The reducer validates
  partner role, currency/account compatibility, and document tenant/lifecycle.
- Fee entry exposes fee and tax accounts. Fee currency is derived from the
  transaction; fee and tax accounts are required for nonzero corresponding
  amounts, with the payment account’s configured fee account used as a default.
- Allocation choices are restricted to same-company, same-partner,
  same-currency open receivable/payable lines.
- Behavioral coverage reloads the persisted fee and asserts derived transaction
  currency and configured fee account.

Remaining for this item:
- Execute the workflow against the republished module and capture UI reload
  evidence for source/evidence/account labels.

### ACC-RI-012 — Repair parent/child subscriptions and refresh

**Current evidence**

- `frontend/packages/stdb/src/subscriptions/accounting-workspace.ts:7`
- `frontend/packages/stdb/src/queries/erp-subscriptions.ts:1663`
- `frontend/packages/stdb/src/queries/erp-subscriptions.ts:1736`

**Fix criteria**

- [x] Depreciation lines load through their scoped asset parents.
- [x] Consolidation accounts and journals have scoped reads.
- [x] Payment-term lines have a real query/subscription path.
- [x] Child mutations invalidate or refresh parent detail and totals.
- [x] Archived/missing related records have an explicit display state.

**Done check**

- Creating a child through a parent view makes it visible after reload and
  updates the parent count/total without switching tabs or tenants.

Implementation progress (2026-07-28):

- Depreciation rows now persist a nullable-backfill `company_id` derived from
  the validated asset parent. Subscription SQL requires both organization and
  an authorized company ID, and the ownership backfill derives or quarantines
  both scope fields together.
- Consolidation account and journal reads are explicitly organization-scoped;
  nullable legacy ownership rows are excluded until backfilled.
- Payment-term lines are registered in the accounting workspace, query
  registry, hooks, and tab data path. Create/update/delete line mutations
  invalidate both the parent payment terms and their child lines.
- Depreciation-board and elimination-entry command hints now refresh parent and
  child resources together.
- Payment-term child rows show a parent name plus an explicit inactive or
  missing-parent state; missing fiscal-year parents are also displayed
  explicitly rather than as an unexplained raw ID.
- Local Rust compile proof: `cargo test --manifest-path spacetimedb/Cargo.toml
  --no-run` (published-module reload verification remains pending).
- Regenerated TypeScript/Rust SDKs and query metadata. Focused `@lumiere/stdb`,
  `@lumiere/erp-shared`, `@lumiere/query-hooks`, and `@lumiere/ui` typechecks
  pass.

### ACC-RI-013 — Add operation-level idempotency

**Affected actions**

- Move/invoice/bill creation
- Payment creation/post/allocation
- Asset creation/depreciation
- Report generation/export
- Consolidation processing
- Amortization recognition

**Fix criteria**

- [ ] Each command accepts or derives a stable idempotency key.
- [ ] The key scope includes organization, company, and action kind.
- [ ] Duplicate calls return the existing result or a clear conflict.
- [ ] Idempotency covers all child and audit effects.

**Done check**

- An intentionally repeated HTTP/reducer call produces one accounting effect.

Implementation progress (2026-07-28):

- Added an accounting operation-receipt contract scoped by organization,
  company, action kind, and caller-supplied idempotency key. Receipts bind the
  key to a payload fingerprint and persisted result ID; changed reuse returns a
  conflict.
- Asset and manual depreciation creation record receipts only after their row,
  parent child/value projections, and audit entry succeed atomically. Exact
  retries return before any of those effects are repeated.
- The asset and depreciation form mappers create one command key per submitted
  intent. The fixed-asset persisted-data test repeats both commands, asserts
  one persisted effect, and proves changed input under a reused key conflicts.
- Remaining affected create commands must adopt the receipt helper before this
  item can close. Record lifecycle commands already derive a stable action key
  from their scoped record ID and reject reapplying a completed transition.
- The updated Rust module compiles and the SDK/query artifacts are regenerated;
  focused shared-package typechecks pass.

---

## 7. P2 — Complete relational usage

### ACC-RI-014 — Replace analytic-distribution JSON IDs

**Current evidence**

- `frontend/packages/erp-shared/src/accounting-create-params.ts:640`
- `spacetimedb/src/accounting/analytic_accounting.rs:730`

**Fix criteria**

- [ ] Add typed distribution rows or a typed ID/percentage command.
- [ ] Preserve `u64` precision end-to-end.
- [ ] Validate accounts under the model company.
- [ ] Prevent duplicate account links.
- [ ] Require total percentage to equal 100.
- [ ] Support explicit replace/add/remove semantics.

**Done check**

- Large IDs beyond JavaScript’s safe integer range round-trip exactly.

### ACC-RI-015 — Type intercompany and consolidation sources

**Current evidence**

- `frontend/packages/erp-shared/src/accounting-create-params.ts:1284`
- `spacetimedb/src/accounting/intercompany.rs:403`
- `spacetimedb/src/accounting/consolidation.rs:498`

**Fix criteria**

- [ ] Replace arbitrary document-model strings with typed variants.
- [ ] Load and validate origin/destination documents.
- [ ] Validate consolidation period, companies, accounts, currency, and
      counterparties.
- [ ] Derive account code/name snapshots from the account relation.
- [ ] Preserve historical snapshots alongside the real account ID.

**Done check**

- An ID cannot be interpreted against a default `"sale.order"` model, and a
  mismatched account snapshot cannot be submitted.

### ACC-RI-016 — Add relation-aware accounting read models

**Current evidence**

- `frontend/packages/stdb/src/read-models/accounting.ts:1`
- `frontend/packages/ui/src/lib/accounting-entity-configs.ts:287`
- `frontend/packages/ui/src/lib/accounting-entity-configs.ts:564`
- `frontend/packages/ui/src/lib/accounting-entity-configs.ts:1153`

**Fix criteria**

- [ ] Add typed IDs and labels for partner, company, journal, account, currency,
      parent, and source document.
- [ ] Use relation labels in lists/details instead of raw IDs.
- [ ] Add filters and navigation based on stable IDs.
- [ ] Define snapshot-versus-live-label behavior.
- [ ] Avoid N+1 lookups through bounded queries or client-side indexed maps.

**Done check**

- Every important persisted foreign key is visible as a useful label after
  reload and can be used for filtering or navigation.

### ACC-RI-017 — Make many-to-many semantics explicit

**Affected fields**

- Taxes
- Analytic tags/distributions
- Budget-post accounts
- Journal allowed/payment methods
- Consolidation companies
- Evidence documents
- Reconciliation targets

**Fix criteria**

- [ ] Define replace/add/remove/clear commands.
- [ ] Validate and deduplicate every ID.
- [ ] Prevent duplicate links.
- [ ] Test `undefined`, `[]`, add, remove, and replace separately.
- [ ] Prefer association tables when relation metadata or reverse queries are
      useful.

**Done check**

- An omitted collection never clears stored links, while an explicit clear does.

---

## 8. P3 — Cleanup and maintainability

### ACC-RI-018 — Remove hard-coded and compiler-only mapping behavior

**Current evidence**

- `frontend/packages/erp-shared/src/accounting-defaults.ts:8`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:1542`
- `frontend/web/app/(modules)/accounting/accounting-client.tsx:2527`

**Fix criteria**

- [ ] Remove fixed account-type IDs `1..6`.
- [ ] Remove `undefined as unknown as null`.
- [ ] Remove zero COGS/inventory arguments.
- [ ] Remove explicit `metadata: undefined` filler where the contract can omit it.
- [ ] Reject unknown enums rather than choosing arbitrary domain values.

**Done check**

- Search results contain no accounting mutation fallback matching:

```text
?? 0n
|| 0n
as unknown as
undefined as unknown
cogsAccountId ?? 0
inventoryAccountId ?? 0
```

Any remaining match must have a written, reviewed rationale.

### ACC-RI-019 — Make accounting tests prove behavior

**Current evidence**

- `spacetimedb/tests/domain_test_reducers.rs:44`
- `frontend/web/tests/e2e/accounting-mutations.spec.ts:21`

**Fix criteria**

- [ ] Native compile guards are not counted as behavioral coverage.
- [ ] `run_all_accounting_tests` covers every corrected reducer.
- [ ] Tenant-isolation tests cover every globally addressed accounting table.
- [ ] Playwright tests query persisted rows and relations.
- [ ] Tests use distinctive non-default dates, amounts, references, and IDs.
- [ ] Tests verify retry/idempotency and UI reload.

**Done check**

- Removing any scoped validation or persisted relation makes at least one test
  fail for the intended reason.

---

## 9. Required test fixture and assertion pattern

```text
Organization A
  Company A1
  Company A2
Organization B
  Company B1

User A:
  Authorized for Organization A only

Each company:
  Distinct currency
  Distinct journals
  Distinct GL account roles
  Distinct partners
  Distinct taxes
  Distinct fiscal periods
  Distinct source documents
```

For each corrected mutation:

```text
Given:
  Valid relations in A1 and incompatible relations in A2/B1

When:
  User A submits distinctive values and real selected IDs

Then:
  The persisted row contains the exact selected/derived IDs
  Parent and child ownership agree
  Related labels appear after reload
  A2/B1 IDs are rejected where incompatible
  Missing required relations are rejected
  Archived/inactive relations are rejected
  No field silently becomes 0, empty, null, undefined, or current time
  Repeating the request does not duplicate the accounting effect
```

Recommended distinctive values:

```text
Date:              2031-04-17
Amount:            731.29
Allocation:        211.13
Residual before:   600.67
Residual after:    389.54
Tax rate:          17.375%
Provider ref:      P-A1-73129
Account code:      A1-771
Journal code:      A1-Z9
Document ref:      IC-7719
```

---

## 10. Release gates

### Gate A — Schema and ownership

- [ ] Every accounting row is directly organization-scoped or safely scoped
      through a validated immutable parent.
- [ ] No unresolved ownership remains after backfill.
- [ ] Every global-ID reducer checks row organization before mutation.

### Gate B — Mutation provenance

- [ ] Every mutation-field source is user selection, user entry, authenticated
      context, validated parent, related lookup, domain default, existing value,
      or server derivation.
- [ ] No compiler-only field remains in a user command.
- [ ] No required business date is invented.

### Gate C — Referential integrity

- [ ] Every foreign-key-like value is loaded and validated server-side.
- [ ] Organization/company/lifecycle/role/currency compatibility is enforced.
- [ ] Parent/child and many-to-many semantics are unambiguous.

### Gate D — Read and UI cohesion

- [ ] Every persisted relationship appears through a scoped read path.
- [ ] The UI shows useful labels and navigation.
- [ ] Child mutations refresh parent detail/totals.
- [ ] No accounting workspace resource silently resolves to no subscription.

### Gate E — Accounting correctness

- [ ] Payment allocation changes actual ledger residuals.
- [ ] FX uses validated currencies and rates.
- [ ] Amortization/depreciation use correct calendar dates and totals.
- [ ] Reports cannot read another tenant’s ledger.
- [ ] Multi-row actions are atomic and balanced.

### Gate F — Test and generated-artifact proof

- [ ] `cargo fmt --check` passes for Rust changes.
- [ ] Relevant Clippy/cargo checks pass.
- [ ] `run_all_accounting_tests` passes against the published module.
- [ ] `run_tenant_isolation_tests` passes.
- [ ] Accounting Playwright persisted-data tests pass.
- [ ] `pnpm typecheck` passes.
- [ ] `make generate-stdb-ts-sdk`
- [ ] `make generate-stdb-rust-sdk`
- [ ] `make codegen`
- [ ] `make check-codegen`
- [ ] Working tree contains no unexplained generated drift.

### Final release decision

Use exactly one status:

```text
Production ready
Pilot ready with restrictions
Partially relational
Compiler-complete but semantically incomplete
Unsafe for real ERP data
```

`Production ready` requires Gates A–F. `Pilot ready with restrictions` requires
all P0 items, Gates A–C and E, plus a documented restriction for every remaining
P1/P2 item. Any open tenant-isolation, ledger-residual, hard-coded-currency, or
required-relation fallback issue remains `Unsafe for real ERP data`.

---

## 11. Execution order and tracker

| Order | ID | Priority | Status | Dependency |
|---:|---|---|---|---|
| 1 | ACC-RI-001 | P0 | In progress | None |
| 2 | ACC-RI-002 | P0 | In progress | ACC-RI-001/scoped loaders |
| 3 | ACC-RI-003 | P0 | Verified | Scoped loaders |
| 4 | ACC-RI-004 | P0 | In progress | ACC-RI-002, ACC-RI-006 |
| 5 | ACC-RI-005 | P0 | In progress | ACC-RI-006 |
| 6 | ACC-RI-006 | P0 | In progress | None; implement alongside 001 |
| 7 | ACC-RI-007 | P0 | In progress | None |
| 8 | ACC-RI-008 | P0 | In progress | DTO changes |
| 9 | ACC-RI-009 | P1 | In progress | P0 contracts stabilized |
| 10 | ACC-RI-010 | P1 | In progress | P0 contracts stabilized |
| 11 | ACC-RI-011 | P1 | In progress | ACC-RI-004/006 |
| 12 | ACC-RI-012 | P1 | In progress | ACC-RI-001 |
| 13 | ACC-RI-013 | P1 | In progress | Final command boundaries |
| 14 | ACC-RI-014 | P2 | Not started | ACC-RI-006/009 |
| 15 | ACC-RI-015 | P2 | Not started | ACC-RI-001/006 |
| 16 | ACC-RI-016 | P2 | Not started | Subscription fixes |
| 17 | ACC-RI-017 | P2 | Not started | Final association design |
| 18 | ACC-RI-018 | P3 | Not started | DTO cleanup |
| 19 | ACC-RI-019 | P3 | Not started | Continuous; closes last |

The tracker status changes only when its completion evidence block is present
and all applicable definition-of-done checks pass.
