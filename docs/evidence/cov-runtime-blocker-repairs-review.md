# COV runtime blocker repairs — integrated review

## Task / base SHA

**REVIEW — implementation integrated; live runtime acceptance unproven.**

Runtime follow-up: the clean browser lane now passes all 51 selected tests.
Overall readiness remains REVIEW because of a verified BOM projection naming
mismatch. See [the 2026-10-04 acceptance record](cov-runtime-browser-acceptance-2026-10-04.md).
The implementation-time verification limitations below are historical.

Base: `77e3e495af2265be07d36854f7c9740dab435056`. The repair is an
uncommitted working-tree change; no new immutable runtime revision is claimed.
Pinned contracts remain `v0.3.81`. The original 43-test failure report remains
historical evidence, not acceptance of these repairs.

## Files changed

Changes are bounded to session resolution, existing domain permission ordering,
two canonical form defaults and fixture provisioning, SoD/domain regressions,
Inventory/Manufacturing browser specs, and downstream record navigation/tests.
See the detailed form, scheduler/manufacturing, and COV25 evidence files alongside
this document.

## Before path

Browser bearer/cookie → frontend session resolver → API session resolver →
trusted generated operation → current domain permission → canonical effect.
Development mock resolution could replace the explicit browser actor with the
server owner. Several reducers also inspected state/company/record existence
before their existing permission checks.

Nine operator tests failed closed at runtime form resolution. They share only
two absent identities: `purchasing:add-purchase-order-line` and
`sales:add-sale-order-line`. Existing SoD reducers already rejected self-action;
their browser proofs lacked persisted-actor assertions.

## After path

- Explicit bearer/cookie credentials precede anonymous-only development mocks
  in both frontend and API resolvers. Invalid explicit authentication cannot
  downgrade to cookie/mock authority.
- Current permission precedes reconstruction fencing and identified business
  validation/replay branches. Authorized state failures retain their normal
  semantics; there is no blanket `422` → `403` remapping.
- Existing atomic form publication provisions the two defaults. Canonical seed
  replay preserves edits/deactivation and rejects duplicate configuration keys.
- SoD proofs assert actual persisted author/approver identities and unchanged
  effects, without weakening the production invariant.
- Dedicated browser specs cover scheduler schedule/cancel, finished-output
  scrap, BOM byproducts, and downstream record-link clicks.

## Canonical owners reused

Existing session/trusted context, generated named operations, domain
`check_permission`, form publication/bootstrap, canonical query resources,
application hooks, and `erp-shared/record-links.ts`. No sibling mutation,
permission, generated-contract, or routing authority was added.

## Effect identity + cardinality

- Forms: `(organization_id, module_id, form_id)`, 0..1.
- SoD: exact leave/timesheet/proposal PK; proposal → `sale_order_id`, 0..1.
- Scheduler: scoped rule → scheduled job, 0..1.
- Scrap: MO + captured UI request UUID → exact source-owned scrap move.
- Byproducts: BOM/product definition and MO-owned finished move identities.
- Navigation: exact PO receipt/bill, proposal order, and subscription
  billing-run invoice/reconciled-payment relations; all organization/company
  scoped. Duplicate identities fail closed. Omitted relation fields are
  unavailable, not evidence of an empty relationship.

## Resulting record ref

Existing exact configuration, job, move, leave, timesheet, proposal, order,
invoice, receipt, and payment IDs. Navigation uses canonical destination tabs
and `filter=id:N`. No live IDs were produced by centralized verification.

## Typed outcomes/errors

Invalid authentication: `401`. Current operation denial: canonical `403`.
Authorized invalid/state/SoD failures retain `422`. Read-only links distinguish
ready, unavailable, and invariant failure. Transport acknowledgement is not
relabeled as an applied domain effect.

## Tests run (command + result)

Centralized in the existing primary workspace, without per-agent build caches:

| Command | Result |
| --- | --- |
| `cargo test -p api-server --lib session::tests -- --nocapture` | 7 passed |
| `cargo test --manifest-path spacetimedb/Cargo.toml --lib` | 145 native unit tests passed |
| `pnpm --dir frontend/web test:unit` | 95 passed |
| `pnpm --dir frontend/web typecheck` | Passed after all implementation handoffs |
| Query-hooks `node --import tsx --test src/hooks/cross-record-links.test.ts src/hooks/order-to-cash.test.ts` | 19 passed |
| Playwright `--list` for SoD/legacy specs | 4 specs plus auth setup collected |
| Playwright `--list` for COV06n/COV07f/COV07g | 3 specs collected |
| Playwright `--list cov25-` | 4 specs collected |
| `pnpm --dir frontend operation-transport:check` | Passed |
| `make check-release-compatibility` | Passed |
| Tenant ownership validator | All 504 tables classified organization-owned |
| `git diff --check` | Passed |

Centralized domain compilation found and repaired two new test-only snapshot
errors: `UserProfile` lacks `Clone`, and audit rows lack `PartialEq`. The tests
now preserve the original profile via exact refetch and compare immutable audit
effect IDs. Production table derives were not changed.

`make check-codegen-pinned` exceeded its bounded timeout; its earlier stages
passed, and tenant ownership was subsequently verified separately. A complete
same-head release/build lane is still required.

## Operator proof

**UNRUN.** Spec collection and native tests are not live operator acceptance.
Native compilation includes domain-test reducers but does not execute their
transactional assertions. Trusted owner SQL in SoD specs is supplemental,
exact-ID, read-only actor evidence; primary transitions remain UI-driven.

## Compatibility/debt retired

Actor replacement, identified permission-ordering gaps, missing two-form
provisioning, missing named browser specs, and missing bounded downstream links
are repaired in source. No schema/reducer signature changed.

## Remaining blocker/deferral

- Existing host API `/ready` returned `503` for incompatible migration history
  and advertised release `0.3.43`, not the pinned `0.3.81`; no compatible web
  runtime was available. Shared services/databases were not reset or restarted.
- Approved isolated, compatible runtime; module/API/web deployment; domain
  reducers; focused browser lanes; then the complete affected suite are pending.
- Helpdesk has no ticket → business-record model/ID relation.
- Historical subscription invoices outside billing runs and unreconciled
  payments are not represented by the bounded link implementation.
- Scheduler timed firing/rescheduling and scheduler/scrap/byproduct resulting
  record navigation are not claimed.
- Malformed transport authorization would need producer-owned operation
  metadata; these repairs do not introduce a guessed permission registry.

## Contract release required: yes/no

**No** for the implemented repairs. **Yes** for a new Helpdesk related-record
identity; historical subscription projection expansion requires a governed
producer decision. Normal pinned release compatibility remains mandatory.

## Next bounded task

Run the repaired source against an approved isolated release-compatible runtime.
Prove exact form seed/readback/replay and actor provenance, run focused domain and
browser lanes with one worker, then run the complete affected acceptance suite
on one immutable revision. Retain REVIEW until that evidence exists.
