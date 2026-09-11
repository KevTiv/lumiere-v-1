#!/usr/bin/env node
/**
 * C9 tenant-isolation evidence gate.
 *
 * Static and replay modes validate evidence already on disk and never claim a
 * live result. Live mode runs one concrete matrix adapter and binds its report
 * to a fresh reconstruction bundle. There is intentionally no one-command-
 * per-lane escape hatch: a command which prints forty `pass` labels without
 * execution evidence is rejected by the schema below.
 */

import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const evidenceDir = path.resolve(
  process.env.C9_MATRIX_EVIDENCE_DIR ?? path.join(root, ".c9-matrix-evidence"),
)
const MATRIX_FILE = "matrix.json"
const MAX_AGE_SECONDS = Number(process.env.C9_MATRIX_MAX_AGE_SECONDS ?? 24 * 60 * 60)
if (!Number.isFinite(MAX_AGE_SECONDS) || MAX_AGE_SECONDS <= 0) {
  throw new Error("C9_MATRIX_MAX_AGE_SECONDS must be a positive number")
}

const LANES = {
  commands: [
    "org_a_positive_create",
    "org_b_foreign_id_rejected",
    "forged_organization_rejected",
    "stale_session_rejected",
    "audit_identity_server_derived",
  ],
  reads: [
    "org_a_read_excludes_org_b",
    "company_a1_read_excludes_a2",
    "foreign_id_read_fail_closed",
    "forged_company_rejected",
    "fresh_read_after_reconstruction",
  ],
  subscriptions: [
    "org_a_subscription_excludes_org_b",
    "company_a1_subscription_excludes_a2",
    "foreign_subscription_rejected",
    "stale_generation_subscription_rejected",
    "audit_identity_server_derived",
  ],
  projection: [
    "org_a_projection_present",
    "org_b_projection_absent_from_a",
    "foreign_projection_mutation_rejected",
    "projection_audit_identity_server_derived",
    "post_reconstruction_projection_consistent",
  ],
  cold_reads: [
    "org_a_cold_read_present",
    "org_b_cold_read_excluded",
    "foreign_id_cold_read_rejected",
    "forged_org_cold_read_rejected",
    "stale_generation_cold_read_rejected",
  ],
  hydration: [
    "company_a1_hydrates",
    "company_a2_hydrates",
    "cross_company_child_rejected",
    "forged_root_scope_rejected",
    "stale_generation_hydration_rejected",
  ],
  reconstruction: [
    "org_a_reconstruction_positive",
    "org_b_fence_rejected",
    "foreign_store_rejected",
    "stale_generation_rejected",
    "audit_identity_server_derived",
  ],
  fresh_sessions: [
    "org_a_fresh_session_read_present",
    "org_a_fresh_session_excludes_org_b",
    "org_b_fresh_session_read_present",
    "foreign_ids_fail_closed",
    "audit_identity_preserved",
  ],
}

const ALL_CHECKS = Object.values(LANES).flat()
const POSITIVE_CHECKS = new Set([
  "org_a_positive_create",
  "org_a_read_excludes_org_b",
  "company_a1_read_excludes_a2",
  "org_a_subscription_excludes_org_b",
  "company_a1_subscription_excludes_a2",
  "org_a_projection_present",
  "org_b_projection_absent_from_a",
  "post_reconstruction_projection_consistent",
  "org_a_cold_read_present",
  "org_b_cold_read_excluded",
  "company_a1_hydrates",
  "company_a2_hydrates",
  "org_a_reconstruction_positive",
  "org_a_fresh_session_read_present",
  "org_a_fresh_session_excludes_org_b",
  "org_b_fresh_session_read_present",
])
const AUDIT_CHECKS = new Set([
  "audit_identity_server_derived",
  "projection_audit_identity_server_derived",
  "audit_identity_preserved",
])

