# Alpha UI review corrections

Date: 2026-10-30. Branch: `codex/alpha-ui-review-fixes`.

This packet implements the nine source findings from the [English Alpha review in PR #329](https://github.com/KevTiv/lumiere-v-1/pull/329). The deferred-feature visibility change remains in that separate PR.

| Finding | Source correction |
| --- | --- |
| CRM loading and failed reads appear empty | Payment and message cards use independent merged query states and existing notices. Denied, failed, loading, and cached partial reads cannot produce an empty-history claim. Retry uses the existing query owner. |
| Payment amounts have no currency | Resolve each row's currency through the existing currency context. Format valid amounts with the shared formatter and show the ISO code. Group allocation and fee totals by their own currency. Missing/invalid amounts or unresolved currencies show unavailable; a real zero remains zero. |
| Expenses inputs lack labels | Card and administration inputs use existing Field, FieldLabel, and Input controls through a small local component. Decimal fields expose the decimal input mode. Existing state, submitted values, operation owners, and gates are retained. |
| Default controls have conflicting sizes | Default buttons, record pickers, inputs, and selects use a 36 px height and matching corner radius. Small buttons use 32 px; large buttons use 40 px. Touch minimums remain 44 px. Explicit multiline and compact overrides remain supported. |
| Expenses field rows do not align | Text inputs and record choices share the same field structure and spacing. Actions occupy their own grid row; related hold actions share a wrapping footer. |
| Analytic allocation text exposes server instructions | The description now states the supported operation: allocate 100% to one analytic account. |
| Analytic tags require internal IDs | Remove unsupported tag assignment inputs from create/edit forms. Updates omit `tagIds`; the existing optional patch mapper preserves saved assignments. Creation retains the existing empty-tag default. No tag lookup or new authority is invented. |
| English labels use implementation terms | Replace Upsert, Statement external ref, Merchant key, and picker Currency ID labels. The WhatsApp description now distinguishes queued messages from confirmed delivery. |
| Long CRM references can overflow | Reference and subject owners can shrink and wrap. Status rows wrap; message bodies accept long unbroken content. |

The optional recommendation to collapse single-view workspace navigation is not part of the nine defect corrections. That shared navigation change needs a separate interaction review.

## Verification plan and current limits

- Added mounted CRM tests for loading, denied joins, retries, independent cards, confirmed emptiness, contact filtering, mixed currencies, unavailable values, and zero.
- Added an input-label test and an analytic edit submission test that verifies tag assignment is omitted.
- Extended the existing CI-owned shared-control browser suite for equal heights, label activation, retained values, narrow touch targets, and enlarged text.
- Extended the existing Expenses lifecycle browser suite to check accessible labels and decimal input modes.
- `git diff --check` passed. No local tests, type checks, builds, or browser runs were executed for this packet. Hosted results are pending.

The payment schema defines a currency on transactions, fees, and reconciliation allocations. These fields were checked in `spacetimedb/src/accounting/payment_management.rs`; this packet changes their presentation only. Source corrections and synthetic component tests do not establish provider delivery, saved financial effects, or deployed Alpha acceptance.
