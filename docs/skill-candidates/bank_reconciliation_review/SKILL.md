---
skill_key: bank_reconciliation_review
name: Bank Reconciliation Review
description: Review authorized statement lines and reconciliation candidates, explaining unmatched and ambiguous items with exact evidence.
category: finance
status: proposed_read_contract_missing
required_tools:
  - bank_reconciliation_review_read
optional_tools: []
allowed_action_drafts: []
---

# Bank Reconciliation Review

This is a workflow candidate for FIN-SKILL-02. The required capability and
snapshot contract do not exist yet; do not advertise or enable this definition.

Use when an operator asks to investigate a statement or an unreconciled line.
Require the exact statement ID and cutoff; the company comes from admitted
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
