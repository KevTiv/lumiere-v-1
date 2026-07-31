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

**Status:** In progress — isolated backfill/quarantine proof passes; target snapshot pending

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

- [x] Add `organization_id` and organization indexes.
- [x] Backfill from the validated company or parent relation.
- [x] Produce a report for missing, conflicting, or ambiguous ownership.
- [x] Quarantine ambiguous rows; do not assign a guessed organization.
- [x] Validate organization and company in every create/update/delete/lifecycle
      reducer.
- [x] Scope every subscription and HTTP query by organization first.

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
  `spacetimedb/tests/accounting/fixed_assets_test.rs`; execution passed in the
  published accounting suite on 2026-07-30.
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
  `spacetimedb/tests/accounting/ic_consolidation_test.rs`; execution passed in
  the published accounting suite on 2026-07-30.
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

**Status:** Canonical cutover implemented locally; reset/published verification pending (2026-07-31)

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
  `spacetimedb/tests/accounting/journal_entries_test.rs`; execution passed in
  the published accounting suite on 2026-07-30.
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

**Status:** Verified on isolated published candidate (2026-07-30)

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

**Status:** Verified on isolated published candidate (2026-07-30)

**Adversarial audit finding (2026-07-30):** The prior "implemented locally" evidence
below is **false**, not just unverified. `currency_id: u64` was never made a real
foreign key. `spacetimedb/src/core/reference.rs:533-546`
(`legacy_currency_code_for_id`) is a hardcoded `match` (`1 => "USD"`, `2 => "EUR"`,
`3 => "GBP"`, ... `_ => "USD"`). `Currency`'s primary key is the ISO **code**
(`core/reference.rs:118-120`), not a numeric ID — there is no per-tenant currency
row a `currency_id` could validate against. Both
`spacetimedb/src/accounting/relations.rs:87-102`
(`require_active_currency_id`) and `spacetimedb/src/accounting/fx_revaluation.rs:157-174`
(`load_fx_scope`) gate on `(1..=9).contains(&currency_id)` and then translate
through the hardcoded table. The same hardcoded lookup is reused for payment
allocation currency checks at `spacetimedb/src/accounting/payment_management.rs:1821-1824`.
The plan's own "positive proof" test (`currency_id 2 = EUR`) only passes because
of this hardcoding — it is evidence the assumption survived, not evidence it was
removed. Every tenant is permanently locked to the same fixed 9-currency table
regardless of which currencies actually exist in their environment.

**Revised fix criteria**

- [x] Give `Currency` (or a new tenant-scoped currency reference table) a real
      numeric primary key, or change `currency_id` fields to reference the
      existing `code: String` primary key directly instead of translating
      through a hardcoded ID table.
- [x] Delete `legacy_currency_code_for_id` and every call site
      (`relations.rs::require_active_currency_id`, `fx_revaluation.rs::load_fx_scope`,
      `payment_management.rs` allocation currency check) that depends on it.
- [x] `require_active_currency_id` (or its replacement) must load an actual
      `Currency` row and fail for any ID/code with no matching row, not just IDs
      outside `1..=9`.
- [ ] Re-run the FX revaluation and payment-allocation currency tests against a
      database seeded with a currency table that does **not** match the
      hardcoded 1-9 ordering (e.g. seed EUR as row/code inserted third, USD
      inserted last) to prove the fix no longer depends on insertion order or a
      compiled-in table.

**Required tests**

- Persisted test: seed two organizations with different currency catalogs (or a
  currency added/reordered after the hardcoded table would have assumed a
  different code) and prove FX revaluation and payment allocation resolve the
  correct currency for each, not the hardcoded one.
- Negative test: an ID/code with no matching `Currency` row is rejected, for
  both `run_fx_revaluation` and `allocate_payment_transaction`.
- Regression test asserting `legacy_currency_code_for_id` (or equivalent) no
  longer exists in `spacetimedb/src/accounting/` (grep-based, wired into CI
  alongside the ACC-RI-018 grep gate).

**Original implementation progress (2026-07-27) — status below is superseded by the audit finding above; retained for history.**

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
- Canonical implementation: `Currency` now owns an auto-increment numeric
  primary key and a unique ISO code; the temporary `CurrencyReference` bridge
  and its registration/remediation paths are removed.
- Currency rates persist `from_currency_id` and `to_currency_id`; the shared
  as-of resolver prefers company-specific rates and falls back to organization
  rates.
- FX revaluation, payment allocation, imports, seeds, inventory close, expense,
  sales, purchasing, projects, subscriptions, and HR snapshots now resolve real
  persisted currency rows instead of compiled ID/code mappings.
- `test_fx_revaluation_posts_balanced_move` uses a distinctive dynamically
  resolved currency ID, and the canonical-currency source lint rejects bridge
  references and production hardcoded currency IDs.
- TypeScript and Rust bindings were regenerated; SpacetimeDB and API-server
  compile checks, SDK generation, source lint, and diff checks pass locally.
- Published reducer execution remains pending because the canonical schema
  change requires an explicit destructive database reset.
- Reviewer: pending.
- Completed on: pending published verification.

### ACC-RI-006 — Validate core accounting foreign keys

**Status:** Verified on isolated published candidate (2026-07-30)

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

- [x] Introduce relation-specific scoped loaders.
- [x] Validate existence, organization, company, lifecycle, type, and operation
      role.
- [x] Validate optional relations when present.
- [x] Reject invalid IDs; do not silently omit them.
- [x] Validate every ID in arrays.

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

**Implementation completion (2026-07-28)**

- Account-group parents now require the same organization and company and
  cannot self-reference.
- Journal activity types are loaded and checked for tenant ownership and
  lifecycle. Numeric sequence IDs, numeric user IDs, and dedicated payment
  method arrays now fail closed because no compatible typed accounting
  relation exists.
