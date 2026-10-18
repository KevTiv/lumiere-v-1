# COV-07f — exact finished-output scrap

**Status:** REVIEW — bounded historical browser acceptance passed; full module acceptance open
**Branch:** `codex/cov07f-finished-output-scrap`  
**Stack base:** COV-07e / `codex/cov07e-manufacturing-quality-gate`

## Bounded path

One Done manufacturing order with untracked finished product may scrap a finite,
positive quantity no greater than its remaining unscrapped production. The
operator selects an active, company-compatible location marked as scrap and
supplies a request ID. The reducer rejects duplicate IDs for the same MO.

The reducer validates the exact completed finished move owned by the MO, one
unambiguous available source quant at the finished destination, and all prior
MO-linked scrap moves before mutation. It creates one `stock_move` with
`production_id = mo.id` and `scrapped = true`, then relocates the quantity with
the existing exact quant movement reducer. The finished move relation remains
the output relation; scrap moves are discovered by `(production_id, scrapped)`.

The persisted domain test checks Draft denial, one exact scrap move, source and
scrap quant deltas, duplicate request rejection, over-production scrap rejection,
and preservation of the effect set after rejected calls.

## Limits and remaining certification

- This slice handles untracked finished goods only. Lot/serial attribution,
  scrap during production, byproducts, and full cost valuation are separate.
- The Manufacturing order row exposes finished-output scrap for Done orders.
  The client supplies a request UUID and resolves the exact stock move by the
  reducer-owned `MO/{mo}/SCRAP/{request}` reference; it never selects the newest
  move.
- The warehouse-persona UI scrap, exact request-bound move and quant deltas,
  duplicate rejection and reader denial were exercised by
  `cov07f-finished-output-scrap.spec.ts` in the Docker acceptance lane. Both
  runs passed all 46 tests, including COV-07f/g; the second run proved durable
  projection convergence. See
  [`cov-runtime-docker-acceptance-2026-10-04.md`](../evidence/cov-runtime-docker-acceptance-2026-10-04.md).
- The same evidence note's 2026-10-07 follow-up records two passing PostgreSQL
  upgrade tests at contracts v0.3.86. It closes the released-migration checksum
  blocker; it does not extend scrap browser coverage.
- Historical setup creates the Done MO as a fixture. The direct resulting
  record link remains open: the row-action submission discards the hook's exact
  scrap reference. Tracked scrap, scrap during production and actual cost
  valuation are separate completion-stack slices.
- This historical pass does not certify the current PR #175 head or the new
  completion stack. Repeat relevant persisted/browser/projection gates on the
  final contract pin and immutable implementation head before promotion. The
  module remains U2/review; see
  [`erp-cov07-completion-stack-plan.md`](./erp-cov07-completion-stack-plan.md).
