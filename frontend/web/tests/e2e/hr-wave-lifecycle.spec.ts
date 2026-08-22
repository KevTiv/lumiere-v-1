/**
 * HR Wave A lifecycle — leave submit→approve and payslip approve→export artifact.
 *
 * Same-session SoD on leave approve is avoided: test employees have no linked user_id.
 * Payslip Done requires export artifact (record_payroll_export_result applied) — proven here and in run_all_hr_tests.
 */
import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  expectNoAppError,
  fetchCurrencyIdByCode,
  fetchSessionOrganizationId,
  gotoModule,
  openEntityCreate,
  chooseFirstOption,
  fillField,
  submitForm,
  smokeName,
  scalarQueryId,
} from "./helpers"

const some = <T>(value: T) => ({ some: value })
const none = { none: [] as [] }

async function openHrTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-hr-${tabId}`).click()
}

async function fetchFirstCompanyId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/companies")
  if (!res.ok()) throw new Error(`companies query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: number | string }> }
  const id = Number(json.data?.[0]?.id)
  if (!Number.isFinite(id) || id <= 0) throw new Error("no company in session")
  return id
}

async function fetchFirstEmployeeId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/employees")
  if (!res.ok()) throw new Error(`employees query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: number | string }> }
  const id = Number(json.data?.[0]?.id)
  if (!Number.isFinite(id) || id <= 0) throw new Error("no employee seeded")
  return id
}

async function fetchPayrollStructureId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/payroll-structures")
  if (!res.ok()) throw new Error(`payroll-structures query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: number | string }> }
  const id = Number(json.data?.[0]?.id)
  if (!Number.isFinite(id) || id <= 0) throw new Error("no payroll structure seeded")
  return id
}

function leaveStateTag(state: unknown): string {
  if (state == null) return ""
  if (typeof state === "string") return state
  if (typeof state === "object" && !Array.isArray(state)) {
    const obj = state as Record<string, unknown>
    if (typeof obj.tag === "string") return obj.tag
    const keys = Object.keys(obj)
    if (keys.length === 1) {
      const key = keys[0]!
      return key.charAt(0).toUpperCase() + key.slice(1)
    }
  }
  return String(state)
}

function payslipStateTag(state: unknown): string {
  return leaveStateTag(state)
}