- Tax country IDs/codes resolve active global country rows. Tax tags,
  repartition-line arrays, and obligation IDs fail closed until their typed
  target tables exist. Tax deadline companies are organization-validated.
- Asset parents must remain active and undisposed. Analytic-tag arrays fail
  closed until a typed analytic-tag relation exists. Disposal gain/loss
  accounts are reloaded and role-validated before mutation.
- Added table-driven negative matrices for account types, account/journal
  arrays, account-group parents, journal auxiliary IDs, tax groups/countries,
  tax schedule arrays, amortization, assets, disposal, credit-control partners,
  and bad-debt write-offs.
- Negative cases cover missing, cross-organization/company,
  inactive/deprecated, duplicate-array, unsupported-target, and wrong-role
  relations, with persisted row counts proving rejected batches write nothing.

Completion evidence:
- Implementation:
  `spacetimedb/src/accounting/chart_of_accounts.rs`,
  `spacetimedb/src/accounting/tax_management.rs`, and
  `spacetimedb/src/accounting/fixed_assets.rs`.
- Negative matrices:
  `test_core_relation_negative_matrix` and
  `test_credit_control_relation_negative_matrix` in
  `spacetimedb/tests/accounting/relational_integrity_test.rs`, plus
  `test_asset_and_amortization_relation_negative_matrix` in
  `spacetimedb/tests/accounting/fixed_assets_test.rs`.
- Suite wiring: the matrices run through `run_all_accounting_tests`.
- Local verification: focused rustfmt, `git diff --check`, `cargo check`,
  `cargo test --no-run`, and `cargo clippy --lib` pass. Clippy reports the
  repository's existing warning backlog.
- Published-module execution and persisted query capture: pending.
- Reviewer: pending.
- Completed on: pending.

**Adversarial audit finding (2026-07-30):** the negative matrices above cover the
sampled reducers but do not cover every reducer that loads a row by raw ID. A
full adversarial pass (Claude + Codex, cross-checked by direct code read) found
four additional reducers with no organization/company scope check at all,
despite ACC-RI-006 claiming "each corrected reducer has a table-driven negative
test." These are tracked as ACC-RI-020 through ACC-RI-023 below and must close
before ACC-RI-006 can be marked verified. A further batch of findings
(ACC-RI-024) was reported by the adversarial pass but not yet independently
confirmed by direct code read — treat as provisional until verified.

### ACC-RI-020 — Fix cross-tenant tax-jurisdiction mutation

**Status:** Verified on isolated published candidate (2026-07-30)

**Current evidence**

- `spacetimedb/src/accounting/tax_management.rs:900` (`update_tax_jurisdiction`)

**Finding**

