# Alpha Finance UI sample data

`scripts/alpha-finance-demo-seed.mjs` adds 21 named synthetic fixtures to the
existing `ALPHA` organization and company. It keeps existing fixtures and uses
their stable references on subsequent runs.

The fixtures include three posted customer invoices, three posted vendor bills,
two drafts, three bank statements with unreconciled lines, and a linked 0% demo
tax setup. The invoice dates cover three months. Due dates show current and
overdue balances. All mutations use the existing administrator's native
SpacetimeDB token and permission-checked reducers. The script does not send
email, execute payments, create credentials, or change permissions.

Before use, open the existing demo fiscal year and period through Accounting
Setup. This was done for FY 2026 and period `ADEMO2026` on October 25, 2026.

Run from a trusted Railway production runtime with private HTTP access. Supply
`STDB_HOST`, `STDB_MODULE`, `STDB_SERVER_TOKEN`, `SEED_ACTOR_TOKEN`,
`SEED_EXPECTED_IDENTITY`, and `RAILWAY_ENVIRONMENT_NAME=production` through the
existing secret system. `SEED_ACTOR_TOKEN` must belong to an existing active
Alpha administrator who is not a platform superuser. The server token is used
only for scoped SQL reads. No token values belong in source or reports.

Build the payload from the pinned contracts archive, then call the runner:

```js
import { readFileSync } from 'node:fs'
import { demoContractSchema } from './scripts/demo-contract-schema.mjs'
import { alphaFinanceDemoFixtures, runAlphaFinanceDemoSeed } from './scripts/alpha-finance-demo-seed.mjs'

const release = JSON.parse(readFileSync('release-compatibility-manifest.json'))
const archive = `frontend/vendor/lumiere-contracts-${release.lumiere_contracts.version}.tgz`
const fixtures = alphaFinanceDemoFixtures()
const operations = await demoContractSchema(archive,
  [...new Set([...fixtures.map(row => row.operation), 'post_account_move'])])
await runAlphaFinanceDemoSeed({ fixtures, operations })
```

Use Node with `--experimental-vm-modules` for contract extraction. Set
`SEED_PLAN_ONLY=true` to verify the actor, tenant and prerequisite records
without business mutations. Then run with that setting absent or `false`.
Repeat the run and require `createdRows: 0`. Existing fixture dates and values
are retained; a repeat does not move old examples into a new month.

The live initial and repeat reports are in
`docs/evidence/alpha-finance-ui-seed-2026-10-25.json`. Browser verification showed
EUR 15,600 in posted customer invoices, EUR 6,800 in posted vendor bills, two
overdue receivables, four unreconciled bank lines including the earlier fixture,
and an accounting setup status of ready. The CRM overview still reported source
field errors; this Finance seed does not repair that separate source issue.

Validation:

```sh
node --experimental-vm-modules --test scripts/tests/alpha-finance-demo-seed.test.mjs scripts/tests/alpha-demo-seed.test.mjs
sh infra/kong/test-render-config.sh
```
