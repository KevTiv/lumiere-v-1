# Record sheet handoff navigation repair

Task / base SHA

Merge-readiness source repair on `fe77fd049c35e6ba24a6387b1f5ac78d23c16a55`.
The failing lead-to-cash operator case remains required in CI.

Files changed

`frontend/packages/ui/src/pages/module-view.tsx` and its mounted navigation tests.

Before path

A Sales row click invokes ModuleView's configured record sheet and then the
Sales callback, which opens the legacy chatter dialog. CI run 41249078884,
job 124679389524 failed on the first order-to-payment link click at
`cov25-link-navigation.ts:38`, called from `mvp-lead-to-cash.spec.ts:455`.
Both initial attempt and retry stayed on the source Sales URL. The exact link
href assertion passed. The failure artifact shows both the legacy chatter
and configured order sheet open together. Target RSC requests returned 200.

After path

ModuleView opens the configured record sheet, or invokes the fallback callback
when the tab has no configured sheet. It retains AI selection reporting in both
paths. Discussion remains available through the configured sheet's Discussion
tab. One row click no longer opens two competing modal roots.

Canonical owners reused

ModuleView, EntityRecordSheet and existing order-to-payment record links.
Callback consumers were checked: Sales/Purchasing/Accounting duplicates open
chatter; Inventory's serial/lot callbacks target tabs without configured sheets.
The other specialized module dialog callbacks have no configured sheet target.

Effect identity + cardinality

Existing exact source record and payment link identity are unchanged. One
configured record sheet opens for a row; no legacy callback is invoked as well.
Tabs without a sheet still invoke their callback once with the exact row.

Resulting record ref

No record was created or changed by this packet.

Typed outcomes/errors

No transport, scope, reducer, response contract or error mapping changes.

Tests run (command + result)

The new mounted sheet-precedence regression failed on the original code because
the legacy callback was invoked once. After the fix:

`vitest run src/pages/module-view-navigation.test.tsx src/pages/module-view-create-gate.test.tsx src/entity-views/entity-record-sheet.test.tsx --config vitest.config.ts`

passed all 34 tests: navigation 7, create gates 23, record sheet 4.
`python3 scripts/finance-skill-manifests.py --check` and `git diff --check` passed.
Existing installed dependencies were reused; no dependency install or broad
build was needed.

Operator proof

CI failure artifact 13060907986 supplied the two-dialog snapshot and exact link
trace. The full lead-to-cash case was not run locally: there is no local E2E
backend listening. The unchanged exact-record URL, row, reload and Back assertions
must pass on the updated CI revision. No larger timeout or assertion weakening
is included. The source regression proves presentation ownership; it does not
by itself certify full hosted navigation.

Compatibility/debt retired

Configured sheets take precedence over fallback dialog openers. Existing
no-sheet callbacks retain their behavior. The stale duplicate chatter path is
removed for configured record sheets.

Remaining blocker/deferral

Run the exact lead-to-cash E2E case against the updated revision, then obtain
required current-head merge checks. No production acceptance is claimed.

Contract release required: yes/no

No. No contract, native schema, migration, manifest hash or deployment changes.

Next bounded task

Integrate this commit into the owning PR and verify the exact failed operator
case before merging.
