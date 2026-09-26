# COV-00A operation census status

**State:** ACCEPTANCE CANDIDATE — coordinator integration review required

**Base:** `b4e23eff69a5a1cba62e07ca9866bb5eb649c9d2`

**Machine-readable evidence:** [`../evidence/cov-00a-operation-census.json`](../evidence/cov-00a-operation-census.json)

**Readable census:** [`../operation-classification-census.md`](../operation-classification-census.md)

## Result

The census now uses all immutable operation-contract shards as its denominator, then reconciles the Rust reducer inventory into that set. It does not infer the operation denominator from reducer discovery.

- 1,399 contract operations classified;
- 914 client-facing operations assigned to an explicit COV or GOV/CAP owner;
- 485 denied/internal/test operations retained as `internal-support` evidence;
- 1,187 Rust reducer rows reconciled, including five explicit digit-boundary aliases;
- zero unowned client-facing operations;
- zero `needs-triage`, `uncategorized`, or review-required accepted rows.

The disposition is deliberately fail-closed. A client-facing operation without a detected UI caller is `future-disabled`; this does not claim that the command is missing, nor does it admit the operation to the first-test-org UI. COV-00B remains the authority for route, sidebar, command-palette, and Fleet `/map` exposure.

## Ratchet

`pnpm --dir frontend/web analyze:coverage:check` now runs both layers:

1. reducer coverage regeneration rejects any reducer without module ownership;
2. the COV-00A generator rejects duplicate operation contracts, reducer rows absent from the canonical operation set, unowned client-facing operations, invalid dispositions, review-required accepted rows, and stale generated evidence.

New source domains fail closed until their owner is explicitly mapped. Generated census files are updated only through `scripts/generate-operation-census.py`.

## Review boundary

This candidate closes COV-00A classification mechanics only. It does not close COV-00, change first-org exposure, settle Fleet navigation, certify any U4/U5 workflow, or convert the conservative `future-disabled` rows into product-admission decisions.
