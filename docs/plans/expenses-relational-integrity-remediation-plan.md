# Expenses Relational Integrity Remediation Plan

**Module:** Expenses only

**Source audit:** Expense relational-integrity audit, 2026-07-26

**Owner:** Unassigned

**Target release:** Unassigned

**Current readiness:** **Unsafe for real ERP data**

**Target readiness:** Production ready after every P0/P1 item and release gate is verified

**Allowed pilot restrictions:** Synthetic-data sandboxes only. Disable expense CSV imports, `fx_rate` intents, project rebilling, advance issuance/application, card match/unmatch, and partial reimbursement until their corresponding P0/P1 items are verified.

**Non-goal:** Redesigning accounting, projects, HR, or global currency storage beyond the changes required to make expense relationships safe.

---

## 1. Purpose

This document is the executable remediation plan for the expense relational-
integrity audit. It covers:

- Expense-owned tables and reducers in `spacetimedb/src/expenses/`
- Expense CSV imports in `spacetimedb/src/data_ops/expenses_imports.rs`
- Expense integration worker contracts
- Generated Rust and TypeScript contracts
- Query resources, subscriptions, hooks, mappers, forms, and panels
- Persisted-data, isolation, retry, lifecycle, and refreshed-read verification

Compilation, generated bindings, a successful reducer call, or a UI toast does
not close an item. Only the proof package and release gates below count as
completion.

## 2. Global definition of done

An item may be marked **Verified** only when every applicable condition is met:

- [ ] Every stored relation has one documented business source.
- [ ] Every referenced row is loaded before its ID is persisted.
- [ ] Organization, company, permission, lifecycle, type, and operation
      compatibility are validated server-side.
- [ ] Organization and company come from authenticated context or a validated
      parent, not editable fields or fallback IDs.
- [ ] No currency, employee, account, project, tax, receipt, partner, journal,
      sheet, move, or rate ID can be unknown, zero, silently omitted, or mapped
      to a different record.
- [ ] No business date silently becomes the current timestamp.
- [ ] Create, unchanged, clear, and replace semantics are explicit.
- [ ] Collection operations distinguish unchanged, replace, and clear; add and
      remove are explicit where incremental editing is supported.
- [ ] Multi-row actions are atomic and retry-safe.
- [ ] Idempotency is scoped by organization, company, action, and key, and a
      reused key with a different payload is rejected.
- [ ] Read paths enforce the same organization/company policy as writes.
- [ ] Important relations resolve to stable IDs and useful labels after reload.
- [ ] Generated bindings, mappers, hooks, form state, and backend contracts
      agree.
- [ ] Persisted-data tests use distinctive non-default values.
- [ ] Negative tests cover missing, cross-organization, cross-company,
      unauthorized, inactive, archived/deleted, state-incompatible, and
      currency-incompatible references where applicable.
- [ ] Existing invalid data is backfilled, quarantined, or explicitly blocked
      before stricter contracts are enabled.

Allowed tracker statuses:

```text
Not started
In progress
Blocked
Implemented, unverified
Verified
Deferred with restriction
```

Only **Verified** counts as done.

## 3. Closure evidence

Attach this block to every completed tracker item:

```md
Completion evidence:
- Implementation:
- Schema/contract:
- Migration/backfill:
- Persisted positive test:
- Isolation and negative tests:
- Update/collection semantics test:
- Retry/rollback test:
- Fresh read/UI test:
- Generated artifacts and checks:
- Reviewer:
- Completed on:
```

## 4. Canonical implementation patterns

### 4.1 Expense-specific scoped relation loaders

Create small, operation-aware loaders. Share tenant checks, but do not hide
relation-specific rules in a generic “exists” helper.

Required loaders:

```text
load_expense_company
load_active_expense_employee
resolve_active_expense_currency
load_expensable_product
load_purchase_tax
load_expense_account
load_analytic_account
load_active_expense_project
load_expense_receipt
load_expense_sheet_for_line
load_card_statement_line
load_expense_partner
load_expense_fiscal_position
load_expense_journal
```

