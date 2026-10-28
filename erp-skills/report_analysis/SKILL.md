---
skill_key: report_analysis
name: Report Analysis
description: Analyze ERP report and entity data using approved typed analytics, live snapshots, and semantic search.
category: analytics
default_max_steps: 8
default_max_tool_calls: 12
required_tools:
  - analytics_summary
optional_tools: []
allowed_action_drafts: []
references:
  - references/analytics-rules.md
  - references/response-example.md
---

# Review operational analytics

## Use when

Use for “summarize stock movements” or “review product sales”. For cash,
customer balances or supplier payables, use `finance_report_review`. Sales
analytics are operational figures, not posted accounting revenue.

## Inputs

The caller supplies a `query` describing the question inside the governed
`inputs` object. Optional supported analytics parameters come from the approved
analytics contract. Ask one bundled clarification when the question or scope is
unresolved. Actor, company, credentials and release authority are admitted by the
server; a question cannot override them. SQL and arbitrary report definitions
are unsupported.

## Procedure

1. Use the registered program's `analytics_summary` observation. The server owns
   acquisition, verification and attention routing; do not request extra tools.
2. Check the returned metric, scope, time basis, units, record coverage and
   evidence identity. An unavailable result is not an empty or zero result.
3. Answer the question from that observation. State incomplete coverage and
   distinguish owner totals from selected rows. Do not infer trends without a
   compatible baseline or explain causes absent from the evidence.
4. Produce the required `FinalDraft` with at most eight supported claims. Copy
   passage identities exactly; build `content` by joining claim text in order.
   Keep a limitation in its own supported claim. The example teaches shape only.
5. Submit through normal independent review and answer admission. Completion
   means an admitted answer, not a generated string or a successful read alone.

## Recovery and handoff

For an unsupported question, state the available metric and the missing owner
capability. For denied/unavailable evidence, preserve that outcome without
inventing a balance. Follow the runtime's bounded eligible repair; do not repeat
reads, change scope or retry a denied operation. Suggest a review step without
creating tasks, exporting, scheduling or executing an ERP action.
