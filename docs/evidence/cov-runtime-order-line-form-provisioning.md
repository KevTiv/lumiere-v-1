# Governed order-line runtime form provisioning

Status: REVIEW — implementation present; runtime/operator acceptance unproven.

Runtime follow-up: canonical provisioning and the affected browser workflows
passed in the fresh 51-test lane. See [current evidence and readiness limits](cov-runtime-browser-acceptance-2026-10-04.md).

Base: `77e3e495af2265be07d36854f7c9740dab435056`.

## Follow-up: COV-25 invoice handoff

The subsequent live COV-25 invoice action exposed one additional governed
configuration dependency: `sales:create-invoice-from-sale-order`. The same seed
owner now publishes this configuration through the same 0/1/duplicate gate.
The bounded helper is named `seed_operator_workflow_forms`.

Its nine exact UI fields are `journalId`, `defaultIncomeAccountId`,
`receivableAccountId` (required selects); `receivableLineName` (optional text);
`narration` (optional textarea); and `incomeExcludeFromInvoiceTab`, `incomeBlocked`,
`receivableExcludeFromInvoiceTab`, `receivableBlocked` (optional checkboxes with
defaults `false`, `false`, `true`, `false`). All are enabled system fields; relation
options remain empty for the current-company form owner to supply. No roles are
guessed. Bootstrap now yields 4 configurations, 31 fields, and 5 journal role rows.

Native field assertions cover exact IDs, types, required flags and defaults.
Bootstrap assertions cover the third publication and updated graph totals;
edit/deactivation preservation and duplicate rejection exercise the invoice form.
This follow-up is source-only: no compilation, build caches, publication, or
runtime mutations were performed by this worker. Integrated compilation and
operator acceptance remain the parent's verification lane.

## Follow-up: COV-25 vendor bill handoff

The live purchase handoff additionally requires
`purchasing:create-bill-from-purchase-order`. It is provisioned by the same
atomic publication and 0/1/duplicate rule. Exact fields: required selects
`journalId`, `defaultExpenseAccountId`, `payableAccountId`; required Date
`invoiceDate`; optional Text `payableLineName`; optional Textarea `narration`;
optional checkboxes `expenseExcludeFromInvoiceTab=false`, `expenseBlocked=false`,
`payableExcludeFromInvoiceTab=true`, `payableBlocked=false`.

The final bootstrap graph is **5 configurations / 41 fields / 5 journal roles**.
Native assertions cover bill IDs/types/required/defaults; bootstrap assertions
cover its publication, field graph, edit/deactivation preservation, replay, and
duplicate rejection. This follow-up changes source only, not runtime or caches.
The original nine-test failure classification below remains unchanged.

## Exact failing identities

The 2026-10-03 report counts nine blocked **tests**, not nine distinct forms.
The original `frontend/web/test-results/*/error-context.md` artifacts identify:

| Spec | Missing runtime configuration |
| --- | --- |
| `cov05-purchase-order-confirmation.spec.ts` | `purchasing:add-purchase-order-line` |
| `cov05b-purchase-receipt.spec.ts` | `purchasing:add-purchase-order-line` |
| `cov05c-vendor-bill.spec.ts` | `purchasing:add-purchase-order-line` |
| `cov21-approval-decision.spec.ts` | `purchasing:add-purchase-order-line` |
| `cov06-picking-lifecycle.spec.ts` | `sales:add-sale-order-line` |
| `cov06b-picking-backorder.spec.ts` | `sales:add-sale-order-line` |
| `cov06f-serial-tracked-picking.spec.ts` | `sales:add-sale-order-line` |
| `cov24-distributor-workspace.spec.ts` | `sales:add-sale-order-line` |
| `cov25-order-handoff-links.spec.ts` | `sales:add-sale-order-line` |

Each artifact says submission is disabled because no configuration exists for
the exact form key. The forms are absent from the registry defaults as well.

## Authority and effect

Before: `sales-client.tsx` / `purchasing-client.tsx` line-entry form →
`ModuleView` / `RuntimeFormModal` → `useRuntimeFormModalConfig` →
`useFormConfiguration` → organization-scoped form-config/field/role queries →
missing configuration → COV-D04 blocks submission.

After: existing `bootstrap_new_tenant(seed_form_configs=true)` or
permission-checked `seed_organization_form_configs` →
`run_seed_organization_form_configs` → `publish_form_configuration` →
canonical `form_config` and `form_config_field` rows + audit + organization
commit → unchanged query/runtime form path.

Identity: `(organization_id, module_id, form_id)`, cardinality 0..1.
Zero publishes once; one preserves all existing policy, edits, and deliberate
deactivation; multiple rejects provisioning. Result is the exact
`form_config.id`. Publication commit correlation is
`form:<module_id>/<form_id>:config:<id>`, operation
`erp.publish_form_configuration`. Field identities are configuration ID plus
the exact camel-case UI field ID. No tenant relation IDs or guessed roles are
seeded; live company-scoped select choices stay with the existing form owner.

The fixture script calls the same seed reducer after resolving its exact
organization. It does not intercept browser requests or drive the tested domain
transition directly.

## Verification

- `node --check frontend/web/scripts/seed-test-user.mjs`: passed.
- `git diff --check`: passed.
- Native unit test added for both complete field identity sets, required/system/
  enabled policy, and absence of seeded relation IDs.
- Existing `test_bootstrap_new_tenant_records_complete_commit` extended to
  verify both published configurations, tenant-owned fields, publication commits,
  replay without additional effects, preservation of operator changes and
  deactivation, and duplicate-identity rejection.
- `cargo test --manifest-path spacetimedb/Cargo.toml
  order_line_defaults_match_operator_field_identities --lib`: passed after
  integration in the primary workspace. Earlier isolated worker attempts timed
  out; centralized compilation also caught and repaired two unrelated new
  authorization-test snapshot errors before passing.
- `cargo test --manifest-path spacetimedb/Cargo.toml --lib`: all 145 native
  unit tests passed on the integrated source. This compiles the domain-test
  reducers but does not execute their transactional database assertions.
- `test_bootstrap_new_tenant_records_complete_commit`: runtime execution
  remains unproven; the added persistence/replay assertions require a live module.
- No runtime publish, reset, restart, or browser acceptance run was performed.

## Release / next bounded verification

No generated signature/schema was changed and no generated files were edited.
No new contract shape release is required by this repair. Deploy the updated
module through the normal release-compatible lane to an approved isolated
runtime; provisioning against the old binary does not contain this repair.

1. Complete native/build and pinned-contract compatibility checks.
2. Invoke existing `test_bootstrap_new_tenant_records_complete_commit` in the
   isolated runtime; this is setup/domain evidence, not operator acceptance.
3. Run the existing first-org persona seed script against that exact module.
4. Read back one active config per exact form identity, with 9 sales fields and
   5 purchasing fields. Rerun seed and prove IDs/versions/effects are unchanged.
5. Rerun the nine listed operator specs on the same exact application/module
   head, followed by the full requested acceptance set.

Permission-first and domain/SOD repairs remain separately owned prerequisites.
COV-D04 stays enabled. Existing deliberate deactivation is not silently repaired.
