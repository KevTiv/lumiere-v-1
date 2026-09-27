# COV-06n Replenishment scheduler

**Package:** `COV-06n`
**Disposition:** `IMPLEMENTED` (backend only) — frontend wiring not started, runtime acceptance pending
**Stacked base:** PR #76 / `codex/cov06m-replenishment-transfer-demand`
**Operator proof:** native domain test only — no browser proof in this slice (see blocker below)

This is the larger, differently-shaped task flagged throughout COV-06h/j/k/l/m: `ReplenishmentRule.next_run` was an inert timestamp — every execution stamped it, but nothing ever consumed it, so a rule only ever ran when a user clicked "execute." This slice gives it an actual recurring schedule.

## Bounded path

```text
one active replenishment rule
→ schedule_replenishment_run → exactly one ReplenishmentRunJob for the rule (fails closed if already scheduled)
→ [SpacetimeDB fires the job at its scheduled_at time]
→ run_scheduled_replenishment(job)
→ executes the rule's demand check (same logic as a manual execute_replenishment_rule call)
→ reschedules: exactly one new job for the rule, at the rule's freshly-stamped next_run
→ cancel_replenishment_run removes any pending job for the rule (no-op if none)
```

## Changes

- New scheduled table `ReplenishmentRunJob` (`spacetimedb/src/inventory/replenishment.rs`), following this codebase's existing one-shot-scheduled-job convention (`SalesSlaEscalationJob` in `sales/oms_advanced.rs`): `{ scheduled_id, scheduled_at: ScheduleAt, organization_id, company_id, rule_id }`, `scheduled(run_scheduled_replenishment)`.
- `execute_replenishment_rule`'s body was extracted into an internal `execute_replenishment_rule_impl` (everything after the permission check), reused by both the manual reducer (permission-checked) and the scheduled worker (system-triggered, no user permission grant — the scheduler itself is the caller, matching how `run_sales_sla_escalation` has no `check_permission` call either).
- `schedule_replenishment_run(organization_id, company_id, rule_id)`: validates the rule (org/company/active), fails closed if a job already exists for that rule (`replenishment_run_job_by_rule` index) rather than silently creating a duplicate, and inserts one job at `rule.next_run` (or one day out if unset).
- `cancel_replenishment_run(organization_id, company_id, rule_id)`: removes all pending jobs for the rule. A rule with none is a no-op success, not an error.
- `run_scheduled_replenishment(job)`: if the rule was deleted or deactivated since scheduling, runs as a no-op and does not reschedule (the fired job row itself is auto-deleted by SpacetimeDB regardless, per this codebase's scheduled-table convention). Otherwise executes the rule with a deterministic job-scoped idempotency key (`scheduled:<ruleId>:<scheduledId>`) and inserts the next job from the rule's freshly-updated `next_run`.
- Added a native domain test (`test_replenishment_scheduled_run_reschedules`, wired into `run_inventory_replenishment_demand_test`) proving: scheduling an already-scheduled rule fails closed; firing a job (simulated as the real scheduler would — delete-then-invoke) both executes the rule and inserts exactly one new job with a different id (not a mutation of the fired one); cancelling removes it; cancelling an unscheduled rule is a no-op success.
- **Found while writing the test**: the warehouse persona fixture had no `replenishment_rule` permission at all. `execute_replenishment_rule`, `schedule_replenishment_run`, and `cancel_replenishment_run` all check for it — meaning COV-06h's and COV-06m's own browser proofs (`executeReplenishmentRuleViaUi`, driven by the warehouse persona) would have failed with 403 had they actually been run. Neither has been executed against a live stack yet (both are still `IMPLEMENTED`, pending the same runtime proof this slice is also pending), so this was caught before it could surface as a real failure. Fixed by adding `replenishment_rule:*` to the warehouse persona fixture.

## Blocker: no frontend wiring in this slice

`ReplenishmentRunJob` is a brand new table with no entry in `crates/stdb-auth/assets/resource_registry.json` and no `/api/query/replenishment-run-jobs` route. Unlike COV-06k's warehouse QC location (an existing, queryable resource that just needed a new field hand-encoded past a stale generated type), there is nothing for the frontend to query here at all yet — a UI action to schedule/cancel a rule's auto-run, and any exact-readback verification of it, needs that resource registered first. This is a genuine blocker, not a repeat of COV-06j's mistaken one.

## Runtime validation required

```bash
spacetime publish <db> --clear-database -y --module-path spacetimedb
spacetime call <db> run_all_inventory_tests
```

Do not mark this slice `ACCEPTED` until that runtime proof passes — this is also the first real exercise of `run_all_inventory_tests` and the browser proofs across COV-06h through COV-06n, none of which have been run against a live stack yet.

## Next bounded work

Register `replenishment_run_job` as a query resource (`resource_registry.json` + whatever else `select_org_scoped_sql` needs), then add a UI action to schedule/cancel a rule's auto-run with a typed workflow verifying the exact job row converges, following the same shape as every other COV-06 slice. That would be COV-06o.
