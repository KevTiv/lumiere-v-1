# PR #3 follow-up: remaining work

**Status:** Reconciled into PR #4 — tactical fixes complete; subscription IR remains
**Purpose:** PR #3 ("STDB-owned durable Postgres + org tenant placement" and
the P0 e2e stabilization pass that rode along with it) merged with known
gaps rather than leaving them undocumented in someone's head. This doc lists
exactly what's left, split into (1) concrete bug fixes carried over from the
e2e stabilization pass and (2) the structural fix that was proposed instead
of hand-patching further, which has already been scoped in a separate plan.

> Rebase note (2026-09-01): PR #4 is now the implementation source of truth.
> It preserves the HTTP post-filter fixes described below, routes browser
> realtime through API-owned invalidations, and keeps optional/inherited
> company and identity-sensitive resources BFF-only. The current contracts pin
> is `lumiere-contracts` v0.3.24. Historical v0.3.2/v0.3.3 release details are
> retained below as incident evidence, not as current repository state.

## 1. Remaining SQL dialect bug fixes (from the e2e stabilization pass)

**Status: done**, except the unrelated schema bug noted at the bottom.
Full detail, confirmed error messages, and the established fix pattern are
in [spacetimedb-sql-dialect-subscription-gaps-plan.md](./spacetimedb-sql-dialect-subscription-gaps-plan.md).
Everything below was confirmed via `spacetime sql` against a live local
instance both before and after the fix, not guessed.

The fix pattern is the same one already applied to `timesheets-to-validate`:
drop the unsupported SQL-level filter from
`frontend/packages/stdb/src/queries/erp-subscriptions.ts`, add (or extend) a
match arm in `api-server/src/query_exec.rs` that fetches without the filter
and post-filters the rows in Rust with `.retain(...)`. Two things were
learned applying it this time:

- **`purchase-orders-to-approve` was never actually fixed** despite an
  earlier version of this doc (and the doc before it) claiming it was —
  `query_exec.rs` had no arm for it, and `erp_org_extra_where`'s
  `state = 'toApprove'` fragment was still being concatenated onto the
  purchasing company-scope dispatch. Fixed now alongside the six below.
  If this doc is ever revised again, don't trust a "fixed" label without
  grepping `query_exec.rs` for the resource key directly — this is the
  second time that check would have caught a stale claim.
