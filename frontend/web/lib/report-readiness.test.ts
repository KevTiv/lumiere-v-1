import assert from "node:assert/strict"
import test from "node:test"
import { parseReadinessIntent, parseReportReadiness, reportReadinessCodes } from "./report-readiness"
const ready = { companyId: 13, agentId: 7, billableCalls: 0, status: "ready", code: null }
test("readiness accepts only an exact scoped no-cost outcome", () => {
  assert.deepEqual(parseReportReadiness(ready, 13, 7), ready)
  for (const changed of [{ companyId: 14 }, { agentId: 8 }, { billableCalls: 1 }, { code: "ready" }, { status: "completed" }, { secret: "private" }]) {
    assert.equal(parseReportReadiness({ ...ready, ...changed }, 13, 7), null)
  }
  assert.equal(parseReportReadiness(null, 13, 7), null)
})
test("every producer blocker is typed and unknown blockers fail closed", () => {
  for (const code of reportReadinessCodes) assert.equal(parseReportReadiness({ ...ready, status: "blocked", code }, 13, 7)?.status, "blocked")
  assert.equal(parseReportReadiness({ ...ready, status: "blocked", code: "new_unreviewed_state" }, 13, 7), null)
})
test("browser intent cannot supply actor, organization, token, policy or unsafe IDs", () => {
  assert.deepEqual(parseReadinessIntent({ companyId: 13, agentId: 7 }), { companyId: 13, agentId: 7 })
  for (const key of ["orgId", "identityHex", "stdbToken", "intelligencePolicyRef"]) assert.equal(parseReadinessIntent({ companyId: 13, agentId: 7, [key]: "forged" }), null)
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "7", null]) assert.equal(parseReadinessIntent({ companyId: 13, agentId: value }), null)
})
