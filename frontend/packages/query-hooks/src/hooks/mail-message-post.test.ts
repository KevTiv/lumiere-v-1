import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import { resolvePostedMessageEffect, type MailMessageProjection, type PostedMessageExpectation } from "./mail-message-post"

const expected: PostedMessageExpectation = { organizationId: 1n, model: "contact", resId: 7n, body: "hello" }

const message = (id: bigint, extra: Partial<MailMessageProjection> = {}): MailMessageProjection => ({
  id,
  organizationId: 1n,
  model: "contact",
  resId: 7n,
  body: "hello",
  ...extra,
})

test("resolves the one new message for the exact record and body", () => {
  const before = [message(1n), message(2n, { body: "other" })]
  const after = [...before, message(3n)]
  assert.deepEqual(resolvePostedMessageEffect(before, after, expected), { resource: "mail-messages", id: "3" })
})

test("an identical earlier message is not the effect", () => {
  const before = [message(1n)]
  assert.equal(resolvePostedMessageEffect(before, before, expected), null)
  assert.deepEqual(resolvePostedMessageEffect(before, [...before, message(2n)], expected), {
    resource: "mail-messages",
    id: "2",
  })
})

test("accepts snake_case rows", () => {
  const after = [{ id: "3", organization_id: "1", model: "contact", res_id: "7", body: "hello" }]
  assert.deepEqual(resolvePostedMessageEffect([], after, expected), { resource: "mail-messages", id: "3" })
})

test("a new message on another record, model, organization or body is no effect", () => {
  for (const other of [
    message(3n, { resId: 8n }),
    message(3n, { model: "lead" }),
    message(3n, { organizationId: 2n }),
    message(3n, { body: "hello!" }),
  ]) {
    assert.equal(resolvePostedMessageEffect([], [other], expected), null)
  }
})

test("throws when two identical messages appear", () => {
  assert.throws(
    () => resolvePostedMessageEffect([], [message(3n), message(4n)], expected),
    AmbiguousOperationEffectError,
  )
})
