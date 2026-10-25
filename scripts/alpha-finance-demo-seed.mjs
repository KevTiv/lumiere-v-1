import { createHash } from 'node:crypto'
import { encodeSeedValue, resolveSeedReferences } from './alpha-demo-seed.mjs'

const note = 'Synthetic Alpha UI example. No real invoice, tax filing, payment or bank transaction.'
export function alphaFinanceDemoFixtures(now = new Date()) {
  const fixtures = []
  const date = (month, day) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + month, day, 12)).toISOString()
  const add = (key, table, operation, match, input) => fixtures.push({ key, table, operation, match, input })
  const named = (key, table, operation, name, params, args = {}) => add(key, table, operation,
    { name }, { ...args, params: { name, ...params, metadata: JSON.stringify({ fixture_key: 'alpha-finance-ui-v1', note }) } })
  for (const [key, group, code] of [['taxAsset', 'Asset', 'ADUI1150'], ['taxLiability', 'Liability', 'ADUI2150']]) {
    named(`${key}Type`, 'account_account_type', 'create_account_account_type', `[Alpha UI demo] ${group} tax type`,
      { companyId: '@company', type: 'other', internalGroup: group, includeInitialBalance: true })
    named(key, 'account_account', 'create_account_account', `[Alpha UI demo] ${group} tax account`,
      { companyId: '@company', code, userTypeId: `@${key}Type`, internalType: group, internalGroup: group, note }, {})
  }
  named('demoTaxGroup', 'account_tax_group', 'create_account_tax_group', '[Alpha UI demo] Illustrative tax group',
    { sequence: 20, taxPayableAccountId: '@taxLiability', taxReceivableAccountId: '@taxAsset' }, { companyId: '@company' })
  for (const use of ['Sale', 'Purchase']) named(`demoTax${use}`, 'account_tax', 'create_account_tax',
    `[Alpha UI demo] ${use} 0% — synthetic only`, { description: note, typeTaxUse: use, amountType: 'Percent', amount: 0,
      active: true, sequence: 20, taxGroupId: '@demoTaxGroup' }, { companyId: '@company' })
  for (const [kind, amounts] of [['invoice', [4200, 7800, 3600, 1250]], ['bill', [2200, 3400, 1200, 850]]]) {
    for (const [i, amount] of amounts.entries()) {
      const key = `${kind}${i}`, ref = `ALPHA-UI-${kind.toUpperCase()}-${i + 1}`
      const issued = i < 2 ? date(i - 2, 15) : date(0, i === 2 ? 20 : 25)
      add(key, 'account_move', 'create_manual_account_invoice', { ref }, { params: {
        idempotencyKey: createHash('sha256').update(`alpha-finance-ui-v1:${key}`).digest('hex').slice(0, 32),
        companyId: '@company', journalId: kind === 'invoice' ? '@salesJournal' : '@purchaseJournal',
        moveType: kind === 'invoice' ? 'OutInvoice' : 'InInvoice', currencyId: '@currency',
        partnerId: kind === 'invoice' ? (i % 2 ? '@customer2' : '@customer') : '@vendor',
        counterpartAccountId: kind === 'invoice' ? '@receivable' : '@payable', date: issued, invoiceDate: issued,
        invoiceDateDue: i < 2 ? date(i - 1, 15) : date(1, 19), ref,
        metadata: JSON.stringify({ fixture_key: 'alpha-finance-ui-v1', note }),
        lines: [{ name: `[Alpha UI demo] ${kind === 'invoice' ? 'Office rollout services' : 'Equipment and materials'} ${i + 1}`,
          accountId: kind === 'invoice' ? '@income' : '@expenseAccount', quantity: 1, priceUnit: amount, discount: 0,
          taxIds: [kind === 'invoice' ? '@demoTaxSale' : '@demoTaxPurchase'] }],
      } })
      fixtures.at(-1).post = i < 3
    }
  }
  for (let i = 0; i < 3; i++) {
    const reference = `ALPHA-UI-BANK-${i + 1}`
    named(`bank${i}`, 'account_bank_statement', 'create_account_bank_statement', `[Alpha UI demo] Bank statement ${i + 1}`,
      { reference, date: i < 2 ? date(i - 1, 0) : date(0, 25), balanceStart: [10000, 14500, 17750][i], currencyId: '@currency' },
      { companyId: '@company', journalId: '@bankJournal' })
    add(`bankLine${i}`, 'account_bank_statement_line', 'create_account_bank_statement_line', { statement_id: `@bank${i}`, amount: [4500, 3250, 2250][i] },
      { companyId: '@company', statementId: `@bank${i}`, params: { date: i < 2 ? date(i - 1, 0) : date(0, 25),
        amount: [4500, 3250, 2250][i], amountCurrency: [4500, 3250, 2250][i], currencyId: '@currency',
        partnerId: '@customer', isReconciled: false, amountResidual: [4500, 3250, 2250][i], transactionType: 'DEMO',
        metadata: JSON.stringify({ fixture_key: 'alpha-finance-ui-v1', note }) } })
  }
  return fixtures
}

