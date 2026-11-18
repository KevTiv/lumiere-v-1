import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { isOperationWrite } from "./ai-index-drain-path"

describe("isOperationWrite", () => {
  it("matches only POSTs to a single operation or reducer segment", () => {
    assert.equal(isOperationWrite("POST", "/api/operations/erp.update_sale_order"), true)
    assert.equal(isOperationWrite("post", "/api/compat/reducer/update_product"), true)
    assert.equal(isOperationWrite("GET", "/api/operations/erp.update_sale_order"), false)
    assert.equal(isOperationWrite("POST", "/api/operations/a/b"), false)
    assert.equal(isOperationWrite("POST", "/api/ai/context/ingest"), false)
    assert.equal(isOperationWrite("POST", "/api/operations/"), false)
  })
})
