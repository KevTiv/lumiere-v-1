import type { Page } from "@playwright/test"

import { scalarQueryId } from "./helpers"

/** Decode persisted SATS identities without treating missing actor evidence as success. */
export function actorIdentity(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>
    return actorIdentity(row.some ?? row.Some ?? row.value ?? row.hex ?? row.Hex ?? row.__identity__)
  }
  if (Array.isArray(value) && value.length === 1) return actorIdentity(value[0])
  if (Array.isArray(value) && value.length === 2 && value[0] === 0) return actorIdentity(value[1])
  if (Array.isArray(value) && value.length === 32
    && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return value.map((byte: number) => byte.toString(16).padStart(2, "0")).join("")
  }
  const hex = String(value ?? "").trim().replace(/^0x/i, "").toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("missing or invalid actor identity evidence")
  return hex
}

export async function sessionActor(page: Page): Promise<string> {
  return actorIdentity(
    (await page.context().cookies()).find((cookie) => cookie.name === "stdb_identity")?.value,
  )
}

/**
 * Supplemental, fixture-only persisted actor/full-row evidence. The governed API
 * projections omit these actor fields. This read-only owner SQL observer does not
 * perform transitions or replace the specs' UI → canonical API readback proof.
 */
export async function canonicalRow(_page: Page, resource: string, id: number) {
  const tables: Record<string, string> = {
    employees: "hr_employee",
    "leave-requests": "hr_leave",
    timesheets: "project_timesheet",
    proposals: "proposal",
    "mrp-boms": "mrp_bom",
    "stock-moves": "stock_move",
  }
  const table = tables[resource]
  if (!table || !Number.isSafeInteger(id) || id <= 0) throw new Error("invalid SoD evidence row")
  const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(/\/$/, "")
  const moduleName = process.env.STDB_MODULE?.trim()
  const token = process.env.STDB_SERVER_TOKEN?.trim()
  if (!moduleName || !token) throw new Error("SoD observer requires STDB_MODULE and STDB_SERVER_TOKEN")
  const response = await fetch(`${host}/v1/database/${moduleName}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: `SELECT * FROM ${table} WHERE id = ${id}`,
  })
  if (!response.ok) throw new Error(`${resource}/${id} evidence read failed: ${response.status}`)
  const result = await response.json() as {
    schema?: { elements?: { name?: { some?: string } }[] }
    rows?: unknown[][]
  }[]
  const elements = result[0]?.schema?.elements
  const rows = result[0]?.rows
  if (result.length !== 1 || !elements || rows?.length !== 1) {
    throw new Error(`${resource}/${id}: expected one result and row`)
  }
  const row = Object.fromEntries(elements.map((element, index) => {
    const name = element.name?.some
    if (!name) throw new Error("SoD evidence column has no name")
    return [name, rows[0]![index]]
  }))
  if (scalarQueryId(row.id) !== id) throw new Error("SoD evidence row identity mismatch")
  return row
}
