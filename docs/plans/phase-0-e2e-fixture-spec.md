# Phase 0 E2E Fixture Specification

## Scope

Define deterministic data fixtures and scenario contracts for Phase 1 and later
ERP work. These fixtures extend the current Playwright conventions under
`frontend/web/tests/e2e/`; they do not add test code yet.

## Current Codebase References

- E2E harness: `frontend/web/tests/e2e/README.md`, `helpers.ts`, `auth.setup.ts`,
  and `frontend/web/scripts/e2e-seed-fixture.mjs`.
- Existing workflow coverage: `mvp-lead-to-cash.spec.ts`,
  `mvp-procure-to-pay.spec.ts`, `accounting-mutations.spec.ts`,
  `crm-duplicate-merge.spec.ts`, `import-rollback.spec.ts`, and
  `mvp-ai-action-draft.spec.ts`.
- Import/rollback record behavior: `spacetimedb/src/data_ops/import_tracker.rs`
  and `docs/IMPORT_ROLLBACK.md`.

## Fixture Rules

1. Each E2E starts from an isolated organization fixture and uses explicit IDs
   or unique suffixes. No scenario depends on seed ordering or another spec.
2. Every finance scenario uses two companies in the same organization and one
   second organization. It must demonstrate both legitimate same-org company
   isolation and hard cross-tenant denial.
3. Fixture data is declarative and canonical. Browser setup may create only the
   records essential to the user workflow; direct setup must still invoke typed
   reducers or a documented seed route, never raw table mutation.
4. Expected money values are integers in minor units in fixture source and are
   converted only at typed UI/API boundaries. This avoids floating-point fixture
   ambiguity even while existing domain fields are `f64`.
5. Fixture phones use reserved test-number ranges, never a real person. Message
   bodies and provider references are synthetic and carry no secrets.

## Baseline Fixture

### Organization and Authorization

| Key | Value | Purpose |
| --- | --- | --- |
| `org_alpha` | primary test organization | normal Phase 1 workflow |
| `company_alpha_main` | first operating company in `org_alpha` | owner of customer sales/payments |
| `company_alpha_branch` | second company in `org_alpha` | company-scope denial/control |
| `org_beta` | separate organization | tenant-isolation denial |
| `owner_alpha` | report/payment/message approver | approval positive path |
| `operator_alpha` | cashier/sales operator | draft/copy action path |
| `finance_alpha` | finance role | posting/reconciliation path |
| `viewer_alpha` | restricted field/report user | masking/permission path |

Roles must be created through the existing organization/settings permission
surface. The fixture records the exact resource/action grants it needs rather
than relying on a broad administrator role for every actor.

### Contacts and Phones

| Key | Contact roles | Phone identities | Required state |
| --- | --- | --- | --- |
| `customer_amina` | customer | primary `+15550101001`, WhatsApp `+15550101001`, momo `+15550101002` | credit eligible, consented |
| `customer_amina_duplicate` | customer | primary formatted variation of `+15550101001` | duplicate candidate |
| `supplier_bako` | supplier | primary `+15550102001`, momo `+15550102002` | active |
| `farmer_chidi` | farmer/member + supplier | primary `+15550103001` | active |
| `contact_opted_out` | customer | primary `+15550104001` | messaging opted out |
| `contact_no_phone` | customer | none | excluded from external messaging |

The migration fixture includes one legacy Contact with only `phone` and one with
only `mobile`; after backfill, both remain searchable and duplicate detection
uses the same normalized identity.

### Products, Stock, Sales, and Purchases

| Key | Initial condition | Intended assertion |
| --- | --- | --- |
| `rice_25kg` | on hand 20, reorder point 10 | sale/delivery causes low-stock alert |
| `soap_case` | on hand 50 | normal sales-by-product line |
| `spare_part_a` | on hand 1 | workshop/service future-pack fixture |
| `purchase_bako_001` | approved receipt/bill for rice | supplier payable and stock arrival |
| `sale_amina_001` | posted invoice for 10,000 minor units | partial customer receipt |
| `sale_amina_002` | posted invoice for 5,000 minor units | second allocation target |

