/**
 * IOT-012 — IoT device lifecycle: hub → device → threshold → telemetry → alert.
 *
 * Flow:
 *   1. Register an IoT hub via BFF reducer
 *   2. Register an IoT device on that hub via BFF reducer
 *   3. Set a threshold that the next telemetry reading will exceed
 *   4. Record telemetry with a value that breaches the threshold
 *   5. Assert an alert was auto-created via /api/query/iot-alerts
 *   6. Navigate to the IoT module and assert the module view renders
 */
import { expect, test } from "@playwright/test"

import {
  callReducerBff,
  expectNoAppError,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  smokeName,
} from "./helpers"

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

// ---------------------------------------------------------------------------
// Local query helpers
// ---------------------------------------------------------------------------

async function fetchHubIdBySerial(page: Parameters<typeof callReducerBff>[0], serial: string): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/iot-hubs")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Array<{ id?: unknown; serial?: string }> }
      const row = (json.data ?? []).find((r) => r.serial === serial)
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`IoT hub not found for serial: ${serial}`)
}

async function fetchDeviceIdByName(page: Parameters<typeof callReducerBff>[0], name: string): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/iot-devices")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
      const row = (json.data ?? []).find((r) => r.name === name)
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`IoT device not found: ${name}`)
}

async function fetchAlertByDeviceId(page: Parameters<typeof callReducerBff>[0], deviceId: number): Promise<boolean> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/iot-alerts")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; deviceId?: unknown; device_id?: unknown }>
      }
      const found = (json.data ?? []).some(
        (r) => scalarQueryId(r.deviceId ?? r.device_id) === deviceId,
      )
      if (found) return true
    }
    await page.waitForTimeout(250)
  }
  return false
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("IoT device lifecycle @p0", () => {
  test(
    "hub → device → threshold → telemetry → auto-alert @p0",
    async ({ page }) => {
      await gotoModule(page, "/iot", "iot")
      const organizationId = await fetchSessionOrganizationId(page)
      const companyId = await fetchDefaultCompanyId(page)

      const hubSerial = smokeName("hub-serial")
      const hubName = smokeName("hub")
      const deviceName = smokeName("temp-sensor")

      // Step 1: Register an IoT hub
      await callReducerBff(page, "register_iot_hub", [
        organizationId,
        companyId,
        {
          name: hubName,
          serial: hubSerial,
          ip_address: some("192.168.1.100"),
          firmware_version: some("1.0.0"),
          metadata: none,
        },
      ])

      const hubId = await fetchHubIdBySerial(page, hubSerial)
      expect(hubId).toBeGreaterThan(0)

      // Step 2: Register a temperature sensor device on the hub
      await callReducerBff(page, "register_iot_device", [
        organizationId,
        companyId,
        hubId,
        {
          name: deviceName,
          device_type: "TemperatureSensor",
          identifier: smokeName("thermo-id"),
          capabilities: ["temperature"],
          metadata: none,
        },
      ])

      const deviceId = await fetchDeviceIdByName(page, deviceName)
      expect(deviceId).toBeGreaterThan(0)

      // Step 3: Set a threshold — max 50°C; we will record 75°C to breach it
      await callReducerBff(page, "set_iot_threshold", [
        organizationId,
        deviceId,
        "temperature",
        none,       // min_value: none
        some(50.0), // max_value: 50°C
        "Warning",
      ])

      // Step 4: Record telemetry that exceeds the max threshold → triggers alert
      await callReducerBff(page, "record_telemetry", [
        organizationId,
        deviceId,
        {
          sensor_type: "temperature",
          value: 75.0,
          raw_value: none,
          unit: "Celsius",
          quality: "good",
        },
      ])

      // Step 5: Assert the alert was auto-created for this device
      const alertFound = await fetchAlertByDeviceId(page, deviceId)
      expect(alertFound, "expected an IoT alert to be created after threshold breach").toBe(true)

      // Step 6: IoT module renders without errors
      await expectNoAppError(page)
    },
  )
})
