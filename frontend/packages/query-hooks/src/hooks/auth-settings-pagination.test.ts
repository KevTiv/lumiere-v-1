import assert from "node:assert/strict"
import test from "node:test"
import { createLumiereApiClient, registerLumiereApiClient } from "@lumiere/api-client"

import { collectSettingsRows, fetchOrganizationUserProfiles } from "./auth"

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

test("organization user profiles use the paginated settings directory", async (t) => {
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://api.test" }))
  const profiles = Array.from({ length: 101 }, (_, id) => ({
    identity: `user-${id}`,
    name: `User ${id}`,
  }))
  const offsets: number[] = []
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = new URL(input)
    assert.equal(url.pathname, "/api/settings/users")
    assert.equal(url.searchParams.get("search"), "Jean & Co")
    assert.equal(url.searchParams.get("limit"), "100")
    const offset = Number(url.searchParams.get("offset"))
    offsets.push(offset)
    return Response.json({ data: profiles.slice(offset, offset + 100) })
  })

  assert.deepEqual(await fetchOrganizationUserProfiles("Jean & Co"), profiles)
  assert.deepEqual(offsets, [0, 100])
})

test("organization user profiles retain the directory denial status", async (t) => {
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://api.test" }))
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 403 }))

  await assert.rejects(fetchOrganizationUserProfiles(), { status: 403 })
})
