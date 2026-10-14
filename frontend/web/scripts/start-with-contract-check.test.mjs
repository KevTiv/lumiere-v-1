import assert from "node:assert/strict"
import test from "node:test"

import { readContractCheckConfig, verifyContractsService } from "./start-with-contract-check.mjs"

const response = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => payload,
})

test("local startup may omit the contracts service", () => {
  assert.equal(readContractCheckConfig({}), null)
})

test("Railway startup fails closed when the dependency is not configured", () => {
  assert.throws(
    () => readContractCheckConfig({ RAILWAY_ENVIRONMENT_ID: "production" }),
    /LUMIERE_CONTRACTS_URL/,
  )
})

test("accepts the expected contracts service and version", async () => {
  const payload = await verifyContractsService(
    { url: "http://lumiere-contracts.railway.internal:8080", expectedVersion: "0.3.106" },
    {
      fetchImpl: async () => response({ service: "lumiere-contracts", version: "0.3.106", status: "ok" }),
      attempts: 1,
    },
  )

  assert.equal(payload.version, "0.3.106")
})

test("rejects a contracts version mismatch", async () => {
  await assert.rejects(
    verifyContractsService(
      { url: "http://lumiere-contracts.railway.internal:8080", expectedVersion: "0.3.106" },
      {
        fetchImpl: async () => response({ service: "lumiere-contracts", version: "0.3.105", status: "ok" }),
        attempts: 1,
      },
    ),
    /version mismatch/,
  )
})

test("retries transient failures before accepting the service", async () => {
  let calls = 0
  const payload = await verifyContractsService(
    { url: "http://lumiere-contracts.railway.internal:8080", expectedVersion: "0.3.106" },
    {
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) throw new Error("private DNS not ready")
        return response({ service: "lumiere-contracts", version: "0.3.106", status: "ok" })
      },
      attempts: 2,
      sleep: async () => {},
      logger: { warn() {} },
    },
  )

  assert.equal(calls, 2)
  assert.equal(payload.status, "ok")
})
