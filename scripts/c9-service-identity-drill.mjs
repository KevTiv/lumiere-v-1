#!/usr/bin/env node
/**
 * Disposable local proof for an organization-scoped integration worker.
 *
 * This intentionally exercises the public reducer boundary with two distinct
 * local tokens: the owner creates an organization and registers the worker,
 * the owner is rejected by the worker-only batch reducer, and the worker can
 * invoke that same reducer.
 */

const host = (process.env.C9_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
)
const moduleName = process.env.C9_STDB_MODULE ?? process.env.STDB_MODULE ?? ""
const adminToken = process.env.C9_STDB_ADMIN_TOKEN ?? ""
const workerToken = process.env.C9_STDB_WORKER_TOKEN ?? ""
const suppliedWorkerIdentity = process.env.C9_STDB_WORKER_IDENTITY ?? ""
const hrWorkerToken = process.env.C9_STDB_HR_WORKER_TOKEN ?? ""
const suppliedHrWorkerIdentity = process.env.C9_STDB_HR_WORKER_IDENTITY ?? ""
const projectWorkerToken = process.env.C9_STDB_PROJECT_WORKER_TOKEN ?? ""
const suppliedProjectWorkerIdentity = process.env.C9_STDB_PROJECT_WORKER_IDENTITY ?? ""
const ownerReportWorkerToken = process.env.C9_STDB_OWNER_REPORT_WORKER_TOKEN ?? ""
const suppliedOwnerReportWorkerIdentity = process.env.C9_STDB_OWNER_REPORT_WORKER_IDENTITY ?? ""
const workflowWorkerToken = process.env.C9_STDB_WORKFLOW_WORKER_TOKEN ?? ""
const suppliedWorkflowWorkerIdentity = process.env.C9_STDB_WORKFLOW_WORKER_IDENTITY ?? ""
const gatewayToken = process.env.C9_STDB_IOT_GATEWAY_TOKEN ?? ""
const suppliedGatewayIdentity = process.env.C9_STDB_IOT_GATEWAY_IDENTITY ?? ""
const serviceName = "expense_integration_worker"

function fail(message) {
  console.error(`[c9-service-drill] ${message}`)
  process.exit(2)
}

function isLoopback(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  } catch {
    return false
  }
}

function jwtIdentity(token) {
  const part = token.split(".")[1]
  if (!part) return ""
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"))
    const raw = payload.sub ?? payload.identity
    if (typeof raw !== "string") return ""
    const normalized = raw.replace(/^0x/i, "")
    return /^[0-9a-f]{64}$/i.test(normalized) ? normalized.toLowerCase() : ""
  } catch {
    return ""
  }
}

function sqlElementName(element) {
  const name = element?.name
  return name && typeof name === "object" && typeof name.some === "string" ? name.some : ""
}

function unwrapSats(value) {
  if (Array.isArray(value) && value.length === 2 && value[0] === 0) {
    return unwrapSats(value[1])
  }
  if (Array.isArray(value) && value.length === 1 && value[0] === 1) {
    return undefined
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if ("some" in value) return unwrapSats(value.some)
    if ("none" in value) return undefined
  }
  return value
}

async function sql(token, query) {
  const response = await fetch(`${host}/v1/database/${moduleName}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: query,
  })
  if (!response.ok) throw new Error(`SQL failed (${response.status}): ${await response.text()}`)
  const resultSets = await response.json()
  const result = Array.isArray(resultSets) ? resultSets[0] : undefined
  if (!result?.rows?.length) return []
  const elements = result.schema?.elements
  if (!Array.isArray(elements)) throw new Error("SQL response lacks schema.elements")
  return result.rows.map((row) => {
    const object = {}
    elements.forEach((element, index) => {
      const name = sqlElementName(element)
      if (name) object[name] = unwrapSats(row[index])
    })
    return object
  })
}

async function reducer(token, name, args, expectSuccess = true) {
  const response = await fetch(`${host}/v1/database/${moduleName}/call/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  })
  const body = await response.text()
  if (expectSuccess && !response.ok) {
    throw new Error(`${name} failed (${response.status}): ${body}`)
  }
  if (!expectSuccess && response.ok) {
    throw new Error(`${name} unexpectedly succeeded`)
  }
  return body
}

