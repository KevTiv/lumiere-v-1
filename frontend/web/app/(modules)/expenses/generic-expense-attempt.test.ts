import assert from "node:assert/strict"
import test from "node:test"
import type { FormConfig, FormValues } from "@lumiere/ui/lib/form-types"
import type { ExpenseCaptureOutboxItem } from "../../../lib/expense-capture-outbox"
import { toCreateExpenseParams } from "../../../lib/expenses-create-params"
import { expenseInputsForLineKind } from "./expense-capture-input"
import { genericExpensePayload, pendingGenericExpense, retainedExpenseForm } from "./generic-expense-attempt"
import { capturePayloadToParams } from "./expense-capture-sync"

const values: FormValues = { employeeId: "7", pricelistId: "4", name: "Client visit", date: "2026-10-27", totalAmount: "32.25", quantity: "2", description: "Project work", hasReceipt: true, lineKind: "Standard", paymentMode: "CorporateCard", merchantKey: "Vendor", productId: "10", taxIds: ["11", "12"], accountId: "13", analyticAccountId: "14", projectId: "15", mileageDistance: "99", mileageRateId: "16", perDiemDays: "5", perDiemRateId: "17" }
function item(): ExpenseCaptureOutboxItem {
  return { clientRequestId: "expense-original", companyId: "2", deviceId: "device", createdAt: "2026-10-27", syncState: "unknown", formOrigin: { actorIdentity: "actor", organizationId: "9", pricelistId: "4" }, payload: genericExpensePayload(toCreateExpenseParams(expenseInputsForLineKind(values), 8n)!, values), receipt: { clientRequestId: "receipt-original", state: "queued", fileName: "receipt.pdf", fileSize: 10, mimeType: "application/pdf", lastModified: 1000 } }
}

test("full generic payload round trips every admitted create value without hidden conditional values", () => {
  for (const lineKind of ["Standard", "Mileage", "PerDiem"] as const) {
    const inputs = { ...values, lineKind }
    const params = toCreateExpenseParams(expenseInputsForLineKind(inputs), 8n)!
    const payload = genericExpensePayload(params, inputs)
    const restored = capturePayloadToParams(payload, 2n, "expense-original", [99n])
    assert.deepEqual(restored, { ...params, companyId: 2n, clientRequestId: "expense-original", attachmentIds: [99n], unitAmount: lineKind === "Standard" ? params.unitAmount : 0, quantity: lineKind === "Standard" ? params.quantity : 1 })
  }
})

test("retained form uses same ID, locks business fields, and permits only pre-dispatch receipt reattachment", () => {
  const config: FormConfig = { id: "new-expense", title: "Expense", sections: [{ id: "fields", fields: [ { id: "name", name: "name", type: "text", label: "Name" }, { id: "receiptFile", name: "receiptFile", type: "file", label: "Receipt" } ] }] }
  const retained = item()
  const unknown = retainedExpenseForm(config, retained)
  assert.equal(unknown.id, config.id)
  assert.equal(unknown.sections[0]?.fields[0]?.defaultValue, values.name)
  assert.ok(unknown.sections[0]?.fields.every((field) => field.disabled))
  const unsent = retainedExpenseForm(config, { ...retained, syncState: "error" })
  assert.equal(unsent.sections[0]?.fields[0]?.disabled, true)
  assert.equal(unsent.sections[0]?.fields[1]?.disabled, false)
})

test("resume selects exact actor without newest-row inference and refuses ambiguity", () => {
  const retained = item()
  assert.equal(pendingGenericExpense([retained], "actor")?.clientRequestId, "expense-original")
  assert.equal(pendingGenericExpense([retained], "another"), null)
  assert.equal(pendingGenericExpense([{ ...retained, syncState: "synced" }], "actor"), null)
  assert.throws(() => pendingGenericExpense([retained, { ...retained, clientRequestId: "other" }], "actor"), /Multiple/)
})