function fail(message, missing = []) {
  const suffix = missing.length ? `; missing evidence: ${missing.join(", ")}` : ""
  console.error(`[c9-matrix] ${message}${suffix}`)
  process.exitCode = 2
}

function usage() {
  console.log(`Usage: node scripts/c9-isolation-matrix.mjs [--static|--replay|--live]

--static  Validate the checked-in harness contract; no live services are run.
--replay  Validate matrix.json without claiming that probes ran now.
--live    Run C9_MATRIX_PROBE_CMD once and validate its complete fresh report.

Live mode also requires C9_RECONSTRUCTION_EVIDENCE, a JSON reconstruction
bundle (or a directory containing resume.json and repeat.json). The adapter
must print one matrix JSON object to stdout. Eight independent lane commands
are not accepted.`)
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new Error(`${label}: cannot parse ${file}: ${error.message}`)
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`)
}

function isoTime(value, label) {
  nonEmptyString(value, label)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp`)
  return parsed
}

function digestJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function digestBytes(value) {
  return createHash("sha256").update(value).digest("hex")
}

function asNumber(value, label) {
  const number = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value
  positiveInteger(number, label)
  return number
}

function resolveReconstructionInput(input) {
  if (!input) throw new Error("C9_RECONSTRUCTION_EVIDENCE is required in live mode")
  const resolved = path.resolve(root, input)
  if (!existsSync(resolved)) throw new Error(`reconstruction evidence does not exist: ${resolved}`)
  return resolved
}

function validateSourceArtifacts(artifacts, label = "source_artifacts") {
  if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error(`${label} are required`)
  const names = new Set()
  for (const artifact of artifacts) {
    if (!isObject(artifact)) throw new Error(`${label} entries must be objects`)
    nonEmptyString(artifact.name, `${label}.name`)
    nonEmptyString(artifact.path, `${label}.${artifact.name}.path`)
    if (names.has(artifact.name)) throw new Error(`${label} contains duplicate ${artifact.name}`)
    names.add(artifact.name)
    if (!/^[0-9a-f]{64}$/i.test(artifact.sha256 ?? "")) throw new Error(`${label}.${artifact.name}.sha256 must be SHA-256 hex`)
  }
  return artifacts
}

function exactWatermark(left, right, label) {
  if (!isObject(left) || !isObject(right)) throw new Error(`${label} watermark is required in both reports`)
  if (left.sequence !== right.sequence || left.commit_checksum !== right.commit_checksum) {
    throw new Error(`${label} resume/repeat watermarks must match exactly`)
  }
  positiveInteger(asNumber(left.sequence, `${label}.sequence`), `${label}.sequence`)
  nonEmptyString(left.commit_checksum, `${label}.commit_checksum`)
  if (!/^(?:sha256:)?[0-9a-f]{64}$/i.test(left.commit_checksum)) throw new Error(`${label}.commit_checksum must be SHA-256 hex`)
  return { sequence: asNumber(left.sequence, `${label}.sequence`), commit_checksum: left.commit_checksum }
}

