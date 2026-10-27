import assert from "node:assert/strict"
import test from "node:test"
import { orderNeedsCustomFieldSave } from "./commercial-order-form-params"
import { toCreateSaleOrderParams, toCreateSaleOrderLineParams } from "./sales-create-params"
import { toAddPurchaseOrderLineParams, toCreatePurchaseOrderParams, toCreateLandedCostParams, toInvoicePoLineArgs, toReceivePoLineArgs, toUpdatePurchaseOrderLineParams } from "./purchasing-create-params"

const exactId = "9007199254740993"

test("create guards distinguish actual custom EAV entries from ordinary order metadata", () => {
  for (const metadata of [undefined, null, "", "not JSON", "[]", '{"validityDate":"2026-11-01","commission_rate_percent":5}', { notes: "Keep this", nested: { "custom:unrelated": 1 } }]) {
    assert.equal(orderNeedsCustomFieldSave(metadata), false)
  }
  for (const metadata of [{ "custom:code": "PO-17" }, '{"custom:code":null}', '{"custom:flag":false}', '{"custom:items":[]}']) {
    assert.equal(orderNeedsCustomFieldSave(metadata), true)
  }
})

test("order parameters retain exact selected currency, party, warehouse and ordinary metadata", () => {
  const sale = toCreateSaleOrderParams({ partnerId: exactId, pricelistId: "4", warehouseId: exactId, clientOrderRef: " Customer ref ", validityDate: "2026-11-01", note: "Keep note", invoicePolicy: "delivery", isDropship: true, commissionRatePercent: "5" }, [{ id: 4n, currencyId: exactId }], 2n)
  assert.ok(sale)
  assert.equal(sale.partnerId, BigInt(exactId))
  assert.equal(sale.partnerInvoiceId, sale.partnerId)
  assert.equal(sale.partnerShippingId, sale.partnerId)
  assert.equal(sale.currencyId, BigInt(exactId))
  assert.equal(sale.warehouseId, BigInt(exactId))
  assert.equal(sale.clientOrderRef, "Customer ref")
  assert.equal(sale.invoicePolicy, "delivery")
  assert.equal(sale.isDropship, true)
  assert.deepEqual(sale.orderLines, [])
  assert.equal(orderNeedsCustomFieldSave(sale.metadata), false)
  const purchase = toCreatePurchaseOrderParams({ partnerId: exactId, pricelistId: "4", partnerRef: "Vendor ref", notes: "Keep notes", metadata: '{"source":"manual"}' }, [{ id: 4n, currencyId: exactId }])
  assert.ok(purchase)
  assert.equal(purchase.partnerId, BigInt(exactId))
  assert.equal(purchase.currencyId, BigInt(exactId))
  assert.equal(purchase.metadata, '{"source":"manual"}')
  assert.equal(purchase.companyId, undefined) // The existing mutation hook supplies company scope.
})

test("purchasing item, receive and recorded-invoice IDs never round through Number", () => {
  const line = toAddPurchaseOrderLineParams({ orderId: exactId, productId: exactId, uomId: exactId, quantity: "2", priceUnit: "37.5", lotId: exactId })
  assert.deepEqual(line, { productId: BigInt(exactId), quantity: 2, uomId: BigInt(exactId), priceUnit: 37.5, lotId: BigInt(exactId) })
  assert.deepEqual(toReceivePoLineArgs({ lineId: exactId, qty: "2", lotId: exactId }), { lineId: BigInt(exactId), qty: 2, lotId: BigInt(exactId) })
  assert.deepEqual(toInvoicePoLineArgs({ lineId: exactId, qty: "2" }), { lineId: BigInt(exactId), qty: 2 })
  const landed = toCreateLandedCostParams({ pickingId: exactId, currencyId: "1", date: "2026-10-27", amountTotal: "12" })
  assert.deepEqual(landed?.pickingIds, [BigInt(exactId)])
})

test("line edits preserve absent versus explicitly cleared taxes and reject invalid exact IDs", () => {
  const fields = { lineId: exactId, quantity: "2", priceUnit: "37.5", productId: exactId, uomId: exactId }
  assert.equal(Object.hasOwn(toUpdatePurchaseOrderLineParams(fields)!, "taxIds"), false)
  assert.deepEqual(toUpdatePurchaseOrderLineParams({ ...fields, taxIds: [] })?.taxIds, [])
  assert.deepEqual(toUpdatePurchaseOrderLineParams({ ...fields, taxIds: [exactId] })?.taxIds, [BigInt(exactId)])
  assert.equal(toUpdatePurchaseOrderLineParams({ ...fields, taxIds: ["invalid"] }), null)
  for (const invalid of ["1.5", "-1", "0", "18446744073709551616", true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(toReceivePoLineArgs({ lineId: invalid, qty: 2 }), null)
    assert.equal(toAddPurchaseOrderLineParams({ orderId: "1", productId: invalid, uomId: "2", quantity: 1, priceUnit: 0 }), null)
  }
})

test("line form grouping does not change accepted zero prices, discounts, tax selection or line order", () => {
  const line = toCreateSaleOrderLineParams({ productId: exactId, uomId: "2", quantity: "3", priceUnit: "0", discount: "0", taxIds: ["7"], sequence: "10", name: "Client work" })
  assert.ok(line)
  assert.equal(line.productId, BigInt(exactId))
  assert.equal(line.quantity, 3)
  assert.equal(line.priceUnit, 0)
  assert.equal(line.discount, 0)
  assert.deepEqual(line.taxIds, [7n])
  assert.equal(line.sequence, 10)
  assert.equal(line.name, "Client work")
})
