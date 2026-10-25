#!/usr/bin/env node

import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_ROWS = 10_000
const MAX_U64 = (1n << 64n) - 1n
const INSTANCE_STATES = ["Active", "Completed", "Cancelled", "Failed"]
const TASK_STATES = ["Open", "Claimed", "Approved", "Rejected", "Completed", "Invalidated", "Cancelled"]
const INSTANCE_COLUMNS = ["id", "organization_id", "company_id", "workflow_version_id", "state", "revision"]
const TASK_COLUMNS = ["id", "organization_id", "company_id", "workflow_version_id", "workflow_instance_id", "status", "revision"]

function unsigned(value, label, positive = true) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must retain its exact integer value`)
  }
  const text = String(value)
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`${label} must be an unsigned decimal integer`)
  const integer = BigInt(text)
  if (integer > MAX_U64 || (positive && integer === 0n)) throw new Error(`${label} is outside its u64 range`)
  return text
}

/** Preserve the original JSON number token; SQL u64 values must never pass through Number. */
export function parseSqlJson(text) {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value !== "number") return value
    if (!context?.source) throw new Error("Node.js with JSON.parse source context is required")
    return context.source
  })
}

export function inventoryConfiguration(environment, arguments_) {
  if (arguments_.length !== 2) {
    throw new Error("Usage: node scripts/inventory-workflow-cancellations.mjs <organization-id> <company-id>")
  }
  const host = new URL(environment.STDB_HOST ?? "")
  if (host.username || host.password || host.search || host.hash || host.pathname !== "/"
      || (host.protocol !== "https:" && !(host.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(host.hostname)))) {
    throw new Error("STDB_HOST must be an HTTPS origin or a loopback HTTP origin")
  }
  const module = environment.STDB_MODULE?.trim()
  const token = environment.STDB_SERVER_TOKEN?.trim()
  if (!module || !/^[A-Za-z0-9_.-]+$/.test(module)) throw new Error("STDB_MODULE must be a database name or identity")
  if (!token) throw new Error("STDB_SERVER_TOKEN is required for this private read-only inventory")
  return {
    host: host.origin,
    module,
    token,
    organizationId: unsigned(arguments_[0], "organization id"),
    companyId: unsigned(arguments_[1], "company id"),
  }
}

function status(value, variants, label) {
  const unit = (payload) => payload === null || (Array.isArray(payload) && payload.length === 0)
    || (payload && typeof payload === "object" && Object.keys(payload).length === 0)
  let tag
  if (typeof value === "string") tag = value
  else if (Array.isArray(value) && value.length === 2 && unit(value[1])) {
    const index = unsigned(value[0], `${label} variant`, false)
    if (BigInt(index) < BigInt(variants.length)) tag = variants[Number(index)]
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value)
    if (typeof value.tag === "string" && (keys.length === 1
        || (keys.length === 2 && keys.includes("value") && unit(value.value)))) tag = value.tag
    else if (keys.length === 1 && unit(value[keys[0]])) tag = keys[0]
  }
  if (!variants.includes(tag)) throw new Error(`Unknown ${label}; inventory is incomplete`)
  return tag
}

function decodeRows(result, columns, configuration, table) {
  if (!Array.isArray(result) || result.length !== 1) throw new Error(`${table}: expected one SQL result`)
  const names = result[0]?.schema?.elements?.map((element) => element.name?.some)
  const rows = result[0]?.rows
  if (!Array.isArray(names) || names.length !== columns.length
      || names.some((name, index) => name !== columns[index]) || !Array.isArray(rows)) {
    throw new Error(`${table}: SQL projection does not match the inventory contract`)
  }
  if (rows.length > MAX_ROWS) throw new Error(`${table}: complete inventory exceeds ${MAX_ROWS} rows; no clean result was produced`)
  const seen = new Set()
  return rows.map((values) => {
    if (!Array.isArray(values) || values.length !== columns.length) throw new Error(`${table}: invalid row width`)
    const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]))
    for (const column of columns) {
      if (column !== "state" && column !== "status") row[column] = unsigned(row[column], `${table}.${column}`, column !== "revision")
    }
    if (row.organization_id !== configuration.organizationId || row.company_id !== configuration.companyId) {
      throw new Error(`${table}: SQL returned a row outside the requested organization/company`)
    }
    if (seen.has(row.id)) throw new Error(`${table}: duplicate row identity`)
    seen.add(row.id)
    if (table === "workflow_instance") row.state = status(row.state, INSTANCE_STATES, "workflow instance state")
    else row.status = status(row.status, TASK_STATES, "human-task status")
    return row
  }).sort((left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : 1)
}

async function readSql(configuration, table, columns, fetch_) {
  let response
  try {
    response = await fetch_(`${configuration.host}/v1/database/${configuration.module}/sql`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${configuration.token}`, "Content-Type": "text/plain" },
      body: `SELECT ${columns.join(", ")} FROM ${table} WHERE organization_id = ${configuration.organizationId} AND company_id = ${configuration.companyId}`,
    })
  } catch {
    throw new Error(`${table}: inventory SQL transport failed`)
  }
  if (!response.ok || !response.body) {
    throw new Error(`${table}: inventory SQL read failed (${response.status})`)
  }
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error(`${table}: response exceeds the bounded inventory size; no clean result was produced`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  let result
  try {
    result = parseSqlJson(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new Error(`${table}: invalid SQL JSON or unsupported Node.js JSON parser`)
  }
  return decodeRows(result, columns, configuration, table)
}

function findingsFor(instances, tasks) {
  const byInstance = new Map(instances.map((instance) => [instance.id, instance]))
  const findings = []
  for (const task of tasks) {
    const instance = byInstance.get(task.workflow_instance_id)
    const active = ["Open", "Claimed"].includes(task.status)
    // Migration remaps active projections; completed history retains the
    // original version and must not make an otherwise complete scan fail.
    if (!instance || (active && task.workflow_version_id !== instance.workflow_version_id)) {
      throw new Error("Task/instance scope or version is inconsistent; inventory is incomplete")
    }
    if (instance.state === "Cancelled" && active) {
      findings.push({
        instanceId: instance.id,
        instanceRevision: instance.revision,
        taskId: task.id,
        taskRevision: task.revision,
        taskStatus: task.status,
      })
    }
  }
  return findings
}

/** Read complete scoped projections twice. A changing or oversized scope never reports clean. */
export async function inventoryWorkflowCancellations(configuration, fetch_ = fetch) {
  const read = async () => ({
    instances: await readSql(configuration, "workflow_instance", INSTANCE_COLUMNS, fetch_),
    tasks: await readSql(configuration, "workflow_human_task", TASK_COLUMNS, fetch_),
  })
  const first = await read()
  const second = await read()
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error("Workflow projections changed during inventory; rerun against a quiescent scope")
  }
  const findings = findingsFor(second.instances, second.tasks)
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    source: { host: configuration.host, module: configuration.module },
    organizationId: configuration.organizationId,
    companyId: configuration.companyId,
    status: findings.length ? "repair_required" : "clean",
    observed: { instances: second.instances.length, tasks: second.tasks.length },
    projectionSha256: createHash("sha256").update(JSON.stringify(second)).digest("hex"),
    findings,
  }
}

async function main() {
  try {
    const configuration = inventoryConfiguration(process.env, process.argv.slice(2))
    const report = await inventoryWorkflowCancellations(configuration)
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.status === "clean" ? 0 : 2
  } catch (error) {
    // Never print a token, a raw HTTP response, or private task content.
    console.error(`Workflow cancellation inventory failed: ${error instanceof Error ? error.message : "unknown error"}`)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main()