function normalizeReconstruction(input) {
  const resolved = resolveReconstructionInput(input)
  let raw
  let sourceArtifacts
  try {
    raw = readJson(resolved, "reconstruction evidence")
    sourceArtifacts = [{ name: "bundle", path: resolved, sha256: digestBytes(readFileSync(resolved)) }]
  } catch {
    const resumePath = path.join(resolved, "resume.json")
    const repeatPath = path.join(resolved, "repeat.json")
    const targetPath = path.join(resolved, "target.json")
    const fencePath = path.join(resolved, "fence.json")
    const metadataPath = path.join(resolved, "metadata.json")
    if (!existsSync(resumePath) || !existsSync(repeatPath)) {
      throw new Error(`reconstruction evidence directory must contain resume.json and repeat.json: ${resolved}`)
    }
    if (!existsSync(targetPath) || !existsSync(fencePath)) {
      throw new Error(`reconstruction evidence directory must contain explicit target.json and fence.json: ${resolved}`)
    }
    if (!existsSync(metadataPath)) throw new Error(`reconstruction evidence directory must contain explicit metadata.json: ${resolved}`)
    sourceArtifacts = [resumePath, repeatPath, targetPath, fencePath, metadataPath].map((file) => ({
      name: path.basename(file, ".json"),
      path: file,
      sha256: digestBytes(readFileSync(file)),
    }))
    raw = {
      ...readJson(metadataPath, "reconstruction metadata"),
      target: readJson(targetPath, "reconstruction target"),
      fence: readJson(fencePath, "reconstruction fence"),
      resume: readJson(resumePath, "reconstruction resume report"),
      repeat: readJson(repeatPath, "reconstruction repeat report"),
    }
  }

  const resume = raw.resume ?? raw.runs?.resume ?? raw.reconstruction?.resume
  const repeat = raw.repeat ?? raw.runs?.repeat ?? raw.reconstruction?.repeat
  if (!isObject(resume) || !isObject(repeat)) {
    throw new Error("reconstruction evidence must contain distinct resume and repeat reports")
  }
  const counts = []
  for (const [name, report] of [["resume", resume], ["repeat", repeat]]) {
    if (report.verified !== true) throw new Error(`reconstruction ${name} report is not verified`)
    counts.push({
      restored_tables: asNumber(report.restored_tables, `reconstruction ${name}.restored_tables`),
      restored_rows: asNumber(report.restored_rows, `reconstruction ${name}.restored_rows`),
    })
    nonEmptyString(report.run_id, `reconstruction ${name}.run_id`)
    positiveInteger(asNumber(report.organization_id, `reconstruction ${name}.organization_id`), `reconstruction ${name}.organization_id`)
    positiveInteger(asNumber(report.placement_generation, `reconstruction ${name}.placement_generation`), `reconstruction ${name}.placement_generation`)
  }
  if (resume.run_id === repeat.run_id) throw new Error("reconstruction resume and repeat run IDs must differ")
  if (counts[0].restored_tables !== counts[1].restored_tables || counts[0].restored_rows !== counts[1].restored_rows) {
    throw new Error("reconstruction resume/repeat restored table and row counts must match exactly")
  }

  const watermark = exactWatermark(resume.watermark, repeat.watermark, "reconstruction")
  if (raw.watermark && (raw.watermark.sequence !== watermark.sequence || raw.watermark.commit_checksum !== watermark.commit_checksum)) {
    throw new Error("reconstruction top-level watermark does not match resume/repeat")
  }

  const target = raw.target
  if (isObject(target?.target)) raw.target = target.target
  const resolvedTarget = raw.target
  if (!isObject(resolvedTarget)) throw new Error("explicit reconstruction target metadata is required")
  const targetId = resolvedTarget.id ?? resolvedTarget.cell_id ?? resolvedTarget.module
  const storeId = resolvedTarget.durable_store_id ?? resolvedTarget.store_id
  nonEmptyString(targetId, "reconstruction target.id")
  nonEmptyString(storeId, "reconstruction target.durable_store_id")
  const generation = asNumber(
    resolvedTarget.placement_generation,
    "reconstruction target.placement_generation",
  )
  const organizationId = asNumber(
    resolvedTarget.organization_id,
    "reconstruction target.organization_id",
  )
  const fence = raw.fence
  if (isObject(fence?.fence)) raw.fence = fence.fence
  const resolvedFence = raw.fence
  if (!isObject(resolvedFence) || resolvedFence.state !== "complete" || resolvedFence.complete !== true) {
    throw new Error("reconstruction target fence must have an executed complete state")
  }
  if (asNumber(resolvedFence.organization_id, "reconstruction fence.organization_id") !== organizationId) {
    throw new Error("reconstruction fence organization does not match target")
  }
  if (asNumber(resolvedFence.placement_generation, "reconstruction fence.placement_generation") !== generation) {
    throw new Error("reconstruction fence generation does not match target")
  }
  if (resolvedFence.run_id && resolvedFence.run_id !== repeat.run_id) {
    throw new Error("reconstruction fence must record the completed repeat run")
  }
  const capturedAt = raw.captured_at
  const capturedMillis = isoTime(capturedAt, "reconstruction captured_at")
  validateSourceArtifacts(sourceArtifacts)
  return {
    schema_version: 1,
    kind: "c9-reconstruction-evidence",
    evidence_digest: digestJson(raw),
    captured_at: capturedAt,
    captured_millis: capturedMillis,
    source_artifacts: sourceArtifacts,
    target: {
      id: targetId,
      durable_store_id: storeId,
      organization_id: organizationId,
      placement_generation: generation,
    },
    resume: {
      run_id: resume.run_id,
      restored_tables: counts[0].restored_tables,
      restored_rows: counts[0].restored_rows,
      watermark,
    },
    repeat: {
      run_id: repeat.run_id,
      restored_tables: counts[1].restored_tables,
      restored_rows: counts[1].restored_rows,
      watermark,
    },
    watermark,
    fence: { state: resolvedFence.state, run_id: resolvedFence.run_id ?? repeat.run_id },
  }
}

