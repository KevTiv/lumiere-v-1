import type { InsightModule, InsightRecord } from "../../lib/module-insights-model"

export const moduleInsightNow = new Date("2026-10-17T12:00:00Z")
const record = (id: string, extra: InsightRecord = {}): InsightRecord => ({ id, organizationId: 1, companyId: 1, name: `SYNTHETIC ${id}`, currencyId: 1, companyCurrencyId: 1, amountTotal: 1200, totalAmount: 1200, expectedRevenue: 1200, dateOrder: "2026-10-01", createdAt: "2026-10-01", createDate: "2026-10-01", dateDeadline: "2026-10-01", datePlanned: "2026-10-01", receiptStatus: "pending", isWon: false, isLost: false, ...extra })
export function moduleInsightRows(module: InsightModule): InsightRecord[] {
  const states = module === "sales" ? ["Draft", "Sale", "Sent", "ToApprove"] : module === "purchasing" ? ["Draft", "Purchase", "ToApprove", "Purchase"] : module === "expenses" ? ["Draft", "Submitted", "Approved", "Refused"] : module === "reports" ? ["Draft", "Generated", "Exported", "Archived"] : ["open", "won", "lost", "open"]
  const outcomes = (index: number) => module === "crm" ? { isWon: index === 1, isLost: index === 2 } : {}
  return [
    ...states.map((state, index) => record(String(101 + index), { state, ...outcomes(index), name: `Synthetic ${module} ${state}`, receiptStatus: index === 3 ? "full" : "pending" })),
    record("9007199254740993", { state: states[0], name: "Synthetic exact u64 record" }),
    record("201", { state: states[1], ...outcomes(1), name: "Synthetic USD document", currencyId: 2, companyCurrencyId: 2, amountTotal: 250, totalAmount: 250, expectedRevenue: 250 }),
    record("202", { state: states[1], ...outcomes(1), name: "Synthetic previous-period document", dateOrder: "2026-09-01", createdAt: "2026-09-01", createDate: "2026-09-01", amountTotal: 600, totalAmount: 600, expectedRevenue: 600 }),
    record("301", { companyId: 2, state: states[1], ...outcomes(1), name: "Synthetic second company", currencyId: 2, companyCurrencyId: 2, amountTotal: 375, totalAmount: 375, expectedRevenue: 375 }),
    record("999", { companyId: 999, state: states[1], ...outcomes(1), name: "FOREIGN COMPANY MUST STAY HIDDEN", amountTotal: 999999, totalAmount: 999999, expectedRevenue: 999999 }),
  ]
}
