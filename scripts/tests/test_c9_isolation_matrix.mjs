#!/usr/bin/env node
/** Focused fail-closed checks for the C9 matrix evidence gate. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..")
const runner = path.join(root, "scripts/c9-isolation-matrix.mjs")
const now = new Date().toISOString()
const later = new Date(Date.now() + 1000).toISOString()

function run(args, env = {}) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const laneIds = {
  commands: ["org_a_positive_create", "org_b_foreign_id_rejected", "forged_organization_rejected", "stale_session_rejected", "audit_identity_server_derived"],
  reads: ["org_a_read_excludes_org_b", "company_a1_read_excludes_a2", "foreign_id_read_fail_closed", "forged_company_rejected", "fresh_read_after_reconstruction"],
  subscriptions: ["org_a_subscription_excludes_org_b", "company_a1_subscription_excludes_a2", "foreign_subscription_rejected", "stale_generation_subscription_rejected", "audit_identity_server_derived"],
  projection: ["org_a_projection_present", "org_b_projection_absent_from_a", "foreign_projection_mutation_rejected", "projection_audit_identity_server_derived", "post_reconstruction_projection_consistent"],
  cold_reads: ["org_a_cold_read_present", "org_b_cold_read_excluded", "foreign_id_cold_read_rejected", "forged_org_cold_read_rejected", "stale_generation_cold_read_rejected"],
  hydration: ["company_a1_hydrates", "company_a2_hydrates", "cross_company_child_rejected", "forged_root_scope_rejected", "stale_generation_hydration_rejected"],
  reconstruction: ["org_a_reconstruction_positive", "org_b_fence_rejected", "foreign_store_rejected", "stale_generation_rejected", "audit_identity_server_derived"],
  fresh_sessions: ["org_a_fresh_session_read_present", "org_a_fresh_session_excludes_org_b", "org_b_fresh_session_read_present", "foreign_ids_fail_closed", "audit_identity_preserved"],
}
const positive = new Set(["org_a_positive_create", "org_a_read_excludes_org_b", "company_a1_read_excludes_a2", "org_a_subscription_excludes_org_b", "company_a1_subscription_excludes_a2", "org_a_projection_present", "org_b_projection_absent_from_a", "post_reconstruction_projection_consistent", "org_a_cold_read_present", "org_b_cold_read_excluded", "company_a1_hydrates", "company_a2_hydrates", "org_a_reconstruction_positive", "org_a_fresh_session_read_present", "org_a_fresh_session_excludes_org_b", "org_b_fresh_session_read_present"])
const audit = new Set(["audit_identity_server_derived", "projection_audit_identity_server_derived", "audit_identity_preserved"])

function reconstruction() {
  const watermark = { sequence: 7, commit_checksum: "a".repeat(64) }
  return {
    schema_version: 1,
    kind: "c9-reconstruction-evidence",
    captured_at: now,
    target: { id: "fresh-c9-module", durable_store_id: "store-a", organization_id: 101, placement_generation: 2 },
    resume: { run_id: "resume-run", organization_id: 101, placement_generation: 2, restored_tables: 4, restored_rows: 9, verified: true, watermark: { ...watermark } },
    repeat: { run_id: "repeat-run", organization_id: 101, placement_generation: 2, restored_tables: 4, restored_rows: 9, verified: true, watermark: { ...watermark } },
    watermark,
    fence: { state: "complete", complete: true, run_id: "repeat-run", organization_id: 101, placement_generation: 2 },
  }
}

function matrix(runId = "matrix-test-run", mutate = () => {}) {
  const report = {
    kind: "c9-isolation-matrix",
    schema_version: 1,
    generated_at: later,
    run: { id: runId, started_at: now, finished_at: later, probe_executed: true, exit_code: 0 },
    target: { id: "fresh-c9-module", durable_store_id: "store-a", host: "http://127.0.0.1:3000", organization_id: 101, placement_generation: 2 },
    fixtures: { fixture_run_id: "fixture-run", created_at: now, org_a: 101, org_b: 202, company_a1: 1001, company_a2: 1002, company_a1_org: 101, company_a2_org: 101, store_a: "store-a", store_b: "store-b" },
    reconstruction: { ...reconstruction(), source_artifacts: [{ name: "bundle", path: "reconstruction.json", sha256: "b".repeat(64) }], evidence_digest: "fixture-digest" },
    lanes: {},
  }
  for (const [lane, ids] of Object.entries(laneIds)) {
    report.lanes[lane] = { executed: true, checks: ids.map((id, index) => {
      const request = { organization_id: 101, store_id: "store-a", placement_generation: 2 }
      if (id.includes("org_b")) request.organization_id = 202
      if (id === "org_b_fresh_session_read_present") request.organization_id = 202
      if (id.includes("foreign_store")) request.store_id = "store-b"
      if (id.includes("stale_generation") || id === "stale_generation_rejected") request.placement_generation = 1
      if (id === "cross_company_child_rejected") { request.company_id = 1002; request.parent_company_id = 1001 }
      const expected = audit.has(id) ? undefined : positive.has(id) ? "allowed" : "rejected"
      const response = audit.has(id) ? { audit_server_derived: true } : { outcome: expected }
      return { id, status: "pass", after_reconstruction: true, executed: true, evidence: { event_id: `${lane}-${index}`, operation: `probe.${lane}.${id}`, reconstruction_run_id: "repeat-run", executed_at: later, target_id: "fresh-c9-module", store_id: "store-a", placement_generation: 2, request, response } }
    }) }
  }
  mutate(report)
  return report
}

const staticRun = run(["--static"])
assert(staticRun.status === 0, `static mode failed: ${staticRun.stderr}`)
assert(staticRun.stdout.includes("40 required executed assertions"), "static mode did not state the concrete assertion count")
assert(staticRun.stdout.includes("live probes and reconstruction evidence were not run"), "static mode overclaimed live proof")

const tempDir = mkdtempSync(path.join(os.tmpdir(), "lumiere-c9-matrix-"))
try {
  const reconstructionPath = path.join(tempDir, "reconstruction.json")
  writeFileSync(reconstructionPath, JSON.stringify(reconstruction()))
  const missing = run(["--replay"], { C9_MATRIX_EVIDENCE_DIR: tempDir })
  assert(missing.status !== 0 && missing.stderr.includes("matrix evidence is missing"), "replay accepted a missing matrix artifact")

  const valid = matrix()
  const matrixPath = path.join(tempDir, "matrix.json")
  writeFileSync(matrixPath, JSON.stringify(valid))
  const replay = run(["--replay"], { C9_MATRIX_EVIDENCE_DIR: tempDir })
  assert(replay.status === 0, `valid replay rejected: ${replay.stderr}`)
  assert(replay.stdout.includes("REPLAY VALID") && !replay.stdout.includes("LIVE PASS"), "replay overclaimed live execution")

  const probePath = path.join(tempDir, "probe.mjs")
  writeFileSync(probePath, `const report = ${JSON.stringify(valid)}; delete report.reconstruction; report.run.id = process.env.C9_MATRIX_RUN_ID; report.generated_at = new Date().toISOString(); report.run.started_at = report.generated_at; report.run.finished_at = report.generated_at; for (const lane of Object.values(report.lanes)) for (const check of lane.checks) check.evidence.executed_at = report.generated_at; console.log(JSON.stringify(report));\n`)
  const live = run(["--live"], { C9_MATRIX_EVIDENCE_DIR: tempDir, C9_RECONSTRUCTION_EVIDENCE: reconstructionPath, C9_MATRIX_PROBE_CMD: `${process.execPath} ${probePath}` })
  assert(live.status === 0, `concrete live probe rejected: ${live.stderr}`)
  assert(live.stdout.includes("LIVE PASS") && live.stdout.includes("40 executed"), "live mode did not report executed assertions")

  const missingEvidence = run(["--live"], { C9_MATRIX_EVIDENCE_DIR: tempDir, C9_MATRIX_PROBE_CMD: `${process.execPath} ${probePath}` })
  assert(missingEvidence.status !== 0 && missingEvidence.stderr.includes("C9_RECONSTRUCTION_EVIDENCE"), "live mode accepted missing reconstruction evidence")

  const missingMetadataDir = path.join(tempDir, "missing-metadata")
  mkdirSync(missingMetadataDir)
  writeFileSync(path.join(missingMetadataDir, "resume.json"), JSON.stringify(reconstruction().resume))
  writeFileSync(path.join(missingMetadataDir, "repeat.json"), JSON.stringify(reconstruction().repeat))
  const missingMetadata = run(["--live"], { C9_MATRIX_EVIDENCE_DIR: tempDir, C9_RECONSTRUCTION_EVIDENCE: missingMetadataDir, C9_MATRIX_PROBE_CMD: `${process.execPath} ${probePath}` })
  assert(missingMetadata.status !== 0 && missingMetadata.stderr.includes("explicit target.json and fence.json"), "directory evidence accepted missing target/fence metadata")

  const mismatchedReconstruction = reconstruction()
  mismatchedReconstruction.repeat.watermark.commit_checksum = "c".repeat(64)
  const mismatchedReconstructionPath = path.join(tempDir, "mismatched-reconstruction.json")
  writeFileSync(mismatchedReconstructionPath, JSON.stringify(mismatchedReconstruction))
  const mismatchedWatermark = run(["--live"], { C9_MATRIX_EVIDENCE_DIR: tempDir, C9_RECONSTRUCTION_EVIDENCE: mismatchedReconstructionPath, C9_MATRIX_PROBE_CMD: `${process.execPath} ${probePath}` })
  assert(mismatchedWatermark.status !== 0 && mismatchedWatermark.stderr.includes("watermarks must match"), "mismatched resume/repeat watermark passed")

  const envFallback = { ...reconstruction() }
  delete envFallback.target
  delete envFallback.fence
  const envFallbackPath = path.join(tempDir, "env-fallback.json")
  writeFileSync(envFallbackPath, JSON.stringify(envFallback))
  const envFallbackRun = run(["--live"], { C9_MATRIX_EVIDENCE_DIR: tempDir, C9_RECONSTRUCTION_EVIDENCE: envFallbackPath, C9_RECONSTRUCTION_TARGET_ID: "forged-env-target", C9_RECONSTRUCTION_STORE_ID: "forged-env-store", C9_MATRIX_PROBE_CMD: `${process.execPath} ${probePath}` })
  assert(envFallbackRun.status !== 0 && envFallbackRun.stderr.includes("explicit reconstruction target metadata"), "environment target fallback was accepted")

  const forged = matrix("matrix-forged", (report) => { report.lanes.reconstruction.checks.find((check) => check.id === "foreign_store_rejected").evidence.request.store_id = "store-a" })
  writeFileSync(matrixPath, JSON.stringify(forged))
  const forgedRun = run(["--replay"], { C9_MATRIX_EVIDENCE_DIR: tempDir })
  assert(forgedRun.status !== 0 && forgedRun.stderr.includes("foreign store"), "foreign-store lane passed without foreign-store evidence")

  const stale = matrix("matrix-stale", (report) => { report.lanes.hydration.checks.find((check) => check.id === "stale_generation_hydration_rejected").evidence.request.placement_generation = 2 })
  writeFileSync(matrixPath, JSON.stringify(stale))
  const staleRun = run(["--replay"], { C9_MATRIX_EVIDENCE_DIR: tempDir })
  assert(staleRun.status !== 0 && staleRun.stderr.includes("stale generation"), "stale-generation lane passed without stale evidence")

  const forgedChecks = matrix("matrix-forged-check", (report) => { delete report.lanes.reads.checks[0].evidence })
  writeFileSync(matrixPath, JSON.stringify(forgedChecks))
  const forgedCheckRun = run(["--replay"], { C9_MATRIX_EVIDENCE_DIR: tempDir })
  assert(forgedCheckRun.status !== 0 && forgedCheckRun.stderr.includes("concrete evidence"), "label-only check passed")
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

console.log("[c9-matrix-test] passed: static, replay, concrete live probe, reconstruction, foreign-store, stale-generation, and label-only checks")
