# HR & Payroll Gap Fixes — Tracker

Executable tracker for the full backlog (Pilot → Competitive → Differentiating). Source investigation: [../HR_PAYROLL_INVESTIGATION.md](../HR_PAYROLL_INVESTIGATION.md).

**Coordinator:** [.cursor/plans/hr-payroll-coordinator-mission.md](../../.cursor/plans/hr-payroll-coordinator-mission.md) · **Skill:** [.cursor/skills/hr-payroll-coordinator/SKILL.md](../../.cursor/skills/hr-payroll-coordinator/SKILL.md)

**Product boundary:** Core HR lives in `spacetimedb/src/hr/`. Payroll is a **country-pack + integration framework** (export intents, immutable calculation artifacts, optional GL post) — **not** a universal gross-to-net engine. Do not implement salary-rule execution. Expenses and PSA timesheets stay in their modules; reuse `employee_id` FKs only.

## Wave A — Pilot integrity (PII + leave + payroll artifact + UI/SQL)

- [x] PII purpose scopes: self / manager (direct reports) / HR-admin row filters
- [x] Field-level masking: strip `pin` from broad feeds; wages require `view_comp`; sensitive columns purpose-gated
- [x] Read-access audit for sensitive employee/comp reads (`hr_pii_access_log` or audit `READ`)
- [x] Split or project public vs sensitive employee surfaces for subscriptions (org-chart safe)
- [x] Leave: `submit_leave` → `Confirm`; approve consumes allocation/balance atomically
- [x] Leave: refuse only from pending states; SoD (approver ≠ requester); optional `gate_action_with_approval`
- [x] Contract/leave/payslip transition reducers: flat `company_id` + ownership guards + from-state checks *(contracts: `[hr-guards-sm]`; leave/payslip: other tracks)*
- [x] Wire `ERP_ORG_SQL` for `job-positions`, `leave-types`, `payroll-structures`, `salary-rules` (without widening PII)
- [x] Wire update_* UI (employee/dept/job/contract/leave-type) or remove from reachability claims
- [x] Fix pending-leave KPI (`Confirm` / pending states, not Draft-only mismatch)
- [x] Payslip: forbid `Done` without export artifact or `account_move_id`; rename confirm → approve-for-export if needed
- [x] `hr_payroll_export_intent` (+ record result) scaffold — no universal rule engine
- [x] Optional `post_payslip` / pack posting path that creates balanced `AccountMove` in one reducer **or** durable export-only path with explicit state
- [x] Minimal offboarding checklist (assets/access/docs) before/with `archive_employee`
- [x] Domain suite `run_all_hr_tests` (isolation + leave balance + payslip artifact)
- [x] Playwright `hr-wave-lifecycle.spec.ts` (leave submit→approve + payslip approve/export path)

## Wave B — Competitive productization

- [x] Onboarding checklist templates + instance progress
- [x] Employee document vault (metadata + attachment refs; tax-form purpose tags)
- [x] Compensation effective-dated events (wage history; contract wage sync)
- [x] Attendance punches MVP + leave conflict check
- [x] Basic work schedules / shifts (pack-keyed holidays later)
- [x] Pack-driven leave category defaults (AU/NZ/ZA/BR/SG/…) + public-holiday table seeds
- [x] Statutory ID vault fields (TFN / SARS tax ref / CPF / …) purpose-restricted
- [x] Bounded SQL + UI: `leaves-to-approve`, `payslips-to-export`
- [x] CSV: Draft-only leave/payslip by default + `write_audit_log_v2` on imports
- [x] Durable leave approval timeline UI
- [x] Recruitment beyond job-position filter (applicant stub — `hr_applicant` + Recruitment panel)

## Wave C — Differentiating

- [x] Performance / goals cycles
- [x] Benefits enrollment
- [x] Advanced WFM (shift optimization, labor cost) *(MVP stubs — `hr_labor_cost_snapshot`, `hr_shift_opt_job`)*
- [x] Certified partner marketplace hooks for country payroll engines
- [x] Cross-border assignee / multi-jurisdiction employee *(MVP stub — `hr_global_assignment` CRUD)*
- [x] Predictive capacity with PSA leave-aware views *(MVP stub — `hr_capacity_forecast`; PSA `capacity_forecast_snapshot` unchanged)*
- [x] Integration workers (STP / eSocial / CPF / SARS file exchange) consuming intents

## Ops checklist (after each wave that touches schema)

1. [x] `make generate-stdb-ts-sdk` and `make generate-stdb-rust-sdk` + `make codegen` — 2026-07-19
2. [x] Publish module — `make publish-clear` → `lumiere-v1-j1uo0` (2026-07-19); e2e re-publishes `lumiere-v1-local-e2e`
3. [x] `spacetime call lumiere-v1-j1uo0 run_all_hr_tests --server local` — passed 2026-07-19
4. [x] Playwright: `hr-wave-lifecycle.spec.ts` + `phase-5-workforce-smoke.spec.ts` passed 2026-07-19 (`E2E_CLEAR_DB=1` for schema publish)
5. [x] Update investigation §7 priority tables — Done (Waves A–C + recruitment) 2026-07-19

## Notes

- **Do not** execute `HrSalaryRule` as a payroll engine — treat as config hints or leave inert.
- Forms: `FormConfig` in `frontend/packages/ui/src/lib/hr-form-configs.ts` + `FormModal` + `ModularForm`.
- Reducers: `.cursor/rules/lumiere-reducer-conventions.mdc` (`*Params`, `write_audit_log_v2`, company guards).
- SpacetimeDB: leave approve + balance consume in one reducer txn; government/bank HTTP → workers/procedures via intents.
- Auth app onboarding (`/(auth)/onboarding`) is **not** HR employee onboarding — keep separate.