- **`crates/stdb-auth/src/erp_subscriptions.rs` is a second, independently
  hand-maintained copy** of this same subscription-SQL logic (used by
  `api-server/src/realtime/mod.rs` for the server-side realtime path, not
  just `erp-subscriptions.ts`'s browser path), and it carried the exact same
  bugs. Every fix below was applied in both places. Note also that
  `erp_org_extra_where`/`ERP_ORG_ROWS` in that same Rust crate is sourced
  from the **pinned external `lumiere-contracts` crate** (`Cargo.toml`,
  then pinned at tag `v0.3.2`), not from this repo's `.contracts-staging/`
  directly — so a `cargo run -p lumiere-codegen` here does *not* update what
  that crate embeds. The six enum-literal resources and
  `purchase-orders-to-approve` are therefore fixed via dedicated match arms
  that bypass `erp_org_extra_where`/`erp_org_line` entirely (same technique
  the pre-existing `timesheets-to-validate` arm used), not by editing the
  pinned JSON. Bumping the `lumiere-contracts` pin to a release that carries
  the corrected `erp-org-sql.json` is separate follow-up work, not required
  for correctness here.

**Attempted the pin bump; reverted it — the pinned release process has an
unrelated, deeper break.** `make publish-contracts VERSION=0.3.3` (after
fixing a real but separate blocker — `packages/contracts/package.json` in
`lumiere-contracts` was missing `esbuild` as a devDependency, causing
`require("esbuild")` to fail during bundling; fixed and pushed to
`lumiere-contracts` `main` directly) succeeded and pushed tag `v0.3.3`. But
bumping this repo's pin to it broke `@lumiere/stdb` typecheck:
`Cannot find module '@lumiere/contracts/generated/operation-inputs'`.
Root cause: `operation-inputs.ts` is produced by `lumiere-contracts`' own
`scripts/generate-from-ir.py` (consuming `ir/PIN.json`) — a second,
IR-owned generator living entirely in that repo, per its README. This
repo's `scripts/publish-contracts.sh` never calls it; it wholesale
`rm -rf`s `packages/contracts/src` and replaces it with a raw
`.contracts-staging/ts/generated` copy (`spacetime generate` +
`lumiere-codegen` output only), so `operation-inputs.ts` — present in the
already-published `v0.3.2` — has no path to get regenerated and silently
disappears. **Reverted** `Cargo.toml`/`Cargo.lock`, both `package.json`s,
and `pnpm-lock.yaml` back to `v0.3.2` (verified `git status` clean, `cargo
check` and `pnpm typecheck` both green again). Tag `v0.3.3` is live on
GitHub but unused by this repo — left in place rather than force-deleting a
pushed tag without being asked; whoever picks this up should decide whether
to delete it or fold `generate-from-ir.py` into the next real publish
attempt. Fixing `publish-contracts.sh` to invoke `generate-from-ir.py` (and
correctly update `ir/PIN.json` first) is real, scoped follow-up work, not
attempted here — it touches release automation for two repos and needs its
own investigation into how `ir/PIN.json`'s `source_commit`/`artifact_sha256`
fields are meant to be kept in sync.

**Enum-literal comparisons rejected regardless of casing** (7 resources incl.
`purchase-orders-to-approve` — `state = '<literal>'` against a sum-type
column is never valid SQL in this SpacetimeDB version) — **fixed**, in
`frontend/packages/stdb/src/queries/erp-subscriptions.ts`,
`api-server/src/query_exec.rs`, and `crates/stdb-auth/src/erp_subscriptions.rs`:
- `sale-orders-to-approve` (`sale_order.state = 'toApprove'`)
- `purchase-orders-to-approve` (`purchase_order.state = 'toApprove'`)
- `leaves-to-approve` (`hr_leave.state = 'confirm'` / `'validatedOne'`)
- `payslips-to-export` (`hr_payslip.state = 'verify'`)
- `expense-sheets-to-approve` (`expense_sheet.state = 'submitted'`)
- `expenses-missing-receipt` (`hr_expense.state = 'draft'`)
- `expense-policy-exceptions` (`hr_expense_policy_exception.state = 'pending'`)

**Plain `=` equality against `Option<T>` columns rejected** (same
underlying engine gap as `IS NULL`) — **fixed**, same three files as above:
- `account_asset` (`fixed-assets`), `account_fiscal_year` (`fiscal-years`),
  `account_period` (`account-periods`), `consolidation_elimination_entry`
  — `organization_id` is `Option<U64>` on these tables; fixed by dropping
  the org filter and keeping only the (required, non-null) `company_id`
  filter. `company.id` is a single global auto-increment primary key, so
  this is exactly as precise as the org filter was, not a looser workaround.
- `consolidation_journal`, `consolidation_account` — same `Option<U64>`
  `organization_id` issue, but these two tables have no `company_id` column
  at all (only `company_ids: Vec<u64>`, also unfilterable via SQL), so there
  is no SQL-level scope left once the org filter is dropped — both now fetch
  unfiltered, matching the pre-existing (already-unscoped) Rust HTTP arms in
  `query_exec.rs`.
- `ai_document_processing_job`, `ai_insight` — `company_id = <n>` against
  `Option<U64>`. The HTTP path in `query_exec.rs` already fetched-all +
  Rust-filtered for these; only the WS subscription SQL was still broken.
- `res_partner_bank` (`partner-banks`) — same `company_id` issue; fixed by
  dropping the company filter and keeping only the org filter (required,
  non-null on this table), with the Rust HTTP path now keeping shared
  (NULL-company) rows too via `row_company_matches(.., allow_shared: true)`.
- `hr_employee` (`my-employee`, `employees`, both variants) — `user_id =
  0x<identity>` against `Option<Identity>`. Fixed by dropping the filter and
  post-filtering in Rust (`row_identity_option_is`, new helper in
  `query_exec.rs` — note the SATS-JSON unwrap represents a present
  `Option<Identity>` as a one-element array `["0x..."]`, not a bare string,
  confirmed against a live `--format json` response, not assumed).
- Also fixed the same class of bug in **`intercompany_rule`/
  `intercompany_transaction`/`account_asset_depreciation_line`**
  (`intercompany-rules`, `intercompany-transactions`, `depreciation-lines`),
  found while touching the same function — not in the original confirmed
  list, but identical `organization_id: Option<u64>` pattern. The Rust HTTP
  side already handled all three correctly; only the WS subscription SQL
  needed the fix. `depreciation-lines` has **both** `organization_id` *and*
  `company_id` as `Option<u64>`, so no SQL-level scope is possible at all —
  it now fetches unfiltered, matching the existing Rust HTTP arm's approach
  (two-level scoping resolved entirely in Rust).

**`NOT IN (...)` unsupported** — **fixed** via the `!=` rewrite (confirmed
working with `spacetime sql`, unlike the enum cases since `purpose` is a
plain `String` column, not a sum type):
- `hr_employee_document.purpose NOT IN ('tax_id', 'identity')` →
  `purpose != 'tax_id' AND purpose != 'identity'`

**Unrelated schema bug — fixed on PR #4 after this investigation** (not a
dialect gap — it was a real column-not-in-scope error):
- `stock_landed_cost_lines` query references `company_id`, which the engine
  says isn't in scope for that table/view.