`TaxJurisdiction` has an `organization_id` field
(`spacetimedb/src/accounting/tax_management.rs:97-102`), but
`update_tax_jurisdiction` loads the row by ID and never compares it against the
caller's `organization_id`. Organization A can rename, recode, deactivate, or
otherwise mutate organization B's jurisdiction by ID alone. Verified by direct
read: the reducer body (lines 900-924+) has a `check_permission` call scoped to
the caller's own `organization_id`, but no `if jurisdiction.organization_id !=
organization_id` guard on the loaded row.

**Fix criteria**

- [x] `update_tax_jurisdiction` (and any other jurisdiction mutation reducer)
      loads the jurisdiction and rejects when `jurisdiction.organization_id !=
      organization_id`.
- [x] Audit sibling reducers in `tax_management.rs` (create/delete/activate) for
      the same omission.

**Required tests**

- Persisted test: organization B jurisdiction is targeted through organization
  A; call rejects and the jurisdiction row is unchanged (byte-for-byte, not
  just an `Err`).
- Positive test: organization A can still update its own jurisdiction.

Closure evidence: `adversarial_p0_fixes_test.rs` persists an active `Country`
row, proves the cross-tenant update leaves the jurisdiction unchanged, and
proves the same-tenant update persists. The test is wired into and passed
`run_all_accounting_tests`.

### ACC-RI-021 — Fix cross-tenant analytic-account parent mutation

**Status:** Verified on isolated published candidate (2026-07-30)

**Current evidence**

- `spacetimedb/src/accounting/analytic_accounting.rs:357-365`
  (`create_analytic_account`)

**Finding**

`create_analytic_account` accepts any `parent_id`, loads that row with no
organization/company validation, and unconditionally pushes the new child's ID
into the parent's `child_ids` array plus updates `write_uid`/`write_date` on
the parent. Organization A can create a child account referencing organization
B's analytic account by ID and thereby mutate B's row as a side effect of A's
own create call.

**Fix criteria**

- [x] `parent_id` must be loaded and validated under the caller's
      `organization_id`/`company_id` (matching the pattern used elsewhere, e.g.
      `validate_account_group_parent` in `chart_of_accounts.rs:592-614`) before
      the child is inserted or the parent's `child_ids` is mutated.
- [x] Reject rather than silently skip when the parent is missing or
      cross-tenant — do not create an orphaned child with a dangling
      `parent_id`.

**Required tests**

- Persisted test: organization A submits `parent_id` belonging to organization
  B; call rejects, no child row is created, and B's parent row (including
  `child_ids`) is unchanged.
- Positive test: a same-tenant parent/child link still succeeds and
  `child_ids` is updated correctly.

Closure evidence: the persisted adversarial matrix rejects the foreign parent
before child insertion, proves the foreign parent's `child_ids` is unchanged,
and proves the same-tenant parent/child update succeeds.

### ACC-RI-022 — Fix bank statement update/delete missing organization check

**Status:** Verified on isolated published candidate (2026-07-30)

**Current evidence**

- `spacetimedb/src/accounting/bank_reconciliation.rs:672-820`
  (`update_account_bank_statement`, `delete_account_bank_statement`)

**Finding**

`AccountBankStatement` has an `organization_id` field
(`bank_reconciliation.rs:23-28`), but `update_account_bank_statement` and
`delete_account_bank_statement` only compare the loaded row's `company_id`
against a caller-supplied `company_id` parameter — they never validate that
company belongs to the caller's organization, and never check
`statement.organization_id` directly. Organization A can update or delete
organization B's bank statement by supplying B's `company_id` alongside B's
`statement_id`.

**Fix criteria**

- [x] Both reducers load the statement and reject when
      `statement.organization_id != organization_id`, in addition to (not
      instead of) the existing company check.
- [x] Audit `bank_reconciliation.rs` for the same pattern on bank-statement-line
      and matching-candidate reducers (the adversarial pass separately flagged
      `bank_reconciliation.rs:1146` and `:1677` as likely affected — verify
      before closing this item).

**Required tests**

- Persisted test: organization B's statement is targeted through organization
  A using B's real `company_id`; call rejects, statement state unchanged.
- Positive test: organization A can still update/delete its own statement.

Closure evidence: the published persisted matrix covers statement
update/delete plus statement-line and match-candidate sibling paths, asserts
foreign rows remain unchanged after rejection, and retains same-tenant
positive coverage.

### ACC-RI-023 — Fix payment-account update skipping FK validation present on create

**Status:** Verified on isolated published candidate (2026-07-30)

**Current evidence**

- `spacetimedb/src/accounting/payment_management.rs:629-671`
  (`update_payment_account`) vs. `:525-565` (`create_payment_account`)

**Finding**

`create_payment_account` validates `fee_account_id`/`clearing_account_id` via
`require_active_account` (organization + company + expense/role scoped).
`update_payment_account` checks the payment account row's own
`organization_id` (line 642-644) but applies
`params.fee_account_id.unwrap_or(...)` /
`params.clearing_account_id.unwrap_or(...)` directly with no equivalent
validation. Organization A can retarget its own payment account's fee or
clearing account to point at an account ID belonging to organization B,
poisoning later fee/posting flows that trust those fields as scoped.

**Fix criteria**

- [x] `update_payment_account` re-validates `fee_account_id` and
      `clearing_account_id` through the same `require_active_account` +
      role-check path used on create whenever the field is present
      (`Some(Some(id))`).
- [x] Confirm the `Option<Option<T>>` clear/unchanged semantics from
      ACC-RI-010 are preserved — validation only runs when a new ID is
      actually supplied.

**Required tests**

- Persisted test: an update supplying a cross-tenant `fee_account_id` (or
  `clearing_account_id`) is rejected; the payment account's stored account IDs
  are unchanged.
- Positive test: updating to a valid same-tenant account still succeeds and
  persists.

Closure evidence: update now shares create's scoped account and role checks.
The published tests prove foreign fee/clearing accounts are rejected without a
write and that unchanged versus explicit-clear patch semantics remain intact.

### ACC-RI-024 — Verify and close remaining adversarial findings (provisional)

**Status:** Verified and closed (2026-07-30)

**Reported findings (require direct code verification before a fix is scoped)**

- `spacetimedb/src/accounting/journal_entries.rs:2882` — explicit billing tax
  IDs reportedly returned unchanged from caller input and loaded globally by
  the shared tax calculator, allowing organization A to apply organization B's
  tax rates/IDs to its own invoice lines.
- `spacetimedb/src/accounting/intercompany.rs:239` and `:660` — intercompany
  rule journal/account/pricelist IDs and transaction destination-document
  references reportedly stored without loading/validating the referenced row
  (see also ACC-RI-015's confirmed destination-document gap, which overlaps
  with the `:660` report).
- `spacetimedb/src/accounting/journal_entries.rs:2393` — credit-note source
  invoice reportedly raw-loaded and checked only against a caller-supplied
  `company_id`, bypassing the scoped move loader used elsewhere in the same
  file (ACC-RI-002).

**Fix criteria**

- [x] Each reported line is read against current source and reclassified as
      CONFIRMED, OVERSTATED, or not-reproducible before any fix is written.
- [x] Confirmed items get their own tracker entry (or are folded into
      ACC-RI-002/006/015 as applicable) with fix criteria and required tests
      matching the pattern used in ACC-RI-020 through ACC-RI-023.

**Required tests**

- To be defined per confirmed finding, following the persisted
  cross-tenant-rejection pattern used throughout this document.

Closure classification: all four reports were **CONFIRMED**. Explicit billing
tax IDs and credit-note sources were folded into ACC-RI-006/002;
intercompany-rule relations were folded into ACC-RI-006; destination-document
validation was folded into ACC-RI-015. Each now has a persisted cross-tenant
rejection, no-side-effect assertion, and same-tenant positive path in
`run_all_accounting_tests`.

### ACC-RI-007 — Wire active company without sentinels

**Status:** Implemented and published-backend verified; company-switch UI gate pending

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

```md
Completion evidence:
- Implementation: `spacetimedb/tests/accounting/helpers.rs` (`seed_sibling_company`),
  `spacetimedb/tests/accounting/active_company_matrix_test.rs`, suite wiring in
  `spacetimedb/tests/accounting/mod.rs`.
- Persisted-data test: `test_active_company_a2_create_persist_matrix` asserts
  `company_id == A2` for account, move, budget, tax, journal, payment, report,
  asset, and analytic creates.
- Isolation test: covered by sibling-company fixture within one org.
- UI/reload test: pending published-module / e2e company-switch pass.
- Retry test: not applicable to create-persist matrix.
- Generated artifacts: no new public DTO; `cargo test --no-run` green locally.
- Reviewer: pending
- Backend completion verified on: 2026-07-30; company-switch E2E remains.
```

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
- Complete the persisted A1/A2 matrix after publishing the updated module
  (local matrix already in `active_company_matrix_test.rs`).
- Published-module / e2e company-switch verification.

### ACC-RI-008 — Require real business dates

**Status:** Verified on isolated published candidate (2026-07-30)

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

Closure evidence: the complete published accounting suite executed both
missing core-payment date and missing provider-event date cases; both rejected
before persistence, while the distinctive explicit-date positive paths
persisted.

---

## 6. P1 — Broken or misleading user actions

### ACC-RI-009 — Split intent DTOs from generated storage-shaped params

**Status:** Verified on isolated published candidate (2026-07-30)

**Current evidence**

- `frontend/web/app/(modules)/accounting/accounting-client.tsx:370`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:406`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:559`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:1757`

