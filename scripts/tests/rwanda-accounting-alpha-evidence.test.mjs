import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import {
  validateEvidenceArtifacts,
  validateRwandaAlphaEvidence,
} from "../validate-rwanda-accounting-alpha-evidence.mjs"

const digest = `sha256:${"a".repeat(64)}`
const runId = "rw-alpha-1"
const releaseCommit = "b".repeat(40)
const cutoverDate = "2026-10-16"
const evidence = (path) => ({
  path,
  sha256: digest,
  runId,
  releaseCommit,
  cutoverDate,
})

function validManifest() {
  return {
    schemaVersion: 1,
    run: {
      runId,
      executedAt: "2026-10-16T00:00:00Z",
      cutoverDate,
      tenantRef: "isolated-rw-1",
      companyId: 7,
      isolatedTenantAcknowledged: true,
      migrationMode: "residual_only",
      operator: { name: "Operator", email: "operator@example.com" },
      release: { commit: releaseCommit, contractVersion: "0.3.108", moduleVersion: "wasm-1" },
    },
    technical: {
      checkpoints: Array.from({ length: 8 }, (_, index) => index === 7
        ? { id: 8, status: "not_applicable", reason: "Residual-only migration." }
        : { id: index + 1, status: "pass", evidence: evidence(`checkpoint-${index + 1}.json`) }),
      companionSpecs: [
        { name: "accounting-post-reconcile.spec.ts", status: "pass", evidence: evidence("posted.json") },
        { name: "cov08b-bank-statement-reconcile.spec.ts", status: "pass", evidence: evidence("bank.json") },
      ],
    },
    controlTotals: ["trial_balance_debits", "trial_balance_credits", "receivables_aging", "payables_aging", "tax_control", "bank_and_cash", "retained_earnings"].map((name) => ({
      name, asOfDate: cutoverDate, currency: "RWF", sourceAmount: 100,
      lumiereAmount: 100, difference: 0, tolerance: 0, status: "pass",
      reviewedBy: "Accountant", evidence: evidence(`${name}.csv`),
    })),
    roleChecks: ["alpha_power_user", "bookkeeper", "read_only"].map((name) => ({
      name, status: "pass", evidence: evidence(`${name}.json`),
    })),
    manualChecks: Array.from({ length: 7 }, (_, index) => ({
      id: index + 1, status: "pass", reviewedBy: "Accountant", evidence: evidence(`manual-${index + 1}.pdf`),
    })),
    signoffs: {
      alphaUser: { decision: "accepted", name: "User", role: "Alpha power user", signedAt: "2026-10-16T00:00:00Z", runId, releaseCommit, cutoverDate, evidence: evidence("user.pdf") },
      accountant: { decision: "accepted", name: "Accountant", role: "Rwanda-qualified accountant", signedAt: "2026-10-16T00:00:00Z", runId, releaseCommit, cutoverDate, evidence: evidence("accountant.pdf") },
      legal: { decision: "pending", name: "Legal reviewer", qualification: "Rwanda counsel", rulesetVersion: "0.2.0-draft" },
      tax: { decision: "pending", name: "Tax reviewer", qualification: "Rwanda tax practitioner", rulesetVersion: "0.2.0-draft" },
      rraVsdc: { status: "pending" },
    },
    countryPack: { packKey: "rw", version: "0.2.0-draft", acceptanceStatus: "review_required", enabled: false },
    exceptions: [],
    decisions: { operationalAlpha: "pass", statutoryUse: "fail" },
  }
}

test("accepts residual-only operational evidence while statutory gates remain pending", () => {
  assert.deepEqual(validateRwandaAlphaEvidence(validManifest()), {
    ok: true,
    errors: [],
    derived: { operationalAlpha: "pass", statutoryUse: "fail" },
  })
})

test("fails closed when a pending external gate is claimed as statutory pass", () => {
  const manifest = validManifest()
  manifest.decisions.statutoryUse = "pass"
  const result = validateRwandaAlphaEvidence(manifest)
  assert.equal(result.ok, false)
  assert(result.errors.includes("$.decisions.statutoryUse must be fail"))
})

