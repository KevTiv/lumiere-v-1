import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  scalarQueryId,
  smokeName,
} from "./helpers"

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

type QueryRow = Record<string, unknown>

async function queryRows(page: Page, resource: string, companyId: number): Promise<QueryRow[]> {
  const response = await page.request.get(`/api/query/${resource}?companyId=${companyId}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed (${response.status()}): ${await response.text()}`)
  }
  const body = (await response.json()) as { data?: QueryRow[] }
  return body.data ?? []
}

async function waitForRow(
  page: Page,
  resource: string,
  companyId: number,
  predicate: (row: QueryRow) => boolean,
): Promise<QueryRow> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const row = (await queryRows(page, resource, companyId)).find(predicate)
    if (row) return row
    await page.waitForTimeout(200)
  }
  throw new Error(`timed out waiting for ${resource} row`)
}

function rowCompanyId(row: QueryRow): number | null {
  return scalarQueryId(row.companyId ?? row.company_id)
}

test.describe("IoT HTTP company isolation", { tag: "@p0" }, () => {
  test("isolates same-organization companies and strips sensitive payload fields", async ({ page }) => {
    const organizationId = await fetchSessionOrganizationId(page)
    const defaultCompanyId = await fetchDefaultCompanyId(page)
    const companies = await queryRows(page, "companies", defaultCompanyId)
    const defaultCompany = companies.find((row) => scalarQueryId(row.id) === defaultCompanyId)
    const currencyId = scalarQueryId(defaultCompany?.currencyId ?? defaultCompany?.currency_id)
    if (currencyId == null) throw new Error("default company has no currency")

    const suffix = smokeName("iot-isolation")
    const branchName = `${suffix}-branch`
    await callReducerBff(page, "create_company", [
      organizationId,
      {
        name: branchName,
        code: smokeName("iotb").slice(-12),
        currency_id: currencyId,
        fiscal_year_end_month: 12,
        fiscal_year_end_day: 31,
        is_parent: false,
        parent_id: some(defaultCompanyId),
        tax_id: none,
        company_registry: none,
        address_street: none,
        address_city: none,
        address_zip: none,
        address_country_code: some("US"),
        metadata: some(JSON.stringify({ fixture: "iot-read-isolation" })),
      },
    ])

    const branchCompany = await waitForRow(
      page,
      "companies",
      defaultCompanyId,
      (row) => row.name === branchName,
    )
    const branchCompanyId = scalarQueryId(branchCompany.id)
    if (branchCompanyId == null) throw new Error("branch company has no id")

    const defaultSerial = `${suffix}-default-hub`
    const branchSerial = `${suffix}-branch-hub`
    for (const [companyId, serial] of [
      [defaultCompanyId, defaultSerial],
      [branchCompanyId, branchSerial],
    ] as const) {
      await callReducerBff(page, "register_iot_hub", [
        organizationId,
        companyId,
        {
          name: serial,
          serial,
          ip_address: some("192.0.2.10"),
          firmware_version: some("1.0.0"),
          metadata: none,
        },
      ])
      await callReducerBff(page, "generate_hub_pairing_token", [organizationId, companyId])
    }

    const defaultHub = await waitForRow(
      page,
      "iot-hubs",
      defaultCompanyId,
      (row) => row.serial === defaultSerial,
    )
    const defaultHubId = scalarQueryId(defaultHub.id)
    if (defaultHubId == null) throw new Error("default IoT hub has no id")

    const scopedHubs = await queryRows(page, "iot-hubs", defaultCompanyId)
    expect(scopedHubs.some((row) => row.serial === branchSerial)).toBe(false)
    expect(scopedHubs.every((row) => rowCompanyId(row) === defaultCompanyId)).toBe(true)

    const scopedTokens = await queryRows(page, "iot-pairing-tokens", defaultCompanyId)
    expect(scopedTokens.length).toBeGreaterThan(0)
    expect(scopedTokens.every((row) => rowCompanyId(row) === defaultCompanyId)).toBe(true)
    expect(scopedTokens.every((row) => !("createdBy" in row) && !("created_by" in row))).toBe(true)

    const deviceName = `${suffix}-device`
    await callReducerBff(page, "register_iot_device", [
      organizationId,
      defaultCompanyId,
      defaultHubId,
      {
        name: deviceName,
        device_type: "BarcodeScanner",
        identifier: `${suffix}-identifier`,
        capabilities: ["barcode"],
        metadata: none,
      },
    ])
    const device = await waitForRow(
      page,
      "iot-devices",
      defaultCompanyId,
      (row) => row.name === deviceName,
    )
    const deviceId = scalarQueryId(device.id)
    if (deviceId == null) throw new Error("IoT device has no id")

    const actionSecret = `${suffix}-payment-payload`
    await callReducerBff(page, "create_iot_action", [
      organizationId,
      deviceId,
      { action_type: "InitiatePayment", payload: actionSecret, triggered_by: "e2e" },
    ])
    const action = await waitForRow(
      page,
      "iot-actions",
      defaultCompanyId,
      (row) => scalarQueryId(row.deviceId ?? row.device_id) === deviceId,
    )
    expect(rowCompanyId(action)).toBe(defaultCompanyId)
    for (const field of ["payload", "resultPayload", "result_payload", "error"]) {
      expect(action, `${field} must not cross the end-user HTTP boundary`).not.toHaveProperty(field)
    }

    const rawSecret = `${suffix}-barcode-value`
    await callReducerBff(page, "record_telemetry", [
      organizationId,
      deviceId,
      {
        sensor_type: "barcode",
        value: 0,
        raw_value: some(rawSecret),
        unit: "",
        quality: "good",
      },
    ])
    const telemetry = await waitForRow(
      page,
      "iot-telemetry",
      defaultCompanyId,
      (row) => scalarQueryId(row.deviceId ?? row.device_id) === deviceId,
    )
    expect(rowCompanyId(telemetry)).toBe(defaultCompanyId)
    expect(telemetry).not.toHaveProperty("rawValue")
    expect(telemetry).not.toHaveProperty("raw_value")

    for (const resource of [
      "iot-actions",
      "iot-alerts",
      "iot-devices",
      "iot-hubs",
      "iot-pairing-tokens",
      "iot-telemetry",
      "iot-thresholds",
    ]) {
      const response = await page.request.get(`/api/query/${resource}?companyId=${branchCompanyId}`)
      expect(response.status(), resource).toBe(403)
    }
  })
})