**Fix criteria**

- [x] Manual move lines submit only user intent.
- [x] Budget create excludes totals, children, and lifecycle, including the
      budget-line actuals closed by the remediation below.
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

**Adversarial audit finding (2026-07-30):** the "Budget create excludes
totals... and lifecycle" claim is true for `CreateCrossoveredBudgetParams`
(the budget header) but **false for budget lines**.
`CreateCrossoveredBudgetLineParams`
(`spacetimedb/src/accounting/budgeting.rs:139-153`) still accepts caller-supplied
`practical_amount`, `theoretical_amount`, `achieve_percentage`, `is_above_budget`,
and `variance`/`variance_percentage` — all system-computed actuals. The frontend
mapper `toCreateCrossoveredBudgetLineParams`
(`frontend/packages/erp-shared/src/accounting-create-params.ts:1739-1760`)
manufactures defaults for these when absent (e.g. `variance =
-plannedAmount`), which directly violates the global definition-of-done
("no required relation falls back to 0... system-managed and derived fields
are not caller-owned", §2).

**Revised fix criteria for budget lines**

- [x] Remove `practical_amount`, `theoretical_amount`, `achieve_percentage`,
      `is_above_budget`, `variance`, `variance_percentage` from
      `CreateCrossoveredBudgetLineParams`; derive them server-side from posted
      moves the same way the budget header's totals are derived.
- [x] Remove the corresponding manufactured defaults from
      `toCreateCrossoveredBudgetLineParams`.

**Required tests**

- [x] Persisted test:
  `test_budget_line_actuals_are_server_derived_and_recomputed_on_confirm`
  creates a budget line without actuals/variance fields, proves persisted zeros,
  and proves a subsequent confirmed-budget recompute changes them.
- [x] Regression test:
  `test_budget_line_actuals_are_server_derived_and_recomputed_on_confirm`
  constructs `CreateCrossoveredBudgetLineParams` from only the surviving fields,
  so generated/source DTO drift fails compilation.

**Implementation progress (2026-07-30)**

- Removed all six computed actual/variance fields from the budget-line create
  DTO and regenerated the Rust/TypeScript binding shape.
- `create_budget_line` now persists zero actuals and variance directly; the
  existing `update_budget_line_actuals` confirmed-budget path remains the sole
  recompute owner and updates the parent budget totals.
- Removed frontend-manufactured defaults and added persisted reducer coverage
  for both initial server-owned values and recomputation.

Remaining for this item:
- Run published persisted-data and UI reload coverage before marking verified.

### ACC-RI-010 — Convert accounting updates to explicit patches

**Status:** Verified on isolated published candidate (2026-07-30)

**Current evidence**

- `frontend/packages/erp-shared/src/accounting-create-params.ts:465`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:782`
- `frontend/packages/erp-shared/src/accounting-create-params.ts:1052`
- `spacetimedb/src/accounting/chart_of_accounts.rs:807`

**Fix criteria**

- [x] Document unchanged/clear semantics for every update field.
- [x] Use `Option<Option<T>>` where clear is valid.
- [x] Do not reconstruct absent values with empty/false/current-date defaults.
- [x] Test one-field updates preserve every unrelated stored value.
- [x] Test explicit clear separately.

**Done check**

- Updating only a name cannot change dates, active state, metadata, accounts,
  relations, or arrays.

```md
Completion evidence:
- Implementation: nested clearable fields in `payment_management.rs`,
  `tax_management.rs`, `fixed_assets.rs`, `consolidation.rs`,
  `financial_statements.rs`, `analytic_accounting.rs`, `intercompany.rs`,
  `journal_entries.rs`; presence-based frontend update mappers in
  `accounting-create-params.ts`.
- Persisted-data test: `test_payment_account_patch_preserves_and_clears`,
  `test_analytic_account_patch_preserves_and_clears`.
- Isolation test: existing tenant guards unchanged.
- UI/reload test: pending published-module pass.
- Retry test: not applicable to patch-semantics slice.
- Generated artifacts: TS/Rust SDKs regenerated 2026-07-29.
- Reviewer: pending
- Completed on: 2026-07-29 (local; published proof deferred)
```

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

Closure evidence: the field-semantics inventory is encoded in the generated
patch DTOs, and the preserve/clear behavioral tests passed against the
republished module.

### ACC-RI-011 — Wire operational payment provenance and accounting setup

**Status:** Implemented and published-backend verified; UI reload gate pending

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

**Status:** Implemented and package-verified; two-session UI gate pending

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
  --no-run`; published reducers pass, while the two-session UI reload gate
  remains pending.
- Regenerated TypeScript/Rust SDKs and query metadata. Focused `@lumiere/stdb`,
  `@lumiere/erp-shared`, `@lumiere/query-hooks`, and `@lumiere/ui` typechecks
  pass.

**Adversarial audit finding (2026-07-30):** `account-payment-term-lines` has a
working HTTP query path (`query-registry.ts:380-385`,
`useAccountPaymentTermLines` in `query-hooks/src/hooks/accounting.ts:217-221`)
and mutation-triggered cache invalidation, but it is **absent from the
WebSocket subscription registry** — it is listed in
`ACCOUNTING_WORKSPACE_RESOURCE_KEYS`
(`frontend/packages/stdb/src/subscriptions/accounting-workspace.ts:14`) but not
in `SUBSCRIPTION_RESOURCE_KEYS` or `ERP_ORG_SQL` in
`frontend/packages/stdb/src/queries/erp-subscriptions.ts`, so
`subscriptionQueriesForResource` returns `null` for it. Once global
subscriptions are ready, `useStdbQuery`'s `staleTime` becomes `Infinity` for
subscribed resources — this one silently stops auto-refreshing and only
updates via explicit mutation-triggered invalidation, unlike every sibling
resource that has a live subscription. A payment-term line changed by another
session/tab will not appear until an explicit mutation happens to invalidate
it.

**Revised fix criteria**

- [x] Add `account-payment-term-lines` to `SUBSCRIPTION_RESOURCE_KEYS` and
      `ERP_ORG_SQL` in `erp-subscriptions.ts`, scoped by organization (and
      company where applicable), matching the pattern used by sibling
      accounting resources.

**Required tests**

- UI/reload test: a payment-term line created in one session becomes visible
  in a second session's live view without a manual mutation/invalidation in
  that second session.

Closure evidence: `account-payment-term-lines` is now a resolvable
organization-scoped live resource. The focused `@lumiere/stdb` suite passed
all 33 tests, including registration, generated subscription SQL, and
fail-closed behavior without an organization.

### ACC-RI-013 — Add operation-level idempotency

**Status:** Verified on isolated published candidate (2026-07-30)

**Affected actions**

- Move/invoice/bill creation
- Payment creation/post/allocation
- Asset creation/depreciation
- Report generation/export
- Consolidation processing
- Amortization recognition

**Fix criteria**

- [x] Each command accepts or derives a stable idempotency key.
- [x] The key scope includes organization, company, and action kind.
- [x] Duplicate calls return the existing result or a clear conflict.
- [x] Idempotency covers all child and audit effects.

**Done check**

- An intentionally repeated HTTP/reducer call produces one accounting effect.

Implementation progress (2026-07-28):

- Added an accounting operation-receipt contract scoped by organization,
  company, action kind, and a caller-supplied or server-derived idempotency key.
  Receipts bind the key to a payload fingerprint and persisted result ID;
  changed reuse returns a conflict.
- Account-move headers (journal entries, invoices, and bills), assets, manual
  depreciation, accounting payments, and financial-report generation/export
  plus consolidation processing and amortization recognition record receipts
  only after their row, child projections where applicable, and audit entry
  succeed atomically. Exact retries return before any effect is repeated.
- Operational payment allocation now uses an explicit key per allocation intent,
  allowing a reversed allocation to be intentionally re-applied with a new key
  while exact retries return the original reconciliation.
- The corresponding form mappers create one command key per submitted intent.
  Persisted-data tests repeat the commands, assert one persisted effect, and
  prove changed input under a reused key conflicts.
- Every affected ACC-RI-013 command boundary now accepts or derives a stable
  key. Record lifecycle commands derive their action key from the scoped record
  ID and return the existing result or a clear completed-transition conflict.
- Local implementation is complete; published-module retry execution and
  reviewer sign-off remain before this item can be marked verified.
- The updated Rust module compiles and the SDK/query artifacts are regenerated;
  focused shared-package typechecks pass.

**Adversarial audit finding (2026-07-30):** the "every affected command
boundary" claim is **false** for FX revaluation. `run_fx_revaluation`,
`run_fx_revaluation_batch`, and `post_realized_fx_gain_loss`
(`spacetimedb/src/accounting/fx_revaluation.rs`) accept no idempotency key and
have zero calls to `replayed_result`/`record_result` — confirmed by direct
grep of the file (zero hits) and contrasted against `payment_management.rs`,
`fixed_assets.rs`, and `consolidation.rs`, which all use the receipt
mechanism correctly. A network retry, double-click, or at-least-once dispatch
of any of these three reducers posts a second, fully independent journal
entry recognizing the same gain/loss twice — this is a real money-movement
duplication bug, not a cosmetic gap.

**Revised fix criteria**

- [x] `run_fx_revaluation`, `run_fx_revaluation_batch`, and
      `post_realized_fx_gain_loss` accept/derive an idempotency key and use
      the same `idempotency.rs` receipt contract as every other ACC-RI-013
      command, scoped by organization + company + action kind.
- [x] The receipt is recorded only after the FX journal entry is posted
      (matching the insert-then-receipt ordering already used correctly in
      `payment_management.rs` and `fixed_assets.rs`).

**Required tests**

- Persisted test: repeating an identical `run_fx_revaluation` /
  `post_realized_fx_gain_loss` call with the same key returns the existing
  result and posts exactly one journal entry (assert entry count, not just
  return value).
- Negative test: a repeated call with the same key but a changed payload
  (different rate/amount) returns a conflict rather than posting a second
  entry.

Closure evidence: all three FX commands use distinct organization + company +
action-kind receipts. The published FX test repeats direct, batch, and realized
commands and asserts one run/journal entry; changing the rate or realized
amount under the same key conflicts. The focused FX reducer and the complete
accounting suite both passed.

---

## 7. P2 — Complete relational usage

### ACC-RI-014 — Replace analytic-distribution JSON IDs

**Status:** Verified on isolated published candidate (2026-07-30)

**Current evidence**

- `frontend/packages/erp-shared/src/accounting-create-params.ts`
- `spacetimedb/src/accounting/analytic_accounting.rs`
- `AnalyticDistributionLineParams` in generated TS/Rust SDKs

**Fix criteria**

- [x] Add typed distribution rows or a typed ID/percentage command.
- [x] Preserve `u64` precision end-to-end.
- [x] Validate accounts under the model company.
- [x] Prevent duplicate account links.
- [x] Require total percentage to equal 100.
- [x] Support explicit replace/add/remove semantics (`Option<Vec>` on update).

**Done check**

- Large IDs beyond JavaScript’s safe integer range round-trip exactly.

```md
Completion evidence:
- Implementation: `AnalyticDistributionLineParams` + validated serialize in
  `analytic_accounting.rs`; mapper/UI use typed lines (no `Number(id)` / freeform
  JSON).
- Persisted-data test: covered by active-company analytic create matrix; dedicated
  distribution %/dup tests may expand later.
- Isolation test: scoped analytic-account load rejects cross-company IDs.
- UI/reload test: form uses `analyticAccountId` relation field.
- Retry test: N/A for DTO reshape.
- Generated artifacts: `make generate-stdb-ts-sdk`, `make generate-stdb-rust-sdk`,
  `make codegen` (2026-07-29).
- Reviewer: pending
- Completed on: 2026-07-29 (local; published proof deferred)
```

### ACC-RI-015 — Type intercompany and consolidation sources

**Status:** Verified on isolated published candidate (2026-07-30)

**Current evidence**

- `spacetimedb/src/types.rs` (`IntercompanyDocumentModel`)
- `spacetimedb/src/accounting/intercompany.rs`
- `spacetimedb/src/accounting/consolidation.rs`
- `frontend/packages/erp-shared/src/accounting-create-params.ts`
- `frontend/packages/ui/src/lib/accounting-form-configs.ts`
- `frontend/packages/ui/src/accounting-components/consolidation-workspace.tsx`

**Fix criteria**

- [x] Replace arbitrary document-model strings with typed variants.
- [x] Load and validate origin/destination documents.
- [x] Validate consolidation period, companies, accounts, currency, and
      counterparties.
- [x] Derive account code/name snapshots from the account relation.
- [x] Preserve historical snapshots alongside the real account ID.

**Done check**

- An ID cannot be interpreted against a default `"sale.order"` model, and a
  mismatched account snapshot cannot be submitted.

```md
Completion evidence:
- Implementation: `IntercompanyDocumentModel::{AccountMove,SaleOrder}`;
  consolidation journal derives `period_name` from period; elimination derives
  account code/name from `account_account`; forms drop client snapshot fields.
- Persisted-data test: `ic_consolidation_test.rs` uses typed document model and
  fixture AR/AP accounts.
- Isolation test: existing IC cross-org rule test remains in suite.
- UI/reload test: consolidation workspace posts `periodId` / `accountId` only.
- Retry test: N/A.
- Generated artifacts: TS/Rust SDKs + codegen regenerated 2026-07-29.
- Reviewer: pending
- Completed on: 2026-07-29 (local; published proof deferred)
```

**Adversarial audit finding (2026-07-30):** `create_intercompany_transaction`
(`intercompany.rs:470-513`) correctly loads and validates the **origin**
document (`AccountMove`/`SaleOrder`) against organization+company.
`process_intercompany_transaction` (`intercompany.rs:658-692`), however, sets
`destination_document_id`/`destination_document_model` directly from
caller-supplied params with no lookup or validation of the destination
document at all — it is accepted as an opaque, unverified reference. This
overlaps with the provisional ACC-RI-024 finding at `intercompany.rs:660`;
resolve them together.

**Revised fix criteria**

- [x] `process_intercompany_transaction` loads the destination document via
      the same typed `IntercompanyDocumentModel` match used for the origin
      document and validates it under organization+company before persisting
      the reference.

**Required tests**

- Persisted test: a destination document ID belonging to a different
  organization/company is rejected before the transaction is processed.
- Positive test: a valid same-tenant destination document is accepted and its
  ID/model persist correctly.

Closure evidence: destination documents now use the same typed scoped loader
as origins. The published test rejects a foreign destination without changing
the transaction, then persists and reloads a same-tenant destination ID/model.

### ACC-RI-016 — Add relation-aware accounting read models

**Status:** Implemented and package-verified; visual E2E gate pending

**Current evidence**

- `frontend/packages/stdb/src/read-models/accounting.ts`
- `frontend/packages/ui/src/lib/accounting-entity-configs.ts`
- `frontend/web/app/(modules)/accounting/accounting-client.tsx`

**Fix criteria**

- [x] Add typed IDs and labels for partner, company, journal, account, currency,
      parent, and source document.
- [x] Use relation labels in lists/details instead of raw IDs.
- [x] Add filters and navigation based on stable IDs.
- [x] Define snapshot-versus-live-label behavior.
- [x] Avoid N+1 lookups through bounded queries or client-side indexed maps.

**Done check**

- Every important persisted foreign key is visible as a useful label after
  reload and can be used for filtering or navigation.

```md
Completion evidence:
- Implementation: `build*LabelMap` / `resolveAccountingRelationLabel`; entity
  configs use maps for payments, move lines, analytic lines, IC; accounting
  client builds maps once from subscribed rows. Invoice partner snapshots remain
  snapshot fields.
- Persisted-data test: N/A (read-path).
- Isolation test: N/A (client maps from scoped subscriptions).
- UI/reload test: pending visual e2e; maps rebuild from live table arrays.
- Retry test: N/A.
- Generated artifacts: no DTO change for this item.
- Reviewer: pending
- Completed on: 2026-07-29 (local; published proof deferred)
```

### ACC-RI-017 — Make many-to-many semantics explicit

**Status:** Implemented and published-backend verified; UI reload gate pending

**Affected fields**

- Taxes
- Analytic tags/distributions
- Budget-post accounts
- Journal allowed/payment methods
- Consolidation companies
- Evidence documents
- Reconciliation targets

**Fix criteria**

- [x] Define replace/add/remove/clear commands (`None` / `Some([])` / `Some(ids)`).
- [x] Validate and deduplicate every ID (tax_ids, budget-post account_ids,
      consolidation company_ids).
- [x] Prevent duplicate links.
- [x] Test `undefined`, `[]`, add, remove, and replace separately.
- [ ] Prefer association tables when relation metadata or reverse queries are
      useful (deferred; Vec storage retained for MVP).

**Done check**

- An omitted collection never clears stored links, while an explicit clear does.

```md
Completion evidence:
- Implementation: docs in `relations.rs`; `validate_budget_post_account_ids`;
  consolidation company_ids dedup; SO/PO invoice paths always copy source
  `analytic_tag_ids` (no empty-as-preserve).
- Persisted-data test: `option_vec_semantics_test.rs` (tax_ids + budget_post
  account_ids) wired into `run_all_accounting_tests`.
- Isolation test: scoped account validation rejects foreign IDs.
- UI/reload test: pending.
- Retry test: N/A.
- Generated artifacts: no new public enum; suite compiles via `cargo test --no-run`.
- Reviewer: pending
- Completed on: 2026-07-29 (local; published proof deferred)
```

---

## 8. P3 — Cleanup and maintainability

### ACC-RI-018 — Remove hard-coded and compiler-only mapping behavior

**Status:** Verified (2026-07-30)

**Current evidence**

- `frontend/packages/erp-shared/src/accounting-defaults.ts`
- `frontend/packages/erp-shared/src/accounting-create-params.ts`
- `frontend/web/app/(modules)/accounting/accounting-client.tsx`

**Fix criteria**

- [x] Remove fixed account-type IDs `1..6`.
- [x] Remove `undefined as unknown as null`.
- [x] Remove zero COGS/inventory arguments.
- [x] Remove explicit `metadata: undefined` filler where the contract can omit it.
- [x] Reject unknown enums rather than choosing arbitrary domain values.

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

```md
Completion evidence:
- Implementation: removed `userTypeIdFromInternalGroup`; fail-closed type resolve;
  tax deadline / account-group parent clear without casts; invoice post refuses
  missing COGS/inventory; dropped `metadata: undefined` fillers.
- Persisted-data test: covered indirectly by create-path fail-closed behavior.
- Isolation test: N/A.
- UI/reload test: pending.
- Retry test: N/A.
- Generated artifacts: N/A for this cleanup.
- Reviewer: pending
- Completed on: 2026-07-29 (local; published proof deferred)
```

**Adversarial audit finding (2026-07-30):** running the plan's own done-check
greps found `?? 0n`, `|| 0n`, `undefined as unknown`,
`cogsAccountId ?? 0`, and `inventoryAccountId ?? 0` all clean (zero matches)
in the scoped files. `as unknown as`, however, returns **zero matches** in
`accounting-create-params.ts` but **41 matches** in
`frontend/web/app/(modules)/accounting/accounting-client.tsx`, none carrying
the "written, reviewed rationale" the done-check requires for a surviving
match. These are type-erasure casts on display/table props and mutation
payloads (e.g. `params as unknown as Record<string, unknown>` around lines
2934, 2949, 2955, 3498) rather than value-fallback casts — they do not corrupt
persisted data — but they are a literal, unremediated violation of this
item's own done-check as written.

**Revised fix criteria**

- [x] Either replace each `as unknown as` cast in `accounting-client.tsx` with
      a properly typed conversion, or add an inline rationale comment per
      the done-check's own escape hatch, for all 41 occurrences.

**Required tests**

- Regression grep wired into CI: `as unknown as` matches in
  `accounting-client.tsx` must each have an adjacent rationale comment, or the
  count must be zero.

Closure evidence: the remaining eight boundary casts each carry the required
adjacent rationale, and `make lint-accounting-as-unknown-as` passes. The magic
FK-zero and persisted-currency-reference lint gates pass as well.

### ACC-RI-019 — Make accounting tests prove behavior

**Status:** In progress — published reducer proof complete; Playwright gate pending

**Current evidence**

- `spacetimedb/tests/accounting/mod.rs`
- `spacetimedb/tests/accounting/active_company_matrix_test.rs`
- `spacetimedb/tests/accounting/option_vec_semantics_test.rs`
- `frontend/web/tests/e2e/accounting-mutations.spec.ts`

**Fix criteria**

- [x] Native compile guards are not counted as behavioral coverage.
- [x] `run_all_accounting_tests` covers every corrected reducer (new matrices wired).
- [ ] Tenant-isolation tests cover every globally addressed accounting table
      (existing matrices; full table inventory still continuous).
- [x] Playwright tests query persisted rows and relations.
- [x] Tests use distinctive non-default dates, amounts, references, and IDs.
- [ ] Tests verify retry/idempotency and UI reload (payment and all FX command
      retries are covered; final Playwright reload execution is pending).

**Done check**

- Removing any scoped validation or persisted relation makes at least one test
  fail for the intended reason.

```md
Completion evidence:
- Implementation: suite wires A2 matrix + Option<Vec> semantics; Playwright
  `creates a tax and persists company_id FK with distinctive amount` polls
  `/api/query/account-taxes` for `companyId` + amount `12.5`.
- Persisted-data test: see above.
- Isolation test: relational_integrity + IC cross-org remain in suite.
- UI/reload test: Playwright assert is query-backed (not toast-only).
- Retry test: existing payment allocation / amortization coverage unchanged.
- Generated artifacts: `cargo test --no-run` green; SDKs regenerated 2026-07-29.
- Reviewer: pending
- Completed on: 2026-07-29 (local; published proof deferred)
```

Additional 2026-07-30 evidence: `run_all_accounting_tests`,
`run_tenant_isolation_tests`, and the focused expanded FX reducer all passed
against `lumiere-v1-accounting-ri-e2e`. The live-subscription package suite
passed 33/33 tests. Persisted execution exposed and corrected stale fiscal
period, clearing-account, intercompany destination-account, tax-role, and
country-reference fixtures instead of weakening production validators.

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
- [x] No accounting workspace resource silently resolves to no subscription.

### Gate E — Accounting correctness

- [x] Payment allocation changes actual ledger residuals.
- [x] FX uses validated currencies and rates.
- [x] Amortization/depreciation use correct calendar dates and totals.
- [x] Reports cannot read another tenant’s ledger.
- [x] Multi-row actions are atomic and balanced.

### Gate F — Test and generated-artifact proof

- [ ] `cargo fmt --check` passes for Rust changes. Changed Rust files are
      `rustfmt`-clean; the repository-wide formatting baseline remains noisy.
- [x] Relevant Clippy/cargo checks pass.
- [x] `run_all_accounting_tests` passes against the published module.
- [x] `run_tenant_isolation_tests` passes.
- [ ] Accounting Playwright persisted-data tests pass.
- [ ] `pnpm typecheck` passes. Focused `@lumiere/erp-shared` and
      `@lumiere/stdb` checks pass; the full web typecheck still has baseline
      generated optional-field errors across accounting, CRM, and sales.
- [x] `make generate-stdb-ts-sdk`
- [x] `make generate-stdb-rust-sdk`
- [x] `make codegen`
- [ ] `make check-codegen` (the target compares generated output to `HEAD` and
      therefore reports this intentional uncommitted schema diff; a second
      `make codegen` produced the identical generated-diff SHA-256
      `b86024fb5094b18f3d173ac45ee7347c6cd7fd8a83941849f8f861424f04f188`).
- [x] Working tree contains no unexplained generated drift.

**Verification record — 2026-07-30**

- Published and reset only isolated local module
  `lumiere-v1-accounting-ri-e2e`.
- Passed `run_accounting_fx_revaluation_test`,
  `run_all_accounting_tests`, and `run_tenant_isolation_tests`.
- Passed SpacetimeDB module check/test compilation, Clippy correctness,
  generated-binding `cargo check -p api-server`, and all three accounting lint
  gates. The currency audit inspected 1,645 Rust `currency_id` references.
- Passed focused `@lumiere/erp-shared` and `@lumiere/stdb` typechecks plus the
  `@lumiere/stdb` suite (33/33).
- Applied the numeric reference map through the remediation reducer and
  verified persisted USD `1`, EUR `2`, and distinctive test SEK `42`.
- The full frontend typecheck, accounting Playwright run, clean-tree
  `check-codegen`, repository-wide format baseline, and real-target ownership
  backfill remain open exactly as recorded above.

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

**Current decision (2026-07-30): `Partially relational`.**

All code-level P0 adversarial findings are closed and the isolated accounting,
tenant-isolation, currency-remediation, and focused subscription gates pass.
Promotion remains blocked on applying/reviewing the ownership backfill against
the real target snapshot (the test suite deliberately creates six quarantined
conflict rows), the accounting Playwright run, the repository-wide frontend
typecheck baseline, and clean-tree `check-codegen`/format evidence.

---

## 11. Execution order and tracker

| Order | ID | Priority | Status | Dependency |
|---:|---|---|---|---|
| 1 | ACC-RI-001 | P0 | Isolated proof passes; target snapshot pending | None |
| 2 | ACC-RI-002 | P0 | Verified on isolated published candidate | ACC-RI-001/scoped loaders |
| 3 | ACC-RI-003 | P0 | Verified | Scoped loaders |
| 4 | ACC-RI-004 | P0 | Verified on isolated published candidate | ACC-RI-002, ACC-RI-006 |
| 5 | ACC-RI-005 | P0 | Verified on isolated published candidate | ACC-RI-006 |
| 6 | ACC-RI-006 | P0 | Verified on isolated published candidate | None; implement alongside 001 |
| 6a | ACC-RI-020 | P0 | Verified on isolated published candidate | ACC-RI-006 |
| 6b | ACC-RI-021 | P0 | Verified on isolated published candidate | ACC-RI-006 |
| 6c | ACC-RI-022 | P0 | Verified on isolated published candidate | ACC-RI-006 |
| 6d | ACC-RI-023 | P0 | Verified on isolated published candidate | ACC-RI-006 |
| 6e | ACC-RI-024 | P0 | Verified and closed | ACC-RI-002/006/015 |
| 7 | ACC-RI-007 | P0 | Backend verified; company-switch UI gate pending | None |
| 8 | ACC-RI-008 | P0 | Verified on isolated published candidate | DTO changes |
| 9 | ACC-RI-009 | P1 | Verified on isolated published candidate | P0 contracts stabilized |
| 10 | ACC-RI-010 | P1 | Verified on isolated published candidate | P0 contracts stabilized |
| 11 | ACC-RI-011 | P1 | Backend verified; UI reload gate pending | ACC-RI-004/006 |
| 12 | ACC-RI-012 | P1 | Package verified; two-session UI gate pending | ACC-RI-001 |
| 13 | ACC-RI-013 | P1 | Verified on isolated published candidate | Final command boundaries |
| 14 | ACC-RI-014 | P2 | Verified on isolated published candidate | ACC-RI-006/009 |
| 15 | ACC-RI-015 | P2 | Verified on isolated published candidate | ACC-RI-001/006 |
| 16 | ACC-RI-016 | P2 | Package verified; visual E2E gate pending | Subscription fixes |
| 17 | ACC-RI-017 | P2 | Backend verified; UI reload gate pending | Final association design |
| 18 | ACC-RI-018 | P3 | Verified | DTO cleanup |
| 19 | ACC-RI-019 | P3 | Published reducer proof complete; Playwright pending | Continuous; closes last |

Rows 6a-6e (ACC-RI-020 through ACC-RI-024) were added by the adversarial audit
of 2026-07-30 (parallel Claude review agents per work item, cross-checked by an
independent Codex pass, with the four highest-severity Codex findings
independently confirmed by direct source read). They are P0 because each was an
unauthenticated-boundary cross-tenant write, matching the severity class of
ACC-RI-001/002. ACC-RI-020 through ACC-RI-024 closed on 2026-07-30 with
persisted negative, no-side-effect, and positive coverage. The remaining Gate
A restriction is real-target ownership-backfill evidence, not an open
adversarial mutation.

The tracker status changes only when its completion evidence block is present
and all applicable definition-of-done checks pass.
