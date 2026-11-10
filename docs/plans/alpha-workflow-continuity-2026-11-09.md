# Alpha workflow continuity

This change builds on PR #389 and extends existing alpha screens and native
business operations. It retains the current module admission and permission
owners, Quiet Precision visual design, versioned contract generation, and
recoverable mutation paths.

## Delivery and acceptance

| Area              | Outcome                                                                                                                             | Required evidence                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record labels     | Search and record sheets interpret supported scalar/wire values, preserve exact IDs, and never coerce arbitrary objects into names. | Wrapped labels, explicit null, large IDs, invalid payloads and navigation regressions.                                                                          |
| Record overview   | Status, responsibilities with known names, next actions/blockers, related records and evidence occupy consistent locations.         | All production RecordPage callers, sheets, keyboard history navigation and narrow layouts.                                                                      |
| Page composition  | Task starting layouts, stable native actions and meaningful data scope on configurable widgets.                                     | Permission-filtered widget catalog, personal draft/reset/undo and existing compare-and-swap save ownership.                                                     |
| Daily Work        | Needs-attention ordering and bounded batch follow-up completion with isolated failures.                                             | Exact actor/company eligibility checks, per-item canonical readback, retry after refresh, no batch business approvals.                                          |
| Capture recovery  | Honest pending/syncing/confirmed/failed/review states across existing capture paths.                                                | Company/actor isolation, interruption and ambiguous-reply handling, no unsent work reported as synchronized.                                                    |
| Import completion | Explicit reviewed opening-balance drafts and safe correction of unchanged imported drafts.                                          | Native preview/approval/execution/readback, paired debit-credit/account/currency/cutover requirements, exact rollback receipts and duplicate-source protection. |
| Bank settlement   | Partial/excess base-currency bank receipts bind to an exact posted operational payment and allocate atomically.                     | Amounts, company/journal/partner, real ledger entry, replay/stale selection, duplicate payment and subsequent residual/credit behavior.                         |

## Business boundaries

Opening balance support does not choose a balancing account, infer a cutover date,
post journals or import arbitrary one-sided trial balances. Posted historical
payments and unrelated transaction adapters require their own native semantics.

Bank settlement reuses the operational payment posting and allocation owners;
approval remains with those owners. Foreign-currency conversion, fees and new
write-off semantics are not inferred by presentation code. Existing exact-match
settlement remains distinct.

The existing reversal owner now compensates an operational bank payment using
its actual posted ledger accounts, restores affected allocations, and reopens
the bank line. Company, statement and fiscal-period access remain required;
approval is bound to the current bank match and allocation balances. Posted
payments awaiting matching also have this correction path.

Imported draft removal is available after both native stage receipts exist,
including after a failed readback or lost rollback reply. A proposal abandoned
before dispatch, or interrupted after only its parent stage, still retains its
source claims: absence of a receipt cannot safely prove that no native write
occurred. Releasing those claims needs an explicit native abandonment protocol.

Daily Work completes follow-ups through their existing command; completing a
follow-up does not approve or execute its underlying business document. Reminders
use supported record discussion flows, not a fabricated notification command.

The existing mobile/outbox surfaces remain scoped to their admitted runtime
entry points. A browser-local draft is not evidence that an ERP record was saved.

## Verification

Focused record, composition, Daily Work, capture, import and reconciliation
model/component regressions passed. Import preparation has 50 passing Python
tests; the final mounted import and reconciliation suites passed 23 and 35 tests
respectively. New native settlement/reversal and PostgreSQL rollback regressions
are registered for GitHub execution.

The new native operation uses the canonical contract generation and release
pipeline. Full local web typechecking exhausted the available memory (4 GiB V8
heap; a larger attempt was killed by the environment), so it remains a required
GitHub check. Heavy builds and native/browser suites remain on GitHub. Local
Chromium launch is blocked by socket/ptrace permission errors; source/model checks
do not establish rendered or deployed acceptance.
