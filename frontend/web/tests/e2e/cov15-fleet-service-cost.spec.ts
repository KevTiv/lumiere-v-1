import { expect, test, type Page, type Request, type Response } from "@playwright/test"

import {
  callReducerBff,
  chooseSelectOptionByLabel,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-15 — see docs/plan/erp-cov15-fleet-service-cost-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const READER_EMAIL = "fixture.reader@example.test"

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

function requestId(row: Row): string {
  const value = row.clientRequestId ?? row.client_request_id
  if (value && typeof value === "object" && "some" in value) return String((value as { some: unknown }).some)
  return String(value ?? "")
}

function outcomeTag(outcome: unknown): string {
  if (typeof outcome === "string") return outcome
  if (outcome && typeof outcome === "object" && !Array.isArray(outcome)) {
    const record = outcome as Record<string, unknown>
    if (typeof record.tag === "string") return record.tag
    const keys = Object.keys(record)
    if (keys.length === 1) return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
  }
  return String(outcome ?? "")
}

/** Exact history rows for one vehicle (fixtures are unique per execution). */
async function historySnapshot(page: Page, resource: "fleet-service-records" | "fleet-inspections", vehicleId: number) {
  return (await rows(page, `/api/query/${resource}`))
    .filter((row) => scalarQueryId(row.vehicleId ?? row.vehicle_id) === vehicleId)
    .map((row) => ({
      id: scalarQueryId(row.id),
      organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
      companyId: scalarQueryId(row.companyId ?? row.company_id),
      vehicleId,
      serviceTypeId: scalarQueryId(row.serviceTypeId ?? row.service_type_id),
      outcome: row.outcome === undefined ? null : outcomeTag(row.outcome),
      odometerKm: scalarQueryId(row.odometerKm ?? row.odometer_km),
      clientRequestId: requestId(row),
    }))
}

async function vehicleOdometer(page: Page, vehicleId: number) {
  const row = (await rows(page, "/api/query/fleet-vehicles")).find((candidate) => scalarQueryId(candidate.id) === vehicleId)
  if (!row) throw new Error(`vehicle ${vehicleId} missing`)
  return scalarQueryId(row.odometerKm ?? row.odometer_km)
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

/** Open a Fleet history tab, fill its record form and submit; returns the operation response. */
async function record(
  page: Page,
  tabId: "fleet-service-records" | "fleet-inspections",
  formId: string,
  reducer: string,
  fill: () => Promise<void>,
): Promise<Response> {
  await gotoModule(page, "/fleet", "fleet")
  await page.getByTestId(`module-tab-fleet-${tabId}`).click()
  await page.getByTestId(`module-create-fleet-${tabId}`).click()
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeVisible({ timeout: 15_000 })
  await fill()
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => matchesOperationResponse(candidate, reducer), { timeout: 45_000 }),
    submitForm(page, formId),
  ])
  return response
}

test.describe("COV-15 exact fleet service and inspection history", { tag: ["@p0", "@cov15"] }, () => {
  test("operator records a service and an inspection; replays are idempotent and the reader is denied", async ({
    browser,
    page,
  }) => {
    test.setTimeout(240_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)

    // ── Fixtures (setup calls only) ─────────────────────────────────────────
    const tag = smokeName("cov15")
    const vehicleName = `${tag}-van`
    const serviceTypeName = `${tag}-service`
    await callReducerBff(page, "create_fleet_vehicle", [organizationId, companyId, {
      name: vehicleName,
      vehicle_type: "van",
      license_plate: none,
      driver_name: none,
      driver_id: none,
      service_type_id: none,
      metadata: none,
    }])
    const vehicleId = await exactId(page, "/api/query/fleet-vehicles", (row) => row.name === vehicleName, vehicleName)
    await callReducerBff(page, "create_fleet_vehicle_service_type", [organizationId, {
      name: serviceTypeName,
      company_id: some(companyId),
    }])
    const serviceTypeId = await exactId(page, "/api/query/fleet-service-types", (row) => row.name === serviceTypeName, serviceTypeName)
    expect(await historySnapshot(page, "fleet-service-records", vehicleId)).toEqual([])
    expect(await historySnapshot(page, "fleet-inspections", vehicleId)).toEqual([])

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const readerPage = await readerContext.newPage()
      await signIn(readerPage, READER_EMAIL, PERSONA_PASSWORD)

      // ── Service: recorded from the visible form, read back by its request id ─
      const serviceResponse = await record(page, "fleet-service-records", "record-fleet-service", "record_fleet_service", async () => {
        await chooseSelectOptionByLabel(page, "vehicle_id", vehicleName)
        await chooseSelectOptionByLabel(page, "service_type_id", serviceTypeName)
        await fillField(page, "odometer_km", "1250")
        await fillField(page, "provider", `${tag} garage`)
        await fillField(page, "notes", `${tag} oil and filter`)
      })
      expect(serviceResponse.ok()).toBe(true)
      await expect.poll(async () => (await historySnapshot(page, "fleet-service-records", vehicleId)).length).toBe(1)
      const [service] = await historySnapshot(page, "fleet-service-records", vehicleId)
      expect(service).toMatchObject({ organizationId, companyId, vehicleId, serviceTypeId, odometerKm: 1250 })
      expect(service!.clientRequestId).not.toBe("")
      expect(await vehicleOdometer(page, vehicleId)).toBe(1250)

      // Replay of the accepted request carries the same request id: no second row.
      const serviceSnapshot = await historySnapshot(page, "fleet-service-records", vehicleId)
      expect((await replay(page, serviceResponse.request())).ok()).toBe(true)
      expect(await historySnapshot(page, "fleet-service-records", vehicleId)).toEqual(serviceSnapshot)
      expect(await vehicleOdometer(page, vehicleId)).toBe(1250)
      expect((await replay(readerPage, serviceResponse.request())).status()).toBe(403)
      expect(await historySnapshot(page, "fleet-service-records", vehicleId)).toEqual(serviceSnapshot)

      // ── Inspection: an older odometer must not regress the vehicle ──────
      const inspectionResponse = await record(page, "fleet-inspections", "record-fleet-inspection", "record_fleet_inspection", async () => {
        await chooseSelectOptionByLabel(page, "vehicle_id", vehicleName)
        await chooseSelectOptionByLabel(page, "outcome", /attention/i)
        await fillField(page, "odometer_km", "1240")
        await fillField(page, "notes", `${tag} tyre pressure`)
      })
      expect(inspectionResponse.ok()).toBe(true)
      await expect.poll(async () => (await historySnapshot(page, "fleet-inspections", vehicleId)).length).toBe(1)
      const [inspection] = await historySnapshot(page, "fleet-inspections", vehicleId)
      expect(inspection).toMatchObject({ organizationId, companyId, vehicleId, outcome: "AttentionRequired", odometerKm: 1240 })
      expect(inspection!.clientRequestId).not.toBe("")
      expect(await vehicleOdometer(page, vehicleId)).toBe(1250)

      const inspectionSnapshot = await historySnapshot(page, "fleet-inspections", vehicleId)
      expect((await replay(page, inspectionResponse.request())).ok()).toBe(true)
      expect(await historySnapshot(page, "fleet-inspections", vehicleId)).toEqual(inspectionSnapshot)
      expect((await replay(readerPage, inspectionResponse.request())).status()).toBe(403)
      expect(await historySnapshot(page, "fleet-inspections", vehicleId)).toEqual(inspectionSnapshot)
      expect(await historySnapshot(page, "fleet-service-records", vehicleId)).toEqual(serviceSnapshot)
    } finally {
      await readerContext.close()
    }
  })
})
