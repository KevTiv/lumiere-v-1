# Finance skill implementation — 2026-10-26

Branch: `codex/finance-skill-expansion`, following the evidence foundation at
`0434eb1a`. The earlier [expansion plan](../plans/finance-harness-expansion.md)
describes the original candidate stage; this file records its implementation.

## Executable coverage

All five skills now have bundled instructions, closed read contracts, registered
governed programs, source-bound certification adapters, authenticated
BFF/gateway/API entry points, and a Finance reviews workbench panel. Execution
still requires an independently certified active tenant release, an authorized
company/actor, compatible agent/model policy and spend admission. This branch
does not deploy services or create any tenant release.

| Skill | Implemented behavior | Intentional limits |
| --- | --- | --- |
| `finance_report_review` | Cash, receivables and payables previews with exact money, cutoff, sources, caveats and explicit item coverage | Existing owner previews retain their preview status. No accounting-statement certification is inferred. |
| `bank_reconciliation_review` | Inspect existing match candidates; distinguish unmatched, unique candidates, ambiguity and already-reconciled lines | Exact company/currency/posted-state/residual checks; already bank-linked payments excluded. No new matching engine, partial-match/FX inference or reconciliation mutation. |
| `period_close_review` | Exact period state, close-owner requirement, draft-entry and unreconciled-line references | Only Open state is currently owner-enforced. The other checks are advisory; unavailable checks remain listed. No new close policy or close action. |
| `expense_evidence_review` | Compare saved expense/bill fields with exact authorized receipt/document bytes and pinned checksum/version | Reuses server text/PDF extraction; no OCR call. Missing, ambiguous, unreadable and unavailable extraction remain distinct. Only explicit observed fields receive deterministic comparisons. |
| `finance_variance_review` | Exact actual/baseline/difference and rational percentages for the supported owner reports | Same company, currency/scale, schema, timezone and duration required. No budget, P&L, FX or causal decomposition inferred. Zero baseline has undefined percentage. |

All five are advisory, read-only skills. Posting, allocation, reconciliation,
expense approval/reimbursement, period close, export, scheduling and messaging
remain separate consequential operations.

## Runtime and authorization

```text
Finance reviews form -> authenticated BFF -> trusted actor headers
  -> active release + current-policy/spend/durable-run admission
  -> finance_review_read -> Verify -> Generate in the existing executor
  -> authenticated source API -> existing source/field/report/blob owners
  -> immutable run observation persisted before model use
  -> complete claims + same-run support + independent semantic review
  -> existing publication gate and saved-run inspector
```

Web path: `/api/ai/skills/finance/<skill_key>`.
Gateway path: `/v1/skills/finance/<skill_key>`.
Source API: `/v1/finance-reviews/<skill_key>`.
The source tool is one fixed `finance_review_read` operation with different named
resources/programs per skill. It uses the original admitted input as parameters,
not model output or server-added reference knowledge. Legacy execution is fenced.

The web request contains `companyId`, optional `agentId`, and `inputs` below.
Company is validated user intent. Organization, actor, credential and durable run
are always server-derived. An optional bounded `query` is accepted in every input.

| Skill | Required `inputs` |
| --- | --- |
| Report | `reportKey`, `date`, `timezone` |
| Reconciliation | `statementId` |
| Close | `periodId` |
| Expense | `recordKind` (`expense` or `bill`), `recordId` |
| Variance | `reportKey`, `actualDate`, `baselineDate`, `timezone` |

Report keys are closed to `cash_mobile_money_v1`, `customer_balances_v1`, and
`supplier_payables_v1`. Dates are explicit `YYYY-MM-DD`; the owner validates IANA
timezones. Unknown fields, SQL, arbitrary reports/URLs and scope overrides reject.

The gateway forwards the verified user's API credential to a fixed configured
origin, disables redirects and bounds time and response bytes while streaming.
The API resolves membership, applies existing source read/field policies, and
rechecks placement/membership after source reads. No source denial becomes an
empty successful report. The new opt-in database bounds cap SQL results and
streamed bytes before post-filters; overflow rejects rather than silently
sampling a supposedly complete source. Large organizations may need narrower
owner queries before these reviews cover their entire source set.

Expense sources retain exact receipt/employee and bill/document/current-version
relations. Managed-storage checksums must agree, and relations/versions/saved
records are reread to reject concurrent changes. Text is untrusted evidence,
never execution instructions. A date with an unresolved reporting basis stays
unverified. Non-JSON text is available to the separately gated model; image-only
evidence does not establish merchant, total, date or tax. No OCR provider is
invoked by this read.

