# Fresh-tenant production acceptance sub-agent plan

## Outcome and fixed decisions

Add one mandatory acceptance journey proving signup, bootstrap, company
foundation, import, lead-to-cash, procure-to-pay and accounting close without
tenant demo fixtures, test users, development reducers, mocked AI or fixed IDs.

The runtime may contain deterministic global reference data such as currencies
and country packs. It must contain no tenant master or transactional data before
signup. Desktop packaging will reuse this web onboarding flow; it will not add a
second bootstrap path.

## Current evidence and product gaps

- `bootstrap_new_tenant` creates organization, owner membership, company,
  settings and optional form configs, but no operational foundation:
  `spacetimedb/src/core/organization.rs:351`.
- Fresh initialization seeds only USD while onboarding advertises USD, EUR, GBP,
  CAD, AUD and JPY. Bootstrap rejects an absent currency:
  `spacetimedb/src/lib.rs:182`, `frontend/web/lib/onboarding-config.ts:20`, and
  `spacetimedb/src/core/organization.rs:375`.
- Bootstrap creates no UoM, CRM stages, pricelist, accounts, journals, fiscal
  periods, warehouse, stock location or stock.
- The current lead-to-cash test assumes seeded stages, product, UoM, pricelist,
  warehouse, journals and accounts:
  `frontend/web/tests/e2e/mvp-lead-to-cash.spec.ts:96-224`.
- Procure-to-pay assumes seeded `Globex Corp`, product, pricelist, UoM, journals
  and accounts; it stops at bill posting and does not prove AP payment:
  `frontend/web/tests/e2e/mvp-procure-to-pay.spec.ts:21-147`.
- An empty tenant cannot create its first warehouse because the UI requires a
  template warehouse: `frontend/packages/ui/src/lib/inventory-form-configs.ts:350`
  and `frontend/web/app/(modules)/inventory/inventory-client.tsx:3349`.
- Product import requires `currencyId`, while the wizard sends only `{csv}`:
  `api-server/src/routes/import.rs:465` and
  `frontend/web/lib/guided-import-wizard.tsx:293`.
- Fiscal setup divides a year into equal-duration slices instead of calendar
  months and opens only the first period:
  `spacetimedb/src/accounting/fiscal_periods.rs:885`.
- `close_account_period` does not reject draft moves in the period:
  `spacetimedb/src/accounting/fiscal_periods.rs:787`.
- Make/Playwright setup always depends on domain test reducers, `seed_dev_data`,
  `seed-test-user` and seeded authentication: `Makefile:300-375,718-721` and
  `frontend/web/playwright.config.ts:31-48`.

## Agent operating rules

1. Global reference data is deterministic and idempotent; tenant fixtures are
   forbidden in the fresh gate.
2. Company-foundation setup may create operational defaults but no demo parties,
   products, orders, balances or transactions.
3. The integration agent owns module exports, generated bindings, Playwright
   project wiring, Make targets and CI workflow edits.
4. Agents use typed reducer params, scope every created row, propagate `Result`
   errors and avoid production `unwrap`.
5. Agents do not commit independently or edit outside their owned files.

## Wave 1 - Independent product fixes

### Agent F1 - Reference currencies

**Owns:**

- `spacetimedb/src/core/reference.rs`
- currency migration additions in `spacetimedb/src/core/migrations.rs`
- currency initialization in `spacetimedb/src/lib.rs`
- focused core tests

Add every advertised currency through deterministic global initialization, or
derive onboarding choices from the authoritative catalog.

**Gate F1:** every currency displayed during onboarding can bootstrap on a newly
published database; retries create no duplicates.

### Agent F2 - Import and first-warehouse repair

**Owns:**

- `api-server/src/routes/import.rs`
- `frontend/web/lib/guided-import-wizard.tsx`
- `frontend/web/lib/warehouse-create-params.ts`
- first-warehouse logic in inventory UI/config files
- focused route/UI tests

Derive omitted import currency from the authenticated effective company. Never
trust browser organization scope. Add a deterministic CSV-header mapping path so
onboarding does not depend on AI. Preserve import jobs, counts and row errors.
Allow creation of a first warehouse without an existing template.

**Gate F2:** product and party imports work with AI unavailable; cross-company
import fails; the first warehouse can be created on an empty company.

### Agent F3 - Fiscal periods and close integrity

**Owns:**

- `spacetimedb/src/accounting/fiscal_periods.rs`
- `spacetimedb/tests/accounting/period_lock_test.rs`
- accounting close error handling in the accounting client/hooks

