# Alpha module sample data and table readback

The October 25, 2026 seed extends the existing Alpha organization and company
with linked synthetic examples. It verifies 105 fixture entries that refer to
97 distinct records across 33 tables. Eight entries only check lifecycle
changes on an earlier record. Generated ledger lines, stock pickings, and asset
depreciation lines are additional derived records.

The final repeat created no rows and performed no lifecycle actions. The full
record IDs and counts are in
[`alpha-ui-scenarios-2026-10-25.json`](../evidence/alpha-ui-scenarios-2026-10-25.json).
This is persisted-data evidence. It does not certify every module or action.

| Module | Examples and useful table cells |
| --- | --- |
| CRM | Four companies, two people, eight leads, and eight opportunities. Names, email, phone, city, linked company, stage, EUR value, owner, and closing date. |
| Sales | Four orders with product or service lines, customer, EUR amounts, payment terms, delivery dates, and draft, quotation, or confirmed state. |
| Purchasing | Three purchase orders with vendor, line quantities, EUR amounts, planned dates, and draft or confirmed state. Two sourcing requests, two standalone RFQs, and four vendor bids. |
| Expenses | Six expenses with stored synthetic text receipts, employee, date, EUR amount, merchant, and account. Two submitted reports and one draft report. |
| Subscriptions | One monthly support plan, one active manual-billing subscription, one draft subscription, a price tier, and two usage events. |
| Reports | Four generated reports from the posted demo ledger: trial balance, profit and loss, aged receivables, and aged payables. |
| Accounting | An EUR 18,000 budget, an active EUR 15,000 asset with 36 depreciation periods, an EUR 1,200 prepaid schedule, and an EUR 2,400 draft deferred-revenue schedule. These extend the separate invoice, bill, and bank-statement seed. |
| Tax setup | Two clearly labelled illustrative report-review deadlines and one synthetic zero-rate schedule. No jurisdiction or filing result is invented. |
| Calendar and activities | Four upcoming private events and three assigned follow-ups with exact Sales, Purchasing, or invoice links. |
| Messages | Two internal review templates. No outbound delivery or provider history is fabricated. |

## Run and repeat

Use the guarded runner in `scripts/alpha-finance-demo-seed.mjs`. The existing
Finance seed and baseline Alpha prerequisites must be present. The live run used
pinned contracts 0.3.145. The source tests derive their archive from the current
release compatibility manifest.

```js
import { readFileSync } from 'node:fs'
import { alphaUiDemoScenarios } from './scripts/alpha-ui-demo-scenarios.mjs'
import { demoContractSchema } from './scripts/demo-contract-schema.mjs'
import { runAlphaFinanceDemoSeed } from './scripts/alpha-finance-demo-seed.mjs'

const release = JSON.parse(readFileSync('release-compatibility-manifest.json'))
const payload = alphaUiDemoScenarios()
const operations = [...new Set(payload.fixtures.flatMap(row =>
  [row.operation, ...(row.actions ?? []).map(action => action.operation)]
).filter(Boolean))]
payload.operations = await demoContractSchema(
  `frontend/vendor/lumiere-contracts-${release.lumiere_contracts.version}.tgz`, operations)
await runAlphaFinanceDemoSeed(payload)
```

Run contract extraction with Node `--experimental-vm-modules`. Use only the
production private Railway network and an existing active Alpha administrator
who is not a platform superuser. Supply tokens through the secret system as
described in `alpha-finance-ui-seed.md`. Never store tokens in reports.

Set `SEED_PLAN_ONLY=true` first. The plan checks the exact tenant, actor, role,
and prerequisites. It makes no business changes. Before the full run, upload
the six labelled synthetic receipts through the authenticated expense capture
form. The runner stops if a receipt is missing. It does not substitute a blob
identifier or bypass the upload path.

Repeat the full run and require both `createdRows: 0` and a zero sum of
`outcomes[].actionCount`. Exact references prevent duplicates. Existing dates
are retained. Unexpected record states and ambiguous matches stop the run.

## Readback changes needed for the live tables

PR #264 adds schema-backed amount, currency, date, relationship, and lifecycle
fields to the existing API read policies. Field masks and tenant scopes still
apply. The Web change maps legacy Sales, Purchasing, and CRM form field names to actual list columns.
It also derives CRM company and contact labels from their exact stored IDs.
Unsupported standard Tags columns are omitted. Custom field identities remain
unchanged.

These changes need both the API runtime update and the Web release. Additional
seed rows alone cannot fill cells when the deployed API omits the source field.
The current live My Work query also returns the older `{data: []}` format;
the current API source contains the work-board protocol expected by the Web.

## Remaining source and workflow limits

- Four older baseline opportunities have no currency. The CRM aggregate fails
  closed for these rows. The released update command cannot set their currency.
  The new opportunities have an explicit EUR currency. No direct SQL repair or
  silent currency fallback was used.
- The global country catalog is empty. Country cells and jurisdiction-based tax
  setup require the reference-data provisioning path. That path requires a
  separate validated database publication. The seed actor was not promoted.
- Draft expense report totals remain zero until the normal submission action
  calculates them. The linked draft lines retain their real amounts.
- The first sourcing request is submitted. RFQs are standalone examples because
  a linked RFQ requires an independently approved requisition. No self-approval
  or approval-rule change was used.
- Documents and other existing baseline records are retained. Outbound messages,
  payments, bank settlement, signatures, AI results, and completed approvals
  require their real operator or provider paths. Empty histories remain empty
  when no such action has occurred.

## Validation

```sh
node --experimental-vm-modules --test scripts/tests/alpha-demo-seed.test.mjs scripts/tests/alpha-finance-demo-seed.test.mjs scripts/tests/alpha-ui-demo-scenarios.test.mjs
cargo test -p stdb-auth --offline
```

The seed checks validate pinned command inputs, table and lookup fields,
ordered references, tagged activity targets, private-network guards, and the
absence of payment or outbound-dispatch actions. The API tests check field
masks and schema-backed projections. UI checks cover real Sales and CRM list
configurations and exact CRM parent labels.
