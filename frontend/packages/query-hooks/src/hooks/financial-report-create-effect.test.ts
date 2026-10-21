import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { toCreateFinancialReportParams } from "@lumiere/erp-shared/reports-create-params"
import { financialReportInputKey, resolveFinancialReportCreation } from "./financial-report-create-effect"
import { AmbiguousOperationEffectError } from "./operation-effect"

const params = toCreateFinancialReportParams({ name: "October close", dateFrom: "2026-10-01T00:00:00.000000Z", dateTo: "2026-10-31T23:59:59.999999Z", currencyId: "4", reportType: "trialBalance", targetMove: "posted" })!
const requestId = "report-request-a"
const row = { ...params, id: "9007199254740993", organizationId: 1n, companyId: 2n, state: { tag: "Generated" }, metadata: JSON.stringify({ lumiere_report_request: requestId, input_fingerprint: financialReportInputKey(params) }) }
describe("financial report create effect", () => {
  it("resolves the exact requested report with full u64 identity and microsecond dates", () => {
    assert.equal(params.dateTo.microsSinceUnixEpoch % 1000n, 999n)
    assert.equal(resolveFinancialReportCreation([{ id: "9007199254740992" }], [row], { organizationId: 1n, companyId: 2n }, params, requestId)?.id, row.id)
  })
  it("ignores concurrent same-name reports with other requests, dates, currencies or companies", () => {
    const concurrent = [{ ...row, id: "10", metadata: JSON.stringify({ lumiere_report_request: "other", input_fingerprint: financialReportInputKey(params) }) }, { ...row, id: "11", companyId: 8n }, { ...row, id: "12", currencyId: 9n }, { ...row, id: "13", dateTo: { microsSinceUnixEpoch: params.dateTo.microsSinceUnixEpoch - 1n } }]
    assert.equal(resolveFinancialReportCreation([], [...concurrent, row], { organizationId: 1n, companyId: 2n }, params, requestId), row)
    assert.equal(resolveFinancialReportCreation([], concurrent, { organizationId: 1n, companyId: 2n }, params, requestId), null)
  })
  it("rejects duplicate exact effects and never selects an existing or incomplete projection", () => {
    assert.throws(() => resolveFinancialReportCreation([], [row, { ...row, id: "14" }], { organizationId: 1n, companyId: 2n }, params, requestId), AmbiguousOperationEffectError)
    assert.equal(resolveFinancialReportCreation([row], [row], { organizationId: 1n, companyId: 2n }, params, requestId), null)
    assert.equal(resolveFinancialReportCreation([], [{ ...row, targetMove: undefined }], { organizationId: 1n, companyId: 2n }, params, requestId), null)
  })
})
