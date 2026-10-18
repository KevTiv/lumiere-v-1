import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { prepareEvidenceBundle } from "../prepare-rwanda-accounting-alpha-evidence.mjs"

const attachment = {
  evidenceBinding: {
    runId: "rw-alpha-20261016-01",
    tenantRef: "isolated-rw-1",
    companyId: 7,
    releaseCommit: "b".repeat(40),
    contractVersion: "0.3.109",
    moduleVersion: "wasm-1",
    cutoverDate: "2026-10-15",
    migrationMode: "residual_only",
  },
  evidence: {
    runId: "rw-alpha-20261016-01",
    executedAt: "2026-10-16T08:00:00Z",
    tenantRef: "isolated-rw-1",
    companyId: 7,
    isolatedTenantAcknowledged: true,
    operator: { name: "Operator", email: "operator@example.com" },
    release: {
      commit: "b".repeat(40),
      contractVersion: "0.3.109",
      moduleVersion: "wasm-1",
    },
    migrationMode: "residual_only",
    cutoverDate: "2026-10-15",
  },
}

test("prepares a run-bound bundle from the exact Playwright context", () => {
  const directory = mkdtempSync(join(tmpdir(), "rw-alpha-prepare-"))
  try {
    const { manifest, manifestPath } = prepareEvidenceBundle(attachment, directory)
    assert.equal(manifest.run.runId, attachment.evidence.runId)
    assert.equal(manifest.run.release.contractVersion, "0.3.109")
    assert.equal(manifest.technical.checkpoints[0].evidence.runId, attachment.evidence.runId)
    assert.equal(manifest.technical.checkpoints[7].status, "not_applicable")
    assert.equal(manifest.controlTotals[0].asOfDate, "2026-10-15")
    assert.equal(manifest.controlTotals[0].evidence.path, "control-totals.csv")
    assert.match(readFileSync(join(directory, "control-totals.csv"), "utf8"), /2026-10-15/)
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")), manifest)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("configures checkpoint 8 for original-total payment replay", () => {
  const directory = mkdtempSync(join(tmpdir(), "rw-alpha-prepare-"))
  try {
    const originalTotal = structuredClone(attachment)
    originalTotal.evidence.migrationMode = "original_total_with_payment_replay"
    originalTotal.evidenceBinding.migrationMode = "original_total_with_payment_replay"
    const { manifest } = prepareEvidenceBundle(originalTotal, directory)
    assert.deepEqual(manifest.technical.checkpoints[7], {
      id: 8,
      status: "pass",
      evidence: {
        path: "08-historical-payment-replay.json",
        sha256: `sha256:${"0".repeat(64)}`,
        runId: attachment.evidence.runId,
        releaseCommit: attachment.evidence.release.commit,
        cutoverDate: attachment.evidence.cutoverDate,
      },
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("rejects a stale or mismatched context binding", () => {
  const directory = mkdtempSync(join(tmpdir(), "rw-alpha-prepare-"))
  try {
    const stale = structuredClone(attachment)
    stale.evidenceBinding.releaseCommit = "c".repeat(40)
    assert.throws(
      () => prepareEvidenceBundle(stale, directory),
      /evidenceBinding.releaseCommit does not match evidence/,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