test("requires checkpoint 8 for original-total payment replay", () => {
  const manifest = validManifest()
  manifest.run.migrationMode = "original_total_with_payment_replay"
  manifest.decisions.operationalAlpha = "fail"
  const result = validateRwandaAlphaEvidence(manifest)
  assert.equal(result.ok, false)
  assert(result.errors.some((error) => error.includes("checkpoints.8.status must be pass")))
})

test("rejects unexplained control-total differences", () => {
  const manifest = validManifest()
  manifest.controlTotals[0].lumiereAmount = 102
  manifest.controlTotals[0].difference = 2
  manifest.decisions.operationalAlpha = "fail"
  const result = validateRwandaAlphaEvidence(manifest)
  assert.equal(result.ok, false)
  assert(result.errors.some((error) => error.includes("trial_balance_debits.difference exceeds tolerance")))
})

test("requires exact RWF control totals instead of operator-selected tolerance", () => {
  const manifest = validManifest()
  manifest.controlTotals[0].lumiereAmount = 102
  manifest.controlTotals[0].difference = 2
  manifest.controlTotals[0].tolerance = 2
  manifest.decisions.operationalAlpha = "fail"
  const result = validateRwandaAlphaEvidence(manifest)
  assert.equal(result.ok, false)
  assert(result.errors.some((error) => error.includes("tolerance must be zero for RWF control totals")))
})

test("binds controls, evidence, and accepted signoffs to this cutover run", () => {
  const manifest = validManifest()
  manifest.controlTotals[0].asOfDate = "2026-10-15"
  manifest.technical.checkpoints[0].evidence.runId = "stale-run"
  manifest.signoffs.alphaUser.releaseCommit = "c".repeat(40)
  manifest.signoffs.accountant.signedAt = "2026-10-15T23:59:59Z"
  manifest.decisions.operationalAlpha = "fail"
  const errors = validateRwandaAlphaEvidence(manifest).errors
  for (const expected of [
    "asOfDate must equal $.run.cutoverDate",
    "runId must equal $.run.runId",
    "releaseCommit must equal $.run.release.commit",
    "signedAt must be at or after $.run.executedAt",
  ]) {
    assert(errors.some((error) => error.includes(expected)), `missing validation error: ${expected}`)
  }
})

test("rejects unknown properties and unexpected rows", () => {
  const manifest = validManifest()
  manifest.unexpected = true
  manifest.run.unexpected = true
  manifest.technical.checkpoints.push({ id: 99, status: "pass", evidence: evidence("extra.json") })
  manifest.technical.companionSpecs.push({ name: "stale.spec.ts", status: "pass", evidence: evidence("stale.json") })
  manifest.roleChecks.push({ name: "superuser", status: "pass", evidence: evidence("superuser.json") })
  manifest.roleChecks[0].evidence.unexpected = true
  manifest.manualChecks.push({ id: 8, status: "pass", reviewedBy: "Accountant", evidence: evidence("manual-8.pdf") })
  manifest.decisions.operationalAlpha = "fail"
  const errors = validateRwandaAlphaEvidence(manifest).errors
  for (const expected of [
    "$.unexpected is not allowed",
    "$.run.unexpected is not allowed",
    "checkpoints.8.id is invalid",
    "companionSpecs.2.name is invalid",
    "roleChecks.3.name is invalid",
    "roleChecks.alpha_power_user.evidence.unexpected is not allowed",
    "manualChecks.7.id is invalid",
  ]) {
    assert(errors.some((error) => error.includes(expected)), `missing validation error: ${expected}`)
  }
})

