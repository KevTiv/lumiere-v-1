import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import { resolvePostedMessageEffect, type MailMessagePostProjection } from "./mail-message-post"

const expected = { idempotencyKey: "key-1", model: "sale_order", resId: 7n }
const keyed = (id: bigint, key: string, over: Partial<MailMessagePostProjection> = {}): MailMessagePostProjection => ({
  id,
  organizationId: 1n,
  model: "sale_order",
  resId: 7n,
  metadata: JSON.stringify({ idempotency_key: key }),
  ...over,
})

test("returns the canonical ref for the exact keyed message", () => {
  assert.deepEqual(
    resolvePostedMessageEffect([keyed(4n, "other"), keyed(5n, "key-1")], 1n, expected),
    { resource: "mail-messages", id: "5" },
  )
})

test("accepts snake_case projection rows", () => {
  assert.deepEqual(
    resolvePostedMessageEffect(
      [{ id: "5", organization_id: "1", model: "sale_order", res_id: "7", metadata: '{"idempotency_key":"key-1"}' }],
      1n,
      expected,
    ),
    { resource: "mail-messages", id: "5" },
  )
})

test("ignores rows without a readable key, including a newer identical body", () => {
  for (const metadata of [null, undefined, "", "not json", "{}", '{"idempotency_key":7}', '{"delivery":"sent"}']) {
    assert.equal(resolvePostedMessageEffect([keyed(5n, "key-1", { metadata })], 1n, expected), null, String(metadata))
  }
})

test("ignores the same key outside the exact organization, model and record scope", () => {
  assert.deepEqual(
    resolvePostedMessageEffect(
      [
        keyed(2n, "key-1", { organizationId: 2n }),
        keyed(3n, "key-1", { model: "purchase_order" }),
        keyed(4n, "key-1", { resId: 8n }),
        keyed(5n, "key-1"),
      ],
      1n,
      expected,
    ),
    { resource: "mail-messages", id: "5" },
  )
})

test("returns null before the message is visible", () => {
  assert.equal(resolvePostedMessageEffect([], 1n, expected), null)
})

test("refuses to pick between two rows carrying the same key", () => {
  assert.throws(
    () => resolvePostedMessageEffect([keyed(5n, "key-1"), keyed(6n, "key-1")], 1n, expected),
    AmbiguousOperationEffectError,
  )
})
