# COV-05k — durable partial-receipt replay

Date: 2026-10-12 (UTC). Integration lane: PR #179.
Disposition: source implementation; runtime activation and Purchasing acceptance deferred.

Contracts: v0.3.104 (`482f4f9804015f466f9ec29fce5c0a643f421989`),
companion [lumiere-contracts#20](https://github.com/KevTiv/lumiere-contracts/pull/20),
stacked on bill-correction #19. The parallel tax/FX release consumed v0.3.103;
its app pin commit is preserved in the integration branch's merge history.

## Receipt identity and evidence

`receive_po_line_once` accepts a scoped operation key and reviewed quantity,
received quantity, lot, move and picking. It checks current actor permissions and
company access before accepting a new invocation or replay. Reusing the key with
different input or another actor is rejected. An identical replay returns the
original result even after later receipts. New receipts require new keys.

The original receipt owner performs the effect inside the same transaction that
inserts the private `purchase_receipt_operation` event. Stock receipts require
the exact open source move, product and PO picking; service receipts carry no
stock or lot identifiers. The event records before/after quantities, completed
move/picking and any continuation. Durable PostgreSQL migration 12 adds this
event table without changing frozen migrations 1 or 11.

The readback API requires a bounded operation key, current line-read or
Purchasing-module read permission, actor membership and company access. Its
owner-token query filters exact primary key, organization, company and actor.
The private ledger is excluded from broad organization subscriptions.

## Operator recovery

Receipt actions preserve the original key and reviewed inputs in browser storage
before dispatch. Storage is partitioned by organization, company, actor and line;
Web Locks coordinate tabs. Missing storage, unsupported locking or an unavailable
updated API fails before a new receipt is sent. An unresolved invocation cannot
be replaced with a different quantity or lot, or silently retargeted to a new
backorder. Canonical evidence is checked before resending the same keyed command.

Both Purchasing line grids expose **Resolve pending receipt**, including fully
received lines. This action only reads saved-key evidence. A matching immutable
event proves the original receipt even after later receipts; quantity movement
alone does not prove it. Missing, malformed or inaccessible evidence retains the
pending identity. Cleanup only removes the matching key, and cleanup failure
cannot turn a proven receipt into an uncertain result.

## Boundaries

The existing unkeyed `receive_po_line` remains compatible for older callers and
does not become replay-safe. The active operator workflow uses the keyed route
without falling back to it. Browser storage clearing or changing browsers loses
local recovery discovery; server evidence remains durable. Explicitly closing an
unused stale key and discovering pending receipts across devices remain follow-up
work. No pending identity is automatically discarded after an error, expiry or
permission revocation.

The localhost app module and API have not been upgraded by this slice. The new
schema was published only to an isolated, unseeded export module. Native reducer
fixtures are authored and compiled, not executed as acceptance evidence.

## Validation

- Native and WASM module builds passed, including the authored two-cycle receipt
  fixture. Its repeated-key, conflicting-input, stale-target and continuation
  assertions are compiled rather than claimed executed.
- Eight browser-persistence/dispatch tests passed: refresh retains the original
  target, conflicting inputs cannot replace it, malformed evidence remains
  unknown, cleanup cannot remove a newer intent, actor/company storage is
  partitioned, service receipts carry no stock targets, lost acknowledgement
  resolves without another command, and an unavailable producer fails before
  persistence or dispatch.
- All 15 existing receipt-evidence tests also passed on the pinned consumer.
- Web TypeScript checking and v0.3.104 release-manifest verification passed.
  The operation history adds exactly `erp.receive_po_line_once` and preserves
  every previous operation's semantic shape against released v0.3.103.
- API compilation including test targets passed with one existing saved-draft
  warning. Final native module compilation, including generated reconstruction,
  passed with 14 existing warnings. No API/reducer runtime acceptance is claimed.
- Contract IR verification, default codegen and drift checks passed; all 30
  companion generator tests passed. The optional strict C0 census still reports
  its pre-existing 471-versus-505 table-count disagreement; it is not claimed
  green. Default ownership classification covers all 505 tables, including the
  new event's real organization-leading composite index.
