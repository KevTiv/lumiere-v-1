# COV-05e1/f0/f1 implementation and validation status

> Integration update (2026-10-12): [Purchasing stack integration](erp-cov05-purchasing-stack-integration.md) supersedes the original build/release blockers below. This document retains evidence from its original base; it does not claim current integrated acceptance.

**Base:** `16f87f9ffc5be5fb18dcde6b184c344a56c52665`

**Disposition:** `REVIEW` — bounded source implementation and review fixes complete;
no new domain or operator runtime gate has passed in this round.

## Approved policy and bounded scope

- COV-05e1 uses one per-line, received-based invoice-status owner after stock
  receipt, service receipt, and PO bill creation. Ordered fulfillment remains
  `receipt_status`. Its operator proof is two receipts and two exact bills,
  using released PO quantities and bill refs, not unavailable bill-line fields.
- COV-05f0 records each exact inserted bill-line ID in its source PO line's
  existing `invoice_lines` relation.
- The developer approved strict COV-05f1 provenance with no legacy fallback or
  guessed backfill. Existing PO draft bills with missing/ambiguous lineage are
  rejected; legitimate manual non-PO invoices remain legitimate.
- No legacy rows are deleted by this policy. It changes validation, not storage
  retention or automatic repair.
- Full partial-receipt idempotency, price/quantity correction, and expanded
  operator-visible provenance require the approved producer/release lane and
  the actual `lumiere-contracts` repository attachment.

## Actual checks so far

| Check | Result |
| --- | --- |
| `git diff --check` | Passed at integration checkpoints |
| Targeted Rust formatting and `rustfmt --check --edition 2021 --config skip_children=true` | Passed on all six changed Rust files after review fixes |
| `cd frontend/web && pnpm typecheck` | Passed again after review fixes; this does not typecheck the Rust module |
| Playwright discovery for `cov05e-partial-receipt-billing.spec.ts` and `cov05f-strict-provenance.spec.ts` | Three tests discovered |
| Isolated native `cargo test` / `cargo check` attempts | Incomplete: bounded compile timeouts, then disk exhaustion; not passes |
| Integrated fresh `make e2e-smoke-setup` | Timed out at 600 seconds during `lumiere_v1` compilation; no completed setup or browser gate |

Integrated setup used fresh local names:

```text
PG_DATABASE=lumiere_cov05ef_20261011222432
E2E_STDB_MODULE=lumiere-cov05ef-20261011222432
```

Its local log is `.tmp/e2e/cov05ef-run-20261011222432/setup.log`.
CLI authentication and STDB data were scoped to that ignored run directory,
with explicit localhost targeting and a private CLI wrapper. The newly created
PostgreSQL database was retained. No cloud publication or global-login change.
After timeout, inspection found no cargo/rustc process or test listener remaining.

## Build-space incident and recovery

Parallel isolated native builds exhausted the local disk. Further isolated
builds were stopped. Cleanup reclaimed only disposable generated artifacts:

- The two run-owned isolated native targets: 795.2 MiB and 300.4 MiB.
- Inactive project native/release artifacts through scoped Cargo cleanup.
- The ignored inactive `spacetimedb/target/wasm32-unknown-unknown/debug`
  directory, after verifying no compiler was active, it was not a symlink, and
  it contained no Git-tracked files. Cargo cleanup did not remove that directory.

Source files, retained STDB/PostgreSQL test data, and global caches were not
deleted. Reported free space recovered to approximately 7.2 GiB.
Validation is now centralized in the parent workspace, one build at a time.

## Review remediation required before acceptance

The first strict-provenance review found:

1. `post_account_move_impl` bypassed the rule enforced by `post_invoice`.
2. Forward-only matching failed to detect dangling source refs after generic
   draft-line deletion/rebalancing.
3. Broad `starts_with("PO")` rejected legitimate manual descriptions.
4. Caller-controlled generated line partners needed canonical PO derivation.
5. Non-finite quantity guards and persisted-value validation were incomplete.
6. Cross-scope diagnostics exposed IDs not proven in the caller's scope.

All six source fixes are now implemented through existing canonical owners:
both posting entry points validate before approval dispatch/writes, the complete
reverse reference graph is checked, exact canonical origin assertions are
distinguished from manual descriptions, generated partners come from the PO,
entry/persisted values are checked for finiteness, and cross-scope diagnostics
omit foreign IDs. Registered native cases cover direct and guarded re-entry,
deletion/rebalance, partner spoofing, and non-finite inputs.

Passing syntax/format/whitespace checks do not establish compilation or domain
success. Compilation, native reducer execution, operator proof, and focused
re-review remain pending. Publication is therefore a draft companion/stack PR
above COV-05d, not a merge-ready or runtime-certified change.

## Contract/release boundary

No schema/signature/generated-contract change or release has been performed.
See [next-slice dependencies](erp-cov05-next-slice-contract-dependencies.md)
for receipt invocation identity, exact PO creation, correction operations,
and canonical projection requirements.
