# PR #3 follow-up: remaining work

**Status:** Tracking — opened immediately after PR #3 merged to `main`
**Purpose:** PR #3 ("STDB-owned durable Postgres + org tenant placement" and
the P0 e2e stabilization pass that rode along with it) merged with known
gaps rather than leaving them undocumented in someone's head. This doc lists
exactly what's left, split into (1) concrete bug fixes carried over from the
e2e stabilization pass and (2) the structural fix that was proposed instead
of hand-patching further, which has already been scoped in a separate plan.

## 1. Remaining SQL dialect bug fixes (from the e2e stabilization pass)

Full detail, confirmed error messages, and the established fix pattern are
in [spacetimedb-sql-dialect-subscription-gaps-plan.md](./spacetimedb-sql-dialect-subscription-gaps-plan.md).
Everything below was confirmed via a full rerun of all 274 client
subscription queries against the live local SpacetimeDB
(`spacetime sql`), not guessed. The fix pattern for all of it is the same
one already applied to `timesheets-to-validate` and
`purchase-orders-to-approve`: drop the unsupported SQL-level filter from
`frontend/packages/stdb/src/queries/erp-subscriptions.ts`, add (or extend) a
match arm in `api-server/src/query_exec.rs` that fetches without the filter
and post-filters the rows in Rust with `.retain(...)`.

**Enum-literal comparisons rejected regardless of casing** (6 confirmed
resources — `state = '<literal>'` against a sum-type column is never valid
SQL in this SpacetimeDB version):
- `sale-orders-to-approve` (`sale_order.state = 'toApprove'`) — note this
  was *believed* fixed at one point during PR #3 but a full-sweep rerun
  proved it wasn't; only the `purchase_order` counterpart actually got the
  Rust post-filter arm. Don't trust the "fixed" label without checking
  `query_exec.rs` directly.
- `leaves-to-approve` (`hr_leave.state = 'confirm'` / `'validatedOne'`)
- `payslips-to-export` (`hr_payslip.state = 'verify'`)
- `expense-sheets-to-approve` (`expense_sheet.state = 'submitted'`)
- `expenses-missing-receipt` (`hr_expense.state = 'draft'`)
- `expense-policy-exceptions` (`hr_expense_policy_exception.state = 'pending'`)

**Plain `=` equality against `Option<T>` columns rejected** (same
underlying engine gap as `IS NULL`, but not previously documented —
discovered in the full-sweep rerun):
- `account_asset`, `account_fiscal_year`, `account_period`,
  `consolidation_elimination_entry`, `consolidation_journal`,
  `consolidation_account` — all filter on `organization_id = <n>`, and
  `organization_id` is `Option<U64>` on these specific tables (unlike most
  other tables where it's required).
- `ai_document_processing_job`, `ai_insight`, `res_partner_bank` — filter on
  `company_id = <n>`, same issue.
- `hr_employee` (both query variants used by the app) — filter on
  `user_id = 0x<identity>`, where `user_id` is `Option<Identity>`.

**`NOT IN (...)` unsupported** (1 confirmed instance, plain `String`
column so not an enum issue — likely fixable with `!=` rewrite rather than
a Rust post-filter, needs a quick confirmation first):
- `hr_employee_document.purpose NOT IN ('tax_id', 'identity')`

**Unrelated schema bug** (not a dialect gap — a real column-not-in-scope
error, needs its own investigation):
- `stock_landed_cost_lines` query references `company_id`, which the engine
  says isn't in scope for that table/view.

**Open question, not yet resolved:** whether a single broken query in the
274-query combined subscription batch fails live updates for the *entire*
batch, not just the offending resource (SpacetimeDB's `onError` fires once
per batch call, not per query). If true, fixing the list above may resolve
symptoms in resources that have no broken query of their own — e.g.
`helpdesk-teams`, which failed to populate live in one repro during PR #3
despite no known-bad query being found for it. Re-test this once the list
above is fully fixed: full `E2E_CLEAR_DB=1` reseed, then a live-browser
repro checking for `[stdb] subscription error` in the console.

## 2. Structural fix: fold subscription SQL generation into the IR

Rather than continuing to hand-patch each newly-discovered SQL dialect gap
one at a time, [subscription-query-ir-codegen-plan.md](./subscription-query-ir-codegen-plan.md)
(already scoped, landed on `main` alongside PR #3) proposes generating
subscription queries from the application-contract IR instead of the
current hand-authored, duplicated TypeScript (`erp-subscriptions.ts`) and
Rust (`erp_subscriptions.rs` / `erp-org-sql.json`) implementations. The IR
already carries each column's real type (`Option<T>`, enum/sum-type, etc.)
— the same information source already used for
`stdb-http-option-fields.json` and `resource_registry.json` — so a codegen
step can either reject an unsupported SQL shape at build time or
automatically lower it into the correct post-fetch-filter form, instead of
each gap being discovered independently via a flaky e2e test months apart.

Whoever picks this up should treat §1 above as the *known, finite* patch
list to keep the current hand-authored system correct in the meantime, and
the IR/codegen plan as the actual fix for why this bug class keeps
recurring.
