# AA-02 first-task activation slice

Baseline: `3d6f32c23ba4a569f83d752ac0b2257e43799397` (main refreshed on
2026-10-30). This is a partial AA-02 implementation, not Alpha acceptance.

Overview now offers role-permitted first tasks after tenant creation. It reads
the existing company and contact queries, matches exact organization/company
identities, and distinguishes saved settings, missing setup, loading and
unverifiable reads. Masked fields and failed reads cannot establish readiness.
Contact availability and customer classification are separate: the existing
New contact form does not expose the customer classification field.

Task selection stays in the Overview URL across reload and browser return.
Actions open the current CRM, Sales, Expenses, Accounting or Reports workspace.
The existing forms own required fields, permissions, setup, review, save and
business outcomes. Accounting retains its existing setup-readiness evaluator.
The checklist performs no writes and requires no AI provider.

## Executed validation

- Eleven focused model cases: exact large identities, company and organization
  separation, masked fields, failed reads with retained data, empty reads,
  customer classification, current task permissions and existing route targets.
- Full web unit command: 138 files passed, including the new registered file.
- Web TypeScript; changed-file lint using the existing UI ESLint configuration;
  i18n, type-debt, browser operation transport, vendored contracts, ERP skill
  catalog, finance manifests and whitespace checks passed.
- Four focused Chromium cases at 320, 390, 768 and 1440 pixels, using the actual
  component and query hooks with intercepted synthetic reads. They exercise
  keyboard task selection, URL/reload restoration, company switching, absent
  company, permission unavailability, denied refresh and zero page overflow.

Reproduce the browser fixture from `frontend/web`:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  node node_modules/@playwright/test/cli.js test \
  --config playwright.activation-ui.config.ts
```

The screenshots below show the **synthetic UI fixture**, including an
unverifiable customer check after an intentionally denied refresh. They do not
prove authentication, provisioning, persisted business effects or provider use.

[320px screenshot](activation-320.png) · [1440px screenshot](activation-1440.png)

## Acceptance remaining after the original slice

Keep AA-02 partial until a fresh authenticated organization completes setup,
opens a canonical form, saves a meaningful record and returns to refreshed
readback. Full prerequisite discovery for Sales/Expenses/Reports, organization
timezone checks, direct saved-record continuation, sample-data provenance and
supported-language operator acceptance remain open. Current source does not
provide a trusted per-record demo marker, so existing records are never claimed
to prove completion of real business work. No deployment is included.

The original slice changed no contracts or migrations and used pin `0.3.157`.
Reverting the Overview import/render removes this discovery surface without
altering normal ERP operations. PRs #309, #312 and #313 retain their ownership;
integration must retain their guide and translation changes.

## Main integration on 2026-10-30

Merged main `51dc54867ba66703518c4edbc0964391da0d8a63` into this branch at
`96417ae9247da2c0728d6b1f5d97c2c51dd7dd05`. Main now includes the contextual
guides from #309, their released `0.3.158` contracts, and #324's release-source
readback fix. This branch retains those changes without generated-output edits.
The only package-script difference from main remains the activation model test;
both separate guide test scripts are retained unchanged. The English catalog is
unchanged from main apart from the additive activation namespace.

Frozen offline installation, eleven activation model cases, both guide helper
test files, i18n, type-debt, immutable browser transport, three-consumer vendored
`0.3.158` verification, ERP catalog and finance manifest checks pass after the
merge. The screenshots above retain the original implementation's synthetic
scope; they are not authenticated ERP acceptance.

Web TypeScript and the same four focused viewport cases also pass on the
integrated source (42.5 seconds for the browser run). The coordinator's separate
disposable first-contact acceptance evidence is linked from PR #322 and owned
by AA-08; it must not be confused with this component fixture or production-image
acceptance at the new contracts pin.
