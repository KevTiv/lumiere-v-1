import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  resolveWorkflowVersionStateEffect,
  type WorkflowVersionEffectProjection,
} from "./workflow-version-effect"

const HASH = `sha256:${"a".repeat(64)}`
const published = (
  overrides: Partial<WorkflowVersionEffectProjection> = {},
): WorkflowVersionEffectProjection => ({
  id: 7n,
  organizationId: 1n,
  status: "Published",
  contentHash: HASH,
  publishedDate: "2026-10-13T00:00:00Z",
  retiredDate: null,
  ...overrides,
})
const expected = { resource: "workflow-versions", id: "7" }

test("publication resolves only the exact sealed version", () => {
  assert.deepEqual(resolveWorkflowVersionStateEffect([published()], 1n, 7n, "Published"), expected)
  assert.equal(resolveWorkflowVersionStateEffect([published({ status: "Draft" })], 1n, 7n, "Published"), null)
  assert.equal(resolveWorkflowVersionStateEffect([published({ contentHash: null })], 1n, 7n, "Published"), null)
  assert.equal(resolveWorkflowVersionStateEffect([published({ organizationId: 2n })], 1n, 7n, "Published"), null)
})

test("retirement requires the preserved seal and terminal timestamp", () => {
  assert.deepEqual(
    resolveWorkflowVersionStateEffect(
      [published({ status: { tag: "Retired" }, retiredDate: "2026-10-13T01:00:00Z" })],
      1n,
      7n,
      "Retired",
    ),
    expected,
  )
  assert.equal(
    resolveWorkflowVersionStateEffect([published({ status: "Retired" })], 1n, 7n, "Retired"),
    null,
  )
})

test("snake-case projections work and duplicate ids fail closed", () => {
  const row = {
    id: "7",
    organization_id: "1",
    status: { Retired: [] },
    content_hash: HASH,
    published_date: "2026-10-13T00:00:00Z",
    retired_date: "2026-10-13T01:00:00Z",
  }
  assert.deepEqual(resolveWorkflowVersionStateEffect([row], 1n, 7n, "Retired"), expected)
  assert.throws(
    () => resolveWorkflowVersionStateEffect([row, row], 1n, 7n, "Retired"),
    AmbiguousOperationEffectError,
  )
})
