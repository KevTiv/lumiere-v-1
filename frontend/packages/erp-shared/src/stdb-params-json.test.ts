import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { camelToSnakeIdentifier, stdbParamsToJson } from "./stdb-params-json.ts"

describe("stdbParamsToJson", () => {
  it("converts top-level camelCase keys to snake_case", () => {
    assert.deepEqual(
      stdbParamsToJson({ contactName: "Ada", partnerId: 1n }),
      { contact_name: "Ada", partner_id: 1 },
    )
  })

  it("converts nested object keys recursively", () => {
    assert.deepEqual(
      stdbParamsToJson({
        autoPost: true,
        lineIds: [{ productId: 2, taxIds: [1, 2] }],
      }),
      {
        auto_post: true,
        line_ids: [{ product_id: 2, tax_ids: [1, 2] }],
      },
    )
  })

  it("leaves already snake_case keys unchanged", () => {
    assert.deepEqual(stdbParamsToJson({ company_id: 7, active: false }), {
      company_id: 7,
      active: false,
    })
  })
})

describe("camelToSnakeIdentifier", () => {
  it("handles Odoo-style relation suffixes", () => {
    assert.equal(camelToSnakeIdentifier("showLotsM2O"), "show_lots_m2o")
    assert.equal(camelToSnakeIdentifier("partnerM2M"), "partner_m2m")
  })

  it("handles numeric image field suffixes", () => {
    assert.equal(camelToSnakeIdentifier("image1920Url"), "image_1920_url")
    assert.equal(camelToSnakeIdentifier("image128Url"), "image_128_url")
  })
})
