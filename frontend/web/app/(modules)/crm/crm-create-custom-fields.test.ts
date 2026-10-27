import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { assertCrmCreateCustomFieldsSupported } from "./crm-create-custom-fields"

const message = "Saving custom fields during creation is not available yet. Your entries are retained and no record was created."

describe("CRM create custom-field admission", () => {
  it("blocks custom-field entries before a base record can be dispatched", async () => {
    for (const metadata of [{ "custom:region": "North" }, JSON.stringify({ note: "Client", "custom:region": "North" }), { "custom:approval": null }]) {
      let dispatched = false
      await assert.rejects(async () => {
        assertCrmCreateCustomFieldsSupported(metadata, message)
        dispatched = true
      }, { message })
      assert.equal(dispatched, false)
    }
  })

  it("keeps ordinary metadata and normal creation available without rewriting their values", () => {
    for (const metadata of [undefined, null, "", JSON.stringify({ source: "referral", notes: "Client visit" }), { source: "referral" }]) {
      const before = JSON.stringify(metadata)
      assert.doesNotThrow(() => assertCrmCreateCustomFieldsSupported(metadata, message))
      assert.equal(JSON.stringify(metadata), before)
    }
  })
})