function validateFixtures(fixtures) {
  if (!isObject(fixtures)) throw new Error("fixtures are required")
  for (const key of ["org_a", "org_b", "company_a1", "company_a2"]) positiveInteger(fixtures[key], `fixtures.${key}`)
  if (fixtures.org_a === fixtures.org_b) throw new Error("Org A and Org B must differ")
  if (fixtures.company_a1 === fixtures.company_a2) throw new Error("Company A1 and A2 must differ")
  if (fixtures.company_a1_org !== fixtures.org_a || fixtures.company_a2_org !== fixtures.org_a) {
    throw new Error("Company A1/A2 must be owned by Org A")
  }
  nonEmptyString(fixtures.fixture_run_id, "fixtures.fixture_run_id")
  isoTime(fixtures.created_at, "fixtures.created_at")
  nonEmptyString(fixtures.store_a, "fixtures.store_a")
  nonEmptyString(fixtures.store_b, "fixtures.store_b")
  if (fixtures.store_a === fixtures.store_b) throw new Error("fixtures.store_a and store_b must differ")
}

function expectedOutcome(id) {
  if (AUDIT_CHECKS.has(id)) return "audit"
  return POSITIVE_CHECKS.has(id) ? "allowed" : "rejected"
}

function validateCheck(check, lane, target, fixtures, reconstruction) {
  if (!isObject(check)) throw new Error(`${lane}: checks must contain objects`)
  nonEmptyString(check.id, `${lane}: check.id`)
  if (check.status !== "pass") throw new Error(`${lane}: check ${check.id} is not pass`)
  if (check.after_reconstruction !== true) throw new Error(`${lane}: check ${check.id} lacks post-reconstruction proof`)
  if (check.executed !== true) throw new Error(`${lane}: check ${check.id} lacks executed evidence`)
  const expected = expectedOutcome(check.id)
  if (!isObject(check.evidence)) throw new Error(`${lane}: check ${check.id} lacks concrete evidence`)
  const evidence = check.evidence
  nonEmptyString(evidence.event_id, `${lane}: check ${check.id}.evidence.event_id`)
  nonEmptyString(evidence.operation, `${lane}: check ${check.id}.evidence.operation`)
  nonEmptyString(evidence.reconstruction_run_id, `${lane}: check ${check.id}.evidence.reconstruction_run_id`)
  if (evidence.reconstruction_run_id !== reconstruction.repeat.run_id) {
    throw new Error(`${lane}: check ${check.id} is not bound to the completed repeat run`)
  }
  const executedAt = isoTime(evidence.executed_at, `${lane}: check ${check.id}.evidence.executed_at`)
  if (!isObject(evidence.request) || !isObject(evidence.response)) {
    throw new Error(`${lane}: check ${check.id} must include request and response evidence`)
  }
  if (evidence.target_id !== target.id || evidence.store_id !== target.durable_store_id) {
    throw new Error(`${lane}: check ${check.id} target/store does not match reconstruction target`)
  }
  if (evidence.placement_generation !== target.placement_generation) {
    throw new Error(`${lane}: check ${check.id} generation does not match reconstruction target`)
  }
  if (expected === "audit") {
    if (evidence.response.audit_server_derived !== true) throw new Error(`${lane}: check ${check.id} lacks server-derived audit evidence`)
  } else if (evidence.response.outcome !== expected) {
    throw new Error(`${lane}: check ${check.id} observed ${evidence.response.outcome ?? "no outcome"}, expected ${expected}`)
  }
  const request = evidence.request
  if (["org_b_foreign_id_rejected", "org_b_fence_rejected"].includes(check.id) && request.organization_id !== fixtures.org_b) throw new Error(`${lane}: check ${check.id} did not execute with Org B`)
  if (check.id === "org_b_fresh_session_read_present" && request.organization_id !== fixtures.org_b) throw new Error(`${lane}: check ${check.id} did not execute with Org B`)
  if (check.id.includes("foreign_store") && request.store_id === target.durable_store_id) throw new Error(`${lane}: check ${check.id} did not use a foreign store`)
  if (check.id.includes("stale_generation") || check.id === "stale_generation_rejected") {
    if (!Number.isInteger(request.placement_generation) || request.placement_generation >= target.placement_generation) throw new Error(`${lane}: check ${check.id} did not use a stale generation`)
  }
  if (check.id === "cross_company_child_rejected") {
    if (request.company_id !== fixtures.company_a2 || request.parent_company_id !== fixtures.company_a1) throw new Error(`${lane}: cross-company child evidence is not A2 under A1`)
  }
  if (executedAt < reconstruction.captured_millis) throw new Error(`${lane}: check ${check.id} predates reconstruction completion`)
  return check.id
}

