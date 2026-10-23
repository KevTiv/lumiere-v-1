import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { UpdateContactDetailsParams } from "@lumiere/contracts/generated/types"
import { camelToSnakeIdentifier } from "@lumiere/stdb/stdb-params-json"
import { contactDetailsUpdateRequest } from "./crm"

function body(patch: Parameters<typeof contactDetailsUpdateRequest>[1]) {
  const request = contactDetailsUpdateRequest("42", patch)
  assert.equal(request.urlPath, "/api/operations/erp.update_contact_details")
  assert.equal(request.init.method, "POST")
  const result = JSON.parse(request.init.body as string)
  assert.equal(result.contactId, 42)
  assert.equal("organizationId" in result, false)
  return result.params
}

describe("contact detail update transport", () => {
  it("encodes replacement text with both presence and value options", () => {
    const description = "## Agreed scope\n\n- First item\n\n| Item | Details |\n| --- | --- |\n| A | B |\n"
    const params = body({ firstName: "Ada", description })
    assert.deepEqual(params.first_name, { some: { some: "Ada" } })
    assert.deepEqual(params.description, { some: { some: description } })
  })

  it("distinguishes an explicit clear from an untouched sibling", () => {
    const params = body({ title: null, website: "" })
    assert.deepEqual(params.title, { some: { none: [] } })
    assert.deepEqual(params.website, { some: { some: "" } })
    assert.deepEqual(params.email_secondary, { none: [] })
  })

  it("supplies every released field as unchanged for an empty or undefined patch", () => {
    const fields = Object.keys(UpdateContactDetailsParams.elements).map(camelToSnakeIdentifier).sort()
    for (const patch of [{}, { description: undefined }]) {
      const params = body(patch)
      assert.deepEqual(Object.keys(params).sort(), fields)
      for (const field of fields) assert.deepEqual(params[field], { none: [] })
    }
  })
})
