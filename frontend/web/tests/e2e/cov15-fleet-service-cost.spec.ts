import { expect, test, type Page, type Request } from "@playwright/test"

import {
  callReducerOwner,
  chooseSelectOptionByValue,
  fetchAccountIdByCode,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  openEntityCreate,
  scalarQueryId,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type Row = Record<string, unknown>

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()}`)
  }
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

function optionString(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("some" in value) {
      return String((value as { some?: unknown }).some ?? "")
    }
    if ("none" in value) return ""
  }
  return ""
}

function findClientRequestId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findClientRequestId(item)
      if (match) return match
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of ["clientRequestId", "client_request_id"]) {
    if (key in record) {
      const match = optionString(record[key]).trim()
      if (match) return match
    }
  }
  for (const nested of Object.values(record)) {
    const match = findClientRequestId(nested)
    if (match) return match
  }
  return null
}

function enumTag(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) return String((value as { tag?: unknown }).tag ?? "")
    const keys = Object.keys(value)
    if (keys.length === 1) {
      return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
    }
  }
  return ""
}

function outcomeTag(value: unknown): string {
  const normalize = (tag: unknown) =>
    String(tag ?? "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase()
  if (typeof value === "string") return normalize(value)
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) {
      return normalize((value as { tag?: unknown }).tag)
    }
    const keys = Object.keys(value)
    if (keys.length === 1) return normalize(keys[0])
  }
  return ""
}

async function historySnapshot(
  page: Page,
  resource: "fleet-service-records" | "fleet-inspections",
  clientRequestId: string,
) {
  const matches = (await rows(page, resource)).filter(
    (row) =>
      optionString(row.clientRequestId ?? row.client_request_id) ===
      clientRequestId,
  )
  if (matches.length !== 1) {
    throw new Error(
      `expected one ${resource} row for ${clientRequestId}, found ${matches.length}`,
    )
  }
  const row = matches[0]!
  return {
    id: scalarQueryId(row.id),
    organizationId: scalarQueryId(
      row.organizationId ?? row.organization_id,
    ),
    companyId: scalarQueryId(row.companyId ?? row.company_id),
    vehicleId: scalarQueryId(row.vehicleId ?? row.vehicle_id),
    serviceTypeId:
      scalarQueryId(row.serviceTypeId ?? row.service_type_id) ?? null,
    outcome: outcomeTag(row.outcome),
    odometerKm: Number(row.odometerKm ?? row.odometer_km ?? 0),
    provider: String(row.provider ?? ""),
    notes: String(row.notes ?? ""),
    costAmount: Number(row.costAmount ?? row.cost_amount ?? 0),
    currencyId: scalarQueryId(row.currencyId ?? row.currency_id) ?? null,
    accountMoveId:
      scalarQueryId(row.accountMoveId ?? row.account_move_id) ?? null,
    clientRequestId,
  }
}

async function waitForServiceType(
  page: Page,
  name: string,
): Promise<number> {
  let id: number | null = null
  await expect
    .poll(async () => {
      const row = (await rows(page, "fleet-service-types")).find(
        (candidate) => candidate.name === name,
      )
      id = scalarQueryId(row?.id)
      return id
    })
    .not.toBeNull()
  if (id == null) throw new Error("fleet service type was not created")
  return id
}

test.describe(
  "COV-15 Fleet service / inspection history",
  { tag: ["@p0", "@cov15"] },
  () => {
    test("records exact service and inspection effects and preserves them on retry/denial", async ({
      browser,
      page,
    }) => {
      test.setTimeout(240_000)

      await gotoModule(page, "/fleet", "fleet")
      const organizationId = await fetchSessionOrganizationId(page)
      const companyId = await fetchDefaultCompanyId(page)

      const vehicle = (await rows(page, "fleet-vehicles")).find(
        (row) =>
          String(row.name ?? "") === "Truck #101" &&
          scalarQueryId(row.companyId ?? row.company_id) === companyId,
      )
      const vehicleId = scalarQueryId(vehicle?.id)
      if (vehicleId == null) {
        throw new Error("seeded Truck #101 is unavailable")
      }

      const serviceTypeName = smokeName("cov15-service-type")
      await callReducerOwner("create_fleet_vehicle_service_type", [
        organizationId,
        {
          name: serviceTypeName,
          company_id: { some: companyId },
        },
      ])
      const serviceTypeId = await waitForServiceType(page, serviceTypeName)

      await openEntityCreate(
        page,
        "/fleet",
        "fleet",
        "fleet-service-records",
        "record-fleet-service",
      )

      await chooseSelectOptionByValue(page, "vehicle_id", vehicleId)
      await chooseSelectOptionByValue(
        page,
        "service_type_id",
        serviceTypeId,
      )
      const journal = (await rows(page, "account-journals")).find(
        (row) =>
          scalarQueryId(row.companyId ?? row.company_id) === companyId &&
          String(row.code ?? "").toUpperCase() === "MISC",
      ) ?? (await rows(page, "account-journals")).find(
        (row) =>
          scalarQueryId(row.companyId ?? row.company_id) === companyId &&
          enumTag(row.type ?? row.type_) === "General",
      )
      const journalId = scalarQueryId(journal?.id)
      if (journalId == null) throw new Error("general fleet cost journal unavailable")
      const expenseAccountId = await fetchAccountIdByCode(page, "5000")
      const offsetAccountId = await fetchAccountIdByCode(page, "2000")

      await fillField(page, "odometer_km", "13000")
      await fillField(page, "provider", "COV-15 Garage")
      await fillField(page, "cost_amount", "275.50")
      await chooseSelectOptionByValue(page, "journal_id", journalId)
      await chooseSelectOptionByValue(
        page,
        "expense_account_id",
        expenseAccountId,
      )
      await chooseSelectOptionByValue(
        page,
        "offset_account_id",
        offsetAccountId,
      )
      await fillField(page, "notes", "COV-15 service proof")

      const [serviceAccepted] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "record_fleet_service"),
          { timeout: 45_000 },
        ),
        submitForm(page, "record-fleet-service"),
      ])
      expect(serviceAccepted.ok()).toBe(true)

      const serviceRequestId = findClientRequestId(
        serviceAccepted.request().postDataJSON(),
      )
      if (!serviceRequestId) {
        throw new Error("service request omitted client_request_id")
      }

      await expect
        .poll(() =>
          historySnapshot(
            page,
            "fleet-service-records",
            serviceRequestId,
          ),
        )
        .toMatchObject({
          organizationId,
          companyId,
          vehicleId,
          serviceTypeId,
          odometerKm: 13000,
          provider: "COV-15 Garage",
          costAmount: 275.5,
          clientRequestId: serviceRequestId,
        })
      const serviceEffect = await historySnapshot(
        page,
        "fleet-service-records",
        serviceRequestId,
      )
      if (serviceEffect.accountMoveId == null || serviceEffect.currencyId == null) {
        throw new Error("fleet service cost is missing accounting linkage")
      }
      const move = (await rows(page, "account-moves")).find(
        (row) => scalarQueryId(row.id) === serviceEffect.accountMoveId,
      )
      expect(move).toBeDefined()
      expect(scalarQueryId(move?.companyId ?? move?.company_id)).toBe(companyId)
      expect(scalarQueryId(move?.currencyId ?? move?.currency_id)).toBe(
        serviceEffect.currencyId,
      )
      expect(enumTag(move?.state)).toBe("Posted")

      const moveLines = (await rows(page, "account-move-lines")).filter(
        (row) =>
          scalarQueryId(row.moveId ?? row.move_id) === serviceEffect.accountMoveId,
      )
      expect(moveLines).toHaveLength(2)
      expect(
        moveLines.some(
          (line) =>
            scalarQueryId(line.accountId ?? line.account_id) === expenseAccountId &&
            Math.abs(Number(line.debit ?? 0) - 275.5) < 0.001,
        ),
      ).toBe(true)
      expect(
        moveLines.some(
          (line) =>
            scalarQueryId(line.accountId ?? line.account_id) === offsetAccountId &&
            Math.abs(Number(line.credit ?? 0) - 275.5) < 0.001,
        ),
      ).toBe(true)


      const serviceRetry = await replay(page, serviceAccepted.request())
      expect(serviceRetry.ok()).toBe(true)
      expect(
        await historySnapshot(
          page,
          "fleet-service-records",
          serviceRequestId,
        ),
      ).toEqual(serviceEffect)

      await openEntityCreate(
        page,
        "/fleet",
        "fleet",
        "fleet-inspections",
        "record-fleet-inspection",
      )

      await chooseSelectOptionByValue(page, "vehicle_id", vehicleId)
      await chooseSelectOptionByValue(
        page,
        "outcome",
        "attention_required",
      )
      await fillField(page, "odometer_km", "13010")
      await fillField(page, "notes", "COV-15 inspection proof")

      const [inspectionAccepted] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "record_fleet_inspection"),
          { timeout: 45_000 },
        ),
        submitForm(page, "record-fleet-inspection"),
      ])
      expect(inspectionAccepted.ok()).toBe(true)

      const inspectionRequestId = findClientRequestId(
        inspectionAccepted.request().postDataJSON(),
      )
      if (!inspectionRequestId) {
        throw new Error("inspection request omitted client_request_id")
      }

      await expect
        .poll(() =>
          historySnapshot(
            page,
            "fleet-inspections",
            inspectionRequestId,
          ),
        )
        .toMatchObject({
          organizationId,
          companyId,
          vehicleId,
          outcome: "attention_required",
          odometerKm: 13010,
          clientRequestId: inspectionRequestId,
        })
      const inspectionEffect = await historySnapshot(
        page,
        "fleet-inspections",
        inspectionRequestId,
      )

      const inspectionRetry = await replay(
        page,
        inspectionAccepted.request(),
      )
      expect(inspectionRetry.ok()).toBe(true)
      expect(
        await historySnapshot(
          page,
          "fleet-inspections",
          inspectionRequestId,
        ),
      ).toEqual(inspectionEffect)

      const readerContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const readerPage = await readerContext.newPage()
      try {
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        for (const request of [
          serviceAccepted.request(),
          inspectionAccepted.request(),
        ]) {
          const denied = await replay(readerPage, request)
          expect(denied.status()).toBe(403)
        }
        expect(
          await historySnapshot(
            page,
            "fleet-service-records",
            serviceRequestId,
          ),
        ).toEqual(serviceEffect)
        expect(
          await historySnapshot(
            page,
            "fleet-inspections",
            inspectionRequestId,
          ),
        ).toEqual(inspectionEffect)
      } finally {
        await readerContext.close()
      }
    })
  },
)