Amounts, tax, currencies, and product costs must be chosen after the first
market accounting decision. The fixture's expected values are stored alongside
the scenario as a calculation table, not inferred in test assertions.

### Payments and Reconciliation

| Key | Value | Purpose |
| --- | --- | --- |
| `wallet_mtn_main` | MTN account mapped to company journal | incoming receipt and duplicate scope |
| `cash_main` | cash account mapped to company journal | cash close/report |
| `bank_main` | bank account mapped to company journal | statement import/control |
| `txn_mtn_001` | reference `TEST-MTN-0001`, settle 12,000 | allocate 10,000 + 2,000 across invoices |
| `txn_mtn_duplicate` | same account/reference as `txn_mtn_001` | duplicate rejection |
| `txn_supplier_001` | supplier payment with defined fee | AP, fee, reversal path |
| `statement_batch_001` | CSV fixture with valid/invalid/duplicate rows | staging/idempotency path |

No fixture encodes a real provider message or secret. Provider-specific parsing
uses versioned sample files with a `format_version` and expected normalization
result.

## Scenario Matrix

| ID | Scenario | Required assertions | Target E2E spec |
| --- | --- | --- | --- |
| `P1-CONTACT-01` | phone-first customer/supplier creation | normalized duplicate warning, roles, masked display, company isolation | `phone-first-contacts.spec.ts` |
| `P1-PAY-01` | incoming mobile-money partial payment | posted journal link, two allocations, correct residual/balance/audit | `mobile-money-payments.spec.ts` |
| `P1-PAY-02` | duplicate reference | rejected before post; same reference is permitted only in approved distinct scope | `mobile-money-payments.spec.ts` |
| `P1-PAY-03` | supplier payment fee and reversal | fee lines, compensating correction, independent approver, immutable original | `mobile-money-payments.spec.ts` |
| `P1-MSG-01` | invoice reminder copy | rendered approved template, masked recipient, copy state, timeline, audit | `operational-messaging.spec.ts` |
| `P1-MSG-02` | bulk reminder approval | opt-out/no-phone exclusion, preview, independent approval, cancellation | `operational-messaging.spec.ts` |
| `P2-REPORT-01` | daily owner reports | deterministic totals, PDF document, audit, company isolation | `owner-reports.spec.ts` |
| `P3-AI-01` | green report skill | scope/masking/resource caps/run audit | `ai-harness-policy.spec.ts` |
| `P4-AI-01` | red action draft | policy denial without approval; correction after independent approval | `ai-harness-policy.spec.ts` |
| `P5-DIST-01` | distributor workflow | sale, stock, partial momo receipt, owner report, low-stock draft | `vertical-distributor.spec.ts` |

## Fixture Lifecycle

1. Build a versioned fixture manifest with `fixture_version`, country/currency
   policy version, report schema version, and skill policy version.
2. Seed baseline records through the established test seed mechanism.
3. Assert seed health through scoped query resources before browser actions.
4. Each test creates its own mutable records or uses scenario-suffixed clones.
5. Capture screenshot, visible audit correlation, and record IDs only on failure
   or explicit diagnostic mode; redact phones/references in test logs.
6. Teardown removes the entire isolated organization/database according to the
   existing E2E clear-db convention. Do not use import rollback as generic test
   cleanup.

## Milestones and Acceptance Criteria

- The fixture manifest has approved country/currency/provider policy values and
  expected accounting calculations.
- Every Phase 1 reducer has a happy-path, validation, permission, audit, and
  company-isolation fixture before its UI workflow is merged.
- Reports and skill outputs are asserted against typed expected DTOs, not only
  screenshots or natural-language summaries.
- All new specs run independently of the production seed and of other E2Es.

## Security and Privacy Considerations

Fixtures contain only synthetic identities and provider references. Test logs,
screenshots, and AI artifact snapshots use masked values by default. Test service
actors receive the smallest permissions required by their scenario; a broad
administrator fixture cannot validate enforcement.

## Open Questions

1. Which country/currency/tax fixtures represent the first production pilot?
2. Which provider statement/SMS sample formats can be retained in source control?
3. What approval roles and separation-of-duties rules should the fixture enforce
   for a small business with only one owner available?
