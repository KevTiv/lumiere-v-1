import { expect, test, type Page, type Request, type Response } from "@playwright/test"

import {
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-09 — see docs/plan/erp-cov09-hr-leave-approval-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const APPROVER_EMAIL = "fixture.hr-project@example.test"

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

type Row = Record<string, unknown>

async function rows(page: Page, path: string): Promise<Row[]> {
  const response = await page.request.get(path)
  if (!response.ok()) throw new Error(`${path} failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function exactId(page: Page, path: string, match: (row: Row) => boolean, label: string) {
  const matches = (await rows(page, path)).filter(match)
  if (matches.length !== 1) throw new Error(`${label}: expected one row, found ${matches.length}`)
  const id = scalarQueryId(matches[0]?.id)
  if (id == null) throw new Error(`${label} has no id`)
  return id
}

function identityHex(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return identityHex(record.hex ?? record.Hex ?? record.__identity__ ?? "")
  }
  return String(value ?? "").trim().replace(/^0x/i, "").toLowerCase()
}

function stateTag(state: unknown): string {
  if (typeof state === "string") return state
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const record = state as Record<string, unknown>
    if (typeof record.tag === "string") return record.tag
    const keys = Object.keys(record)
    if (keys.length === 1) return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
  }
  return String(state ?? "")
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function leaveSnapshot(page: Page, leaveId: number) {
  const matches = (await rows(page, "/api/query/leave-requests")).filter((row) => scalarQueryId(row.id) === leaveId)
  if (matches.length !== 1) throw new Error(`expected one leave ${leaveId}, found ${matches.length}`)
  const row = matches[0]!
  return {
    id: leaveId,
    organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
    companyId: scalarQueryId(row.companyId ?? row.company_id),
    state: stateTag(row.state),
  }
}

/** Select one leave in HR → Leaves and run a toolbar action; returns the operation response. */
async function runLeaveAction(page: Page, leaveId: number, actionId: string, reducer: string): Promise<Response> {
  await gotoModule(page, "/hr", "hr")
  await page.getByTestId("module-tab-hr-leaves").click()
  const leaveRow = page.getByTestId(`entity-row-${leaveId}`)
  await expect(leaveRow).toBeVisible({ timeout: 30_000 })
  await leaveRow.click()
  const action = page.getByTestId(`entity-action-${actionId}`)
  await expect(action).toBeEnabled()
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => matchesOperationResponse(candidate, reducer), { timeout: 30_000 }),
    action.click(),
  ])
  return response
}

test.describe("COV-09 exact leave submit → approve / refuse", { tag: ["@p0", "@cov09"] }, () => {
  test("approver drives submit, approve and refuse; replays, self-approval and reader are rejected", async ({
    browser,
    page,
  }) => {
    test.setTimeout(300_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)

    const approver = (await rows(page, `/api/settings/users?limit=100&search=${encodeURIComponent(APPROVER_EMAIL)}`))
      .filter((row) => row.email === APPROVER_EMAIL)
    expect(approver).toHaveLength(1)
    const approverIdentity = identityHex(approver[0]?.identity)
    expect(approverIdentity).toMatch(/^[0-9a-f]{64}$/)

    // ── Fixtures (setup calls only) ─────────────────────────────────────────
    const tag = smokeName("cov09")
    const leaveTypeName = `${tag}-type`
    await callReducerBff(page, "create_leave_type", [organizationId, companyId, {
      name: leaveTypeName,
      allocation_type: "fixed",
      max_leaves: 30,
      code: none,
      color: none,
      validity_start: none,
      validity_stop: none,
      is_active: true,
    }])
    const leaveTypeId = await exactId(page, "/api/query/leave-types", (row) => row.name === leaveTypeName, "COV-09 leave type")

    const createEmployee = async (name: string) => {
      await callReducerBff(page, "create_employee", [organizationId, {
        company_id: some(companyId),
        name,
        job_id: none,
        department_id: none,
        employment_type: { tag: "FullTime" },
        work_email: none,
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
      }])
      return exactId(page, "/api/query/employees", (row) => row.name === name, name)
    }
    const employeeId = await createEmployee(`${tag} employee`)
    // The approver's own employee record: their leave must not be self-approvable.
    const approverEmployeeId = await createEmployee(`${tag} approver`)
    await callReducerBff(page, "update_employee", [organizationId, companyId, approverEmployeeId, {
      name: none,
      job_title: none,
      job_id: none,
      department_id: none,
      parent_id: none,
      work_email: none,
      work_phone: none,
      mobile_phone: none,
      work_location: none,
      work_contact_partner_id: none,
      employment_type: none,
      user_id: some(approverIdentity),
    }])

    const nowMicros = Date.now() * 1000
    const createLeave = async (employee: number, name: string) => {
      await callReducerBff(page, "create_leave_request", [organizationId, companyId, {
        employee_id: employee,
        leave_type_id: leaveTypeId,
        date_from: { __timestamp_micros_since_unix_epoch__: nowMicros },
        date_to: { __timestamp_micros_since_unix_epoch__: nowMicros + 86400 * 1_000_000 },
        number_of_days: 1,
        notes: some(name),
        name: some(name),
        manager_id: none,
      }])
      return exactId(page, "/api/query/leave-requests", (row) => row.name === name, name)
    }
    const toApprove = await createLeave(employeeId, `${tag}-approve`)
    const toRefuse = await createLeave(employeeId, `${tag}-refuse`)
    const ownLeave = await createLeave(approverEmployeeId, `${tag}-own`)
    const snapshot = (leaveId: number, state: string) => ({ id: leaveId, organizationId, companyId, state })
    for (const leaveId of [toApprove, toRefuse, ownLeave]) {
      expect(await leaveSnapshot(page, leaveId)).toEqual(snapshot(leaveId, "Draft"))
    }

    // ── Operator path: the HR approver persona drives every transition ─────
    const approverContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const approverPage = await approverContext.newPage()
    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(approverPage, APPROVER_EMAIL, PERSONA_PASSWORD)

      for (const leaveId of [toApprove, toRefuse, ownLeave]) {
        const submitted = await runLeaveAction(approverPage, leaveId, "submit-leave", "submit_leave")
        expect(submitted.ok()).toBe(true)
        await expect.poll(() => leaveSnapshot(page, leaveId)).toEqual(snapshot(leaveId, "Confirm"))
        const staleSubmit = await replay(approverPage, submitted.request())
        expect(staleSubmit.status()).toBe(422)
        expect(await leaveSnapshot(page, leaveId)).toEqual(snapshot(leaveId, "Confirm"))
      }

      const approved = await runLeaveAction(approverPage, toApprove, "approve-leave", "approve_leave")
      expect(approved.ok()).toBe(true)
      await expect.poll(() => leaveSnapshot(page, toApprove)).toEqual(snapshot(toApprove, "Validated"))
      const staleApprove = await replay(approverPage, approved.request())
      expect(staleApprove.status()).toBe(422)
      expect(await leaveSnapshot(page, toApprove)).toEqual(snapshot(toApprove, "Validated"))

      const refused = await runLeaveAction(approverPage, toRefuse, "refuse-leave", "refuse_leave")
      expect(refused.ok()).toBe(true)
      await expect.poll(() => leaveSnapshot(page, toRefuse)).toEqual(snapshot(toRefuse, "Refused"))
      const staleRefuse = await replay(approverPage, refused.request())
      expect(staleRefuse.status()).toBe(422)
      expect(await leaveSnapshot(page, toRefuse)).toEqual(snapshot(toRefuse, "Refused"))

      // Separation of duties: the approver cannot approve their own leave.
      const selfApproval = await runLeaveAction(approverPage, ownLeave, "approve-leave", "approve_leave")
      expect(selfApproval.status()).toBe(422)
      expect(await leaveSnapshot(page, ownLeave)).toEqual(snapshot(ownLeave, "Confirm"))

      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      for (const [request, leaveId, state] of [
        [approved.request(), toApprove, "Validated"],
        [refused.request(), toRefuse, "Refused"],
      ] as const) {
        const denied = await replay(readerPage, request)
        expect(denied.status()).toBe(403)
        expect(await leaveSnapshot(page, leaveId)).toEqual(snapshot(leaveId, state))
      }
    } finally {
      await readerContext.close()
      await approverContext.close()
    }
  })
})
