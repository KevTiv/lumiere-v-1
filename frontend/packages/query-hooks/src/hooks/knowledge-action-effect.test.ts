import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveArticleMemberRemovalEffect,
  resolveKnowledgeCategoryDeleteEffect,
  resolveKnowledgeCategoryUpdateEffect,
  resolveRetentionPurgeScheduleEffect,
} from "./knowledge-action-effect"

test("category update requires the exact tenant row and requested values", () => {
  const rows = [
    { id: 7n, organizationId: 1n, name: "Tax", description: "Current", color: 3, sequence: 20 },
  ]
  assert.deepEqual(
    resolveKnowledgeCategoryUpdateEffect(rows, 1n, 7n, {
      name: { some: "Tax" },
      description: { some: "Current" },
      color: { some: 3 },
      sequence: { some: 20 },
    }),
    { resource: "knowledge-categories", id: "7" },
  )
  assert.equal(
    resolveKnowledgeCategoryUpdateEffect(rows, 1n, 7n, { name: { some: "Other" } }),
    null,
  )
})

test("category deletion requires exact absence", () => {
  assert.deepEqual(resolveKnowledgeCategoryDeleteEffect([], 1n, 7n), {
    resource: "knowledge-categories",
    id: "7",
  })
  assert.equal(resolveKnowledgeCategoryDeleteEffect([{ id: 7n, organizationId: 1n }], 1n, 7n), null)
})

test("member removal reads the exact article member list", () => {
  const base = { id: 9n, organizationId: 1n }
  assert.deepEqual(resolveArticleMemberRemovalEffect([{ ...base, memberIds: [] }], 1n, 9n, "abc"), {
    resource: "knowledge-articles",
    id: "9",
  })
  assert.equal(
    resolveArticleMemberRemovalEffect([{ ...base, memberIds: [{ __identity__: "ABC" }] }], 1n, 9n, "abc"),
    null,
  )
})

test("retention scheduling resolves one new organization-owned job", () => {
  const rows = [
    { scheduledId: 4n, organizationId: 1n },
    { scheduledId: 5n, organizationId: 1n },
    { scheduledId: 6n, organizationId: 2n },
  ]
  assert.deepEqual(resolveRetentionPurgeScheduleEffect(new Set([4n]), rows, 1n), {
    resource: "document-retention-purge-jobs",
    id: "5",
  })
})