if (process.env.C9_DISPOSABLE_STDB !== "1") fail("C9_DISPOSABLE_STDB=1 is required")
if (!isLoopback(host)) fail("C9_STDB_HOST/STDB_HOST must target loopback")
if (!moduleName.startsWith("lumiere-c9-")) fail("C9_STDB_MODULE/STDB_MODULE must use lumiere-c9- prefix")
if (
  !adminToken ||
  !workerToken ||
  !hrWorkerToken ||
  !projectWorkerToken ||
  !ownerReportWorkerToken ||
  !workflowWorkerToken ||
  !gatewayToken
) {
  fail("C9 admin, five worker, and IoT gateway tokens are required")
}
if (
  new Set([
    adminToken,
    workerToken,
    hrWorkerToken,
    projectWorkerToken,
    ownerReportWorkerToken,
    workflowWorkerToken,
    gatewayToken,
  ]).size !== 7
) {
  fail("admin, workers, and IoT gateway tokens must be pairwise distinct")
}
const workerIdentity = (suppliedWorkerIdentity.replace(/^0x/i, "") || jwtIdentity(workerToken)).toLowerCase()
if (!/^[0-9a-f]{64}$/.test(workerIdentity)) {
  fail("C9_STDB_WORKER_IDENTITY must be a 32-byte hex identity when the local JWT omits it")
}
const hrWorkerIdentity = (
  suppliedHrWorkerIdentity.replace(/^0x/i, "") || jwtIdentity(hrWorkerToken)
).toLowerCase()
if (!/^[0-9a-f]{64}$/.test(hrWorkerIdentity)) {
  fail("C9_STDB_HR_WORKER_IDENTITY must be a 32-byte hex identity when the local JWT omits it")
}
const projectWorkerIdentity = (
  suppliedProjectWorkerIdentity.replace(/^0x/i, "") || jwtIdentity(projectWorkerToken)
).toLowerCase()
if (!/^[0-9a-f]{64}$/.test(projectWorkerIdentity)) {
  fail("C9_STDB_PROJECT_WORKER_IDENTITY must be a 32-byte hex identity when the local JWT omits it")
}
const ownerReportWorkerIdentity = (
  suppliedOwnerReportWorkerIdentity.replace(/^0x/i, "") || jwtIdentity(ownerReportWorkerToken)
).toLowerCase()
if (!/^[0-9a-f]{64}$/.test(ownerReportWorkerIdentity)) {
  fail("C9_STDB_OWNER_REPORT_WORKER_IDENTITY must be a 32-byte hex identity when the local JWT omits it")
}
const workflowWorkerIdentity = (
  suppliedWorkflowWorkerIdentity.replace(/^0x/i, "") || jwtIdentity(workflowWorkerToken)
).toLowerCase()
if (!/^[0-9a-f]{64}$/.test(workflowWorkerIdentity)) {
  fail("C9_STDB_WORKFLOW_WORKER_IDENTITY must be a 32-byte hex identity when the local JWT omits it")
}
const gatewayIdentity = (
  suppliedGatewayIdentity.replace(/^0x/i, "") || jwtIdentity(gatewayToken)
).toLowerCase()
if (!/^[0-9a-f]{64}$/.test(gatewayIdentity)) {
  fail("C9_STDB_IOT_GATEWAY_IDENTITY must be a 32-byte hex identity when the local JWT omits it")
}