Each loader must:

```text
load by ID
→ reject missing
→ validate organization
→ validate company or documented global/shared scope
→ validate caller permission where relation access is restricted
→ validate active/deleted/archived state
→ validate relation-specific type and operation compatibility
→ return the loaded row for use by the mutation
```

Rust implementation requirements:

- Return `Result`; expected input failures must not panic.
- Borrow inputs instead of cloning solely for validation.
- Use `?` for propagation.
- Keep domain-specific checks visible at the operation call site.
- Use lowercase error messages without trailing punctuation for new errors.

### 4.2 System-owned tenant context

Frontend mutations must not use `?? 0n`. If active company context has not
loaded, the action must remain disabled with an actionable message.

For mutations targeting an existing sheet, expense, advance, card line,
exception, or receipt, remove `company_id` from the command and derive company
from the validated parent. For top-level create commands, accept the active
company from protected session context and validate it on the backend.

### 4.3 Validated currency boundary

Do not let the legacy numeric currency helper map unknown values to USD.

For the expense module:

1. Introduce a fallible resolver from numeric ID to an active ISO currency row.
2. Reject IDs outside the supported mapping.
3. Reject inactive or unseeded currency rows.
4. Require rate and sheet currencies to match their selected expense currency.
5. Store the resolved ISO code in immutable FX snapshots where accounting
   evidence needs it.

Advance issuance must either:

- require advance currency to equal company currency; or
- store document amount, document currency, FX rate, and company amount, and
  post the company amount.

The first option is the rollout-safe initial implementation. Multi-currency
advances may be enabled only after the second option has persisted-data tests.

### 4.4 Intent-shaped worker commands

Workers must not mutate `expense_sheet.currency_rate` from generic JSON.

Preferred flow:

```text
worker provider result
→ typed, authenticated currency-rate command
→ validate organization/company/currency pair/effective date/provider key
→ upsert scoped currency_rate row idempotently
→ expense sheet submit resolves and snapshots that rate
```

Remove direct sheet mutation from the `fx_rate` intent path. OCR, email, card,
and delayed-sync payloads must use typed payload structs and require the actual
business date. They must call the same internal create implementation as the
interactive path.

### 4.5 Explicit patch and collection semantics

Use a transport shape that can express:

```text
absent       → unchanged
null         → clear when allowed
value        → validate and replace
empty array  → clear collection
non-empty    → validate all and replace collection
```

For Rust/SpacetimeDB, use `Option<Option<T>>`, an explicit patch enum, or named
set/clear reducers based on generated-client support. Do not keep
`.or(existing)` where the UI needs to clear a field.

### 4.6 Atomic idempotent commands

Idempotency lookup must include:

```text
organization_id
company_id
action
client_request_id
request_hash
result record IDs
```

Same key and same request returns the original result. Same key and different
request fails with an idempotency-conflict error. The boundary must cover the
complete logical action, including receipts, expense lines, allocations,
advances, applications, moves, and audit rows.

### 4.7 Relation-aware reads

Expense list/detail reads must provide stable IDs and useful labels for:

- employee
- company
- currency
- sheet
- product
- account
- analytic account
- project
- mileage/per-diem rate
- receipts
- card statement match
- advances and applications
- posting, reimbursement, and rebill moves

Read authorization must filter by authorized company IDs in addition to
organization. Missing or archived relations must render as an explicit warning,
not an unexplained blank or raw ID.

## 5. Remediation tracker

