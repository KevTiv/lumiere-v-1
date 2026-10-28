import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { createLumiereApiClient, registerLumiereApiClient } from '@lumiere/api-client'
import type { CreateSaleOrderParams } from '@lumiere/stdb/types'
import { createdSaleOrderId, withSaleOrderReceipt } from './sales-create-receipt'
import { createSaleOrderDraftCommand } from './sales'

const realFetch = globalThis.fetch
beforeEach(() => registerLumiereApiClient(createLumiereApiClient({ baseUrl: 'http://api.test', credentials: 'omit' })))
afterEach(() => { globalThis.fetch = realFetch; registerLumiereApiClient(null) })

const params: CreateSaleOrderParams = {
  companyId: 2n, partnerId: 3n, partnerInvoiceId: 3n, partnerShippingId: 3n,
  pricelistId: 4n, currencyId: 5n, warehouseId: 6n, orderLines: [],
  origin: undefined, clientOrderRef: undefined, paymentTermId: undefined,
  fiscalPositionId: undefined, teamId: undefined, opportunityId: undefined,
  proposalId: undefined, note: undefined, termsAndConditions: undefined,
  validityDays: undefined, shippingPolicy: undefined, pickingPolicy: undefined,
  campaignId: undefined, mediumId: undefined, sourceId: undefined,
  commitmentDate: undefined, expectedDate: undefined, incotermId: undefined,
  incoterm: undefined, incotermLocation: undefined, carrierId: undefined,
  customerLead: undefined, analyticAccountId: undefined, userId: undefined,
  isPrinted: undefined, isLocked: undefined, isDropship: undefined,
  invoicePolicy: undefined, messageFollowerIds: undefined, messagePartnerIds: undefined,
  messageChannelIds: undefined, activityIds: undefined,
  metadata: '{"commission_rate_percent":5}',
}

test('receipt preserves metadata and matches exactly within organization and company', () => {
  const metadata = withSaleOrderReceipt(params.metadata, 'receipt')
  assert.equal(JSON.parse(metadata).commission_rate_percent, 5)
  const row = { id: '9007199254740993', organizationId: '1', companyId: '2', receipt: 'receipt' }
  assert.equal(createdSaleOrderId([row], 'receipt', 1n, 2n), row.id)
  assert.equal(createdSaleOrderId([{ id: row.id, organization_id: '1', company_id: '2', receipt: 'receipt' }], 'receipt', 1n, 2n), row.id)
  assert.equal(createdSaleOrderId([row], 'other', 1n, 2n), undefined)
  assert.equal(createdSaleOrderId([row], 'receipt', 9n, 2n), undefined)
  assert.equal(createdSaleOrderId([row], 'receipt', 1n, 9n), undefined)
  assert.equal(createdSaleOrderId([row, { ...row, id: '8' }], 'receipt', 1n, 2n), undefined)
  assert.equal(createdSaleOrderId([{ ...row, receipt: undefined }], 'receipt', 1n, 2n), undefined)
});

test('acknowledged creation reads the creator-scoped receipt and returns its exact saved ID', async () => {
  let metadata = ''
  let writes = 0
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      writes++
      const body = JSON.parse(String(init.body))
      const wireMetadata = (typeof body.params === 'string' ? JSON.parse(body.params) : body.params).metadata
      metadata = typeof wireMetadata === 'string' ? wireMetadata : wireMetadata.some
      return new Response('{}')
    }
    const receipt = JSON.parse(metadata).sales_create_receipt
    assert.equal(String(input), `http://api.test/api/sales/order-creations/${receipt}?companyId=2`)
    return Response.json({ data: [{ id: '12', organizationId: '1', companyId: '2', receipt }] })
  }
  assert.deepEqual(await createSaleOrderDraftCommand(params, 1n, 2n), { orderId: '12' })
  assert.equal(writes, 1)
});

test('missing, ambiguous or foreign readback resolves as saved without a repeated write', async () => {
  for (const kind of ['missing', 'duplicate', 'foreign', 'wrong-receipt']) {
    let writes = 0
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'POST') { writes++; return new Response('{}') }
      const receipt = new URL(String(input)).pathname.split('/').at(-1)
      const row = { id: '12', organizationId: '1', companyId: kind === 'foreign' ? '9' : '2', receipt: kind === 'wrong-receipt' ? 'wrong' : receipt }
      return Response.json({ data: kind === 'missing' ? [] : kind === 'duplicate' ? [row, { ...row, id: '13' }] : [row] })
    }
    assert.equal((await createSaleOrderDraftCommand(params, 1n, 2n)).orderId, undefined, kind)
    assert.equal(writes, 1, kind)
  }
});

test('failed readback after save resolves as saved and never repeats creation', async () => {
  let writes = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') { writes++; return new Response('{}') }
    return new Response('unavailable', { status: 503 })
  }
  assert.deepEqual(await createSaleOrderDraftCommand(params, 1n, 2n), {})
  assert.equal(writes, 1)
});

test('a rejected create reports the server reason without reading or retrying', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('Warehouse unavailable', { status: 422 }) }
  await assert.rejects(createSaleOrderDraftCommand(params, 1n, 2n), /Warehouse unavailable/)
  assert.equal(calls, 1)
});
