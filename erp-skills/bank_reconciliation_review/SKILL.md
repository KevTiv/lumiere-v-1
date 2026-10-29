---
skill_key: bank_reconciliation_review
name: Bank Reconciliation Review
description: Review authorized statement lines and reconciliation candidates, explaining unmatched and ambiguous items with exact evidence.
category: finance
status: implemented_pending_tenant_certification
required_tools:
  - finance_review_read
optional_tools: []
default_max_steps: 5
default_max_tool_calls: 1
allowed_action_drafts: []
---

# Bank Reconciliation Review

This skill runs through the governed finance read capability and requires an independently certified active tenant release.

Use when an operator asks to investigate a statement or an unreconciled line.
Require `statementId` (positive integer); optional `query` narrows the question.
The owner supplies the cutoff, versions and current statement state; the company comes from admitted
context. Consume only the canonical bank/reconciliation owner's scoped snapshot.

1. Confirm statement identity, currency, opening/closing balances, import state,
   line coverage and cutoff. A staged statement is not approved or reconciled.
2. Present the owner's existing matches and deterministic proposed candidates.
   Compare amounts, currency, dates and references through that owner contract.
3. Separate unique candidates, multiple candidates, missing counterparts, timing
   differences and unavailable evidence. A similar amount alone is insufficient.
4. Retain reversal and partial-allocation relations. Do not propose using a
   payment balance already consumed by another allocation.
5. Cite statement/line and payment/entry identities, snapshot version and exact
   source pointers for every proposed match and stated difference.
6. Explain unresolved differences as investigation items. Do not label them fraud,
   bank error or ledger error without supporting evidence.

Output an investigation table and coverage/limitations. Never mark a statement
reconciled, stage another import, allocate a payment, write off a balance, create
an adjustment or approve a match. Those are separate consequential workflows.

Acceptance must include duplicate imports, same-amount competing candidates,
wrong currency/company, partial allocations, reversals, stale snapshots, denied
evidence and incomplete line sets. See the finance expansion plan for sequencing.

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
  "statementId": 1
}
```
