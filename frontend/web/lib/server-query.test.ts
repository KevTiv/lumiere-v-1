import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { serverQueryUrl } from "./server-query-url"

describe("serverQueryUrl", () => {
  it("joins base and resource without double slashes", () => {
    assert.equal(
      serverQueryUrl("http://127.0.0.1:8082", "leads"),
      "http://127.0.0.1:8082/v1/query/leads",
    )
  })

  it("strips trailing slash from base", () => {
    assert.equal(
      serverQueryUrl("http://127.0.0.1:8082/", "sale-orders"),
      "http://127.0.0.1:8082/v1/query/sale-orders",
    )
  })

  it("encodes resource path segments", () => {
    assert.equal(
      serverQueryUrl("http://127.0.0.1:8082", "account-moves"),
      "http://127.0.0.1:8082/v1/query/account-moves",
    )
  })
})
