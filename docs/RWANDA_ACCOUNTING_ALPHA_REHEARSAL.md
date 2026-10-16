# Rwanda accounting alpha rehearsal

This rehearsal is the release gate for the first Rwanda accounting power user. It uses an isolated tenant and keeps exact JSON evidence in the Playwright report for each checkpoint. It makes separate operational-alpha and statutory-use decisions; an operational pass does not authorize Rwanda statutory invoicing or filing.

## Prerequisites

- The company legal-address country is `RW` and its base currency is `RWF`.
- The tenant contains active sales, purchase, and general journals; receivable, payable, income, expense, and asset accounts; a fiscal year; and an open period.
- At least one active customer and vendor exist.
- Choose one customer and one vendor for the rehearsal and record their numeric partner IDs. The test uses these exact partners; it never relies on query ordering.
- The current web, API, contracts, and SpacetimeDB module are deployed together.
- Use an isolated rehearsal tenant. The run creates draft documents, an account with an opening balance, import jobs, and a historical journal.

The Rwanda country pack is currently allowed to remain `review_required` for an operational alpha rehearsal in residual-only migration mode. Statutory certification must use `E2E_RWANDA_REQUIRE_ACCEPTED_PACK=1`; that makes the run fail unless legal/tax review has changed the pack to `accepted` and enabled it for the company. The evidence validator also requires a separate RRA VSDC certification record before `statutoryUse` can be `pass`.

## Configure the run

### Prepare an isolated tenant

For a new isolated Railway deployment, copy [`accounting/rwanda-alpha/setup.env.example`](accounting/rwanda-alpha/setup.env.example) into the private one-shot job and inject its three secret values from Railway references. Then run:

```bash
node scripts/setup-rwanda-accounting-alpha.mjs
```

The setup refuses public endpoints, a database containing another organization, multiple organizations, a non-RWF company currency, conflicting deterministic fixture rows, privileged persona profiles, and roles containing `*:*`. It is safe to rerun against the same otherwise-isolated target: it reads back every exact organization, company, account, journal, fiscal period, synthetic partner, role, membership, and role assignment before creating a missing row. It uses the organization owner session for tenant mutations and the database owner token only for bounded verification reads and credential binding. It never prints passwords, bearer tokens, identities, source data, or customer data.

On success it prints the safe `E2E_RWANDA_*` identifiers for the existing rehearsal env: tenant reference, company ID, operator email, and the two synthetic partner IDs. It also prepares an open fiscal year and period containing the configured cutover date; active RWF sales, purchase, general, and bank journals; receivable, payable, income, expense, and liquidity accounts; and separate alpha-power-user, bookkeeper, and read-only identities. The read-only address defaults to `fixture.reader@example.test`, which the two companion reconciliation specs require.

The generated contacts are synthetic rehearsal fixtures. Replace neither name with a real customer or supplier, and keep real migration source data in the restricted evidence workflow.

Copy [`accounting/rwanda-alpha/rehearsal.env.example`](accounting/rwanda-alpha/rehearsal.env.example) outside the repository, fill every value, then load it into the shell. The rehearsal requires a full Git commit SHA, deployed contract and module versions, tenant/company identity, named operator, cutover date, the exact customer and vendor partner IDs, migration mode, and an explicit isolated-tenant acknowledgement. The cutover date must be inside an open accounting period and is used for every historical journal, invoice, bill, control total, and evidence reference. Do not put passwords, access tokens, customer names, TINs, or source ledgers in the env file.

Choose one migration mode:

- `residual_only` imports each outstanding document at its cutover residual. Checkpoint 8 is not applicable because earlier payments are not replayed.
- `original_total_with_payment_replay` imports original face values and must execute checkpoint 8 through the historical-payment BFF operation. It fails if checkpoint 8 is skipped.

For `original_total_with_payment_replay`, prepare the two payment transactions in **Accounting → Payment Operations** before starting the test:

1. Use the configured customer partner for an inbound customer receipt and the configured vendor partner for an outbound supplier payment.
2. Use company currency `RWF`, settlement amounts of `200000` for each transaction, and an occurred-at date no later than the cutover date.
3. Set source record type exactly to `historical_accounting_import` and source record ID to a positive operator-assigned batch reference. This number is a grouping marker, not a verified foreign key to a durable migration-run record; record its meaning in the restricted evidence notes.
4. Post each transaction. Confirm Payment Operations shows `Posted`, the internal transaction ID, and the operator batch reference. Posting must have created a paid ledger payment and a posted payment move whose open residual is the full settlement amount.
5. Do not allocate either transaction. Put their internal IDs in `E2E_RWANDA_CUSTOMER_PAYMENT_TRANSACTION_ID` and `E2E_RWANDA_SUPPLIER_PAYMENT_TRANSACTION_ID`.

