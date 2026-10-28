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

Require `reportKey`, `actualDate`, `baselineDate` and `timezone`; optional `query`
narrows the question. Report keys are cash_mobile_money_v1, customer_balances_v1
and supplier_payables_v1; dates are YYYY-MM-DD. Budgets, P&L, FX and causal
decomposition are unsupported by this read. Company and currency scope come from admitted context.

1. Obtain owner-calculated comparison evidence. Verify compatible company,
   currency/scale, accounting basis, calendar, period length and posting state.
2. Show baseline, actual, absolute difference and the owner's percentage result.
   A zero baseline has an undefined percentage, not infinite or zero growth.
3. Explain the supported report differences only. Do not invent a price/volume
   decomposition, interaction effects or causal explanation absent from the owner.
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

## Response and recovery

Use the runtime FinalDraft schema: at most eight claims with copied run-scoped
passage identities; join their exact text in order to form content. Retain source
limitations in supported claim text. Request missing caller inputs together;
source metadata is resolved by the owner. Denial, unavailable evidence and changed
versions are not successful checks. Use only the runtime's bounded recovery.
Completion requires independent review and answer admission.

## Example task data

Synthetic example; trusted transport and identity fields are supplied separately
by the server. This data is not evidence of a saved record or an executed action.

```json
{
  "reportKey": "supplier_payables_v1",
  "actualDate": "2026-10-26",
  "baselineDate": "2026-10-25",
  "timezone": "Africa/Kigali"
}
```
