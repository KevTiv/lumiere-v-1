# COV-07f — exact finished-output scrap

**Status:** BACKEND IMPLEMENTED — contract/UI and runtime acceptance pending  
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
- The versioned `@lumiere/contracts` operation needs regeneration and release
  before the Manufacturing UI can dispatch it. Add exact canonical readback,
  warehouse persona and read-only browser proof after the contract release.
- Run native persisted tests and browser acceptance during stacked-PR integration.
  The current workspace does not provide `cargo` or SpacetimeDB tooling.
