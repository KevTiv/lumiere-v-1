# SpacetimeDB SQL Dialect Gaps in Client Subscription Queries

## Summary

During P0 e2e stabilization (branch `vibe/sliding-window-cold-tier-82802f`), a
systemic bug class was found in how `frontend/packages/stdb/src/queries/erp-subscriptions.ts`
builds both the browser's live WebSocket subscription queries
(`createClientSubscriptions` / `FULL_CLIENT_SUBSCRIPTION_RESOURCES`) and,
via the same string templates, some HTTP query paths: several generated SQL
fragments use syntax SpacetimeDB's SQL engine does not support at all,
regardless of correct casing or escaping. Two instances were found and fixed
in this session; a systematic sweep of all 274 client subscription queries
found roughly a dozen more of the same class still broken, plus a separate,
narrower pattern (`NOT IN (...)`). This doc exists so a future session can
pick the investigation back up without re-deriving the starting point.

## Confirmed bug classes (verified against the live local SpacetimeDB, not guessed)

### 1. `IS NULL` / `IS NOT NULL` against an `Option<T>` column — always rejected

No SQL syntax variant makes this work: `IS NULL`, `IS NOT NULL`, `= NULL`,
`= 'none'`, `= 0`, and struct-literal forms (`(none = ())`) were all tried
directly via `spacetime sql` against a real `Option<u64>` column
(`project_timesheet.timesheet_invoice_id`) and every one was rejected —
either "Unsupported expression" or "cannot be parsed as type
`(some: U64 | none: ())`". This is a genuine engine limitation, not a syntax
mistake.

**Fixed this session:**
- `timesheets-to-validate` / `timesheets-unbilled` subscription+HTTP queries
  had `AND timesheet_invoice_id IS NULL`. Fixed by dropping the SQL-level
  null check and post-filtering in Rust
  (`api-server/src/query_exec.rs`, new match arm for these two resource
  keys, using `rows.retain(...)` — mirrors the existing `row_company_matches`
  post-fetch-filter idiom already used elsewhere in that file).
- The `crmOptionalCompanyTables` subscription query builder in
  `erp-subscriptions.ts` had
  `WHERE organization_id = X AND (company_id = Y OR company_id IS NULL)`
  for `contacts`, `opportunities`, `contact-phone-identities`,
  `contact-role-assignments`, `contact-communication-preferences`. Fixed by
  dropping the SQL-level company filter entirely (subscribe org-wide) and
  relying on the client-side filter that already exists and is exactly
  equivalent: `frontend/packages/stdb/src/live/projection.ts`'s
  `CRM_OPTIONAL_COMPANY_RESOURCES` branch already does
  `cid == null || cid === ids[0]` in JS after the rows arrive.

**Update — the full 274-query sweep completed and reran clean** (via the
Python-timeout harness described below, task `bxgyl71jo`, see
`scratchpad/failures.txt`), confirming the `IS NULL` pattern itself is fully
fixed (zero `IS NULL`/`IS NOT NULL` failures remain), but surfacing a
**broader, previously-undocumented variant of the same underlying bug: plain
`= <literal>` equality against an `Option<T>` column is ALSO rejected**, not
just `IS NULL`/`IS NOT NULL`. This is distinct from §2 (enum literals) —
these are `Option<U64>` and `Option<Identity>` columns being compared with a
bare scalar literal, with no `some(...)`/unwrap syntax available at the SQL
level:

```
Error: The literal expression `195` cannot be parsed as type `(some: U64 | none: ())`
Error: The literal expression `c200261e19311455d03403179768a7489ab7bab5aa73f537f6ec7983079ca770`
  cannot be parsed as type `(some: (__identity__: U256) | none: ())`
```

