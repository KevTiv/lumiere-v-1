# Full-history dashboard replacement for PR #436

## Scope

This replacement starts at `c2e9b50` on `main`. It retains the still-needed
Accounting, HR, Subscriptions, and shared period fixes from #436 without carrying
that branch's unrelated commits or its superseded inventory rewrite.

| Surface | Replacement behavior |
| --- | --- |
| Accounting insights | Shared All history, presets, and custom dates instead of only 30/90/180 days |
| Accounting document activity | Same selected period as insights instead of six fixed months |
| HR headcount | Adaptive reconstruction from recorded hire/termination dates instead of six fixed months and invented missing hires |
| HR leave usage | Full requested days grouped by request start date in the selected period, not prorated overlap |
| Subscription MRR/churn | Adaptive dated-contract history instead of twelve fixed months |
| Shared period persistence | Synchronous native URL commit before company-keyed remounts; preserve unrelated query parameters and hash |
| Inventory | Keep #434's completed-transfer chart unchanged; do not restore scheduled-transfer counts |

The canonical period contract is
`frontend/packages/erp-shared/src/history-period.ts`: `all` has open bounds,
custom dates include the entire final calendar day, and timestamp intervals are
start-inclusive/end-exclusive. Buckets coarsen rather than truncate old dates.
Observed dates determine chart layout only, not authoritative source coverage.

## Data meaning and limits

- Open balances, aging, bank cash position, stock, current headcount, work queues,
  and current plan mix remain current-state views, not historical snapshots.
- All history has neither a finite prior comparison nor a meaningful lifetime
  DSO/DPO duration. These remain explicitly unavailable rather than invented.
- Accounting date columns represent source-calendar dates encoded at UTC
  midnight. Typed timestamps and date strings agree, including before 1970 and
  across reporting-timezone DST boundaries. Pre-epoch bank statement dates must
  not be replaced by an epoch-zero "as of" date.
- Accounting can accept an explicitly authorized organization timezone. The live
  accounting client currently has no authorized timezone projection, so it
  visibly discloses UTC fallback. No company/browser timezone field is invented.
- HR excludes employees with unknown hire dates and inactive employees with
  unknown termination dates from reconstruction. It is not a staffing ledger.
- Subscription history applies current contract MRR to recorded start/close
  dates. Unknown start dates and closed contracts without known close dates are
  excluded. It is not a billing or historical MRR ledger.
- HR and subscription dates use UTC; future headcount and subscription snapshots
  are clamped to now. Historical accounting excludes future postings.
- Invalid period links suppress historical figures until explicitly cleared.
  Current accounting operational queues remain available.
- Accounting exports identify period, timezone, date field, exclusive bounds,
  scope, currency, and calculation basis. All-history bounds stay open; current
  aging exports do not pretend to cover a historical interval.

No schema, generated bindings, authorization, deployment, or persisted-data
changes are needed. Existing read limits and partial/unavailable source handling
remain intact. Removing unused legacy calculations in other modules, adding an
authorized organization-timezone read, and server-side aggregation for large
tenants remain separate work.

## Validation

Run with Node 26.5.0:

- `pnpm --dir frontend/web test:history-ranges`: 107 passed, including the existing
  completed-transfer inventory tests from #434.
- `pnpm --dir frontend/web test:unit`: 1,240 passed.
- `pnpm --dir frontend/web test:accounting-ui:models`: 96 + 5 passed.
- `pnpm --dir frontend/packages/erp-shared test`: 199 passed.
- `pnpm --dir frontend i18n:check`: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm --dir frontend/web typecheck`:
  passed. The default 4 GiB heap ran out of memory.

Browser results and final diff/security CI status are recorded in the replacement
PR. Synthetic browser evidence verifies rendered controls, exports, reload/Back,
and company remounts, not authenticated tenant-data completeness. No production
build or live-tenant test is claimed.