test.describe("HR wave lifecycle e2e @hr", () => {
  test("leave type smoke + leave submit→approve lifecycle @p0", async ({ page }) => {
    test.setTimeout(120_000)
    await gotoModule(page, "/hr", "hr")
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchFirstCompanyId(page)
    const employeeId = await fetchFirstEmployeeId(page)

    const leaveTypeName = smokeName("lc-leave-type")
    await openEntityCreate(page, "/hr", "hr", "leave-types", "new-leave-type")
    await fillField(page, "name", leaveTypeName)
    await chooseFirstOption(page, "allocationType")
    await fillField(page, "maxLeaves", "10")
    await submitForm(page, "new-leave-type")

    await openHrTab(page, "leave-types")
    await expect(page.getByText(leaveTypeName)).toBeVisible({ timeout: 45_000 })

    const leaveTypesRes = await page.request.get("/api/query/leave-types")
    const leaveTypeId = Number(
      ((await leaveTypesRes.json()) as { data?: Array<{ id?: number; name?: string }> }).data?.find(
        (lt) => lt.name === leaveTypeName,
      )?.id,
    )
    expect(leaveTypeId).toBeGreaterThan(0)

    const leaveTag = smokeName("lc-leave")
    const nowMicros = Date.now() * 1000
    await callReducerBff(page, "create_leave_request", [
      organizationId,
      companyId,
      {
        employee_id: employeeId,
        leave_type_id: leaveTypeId,
        date_from: { __timestamp_micros_since_unix_epoch__: nowMicros },
        date_to: { __timestamp_micros_since_unix_epoch__: nowMicros + 2 * 86400 * 1_000_000 },
        number_of_days: 2,
        notes: some(leaveTag),
        name: some(leaveTag),
        manager_id: none,
      },
    ])

    const leavesRes = await page.request.get("/api/query/leave-requests")
    const leaveId = Number(
      ((await leavesRes.json()) as { data?: Array<{ id?: number; name?: string; notes?: string }> })
        .data?.find((l) => l.name === leaveTag || l.notes === leaveTag)?.id,
    )
    expect(leaveId).toBeGreaterThan(0)

    await callReducerBff(page, "submit_leave", [organizationId, companyId, leaveId])

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/leave-requests")
        if (!res.ok()) return ""
        const json = (await res.json()) as { data?: Array<{ id?: number; state?: unknown }> }
        const row = (json.data ?? []).find((l) => Number(l.id) === leaveId)
        return leaveStateTag(row?.state)
      }, { timeout: 45_000 })
      .toMatch(/Confirm/i)

    await callReducerBff(page, "approve_leave", [organizationId, companyId, leaveId])

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/leave-requests")
        if (!res.ok()) return ""
        const json = (await res.json()) as { data?: Array<{ id?: number; state?: unknown }> }
        const row = (json.data ?? []).find((l) => Number(l.id) === leaveId)
        return leaveStateTag(row?.state)
      }, { timeout: 45_000 })
      .toMatch(/Validated/i)

    await expectNoAppError(page)
  })

  test("payslip approve→export artifact path (not silent Done) @p0", async ({ page }) => {
    test.setTimeout(120_000)
    await gotoModule(page, "/hr", "hr")
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchFirstCompanyId(page)
    const employeeId = await fetchFirstEmployeeId(page)
    const structId = await fetchPayrollStructureId(page)

    await callReducerBff(page, "create_payslip", [
      organizationId,
      {
        company_id: some(companyId),
        employee_id: employeeId,
        struct_id: structId,
        date_from: { __timestamp_micros_since_unix_epoch__: Date.now() * 1000 },
        date_to: { __timestamp_micros_since_unix_epoch__: (Date.now() + 30 * 86400) * 1000 },
        basic_wage: 4200,
        contract_id: none,
        notes: none,
      },
    ])

    const payslipsRes = await page.request.get("/api/query/payslips")
    const payslipId = Number(
      ((await payslipsRes.json()) as { data?: Array<{ id?: number; employeeId?: number; employee_id?: number }> })
        .data?.filter(
          (p) => Number(p.employeeId ?? p.employee_id) === employeeId,
        )
        .sort((a, b) => Number(b.id) - Number(a.id))[0]?.id,
    )
    expect(payslipId).toBeGreaterThan(0)

    await callReducerBff(page, "confirm_payslip", [
      organizationId,
      payslipId,
      {
        company_id: some(companyId),
        gross_wage: 4200,
        net_wage: 3500,
        calculation_source: "manual",
      },
    ])

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/payslips")
        if (!res.ok()) return ""
        const json = (await res.json()) as { data?: Array<{ id?: number; state?: unknown }> }
        const row = (json.data ?? []).find((p) => Number(p.id) === payslipId)
        return payslipStateTag(row?.state)
      }, { timeout: 45_000 })
      .toMatch(/Verify/i)

    const idempotencyKey = `e2e-export-${payslipId}-${Date.now()}`
    await callReducerBff(page, "create_payroll_export_intent", [
      organizationId,
      companyId,
      payslipId,
      {
        pack_key: some("au"),
        idempotency_key: idempotencyKey,
        payload: JSON.stringify({ payslipId, source: "e2e" }),
        metadata: none,
      },
    ])

    let intentId = 0
    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/payslips")
        if (!res.ok()) return 0
        const json = (await res.json()) as {
          data?: Array<{
            id?: number
            exportIntentId?: number | string | null
            export_intent_id?: number | string | null
          }>
        }
        const row = (json.data ?? []).find((p) => Number(p.id) === payslipId)
        intentId = Number(row?.exportIntentId ?? row?.export_intent_id ?? 0)
        return intentId
      }, { timeout: 45_000 })
      .toBeGreaterThan(0)

    await callReducerBff(page, "record_payroll_export_result", [
      organizationId,
      companyId,
      intentId,
      {
        status: "applied",
        external_ref: some(`STP-${payslipId}`),
        payload_hash: some("sha256:e2e-test"),
        last_error: none,
        metadata: none,
      },
    ])

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/payslips")
        if (!res.ok()) return ""
        const json = (await res.json()) as { data?: Array<{ id?: number; state?: unknown }> }
        const row = (json.data ?? []).find((p) => Number(p.id) === payslipId)
        return payslipStateTag(row?.state)
      }, { timeout: 45_000 })
      .toMatch(/Done/i)

    await openHrTab(page, "payslips")
    await expectNoAppError(page)
  })
})