| ID | Priority | Problem and risk | Affected paths | Required fix | Application pattern | Migration/backfill | Acceptance criteria | Done evidence | Status |
|---|---|---|---|---|---|---|---|---|---|
| EXP-RI-001 | P0 | CSV imports directly insert unvalidated rows and invent dates/defaults | `spacetimedb/src/data_ops/expenses_imports.rs`, expense create helpers, import tests | Stage and validate rows; reuse normal create implementations; Draft-only; derive totals; reject missing dates and raw sheet links | Scoped loaders; intent-shaped command; atomic import row | Audit/quarantine invalid company, employee, currency, sheet, account, analytic, project, tax, rate, and receipt IDs | Invalid row persists nothing; valid distinctive row reloads with exact relations; no current-date fallback | Required proof package | Not started |
| EXP-RI-002 | P0 | Generic `fx_rate` intents can alter cross-company or posted sheets | `expense_wave_d.rs`, integration worker, intent bindings/tests | Remove direct sheet mutation; write validated scoped rate data; snapshot only during sheet submit | Typed worker command; scoped loader; system-owned context | Find sheets whose rate changed after submit/approval/post; compare with move evidence; quarantine mismatches | Worker cannot write another company’s rate or alter any sheet directly; submitted snapshot and posted move remain immutable | Required proof package | Not started |
| EXP-RI-003 | P0 | Unknown currency IDs silently map to USD; advance FX is not represented | currency helper call sites in expenses, `expenses.rs`, `expense_depth.rs`, `expense_wave_d.rs`, `expense_wave_e.rs`, forms/panels | Add fallible expense currency resolver; remove UI ID defaults; initially restrict advances to company currency; later add explicit FX snapshot if needed | Validated currency boundary; scoped selector | Scan IDs outside supported set and ID/code mismatches; quarantine ambiguous rows | Unknown/inactive currency rejected everywhere; no fallback to USD; advance GL amount equals validated company amount | Required proof package | Not started |
| EXP-RI-004 | P0 | Expense reads filter only by organization, not authorized companies | `erp-subscriptions.ts`, query registry/field policy, hooks, workspace subscriptions, API query handlers | Define company-visibility policy and enforce it in HTTP and WebSocket reads for every expense resource | Relation-aware reads; server authorization | Identify rows exposed outside users’ company memberships; no data rewrite unless ownership is invalid | Company A1-only user cannot read A2 rows; documented shared rows are the only exception | Required proof package | Not started |
| EXP-RI-005 | P1 | Core expense and sheet creates persist unverified employee, currency, account, analytic, tax, product lifecycle, and project lifecycle relations | `expenses.rs`, generated params, hooks, create/edit forms | Load every relation before insert/update; require active employee; validate purchase tax/account/analytic/project compatibility | Scoped relation loaders | Scan existing dangling, cross-scope, inactive, and type-incompatible relations; repair or quarantine | Full positive and negative relation matrix passes for create and update | Required proof package | Not started |
| EXP-RI-006 | P1 | A line can be attached after sheet submission; totals/FX/approval evidence can become stale | `submit_expense`, sheet lifecycle reducers, add-to-report UI/options | Permit line attachment only to Draft sheets; recompute totals on Draft mutations; submitted sheets require explicit return-to-draft workflow | Selected-parent wiring; lifecycle guard | Find Submitted/Approved sheets whose current line sum differs from submitted snapshot | Submitted/Approved sheets reject line add/remove; approval sees immutable submitted content | Required proof package | Not started |
| EXP-RI-007 | P1 | Card match/unmatch ignores currency and lifecycle and can drift after posting | `expense_wave_e.rs`, card inbox/ops UI, card tests | Require same company/currency, compatible amount and merchant, allowed line/sheet states; lock match at post or add explicit reconciliation adjustment workflow | Scoped relation loader; explicit state transition | Identify posted expenses whose match changed after post or whose currencies differ | Cross-currency and posted-state match/unmatch rejected; explicit correction workflow tested if supported | Required proof package | Not started |
| EXP-RI-008 | P1 | Rebill trusts project, partner, and fiscal-position IDs and silently chooses first partner | `expense_depth.rs`, project rebill form/hook/tests | Revalidate active same-company projects; derive partner/fiscal position; require one customer per invoice or intentionally split invoices; validate taxes/accounts | Scoped loaders; intent-shaped command | Find rebill moves with cross-company/missing projects, ambiguous customers, or invalid partner/fiscal position | Rebill creates only correctly scoped invoice(s); mixed customers are rejected or split atomically | Required proof package | Not started |
| EXP-RI-009 | P1 | Partial reimbursements are one-to-many but schema stores only the latest move; UI omits retry key | `expenses.rs`, expense tables/bindings, reimbursement hook/form/read model | Add reimbursement association table; require idempotency key; retain latest link only as optional derived cache; list every payment | Explicit association; atomic idempotent command; relation-aware read | Backfill existing `reimbursement_move_id`; inspect metadata/source moves for earlier partial payments; quarantine ambiguity | Multiple partial payments remain navigable; retry creates one move; full residual closes exactly once | Required proof package | Not started |
| EXP-RI-010 | P1 | Advance application can be repeated and can change an Approved sheet; post trusts caller-supplied clearing account | `expense_wave_d.rs`, `expenses.rs`, advance UI/hooks/tests | Apply only while sheet is Draft; require request key; store issuance clearing account on advance; derive post clearing lines from applications | Selected parent; atomic idempotent command; server-derived accounting | Backfill clearing account from issuance moves; flag ambiguous moves/applications | Retry creates one application; approved sheet is immutable; post uses issuance account without caller override | Required proof package | Not started |
| EXP-RI-011 | P1 | Idempotency checks are organization-only and do not compare payloads | expense, receipt, advance, intent, card, post/reimburse/rebill create paths | Scope keys by org/company/action; persist request hash/result; reject conflicting reuse | Atomic idempotent command | Detect duplicate keys across companies/actions and conflicting payloads | Same request returns same result; changed payload fails; concurrent retry creates one effect | Required proof package | Not started |
| EXP-RI-012 | P2 | Update contracts cannot distinguish unchanged from clear for optional fields | `UpdateExpenseParams`, generated bindings, mapper, edit form | Add explicit patch semantics for description, account, product, merchant, rates, project, analytic, and attachments | Explicit patch; explicit collection semantics | No backfill; investigate known accidental non-clears only if reported | Omission preserves; null clears; value validates/replaces; `[]` clears only documented collections | Required proof package | Not started |
| EXP-RI-013 | P2 | Raw-ID forms and raw-row reads hide relational meaning and allow mistyped identifiers | expense forms/configs, lookup helpers, read models, entity configs, panels | Replace text IDs/default `1` with scoped selectors; add relation-aware rows, filters, labels, and move/payment navigation | Scoped selector; relation-aware read | None beyond EXP-RI-004/005 data cleanup | Reload shows labels for exact stored IDs; archived/missing relation is visibly flagged | Required proof package | Not started |
| EXP-RI-014 | P3 | Compiler-only metadata, duplicate mappers, and fallback tenant values obscure provenance | allocation submit mapper, coverage helpers, panels/hooks | Remove unused metadata from client contracts or provide real source; eliminate `?? 0n`; centralize validated form mapping | System-owned context; contract cleanup | None | No expense production mapper invents IDs, dates, enum values, or metadata | Required proof package | Not started |