**Open question — resolved, and the real root cause is much bigger than §1.**
Did a full `E2E_CLEAR_DB=1` reseed + live-browser repro (signed in as the
seeded test user, local Next.js dev server + local api-server + local
SpacetimeDB with all of §1's fixes applied). `[stdb] subscription error {}`
still fired on first connect, before any navigation. The `{}` was misleading:
`context.tsx`'s `.onError((err) => console.error(..., err))` names the
*context* object `err` (the SDK's real signature is `onError(ctx, error)`,
two args — the actual `Error` was being silently dropped). Reconstructing
the real error (via a standalone Node script using the same
`DbConnection`/`subscriptionBuilder` SDK path, not `spacetime sql`) surfaced
the true cause:

> `Error: Column projections are not supported in subscriptions;
> Subscriptions must return a table type`

**Confirmed empirically, not guessed** (isolated `DbConnection` +
`subscriptionBuilder().subscribe([sql])` calls against the live local
instance):
- A subscription query must be exactly `SELECT * FROM <table> [WHERE ...]`.
  *Any* explicit column list is rejected — even one that lists literally
  every column of the table in the table's own order (tested against
  `purchase_order`'s full 54-column list; still rejected).
- Separately, `ORDER BY` is **also** entirely unsupported in subscriptions
  (`SELECT * FROM purchase_order WHERE organization_id = 195 ORDER BY id
  DESC` → `Unsupported: ...`), independent of the projection issue.
- This is a **different SQL surface than `spacetime sql`** (the `/sql` HTTP
  endpoint), which happily accepts column-projected and `ORDER BY` queries —
  confirmed by re-running several now-rejected subscription queries through
  `spacetime sql` and watching them succeed. §1 above (and the *entire*
  prior investigation, including the original "274-query sweep") tested
  exclusively via `spacetime sql`/the HTTP endpoint, so this class of bug
  was structurally invisible to that methodology the whole time.

**Blast radius:** `frontend/packages/stdb/src/queries/erp-subscriptions.ts`
builds virtually every non-auth subscription query via
`resolveHttpSqlColumns(...)` — an explicit, field-policy-restricted column
list — through `selectOrgScopedSql`/`selectCompanyScopedSql`/
`subscriptionSqlForCompanyScopedResource`/the `ERP_ORG_SQL` map. At the time
of the investigation, that meant essentially the **entire direct-row ERP
subscription surface was non-functional**, not just the handful of resources
with enum/`Option<T>` bugs. `auth.ts`
(`authSubscriptions`, boot resources) mostly already uses `SELECT *` — with
one exception, `field_permission`, which still projects columns and is
therefore *also* broken, in the same boot batch as `roles`. This fully
explains the "batch atomicity"/`helpdesk-teams` symptom from PR #3: it was
never really about one bad query poisoning a batch of otherwise-good ones —
almost the entire batch was bad, for a reason invisible to `spacetime sql`
testing. §1's enum/`Option<T>`/`NOT IN` fixes are still correct and still
necessary (`spacetime sql`/the HTTP query path — `api-server/src/query_exec.rs`
— genuinely required them), but they do **not** fix live subscriptions on
their own, because the column-projection and `ORDER BY` issues sit on top of
every one of them.

**Resolved architecturally on PR #4, with structural follow-up still open:**
the server-side realtime bridge rewrites authorized invalidation subscriptions
to supported full-row shapes, keeps complete rows inside the API server, and
sends browser invalidations that refetch projected rows through HTTP. Direct
browser full-row caching is disabled by default. Rewriting
`erp-subscriptions.ts` (+ its Rust mirror,
`crates/stdb-auth/src/erp_subscriptions.rs`) to emit `SELECT * FROM <table>
WHERE ...` (no `ORDER BY`, sorted client-side instead, mirroring how
`api-server/src/query_exec.rs` already avoids `ORDER BY` in SQL for the same
reason) raises a real security question that needs a decision, not an
assumption: switching from a restricted column list to `SELECT *` means the
**client's local subscription cache receives every column of every
subscribed row, regardless of field policy** — including HR/PII fields that
`resolveHttpSqlColumns` currently strips for the HTTP path. Whether that's
acceptable (enforce field redaction client-side in `projection.ts` before
it reaches UI code/query cache) or unacceptable (field-sensitive resources
must stay HTTP-only, `realtime: false`, matching the "Private/BFF-only"
class already described in
[subscription-query-ir-codegen-plan.md](./subscription-query-ir-codegen-plan.md)
§11E) is exactly the kind of call that IR/codegen plan's phase SQ-0 census
(§16) is meant to make resource-by-resource — this finding is a strong
argument for prioritizing that structural work over further hand-patching.

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