Cash is daily movement and open balances use the owner's cutoff. Comparisons
never mix these bases. Percentages use `difference / absolute baseline * 100`
with exact rational strings; neither causality nor favorable/unfavorable status
is inferred from the sign alone.

## Evidence and release

`finance_review_snapshot` records are bound to organization, company, run, skill
and the exact observation content hash, including source limitations and
coverage. Persistence must succeed before model use. Reloading the saved-run URL
uses the existing inspector without executing another read/provider call.

Structured answer parsing, complete in-order claim coverage and own-run support
checks now apply to the exact five finance programs as well as `report_analysis`.
Plain prose acquires no claims implicitly. Independent semantic rejection
withholds the answer. A snapshot hash is an identity, not an admission certificate.

Shared executor/registry changes alter the pilot's compiled source binding.
This branch proposes **`report_analysis` 1.0.6**, with updated proposed manifest
and local development seed hash. It does not change a deployed 1.0.5 release.
Integration must certify/promote that new version before deploying this branch
to a pilot that requires it.

Each finance skill starts at **1.0.0**. Prepare/check its proposed local artifacts:

```sh
python3 scripts/finance-skill-manifests.py --write
python3 scripts/finance-skill-manifests.py --check
```

Manifests live in `infra/skill-releases/finance/`. The script reads source only;
it never contacts a service, registers a skill or issues a certificate. Empty
permission arrays grant nothing; source access is independently intersected at
read time. Source hashes bind prompts, shared admission/executor sources,
transport, projection, source/report/blob owners and the bounded database client.

The certification worker supports all five adapters. Its normal pinned transcript
dataset also carries `financeSource`: `preview` for reports; `statements`, `lines`,
`candidates`, `invoices`, `payments` for reconciliation; `periods`, `moves`,
`statements`, `lines` for close; a scoped `record` and pinned `source` for expense;
and complete `actual`/`baseline` envelopes for variance. The adapter executes
actual projections and derives its passage catalog from their output. Expected
fixture output is never supplied to it.

No native table/reducer signature or immutable contracts release changes here.
Live HTTP tenant acceptance, real-provider behavior, settled spend, deployed
browser acceptance and independent promotion remain external integration gates.
Synthetic transcript replay is not a live-provider certificate.

## Verification scope

Tests exercise actual owner calculators, all five real governed programs and
their independent-review rejection paths; scope/credential forwarding; denied,
oversized and redirected source reads; exact large money/zero baselines; duplicate
identities/payment reuse; partial allocations/reversals; extraction availability;
and advisory versus owner-enforced close checks. The five API paths join the
existing anonymous-denial integration test. Local checks do not establish
production provisioning.

Completed checks:

- Gateway: 769 tests passed; eight existing tests ignored. Finance domain owner
  integration: 27 passed.
- Shared finance core: 14 tests passed, including exact payment linkage and
  receipt comparison. Database client: 16 unit tests and two bounded-HTTP tests
  passed.
- Source API compiled; all three session-auth integration tests passed,
  including anonymous denial on the five new source routes.
- Web unit suite: 112 test files passed. The new BFF admission and form-model
  tests were also run directly (six tests passed).
- Web and query-hooks TypeScript checks passed. Translation duplicate/key
  guards, source-bound manifest checks, runtime-image contract checks and
  immutable contracts release verification passed.

No full container build or deployed browser/live-tenant acceptance was run.

## Integration with current Alpha source — 2026-10-27

Merged current main through `83e8be1f50d758f8bc9e1a9ec9d05993a1bfe8d9`.
Retained the report question, typed final-draft contract, complete claim coverage,
and recorded analytics snapshot admission fixes. The proposed report version is
1.0.6; finance skills remain 1.0.0. The immutable contracts pin is 0.3.149.

Finance generation now requests the same typed final-draft response contract.
The final citation check admits finance snapshots only from the declared source
node for the current run. Tests exercise top-level snapshot citations, all five
programs, rejection by independent review, and foreign-run/wrong-node/wrong-kind
refusal. Local gateway tests passed: 776 unit tests and 27 owner integration tests;
eight existing prerequisite tests remain ignored. Six finance BFF/form tests,
manifest checks, runtime image contract checks, and immutable release verification
also passed. Hosted final-head CI and browser checks remain pending.

No production deployment or tenant activation is part of this merge.