function validateMatrix(report, { live = false, startedMillis = 0, runId = "" } = {}) {
  if (!isObject(report)) throw new Error("matrix report must be a JSON object")
  if (report.kind !== "c9-isolation-matrix" || report.schema_version !== 1) throw new Error("matrix report kind/schema_version is invalid")
  const generatedMillis = isoTime(report.generated_at, "matrix generated_at")
  if (live && generatedMillis > Date.now() + 60_000) throw new Error("matrix report timestamp is in the future")
  if (live && generatedMillis < startedMillis) throw new Error("matrix report is older than this live run")
  if (live && Date.now() - generatedMillis > MAX_AGE_SECONDS * 1000) throw new Error("matrix report is stale")
  if (!isObject(report.run)) throw new Error("matrix run metadata is required")
  nonEmptyString(report.run.id, "matrix run.id")
  if (live && report.run.id !== runId) throw new Error("matrix run.id does not match the runner-issued run ID")
  const runStarted = isoTime(report.run.started_at, "matrix run.started_at")
  const runFinished = isoTime(report.run.finished_at, "matrix run.finished_at")
  if (runFinished < runStarted || (live && runStarted < startedMillis)) throw new Error("matrix run timestamps are invalid or stale")
  if (report.run.probe_executed !== true || report.run.exit_code !== 0) throw new Error("matrix run does not prove a successful executed probe")
  if (!isObject(report.target)) throw new Error("matrix target metadata is required")
  const target = report.target
  nonEmptyString(target.id, "matrix target.id")
  nonEmptyString(target.durable_store_id, "matrix target.durable_store_id")
  nonEmptyString(target.host, "matrix target.host")
  positiveInteger(target.organization_id, "matrix target.organization_id")
  positiveInteger(target.placement_generation, "matrix target.placement_generation")
  validateFixtures(report.fixtures)
  if (target.organization_id !== report.fixtures.org_a) throw new Error("matrix target must be Org A")
  const reconstruction = report.reconstruction
  if (!isObject(reconstruction) || reconstruction.target?.id !== target.id || reconstruction.target.durable_store_id !== target.durable_store_id || reconstruction.target.organization_id !== target.organization_id || reconstruction.target.placement_generation !== target.placement_generation) {
    throw new Error("matrix reconstruction target does not match matrix target")
  }
  if (reconstruction.schema_version !== 1 || reconstruction.kind !== "c9-reconstruction-evidence") throw new Error("matrix reconstruction evidence kind/schema_version is invalid")
  validateSourceArtifacts(reconstruction.source_artifacts, "matrix reconstruction.source_artifacts")
  isoTime(reconstruction.captured_at, "matrix reconstruction.captured_at")
  for (const [name, report] of [["resume", reconstruction.resume], ["repeat", reconstruction.repeat]]) {
    if (!isObject(report)) throw new Error(`matrix reconstruction ${name} report is required`)
    nonEmptyString(report.run_id, `matrix reconstruction ${name}.run_id`)
    positiveInteger(report.restored_tables, `matrix reconstruction ${name}.restored_tables`)
    positiveInteger(report.restored_rows, `matrix reconstruction ${name}.restored_rows`)
  }
  if (reconstruction.resume.run_id === reconstruction.repeat.run_id) throw new Error("matrix reconstruction resume and repeat run IDs must differ")
  const matrixWatermark = exactWatermark(reconstruction.resume.watermark, reconstruction.repeat.watermark, "matrix reconstruction")
  if (!isObject(reconstruction.watermark) || reconstruction.watermark.sequence !== matrixWatermark.sequence || reconstruction.watermark.commit_checksum !== matrixWatermark.commit_checksum) throw new Error("matrix reconstruction top-level watermark does not match resume/repeat")
  if (reconstruction.resume.restored_tables !== reconstruction.repeat.restored_tables || reconstruction.resume.restored_rows !== reconstruction.repeat.restored_rows) throw new Error("matrix reconstruction resume/repeat counts do not match")
  if (!isObject(reconstruction.fence) || reconstruction.fence.state !== "complete" || reconstruction.fence.run_id !== reconstruction.repeat.run_id) throw new Error("matrix reconstruction target fence is not complete")
  const lanes = report.lanes
  if (!isObject(lanes)) throw new Error("matrix lanes are required")
  const eventIds = new Set()
  for (const [lane, ids] of Object.entries(LANES)) {
    const laneReport = lanes[lane]
    if (!isObject(laneReport) || laneReport.executed !== true || !Array.isArray(laneReport.checks)) throw new Error(`${lane}: executed checks are required`)
    if (laneReport.checks.length !== ids.length) throw new Error(`${lane}: report must contain exactly ${ids.length} checks`)
    const checkIds = new Set()
    for (const check of laneReport.checks) {
      if (!ids.includes(check?.id) || checkIds.has(check.id)) throw new Error(`${lane}: unknown or duplicate check ${check?.id ?? "<missing>"}`)
      checkIds.add(check.id)
      const eventId = validateCheck(check, lane, target, report.fixtures, reconstruction)
      if (eventIds.has(check.evidence.event_id)) throw new Error(`duplicate evidence event ${eventId}`)
      eventIds.add(check.evidence.event_id)
    }
  }
  if (eventIds.size !== ALL_CHECKS.length) throw new Error(`matrix executed evidence contains ${eventIds.size} events, expected ${ALL_CHECKS.length}`)
  return { lanes: Object.keys(LANES).length, checks: eventIds.size, generated_at: report.generated_at }
}

