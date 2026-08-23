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

**Still broken — not yet fixed (found via the systematic sweep, see below):**
none currently known beyond the two above for this specific `IS NULL` pattern
— the sweep's remaining failures are the enum-literal class (§2) and the
`NOT IN` class (§3).

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
- `purchase-orders-to-approve` (`state = 'toApprove'`)
- `sale-orders-to-approve` (`state = 'toApprove'`)

**Confirmed still broken** (found via the systematic sweep — same error
shape, not yet fixed, needs the same treatment):
- `leaves-to-approve` — `state = 'confirm'` / `'validatedOne'`
  (`hr_leave.state`)
- `payslips-to-export` — `state = 'verify'` (`hr_payslip.state`)
- `expense-sheets-to-approve` — `state = 'submitted'`
  (`expense_sheet.state`)
- `expenses-missing-receipt` — `state = 'draft'` (`hr_expense.state`)
- `expense-policy-exceptions` — likely affected (not yet individually
  confirmed in the sweep output, but uses the same `state = '<literal>'`
  pattern in `erp-subscriptions.ts`)
- An AI-action-draft-status-shaped resource — `state = 'pending'` appeared in
  the sweep; confirm which resource key this is (grep
  `erp-subscriptions.ts` for `'pending'`) before fixing.
- `inventory_exception` (`inventory-exceptions*` family) —
  `state = 'open'` (+ `exception_type = '...'` combos), multiple resource
  keys share this table.

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

Found once in the sweep:

```
Error: Unsupported expression: purpose NOT IN ('tax_id', 'identity')
```

Not yet investigated further — find the source resource
(grep `erp-subscriptions.ts` for `NOT IN`), confirm whether `IN (...)`
(positive form) works or is equally rejected, and whether the fix is
"rewrite as `purpose != 'tax_id' AND purpose != 'identity'`" (if plain
inequality against a non-enum string column works — likely, since this
looks like a plain `String` column, not a sum type) or needs the same
post-filter treatment.

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
`crmOptionalCompanyTables` and the `timesheets-to-validate` /
`purchase-orders-to-approve` / `sale-orders-to-approve` enum-literal fixes
are already committed. This doc's §2 list (leaves-to-approve,
payslips-to-export, expense-sheets-to-approve, expenses-missing-receipt,
expense-policy-exceptions, the `pending`-state resource, inventory
exceptions) and §3 (`NOT IN`) are **not yet fixed** — that's the concrete
next-session task.