**Confirmed still broken, not yet fixed** (all in `erp-subscriptions.ts`,
same "drop the SQL filter, post-filter in Rust" fix pattern applies):
- `account_asset`, `account_fiscal_year`, `account_period`,
  `consolidation_elimination_entry`, `consolidation_journal`,
  `consolidation_account` — filter on `organization_id = <n>`, where
  `organization_id` is `Option<U64>` on these tables (unlike most other
  tables where it's a required column) — resources: whichever
  `erp-subscriptions.ts` keys map to these tables (grep for
  `account_asset`/`consolidation_` there to find the exact resource keys).
- `ai_document_processing_job`, `ai_insight`, `res_partner_bank` — filter on
  `company_id = <n>`, same `Option<U64>` issue.
- `hr_employee` (two separate query variants) — filter on
  `user_id = 0x<identity>`, where `user_id` is `Option<Identity>`.

**Separately, a real schema/column bug** (not a dialect gap) was found in
the same sweep: the query for `stock_landed_cost_lines` filters on
`company_id`, but the engine returns `Error: company_id is not in scope` —
meaning that column doesn't exist on this table/view as currently modeled.
Needs its own fix (either drop the filter or confirm the correct column
name) rather than the post-filter workaround.

### 2. Quoted string literal compared against an enum/sum-type column — always rejected, any casing

This is bigger than it first looked. Early in the session, `state = 'ToApprove'`
(PascalCase, matching the Rust variant name) was assumed to be a casing bug,
since SpacetimeDB's wire format serializes enum tags as camelCase-first-lower
(e.g. `toApprove`, confirmed via `workflow_edge.condition` dumps showing
`(draft: () | sent: () | toApprove: () | ...)`). Fixing the casing
(`ToApprove` → `toApprove`) was necessary but **not sufficient** — the
corrected, properly-cased query is *still* rejected:

```
$ spacetime sql lumiere-v1-local-e2e --server local --no-config \
  "SELECT id FROM purchase_order WHERE state = 'toApprove'"
Error: The literal expression `toApprove` cannot be parsed as type
`(draft: () | sent: () | purchase: () | done: () | cancelled: () | toApprove: ())`
```

Every casing was tried (`draft`, `Draft`) and every one fails identically.
**No quoted-string SQL literal can be compared against a sum-type column at
all**, in this SpacetimeDB version — this is the same class of engine gap as
§1, just for enums instead of `Option`.

**Fixed this session** (via the same "drop SQL filter, add explicit Rust
match arm with post-fetch `.retain()`" pattern as §1):
- `purchase-orders-to-approve` (`state = 'toApprove'`) — confirmed fixed:
  `api-server/src/query_exec.rs` has a real match arm for this key.

**Correction (caught by the full-sweep rerun):** `sale-orders-to-approve`
was NOT actually fixed despite an earlier version of this doc claiming it
was — `query_exec.rs` has no match arm for it, only for
`purchase-orders-to-approve`, and the sweep reproduces the exact same
`state = 'toApprove'` rejection against `sale_order` (query #41 in the
rerun). Treat it as still broken; see the confirmed list below.

**Confirmed still broken** (re-verified via the full sweep rerun,
`scratchpad/failures.txt`, queries #41/160/170/243/244/248 — same error
shape, not yet fixed, needs the same treatment):
- `sale_order` — `state = 'toApprove'` (query #41; note only the
  `purchase_order` variant, §above, was actually fixed this session — the
  `sale_order` one was NOT, despite the earlier summary listing
  `sale-orders-to-approve` as fixed. Re-check
  `crates/stdb-auth/assets`/`api-server/src/query_exec.rs` before assuming
  this one is done.)
- `hr_leave` — `state = 'confirm'` OR `state = 'validatedOne'` (query #160,
  `leaves-to-approve`)
- `hr_payslip` — `state = 'verify'` (query #170, `payslips-to-export`)
- `expense_sheet` — `state = 'submitted'` (query #243,
  `expense-sheets-to-approve`)
- `hr_expense` — `state = 'draft'` AND `has_receipt = false` (query #244,
  `expenses-missing-receipt`)
- `hr_expense_policy_exception` — `state = 'pending'` (query #248,
  `expense-policy-exceptions`)

Only these six were confirmed in the rerun. The earlier `inventory_exception`
suspicion was NOT reproduced in this rerun's non-`ORDER BY` failures — either
it was already fixed, doesn't use a literal-vs-enum comparison, or its query
didn't appear as a distinct failure; re-check directly before assuming it's
still broken.

Each of these needs the same fix shape as `timesheets-to-validate` /
`purchase-orders-to-approve`: remove the `state = '<literal>'` fragment from
the `erp-subscriptions.ts` template, add (or extend) an explicit match arm in
`api-server/src/query_exec.rs` that fetches without the filter and
post-filters with `rows.retain(...)` comparing the deserialized JSON tag
string (see the `timesheets-to-validate` arm added this session for the
exact idiom — it uses `row_u64`/similar accessors; for an enum column the
equivalent is comparing the row's tag field, e.g.
`row.get("state").and_then(|v| v.get("tag"))`-style access — check how
`row_company_matches` or similar helpers in that file read a sum-type field
out of the generic JSON `Value` row for the right helper to reuse or extend).

### 3. `NOT IN (...)` — rejected

Found once in the sweep, source confirmed:

```
SELECT id, organization_id, employee_id, doc_type, attachment_id, purpose,
       title, notes, active, company_id
FROM hr_employee_document
WHERE organization_id = 195 AND active = true
  AND purpose NOT IN ('tax_id', 'identity')

Error: Unsupported expression: purpose NOT IN ('tax_id', 'identity')
```

`purpose` is a plain `String` column (not a sum type), so unlike §2 this is
purely a `NOT IN` grammar gap, not an enum-literal issue. Not yet fixed —
still need to confirm whether `IN (...)` (positive form) works, and whether
`purpose != 'tax_id' AND purpose != 'identity'` (plain inequality, which is
very likely supported for a `String` column) is a viable rewrite before
resorting to a Rust-side post-filter.

## Why this went undetected for so long

Every one of these queries is used in **one combined subscription batch**
sent at app startup (`FULL_CLIENT_SUBSCRIPTION_RESOURCES`, ~274 queries
across all ERP resources, built by `createClientSubscriptions` and consumed
in `frontend/packages/stdb/src/context.tsx`'s `.subscriptionBuilder()...
.subscribe(...)` call). The suspicion going into this doc was that **one bad
query in that batch fails the whole subscription** (SpacetimeDB's
`.onError()` fires once for the batch, not per-query — confirmed the error
callback exists and fires with a generic error object, not per-query
detail). If true, this single class of bug could explain a much wider set of
"data exists server-side but never appears live in the UI" symptoms than the
handful of e2e tests that happened to surface it — not just the
already-diagnosed cases below, but potentially *any* resource sharing that
batch with a broken sibling.

**This "whole batch fails atomically" theory is not yet confirmed** — after
fixing the `contacts`/`opportunities` `IS NULL` bug (the most directly
implicated one for the `mvp-lead-to-cash` failure below), a fresh full P0
run still showed the exact same failure for that test, `hr-wave-lifecycle`,
and `helpdesk-mutations`, with the `[stdb] subscription error` console
message still present in a live repro. That means either:

- the batch-atomicity theory is wrong and subscription failures are
  isolated per-resource (in which case `helpdesk-teams`, which has no known
  broken query, has a **separate, still-unexplained** cause for never
  populating — confirmed via live repro that its own REST fallback never
  fires either, zero network requests to `/api/query/helpdesk-teams` ever
  observed from the app itself), or
- there is at least one more broken query in the batch (very plausible given
  the sweep above found ~8-10 more instances of the enum-literal bug alone,
  none of which were fixed before that re-run).

**Next step for whoever picks this up:** finish fixing every confirmed-broken
query in §2/§3 above, republish, do a full `E2E_CLEAR_DB=1` reseed, and
re-run the live-browser repro (sign in, open `/helpdesk`, open New Ticket,
check console for `[stdb] subscription error` and check
`read_network_requests` for whether `/api/query/helpdesk-teams` ever fires
from the app itself, not just from test-driven `page.request.get` calls).
If the error is gone and helpdesk-teams still doesn't populate, the
batch-atomicity theory is disproven and `helpdesk-teams` needs independent
investigation (check `useHelpdeskTeams` in
`frontend/packages/query-hooks/src/hooks/helpdesk.ts` — plain `useQuery`,
not subscription-aware, `staleTime: initialData?.length ? 30_000 : 0`; worth
checking whether SSR `initialTeams` threading is actually reaching the
component, and whether `enabled` is gated on anything that could be false
for this specific render path).

## How the full 274-query sweep was produced (reusable)

`createClientSubscriptions(FULL_CLIENT_SUBSCRIPTION_RESOURCES, ctx)` was
invoked directly via `tsx` (no build step needed —
`frontend/packages/stdb/package.json` exports raw `.ts` from `src/`) with a
synthetic but realistic context (org 195, company 198, a real 64-hex-char
identity from the local seed DB), dumping every generated query string to a
file, then each was tested individually against the running local
SpacetimeDB via a Python script with a **15-second hard timeout per query**
(a plain shell `while read` loop calling `spacetime sql` in a subshell
appeared to hang indefinitely with no clear cause across two attempts in
this session — possibly an artifact of the sandboxed environment, not
reproduced further; the Python `subprocess.run(..., timeout=15)` approach
completed all 274 in well under a minute with no issues). See this session's
transcript for the exact script if reconstructing it; the shape was:

```python
import subprocess
for i, q in enumerate(queries, 1):
    try:
        result = subprocess.run(
            ["spacetime", "sql", "<db>", "--server", "local", "--no-config", q],
            capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL,
        )
        out = result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        out = "Error: TIMEOUT"
    if "Error:" in out:
        # record query + error
```

**Caveat on `ORDER BY`:** the sweep's single largest failure category by
count was `Unsupported: SELECT ... ORDER BY ...` across dozens of resources.
This is very likely a **false positive of the `spacetime sql` CLI
specifically** (it's explicitly marked `UNSTABLE` and may have a more
restricted grammar than the real HTTP/WS query engine) rather than a real
app bug — many currently-passing e2e tests already exercise resources with
`ORDER BY` in their subscription/query templates without issue. This was
**not verified either way** before this doc was written; do not assume
`ORDER BY` is broken without checking whether the *actual* HTTP query path
(`api-server`'s `query_exec.rs`, which is what real traffic uses, not the
CLI) accepts it — if it does, filter all `ORDER BY`-only failures out of the
sweep results before triaging further.

## Recommendation: fold subscription query generation into the schema/contract IR

This entire bug class exists because `erp-subscriptions.ts` is **hand-authored
TS string templates** with no awareness of each column's actual SpacetimeDB
type (`Option<T>` vs required, enum vs scalar). A human has to know, for
every single resource, which columns are nullable or enum-typed and avoid
the unsupported SQL shapes by hand — which is exactly how ~10+ of these slipped
in undetected across the app's lifetime.

PR #3 (this branch) already establishes a generated "application-contract IR"
as the stable client boundary (see `docs/plans/agent-ir-codegen-extension-plan.md`
and the schema IR pipeline under `lumiere-codegen/`, which already knows
every column's real type — it's the same source of truth that produces
`crates/stdb-auth/assets/resource_registry.json` and
`stdb-http-option-fields.json`). Subscription query generation should move
into that same codegen pipeline rather than staying hand-maintained:

- The generator already has each column's `Option<T>` / enum-ness available
  (it's literally what `stdb-http-option-fields.json` encodes today for a
  different purpose — optional-field JSON wrapping).
- A codegen-time check could **reject the build** if a hand-written
  `extra_where` fragment (or a generated one) contains `IS NULL` /
  `IS NOT NULL` against a known-`Option<T>` column, or a quoted-literal
  equality against a known-enum column — turning this into a compile-time
  error instead of a silent runtime subscription failure discovered months
  later via a flaky e2e test.
- Longer-term, filters like "state is one of these values" or "company is
  either X or unset" could be generated as **post-fetch predicates** (Rust
  closures or JS filter functions, mirroring the `row_company_matches` /
  `projection.ts` patterns already established ad-hoc this session) directly
  from the IR, rather than requiring each engineer to independently
  rediscover "oh, this specific SQL shape doesn't work" and hand-roll a
  workaround.

This is a real scope increase beyond "fix the remaining broken queries" —
flagging it here as the more durable fix rather than doing it as part of
this e2e-stabilization pass.

## Affected e2e tests (as of this session)

- `hr-wave-lifecycle.spec.ts` (HR-008) — payslip never appears in UI after
  creation. `payslips-to-export`'s broken `state = 'verify'` query is a
  plausible contributor but not confirmed as *the* cause (see the
  batch-atomicity uncertainty above).
- `helpdesk-mutations.spec.ts` — Team/Stage select shows zero options; no
  known broken query for `helpdesk-teams` itself, cause still unconfirmed.
- `mvp-lead-to-cash.spec.ts` — newly lead-converted contact never appears in
  a payment form's Customer select. The `contacts` `IS NULL` bug (§1, fixed)
  was the leading suspect but did not resolve the symptom on its own,
  consistent with more than one broken query still poisoning the shared
  subscription batch.

## Where things stood when this doc was written

Full P0 suite: 55-56 passed / 4-5 failed, down from the original 24 failures
at the start of this stabilization pass. The `company_id IS NULL` fix for
`crmOptionalCompanyTables` and the `timesheets-to-validate` enum/null-literal
fixes are committed, and confirmed correct by a full rerun of the 274-query
sweep (task `bxgyl71jo`, `scratchpad/failures.txt`) — zero `IS NULL`
failures remain. That same rerun corrected an earlier claim in this doc:
`sale-orders-to-approve` was never actually fixed (only
`purchase-orders-to-approve` has a Rust post-filter arm) — don't trust the
"fixed" label on any resource without checking `query_exec.rs` directly.

**Confirmed still-broken, ready for the next session to fix one-for-one with
the established pattern:**
- §2 enum-literal class: `sale-orders-to-approve`, `leaves-to-approve`,
  `payslips-to-export`, `expense-sheets-to-approve`,
  `expenses-missing-receipt`, `expense-policy-exceptions` (six resources,
  down from the earlier "~10, some unconfirmed" estimate — this list is now
  exact, not a guess).
- New class found in the rerun (not in the original doc): plain `=` equality
  against `Option<u64>`/`Option<Identity>` columns, affecting
  `account_asset`, `account_fiscal_year`, `account_period`,
  `consolidation_elimination_entry`, `consolidation_journal`,
  `consolidation_account`, `ai_document_processing_job`, `ai_insight`,
  `res_partner_bank`, and both `hr_employee` query variants.
- §3 `NOT IN`: one confirmed instance, `hr_employee_document`.
- One unrelated schema bug: `stock_landed_cost_lines` references a
  `company_id` column that doesn't exist in scope.

The `inventory_exception` suspicion from the original draft did not
reproduce in this rerun and should be dropped from the list unless
independently re-confirmed.