function staticContract() {
  const requiredFiles = [
    "scripts/c9-service-identity-drill.mjs",
    "scripts/c7-reconstruction-drill.sh",
    "api-server/src/cold_tier/read_plan.rs",
    "api-server/src/cold_tier/hydration.rs",
    "api-server/src/organization_placement.rs",
  ]
  const missing = requiredFiles.filter((file) => !existsSync(path.join(root, file)))
  if (missing.length) throw new Error(`static contract missing harness files: ${missing.join(", ")}`)
  console.log("[c9-matrix] static contract OK; 8 lanes, 40 required executed assertions; live probes and reconstruction evidence were not run")
  console.log("[c9-matrix] remaining evidence: run one concrete C9_MATRIX_PROBE_CMD against a fresh target with C9_RECONSTRUCTION_EVIDENCE")
}

function runProbe(command, env) {
  const result = spawnSync(command, { cwd: root, env, encoding: "utf8", shell: true, maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw new Error(`matrix probe failed to start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`matrix probe exited ${result.status}: ${(result.stderr || result.stdout).trim()}`)
  const stdout = result.stdout.trim()
  if (!stdout) throw new Error("matrix probe printed no JSON report")
  try { return JSON.parse(stdout) } catch (error) { throw new Error(`matrix probe stdout must be one JSON report: ${error.message}`) }
}

function liveContract() {
  const command = process.env.C9_MATRIX_PROBE_CMD
  if (!command) throw new Error("C9_MATRIX_PROBE_CMD is required in live mode")
  const reconstruction = normalizeReconstruction(
    process.env.C9_RECONSTRUCTION_EVIDENCE ??
      process.env.C9_RECONSTRUCTION_EVIDENCE_DIR ??
      process.env.C7_EVIDENCE_DIR,
  )
  if (reconstruction.captured_millis > Date.now() + 60_000) throw new Error("reconstruction evidence timestamp is in the future")
  if (Date.now() - reconstruction.captured_millis > MAX_AGE_SECONDS * 1000) throw new Error("reconstruction evidence is stale")
  const startedMillis = Date.now()
  const runId = process.env.C9_MATRIX_RUN_ID || `c9-matrix-${Date.now()}-${randomUUID()}`
  const report = runProbe(command, { ...process.env, C9_MATRIX_RUN_ID: runId, C9_MATRIX_RECONSTRUCTION_DIGEST: reconstruction.evidence_digest })
  if (isObject(report.reconstruction) && report.reconstruction.evidence_digest !== reconstruction.evidence_digest) {
    throw new Error("matrix probe reconstruction evidence digest does not match the validated bundle")
  }
  report.reconstruction = reconstruction
  const summary = validateMatrix(report, { live: true, startedMillis, runId })
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(path.join(evidenceDir, MATRIX_FILE), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`[c9-matrix] LIVE PASS; ${summary.lanes} lanes and ${summary.checks} executed post-reconstruction assertions passed; evidence=${path.join(evidenceDir, MATRIX_FILE)}`)
}

function replayContract() {
  const reportPath = process.env.C9_MATRIX_EVIDENCE_FILE ? path.resolve(root, process.env.C9_MATRIX_EVIDENCE_FILE) : path.join(evidenceDir, MATRIX_FILE)
  if (!existsSync(reportPath)) throw new Error(`matrix evidence is missing: ${reportPath}`)
  const summary = validateMatrix(readJson(reportPath, "matrix evidence"))
  console.log(`[c9-matrix] REPLAY VALID; ${summary.lanes} lanes and ${summary.checks} executed assertions satisfy the evidence schema; no live probes were executed`)
}

const mode = process.argv[2]
if (mode === "--help" || mode === "-h") usage()
else if (mode === "--static") { try { staticContract() } catch (error) { fail(error.message) } }
else if (mode === "--live") { try { liveContract() } catch (error) { fail(error.message) } }
else if (mode === "--replay") { try { replayContract() } catch (error) { fail(error.message) } }
else { usage(); fail("mode is required") }
