import assert from "node:assert/strict"
import test from "node:test"
import { buildPurchasingConfigurationSubmission } from "./purchasing-configuration"

test("builds a scorecard upsert with bounded numeric scores", () => {
  assert.deepEqual(
    buildPurchasingConfigurationSubmission("scorecard", {
      partnerId: "42",
      otifScore: "97.5",
      qualityScore: "88",
    }),
    {
      kind: "scorecard",
      params: {
        partnerId: 42n,
        otifScore: 97.5,
        qualityScore: 88,
        metadata: null,
      },
    },
  )
  assert.throws(
    () =>
      buildPurchasingConfigurationSubmission("scorecard", {
        partnerId: "42",
        otifScore: "101",
        qualityScore: "88",
      }),
    /between 0 and 100/,
  )
})

test("rejects an approval delegation to the same identity", () => {
  assert.throws(
    () =>
      buildPurchasingConfigurationSubmission("approvalDelegate", {
        principalIdentity: "abc",
        delegateIdentity: "abc",
        isActive: true,
      }),
    /must be different/,
  )
})

test("builds an idempotent integration intent with an optional order", () => {
  assert.deepEqual(
    buildPurchasingConfigurationSubmission("integrationIntent", {
      provider: "EDI",
      intentType: "send_po",
      purchaseOrderId: "55",
      idempotencyKey: "po-55-v1",
      requestPayload: '{"version":1}',
    }),
    {
      kind: "integrationIntent",
      params: {
        provider: "EDI",
        intentType: "send_po",
        purchaseOrderId: 55n,
        idempotencyKey: "po-55-v1",
        requestPayload: '{"version":1}',
        metadata: null,
      },
    },
  )
})

test("validates contract date ordering and scoped ids", () => {
  assert.throws(
    () =>
      buildPurchasingConfigurationSubmission("contract", {
        name: "Annual steel",
        partnerId: "0",
      }),
    /positive id/,
  )
  assert.throws(
    () =>
      buildPurchasingConfigurationSubmission("contract", {
        name: "Annual steel",
        partnerId: "7",
        dateStart: "2027-02-01",
        dateEnd: "2027-01-01",
      }),
    /End date/,
  )
})
