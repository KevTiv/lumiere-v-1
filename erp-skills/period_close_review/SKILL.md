---
skill_key: period_close_review
name: Period Close Review
description: Prepare an evidence-backed close-readiness review for one accounting period, distinguishing canonical blockers from advisory checklist items.
category: finance
status: implemented_pending_tenant_certification
required_tools:
  - finance_review_read
optional_tools: []
default_max_steps: 5
default_max_tool_calls: 1
allowed_action_drafts: []
---

# Period Close Review

This skill runs through the governed finance read capability and requires an independently certified active tenant release.
Require `periodId` (positive integer); optional `query` narrows the question; resolve company/actor through admitted
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
  "periodId": 1
}
```