## 6. Detailed work packages

### EXP-RI-001 — Validated expense imports

Required design:

1. Split interactive reducer entry points into thin reducers plus internal
   functions that return created IDs, for example:

   ```text
   create_expense reducer
   → resolve protected context
   → create_expense_impl(validated command)
   → inserted expense ID
   ```

2. Parse each CSV row into the same intent-shaped command.
3. Require explicit `date`, `employee_id`, `currency_id`, name, amount source,
   and active company.
4. Derive `total_amount` from kind-specific inputs. If CSV supplies a total,
   treat it as an assertion and reject a mismatch.
5. Do not accept `sheet_id` on general expense import. A separate import-to-
   selected-Draft-sheet operation may derive the parent ID from command context.
6. Accept Draft state only. Historical migration must use a separate
   superuser-only migration command with accounting evidence.
7. Validate every receipt before inserting the expense.
8. Prevalidate the whole row before writing any receipt, allocation, or line.

Completion gate:

- A CSV row with a cross-company employee, project, account, analytic account,
  tax, sheet, rate, or receipt produces an import error and no business row.
- A blank date is rejected.
- `unit_amount=12.34`, `quantity=3`, and asserted `total_amount=37.02` persist
  exactly; an asserted total of `37.03` is rejected.
- A forced failure after receipt validation leaves no partial expense graph.