The replay preflight checks company, configured partner, customer/supplier direction, RWF currency, source marker fields, positive operator batch reference, occurrence date, posted ledger state, exact settlement amount, and absence of earlier allocations before it creates documents.

Create a restricted evidence directory for the run. After checkpoint 1 produces `00-rwanda-rehearsal-context.json`, initialize the bundle from that exact attachment:

```bash
make prepare-rwanda-alpha-evidence \
  RWANDA_ALPHA_CONTEXT=/secure/path/00-rwanda-rehearsal-context.json \
  RWANDA_ALPHA_BUNDLE=/secure/path/rwanda-alpha-run
```

The initializer copies the run identity from the attachment, configures checkpoint 8 for the selected migration mode, creates `control-totals.csv` at the declared cutover date, and assigns stable paths to the remaining evidence. It refuses to replace an existing manifest. Copy each named artifact into the bundle, update its result and review fields, and calculate its digest. The checked-in [`evidence-manifest.template.json`](accounting/rwanda-alpha/evidence-manifest.template.json) and [`control-totals.template.csv`](accounting/rwanda-alpha/control-totals.template.csv) remain available for manual setup.

Evidence paths in the manifest are relative to the manifest and must remain inside that evidence bundle. Every evidence reference must have a matching `sha256:<64 lowercase hex>` digest and repeat the run ID, release commit, and cutover date from the manifest. The validator reads and hashes each referenced file and rejects a mismatched binding.

## Run

From the repository root, against an already-running isolated stack:

```bash
set -a
. /secure/path/rwanda-alpha-rehearsal.env
set +a

# Load credentials from a secret manager, or enter the password without echo.
export E2E_TEST_EMAIL=operator@example.com
read -rsp "Rehearsal operator password: " E2E_TEST_PASSWORD && echo
export E2E_TEST_PASSWORD

make e2e-single-remote E2E_SPEC=rwanda-accounting-alpha-rehearsal.spec.ts E2E_GREP=
```

Do not add `E2E_TEST_PASSWORD`, session cookies, or service tokens to the rehearsal env file or evidence bundle. Clear the password after the run with `unset E2E_TEST_PASSWORD`. The remote target preserves `PLAYWRIGHT_BASE_URL` and the caller's environment; it does not source local dotenv files, rebuild, seed, or perform localhost health checks.

For the final statutory gate:

```bash
E2E_RWANDA_ALPHA_REHEARSAL=1 \
E2E_RWANDA_REQUIRE_ACCEPTED_PACK=1 \
  make e2e-single-remote E2E_SPEC=rwanda-accounting-alpha-rehearsal.spec.ts E2E_GREP=
```

Run the existing posted-payment reconciliation certification beside it:

```bash
make e2e-single-remote E2E_SPEC=accounting-post-reconcile.spec.ts E2E_GREP=
make e2e-single-remote E2E_SPEC=cov08b-bank-statement-reconcile.spec.ts E2E_GREP=
```

These companion specs also sign in as `fixture.reader@example.test`; supply its password through `E2E_FIRST_ORG_PERSONA_PASSWORD` and provision that separate read-only identity in the isolated tenant. The bank-reconciliation spec creates its fixture through the trusted owner endpoint, so it additionally requires `STDB_HOST`, `STDB_MODULE`, and `STDB_SERVER_TOKEN` for that same isolated deployment. Inject both passwords and the owner token from the secret manager; never write them to the rehearsal env file or evidence bundle.

## Automated evidence

| Checkpoint | Automated proof | Attachment |
|---|---|---|
| Company and country | Legal country `RW`, currency `RWF`, Rwanda pack catalog/activation state, visible readiness panel | `01-rwanda-country-pack.json` |
| Ledger setup | Required account classes and journal types, fiscal year, open period, ready UI state | `02-accounting-readiness.json` |
| Day-one documents | Customer invoice and vendor bill created through the operator UI with exactly balanced canonical lines | `03-invoice-and-bill.json` |
| Opening balances and retry | Rejected mixed debit/credit row creates no account; identical request returns the same job; corrected new submission persists the exact balance | `04-opening-balance-retry.json` |
| Historical journals | Unbalanced flat file is blocked before dispatch; corrected file creates one parent and two balanced lines through the tracked bundle | `05-historical-journal.json` |
| Outstanding documents | Customer invoice and vendor bill expand into balanced bundles in the configured residual-only or original-total mode; source totals and paid-to-date remain traceable | `06-outstanding-documents.json` |
| Historical-payment contract | Exact allocation reducer wire shape, paid-to-date amount, expected cutover residual, and completion marker | `07-historical-payment-contract.json` |
| Original-total payment replay | Real BFF request, idempotent replay, allocation result, and reconstructed residual; required only in `original_total_with_payment_replay` mode | `08-historical-payment-replay.json` |

