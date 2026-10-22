# COV-06o Replenishment scheduler UI and readback

**Package:** `COV-06o`
**Disposition:** `IMPLEMENTED` — contract release and live acceptance pending
**Stacked base:** `claude/cov06n-scheduler-readback`
**Authoritative state:** `replenishment_rule.scheduled_run_job_id`; the private scheduled-job table is not a frontend resource.

## Bounded path

```text
Inventory / Replenishment row
→ Schedule automatic run / Cancel automatic run
→ fresh replenishment-rules read
→ exact rule + scheduled_run_job_id preflight
→ generated named session operation
→ schedule_replenishment_run | cancel_replenishment_run
→ invalidate replenishment-rules
→ exact rule readback
→ scheduled_run_job_id populated | cleared
```

The row action is advisory only. The typed workflow always performs a fresh
`staleTime: 0` read before dispatch, and the reducer remains the authoritative
permission/state guard.

## Changes

- Expose `schedule_replenishment_run` and `cancel_replenishment_run` as reviewed session commands in the reducer exposure and operation classification sources. They were present in contracts v0.3.63 as reducer input types, but intentionally absent from the generated session operation descriptors while `client_facing=false`.
- Project `scheduled_run_job_id` from the public `replenishment-rules` resource for ordinary inventory readers. The private `ReplenishmentRunJob` table remains private.
- Add `inventory.replenishment.schedule` and `inventory.replenishment.schedule-cancel` workflows. Their state reader distinguishes a missing projection from an explicit empty option and fails closed when the pointer cannot be observed.
- Add generated-operation commands and a shared `replenishmentRulesQueryOptions` query boundary.
- Add mutually exclusive Schedule/Cancel row actions in the Inventory Replenishment tab. Schedule applies only when the public pointer is readable and empty; Cancel applies only when it is readable and populated.
- Register both reducers in the Inventory command census.
- Add pure workflow tests for missing-field, stale state, exact-rule and post-dispatch convergence.
- Add the COV-06o browser proof for:
  - warehouse Schedule through the UI and exact pointer readback;
  - stale duplicate Schedule denial with the pointer unchanged;
  - read-only Cancel denial with the pointer unchanged;
  - warehouse Cancel through the UI and exact pointer clear;
  - read-only Schedule denial with the pointer still empty.
- Add an opt-in `E2E_RUN_INVENTORY_AGGREGATE=1` live-stack gate so this certification branch can exercise `run_all_inventory_tests` once without making every normal smoke run pay for the aggregate suite.

## Contract boundary

COV-06o must use the generated immutable operation highway. No raw reducer or
compatibility call is introduced by product code. The contract release generated
from these source changes must contain both scheduler operations in
`SESSION_OPERATION_DESCRIPTORS` before frontend typecheck/runtime acceptance.

## Runtime acceptance

Required before `ACCEPTED`:

```bash
spacetime call <db> run_all_inventory_tests
# Browser proofs on the live P0 stack:
# COV-06h, COV-06i, COV-06j/k, COV-06l, COV-06m, COV-06o
```

The COV-06o proof itself carries stale and read-only denial assertions and
checks the public scheduler pointer after every denied mutation.

## Acceptance rule

Mark COV-06o `ACCEPTED` only when the contracts pin containing the session
descriptors is on this branch, static/type checks pass, the aggregate inventory
reducer suite passes on a live stack, and the COV-06 browser proofs pass there.