### EXP-RI-002 — Safe FX ingestion and immutable sheet snapshots

Required design:

1. Remove `apply_fx_rate_payload` behavior that updates a sheet.
2. Add a typed rate-ingestion command containing:

   ```text
   company_id
   from_currency
   to_currency
   rate
   effective_at
   provider
   provider_reference
   idempotency_key
   ```

3. Restrict the command to a dedicated integration permission/identity.
4. Validate company, both active currencies, positive rate, date bounds, and
   provider/reference uniqueness.
5. At `submit_expense_sheet`, choose a scoped effective rate and store an
   immutable snapshot containing IDs/codes, rate row or provider reference, and
   effective date.
6. Approved/Posted/Done sheets must reject any direct rate mutation.

Completion gate:

- A worker authorized for Company A1 cannot write an A2 rate.
- Retried provider payload produces one rate result.
- A changed payload under the same key fails.
- A sheet submitted with EUR→USD rate `1.234567` retains that snapshot after
  later rate updates and after posting.

### EXP-RI-003 — Currency integrity and advance valuation

Required design:

1. Add a fallible `resolve_expense_currency` helper and replace every call to
   the infallible legacy fallback in expense code.
2. Update forms to load real active currency options; no fallback option is
   inserted.
3. Verify rate currency equals expense currency and sheet currency.
4. For the first safe release, require:

   ```text
   advance.currency_id == company.currency_id
   ```

5. If multi-currency advances are later required, add immutable fields:

   ```text
   document_amount
   document_currency_id
   company_amount
   company_currency_id
   currency_rate
   rate_source
   rate_effective_at
   ```

Completion gate:

- IDs `0`, `10`, and an inactive mapped currency are rejected.
- No expense code path maps an unknown ID to USD.
- Advance amount `123.45` in company currency posts exactly `123.45`.
- Any multi-currency implementation proves document and company amounts with a
  non-1.0 rate.

### EXP-RI-004 — Company-scoped reads

Required design:

1. Define visibility for ordinary employee, approver, expense administrator,
   accountant, and integration worker roles.
2. Apply authorized `companyIds` to every expense HTTP and WebSocket resource.
3. Employee self-service may further filter to the authenticated employee where
   policy requires it.
4. Keep server filtering authoritative; frontend tabs may narrow further only
   for usability.
5. Apply field policy to receipt storage keys, fraud reasons, policy reasons,
   and integration payload/error data.

Completion gate:

- A user assigned only to Company A1 cannot query A2 expense lines, sheets,
  receipts, advances, applications, policy exceptions, card lines, rates,
  allocations, reimbursements, or intents.
- An explicitly authorized organization-wide expense administrator can read
  both companies.
- HTTP initial load and live subscription return the same row set.

### EXP-RI-005 — Core write-side relation validation

Required validation matrix:

| Relation | Required checks |
|---|---|
| Employee | exists; same org/company; active; not deleted/terminated where policy disallows claims |
| Currency | supported mapping; global row exists and active |
| Product | same org; active; expensable; compatible policy |
| Tax | exists; same org/company; active; purchase/none use; supported amount type |
| Account | exists; same org/company; active/non-deprecated; expense-compatible role |
| Analytic account | exists; same org/company; active; plan accepts expense entries |
| Project | exists; same org/company; active; caller may reference; expense/billing compatibility |
| Receipt | exists; same org/company/employee; storage key present |
| Mileage/per-diem rate | exists; same org/company/currency; active and effective on business date |

