# Authenticated first-contact acceptance

Executed 2026-10-30 on `codex/alpha-ai-integration-review` at
`92ea7c3fd2e4e0d493d932e173c1c2d97086a915`. This combines #318, #319, #321
(including timeout handling) and #322 with main `8fee8fd507f948e75be99fb27d0b2344cab6db78`.
The test-only AA-08 PR #323 (`b2291da2bbfe33c737191c52ee1cfc3b9d8961bb`) is
stacked against this testing branch. No feature PR was merged and no production
deployment was performed by this program.

The independent QA test uses an actual authenticated disposable stack:
SpacetimeDB 2.8.2, PostgreSQL 16, the source-built API and Next development web.
Immutable contracts remain 0.3.157. [Non-secret stack provenance](disposable-stack.json)
records the validated development module hash, migration checks and restart result.
Runtime credentials and encryption/signing keys are not included.

## Passed bounded journey

The focused `alpha-assisted-activation.spec.ts` passed one test in 37.3 seconds.
Persisted organization **4098**, company **4098**, contact **4097** were also
independently confirmed by a bounded read-only lookup of the unique synthetic
marker with exactly-one enforcement, no ordering/newest-row discovery and no writes.

The test performs these steps:

1. Provision only an organization-less test authentication account; no business
   records are seeded into its new organization.
2. Sign in and complete normal onboarding with explicit currency, timezone and
   fiscal year-end choices. Read back saved company/fiscal-year state and the
   exact referenced persisted USD currency row.
3. Observe an empty current-organization contact set and the company-scoped
   Overview checklist's missing contact state.
4. Follow Add a contact into the existing CRM form, enter a unique name/email,
   and save through the normal canonical operation.
5. Read back exactly one new contact with the expected organization/company,
   exact saved identity and entered fields. Return to Overview and reload;
   the checklist and exact record remain current.
6. Assert exactly one contact-create request and zero `/api/ai/` requests.

[Authenticated screenshot](authenticated-first-contact.png) shows the saved-contact
availability after reload. This is a real disposable-stack screenshot, distinct
from #322's synthetic responsive component screenshots. The existing
retain-on-failure trace policy discarded the successful trace; no pass trace is
claimed.

The initial attempt completed onboarding but used a nonexistent currency query
route in an added test assertion. It failed before any contact create or AI
request. The assertion was corrected to the existing canonical currency owner
(`/api/bootstrap/currencies`); no product assertion or authorization check was
weakened. The passing run used a fresh account and organization.

## Limits

This accepts only the new-organization → deterministic first-contact journey in
this disposable, development web stack. It does not certify all of AA-02/08,
ordinary-member permissions, actual AI conversation or handoff, financial
operations, uncertain effects, saved guides, service restart after contact creation,
production images/deployment, or supported-language operator acceptance.

The isolated database restart recovered baseline module/fixture state before
this test; it does not establish contact-save interruption/restart acceptance.
Synthetic component tests separately cover 320/390/768/1440px and keyboard,
company-switch and denied-read behavior. No AI provider/gateway was running, and
no provider use, spend or candidate skill activation is implied.
