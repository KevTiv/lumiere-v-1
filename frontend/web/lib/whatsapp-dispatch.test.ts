import assert from "node:assert/strict"
import { test } from "node:test"
import {
  canReviewWhatsApp,
  renderWhatsAppTemplate,
  whatsappOptionsSchema,
  whatsappRequest,
  whatsappSendSchema,
  whatsappStatusSchema,
} from "./whatsapp-dispatch"

const options = () =>
  whatsappOptionsSchema.parse({
    messageId: "4",
    body: "Invoice INV-1",
    senderName: "Test merchant",
    recipient: "***3456",
    replyWindowOpen: true,
    optedOut: false,
    quietHoursAllow: true,
    templates: [],
    transport: { state: "not_attempted", providerAccepted: false },
    dailyLimit: 20,
  })

test("template variables are literal text, not nested template instructions", () => {
  assert.equal(renderWhatsAppTemplate("Hello {{1}}: {{2}}", ["{{2}}", "42"]), "Hello {{2}}: 42")
  assert.equal(renderWhatsAppTemplate("Invoice {{1}}", ["INV-1"]), "Invoice INV-1")
  assert.equal(renderWhatsAppTemplate("{{0}}", ["bad"]), null)
  assert.equal(renderWhatsAppTemplate("{{2}}", ["missing"]), null)
  assert.equal(renderWhatsAppTemplate("{{1}}", ["💡".repeat(1100)]), null)
})

test("known attempts, STOP and quiet hours block another review", () => {
  const value = options()
  assert.equal(canReviewWhatsApp(value), true)
  for (const state of ["attempted", "accepted", "unknown", "rejected", "prepared"] as const) {
    assert.equal(
      canReviewWhatsApp({ ...value, transport: { state, providerAccepted: false } }),
      false,
    )
  }
  assert.equal(canReviewWhatsApp({ ...value, optedOut: true }), false)
  assert.equal(canReviewWhatsApp({ ...value, quietHoursAllow: false }), false)
})

test("transport acceptance and actual recipient delivery remain distinct", () => {
  const status = whatsappStatusSchema.parse({
    messageId: "4",
    deliveryState: "queued",
    transport: { state: "accepted", providerAccepted: true },
  })
  assert.equal(status.deliveryState, "queued")
  assert.equal(status.transport.state, "accepted")
  assert.equal(
    whatsappSendSchema.safeParse({
      state: "delivered",
      messageId: "4",
      canAutomaticallyRetry: false,
    }).success,
    false,
  )
  assert.equal(
    whatsappSendSchema.safeParse({ state: "unknown", messageId: "4", canAutomaticallyRetry: true })
      .success,
    false,
  )
})

test("a lost send response is not retried by the transport helper", async (context) => {
  let calls = 0
  context.mock.method(globalThis, "fetch", async () => {
    calls += 1
    throw new TypeError("network lost after request")
  })
  await assert.rejects(
    () =>
      whatsappRequest("/api/whatsapp/messages/4/dispatch", whatsappSendSchema, {
        method: "POST",
        body: JSON.stringify({ companyId: "3", reviewId: "a".repeat(64) }),
      }),
    /network lost/,
  )
  assert.equal(calls, 1)
})

test("HTTP denial is surfaced and cannot be parsed as a successful send", async (context) => {
  context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ error: "consent revoked" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
  )
  await assert.rejects(
    () => whatsappRequest("/api/whatsapp/messages/4/dispatch", whatsappSendSchema),
    /consent revoked/,
  )
})