export async function runAlphaFinanceDemoSeed({ fixtures, operations, prerequisites = [], fixtureKey = 'alpha-finance-ui-v1' }, env = process.env) {
  const host = new URL(env.STDB_HOST)
  if (host.protocol !== 'http:' || !host.hostname.endsWith('.railway.internal') || env.RAILWAY_ENVIRONMENT_NAME !== 'production') {
    throw new Error('requires the Railway production private network')
  }
  const expected = env.SEED_EXPECTED_IDENTITY?.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(expected ?? '') || !env.SEED_ACTOR_TOKEN || !env.STDB_SERVER_TOKEN) throw new Error('existing actor credentials are required')
  const base = `/v1/database/${encodeURIComponent(env.STDB_MODULE)}`
  async function sql(statement, token = env.STDB_SERVER_TOKEN) {
    const response = await fetch(new URL(`${base}/sql`, host), { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain',
    }, body: statement, signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`SQL read HTTP ${response.status}`)
    const [result] = await response.json()
    return { identity: response.headers.get('spacetime-identity')?.replace(/^0x/, '').toLowerCase(), rows: result.rows.map(row =>
      Object.fromEntries(result.schema.elements.map((column, i) => [column.name.some, row[i]]))) }
  }
  const rows = async statement => (await sql(statement)).rows
  if ((await sql('SELECT id FROM organization LIMIT 1', env.SEED_ACTOR_TOKEN)).identity !== expected) throw new Error('actor identity mismatch')
  const orgs = await rows("SELECT id, name FROM organization WHERE code = 'ALPHA'")
  if (orgs.length !== 1 || orgs[0].name !== 'Alpha org' || orgs[0].id !== 1) throw new Error('unexpected Alpha tenant')
  const profiles = await rows(`SELECT is_superuser, is_active FROM user_profile WHERE organization_id = 1 AND identity = 0x${expected}`)
  const memberships = await rows(`SELECT role_id, is_active FROM user_organization WHERE organization_id = 1 AND user_identity = 0x${expected}`)
  if (profiles.length !== 1 || profiles[0].is_superuser || !profiles[0].is_active || memberships.length !== 1 || !memberships[0].is_active) throw new Error('active non-platform Alpha actor required')
  const roles = await rows(`SELECT permissions FROM role WHERE organization_id = 1 AND id = ${memberships[0].role_id} AND is_active = true`)
  if (roles.length !== 1 || !roles[0].permissions.includes('*:*')) throw new Error('existing Alpha administrator required')
  const companies = await rows("SELECT id, currency_id FROM company WHERE organization_id = 1 AND code = 'ALPHA'")
  if (companies.length !== 1) throw new Error('ambiguous Alpha company')
  const ids = { company: companies[0].id, currency: companies[0].currency_id, actor: expected }
  async function find(table, match) {
    if (!/^[a-z_]+$/.test(table) || Object.keys(match).some(key => !/^[a-z_]+$/.test(key))) throw new Error('unsafe fixture lookup')
    const found = await rows(`SELECT * FROM ${table} WHERE organization_id = 1 LIMIT 1000`)
    if (found.length === 1000) throw new Error('fixture lookup bound exceeded')
    const unwrap = value => Array.isArray(value) && value.length === 2 && value[0] === 0 ? value[1] : value
    return found.filter(row => Object.entries(match).every(([key, value]) => String(unwrap(row[key])) === String(value)))
  }
  for (const [key, table, match] of [
    ['customer', 'contact', { name: '[Alpha demo] Aurora Retail' }], ['customer2', 'contact', { name: '[Alpha demo] Northstar Studio' }],
    ['vendor', 'contact', { name: '[Alpha demo] Beacon Components' }], ['receivable', 'account_account', { code: 'ADEMO1100' }],
    ['payable', 'account_account', { code: 'ADEMO2100' }], ['income', 'account_account', { code: 'ADEMO4000' }],
    ['expenseAccount', 'account_account', { code: 'ADEMO6000' }], ['salesJournal', 'account_journal', { code: 'ADS' }],
    ['purchaseJournal', 'account_journal', { code: 'ADP' }], ['bankJournal', 'account_journal', { code: 'ADB' }], ...prerequisites,
  ]) {
    const found = await find(table, match)
    if (found.length !== 1) throw new Error(`missing or ambiguous prerequisite ${key}`)
    ids[key] = found[0].id
  }
  async function call(operation, input) {
    const definition = operations[operation]
    if (!definition) throw new Error(`operation is not in pinned seed contracts: ${operation}`)
    const resolved = { ...resolveSeedReferences(input, ids), organizationId: 1 }
    const args = Object.entries(definition.fields).map(([field, type]) => encodeSeedValue(type, resolved[field], field))
    const response = await fetch(new URL(`${base}/call/${operation}`, host), { method: 'POST', headers: {
      Authorization: `Bearer ${env.SEED_ACTOR_TOKEN}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify(args), signal: AbortSignal.timeout(45000) })
    if (!response.ok) throw new Error(`${operation} HTTP ${response.status}: ${(await response.text()).slice(0, 350)}`)
  }
  if (env.SEED_PLAN_ONLY === 'true') {
    const report = { fixtureKey, organizationId: 1, actorVerified: true, fixtureCount: fixtures.length, mutationCount: 0 }
    console.log('ALPHA_FINANCE_PLAN', JSON.stringify(report))
    return report
  }
  const outcomes = []
  for (const fixture of fixtures) {
    const match = resolveSeedReferences(fixture.match, ids)
    let found = await find(fixture.table, match)
    const created = found.length === 0
    if (created) {
      if (!fixture.operation) throw new Error(`missing existing fixture ${fixture.key}`)
      const input = resolveSeedReferences(fixture.input, ids)
      if (fixture.blob) {
        throw new Error(`upload ${fixture.blob.fileName} through the authenticated expense capture form first`)
      }
      await call(fixture.operation, input); found = await find(fixture.table, match)
    }
    if (found.length !== 1) throw new Error(`ambiguous fixture ${fixture.key}`)
    ids[fixture.key] = found[0].id
    let actionCount = 0
    for (const action of fixture.actions ?? []) {
      const expect = resolveSeedReferences(action.expect, ids)
      const matches = row => Object.entries(expect).every(([key, value]) => JSON.stringify(row[key]) === JSON.stringify(value)) &&
        Object.entries(action.expectLengths ?? {}).every(([key, count]) => Array.isArray(row[key]) && row[key].length === count)
      if (!matches(found[0])) {
        const before = resolveSeedReferences(action.before, ids)
        if (!Object.entries(before).every(([key, value]) => JSON.stringify(found[0][key]) === JSON.stringify(value))) {
          throw new Error(`unexpected lifecycle state: ${fixture.key}`)
        }
        await call(action.operation, action.input)
        found = await find(fixture.table, match)
        if (found.length !== 1 || !matches(found[0])) throw new Error(`action readback failed: ${fixture.key} ${action.operation}`)
        actionCount++
      }
    }
    if (fixture.post) {
      const state = found[0].state
      if (state[0] === 0) await call('post_account_move', { moveId: found[0].id })
      const [posted] = await find(fixture.table, match)
      if (posted.state[0] !== 1 || posted.amount_total <= 0) throw new Error(`posting readback failed: ${fixture.key}`)
    }
    outcomes.push({ key: fixture.key, table: fixture.table, id: ids[fixture.key], created, posted: fixture.post ?? false, actionCount })
    console.log('ALPHA_FINANCE_FIXTURE', JSON.stringify(outcomes.at(-1)))
  }
  const report = { fixtureKey, organizationId: 1, generatedAt: new Date().toISOString(),
    createdRows: outcomes.filter(row => row.created).length, outcomes }
  console.log('ALPHA_FINANCE_REPORT', JSON.stringify(report))
  return report
}