test("enforces unique evidence keys and critical accounting fields", () => {
  const manifest = validManifest()
  manifest.technical.checkpoints.push({ ...manifest.technical.checkpoints[0] })
  manifest.controlTotals.push({ ...manifest.controlTotals[0] })
  manifest.roleChecks.push({ ...manifest.roleChecks[0] })
  manifest.manualChecks.push({ ...manifest.manualChecks[0] })
  manifest.controlTotals[0].currency = "EUR"
  manifest.controlTotals[0].asOfDate = "not-a-date"
  manifest.controlTotals[0].tolerance = -1
  manifest.exceptions.push({ id: "EX-1", severity: "urgent", status: "unknown" })
  manifest.decisions = { operationalAlpha: "maybe", statutoryUse: "maybe" }
  const errors = validateRwandaAlphaEvidence(manifest).errors
  for (const expected of [
    "duplicate id 1",
    "duplicate name trial_balance_debits",
    "currency must be RWF",
    "must be an ISO date",
    "tolerance must be zero for RWF control totals",
    "severity is invalid",
    "status is invalid",
    "description must be a non-empty string",
    "operationalAlpha must be pass or fail",
    "statutoryUse must be pass or fail",
  ]) {
    assert(errors.some((error) => error.includes(expected)), `missing validation error: ${expected}`)
  }
})

test("verifies evidence files relative to the manifest", () => {
  const directory = mkdtempSync(join(tmpdir(), "rw-alpha-evidence-"))
  try {
    const manifestPath = join(directory, "manifest.json")
    const bytes = Buffer.from("rehearsal evidence")
    writeFileSync(join(directory, "checkpoint.json"), bytes)
    const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    assert.deepEqual(
      validateEvidenceArtifacts({ evidence: { path: "checkpoint.json", sha256 } }, manifestPath),
      [],
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("rejects missing evidence and digest mismatches", () => {
  const directory = mkdtempSync(join(tmpdir(), "rw-alpha-evidence-"))
  try {
    const manifestPath = join(directory, "manifest.json")
    writeFileSync(join(directory, "checkpoint.json"), "actual")
    const errors = validateEvidenceArtifacts({
      mismatch: { path: "checkpoint.json", sha256: `sha256:${"a".repeat(64)}` },
      missing: { path: "missing.json", sha256: `sha256:${"b".repeat(64)}` },
    }, manifestPath)
    assert(errors.some((error) => error.includes("does not match checkpoint.json")))
    assert(errors.some((error) => error.includes("cannot be read: missing.json")))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("rejects evidence paths outside the bundle", () => {
  const directory = mkdtempSync(join(tmpdir(), "rw-alpha-evidence-"))
  try {
    const errors = validateEvidenceArtifacts({
      evidence: { path: "../outside.json", sha256: `sha256:${"a".repeat(64)}` },
    }, join(directory, "manifest.json"))
    assert(errors.some((error) => error.includes("must stay inside the evidence bundle")))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("verifies technical attachment content is bound to the manifest run", () => {
  const directory = mkdtempSync(join(tmpdir(), "rw-alpha-evidence-"))
  try {
    const manifestPath = join(directory, "manifest.json")
    const artifactPath = join(directory, "checkpoint.json")
    const artifact = {
      evidenceBinding: {
        runId,
        tenantRef: "isolated-rw-1",
        companyId: 7,
        releaseCommit,
        contractVersion: "0.3.108",
        moduleVersion: "wasm-1",
        cutoverDate,
        migrationMode: "residual_only",
      },
      evidence: { result: "pass" },
    }
    const bytes = Buffer.from(JSON.stringify(artifact))
    writeFileSync(artifactPath, bytes)
    const reference = {
      path: "checkpoint.json",
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      runId,
      releaseCommit,
      cutoverDate,
    }
    const manifest = {
      run: {
        runId,
        tenantRef: "isolated-rw-1",
        companyId: 7,
        release: { commit: releaseCommit, contractVersion: "0.3.108", moduleVersion: "wasm-1" },
        cutoverDate,
        migrationMode: "residual_only",
      },
      technical: { checkpoints: [{ id: 1, status: "pass", evidence: reference }] },
    }
    assert.deepEqual(validateEvidenceArtifacts(manifest, manifestPath), [])

    artifact.evidenceBinding.releaseCommit = "c".repeat(40)
    const staleBytes = Buffer.from(JSON.stringify(artifact))
    writeFileSync(artifactPath, staleBytes)
    reference.sha256 = `sha256:${createHash("sha256").update(staleBytes).digest("hex")}`
    const errors = validateEvidenceArtifacts(manifest, manifestPath)
    assert(errors.some((error) => error.includes("evidenceBinding.releaseCommit does not match")))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