Apply the same matrix to create, update, CSV, worker intent, card feed, capture
outbox, allocations, submit, and posting revalidation.

### EXP-RI-006 and EXP-RI-007 — Lifecycle locks

Allowed transitions:

```text
Expense line:
Draft → attached to Draft sheet
Draft sheet submit → line Submitted + immutable submission snapshot
Submitted → Approved or Refused
Approved → Posted
Posted → Done through settlement

Card match:
unmatched → matched only before sheet post
matched → unmatched only before sheet post
post consumes and locks the match
```

If correcting a posted match is required, implement an explicit accounting/
reconciliation adjustment command. Do not reopen the generic unmatch reducer.

### EXP-RI-008 — Safe project rebilling

Required design:

1. Revalidate every project and allocation at rebill time.
2. Derive partner from the validated project. Remove arbitrary `partner_id`
   override from the ordinary command.
3. If an override is genuinely required, expose a privileged operation that
   loads the partner, validates company/access, and requires a reason.
4. Derive fiscal position from the validated partner/company relationship.
5. For one invoice, require all billable project shares to resolve to the same
   customer and currency.
6. If multiple customers are supported, create one invoice per customer under
   one atomic idempotency boundary and persist a rebill association collection.
7. Validate sale taxes and tax payable accounts; never silently use the income
   account as the tax account.

### EXP-RI-009 — Reimbursement association model

Add an expense-owned association such as:

```rust
pub struct HrExpenseReimbursement {
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub sheet_id: u64,
    pub source_move_id: u64,
    pub reimbursement_move_id: u64,
    pub amount: f64,
    pub currency_id: u64,
    pub payment_date: Timestamp,
    pub client_request_id: String,
    pub create_uid: Identity,
    pub created_at: Timestamp,
}
```

Required indexes:

```text
by organization
by company
by sheet
by source move
by reimbursement move
by scoped client request key
```

`expense_sheet.reimbursement_move_id` may remain temporarily as a derived
latest-payment cache for compatibility, but it is not the authoritative
relationship. Reads and totals must use the association rows.

### EXP-RI-010 — Advance application integrity

Required design:

1. Store the validated advance clearing account on `HrExpenseAdvance`.
2. Require a client request key on application.
3. Apply advances only to Draft sheets for the same employee, company, and
   currency.
4. Prevent total applications from exceeding both advance residual and eligible
   out-of-pocket sheet amount.
5. Derive posting clearing accounts from application→advance relations.
6. If applications use multiple clearing accounts, post separate credit lines.
7. Refuse arbitrary `advance_account_id` in `PostExpenseSheetParams`.

### EXP-RI-011 — Shared idempotency contract

Either add a small expense command-receipt table or implement equivalent scoped
keys consistently in the business tables. The result must support:

```text
same scope + action + key + hash → return existing result
same scope + action + key + different hash → conflict
different company or action + same text key → independent command
```

Include create expense, create receipt, integration intent, card statement
ingest, advance issue/application, sheet post, reimbursement, and rebill.

### EXP-RI-012 — Explicit expense patch

The update contract must cover all editable relations and values. Suggested
semantics:

| Field | Omitted | `null` | Present |
|---|---|---|---|
| Description | unchanged | clear | replace |
| Product | unchanged | clear | validate/replace |
| Account | unchanged | clear | validate/replace |
| Analytic account | unchanged | clear | validate/replace |
| Project | unchanged | clear | validate/replace |
| Merchant key | unchanged | clear | normalize/replace |
| Attachments | unchanged | not used | `[]` clear; IDs replace |
| Tax IDs | unchanged | not used | `[]` clear; IDs replace |
| Mileage/per-diem rate | unchanged | only when changing kind through explicit operation | validate/replace |

Do not permit ordinary update to change employee, company, currency, sheet, or
line kind. Those require explicit operations with their own compatibility
rules, or remain immutable.

### EXP-RI-013 and EXP-RI-014 — UI/read cohesion and cleanup

Required UI sources:

