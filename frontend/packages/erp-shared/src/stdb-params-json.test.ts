import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  camelToSnakeIdentifier,
  encodeReducerCallArgs,
  encodeTaggedUnitEnum,
  stdbParamsToJson,
} from "./stdb-params-json.ts"

describe("stdbParamsToJson", () => {
  it("converts top-level camelCase keys to snake_case", () => {
    assert.deepEqual(
      stdbParamsToJson({ contactName: "Ada", partnerId: 1n }),
      { contact_name: "Ada", partner_id: 1 },
    )
  })

  it("wraps Option fields when structName is provided", () => {
    assert.deepEqual(
      stdbParamsToJson(
        { contactName: "Ada", email: undefined, partnerId: 1n },
        "CreateLeadParams",
      ),
      {
        contact_name: { some: "Ada" },
        partner_id: { some: 1 },
      },
    )
  })

  it("encodes Option<u64> zero as none for struct fields", () => {
    assert.deepEqual(
      stdbParamsToJson({ companyId: 0n }, "CreateContactParams"),
      { company_id: { none: [] } },
    )
  })

  it("encodeReducerCallArgs SATS-encodes the trailing params object", () => {
    assert.deepEqual(
      encodeReducerCallArgs("create_lead", [
        1,
        { name: "L", contactName: "L", email: "a@b.test", tagIds: [] },
      ]),
      [
        1,
        {
          name: "L",
          contact_name: { some: "L" },
          email: { some: "a@b.test" },
          tag_ids: [],
        },
      ],
    )
  })

  it("encodes timestamps for SpacetimeDB HTTP", () => {
    assert.deepEqual(
      stdbParamsToJson({
        dateFrom: { microsSinceUnixEpoch: 1_700_000_000_000_000n },
      }),
      {
        date_from: { __timestamp_micros_since_unix_epoch__: 1_700_000_000_000_000 },
      },
    )
  })

  it("encodes tagged unit enums as SATS sum JSON", () => {
    assert.deepEqual(
      stdbParamsToJson({ discountPolicy: { tag: "WithDiscount" } }),
      { discount_policy: { withDiscount: [] } },
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

describe("encodeTaggedUnitEnum", () => {
  it("lowercases the first character of the tag", () => {
    assert.deepEqual(encodeTaggedUnitEnum({ tag: "Percent" }), { percent: [] })
    assert.deepEqual(encodeTaggedUnitEnum({ tag: "PythonCode" }), { pythonCode: [] })
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