try {
  const organizationCode = `C9-${process.pid}-${Date.now()}`
  await reducer(adminToken, "create_organization", [
    {
      name: "C9 service identity drill",
      code: organizationCode,
      timezone: "UTC",
      date_format: "YYYY-MM-DD",
      language: "en",
      is_active: true,
      description: { none: [] },
      logo_url: { none: [] },
      website: { none: [] },
      email: { none: [] },
      phone: { none: [] },
      currency_id: { none: [] },
      metadata: { some: JSON.stringify({ disposable_c9_drill: true }) },
    },
  ])

  const organizations = await sql(
    adminToken,
    `SELECT id FROM organization WHERE code = '${organizationCode}' LIMIT 1`,
  )
  const organizationId = Number(organizations[0]?.id)
  if (!Number.isInteger(organizationId) || organizationId === 0) {
    throw new Error("fixture did not create an organization")
  }

  // The production registration boundary is platform-superuser-only. The
  // disposable module exposes its test harness, which elevates this local
  // caller before exercising the same production reducer below.
  await reducer(adminToken, "run_core_permissions_test", [])

  await reducer(adminToken, "register_cold_tier_service_identity", [
    organizationId,
    `c9-expense-worker-${process.pid}`,
    serviceName,
    { __identity__: `0x${workerIdentity}` },
  ])

  await reducer(adminToken, "apply_pending_expense_integration_intents", [organizationId, 1], false)
  await reducer(workerToken, "apply_pending_expense_integration_intents", [organizationId, 1])

  const registrations = await sql(
    adminToken,
    `SELECT service_name, is_active FROM cold_tier_service_identity WHERE organization_id = ${organizationId} AND service_name = '${serviceName}' LIMIT 1`,
  )
  if (registrations[0]?.service_name !== serviceName || registrations[0]?.is_active !== true) {
    throw new Error(`worker registration was not persisted: ${JSON.stringify(registrations[0] ?? null)}`)
  }
  for (const worker of [
    {
      service: "hr_integration_worker",
      token: hrWorkerToken,
      identity: hrWorkerIdentity,
      reducer: "apply_pending_hr_integration_intents",
    },
    {
      service: "project_integration_worker",
      token: projectWorkerToken,
      identity: projectWorkerIdentity,
      reducer: "apply_pending_project_integration_intents",
    },
  ]) {
    await reducer(adminToken, "register_cold_tier_service_identity", [
      organizationId,
      `c9-${worker.service}-${process.pid}`,
      worker.service,
      { __identity__: `0x${worker.identity}` },
    ])
    await reducer(adminToken, worker.reducer, [organizationId, 1], false)
    await reducer(worker.token, worker.reducer, [organizationId, 1])
  }
  for (const worker of [
    {
      service: "owner_report_worker",
      token: ownerReportWorkerToken,
      identity: ownerReportWorkerIdentity,
      queue: "owner_report",
    },
    {
      service: "workflow_worker",
      token: workflowWorkerToken,
      identity: workflowWorkerIdentity,
      queue: "workflow-external",
    },
  ]) {
    await reducer(adminToken, "register_cold_tier_service_identity", [
      organizationId,
      `c9-${worker.service}-${process.pid}`,
      worker.service,
      { __identity__: `0x${worker.identity}` },
    ])
    const workerName = `c9-${worker.service}-${process.pid}-${Date.now()}`
    const registrationArgs = [
      organizationId,
      {
        company_id: { none: [] },
        name: workerName,
        queues: [worker.queue],
        metadata: { none: [] },
      },
    ]
    await reducer(workerToken, "register_queue_worker", registrationArgs, false)
    await reducer(worker.token, "register_queue_worker", registrationArgs)
    const queueWorkers = await sql(
      adminToken,
      `SELECT id FROM queue_worker WHERE organization_id = ${organizationId} AND name = '${workerName}' LIMIT 1`,
    )
    const queueWorkerId = Number(queueWorkers[0]?.id)
    if (!Number.isInteger(queueWorkerId) || queueWorkerId === 0) {
      throw new Error(`${worker.service} queue registration was not persisted`)
    }
    await reducer(workerToken, "worker_heartbeat", [organizationId, queueWorkerId], false)
    await reducer(worker.token, "worker_heartbeat", [organizationId, queueWorkerId])
  }

  const companies = await sql(
    adminToken,
    "SELECT id, organization_id FROM company LIMIT 1",
  )
  const companyId = Number(companies[0]?.id)
  const gatewayOrganizationId = Number(companies[0]?.organization_id)
  if (!Number.isInteger(companyId) || companyId === 0 || !Number.isInteger(gatewayOrganizationId)) {
    throw new Error("platform-superuser fixture did not create a company")
  }
  await reducer(adminToken, "register_cold_tier_service_identity", [
    gatewayOrganizationId,
    `c9-iot-gateway-${process.pid}`,
    "iot_gateway",
    { __identity__: `0x${gatewayIdentity}` },
  ])
  await reducer(adminToken, "generate_hub_pairing_token", [gatewayOrganizationId, companyId])
  const pairingTokens = await sql(
    adminToken,
    `SELECT token FROM iot_pairing_token WHERE organization_id = ${gatewayOrganizationId} AND company_id = ${companyId} AND used = false LIMIT 1`,
  )
  const pairingToken = pairingTokens[0]?.token
  if (typeof pairingToken !== "string" || pairingToken.length === 0) {
    throw new Error("pairing token was not persisted")
  }
  const serial = `c9-gateway-${process.pid}-${Date.now()}`
  const credentialHash = "ab".repeat(32)
  const claimArgs = [pairingToken, serial, "C9 gateway", { none: [] }, { none: [] }, credentialHash]
  await reducer(adminToken, "claim_hub_with_token", claimArgs, false)
  await reducer(gatewayToken, "claim_hub_with_token", claimArgs)
  const hubs = await sql(
    adminToken,
    `SELECT organization_id, company_id, credential_hash FROM iot_hub WHERE serial = '${serial}' LIMIT 1`,
  )
  if (
    Number(hubs[0]?.organization_id) !== gatewayOrganizationId ||
    Number(hubs[0]?.company_id) !== companyId ||
    hubs[0]?.credential_hash !== credentialHash
  ) {
    throw new Error(`IoT gateway claim scope/hash mismatch: ${JSON.stringify(hubs[0] ?? null)}`)
  }
  console.log(
    `[c9-service-drill] passed: wrong identities rejected; distinct owner-report/workflow/expense/HR/project workers accepted for org=${organizationId}; dedicated IoT gateway claimed company=${companyId} with hash-only credential`,
  )
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
