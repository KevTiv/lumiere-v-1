import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  RESOURCE_REGISTRY,
  resolveHttpSqlColumns,
  selectCompanyScopedSql,
  sqlColumnListForGeneratedType,
  type FieldAccessContext,
} from './field-policy'
import { subscriptionQueriesForResource } from './queries/erp-subscriptions'

function access(resource: string, fields?: string[]): FieldAccessContext {
  return {
    organizationId: 7,
    roleId: 9,
    roleName: 'member',
    isSuperuser: false,
    rolePermissions: [`${resource}:read`],
    identityHex: 'actor',
    fieldPermissions: fields ? [{ roleId: 9, resource, action: 'read', allowedFields: fields }] : [],
  }
}

test('subscription line defaults match released SQL columns', () => {
  const generated = sqlColumnListForGeneratedType('SubscriptionLine')
  assert.equal(generated.includes('active'), false)
  assert.equal(RESOURCE_REGISTRY['subscription-lines'].defaultRestricted.includes('active'), true)
  for (const context of [undefined, access('subscription_line')]) {
    const columns = resolveHttpSqlColumns('subscription-lines', context)
    for (const column of columns) {
      assert.ok(generated.includes(column), `unsupported SubscriptionLine SQL column: ${column}`)
    }
    for (const column of ['company_id', 'subscription_id', 'product_id', 'price_unit', 'price_subtotal']) {
      assert.ok(columns.includes(column), `missing subscription line evidence: ${column}`)
    }
  }
})

test('subscription compatibility exclusion stays scoped and honors field masks', () => {
  const columns = resolveHttpSqlColumns('subscription-lines', access('subscription_line', ['active', 'price_unit']))
  assert.deepEqual(columns, ['id', 'organization_id', 'price_unit'])
  assert.ok(resolveHttpSqlColumns('account-journals', undefined).includes('active'))
})

test('bank line defaults preserve exact payment and lifecycle readback', () => {
  for (const context of [undefined, access('account_bank_statement_line')]) {
    const columns = resolveHttpSqlColumns('bank-statement-lines', context)
    for (const column of ['move_ids', 'payment_ids', 'metadata', 'amount_residual']) {
      assert.ok(columns.includes(column), `missing bank settlement evidence: ${column}`)
    }
  }
})

test('bank readback inclusions never override explicit field masks', () => {
  const masked = resolveHttpSqlColumns('bank-statement-lines', access('account_bank_statement_line', ['amount_residual']))
  assert.deepEqual(masked, ['id', 'organization_id', 'amount_residual'])
  const selected = resolveHttpSqlColumns('bank-statement-lines', access('account_bank_statement_line', ['payment_ids', 'metadata']))
  assert.deepEqual(selected, ['id', 'organization_id', 'payment_ids', 'metadata'])
  const unrelated = resolveHttpSqlColumns('subscriptions', access('subscription', ['invoice_ids', 'metadata']))
  assert.deepEqual(unrelated, ['id', 'organization_id'])
})

const financeRelations = [
  ['account-assets', 'account_asset', 'AccountAsset', ['depreciation_board_ids']],
  ['expenses', 'hr_expense', 'HrExpense', ['attachment_ids', 'tax_ids']],
] as const

test('finance owner relations are schema backed and survive explicit grants', () => {
  for (const [resource, alias, typeName, fields] of financeRelations) {
    const generated = sqlColumnListForGeneratedType(typeName)
    const columns = resolveHttpSqlColumns(resource, access(alias, [...fields]))
    for (const field of fields) {
      assert.ok(generated.includes(field), `unknown ${typeName} relation: ${field}`)
      assert.ok(columns.includes(field), `missing authorized ${resource} relation: ${field}`)
    }
  }
})

test('finance relation exceptions honor masks and keep unrelated vectors excluded', () => {
  for (const [resource, alias, , fields] of financeRelations) {
    const masked = resolveHttpSqlColumns(resource, access(alias, ['name']))
    assert.deepEqual(masked, [...RESOURCE_REGISTRY[resource].mandatory, 'name'])
    const selected = resolveHttpSqlColumns(resource, access(alias, [...fields, 'metadata', 'message_ids', 'activity_ids']))
    assert.deepEqual(selected, [...RESOURCE_REGISTRY[resource].mandatory, ...fields])
  }
  assert.deepEqual(resolveHttpSqlColumns('subscriptions', access('subscription', ['attachment_ids', 'tax_ids', 'depreciation_board_ids'])), ['id', 'organization_id'])
})

test('finance browser SQL retains tenant predicates while resolving owner relations', () => {
  const fieldAccess = access('hr_expense', ['attachment_ids', 'tax_ids'])
  const statements = subscriptionQueriesForResource('expenses', { organizationId: 7, fieldAccess })
  assert.ok(statements?.length)
  assert.match(statements[0]!, /attachment_ids, tax_ids FROM hr_expense WHERE organization_id = 7\b/)
  assert.equal(subscriptionQueriesForResource('expenses', { fieldAccess }), null)
  const asset = selectCompanyScopedSql('account-assets', 'account_asset', 33, access('account_asset', ['depreciation_board_ids']), '')
  assert.match(asset, /id, company_id, depreciation_board_ids FROM account_asset WHERE company_id = 33$/)
})
