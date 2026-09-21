import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const HOOK_SOURCE = readFileSync(
  fileURLToPath(new URL("./fleet.ts", import.meta.url)),
  "utf8",
)
const COMMAND_SOURCE = readFileSync(
  fileURLToPath(
    new URL("../../../stdb/src/commands/fleet-http.ts", import.meta.url),
  ),
  "utf8",
)
const RESOURCE_REGISTRY = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../../../crates/stdb-auth/assets/resource_registry.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
) as Record<string, { table?: string; mandatory?: string[] }>

function exportedFunction(name: string): string {
  const start = HOOK_SOURCE.indexOf(`export function ${name}(`)
  assert.notEqual(start, -1, `${name} not found in fleet.ts`)
  const next = HOOK_SOURCE.indexOf("\nexport function ", start + 1)
  return HOOK_SOURCE.slice(start, next === -1 ? HOOK_SOURCE.length : next)
}

function localFunction(name: string): string {
  const start = HOOK_SOURCE.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} not found in fleet.ts`)
  const nextExport = HOOK_SOURCE.indexOf("\nexport ", start + 1)
  return HOOK_SOURCE.slice(start, nextExport === -1 ? HOOK_SOURCE.length : nextExport)
}

const LIFECYCLE_RESOURCES = {
  "fleet-service-types": "fleet_vehicle_service_type",
  "fleet-service-records": "fleet_service_record",
  "fleet-inspections": "fleet_inspection",
} as const

describe("Fleet lifecycle query and command contracts", () => {
  it("registers each history resource against its canonical table and tenant scope", () => {
    for (const [resource, table] of Object.entries(LIFECYCLE_RESOURCES)) {
      const entry = RESOURCE_REGISTRY[resource]
      assert.equal(entry?.table, table, `${resource} is not registered`)
      assert.ok(
        entry.mandatory?.includes("organization_id"),
        `${resource} must retain organization_id in every response`,
      )
      assert.ok(
        entry.mandatory?.includes("company_id"),
        `${resource} must retain company_id for company isolation`,
      )
    }
  })

  it("reads every lifecycle history through its matching organization-scoped resource", () => {
    const sharedReader = localFunction("useFleetHistory")
    assert.match(
      sharedReader,
      /queryKey:\s*\[\s*resource\s*,\s*rqBigIntKey\(organizationId\)\s*\]/,
    )
    assert.match(sharedReader, /fetchQueryList\(fleetHistoryPath\(resource\)/)

    for (const [hook, resource] of [
      ["useFleetServiceTypes", "fleet-service-types"],
      ["useFleetServiceRecords", "fleet-service-records"],
      ["useFleetInspections", "fleet-inspections"],
    ] as const) {
      assert.ok(
        HOOK_SOURCE.includes(`export const ${hook}`) &&
          HOOK_SOURCE.includes(`useFleetHistory("${resource}", organizationId)`),
        `${hook} does not read ${resource}`,
      )
    }
  })

  it("routes assignment and history writes through their typed reducer operations", () => {
    for (const [hook, reducer] of [
      ["useUpdateFleetVehicleDriver", "update_fleet_vehicle"],
      ["useRecordFleetService", "record_fleet_service"],
      ["useRecordFleetInspection", "record_fleet_inspection"],
    ] as const) {
      assert.match(
        exportedFunction(hook),
        new RegExp(`stdbBffCommandPost\\(\\s*["']${reducer}["']`),
        `${hook} does not call ${reducer}`,
      )
      assert.match(
        COMMAND_SOURCE,
        new RegExp(`["']${reducer}["']`),
        `${reducer} is absent from the Fleet BFF allowlist`,
      )
    }
  })

  it("refreshes the current vehicle and the affected history after lifecycle writes", () => {
    const invalidation = localFunction("invalidateFleetLifecycleQueries")
    for (const [hook, requiredResources] of [
      ["useUpdateFleetVehicleDriver", ["fleet-vehicles"]],
      ["useRecordFleetService", ["fleet-vehicles", "fleet-service-records"]],
      ["useRecordFleetInspection", ["fleet-vehicles", "fleet-inspections"]],
    ] as const) {
      const source = exportedFunction(hook)
      assert.match(source, /onSuccess:[^\n]*invalidateFleetLifecycleQueries/)
      for (const resource of requiredResources) {
        assert.match(
          invalidation,
          new RegExp(`["']${resource}["']`),
          `${hook} does not refresh ${resource}`,
        )
      }
    }
  })
})
