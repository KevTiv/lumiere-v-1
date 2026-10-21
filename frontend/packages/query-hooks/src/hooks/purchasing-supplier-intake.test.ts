import assert from "node:assert/strict"
import test from "node:test"

import { toSubmitSupplierIntakeParams } from "./purchasing-supplier-intake"

test("supplier intake submission emits every optional SATS field", () => {
  const out = toSubmitSupplierIntakeParams({
    companyName: "Northwind",
    contactName: "Ada",
    email: "ada@example.test",
    productCategories: [],
    qualityCertificates: [],
    documents: [],
    phone: "+250700000000",
  })

  assert.equal(out.company_name, "Northwind")
  assert.deepEqual(out.phone, { some: "+250700000000" })
  assert.deepEqual(out.website, { none: [] })
  assert.deepEqual(out.payment_terms_id, { none: [] })
  assert.deepEqual(out.metadata, { none: [] })
})