The Playwright HTML report, trace on failure, import receipts, run-context attachment, and checkpoint attachments form the technical evidence pack. Every checkpoint JSON attachment includes an `evidenceBinding` block with the run, tenant, company, release, cutover, and migration-mode identity. The validator reads that block from each checkpoint artifact and rejects stale or mismatched files.

## Evidence checklist

Keep customer data outside Git. Store this checklist in the restricted run folder and record only artifact paths and digests in the manifest.

| Evidence | Owner | Pass condition |
|---|---|---|
| Playwright report and checkpoint attachments | Technical operator | Checkpoints 1–7 pass; checkpoint 8 passes for original-total mode or is explicitly not applicable for residual-only mode |
| Posted-payment reconciliation report | Technical operator | `accounting-post-reconcile.spec.ts` passes on the same deployed release |
| Bank reconciliation report | Technical operator | `cov08b-bank-statement-reconcile.spec.ts` passes on the same deployed release |
| Source and Lumiere control totals | Rwanda-qualified accountant | All seven named RWF measurements across six control areas match exactly with zero tolerance; `difference` equals Lumiere minus source and every `asOfDate` equals the declared cutover date. Trial-balance debits and credits are recorded separately. |
| Sample document review | Rwanda-qualified accountant | Five invoices/bills match source dates, accounts, taxes, totals, sequence policy, and audit metadata |
| Role evidence | Tenant administrator | All rows in the [role matrix](accounting/rwanda-alpha/role-matrix.md) pass at the server boundary using separate identities |
| Exception register | Rehearsal owner | Every open exception has severity, owner, workaround, and target release; no high or critical exception remains open |
| Alpha-user and accountant acceptance | Named signatories | Both decisions are `accepted` with timestamped evidence |
| Rwanda legal and tax review | Qualified external/internal reviewers | Both decisions are `approved` against the exact country-pack ruleset version before pack acceptance |
| RRA VSDC status | Release owner | A current RRA certification reference and validity dates are attached before statutory use |

## Manual live-tenant checks

The first user must still confirm the following with a Rwanda-qualified accountant before statutory use:

1. Company registration, TIN, fiscal year, RWF rounding, VAT registration status, and invoice sequence policy.
2. The chart-of-accounts mapping from the user's export, including control-account classifications and opening-balance sign convention.
3. Tax mappings for standard-rated, zero-rated, exempt, reverse-charge, withholding, and non-deductible purchases against current RRA rules.
4. Source totals: trial balance by period, receivable and payable aging, tax control totals, bank/cash totals, and retained earnings.
5. Five sampled invoices and bills rendered and posted with expected dates, accounts, taxes, totals, and audit metadata.
6. One customer receipt and one supplier payment matched to the intended document, plus one bank-statement reconciliation.
7. Permission checks using the intended alpha-power-user, bookkeeper, and read-only roles against the [role matrix](accounting/rwanda-alpha/role-matrix.md).

## Remaining scope limit

Residual-only outstanding invoices and bills are now covered by the automated rehearsal. They book the cutover residual to AR/AP against an opening account while retaining source face value and paid-to-date amounts in audit metadata.

Foreign-currency historical effects still need live acceptance evidence. Until that evidence exists, use company-currency source data. In residual-only cutover mode, reconcile resulting AR/AP aging to the source system and do not replay earlier payments a second time.

## Record and validate the decision

Fill [`evidence-manifest.template.json`](accounting/rwanda-alpha/evidence-manifest.template.json), calculate artifact digests with `sha256sum`, and validate it:

```bash
make validate-rwanda-alpha-evidence \
  RWANDA_ALPHA_EVIDENCE=/secure/path/evidence-manifest.json
```

The validator derives both decisions and rejects a manifest that claims a stronger result. Operational alpha requires all applicable technical checks, exact zero-difference RWF control totals at the declared cutover date, the role and manual checks, alpha-user acceptance after the technical run, accountant acceptance after the technical run, and no open high/critical exception. Evidence references and accepted operational signoffs must match the run ID, release commit, and cutover date. Statutory use additionally requires an accepted and enabled Rwanda pack, approved legal and tax records tied to its ruleset version, and a current RRA VSDC certification record. Pending, rejected, omitted, malformed, unexpected, or extra records fail closed. Repository templates do not represent approval or certification.

## Pass criteria

- Checkpoints 1–7 pass on the exact release candidate. Checkpoint 8 also passes for original-total mode; it is recorded as not applicable for residual-only mode.
- The posted-payment and bank reconciliation companion specs pass on the same deployment.
- The seven named source-to-Lumiere RWF measurements across six control areas reconcile exactly at the declared cutover date.
- The role matrix and seven manual checks pass with evidence.
- The alpha user and Rwanda-qualified accountant sign off on the manual checks and control totals.
- For statutory use, qualified legal and tax reviewers approve the exact pack ruleset, the Rwanda pack is accepted and enabled, and current RRA VSDC certification evidence is attached.
- Every exception has an owner, severity, workaround, and target release; no unexplained control-total difference remains.
