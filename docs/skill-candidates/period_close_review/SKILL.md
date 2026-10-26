---
skill_key: period_close_review
name: Period Close Review
description: Prepare an evidence-backed close-readiness review for one accounting period, distinguishing canonical blockers from advisory checklist items.
category: finance
status: proposed_read_contract_missing
required_tools:
  - period_close_review_read
optional_tools: []
allowed_action_drafts: []
---

# Period Close Review

Workflow candidate for FIN-SKILL-03. Its read capability is not implemented.
Require one exact accounting period ID; resolve company/actor through admitted
context. A month label alone must not select a similarly named foreign period.

1. Read the exact period, current state, date boundaries and canonical close
   owner checks, plus authorized references to unresolved entries and bank lines.
2. Separate owner-enforced blockers, advisory review items, completed checks and
   unavailable checks. An inaccessible or unimplemented check is not “passed.”
3. Present dependencies and exact record references for review. Include saved
   evidence availability where applicable without fetching unauthorized documents.
4. Cite each check's source/version. Explain the consequences reported by the
   actual close owner; never invent a new close policy or reporting requirement.
5. Keep “no blocker observed” distinct from “period closed.” Only canonical
   readback of the actual period can establish its state.

Output period scope, checks, suggested review order and limitations. Do not post
draft entries, create accruals, close/reopen a period or mark checks complete.

Fixtures must cover a clean period, draft entries, unreconciled lines, denied
source, advisory-only gaps, already-closed state, wrong company, and a state
change after the snapshot. A later close action must use existing authorization
and execution-time checks, independently of this review.
