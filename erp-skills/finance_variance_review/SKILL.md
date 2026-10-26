---
skill_key: finance_variance_review
name: Finance Variance Review
description: Explain owner-calculated differences between compatible financial snapshots with explicit baselines, unexplained residuals and cited evidence.
category: finance
status: implemented_pending_tenant_certification
required_tools:
  - finance_review_read
optional_tools: []
default_max_steps: 5
default_max_tool_calls: 1
allowed_action_drafts: []
---

# Finance Variance Review

This skill runs through the governed finance read capability and requires an independently certified active tenant release. The existing sales
analytics summary is not an alternative financial-statement source.

Require metric/report key, actual window, comparison window or exact budget
version, and timezone. Company and currency scope come from admitted context.

1. Obtain owner-calculated comparison evidence. Verify compatible company,
   currency/scale, accounting basis, calendar, period length and posting state.
2. Show baseline, actual, absolute difference and the owner's percentage result.
   A zero baseline has an undefined percentage, not infinite or zero growth.
3. Use only the owner's documented decomposition convention. Contributions must
   tie to the total or expose an explicit unexplained residual. Do not silently
   distribute interaction/mix effects to force a balanced narrative.
4. Apply the organization's explicit materiality settings if supplied; otherwise
   describe changes without inventing a reporting threshold.
5. Cite source snapshots and calculation version. Separate measured price/volume
   contributions from hypotheses about customer, supplier or management behavior.

Output compatible scopes, comparison facts, verified contributions, residual and
questions for investigation. Do not infer P&L from unposted sales, combine
currencies, invent missing budgets or classify every positive change as favorable.

Acceptance includes zero/negative baselines, missing budgets, unequal periods,
FX mismatch, reversals, rounding, decomposition interaction terms, incomplete
coverage, scope mismatch and unsupported causal assertions.
