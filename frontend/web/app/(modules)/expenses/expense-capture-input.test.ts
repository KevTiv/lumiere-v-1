import assert from "node:assert/strict"
import test from "node:test"
import type { FormConfig } from "@lumiere/ui/lib/form-types"
import type { TFunction } from "i18next"
import { newExpenseForm, editExpenseForm } from "@lumiere/ui/lib/expenses-form-configs"
import { mergeSelectOptionsForFields } from "@lumiere/ui/lib/form-config-merge"
import { toCreateExpenseParams } from "@/lib/expenses-create-params"
import {
  expenseCompanyLookupRows, expenseInputsForLineKind, expenseProductLookupRows,
  expenseReceiptFromUpload, expenseTaxLookupRows, createExpenseReceiptAttemptCache, preserveExpenseEditSelections,
  expenseCreateContext,
  expenseDefaultEmployee, expenseEmployeeDefaultForm, expensePricelistLookupRows,
} from "./expense-capture-input"

const t = ((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key) as TFunction
const entered = {
  employeeId: "1", date: "2026-10-20", name: "Trip", totalAmount: 9999, quantity: 777,
  mileageDistance: 20, mileageRateId: "2", perDiemDays: 3, perDiemRateId: "4", taxIds: ["7"],
}

test("employee default requires one current company active link to the exact actor, with visible source", () => {
  const actor = "ab".repeat(32)
  const employee = { id: "9007199254740993", organizationId: 9n, companyId: 2n, userId: actor, isActive: true, deletedAt: null }
  assert.equal(expenseDefaultEmployee([employee], 9n, 2n, actor), "9007199254740993")
  assert.equal(expenseDefaultEmployee([employee], 9n, 2n, `0x${actor.toUpperCase()}`), "9007199254740993")
  for (const rows of [[{ ...employee, userId: "cd".repeat(32) }], [{ ...employee, companyId: 3n }],
    [{ ...employee, organizationId: 3n }], [{ ...employee, isActive: false }], [{ ...employee, deletedAt: "yesterday" }],
    [{ ...employee, deletedAt: undefined }], [employee, { ...employee, id: "2" }]]) {
    assert.equal(expenseDefaultEmployee(rows, 9n, 2n, actor), undefined)
  }
  const { deletedAt: _omitted, ...maskedEmployee } = employee
  assert.equal(expenseDefaultEmployee([maskedEmployee], 9n, 2n, actor), undefined)
  assert.equal(expenseDefaultEmployee([employee], 9n, 2n, null), undefined)
  const config = expenseEmployeeDefaultForm(newExpenseForm(t), employee.id, "From your linked employee")
  const field = config.sections.flatMap((section) => section.fields).find((field) => field.name === "employeeId")
  assert.equal(field?.defaultValue, employee.id)
  assert.equal(field?.description, "From your linked employee")
})

test("employee defaults preserve unsupported field shapes and unrelated selectors", () => {
  const config: FormConfig = { ...newExpenseForm(t), sections: [{ id: "alternate-fields", fields: [
    { id: "employee-number", name: "employeeId", type: "number", defaultValue: 7, description: "Existing numeric control" },
    { id: "employee-checkbox", name: "employeeId", type: "checkbox", defaultValue: false },
    { id: "project", name: "projectId", type: "select", defaultValue: "project-1", options: [{ value: "project-1", label: "Current project" }] },
  ] }] }
  const result = expenseEmployeeDefaultForm(config, "9007199254740993", "From your linked employee")
  for (const [index, field] of config.sections[0].fields.entries()) {
    assert.equal(result.sections[0].fields[index], field)
  }
  assert.equal(result.sections[0].fields[0].defaultValue, 7)
  assert.equal(result.sections[0].fields[0].description, "Existing numeric control")
  assert.equal(result.sections[0].fields[1].defaultValue, false)
})

test("price list currency choices require declared organization/company scope and active state", () => {
  const row = { id: 4n, organizationId: 9n, companyId: null, currencyId: 5n, isActive: true }
  assert.deepEqual(expensePricelistLookupRows([row, { ...row, id: 5n, companyId: 2n }], 9n, 2n).map((row) => row.id), [4n, 5n])
  for (const patch of [{ organizationId: 8n }, { companyId: 3n }, { isActive: false }, { currencyId: 0n }]) {
    assert.deepEqual(expensePricelistLookupRows([{ ...row, ...patch }], 9n, 2n), [])
  }
  const { companyId: _masked, ...masked } = row
  assert.deepEqual(expensePricelistLookupRows([masked], 9n, 2n), [])
})

test("expense prerequisites reject unavailable employee, price list and currency before an upload or create", () => {
  const employees = [{ id: 1n, organizationId: 9n, companyId: 2n }]
  const pricelists = [{ id: 4n, currencyId: 5n }]
  const values = { ...entered, pricelistId: "4" }
  for (const employeeId of ["", "invalid", "7", "0"]) {
    assert.throws(() => expenseCreateContext({ ...values, employeeId }, employees, pricelists, 9n, 2n, t), /Select an employee available/)
  }
  assert.throws(() => expenseCreateContext(values, employees, pricelists, 9n, 3n, t), /Select an employee available/)
  assert.throws(() => expenseCreateContext(values, employees, pricelists, 9n, 0n, t), /Select a company/)
  for (const pricelistId of ["", "invalid", "8", "0"]) {
    assert.throws(() => expenseCreateContext({ ...values, pricelistId }, employees, pricelists, 9n, 2n, t), /Select an available price list/)
  }
  for (const currencyId of [undefined, null, "invalid", 0n]) {
    assert.throws(() => expenseCreateContext(values, employees, [{ id: 4n, currencyId }], 9n, 2n, t), /no valid currency/)
  }
  assert.deepEqual(values, { ...entered, pricelistId: "4" })
})

test("validated expense context preserves exact chosen employee, currency, quantity and receipt payload", () => {
  const values = { ...entered, pricelistId: "4", clientRequestId: "same-command" }
  const context = expenseCreateContext(values, [{ id: 1n, organizationId: 9n, companyId: 2n }], [{ id: 4n, currencyId: 5n }], 9n, 2n, t)
  const params = toCreateExpenseParams(expenseInputsForLineKind(values), context.currencyId, [31n])
  assert.equal(params?.employeeId, 1n)
  assert.equal(params?.currencyId, 5n)
  assert.equal(params?.unitAmount, 9999)
  assert.equal(params?.quantity, 777)
  assert.deepEqual(params?.attachmentIds, [31n])
  assert.equal(params?.clientRequestId, "same-command")
})

test("capture entry groups evidence and purpose before pricing and preserves all operation fields", () => {
  const form = newExpenseForm(t)
  assert.deepEqual(form.sections.map((section) => section.id), ["expense-details", "expense-amounts", "expense-optional"])
  const fields = form.sections.flatMap((section) => section.fields)
  assert.ok(fields.findIndex((field) => field.name === "receiptFile") < fields.findIndex((field) => field.name === "pricelistId"))
  assert.equal(fields.find((field) => field.name === "totalAmount")?.label, "Unit amount")
  assert.match(fields.find((field) => field.name === "quantity")?.description ?? "", /empty for one unit/)
  assert.equal(fields.find((field) => field.name === "pricelistId")?.required, true)
  assert.equal(fields.find((field) => field.name === "employeeId")?.required, true)
})

test("switching back to Standard strips stale distance, day and rate values from the create payload", () => {
  const params = toCreateExpenseParams(expenseInputsForLineKind({ ...entered, lineKind: "Standard" }), 5n)
  assert.equal(params?.unitAmount, 9999)
  assert.equal(params?.mileageDistance, undefined)
  assert.equal(params?.mileageRateId, undefined)
  assert.equal(params?.perDiemDays, undefined)
  assert.equal(params?.perDiemRateId, undefined)
  assert.deepEqual(params?.taxIds, [7n])
  assert.equal(entered.mileageDistance, 20)
})

test("Mileage and PerDiem payloads cannot carry stale manual amounts or the other kind's rate", () => {
  const mileage = toCreateExpenseParams(expenseInputsForLineKind({ ...entered, lineKind: "Mileage" }), 5n)
  assert.equal(mileage?.mileageDistance, 20)
  assert.equal(mileage?.mileageRateId, 2n)
  assert.equal(mileage?.perDiemDays, undefined)
  assert.equal(mileage?.perDiemRateId, undefined)
  assert.notEqual(mileage?.unitAmount, entered.totalAmount)
  assert.notEqual(mileage?.quantity, entered.quantity)
  const daily = toCreateExpenseParams(expenseInputsForLineKind({ ...entered, lineKind: "PerDiem" }), 5n)
  assert.equal(daily?.perDiemDays, 3)
  assert.equal(daily?.perDiemRateId, 4n)
  assert.equal(daily?.mileageRateId, undefined)
})

test("edit sanitization uses the persisted kind rather than a stale or changed form discriminator", () => {
  const edited = expenseInputsForLineKind({ ...entered, lineKind: "Standard", unitAmount: 12345 }, { tag: "Mileage" })
  assert.equal(edited.lineKind, "Mileage")
  assert.equal(edited.unitAmount, undefined)
  assert.equal(edited.quantity, undefined)
  assert.equal(edited.perDiemDays, undefined)
  assert.equal(edited.mileageDistance, 20)
})

test("company-owned lookups reject missing scope and foreign organization/company rows", () => {
  const same = { id: 1n, organizationId: 9n, companyId: 2n, name: "Our project" }
  const rows = [same, { organization_id: 9, company_id: 3 }, { organizationId: 8, companyId: 2 }, { organizationId: 9 }, { companyId: 2 }]
  assert.deepEqual(expenseCompanyLookupRows(rows, 9n, 2n), [same])
  assert.deepEqual(expenseCompanyLookupRows(rows, 9n, 0n), [])
})

test("catalog selection requires explicit expense eligibility in the current organization", () => {
  const candidate = { id: 1, organizationId: 9, name: "Travel product", active: true, canBeExpensed: true }
  const snake = { id: 2, organization_id: 9, name: "Mileage product", active: true, can_be_expensed: true }
  const rows = [candidate, snake,
    { ...candidate, id: 3, organizationId: 8 },
    { ...candidate, id: 4, active: false },
    { ...candidate, id: 5, canBeExpensed: false },
    { ...candidate, id: 6, canBeExpensed: undefined },
    { ...candidate, id: 7, canBeExpensed: null },
  ]
  assert.deepEqual(expenseProductLookupRows(rows, 9n), [candidate, snake])
})

test("tax choices contain active current-company purchase or unrestricted-use taxes only", () => {
  const base = { organizationId: 9, companyId: 2, name: "Tax", active: true }
  const purchase = { ...base, id: 1, typeTaxUse: { tag: "Purchase" } }
  const allUses = { ...base, id: 2, typeTaxUse: "None" }
  const rows = [purchase, allUses, { ...base, id: 3, typeTaxUse: "Sale" }, { ...purchase, id: 4, active: false }, { ...purchase, id: 5, companyId: 3 }, { ...purchase, id: 6, companyId: undefined }]
  assert.deepEqual(expenseTaxLookupRows(rows, 9n, 2n), [purchase, allUses])
})

test("receipt registration uses the completed upload key, checksum, name and MIME type", () => {
  const receipt = expenseReceiptFromUpload({ objectKey: "completed-upload-key", checksum: "verified-checksum", fileName: "receipt.pdf", mimetype: "application/pdf", fileSize: 10n, url: "https://example.test/receipt" }, 7n, "rcpt-request")
  assert.deepEqual(receipt, { employeeId: 7n, storageKey: "completed-upload-key", contentHash: "verified-checksum", fileName: "receipt.pdf", mimeType: "application/pdf", clientRequestId: "rcpt-request" })
})

test("capture configurations hide kind-specific inputs and expose linked controls instead of manual keys", () => {
  for (const config of [newExpenseForm(t), editExpenseForm(t)]) {
    const fields = config.sections.flatMap((section) => section.fields)
    assert.equal(fields.some((field) => field.name === "storageKey"), false)
    assert.deepEqual(fields.find((field) => field.name === "mileageDistance")?.visibleWhen, { field: "lineKind", equals: "Mileage" })
    assert.deepEqual(fields.find((field) => field.name === "perDiemDays")?.visibleWhen, { field: "lineKind", equals: "PerDiem" })
    const product = fields.find((field) => field.name === "productId")
    assert.equal(product?.type, "select")
    assert.equal(product?.type === "select" && product.searchable, true)
    assert.equal(fields.find((field) => field.name === "taxIds")?.type, "multiselect")
    const merged = mergeSelectOptionsForFields(config, { taxIds: [{ value: "7", label: "Purchase VAT" }] })
    const tax = merged.sections.flatMap((section) => section.fields).find((field) => field.name === "taxIds")
    assert.equal(tax?.type === "multiselect" && tax.options[0]?.label, "Purchase VAT")
  }
})

const uploadedReceipt = { objectKey: "completed-key", checksum: "verified-sha256", fileName: "receipt.pdf", mimetype: "application/pdf", fileSize: 10n, url: "https://example.test/receipt" }
const receiptScope = { organizationId: 9n, companyId: 2n, employeeId: 7n }

test("failed receipt registration retry reuses the completed upload and stable request identity", async () => {
  const resolve = createExpenseReceiptAttemptCache()
  const file = new File(["receipt"], "receipt.pdf", { type: "application/pdf" })
  let uploads = 0
  let keys = 0
  const registrations: Array<ReturnType<typeof expenseReceiptFromUpload>> = []
  const services = {
    upload: async () => { uploads++; return uploadedReceipt },
    newRequestId: () => `rcpt-${++keys}`,
    register: async (params: ReturnType<typeof expenseReceiptFromUpload>) => {
      registrations.push(params)
      if (registrations.length === 1) throw new Error("Receipt response lost")
      return 11n
    },
  }
  await assert.rejects(resolve(file, receiptScope, services), /Receipt response lost/)
  assert.equal(await resolve(file, receiptScope, services), 11n)
  assert.equal(uploads, 1)
  assert.equal(keys, 1)
  assert.equal(registrations.length, 2)
  assert.equal(registrations[0].clientRequestId, registrations[1].clientRequestId)
  assert.equal(registrations[0].storageKey, "completed-key")
  assert.equal(registrations[0].storageKey, registrations[1].storageKey)
})

test("a resolved receipt survives a failed expense update without another upload or registration", async () => {
  const resolve = createExpenseReceiptAttemptCache()
  const file = new File(["receipt"], "receipt.pdf")
  let uploads = 0
  let registrations = 0
  const services = {
    upload: async () => { uploads++; return uploadedReceipt },
    register: async () => { registrations++; return 12n },
    newRequestId: () => "rcpt-stable",
  }
  const receiptId = await resolve(file, receiptScope, services)
  const updateExpense = async () => { throw new Error("Expense update failed") }
  await assert.rejects(updateExpense(), /Expense update failed/)
  assert.equal(await resolve(file, receiptScope, services), receiptId)
  assert.equal(uploads, 1)
  assert.equal(registrations, 1)
})

test("the same file cannot share a receipt across organization, company or employee scopes", async () => {
  const resolve = createExpenseReceiptAttemptCache()
  const file = new File(["receipt"], "receipt.pdf")
  const registrations: Array<{ employeeId: bigint; companyId: bigint; requestId: string }> = []
  let request = 0
  const services = {
    upload: async () => uploadedReceipt,
    register: async (params: ReturnType<typeof expenseReceiptFromUpload>, companyId: bigint) => {
      registrations.push({ employeeId: params.employeeId, companyId, requestId: params.clientRequestId })
      return BigInt(registrations.length)
    },
    newRequestId: () => `rcpt-${++request}`,
  }
  assert.equal(await resolve(file, receiptScope, services), 1n)
  assert.equal(await resolve(file, { ...receiptScope, employeeId: 8n }, services), 2n)
  assert.equal(await resolve(file, { ...receiptScope, companyId: 3n }, services), 3n)
  assert.equal(await resolve(file, { ...receiptScope, organizationId: 10n }, services), 4n)
  assert.equal(await resolve(new File(["receipt"], "receipt.pdf"), receiptScope, services), 5n)
  assert.equal(new Set(registrations.map((row) => row.requestId)).size, 5)
})

test("concurrent submissions of one receipt attempt share the same in-flight upload and registration", async () => {
  const resolve = createExpenseReceiptAttemptCache()
  const file = new File(["receipt"], "receipt.pdf")
  let uploads = 0
  let registrations = 0
  const services = {
    upload: async () => { uploads++; return uploadedReceipt },
    register: async () => { registrations++; return 14n },
    newRequestId: () => "rcpt-concurrent",
  }
  assert.deepEqual(await Promise.all([resolve(file, receiptScope, services), resolve(file, receiptScope, services)]), [14n, 14n])
  assert.equal(uploads, 1)
  assert.equal(registrations, 1)
})

test("edit lookups retain current unavailable IDs as disabled visible choices without adding selectable foreign rows", () => {
  const config: FormConfig = { id: "edit-expense", title: "Edit", sections: [{ id: "main", fields: [
    { id: "product", name: "productId", type: "select", defaultValue: "old-product", options: [{ value: "", label: "No product" }, { value: "current-product", label: "Current company product" }] },
    { id: "project", name: "projectId", type: "select", defaultValue: "old-project", options: [] },
    { id: "tax", name: "taxIds", type: "multiselect", defaultValue: ["old-tax", "valid-tax"], options: [{ value: "valid-tax", label: "Current company tax" }] },
    { id: "mileage", name: "mileageRateId", type: "select", defaultValue: "old-rate", options: [] },
  ] }] }
  const retained = preserveExpenseEditSelections(config, (value) => `Unavailable selection: ${value}`)
  const fields = retained.sections[0].fields
  for (const [name, value] of [["productId", "old-product"], ["projectId", "old-project"], ["taxIds", "old-tax"], ["mileageRateId", "old-rate"]]) {
    const field = fields.find((candidate) => candidate.name === name)
    assert.ok(field && (field.type === "select" || field.type === "multiselect"))
    assert.deepEqual(field.options.find((option) => option.value === value), { value, label: `Unavailable selection: ${value}`, disabled: true })
  }
  const product = fields.find((field) => field.name === "productId")
  assert.ok(product?.type === "select")
  assert.equal(product.options.some((option) => option.value === ""), false)
  assert.equal(product.options.filter((option) => !option.disabled).length, 1)
  const sourceProduct = config.sections[0].fields[0]
  assert.ok(sourceProduct.type === "select")
  assert.equal(sourceProduct.options.length, 2)
})
