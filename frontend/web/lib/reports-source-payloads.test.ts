import assert from "node:assert/strict"
import test from "node:test"
import { toCreateReportTemplatePayload, toCreateScheduledReportPayload } from "./reports-module-form-payloads"

for (const map of [toCreateReportTemplatePayload, toCreateScheduledReportPayload]) {
  test(`${map.name} uses the selected preset after switching from custom`, () => {
    const payload = map({ reportSource: "account.move", model: "custom.source", name: "Finance" })
    assert.equal(payload.model, "account.move")
    assert.equal("reportSource" in payload, false)
  })
  test(`${map.name} preserves a custom identifier and old callers`, () => {
    assert.equal(map({ reportSource: "__custom__", model: "custom.source" }).model, "custom.source")
    assert.equal(map({ model: "legacy.source" }).model, "legacy.source")
  })
}