| Field | Correct source |
|---|---|
| Company | Active company context |
| Employee | Scoped active employee selector or authenticated employee |
| Currency | Active currency selector or validated company default |
| Product | Scoped active expensable-product selector |
| Tax | Scoped active purchase-tax multi-selector |
| Expense account | Scoped compatible account selector or company configuration |
| Analytic account | Scoped active analytic selector |
| Project | Scoped active permitted project selector |
| Sheet | Selected Draft sheet for the same employee/company/currency |
| Journal/accounts on post | Scoped compatible selectors initially; company configuration where authoritative |
| Business dates | User-selected or server-derived from an explicit operation rule |
| Metadata | Server-derived audit/integration data; remove compiler-only client fields |

Actions must be disabled until active company and required lookups are loaded.
Never send `0n`, currency `1`, current date, first option, or arbitrary enum as a
missing-value substitute.

## 7. Migration and backfill plan

Run in this order against a representative copy before production:

1. **Inventory**
   - Count every expense-owned table by organization/company/state.
   - Export every relation ID and idempotency key.
2. **Classify**
   - Valid
   - Missing parent
   - Cross-organization
   - Cross-company
   - Inactive/deleted/incompatible
   - Ambiguous currency
   - Duplicate/conflicting idempotency key
   - Accounting evidence mismatch
3. **Quarantine**
   - Do not silently delete or retarget ambiguous records.
   - Mark affected Draft/Submitted records blocked from workflow.
   - Mark Posted/Done mismatches for finance-led repair.
4. **Backfill**
   - Reimbursement association rows from sheet link, move metadata, and source
     move linkage.
   - Advance clearing account from the issuance move debit line.
   - Currency codes/snapshots only when the numeric mapping and accounting move
     agree.
   - Relation labels are read-side projections, not copied authoritative text.
5. **Reconcile**
   - Sheet total equals line sum.
   - Posted sheet equals source move and line states.
   - Advance residual equals amount minus applications.
   - Source move residual equals reimbursements.
   - Rebill totals equal billable project allocations.
6. **Enable stricter commands**
   - Deploy validators before enabling remediated UI.
   - Keep unsafe imports/intents disabled until backfill verification passes.

Every migration must be idempotent, superuser-restricted, audited, and produce a
machine-readable summary of scanned, fixed, quarantined, and failed rows.

## 8. Required persisted-data test matrix

### Fixture

```text
Organization A
  Company A1
  Company A2
Organization B
  Company B1

User A1: authorized only for Organization A / Company A1
Approver A1: approval permission, distinct identity
Expense admin A: explicitly authorized for A1 and A2

Distinct active and inactive employees, currencies, products, taxes, accounts,
analytic accounts, projects, receipts, rates, partners, journals, advances,
and card lines in each scope.
```

### Positive lifecycle

Use distinctive values:

```text
expense amount: 123.45
quantity: 3
currency: EUR
FX rate: 1.234567
mileage distance: 87.65
allocation shares: 37% / 63%
partial reimbursements: 41.23 and remaining residual
```

Verify through fresh repository/query reads:

1. Exact employee/company/currency/product/tax/account/analytic/project/receipt
   IDs persisted.
2. Sheet total is server-derived from persisted lines.
3. FX snapshot references the expected scoped rate and does not change later.
4. Approval uses a different identity.
5. Post creates balanced move lines with exact company amounts.
6. Card match is locked consistently at post.
7. Advance clearing uses the account stored on the advance.
8. Every partial reimbursement has its own association and move.
9. Rebill uses the validated project customer and fiscal position.
10. Fresh UI reads display relation labels and all payment/move links.

### Negative matrix

For each applicable mutation, prove rejection of:

- missing relation
- ID `0`
- unknown currency
- cross-organization relation
- cross-company relation
- unauthorized relation
- inactive employee/product/rate/project/account
- deleted employee/company
- incompatible tax or account type
- receipt belonging to another employee
- rate with wrong currency or effective date
- line attached to Submitted/Approved/Posted sheet
- card match with different currency
- card unmatch after posting
- advance application after submission
- mixed-customer rebill
- conflicting idempotency payload
- import row with missing business date