Generate real calendar-month boundaries, open the period covering the configured
operational date, reject close while draft moves exist, preserve posting denial
for closed/unavailable periods, and surface close errors to the user.

**Gate F3:** a clean period closes; draft-containing periods do not; every
posting path rejects a closed date.

## Wave 2 - Company foundation

### Agent F4 - Idempotent production setup

**Depends on:** F1 and the fiscal contract from F3.

**Owns:**

- new `spacetimedb/src/core/company_setup.rs`
- focused company-foundation tests
- narrowly required domain helper changes

Add a permission-checked `setup_company_foundation` reducer with typed company,
country/accounting-pack, fiscal-date and starter-warehouse inputs. In one
transaction create only:

- a UoM category and reference unit;
- qualification/proposal/won/lost CRM stages;
- a default pricelist;
- internal stock location and first warehouse;
- minimal AR, AP, income, expense, inventory and bank accounts/account types;
- sales, purchase, bank and general journals;
- fiscal year with calendar periods and the operational period open;
- enabled country pack and applicable tax defaults.

**Gate F4:** success on an empty company, idempotent retry, no duplicate defaults,
correct scope/audit, unauthorized/cross-company denial, and exactly one period
covering the operational date.

### Agent F5 - Resumable onboarding configuration

**Depends on:** frozen F4 reducer shape.

**Owns:**

- `frontend/web/app/(auth)/onboarding/page.tsx` or a new onboarding step
- organization/company query hooks used by this step
- focused frontend tests

Invoke company foundation through production routing, show success and errors,
and resume safely after refresh or an idempotent retry.

**Gate F5:** a newly signed-up owner completes company configuration entirely
through the UI and reaches a transaction-ready company.

## Wave 3 - One stateful acceptance journey

### Agent F6 - Parameterized workflows

**Owns:**

- new `frontend/web/tests/e2e/workflows/bootstrap.ts`
- new `frontend/web/tests/e2e/workflows/lead-to-cash.ts`
- new `frontend/web/tests/e2e/workflows/procure-to-pay.ts`
- new `frontend/web/tests/e2e/workflows/close.ts`
- reusable additions in `frontend/web/tests/e2e/helpers.ts`

Extract parameterized helpers from the existing golden paths. They accept IDs
and names created during this run and never search for seeded names.

**Gate F6:** existing seeded specs retain behavior where still used; new helpers
have no fixed tenant/master IDs or demo names.

### Agent F7 - Fresh tenant journey

**Depends on:** F2-F6.

**Owns:** new `frontend/web/tests/e2e/fresh-tenant-journey.spec.ts`.

Use one stateful Playwright test with `test.step`:

1. Sign up through the production UI.
2. Bootstrap tenant and complete company foundation through the UI.
3. Prove the tenant contained no master/transactional fixtures before setup.
4. Import customer and supplier CSV through the production wizard and assert a
   completed import job with zero row errors.
5. Import or create a product and opening stock through normal product paths.
6. Complete lead -> opportunity -> order -> delivery -> invoice -> customer
   payment.
7. Complete PO -> receipt -> matched bill -> AP payment.
8. Assert stock effects, balanced move lines, residuals and audit history.
9. Close the operational period through the UI.
10. Attempt a posting into the closed period and assert server rejection.

**Gate F7:** no seed-only name, fixed internal ID, mocked AI, generic import
reducer or development reducer appears in the test.

## Wave 4 - Hermetic release gate

### Integration agent - Fresh Playwright project and CI

**Owns:**

- `Makefile`
- `frontend/web/playwright.config.ts`
- `.github/workflows/e2e-smoke.yml`
- `frontend/web/tests/e2e/README.md`
- `docs/MVP_WORKFLOW_CONTRACT.md`
- generated bindings/registries required by F4

Add a `fresh-tenant` Playwright project with empty storage, one worker and no
dependency on `auth.setup.ts`. Add `make e2e-fresh-tenant` that always clears and
publishes the module, sets `LUMIERE_ENABLE_DEV_REDUCERS=0`, uses strict reducer
routing, never invokes domain test reducers or seed scripts, starts only required
services, and performs an empty-tenant preflight before signup. Make it a
mandatory CI job and upload all browser/service/database logs on failure.

## Definition of done

`make e2e-fresh-tenant` passes twice from independently cleared databases with
strict production routing. It proves both complete financial workflows,
imports, AP/AR payments, stock/ledger/audit effects, safe close and closed-period
rejection without any tenant seed or test reducer.
