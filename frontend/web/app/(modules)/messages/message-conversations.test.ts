import assert from "node:assert/strict"
import test from "node:test"
import {
  isNotificationMessage,
  isNotificationRead,
  matchingConversations,
  messageConversations,
  messageSource,
  notificationRecipient,
} from "./message-conversations"

test("threads join only visible parents with exactly matching model and record", () => {
  const rows = [
    {
      id: "1",
      model: "account_move",
      resId: "9",
      body: "Invoice",
      date: 1_000_000,
    },
    {
      id: "2",
      model: "account_move",
      resId: "9",
      parentId: { some: "1" },
      body: "Reply",
      date: 2_000_000,
    },
    {
      id: "3",
      model: "account_move",
      resId: "10",
      parentId: "1",
      body: "Other invoice",
    },
    {
      id: "4",
      model: "purchase_order",
      resId: "9",
      parentId: "1",
      body: "Other kind",
    },
    {
      id: "5",
      model: "account_move",
      resId: "9",
      parentId: "999",
      body: "Hidden parent",
    },
  ]
  const threads = messageConversations(rows)
  assert.equal(threads.length, 4)
  assert.deepEqual(
    threads.find((thread) => thread.id === "1")?.messages.map((row) => row.id),
    ["1", "2"],
  )
  assert.equal(matchingConversations(threads, "reply")[0]?.id, "1")
})

test("cycles and duplicate IDs cannot synthesize a root or ambiguous thread", () => {
  const threads = messageConversations([
    { id: "1", model: "account_move", resId: "9", parentId: "2" },
    { id: "2", model: "account_move", resId: "9", parentId: "1" },
    { id: "3", body: "duplicate A" },
    { id: "3", body: "duplicate B" },
  ])
  assert.equal(threads.length, 2)
  assert.ok(threads.every((thread) => thread.messages.length === 1))
  assert.equal(
    messageSource({
      id: "1",
      model: "account_move",
      resId: "18446744073709551615",
    })?.resId,
    "18446744073709551615",
  )
  assert.equal(messageSource({ id: "1", model: "", resId: "9" }), null)
})

test("loaded conversation search includes text beyond the list preview", () => {
  const threads = messageConversations([
    { id: "1", body: `${"x".repeat(120)} final detail` },
  ])
  assert.equal(matchingConversations(threads, "final detail").length, 1)
})

test("notification classification reads generated tags and durable metadata independently", () => {
  for (const kind of [
    { tag: "Notification" },
    { Notification: [] },
    "notification",
    "user_notification",
  ]) {
    assert.equal(isNotificationMessage({ id: "1", messageType: kind }), true)
  }
  const notification = {
    id: "1",
    messageType: { tag: "Notification" },
    metadata: { some: '{"recipient":"0xABCD","read_at":123}' },
  }
  assert.equal(notificationRecipient(notification), "abcd")
  assert.equal(isNotificationRead(notification), true)
  assert.equal(
    isNotificationRead({
      id: "2",
      messageType: { tag: "Comment" },
      metadata: '{"read_at":123}',
    }),
    false,
  )
  assert.equal(notificationRecipient({ id: "3", metadata: "invalid" }), null)
})
