#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..")
const TEMPLATE_PATH = join(REPOSITORY_ROOT, "docs/accounting/rwanda-alpha/evidence-manifest.template.json")
const CONTROL_TOTALS_PATH = join(REPOSITORY_ROOT, "docs/accounting/rwanda-alpha/control-totals.template.csv")

const COMPANION_PATHS = new Map([
  ["accounting-post-reconcile.spec.ts", "09-accounting-post-reconcile-report.zip"],
  ["cov08b-bank-statement-reconcile.spec.ts", "10-bank-statement-reconcile-report.zip"],
])

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`)
  }
  return value
}

function contextFromAttachment(value) {
  const context = value?.evidence ?? value
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new Error("run-context attachment must contain an evidence object")
  }
  const companyId = Number(context.companyId)
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("run-context evidence.companyId must be a positive integer")
  }
  if (context.isolatedTenantAcknowledged !== true) {
    throw new Error("run-context evidence.isolatedTenantAcknowledged must be true")
  }
  if (!["residual_only", "original_total_with_payment_replay"].includes(context.migrationMode)) {
    throw new Error("run-context evidence.migrationMode is invalid")
  }
  const result = {
    runId: requiredString(context.runId, "run-context evidence.runId"),
    executedAt: requiredString(context.executedAt, "run-context evidence.executedAt"),
    tenantRef: requiredString(context.tenantRef, "run-context evidence.tenantRef"),
    companyId,
    isolatedTenantAcknowledged: true,
    migrationMode: context.migrationMode,
    operator: {
      name: requiredString(context.operator?.name, "run-context evidence.operator.name"),
      email: requiredString(context.operator?.email, "run-context evidence.operator.email"),
    },
    release: {
      commit: requiredString(context.release?.commit, "run-context evidence.release.commit"),
      contractVersion: requiredString(context.release?.contractVersion, "run-context evidence.release.contractVersion"),
      moduleVersion: requiredString(context.release?.moduleVersion, "run-context evidence.release.moduleVersion"),
    },
    cutoverDate: requiredString(context.cutoverDate, "run-context evidence.cutoverDate"),
  }
  if (value?.evidenceBinding) {
    const binding = value.evidenceBinding
    for (const [field, expected] of Object.entries({
      runId: result.runId,
      tenantRef: result.tenantRef,
      companyId: result.companyId,
      releaseCommit: result.release.commit,
      contractVersion: result.release.contractVersion,
      moduleVersion: result.release.moduleVersion,
      cutoverDate: result.cutoverDate,
      migrationMode: result.migrationMode,
    })) {
      if (binding[field] !== expected) {
        throw new Error(`run-context evidenceBinding.${field} does not match evidence`)
      }
    }
  }
  return result
}

function bindEvidenceReferences(value, run) {
  if (Array.isArray(value)) {
    value.forEach((item) => bindEvidenceReferences(item, run))
    return
  }
  if (!value || typeof value !== "object") return
  if (typeof value.path === "string" && typeof value.sha256 === "string") {
    value.runId = run.runId
    value.releaseCommit = run.release.commit
    value.cutoverDate = run.cutoverDate
  }
  Object.values(value).forEach((child) => bindEvidenceReferences(child, run))
}

export function prepareEvidenceBundle(contextAttachment, destination, options = {}) {
  const run = contextFromAttachment(contextAttachment)
  const outputDirectory = resolve(destination)
  const manifestPath = join(outputDirectory, "evidence-manifest.json")
  if (existsSync(manifestPath) && !options.force) {
    throw new Error(`${manifestPath} already exists; move it or pass --force`)
  }
  mkdirSync(outputDirectory, { recursive: true })

  const manifest = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"))
  manifest.run = run
  bindEvidenceReferences(manifest, run)

  const checkpoint8 = manifest.technical.checkpoints.find(({ id }) => id === 8)
  if (run.migrationMode === "original_total_with_payment_replay") {
    delete checkpoint8.reason
    checkpoint8.status = "pass"
    checkpoint8.evidence = {
      path: "08-historical-payment-replay.json",
      sha256: `sha256:${"0".repeat(64)}`,
      runId: run.runId,
      releaseCommit: run.release.commit,
      cutoverDate: run.cutoverDate,
    }
  }
  for (const row of manifest.technical.companionSpecs) {
    row.evidence.path = COMPANION_PATHS.get(row.name)
  }
  for (const row of manifest.controlTotals) {
    row.asOfDate = run.cutoverDate
    row.evidence.path = "control-totals.csv"
  }
  for (const row of manifest.roleChecks) row.evidence.path = `role-${row.name}.json`
  for (const row of manifest.manualChecks) row.evidence.path = `manual-check-${row.id}.pdf`
  for (const key of ["alphaUser", "accountant"]) {
    manifest.signoffs[key].runId = run.runId
    manifest.signoffs[key].releaseCommit = run.release.commit
    manifest.signoffs[key].cutoverDate = run.cutoverDate
  }

  const controlTotals = readFileSync(CONTROL_TOTALS_PATH, "utf8").replaceAll("YYYY-MM-DD", run.cutoverDate)
  writeFileSync(join(outputDirectory, "control-totals.csv"), controlTotals)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  if (options.contextPath) {
    const contextDestination = join(outputDirectory, "00-rwanda-rehearsal-context.json")
    if (resolve(options.contextPath) !== resolve(contextDestination)) {
      cpSync(options.contextPath, contextDestination)
    }
  }
  return { manifest, manifestPath }
}

function main(argv) {
  const positional = argv.slice(2).filter((argument) => argument !== "--force")
  if (positional.length !== 2) {
    console.error("Usage: node scripts/prepare-rwanda-accounting-alpha-evidence.mjs <00-rwanda-rehearsal-context.json> <bundle-directory> [--force]")
    return 2
  }
  const [contextPath, destination] = positional
  try {
    const attachment = JSON.parse(readFileSync(contextPath, "utf8"))
    const result = prepareEvidenceBundle(attachment, destination, {
      contextPath,
      force: argv.includes("--force"),
    })
    console.log(`Prepared Rwanda accounting alpha evidence bundle: ${result.manifestPath}`)
    return 0
  } catch (error) {
    console.error(`Could not prepare Rwanda accounting alpha evidence: ${error.message}`)
    return 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv)
}
