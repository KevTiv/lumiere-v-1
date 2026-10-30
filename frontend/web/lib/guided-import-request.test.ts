import assert from "node:assert/strict"
import test from "node:test"
import { csvImportRequestBody } from "@lumiere/query-hooks/hooks/csv-import-request"
import { guidedImportRequest } from "./guided-import-request"

test("a product request uses the exact operating company's currency and a tracking id", () => {
  const request=guidedImportRequest({organizationId:7n,companyId:22,entity:"product",csv:"name,sale_price,cost_price\nHistoric product,4800,3000",fileName:"reviewed.csv",companies:[{id:11,currencyId:840},{id:22,currencyId:646}]})
  const body=JSON.parse(csvImportRequestBody(request))
  assert.equal(body.params.companyId,"22")
  assert.equal(body.params.currencyId,"646")
  assert.match(body.requestId,/^[0-9a-f]{32}$/)
  assert.equal(body.fileName,"reviewed.csv")
})

test("unknown product prices cannot pass through an import override or become zero", () => {
  const args={organizationId:7n,companyId:22,entity:"product",fileName:"source.csv",companies:[{id:22,currencyId:646}]}
  for (const csv of ["name\nSausage", "name,sale_price,cost_price\nSausage,4800,", "name,sale_price,cost_price\nSausage,unknown,400", "name,sale_price,cost_price\nSausage,4800,-1"]) {
    assert.throws(()=>guidedImportRequest({...args,csv}),/explicit sale price and cost price/)
  }
  assert.ok(guidedImportRequest({...args,csv:"name,sale_price,cost_price\nBones,0,0"}))
})

test("imports reject missing company/currency and preserve the combined Accounting entry path", () => {
  const args={organizationId:7n,companyId:22,entity:"product",csv:"name\nHistoric product",fileName:"reviewed.csv"}
  assert.throws(()=>guidedImportRequest({...args,companies:[{id:11,currencyId:840}]}),/operating company/)
  assert.throws(()=>guidedImportRequest({...args,companies:[{id:22}]}),/currency/)
  assert.throws(()=>guidedImportRequest({...args,entity:"account_move",companies:[{id:22,currencyId:646}]}),/Accounting/)
  const budget=guidedImportRequest({...args,entity:"budget",companies:[{id:22,currencyId:646}]})
  assert.equal(budget.entity,"crossovered_budget")
})
