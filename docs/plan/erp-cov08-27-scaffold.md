# COV-08 → COV-27 scaffold

**Status:** SCAFFOLDED — every remaining track has a bounded first target, its
existing operations and query hooks, the canonical readback resource, a
contract-release disposition, a D/A/O/E checklist and a `test.fixme` browser
placeholder. No business behavior is changed by the scaffold.

Machine-readable tracker: [`../evidence/cov-08-27-scaffold.json`](../evidence/cov-08-27-scaffold.json).
Ordering and acceptance rules remain those of
[`erp-cov08-27-stacked-acceptance-plan.md`](./erp-cov08-27-stacked-acceptance-plan.md).

## How the inventory was derived

For each track the scaffold lists only reducers that exist in `spacetimedb/src`
**and** are already called from the frontend command layer, and checks the
registry projection (`crates/stdb-auth/assets/resource_registry.json`) of the
table each reducer writes for a state field and organization/company scope.
"Contract release required" means the exact readback needs a field or resource
the current projection does not expose.

## Contract releases

Releases cannot be cut from CI or from the authoring session. Slices marked
`yes` stop at IMPLEMENTED with the registry diff prepared; a maintainer with
`lumiere-contracts` access runs `make publish-contracts VERSION=x.y.z` and pins
the release (see `dec51e09` for the v0.3.54 pin). Batch these into one release
where possible (COV-05 `purchase_id`, COV-05b `purchase_line_id`/`is_done`,
PAY-06 write-off fields are already waiting on v0.3.55).

## Tracks

| Track | First bounded target | Existing operations | Contract release | Card |
| --- | --- | --- | --- | --- |
| COV-08d2 | Fixed-asset depreciation board and disposal exact effects | `compute_depreciation_board`, `dispose_account_asset` | maybe | [status](./erp-cov08d2-asset-depreciation-disposal-status.md) |
| COV-08e | Finance module certification over 08a–d | `archive_financial_report` | no | [status](./erp-cov08e-finance-certification-status.md) |
| COV-09 | Leave request submit → approve/refuse | `submit_leave`, `approve_leave`, `refuse_leave` | no | [status](./erp-cov09-hr-leave-approval-status.md) |
| COV-10 | Approved timesheet validation → billing handoff | `validate_timesheets`, `reject_timesheets` | maybe | [status](./erp-cov10-project-timesheet-validation-status.md) |
| COV-11 | Expense sheet submit → approve → post → reimburse | `submit_expense_sheet`, `approve_expense_sheet`, `post_expense_sheet`, `create_expense_reimbursement_payment` | no | [status](./erp-cov11-expense-sheet-lifecycle-status.md) |
| COV-12 | One recurring invoice run | `generate_subscription_invoice`, `pay_subscription_invoice` | maybe | [status](./erp-cov12-subscription-invoice-run-status.md) |
| COV-13 | Session order/payment → close | `close_pos_session` | yes | [status](./erp-cov13-pos-session-close-status.md) |
| COV-14 | Ticket assign → close → reopen | `assign_ticket`, `close_ticket`, `reopen_ticket` | yes | [status](./erp-cov14-helpdesk-ticket-lifecycle-status.md) |
| COV-15 | Vehicle service/inspection cost history | `record_fleet_service`, `record_fleet_inspection` | maybe | [status](./erp-cov15-fleet-service-cost-status.md) |
| COV-16 | Device alert → acknowledge/resolve | `acknowledge_iot_action`, `resolve_iot_alert` | no | [status](./erp-cov16-iot-alert-resolve-status.md) |
| COV-17 | Versioned review → approve → convert to sale order | `approve_proposal`, `convert_proposal_to_sale_order` | no | [status](./erp-cov17-proposal-approve-convert-status.md) |
| COV-18 | Upload/version → lock/unlock one document | `lock_document`, `unlock_document` | yes | [status](./erp-cov18-document-lock-version-status.md) |
| COV-19 | Record-linked activity completion (then message post) | `complete_activity`, `post_message` | no | [status](./erp-cov19-activity-completion-status.md) |
| COV-20 | Configure → execute → export one scheduled report | `create_scheduled_report`, `record_report_run` | yes | [status](./erp-cov20-report-run-status.md) |
| COV-21 | One evidence-backed human-task decision | `claim_workflow_human_task`, `decide_workflow_human_task` | yes | [status](./erp-cov21-approval-decision-status.md) |
| COV-22 | Publish one form configuration; validate→commit one import | `publish_form_configuration`, `import_hr_payslip_csv` | no | [status](./erp-cov22-form-publish-import-commit-status.md) |
| COV-23 | Membership role assign → revoke | `assign_role`, `revoke_role` | no | [status](./erp-cov23-role-assignment-status.md) |
| COV-24 | Order → delivery → collection exception workspace | — | no | [status](./erp-cov24-distributor-workspace-status.md) |
| COV-25 | Close one missing downstream record link per PR | — | no | [status](./erp-cov25-cross-module-links-status.md) |
| COV-26 | One module quality pass per PR | — | no | [status](./erp-cov26-ux-accessibility-status.md) |
| COV-27 | Seeded all-module launch manifest and ratchets | — | no | [status](./erp-cov27-full-stack-certification-status.md) |

## Placeholders

`frontend/web/tests/e2e/cov*-*.spec.ts` placeholders are tagged `@cov-scaffold`
and use `test.fixme`, so they are reported as pending and never counted as
passing; they are outside the `@p0` lane. Replace each with the real proof when
the slice is implemented (remove `@cov-scaffold`, add `@p0`, keep the file name).
