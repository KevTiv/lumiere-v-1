import { expect, test, type Page, type Request } from "@playwright/test"

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

// COV-16 — see docs/plan/erp-cov16-iot-alert-resolve-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const none = { none: [] as [] }

type Row = Record<string, unknown>

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function exactId(page: Page, resource: string, match: (row: Row) => boolean, label: string) {
  let id: number | null = null
  await expect
    .poll(async () => {
      const matches = (await rows(page, resource)).filter(match)
      id = matches.length === 1 ? scalarQueryId(matches[0]?.id) : null
      return matches.length
    }, { timeout: 30_000, message: `${label} must resolve to exactly one row` })
    .toBe(1)
  if (id == null) throw new Error(`${label} has no id`)
  return id
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function alertSnapshot(page: Page, alertId: number) {
  const matches = (await rows(page, "iot-alerts")).filter((row) => scalarQueryId(row.id) === alertId)
  if (matches.length !== 1) throw new Error(`expected one IoT alert ${alertId}, found ${matches.length}`)
  const row = matches[0]!
  const resolvedAt = row.resolvedAt ?? row.resolved_at ?? null
  return {
    id: alertId,
    organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
    deviceId: scalarQueryId(row.deviceId ?? row.device_id),
    resolved: resolvedAt != null,
    resolvedAt: JSON.stringify(resolvedAt),
  }
}

test.describe("COV-16 exact IoT alert resolution", { tag: ["@p0", "@cov16"] }, () => {
  test("resolves the selected alert and preserves it on stale and denied replay", async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)

    // Setup only: hub, device and the open alert are fixture data. The
    // resolution under test is driven through the IoT Alerts UI below.
    const hubSerial = smokeName("cov16-hub")
    await callReducerBff(page, "register_iot_hub", [organizationId, companyId, {
      name: hubSerial,
      serial: hubSerial,
      ip_address: none,
      firmware_version: none,
      metadata: none,
    }])
    const hubId = await exactId(page, "iot-hubs", (row) => row.serial === hubSerial, "COV-16 hub")

    const deviceName = smokeName("cov16-sensor")
    await callReducerBff(page, "register_iot_device", [organizationId, companyId, hubId, {
      name: deviceName,
      device_type: "TemperatureSensor",
      identifier: deviceName,
      capabilities: ["temperature"],
      metadata: none,
    }])
    const deviceId = await exactId(page, "iot-devices", (row) => row.name === deviceName, "COV-16 device")

    const message = smokeName("cov16-alert")
    await callReducerBff(page, "create_iot_alert", [organizationId, deviceId, "cov16_manual", "Warning", message])
    const alertId = await exactId(
      page,
      "iot-alerts",
      (row) => scalarQueryId(row.deviceId ?? row.device_id) === deviceId && row.message === message,
      "COV-16 alert",
    )
    expect(await alertSnapshot(page, alertId)).toMatchObject({
      id: alertId,
      organizationId,
      deviceId,
      resolved: false,
    })

    await gotoModule(page, "/iot", "iot")
    await page.getByTestId("module-tab-iot-iot-alerts").click()
    const alertRow = page.getByTestId(`entity-row-${alertId}`)
    await expect(alertRow).toBeVisible({ timeout: 30_000 })
    await alertRow.click()
    const action = page.getByTestId("entity-action-resolve-alert")
    await expect(action).toBeEnabled()
    const [accepted] = await Promise.all([
      page.waitForResponse((response) => matchesOperationResponse(response, "resolve_iot_alert"), {
        timeout: 30_000,
      }),
      action.click(),
    ])
    expect(accepted.ok()).toBe(true)

    await expect
      .poll(async () => (await alertSnapshot(page, alertId)).resolved, { timeout: 30_000 })
      .toBe(true)
    const effect = await alertSnapshot(page, alertId)
    expect(effect).toMatchObject({ id: alertId, organizationId, deviceId, resolved: true })

    // The reducer rejects an already-resolved alert; the resolution timestamp
    // must not be re-stamped by a stale replay.
    const stale = await replay(page, accepted.request())
    expect(stale.status()).toBe(422)
    expect(await alertSnapshot(page, alertId)).toEqual(effect)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await replay(readerPage, accepted.request())
      expect(denied.status()).toBe(403)
      expect(await alertSnapshot(page, alertId)).toEqual(effect)
    } finally {
      await readerContext.close()
    }
  })
})
