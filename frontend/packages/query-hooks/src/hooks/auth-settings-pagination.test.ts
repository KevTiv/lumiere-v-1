import assert from "node:assert/strict"
import test from "node:test"

import { collectSettingsRows } from "./auth"

test("settings role pagination collects every page in offset order", async () => {
  const calls: Array<{ offset: number; limit: number }> = []
  const source = Array.from({ length: 205 }, (_, id) => ({ id }))

  const rows = await collectSettingsRows(async (offset, limit) => {
    calls.push({ offset, limit })
    return source.slice(offset, offset + limit)
  })

  assert.deepEqual(rows, source)
  assert.deepEqual(calls, [
    { offset: 0, limit: 100 },
    { offset: 100, limit: 100 },
    { offset: 200, limit: 100 },
  ])
})

test("settings role pagination rejects an invalid page size", async () => {
  await assert.rejects(
    collectSettingsRows(async () => [], 0),
    /pageSize must be a positive safe integer/,
  )
})
