import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  RESOURCE_REGISTRY,
  resolveHttpSqlColumns,
  sqlColumnListForGeneratedType,
  type FieldAccessContext,
} from './field-policy'

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
