#!/usr/bin/env node
// Repeatable private-network setup for an isolated Rwanda accounting rehearsal tenant.
// Secrets are accepted only through environment variables and are never printed.

const MARKER = 'rwanda-accounting-alpha-setup-v1'
const NONE = { none: [] }
const some = value => ({ some: value })
const timestamp = iso => ({ __timestamp_micros_since_unix_epoch__: Date.parse(iso) * 1000 })
const identity = value => ({ __identity__: `0x${value.replace(/^0x/i, '').toLowerCase()}` })

function required(env, name) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`missing ${name}`)
  return value
}

function privateUrl(env, name) {
  const url = new URL(required(env, name))
  if (url.protocol !== 'http:' || !url.hostname.endsWith('.railway.internal')) {
    throw new Error(`${name} must use Railway private HTTP`)
  }
  return url
}

function validatedEmail(value, name) {
  const email = value.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`invalid ${name}`)
  return email
}

export function setupConfig(env = process.env) {
  if (required(env, 'RWANDA_SETUP_ISOLATED_TENANT_ACK') !== '1') {
    throw new Error('RWANDA_SETUP_ISOLATED_TENANT_ACK must be 1')
  }
  const code = required(env, 'RWANDA_SETUP_ORG_CODE').toUpperCase()
  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) throw new Error('invalid RWANDA_SETUP_ORG_CODE')
  const cutoverDate = required(env, 'RWANDA_SETUP_CUTOVER_DATE')
  const parsedCutoverDate = new Date(`${cutoverDate}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoverDate)
    || !Number.isFinite(parsedCutoverDate.getTime())
    || parsedCutoverDate.toISOString().slice(0, 10) !== cutoverDate) {
    throw new Error('RWANDA_SETUP_CUTOVER_DATE must be YYYY-MM-DD')
  }
  const year = Number(cutoverDate.slice(0, 4))
  const tenantRef = required(env, 'RWANDA_SETUP_TENANT_REF')
  if (!/^[A-Za-z0-9._:-]{3,100}$/.test(tenantRef)) throw new Error('invalid RWANDA_SETUP_TENANT_REF')
  const ownerPassword = required(env, 'RWANDA_SETUP_OWNER_PASSWORD')
  const personaPassword = required(env, 'RWANDA_SETUP_PERSONA_PASSWORD')
  if (ownerPassword.length < 8 || personaPassword.length < 8) {
    throw new Error('Rwanda setup passwords must contain at least 8 characters')
  }
  const ownerEmail = validatedEmail(required(env, 'RWANDA_SETUP_OWNER_EMAIL'), 'RWANDA_SETUP_OWNER_EMAIL')
  const operatorEmail = validatedEmail(env.RWANDA_SETUP_OPERATOR_EMAIL ?? 'rw.alpha.operator@example.test', 'RWANDA_SETUP_OPERATOR_EMAIL')
  const bookkeeperEmail = validatedEmail(env.RWANDA_SETUP_BOOKKEEPER_EMAIL ?? 'rw.alpha.bookkeeper@example.test', 'RWANDA_SETUP_BOOKKEEPER_EMAIL')
  const readerEmail = validatedEmail(env.RWANDA_SETUP_READER_EMAIL ?? 'fixture.reader@example.test', 'RWANDA_SETUP_READER_EMAIL')
  if (new Set([ownerEmail, operatorEmail, bookkeeperEmail, readerEmail]).size !== 4) {
    throw new Error('Rwanda setup identities must use four distinct email addresses')
  }
  return {
    api: privateUrl(env, 'LUMIERE_API_SERVER_URL'),
    stdb: privateUrl(env, 'STDB_HOST'),
    database: encodeURIComponent(required(env, 'STDB_MODULE')),
    admin: required(env, 'STDB_SERVER_TOKEN'),
    tenantRef,
    orgName: required(env, 'RWANDA_SETUP_ORG_NAME'),
    orgCode: code,
    ownerEmail,
    ownerPassword,
    personaPassword,
    operatorEmail,
    bookkeeperEmail,
    readerEmail,
    cutoverDate,
    fiscalYear: year,
  }
}

function decodeRows(resultSets) {
  const result = resultSets?.[0]
  return (result?.rows ?? []).map(row => Object.fromEntries(
    result.schema.elements.map((column, index) => [column.name.some, row[index]]),
  ))
}

function unwrap(value) {
  if (value && typeof value === 'object' && 'some' in value) return unwrap(value.some)
  if (Array.isArray(value) && value.length === 2 && value[0] === 0) return unwrap(value[1])
  if (value && typeof value === 'object' && '__identity__' in value) return value.__identity__.replace(/^0x/i, '').toLowerCase()
  return value
}

function unitTag(value) {
  const unwrapped = unwrap(value)
  if (typeof unwrapped === 'string') return unwrapped.toLowerCase()
  if (unwrapped && typeof unwrapped === 'object') {
    if (typeof unwrapped.tag === 'string') return unwrapped.tag.toLowerCase()
    const keys = Object.keys(unwrapped)
    if (keys.length === 1) return keys[0].toLowerCase()
  }
  return ''
}

function timestampMillis(value) {
  const unwrapped = unwrap(value)
  const micros = unwrapped?.__timestamp_micros_since_unix_epoch__
  const number = Number(micros)
  if (!Number.isFinite(number)) throw new Error('invalid persisted timestamp')
  return number / 1000
}

function strictId(value, label) {
  const id = Number(unwrap(value))
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`invalid ${label}`)
  return id
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function rehearsalEnvIds({ tenantRef, companyId, operatorEmail, customerId, vendorId }) {
  return [
    `E2E_RWANDA_TENANT_REF=${tenantRef}`,
    `E2E_RWANDA_EXPECTED_COMPANY_ID=${companyId}`,
    'E2E_RWANDA_OPERATOR_NAME=Rwanda alpha power user',
    `E2E_RWANDA_OPERATOR_EMAIL=${operatorEmail}`,
    `E2E_RWANDA_CUSTOMER_PARTNER_ID=${customerId}`,
    `E2E_RWANDA_SUPPLIER_PARTNER_ID=${vendorId}`,
  ].join('\n')
}

export async function runRwandaAccountingSetup(env = process.env, output = console.log) {
  const cfg = setupConfig(env)
  const request = async (base, path, token, body, contentType = 'application/json') => {
    const response = await fetch(new URL(path, base), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': contentType }) },
      body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
      signal: AbortSignal.timeout(45_000),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`${path} failed: HTTP ${response.status}`)
    return data
  }
  const sql = async statement => decodeRows(await request(
    cfg.stdb, `/v1/database/${cfg.database}/sql`, cfg.admin, statement, 'text/plain',
  ))
  const credential = async (email, password) => {
    const value = await request(cfg.api, '/v1/auth/internal/bootstrap-credential', cfg.admin, { email, password })
    const normalized = String(value.identity ?? '').replace(/^0x/i, '').toLowerCase()
    if (!value.token || !/^[0-9a-f]{64}$/.test(normalized)) throw new Error('credential binding is incomplete')
    return { token: value.token, identity: normalized }
  }
  const operation = (token, name, body) => request(cfg.api, `/v1/operations/erp.${name}`, token, body)

  let organizations = await sql('SELECT id, name, code FROM organization')
  if (organizations.length > 1) throw new Error('isolated rehearsal database contains more than one organization')
  if (organizations.length === 1 && (organizations[0].code !== cfg.orgCode || organizations[0].name !== cfg.orgName)) {
    throw new Error('isolated rehearsal database is already bound to a different organization')
  }

  const owner = await credential(cfg.ownerEmail, cfg.ownerPassword)
  let ownerSession = await request(cfg.api, '/v1/session/field-access', owner.token)
  if (!organizations.length) {
    if (ownerSession.organizationId != null) throw new Error('owner already belongs to another organization')
    await request(cfg.api, '/v1/bootstrap/tenant', owner.token, {
      organization: {
        name: cfg.orgName, code: cfg.orgCode, timezone: 'Africa/Kigali', dateFormat: 'yyyy-MM-dd',
        language: 'en', isActive: true, description: null, logoUrl: null, website: null,
        email: cfg.ownerEmail, phone: null, currencyId: null, metadata: JSON.stringify({ setup: MARKER }),
      },
      defaultCompanyName: cfg.orgName, defaultCompanyCode: cfg.orgCode,
      defaultCompanyCurrencyId: 0, defaultCompanyCurrencyCode: 'RWF',
      fiscalYearEndMonth: 12, fiscalYearEndDay: 31, seedFormConfigs: true,
      settings: { moduleConfig: null, featureFlags: [], integrationKeys: null, metadata: JSON.stringify({ setup: MARKER }) },
    })
    organizations = await sql('SELECT id, name, code FROM organization')
  }
  if (organizations.length !== 1) throw new Error('tenant bootstrap did not create exactly one organization')
  const organizationId = strictId(organizations[0].id, 'organization id')
  ownerSession = await request(cfg.api, '/v1/session/field-access', owner.token)
  if (Number(ownerSession.organizationId) !== organizationId) throw new Error('owner organization binding was not verified')

  const ownerProfiles = await sql(`SELECT identity, is_superuser FROM user_profile WHERE organization_id = ${organizationId}`)
  const ownerProfile = ownerProfiles.find(row => unwrap(row.identity) === owner.identity)
  if (!ownerProfile || ownerProfile.is_superuser !== false) throw new Error('owner must remain a non-platform-superuser')

  const companies = await sql(`SELECT id, name, code, currency_id, address_country_code FROM company WHERE organization_id = ${organizationId}`)
  if (companies.length !== 1 || companies[0].code !== cfg.orgCode) throw new Error('isolated tenant must contain exactly the target company')
  const companyId = strictId(companies[0].id, 'company id')
  const currencyId = strictId(companies[0].currency_id, 'currency id')
  const currencies = await sql(`SELECT id, code, decimal_places, active FROM currency WHERE organization_id = ${organizationId}`)
  const companyCurrency = currencies.find(row => strictId(row.id, 'currency id') === currencyId)
  if (!companyCurrency || companyCurrency.code !== 'RWF' || companyCurrency.active !== true || Number(companyCurrency.decimal_places) !== 0) {
    throw new Error('company currency is not active zero-decimal RWF')
  }
  if (unwrap(companies[0].address_country_code) !== 'RW') {
    await operation(owner.token, 'update_company_address', {
      companyId,
      params: { address_street: NONE, address_city: NONE, address_zip: NONE, address_country_code: some('RW') },
    })
  }

  const marker = JSON.stringify({ setup: MARKER })
  const accountTypeSpecs = [
    ['rw-alpha-receivable', 'RW Alpha Receivable', 'receivable', 'asset'],
    ['rw-alpha-payable', 'RW Alpha Payable', 'payable', 'liability'],
    ['rw-alpha-income', 'RW Alpha Income', 'income', 'income'],
    ['rw-alpha-expense', 'RW Alpha Expense', 'expense', 'expense'],
    ['rw-alpha-liquidity', 'RW Alpha Liquidity', 'liquidity', 'asset'],
  ]
  const accountTypes = {}
  for (const [key, name, type, group] of accountTypeSpecs) {
    let matches = await sql(`SELECT id, name, type, internal_group, is_deprecated FROM account_account_type WHERE organization_id = ${organizationId} AND company_id = ${companyId} AND name = ${sqlLiteral(name)}`)
    if (matches.length > 1) throw new Error(`ambiguous account type ${name}`)
    if (!matches.length) {
      await operation(owner.token, 'create_account_account_type', { params: {
        name, type, internal_group: { [group]: [] }, include_initial_balance: true,
        company_id: some(companyId), metadata: some(marker),
      } })
      matches = await sql(`SELECT id, name, type, internal_group, is_deprecated FROM account_account_type WHERE organization_id = ${organizationId} AND company_id = ${companyId} AND name = ${sqlLiteral(name)}`)
    }
    if (matches.length !== 1 || matches[0].is_deprecated === true || matches[0].type !== type || unitTag(matches[0].internal_group) !== group) {
      throw new Error(`account type ${name} failed verification`)
    }
    accountTypes[key] = strictId(matches[0].id, `${name} id`)
  }

  const accountSpecs = [
    ['receivable', 'RWAR1100', 'Rwanda alpha trade receivables', 'rw-alpha-receivable', 'receivable', 'asset', true],
    ['payable', 'RWAP2100', 'Rwanda alpha trade payables', 'rw-alpha-payable', 'payable', 'liability', true],
    ['income', 'RWAI4000', 'Rwanda alpha sales income', 'rw-alpha-income', 'income', 'income', false],
    ['expense', 'RWAE6000', 'Rwanda alpha operating expense', 'rw-alpha-expense', 'expense', 'expense', false],
    ['liquidity', 'RWAB1200', 'Rwanda alpha bank', 'rw-alpha-liquidity', 'liquidity', 'asset', true],
  ]
  const accounts = {}
  for (const [key, code, name, typeKey, internalType, group, reconcile] of accountSpecs) {
    let matches = await sql(`SELECT id, code, user_type_id, internal_type, internal_group, deprecated FROM account_account WHERE organization_id = ${organizationId} AND company_id = ${companyId} AND code = ${sqlLiteral(code)}`)
    if (matches.length > 1) throw new Error(`ambiguous account ${code}`)
    if (!matches.length) {
      await operation(owner.token, 'create_account_account', { params: {
        company_id: some(companyId), code, name, user_type_id: accountTypes[typeKey], currency_id: NONE,
        internal_type: some({ [internalType]: [] }), internal_group: some({ [group]: [] }), group_id: NONE,
        reconcile, tax_ids: [], note: some('Synthetic rehearsal prerequisite'), opening_debit: 0,
        opening_credit: 0, allowed_journal_ids: [], non_trade: false, is_off_balance: false, metadata: some(marker),
      } })
      matches = await sql(`SELECT id, code, user_type_id, internal_type, internal_group, deprecated FROM account_account WHERE organization_id = ${organizationId} AND company_id = ${companyId} AND code = ${sqlLiteral(code)}`)
    }
    if (matches.length !== 1 || matches[0].deprecated === true
      || strictId(matches[0].user_type_id, `${code} type`) !== accountTypes[typeKey]
      || unitTag(matches[0].internal_type) !== internalType
      || unitTag(matches[0].internal_group) !== group) {
      throw new Error(`account ${code} failed verification`)
    }
    accounts[key] = strictId(matches[0].id, `${code} id`)
  }

  const journalSpecs = [
    ['sale', 'RWAS', 'Rwanda alpha sales', 'sale', accounts.income],
    ['purchase', 'RWAP', 'Rwanda alpha purchases', 'purchase', accounts.expense],
    ['general', 'RWAG', 'Rwanda alpha general', 'general', accounts.expense],
    ['bank', 'RWAB', 'Rwanda alpha bank', 'bank', accounts.liquidity],
  ]
  const journals = {}
  for (const [key, code, name, type, defaultAccountId] of journalSpecs) {
    let matches = await sql(`SELECT id, code, type, currency_id, default_account_id, active FROM account_journal WHERE organization_id = ${organizationId} AND company_id = ${companyId} AND code = ${sqlLiteral(code)}`)
    if (matches.length > 1) throw new Error(`ambiguous journal ${code}`)
    if (!matches.length) {
      await operation(owner.token, 'create_account_journal', { params: {
        company_id: some(companyId), name, code, type: { [type]: [] }, currency_id: some(currencyId),
        default_account_id: some(defaultAccountId), suspense_account_id: NONE, loss_account_id: NONE,
        profit_account_id: NONE, bank_account_id: type === 'bank' ? some(accounts.liquidity) : NONE,
        payment_credit_account_id: NONE, payment_debit_account_id: NONE, invoice_reference_type: NONE,
        invoice_reference_model: NONE, sequence_id: NONE, refund_sequence_id: NONE, sequence_override_regex: NONE,
        secure_sequence_id: NONE, alias_name: NONE, alias_domain: NONE, sale_activity_type_id: NONE,
        sale_activity_user_id: NONE, sale_activity_note: NONE, sale_activity_date_deadline: NONE,
        restrict_mode_hash_table: false, active: true, at_least_one_inbound: false,
        at_least_one_outbound: false, dedicated_payment_method_ids: [], sale_activity_done: false, metadata: some(marker),
      } })
      matches = await sql(`SELECT id, code, type, currency_id, default_account_id, active FROM account_journal WHERE organization_id = ${organizationId} AND company_id = ${companyId} AND code = ${sqlLiteral(code)}`)
    }
    if (matches.length !== 1 || matches[0].active !== true
      || unitTag(matches[0].type) !== type
      || strictId(matches[0].currency_id, `${code} currency`) !== currencyId
      || strictId(matches[0].default_account_id, `${code} default account`) !== defaultAccountId) {
      throw new Error(`journal ${code} failed verification`)
    }
    journals[key] = strictId(matches[0].id, `${code} id`)
  }

  const yearStart = `${cfg.fiscalYear}-01-01T00:00:00.000Z`
  const yearEnd = `${cfg.fiscalYear}-12-31T23:59:59.999Z`
  const yearName = `RW alpha FY ${cfg.fiscalYear}`
  let years = await sql(`SELECT id, name, date_from, date_to, state FROM account_fiscal_year WHERE organization_id = ${organizationId} AND company_id = ${companyId} AND name = ${sqlLiteral(yearName)}`)
  if (years.length > 1) throw new Error(`ambiguous fiscal year ${yearName}`)
  if (!years.length) {
    await operation(owner.token, 'create_fiscal_year', { companyId, params: {
      name: yearName, date_from: timestamp(yearStart), date_to: timestamp(yearEnd), type: 'normal',
      is_adjustment: false, notes: some('Synthetic Rwanda alpha rehearsal year'), metadata: some(marker),
    } })
    years = await sql(`SELECT id, name, date_from, date_to, state FROM account_fiscal_year WHERE organization_id = ${organizationId} AND company_id = ${companyId} AND name = ${sqlLiteral(yearName)}`)
  }
  if (years.length !== 1) throw new Error('fiscal year failed verification')
  const fiscalYearId = strictId(years[0].id, 'fiscal year id')
  const fiscalState = unitTag(years[0].state)
  if (fiscalState === 'draft') {
    await operation(owner.token, 'open_fiscal_year', { companyId, fiscalYearId })
  } else if (fiscalState !== 'running') {
    throw new Error('rehearsal fiscal year is not openable')
  }
  const periodCode = `RWA${cfg.fiscalYear}`
  let periods = await sql(`SELECT id, code, date_from, date_to, fiscal_year_id, state FROM account_period WHERE organization_id = ${organizationId} AND company_id = ${companyId} AND code = ${sqlLiteral(periodCode)}`)
  if (periods.length > 1) throw new Error(`ambiguous accounting period ${periodCode}`)
  if (!periods.length) {
    await operation(owner.token, 'create_account_period', { companyId, params: {
      name: `RW alpha period ${cfg.fiscalYear}`, code: periodCode, date_from: timestamp(yearStart),
      date_to: timestamp(yearEnd), fiscal_year_id: fiscalYearId, is_adjustment: false,
      notes: some('Synthetic Rwanda alpha rehearsal period'), metadata: some(marker),
    } })
    periods = await sql(`SELECT id, code, date_from, date_to, fiscal_year_id, state FROM account_period WHERE organization_id = ${organizationId} AND company_id = ${companyId} AND code = ${sqlLiteral(periodCode)}`)
  }
  if (periods.length !== 1 || strictId(periods[0].fiscal_year_id, 'period fiscal year') !== fiscalYearId) {
    throw new Error('accounting period is not bound to the rehearsal fiscal year')
  }
  const cutoverMillis = Date.parse(`${cfg.cutoverDate}T00:00:00Z`)
  if (timestampMillis(periods[0].date_from) > cutoverMillis || timestampMillis(periods[0].date_to) < cutoverMillis) {
    throw new Error('accounting period does not contain the configured cutover date')
  }
  const periodId = strictId(periods[0].id, 'accounting period id')
  const periodState = unitTag(periods[0].state)
  if (periodState === 'draft') {
    await operation(owner.token, 'open_account_period', { companyId, periodId })
  } else if (periodState !== 'open') {
    throw new Error('accounting period is not open and bound to the rehearsal fiscal year')
  }

  const contactSpecs = [
    ['customer', 'Rwanda alpha synthetic customer', true, false],
    ['vendor', 'Rwanda alpha synthetic vendor', false, true],
  ]
  const contacts = {}
  for (const [key, name, isCustomer, isVendor] of contactSpecs) {
    let matches = await sql(`SELECT id, name, company_id, country_code, is_customer, is_vendor FROM contact WHERE organization_id = ${organizationId} AND name = ${sqlLiteral(name)}`)
    if (matches.length > 1) throw new Error(`ambiguous synthetic contact ${name}`)
    if (!matches.length) {
      const optional = value => value == null ? NONE : some(value)
      await operation(owner.token, 'create_contact', { params: {
        name, type: 'company', email: NONE, phone: NONE, mobile: NONE, company_id: some(companyId),
        is_customer: isCustomer, is_vendor: isVendor, is_employee: false, is_prospect: false,
        is_partner: true, customer_rank: isCustomer ? 1 : 0, supplier_rank: isVendor ? 1 : 0,
        display_name: some(name), first_name: NONE, last_name: NONE, title: NONE, email_secondary: NONE,
        fax: NONE, website: NONE, street: NONE, street_2: NONE, city: some('Kigali'), state_code: NONE,
        zip: NONE, country_code: some('RW'), tax_id: NONE, company_registry: NONE, industry: NONE,
        employees_count: NONE, annual_revenue: NONE, description: some('Synthetic rehearsal-only partner'),
        salesperson_id: NONE, assigned_user_id: NONE, parent_id: NONE, user_id: NONE, color: NONE,
        metadata: optional(marker),
      } })
      matches = await sql(`SELECT id, name, company_id, country_code, is_customer, is_vendor FROM contact WHERE organization_id = ${organizationId} AND name = ${sqlLiteral(name)}`)
    }
    if (matches.length !== 1 || strictId(matches[0].company_id, `${name} company`) !== companyId
      || unwrap(matches[0].country_code) !== 'RW'
      || matches[0].is_customer !== isCustomer || matches[0].is_vendor !== isVendor) {
      throw new Error(`synthetic contact ${name} failed verification`)
    }
    contacts[key] = strictId(matches[0].id, `${name} id`)
  }

  const personaSpecs = [
    ['alpha-power-user', cfg.operatorEmail, 'rw-alpha-power-user', [
      'organization:read', 'company:read', 'currency:read', 'contact:read',
      'account_account:read', 'account_account:create', 'account_account_type:read',
      'account_fiscal_year:read', 'account_period:read', 'financial_report:read',
      'account_move:*', 'account_move_line:*', 'account_payment:*', 'payment_transaction:*',
      'payment:create', 'payment:post', 'payment:reconcile', 'payment:cancel', 'payment:reverse', 'payment_reversal:read',
      'payment_reconciliation:*', 'account_journal:read', 'account_bank_statement:*',
      'account_bank_statement_line:*', 'import_job:*', 'report:read', 'audit_log:read',
      'mail_template:read', 'mail_template:write', 'mail_message:read', 'mail_message:write',
      'document:read', 'document:create',
    ]],
    ['bookkeeper', cfg.bookkeeperEmail, 'rw-alpha-bookkeeper', [
      'organization:read', 'company:read', 'currency:read', 'contact:read',
      'account_account:read', 'account_account:create', 'account_account_type:read',
      'account_fiscal_year:read', 'account_period:read', 'financial_report:read',
      'account_move:create', 'account_move:read', 'account_move:write', 'account_move_line:*',
      'account_payment:create', 'account_payment:read', 'account_journal:read', 'account_bank_statement:read',
      'payment_transaction:read', 'payment_reversal:read',
      'document:read', 'document:create',
      'account_bank_statement_line:read', 'import_job:create', 'import_job:read', 'report:read', 'audit_log:read',
    ]],
    ['read-only', cfg.readerEmail, 'rw-alpha-read-only', [
      'organization:read', 'company:read', 'currency:read', 'contact:read',
      'account_account:read', 'account_account_type:read', 'account_fiscal_year:read',
      'account_period:read', 'financial_report:read', 'account_move:read',
      'account_move_line:read', 'account_payment:read', 'payment_transaction:read',
      'payment_reversal:read',
      'document:read',
      'payment_reconciliation:read', 'account_journal:read', 'account_bank_statement:read',
      'account_bank_statement_line:read', 'import_job:read', 'report:read', 'audit_log:read',
    ]],
  ]
  for (const [key, email, roleName, permissions] of personaSpecs) {
    let roles = await sql(`SELECT id, name, permissions, is_system, is_active FROM role WHERE organization_id = ${organizationId} AND name = ${sqlLiteral(roleName)}`)
    if (roles.length > 1) throw new Error(`ambiguous role ${roleName}`)
    if (!roles.length) {
      await operation(owner.token, 'create_role', { params: {
        name: roleName, description: some(`Rwanda alpha ${key}`), parent_id: NONE,
        permissions, is_active: true, metadata: some(marker),
      } })
      roles = await sql(`SELECT id, name, permissions, is_system, is_active FROM role WHERE organization_id = ${organizationId} AND name = ${sqlLiteral(roleName)}`)
    }
    const actualPermissions = Array.isArray(roles[0]?.permissions) ? [...roles[0].permissions].sort() : []
    const expectedPermissions = [...permissions].sort()
    if (roles.length !== 1 || roles[0].is_system === true || roles[0].is_active !== true
      || actualPermissions.includes('*:*') || JSON.stringify(actualPermissions) !== JSON.stringify(expectedPermissions)) {
      throw new Error(`role ${roleName} is privileged or invalid`)
    }
    const roleId = strictId(roles[0].id, `${roleName} id`)
    const persona = await credential(email, cfg.personaPassword)
    const memberships = await sql(`SELECT id, user_identity, organization_id, company_id, role_id, is_active FROM user_organization WHERE organization_id = ${organizationId}`)
    const membership = memberships.find(row => unwrap(row.user_identity) === persona.identity)
    if (!membership) {
      await operation(owner.token, 'add_org_member', { userIdentity: identity(persona.identity), params: {
        role_name: roleName, company_id: some(companyId), job_title: some(`Rwanda alpha ${key}`),
        department_id: NONE, employee_id: NONE, is_active: true, is_default: true, metadata: some(marker),
      } })
    } else if (membership.is_active !== true || strictId(membership.company_id, `${email} company`) !== companyId || strictId(membership.role_id, `${email} role`) !== roleId) {
      throw new Error(`existing persona ${email} has a conflicting membership`)
    }
    const assignments = await sql(`SELECT user_identity, role_id, is_active FROM user_role_assignment WHERE organization_id = ${organizationId}`)
    if (!assignments.some(row => unwrap(row.user_identity) === persona.identity && strictId(row.role_id, `${email} assigned role`) === roleId && row.is_active === true)) {
      await operation(owner.token, 'assign_role', { userIdentity: identity(persona.identity), roleId, params: { expires_at_micros: NONE, metadata: some(marker) } })
    }
    const profiles = await sql(`SELECT identity, is_superuser FROM user_profile WHERE organization_id = ${organizationId}`)
    const profile = profiles.find(row => unwrap(row.identity) === persona.identity)
    if (!profile || profile.is_superuser !== false) throw new Error(`persona ${email} must remain a non-platform-superuser`)
    const personaSession = await request(cfg.api, '/v1/session/field-access', persona.token)
    if (Number(personaSession.organizationId) !== organizationId
      || String(personaSession.fieldAccess?.roleName ?? '').toLowerCase() !== roleName) {
      throw new Error(`persona ${email} did not resolve the expected tenant role`)
    }
    await request(cfg.api, '/v1/auth/signin', '', { email, password: cfg.personaPassword })
  }

  const finalCompany = (await sql(`SELECT id, currency_id, address_country_code FROM company WHERE organization_id = ${organizationId} AND id = ${companyId}`))[0]
  if (!finalCompany || unwrap(finalCompany.address_country_code) !== 'RW' || strictId(finalCompany.currency_id, 'final company currency') !== currencyId) {
    throw new Error('final Rwanda company verification failed')
  }
  const result = { organizationId, companyId, currencyId, customerId: contacts.customer, vendorId: contacts.vendor, tenantRef: cfg.tenantRef, operatorEmail: cfg.operatorEmail }
  output('RWANDA_ALPHA_SETUP_VERIFIED')
  output(rehearsalEnvIds(result))
  return result
}

if (process.argv[1]?.endsWith('/setup-rwanda-accounting-alpha.mjs')) {
  runRwandaAccountingSetup().catch(error => {
    console.error(`RWANDA_ALPHA_SETUP_FAILED ${error instanceof Error ? error.message : 'unknown failure'}`)
    process.exitCode = 1
  })
}