### Retry and rollback matrix

- Repeat and concurrently invoke expense create, receipt create, card ingest,
  advance issue/application, post, reimbursement, rebill, and worker apply.
- Assert one logical result for the same request.
- Assert conflicting payload reuse fails.
- Force a child insert/move-line failure and assert no partial parent, child,
  allocation, application, association, move, or audit result remains.

## 9. Verification commands and runtime evidence

Minimum static checks:

```bash
cargo fmt --manifest-path spacetimedb/Cargo.toml --check
cargo check --manifest-path spacetimedb/Cargo.toml
cargo clippy --manifest-path spacetimedb/Cargo.toml -- -D warnings
pnpm typecheck
```

Required runtime checks:

- Execute the expense reducer suites against an isolated SpacetimeDB test
  database.
- Add a new relational-integrity wave covering every P0/P1 negative case.
- Run frontend mapper/unit tests.
- Run BFF contract tests after regeneration.
- Run Playwright with two companies and distinct identities.
- Query persisted rows and related accounting moves after every corrected
  mutation.

Static checks alone do not satisfy a runtime or persisted-data gate.

## 10. Release gates

| Gate | Requirement | Current result | Evidence required to pass |
|---|---|---|---|
| Schema | Reimbursements and other one-to-many effects have real association rows; required advance/FX evidence is represented | Fail | Final table definitions, indexes, backfill result, persisted relation queries |
| Provenance | Every mutation field has one justified source and no ID/date fallback | Fail | Provenance matrix, form sources, request-hash/idempotency proof |
| Scope | Backend and reads enforce organization/company/permission/lifecycle compatibility | Fail | A/A1/A2/B isolation suite for HTTP, WebSocket, reducers, imports, and workers |
| Semantics | Create/update/clear/collection/lifecycle behavior is explicit | Fail | Patch, attachment/tax collection, sheet lock, and card lock tests |
| Read path | Relations resolve to labels/navigation after reload under matching authorization | Fail | Fresh read and Playwright evidence |
| Atomicity | Multi-record writes and retries are safe | Unverified | Forced rollback and concurrent retry evidence |
| Tests | Persisted positive and negative cases pass | Fail | New relational-integrity reducer wave plus BFF/UI suites |
| Contracts | Generated/backend/frontend contracts match final behavior | Unverified | Clean codegen diff, contract tests, Rust checks, TypeScript typecheck |

Any failed or unverified P0 gate blocks production. Material P1 failures block
unrestricted pilot use.

## 11. Implementation order

```text
Phase 0 — Containment
  disable unsafe import/FX/rebill/advance/card/reimbursement surfaces
  add feature flags and operator warning

Phase 1 — Scope and provenance foundations
  EXP-RI-003 currency resolver
  EXP-RI-004 company-scoped reads
  EXP-RI-005 scoped loaders
  EXP-RI-011 idempotency contract

Phase 2 — Unsafe write paths
  EXP-RI-001 imports
  EXP-RI-002 FX ingestion
  EXP-RI-006 lifecycle lock
  EXP-RI-007 card lock
  EXP-RI-008 rebill
  EXP-RI-010 advances

Phase 3 — Relationship representation
  EXP-RI-009 reimbursement association
  EXP-RI-012 explicit patch

Phase 4 — Read/UI completion
  EXP-RI-013 relation-aware reads and selectors
  EXP-RI-014 cleanup

Phase 5 — Backfill, persisted proof, and controlled rollout
  migration inventory/quarantine/backfill
  complete all release gates
  remove containment flags only for Verified items
```

## 12. Final readiness decision

The expense module remains restricted to synthetic-data sandboxes until every
P0 item is Verified and all applicable release gates pass. Any P1 item left
deferred must have an enforceable feature restriction that removes the affected
workflow from pilot access.

Unsafe for real ERP data
