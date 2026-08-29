# Phase 2 — P0 release-gate recovery

**Status:** Scoped — 2026-08-29  
**Depends on:** immutable `lumiere-contracts` v0.3.4 integration  
**Release authority:** [v0.1 production readiness plan](./v0.1-production-readiness-plan.md)  
**Previous slice:** [IR-owned operation descriptors](./ir-api-sdk-operation-foundation-continuation.md)

## 1. Outcome

Restore a clean, repeatable P0 browser gate on the tag-backed application
commit before starting generated wire codecs or typed API dispatch. Keep each
repair at the narrowest proven boundary and retain persisted-data assertions;
do not weaken the workflows into page-only smoke tests.

## 2. Current evidence

Application CI run `33258047054` is green after one transient Frontend runner
heap retry. Contracts drift, codegen, Rust, Frontend, Playwright compile smoke,
and PDF regression all passed against `lumiere-contracts` v0.3.4.

P0 run `33258046996` completed with 56 passed, 4 skipped, and 4 failed:

| Track | Failure boundary | Current evidence |
|---|---|---|
| Lead-to-cash | numeric Radix option lookup | The persisted partner ID exists in contacts and the invoice. The helper looked for the ID on the visible option even though Radix stores it in an adjacent hidden native `select`. |
| Helpdesk | assignee option lookup by label | `chooseSelectOptionByLabel` found no matching visible option. Data availability, label mapping, and refresh timing are not yet distinguished. |
| HR | created payslip not visible | The reducer/query returned a non-empty payslip name, but the expected row was not visible. Persistence, query projection, invalidation, and active-tab filtering are not yet distinguished. |
| Purchasing | created landed cost not found by description | The UI creation step completed, but the polling query did not return the distinctive description. Mutation result, read resource, projection, and company filtering are not yet distinguished. |

The lead-to-cash selector repair has a focused helper regression. Its targeted
integration run now passes partner, currency, and journal selection and reaches
`POST /api/call/create_payment`. That request contains the selected IDs but
fails because the form sends `date: None` while the reducer requires a payment
date. This is the next lead-to-cash contract boundary.

## 3. Workstreams

### A. Close lead-to-cash form contracts

1. Land the hidden-native-select value resolver and its focused Playwright
   regression.
2. Trace the `new-account-payment` form definition through create-parameter
   encoding to `create_payment`.
3. Add an explicit required payment-date field or a documented server-owned
   date policy. Do not silently invent the current date in a generic encoder.
4. Add a focused create-payment form test that asserts the outgoing request has
   partner, amount, currency, journal, and date, then rerun the complete
   lead-to-cash spec.

Exit: lead-to-cash passes on both preserved data and `E2E_CLEAR_DB=1`.

### B. Diagnose and repair the three remaining P0 failures

For each track, capture the mutation response and the first authoritative read
before changing code:

1. **Helpdesk:** prove whether the intended assignee is absent from source data,
   removed by option mapping, stale after invalidation, or only mismatched by
   accessible label. Fix the first broken boundary and add a focused selector
   assertion.
2. **HR:** prove the created payslip ID/name in persisted data, then compare the
   query response and active table filters. Repair invalidation/projection/UI
   filtering only where evidence points and assert the row by stable ID.
3. **Purchasing:** capture the landed-cost creation response, persisted ID, and
   query payload. Repair mutation wiring, projection, invalidation, or scope
   filtering at the first divergence and assert the resulting state by ID.

Exit: each formerly failing spec passes twice independently with its distinctive
created record reloaded from the authoritative query path.

### C. Make the gate repeatable

1. Run the four repaired specs with the hash-gated fast path while iterating.
2. Run one clean `E2E_CLEAR_DB=1` full P0 suite after all focused checks pass.
3. Rerun the tag-backed CI and P0 workflows on the final commit.
4. Preserve Playwright traces and service/database logs for any failure.
5. Treat the existing ESLint 9 missing-flat-config failure and Frontend Node heap
   pressure as release-baseline tooling work; do not hide either with skipped
   jobs or broad exclusions.

Exit: one fresh checkout has green deterministic CI and green full P0 with no
required skipped job. Only then may the application PR advance readiness.

## 4. PR sequence

1. **P0 helper repair:** hidden native select resolver plus focused regression.
2. **Lead-to-cash form contract:** explicit payment-date wiring and request test.
3. **Independent domain repairs:** helpdesk, HR, and purchasing as separate
   reviewable commits or PRs when their root causes do not share a boundary.
4. **Release-gate proof:** clean full P0 evidence and PR-description/readiness
   update; no feature work in this step.

## 5. Non-goals

- changing the v0.3.4 contracts artifact or tag;
- adding generated codecs or changing API dispatch before P0 is green;
- broad selector-component rewrites when a test helper owns the defect;
- weakening persisted-data, tenant, company, audit, or accounting assertions;
- treating retries as proof for deterministic test failures;
- inventing unresolved business defaults such as payment dates.

## 6. Definition of done

- all four failures have an evidence-backed root cause and focused regression;
- lead-to-cash includes an explicit valid payment date and completes payment
  registration;
- helpdesk, HR, and purchasing reload the distinctive persisted entity through
  the production query path;
- one clean-database full P0 run is green;
- tag-backed CI is green on the same application commit;
- both PR descriptions contain the final evidence and remain unmerged until all
  required checks pass.

After this gate, the next contracts milestone may start generated wire codecs
and a typed API operation endpoint on the v0.3.4 descriptor highway.
