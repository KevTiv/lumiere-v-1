import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  camelToSnakeIdentifier,
  encodeOptionalString,
  encodeOptionalTimestamp,
  encodeReducerCallArgs,
  encodeTaggedUnitEnum,
  stdbParamsToJson,
} from "./stdb-params-json"

describe("stdbParamsToJson", () => {
  it("converts top-level camelCase keys to snake_case", () => {
    assert.deepEqual(
      stdbParamsToJson({ contactName: "Ada", partnerId: 1n }),
      { contact_name: "Ada", partner_id: 1 },
    )
  })

  it("wraps Option fields when structName is provided", () => {
    const out = stdbParamsToJson(
      { contactName: "Ada", email: undefined, partnerId: 1n },
      "CreateLeadParams",
    )
    assert.deepEqual(out.contact_name, { some: "Ada" })
    assert.deepEqual(out.partner_id, { some: 1 })
    assert.deepEqual(out.email, { none: [] })
    assert.deepEqual(out.phone, { none: [] })
  })

  it("emits explicit none for every missing Option field in a struct", () => {
    const out = stdbParamsToJson(
      {
        name: "Smoke Lead",
        priority: "Medium",
        state: "new",
        expectedRevenue: 1000,
        probability: 0,
        tagIds: [],
        contactName: "Ada",
        email: "ada@example.test",
      },
      "CreateLeadParams",
    )
    assert.deepEqual(out.phone, { none: [] })
    assert.deepEqual(out.mobile, { none: [] })
    assert.deepEqual(out.company_name, { none: [] })
    assert.deepEqual(out.email, { some: "ada@example.test" })
  })

  it("encodes Option<u64> zero as none for struct fields", () => {
    const out = stdbParamsToJson({ companyId: 0n }, "CreateContactParams")
    assert.deepEqual(out.company_id, { none: [] })
    assert.deepEqual(out.phone, { none: [] })
  })

  it("encodeReducerCallArgs SATS-encodes the trailing params object", () => {
    const encoded = encodeReducerCallArgs("create_lead", [
      1,
      { name: "L", contactName: "L", email: "a@b.test", tagIds: [] },
    ])
    assert.equal(encoded[0], 1)
    const params = encoded[1] as Record<string, unknown>
    assert.equal(params.name, "L")
    assert.deepEqual(params.contact_name, { some: "L" })
    assert.deepEqual(params.email, { some: "a@b.test" })
    assert.deepEqual(params.tag_ids, [])
    assert.deepEqual(params.phone, { none: [] })
  })

  it("encodeReducerCallArgs SATS-encodes convert_lead_to_customer params", () => {
    const encoded = encodeReducerCallArgs("convert_lead_to_customer", [
      1,
      42,
      {
        createContact: true,
        createOpportunity: true,
        opportunityStageId: 7,
      },
    ])
    assert.equal(encoded[0], 1)
    assert.equal(encoded[1], 42)
    const params = encoded[2] as Record<string, unknown>
    assert.equal(params.create_contact, true)
    assert.equal(params.create_opportunity, true)
    assert.deepEqual(params.opportunity_stage_id, { some: 7 })
    assert.deepEqual(params.contact_type, { none: [] })
    assert.deepEqual(params.metadata, { none: [] })
  })

  it("encodeReducerCallArgs snake_cases convert_opportunity_to_sale_order params", () => {
    const encoded = encodeReducerCallArgs("convert_opportunity_to_sale_order", [
      99,
      { pricelistId: 3, warehouseId: 5 },
    ])
    assert.equal(encoded[0], 99)
    const params = encoded[1] as Record<string, unknown>
    assert.equal(params.pricelist_id, 3)
    assert.equal(params.warehouse_id, 5)
  })

  it("encodeReducerCallArgs SATS-encodes flat Option args for create_proposal", () => {
    const encoded = encodeReducerCallArgs("create_proposal", [
      1,
      "Title",
      "Client",
      5000,
      null,
      "",
      null,
    ])
    assert.deepEqual(encoded[4], { none: [] })
    assert.deepEqual(encoded[5], { none: [] })
    assert.deepEqual(encoded[6], { none: [] })
  })

  it("encodeReducerCallArgs SATS-encodes flat Option args for update_payment_term", () => {
    const encoded = encodeReducerCallArgs("update_payment_term", [
      1,
      42,
      null,
      null,
      false,
    ])
    assert.deepEqual(encoded[2], { none: [] })
    assert.deepEqual(encoded[3], { none: [] })
    assert.deepEqual(encoded[4], { some: false })
  })

  it("encodeOptionalString treats empty string as none", () => {
    assert.deepEqual(encodeOptionalString(""), { none: [] })
    assert.deepEqual(encodeOptionalString("notes"), { some: "notes" })
  })

  it("encodeOptionalTimestamp encodes Date values for SpacetimeDB HTTP", () => {
    const d = new Date("2026-01-15T12:00:00.000Z")
    const encoded = encodeOptionalTimestamp(d)
    assert.ok(encoded && typeof encoded === "object" && "some" in encoded)
    const ts = (encoded as { some: Record<string, unknown> }).some
    assert.equal(
      ts.__timestamp_micros_since_unix_epoch__,
      Number(BigInt(d.getTime()) * 1000n),
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

  it("encodeReducerCallArgs SATS-encodes update_sale_order params", () => {
    const encoded = encodeReducerCallArgs("update_sale_order", [
      42,
      { clientOrderRef: "SO-UPDATED" },
    ])
    assert.equal(encoded[0], 42)
    const params = encoded[1] as Record<string, unknown>
    assert.deepEqual(params.client_order_ref, { some: "SO-UPDATED" })
    assert.deepEqual(params.note, { none: [] })
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

  it("emits explicit none for CreatePaymentTermParams option fields", () => {
    const out = stdbParamsToJson({ name: "Net 30" }, "CreatePaymentTermParams")
    assert.equal(out.name, "Net 30")
    assert.deepEqual(out.note, { none: [] })
  })

  it("wraps Option<TicketPriority> on UpdateTicketParams", () => {
    const out = stdbParamsToJson(
      { name: "Updated", priority: { tag: "High" } },
      "UpdateTicketParams",
    )
    assert.deepEqual(out.name, { some: "Updated" })
    assert.deepEqual(out.priority, { some: { high: [] } })
    assert.deepEqual(out.description, { none: [] })
    assert.deepEqual(out.stage_id, { none: [] })
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
