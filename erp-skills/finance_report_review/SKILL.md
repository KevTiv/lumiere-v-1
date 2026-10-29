---
skill_key: finance_report_review
name: Finance Report Review
description: Explain authorized cash, customer-balance and supplier-payable previews with exact amounts, source citations, visible cutoff and incomplete-data caveats.
category: finance
status: implemented_pending_tenant_certification
default_max_steps: 5
default_max_tool_calls: 1
required_tools:
  - finance_review_read
optional_tools: []
allowed_action_drafts: []
references:
  - references/response-example.md
---

# Review cash and open balances

## Use when

Use for “what do we owe suppliers?”, “which customer balances are largest?” or
“explain cash movement”. Use `finance_variance_review` for a supported comparison,
`bank_reconciliation_review` for statement candidates, and `report_analysis` for
operational sales/stock analytics.

## Inputs

Required: `reportKey` (`cash_mobile_money_v1`, `customer_balances_v1` or
`supplier_payables_v1`), `date` (`YYYY-MM-DD`), and `timezone` (company reporting
IANA timezone). Optional: a bounded `query`. Ask for all unresolved values in one
clarification; do not guess the timezone. Organization, actor, company and run
come from admitted context. SQL, arbitrary URLs and scope overrides reject.

## Procedure

1. The fixed `finance_review_read` program obtains one authorized owner snapshot.
   Check report key, currency/scale, local date, cutoff, watermark, caveats and
   item coverage. Preserve preview status; an error is not a zero balance.
2. Explain owner-calculated totals. Format integer minor units at their declared
   scale; do not use floating-point money, convert currencies, recalculate
   allocations or subtract reversals again.
3. Explain selected balances as largest by absolute residual. Cash ranking refers
   only to owner-provided unreconciled lines. State omitted counts; do not infer
   the value of omitted items. Null due dates remain unknown.
4. Produce at most eight supported claims in `FinalDraft`. Copy the run-scoped
   evidence passage identity/version. Its pointers locate persisted evidence;
   owner source pointers have a different meaning. Exact record kind/ID links
   may come from the observation; do not invent navigation URLs.
5. Include preview/cutoff and material coverage caveats in supported claim text.
   Build `content` from those claim texts in order. Use the response example for
   shape only. Submit through independent review and normal answer admission.

## Recovery and handoff

Separate observed facts from investigation suggestions. Missing inputs need
clarification; denied, stale, incomplete and unavailable evidence retain their
actual outcomes. Use only runtime-authorized bounded recovery. A saved answer
represents its original observation, not current balances after reload.
Do not allocate/reconcile payments, post entries, send notices, close periods,
create tasks, export or schedule work. Completion is an admitted bounded review;
financial actions require their own authorized workflow.