test.describe("HR-008 employee → contract → payslip lifecycle @hr @p0", () => {
  async function fetchEmployeeIdByName(page: Page, name: string): Promise<number> {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const res = await page.request.get("/api/query/employees")
      if (res.ok()) {
        const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
        const row = (json.data ?? []).find((e) => e.name === name)
        const id = scalarQueryId(row?.id)
        if (id != null) return id
      }
      await page.waitForTimeout(250)
    }
    throw new Error(`employee not found after create: ${name}`)
  }

  async function fetchContractIdByName(page: Page, name: string): Promise<number> {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const res = await page.request.get("/api/query/contracts")
      if (res.ok()) {
        const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
        const row = (json.data ?? []).find((c) => c.name === name)
        const id = scalarQueryId(row?.id)
        if (id != null) return id
      }
      await page.waitForTimeout(250)
    }
    throw new Error(`contract not found after create: ${name}`)
  }

  test("create employee → contract → payslip → confirm @p0", async ({ page }) => {
    test.setTimeout(180_000)
    await gotoModule(page, "/hr", "hr")
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchFirstCompanyId(page)
    const structId = await fetchPayrollStructureId(page)
    const currencyId = await fetchCurrencyIdByCode(page, "USD")

    const employeeName = smokeName("hr008-emp")
    await callReducerBff(page, "create_employee", [
      organizationId,
      {
        company_id: some(companyId),
        name: employeeName,
        job_id: none,
        department_id: none,
        employment_type: { tag: "FullTime" },
        work_email: some(`${employeeName.toLowerCase().replace(/\s+/g, "-")}@example.test`),
        employee_number: none,
        job_title: none,
        parent_id: none,
        coach_id: none,
        work_phone: none,
        mobile_phone: none,
        work_location: none,
        work_contact_partner_id: none,
        date_hired: none,
        gender: none,
        birthday: none,
        marital: none,
        emergency_contact: none,
        emergency_phone: none,
        barcode: none,
        pin: none,
        image_url: none,
        color: none,
        is_active: true,
        metadata: none,
      },
    ])

    const employeeId = await fetchEmployeeIdByName(page, employeeName)
    expect(employeeId).toBeGreaterThan(0)

    const contractName = smokeName("hr008-contract")
    const nowMicros = Date.now() * 1000
    await callReducerBff(page, "create_contract", [
      organizationId,
      {
        company_id: some(companyId),
        employee_id: employeeId,
        name: contractName,
        date_start: { __timestamp_micros_since_unix_epoch__: nowMicros },
        wage: 5500,
        currency_id: currencyId,
        job_id: none,
        department_id: none,
        date_end: none,
        notes: none,
      },
    ])

    const contractId = await fetchContractIdByName(page, contractName)
    expect(contractId).toBeGreaterThan(0)

    const payslipTag = smokeName("hr008-payslip")
    await callReducerBff(page, "create_payslip", [
      organizationId,
      {
        company_id: some(companyId),
        employee_id: employeeId,
        struct_id: structId,
        date_from: { __timestamp_micros_since_unix_epoch__: nowMicros },
        date_to: { __timestamp_micros_since_unix_epoch__: (Date.now() + 30 * 86400) * 1000 },
        basic_wage: 5500,
        contract_id: some(contractId),
        notes: some(payslipTag),
      },
    ])

    let payslipId = 0
    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/payslips")
        if (!res.ok()) return 0
        const json = (await res.json()) as {
          data?: Array<{
            id?: unknown
            employeeId?: unknown
            employee_id?: unknown
            contractId?: unknown
            contract_id?: unknown
            notes?: string
          }>
        }
        const row = (json.data ?? [])
          .filter(
            (p) =>
              scalarQueryId(p.employeeId ?? p.employee_id) === employeeId &&
              scalarQueryId(p.contractId ?? p.contract_id) === contractId,
          )
          .sort((a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0))[0]
        payslipId = scalarQueryId(row?.id) ?? 0
        return payslipId
      }, { timeout: 45_000 })
      .toBeGreaterThan(0)
    expect(payslipId).toBeGreaterThan(0)

    await callReducerBff(page, "confirm_payslip", [
      organizationId,
      payslipId,
      {
        company_id: some(companyId),
        gross_wage: 5500,
        net_wage: 4600,
        calculation_source: "manual",
      },
    ])

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/payslips")
        if (!res.ok()) return ""
        const json = (await res.json()) as { data?: Array<{ id?: unknown; state?: unknown }> }
        const row = (json.data ?? []).find((p) => scalarQueryId(p.id) === payslipId)
        return payslipStateTag(row?.state)
      }, { timeout: 45_000 })
      .toMatch(/Verify/i)

    await openHrTab(page, "payslips")
    await expect(page.getByText(employeeName)).toBeVisible({ timeout: 45_000 })
    await expectNoAppError(page)
  })
})
