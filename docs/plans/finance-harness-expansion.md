# Finance harness expansion after the first pilot

> Historical foundation plan. All five workflows have since gained executable
> implementations. Use [the current implementation status](../plan/finance-skill-expansion-status.md)
> for runtime behavior, release requirements, coverage and remaining external acceptance.

Date: 2026-10-26. Base: `1d92894e` (merged PR #277).
Branch: `codex/finance-skill-expansion`.

This lane expands finance coverage alongside the first-shape harness readiness
lane. It does not own pilot deployment, service credentials, spend provisioning,
report-analysis certification or live GOV00 acceptance. The current pilot's
compiled source bundle, registries, contracts and runtime routes stay untouched.

## Delivered slice and exact disposition

`FIN-SKILL-00` implements a **provider-free candidate evidence projection** for
cash/mobile money, customer balances and supplier payables. It compiles against
the real owner-report calculations in contract tests. It is not an admitted
capability, active release, certification adapter or user-facing feature.

Implementation:

- `ai-gateway/src/harness/finance_review/mod.rs`: closed request schema, trusted
  run/company context, bounded owner-report response validation, exact money,
  source/evidence pointers, stable ranking, visible coverage and snapshot hash.
- `ai-gateway/src/harness/finance_review/fixtures/`: three synthetic owner-report
  response fixtures; AR/AP include a partial allocation and its reversal.
- `ai-gateway/tests/finance_review_contract.rs`: compiles the actual owner source
  types/calculators and compares their output with the candidate fixtures.
- `docs/skill-candidates/`: five workflow definitions with explicit implementation
  disposition. This location is outside `erp-skills`, so the bundled loader cannot
  advertise unfinished candidates.

Candidate definitions:

- [Finance Report Review](../skill-candidates/finance_report_review/SKILL.md):
  cash, receivables and payables, with the implemented evidence projection.
- [Bank Reconciliation Review](../skill-candidates/bank_reconciliation_review/SKILL.md).
- [Period Close Review](../skill-candidates/period_close_review/SKILL.md).
- [Expense Evidence Review](../skill-candidates/expense_evidence_review/SKILL.md).
- [Finance Variance Review](../skill-candidates/finance_variance_review/SKILL.md).

The candidate source is compiled by tests, not registered in `harness/mod.rs` or
any production catalog. This is intentional integration isolation, not a new
executor or a second financial calculator.

## Evidence-backed next gaps

| Package | Disposition | Existing authority to reuse | Work and completion criterion |
| --- | --- | --- | --- |
| FIN-SKILL-00 | IMPLEMENTED; candidate tests passed | `reports::{financial_position,open_balances}` | Produce validated cash/AR/AP observations without provider calls. Domain fixtures agree with actual owners; malformed, mismatched and inconsistent snapshots reject. |
| FIN-SKILL-01 | NEXT; not implemented | Authenticated `/v1/reports/{key}/preview`, canonical governed executor | Add one closed `finance_report_read` capability, with admitted company/actor context, source authorization, bounded HTTP transport and evidence persistence. Register a new program and certification adapter without changing `report_analysis`. |
| FIN-SKILL-02 | PROPOSED | Existing bank statement, statement line, payment allocation and reconciliation owners | Add a reconciliation review snapshot: exact statement and line IDs, candidate allocations, unmatched reasons, currency and cutoff. Deterministic matches precede prose. Multiple possible matches remain ambiguous. No reconciliation mutation. |
| FIN-SKILL-03 | PROPOSED | Accounting fiscal-period owner and current close workspace | Add period-close review with exact period identity, draft entries, unreconciled lines and available evidence. Distinguish owner-enforced blockers from advisory checklist items. No close-period mutation. |
| FIN-SKILL-04 | PROPOSED | Existing expense/bill source-evidence access and document-version owners | Add field/receipt comparison with exact versions, availability and extraction provenance. Missing OCR, unreadable evidence and denied access remain distinct. No capture, upload, expense creation or posting. |
| FIN-SKILL-05 | PROPOSED | Typed report snapshots and approved accounting comparison owner | Add deterministic same-metric comparison across compatible company/currency/calendar/basis/window snapshots; explicit baseline and residual. Narratives distinguish measured differences from possible explanations. No unsupported P&L or budget calculations from current sales summaries. |

`FIN-SKILL-01` is the next integration package; the later packages can be designed
independently but are not substitutes for their missing read contracts.

These packages narrow the broader `CAP-00`, `CAP-02` and `CAP-04` work in the
[implementation ledger](../plan/erp-harness-implementation-ledger.md). They do not
change the ledger's acceptance history or certify Finance modules as U4/U5.

## Why this boundary

The existing `report_analysis` adapter's `analytics_summary` tool currently offers
sales revenue by product and stock movement by state. It has no AR/AP aging,
bank/GL reconciliation or budget comparison operation. Its raw sales summary is
not posted accounting revenue. Broader instructions cannot supply absent data.

The owner-report service already implements typed Cash & Mobile Money, Customer
Balances and Supplier Payables previews, with report/source access, company
membership, field masking, integer money, watermarks and caveats. Reuse those
owners rather than adding direct SQL to the model or repeating accounting logic
in a prompt. All three remain previews, and the skill must preserve that status.

Read contracts:

- `api-server/src/routes/reports.rs`: authenticated preview and report/source
  access before response masking.
- `api-server/src/reports/common.rs`: `ReportEnvelope`, currency and watermark.
- `api-server/src/reports/service/financial.rs`: authoritative preview dispatch,
  posted/as-of selection and caveats.
- `api-server/src/reports/open_balances.rs`: residuals, allocation/reversal
  handling and due buckets.
- `api-server/src/reports/financial_position.rs`: posted cash and fee movement.

## FIN-SKILL-01 integration contract

### Input and authority

Candidate skill key: `finance_report_review`.
Candidate capability key: `finance_report_read` (not registered).
Model-visible input:

```json
{
  "reportKey": "supplier_payables_v1",
  "date": "2026-10-26",
  "timezone": "Africa/Kigali"
}
```

Only these three report keys are accepted: `cash_mobile_money_v1`,
`customer_balances_v1`, `supplier_payables_v1`. Extra fields reject.

Organization, company, actor, run, credentials and service origin come from the
current authenticated admitted-run context. Company is fixed before capability
invocation, not selected by the model. The capability forwards the verified
caller's existing authentication to the ordinary owner-report route. It must not
use an owner/runtime-writer credential to bypass source access or replace the
current policy with a model-supplied scope. Missing credentials or stale/revoked
authority fail before source read. The owner service validates the IANA timezone;
the projection checks exact returned scope and consistent cutoff metadata.

### Transport and observation

1. Resolve the exact released skill/program and authorized capability.
2. Apply existing run, deadline and policy checks before the source call.
3. Call the fixed API origin and one enumerated preview path. Send only the
   company from the admitted context, date and timezone. Disable credential-bearing
   cross-origin redirects; cap response bytes while streaming, not after buffering.
4. Propagate denied, unavailable, invalid and oversized source outcomes distinctly.
   They cannot be rewritten as empty successful reports.
5. Call `finance_review::build_evidence` on the authorized, masked response. Its
   input ceiling is 256 KiB and 1,000 source/item rows; at most 20 selected items
   are presented. It returns exact total/owner-provided/included/omitted counts.
6. Persist the immutable observation under the exact run-scoped source key and
   source version before generation. Persist the supplied evidence projection,
   including caveats and coverage, rather than a later refetch. Claims select
   `evidencePointer` inside the persisted observation; `sourcePointer` records
   the original owner-response field and must not be used as a snapshot pointer.
7. Provide the model only that observation. Preserve integer minor units at all
   JSON/TypeScript boundaries; unsafe integers must use the repository's exact
   number codec, not ordinary JavaScript arithmetic or silent float coercion.
8. Route claims and any displayed answer through existing evidence, arithmetic,
   semantic review and publication gates. The projection's hash is an identity,
   not an answer-admission certificate.
9. Reopen the saved run through the existing inspector. Do not refetch or rerun
   merely to display the original result. Following a record reference still
   requires current destination authorization.

Cash totals are daily movement; open balances are as-of the recorded cutoff.
Never combine these as if they shared one accounting basis. Missing due dates
remain null even where the owner classifies their amounts as current. Cash
unreconciled details can already be truncated by the owner; the selected lines
must not be described as the globally largest items or as a complete match list.

### Release and tests

The candidate is green/read-only with no action drafts, posting, payment,
reconciliation, close, export, scheduling or message-send authority. Suggested
execution envelope: one report read plus existing separately admitted generation
and review steps. Final graph limits and source/result schemas must be resolved
through the existing capability/IR owner; this document is not review metadata.

Before enabling the skill:

- Add the capability descriptor, exact program, candidate certification adapter,
  pinned fixture environment and reviewed privacy projection.
- Bind the new skill's source hash to the projection, program, transport, prompt,
  fixtures and applicable owner contract. Never edit the current pilot's version
  or source hash to make this candidate runnable.
- Certify same-company and denied source/field access, another-company response,
  revoked membership, unsupported report, byte/row bounds, ambiguous source error,
  exact empty evidence, partial allocations/reversals and upstream truncation.
- Certify claim coverage and same-run source selection, malformed output,
  unsupported causal claims, and publication withheld on failed review.
- Prove browser → BFF → admitted capability → saved evidence → reload on the
  integrated head, with exact integers, no repeat source/provider call on reload,
  then independent promotion using normal skill lifecycle commands.

No schema/reducer/immutable-contract delta is needed for this provider-free
projection. FIN-SKILL-01 must explicitly assess descriptor/codegen and persistence
contract deltas before claiming the same for the integrated capability.

## Verification recorded for this slice

```sh
cargo test --manifest-path ai-gateway/tests/finance-review-candidate/Cargo.toml --locked --offline
# 27 passed; 0 failed; 0 ignored
```

That target compiles the same projection and actual API calculator sources. It
includes 14 candidate regressions, two owner/fixture contract tests and 11 existing
owner-calculator tests. It requires no server, provider, database or credentials.
The same integration target participates in normal `cargo test -p ai-gateway`.

The standard application target also passed:

```sh
cargo test -p ai-gateway --test finance_review_contract --locked
# Gateway binary compiles; 27 passed; 0 failed; 0 ignored.
```

Rustfmt and whitespace checks passed on the new Rust files. The initial offline
workspace attempt lacked an uncached unrelated dependency; after enabling the
execution sandbox's network access through the configured proxy, the standard
target compiled and passed. Neither target establishes authenticated HTTP,
provider, browser, publication or skill-promotion acceptance. Those belong to
FIN-SKILL-01; the unchanged runtime was not re-certified by this slice.

## Reference patterns

The workflow decomposition draws on Anthropic's public
[Finance plugin](https://github.com/anthropics/knowledge-work-plugins/tree/main/finance)
(reconciliation, close, variance, journal preparation, statements and audit support)
and [Financial Services catalogue](https://github.com/anthropics/financial-services).
These are methodology references, not installed dependencies or permission to
execute their connectors. The candidate instructions are written for Lumière's
owners, preview semantics, run evidence and promotion process. No external skill
scripts or third-party executors are installed.
