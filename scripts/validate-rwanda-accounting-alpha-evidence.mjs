#!/usr/bin/env node

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"

const CONTROL_TOTALS = new Set([
  "trial_balance_debits",
  "trial_balance_credits",
  "receivables_aging",
  "payables_aging",
  "tax_control",
  "bank_and_cash",
  "retained_earnings",
])
const REQUIRED_ROLES = new Set(["alpha_power_user", "bookkeeper", "read_only"])
const REQUIRED_COMPANION_SPECS = new Set([
  "accounting-post-reconcile.spec.ts",
  "cov08b-bank-statement-reconcile.spec.ts",
])

function object(value, path, errors, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return {}
  }
  if (allowedKeys) {
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not allowed`)
    }
  }
  return value
}

function array(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`)
    return []
  }
  return value
}

function nonEmpty(value, path, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path} must be a non-empty string`)
    return false
  }
  if (value.trim().toLowerCase() === "replace-me") {
    errors.push(`${path} still contains a template placeholder`)
    return false
  }
  return true
}

function dateOnly(value, path, errors) {
  const parsed = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : null
  if (!parsed || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push(`${path} must be an ISO date`)
    return false
  }
  return true
}

function dateTime(value, path, errors) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    errors.push(`${path} must be an ISO date-time`)
    return false
  }
  return true
}

function requireUnique(rows, field, path, errors) {
  const seen = new Set()
  for (const row of rows) {
    const value = row?.[field]
    if (seen.has(value)) errors.push(`${path} contains duplicate ${field} ${String(value)}`)
    seen.add(value)
  }
}

function evidenceReference(value, path, errors, expectedBinding) {
  const evidence = object(
    value,
    path,
    errors,
    new Set(["path", "sha256", "runId", "releaseCommit", "cutoverDate"]),
  )
  nonEmpty(evidence.path, `${path}.path`, errors)
  if (!/^sha256:[0-9a-f]{64}$/.test(evidence.sha256 ?? "")) {
    errors.push(`${path}.sha256 must be a lowercase sha256:<hex> digest`)
  }
  if (evidence.sha256 === `sha256:${"0".repeat(64)}` || evidence.path === "replace-me") {
    errors.push(`${path} still contains template placeholders`)
  }
  if (evidence.runId !== expectedBinding.runId) {
    errors.push(`${path}.runId must equal $.run.runId`)
  }
  if (evidence.releaseCommit !== expectedBinding.releaseCommit) {
    errors.push(`${path}.releaseCommit must equal $.run.release.commit`)
  }
  if (evidence.cutoverDate !== expectedBinding.cutoverDate) {
    errors.push(`${path}.cutoverDate must equal $.run.cutoverDate`)
  }
}

function namedRows(rows) {
  return new Map(rows.filter((row) => row && typeof row === "object").map((row) => [row.name, row]))
}

function requirePassedRows(rows, expectedNames, path, errors, expectedBinding) {
  const byName = namedRows(rows)
  for (const [index, value] of rows.entries()) {
    const row = object(
      value,
      `${path}.${index}`,
      errors,
      new Set(["name", "status", "evidence"]),
    )
    if (!expectedNames.has(row.name)) errors.push(`${path}.${index}.name is invalid`)
    if (row.status !== "pass") errors.push(`${path}.${String(row.name)}.status must be pass`)
    evidenceReference(row.evidence, `${path}.${String(row.name)}.evidence`, errors, expectedBinding)
  }
  for (const name of expectedNames) {
    const row = byName.get(name)
    if (!row) {
      errors.push(`${path} is missing ${name}`)
      continue
    }
  }
}

function validateHumanSignoff(signoff, path, errors, expectedBinding, executedAt) {
  const row = object(
    signoff,
    path,
    errors,
    new Set(["decision", "name", "role", "signedAt", "evidence", "runId", "releaseCommit", "cutoverDate"]),
  )
  if (!new Set(["accepted", "rejected", "pending"]).has(row.decision)) {
    errors.push(`${path}.decision must be accepted, rejected, or pending`)
  }
  nonEmpty(row.name, `${path}.name`, errors)
  nonEmpty(row.role, `${path}.role`, errors)
  if (row.decision === "accepted") {
    const validSignedAt = dateTime(row.signedAt, `${path}.signedAt`, errors)
    evidenceReference(row.evidence, `${path}.evidence`, errors, expectedBinding)
    if (row.runId !== expectedBinding.runId) errors.push(`${path}.runId must equal $.run.runId`)
    if (row.releaseCommit !== expectedBinding.releaseCommit) {
      errors.push(`${path}.releaseCommit must equal $.run.release.commit`)
    }
    if (row.cutoverDate !== expectedBinding.cutoverDate) {
      errors.push(`${path}.cutoverDate must equal $.run.cutoverDate`)
    }
    if (
      validSignedAt &&
      typeof executedAt === "string" &&
      !Number.isNaN(Date.parse(executedAt))
    ) {
      if (Date.parse(row.signedAt) < Date.parse(executedAt)) {
        errors.push(`${path}.signedAt must be at or after $.run.executedAt`)
      }
    }
  }
  return row.decision === "accepted"
}

function validateProfessionalSignoff(signoff, path, errors, expectedBinding) {
  const row = object(
    signoff,
    path,
    errors,
    new Set(["decision", "name", "qualification", "rulesetVersion", "signedAt", "evidence"]),
  )
  if (!new Set(["approved", "rejected", "pending"]).has(row.decision)) {
    errors.push(`${path}.decision must be approved, rejected, or pending`)
  }
  nonEmpty(row.name, `${path}.name`, errors)
  nonEmpty(row.qualification, `${path}.qualification`, errors)
  nonEmpty(row.rulesetVersion, `${path}.rulesetVersion`, errors)
  if (row.decision === "approved") {
    dateTime(row.signedAt, `${path}.signedAt`, errors)
    evidenceReference(row.evidence, `${path}.evidence`, errors, expectedBinding)
  }
  return row.decision === "approved"
}

function validateRraSignoff(signoff, path, errors, expectedBinding) {
  const row = object(
    signoff,
    path,
    errors,
    new Set(["status", "certificateReference", "validFrom", "validTo", "evidence"]),
  )
  if (!new Set(["certified", "not_certified", "pending"]).has(row.status)) {
    errors.push(`${path}.status must be certified, not_certified, or pending`)
  }
  if (row.status === "certified") {
    nonEmpty(row.certificateReference, `${path}.certificateReference`, errors)
    dateOnly(row.validFrom, `${path}.validFrom`, errors)
    dateOnly(row.validTo, `${path}.validTo`, errors)
    evidenceReference(row.evidence, `${path}.evidence`, errors, expectedBinding)
  }
  return row.status === "certified"
}

export function validateRwandaAlphaEvidence(manifest) {
  const errors = []
  const root = object(
    manifest,
    "$",
    errors,
    new Set(["schemaVersion", "run", "technical", "controlTotals", "roleChecks", "manualChecks", "signoffs", "countryPack", "exceptions", "decisions"]),
  )
  if (root.schemaVersion !== 1) errors.push("$.schemaVersion must be 1")

  const run = object(
    root.run,
    "$.run",
    errors,
    new Set(["runId", "executedAt", "cutoverDate", "tenantRef", "companyId", "isolatedTenantAcknowledged", "migrationMode", "operator", "release"]),
  )
  nonEmpty(run.runId, "$.run.runId", errors)
  dateTime(run.executedAt, "$.run.executedAt", errors)
  dateOnly(run.cutoverDate, "$.run.cutoverDate", errors)
  if (
    typeof run.executedAt === "string" &&
    typeof run.cutoverDate === "string" &&
    Date.parse(`${run.cutoverDate}T00:00:00Z`) > Date.parse(run.executedAt)
  ) {
    errors.push("$.run.cutoverDate cannot be after $.run.executedAt")
  }
  nonEmpty(run.tenantRef, "$.run.tenantRef", errors)
  if (!Number.isSafeInteger(run.companyId) || run.companyId <= 0) {
    errors.push("$.run.companyId must be a positive integer")
  }
  if (run.isolatedTenantAcknowledged !== true) {
    errors.push("$.run.isolatedTenantAcknowledged must be true")
  }
  if (!new Set(["residual_only", "original_total_with_payment_replay"]).has(run.migrationMode)) {
    errors.push("$.run.migrationMode is invalid")
  }
  const operator = object(run.operator, "$.run.operator", errors, new Set(["name", "email"]))
  nonEmpty(operator.name, "$.run.operator.name", errors)
  nonEmpty(operator.email, "$.run.operator.email", errors)
  if (typeof operator.email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(operator.email)) {
    errors.push("$.run.operator.email must be an email address")
  }
  const release = object(
    run.release,
    "$.run.release",
    errors,
    new Set(["commit", "contractVersion", "moduleVersion"]),
  )
  if (!/^[0-9a-f]{40}$/.test(release.commit ?? "")) {
    errors.push("$.run.release.commit must be a full lowercase Git commit SHA")
  }
  nonEmpty(release.contractVersion, "$.run.release.contractVersion", errors)
  nonEmpty(release.moduleVersion, "$.run.release.moduleVersion", errors)

  const expectedBinding = {
    runId: run.runId,
    releaseCommit: release.commit,
    cutoverDate: run.cutoverDate,
  }

  const technical = object(
    root.technical,
    "$.technical",
    errors,
    new Set(["checkpoints", "companionSpecs"]),
  )
  const checkpoints = array(technical.checkpoints, "$.technical.checkpoints", errors)
  requireUnique(checkpoints, "id", "$.technical.checkpoints", errors)
  const checkpointById = new Map(checkpoints.map((row) => [row?.id, row]))
  for (const [index, value] of checkpoints.entries()) {
    const row = object(
      value,
      `$.technical.checkpoints.${index}`,
      errors,
      new Set(["id", "status", "reason", "evidence"]),
    )
    if (!Number.isSafeInteger(row.id) || row.id < 1 || row.id > 8) {
      errors.push(`$.technical.checkpoints.${index}.id is invalid`)
    }
  }
  for (let id = 1; id <= 8; id += 1) {
    const row = checkpointById.get(id)
    if (!row) {
      errors.push(`$.technical.checkpoints is missing checkpoint ${id}`)
      continue
    }
    const allowed = id === 8 && run.migrationMode === "residual_only"
      ? new Set(["pass", "not_applicable"])
      : new Set(["pass"])
    if (!allowed.has(row.status)) {
      errors.push(`$.technical.checkpoints.${id}.status must be ${[...allowed].join(" or ")}`)
    }
    if (row.status === "pass") {
      evidenceReference(
        row.evidence,
        `$.technical.checkpoints.${id}.evidence`,
        errors,
        expectedBinding,
      )
    }
    if (row.status === "not_applicable") nonEmpty(row.reason, `$.technical.checkpoints.${id}.reason`, errors)
  }
  requirePassedRows(
    (() => {
      const rows = array(technical.companionSpecs, "$.technical.companionSpecs", errors)
      requireUnique(rows, "name", "$.technical.companionSpecs", errors)
      return rows
    })(),
    REQUIRED_COMPANION_SPECS,
    "$.technical.companionSpecs",
    errors,
    expectedBinding,
  )

  const totals = array(root.controlTotals, "$.controlTotals", errors)
  requireUnique(totals, "name", "$.controlTotals", errors)
  const totalsByName = namedRows(totals)
  for (const name of CONTROL_TOTALS) {
    if (!totalsByName.has(name)) errors.push(`$.controlTotals is missing ${name}`)
  }
  for (const [index, value] of totals.entries()) {
    const row = object(
      value,
      `$.controlTotals.${index}`,
      errors,
      new Set(["name", "asOfDate", "currency", "sourceAmount", "lumiereAmount", "difference", "tolerance", "status", "reviewedBy", "evidence"]),
    )
    const name = typeof row.name === "string" ? row.name : String(index)
    const path = `$.controlTotals.${name}`
    if (!CONTROL_TOTALS.has(row.name)) errors.push(`${path}.name is invalid`)
    for (const field of ["sourceAmount", "lumiereAmount", "difference", "tolerance"]) {
      if (typeof row[field] !== "number" || !Number.isFinite(row[field])) {
        errors.push(`${path}.${field} must be a finite number`)
      }
    }
    dateOnly(row.asOfDate, `${path}.asOfDate`, errors)
    if (row.asOfDate !== run.cutoverDate) errors.push(`${path}.asOfDate must equal $.run.cutoverDate`)
    if (row.currency !== "RWF") errors.push(`${path}.currency must be RWF`)
    if (row.tolerance !== 0) {
      errors.push(`${path}.tolerance must be zero for RWF control totals`)
    }
    if (typeof row.difference === "number" && typeof row.sourceAmount === "number" && typeof row.lumiereAmount === "number") {
      const calculated = row.lumiereAmount - row.sourceAmount
      if (Math.abs(calculated - row.difference) > 0.000001) {
        errors.push(`${path}.difference must equal lumiereAmount - sourceAmount`)
      }
    }
    if (row.status !== "pass") errors.push(`${path}.status must be pass`)
    if (typeof row.difference === "number" && typeof row.tolerance === "number" && Math.abs(row.difference) > row.tolerance) {
      errors.push(`${path}.difference exceeds tolerance`)
    }
    evidenceReference(row.evidence, `${path}.evidence`, errors, expectedBinding)
    nonEmpty(row.reviewedBy, `${path}.reviewedBy`, errors)
  }

  requirePassedRows(
    (() => {
      const rows = array(root.roleChecks, "$.roleChecks", errors)
      requireUnique(rows, "name", "$.roleChecks", errors)
      return rows
    })(),
    REQUIRED_ROLES,
    "$.roleChecks",
    errors,
    expectedBinding,
  )
  const manualChecks = array(root.manualChecks, "$.manualChecks", errors)
  requireUnique(manualChecks, "id", "$.manualChecks", errors)
  const manualById = new Map(manualChecks.map((row) => [row?.id, row]))
  for (const [index, value] of manualChecks.entries()) {
    const row = object(
      value,
      `$.manualChecks.${index}`,
      errors,
      new Set(["id", "status", "reviewedBy", "evidence"]),
    )
    if (!Number.isSafeInteger(row.id) || row.id < 1 || row.id > 7) {
      errors.push(`$.manualChecks.${index}.id is invalid`)
    }
  }
  for (let id = 1; id <= 7; id += 1) {
    const row = manualById.get(id)
    if (!row) {
      errors.push(`$.manualChecks is missing check ${id}`)
      continue
    }
    if (row.status !== "pass") errors.push(`$.manualChecks.${id}.status must be pass`)
    nonEmpty(row.reviewedBy, `$.manualChecks.${id}.reviewedBy`, errors)
    evidenceReference(row.evidence, `$.manualChecks.${id}.evidence`, errors, expectedBinding)
  }

  const signoffs = object(
    root.signoffs,
    "$.signoffs",
    errors,
    new Set(["alphaUser", "accountant", "legal", "tax", "rraVsdc"]),
  )
  const alphaUserAccepted = validateHumanSignoff(
    signoffs.alphaUser,
    "$.signoffs.alphaUser",
    errors,
    expectedBinding,
    run.executedAt,
  )
  const accountantAccepted = validateHumanSignoff(
    signoffs.accountant,
    "$.signoffs.accountant",
    errors,
    expectedBinding,
    run.executedAt,
  )
  const legalApproved = validateProfessionalSignoff(
    signoffs.legal,
    "$.signoffs.legal",
    errors,
    expectedBinding,
  )
  const taxApproved = validateProfessionalSignoff(
    signoffs.tax,
    "$.signoffs.tax",
    errors,
    expectedBinding,
  )
  const rraCertified = validateRraSignoff(
    signoffs.rraVsdc,
    "$.signoffs.rraVsdc",
    errors,
    expectedBinding,
  )

  const countryPack = object(
    root.countryPack,
    "$.countryPack",
    errors,
    new Set(["packKey", "version", "acceptanceStatus", "enabled"]),
  )
  if (countryPack.packKey !== "rw") errors.push("$.countryPack.packKey must be rw")
  nonEmpty(countryPack.version, "$.countryPack.version", errors)
  if (!new Set(["review_required", "accepted"]).has(countryPack.acceptanceStatus)) {
    errors.push("$.countryPack.acceptanceStatus must be review_required or accepted")
  }
  if (typeof countryPack.enabled !== "boolean") errors.push("$.countryPack.enabled must be boolean")
  if (signoffs.legal?.rulesetVersion !== countryPack.version) {
    errors.push("$.signoffs.legal.rulesetVersion must equal $.countryPack.version")
  }
  if (signoffs.tax?.rulesetVersion !== countryPack.version) {
    errors.push("$.signoffs.tax.rulesetVersion must equal $.countryPack.version")
  }
  if (rraCertified) {
    const executed = Date.parse(run.executedAt)
    const validFrom = Date.parse(`${signoffs.rraVsdc.validFrom}T00:00:00Z`)
    const validTo = Date.parse(`${signoffs.rraVsdc.validTo}T23:59:59Z`)
    if (!(validFrom <= executed && executed <= validTo)) {
      errors.push("$.signoffs.rraVsdc certification must be valid at $.run.executedAt")
    }
  }

  const exceptions = array(root.exceptions, "$.exceptions", errors)
  requireUnique(exceptions, "id", "$.exceptions", errors)
  for (const [index, exception] of exceptions.entries()) {
    const path = `$.exceptions.${index}`
    const row = object(
      exception,
      path,
      errors,
      new Set(["id", "severity", "status", "description", "owner", "workaround", "targetRelease"]),
    )
    if (!new Set(["low", "medium", "high", "critical"]).has(row.severity)) errors.push(`${path}.severity is invalid`)
    if (!new Set(["open", "closed"]).has(row.status)) errors.push(`${path}.status is invalid`)
    nonEmpty(row.description, `${path}.description`, errors)
    if (row.status === "open") {
      nonEmpty(row.owner, `${path}.owner`, errors)
      nonEmpty(row.workaround, `${path}.workaround`, errors)
      nonEmpty(row.targetRelease, `${path}.targetRelease`, errors)
    }
  }
  const hasBlockingException = exceptions.some((row) =>
    row?.status === "open" && new Set(["high", "critical"]).has(row?.severity),
  )

  const decisions = object(
    root.decisions,
    "$.decisions",
    errors,
    new Set(["operationalAlpha", "statutoryUse"]),
  )
  if (!new Set(["pass", "fail"]).has(decisions.operationalAlpha)) {
    errors.push("$.decisions.operationalAlpha must be pass or fail")
  }
  if (!new Set(["pass", "fail"]).has(decisions.statutoryUse)) {
    errors.push("$.decisions.statutoryUse must be pass or fail")
  }
  const technicalReady = errors.length === 0
  const operationalPass = technicalReady && alphaUserAccepted && accountantAccepted && !hasBlockingException
  const statutoryPass = operationalPass && legalApproved && taxApproved && rraCertified &&
    countryPack.acceptanceStatus === "accepted" && countryPack.enabled === true
  const expectedOperational = operationalPass ? "pass" : "fail"
  const expectedStatutory = statutoryPass ? "pass" : "fail"
  if (decisions.operationalAlpha !== expectedOperational) {
    errors.push(`$.decisions.operationalAlpha must be ${expectedOperational}`)
  }
  if (decisions.statutoryUse !== expectedStatutory) {
    errors.push(`$.decisions.statutoryUse must be ${expectedStatutory}`)
  }

  return {
    ok: errors.length === 0,
    errors,
    derived: {
      operationalAlpha: expectedOperational,
      statutoryUse: expectedStatutory,
    },
  }
}

export function validateEvidenceArtifacts(manifest, manifestPath) {
  const errors = []
  const root = dirname(resolve(manifestPath))
  const references = []
  const readableArtifacts = new Map()
  function visit(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}.${index}`))
      return
    }
    if (!value || typeof value !== "object") return
    if (typeof value.path === "string" && typeof value.sha256 === "string") {
      references.push({ value, path })
    }
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`)
  }
  visit(manifest, "$")
  for (const reference of references) {
    const artifactPath = reference.value.path
    if (isAbsolute(artifactPath)) {
      errors.push(`${reference.path}.path must be relative to the manifest directory`)
      continue
    }
    const resolved = resolve(root, artifactPath)
    const fromRoot = relative(root, resolved)
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
      errors.push(`${reference.path}.path must stay inside the evidence bundle`)
      continue
    }
    try {
      const bytes = readFileSync(resolved)
      const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
      if (actual !== reference.value.sha256) errors.push(`${reference.path}.sha256 does not match ${artifactPath}`)
      readableArtifacts.set(reference.value, bytes)
    } catch (error) {
      errors.push(`${reference.path}.path cannot be read: ${artifactPath} (${error.code ?? error.message})`)
    }
  }
  const run = manifest?.run
  for (const [index, checkpoint] of (manifest?.technical?.checkpoints ?? []).entries()) {
    if (checkpoint?.status !== "pass" || !checkpoint.evidence) continue
    const bytes = readableArtifacts.get(checkpoint.evidence)
    if (!bytes) continue
    const path = `$.technical.checkpoints.${index}.evidence`
    let artifact
    try {
      artifact = JSON.parse(bytes.toString("utf8"))
    } catch {
      errors.push(`${path}.path must contain JSON rehearsal evidence`)
      continue
    }
    const binding = artifact?.evidenceBinding
    const expected = {
      runId: run?.runId,
      tenantRef: run?.tenantRef,
      companyId: run?.companyId,
      releaseCommit: run?.release?.commit,
      contractVersion: run?.release?.contractVersion,
      moduleVersion: run?.release?.moduleVersion,
      cutoverDate: run?.cutoverDate,
      migrationMode: run?.migrationMode,
    }
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
      errors.push(`${path}.path is missing evidenceBinding`)
      continue
    }
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (binding[field] !== expectedValue) {
        errors.push(`${path}.path evidenceBinding.${field} does not match the manifest run`)
      }
    }
  }
  return errors
}

function main(argv) {
  const path = argv[2]
  if (!path) {
    console.error("Usage: node scripts/validate-rwanda-accounting-alpha-evidence.mjs <manifest.json>")
    return 2
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    console.error(`Could not read ${path}: ${error.message}`)
    return 2
  }
  const result = validateRwandaAlphaEvidence(manifest)
  result.errors.push(...validateEvidenceArtifacts(manifest, path))
  result.ok = result.errors.length === 0
  if (!result.ok) {
    for (const error of result.errors) console.error(`- ${error}`)
    console.error(`Rwanda accounting alpha evidence is invalid (${result.errors.length} errors).`)
    return 1
  }
  console.log(`Rwanda accounting alpha evidence is valid: operational=${result.derived.operationalAlpha}, statutory=${result.derived.statutoryUse}`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv)
}
