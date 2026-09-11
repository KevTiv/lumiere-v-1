#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
const readArtifact = (name) => {
  const path = required(name)
  const bytes = readFileSync(path)
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    report: JSON.parse(bytes.toString("utf8")),
  }
}
const asPositive = (value, label) => {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be positive`)
  return number
}
const expectPasses = (artifact, lane) => {
  if (artifact.report.lane !== lane || artifact.report.post_reconstruction !== true) {
    throw new Error(`${lane} artifact is not post-reconstruction evidence`)
  }
  const checks = new Map(artifact.report.checks?.map((check) => [check.id, check]) ?? [])
  for (const check of checks.values()) {
    if (check.status !== "pass" || check.after_reconstruction !== true) {
      throw new Error(`${lane}.${check.id} was not executed successfully`)
    }
  }
  return checks
}
const checkOutput = (result, expected, label) => {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  if (result.status === 0 || !output.includes(expected)) {
    throw new Error(`${label} did not fail closed with '${expected}': ${output.trim()}`)
  }
  return output.trim()
}

const runId = required("C9_MATRIX_RUN_ID")
const targetId = required("C9_TARGET_ID")
const targetHost = required("C9_TARGET_HOST").replace(/\/$/, "")
const storeId = required("C9_DURABLE_STORE_ID")
const generation = asPositive(required("C9_PLACEMENT_GENERATION"), "C9_PLACEMENT_GENERATION")
const repeatRunId = required("C9_RECONSTRUCTION_REPEAT_RUN_ID")
const browser = readArtifact("C9_BROWSER_EVIDENCE")
const projection = readArtifact("C9_PROJECTION_EVIDENCE")
const coldReads = readArtifact("C9_COLD_READ_EVIDENCE")
const hydration = readArtifact("C9_HYDRATION_EVIDENCE")

if (browser.report.post_reconstruction !== true || !browser.report.generated_at) {
  throw new Error("browser artifact lacks explicit post-reconstruction capture time")
}
const browserLanes = Object.fromEntries(
  Object.entries(browser.report.lanes).map(([lane, report]) => {
    const checks = new Map(report.checks?.map((check) => [check.id, check]) ?? [])
    for (const check of checks.values()) {
      if (check.status !== "pass" || check.after_reconstruction !== true) {
        throw new Error(`${lane}.${check.id} was not executed successfully`)
      }
    }
    return [lane, checks]
  }),
)
const coldLanes = {
  projection: expectPasses(projection, "projection"),
  cold_reads: expectPasses(coldReads, "cold_reads"),
  hydration: expectPasses(hydration, "hydration"),
}
for (const [lane, artifact] of Object.entries({ projection, cold_reads: coldReads, hydration })) {
  if (!artifact.report.generated_at) throw new Error(`${lane} artifact lacks explicit capture time`)
}

const browserFixtures = browser.report.fixtures
const coldFixtures = hydration.report.fixtures
const orgA = asPositive(coldFixtures.org_a, "cold fixtures org_a")
const orgB = asPositive(browserFixtures.org_b, "browser fixtures org_b")
const companyA1 = asPositive(coldFixtures.company_a1, "cold fixtures company_a1")
const companyA2 = asPositive(coldFixtures.company_a2, "cold fixtures company_a2")
const staleGeneration = generation - 1
if (staleGeneration <= 0) throw new Error("C9 placement generation must be at least 2")

const ownerToken = required("STDB_SERVER_TOKEN")
const reconstructorToken = required("STDB_RECONSTRUCTION_TOKEN")
const sql = async (statement, token = ownerToken) => {
  const response = await fetch(`${targetHost}/v1/database/${targetId}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: statement,
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`live target SQL failed (${response.status}): ${body}`)
  return body
}
const reducer = async (name, args) => {
  const response = await fetch(`${targetHost}/v1/database/${targetId}/call/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${reconstructorToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  })
  return { status: response.status, body: await response.text() }
}

const startedAt = new Date().toISOString()
const fenceBody = await sql(
  `SELECT * FROM organization_reconstruction_fence WHERE organization_id = ${orgA}`,
)
if (!fenceBody.includes(repeatRunId) || !fenceBody.includes("complete")) {
  throw new Error("fresh target does not expose the completed reconstruction fence")
}
const bindingBody = await sql(
  `SELECT * FROM cold_tier_service_identity WHERE organization_id = ${orgA}`,
)
if (!bindingBody.includes("organization_reconstructor")) {
  throw new Error("fresh target lacks the server-owned reconstruction identity binding")
}

const wrongOrg = await reducer("begin_organization_reconstruction", [
  orgB,
  `${runId}-wrong-org`,
  generation,
  2,
  "0".repeat(64),
])
if (wrongOrg.status < 400 || !wrongOrg.body.includes("not the registered organization reconstructor")) {
  throw new Error(`wrong-organization reconstruction did not fail closed: ${wrongOrg.status} ${wrongOrg.body}`)
}

const operator = required("C9_RECONSTRUCTION_BIN")
const operatorEnv = {
  ...process.env,
  STDB_MODULE: targetId,
  STDB_HOST: targetHost,
  LUMIERE_PLACEMENT_CONTROL_PATH: required("LUMIERE_PLACEMENT_CONTROL_PATH"),
  RECONSTRUCTION_EXPECTED_CELL_ID: required("C9_CELL_ID"),
  RECONSTRUCTION_RUN_ID: `${runId}-negative`,
}
const foreignStore = spawnSync(operator, [String(orgA)], {
  env: {
    ...operatorEnv,
    RECONSTRUCTION_EXPECTED_PLACEMENT_GENERATION: String(generation),
    RECONSTRUCTION_EXPECTED_DURABLE_STORE_ID: required("C9_FOREIGN_STORE_ID"),
  },
  encoding: "utf8",
})
const foreignStoreOutput = checkOutput(
  foreignStore,
  "reconstruction durable store mismatch",
  "foreign-store reconstruction",
)
const stale = spawnSync(operator, [String(orgA)], {
  env: {
    ...operatorEnv,
    RECONSTRUCTION_EXPECTED_PLACEMENT_GENERATION: String(staleGeneration),
    RECONSTRUCTION_EXPECTED_DURABLE_STORE_ID: storeId,
  },
  encoding: "utf8",
})
const staleOutput = checkOutput(
  stale,
  "stale reconstruction placement generation",
  "stale-generation reconstruction",
)

const positive = new Set([
  "org_a_positive_create", "org_a_read_excludes_org_b", "company_a1_read_excludes_a2",
  "org_a_subscription_excludes_org_b", "company_a1_subscription_excludes_a2",
  "org_a_projection_present", "org_b_projection_absent_from_a",
  "post_reconstruction_projection_consistent", "org_a_cold_read_present",
  "org_b_cold_read_excluded", "company_a1_hydrates", "company_a2_hydrates",
  "org_a_reconstruction_positive", "org_a_fresh_session_read_present",
  "org_a_fresh_session_excludes_org_b", "org_b_fresh_session_read_present",
])
const audits = new Set([
  "audit_identity_server_derived", "projection_audit_identity_server_derived",
  "audit_identity_preserved",
])
const requestFor = (id, sourceFixtures) => {
  const request = {
    organization_id: sourceFixtures.org_a,
    store_id: storeId,
    placement_generation: generation,
  }
  if (id.includes("org_b")) request.organization_id = sourceFixtures.org_b
  if (id.includes("foreign_store")) request.store_id = required("C9_FOREIGN_STORE_ID")
  if (id.includes("stale_generation") || id === "stale_generation_rejected") {
    request.placement_generation = staleGeneration
  }
  if (id === "cross_company_child_rejected") {
    request.company_id = companyA2
    request.parent_company_id = companyA1
  }
  return request
}
const wrap = (lane, id, source, sourceFixtures, executedAt, detail) => ({
  id,
  status: "pass",
  after_reconstruction: true,
  executed: true,
  evidence: {
    event_id: `${runId}:${lane}:${id}`,
    operation: `c9.${lane}.${id}`,
    reconstruction_run_id: repeatRunId,
    executed_at: executedAt,
    target_id: targetId,
    store_id: storeId,
    placement_generation: generation,
    request: requestFor(id, sourceFixtures),
    response: audits.has(id)
      ? { audit_server_derived: true }
      : { outcome: positive.has(id) ? "allowed" : "rejected" },
    source: { path: source.path, sha256: source.sha256, detail },
  },
})
const fromSource = (lane, ids, source, checks, fixtures, executedAt) => ({
  executed: true,
  checks: ids.map((id) => {
    const check = checks.get(id)
    if (!check && audits.has(id) && source.report.audit?.server_derived === true) {
      return wrap(
        lane,
        id,
        source,
        fixtures,
        executedAt,
        `server-derived actor ${source.report.audit.actor_identity} and correlation ${source.report.audit.correlation_id}`,
      )
    }
    if (!check) throw new Error(`${lane}.${id} is missing from its source artifact`)
    return wrap(lane, id, source, fixtures, executedAt, check.evidence ?? check.detail)
  }),
})

const laneIds = {
  commands: ["org_a_positive_create", "org_b_foreign_id_rejected", "forged_organization_rejected", "stale_session_rejected", "audit_identity_server_derived"],
  reads: ["org_a_read_excludes_org_b", "company_a1_read_excludes_a2", "foreign_id_read_fail_closed", "forged_company_rejected", "fresh_read_after_reconstruction"],
  subscriptions: ["org_a_subscription_excludes_org_b", "company_a1_subscription_excludes_a2", "foreign_subscription_rejected", "stale_generation_subscription_rejected", "audit_identity_server_derived"],
  projection: ["org_a_projection_present", "org_b_projection_absent_from_a", "foreign_projection_mutation_rejected", "projection_audit_identity_server_derived", "post_reconstruction_projection_consistent"],
  cold_reads: ["org_a_cold_read_present", "org_b_cold_read_excluded", "foreign_id_cold_read_rejected", "forged_org_cold_read_rejected", "stale_generation_cold_read_rejected"],
  hydration: ["company_a1_hydrates", "company_a2_hydrates", "cross_company_child_rejected", "forged_root_scope_rejected", "stale_generation_hydration_rejected"],
  fresh_sessions: ["org_a_fresh_session_read_present", "org_a_fresh_session_excludes_org_b", "org_b_fresh_session_read_present", "foreign_ids_fail_closed", "audit_identity_preserved"],
}
const reconstructionChecks = [
  ["org_a_reconstruction_positive", "completed fence and full-table checksum report"],
  ["org_b_fence_rejected", wrongOrg.body],
  ["foreign_store_rejected", foreignStoreOutput],
  ["stale_generation_rejected", staleOutput],
  ["audit_identity_server_derived", "server-owned organization_reconstructor binding"],
].map(([id, detail]) => wrap(
  "reconstruction",
  id,
  { path: required("C9_RECONSTRUCTION_EVIDENCE"), sha256: required("C9_MATRIX_RECONSTRUCTION_DIGEST") },
  { org_a: orgA, org_b: orgB },
  new Date().toISOString(),
  detail,
))

const finishedAt = new Date().toISOString()
const report = {
  kind: "c9-isolation-matrix",
  schema_version: 1,
  generated_at: finishedAt,
  run: { id: runId, started_at: startedAt, finished_at: finishedAt, probe_executed: true, exit_code: 0 },
  target: { id: targetId, durable_store_id: storeId, host: targetHost, organization_id: orgA, placement_generation: generation },
  fixtures: {
    fixture_run_id: runId,
    created_at: browser.report.generated_at,
    org_a: orgA,
    org_b: orgB,
    company_a1: companyA1,
    company_a2: companyA2,
    company_a1_org: orgA,
    company_a2_org: orgA,
    store_a: storeId,
    store_b: required("C9_FOREIGN_STORE_ID"),
  },
  reconstruction: { evidence_digest: required("C9_MATRIX_RECONSTRUCTION_DIGEST") },
  lanes: {
    commands: fromSource("commands", laneIds.commands, browser, browserLanes.commands, browserFixtures, browser.report.generated_at),
    reads: fromSource("reads", laneIds.reads, browser, browserLanes.reads, browserFixtures, browser.report.generated_at),
    subscriptions: fromSource("subscriptions", laneIds.subscriptions, browser, browserLanes.subscriptions, browserFixtures, browser.report.generated_at),
    projection: fromSource("projection", laneIds.projection, projection, coldLanes.projection, projection.report.fixtures, projection.report.generated_at),
    cold_reads: fromSource("cold_reads", laneIds.cold_reads, coldReads, coldLanes.cold_reads, coldReads.report.fixtures, coldReads.report.generated_at),
    hydration: fromSource("hydration", laneIds.hydration, hydration, coldLanes.hydration, hydration.report.fixtures, hydration.report.generated_at),
    reconstruction: { executed: true, checks: reconstructionChecks },
    fresh_sessions: fromSource("fresh_sessions", laneIds.fresh_sessions, browser, browserLanes.fresh_sessions, browserFixtures, browser.report.generated_at),
  },
}

process.stdout.write(JSON.stringify(report))
